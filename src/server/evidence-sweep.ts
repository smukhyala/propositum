/**
 * Deleting what the agent saw, once nobody needs it.
 *
 * ── The sentence this file exists to keep true ──────────────────────────
 *
 * `docs/SECURITY_AND_PRIVACY.md` publishes a retention promise. Without a
 * sweep, the honest version of that promise for the acting path would be *"we
 * keep everything the agent ever saw, forever"* — every accessibility tree of
 * every page it touched inside the person's authenticated session, and every
 * screenshot, which are the heaviest and by a distance the most revealing rows
 * in this database. A bounded per-turn budget says how much is kept per turn.
 * It says nothing at all about how long.
 *
 * So the budget and the sweep are two halves of one promise, and publishing
 * either without the other publishes a promise that is not kept.
 *
 * ── Two rules, and the normal one is not the window ─────────────────────
 *
 * 1. **A settled run's evidence goes immediately.** Once the person has
 *    accepted or rejected everything a Shift produced, the snapshots have no
 *    remaining reader. This is the rule that fires in ordinary use.
 * 2. **Everything goes past the window, settled or not.** The backstop for runs
 *    that failed, were interrupted, or are waiting on a confirmation nobody
 *    ever answered. Without it, a run that ended badly would keep its evidence
 *    for the life of the database — and a run that ended badly is exactly the
 *    one that saw a page it should not have.
 *
 * ── The published exception, and it is not a small one ──────────────────
 *
 * A `ConfirmationRequest` holds a foreign key to the exact row the person was
 * looking at when they authorised an irreversible effect. `confirmation_request`
 * is append-only, so the sweep can neither delete the row it points at nor clear
 * the pointer — and it never will be able to. Those rows are kept **forever**,
 * not "as long as the question is". The two are the same thing here, because the
 * question is kept forever too.
 *
 * Say the cost out loud: this is the row most likely to be a SCREENSHOT OF A
 * PAGE THE PERSON WAS SIGNED INTO, because a confirmation question is exactly
 * the moment the accessibility tree was insufficient. A retention module that
 * kept an indefinite exception quiet would be worse than no retention module,
 * because the sweep's existence is what makes the seven days believable.
 *
 * So the rows stay, they are COUNTED by every pass rather than silently
 * skipped, `docs/SECURITY_AND_PRIVACY.md` says "kept indefinitely" in those
 * words, and ADR-0010 carries it as a risk and a revisit condition. The real
 * fix is for `ConfirmationRequest` to be an audit record without holding a
 * foreign key to a screenshot, which is a schema change and someone else's ADR.
 */

import type { ActionEvidenceRepository, EvidenceSweepCounts } from '../persistence/repositories/index'

/**
 * How long unsettled ActionEvidence survives. A published constant, in the same
 * sense as the two budgets in `src/model/untrusted.ts`: the promise is the
 * artifact and the number is downstream of the promise sentence.
 *
 * ── Why seven days ──────────────────────────────────────────────────────
 *
 * The floor is set by the confirmation pause. ADR-0010 §5 makes a stopped run
 * recoverable by a NEW run days later, and CONTEXT.md's override list notes
 * that "a Shift can now span a person's coffee break". In practice it spans a
 * weekend: asked on Friday evening, answered on Monday morning. A window that
 * expires inside that deletes the snapshot the question was about, and then the
 * screen asking a person to authorise an effect can no longer show them what
 * they would be authorising. Anything shorter than about four days makes that
 * the normal case rather than the edge one.
 *
 * The ceiling is set by what these rows are. A week-old accessibility tree of a
 * signed-in page answers a question nobody is asking; a month-old screenshot of
 * one is a liability with no reader. Nothing in the ShiftReport renders from
 * ActionEvidence, so no product surface degrades when it goes.
 *
 * Seven days is the smallest number comfortably above the floor. It is a
 * ceiling and not a normal lifetime — rule 1 above reaps a settled run's
 * evidence within an hour of the person deciding.
 */
export const ACTION_EVIDENCE_RETENTION_DAYS = 7

const DAY_MS = 24 * 60 * 60 * 1000

export interface EvidenceSweepDeps {
  readonly evidence: ActionEvidenceRepository
  /**
   * Injected so a test does not have to wait a week, and so nothing in here
   * calls `Date.now()` — the same rule the rest of the codebase follows.
   *
   * Note what is NOT here: an override for the window. A caller-supplied
   * `retentionDays` would make the published promise a parameter, and the first
   * caller passing 90 to debug something would be a privacy regression that
   * typechecks. Tests move the CLOCK instead, which is the same experiment
   * without a second way to say how long evidence lives.
   */
  readonly now: () => Date
}

export interface EvidenceSweepResult {
  /** Rows removed because the run they belong to is fully decided. */
  readonly settled: EvidenceSweepCounts
  /** Rows removed because they aged out, whatever their run is doing. */
  readonly expired: EvidenceSweepCounts
  /**
   * A true total. Deletions are disjoint — the settled pass runs first, so
   * nothing it took can be taken again.
   *
   * There is deliberately NO combined `keptForConfirmation` beside it. A row in
   * a settled run that is ALSO past the window is counted by both passes, and a
   * summed figure would report two rows where one exists. The two counts are
   * reported separately and named per-pass rather than reconciled into a number
   * that is wrong in a way nobody would ever check.
   */
  readonly deleted: number
}

/**
 * One pass. Safe to call repeatedly and safe to call concurrently with a run.
 *
 * Settled first, then expired — the order is not arbitrary. Doing settled first
 * means the expired pass has less to look at, and more importantly it means the
 * two counts do not double-count the same row: whatever the settled pass took
 * is already gone when the expired pass runs.
 */
export async function sweepActionEvidence(
  deps: EvidenceSweepDeps,
): Promise<EvidenceSweepResult> {
  const createdBefore = new Date(deps.now().getTime() - ACTION_EVIDENCE_RETENTION_DAYS * DAY_MS)

  const settled = await deps.evidence.sweepSettledRuns()
  const expired = await deps.evidence.sweepOlderThan(createdBefore)

  return { settled, expired, deleted: settled.deleted + expired.deleted }
}
