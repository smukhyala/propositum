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
import type { AmbientObservation, ExitType } from '../src/domain/detection/detect'
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
 * An afternoon that clears the offer bar, so a comparison is between two real
 * answers rather than two nulls.
 *
 * ── Hoisted to module scope 2026-08-17 (ADR-0013), deliberately ──────────
 *
 * Three blocks now measure a signal against it — scroll and exit type, both
 * carried and not consulted, and the tab group title, whose one permitted
 * consumption is the sentence. The alternative was three copies of eleven
 * observations drifting apart. One fixture is one thing to keep honest, and
 * every block below re-asserts that it still qualifies rather than assuming it.
 *
 * ── Widened 2026-08-17, twice over, after review ─────────────────────────
 *
 * The first version was three origins with one page each and about four
 * minutes of reading, and it was too small in two ways that both made
 * assertions quietly weaker than they read:
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
 * Scroll arrives, and nothing about the answer moves.
 *
 * `scrollFraction` landed on `AmbientObservation` on 2026-08-17 after being
 * computed by `content.js` and dropped on arrival for the whole build. Carrying
 * a signal and consulting it are two decisions, and only the first was taken —
 * the research that motivated it (`docs/research/intent-suggestion-quality.md`)
 * was recorded as honest limits WITHOUT retuning any constant. ADR-0013 then
 * added the missing producer line, so the field now arrives from a browser
 * rather than only from a `curl`; nothing about this block changes, because
 * what it guards is the consumption and not the transport.
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

/**
 * A tab group title arrives, and only the NAME moves. ADR-0013.
 *
 * ── What is being guarded, and why it is the load-bearing claim ──────────
 *
 * `docs/research/intent-signals.md` §4.3 argues that a group title is the best
 * signal available to this product, and it argues just as hard for the limit:
 * *"It should raise confidence and never gate detection."* The manifest pays a
 * real install warning — *"View and manage your tab groups"* — on the strength
 * of that limit, so the limit has to be a fact rather than an intention.
 *
 * The specific hazard is not subtle. A group title is on EVERY page in the
 * group by construction. If it reached `ThreadPage.terms` it would supply a
 * seed term, the `ORIGINS_FOR_THREAD` origin count and the `PAGES_FOR_THREAD`
 * page count in one move — manufacturing a thread out of the fact that
 * somebody tidied their tabs, which is the same failure `vocabularyOf`'s rule 2
 * spends its length preventing for a one-edit typo, arriving through a wider
 * door.
 *
 * So this asserts byte-equality of everything the offer bar is computed from,
 * against a buffer that differs only by a label somebody typed — and then
 * asserts, separately, that the label did reach the one place it is allowed to
 * (`WorkDetected.authoredLabel`), so the equalities above are not green because
 * the field went nowhere at all.
 */
describe('a tab group title changes the name and nothing else', () => {
  const NOW = T0 + 10 * 60_000

  /** The same qualifying afternoon the scroll block uses, and deliberately so:
   *  two deferrals and one consumption measured against one fixture is one
   *  fixture to keep honest. */
  const grouped: AmbientObservation[] = afternoon.map((o) => ({
    ...o,
    groupTitle: 'Q3 world-model review',
  }))

  const groundsOf = (observations: readonly AmbientObservation[]) => {
    const detected = detectWork(observations, NOW)
    expect(detected, 'the fixture stopped qualifying — this test is comparing two nulls').not.toBeNull()
    return groundsFor(detected!, threadPagesOf(observations, detected!, NOW))
  }

  it('computes byte-identical grounds, kinds sentences and sufficiency alike', () => {
    const without = groundsOf(afternoon)

    // Non-vacuous, the same way the scroll block is: an equality over a grounds
    // set that fires nothing would be true for the wrong reason.
    expect(without.kinds.length).toBeGreaterThan(0)
    expect(without.sufficient, 'the fixture stopped clearing the offer bar').toBe(true)
    expect(groundsOf(grouped)).toEqual(without)
  })

  it('forms the same threads, in the same order, out of the same pages', () => {
    // `authoredLabel` is the one field expected to differ, so it is stripped
    // before comparing. Everything else — terms, labels, origins, page counts,
    // searches, dwell, urls, `because` — must be identical, because every one
    // of them feeds either the bar or the signature.
    const strip = (found: ReturnType<typeof detectThreads>) =>
      found.map(({ authoredLabel, ...rest }) => {
        void authoredLabel
        return rest
      })

    expect(strip(detectThreads(grouped, NOW))).toEqual(strip(detectThreads(afternoon, NOW)))
  })

  it('never lets the label into the terms that seed a thread or key a signature', () => {
    // The specific hazard, checked directly rather than inferred from the
    // equality above. "review" is a word in the group title and in no page
    // title, so its presence in `terms` would be proof the label leaked.
    const detected = detectWork(grouped, NOW)!

    expect(detected.terms).not.toContain('review')
    expect(detected.terms.join(' ')).not.toContain('q3')

    for (const page of threadPagesOf(grouped, detected, NOW)) {
      expect([...page.terms]).not.toContain('review')
    }
  })

  it('does reach the name, so the equalities above are not green for nothing', () => {
    expect(detectWork(grouped, NOW)?.authoredLabel).toBe('Q3 world-model review')
    expect(detectWork(afternoon, NOW)?.authoredLabel).toBeUndefined()
  })

  it('cannot make an afternoon qualify that would not have qualified', () => {
    /**
     * The claim in the form somebody actually cares about.
     *
     * Three pages across three origins sharing NO subject word — the election,
     * a lasagne recipe and the weather, which is the fixture `topics.test.ts`
     * uses for "unrelated browsing produces nothing". Dropped into one tab group
     * called "world models" they suddenly share a human-authored phrase, and if
     * that phrase reached `terms` it would supply the seed term, the
     * `ORIGINS_FOR_THREAD` origin count and the `PAGES_FOR_THREAD` page count in
     * one move. Every threshold in the detector would be cleared by the fact
     * that somebody tidied their tabs.
     *
     * The dwell is deliberately far past `ENGAGED_MS_FOR_WORK`, so the ONLY
     * thing standing between this buffer and an offer is that the label is not
     * a term.
     */
    const tidiedTabs: AmbientObservation[] = [
      { at: T0, origin: 'https://news.example', url: 'https://news.example/1', title: 'Election Results', kind: 'navigation', groupTitle: 'world models' },
      { at: T0 + 1_000, origin: 'https://news.example', url: 'https://news.example/1', title: 'Election Results', kind: 'engagement', engagedMs: DEEP_READ_MS * 9, groupTitle: 'world models' },
      { at: T0 + 2_000, origin: 'https://recipes.example', url: 'https://recipes.example/1', title: 'Lasagne', kind: 'navigation', groupTitle: 'world models' },
      { at: T0 + 3_000, origin: 'https://recipes.example', url: 'https://recipes.example/1', title: 'Lasagne', kind: 'engagement', engagedMs: DEEP_READ_MS * 9, groupTitle: 'world models' },
      { at: T0 + 4_000, origin: 'https://weather.example', url: 'https://weather.example/1', title: 'Forecast', kind: 'navigation', groupTitle: 'world models' },
      { at: T0 + 5_000, origin: 'https://weather.example', url: 'https://weather.example/1', title: 'Forecast', kind: 'engagement', engagedMs: DEEP_READ_MS * 9, groupTitle: 'world models' },
    ]

    expect(detectWork(tidiedTabs, NOW)).toBeNull()
    expect(detectThreads(tidiedTabs, NOW)).toEqual([])
  })

  it('picks the label most of the thread carries, and the same one every time', () => {
    /**
     * Determinism, because the sentence is re-rendered on every thirty-second
     * poll and a name that flaps reads as a system making things up. This is the
     * same failure `findThreads` was caught by when it took the first spelling
     * it met and rendered a thread as "robotcs".
     */
    const split = afternoon.map((o, index) =>
      index < 4 ? { ...o, groupTitle: 'reading' } : { ...o, groupTitle: 'world models' },
    )

    expect(detectWork(split, NOW)?.authoredLabel).toBe('world models')
    // And again, from the same buffer, unchanged.
    expect(detectWork(split, NOW)?.authoredLabel).toBe('world models')
  })
})

/**
 * The exit type arrives, and nothing at all moves. ADR-0013.
 *
 * The same guard as the scroll block above and for the same reason: it is
 * carried and deliberately not consulted. `AmbientObservation.exitType` argues
 * the deferral at length — the short version is that Fox et al.'s evidence
 * turns on separating a return from an onward navigation, and that distinction
 * lives INSIDE our `'left-unloaded'`, which a content script cannot split
 * without `tabs` or `webNavigation`.
 *
 * `tests/reachability.test.ts` greps for a reader. This asserts the thing
 * anybody cares about, which is that the same afternoon produces the same
 * answer either way. The two catch different mistakes.
 */
/**
 * Every member of the enum, and exhaustive by construction.
 *
 * WAS one fixture setting `'left-unloaded'` on every engagement, and CORRECTED
 * 2026-08-17: an equality that only ever sees one of three values cannot report
 * itself as covering the enum. A consumer keyed on `'hidden'` — the value the
 * new `visibilitychange` reporter emits most, and the commonest exit there is —
 * never appeared on either side of the old comparison, and one added to
 * `pagesOf` passed the whole suite green.
 *
 * The `Record<ExitType, …>` is what keeps this honest as the type changes: a
 * fourth member added to `ExitType` fails `npm run typecheck` here rather than
 * quietly going unexercised, which is the same failure in a slower disguise.
 */
const EVERY_EXIT_TYPE: Record<ExitType, true> = {
  hidden: true,
  'left-cached': true,
  'left-unloaded': true,
}

describe.each(Object.keys(EVERY_EXIT_TYPE) as ExitType[])(
  'landing the exit type changes no detection outcome (%s)',
  (exitType) => {
    const NOW = T0 + 10 * 60_000

    /** The same afternoon, differing only by how each page was left. If anything
     *  starts reading this field, one of these three runs is the buffer whose
     *  answer changes first — `'left-unloaded'` is Fox's dissatisfaction node
     *  and `'hidden'` is the value a tab switch produces. */
    const exited: AmbientObservation[] = afternoon.map((o) =>
      o.kind === 'engagement' ? { ...o, exitType } : o,
    )

    it('detects the same strands, in the same order', () => {
      expect(detectThreads(exited, NOW)).toEqual(detectThreads(afternoon, NOW))
    })

    it('builds the same pages, so ThreadPage gained nothing to threshold on', () => {
      const detected = detectWork(afternoon, NOW)!
      expect(threadPagesOf(exited, detected, NOW)).toEqual(threadPagesOf(afternoon, detected, NOW))
    })

    it('computes the same grounds, kinds sentences and sufficiency alike', () => {
      const detected = detectWork(afternoon, NOW)!
      const without = groundsFor(detected, threadPagesOf(afternoon, detected, NOW))

      expect(without.kinds.length).toBeGreaterThan(0)

      // Non-vacuous, and it is the assertion that catches a consumer which
      // zeroes the afternoon rather than merely re-scoring it: two nulls compare
      // equal, and a thrown non-null assertion is a worse error message than
      // this one.
      const withExit = detectWork(exited, NOW)
      expect(
        withExit,
        `the fixture stopped qualifying once every page was left '${exitType}' — something reads exitType`,
      ).not.toBeNull()

      expect(groundsFor(withExit!, threadPagesOf(exited, withExit!, NOW))).toEqual(without)
    })
  },
)

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
