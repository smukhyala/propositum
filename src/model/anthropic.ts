/**
 * The one real ModelClient.
 *
 * Uses structured outputs — `betaZodOutputFormat` throughout, reached by two
 * different call shapes. Everything here is under the BETA namespace; the
 * research originally recorded the stable names and was wrong, corrected in #3.
 *
 * Structured outputs and forced tool use ride the same grammar-constrained
 * sampling pipeline, so reliability is identical. Structured outputs skips the
 * 406-token forced-tool system prompt on every call and keeps `stop_reason`
 * legible (`end_turn` rather than `tool_use`) — which is what makes
 * classify-before-parse possible.
 *
 * ── Two call shapes, and why they cannot be one ──────────────────────────
 *
 * A boundary that does not stream goes through `beta.messages.parse()` with
 * `output_format`, and the SDK hands back `parsed_output`. A boundary that
 * streams goes through `beta.messages.stream()` with `output_config.format`,
 * and this file decodes the text block itself.
 *
 * The asymmetry is ugly and it is not a preference. It is the shape of a
 * version lag, measured against `claude-opus-5` on `@anthropic-ai/sdk`
 * **0.71.2** — name the version, because the whole thing is only true of it:
 *
 *   `.parse()`  + `output_format`     + `stream: false`  works.
 *   `.parse()`  + `output_format`     + `stream: true`   throws inside the SDK.
 *       `.parse()` pipes the returned Stream straight into `parseBetaMessage`,
 *       which does `message.content.map(...)` on a Stream that has no
 *       `content` — `Cannot read properties of undefined (reading 'map')`.
 *   `.stream()` + `output_format`                        HTTP 400:
 *       *"output_format: This field is deprecated. Use 'output_config.format'
 *       instead."*
 *   `.stream()` + `output_config.format`                 works, and
 *       `parsed_output` comes back **null**, because `maybeParseBetaMessage`
 *       tests `params.output_format` and reads nothing else. See
 *       `lib/beta-parser.js` in the installed SDK.
 *
 * So the field the API has deprecated is the only field the SDK's parser
 * knows, and no single request shape satisfies both endpoints. The
 * non-streaming path is therefore left on `output_format` DELIBERATELY:
 * moving it to `output_config.format` for symmetry would null its
 * `parsed_output` too and break the boundaries that work today, buying
 * tidiness with three regressions.
 *
 * This is the shape of a defect that hid for a whole wave. `worker-action` is
 * the only boundary that streams, every other test of this layer runs on
 * `FakeModelClient` — which never touches the SDK — and a live eval of four
 * scenarios took `0 action(s)` on all four while 1,709 tests stayed green.
 * Two things stop it coming back and both are load-bearing:
 * `tests/architecture.test.ts` refuses a `stream: true` boundary reaching the
 * `.parse()` call site, and `tests/model-boundary.live.test.ts` drives the
 * streaming path against the real API.
 *
 * **Revisit when the SDK's parser learns `output_config.format`.** Then both
 * paths collapse onto it, `decodeStreamedOutput` goes, and so does this
 * section. Upgrading the SDK is the real fix; the lag is a fact to work with
 * today.
 *
 * ── What the grammar does and does not do (verified, #3) ─────────────────
 *
 * It enforces SHAPE. It does not enforce `enum`, `const`, `default`,
 * `minLength`, `maxLength`, or `pattern` — all are folded into `description` as
 * prose. Zod enforces those client-side on parse, and the gap between the two
 * is exactly where the repair turn belongs.
 *
 * ── No prompt caching ────────────────────────────────────────────────────
 *
 * Changing `output_format` invalidates the cache, so six schemas mean six
 * mutually-exclusive prefixes even with byte-identical system prompts. Four of
 * the six boundaries run once per handoff, minutes apart, against a 5-minute
 * TTL — `cache_control` there is a pure 1.25x write tax that is never read.
 * Measured input is ~470 tokens for a small boundary, so there is nothing to
 * save. Deliberately omitted; see ADR-0005.
 */

import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { ZodType } from 'zod'
import { NON_STREAMING_MAX_TOKENS, classifyStopReason, recoveryFor } from './client'
import type {
  BoundaryResult,
  CallTelemetry,
  FailureKind,
  ModelBoundary,
  ModelClient,
  PromptParts,
} from './client'

export interface AnthropicModelClientOptions {
  readonly apiKey: string
  readonly model?: string
  /** Injected so tests and fixtures are not at the mercy of the wall clock. */
  readonly now?: () => number
  /** Called once per attempt, including failures — this is the ModelCallRecord
   *  write hook. Traceability that only records successes is not traceability. */
  readonly onCall?: (telemetry: CallTelemetry, failure?: FailureKind) => void
}

/**
 * The model every boundary runs on unless configuration says otherwise.
 *
 * Exported so `provider.ts` can fall back to it by name rather than by copying
 * the string. It was copied three times before that — here, in `scripts/eval.ts`
 * and in `scripts/verify-model.ts` — and two of the three were the id the
 * harness PRINTED while this one was the id the client actually called. Two
 * copies of a model id is how a scoring worksheet comes to name a model that
 * never ran.
 */
export const DEFAULT_MODEL = 'claude-opus-5'

export class AnthropicModelClient implements ModelClient {
  private readonly sdk: Anthropic
  private readonly model: string
  private readonly now: () => number
  private readonly onCall: ((t: CallTelemetry, f?: FailureKind) => void) | undefined

  constructor(options: AnthropicModelClientOptions) {
    this.sdk = new Anthropic({ apiKey: options.apiKey })
    this.model = options.model ?? DEFAULT_MODEL
    this.now = options.now ?? (() => performance.now())
    this.onCall = options.onCall
  }

  async run<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    input: TInput,
  ): Promise<BoundaryResult<TOutput>> {
    const prompt = boundary.buildPrompt(input)

    let attempt = await this.attempt(boundary, prompt, boundary.maxTokens, 0)

    if (!attempt.ok) {
      const recovery = recoveryFor(attempt.failure)

      if (recovery === 'escalate-tokens') {
        // Exactly one escalation. A second would double again into a budget the
        // boundary never sized for, on a run nobody is watching.
        attempt = await this.attempt(boundary, prompt, boundary.maxTokens * 2, 1)
      } else if (recovery === 'repair') {
        // Exactly one repair turn, quoting the specific Zod issues. More than
        // one rarely converges and always costs minutes.
        attempt = await this.attempt(
          boundary,
          {
            system: prompt.system,
            user: `${prompt.user}\n\n---\nYour previous reply did not match the required shape:\n${attempt.detail}\n\nReply again with the same content, corrected.`,
          },
          boundary.maxTokens,
          1,
        )
      }
    }

    return attempt
  }

  private async attempt<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    prompt: PromptParts,
    maxTokens: number,
    repairTurns: number,
  ): Promise<BoundaryResult<TOutput>> {
    // The SDK throws locally above this unless streaming — better to fail here,
    // with a message naming the boundary, than inside the SDK.
    const stream = boundary.stream ?? maxTokens > NON_STREAMING_MAX_TOKENS

    const started = this.now()
    const blank = (): CallTelemetry => ({
      boundary: boundary.name,
      model: this.model,
      promptVersion: boundary.promptVersion,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Math.round(this.now() - started),
      stopReason: null,
      repairTurns,
    })

    try {
      const message = stream
        ? await this.streamed(boundary, prompt, maxTokens)
        : await this.parsed(boundary, prompt, maxTokens)

      const telemetry: CallTelemetry = {
        boundary: boundary.name,
        model: message.model ?? this.model,
        promptVersion: boundary.promptVersion,
        // `finalMessage()` assembles usage from `message_start` and
        // `message_delta` rather than reading one field off one body, so these
        // two are checked live rather than assumed — a streamed call reporting
        // 0 in / 0 out is the cost half of every worksheet quietly going blank.
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        latencyMs: Math.round(this.now() - started),
        stopReason: message.stop_reason ?? null,
        repairTurns,
      }

      // Classify BEFORE looking at the parsed output. The SDK's parser throws on
      // truncated JSON without checking stop_reason, so a parse-first design
      // repairs the wrong problem. It is also what makes the JSON.parse below
      // safe to read as a shape failure: truncation has already been ruled out.
      const stopFailure = classifyStopReason(telemetry.stopReason)
      if (stopFailure)
        return this.fail(telemetry, stopFailure, `stop_reason=${telemetry.stopReason}`)

      // The one step the two paths do not share. See the header: on the
      // streaming path the SDK leaves `parsed_output` null however well the
      // call went, so the object has to be lifted out of the text ourselves.
      const obtained = stream
        ? decodeStreamedOutput(message)
        : { ok: true as const, value: (message as { parsed_output?: unknown }).parsed_output }

      if (!obtained.ok) return this.fail(telemetry, 'schema-mismatch', obtained.detail)

      const parsed = obtained.value
      if (parsed === undefined || parsed === null) {
        return this.fail(telemetry, 'schema-mismatch', 'no parsed output returned')
      }

      // Re-validate with Zod. The grammar guaranteed shape; everything else —
      // bounds, patterns, enum membership, refinements — is only prose to the
      // model and has to be checked here.
      const validated = boundary.schema.safeParse(parsed)
      if (!validated.success) {
        return this.fail(
          telemetry,
          'schema-mismatch',
          validated.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
        )
      }

      this.record(telemetry)
      return { ok: true, value: validated.data, telemetry }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const telemetry = blank()
      // A local throw for an oversized non-streaming request is our bug, not the
      // network's — say so rather than filing it under 'transport'.
      const kind: FailureKind = /max_tokens/i.test(message) ? 'truncation' : 'transport'
      return this.fail(telemetry, kind, message)
    }
  }

  /**
   * The non-streaming request, unchanged and deliberately so.
   *
   * `output_format` is deprecated on the API and it is the ONLY field the
   * SDK's parser consults, so this is the one shape where `parsed_output`
   * arrives populated. Moving it to `output_config.format` to match the
   * streaming path would null it here as well. See the file header.
   */
  private async parsed<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    prompt: PromptParts,
    maxTokens: number,
  ) {
    return await this.sdk.beta.messages.parse({
      model: this.model,
      max_tokens: maxTokens,
      stream: false,
      output_format: betaZodOutputFormat(boundary.schema as ZodType),
      ...(prompt.system === undefined ? {} : { system: prompt.system }),
      messages: [{ role: 'user', content: userContent(prompt) }],
    } as Parameters<typeof this.sdk.beta.messages.parse>[0])
  }

  /**
   * The streaming request.
   *
   * `.parse()` cannot do this — it pipes the Stream it gets back into
   * `parseBetaMessage`, which maps over a `content` array a Stream does not
   * have, and the TypeError surfaces as `transport`. `.stream()` is the call
   * that exists for it, and `output_config.format` is the field that endpoint
   * accepts.
   *
   * `finalMessage()` and not the event stream: ADR-0005 says streaming is a
   * liveness signal and never an incremental parse, so nothing here reads a
   * delta. What the streaming buys is a connection that keeps talking on a run
   * nobody is watching, and a `max_tokens` above `NON_STREAMING_MAX_TOKENS`
   * that the SDK would otherwise refuse locally.
   *
   * The cast is the version lag in one line: `BetaOutputConfig` in 0.71.2
   * declares `effort` and nothing else, so the field the endpoint requires is
   * not in the type that describes the endpoint.
   */
  private async streamed<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    prompt: PromptParts,
    maxTokens: number,
  ) {
    const streaming = this.sdk.beta.messages.stream({
      model: this.model,
      max_tokens: maxTokens,
      output_config: { format: betaZodOutputFormat(boundary.schema as ZodType) },
      ...(prompt.system === undefined ? {} : { system: prompt.system }),
      messages: [{ role: 'user', content: userContent(prompt) }],
    } as Parameters<typeof this.sdk.beta.messages.stream>[0])

    return await streaming.finalMessage()
  }

  private fail<T>(
    telemetry: CallTelemetry,
    failure: FailureKind,
    detail: string,
  ): BoundaryResult<T> {
    this.record(telemetry, failure)
    return { ok: false, failure, detail, telemetry }
  }

  /**
   * The hook, held at arm's length.
   *
   * ── Why the try/catch is HERE, and what it cannot cover ──────────────────
   *
   * A failure to write a telemetry row must never fail the model call that
   * produced it, and there are two ways a hook can break that promise. This
   * catch holds the first: a hook that throws SYNCHRONOUSLY. Only this class
   * can hold that one, because it is the only code between the hook and the
   * `BoundaryResult`, and both call sites turn a throw into a lie:
   *
   *   - The success call sits INSIDE the try that classifies model failures, so
   *     a throwing hook would be caught there and reported as `transport` — a
   *     network failure that never happened, invented by the thing recording it.
   *   - `fail()` sits outside every try, so a throw there escapes `run()` as an
   *     exception. That is precisely what this file's header forbids: *"an
   *     exception thrown through the worker loop loses the telemetry and turns a
   *     recoverable boundary failure into a dead run."*
   *
   * The second way — an ASYNCHRONOUS rejection from the write — cannot be held
   * here at all. `onCall` returns `void`, so the promise never crosses back and
   * there is nothing here to await or catch. That half is `provider.ts`'s, and
   * it says so.
   *
   * ── The weakness, not rounded up ─────────────────────────────────────────
   *
   * This swallows silently. A hook that throws on every call is invisible from
   * here, and it stays invisible: this class has no logger, and giving the
   * observed thing a second reporting channel to report on its observer is
   * worse than the gap. The consequence is real — telemetry can stop being
   * written and nothing in the model layer will say so.
   *
   * **There is no mitigation, and this docblock used to claim one.** It said the
   * sink `provider.ts` builds reports its own failures; `provider.ts` says the
   * opposite in as many words — *"a telemetry write that fails is LOST SILENTLY
   * and nothing counts the losses"* — and its `.catch` is empty, because there
   * is no logger in `src/` at all. Two files disagreeing about whether a silent
   * failure is reported is worse than the silence: a reader of this one was
   * told the loss surfaces somewhere. It does not. `provider.ts` holds the
   * honest statement and names where the count belongs when a
   * `ModelCallRecord` reader lands.
   */
  private record(telemetry: CallTelemetry, failure?: FailureKind): void {
    try {
      this.onCall?.(telemetry, failure)
    } catch {
      /* See above. The call's own result is the thing being protected. */
    }
  }
}

/**
 * The object, lifted out of a streamed message by hand.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * `output_config.format` constrains the sampler exactly as `output_format`
 * does — the text block that comes back IS the JSON the grammar produced. What
 * does not happen is the SDK parsing it: `maybeParseBetaMessage` decides
 * whether to parse by testing `params.output_format`, which the streaming
 * request cannot send, so `parsed_output` is null on a call that went
 * perfectly. This is the four lines that fill that in. See the file header for
 * the version this is true of.
 *
 * ── Why a JSON.parse failure here is `schema-mismatch` ───────────────────
 *
 * `classifyStopReason` has already run, so `max_tokens` is off the table and
 * the response in hand is COMPLETE. Text that is complete and still not JSON
 * is the model having produced the wrong shape, which is what
 * `schema-mismatch` names and what ADR-0005 gives one repair turn to.
 *
 * Calling it `transport` instead would be inventing a network failure that did
 * not happen, and it would also switch off the repair — `recoveryFor` returns
 * `none` for transport. Half of why the streaming defect stayed hidden for a
 * wave is exactly this: a TypeError inside the SDK was reported as a transport
 * error, which is the one classification nobody investigates.
 *
 * ── Blocks joined rather than the first one taken ────────────────────────
 *
 * A structured-output response is one text block today. Joining is what stays
 * correct if it ever is not, and costs nothing when it is.
 */
function decodeStreamedOutput(
  message: unknown,
):
  { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly detail: string } {
  const content = (message as { content?: unknown }).content
  const blocks = Array.isArray(content) ? content : []

  let text = ''
  for (const block of blocks) {
    const candidate = block as { type?: unknown; text?: unknown }
    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      text += candidate.text
    }
  }

  if (text.trim() === '') {
    return { ok: false, detail: 'streamed response carried no text block' }
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { ok: false, detail: `streamed response was not JSON: ${reason}` }
  }
}

/**
 * One user turn: the prose, plus any pictures that belong with it.
 *
 * ── Why images come FIRST, before the text ───────────────────────────────
 *
 * Anthropic's own vision guidance puts the image block ahead of the text
 * block, and the ordering is not cosmetic — a question placed after the image
 * is a question about something the model has already been shown. Reversed,
 * the model reads an instruction referring to a picture it has not seen yet.
 *
 * ── A bare string when there are no images, deliberately ─────────────────
 *
 * `content` accepts either a string or an array of blocks, and the two are
 * equivalent to the API. Keeping the string form on the overwhelmingly common
 * path means every existing boundary produces byte-identical requests to the
 * ones it produced before this function existed — which matters more than it
 * sounds, because a changed request prefix is a cold prompt cache on every
 * boundary at once.
 *
 * ── `base64` is the bytes, and nothing here validates them ───────────────
 *
 * A malformed image is the API's error to report, not ours to pre-empt. What
 * this must never do is log or echo the data: it is pixels of a page inside
 * somebody's signed-in browser, and the only place it belongs is the request
 * body.
 */
function userContent(prompt: PromptParts): unknown {
  const images = prompt.images ?? []
  if (images.length === 0) return prompt.user

  return [
    ...images.map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mediaType, data: image.base64 },
    })),
    { type: 'text' as const, text: prompt.user },
  ]
}
