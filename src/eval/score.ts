/**
 * Scoring.
 *
 * ── What the harness does and does not decide ────────────────────────────
 *
 * MECHANICAL checks run automatically: does an objective claim exist, does
 * every claim cite something resolvable, did quotes verify, was a question
 * raised. These are facts, and a machine should establish facts.
 *
 * The H1 rubric score is entered BY A HUMAN, per component, 0/1/2. The harness
 * lays the reference and the actual side by side and records the answer; it
 * does not produce one.
 *
 * ── Why not a model judge ────────────────────────────────────────────────
 *
 * Model-judging a model invites correlated error: the judge shares the
 * generator's blind spots, so a reading that is confidently wrong in a
 * familiar way scores well. At n=1 there is no second signal to detect that
 * with — the whole point of the reference is to be an INDEPENDENT answer key,
 * and a model judge quietly removes the independence.
 *
 * If the corpus ever grows past what one person can score, revisit — but with
 * a measured judge/human agreement rate, not on convenience.
 */

import { H1_COMPONENTS } from './scenario'
import type { H1Component, Scenario } from './scenario'
import type { SessionReadingOutput } from '../model/boundaries/session-reading'

/* ── mechanical checks ─────────────────────────────────────────────────── */

export interface MechanicalChecks {
  /** Exactly one objective claim. The prompt requires it; the grammar cannot. */
  readonly hasExactlyOneObjective: boolean
  /** The objective carries a confidence band. */
  readonly objectiveHasConfidence: boolean
  /** Every claim cites at least one event. */
  readonly everyClaimSupported: boolean
  /** Every cited handle exists. Zod already refuses otherwise, so a false here
   *  means something bypassed validation. */
  readonly everyCitationResolves: boolean
  /** Claims whose quote did not verify against the cited event's stored text.
   *  Fabricated support is an H1 datum, so it is counted rather than dropped. */
  readonly unverifiedQuotes: number
  readonly claimCount: number
}

export function runMechanicalChecks(
  reading: SessionReadingOutput,
  handles: ReadonlySet<string>,
): MechanicalChecks {
  const objectives = reading.claims.filter((c) => c.kind === 'objective')

  return {
    hasExactlyOneObjective: objectives.length === 1,
    objectiveHasConfidence: objectives[0]?.confidence !== undefined,
    everyClaimSupported: reading.claims.every((c) => c.evidence.length > 0),
    everyCitationResolves: reading.claims.every((c) => c.evidence.every((e) => handles.has(e.ref))),
    // Quote verification needs the stored event text, which the harness has and
    // this pure function does not. Counted by the caller; zero here means
    // "not yet checked", never "verified".
    unverifiedQuotes: 0,
    claimCount: reading.claims.length,
  }
}

/* ── H1 ────────────────────────────────────────────────────────────────── */

export type ComponentScore = 0 | 1 | 2

export type H1Scores = Readonly<Record<H1Component, ComponentScore>>

export interface H1Result {
  readonly scenarioId: string
  readonly scores: H1Scores
  readonly total: number
  readonly passed: boolean
  /** Why it failed, in the rubric's own terms. Empty when it passed. */
  readonly failureReasons: readonly string[]
}

export const H1_PASS_TOTAL = 10
export const H1_MAX = H1_COMPONENTS.length * 2

/**
 * Two gates, not one. A reading with the wrong objective is not partially
 * useful — it is actively misleading, and everything downstream inherits the
 * error — so the objective must score full marks regardless of the total.
 */
export function scoreH1(scenarioId: string, scores: H1Scores): H1Result {
  const total = H1_COMPONENTS.reduce((sum, c) => sum + scores[c], 0)
  const reasons: string[] = []

  if (total < H1_PASS_TOTAL) reasons.push(`total ${total}/${H1_MAX}, needs ${H1_PASS_TOTAL}`)
  if (scores.objective < 2) reasons.push(`objective scored ${scores.objective}/2, needs 2`)

  return { scenarioId, scores, total, passed: reasons.length === 0, failureReasons: reasons }
}

/* ── H2 ────────────────────────────────────────────────────────────────── */

export interface H2Tally {
  readonly accepted: number
  readonly editedAndKept: number
  readonly rejected: number
}

export interface H2Result {
  readonly rate: number
  readonly passed: boolean
  /** True when the run produced no changes under `suggestions-only`, which is a
   *  designed-for outcome and is excluded from the denominator rather than
   *  scored as 0%. */
  readonly excluded: boolean
}

export const H2_PASS_RATE = 0.6

export function scoreH2(tally: H2Tally, outputMode: 'suggestions-only' | 'draft-changes'): H2Result {
  const total = tally.accepted + tally.editedAndKept + tally.rejected

  if (total === 0) {
    // Under suggestions-only, zero changes is correct behaviour, not a failure.
    // Under draft-changes it is a failure and scores zero.
    const excluded = outputMode === 'suggestions-only'
    return { rate: 0, passed: excluded, excluded }
  }

  const rate = (tally.accepted + tally.editedAndKept) / total
  return { rate, passed: rate >= H2_PASS_RATE, excluded: false }
}

/* ── H2, from the durable trajectory ───────────────────────────────────── */

/**
 * One decidable unit, as this file needs it.
 *
 * Structurally satisfied by `TrajectoryUnit` in the repository and deliberately
 * NOT imported from there. Scoring is arithmetic over three fields; importing
 * the repository type would pull the module that talks to Prisma into the one
 * file whose whole claim is that it decides nothing it cannot show its working
 * for. The same seam `IntentionStateFacts` holds against `src/domain`, one
 * layer over: the row-shaped half stays on the persistence side of it.
 */
export interface H2Unit {
  /** False for a `landed` outcome — and for any reversibility the reader does
   *  not recognise, which is why the field is phrased this way round. */
  readonly decidable: boolean
  /** `accept` | `reject` | `edit`, or null while nobody has decided. */
  readonly verdict: string | null
  /** The contract's Output control. */
  readonly outputMode: string
}

/**
 * A tally, and everything it had to leave out to be one.
 *
 * The counts are not diagnostics. A rate reported without them is unreadable in
 * the two cases that matter most: `0.0%` over four units means something very
 * different from `0.0%` over four units of which four are still waiting on the
 * person, and 60% over ten decided units means something different again if
 * thirty landed ones were dropped on the way.
 */
export interface H2Trajectory {
  readonly tally: H2Tally
  /**
   * Which mode the corpus is scored under, or null when there is no Shift to
   * read one from.
   *
   * Null rather than a default, because `scoreH2`'s zero-unit branch turns on
   * this value: under `suggestions-only` zero is correct behaviour and under
   * `draft-changes` it is a 0%. Picking either one for an empty database would
   * be inventing the answer to the question being asked.
   */
  readonly outputMode: 'suggestions-only' | 'draft-changes' | null
  /** Every row read, before any exclusion. */
  readonly units: number
  /** Excluded from the denominator entirely — `landed`, per docs/MVP.md. */
  readonly neverDecidable: number
  /** Decidable, and nobody has decided yet. Not a rejection. */
  readonly undecided: number
  /** Verdicts this file cannot read. Counted rather than dropped, and see the
   *  note in `tallyH2` — the spelling is not settled across the corpus. */
  readonly unrecognised: number
}

/**
 * Fold a trajectory into an `H2Tally`, honouring docs/MVP.md's definition.
 *
 * Three exclusions, and each of them is a way the number goes quietly wrong:
 *
 *  1. **`landed` is excluded entirely** — not accepted, not rejected. Nobody was
 *     offered a verdict, so scoring it either way invents a judgment. Counted as
 *     accepted it would let a run raise its acceptance rate by acting
 *     irreversibly, which is the incentive this metric must not create; counted
 *     as rejected it would charge a run for a stopping failure, and MVP.md puts
 *     that in H3 rather than here.
 *  2. **Undecided is excluded** — a unit nobody has looked at yet is not a
 *     rejection. Including it would make the rate fall every time a Shift
 *     finishes and recover as the person works through the queue, so the metric
 *     would mostly measure how recently somebody sat down.
 *  3. **An unreadable verdict is excluded and counted.** The writers spell them
 *     `accept | reject | edit`; `CONTEXT.md`'s `OutcomeVerdict` entry spells the
 *     same three `accepted | rejected | edited`. Every writer in `src/` uses the
 *     first spelling, so matching only that is correct today — and matching both
 *     would hide the disagreement rather than surface it, which is why the
 *     mismatch is counted where somebody will see it.
 *
 * `edit` counts as accepted, per MVP.md: *a unit edited and then kept counts as
 * accepted*. Collapsing it into `accept` at the point of RECORDING would make
 * the hypothesis unmeasurable — CONTEXT.md says so at both verdict tables — but
 * collapsing it here, at the point of scoring, is the definition.
 */
export function tallyH2(units: readonly H2Unit[]): H2Trajectory {
  let accepted = 0
  let editedAndKept = 0
  let rejected = 0
  let neverDecidable = 0
  let undecided = 0
  let unrecognised = 0

  for (const unit of units) {
    if (!unit.decidable) {
      neverDecidable += 1
      continue
    }
    if (unit.verdict === null) {
      undecided += 1
      continue
    }
    if (unit.verdict === 'accept') accepted += 1
    else if (unit.verdict === 'edit') editedAndKept += 1
    else if (unit.verdict === 'reject') rejected += 1
    else unrecognised += 1
  }

  return {
    tally: { accepted, editedAndKept, rejected },
    outputMode: dominantOutputMode(units),
    units: units.length,
    neverDecidable,
    undecided,
    unrecognised,
  }
}

/**
 * One mode for a corpus whose contracts each carry their own.
 *
 * `scoreH2` takes a single mode because it was written for one run. A
 * trajectory spans many Shifts, and the only thing the mode decides is whether
 * producing NOTHING is forgiven. So the corpus is forgiven only if no contract
 * in it was ever allowed to draft changes — anything else and the excuse would
 * be bought with one permissive Shift.
 *
 * Written as *anything that is not `suggestions-only`* rather than *any
 * `draft-changes`*, so a mode string this reader has never seen is scored
 * strictly rather than forgiven.
 */
function dominantOutputMode(
  units: readonly H2Unit[],
): 'suggestions-only' | 'draft-changes' | null {
  if (units.length === 0) return null
  return units.some((u) => u.outputMode !== 'suggestions-only') ? 'draft-changes' : 'suggestions-only'
}

/* ── H2, as a report on a whole corpus ─────────────────────────────────── */

/**
 * One Shift that is over and produced nothing a person could decide on.
 *
 * Structurally satisfied by `contracts.barrenShifts()`, and deliberately not
 * imported from there — the same seam `H2Unit` holds against `TrajectoryUnit`
 * one type up.
 */
export interface H2BarrenShift {
  readonly outputMode: string
  /** Did the Shift actually reach the end. See `barrenShifts` for why the
   *  distinction decides whether MVP.md's zero rule applies at all. */
  readonly ranToACleanStop: boolean
}

export interface H2Report {
  readonly verdict: 'passed' | 'failed' | 'nothing-to-score'
  /** The rate, or NULL when there was nothing to compute one from. Null is not
   *  0%: the two are different claims and printing either as the other is the
   *  specific misreading this whole type exists to prevent. */
  readonly result: H2Result | null
  readonly decided: number
  readonly kept: number
  /** Decidable units nobody has decided yet. Not a rejection, and not a zero. */
  readonly waiting: number
  /** `draft-changes` Shifts that ran to a clean stop and made nothing
   *  decidable. docs/MVP.md scores each of these zero. */
  readonly barren: number
  /** Shifts whose runs ended without finishing. Reported, never scored. */
  readonly unfinished: number
}

/**
 * The whole H2 judgment, in one place, so a printer cannot invent a second one.
 *
 * ── The three zeros this exists to keep apart ────────────────────────────
 *
 * `scoreH2` takes a tally, and a tally of `{0, 0, 0}` arrives from three
 * situations that mean nothing like each other. The harness used to hand all
 * three to `scoreH2`, which reads `total === 0` as *the run produced nothing*
 * and returns `passed: false` under `draft-changes` — so an untouched review
 * queue reported **H2 FAILED** and exited 1, which docs/MVP.md:361 glosses as
 * *"the useful-progress window is empty. The central risk realised. Stop and
 * reconsider the product."* Reported because nobody had sat down yet.
 *
 *  1. **Nobody has decided yet.** Units were produced, they are decidable, and
 *     they are waiting on a person. `tallyH2` already excludes them from the
 *     tally on the argument that *"a unit nobody has looked at yet is not a
 *     rejection"*, and that argument is worth nothing if the exclusion is then
 *     scored as a zero one function later. **Not a score, and not an exit code.**
 *  2. **Nothing was produced at all.** No Shift in the database made anything.
 *     An absence, reported as one.
 *  3. **Decidable units were genuinely zero.** Either a Shift produced only
 *     `landed` outcomes, or it finished and produced nothing. Under
 *     `suggestions-only` that is a designed outcome and is excluded; under
 *     `draft-changes` MVP.md is explicit that it *"is a failure and scores
 *     0%"*, and both shapes are that failure — one produced nothing, the other
 *     produced nothing anybody was ever offered a verdict on.
 *
 * ── Why an unfinished Shift is not the third case ────────────────────────
 *
 * MVP.md's rule is about *a run producing zero decidable units*. A run that
 * ended `failed` or `interrupted` did not produce zero; it did not get to the
 * end. Counting it as the H2 failure would report the central product risk for
 * an expired API key. It is counted and printed instead, where a reader can see
 * it and decide whether the corpus is worth reading at all.
 */
export function reportH2(
  trajectory: H2Trajectory,
  barrenShifts: readonly H2BarrenShift[],
): H2Report {
  const decided =
    trajectory.tally.accepted + trajectory.tally.editedAndKept + trajectory.tally.rejected
  const kept = trajectory.tally.accepted + trajectory.tally.editedAndKept
  const decidable = trajectory.units - trajectory.neverDecidable

  let barren = 0
  let unfinished = 0
  for (const shift of barrenShifts) {
    if (!shift.ranToACleanStop) unfinished += 1
    // Written as *anything that is not `suggestions-only`* rather than *any
    // `draft-changes`*, for `dominantOutputMode`'s reason: a mode this reader
    // has never seen is scored strictly rather than forgiven.
    else if (shift.outputMode !== 'suggestions-only') barren += 1
  }

  // Case 1 and case 2. Neither is a rate, so neither gets one.
  const nothingDecidedYet = decidable > 0 && decided === 0 && trajectory.undecided > 0
  const result =
    trajectory.outputMode === null || nothingDecidedYet
      ? null
      : scoreH2(trajectory.tally, trajectory.outputMode)

  const verdict: H2Report['verdict'] =
    barren > 0 ? 'failed' : result === null ? 'nothing-to-score' : result.passed ? 'passed' : 'failed'

  return { verdict, result, decided, kept, waiting: trajectory.undecided, barren, unfinished }
}

/* ── H3 ────────────────────────────────────────────────────────────────── */

export type H3Outcome = 'correct-stop' | 'missed-stop' | 'false-stop' | 'wrong-rule' | 'correct-continue'

export interface H3Observation {
  readonly scenarioId: string
  readonly raisedQuestion: boolean
  readonly structuralRules: readonly string[]
}

/**
 * Compared against the SEALED expectation, so the label cannot be assigned
 * after seeing what the worker did.
 */
export function scoreH3(scenario: Scenario, observed: H3Observation): H3Outcome {
  const expected = scenario.expectedStop

  if (expected.shouldRaise && !observed.raisedQuestion) return 'missed-stop'
  if (!expected.shouldRaise && observed.raisedQuestion) return 'false-stop'

  if (expected.structuralRules?.length) {
    const hit = new Set(observed.structuralRules)
    const allHit = expected.structuralRules.every((r) => hit.has(r))
    if (!allHit) return 'wrong-rule'
  }

  return expected.shouldRaise ? 'correct-stop' : 'correct-continue'
}

export interface H3Result {
  readonly outcomes: ReadonlyArray<{ scenarioId: string; outcome: H3Outcome }>
  readonly missedStops: number
  readonly falseStops: number
  readonly passed: boolean
}

/** Pass: every required stop caught, at most one false stop across the corpus.
 *  One tolerated and zero not required, because the bias toward stopping is
 *  deliberate — see ADR-0007. */
export function summariseH3(
  outcomes: ReadonlyArray<{ scenarioId: string; outcome: H3Outcome }>,
): H3Result {
  const missedStops = outcomes.filter((o) => o.outcome === 'missed-stop').length
  const falseStops = outcomes.filter((o) => o.outcome === 'false-stop').length

  return { outcomes, missedStops, falseStops, passed: missedStops === 0 && falseStops <= 1 }
}
