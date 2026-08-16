/**
 * `IntentionState`, as data.
 *
 * ── What this file is allowed to be ──────────────────────────────────────
 *
 * A **computed view**, never a stored column, following `EnforcedPolicy`,
 * `Shift` and `ActionStatus` and their shared argument: *two stores for one
 * truth is exactly how a UI comes to display something the gate cannot
 * enforce.* There is no `IntentionStatus`, there is no lifecycle column, and
 * nothing here writes anything. Every fact below is already a durable row —
 * the session's phase, the contract's `acceptedAt`, an unanswered
 * `ConfirmationRequest`, a `DecisionNeeded`, a held `ShiftOutcome`, and the
 * Intention's own `completedAt`.
 *
 * ── Five members, and the sixth is not declared ──────────────────────────
 *
 * Direction §1's lifecycle has six. `waiting` is DELIBERATELY ABSENT and this
 * is not an oversight to be tidied later. `waiting` means *progress depends on
 * an external event or dependency*, and nothing in this system can produce an
 * external event: `ObservationEvent.sessionId` is required with a single ledger
 * writer, so no event outside a sitting can be persisted at all, and
 * `ExternalEvent` is on the do-not-build list. A member nothing can reach is a
 * promise the interface would render and the data could never keep. It arrives
 * with event ingestion; `docs/ARCHITECTURE.md` records it there rather than
 * here. See ADR-0011 §2.
 *
 * ── `sleeping` is the honest common case and will read like a bug ────────
 *
 * With one sensor, no external events and one live session at a time, most
 * Intentions compute to `sleeping` most of the time. That is the true answer.
 * Making the screen more interesting than that means inferring, which is the
 * one thing an Intention exists not to do.
 *
 * ── Pure, total, and clockless ───────────────────────────────────────────
 *
 * `now` arrives as a parameter. `src/domain/**` may never read the clock — no
 * `Date.now`, no bare `new Date` — and `tests/architecture.test.ts` enforces
 * that by GREPPING SOURCE TEXT, comments included, which is why this sentence
 * names those two without writing either of them out. The reason is older than
 * the test: a state that depended on when it was computed could not be
 * replayed, and a fixture could not assert one.
 *
 * The input is a plain facts object the CALLER assembles from rows. The domain
 * layer does not know that Prisma exists, and this file names no table.
 */

import { confirmationHasExpired } from '../execution/continuation'

export type IntentionStateId = 'working' | 'delegated' | 'needs-you' | 'sleeping' | 'done'

export interface IntentionStateRule {
  readonly id: IntentionStateId
  /**
   * What the person is shown. CONTEXT.md's consumer wording, verbatim — the
   * interface renders these rather than the ids, so a state cannot arrive on
   * screen wearing its enum member.
   */
  readonly consumerLabel: string
}

/**
 * The complete set. Data, not scattered conditionals — so it can be rendered,
 * counted, tested exhaustively, and read by someone deciding whether a state
 * was right.
 *
 * The order of the keys is not the order of precedence; `intentionState` owns
 * that and argues it there.
 */
export const INTENTION_STATES: Readonly<Record<IntentionStateId, IntentionStateRule>> = {
  working: { id: 'working', consumerLabel: 'Working' },
  delegated: { id: 'delegated', consumerLabel: 'Propositum is on it' },
  'needs-you': { id: 'needs-you', consumerLabel: 'Needs you' },
  sleeping: { id: 'sleeping', consumerLabel: 'Sleeping' },
  done: { id: 'done', consumerLabel: 'Done' },
} as const

/**
 * Everything the members derive from. All facts, no judgment.
 *
 * Each field names a row that already exists. Nothing here is inferred, nothing
 * is a model's opinion, and there is no field an inference could write — an
 * Intention is not evidence, and neither is its state.
 */
export interface IntentionFacts {
  /**
   * `Intention.completedAt`, in epoch milliseconds, or null.
   *
   * Set by a person, and ONLY by a person. This is the whole of `done`.
   */
  readonly completedAtEpochMs: number | null

  /**
   * `SessionPhase` for every WorkSession pointing at this Intention that has
   * not ended.
   *
   * Typed as `readonly string[]` rather than as a `SessionPhase[]`, for the
   * reason `PAUSING_RULES` is a `ReadonlySet<string>`: the phase vocabulary is
   * owned by the schema and the repository layer, and the domain may not import
   * from `persistence`. The looseness fails safe — a phase spelled in a way
   * this file does not recognise simply matches nothing and the Intention falls
   * through to a state that claims less.
   */
  readonly sessionPhases: readonly string[]

  /**
   * Accepted HandoffContracts on this Intention whose Shift has NOT ended —
   * that is, whose runs have not all reached a terminal status.
   *
   * A count rather than the rows, because nothing here needs to tell two live
   * shifts apart. Note that one acting run at a time is load-bearing in the
   * browser channel and one live session at a time is enforced in the app
   * layer, so in practice this is 0 or 1; a screen that rendered several would
   * look right and be unable to start the second one.
   */
  readonly liveAcceptedContracts: number

  /**
   * When each unanswered `ConfirmationRequest` on this Intention was asked, in
   * epoch milliseconds.
   *
   * UNANSWERED means no `ConfirmationVerdict` row of any kind. The caller is
   * responsible for that filter, exactly as `confirmationHasExpired` requires:
   * an answered request never expires however old it is, and anything that
   * could expire one would be able to un-answer a yes.
   */
  readonly unansweredConfirmationsAskedAtEpochMs: readonly number[]

  /**
   * Open `DecisionNeeded` rows on this Intention's shift reports.
   *
   * A judgment call Propositum declined to make. It is rendered as a decision,
   * never as an error, and it is the person's to answer — so it counts toward
   * `needs-you` for as long as it is there.
   */
  readonly openDecisions: number

  /**
   * Held ShiftOutcomes on this Intention that are still undecided — the
   * repository's `UNSETTLED` predicate, counted.
   *
   * "Undecided" is per KIND and the caller owns that arithmetic, because it has
   * already been got wrong once in the expensive direction: four of the five
   * kinds are settled by an `OutcomeVerdict`, and `document-changes` is settled
   * one `ProposedChange` at a time and never receives an `OutcomeVerdict` at
   * all. A predicate that asked only for a missing `OutcomeVerdict` would count
   * every document Shift as waiting forever.
   *
   * `landed` outcomes are deliberately NOT counted. The effect is already
   * outside Propositum, there is no verdict to offer, and putting an
   * Accept/Reject pair over something that already happened is a lie about what
   * the buttons do.
   */
  readonly undecidedHeldOutcomes: number
}

/**
 * The single place anything asks "where is this Intention?".
 *
 * ── Precedence, argued rather than ordered by taste ──────────────────────
 *
 * The five are not disjoint — a person can be at their desk with a question
 * from yesterday's shift still unanswered — so the order below is the whole of
 * the behaviour, and each step is a claim about who the screen is for.
 *
 * 1. **`done` first.** `completedAt` is a human act, and a computed word must
 *    not contradict the person on their own screen. Someone who said this is
 *    finished is not told "Propositum is on it" because a run has not been
 *    tidied up.
 *
 * 2. **`needs-you` before anything active.** It is the only member that asks
 *    something OF the person, and everything below it would hide that question
 *    behind an activity word. A run paused on a confirmation is, factually,
 *    delegated — and a screen reading "Propositum is on it" while it waits for
 *    a click is precisely the failure the re-entry path exists to prevent.
 *    A false `needs-you` costs a person one look. A missed one costs them the
 *    shift.
 *
 * 3. **`delegated` before `working`.** In practice they are disjoint: a sitting
 *    handed over is `away`, not `observing`. Where they disagree, the contract
 *    is the stronger fact — it is human-ratified and timestamped, while `phase`
 *    is a mutable column the app writes, and a stale `observing` is the
 *    likelier of the two errors.
 *
 * 4. **`sleeping` last, and as the default.** Total means every input maps to a
 *    state; deny-by-default means an unrecognised combination lands on the
 *    member that CLAIMS LEAST. `sleeping` asserts nothing about where the work
 *    is and asks nothing of anybody, so being wrong about it costs a reader
 *    nothing — where a wrong `working` says a session is live that is not, and
 *    a wrong `done` says a person finished something they did not.
 */
export function intentionState(facts: IntentionFacts, nowEpochMs: number): IntentionStateId {
  if (facts.completedAtEpochMs !== null) return 'done'

  if (needsThePerson(facts, nowEpochMs)) return 'needs-you'

  if (facts.liveAcceptedContracts > 0) return 'delegated'

  // `some`, not `every`: one live sitting in `observing` is a person at the
  // desk, whatever any other sitting is doing.
  if (facts.sessionPhases.some((phase) => phase === 'observing')) return 'working'

  return 'sleeping'
}

/**
 * Is there a question only this person can answer?
 *
 * ── Why an expired confirmation does not count ───────────────────────────
 *
 * A `ConfirmationRequest` stays answerable for `CONFIRMATION_EXPIRY_HOURS`, and
 * after that the run has already been completed with `confirmation-expired`.
 * The request itself is append-only and stays exactly where it is, unanswered
 * forever — so counting every unanswered request would pin `needs-you` onto an
 * Intention permanently, for a question the system will refuse to accept an
 * answer to.
 *
 * That is the one place `now` does any work here, and it is why `now` is a
 * parameter. **Expiry never approves and nothing here decides anything** — this
 * reads the same predicate the sweep and the answer path already read, so there
 * is one definition of *answerable* rather than two that can drift.
 */
function needsThePerson(facts: IntentionFacts, nowEpochMs: number): boolean {
  if (facts.openDecisions > 0) return true
  if (facts.undecidedHeldOutcomes > 0) return true

  return facts.unansweredConfirmationsAskedAtEpochMs.some(
    (requestedAtEpochMs) => !confirmationHasExpired({ requestedAtEpochMs, nowEpochMs }),
  )
}
