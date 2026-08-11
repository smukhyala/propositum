/**
 * Does the extension's raw signal become the right ObservationEvent?
 *
 * This layer exists because `content.js` used to name the kind itself, and got
 * it wrong in a way a green suite could not see: `queried` and `returnedTo`
 * were never produced by any code path, and `engaged` fired on every pagehide
 * with no dwell measured, so the tested thresholds in semantics.ts were
 * contradicted rather than merely unused.
 *
 * So these tests are about the four kinds that were previously unreachable, and
 * about the two ways a signal is deliberately dropped.
 */

import { describe, it, expect } from 'vitest'
import { createNavigationClassifier } from '../src/capture/semantics'
import { ENGAGEMENT_DWELL_MS, ENGAGEMENT_SCROLL_FRACTION } from '../src/capture/semantics'
import { rawSignalSchema, toSemanticEvent } from '../src/server/capture-adapter'

const SOURCE = 'src-1'
const AT = new Date('2026-08-10T14:00:00.000Z').toISOString()

function fresh() {
  return createNavigationClassifier()
}

describe('the extension may not name a kind', () => {
  it('accepts a raw navigation signal', () => {
    const parsed = rawSignalSchema.safeParse({
      signal: 'navigation',
      at: AT,
      elapsedMs: 0,
      url: 'https://northwind.example.com/partners',
      title: 'Partners',
    })

    expect(parsed.success).toBe(true)
  })

  it('rejects a payload that tries to name a kind instead of a signal', () => {
    // The old wire format. An extension that could name a kind could name
    // `sourceApproved`, and approval is a human act the app records.
    const parsed = rawSignalSchema.safeParse({
      kind: 'visited',
      observedAt: AT,
      elapsedMs: 0,
      attested: { url: 'https://northwind.example.com/partners' },
    })

    expect(parsed.success).toBe(false)
  })

  it('rejects an unknown signal name rather than guessing', () => {
    expect(rawSignalSchema.safeParse({ signal: 'keylog', at: AT, elapsedMs: 0 }).success).toBe(false)
  })
})

describe('navigation becomes visited, queried or returnedTo', () => {
  it('a first visit is visited', () => {
    const event = toSemanticEvent(
      {
        signal: 'navigation',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/partners',
        title: 'Partners',
      },
      SOURCE,
      fresh(),
    )

    expect(event?.kind).toBe('visited')
  })

  it('a second visit to the same page is returnedTo — a kind nothing could produce before', () => {
    const classifier = fresh()
    const signal = {
      signal: 'navigation' as const,
      at: AT,
      elapsedMs: 10,
      url: 'https://northwind.example.com/partners',
      title: 'Partners',
    }

    expect(toSemanticEvent(signal, SOURCE, classifier)?.kind).toBe('visited')
    expect(toSemanticEvent(signal, SOURCE, classifier)?.kind).toBe('returnedTo')
  })

  it('a search is queried, and carries the term', () => {
    const event = toSemanticEvent(
      {
        signal: 'navigation',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/search?q=partner+tiers',
        title: 'Search',
      },
      SOURCE,
      fresh(),
    )

    expect(event?.kind).toBe('queried')
    expect(event?.attested['term']).toBe('partner tiers')
  })

  it('the readable excerpt rides along raw, for the ledger to datamark', () => {
    const event = toSemanticEvent(
      {
        signal: 'navigation',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/partners',
        title: 'Partners',
        text: 'Standard partners receive a 15% revenue share.',
      },
      SOURCE,
      fresh(),
    )

    expect(event?.untrustedText).toBe('Standard partners receive a 15% revenue share.')
  })
})

describe('engagement thresholds actually bite', () => {
  const engagement = (dwellMs: number, scrollFraction: number) =>
    toSemanticEvent(
      {
        signal: 'engagement',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/partners',
        dwellMs,
        scrollFraction,
      },
      SOURCE,
      fresh(),
    )

  it('a glance produces no row at all', () => {
    // Previously EVERY pagehide produced an `engaged` event, because content.js
    // hardcoded the kind and sent no dwell.
    expect(engagement(1_000, 0.9)).toBeNull()
  })

  it('a long dwell without scrolling produces no row', () => {
    expect(engagement(ENGAGEMENT_DWELL_MS + 1, 0)).toBeNull()
  })

  it('dwell and scroll together are engagement', () => {
    const event = engagement(ENGAGEMENT_DWELL_MS + 1, ENGAGEMENT_SCROLL_FRACTION + 0.1)

    expect(event?.kind).toBe('engaged')
  })
})

describe('engagement is reported while the page is open, not only on unload', () => {
  const report = (classifier: ReturnType<typeof createNavigationClassifier>, dwellMs: number) =>
    toSemanticEvent(
      {
        signal: 'engagement',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/tiers',
        dwellMs,
        scrollFraction: ENGAGEMENT_SCROLL_FRACTION + 0.1,
      },
      SOURCE,
      classifier,
    )

  it('records the page once, however many reports arrive', () => {
    // content.js now reports every 15s while the page is visible, so without
    // this the ledger would gain a row every fifteen seconds for as long as
    // someone read — a timeline of one page, forty times.
    const classifier = fresh()

    expect(report(classifier, ENGAGEMENT_DWELL_MS + 1)?.kind).toBe('engaged')
    expect(report(classifier, ENGAGEMENT_DWELL_MS * 2)).toBeNull()
    expect(report(classifier, ENGAGEMENT_DWELL_MS * 4)).toBeNull()
  })

  it('counts a page read without any window scroll — the container-scroll case', () => {
    // The bug this exists for: `window.scrollY` stays 0 on a site that scrolls
    // inside a div, so a page read seven times over several minutes produced
    // ZERO engagement events. Scrolling was always a proxy for presence.
    const event = toSemanticEvent(
      {
        signal: 'engagement',
        at: AT,
        elapsedMs: 10,
        url: 'https://www.tripadvisor.com/secret-falls',
        dwellMs: ENGAGEMENT_DWELL_MS + 60_000,
        scrollFraction: 0,
        interacted: true,
      },
      SOURCE,
      fresh(),
    )

    expect(event?.kind).toBe('engaged')
  })

  it('still refuses a tab left open and never touched', () => {
    // The rule's actual purpose, unchanged: dwell alone is not reading.
    const event = toSemanticEvent(
      {
        signal: 'engagement',
        at: AT,
        elapsedMs: 10,
        url: 'https://news.example/left-open',
        dwellMs: ENGAGEMENT_DWELL_MS * 20,
        scrollFraction: 0,
        interacted: false,
      },
      SOURCE,
      fresh(),
    )

    expect(event).toBeNull()
  })

  it('an early report below the threshold does not silence the real crossing', () => {
    // The bug this shape exists to avoid: marking the page on the QUERY rather
    // than on a produced event lets a 15s report claim it, so the 25s crossing
    // is suppressed and the engagement is never recorded at all.
    const classifier = fresh()

    expect(report(classifier, ENGAGEMENT_DWELL_MS - 5_000)).toBeNull()
    expect(report(classifier, ENGAGEMENT_DWELL_MS + 5_000)?.kind).toBe('engaged')
  })

  it('a different page in the same sitting is still recorded', () => {
    const classifier = fresh()
    expect(report(classifier, ENGAGEMENT_DWELL_MS + 1)?.kind).toBe('engaged')

    const other = toSemanticEvent(
      {
        signal: 'engagement',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/pricing',
        dwellMs: ENGAGEMENT_DWELL_MS + 1,
        scrollFraction: ENGAGEMENT_SCROLL_FRACTION + 0.1,
      },
      SOURCE,
      classifier,
    )

    expect(other?.kind).toBe('engaged')
  })
})

describe('selection', () => {
  it('a stray two-character selection is not intent', () => {
    const event = toSemanticEvent(
      {
        signal: 'selection',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/partners',
        text: 'ab',
      },
      SOURCE,
      fresh(),
    )

    expect(event).toBeNull()
  })

  it('a deliberate selection is excerpted, with the text carried raw', () => {
    const event = toSemanticEvent(
      {
        signal: 'selection',
        at: AT,
        elapsedMs: 10,
        url: 'https://northwind.example.com/partners',
        text: 'Gold partners receive co-marketing.',
      },
      SOURCE,
      fresh(),
    )

    expect(event?.kind).toBe('excerpted')
    expect(event?.untrustedText).toBe('Gold partners receive co-marketing.')
  })
})

describe('leaving is not attributable to a source', () => {
  it('away carries no approvedSourceId, because where they went is not our business', () => {
    const event = toSemanticEvent(
      { signal: 'away', at: AT, elapsedMs: 10, cause: 'idle' },
      '',
      fresh(),
    )

    expect(event?.kind).toBe('switchedAway')
    expect(event?.approvedSourceId).toBeUndefined()
    expect(event?.attested['cause']).toBe('idle')
  })
})
