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
 *
 * **It is not the only such bound, found 2026-09-03.** The SDK also carries a
 * PER-MODEL non-streaming cap — `MODEL_NONSTREAMING_TOKENS` in
 * `internal/constants.js`, 8,192 for the Opus 4 family — and refuses the same
 * way when a budget under this number exceeds that one. Nothing here can know
 * it: the model comes from `PROPOSITUM_MODEL` at runtime and the table is the
 * SDK's private business. So this constant keeps a boundary off the refusal on
 * the default model and cannot promise more than that; `classifyThrow` in
 * `anthropic.ts` is what handles the refusal when it happens anyway.
 */
export const NON_STREAMING_MAX_TOKENS = 21_333

export interface PromptParts {
  readonly system?: string | undefined
  readonly user: string
  /**
   * Pictures that travel WITH `user`, in the same turn.
   *
   * ── Why this field had to exist ──────────────────────────────────────
   *
   * `capture-screen` is its own `ActionKind` with its own grant, and the
   * hybrid perception model it belongs to is deliberate: the accessibility
   * tree first, a screenshot when the tree is not enough. It only fires
   * because a run already decided the tree was insufficient.
   *
   * Until this field, there was no image path at all. `PromptParts` was
   * `{ system, user }`, the client sent `content: prompt.user` — a bare
   * string — and a boundary that said *"a screenshot is attached"* was
   * telling the model something untrue. The likely behaviour is the worst
   * kind: the agent looks again, gets nothing again, and spends its action
   * cap discovering that the capability does not work. A prompt that claims
   * an attachment it does not send is worse than one that admits it cannot
   * see, because only the second lets the model change strategy.
   *
   * ── Base64 rather than a URL, and why that is not a limitation ───────
   *
   * The alternative is `source: { type: 'url' }`, which asks Anthropic's
   * servers to fetch an address. The only images this project has are pixels
   * of a page inside somebody's signed-in browser; publishing them at a URL
   * so a third party can fetch them is a data flow nobody agreed to. Bytes
   * in the request body go exactly where the rest of the prompt goes.
   *
   * `image/png` only, and that is a deliberate narrowing rather than an
   * oversight: it is what the browser control channel produces, and a wider
   * union here would be a union the rest of the code cannot supply.
   */
  readonly images?: ReadonlyArray<{ mediaType: 'image/png'; base64: string }> | undefined
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
  /**
   * What the API said it billed, or NULL when we never learned.
   *
   * ── Why null and zero are different, added 2026-09-03 ────────────────
   *
   * Zero is a claim: *the call spent nothing*. Null is the absence of one:
   * *the call happened and its usage never came back*. Until this field was
   * nullable the failure path in `anthropic.ts` reported zero for both, and
   * the 2026-09-02 eval run printed a session reading — the largest call in
   * the corpus — as `$0.0000 · 22298 ms · 1 call`. Twenty-two seconds of
   * generation the API billed for, recorded as free, and summed into a run
   * total that read as a figure rather than a floor.
   *
   * A throw out of the SDK is the case that produces null: the usage block
   * was on a message no caller ever holds. It does NOT cover a call that
   * genuinely spent nothing — `FakeModelClient` still reports zero, because
   * for a scripted reply zero is the true number rather than an unknown one.
   *
   * Anything summing these is summing a lower bound, and should say so.
   */
  readonly inputTokens: number | null
  readonly outputTokens: number | null
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
  /**
   * Ran out of tokens mid-object. One doubled-budget escalation.
   *
   * Since 2026-09-03 it carries a second thing that is not that: the SDK's own
   * refusal to send a non-streaming request whose budget it cannot time out.
   * The cause is the opposite way round — our request was too big, rather than
   * the reply being cut off — and the kind is shared because the recovery is
   * the same one, and because doubling the budget is what flips that call onto
   * the streaming path. `classifyThrow` in `anthropic.ts` argues it, including
   * the two shapes where the doubling does not help.
   */
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
