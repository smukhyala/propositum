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
