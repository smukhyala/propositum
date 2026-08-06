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
} from './client.js'
import type {
  BoundaryResult,
  CallTelemetry,
  FailureKind,
  ModelBoundary,
  ModelClient,
  PromptParts,
} from './client.js'

export interface AnthropicModelClientOptions {
  readonly apiKey: string
  readonly model?: string
  /** Injected so tests and fixtures are not at the mercy of the wall clock. */
  readonly now?: () => number
  /** Called once per attempt, including failures — this is the ModelCallRecord
   *  write hook. Traceability that only records successes is not traceability. */
  readonly onCall?: (telemetry: CallTelemetry, failure?: FailureKind) => void
}

const DEFAULT_MODEL = 'claude-opus-5'

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
        messages: [{ role: 'user', content: prompt.user }],
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

      this.onCall?.(telemetry)
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
    this.onCall?.(telemetry, failure)
    return { ok: false, failure, detail, telemetry }
  }
}
