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

/**
 * Consecutive completed actions producing no artifact change before we call it
 * a loop. Three, because two can be legitimate research before a draft.
 *
 * **"Before a draft" is load-bearing, and was not read that way until
 * 2026-09-01.** Where the run has no draft to be working towards — because the
 * compiled policy permits nothing that could report progress — a completed
 * action that changed nothing is not evidence of a circle, and the worker stops
 * counting that one thing towards this limit.
 *
 * The number is not lowered and this rule is not conditional: the exemption is
 * in the counter rather than here, and it is deliberately narrow. See
 * `progressIsPossible` in `src/runtime/worker-loop.ts` for the argument and for
 * the three increments it leaves alone.
 *
 * ── ~~"two can be legitimate research before a draft"~~ ──────────────────
 *
 * **That assumption failed twice, on paid runs, and is amended 2026-09-02
 * ([ADR-0031](../../../docs/adr/0031-a-first-look-is-progress.md)).**
 * `monitor-shortlist` was given a six-step plan whose first drafting step is
 * step 5 — four reads before it — and halted here on step 3 with nothing
 * drafted. It had not decided against drafting; it never arrived.
 *
 * The number is still 3 and still not conditional. What changed is again in the
 * counter: a read of something this run has not read resets it, and only a
 * SECOND look at the same thing counts. That is the line `changedSomething`'s
 * own docblock always drew — *"opening a page gets somewhere, where re-reading
 * the same document three times does not"* — and had no code behind it.
 */
export const NO_PROGRESS_LIMIT = 3

/** Consecutive gate refusals before we conclude the worker is stuck proposing
 *  things it cannot do. Retrying a fourth time has never helped. */
export const REFUSAL_LOOP_LIMIT = 3

/**
 * Refusals that mean "ask the person", not "the worker is stuck".
 *
 * A pause is not a loop. `confirmation_required` is the gate working exactly as
 * designed — the worker proposed something irreversible, we stopped to ask —
 * and counting it toward `refusal-loop` would make a run that correctly asked
 * for permission three times look like one going in circles. It would then halt
 * the run at the precise moment the person was about to answer, and report the
 * halt as *"I kept needing things the agreement does not allow"*, which is both
 * wrong and discouraging about a behaviour we want.
 *
 * Typed as `ReadonlySet<string>` rather than `ReadonlySet<RefusalRule>` because
 * the domain layer may not import from `policy` — the rule ids are the gate's
 * vocabulary, and this is the one place the domain needs to name one. The
 * looseness is deliberate; a wrong string here fails safe by counting a pause
 * as a refusal, which is the pre-existing behaviour.
 */
export const PAUSING_RULES: ReadonlySet<string> = new Set(['confirmation_required'])

/**
 * How long a confirmation stays answerable.
 *
 * **Expiry never approves.** An expired confirmation is simply absent from
 * `RunContext.confirmedRequestIds`, so the gate refuses again with
 * `confirmation_required` — identical to never having asked. A timeout that
 * decayed into "yes" would be the exact failure this whole mechanism exists to
 * prevent: an irreversible act happening because nobody was watching, dressed
 * up as consent.
 *
 * ── It is longer than the budget can honour, and that is worth knowing ───
 *
 * A review caught the interaction. Twenty-four hours is how long a confirmation
 * stays ANSWERABLE; `MAX_PAUSE_CREDIT_MINUTES` is only four hours of budget
 * credited back. So a question asked at 09:05 on a thirty-minute shift and
 * answered at 18:00 is accepted as a valid yes, and every proposal after it is
 * refused `budget_exhausted` — the "asking permission destroyed the run"
 * failure that `deadlineFor` exists to prevent, moved from thirty minutes out
 * to four and a half hours out rather than removed.
 *
 * The two constants are deliberately not reconciled by shortening the expiry,
 * because a confirmation that expires while someone is still willing to answer
 * pushes them toward answering fast rather than reading. ~~The right resolution
 * lives in the interface: a person answering a question whose shift has already
 * ended should be TOLD that, and offered a fresh shift, rather than having
 * their yes accepted into a dead run. Whoever builds the confirmation screen
 * owns that; recording it here so it is a decision rather than a surprise.~~
 *
 * **Both halves built, and the second one took a year of the repository's
 * patience to spend.** *Told that* landed 2026-09-01 (#132): `confirmRequest`
 * refuses a question whose run ended some other way, and `SettledConfirmation`
 * renders the closed state rather than offering a button the answer path turns
 * down. *Offered a fresh shift* landed 2026-09-02
 * ([#139](https://github.com/smukhyala/propositum/issues/139)): that screen
 * carries **Hand over again** on all four of its closed states, to the ordinary
 * agreement screen where a person ratifies a new contract in full. Nothing is
 * pre-approved by it, which is why it is the one control a dead end may hold.
 *
 * The interaction this paragraph describes is unchanged and still real — the
 * resolution was always about what the person is offered next, never about
 * making the two constants agree.
 */
export const CONFIRMATION_EXPIRY_HOURS = 24

/**
 * The most waiting time a shift will credit back, however long the pauses ran.
 *
 * Uncapped credit would make the time limit meaningless: a run paused over a
 * weekend would wake with three days of budget and no longer resemble anything
 * the person agreed to. Four hours restores an afternoon's interruption while
 * keeping *"I gave it thirty minutes"* recognisably true.
 */
export const MAX_PAUSE_CREDIT_MINUTES = 240

export type StopRuleId =
  | 'budget-exhausted'
  | 'no-progress'
  | 'refusal-loop'
  | 'decision-needed'
  | 'control-lost'
  | 'action-limit'

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
  /**
   * The tab went away — closed, navigated by the person, or the debugger
   * attachment dropped. Structural, and deterministic: it is an observed fact
   * about the browser, not an inference about the work.
   *
   * It has to be its own rule rather than a failure, because "the page I was
   * working in is gone" is the one halt where the person can see for themselves
   * exactly what happened, and telling them that is far better than a generic
   * error. It also means any half-finished interaction is theirs now.
   */
  'control-lost': {
    id: 'control-lost',
    origin: 'structural',
    terminalReason: 'stop-condition',
    consumerLabel: 'I lost the tab I was working in.',
  },
  /**
   * The run reached `EnforcedPolicy.maxActions`.
   *
   * Distinct from `budget-exhausted` on purpose: running out of TIME and running
   * out of PERMITTED ACTIONS are different things to be told, and lead to
   * different next moves — one says "give me longer", the other says "this is
   * taking more steps than expected, look at what it is doing".
   */
  'action-limit': {
    id: 'action-limit',
    origin: 'structural',
    terminalReason: 'stop-condition',
    consumerLabel: "I did as much as I'm allowed to do in one go.",
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
  /** Consecutive gate refusals. **Refusals in `PAUSING_RULES` must not be
   *  counted here** — the caller filters, because only the caller sees rules. */
  readonly consecutiveRefusals: number

  /**
   * The browser-era facts, optional for the same reason `RunContext`'s are: the
   * run path that builds this is owned by the unit wiring the executor, and
   * making them required would break that file before it can supply them.
   *
   * Both absences mean the corresponding rule cannot fire, which leaves an
   * unwired caller with exactly the behaviour it had before these rules existed
   * rather than a spurious halt.
   */
  readonly controlLost?: boolean | undefined
  /** Authorized actions so far, counted off ActionIntent rows. */
  readonly actionsTaken?: number | undefined
  /** `EnforcedPolicy.maxActions`. Passed rather than imported so this file
   *  stays a rule set over facts and never reaches for a policy. */
  readonly maxActions?: number | undefined
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
  if (progress.controlLost === true) fired.push('control-lost')

  // Both terms or neither. A cap with no count, or a count with no cap, is not
  // a limit — and guessing a default for either would invent a limit nobody set.
  if (
    progress.actionsTaken !== undefined &&
    progress.maxActions !== undefined &&
    progress.actionsTaken >= progress.maxActions
  ) {
    fired.push('action-limit')
  }

  return fired
}

/**
 * When this shift actually ends, with confirmation pauses credited back.
 *
 * ── The problem ─────────────────────────────────────────────────────────
 *
 * A confirmation pause would otherwise eat the shift. Someone asked at 09:05
 * whether to press *Place order*, who answers at 12:00, returns to a run whose
 * thirty minutes expired at 09:30 — so every remaining proposal is refused with
 * `budget_exhausted` and the work they just approved never happens. The person
 * did nothing wrong, the system did nothing wrong, and the outcome is that
 * asking permission destroyed the run. That makes the safest behaviour the most
 * expensive one, which is how safeguards get switched off.
 *
 * ── Why this is not the stored deadline that was forbidden ───────────────
 *
 * `EnforcedPolicy` deliberately has no `deadlineAt` field, because recomputing
 * a deadline on restart would reset the budget on every crash loop — a run that
 * dies and resumes ten times would get eleven full budgets.
 *
 * **This does not, and the reason is structural rather than careful.** Every
 * term is an immutable timestamp on a durable row: `acceptedAt` on the
 * contract, and a `(requestedAt, decidedAt)` pair per answered confirmation.
 * None of them is "now", none is written by this function, and none changes
 * when a process restarts. So it recomputes to the SAME NUMBER after any number
 * of restarts, which is exactly the property the original rule was protecting.
 * It looks like the forbidden thing; it is its opposite.
 *
 * Pure and total. An open pause — requested but not yet decided — is simply not
 * in the list, and therefore earns nothing: crediting one would need the clock,
 * and the run is not spending budget while it waits anyway.
 */
export function deadlineFor(input: {
  readonly acceptedAtEpochMs: number
  readonly timeLimitMinutes: number
  readonly pauses: ReadonlyArray<{ requestedAtEpochMs: number; decidedAtEpochMs: number }>
}): number {
  let waitedMs = 0
  for (const pause of input.pauses) {
    const elapsed = pause.decidedAtEpochMs - pause.requestedAtEpochMs
    // Clamped at zero. A decision timestamped before its request is clock skew
    // or a bad row, and neither should ever SHORTEN a shift — an input error
    // that silently took time away from someone would be very hard to see.
    if (elapsed > 0) waitedMs += elapsed
  }

  const creditMs = Math.min(waitedMs, MAX_PAUSE_CREDIT_MINUTES * 60_000)

  return input.acceptedAtEpochMs + input.timeLimitMinutes * 60_000 + creditMs
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
