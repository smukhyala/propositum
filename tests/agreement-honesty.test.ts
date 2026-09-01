/**
 * The permission screen has to stop saying three things that stopped being true.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `src/ui/agreement.tsx` carried a block headed *"This list becomes FALSE the
 * moment a contract grants `click-element`"*, naming three sentences that would
 * go false together and noting that the claim survived only because no handoff
 * path granted a browser verb. A shift with no document now grants all six, so
 * all three went false at once — and not one of them was covered by a test.
 * The comment was the only thing that knew, and a comment does not fail.
 *
 * So this file renders the screen under both grants and reads what a person
 * would read. It is the same `renderToStaticMarkup` harness
 * `tests/calendar-agreement.test.ts` argues for, and it inherits the same
 * stated cost: one render and no interaction. That is enough here, because
 * every sentence under test is decided by `compilePolicy` at render time.
 *
 * ── Why the assertions are on WORDS ──────────────────────────────────────
 *
 * A permission screen is a promise in prose. There is no structural check that
 * can tell "Propositum has no way to do them" from "Propositum has no way to do
 * them itself", and the difference between those two is the whole of what
 * ADR-0010 spent. So the words are pinned, and a rewrite that changes what is
 * promised has to come through here.
 *
 * ── The fourth sentence, found later and worse than the other three ──────
 *
 * Three sentences were corrected when the browser shift landed. A fourth was
 * not: the panel explained a missing `draft-section` with *"You chose research
 * only"*, which assumes the Output dial is the only thing that can remove it.
 * `grantableActionKinds(false)` never grants it in the first place, so on a
 * browser shift with the dials untouched the screen showed *"Draft the
 * changes"* checked and told the person they had chosen research only, on the
 * one screen where a claim about what they chose is the whole product.
 *
 * That one is worse than the other three because it is not an overstatement of
 * a promise — it is a decision attributed to someone who did not make it. So
 * the case below renders the default browser shift and reads BOTH: the checked
 * radio out of the markup, and the explanation out of the prose.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Agreement } from '../src/ui/agreement'
import type { ContractDrafted } from '../src/server/actions'
import type { ActionKind, AutonomyControls } from '../src/domain/handoff/policy'
import { grantableActionKinds } from '../src/domain/handoff/policy'

const DEFAULTS: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

function screen(
  allowedActionKinds: readonly ActionKind[],
  over: Partial<AutonomyControls> = {},
  /** Null is the browser shift's value and the default here, because that is
   *  the shape most of this file is about. A title is passed only where the
   *  case under test is a shift that really does have a document under it. */
  documentTitle: string | null = null,
): string {
  const draft: ContractDrafted = {
    contractId: 'contract-1',
    objective: 'Find the delivery date for my last order',
    definitionOfDone: 'The date is written down',
    // `this-session` because this file is about what the panel claims the
    // agreement PERMITS, and the account above the fields is about where the
    // words CAME FROM. Pinning the other arm here would couple a test of the
    // allowlist copy to a change in the pre-fill source — `agreement-words`
    // owns that distinction and asserts both arms.
    words: { from: 'this-session' },
    suggestedTimeLimitMinutes: 30,
    approvedSourceIds: ['source-1'],
    allowedActionKinds: [...allowedActionKinds],
    documentTitle,
    quotedConstraints: [],
  }

  return renderToStaticMarkup(
    createElement(Agreement, {
      draft,
      defaults: { ...DEFAULTS, ...over },
      sourceLabels: { 'source-1': 'Your orders page' },
      onBack: () => undefined,
      onHandedOver: () => undefined,
    }),
  )
}

/**
 * The words, as a person reads them.
 *
 * Curly quotes are normalised because the component writes `&rsquo;` and React
 * renders the character — so an assertion typed with a straight apostrophe
 * would fail for a reason that has nothing to do with what was promised.
 */
function words(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&rsquo;|[‘’]/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

/**
 * The value of the one checked radio in the Output group.
 *
 * Read out of the markup rather than out of `DEFAULTS`, because the point of
 * the case it serves is that two things on ONE rendered screen disagree — and
 * quoting the fixture back at itself would prove nothing about the screen.
 * Same shape as `checkedTimeLimit` in `tests/calendar-agreement.test.ts`.
 */
function checkedOutput(html: string): string | null {
  for (const [, value] of html.matchAll(
    /<input type="radio" name="output" checked="" value="([a-z-]+)"\/>/g,
  )) {
    return value ?? null
  }
  return null
}

const BROWSER = grantableActionKinds(false)
const DOCUMENT = grantableActionKinds(true)

describe('a document shift still says exactly what it always said', () => {
  /**
   * First, because generalising a screen is the change that breaks the case it
   * grew out of, quietly, in a suite that was only ever testing the general
   * one. Every sentence below is the original wording, unchanged.
   */
  it('keeps the absence claim, which is still true of it', () => {
    expect(words(screen(DOCUMENT))).toContain(
      "These aren't switched off. Propositum has no way to do them, and no setting on this page turns one on.",
    )
  })

  it('keeps "nothing lands anywhere on its own"', () => {
    expect(words(screen(DOCUMENT))).toContain('Nothing lands anywhere on its own')
  })

  it('keeps "it cannot follow the link"', () => {
    expect(words(screen(DOCUMENT))).toContain('it cannot follow the link')
  })
})

describe('a browser shift stops claiming an absence it no longer has', () => {
  it('does not tell the person Propositum has no way to send, buy, publish or delete', () => {
    const said = words(screen(BROWSER))

    expect(said).not.toContain('Propositum has no way to do them, and no setting on this page')
    // The list itself survives: there really is no code here that does any of
    // them, and `tests/architecture.test.ts` holds that.
    expect(said).toContain('Send an email or a message')
    expect(said).toContain('Buy anything')
  })

  it('says what actually stands there, which is the pause', () => {
    const said = words(screen(BROWSER))

    expect(said).toContain('it stops and asks you about that one thing')
    // The two properties a person most needs and would otherwise assume wrongly.
    expect(said).toContain('nothing on this page turns it off')
    expect(said).toContain('time running out never counts as a yes')
  })

  it('stops promising that nothing lands on its own', () => {
    const said = words(screen(BROWSER))

    expect(said).not.toContain('Nothing lands anywhere on its own')
    expect(said).toContain('they happen on the page as they happen')
  })

  it('stops promising it cannot follow a link', () => {
    const said = words(screen(BROWSER))

    expect(said).toContain('It can open other pages on these sites')
    // The narrower promise survives and is the one that is still true: a link
    // off the approved sources is not followed.
    expect(said).toContain('If a link goes anywhere else, it cannot follow it')
  })

  it('lists pressing and typing under what Propositum may do', () => {
    const said = words(screen(BROWSER))

    expect(said).toContain('Click something on the page')
    expect(said).toContain('Type into a box on the page')
  })
})

describe('research only takes the pause back off the screen, because it is true again', () => {
  /**
   * The dial has to move the WORDS as well as the permission.
   *
   * `compilePolicy` removes every kind that can operate a page under
   * `suggestions-only`, so a browser shift set to research only genuinely
   * cannot press anything — and a screen still explaining a confirmation pause
   * would be describing a mechanism that has nothing left to guard. The panel
   * reads the compiled allowlist rather than the stored one precisely so this
   * cannot drift.
   */
  it('restores the absence claim under suggestions-only', () => {
    const said = words(screen(BROWSER, { output: 'suggestions-only' }))

    expect(said).toContain(
      'Propositum has no way to do them, and no setting on this page turns one on',
    )
    expect(said).not.toContain('it stops and asks you about that one thing')
  })

  it('still lets it read across the site, so the label means what it says', () => {
    const said = words(screen(BROWSER, { output: 'suggestions-only' }))

    expect(said).toContain('Look at the page you are on')
    expect(said).toContain('It can open other pages on these sites')
    expect(said).not.toContain('Click something on the page under')
  })
})

describe('the panel says why drafting is off, and never invents the reason', () => {
  it('does not tell a browser shift they chose research only', () => {
    // The dials are untouched, so this is what the default handover shows.
    const html = screen(BROWSER)

    expect(checkedOutput(html)).toBe('draft-changes')
    expect(words(html)).not.toContain('You chose research only')
  })

  it('says the true reason, which is that there is no document to draft into', () => {
    expect(words(screen(BROWSER))).toContain(
      'There is no document under this agreement, so there is nothing to draft',
    )
  })

  it('keeps the dial sentence where the dial really is the reason', () => {
    // A document shift: `draft-section` was granted, and research only took it
    // away. Here the screen is describing a choice the person actually made.
    const said = words(screen(DOCUMENT, { output: 'suggestions-only' }, 'The supplier proposal'))

    expect(said).toContain(
      'You chose research only, so Propositum will come back with findings, questions and next steps',
    )
    expect(said).not.toContain('There is no document under this agreement, so there is nothing to draft')
  })
})

/**
 * The fifth sentence, and the only one that is not a sentence.
 *
 * The four above were all fixed by rewriting prose. This one cannot be: every
 * sentence under *"What you've switched off"* was already true on its own, and
 * `NOT_IN_THIS_AGREEMENT` was written precisely so that it names no cause. What
 * made the panel lie was the HEADING — one cause, over a list built as every
 * kind not on the compiled allowlist, which on a browser shift is mostly kinds
 * the person was never offered and therefore never switched off.
 *
 * So the assertions below are scoped to a group rather than to the page. A
 * page-wide `toContain` cannot see this defect at all, which is why it survived
 * two commits that both reported it.
 */

/** Every group heading on the panel, in the order a person meets them. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h3 class="ag-group-head">(.*?)<\/h3>/g)].map((m) =>
    words(m[1] ?? '').trim(),
  )
}

/**
 * The words filed under one heading, and nothing else on the screen.
 *
 * Sliced between this `ag-group-head` and the next one. It does NOT cover the
 * prose after the last group — the `ag-hint` under the absence list runs to the
 * end of the section and would be swept into it. No assertion here needs it,
 * and `tests/agreement-density.test.ts` owns that sentence.
 */
function underHeading(html: string, heading: string): string {
  const heads = [...html.matchAll(/<h3 class="ag-group-head">(.*?)<\/h3>/g)]
  const at = heads.findIndex((h) => words(h[1] ?? '').trim() === heading)
  if (at === -1) return ''
  const here = heads[at]
  if (here?.index === undefined) return ''
  return words(html.slice(here.index + here[0].length, heads[at + 1]?.index ?? html.length))
}

const SWITCHED_OFF = "What you've switched off"
const NOT_INCLUDED = "What this agreement doesn't include"

describe('the panel files a permission under the heading that is true of it', () => {
  it('credits the person with nothing on a browser shift, where they chose nothing', () => {
    // The dials are untouched. Everything missing here is missing because
    // `grantableActionKinds(false)` never offered it, so the group that names a
    // choice has no members and must not be on the screen at all.
    const html = screen(BROWSER)

    expect(checkedOutput(html)).toBe('draft-changes')
    expect(headings(html)).not.toContain(SWITCHED_OFF)
    expect(underHeading(html, SWITCHED_OFF)).toBe('')
  })

  it('files what was never offered under a heading naming no cause', () => {
    const said = underHeading(screen(BROWSER), NOT_INCLUDED)

    expect(said).toContain('Draft a section of your document')
    expect(said).toContain('Read the sources you approved')
  })

  it('keeps the choice heading for the kind a dial really did remove', () => {
    // A document shift under research only: `draft-section` was granted and the
    // dial took it away. This is the one case where crediting the person is true.
    const html = screen(DOCUMENT, { output: 'suggestions-only' }, 'The supplier proposal')

    expect(underHeading(html, SWITCHED_OFF)).toContain('Draft a section of your document')
    expect(underHeading(html, NOT_INCLUDED)).not.toContain('Draft a section of your document')
  })

  it('splits one screen across both headings when the dial removed only some of it', () => {
    // A browser shift under research only. The dial removed the three kinds
    // that operate a page; `draft-section` was never on offer. Both groups have
    // members, and the same panel has to get both right at once.
    const html = screen(BROWSER, { output: 'suggestions-only' })

    expect(underHeading(html, SWITCHED_OFF)).toContain('Click something on the page')
    expect(underHeading(html, SWITCHED_OFF)).not.toContain('Draft a section of your document')
    expect(underHeading(html, NOT_INCLUDED)).toContain('Draft a section of your document')
  })
})
