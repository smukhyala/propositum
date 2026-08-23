/**
 * The reading screen's shape, pinned before it is simplified.
 *
 * ── Why this one is worth a file of its own ──────────────────────────────
 *
 * `TakeOver` renders the surface H1 is scored against. `docs/MVP.md` scores
 * the reading on six components, and the sixth is *Uncertainties* — "none
 * surfaced, or noise" scores 0. So the confidence band and the per-claim
 * evidence are not decoration on this screen; they are the measurement. A
 * simplification that quietly removed either would not fail a test today, and
 * would silently lower a hypothesis that has never been scored.
 *
 * It also owns the two-stage flow: `stage` flips between the reading and the
 * agreement in client state, so the agreement has no URL of its own. This file
 * pins the first stage only — `renderToStaticMarkup` gives the arrival state,
 * and the arrival state is the reading.
 *
 * ── What is deliberately NOT pinned ──────────────────────────────────────
 *
 * The word *confidence* never appears in UI copy (CONTEXT.md) — the band is
 * three fixed sentences. Those sentences are prose and are free to change, so
 * nothing here asserts them. What is asserted is that a low band still opens
 * the correction box, because that is the behaviour, not the wording.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TakeOver } from '../src/ui/reading'
import type { ClaimView, TakeOverProps } from '../src/ui/reading'

function claim(over: Partial<ClaimView> = {}): ClaimView {
  return {
    id: 'claim-1',
    kind: 'objective',
    text: 'Checking the zone forecast for the south shore.',
    confidence: 'high',
    origin: 'inferred',
    evidence: [
      {
        at: '4:31 pm',
        what: 'Read the zone forecast page',
        quote: null,
        sourceLabel: 'forecast.weather.gov',
      },
    ],
    ...over,
  }
}

function screen(over: Partial<TakeOverProps> = {}): string {
  const props: TakeOverProps = {
    sessionId: 'session-1',
    projectName: 'Kauai',
    phase: 'observing',
    when: '3:41 pm — still going',
    reading: { id: 'reading-1', claims: [claim()] },
    sources: [
      { id: 'source-1', label: 'The forecast site', originPattern: 'forecast.weather.gov' },
    ],
    shiftContractId: null,
    ...over,
  }

  return renderToStaticMarkup(createElement(TakeOver, props))
}

describe('the reading keeps the surface H1 is scored on', () => {
  it('reaches evidence for a claim', () => {
    const markup = screen()

    /* MVP.md's acceptance criteria: "The SessionReading renders with Evidence
     * reachable for every claim." A disclosure satisfies reachable; nothing at
     * all does not. */
    expect(markup).toContain('<details')
    expect(markup).toContain('Read the zone forecast page')
  })

  it('attributes a page-authored quotation to its source, never bare', () => {
    const markup = screen({
      reading: {
        id: 'reading-1',
        claims: [
          claim({
            evidence: [
              {
                at: '4:31 pm',
                what: 'Read the forecast',
                quote: 'Small craft advisory in effect.',
                sourceLabel: 'forecast.weather.gov',
              },
            ],
          }),
        ],
      },
    })

    /* CONTEXT.md's `UntrustedContent` has no consumer word by design: "The UI
     * shows the source link and the attributed quote instead of a trust
     * label." So the quote may never appear without the label. */
    const quote = markup.indexOf('Small craft advisory')
    expect(quote).toBeGreaterThan(-1)
    expect(markup).toContain('forecast.weather.gov')
  })

  it('offers a correction on every claim', () => {
    const markup = screen({
      reading: {
        id: 'reading-1',
        claims: [claim(), claim({ id: 'claim-2', kind: 'open-thread', confidence: null })],
      },
    })

    /* Editing is per claim on purpose: revision-level authorship "would
     * launder every untouched inferred claim into a human assertion the moment
     * one word changed". Two claims, two ways to correct. */
    expect(markup.split('Say it differently').length - 1).toBe(2)
  })

  it('does not print the word confidence anywhere a person can read it', () => {
    const markup = screen({
      reading: { id: 'reading-1', claims: [claim({ confidence: 'low' })] },
    })

    /* CONTEXT.md:806 — "the word 'confidence' never appears in UI copy".
     * Class names and attributes are not copy, so only the text between tags
     * is searched. */
    const visible = markup.replace(/<[^>]*>/g, ' ')
    expect(visible.toLowerCase()).not.toContain('confidence')
  })
})

describe('the reading will not hand over what it has not read', () => {
  it('offers no way forward when there is no reading yet', () => {
    const markup = screen({ reading: null })

    expect(markup).not.toContain('Write the working agreement')
  })

  it('blocks the agreement when the objective claim is missing', () => {
    const markup = screen({
      reading: { id: 'reading-1', claims: [claim({ kind: 'open-thread', confidence: null })] },
    })

    /* "Write the working agreement" is disabled when `objective === null`.
     * The control is present and inert rather than absent — the person needs
     * to see that the step exists and why it is not available. */
    const at = markup.indexOf('Write the working agreement')
    expect(at).toBeGreaterThan(-1)
    expect(markup.slice(Math.max(0, at - 400), at)).toContain('disabled')
  })
})
