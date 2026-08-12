/**
 * What a Shift produced — the closed set, and the two values that say whether
 * anyone can still change their mind about it.
 *
 * ── Why these live in the domain rather than beside the writer ────────────
 *
 * `src/server/outcomes/` is the only place that ASSIGNS either of these, and
 * `tests/architecture.test.ts` holds that line with a grep. But the vocabulary
 * itself is needed one layer further in: `WorkerJob.expects` carries
 * `ShiftOutcomeKind`s so the runtime can tell a worker what shape of result the
 * ratified contract is after, and the runtime must not import from the server.
 * So the names live here, in the layer both sides may depend on, and the
 * authority to write them stays where the ADR put it.
 *
 * ── The two things named `Reversibility` in this directory ────────────────
 *
 * `./reversibility.ts` already exports a type of that name, and it means
 * something else entirely: `ordinary | requires-confirmation`, the gate's
 * question about whether a PROPOSED action needs a person before it happens.
 * This one is CONTEXT.md's value object on `ShiftOutcome`: `held | landed`, a
 * fact about work that has ALREADY happened.
 *
 * Two names for two different questions asked at two different times is a real
 * cost, and it is written down here rather than discovered by someone importing
 * the wrong one. Nothing imports both — the classifier belongs to the gate, this
 * belongs to the outcome writers — and CONTEXT.md names this one, so this one
 * keeps the name it was given.
 */

import { LANDING_ACTION_KINDS } from '../handoff/policy'
import type { ActionKind } from '../handoff/policy'

/**
 * Five kinds, closed, code-owned. There is deliberately **no `other`**.
 *
 * ADR-0009 argues it at length and the short form is: an `other` kind is a
 * free-text field wearing an enum's clothes. Every consumer would need a
 * fallback branch, and the fallback branch is exactly where a landed effect gets
 * rendered as a reviewable proposal — the one rendering error in this design
 * that lies to somebody.
 *
 * A production matching no kind is DROPPED AND COUNTED. The count is the
 * evidence that the set is wrong; a silent drop is not.
 */
export const SHIFT_OUTCOME_KINDS = [
  'document-changes',
  'collection',
  'answer',
  'message-draft',
  'external-effect',
] as const
export type ShiftOutcomeKind = (typeof SHIFT_OUTCOME_KINDS)[number]

/**
 * `held | landed`. Two values, and the second one is why there are not three.
 *
 * Either the interface can offer a control that undoes the thing or it cannot.
 * "Partially reversible" has no operational meaning — there is no half-button —
 * and a third value would exist only so that somebody could later render it as
 * a disabled one, which is the lie ADR-0009 spends a paragraph refusing.
 *
 * This is the same argument that gives `HandoffContract.status` two members.
 */
export const REVERSIBILITIES = ['held', 'landed'] as const
export type Reversibility = (typeof REVERSIBILITIES)[number]

/**
 * Did this run put anything out in the world?
 *
 * Computed from the ledger, never from a model and never from configuration: an
 * outcome is `landed` when the completed `ActionIntent` that produced it carried
 * a kind in `LANDING_ACTION_KINDS`. A model that could declare its own work
 * reversible would be granting, and granting is the one thing a model may never
 * do.
 *
 * `LANDING_ACTION_KINDS` is empty today, so this returns `held` for everything,
 * and `tests/reachability.test.ts` pins that emptiness deliberately. The day a
 * capability lands, this function is already the single place that notices.
 */
export function reversibilityOf(kind: ActionKind | undefined): Reversibility {
  return kind !== undefined && LANDING_ACTION_KINDS.has(kind) ? 'landed' : 'held'
}
