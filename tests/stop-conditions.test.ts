import { describe, it, expect } from 'vitest'
import {
  CONFIRMATION_EXPIRY_HOURS,
  HALT_TIMING,
  MAX_PAUSE_CREDIT_MINUTES,
  NO_PROGRESS_LIMIT,
  PAUSING_RULES,
  REFUSAL_LOOP_LIMIT,
  STOP_RULES,
  deadlineFor,
  effectOfRaisedQuestion,
  evaluateStructuralStops,
  shouldStop,
} from '../src/domain/execution/stop-conditions'
import type { RunProgress } from '../src/domain/execution/stop-conditions'

const fine: RunProgress = {
  nowEpochMs: 0,
  deadlineEpochMs: 10_000,
  consecutiveNoProgress: 0,
  consecutiveRefusals: 0,
}

const p = (over: Partial<RunProgress> = {}): RunProgress => ({ ...fine, ...over })

describe('structural halts are deterministic and unconfigurable', () => {
  it('does not fire on a healthy run', () => {
    expect(evaluateStructuralStops(fine)).toEqual([])
  })

  it('fires on an exhausted budget', () => {
    expect(evaluateStructuralStops(p({ nowEpochMs: 10_000 }))).toContain('budget-exhausted')
  })

  it('fires when the run is going in circles', () => {
    expect(evaluateStructuralStops(p({ consecutiveNoProgress: NO_PROGRESS_LIMIT }))).toContain(
      'no-progress',
    )
    expect(evaluateStructuralStops(p({ consecutiveNoProgress: NO_PROGRESS_LIMIT - 1 }))).toEqual([])
  })

  it('fires when the worker keeps proposing things it cannot do', () => {
    expect(evaluateStructuralStops(p({ consecutiveRefusals: REFUSAL_LOOP_LIMIT }))).toContain(
      'refusal-loop',
    )
  })

  it('reports every rule that fired, not just the first', () => {
    // A run that hit two limits should say so rather than pick one arbitrarily.
    const fired = evaluateStructuralStops(
      p({ nowEpochMs: 10_000, consecutiveNoProgress: NO_PROGRESS_LIMIT }),
    )
    expect(fired).toContain('budget-exhausted')
    expect(fired).toContain('no-progress')
  })

  it('cannot be switched off by either interruption setting', () => {
    for (const dial of ['stop-when-uncertain', 'stop-only-when-blocked'] as const) {
      const decision = shouldStop(p({ nowEpochMs: 10_000 }), dial, false)
      expect(decision.halt).toBe(true)
      expect(decision.rules).toContain('budget-exhausted')
    }
  })
})

describe('a raised question is always recorded, and sometimes halts', () => {
  it('halts under stop-when-uncertain', () => {
    expect(effectOfRaisedQuestion('stop-when-uncertain')).toBe('halt')
    expect(shouldStop(fine, 'stop-when-uncertain', true).halt).toBe(true)
  })

  it('continues under stop-only-when-blocked', () => {
    expect(effectOfRaisedQuestion('stop-only-when-blocked')).toBe('record-and-continue')
    expect(shouldStop(fine, 'stop-only-when-blocked', false).halt).toBe(false)
  })

  it('lets the demo scenario work: draft completed AND a decision raised', () => {
    // CONTEXT.md: DecisionNeeded is "not a halt and not a gate refusal". The
    // headline scenario only holds if raising a question can leave the run
    // running.
    const decision = shouldStop(fine, 'stop-only-when-blocked', true)

    expect(decision.halt).toBe(false)
    expect(decision.rules).not.toContain('decision-needed')
  })

  it('makes the dial a real control, not a presentation choice', () => {
    const halts = shouldStop(fine, 'stop-when-uncertain', true)
    const continues = shouldStop(fine, 'stop-only-when-blocked', true)

    expect(halts.halt).not.toBe(continues.halt)
  })
})

describe('the shape of the rule set', () => {
  it('separates structural rules from the model-raised one', () => {
    const structural = Object.values(STOP_RULES).filter((r) => r.origin === 'structural')
    const raised = Object.values(STOP_RULES).filter((r) => r.origin === 'model-raised')

    expect(structural.map((r) => r.id).sort()).toEqual([
      'action-limit',
      'budget-exhausted',
      'control-lost',
      'no-progress',
      'refusal-loop',
    ])
    expect(raised.map((r) => r.id)).toEqual(['decision-needed'])
  })

  it('gives every rule consumer language with no jargon or rule ids', () => {
    for (const rule of Object.values(STOP_RULES)) {
      expect(rule.consumerLabel).toMatch(/^I /)
      expect(rule.consumerLabel).not.toContain(rule.id)
      for (const banned of ['stop condition', 'policy', 'gate', 'trigger', 'threshold']) {
        expect(rule.consumerLabel.toLowerCase()).not.toContain(banned)
      }
    }
  })

  it('maps every rule to a terminalReason the schema accepts', () => {
    for (const rule of Object.values(STOP_RULES)) {
      expect(['budget-exhausted', 'stop-condition']).toContain(rule.terminalReason)
    }
  })

  it('surfaces the labels on a decision, so the report needs no lookup table', () => {
    const decision = shouldStop(p({ nowEpochMs: 10_000 }), 'stop-when-uncertain', false)

    expect(decision.consumerLabels).toEqual(['I ran out of the time you gave me.'])
  })
})

describe('the browser-era structural rules', () => {
  it('does not fire either of them on a run that supplies neither fact', () => {
    // The unwired caller. Absent facts must leave behaviour exactly as it was,
    // not invent a halt out of a missing field.
    expect(evaluateStructuralStops(fine)).toEqual([])
  })

  it('fires when the tab is gone', () => {
    expect(evaluateStructuralStops(p({ controlLost: true }))).toContain('control-lost')
    expect(evaluateStructuralStops(p({ controlLost: false }))).toEqual([])
  })

  it('fires when the run has done as much as it may', () => {
    expect(evaluateStructuralStops(p({ actionsTaken: 40, maxActions: 40 }))).toContain(
      'action-limit',
    )
    expect(evaluateStructuralStops(p({ actionsTaken: 41, maxActions: 40 }))).toContain(
      'action-limit',
    )
    expect(evaluateStructuralStops(p({ actionsTaken: 39, maxActions: 40 }))).toEqual([])
  })

  it('needs both terms, because a count with no cap is not a limit', () => {
    expect(evaluateStructuralStops(p({ actionsTaken: 9_000 }))).toEqual([])
    expect(evaluateStructuralStops(p({ maxActions: 1 }))).toEqual([])
  })

  it('keeps running out of actions distinct from running out of time', () => {
    // Different things to be told, leading to different next moves.
    expect(STOP_RULES['action-limit'].consumerLabel).not.toEqual(
      STOP_RULES['budget-exhausted'].consumerLabel,
    )
    expect(STOP_RULES['action-limit'].terminalReason).toBe('stop-condition')
  })

  it('cannot be switched off by either interruption setting', () => {
    for (const dial of ['stop-when-uncertain', 'stop-only-when-blocked'] as const) {
      expect(shouldStop(p({ controlLost: true }), dial, false).halt).toBe(true)
      expect(shouldStop(p({ actionsTaken: 1, maxActions: 1 }), dial, false).halt).toBe(true)
    }
  })
})

describe('a pause is not a loop', () => {
  it('names confirmation_required as a pausing rule, so it is not counted as a refusal', () => {
    // Counting it would make a run that correctly asked three times look like
    // one going in circles — and halt it just as the person was about to answer.
    expect(PAUSING_RULES.has('confirmation_required')).toBe(true)
  })

  it('does not sweep ordinary refusals into the pausing set', () => {
    for (const rule of [
      'action_kind_not_allowed',
      'source_not_approved',
      'off_plan',
      'stale_snapshot',
      'password_field',
      'budget_exhausted',
    ]) {
      expect(PAUSING_RULES.has(rule)).toBe(false)
    }
  })

  it('still halts a genuine refusal loop, so the filter cannot hide one', () => {
    expect(evaluateStructuralStops(p({ consecutiveRefusals: REFUSAL_LOOP_LIMIT }))).toContain(
      'refusal-loop',
    )
  })
})

describe('a confirmation pause does not eat the shift', () => {
  const acceptedAtEpochMs = 1_000_000
  const timeLimitMinutes = 30

  it('ends at accepted + limit when nobody was ever asked', () => {
    expect(deadlineFor({ acceptedAtEpochMs, timeLimitMinutes, pauses: [] })).toBe(
      acceptedAtEpochMs + 30 * 60_000,
    )
  })

  it('credits back the time the person took to answer', () => {
    // Asked at +5 min, answered at +65 min. An hour of that was waiting, and
    // waiting is not working.
    const deadline = deadlineFor({
      acceptedAtEpochMs,
      timeLimitMinutes,
      pauses: [
        {
          requestedAtEpochMs: acceptedAtEpochMs + 5 * 60_000,
          decidedAtEpochMs: acceptedAtEpochMs + 65 * 60_000,
        },
      ],
    })

    expect(deadline).toBe(acceptedAtEpochMs + (30 + 60) * 60_000)
  })

  it('sums several pauses', () => {
    const deadline = deadlineFor({
      acceptedAtEpochMs,
      timeLimitMinutes,
      pauses: [
        { requestedAtEpochMs: 0, decidedAtEpochMs: 10 * 60_000 },
        { requestedAtEpochMs: 0, decidedAtEpochMs: 5 * 60_000 },
      ],
    })

    expect(deadline).toBe(acceptedAtEpochMs + (30 + 15) * 60_000)
  })

  it('caps the credit, so a weekend pause does not hand back a weekend', () => {
    const deadline = deadlineFor({
      acceptedAtEpochMs,
      timeLimitMinutes,
      pauses: [{ requestedAtEpochMs: 0, decidedAtEpochMs: 72 * 60 * 60_000 }],
    })

    expect(deadline).toBe(acceptedAtEpochMs + (30 + MAX_PAUSE_CREDIT_MINUTES) * 60_000)
  })

  it('never shortens a shift, however wrong the timestamps are', () => {
    // Clock skew or a bad row. An input error that silently took time away from
    // someone would be very hard to see, so it is clamped rather than trusted.
    const deadline = deadlineFor({
      acceptedAtEpochMs,
      timeLimitMinutes,
      pauses: [{ requestedAtEpochMs: 60 * 60_000, decidedAtEpochMs: 0 }],
    })

    expect(deadline).toBe(acceptedAtEpochMs + 30 * 60_000)
  })

  it('is stable across restarts, which is what the no-stored-deadline rule protected', () => {
    // Every term is an immutable timestamp on a durable row. Recomputing it a
    // thousand times gives the same number — unlike a deadline derived from
    // "now at startup", which would hand a crash loop a fresh budget each time.
    const input = {
      acceptedAtEpochMs,
      timeLimitMinutes,
      pauses: [{ requestedAtEpochMs: 100, decidedAtEpochMs: 100_000 }],
    }

    const answers = new Set<number>()
    for (let restart = 0; restart < 1000; restart += 1) answers.add(deadlineFor(input))

    expect(answers.size).toBe(1)
  })

  it('gives an unanswered pause nothing, because crediting one would need a clock', () => {
    // An open pause is simply not in the list. The run is not spending budget
    // while it waits, so it loses nothing by earning nothing.
    expect(deadlineFor({ acceptedAtEpochMs, timeLimitMinutes, pauses: [] })).toBe(
      deadlineFor({
        acceptedAtEpochMs,
        timeLimitMinutes,
        pauses: [{ requestedAtEpochMs: 5, decidedAtEpochMs: 5 }],
      }),
    )
  })
})

describe('expiry never approves', () => {
  it('is a bounded window rather than an open one', () => {
    expect(CONFIRMATION_EXPIRY_HOURS).toBe(24)
  })

  it('has no path that turns a timeout into a yes', () => {
    // The property is structural rather than behavioural, so it is asserted
    // where it lives: an expired confirmation is simply absent from the run's
    // confirmed set, and the gate refuses an absent one with
    // `confirmation_required` — identical to never having asked. There is no
    // "expired" state anywhere that authorization could read as consent.
    // tests/policy-gate.test.ts proves the gate side of that.
    expect(PAUSING_RULES.has('confirmation_required')).toBe(true)
  })
})

describe('halt timing', () => {
  it('always lands at the next action boundary, never mid-action', () => {
    // An ActionIntent is committed before any effect, so abandoning an action
    // in flight leaves a row with no outcome — indistinguishable from a crash,
    // and reported as `unknown` when we know exactly what happened.
    expect(HALT_TIMING).toBe('next-action-boundary')
  })
})

/**
 * `no-progress` was written for a drafting run, and a research run has no draft.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * Under `suggestions-only` on a document shift, `compilePolicy` removes
 * `draft-section` and what survives is reads — and every read reports
 * `changedSomething: false`, because it is one. The counter only ever resets on
 * that field, so nothing the run is PERMITTED to do could reset it, and the
 * halt landed on the third action every time. Not on a fixture and not on a
 * model's choice: on the arithmetic.
 *
 * The constant's own comment says what it was written for and it is not this —
 * *"three, because two can be legitimate research before a draft"*. Under
 * `suggestions-only` there is no draft for the research to be a prelude to.
 *
 * ── Why this is a false stop, and why that is allowed to matter ──────────
 *
 * ADR-0007's asymmetry is that a false stop is annoying and a missed stop is
 * dangerous, so the brake is cheap to pull. That is about SAFETY, and a run
 * that cannot write cannot do the dangerous thing: `suggestions-only` is still
 * bounded by `MAX_ACTIONS_PER_RUN` and the time budget, both of which the
 * person set on the dials. What was being prevented was research.
 *
 * ── The one thing here that will be misread ──────────────────────────────
 *
 * `progressIsPossible` is absent-means-FIRE, the opposite of `controlLost` and
 * `actionsTaken` above, which are absent-means-cannot-fire. Deliberate, and
 * asserted below: an unwired caller keeps the behaviour it had rather than
 * silently losing a stop. Getting this backwards turns a missing field into a
 * run with no loop detection at all, which is the dangerous direction.
 */
describe('a run that cannot change anything cannot be going in circles', () => {
  it('does not fire when nothing the run may do could ever reset the counter', () => {
    expect(
      evaluateStructuralStops(
        p({ consecutiveNoProgress: NO_PROGRESS_LIMIT, progressIsPossible: false }),
      ),
    ).not.toContain('no-progress')
  })

  it('stays off however long such a run goes on, because the count is not the point', () => {
    expect(
      evaluateStructuralStops(
        p({ consecutiveNoProgress: NO_PROGRESS_LIMIT * 20, progressIsPossible: false }),
      ),
    ).toEqual([])
  })

  it('still fires when the run had a way to make progress and did not', () => {
    expect(
      evaluateStructuralStops(
        p({ consecutiveNoProgress: NO_PROGRESS_LIMIT, progressIsPossible: true }),
      ),
    ).toContain('no-progress')
  })

  it('fires when the fact is absent, so an unwired caller does not lose the stop', () => {
    // The opposite default from `controlLost` and `actionsTaken`, on purpose.
    expect(evaluateStructuralStops(p({ consecutiveNoProgress: NO_PROGRESS_LIMIT }))).toContain(
      'no-progress',
    )
  })

  it('does not switch off the limits that still bound such a run', () => {
    // The whole argument for removing this rule here is that two others remain.
    const fired = evaluateStructuralStops(
      p({
        consecutiveNoProgress: NO_PROGRESS_LIMIT * 5,
        progressIsPossible: false,
        nowEpochMs: 10_000,
        actionsTaken: 40,
        maxActions: 40,
      }),
    )
    expect(fired).toContain('budget-exhausted')
    expect(fired).toContain('action-limit')
  })

  it('leaves the refusal loop alone, which is about a different failure', () => {
    // A run proposing things the agreement forbids is stuck whether or not it
    // could have written anything, so this rule keeps firing.
    expect(
      evaluateStructuralStops(
        p({ consecutiveRefusals: REFUSAL_LOOP_LIMIT, progressIsPossible: false }),
      ),
    ).toContain('refusal-loop')
  })
})
