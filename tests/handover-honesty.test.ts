/**
 * The screen you read AFTER handing over has to stop crediting a choice nobody
 * made.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `tests/agreement-honesty.test.ts` fixed the fourth sentence of the permission
 * panel: a missing `draft-section` was explained with *"You chose research
 * only"*, which assumes the Output dial is the only thing that can remove it.
 * `grantableActionKinds(false)` never grants it, so on every browser shift that
 * sentence attributed a decision to somebody who did not make it.
 *
 * The commit that fixed it named what it did not fix, in as many words:
 * *"`src/ui/reading.tsx` repeats 'You asked for research only' after the
 * handover on the same reading of the same allowlist."* This file is about that
 * repeat. It is the same untruth on a later screen, and the later screen is the
 * worse place for it — the permission panel is read while a person can still
 * change their mind, and this one is read while Propositum is already working.
 *
 * ── Why the assertions are on WORDS ──────────────────────────────────────
 *
 * Same reason `agreement-honesty` gives: a screen that tells a person what they
 * chose is a promise in prose, and there is no structural check that separates
 * *"you asked for research only"* from *"there is nothing to draft"*. So the
 * words are pinned and a rewrite has to come through here.
 *
 * ── Cost, stated ─────────────────────────────────────────────────────────
 *
 * One `renderToStaticMarkup` and no interaction, inherited from the harness
 * `tests/calendar-agreement.test.ts` argues for. It is enough because the
 * sentence under test is decided entirely by the props at render time.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { HandedOver } from '../src/ui/reading'
import type { Handed } from '../src/ui/reading'
import { grantableActionKinds } from '../src/domain/handoff/policy'

const BROWSER = grantableActionKinds(false)
const DOCUMENT = grantableActionKinds(true)

function screen(over: Partial<Handed>): string {
  const handed: Handed = {
    contractId: 'contract-1',
    deadlineAt: new Date('2026-08-20T17:30:00Z').toISOString(),
    allowedActionKinds: [...BROWSER],
    draftingWasOnOffer: false,
    documentTitle: null,
    ...over,
  }

  return renderToStaticMarkup(createElement(HandedOver, { handed }))
}

/** The words, as a person reads them. Curly quotes normalised for the reason
 *  `agreement-honesty` normalises them. */
function words(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;|&rsquo;|[‘’]/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&mdash;|—/g, '-')
    .replace(/\s+/g, ' ')
}

describe('a document shift still says exactly what it always said', () => {
  /**
   * First, because generalising a screen is the change that breaks the case it
   * grew out of. Both sentences below are the original wording, unchanged.
   */
  it('promises drafted text when drafting was granted', () => {
    expect(
      words(screen({ allowedActionKinds: [...DOCUMENT], documentTitle: 'Trip notes' })),
    ).toContain('It may propose text for your document. Nothing lands until you accept it.')
  })

  it('still credits the dial when the dial really did take drafting away', () => {
    const html = screen({
      allowedActionKinds: DOCUMENT.filter((kind) => kind !== 'draft-section'),
      draftingWasOnOffer: true,
      documentTitle: 'Trip notes',
    })
    expect(words(html)).toContain('You asked for research only')
  })
})

describe('a browser shift is not told it chose something', () => {
  /**
   * The regression itself. `grantableActionKinds(false)` never offered
   * `draft-section`, so there was no choice to make and none to report — and
   * this screen said there had been one on every shift with no document under
   * it, which is every browser shift there is.
   */
  it('never says the person asked for research only', () => {
    expect(words(screen({}))).not.toContain('You asked for research only')
  })

  it('says why there is nothing to draft instead', () => {
    expect(words(screen({}))).toContain('This shift has no document under it')
  })

  /**
   * The third case, so the fix cannot swing the other way: a kind that is
   * absent for neither reason gets the sentence that names no cause, exactly as
   * `NOT_IN_THIS_AGREEMENT` does one screen earlier.
   */
  it('names no cause when there is a document and drafting was never offered', () => {
    const html = words(screen({ documentTitle: 'Trip notes' }))
    expect(html).not.toContain('You asked for research only')
    expect(html).not.toContain('This shift has no document under it')
    expect(html).toContain('no text for your document')
  })
})
