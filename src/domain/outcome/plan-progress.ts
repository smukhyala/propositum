/**
 * Which of a run's stated steps came to something, and which did not.
 *
 * ── Why this is a function and not a column ──────────────────────────────
 *
 * A `PlanStep` is what the model SAID it would do. Whether it happened is a
 * fact about `ActionIntent` and `ActionOutcome`, which are append-only and are
 * the receipt. Storing a status beside the step would be a second, mutable
 * opinion about the same question — and the first time the two disagreed, the
 * one on screen would be the wrong one.
 *
 * So the answer is computed from the rows every time, here, where it is pure
 * and cheap to test.
 *
 * ── The rule, and the direction it fails in ──────────────────────────────
 *
 * A step is **done** when at least one of its intents was authorised AND that
 * intent's outcome says `succeeded`. Everything else is not done: refused,
 * failed, and — the one worth naming — **authorised with no outcome at all**,
 * which is what a run that died mid-action leaves behind.
 *
 * That last case is deliberately on the *not done* side. An intent with no
 * outcome is `unknown`, not success: the schema's own comment says
 * `observedBy` exists because "a run that dies between the effect and the
 * outcome" is indistinguishable from one that did nothing. Reporting it as
 * done would be the narrative claiming an effect the ledger cannot show, which
 * is the one thing the split above the model exists to prevent.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not rank, weight or judge. A step whose action succeeded but
 * achieved nothing useful is *done* here, because "did the thing happen" is the
 * only question rows can answer. Whether it was worth doing is the person's,
 * and the reviewer's, and neither is this function.
 *
 * It also says nothing about a run with no steps: both lists come back empty,
 * and a caller that reads that as "nothing was done" is wrong in the same way
 * for a run that never planned as for one that planned and failed. The caller
 * has `refusalCount` and a stop reason to tell those apart.
 */

/** One stated step, with just enough of its intents to answer the question. */
export interface PlanStepProgress {
  readonly ordinal: number
  readonly intent: string
  readonly intents: readonly { readonly authorized: boolean; readonly result: string | null }[]
}

export interface SplitSteps {
  /** The step's own words, in plan order. */
  readonly completed: readonly string[]
  readonly notDone: readonly string[]
}

/** Deterministic, order-preserving, and it reads no clock. */
export function splitSteps(steps: readonly PlanStepProgress[]): SplitSteps {
  const completed: string[] = []
  const notDone: string[] = []

  for (const step of [...steps].sort((a, b) => a.ordinal - b.ordinal)) {
    const landed = step.intents.some((intent) => intent.authorized && intent.result === 'succeeded')
    ;(landed ? completed : notDone).push(step.intent)
  }

  return { completed, notDone }
}
