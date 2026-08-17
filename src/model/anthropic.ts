/**
 * The one real ModelClient.
 *
 * Uses structured outputs — `output_format` + `betaZodOutputFormat` +
 * `client.beta.messages.parse()`. All three are under the BETA namespace; the
 * research originally recorded the stable names and was wrong, corrected in #3.
 *
 * Structured outputs and forced tool use ride the same grammar-constrained
 * sampling pipeline, so reliability is identical. Structured outputs skips the
 * 406-token forced-tool system prompt on every call and keeps `stop_reason`
 * legible (`end_turn` rather than `tool_use`) — which is what makes
 * classify-before-parse possible.
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
import {
  NON_STREAMING_MAX_TOKENS,
  classifyStopReason,
  recoveryFor,
} from './client'
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
      const message = await this.sdk.beta.messages.parse({
        model: this.model,
        max_tokens: maxTokens,
        stream,
        output_format: betaZodOutputFormat(boundary.schema as ZodType),
        ...(prompt.system === undefined ? {} : { system: prompt.system }),
        messages: [{ role: 'user', content: userContent(prompt) }],
      } as Parameters<typeof this.sdk.beta.messages.parse>[0])

      const telemetry: CallTelemetry = {
        boundary: boundary.name,
        model: message.model ?? this.model,
        promptVersion: boundary.promptVersion,
        inputTokens: message.usage?.input_tokens ?? 0,
        outputTokens: message.usage?.output_tokens ?? 0,
        latencyMs: Math.round(this.now() - started),
        stopReason: message.stop_reason ?? null,
        repairTurns,
      }

      // Classify BEFORE looking at the parsed output. The SDK's parser throws on
      // truncated JSON without checking stop_reason, so a parse-first design
      // repairs the wrong problem.
      const stopFailure = classifyStopReason(telemetry.stopReason)
      if (stopFailure) return this.fail(telemetry, stopFailure, `stop_reason=${telemetry.stopReason}`)

      const parsed = (message as { parsed_output?: unknown }).parsed_output
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
          validated.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
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
