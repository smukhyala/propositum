/**
 * Which step somebody is on, over every combination there is.
 *
 * ── What is being defended ───────────────────────────────────────────────
 *
 * The half of a setup screen that can be wrong in a way nobody would spot.
 * Reading a fact either works or throws; ORDERING them wrongly produces a screen
 * that is confidently and quietly incorrect — telling somebody to pair an
 * extension they paired an hour ago, or that they are finished when nothing is
 * watching. A screenshot of that looks fine.
 *
 * `stepFrom` is five booleans, so thirty-two combinations is the whole domain
 * and the table below is exhaustive by construction rather than by judgment.
 * That is the reason the function was pulled out of the page at all.
 */

import { describe, it, expect } from 'vitest'

import { WELCOME_STEPS, stepFrom } from '../src/server/welcome'
import type { SetupFacts, WelcomeStep } from '../src/server/welcome'

const NOTHING: SetupFacts = {
  keySet: false,
  extensionPaired: false,
  anySourceApproved: false,
  anythingToOffer: false,
  threadPaired: false,
}

const EVERYTHING: SetupFacts = {
  keySet: true,
  extensionPaired: true,
  anySourceApproved: true,
  anythingToOffer: true,
  threadPaired: true,
}

/** The five facts, in the order the five steps read them. */
const KEYS: ReadonlyArray<keyof SetupFacts> = [
  'keySet',
  'extensionPaired',
  'anySourceApproved',
  'anythingToOffer',
  'threadPaired',
]

/** Every combination of five booleans. */
function everyCombination(): SetupFacts[] {
  const all: SetupFacts[] = []
  for (let mask = 0; mask < 32; mask += 1) {
    const facts = { ...NOTHING } as Record<keyof SetupFacts, boolean>
    KEYS.forEach((key, index) => {
      facts[key] = (mask & (1 << index)) !== 0
    })
    all.push(facts as SetupFacts)
  }
  return all
}

describe('a fresh install and a finished one', () => {
  it('starts at the key', () => {
    expect(stepFrom(NOTHING).at).toBe('key')
  })

  it('ends at nothing', () => {
    expect(stepFrom(EVERYTHING).at).toBeNull()
    expect(Object.values(stepFrom(EVERYTHING).done).every(Boolean)).toBe(true)
  })
})

describe('the order, one step at a time', () => {
  const cases: Array<[WelcomeStep, Partial<SetupFacts>]> = [
    ['key', {}],
    ['extension', { keySet: true }],
    ['sources', { keySet: true, extensionPaired: true }],
    ['watching', { keySet: true, extensionPaired: true, anySourceApproved: true }],
    [
      'phone',
      {
        keySet: true,
        extensionPaired: true,
        anySourceApproved: true,
        anythingToOffer: true,
      },
    ],
  ]

  for (const [expected, facts] of cases) {
    it(`is at ${expected} when everything before it is done`, () => {
      expect(stepFrom({ ...NOTHING, ...facts }).at).toBe(expected)
    })
  }
})

describe('over every combination there is', () => {
  /**
   * The invariant that makes this a state machine rather than a wizard: `at` is
   * always the FIRST unfinished step, never a cursor somebody moved.
   *
   * Asserted over all thirty-two rather than a chosen few, because the failure
   * this catches is a reordering that happens to be right for the paths anybody
   * thought to write down.
   */
  it('always points at the first thing that is not done', () => {
    for (const facts of everyCombination()) {
      const { at, done } = stepFrom(facts)
      const firstUndone = WELCOME_STEPS.find((step) => !done[step]) ?? null
      expect(at, JSON.stringify(facts)).toBe(firstUndone)
    }
  })

  /**
   * A later step being done never lets an earlier one be skipped.
   *
   * This is the one somebody would actually break. Pairing a phone by hand, or
   * an extension id arriving from `.env`, sets a later flag without the earlier
   * work having happened — and a screen that read "you are finished" because the
   * LAST box was ticked would be the most confidently wrong version of this
   * screen it is possible to ship.
   */
  it('is never null while anything is unfinished', () => {
    for (const facts of everyCombination()) {
      const { at, done } = stepFrom(facts)
      const anythingLeft = WELCOME_STEPS.some((step) => !done[step])
      expect(at === null, JSON.stringify(facts)).toBe(!anythingLeft)
    }
  })

  /** `done` reports every step, not only the ones behind the cursor. */
  it('reports every step regardless of where it is', () => {
    for (const facts of everyCombination()) {
      expect(Object.keys(stepFrom(facts).done).sort()).toEqual([...WELCOME_STEPS].sort())
    }
  })

  /**
   * The phone is last, and Principle 13 is why.
   *
   * The thread's first message is an offer. A greeting is a notification with no
   * decision attached, which that principle forbids outright — so the screen
   * must not invite pairing before there is something to say. Reordering these
   * two would look like a harmless improvement to the flow.
   */
  it('never asks for a phone before there is something to say', () => {
    for (const facts of everyCombination()) {
      if (stepFrom(facts).at !== 'phone') continue
      expect(facts.anythingToOffer, JSON.stringify(facts)).toBe(true)
    }
  })
})
