/**
 * Gate behaviour.
 *
 * The decision space is small and finite by design — 2 x 2 x 2 controls times
 * the ActionKind set — so it is walked exhaustively rather than sampled. A gate
 * with an untested combination is a gate with an unknown hole.
 */

import { describe, it, expect } from 'vitest'
import {
  ACTION_KINDS,
  MAX_PLAN_STEPS,
  compilePolicy,
} from '../src/domain/handoff/policy'
import type { ActionKind, AutonomyControls, ContractScope } from '../src/domain/handoff/policy'
import { authorize } from '../src/policy/gate'
import type { RunContext, ToolProposal } from '../src/policy/gate'

const scope: ContractScope = {
  approvedSourceIds: ['src-approved'],
  allowedActionKinds: ['read-approved-source', 'read-document', 'draft-section'],
  baseVersionId: 'ver-1',
}

const controls: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

const run: RunContext = {
  currentStepOrdinal: 2,
  planLength: 5,
  deadlineEpochMs: 10_000,
  nowEpochMs: 0,
}

const read: ToolProposal = {
  kind: 'read-approved-source',
  params: { approvedSourceId: 'src-approved' },
  reason: 'need the partner terms',
  stepOrdinal: 2,
}

const gate = (
  p: Partial<ToolProposal> = {},
  c: Partial<AutonomyControls> = {},
  r: Partial<RunContext> = {},
  s: Partial<ContractScope> = {},
) =>
  authorize(
    compilePolicy({ ...scope, ...s }, { ...controls, ...c }),
    { ...read, ...p },
    { ...run, ...r },
    'intent-1',
  )

describe('the happy path', () => {
  it('authorizes an in-scope, in-plan, in-budget read', () => {
    const result = gate()

    expect(result.authorized).toBe(true)
    if (result.authorized) {
      expect(result.action.kind).toBe('read-approved-source')
      expect(result.action.intentId).toBe('intent-1')
    }
  })
})

describe('deny by default', () => {
  it('refuses a source that is not approved', () => {
    const r = gate({ params: { approvedSourceId: 'src-elsewhere' } })
    expect(r).toEqual({ authorized: false, rule: 'source_not_approved' })
  })

  it('refuses an action kind the contract did not grant', () => {
    const r = gate({ kind: 'draft-section', params: { documentId: 'doc-1' } }, {}, {}, {
      allowedActionKinds: ['read-approved-source'],
    })
    expect(r).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  it('refuses a kind outside the enum, because the grammar does not enforce enums', () => {
    // Verified in #3: `enum` does not survive schema transformation, so the
    // model genuinely can return this. Deny-by-default is the whole defence.
    const r = gate({ kind: 'send-email', params: {} })
    expect(r).toEqual({ authorized: false, rule: 'unknown_action_kind' })
  })

  it('refuses when required params are absent rather than guessing', () => {
    expect(gate({ params: {} })).toEqual({ authorized: false, rule: 'source_missing' })
    expect(gate({ kind: 'draft-section', params: {} })).toEqual({
      authorized: false,
      rule: 'document_missing',
    })
  })
})

describe('Output is a real permission, not a display mode', () => {
  it('suggestions-only removes draft-section from the allowlist entirely', () => {
    const policy = compilePolicy(scope, { ...controls, output: 'suggestions-only' })

    expect(policy.actionKindAllowlist.has('draft-section')).toBe(false)
    expect(policy.actionKindAllowlist.has('read-approved-source')).toBe(true)
  })

  it('so a drafting attempt under suggestions-only is refused by the gate', () => {
    const r = gate(
      { kind: 'draft-section', params: { documentId: 'doc-1' } },
      { output: 'suggestions-only' },
    )
    expect(r).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  it('draft-changes permits it', () => {
    const r = gate({ kind: 'draft-section', params: { documentId: 'doc-1' } }, { output: 'draft-changes' })
    expect(r.authorized).toBe(true)
  })
})

describe('Initiative and Progress are orthogonal', () => {
  it('follow-closely refuses an off-plan action', () => {
    const r = gate({ stepOrdinal: undefined }, { initiative: 'follow-closely' })
    expect(r).toEqual({ authorized: false, rule: 'off_plan' })
  })

  it('use-judgment permits one', () => {
    const r = gate({ stepOrdinal: undefined }, { initiative: 'use-judgment' })
    expect(r.authorized).toBe(true)
  })

  it('current-step-only refuses a later step', () => {
    const r = gate({ stepOrdinal: 4 }, { progress: 'current-step-only' }, { currentStepOrdinal: 2 })
    expect(r).toEqual({ authorized: false, rule: 'step_out_of_scope' })
  })

  it('remaining-plan permits one', () => {
    const r = gate({ stepOrdinal: 4 }, { progress: 'remaining-plan' }, { currentStepOrdinal: 2 })
    expect(r.authorized).toBe(true)
  })

  it('breadth and depth do not substitute for one another', () => {
    // use-judgment (breadth) must not silently grant depth.
    const r = gate(
      { stepOrdinal: 4 },
      { initiative: 'use-judgment', progress: 'current-step-only' },
      { currentStepOrdinal: 2 },
    )
    expect(r).toEqual({ authorized: false, rule: 'step_out_of_scope' })
  })
})

describe('budget', () => {
  it('refuses everything once the deadline has passed, including reads', () => {
    // A time limit is a limit on WORKING, not just on writing — otherwise the
    // dial would not mean what the label says.
    for (const kind of ACTION_KINDS) {
      const params =
        kind === 'read-approved-source'
          ? { approvedSourceId: 'src-approved' }
          : { documentId: 'doc-1' }
      const r = gate({ kind, params }, {}, { nowEpochMs: 10_001 })
      expect(r).toEqual({ authorized: false, rule: 'budget_exhausted' })
    }
  })

  it('is checked before anything else, so an exhausted run reports the real reason', () => {
    const r = gate({ kind: 'nonsense', params: {} }, {}, { nowEpochMs: 10_001 })
    expect(r).toEqual({ authorized: false, rule: 'budget_exhausted' })
  })
})

describe('blast radius', () => {
  it('refuses when the plan exceeds the cap, so a run cannot rewrite the document', () => {
    // An all-red diff is a policy failure, not a rendering one. The plan bounds
    // sections touched, so capping plan length caps the radius.
    const r = gate({}, {}, { planLength: MAX_PLAN_STEPS + 1 })
    expect(r).toEqual({ authorized: false, rule: 'plan_limit_exceeded' })
  })

  it('permits a plan at exactly the cap', () => {
    expect(gate({}, {}, { planLength: MAX_PLAN_STEPS }).authorized).toBe(true)
  })
})

describe('exhaustive control matrix', () => {
  const values = {
    initiative: ['follow-closely', 'use-judgment'],
    progress: ['current-step-only', 'remaining-plan'],
    output: ['suggestions-only', 'draft-changes'],
  } as const

  it('never authorizes an unapproved source under any combination', () => {
    for (const initiative of values.initiative) {
      for (const progress of values.progress) {
        for (const output of values.output) {
          for (const kind of ACTION_KINDS) {
            const r = gate(
              { kind, params: { approvedSourceId: 'src-elsewhere', documentId: undefined } },
              { initiative, progress, output },
            )
            if (kind === 'read-approved-source') {
              expect(r).toEqual({ authorized: false, rule: 'source_not_approved' })
            } else {
              // Other kinds need a document, which is absent here.
              expect(r.authorized).toBe(false)
            }
          }
        }
      }
    }
  })

  it('never authorizes draft-section under suggestions-only, whatever the other dials say', () => {
    for (const initiative of values.initiative) {
      for (const progress of values.progress) {
        const r = gate(
          { kind: 'draft-section', params: { documentId: 'doc-1' }, stepOrdinal: undefined },
          { initiative, progress, output: 'suggestions-only' },
        )
        expect(r.authorized).toBe(false)
      }
    }
  })

  it('is deterministic — the same inputs always give the same answer', () => {
    const once = gate()
    const twice = gate()
    expect(once.authorized).toBe(twice.authorized)
  })
})

describe('compilePolicy is pure and total', () => {
  it('produces the same policy for the same inputs', () => {
    const a = compilePolicy(scope, controls)
    const b = compilePolicy(scope, controls)

    expect([...a.actionKindAllowlist]).toEqual([...b.actionKindAllowlist])
    expect([...a.sourceAllowlist]).toEqual([...b.sourceAllowlist])
  })

  it('does not alias its inputs — mutating the scope afterwards cannot widen the policy', () => {
    const mutable: ContractScope = {
      approvedSourceIds: ['src-approved'],
      allowedActionKinds: ['read-approved-source'] as ActionKind[],
      baseVersionId: 'v',
    }
    const policy = compilePolicy(mutable, controls)
    ;(mutable.allowedActionKinds as ActionKind[]).push('draft-section')

    expect(policy.actionKindAllowlist.has('draft-section')).toBe(false)
  })
})
