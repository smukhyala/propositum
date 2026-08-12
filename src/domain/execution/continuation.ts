/**
 * What happens after somebody answers a confirmation.
 *
 * ── The thing this file is protecting ────────────────────────────────────
 *
 * ADR-0010 concedes its own price in its first paragraph: `ActionKind` now
 * enumerates MECHANISMS rather than EFFECTS, so `click-element` can press
 * *Send*, and ADR-0004's strongest claim — "a prohibition implemented as a
 * missing capability cannot be misconfigured" — is substantively false even
 * though the enum still passes its test. What replaced the absence is a
 * confirmation pause, and **a pause is strictly weaker than an absence**. It
 * can be clicked through, it gets tired at nine in the evening, and it can be
 * defeated by a two-line "improvement" that unblocks a stuck run.
 *
 * So every rule below is written on the assumption that somebody will one day
 * want to relax it, and says why they must not.
 *
 * ── Two clocks that are allowed to disagree ──────────────────────────────
 *
 * `CONFIRMATION_EXPIRY_HOURS` is 24: how long a question stays ANSWERABLE.
 * `MAX_PAUSE_CREDIT_MINUTES` is 240: the most waiting time a shift will credit
 * back. Those two numbers do not agree, deliberately, and the gap between them
 * is a real state a person can land in — answering at six in the evening a
 * question asked at nine in the morning, on a thirty-minute shift.
 *
 * The decision, taken explicitly rather than absorbed: **tell them plainly and
 * stop.** The confirmation is still valid — their yes is recorded as a yes, and
 * the ledger says a human was consulted and agreed — but the shift's time limit
 * is a bound they set and it has passed, so the continuation completes without
 * doing anything and says so.
 *
 * Three alternatives were available and each is worse:
 *
 *   - **Credit the whole wait.** Then "I gave it thirty minutes" stops being
 *     true the first time somebody goes to lunch, and the time limit becomes a
 *     number in a form rather than a bound.
 *   - **Shorten the expiry to match the credit.** Then a question expires while
 *     somebody is still willing to answer it, which pushes people toward
 *     answering fast rather than reading — the precise habit the pause exists
 *     to prevent.
 *   - **Let the run start and hit `budget_exhausted` on its first proposal.**
 *     Then the person sees a run that appears to resume and silently does
 *     nothing, which is the worst of the four: it looks like their answer was
 *     ignored, and the only evidence otherwise is a refusal row.
 *
 * The fourth option is this one. It costs a run that ends immediately, and it
 * buys a sentence the person can act on.
 *
 * ── No clock, no I/O ─────────────────────────────────────────────────────
 *
 * Everything here is a pure function of numbers a caller read off durable rows.
 * `deadlineFor` in `./stop-conditions` is a pure function of immutable
 * timestamps and recomputes to the same value after any number of restarts;
 * these are the decisions taken on top of it, and they inherit that property
 * only by never reaching for `Date.now()` themselves.
 */

import { CONFIRMATION_EXPIRY_HOURS } from './stop-conditions'

/**
 * `AgentRun.terminalReason` when a continuation arrived after its shift's
 * credited deadline.
 *
 * Its own reason rather than `budget-exhausted`, even though the underlying
 * fact is the same elapsed time. `budget-exhausted` means "I worked until the
 * time ran out"; this means "I never started, because the time had already run
 * out when you answered". Those lead a person to different next moves — the
 * first says give me longer, the second says the question sat too long — and
 * collapsing them would make the report say the run did work it never did.
 */
export const ANSWERED_TOO_LATE = 'answered-too-late'

/**
 * `AgentRun.terminalReason` when nobody answered within
 * `CONFIRMATION_EXPIRY_HOURS`.
 *
 * **This is not a verdict and must never become one.** An expired request has
 * NO `ConfirmationVerdict` row — not `rejected`, not anything — so the gate
 * sees exactly the absence it saw before the question was ever asked. There is
 * no code path from elapsed time to permission because there is no value for
 * elapsed time to write. A confirmation that times out into *yes* is the
 * failure mode this entire feature exists to prevent.
 */
export const CONFIRMATION_EXPIRED = 'confirmation-expired'

/**
 * What the person is told when their answer arrived after the time limit.
 *
 * Consumer copy, so: no run, no queue, no job, no worker. It says the true
 * thing plainly and takes responsibility for the outcome rather than blaming
 * the person for being slow — they were reading a question about something
 * irreversible, which is exactly what we asked them to do.
 */
export const ANSWERED_TOO_LATE_REPORT =
  'You answered after the time limit, so I did not go on. Nothing was done. Hand the work over again if you still want it.'

/**
 * What the person is told when a question sat unanswered for a day.
 *
 * Note what it does NOT say: it does not say "so I assumed you meant no", and
 * it does not say "so I went ahead". Nobody decided anything. The request was
 * never answered and the action never happened, and both halves are said.
 */
export const CONFIRMATION_EXPIRED_REPORT =
  'I asked you about one thing I could not undo, and the question went unanswered for a day, so I stopped. Nothing was done.'

export type Admission =
  /** The credited deadline is still ahead. Enter the loop. */
  | { readonly admit: true }
  /**
   * The credited deadline has already passed. Do NOT enter the loop: complete
   * the run and write the report. `report` is the sentence to write.
   */
  | { readonly admit: false; readonly terminalReason: string; readonly report: string }

/**
 * May this continuation run enter the worker loop?
 *
 * Asked BEFORE the loop rather than inside it, which is the whole point. A
 * check inside the loop would let the run start, propose something, and be
 * refused `budget_exhausted` — leaving the person with a run that resumed and
 * then silently did nothing, plus a refusal row explaining it in the gate's
 * vocabulary rather than theirs.
 *
 * Boundary: `>=` refuses at the instant of the deadline. A run admitted exactly
 * at its deadline would be admitted only to have `evaluateStructuralStops` fire
 * `budget-exhausted` on the same millisecond, which is the silent-resume
 * failure again, one tick narrower.
 */
export function admitContinuation(input: {
  readonly nowEpochMs: number
  /** From `deadlineFor` — acceptedAt + timeLimit + credited pauses. */
  readonly creditedDeadlineEpochMs: number
}): Admission {
  if (input.nowEpochMs >= input.creditedDeadlineEpochMs) {
    return { admit: false, terminalReason: ANSWERED_TOO_LATE, report: ANSWERED_TOO_LATE_REPORT }
  }
  return { admit: true }
}

/**
 * Has this request sat unanswered long enough to stop waiting for an answer?
 *
 * Pure, and takes both timestamps, so the startup sweep and a test share one
 * definition. The caller is responsible for only asking about requests that
 * have no verdict — an ANSWERED request never expires, however old it is, and
 * a function that could expire one would be able to un-answer a yes.
 */
export function confirmationHasExpired(input: {
  readonly requestedAtEpochMs: number
  readonly nowEpochMs: number
}): boolean {
  return input.nowEpochMs - input.requestedAtEpochMs >= CONFIRMATION_EXPIRY_HOURS * 3_600_000
}
