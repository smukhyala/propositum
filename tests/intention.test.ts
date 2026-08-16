/**
 * `intentionState()` — the five members, and the arguments behind them.
 *
 * These test the ARGUMENT rather than the implementation. Each case names the
 * claim it defends: that a human act outranks a computed word, that a question
 * is never hidden behind an activity word, that an unreachable question is not
 * a question, and that an input nobody anticipated lands on the member that
 * claims least.
 *
 * There is deliberately no case for `waiting`. It is not declared, nothing can
 * produce it, and a test asserting its absence would be a test of the type
 * system — `docs/ARCHITECTURE.md` carries that claim instead.
 */

import { describe, it, expect } from 'vitest'
import {
  INTENTION_STATES,
  intentionState,
  type IntentionFacts,
} from '../src/domain/intention/state'
import { CONFIRMATION_EXPIRY_HOURS } from '../src/domain/execution/stop-conditions'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const HOUR = 3_600_000

/** Nothing is happening and nobody has said anything. The honest common case. */
const QUIET: IntentionFacts = {
  completedAtEpochMs: null,
  sessionPhases: [],
  liveAcceptedContracts: 0,
  unansweredConfirmationsAskedAtEpochMs: [],
  openDecisions: 0,
  undecidedHeldOutcomes: 0,
}

const facts = (over: Partial<IntentionFacts>): IntentionFacts => ({ ...QUIET, ...over })

describe('the five members are reachable, and each has consumer words', () => {
  it('computes every member from facts that are already durable rows', () => {
    expect(intentionState(facts({ sessionPhases: ['observing'] }), NOW)).toBe('working')
    expect(intentionState(facts({ liveAcceptedContracts: 1 }), NOW)).toBe('delegated')
    expect(intentionState(facts({ openDecisions: 1 }), NOW)).toBe('needs-you')
    expect(intentionState(QUIET, NOW)).toBe('sleeping')
    expect(intentionState(facts({ completedAtEpochMs: NOW - HOUR }), NOW)).toBe('done')
  })

  it('renders in the person’s words, never in enum members', () => {
    expect(Object.values(INTENTION_STATES).map((state) => state.consumerLabel)).toEqual([
      'Working',
      'Propositum is on it',
      'Needs you',
      'Sleeping',
      'Done',
    ])
  })

  it('has exactly five, so a member nothing can reach is not declared', () => {
    expect(Object.keys(INTENTION_STATES)).toHaveLength(5)
    expect(Object.keys(INTENTION_STATES)).not.toContain('waiting')
  })
})

describe('a human act outranks anything computed', () => {
  it('says done even while a shift is still running, because a person said so', () => {
    // `completedAt` is written by a person and only by a person. A computed
    // word that contradicted them on their own screen would be the interface
    // arguing with the one fact here nobody inferred.
    const state = intentionState(
      facts({
        completedAtEpochMs: NOW - HOUR,
        liveAcceptedContracts: 1,
        sessionPhases: ['observing'],
        openDecisions: 2,
      }),
      NOW,
    )

    expect(state).toBe('done')
  })

  it('treats an epoch-zero completion as a completion, not as a falsy value', () => {
    // The classic bug: `if (completedAt)` is false at the epoch. The check is
    // against null, so a row completed at time zero is done.
    expect(intentionState(facts({ completedAtEpochMs: 0 }), NOW)).toBe('done')
  })
})

describe('a question is never hidden behind an activity word', () => {
  it('needs the person even while the work is delegated', () => {
    // A run paused on a confirmation IS delegated, factually. A screen reading
    // "Propositum is on it" while it waits for a click is the failure the whole
    // re-entry path exists to prevent.
    const state = intentionState(
      facts({ liveAcceptedContracts: 1, unansweredConfirmationsAskedAtEpochMs: [NOW - HOUR] }),
      NOW,
    )

    expect(state).toBe('needs-you')
  })

  it('needs the person even while they are at the desk', () => {
    expect(intentionState(facts({ sessionPhases: ['observing'], openDecisions: 1 }), NOW)).toBe(
      'needs-you',
    )
  })

  it('counts a held outcome nobody has accepted or rejected', () => {
    expect(intentionState(facts({ undecidedHeldOutcomes: 1 }), NOW)).toBe('needs-you')
  })
})

describe('an unanswerable question is not a question', () => {
  const expiryMs = CONFIRMATION_EXPIRY_HOURS * HOUR

  it('needs the person one millisecond before the request expires', () => {
    const asked = NOW - expiryMs + 1

    expect(intentionState(facts({ unansweredConfirmationsAskedAtEpochMs: [asked] }), NOW)).toBe(
      'needs-you',
    )
  })

  it('stops needing them at the instant it expires', () => {
    // The boundary matches `confirmationHasExpired`, which is `>=`, because the
    // two must not disagree: one definition of answerable, read here and by the
    // sweep that ends the run. Expiry never approves — there is simply no
    // longer an answer anyone can give, so pinning "Needs you" on the screen
    // forever would be a promise the product could not keep.
    const asked = NOW - expiryMs

    expect(intentionState(facts({ unansweredConfirmationsAskedAtEpochMs: [asked] }), NOW)).toBe(
      'sleeping',
    )
  })

  it('still needs them when one request of several is inside the window', () => {
    const state = intentionState(
      facts({ unansweredConfirmationsAskedAtEpochMs: [NOW - expiryMs * 3, NOW - HOUR] }),
      NOW,
    )

    expect(state).toBe('needs-you')
  })

  it('is a pure function of now, so the same facts replay to the same word', () => {
    const asked = NOW - expiryMs + 1
    const input = facts({ unansweredConfirmationsAskedAtEpochMs: [asked] })

    expect(intentionState(input, NOW)).toBe('needs-you')
    expect(intentionState(input, NOW)).toBe('needs-you')
    expect(intentionState(input, NOW + expiryMs)).toBe('sleeping')
  })
})

describe('delegated and working, where the two disagree', () => {
  it('believes the contract over a stale phase', () => {
    // Disjoint in practice — a sitting handed over is `away`, not `observing`.
    // Where they disagree the contract is the stronger fact: it is
    // human-ratified and timestamped, and `phase` is a mutable column.
    const state = intentionState(
      facts({ liveAcceptedContracts: 1, sessionPhases: ['observing'] }),
      NOW,
    )

    expect(state).toBe('delegated')
  })

  it('is working when one sitting of several is at the desk', () => {
    expect(intentionState(facts({ sessionPhases: ['away', 'observing'] }), NOW)).toBe('working')
  })

  it('sleeps when the only sitting is away with no accepted contract', () => {
    // The honest answer to a half-finished handoff: nothing is running, nobody
    // is being asked anything, and nobody said it was finished.
    expect(intentionState(facts({ sessionPhases: ['away'] }), NOW)).toBe('sleeping')
  })
})

describe('total, and deny-by-default', () => {
  it('falls to the state that claims least when a phase is unrecognised', () => {
    // The phase vocabulary belongs to the schema; the domain may not import it.
    // A spelling this file does not know matches nothing, and the Intention
    // lands on the member that asserts nothing about where the work is rather
    // than throwing at a caller that is only trying to render a word.
    expect(intentionState(facts({ sessionPhases: ['Observing', 'paused', '']  }), NOW)).toBe(
      'sleeping',
    )
  })

  it('answers for facts that say nothing at all', () => {
    expect(intentionState(QUIET, NOW)).toBe('sleeping')
    expect(intentionState(QUIET, 0)).toBe('sleeping')
  })

  it('never throws, whatever the counts are', () => {
    expect(() =>
      intentionState(
        facts({ liveAcceptedContracts: -1, openDecisions: -3, undecidedHeldOutcomes: -1 }),
        NOW,
      ),
    ).not.toThrow()
    // Negative counts are impossible rows, so they are read as "none" rather
    // than as a signal — a count below zero claims nothing.
    expect(
      intentionState(facts({ liveAcceptedContracts: -1, openDecisions: -3 }), NOW),
    ).toBe('sleeping')
  })
})
