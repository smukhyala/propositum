/**
 * Stop conditions, as data.
 *
 * ── The contradiction this file resolves ─────────────────────────────────
 *
 * The founding brief requires both:
 *
 *   "Use deterministic application logic for stop-condition enforcement"
 *   "When confidence falls below the configured threshold... stop and surface
 *    the question"
 *
 * Model-reported confidence is uncalibrated, so the second cannot be
 * implemented deterministically and the two appear to collide.
 *
 * They do not, because **stopping requires no authority.**
 *
 * "Models propose, deterministic code authorizes" forbids a model GRANTING
 * anything. A stop grants nothing — it is the absence of an action. So the
 * asymmetry is safe and deliberate:
 *
 *   a model may NEVER widen what is permitted   (it could grant)
 *   a model may ALWAYS decline to proceed       (it can only withhold)
 *
 * A false stop is annoying. A missed stop is dangerous. Making the brake
 * cheap to pull is the correct bias, and it costs nothing that "deterministic
 * code authorizes" was protecting.
 *
 * ── Two different things, deliberately not conflated ─────────────────────
 *
 * A STRUCTURAL HALT is a limit. It happens TO the run — budget, loops, no
 * progress. The worker does not choose it and cannot suppress it.
 *
 * A DecisionNeeded is the worker DECLINING a judgment call. Per CONTEXT.md it
 * is "not a halt and not a gate refusal" — the demo's centrepiece is a run that
 * completes the draft AND identifies one strategic decision, which only works
 * if raising a question does not by itself end the run.
 *
 * The Interruption dial decides whether a raised question ALSO halts. It never
 * decides whether the question is reported — that is not the person's to switch
 * off, and a dial that could hide a question would be the dangerous one.
 *
 * ── Why there is no decision-class taxonomy ──────────────────────────────
 *
 * Declaring in advance which decisions need a human would make the semantic
 * stop structural, which is tempting. CONTEXT.md rejects it: "which partner
 * tier to propose" is not plausibly enumerable, so the mechanism would never
 * fire on real work while looking as though it had been handled.
 *
 * So H3 scores model self-report here, and the results must say so.
 */

/** Consecutive completed actions producing no artifact change before we call it
 *  a loop. Three, because two can be legitimate research before a draft. */
export const NO_PROGRESS_LIMIT = 3

/** Consecutive gate refusals before we conclude the worker is stuck proposing
 *  things it cannot do. Retrying a fourth time has never helped. */
export const REFUSAL_LOOP_LIMIT = 3

export type StopRuleId =
  | 'budget-exhausted'
  | 'no-progress'
  | 'refusal-loop'
  | 'decision-needed'

export type StopOrigin = 'structural' | 'model-raised'

export interface StopRule {
  readonly id: StopRuleId
  readonly origin: StopOrigin
  /** Maps to AgentRun.terminalReason when this rule ends a run. */
  readonly terminalReason: 'budget-exhausted' | 'stop-condition'
  /** What the shift report says under "Where I stopped". Consumer language —
   *  no rule ids, no jargon. */
  readonly consumerLabel: string
}

/**
 * The complete rule set. Data, not scattered conditionals — so it can be
 * rendered, counted, tested exhaustively, and read by someone deciding whether
 * a stop was correct.
 */
export const STOP_RULES: Readonly<Record<StopRuleId, StopRule>> = {
  'budget-exhausted': {
    id: 'budget-exhausted',
    origin: 'structural',
    terminalReason: 'budget-exhausted',
    consumerLabel: 'I ran out of the time you gave me.',
  },
  'no-progress': {
    id: 'no-progress',
    origin: 'structural',
    terminalReason: 'stop-condition',
    consumerLabel: 'I stopped because I was going in circles without changing anything.',
  },
  'refusal-loop': {
    id: 'refusal-loop',
    origin: 'structural',
    terminalReason: 'stop-condition',
    consumerLabel: 'I stopped because I kept needing things the agreement does not allow.',
  },
  'decision-needed': {
    id: 'decision-needed',
    origin: 'model-raised',
    terminalReason: 'stop-condition',
    consumerLabel: 'I stopped because this needs a decision only you can make.',
  },
} as const

/** Everything the rules need about the run so far. All facts, no judgment. */
export interface RunProgress {
  /** Passed in, never read from the clock — a 40-minute fixture replays in 400ms. */
  readonly nowEpochMs: number
  /** Derived from contract.acceptedAt + timeLimitMinutes; never stored. */
  readonly deadlineEpochMs: number
  /** Consecutive completed actions that changed no artifact. */
  readonly consecutiveNoProgress: number
  /** Consecutive gate refusals. */
  readonly consecutiveRefusals: number
}

/**
 * Structural halts only. Pure, total, deterministic — no model, no clock, no I/O.
 *
 * Returns every rule that fires, not just the first, so the shift report can
 * explain a run that hit two limits at once rather than picking one arbitrarily.
 */
export function evaluateStructuralStops(progress: RunProgress): StopRuleId[] {
  const fired: StopRuleId[] = []

  if (progress.nowEpochMs >= progress.deadlineEpochMs) fired.push('budget-exhausted')
  if (progress.consecutiveNoProgress >= NO_PROGRESS_LIMIT) fired.push('no-progress')
  if (progress.consecutiveRefusals >= REFUSAL_LOOP_LIMIT) fired.push('refusal-loop')

  return fired
}

export type RaisedQuestionEffect = 'halt' | 'record-and-continue'

/**
 * What a DecisionNeeded does, given the Interruption dial.
 *
 * The question is ALWAYS recorded and ALWAYS surfaced in the shift report. The
 * dial only decides whether the run also stops. A dial that could suppress the
 * question would let a person configure away the thing they most need to see.
 */
export function effectOfRaisedQuestion(
  interruption: 'stop-when-uncertain' | 'stop-only-when-blocked',
): RaisedQuestionEffect {
  return interruption === 'stop-when-uncertain' ? 'halt' : 'record-and-continue'
}

/**
 * When a halt takes effect.
 *
 * ALWAYS at the next action boundary, never mid-action. An ActionIntent is
 * committed before any effect, so abandoning an action in flight would leave a
 * row with no outcome — indistinguishable from a crash, and reported to the
 * person as `unknown` when we actually know exactly what happened.
 *
 * Note this is NOT the Progress dial. Progress governs how far a run goes when
 * nothing is wrong; this governs how a stop lands when something is.
 */
export const HALT_TIMING = 'next-action-boundary' as const

export interface StopDecision {
  readonly halt: boolean
  readonly rules: readonly StopRuleId[]
  /** What the shift report says. Empty when nothing fired. */
  readonly consumerLabels: readonly string[]
}

/**
 * The single place a run asks "should I stop?".
 *
 * Structural rules are evaluated first and are unaffected by the dial — a
 * person cannot configure away an exhausted budget.
 */
export function shouldStop(
  progress: RunProgress,
  interruption: 'stop-when-uncertain' | 'stop-only-when-blocked',
  questionRaised: boolean,
): StopDecision {
  const rules = evaluateStructuralStops(progress)

  if (questionRaised && effectOfRaisedQuestion(interruption) === 'halt') {
    rules.push('decision-needed')
  }

  return {
    halt: rules.length > 0,
    rules,
    consumerLabels: rules.map((id) => STOP_RULES[id].consumerLabel),
  }
}
