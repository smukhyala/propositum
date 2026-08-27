/**
 * Boundary 6, wired — the one sentence at the top of the handover note.
 *
 * ── What was wrong before this file ──────────────────────────────────────
 *
 * `shiftReportBoundary` was written, tested and called by nothing.
 * `execute-run.ts` stored `narrative: stopLabel` instead — a **consumer label
 * from the stop rule**, rendered in the field model prose belongs in. Not
 * wrong, and not what the field means: a person coming back to *"I ran out of
 * the time you gave me."* is told where the run stopped and nothing about what
 * it did. A clean run that hit no stop rule stored `null` and the top of the
 * screen was a time window.
 *
 * `tests/reachability.test.ts` asserted the absence in its deferred block and
 * named the consequence in the same words. This file is what turns that
 * assertion round.
 *
 * ── Every fact here comes from a row ─────────────────────────────────────
 *
 * The boundary's own header is the rule: *"A model summarising its own ledger
 * can soften or omit."* So nothing below is asked of the model. The objective
 * is the contract's, the steps are `PlanStep` rows joined to their outcomes,
 * the counts are counts, and the stop reason is the deterministic label. The
 * model is handed established facts and writes one sentence over them; the list
 * underneath it on the screen is still rendered from the same rows
 * independently, so the sentence can be checked against the receipt.
 *
 * ── It fails open, and here is what that costs ───────────────────────────
 *
 * A boundary failure returns `null` and the caller keeps what it would have
 * written before. That is the behaviour the boundary's header asks for — *"If
 * this boundary fails, the report renders without it"* — and the prototype
 * finding it also quotes is the cost: with no narrative, the top of the
 * re-entry screen is the least useful version of itself.
 *
 * Failing open is still right, because the alternative is a report that cannot
 * be written at all, and the report is the only durable record of an
 * `interrupted` Shift.
 *
 * ── What this deliberately does NOT narrate ──────────────────────────────
 *
 * **A crashed run.** `writeReport` routes a `failureDetail` to a code-authored
 * sentence and never reaches this file. Asking a model to narrate a run whose
 * own boundary calls were failing is asking the least reliable component in the
 * system to explain its own outage, and the answer would be indistinguishable
 * from a confident one.
 *
 * **A cancelled run.** *"You stopped me, so I put everything down where it
 * was."* is exact, it is what the person just did, and there is nothing for a
 * sentence to add.
 */

import { shiftReportBoundary } from '../model/boundaries/shift-report'
import { splitSteps } from '../domain/outcome/plan-progress'
import type { ModelClient } from '../model/client'
import type { AppContext } from './db'

export interface NarrateShiftInput {
  readonly ctx: AppContext
  readonly model: ModelClient
  readonly runId: string
  readonly contractId: string
  readonly sessionId: string
  /** The contract's stated objective — never the reading's objective claim. */
  readonly objective: string
  /** The stop rule's consumer label, or null when nothing stopped it. */
  readonly stoppedBecause: string | null
  /** True when the run ended by lease sweep, so the end time is the sweep's
   *  clock rather than the lid's and the copy must hedge. */
  readonly endTimeIsApproximate: boolean
  readonly decisions: readonly { readonly question: string }[]
}

/**
 * One sentence, or `null`.
 *
 * `null` is a designed outcome and appears three ways: the boundary failed, the
 * model returned an empty string, or there was nothing to narrate. The caller
 * cannot tell them apart and does not need to — all three mean *keep what you
 * had*.
 */
export async function narrateShift(input: NarrateShiftInput): Promise<string | null> {
  const { ctx } = input

  const steps = await ctx.repos.plans.forRun(input.runId)
  const { completed, notDone } = splitSteps(steps)

  const changeset = await ctx.repos.changesets.forContract(input.contractId)
  const gapCount = await ctx.repos.events.countByKind(input.sessionId, 'captureGap')

  /**
   * Refusals are counted from the plan's own intents rather than queried
   * separately, because these rows are already here and a second query for a
   * number is a round trip for nothing.
   *
   * `authorized: false` is the gate refusing — one of the five verbs, and the
   * only one of them that produces a row shaped like this.
   */
  const refusalCount = steps.reduce(
    (total, step) => total + step.intents.filter((intent) => !intent.authorized).length,
    0,
  )

  /**
   * Nothing planned, nothing refused, nothing changed, nothing to decide.
   *
   * There is no sentence to write about that and a model asked for one will
   * write it anyway. Returning early keeps the run free rather than spending a
   * call to be told what the absence already says.
   */
  if (
    completed.length === 0 &&
    notDone.length === 0 &&
    refusalCount === 0 &&
    input.decisions.length === 0 &&
    (changeset?.changes.length ?? 0) === 0
  ) {
    return null
  }

  const result = await input.model.run(shiftReportBoundary, {
    objective: input.objective,
    completed,
    notDone,
    changeCount: changeset?.changes.length ?? 0,
    refusalCount,
    gapCount,
    decisions: input.decisions.map((decision) => decision.question),
    stoppedBecause: input.stoppedBecause,
    endTimeIsApproximate: input.endTimeIsApproximate,
  })

  // A failure is a value here, the way it is at every other boundary in this
  // repository. Nothing is thrown across the worker loop — a recoverable
  // boundary failure must not become a dead run.
  if (!result.ok) return null

  const narrative = result.value.narrative.trim()
  return narrative === '' ? null : narrative
}
