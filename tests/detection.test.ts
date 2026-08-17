/**
 * When does Propositum decide you are working on something?
 *
 * This layer reverses a founding-brief exclusion, so the tests are written
 * against the two ways it can be wrong, and they are not symmetric:
 *
 *   - A MISSED detection costs a suggestion nobody sees. Annoying.
 *   - A FALSE detection interrupts someone who was reading the news, and
 *     teaches them to ignore the thing. That is the expensive one.
 *
 * So most of what is pinned here is what must NOT fire.
 */

import { describe, it, expect } from 'vitest'
import {
  ENGAGED_MS_FOR_WORK,
  PAUSE_MS,
  WINDOW_MS,
  WORKED_MS_FOR_HANDOFF,
  detectPause,
  detectThreads,
  detectWork,
  threadPagesOf,
} from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'
import { DEEP_READ_MS, READ_AROUND_MS, groundsFor } from '../src/domain/detection/grounds'

const T0 = 1_000_000

function nav(at: number, url: string, origin = 'https://northwind.example.com'): AmbientObservation {
  return { at, origin, url, title: url, kind: 'navigation' }
}

function read(
  at: number,
  url: string,
  engagedMs: number,
  origin = 'https://northwind.example.com',
): AmbientObservation {
  return { at, origin, url, title: url, kind: 'engagement', engagedMs }
}

function query(at: number, url: string, origin = 'https://northwind.example.com'): AmbientObservation {
  return { at, origin, url, title: url, kind: 'query' }
}

describe('what must not be mistaken for work', () => {
  it('an empty window detects nothing', () => {
    expect(detectWork([], T0)).toBeNull()
  })

  it('one page, however long, is reading — not work', () => {
    const observations = [nav(T0, '/a'), read(T0 + 1, '/a', ENGAGED_MS_FOR_WORK * 3)]

    expect(detectWork(observations, T0 + 2)).toBeNull()
  })

  it('many pages skimmed with no engagement is browsing', () => {
    // Ten pages, no dwell past the engagement threshold. This is the news.
    const observations = Array.from({ length: 10 }, (_, i) => nav(T0 + i, `/p${i}`))

    expect(detectWork(observations, T0 + 20)).toBeNull()
  })

  it('enough pages but not enough engaged time does not fire', () => {
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK / 4),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })

  it('revisiting one page repeatedly is not three pages', () => {
    // Distinct URLs, not visit count — a refresh loop is not research.
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/a'),
      nav(T0 + 2, '/a'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK * 2),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })

  it('work that has aged out of the window is gone', () => {
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK),
    ]

    // Past the LAST observation's window, not the first — the window rolls per
    // observation, so aging out the earliest proves nothing.
    expect(detectWork(observations, T0 + 3 + WINDOW_MS + 1)).toBeNull()
  })

  it('the window rolls, so old work stops counting while new work still does', () => {
    const observations = [
      // Yesterday's session, still in the buffer.
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK),
      // A single page now. Not work on its own.
      nav(T0 + WINDOW_MS + 10, '/d'),
      read(T0 + WINDOW_MS + 11, '/d', 60_000),
    ]

    // The old four are out of window; the new two are not enough.
    expect(detectWork(observations, T0 + WINDOW_MS + 12)).toBeNull()
  })

  it('does not add up activity across unrelated sites', () => {
    // Two pages here, two there. Neither is work, and the sum is not either.
    const observations = [
      nav(T0, '/a', 'https://a.example.com'),
      read(T0 + 1, '/a', ENGAGED_MS_FOR_WORK, 'https://a.example.com'),
      nav(T0 + 2, '/b', 'https://b.example.com'),
      read(T0 + 3, '/b', ENGAGED_MS_FOR_WORK, 'https://b.example.com'),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })
})

describe('what is work — a subject followed across sites', () => {
  /** Three sites, one subject. The shape research actually has. */
  const thread: AmbientObservation[] = [
    { at: T0, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    { at: T0 + 1, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK / 2 },
    { at: T0 + 2, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    { at: T0 + 3, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK / 2 },
    { at: T0 + 4, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
  ]

  it('finds the subject, not the site', () => {
    const found = detectWork(thread, T0 + 5)

    expect(found).not.toBeNull()
    expect(found?.terms).toContain('world')
    // The matching key is singular, so a page saying "world model" joins a
    // thread built from pages saying "world models".
    expect(found?.terms).toContain('model')
    // And the sentence a person reads keeps the spelling they saw. A stem is a
    // key; it was never fit to be shown to anybody.
    expect(found?.labels).toContain('models')
  })

  it('names every site the subject ran through', () => {
    expect(detectWork(thread, T0 + 5)?.origins.length).toBe(3)
  })

  it('a searched subject fires without much reading at all', () => {
    // Searching for something states the intent outright. Waiting for eight
    // minutes of dwell after that is waiting for a fact already established.
    const searched: AmbientObservation[] = [
      { at: T0, origin: 'https://www.google.com', url: 'https://www.google.com/search?q=world+models', title: 'world models - Google Search', kind: 'query' },
      { at: T0 + 1, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
      { at: T0 + 2, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    ]

    const found = detectWork(searched, T0 + 3)
    expect(found?.because).toBe('searched-and-followed')
    expect(found?.searches).toBeGreaterThanOrEqual(1)
  })

  it('names the page they spent longest on', () => {
    expect(detectWork(thread, T0 + 5)?.focus).toBe('World Models Survey')
  })

  it('always reports why it fired', () => {
    expect(detectWork(thread, T0 + 5)?.because).toBeDefined()
  })

  it('takes the largest cumulative report per page, not the sum', () => {
    // Reports arrive every 15s carrying cumulative dwell. Summing them would
    // count the same minute once per report.
    const repeated: AmbientObservation[] = [
      ...thread,
      { at: T0 + 6, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK / 2 },
      { at: T0 + 7, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK / 2 },
    ]

    expect(detectWork(repeated, T0 + 8)?.engagedMs).toBe(ENGAGED_MS_FOR_WORK)
  })
})

describe('a query is a query, not a question mark', () => {
  /**
   * The service worker marks `kind: 'query'` on any URL carrying a `?`, so
   * `describeWork` was claiming "you searched for it, then read 4 pages" over
   * browsing where nobody had searched for anything. The domain re-decides,
   * and the extension cannot widen what counts.
   */
  const shaped = (url: string, origin: string): AmbientObservation[] => [
    { at: T0, origin, url, title: 'World Models', kind: 'query' },
    { at: T0 + 1, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    { at: T0 + 2, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    // Enough reading that the thread clears the naming bar either way, so what
    // is being measured here is the search count and nothing else.
    { at: T0 + 3, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK },
  ]

  it('counts a real search', () => {
    const found = detectWork(
      shaped('https://www.google.com/search?q=world+models', 'https://www.google.com'),
      T0 + 3,
    )

    expect(found?.searches).toBe(1)
    expect(found?.because).toBe('searched-and-followed')
  })

  it('does not count a checkout page the extension called a query', () => {
    const found = detectWork(
      shaped('https://shop.example.com/cart/checkout?step=2', 'https://shop.example.com'),
      T0 + 3,
    )

    // The thread still forms — three pages, three origins, one subject — but
    // nothing about it may be described as having been searched for.
    expect(found?.searches).toBe(0)
    expect(found?.because).toBe('followed-across-sites')
  })
})

describe('coming back to a page is a fact about the page', () => {
  const thread = (extra: AmbientObservation[] = []): AmbientObservation[] => [
    { at: T0, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    { at: T0 + 1, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    { at: T0 + 2, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
    // Past the naming bar, so `detectWork` has something to report and the
    // arrival counts can be read off it.
    { at: T0 + 10, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK },
    ...extra,
  ]

  /** Through `detectWork` and `threadPagesOf`, which is the pair the offer path
   *  uses — so these are the counts the grounds will see, not a private view. */
  const pageIn = (observations: AmbientObservation[], url: string) => {
    const found = detectWork(observations, T0 + 100)
    expect(found).not.toBeNull()
    return threadPagesOf(observations, found!, T0 + 100).find((page) => page.url === url)
  }

  it('carries only the pages the thread was made of', () => {
    const observations = thread([
      { at: T0 + 3, origin: 'https://unrelated.example', url: 'https://unrelated.example/1', title: 'Lasagne', kind: 'navigation' },
    ])
    const found = detectWork(observations, T0 + 100)

    expect(threadPagesOf(observations, found!, T0 + 100).map((page) => page.url)).toEqual(found?.urls)
  })

  it('a page seen once, then returned to, is two arrivals', () => {
    const observations = thread([
      { at: T0 + 3, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    ])

    // Reached through the same buffer the offer path reads, so this is the
    // count `came-back` will see rather than a private one.
    expect(pageIn(observations, 'https://a.example/1')?.visits).toBe(2)
  })

  it('a reload is not a return', () => {
    // Two navigation reports in a row for the same page is one arrival
    // reported twice. Counting it would make `came-back` fire on any page that
    // refreshes itself.
    const observations = thread([
      { at: T0 + 3, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
    ])

    expect(pageIn(observations, 'https://c.example/1')?.visits).toBe(1)
  })

  it('counts arrivals in time order, however the reports arrived', () => {
    // A service worker that woke up late can deliver two sittings out of
    // sequence, and an arrival counted against the wrong neighbour is a return
    // that did not happen.
    // Delivered a-then-a, which reads as a reload. In TIME order the two
    // arrivals at a.example have the whole thread between them, which is a
    // return.
    const observations: AmbientObservation[] = [
      { at: T0, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
      { at: T0 + 3, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
      { at: T0 + 1, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
      { at: T0 + 2, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
      { at: T0 + 10, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: ENGAGED_MS_FOR_WORK },
    ]

    expect(pageIn(observations, 'https://a.example/1')?.visits).toBe(2)
  })

  it('does not count engagement reports as arrivals', () => {
    // Engagement arrives every fifteen seconds while a page is open. If those
    // counted, every page read for a minute would look like a page returned to.
    const observations = thread([
      { at: T0 + 3, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: 30_000 },
      { at: T0 + 4, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: 60_000 },
    ])

    expect(pageIn(observations, 'https://a.example/1')?.visits).toBe(1)
  })
})

describe('a natural stopping point', () => {
  const worked: AmbientObservation[] = [
    nav(T0, '/partners'),
    read(T0 + 1, '/partners', WORKED_MS_FOR_HANDOFF),
  ]

  it('does not fire while they are still here', () => {
    expect(detectPause(worked, T0 + 2)).toBeNull()
  })

  it('does not fire on a short gap', () => {
    expect(detectPause(worked, T0 + PAUSE_MS / 2)).toBeNull()
  })

  it('does not offer to continue work that barely happened', () => {
    const barely = [nav(T0, '/a'), read(T0 + 1, '/a', WORKED_MS_FOR_HANDOFF / 20)]

    expect(detectPause(barely, T0 + PAUSE_MS * 2)).toBeNull()
  })

  it('fires after real work followed by a real gap', () => {
    const found = detectPause(worked, T0 + PAUSE_MS + 1)

    expect(found).not.toBeNull()
    expect(found?.idleForMs).toBeGreaterThanOrEqual(PAUSE_MS)
    expect(found?.workedMs).toBeGreaterThanOrEqual(WORKED_MS_FOR_HANDOFF)
  })

  it('stops firing once everything has aged out', () => {
    // Measured from the last observation, not the first.
    expect(detectPause(worked, T0 + 1 + WINDOW_MS + 1)).toBeNull()
  })
})

/**
 * Scroll arrives, and nothing about the answer moves.
 *
 * `scrollFraction` landed on `AmbientObservation` on 2026-08-17 after being
 * computed by `content.js` and dropped on arrival for the whole build. Carrying
 * a signal and consulting it are two decisions, and only the first was taken —
 * the research that motivated it (`docs/research/intent-suggestion-quality.md`)
 * was recorded as honest limits WITHOUT retuning any constant.
 *
 * So this is the guard on that promise, and it is deliberately not a grep.
 * `tests/reachability.test.ts` asserts that no file under `src/domain/detection`
 * mentions the field; this asserts the thing anybody actually cares about, which
 * is that the same afternoon produces the same detection and the same grounds
 * whether or not the scroll is there. The two catch different mistakes: a grep
 * would miss a consumer that reached the value through a spread, and this would
 * miss a consumer whose effect happens to be nil on one fixture.
 *
 * ADR-0008 names the false positive as the expensive failure, so what must be
 * pinned is that a plumbing change moved no bar in either direction.
 */
describe('landing scroll changes no detection outcome', () => {
  const NOW = T0 + 10 * 60_000

  /**
   * An afternoon that clears the offer bar, so the comparison is between two
   * real answers rather than two nulls.
   *
   * ── Widened 2026-08-17, twice over, after review ─────────────────────────
   *
   * The first version was three origins with one page each and about four
   * minutes of reading, and it was too small in two ways that both made
   * assertions in this block quietly weaker than they read:
   *
   *  - **`read-around` never fired.** It wants `PAGES_ON_ONE_ORIGIN` pages on a
   *    single origin, each held past `READ_AROUND_MS`, and one page per origin
   *    can never satisfy it. That is the ground the deferral is *about*: a
   *    scroll fraction would be consulted there first, so an equality that
   *    cannot see `read-around` cannot see the change it is guarding against.
   *    `a.example` now has three pages.
   *  - **`detectPause` returned `null` on both sides**, so the stopping-point
   *    test asserted `null === null`. `WORKED_MS_FOR_HANDOFF` is ten minutes and
   *    the fixture held four. The engagement figures below total eleven, which
   *    clears it with room and leaves every other bar in the same place.
   */
  const afternoon: AmbientObservation[] = [
    { at: T0, origin: 'https://www.google.com', url: 'https://www.google.com/search?q=world+models', title: 'world models - Google Search', kind: 'query' },
    { at: T0 + 1_000, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    { at: T0 + 2_000, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: DEEP_READ_MS * 3 },
    { at: T0 + 3_000, origin: 'https://a.example', url: 'https://a.example/2', title: 'World Models Benchmarks', kind: 'navigation' },
    { at: T0 + 4_000, origin: 'https://a.example', url: 'https://a.example/2', title: 'World Models Benchmarks', kind: 'engagement', engagedMs: READ_AROUND_MS * 3 },
    { at: T0 + 5_000, origin: 'https://a.example', url: 'https://a.example/3', title: 'World Models Criticism', kind: 'navigation' },
    { at: T0 + 6_000, origin: 'https://a.example', url: 'https://a.example/3', title: 'World Models Criticism', kind: 'engagement', engagedMs: READ_AROUND_MS * 3 },
    { at: T0 + 7_000, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    { at: T0 + 8_000, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'engagement', engagedMs: DEEP_READ_MS * 3 },
    { at: T0 + 9_000, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
    { at: T0 + 10_000, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'engagement', engagedMs: DEEP_READ_MS * 3 },
  ]

  /**
   * The same afternoon, with scroll on every engagement.
   *
   * Deliberately a value a consumer would be tempted to threshold on: 0.05 is
   * "they read the first screenful and stopped", which is the case
   * `READ_AROUND_MS`'s own docstring admits it cannot refuse. If anything starts
   * reading this field, this is the buffer whose answer changes first.
   */
  const scrolled: AmbientObservation[] = afternoon.map((o) =>
    o.kind === 'engagement' ? { ...o, scrollFraction: 0.05 } : o,
  )

  const groundsOf = (observations: readonly AmbientObservation[]) => {
    const detected = detectWork(observations, NOW)
    expect(detected, 'the fixture stopped qualifying — this test is comparing two nulls').not.toBeNull()
    return groundsFor(detected!, threadPagesOf(observations, detected!, NOW))
  }

  it('detects the same thread', () => {
    expect(detectWork(scrolled, NOW)).toEqual(detectWork(afternoon, NOW))
  })

  it('detects the same strands, in the same order', () => {
    expect(detectThreads(scrolled, NOW)).toEqual(detectThreads(afternoon, NOW))
  })

  it('builds the same pages, so ThreadPage gained nothing to threshold on', () => {
    const detected = detectWork(afternoon, NOW)!
    expect(threadPagesOf(scrolled, detected, NOW)).toEqual(threadPagesOf(afternoon, detected, NOW))
  })

  it('computes the same grounds, kinds sentences and sufficiency alike', () => {
    const without = groundsOf(afternoon)

    // Non-vacuous: a fixture that fires nothing would make the equality below
    // true for the wrong reason. `read-around` is named explicitly because it is
    // the ground a scroll fraction would be consulted by first — an equality
    // over a grounds set that does not contain it is not guarding the thing this
    // block is about.
    expect(without.kinds).toContain('read-around')
    expect(without.kinds.length).toBeGreaterThan(0)
    expect(groundsOf(scrolled)).toEqual(without)
  })

  it('finds the same stopping point', () => {
    const paused = [...afternoon, { at: T0 + 10_000, origin: 'https://c.example', url: 'https://c.example/1', title: '', kind: 'away' } as const]
    const scrolledPause = paused.map((o) =>
      o.kind === 'engagement' ? { ...o, scrollFraction: 0.05 } : o,
    )

    const without = detectPause(paused, NOW)

    // The guard the other two assertions in this block already had and this one
    // did not: `detectPause` returned `null` on both sides of the original
    // fixture, so this read `expect(null).toEqual(null)` and would have stayed
    // green through any change to `detectPause` whatsoever.
    expect(without, 'the fixture stopped pausing — this test is comparing two nulls').not.toBeNull()
    expect(detectPause(scrolledPause, NOW)).toEqual(without)
  })
})

describe('the detector cannot see page text', () => {
  it('has no field that could carry it', () => {
    // Structural, not a convention. If someone adds one, this fails and they
    // have to argue for it — ambient capture is metadata only.
    const observation: AmbientObservation = {
      at: T0,
      origin: 'https://northwind.example.com',
      url: '/a',
      title: 'Partners',
      kind: 'navigation',
    }

    expect(Object.keys(observation).sort()).toEqual(['at', 'kind', 'origin', 'title', 'url'])
  })
})
