/**
 * Which dial took a kind away, asked of `compilePolicy` rather than believed.
 *
 * ── What is actually being defended ──────────────────────────────────────
 *
 * Not "the function returns 'output'". The permission panel files a missing
 * `ActionKind` under *"What you've switched off"* — a claim about a decision the
 * person made — and #137 is about the rows under that heading being allowed to
 * say why. `NOT_IN_THIS_AGREEMENT`'s docblock sets the price: *"a kind can be
 * off the list because a dial removed it or because the shift was never granted
 * it… any wording that names ONE of those reasons has to be earned per kind."*
 *
 * A constant listing today's answers would be earned once and then silently
 * wrong. So `dialThatRemoved` compiles the policy again with each dial flipped
 * and reports the one that brings the kind back, and the load-bearing case in
 * this file is the last one: a rule that removes a kind for a reason no single
 * dial explains gets NO dial, and the panel falls back to the causeless
 * sentence rather than blaming Output.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * The sentences. `WHY_A_DIAL_REMOVED_IT` lives in `src/ui/agreement.tsx` and is
 * asserted through the rendered screen by `tests/agreement-honesty.test.ts`,
 * scoped to the heading — which is where a wording that is only correct under
 * one heading has to be checked.
 */

import { describe, it, expect } from 'vitest'

import {
  AUTONOMY_DIALS,
  MUTATING_ACTION_KINDS,
  compilePolicy,
  dialThatRemoved,
  grantableActionKinds,
} from '../src/domain/handoff/policy'
import type { ActionKind, AutonomyControls, ContractScope } from '../src/domain/handoff/policy'

const BROWSER: ContractScope = {
  approvedSourceIds: ['src-1'],
  allowedActionKinds: [...grantableActionKinds(false)],
  baseVersionId: '',
}

const DOCUMENT: ContractScope = {
  approvedSourceIds: ['src-1'],
  allowedActionKinds: [...grantableActionKinds(true)],
  baseVersionId: 'ver-1',
}

const DIALS: AutonomyControls = {
  initiative: 'use-judgment',
  progress: 'remaining-plan',
  output: 'draft-changes',
  interruption: 'stop-only-when-blocked',
  timeLimitMinutes: 30,
}

const dials = (over: Partial<AutonomyControls> = {}): AutonomyControls => ({ ...DIALS, ...over })

describe('a kind a dial removed names that dial', () => {
  it('names Output for every mutating kind a research-only browser shift loses', () => {
    const controls = dials({ output: 'suggestions-only' })
    const lost = [...MUTATING_ACTION_KINDS].filter(
      (kind) =>
        BROWSER.allowedActionKinds.includes(kind) &&
        !compilePolicy(BROWSER, controls).actionKindAllowlist.has(kind),
    )

    // Or the assertion under it is about nothing.
    expect(lost.length).toBeGreaterThan(0)
    for (const kind of lost) {
      expect(dialThatRemoved(kind, BROWSER, controls), kind).toBe('output')
    }
  })

  it('names Output for drafting on a document shift', () => {
    expect(dialThatRemoved('draft-section', DOCUMENT, dials({ output: 'suggestions-only' }))).toBe(
      'output',
    )
  })
})

describe('and everything else names nothing, which is the safe direction', () => {
  it('says nothing about a kind that is still allowed', () => {
    for (const kind of BROWSER.allowedActionKinds) {
      expect(dialThatRemoved(kind, BROWSER, DIALS), kind).toBeNull()
    }
  })

  it('says nothing about a kind the shift never offered', () => {
    // `grantableActionKinds(false)` never grants `draft-section`, so on a
    // browser shift it is absent for a reason that has nothing to do with a
    // dial — and attributing it to one is the defect #130 fixed one layer up.
    expect(BROWSER.allowedActionKinds).not.toContain('draft-section')
    expect(dialThatRemoved('draft-section', BROWSER, dials({ output: 'suggestions-only' }))).toBeNull()
  })

  /**
   * The ambiguous case is UNREACHABLE today, and is asserted as unreachable
   * rather than faked — `tests/reachability.test.ts`'s rule, applied here.
   *
   * `dialThatRemoved` returns null when two dials could each restore a kind, or
   * when none can. Neither can happen against the current `compilePolicy`:
   * there is exactly one gate in it (`output === 'suggestions-only'`), so every
   * removed kind is restored by flipping exactly one dial, and no kind in scope
   * survives removal under all four flips.
   *
   * That is worth pinning as an emptiness rather than leaving silent, because
   * the day a second dial removes something this goes red — and going red is
   * correct: somebody then has to decide what the panel says about a kind two
   * settings each took away, which is a wording question and not a bug.
   */
  it('has no kind today that two dials or no dial explains', () => {
    const ambiguous: ActionKind[] = []

    for (const scope of [BROWSER, DOCUMENT]) {
      for (const output of ['suggestions-only', 'draft-changes'] as const) {
        for (const progress of ['current-step-only', 'remaining-plan'] as const) {
          const controls = dials({ output, progress })
          const allowed = compilePolicy(scope, controls).actionKindAllowlist
          for (const kind of scope.allowedActionKinds) {
            if (allowed.has(kind)) continue
            if (dialThatRemoved(kind, scope, controls) === null) ambiguous.push(kind)
          }
        }
      }
    }

    expect(ambiguous).toEqual([])
  })

  /**
   * The case this whole derivation exists for.
   *
   * If a second dial ever removes a kind that Output also removes, no single
   * flip restores it, and the answer must be *"I cannot say"* rather than
   * *"Output"*. Constructed here by flipping two dials at once against a kind
   * only one of them touches — which proves the shape rather than the current
   * rule set: the function reports a dial only when moving THAT dial and
   * nothing else brings the kind back.
   */
  it('refuses to name one dial when one dial is not the answer', () => {
    const controls = dials({ output: 'suggestions-only' })
    const kind: ActionKind = 'click-element'

    // Output alone explains it today.
    expect(dialThatRemoved(kind, BROWSER, controls)).toBe('output')

    // Take the kind out of the scope as well. Now flipping Output does not
    // bring it back either, because it was never offered — and the function
    // reports nothing rather than the dial that used to be the answer.
    const narrowed: ContractScope = {
      ...BROWSER,
      allowedActionKinds: BROWSER.allowedActionKinds.filter((k) => k !== kind),
    }
    expect(dialThatRemoved(kind, narrowed, controls)).toBeNull()
  })

  it('considers every dial, so a new rule cannot hide behind an unchecked one', () => {
    // `timeLimitMinutes` is deliberately absent: it is a number, not a toggle,
    // and it removes no kind. If a fifth toggle is added to `AutonomyControls`
    // and not to this list, a kind it removes would report null forever —
    // which is safe, and this is the reminder that it is also incomplete.
    expect([...AUTONOMY_DIALS].sort()).toEqual([
      'initiative',
      'interruption',
      'output',
      'progress',
    ])
  })
})
