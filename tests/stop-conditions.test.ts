import { describe, it, expect } from 'vitest'
import {
  HALT_TIMING,
  NO_PROGRESS_LIMIT,
  REFUSAL_LOOP_LIMIT,
  STOP_RULES,
  effectOfRaisedQuestion,
  evaluateStructuralStops,
  shouldStop,
} from '../src/domain/execution/stop-conditions.js'
import type { RunProgress } from '../src/domain/execution/stop-conditions.js'

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
      'budget-exhausted',
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

describe('halt timing', () => {
  it('always lands at the next action boundary, never mid-action', () => {
    // An ActionIntent is committed before any effect, so abandoning an action
    // in flight leaves a row with no outcome — indistinguishable from a crash,
    // and reported as `unknown` when we know exactly what happened.
    expect(HALT_TIMING).toBe('next-action-boundary')
  })
})
