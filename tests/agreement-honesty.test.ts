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
    documentTitle: null,
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
