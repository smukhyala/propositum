/**
 * When has Propositum seen enough to offer to DO something?
 *
 * The code under test is pure arithmetic, so these tables ARE the end-to-end
 * evidence — there is no clock, no I/O and no model between an input and an
 * answer, and nothing about running the real server would exercise a path this
 * file cannot.
 *
 * Weighted the same way `detection.test.ts` is, and for a stronger reason. A
 * missed offer costs a suggestion nobody sees. A false one asks somebody to
 * read and ratify a proposal about work they were not doing, and ADR-0008 names
 * that as the expensive failure. So the case that matters most here is the last
 * describe block: an afternoon of ordinary reading that must NOT qualify.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  BREADTH_AXIS,
  DEEP_READ_MS,
  INTENT_GROUNDS,
  INTENT_REQUIRED,
  INVESTMENT_GROUNDS,
  INVESTMENT_REQUIRED,
  ORIGINS_FOR_OFFER,
  PAGES_ON_ONE_ORIGIN,
  READ_AROUND_MS,
  SUSTAINED_MS,
  groundsFor,
} from '../src/domain/detection/grounds'
import type { GroundKind } from '../src/domain/detection/grounds'
import {
  ORIGINS_FOR_THREAD,
  PAGES_FOR_THREAD,
  searchQueryOf,
  termsOf,
} from '../src/domain/detection/topics'
import type { ThreadPage } from '../src/domain/detection/topics'
import { WINDOW_MS } from '../src/domain/detection/detect'
import type { WorkDetected } from '../src/domain/detection/detect'
// The capture layer's definition of where a glance stops. `grounds.ts` does not
// import it — see `READ_AROUND_MS` — so the test is where the two are held
// against each other.
import { ENGAGEMENT_DWELL_MS } from '../src/capture/semantics'

const T0 = 1_786_471_000_000
const MINUTE = 60_000

function page(o: {
  url: string
  origin?: string
  title?: string
  engagedMs?: number
  at?: number
  visits?: number
  /** Only ever set to prove the domain ignores it. `pagesOf` derives it. */
  searched?: boolean
}): ThreadPage {
  const title = o.title ?? ''
  return {
    url: o.url,
    origin: o.origin ?? new URL(o.url).origin,
    title,
    terms: termsOf(title, o.url),
    engagedMs: o.engagedMs ?? 0,
    at: o.at ?? T0,
    searched: o.searched ?? searchQueryOf(o.url) !== null,
    visits: o.visits ?? 1,
  }
}

/** Only `terms` is read, but a half-built WorkDetected in a fixture is how a
 *  test stops noticing that the shape changed. */
function detected(terms: string[], pages: readonly ThreadPage[]): WorkDetected {
  return {
    terms,
    // Grounds never reads a label — nothing here is shown to anybody — but the
    // shape is filled honestly rather than cast, which is what caught this
    // field arriving in the first place.
    labels: terms,
    origins: [...new Set(pages.map((p) => p.origin))],
    pages: pages.length,
    searches: pages.filter((p) => p.searched).length,
    engagedMs: pages.reduce((total, p) => total + p.engagedMs, 0),
    since: Math.min(...pages.map((p) => p.at)),
    focus: pages[0]?.title ?? null,
    titles: pages.map((p) => p.title).filter((t) => t !== ''),
    urls: pages.map((p) => p.url),
    because: 'followed-across-sites',
  }
}

/** The subject every fixture below is about. */
const SUBJECT = ['world', 'models', 'survey']

function grounds(pages: readonly ThreadPage[]): readonly GroundKind[] {
  return groundsFor(detected(SUBJECT, pages), pages).kinds
}

const SEARCH = 'https://www.google.com/search?q=world+models'
const SEARCH_AGAIN = 'https://www.google.com/search?q=world+models+training'

describe('the thresholds themselves', () => {
  /**
   * Every other test in this file is written AGAINST the constants, which is
   * the right way to test the rules and no way at all to test the numbers. The
   * whole file stayed green through two real sessions that `DEEP_READ_MS`
   * refused; a boundary test that reads `DEEP_READ_MS - 1` cannot notice that
   * `DEEP_READ_MS` is wrong. These are the expectations that fail when
   * somebody moves one, so the number has to be moved on purpose.
   */

  it('calls a minute on one page a read', () => {
    // ~~Ninety seconds.~~ Sixty, as of 2026-08-16: run 2's deepest page was a
    // sixty-second read of an arXiv paper, and ninety was the only thing
    // between eleven minutes of real research and an offer.
    expect(DEEP_READ_MS).toBe(60_000)
  })

  it('calls fifteen minutes on a subject sustained', () => {
    // ~~Fifteen minutes.~~ ~~Eight, as of 2026-08-16.~~ Fifteen again, later
    // the same day. Eight had no session behind it — `DEEP_READ_MS` released
    // run 2 on its own — and it admitted the newsletter afternoon pinned in
    // `the false positive that must not qualify` below. `SUSTAINED_MS` is the
    // cheapest investment ground to produce by accident, because it costs a
    // person nothing but time passing.
    expect(SUSTAINED_MS).toBe(15 * MINUTE)

    // Half the window, pinned deliberately rather than noticed again. It is a
    // real complaint about this rule — a thread has to span half the life of
    // the buffer it is measured inside — and the fix is a longer window or a
    // different ground, not a smaller number underneath the same window.
    expect(SUSTAINED_MS * 2).toBe(WINDOW_MS)
  })

  it('still wants a third origin, because two is only what the thread needed', () => {
    // Unchanged. Not calibration — double-counting: two origins is the thread's
    // own entry condition, so two here would report it back as evidence.
    expect(ORIGINS_FOR_OFFER).toBe(3)
    expect(ORIGINS_FOR_OFFER).toBeGreaterThan(ORIGINS_FOR_THREAD)
  })

  it('wants three pages on one site before depth on it counts', () => {
    // Added 2026-08-17 with `read-around`. Two is a landing page and the thing
    // you came for; three is the smallest number that is a pattern rather than
    // a click.
    expect(PAGES_ON_ONE_ORIGIN).toBe(3)

    // The same number as `PAGES_FOR_THREAD` and not derived from it — that one
    // counts a thread's pages anywhere, this one counts them on one host. They
    // agree today, and this pins the agreement so that a future reader moving
    // either one is told the other exists rather than discovering it.
    expect(PAGES_ON_ONE_ORIGIN).toBe(PAGES_FOR_THREAD)
  })

  it('wants twenty seconds on a page before it counts as one of them', () => {
    // Added 2026-08-17, after the ground shipped with `engagedMs > 0` — which on
    // the ambient path means "was visible", not "was read". Three seconds a tab
    // cleared it and produced a sentence claiming somebody read three pages.
    expect(READ_AROUND_MS).toBe(20_000)

    // The same number as `ENGAGEMENT_DWELL_MS`, which is the product's existing
    // sentence about where a glance stops. Not imported — that one decides what
    // capture writes down, this one decides what an offer may claim — so this
    // pins the agreement rather than the dependency, and a future reader moving
    // either is told the other exists.
    expect(READ_AROUND_MS).toBe(ENGAGEMENT_DWELL_MS)
  })

  it('treats breadth across sites and depth on one site as one axis', () => {
    // Both are members of the investment group and both still fire and still
    // say their sentence. They count once between them, because a thread across
    // three origins usually has three pages on one of them and past seven pages
    // must — so counting both is counting one afternoon of clicking twice.
    expect([...BREADTH_AXIS]).toEqual(['followed-across', 'read-around'])
    for (const kind of BREADTH_AXIS) {
      expect(INVESTMENT_GROUNDS as readonly GroundKind[]).toContain(kind)
    }
  })

  it('still wants one intent ground and two investment grounds', () => {
    // Unchanged, and deliberately. Lowering `INVESTMENT_REQUIRED` to 1 would
    // also have released run 2, and would additionally have admitted the
    // newsletter afternoon in the last describe block below.
    expect(INTENT_REQUIRED).toBe(1)
    expect(INVESTMENT_REQUIRED).toBe(2)
  })
})

describe('intent — did they pursue this, or receive it', () => {
  describe('searched-then-read', () => {
    it('fires on a query followed by two pages of the thread', () => {
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE, engagedMs: 30_000 }),
        page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + 2 * MINUTE, engagedMs: 30_000 }),
      ]

      expect(grounds(pages)).toContain('searched-then-read')
    })

    it('does not fire on a query followed by one page', () => {
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE, engagedMs: 30_000 }),
      ]

      expect(grounds(pages)).not.toContain('searched-then-read')
    })

    it('does not fire on a burst of tabs opened from the results and never read', () => {
      // Middle-clicking five results and closing them all is the commonest way
      // to produce pages that were never read. Counting them would let the
      // intent half of the rule be satisfied by an act of opening tabs.
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + 1 }),
        page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + 2 }),
        page({ url: 'https://c.example/1', title: 'Training World Models', at: T0 + 3 }),
      ]

      expect(grounds(pages)).not.toContain('searched-then-read')
    })

    it('does not fire when the reading all happened BEFORE the search', () => {
      // Searching after reading is looking for what you already had. The ground
      // is about a query that was followed, and nothing followed this one.
      const pages = [
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 }),
        page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + MINUTE }),
        page({ url: SEARCH, at: T0 + 2 * MINUTE }),
      ]

      expect(grounds(pages)).not.toContain('searched-then-read')
    })

    it('does not fire when a second search is the only thing after the first', () => {
      // Two searches and nothing read is a search going badly, which is the
      // worst possible moment to interrupt somebody.
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: SEARCH_AGAIN, at: T0 + MINUTE }),
      ]

      expect(grounds(pages)).not.toContain('searched-then-read')
    })
  })

  describe('refined-the-search', () => {
    it('fires on two distinct queries sharing the thread terms', () => {
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: SEARCH_AGAIN, at: T0 + MINUTE }),
      ]

      expect(grounds(pages)).toContain('refined-the-search')
    })

    it('does not fire when the same query was run twice', () => {
      // A reload, a back button, a duplicated tab. Not a refinement.
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: `${SEARCH}&start=10`, at: T0 + MINUTE }),
      ]

      expect(grounds(pages)).not.toContain('refined-the-search')
    })

    it('does not fire on a second query about something else', () => {
      // Lunch, in the middle of an afternoon of research. The page joined the
      // thread on an incidental word; the query was not about the subject.
      const pages = [
        page({ url: SEARCH, at: T0 }),
        page({ url: 'https://www.google.com/search?q=lunch+nearby', at: T0 + MINUTE }),
      ]

      expect(grounds(pages)).not.toContain('refined-the-search')
    })
  })

  describe('came-back', () => {
    it('fires when a page of the thread was returned to', () => {
      const pages = [
        page({ url: 'https://a.example/1', title: 'World Models Survey', visits: 2 }),
        page({ url: 'https://b.example/1', title: 'World Models Explained' }),
      ]

      expect(grounds(pages)).toContain('came-back')
    })

    it('does not fire when every page was seen once on the way through', () => {
      const pages = [
        page({ url: 'https://a.example/1', title: 'World Models Survey' }),
        page({ url: 'https://b.example/1', title: 'World Models Explained' }),
      ]

      expect(grounds(pages)).not.toContain('came-back')
    })
  })

  describe('the extension does not get a vote on what a search is', () => {
    it('ignores `searched` on a URL that is not search-shaped', () => {
      // The service worker marks `kind: 'query'` on ANY url with a `?`, so this
      // is what a checkout page and a paginated listing arrive looking like.
      // If the domain trusted that flag, the "at least one intent ground" half
      // of the sufficiency rule would be satisfiable by a question mark.
      const pages = [
        page({ url: 'https://shop.example.com/checkout?step=2', searched: true, at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE }),
        page({ url: 'https://b.example/1', title: 'World Models', at: T0 + 2 * MINUTE }),
        page({ url: 'https://c.example/1', title: 'World Models Training', at: T0 + 3 * MINUTE }),
      ]

      for (const kind of INTENT_GROUNDS) expect(grounds(pages)).not.toContain(kind)
    })

    it('ignores a search parameter on a page that is not a search', () => {
      // `?q=` on an article path is a highlight or an on-page filter, and some
      // sites append the referring query to it — which is how a page carries
      // the subject in a search parameter without anybody having searched on
      // it. The parameter name alone cannot carry this rule; the path has to
      // name searching too.
      const pages = [
        page({ url: 'https://docs.example/guide/setup?q=world+models', title: 'Setup', at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE }),
        page({ url: 'https://b.example/1', title: 'World Models', at: T0 + 2 * MINUTE }),
      ]

      expect(grounds(pages)).not.toContain('searched-then-read')
    })

    it('still recognises a real search the extension never labelled', () => {
      const pages = [
        page({ url: SEARCH, searched: false, at: T0 }),
        page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE, engagedMs: 30_000 }),
        page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + 2 * MINUTE, engagedMs: 30_000 }),
      ]

      expect(grounds(pages)).toContain('searched-then-read')
    })
  })
})

describe('investment — was enough spent to be worth an offer', () => {
  describe('read-deeply', () => {
    it('fires on one page held past the threshold', () => {
      expect(grounds([page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS })])).toContain(
        'read-deeply',
      )
    })

    it('does not fire a moment short of it', () => {
      expect(grounds([page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS - 1 })])).not.toContain(
        'read-deeply',
      )
    })

    it('does not add up short reads across pages', () => {
      // Depth on ONE page is the fact. Four skims are not one read, and summing
      // them would make `read-deeply` a second, weaker copy of `stayed-with-it`.
      const pages = Array.from({ length: 4 }, (_, i) =>
        page({ url: `https://a.example/${i}`, engagedMs: DEEP_READ_MS / 2 }),
      )

      expect(grounds(pages)).not.toContain('read-deeply')
    })
  })

  describe('stayed-with-it', () => {
    it('fires when the thread spans the threshold', () => {
      const pages = [
        page({ url: 'https://a.example/1', at: T0 }),
        page({ url: 'https://b.example/1', at: T0 + SUSTAINED_MS }),
      ]

      expect(grounds(pages)).toContain('stayed-with-it')
    })

    it('does not fire a moment short of it', () => {
      const pages = [
        page({ url: 'https://a.example/1', at: T0 }),
        page({ url: 'https://b.example/1', at: T0 + SUSTAINED_MS - 1 }),
      ]

      expect(grounds(pages)).not.toContain('stayed-with-it')
    })
  })

  describe('followed-across', () => {
    it('fires on three origins', () => {
      const pages = Array.from({ length: ORIGINS_FOR_OFFER }, (_, i) =>
        page({ url: `https://s${i}.example/1` }),
      )

      expect(grounds(pages)).toContain('followed-across')
    })

    it('does not fire on the two a thread already needed', () => {
      // Two origins is the bar `findThreads` already applied, so counting it
      // again here would be reporting the same fact twice and calling the
      // second one evidence.
      const pages = [page({ url: 'https://a.example/1' }), page({ url: 'https://b.example/1' })]

      expect(grounds(pages)).not.toContain('followed-across')
    })

    it('counts origins, not pages', () => {
      const pages = Array.from({ length: 9 }, (_, i) => page({ url: `https://a.example/${i}` }))

      expect(grounds(pages)).not.toContain('followed-across')
    })
  })

  describe('read-around', () => {
    /**
     * Added 2026-08-17. Breadth across sites was rewarded and depth on one site
     * counted for nothing: six arXiv abstracts on one subject earned no
     * investment ground at all unless a page happened to clear `DEEP_READ_MS`,
     * while three glances at three sites earned `followed-across` outright.
     */
    const around = (n: number, engagedMs: number) =>
      Array.from({ length: n }, (_, i) =>
        page({ url: `https://arxiv.org/abs/250${i}`, title: `World Models ${i}`, engagedMs, at: T0 + i * MINUTE }),
      )

    it('fires on three engaged pages of one site', () => {
      expect(grounds(around(PAGES_ON_ONE_ORIGIN, 40_000))).toContain('read-around')
    })

    it('does not fire on two', () => {
      expect(grounds(around(PAGES_ON_ONE_ORIGIN - 1, 40_000))).not.toContain('read-around')
    })

    it('does not fire on three pages nobody engaged with', () => {
      // The same accident `pursuitOf` excludes from `searched-then-read`: tabs
      // opened from a result page and closed unread. The sentence this ground
      // produces says somebody READ three pages, and it had better be true.
      expect(grounds(around(PAGES_ON_ONE_ORIGIN, 0))).not.toContain('read-around')
    })

    it('does not fire on three pages open for three seconds each', () => {
      /**
       * The version of the case above that actually happens, and the one the
       * ground shipped admitting on 2026-08-17.
       *
       * `engagedMs > 0` was borrowed from `pursuitOf` and means "was visible" on
       * a path with no upstream dwell floor: `ENGAGEMENT_DWELL_MS` gates the
       * ledger, the ambient route takes any nonnegative integer, and
       * `extension/src/content.js` reports cumulative dwell on `pagehide`. So
       * four tabs middle-clicked from a results page and closed produced *"You
       * read 3 pages on arxiv.org."* — three seconds apiece.
       */
      expect(grounds(around(PAGES_ON_ONE_ORIGIN, 3_000))).not.toContain('read-around')
    })

    it('fires exactly at the floor and not a moment short of it', () => {
      expect(grounds(around(PAGES_ON_ONE_ORIGIN, READ_AROUND_MS))).toContain('read-around')
      expect(grounds(around(PAGES_ON_ONE_ORIGIN, READ_AROUND_MS - 1))).not.toContain('read-around')
    })

    it('counts only the pages that cleared the floor', () => {
      // Six pages of one site, three of them glanced at. The sentence must say
      // three, because three is how many were read.
      const mixed = [
        ...around(PAGES_ON_ONE_ORIGIN, 40_000),
        ...Array.from({ length: 3 }, (_, i) =>
          page({ url: `https://arxiv.org/abs/glance${i}`, title: 'World Models', engagedMs: 4_000 }),
        ),
      ]

      const result = groundsFor(detected(SUBJECT, mixed), mixed)
      expect(result.sentences).toContain('You read 3 pages on arxiv.org.')
    })

    it('does not fire on three pages spread across three sites', () => {
      // The distinguishing case. Three pages on three hosts is `followed-across`
      // and nothing else; if one fixture could fire both, the two grounds would
      // be one fact counted twice and `INVESTMENT_REQUIRED` would be satisfiable
      // by a single afternoon of clicking.
      const spread = Array.from({ length: PAGES_ON_ONE_ORIGIN }, (_, i) =>
        page({ url: `https://s${i}.example/1`, title: 'World Models', engagedMs: 40_000 }),
      )

      expect(grounds(spread)).toContain('followed-across')
      expect(grounds(spread)).not.toContain('read-around')
    })

    it('DOES fire alongside followed-across, which is the case above the test could not see', () => {
      /**
       * The sentence in the test above — *"if one fixture could fire both, the
       * two grounds would be one fact counted twice"* — was a standard the code
       * did not meet, and the fixture proving it could not notice: three pages
       * on three hosts cannot fire both BY CONSTRUCTION. The common case can.
       * A thread spanning three origins usually has three pages on one of them,
       * and past seven pages over three origins it must, by pigeonhole.
       *
       * So the grounds do co-fire, they are one fact, and `BREADTH_AXIS` is
       * where the arithmetic stops counting it twice. Both are still SAID.
       */
      const overlapping = [
        ...Array.from({ length: PAGES_ON_ONE_ORIGIN }, (_, i) =>
          page({ url: `https://arxiv.org/abs/250${i}`, title: 'World Models', engagedMs: 40_000, at: T0 + i * MINUTE }),
        ),
        page({ url: 'https://openreview.net/forum', title: 'World Models', engagedMs: 40_000, at: T0 + 4 * MINUTE }),
        page({ url: 'https://github.com/x/world-models', title: 'World Models', engagedMs: 40_000, at: T0 + 5 * MINUTE }),
      ]

      expect(grounds(overlapping)).toContain('followed-across')
      expect(grounds(overlapping)).toContain('read-around')
    })

    it('does not fire on three engaged search result pages', () => {
      // Three result pages on google.com are not reading around a site. They are
      // the refinement `refined-the-search` already notices, and counting them
      // here would let one act of intent pay for an investment ground too.
      const searching = [
        page({ url: SEARCH, engagedMs: 40_000, at: T0 }),
        page({ url: SEARCH_AGAIN, engagedMs: 40_000, at: T0 + MINUTE }),
        page({ url: 'https://www.google.com/search?q=world+models+survey', engagedMs: 40_000, at: T0 + 2 * MINUTE }),
      ]

      expect(grounds(searching)).toContain('refined-the-search')
      expect(grounds(searching)).not.toContain('read-around')
    })

    it('counts distinct pages, not reports of the same one', () => {
      // `pagesOf` collapses a buffer to one page per URL, but `groundsFor` is
      // exported and counts what it is handed.
      const repeated = Array.from({ length: 5 }, () =>
        page({ url: 'https://arxiv.org/abs/2501', title: 'World Models', engagedMs: 40_000 }),
      )

      expect(grounds(repeated)).not.toContain('read-around')
    })

    it('names the site, and how many pages of it', () => {
      const read = around(PAGES_ON_ONE_ORIGIN, 40_000)
      const result = groundsFor(detected(SUBJECT, read), read)

      expect(result.sentences).toContain('You read 3 pages on arxiv.org.')
    })
  })
})

describe('sufficiency — one of these AND two of those', () => {
  /**
   * Three origins, deep reading, a long span, and three pages of one of those
   * origins. No query, nothing returned to.
   *
   * The last two pages were added 2026-08-17, when `read-around` joined
   * `INVESTMENT_GROUNDS` and this fixture stopped being able to fire every
   * member of the group it iterates. A real fixture rather than a loosened
   * assertion: what this test is for is that the RULE refuses, not a shortage
   * of evidence, and that only means something while the evidence is complete.
   */
  const investmentOnly = [
    page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS * 2, at: T0 }),
    page({ url: 'https://b.example/1', engagedMs: DEEP_READ_MS, at: T0 + SUSTAINED_MS / 2 }),
    page({ url: 'https://c.example/1', engagedMs: DEEP_READ_MS, at: T0 + SUSTAINED_MS }),
    page({ url: 'https://a.example/2', engagedMs: 40_000, at: T0 + MINUTE }),
    page({ url: 'https://a.example/3', engagedMs: 40_000, at: T0 + 2 * MINUTE }),
  ]

  it('every investment ground and no intent is not enough', () => {
    const result = groundsFor(detected(SUBJECT, investmentOnly), investmentOnly)

    // Every investment ground fires. The rule is what refuses, not a shortage
    // of evidence — which is the whole argument against a flat k-of-n counter.
    for (const kind of INVESTMENT_GROUNDS) expect(result.kinds).toContain(kind)
    expect(result.sufficient).toBe(false)
  })

  it('one intent ground and one investment ground is not enough', () => {
    const pages = [
      page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS, visits: 2, at: T0 }),
      page({ url: 'https://b.example/1', at: T0 + MINUTE }),
    ]

    const result = groundsFor(detected(SUBJECT, pages), pages)

    expect(result.kinds).toContain('came-back')
    expect(result.kinds).toContain('read-deeply')
    expect(result.kinds).toHaveLength(2)
    expect(result.sufficient).toBe(false)
  })

  it('one intent ground and two investment grounds is enough', () => {
    const pages = [
      page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS, visits: 2, at: T0 }),
      page({ url: 'https://b.example/1', at: T0 + MINUTE }),
      page({ url: 'https://c.example/1', at: T0 + 2 * MINUTE }),
    ]

    const result = groundsFor(detected(SUBJECT, pages), pages)

    expect(result.kinds).toEqual(['came-back', 'read-deeply', 'followed-across'])
    expect(result.sufficient).toBe(true)
  })

  it('three intent grounds and one investment ground is not enough', () => {
    // Searched, refined, and came back — inside two minutes, having read almost
    // nothing. That is what a search going badly looks like.
    const pages = [
      page({ url: SEARCH, at: T0, visits: 2 }),
      page({ url: SEARCH_AGAIN, at: T0 + MINUTE }),
      page({ url: 'https://a.example/1', title: 'World Models Survey', at: T0 + MINUTE + 1, engagedMs: 25_000 }),
      page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + MINUTE + 2, engagedMs: 25_000 }),
    ]

    const result = groundsFor(detected(SUBJECT, pages), pages)

    for (const kind of INTENT_GROUNDS) expect(result.kinds).toContain(kind)
    expect(result.kinds).toContain('followed-across')
    expect(result.sufficient).toBe(false)
  })

  it('breadth and depth-on-one-site together are not two grounds', () => {
    /**
     * The pair that shipped sufficient on 2026-08-17 and must not be.
     *
     * One search, four tabs opened from the results and closed after thirty
     * seconds each — three on arxiv.org, one on openreview.net. A hundred-second
     * span, no page held for a minute. It fires `searched-then-read`,
     * `followed-across` and `read-around`, and there is **no duration evidence
     * of any kind** behind it: nothing read, nothing sustained. Two of those
     * three grounds are the two ends of one axis, and the version that counted
     * them separately offered this work.
     *
     * Thirty seconds a page rather than three, deliberately: `READ_AROUND_MS`
     * must not be what refuses this, or the test would pass for the wrong
     * reason and stop failing the day the floor moved.
     */
    const glance = [
      page({ url: SEARCH, at: T0 }),
      page({ url: 'https://arxiv.org/abs/2501.1', title: 'World Models Survey', engagedMs: 30_000, at: T0 + 10_000 }),
      page({ url: 'https://arxiv.org/abs/2501.2', title: 'World Models Control', engagedMs: 30_000, at: T0 + 20_000 }),
      page({ url: 'https://arxiv.org/abs/2501.3', title: 'World Models Scaling', engagedMs: 30_000, at: T0 + 30_000 }),
      page({ url: 'https://openreview.net/forum', title: 'World Models Review', engagedMs: 30_000, at: T0 + 100_000 }),
    ]

    const result = groundsFor(detected(SUBJECT, glance), glance)

    expect(result.kinds).toContain('searched-then-read')
    for (const kind of BREADTH_AXIS) expect(result.kinds).toContain(kind)
    expect(result.kinds).not.toContain('read-deeply')
    expect(result.kinds).not.toContain('stayed-with-it')
    expect(result.sufficient).toBe(false)
  })

  it('breadth plus one ground that is not on that axis is enough', () => {
    // The other half of the rule, so the fold is not mistaken for a ban. The
    // same five pages with one of them held past `DEEP_READ_MS` is offered:
    // breadth counts once, and the read is a different accident.
    const withARead = [
      page({ url: SEARCH, at: T0 }),
      page({ url: 'https://arxiv.org/abs/2501.1', title: 'World Models Survey', engagedMs: DEEP_READ_MS, at: T0 + 10_000 }),
      page({ url: 'https://arxiv.org/abs/2501.2', title: 'World Models Control', engagedMs: 30_000, at: T0 + 20_000 }),
      page({ url: 'https://arxiv.org/abs/2501.3', title: 'World Models Scaling', engagedMs: 30_000, at: T0 + 30_000 }),
      page({ url: 'https://openreview.net/forum', title: 'World Models Review', engagedMs: 30_000, at: T0 + 100_000 }),
    ]

    const result = groundsFor(detected(SUBJECT, withARead), withARead)

    for (const kind of BREADTH_AXIS) expect(result.kinds).toContain(kind)
    expect(result.kinds).toContain('read-deeply')
    expect(result.sufficient).toBe(true)
  })

  it('nothing at all is not enough, and says so without throwing', () => {
    const result = groundsFor(detected([], []), [])

    expect(result.kinds).toEqual([])
    expect(result.sentences).toEqual([])
    expect(result.sufficient).toBe(false)
  })
})

describe('the real session that was refused, 2026-08-16', () => {
  /**
   * Run 2, as it happened. Four queries on one subject, an arXiv paper, a
   * Science Robotics article and a GitHub project across four origins over
   * about eleven minutes, with sixty seconds on the deepest page.
   *
   * It fired `searched-then-read`, `refined-the-search`, `came-back` and
   * `followed-across` — three intent grounds and ONE investment ground — so
   * `sufficient` stayed false and nothing was offered. `DEEP_READ_MS` at ninety
   * seconds against a sixty-second read was the single thing in the way.
   */
  const SUBJECT_2 = ['perturbation', 'robotic']

  const ARXIV = 'https://arxiv.org/abs/2501.09876'
  const SCIENCE = 'https://www.science.org/doi/10.1126/scirobotics.perturbation'
  const GITHUB = 'https://github.com/example/perturbation-sim'

  const query = (q: string, at: number) =>
    page({ url: `https://www.google.com/search?q=${q}`, at })

  const run2 = [
    query('what+is+perturbation+in+robotics', T0),
    page({
      url: ARXIV,
      title: 'Perturbation-Aware Robotics Navigation',
      at: T0 + MINUTE,
      // The read that was called a skim.
      engagedMs: 60_000,
      visits: 2,
    }),
    query('perturbation+robotics+definition', T0 + 3 * MINUTE),
    page({
      url: SCIENCE,
      title: 'Robustness to Perturbation in Legged Robotics',
      at: T0 + 4 * MINUTE,
      engagedMs: 45_000,
    }),
    query('perturbation+theory+robotics+control', T0 + 7 * MINUTE),
    page({
      url: GITHUB,
      title: 'Perturbation Simulation for Robotics',
      at: T0 + 8 * MINUTE,
      engagedMs: 30_000,
    }),
    query('how+to+model+perturbation+robotics', T0 + 11 * MINUTE),
  ]

  const result = groundsFor(detected(SUBJECT_2, run2), run2)

  it('had every intent ground it could have', () => {
    for (const kind of INTENT_GROUNDS) expect(result.kinds).toContain(kind)
  })

  it('calls the sixty-second page a read', () => {
    // This is the whole diff. At ninety seconds it did not fire, and it was the
    // only ground between this session and an offer.
    expect(result.kinds).toContain('read-deeply')
  })

  it('does not call eleven minutes sustained, and does not need to', () => {
    // ~~At fifteen minutes it did not fire either — fifteen being half the life
    // of the buffer this span is measured inside.~~ That sentence was used to
    // justify lowering `SUSTAINED_MS` to eight in the same diff, and it does
    // not support the change: run 2 was released by `DEEP_READ_MS` alone, and
    // eight minutes admitted the skimmed afternoon pinned above. `SUSTAINED_MS`
    // went back to fifteen, so this ground stays unfired here — and the session
    // is still offered on the two grounds it really earned.
    expect(result.kinds).not.toContain('stayed-with-it')
    expect(result.kinds).toContain('read-deeply')
    expect(result.kinds).toContain('followed-across')
  })

  it('is offered', () => {
    expect(result.sufficient).toBe(true)
  })

  it('is still refused when the reading really was thin', () => {
    /**
     * The same navigation, compressed into three minutes with nothing held for
     * a minute: four queries, four origins, a page returned to, and no page
     * read. Three intent grounds and one investment ground.
     *
     * This is the case the counts exist for, and it is why the fix was a
     * duration and not `INVESTMENT_REQUIRED`. Lowering the count to one would
     * have released run 2 as well — and would have released this, which is what
     * a search going badly looks like.
     */
    const thin = [
      query('what+is+perturbation+in+robotics', T0),
      page({ url: ARXIV, title: 'Perturbation-Aware Robotics Navigation', at: T0 + 1000, engagedMs: 20_000, visits: 2 }),
      query('perturbation+robotics+definition', T0 + 2000),
      page({ url: SCIENCE, title: 'Robustness to Perturbation in Legged Robotics', at: T0 + 3000, engagedMs: 15_000 }),
      page({ url: GITHUB, title: 'Perturbation Simulation for Robotics', at: T0 + 4000, engagedMs: 10_000 }),
      query('perturbation+theory+robotics+control', T0 + 3 * MINUTE),
    ]

    const thinResult = groundsFor(detected(SUBJECT_2, thin), thin)

    for (const kind of INTENT_GROUNDS) expect(thinResult.kinds).toContain(kind)
    expect(thinResult.kinds).toContain('followed-across')
    expect(thinResult.kinds).not.toContain('read-deeply')
    expect(thinResult.kinds).not.toContain('stayed-with-it')
    expect(thinResult.sufficient).toBe(false)
  })
})

describe('the false positive that must not qualify', () => {
  /**
   * An afternoon of idle reading. Three sites, forty minutes, two of them read
   * properly — arrived at from a newsletter, one link at a time. Nothing was
   * searched for and nothing was returned to.
   *
   * This is ADR-0008's expensive failure written as a fixture: it interrupts
   * somebody reading the news and teaches them the feature is noise. Every
   * investment ground fires, and the offer must still not be made.
   */
  const afternoon = [
    page({
      url: 'https://news.example/long-read',
      title: 'The World After Models',
      engagedMs: 12 * MINUTE,
      at: T0,
    }),
    page({
      url: 'https://forum.example/thread/9',
      title: 'World Models, discussed',
      engagedMs: 9 * MINUTE,
      at: T0 + 14 * MINUTE,
    }),
    page({
      url: 'https://blog.example/posts/world-models',
      title: 'Notes on World Models',
      engagedMs: 6 * MINUTE,
      at: T0 + 30 * MINUTE,
    }),
  ]

  const result = groundsFor(detected(SUBJECT, afternoon), afternoon)

  it('is not sufficient', () => {
    expect(result.sufficient).toBe(false)
  })

  it('produces no intent ground at all', () => {
    for (const kind of INTENT_GROUNDS) expect(result.kinds).not.toContain(kind)
  })

  it('is refused despite every investment ground it can fire', () => {
    // ~~`toEqual([...INVESTMENT_GROUNDS])`.~~ **Amended 2026-08-17.**
    // `read-around` joined the group and this afternoon is one page per site,
    // so it cannot fire it — the members are named individually now, because
    // this fixture is a recorded shape and rewriting it to keep an assertion
    // convenient would be changing the evidence to fit the test. The version
    // that fires all four is the next fixture down.
    expect(result.kinds).toEqual(['read-deeply', 'stayed-with-it', 'followed-across'])
  })

  /**
   * The same afternoon, three articles deep on the site the newsletter linked
   * to — which is what an afternoon of newsletter reading actually looks like,
   * and which fires `read-around` as well.
   *
   * This is the fixture that keeps `[...INVESTMENT_GROUNDS]` honest: it must
   * fail the day a fifth ground is added and nothing here fires it, because a
   * group whose members are never all exercised together is a group nobody is
   * checking the sufficiency rule against.
   */
  const deeperAfternoon = [
    ...afternoon,
    page({
      url: 'https://news.example/opinion',
      title: 'Models, and the World They Describe',
      engagedMs: 3 * MINUTE,
      at: T0 + 20 * MINUTE,
    }),
    page({
      url: 'https://news.example/briefing',
      title: 'World Models, briefly',
      engagedMs: 2 * MINUTE,
      at: T0 + 24 * MINUTE,
    }),
  ]

  it('is refused with every one of the four investment grounds firing', () => {
    const deeper = groundsFor(detected(SUBJECT, deeperAfternoon), deeperAfternoon)

    expect(deeper.kinds).toEqual([...INVESTMENT_GROUNDS])
    for (const kind of INTENT_GROUNDS) expect(deeper.kinds).not.toContain(kind)
    expect(deeper.sufficient).toBe(false)
  })

  it('a single query would still not be enough on its own', () => {
    // Because a query that was not followed is not `searched-then-read`. The
    // bar is not "did a search happen", it is "did they pursue this".
    const withOneSearch = [...afternoon, page({ url: SEARCH, at: T0 + 40 * MINUTE })]

    expect(groundsFor(detected(SUBJECT, withOneSearch), withOneSearch).sufficient).toBe(false)
  })

  /**
   * The same afternoon with one click back, which is the version the fixture
   * above cannot catch.
   *
   * `afternoon` has no revisit at all, so it is refused by `INTENT_REQUIRED`
   * and every investment threshold could be wrong without this file noticing.
   * One return to one site is not much to ask of ordinary browsing — a tab
   * reopened, a link followed home — and it fires `came-back`, which satisfies
   * the intent half on its own. From there the whole bar is the investment
   * count, and the investment count is `SUSTAINED_MS`.
   *
   * Written after `SUSTAINED_MS` was lowered to eight minutes and this exact
   * shape was offered work: no search, no page held for a minute, twelve links
   * across three sites in nine.
   *
   * ~~Three pages, one per site.~~ **Twelve, as of 2026-08-17, which is the size
   * the paragraph above always said it was.** The small version was written
   * because three pages were enough to make the assertions it carried, and for a
   * day that was true. Then `read-around` shipped, and twelve pages over three
   * sites put four on some site by pigeonhole while three put one — so the real
   * afternoon was offered work and the fixture standing for it was not, and the
   * suite stayed green through the exact regression it exists to catch. A
   * fixture smaller than the session it records is not a smaller test, it is a
   * different one.
   */
  const SKIM_HOSTS = ['https://news.example', 'https://forum.example', 'https://blog.example']
  const skimmed = Array.from({ length: 12 }, (_, i) =>
    page({
      url: `${SKIM_HOSTS[i % 3]}/world-models-${i}`,
      title: 'World Models, discussed',
      engagedMs: 45_000,
      // Twelve links in nine minutes, and one of them reopened.
      at: T0 + i * 45_000,
      visits: i === 0 ? 2 : 1,
    }),
  )

  it('refuses a skimmed afternoon that happens to include one click back', () => {
    const result = groundsFor(detected(SUBJECT, skimmed), skimmed)

    // The intent half is satisfied — that is the point. The refusal has to
    // come from investment, and from `SUSTAINED_MS` in particular.
    expect(result.kinds).toContain('came-back')
    expect(result.kinds).toContain('followed-across')
    expect(result.kinds).not.toContain('stayed-with-it')
    expect(result.kinds).not.toContain('read-deeply')
    expect(result.sufficient).toBe(false)
  })

  it('is refused even though read-around fires on it, because breadth counts once', () => {
    /**
     * The regression this fixture was resized for. Forty-five seconds a page
     * clears `READ_AROUND_MS` honestly — nobody is pretending these pages were
     * not looked at — so `read-around` DOES fire, and for part of 2026-08-17 it
     * counted as a second investment ground beside `followed-across` and this
     * afternoon was offered work at fifteen minutes. That is what lowering
     * `SUSTAINED_MS` to eight did, arrived at from a different direction.
     *
     * `BREADTH_AXIS` is what refuses it: three sites and four pages of one of
     * them is one fact about clicking, asked twice.
     */
    const result = groundsFor(detected(SUBJECT, skimmed), skimmed)

    expect(result.kinds).toContain('read-around')
    expect(result.kinds).toContain('followed-across')
    // Three investment KINDS would be two investment axes if these were
    // independent. They are not, so it is one, and one is not enough.
    expect(result.sufficient).toBe(false)
  })

  it('is admitted once the same afternoon runs past SUSTAINED_MS, and that is the known cost', () => {
    // Not a wall, a price, and the price is time passing. Pinned rather than
    // hidden: `INVESTMENT_REQUIRED`'s comment says the same thing in words, and
    // ADR-0009's revisit list names this direction. If a real person is ever
    // interrupted this way, this is the test that says it was expected.
    //
    // `stayed-with-it` is the ground that pays for it, and it is the only one
    // that can: `came-back` is the intent half, and `followed-across` and
    // `read-around` fold into one between them.
    const longer = [
      ...skimmed.slice(0, -1),
      page({
        url: 'https://blog.example/posts/world-models',
        title: 'Notes on World Models',
        engagedMs: 45_000,
        at: T0 + SUSTAINED_MS,
      }),
    ]

    const result = groundsFor(detected(SUBJECT, longer), longer)
    expect(result.kinds).toContain('stayed-with-it')
    expect(result.sufficient).toBe(true)
  })
})

describe('depth on one site, which used to be worth nothing — 2026-08-17', () => {
  /**
   * The product owner's ask, as a fixture: *"in the event something is done on
   * the same site for multiple subpages, you shouldn't need a third site. That
   * doesn't really make sense logistically."*
   *
   * A search, then six arXiv abstracts on one subject, one of them read
   * properly. Two origins, so `followed-across` cannot fire; nine minutes, so
   * `stayed-with-it` cannot either. Before `read-around` this session had
   * exactly ONE investment ground and was refused, which is the asymmetry: the
   * same person glancing at three sites for ninety seconds had two.
   */
  const abstracts = Array.from({ length: 6 }, (_, i) =>
    page({
      url: `https://arxiv.org/abs/2501.0${i}`,
      title: `World Models for Control ${i}`,
      // One page held past the threshold, the rest read the way abstracts are.
      engagedMs: i === 2 ? 70_000 : 35_000,
      at: T0 + (i + 1) * MINUTE,
    }),
  )

  const readingAround = [page({ url: SEARCH, at: T0 }), ...abstracts]
  const result = groundsFor(detected(SUBJECT, readingAround), readingAround)

  it('is offered', () => {
    expect(result.sufficient).toBe(true)
  })

  it('rests on read-around, and would not stand without it', () => {
    // The two investment grounds are `read-deeply` and `read-around`, and the
    // other two are provably absent — one site short and six minutes short. So
    // this test fails the moment `read-around` is taken back out, rather than
    // passing on some other ground quietly picking up the slack.
    expect(result.kinds).toContain('read-around')
    expect(result.kinds).toContain('read-deeply')
    expect(result.kinds).not.toContain('followed-across')
    expect(result.kinds).not.toContain('stayed-with-it')
    expect(result.kinds).toContain('searched-then-read')
  })

  it('names the site they read around', () => {
    expect(result.sentences).toContain('You read 6 pages on arxiv.org.')
  })

  it('is still refused when nothing on that site was actually read', () => {
    // `read-around` buys ONE of the two investment grounds required. A search
    // and six abstracts nobody stayed on is a search going badly with more
    // tabs, and it is refused exactly as it was before this ground existed.
    const glanced = [
      page({ url: SEARCH, at: T0 }),
      ...abstracts.map((abstract, i) => page({ url: abstract.url, title: abstract.title, engagedMs: 20_000, at: T0 + (i + 1) * MINUTE })),
    ]

    const glancedResult = groundsFor(detected(SUBJECT, glanced), glanced)

    expect(glancedResult.kinds).toContain('read-around')
    expect(glancedResult.kinds).not.toContain('read-deeply')
    expect(glancedResult.kinds).not.toContain('stayed-with-it')
    expect(glancedResult.kinds).not.toContain('followed-across')
    expect(glancedResult.sufficient).toBe(false)
  })

  /**
   * The same shape, from a real buffer on 2026-08-16: a search, then a run of
   * product pages on one retailer, one of them looked at properly. Nothing here
   * can tell this apart from the six abstracts above, because telling them apart
   * is what a model would be for and no model runs in this path.
   *
   * Pinned rather than hidden, the way the newsletter afternoon past
   * `SUSTAINED_MS` is pinned above. If a real person is ever interrupted
   * mid-shop, these are the tests that say it was expected.
   *
   * The bound is elsewhere and is weaker than it reads: eighteen product pages
   * with no search in front of them are one origin, form no thread, and never
   * reach here — but the search in front of them is the whole of what it takes
   * to clear that, and it is the first thing anybody does.
   */
  const shopping = [
    page({ url: 'https://www.google.com/search?q=wireless+headphones', at: T0 }),
    ...Array.from({ length: 18 }, (_, i) =>
      page({
        url: `https://www.amazon.com/dp/B0${i}`,
        title: 'Wireless Headphones',
        engagedMs: i === 5 ? 80_000 : 15_000,
        at: T0 + (i + 1) * 10_000,
      }),
    ),
  ]

  it('refuses eighteen product pages nobody spent twenty seconds on', () => {
    /**
     * ~~`expect(shoppingResult.sufficient).toBe(true)` — the accepted cost.~~
     * **Amended 2026-08-17.** The recorded buffer is fifteen seconds a page, and
     * fifteen seconds is under `READ_AROUND_MS`, so the honest reading of this
     * session is that one page was looked at and seventeen were flicked past.
     * The engagement figures are the recording and are left alone; what changed
     * is that "engaged" now means something.
     *
     * This is NOT the cost going away — the next test is the cost, at the size
     * the cost really is. It is the difference between eighteen pages read and
     * eighteen pages seen, which the ground's own sentence claims to know.
     */
    const shoppingResult = groundsFor(detected(['wireless', 'headphones'], shopping), shopping)

    expect(shoppingResult.kinds).toContain('read-deeply')
    expect(shoppingResult.kinds).not.toContain('read-around')
    expect(shoppingResult.sufficient).toBe(false)
  })

  it('admits the shopping session at real dwell, and that is the accepted cost', () => {
    // The same eighteen pages, at half a minute each rather than fifteen
    // seconds — which is what looking at a product page actually costs.
    const browsed = [
      shopping[0] as ThreadPage,
      ...shopping.slice(1).map((product, i) =>
        page({
          url: product.url,
          title: product.title,
          engagedMs: i === 5 ? 80_000 : 30_000,
          at: product.at,
        }),
      ),
    ]

    const result = groundsFor(detected(['wireless', 'headphones'], browsed), browsed)

    expect(result.kinds).toContain('read-around')
    expect(result.sentences).toContain('You read 18 pages on www.amazon.com.')
    expect(result.sufficient).toBe(true)
  })

  it('admits it at three pages and four minutes, which is the real minimum', () => {
    /**
     * The size the cost actually is, and the number the prose got wrong.
     *
     * `grounds.ts` and ADR-0009 both described the admitted shape by quoting the
     * eighteen-page buffer, which read as though eighteen were the bar. It is
     * three: three pages of one site each held past `READ_AROUND_MS`, one of
     * them past `DEEP_READ_MS`, and any one intent ground in front. That is four
     * minutes. Written down here so the documented cost is the real one.
     *
     * A bank portal and a documentation lookup have exactly this shape, and are
     * offered work exactly like this. Neither is research and nothing here can
     * say so.
     */
    const portal = [
      page({ url: 'https://www.google.com/search?q=chase+statement+download', at: T0 }),
      page({ url: 'https://secure.chase.com/statements', title: 'Chase Statement', engagedMs: 70_000, at: T0 + MINUTE }),
      page({ url: 'https://secure.chase.com/activity', title: 'Chase Statement Activity', engagedMs: 20_000, at: T0 + 2 * MINUTE }),
      page({ url: 'https://secure.chase.com/download', title: 'Chase Statement Download', engagedMs: 20_000, at: T0 + 4 * MINUTE }),
    ]

    const result = groundsFor(detected(['chase', 'statement'], portal), portal)

    expect(result.kinds).toEqual(['searched-then-read', 'read-deeply', 'read-around'])
    expect(result.sentences).toContain('You read 3 pages on secure.chase.com.')
    expect(result.sufficient).toBe(true)
  })

  it('admits it with no search at all, on one click back', () => {
    /**
     * The other half of the correction. `grounds.ts` said the admitted shape was
     * *"one search leading into heavy browsing on ONE site"* and ADR-0009 said
     * the same; a search is not required, because `came-back` is an intent
     * ground too. A newsletter link, three pages of the site it went to, one of
     * them read, and a tab reopened.
     */
    const noSearch = [
      page({ url: 'https://news.example/digest', title: 'World Models Digest', engagedMs: 30_000, at: T0, visits: 2 }),
      page({ url: 'https://blog.example/posts/world-models', title: 'Notes on World Models', engagedMs: 70_000, at: T0 + MINUTE }),
      page({ url: 'https://blog.example/posts/world-models-2', title: 'More World Models', engagedMs: 30_000, at: T0 + 2 * MINUTE }),
      page({ url: 'https://blog.example/posts/world-models-3', title: 'World Models Again', engagedMs: 30_000, at: T0 + 4 * MINUTE }),
    ]

    const result = groundsFor(detected(SUBJECT, noSearch), noSearch)

    expect(result.kinds).toEqual(['came-back', 'read-deeply', 'read-around'])
    expect(result.sufficient).toBe(true)
  })
})

describe('what the person is shown', () => {
  const pages = [
    page({ url: SEARCH, at: T0 }),
    page({
      url: 'https://a.example/1',
      title: 'World Models Survey',
      engagedMs: DEEP_READ_MS,
      at: T0 + MINUTE,
      visits: 2,
    }),
    page({ url: 'https://b.example/1', title: 'World Models Explained', at: T0 + 2 * MINUTE }),
    page({ url: 'https://c.example/1', title: 'Training World Models', at: T0 + 3 * MINUTE }),
  ]

  const result = groundsFor(detected(SUBJECT, pages), pages)

  it('says one sentence per ground, in the order shown', () => {
    expect(result.sentences).toHaveLength(result.kinds.length)
  })

  it('says what was seen, never what it means', () => {
    // The same rule `describeWork` follows: "you searched three different ways"
    // is a fact; "you are researching world models" is a reading, and a reading
    // needs a model, a session and somebody watching.
    for (const sentence of result.sentences) expect(sentence).toMatch(/^You /)
  })

  it('names the site they went back to', () => {
    expect(result.sentences).toContain('You went back to a.example after leaving it.')
  })

  it('quotes no page-authored text', () => {
    // Titles are page-authored and untrusted. The grounds block is the one
    // thing a person reads before deciding to be interrupted, so it is built
    // from hostnames and counts — nothing a page can write.
    for (const sentence of result.sentences) {
      expect(sentence).not.toContain('World Models Survey')
    }
  })
})

describe('an offer produced under fast-detect must not read like a real one', () => {
  it('appends the note to the grounds block', async () => {
    // Three seconds on a page fires `read-deeply` when the thresholds are 20×
    // short, and `read-deeply` means a minute. The sentence quotes the true
    // three seconds, so the number is not the lie — the ground firing is.
    // Somebody shown that without the note is being told something false about
    // their own afternoon.
    vi.resetModules()
    vi.stubEnv('PROPOSITUM_FAST_DETECT', '1')

    try {
      const fast = await import('../src/domain/detection/grounds')
      const pages = [page({ url: 'https://a.example/1', engagedMs: fast.DEEP_READ_MS })]
      const result = fast.groundsFor(detected(SUBJECT, pages), pages)

      expect(result.sentences).toHaveLength(1)
      expect(result.sentences[0]).toContain('fast-detect is on')
      expect(fast.DEEP_READ_MS).toBeLessThan(DEEP_READ_MS)
      // Counts do not shorten. A single page must stay reading rather than work
      // however fast the durations are made, and three pages on a site must
      // stay three — at two, `read-around` would be a landing page and one
      // click, which is the thing it was written to exclude.
      expect(fast.ORIGINS_FOR_OFFER).toBe(ORIGINS_FOR_OFFER)
      expect(fast.PAGES_ON_ONE_ORIGIN).toBe(PAGES_ON_ONE_ORIGIN)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
