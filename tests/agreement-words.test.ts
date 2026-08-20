/**
 * The agreement screen's account of where its two sentences came from.
 *
 * ── The claim this defends, in the ruling's own words ────────────────────
 *
 * `CONTEXT.md` forbids three things about a durable objective in one sentence —
 * *stale*, *inherited*, **quietly** — and names its own reason: *"because
 * nothing on screen would say it had been."* ADR-0011 answers two thirds of that
 * structurally (no model writes an Intention; no model-facing schema has a field
 * that could carry one) and says plainly that the third is *"a sentence someone
 * has to keep true in `.tsx` files, and this ADR ships no test that would notice
 * if it stopped being true."*
 *
 * This is that test. Until 2026-08-20 it could not be written, because there was
 * only one source for the pre-filled words and therefore only one branch to
 * check. ADR-0017 made the second reachable — `draftContract` pre-fills from the
 * Intention when work is being picked back up — and the branch is worthless
 * unless it says WHEN those words were written, so the date is asserted rather
 * than the branch's existence.
 *
 * ── Why it renders rather than greps ─────────────────────────────────────
 *
 * `tests/reachability.test.ts` greps for the phrase, and its own docblock is
 * explicit that a grep is satisfied by a component that computes the right thing
 * and renders something else. `tests/calendar-agreement.test.ts` established
 * that a screen in this repo CAN be rendered — `renderToStaticMarkup`, no DOM,
 * no new dependency — and the same argument applies here for the same reason:
 * the property is what a person reads, and only rendering it answers that.
 *
 * The cost is that one already stated: static markup is one render and no
 * interaction, and `useEffect` does not run. Neither matters here — this
 * paragraph is on the screen before anybody touches anything, which is the whole
 * point of it.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Agreement } from '../src/ui/agreement'
import type { ContractDrafted, PrefilledWords } from '../src/server/actions'
import type { AutonomyControls } from '../src/domain/handoff/policy'

const DEFAULTS: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

/** 14 March 2026, which is a date a reader can spot as old. */
const MARCH = Date.UTC(2026, 2, 14, 17, 30, 0)

function screen(words: PrefilledWords): string {
  const draft: ContractDrafted = {
    contractId: 'contract-1',
    objective: 'Win the Northwind renewal by shipping the tier comparison',
    definitionOfDone: 'The comparison is in the proposal and the renewal is signed',
    words,
    suggestedTimeLimitMinutes: 30,
    approvedSourceIds: ['source-1'],
    allowedActionKinds: [],
    documentTitle: null,
    quotedConstraints: [],
  }

  return renderToStaticMarkup(
    createElement(Agreement, {
      draft,
      defaults: DEFAULTS,
      sourceLabels: { 'source-1': 'Northwind partners' },
      onBack: () => undefined,
      onHandedOver: () => undefined,
    }),
  )
}

describe('words Propositum worked out this afternoon', () => {
  it('says so, and says nothing was carried over', () => {
    const html = screen({ from: 'this-session' })

    expect(html).toContain('Worked out from this session')
    expect(html).toContain('Neither was carried over from an earlier session')
  })

  it('prints no date, because the masthead already carries this sitting’s window', () => {
    // Two timestamps for one fact is worse than one, and they can disagree
    // after a reload. The distinction this arm exists to make is *this is what I
    // worked out from this afternoon*, and the sitting's own clock is above it.
    expect(screen({ from: 'this-session' })).not.toMatch(/\b(January|March|August|December)\b/)
  })
})

describe('words a person wrote before this sitting existed', () => {
  const html = () => screen({ from: 'your-intention', writtenAtEpochMs: MARCH })

  it('says they are the person’s own, not Propositum’s reading of the afternoon', () => {
    expect(html()).toContain('In your own words')
    expect(html()).toContain('picking this back up')
  })

  it('says WHEN they were written, which is the whole of the answer to “quietly”', () => {
    // The failure `CONTEXT.md`'s ruling describes is an objective inherited with
    // nothing on screen saying it had been. A month and a year is what makes a
    // sentence from March visible as one in August.
    expect(html()).toContain('March 14, 2026')
  })

  it('does not claim the sentence is still right, only that it is theirs', () => {
    const rendered = html()

    // ADR-0011: human ratification removes silence, not staleness. A screen
    // that said "still current" or "up to date" would be claiming the second.
    expect(rendered).not.toMatch(/still current|up to date|still right/i)
    // ...and it offers the correction rather than implying there is none.
    expect(rendered).toContain('If the work has moved on, change them here')
  })

  it('does not use the type name where a person can see it', () => {
    // `Intention` is a legal type and table name since ADR-0011 and is NOT the
    // consumer word. CONTEXT.md fixes that as *what you're working toward*.
    expect(html()).not.toContain('Intention')
  })
})

describe('the two accounts are actually different', () => {
  it('renders a different heading for each, rather than one paragraph for both', () => {
    /**
     * The mutation this catches: a component that takes the discriminant and
     * ignores it. Both greps in `tests/reachability.test.ts` would stay green
     * through that — a prop that is threaded and never read is exactly the
     * "call whose result is discarded" shape that file was rewritten over.
     */
    expect(screen({ from: 'this-session' })).not.toEqual(
      screen({ from: 'your-intention', writtenAtEpochMs: MARCH }),
    )
  })
})
