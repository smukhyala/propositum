/**
 * The one place a real ModelClient is built, and the one place a call becomes a
 * row.
 *
 * ── What this is NOT, said first ─────────────────────────────────────────
 *
 * Not a router, not a registry, not a provider abstraction. There is one
 * provider and one client class, and [ADR-0005](../../docs/adr/0005-model-boundary.md)
 * closes with *"Revisit when a second provider is genuinely required. The
 * interface allows it; nothing else should."* This file is the *nothing else*:
 * it collapses five construction sites into one function and it CHOOSES
 * nothing. A `switch` on a provider name here, or a per-boundary model, would
 * be the first half of a Worker Router — which the direction document puts on
 * the do-not-build list, and which would arrive with no second worker to route
 * between.
 *
 * ── The two things five hardcoded sites were getting wrong ───────────────
 *
 * `scripts/worker.ts`, `src/server/actions.ts`, `src/app/api/session/current/route.ts`
 * (twice) and `scripts/eval.ts` each wrote `new AnthropicModelClient({ apiKey })`
 * and nothing else. So:
 *
 *  1. **`AnthropicModelClientOptions.model` existed and no caller passed it.**
 *     All eight boundaries ran on a module const nothing outside that file could
 *     reach, while the eval harness and the verification script each read
 *     `PROPOSITUM_MODEL` for the model id they PRINT. The id in a scoring
 *     worksheet and the id that was actually called were two different reads
 *     that happened to agree. `modelId()` is now the only read, and the default
 *     is `DEFAULT_MODEL` — unchanged, deliberately: this collapse must not move
 *     which model runs.
 *  2. **`onCall` — the declared `ModelCallRecord` write hook — had zero
 *     callers.** `model_call_record` has existed as a table with all three
 *     append-only triggers and no writer, so every call's model, latency,
 *     tokens, stop reason, failure kind and repair count was computed and
 *     dropped. That is the gap this file closes, and it closes it in one place
 *     so a sixth construction site cannot reopen it by omission.
 *
 * ── Why the sink is a function and not a repository ──────────────────────
 *
 * `src/model` and `src/persistence` do not import each other, and a telemetry
 * row is not a good enough reason to make this the first edge. The caller
 * supplies `repos.modelCalls.create` and structural typing binds the two.
 *
 * The cost is named rather than hidden: `ModelCallRow` below and the
 * repository's input are written out twice, and the assignment is
 * contravariant — so a field ADDED to the repository fails typecheck at every
 * call site, while a field REMOVED from it does not. This is the same trade
 * `IntentionFacts` already takes at the domain boundary and for the same
 * reason, and it is a weaker check in one direction than it looks.
 */

import { AnthropicModelClient, DEFAULT_MODEL } from './anthropic'
import type { BoundaryName, CallTelemetry, FailureKind, ModelClient } from './client'

/**
 * The configuration this file reads, and all of it.
 *
 * An environment variable rather than a config object, because that is what the
 * rest of the process already is — `ANTHROPIC_API_KEY`, `PROPOSITUM_FAST_DETECT`,
 * `PROPOSITUM_EXTENSION_ID` — and one local user with a `.env` does not need a
 * settings layer to have opinions about.
 */
const MODEL_ENV_VAR = 'PROPOSITUM_MODEL'

/**
 * Which model every boundary runs on.
 *
 * Exported so the eval harness records the same id it calls, from the same
 * read. A blank or whitespace value is treated as absent: an override someone
 * cleared in `.env` is a request for the default, never a request to call a
 * model with no name — and the API's error for that would name the field rather
 * than the file.
 *
 * There is no per-boundary override and there should not be one. Eight
 * boundaries on one model is what makes a `ModelCallRecord` comparable across
 * them; a per-boundary dial would make every cost and latency comparison a
 * question about configuration first.
 */
export function modelId(): string {
  const configured = process.env[MODEL_ENV_VAR]?.trim()
  return configured === undefined || configured === '' ? DEFAULT_MODEL : configured
}

/**
 * One `ModelCallRecord`, as the model layer produces it.
 *
 * ── One row per ATTEMPT, not per call ────────────────────────────────────
 *
 * ADR-0005: *"`onCall` fires once per attempt, including failures —
 * traceability that only records successes is not traceability."* A boundary
 * that failed its schema check and was repaired therefore writes TWO rows, and
 * a reader counting rows is counting attempts.
 *
 * ── `repairTurns` counts second attempts, which is not what it is called ─
 *
 * The client passes `1` for BOTH recovery paths — the repair turn and the
 * doubled-token escalation — so a row with `repairTurns: 1` may be either, and
 * nothing in the table distinguishes them. The preceding row's `failureKind`
 * does (`schema-mismatch` versus `truncation`), and nothing joins the two rows.
 * Naming a third state would mean a schema change on an append-only table, and
 * the honest note is cheaper than the honest column until someone needs to
 * query it.
 */
export interface ModelCallRow {
  /** The run these calls belong to, or null. Null is ORDINARY, not a gap: the
   *  reading, drafting, `subject` and `offer` boundaries all run before any
   *  AgentRun exists, and two of them run with no session at all. */
  readonly runId: string | null
  readonly boundary: BoundaryName
  readonly model: string
  readonly promptVersion: string
  /** Null where the attempt threw and the usage never came back — which is
   *  not the same fact as zero, and the column is nullable for that reason.
   *  See `CallTelemetry.inputTokens`. */
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly latencyMs: number
  readonly stopReason: string | null
  /** Null means the attempt succeeded. `FailureKind` has no member for "it
   *  worked", and inventing one would be a second spelling of success in a
   *  nullable column. */
  readonly failureKind: FailureKind | null
  readonly repairTurns: number
}

/** Where a row goes. `repos.modelCalls.create` satisfies this; so does a test
 *  double that collects them, which is the point of it being a function. */
export type ModelCallSink = (row: ModelCallRow) => Promise<unknown>

export interface ModelClientOptions {
  readonly apiKey: string
  /** Set only where a run id is genuinely in hand. See `ModelCallRow.runId`. */
  readonly runId?: string | null | undefined
  /**
   * Omitted where there is no database to write to — `scripts/eval.ts` is the
   * only such caller and it is a standalone harness. Omitting it means the call
   * is not recorded, which is yesterday's behaviour rather than a silent
   * failure, and it is the one case where that is the right answer.
   */
  readonly record?: ModelCallSink | undefined
}

export function createModelClient(options: ModelClientOptions): ModelClient {
  const record = options.record

  return new AnthropicModelClient({
    apiKey: options.apiKey,
    model: modelId(),
    // `exactOptionalPropertyTypes`: an absent hook and a hook that is
    // `undefined` are different types here, so the property is spread in rather
    // than assigned.
    ...(record === undefined ? {} : { onCall: recorder(record, options.runId ?? null) }),
  })
}

/**
 * Telemetry in, a fire-and-forget write out.
 *
 * ── Why the try/catch is HERE, and what it cannot cover ──────────────────
 *
 * A failure to WRITE a telemetry row must never fail the model call that
 * produced it. Two failures can break that, and neither place can hold both:
 *
 *   - A hook that throws SYNCHRONOUSLY is `AnthropicModelClient`'s to hold,
 *     because it is the only code between the hook and the `BoundaryResult`.
 *     `AnthropicModelClient.record` explains what a throw would corrupt there.
 *   - An ASYNCHRONOUS rejection from the write itself is THIS function's, and
 *     only this function's. `onCall` returns `void`, so the promise never
 *     crosses back into the client — there is nothing there to await. Left
 *     alone it is an unhandled rejection, which Node terminates the process
 *     for: a worker mid-shift dying because a SQLite insert lost a race. That
 *     is the specific accident this `.catch` prevents.
 *
 * The write is wrapped in an `async` function rather than called directly so
 * that a sink which throws before returning a promise becomes a rejection this
 * same `.catch` holds. One guard, both shapes.
 *
 * ── The weakness, not rounded up ─────────────────────────────────────────
 *
 * A telemetry write that fails is LOST SILENTLY and nothing counts the losses.
 * `model_call_record` is append-only with no expected sequence, so a missing row
 * is indistinguishable from a call that never happened — which is exactly the
 * shape of defect the reachability suite exists to remember, reintroduced one
 * level down. It is accepted here because the alternatives are worse (crash the
 * worker, or fail the call), and because `src/model` has no reporting channel:
 * there is no logger in `src/` at all, and threading one through five call
 * sites for a failure nobody has yet seen is a build, not a fix.
 * When a `ModelCallRecord` reader lands and a gap in it matters, this is where
 * the count belongs.
 */
function recorder(
  record: ModelCallSink,
  runId: string | null,
): (telemetry: CallTelemetry, failure?: FailureKind) => void {
  return (telemetry, failure) => {
    const write = async (): Promise<void> => {
      await record({
        runId,
        boundary: telemetry.boundary,
        // `telemetry.model` is what the API SAID it ran, falling back to what we
        // asked for. Recording the answer rather than the request is the whole
        // value of the column — an alias that resolves to something else is a
        // fact about the call, not about the config.
        model: telemetry.model,
        promptVersion: telemetry.promptVersion,
        inputTokens: telemetry.inputTokens,
        outputTokens: telemetry.outputTokens,
        latencyMs: telemetry.latencyMs,
        stopReason: telemetry.stopReason,
        failureKind: failure ?? null,
        repairTurns: telemetry.repairTurns,
      })
    }

    void write().catch(() => {
      /* See above. The call's own result is the thing being protected. */
    })
  }
}
