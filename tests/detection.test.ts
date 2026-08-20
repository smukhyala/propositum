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
import type { AmbientObservation, Arrival, ExitType } from '../src/domain/detection/detect'
import { DEEP_READ_MS, READ_AROUND_MS, groundsFor } from '../src/domain/detection/grounds'
import { ambientObservationFields } from './support/ambient-fields'

const T0 = 1_000_000

function nav(
  at: number,
  url: string,
  origin = 'https://northwind.example.com',
): AmbientObservation {
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

function query(
  at: number,
  url: string,
  origin = 'https://northwind.example.com',
): AmbientObservation {
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
    {
      at: T0,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'navigation',
    },
    {
      at: T0 + 1,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'engagement',
      engagedMs: ENGAGED_MS_FOR_WORK / 2,
    },
    {
      at: T0 + 2,
      origin: 'https://b.example',
      url: 'https://b.example/1',
      title: 'World Models Explained',
      kind: 'navigation',
    },
    {
      at: T0 + 3,
      origin: 'https://b.example',
      url: 'https://b.example/1',
      title: 'World Models Explained',
      kind: 'engagement',
      engagedMs: ENGAGED_MS_FOR_WORK / 2,
    },
    {
      at: T0 + 4,
      origin: 'https://c.example',
      url: 'https://c.example/1',
      title: 'Training World Models',
      kind: 'navigation',
    },
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
      {
        at: T0,
        origin: 'https://www.google.com',
        url: 'https://www.google.com/search?q=world+models',
        title: 'world models - Google Search',
        kind: 'query',
      },
      {
        at: T0 + 1,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'navigation',
      },
      {
        at: T0 + 2,
        origin: 'https://b.example',
        url: 'https://b.example/1',
        title: 'World Models Explained',
        kind: 'navigation',
      },
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
      {
        at: T0 + 6,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'engagement',
        engagedMs: ENGAGED_MS_FOR_WORK / 2,
      },
      {
        at: T0 + 7,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'engagement',
        engagedMs: ENGAGED_MS_FOR_WORK / 2,
      },
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
    {
      at: T0 + 1,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'navigation',
    },
    {
      at: T0 + 2,
      origin: 'https://b.example',
      url: 'https://b.example/1',
      title: 'World Models Explained',
      kind: 'navigation',
    },
    // Enough reading that the thread clears the naming bar either way, so what
    // is being measured here is the search count and nothing else.
    {
      at: T0 + 3,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'engagement',
      engagedMs: ENGAGED_MS_FOR_WORK,
    },
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
    {
      at: T0,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'navigation',
    },
    {
      at: T0 + 1,
      origin: 'https://b.example',
      url: 'https://b.example/1',
      title: 'World Models Explained',
      kind: 'navigation',
    },
    {
      at: T0 + 2,
      origin: 'https://c.example',
      url: 'https://c.example/1',
      title: 'Training World Models',
      kind: 'navigation',
    },
    // Past the naming bar, so `detectWork` has something to report and the
    // arrival counts can be read off it.
    {
      at: T0 + 10,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'engagement',
      engagedMs: ENGAGED_MS_FOR_WORK,
    },
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
      {
        at: T0 + 3,
        origin: 'https://unrelated.example',
        url: 'https://unrelated.example/1',
        title: 'Lasagne',
        kind: 'navigation',
      },
    ])
    const found = detectWork(observations, T0 + 100)

    expect(threadPagesOf(observations, found!, T0 + 100).map((page) => page.url)).toEqual(
      found?.urls,
    )
  })

  it('a page seen once, then returned to, is two arrivals', () => {
    const observations = thread([
      {
        at: T0 + 3,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'navigation',
      },
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
      {
        at: T0 + 3,
        origin: 'https://c.example',
        url: 'https://c.example/1',
        title: 'Training World Models',
        kind: 'navigation',
      },
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
      {
        at: T0,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'navigation',
      },
      {
        at: T0 + 3,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'navigation',
      },
      {
        at: T0 + 1,
        origin: 'https://b.example',
        url: 'https://b.example/1',
        title: 'World Models Explained',
        kind: 'navigation',
      },
      {
        at: T0 + 2,
        origin: 'https://c.example',
        url: 'https://c.example/1',
        title: 'Training World Models',
        kind: 'navigation',
      },
      {
        at: T0 + 10,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'engagement',
        engagedMs: ENGAGED_MS_FOR_WORK,
      },
    ]

    expect(pageIn(observations, 'https://a.example/1')?.visits).toBe(2)
  })

  it('does not count engagement reports as arrivals', () => {
    // Engagement arrives every fifteen seconds while a page is open. If those
    // counted, every page read for a minute would look like a page returned to.
    const observations = thread([
      {
        at: T0 + 3,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'engagement',
        engagedMs: 30_000,
      },
      {
        at: T0 + 4,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'engagement',
        engagedMs: 60_000,
      },
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
  {
    at: T0,
    origin: 'https://www.google.com',
    url: 'https://www.google.com/search?q=world+models',
    title: 'world models - Google Search',
    kind: 'query',
  },
  {
    at: T0 + 1_000,
    origin: 'https://a.example',
    url: 'https://a.example/1',
    title: 'World Models Survey',
    kind: 'navigation',
  },
  {
    at: T0 + 2_000,
    origin: 'https://a.example',
    url: 'https://a.example/1',
    title: 'World Models Survey',
    kind: 'engagement',
    engagedMs: DEEP_READ_MS * 3,
  },
  {
    at: T0 + 3_000,
    origin: 'https://a.example',
    url: 'https://a.example/2',
    title: 'World Models Benchmarks',
    kind: 'navigation',
  },
  {
    at: T0 + 4_000,
    origin: 'https://a.example',
    url: 'https://a.example/2',
    title: 'World Models Benchmarks',
    kind: 'engagement',
    engagedMs: READ_AROUND_MS * 3,
  },
  {
    at: T0 + 5_000,
    origin: 'https://a.example',
    url: 'https://a.example/3',
    title: 'World Models Criticism',
    kind: 'navigation',
  },
  {
    at: T0 + 6_000,
    origin: 'https://a.example',
    url: 'https://a.example/3',
    title: 'World Models Criticism',
    kind: 'engagement',
    engagedMs: READ_AROUND_MS * 3,
  },
  {
    at: T0 + 7_000,
    origin: 'https://b.example',
    url: 'https://b.example/1',
    title: 'World Models Explained',
    kind: 'navigation',
  },
  {
    at: T0 + 8_000,
    origin: 'https://b.example',
    url: 'https://b.example/1',
    title: 'World Models Explained',
    kind: 'engagement',
    engagedMs: DEEP_READ_MS * 3,
  },
  {
    at: T0 + 9_000,
    origin: 'https://c.example',
    url: 'https://c.example/1',
    title: 'Training World Models',
    kind: 'navigation',
  },
  {
    at: T0 + 10_000,
    origin: 'https://c.example',
    url: 'https://c.example/1',
    title: 'Training World Models',
    kind: 'engagement',
    engagedMs: DEEP_READ_MS * 3,
  },
]

/**
 * ~~Scroll arrives, and nothing about the answer moves.~~ **It moves one thing
 * now, 2026-08-20, and this block says which.**
 *
 * `scrollFraction` landed on `AmbientObservation` on 2026-08-17 after being
 * computed by `content.js` and dropped on arrival for the whole build. Carrying
 * a signal and consulting it were two decisions and only the first had been
 * taken. [ADR-0018](../docs/adr/0018-the-everyday-shapes.md) takes the second.
 *
 * ~~What must be pinned is that a plumbing change moved no bar in either
 * direction.~~ **What must be pinned now is exactly WHICH afternoons moved**,
 * which is what ADR-0018 and the reachability pins both ask the change that
 * consumes these signals to say. The pairing with `tests/reachability.test.ts`
 * is unchanged in shape and reversed in content: that file asserted no reader
 * existed and now asserts one does; this one asserted the answer never changed
 * and now names the buffer where it does.
 *
 * ADR-0008 still names the false positive as the expensive failure, so the
 * assertions below are weighted the same way: the scroll fraction the old block
 * used — 0.05, *"they read the first screenful and stopped"* — still changes
 * nothing, because `grounds.ts` consumes scroll as a VETO in conjunction with
 * an exit type rather than as a floor of its own. The one thing that stops
 * counting is a page nobody ever scrolled that was switched away from, and that
 * is here too.
 */
describe('landing scroll changes one thing, and this is the thing', () => {
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
    expect(
      detected,
      'the fixture stopped qualifying — this test is comparing two nulls',
    ).not.toBeNull()
    return groundsFor(detected!, threadPagesOf(observations, detected!, NOW))
  }

  it('detects the same thread', () => {
    expect(detectWork(scrolled, NOW)).toEqual(detectWork(afternoon, NOW))
  })

  it('detects the same strands, in the same order', () => {
    expect(detectThreads(scrolled, NOW)).toEqual(detectThreads(afternoon, NOW))
  })

  it('carries the deepest scroll onto the page the grounds are computed from', () => {
    // The half that was missing until today: the field reached
    // `AmbientObservation` on 2026-08-17 and stopped there, so no rule could
    // have read it even if one wanted to.
    const detected = detectWork(scrolled, NOW)!
    const pages = threadPagesOf(scrolled, detected, NOW)

    // The pages with an engagement report behind them, which is where a scroll
    // fraction comes from — the search page has none and must not acquire one.
    const read = pages.filter((page) => page.engagedMs > 0)
    expect(read.length).toBeGreaterThan(0)
    expect(read.every((page) => page.scrollFraction === 0.05)).toBe(true)
    expect(
      pages.filter((page) => page.engagedMs === 0).every((p) => p.scrollFraction === undefined),
    ).toBe(true)
    // And absent stays absent, rather than defaulting to a number that would
    // make "nobody reported one" indistinguishable from "they scrolled nowhere".
    const bare = threadPagesOf(afternoon, detectWork(afternoon, NOW)!, NOW)
    expect(bare.every((page) => page.scrollFraction === undefined)).toBe(true)
  })

  it('still computes the same grounds at one screenful, because scroll is not a floor', () => {
    const without = groundsOf(afternoon)

    // 0.05 is *"they read the first screenful and stopped"*, the value the old
    // version of this block chose as the one a consumer would be tempted to
    // threshold on. Nothing thresholds on it: `content.js`'s own note says a
    // short page read fully scrolls nowhere, so a floor here would refuse a page
    // somebody read every word of. `read-around` is named explicitly because it
    // is the ground scroll is consulted by first.
    expect(without.kinds).toContain('read-around')
    expect(without.kinds.length).toBeGreaterThan(0)
    expect(groundsOf(scrolled)).toEqual(without)
  })

  it('stops calling a page a read when nothing was scrolled and the tab was switched away from', () => {
    /**
     * The afternoon that moved. Every page unscrolled AND left `'hidden'` — a
     * tab opened, never touched, and switched away from — which is the one
     * conjunction `heldOpenUnread` refuses. Neither field does this alone, and
     * the two tests above are what say so.
     *
     * This is the honest answer to *"which afternoons stopped qualifying"* for
     * scroll and exit type: this one, and nothing else in the corpus.
     */
    const parked: AmbientObservation[] = afternoon.map((o) =>
      o.kind === 'engagement' ? { ...o, scrollFraction: 0, exitType: 'hidden' as const } : o,
    )

    const before = groundsOf(afternoon)
    expect(before.sufficient).toBe(true)
    expect(before.kinds).toContain('read-deeply')
    expect(before.kinds).toContain('read-around')

    const detected = detectWork(parked, NOW)
    expect(
      detected,
      'the thread itself is unaffected — only what may be claimed about it',
    ).not.toBeNull()
    const after = groundsFor(detected!, threadPagesOf(parked, detected!, NOW))

    expect(after.kinds).not.toContain('read-deeply')
    expect(after.kinds).not.toContain('read-around')
    expect(after.sufficient).toBe(false)
  })

  it('finds the same stopping point', () => {
    const paused = [
      ...afternoon,
      {
        at: T0 + 10_000,
        origin: 'https://c.example',
        url: 'https://c.example/1',
        title: '',
        kind: 'away',
      } as const,
    ]
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
    expect(
      detected,
      'the fixture stopped qualifying — this test is comparing two nulls',
    ).not.toBeNull()
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
      {
        at: T0,
        origin: 'https://news.example',
        url: 'https://news.example/1',
        title: 'Election Results',
        kind: 'navigation',
        groupTitle: 'world models',
      },
      {
        at: T0 + 1_000,
        origin: 'https://news.example',
        url: 'https://news.example/1',
        title: 'Election Results',
        kind: 'engagement',
        engagedMs: DEEP_READ_MS * 9,
        groupTitle: 'world models',
      },
      {
        at: T0 + 2_000,
        origin: 'https://recipes.example',
        url: 'https://recipes.example/1',
        title: 'Lasagne',
        kind: 'navigation',
        groupTitle: 'world models',
      },
      {
        at: T0 + 3_000,
        origin: 'https://recipes.example',
        url: 'https://recipes.example/1',
        title: 'Lasagne',
        kind: 'engagement',
        engagedMs: DEEP_READ_MS * 9,
        groupTitle: 'world models',
      },
      {
        at: T0 + 4_000,
        origin: 'https://weather.example',
        url: 'https://weather.example/1',
        title: 'Forecast',
        kind: 'navigation',
        groupTitle: 'world models',
      },
      {
        at: T0 + 5_000,
        origin: 'https://weather.example',
        url: 'https://weather.example/1',
        title: 'Forecast',
        kind: 'engagement',
        engagedMs: DEEP_READ_MS * 9,
        groupTitle: 'world models',
      },
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
 * ~~The exit type arrives, and nothing at all moves. ADR-0013.~~ **It is
 * consulted as of 2026-08-20 and this block is what it does NOT move.**
 *
 * `AmbientObservation.exitType` argued the deferral at length and one half of
 * that argument survives ADR-0018 untouched: Fox et al.'s evidence turns on
 * separating a return from an onward navigation, and that distinction lives
 * INSIDE our `'left-unloaded'`, which a content script cannot split without
 * `tabs` or `webNavigation`. So the citation is still not borrowed. What is
 * consumed is the narrower thing the deferral itself called *"honestly
 * available now"* — the `'hidden'` versus `'left-*'` split — and only in
 * conjunction with a scroll fraction of zero.
 *
 * That is why every run below is still an equality: how a page was LEFT changes
 * nothing on its own, for any of the three values, on a fixture where people
 * scrolled. The block above holds the conjunction that does change something.
 * Keeping both is the point — a reader that started refusing on `'hidden'`
 * alone would take the commonest exit there is out of every ground at once, and
 * these three runs are what would say so.
 *
 * `tests/reachability.test.ts` is the structural pair, and it now asserts that a
 * reader EXISTS. The two still catch different mistakes.
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
  'how a page was left changes no detection outcome on its own (%s)',
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

    it('carries the exit onto every page, and changes none of the rest of one', () => {
      // The transport half, which is new — the field reached the store on
      // 2026-08-17 and `pagesOf` dropped it until today. Everything else about
      // the page has to be untouched, or the equalities below would be green
      // because two different things had both gone wrong.
      const detected = detectWork(afternoon, NOW)!
      const withExit = threadPagesOf(exited, detected, NOW)
      const bare = threadPagesOf(afternoon, detected, NOW)

      const read = withExit.filter((page) => page.engagedMs > 0)
      expect(read.length).toBeGreaterThan(0)
      expect(read.every((page) => page.exitType === exitType)).toBe(true)
      expect(bare.every((page) => page.exitType === undefined)).toBe(true)
      expect(withExit.map(({ exitType: _, ...rest }) => rest)).toEqual(bare)
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

/**
 * ~~The arrival classification lands, and nothing at all moves.~~ **It decides
 * `came-back` as of 2026-08-20 — ADR-0018, part 2 — and only for a page
 * somebody returned to.**
 *
 * The deferral's own objection is what shapes the consumption, so it is worth
 * restating rather than deleting. A `'no-referrer'` arrival reads as *the
 * person chose this* and is produced both by somebody typing an address AND by
 * a followed link whose page stripped its referrer, which newsletters and mail
 * clients do — so the value that looks most like intent is produced by the
 * exact afternoon `grounds.ts` exists to refuse, and by every omnibox search
 * besides. `arrival` is therefore **not** read as an intent ground of its own.
 * It is read only to answer a question that was already being asked and already
 * fired an intent ground: *they came back — from where?*
 *
 * That is why the runs below are still equalities on an afternoon with no
 * return in it. An arrival on a page seen once changes nothing at all, for any
 * of the five values, which is the property that would break first if somebody
 * keyed a ground on the value rather than on the return. The block after them
 * is the one with a return in it, and it is where the five values separate.
 */
/**
 * Every member of the enum, exhaustive by construction.
 *
 * The `Record<Arrival, …>` is what keeps this honest: a sixth member added to
 * `Arrival` fails `npm run typecheck` here rather than quietly going
 * unexercised. That is the correction `EVERY_EXIT_TYPE` above had to be given
 * after shipping with one value.
 */
const EVERY_ARRIVAL: Record<Arrival, true> = {
  'no-referrer': true,
  'same-origin': true,
  'cross-origin': true,
  reloaded: true,
  'back-or-forward': true,
}

describe.each(Object.keys(EVERY_ARRIVAL) as Arrival[])(
  'an arrival at a page seen once changes no detection outcome (%s)',
  (arrival) => {
    const NOW = T0 + 10 * 60_000

    /**
     * The same afternoon, differing only by how each page was reached.
     *
     * Applied to navigations and queries rather than engagements, because that
     * is where the field actually occurs — a navigation is an arrival and an
     * engagement report is not. Getting that wrong would make this block pass
     * over observations that never carry the value, which is the vacuous shape
     * the exit-type block had to be corrected out of.
     */
    const arrived: AmbientObservation[] = afternoon.map((o) =>
      o.kind === 'navigation' || o.kind === 'query' ? { ...o, arrival } : o,
    )

    it('detects the same strands, in the same order', () => {
      expect(detectThreads(arrived, NOW)).toEqual(detectThreads(afternoon, NOW))
    })

    it('builds the same pages, because a first arrival is not a return', () => {
      // `returnArrivals` collects the SECOND and later arrival at a URL. This
      // afternoon has no repeats, so the list is empty however the pages were
      // reached — which is the rule `returnArrivalsByUrl` states and this is
      // the fixture that would catch it collecting the first one.
      const detected = detectWork(afternoon, NOW)!
      expect(threadPagesOf(arrived, detected, NOW)).toEqual(threadPagesOf(afternoon, detected, NOW))
    })

    it('computes the same grounds, kinds sentences and sufficiency alike', () => {
      const detected = detectWork(afternoon, NOW)!
      const without = groundsFor(detected, threadPagesOf(afternoon, detected, NOW))

      expect(without.kinds.length).toBeGreaterThan(0)

      // Non-vacuous in the same way the exit-type block is: two nulls compare
      // equal, so a consumer that zeroes the afternoon rather than re-scoring it
      // would slip past a bare equality.
      const withArrival = detectWork(arrived, NOW)
      expect(
        withArrival,
        `the fixture stopped qualifying once every arrival was '${arrival}' — something reads arrival`,
      ).not.toBeNull()

      expect(groundsFor(withArrival!, threadPagesOf(arrived, withArrival!, NOW))).toEqual(without)
    })
  },
)

/**
 * The return, and the five ways of arriving at one. ADR-0018, part 2.
 *
 * ── Why this block exists beside the five equalities above ───────────────
 *
 * Those five say that an arrival at a page seen once decides nothing. These say
 * what an arrival at a page seen TWICE decides, which is the whole of what was
 * wired. `came-back` used to read a tally and nothing else, and Adar, Teevan &
 * Dumais's 612,000-user revisit study says that in the sub-hour band a
 * thirty-minute `WINDOW_MS` can see, 77.0% of revisits came from the same
 * domain — so the tally was measuring a click home from a spoke at least three
 * times as often as it was measuring intent.
 *
 * ── This is a bar change wearing a predicate's clothes, and the numbers ──
 *
 * `came-back` is one of three intent grounds and one is required, so refusing a
 * return refuses an offer outright when nothing else fired. Two of the five
 * values now refuse: `'same-origin'`, which is the 77%, and `'reloaded'`, which
 * is not a return at all. `grounds.ts`'s `RETURN_ARRIVALS` argues both, and this
 * is the table that fails if either list moves.
 */
describe('a return fires came-back only when it came from somewhere else', () => {
  const NOW = T0 + 10 * 60_000

  /** The qualifying afternoon, plus a return to its first page. The arrival is
   *  the only thing that varies. */
  const returning = (arrival: Arrival): AmbientObservation[] => [
    ...afternoon,
    {
      at: T0 + 11_000,
      origin: 'https://a.example',
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'navigation',
      arrival,
    },
  ]

  const groundsOf = (observations: readonly AmbientObservation[]) => {
    const detected = detectWork(observations, NOW)
    expect(
      detected,
      'the fixture stopped qualifying — this test is comparing two nulls',
    ).not.toBeNull()
    return groundsFor(detected!, threadPagesOf(observations, detected!, NOW))
  }

  it('counts the return itself either way, so the ground is what changed and not the tally', () => {
    // `visits` is unaffected by the narrowing, deliberately: the person did come
    // back, the buffer says so, and what changed is what may be CLAIMED about
    // it. A fix that stopped counting the visit would have been a different
    // change with the same test results.
    for (const arrival of Object.keys(EVERY_ARRIVAL) as Arrival[]) {
      const observations = returning(arrival)
      const detected = detectWork(observations, NOW)!
      const page = threadPagesOf(observations, detected, NOW).find(
        (p) => p.url === 'https://a.example/1',
      )

      expect(page?.visits, arrival).toBe(2)
      expect(page?.returnArrivals, arrival).toEqual([arrival])
    }
  })

  it('fires on cross-origin, no-referrer and back-or-forward', () => {
    for (const arrival of ['cross-origin', 'no-referrer', 'back-or-forward'] as const) {
      expect(groundsOf(returning(arrival)).kinds, arrival).toContain('came-back')
    }
  })

  it('does not fire on a click home from the same site, which is the 77%', () => {
    expect(groundsOf(returning('same-origin')).kinds).not.toContain('came-back')
  })

  it('does not fire on a reload, which is the same page and not a different origin', () => {
    // `visitsByUrl` already refuses two navigations in a row to one URL. This is
    // the other shape — a reload of a page they had been away from — and it is
    // refused here rather than relying on the two rules never disagreeing.
    expect(groundsOf(returning('reloaded')).kinds).not.toContain('came-back')
  })

  it('does not fire on a return nothing classified, which is the transport failing safe', () => {
    // An older sender, or a navigation the content script could not classify.
    // `came-back` under-fires, which is the direction ADR-0008 says to be wrong
    // in, and it is a second reason on top of the one `visitsByUrl` already had.
    const unclassified: AmbientObservation[] = [
      ...afternoon,
      {
        at: T0 + 11_000,
        origin: 'https://a.example',
        url: 'https://a.example/1',
        title: 'World Models Survey',
        kind: 'navigation',
      },
    ]

    const detected = detectWork(unclassified, NOW)!
    const page = threadPagesOf(unclassified, detected, NOW).find(
      (p) => p.url === 'https://a.example/1',
    )

    expect(page?.visits).toBe(2)
    expect(page?.returnArrivals).toBeUndefined()
    expect(groundsOf(unclassified).kinds).not.toContain('came-back')
  })
})

describe('the detector cannot see page text', () => {
  /**
   * REWRITTEN 2026-08-18. This was the precedent two other structural tests
   * were built on, and it did not hold.
   *
   * ~~The body built an `AmbientObservation` literal and asserted `Object.keys`
   * of the literal it had just built.~~ That fails only if somebody edits this
   * test. `tests/ambient-store.test.ts` copied the shape, and the copy was
   * caught in review; this is the original. Proved inert the same way: an
   * optional field added to `AmbientObservation` left the whole suite green.
   *
   * Both halves now, for the reason `tests/support/ambient-fields.ts` gives —
   * the source read fires under `vitest`, the type-level one under
   * `npm run typecheck`, and neither command alone holds the promise.
   */
  it('declares exactly the fields it is supposed to, and no more', () => {
    // The complete list, not a subset: a subset check passes on the field it
    // was not told to look for, which is how a metadata-only record grows one.
    expect(ambientObservationFields()).toEqual([
      'arrival',
      'at',
      'engagedMs',
      'exitType',
      'groupTitle',
      'kind',
      'origin',
      'scrollFraction',
      'title',
      'url',
    ])
  })

  it('cannot be given a field that could carry page text without failing to compile', () => {
    // The names a future field would plausibly have. Not exhaustive and cannot
    // be — the list above is what makes this closed, and this is what makes the
    // likely mistake loud. Ambient capture is metadata only; the 2,000-character
    // excerpt begins only after a session starts.
    const noPageText: [
      Extract<keyof AmbientObservation, 'text' | 'excerpt' | 'selection' | 'body' | 'html'>,
    ] extends [never]
      ? true
      : never = true

    expect(noPageText).toBe(true)
  })
})
