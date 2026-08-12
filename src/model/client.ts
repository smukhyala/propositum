/**
 * The model boundary.
 *
 * Eight places in Propositum call a model: session-reading inference, handoff
 * generation, planning, worker action proposals, review, shift-report
 * narration, naming a detected thread, and composing what to offer to do about
 * it. All eight go through this one interface, so provider calls never appear
 * in UI or domain code.
 *
 * ── Two shapes, deliberately separated ───────────────────────────────────
 *
 * A `ModelBoundary` is DATA: a prompt builder, a schema, a version, a token
 * budget. It is pure and trivially testable, and it is where the interesting
 * decisions live.
 *
 * A `ModelClient` is the MACHINE that runs one: call, classify, repair, record.
 * There is one real implementation and one fake, and neither knows anything
 * about any particular boundary.
 *
 * ── Failures are values, not exceptions ──────────────────────────────────
 *
 * `run()` does not throw for model failures. An unattended run at 2am has to
 * record what went wrong and decide what to do; an exception thrown through the
 * worker loop loses the telemetry and turns a recoverable boundary failure into
 * a dead run.
 *
 * It throws only for programmer error — a boundary that cannot be built at all.
 */

import type { ZodType } from 'zod'

/** The eight. Used as `ModelCallRecord.boundary`. */
export const BOUNDARY_NAMES = [
  'session-reading',
  'handoff',
  'plan',
  'worker-action',
  'review',
  'shift-report',
  /** Naming a detected thread. Runs with no session and no contract — gated
   *  behind deterministic detection, sees titles only, and grants nothing.
   *  See ADR-0008 and boundaries/subject.ts. */
  'subject',
  /** Composing what Propositum would do about a named thread. The same gating
   *  as `subject` and a higher bar in front of it: deterministic OfferGrounds
   *  must be sufficient before it runs at all. It writes prose, names no place
   *  and no ActionKind, and grants nothing. See ADR-0009 and
   *  boundaries/offer.ts — including why it is a separate call. */
  'offer',
] as const
export type BoundaryName = (typeof BOUNDARY_NAMES)[number]

/**
 * Above this, the Anthropic TypeScript SDK throws LOCALLY before any HTTP call
 * unless the request streams. Verified in #6's research; encoded here so a
 * boundary that raises its budget cannot silently become unrunnable.
 */
export const NON_STREAMING_MAX_TOKENS = 21_333

export interface PromptParts {
  readonly system?: string | undefined
  readonly user: string
}

/**
 * One model boundary, as data.
 *
 * `promptVersion` is recorded on every call. Prompts are code — they need
 * review and regression tests — and a telemetry row that cannot say which
 * prompt produced it is not traceability.
 */
export interface ModelBoundary<TInput, TOutput> {
  readonly name: BoundaryName
  readonly promptVersion: string
  readonly schema: ZodType<TOutput>
  readonly maxTokens: number
  /**
   * Streaming is not a cost lever. It is required above
   * NON_STREAMING_MAX_TOKENS, and it is a genuine liveness signal for a run
   * nobody is watching. Never parse the JSON incrementally.
   */
  readonly stream?: boolean | undefined
  buildPrompt(input: TInput): PromptParts
}

/** What a call cost and how it went. One of these becomes a `ModelCallRecord`. */
export interface CallTelemetry {
  readonly boundary: BoundaryName
  readonly model: string
  readonly promptVersion: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly latencyMs: number
  readonly stopReason: string | null
  readonly repairTurns: number
}

/**
 * Why a call failed, classified BY `stop_reason` BEFORE any parse is attempted.
 *
 * Order matters and is easy to get wrong: the SDK's parser throws on truncated
 * JSON without consulting `stop_reason`, so a parse-first design reports
 * "schema mismatch" for what is actually "ran out of tokens" — and then repairs
 * the wrong problem, burning a turn to be told the same thing again.
 */
export type FailureKind =
  /** The model declined. Terminal — retrying reproduces it. */
  | 'refusal'
  /** Ran out of tokens mid-object. One doubled-budget escalation. */
  | 'truncation'
  /** Well-formed JSON, wrong shape. Exactly one repair turn quoting the issues. */
  | 'schema-mismatch'
  /** Network or 5xx. The SDK already retries with backoff — do not stack another layer. */
  | 'transport'

export type BoundaryResult<T> =
  | { readonly ok: true; readonly value: T; readonly telemetry: CallTelemetry }
  | {
      readonly ok: false
      readonly failure: FailureKind
      readonly detail: string
      readonly telemetry: CallTelemetry
    }

export interface ModelClient {
  run<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    input: TInput,
  ): Promise<BoundaryResult<TOutput>>
}

/**
 * Classify before parsing. Exported so both the real client and the tests use
 * the same rules rather than two implementations that drift.
 */
export function classifyStopReason(stopReason: string | null): FailureKind | null {
  switch (stopReason) {
    case 'refusal':
      return 'refusal'
    case 'max_tokens':
      return 'truncation'
    default:
      return null
  }
}

/** Whether a failure is worth another attempt, and what kind. */
export function recoveryFor(failure: FailureKind): 'none' | 'escalate-tokens' | 'repair' {
  switch (failure) {
    // Terminal. The model decided; asking again asks the same model the same
    // thing and wastes a turn plus, on an unattended run, real minutes.
    case 'refusal':
      return 'none'
    case 'truncation':
      return 'escalate-tokens'
    case 'schema-mismatch':
      return 'repair'
    // Already handled by SDK backoff. Stacking our own retries multiplies the
    // delay and hides the real error behind a timeout.
    case 'transport':
      return 'none'
  }
}
