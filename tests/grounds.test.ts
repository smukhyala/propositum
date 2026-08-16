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
  DEEP_READ_MS,
  INTENT_GROUNDS,
  INTENT_REQUIRED,
  INVESTMENT_GROUNDS,
  INVESTMENT_REQUIRED,
  ORIGINS_FOR_OFFER,
  SUSTAINED_MS,
  groundsFor,
} from '../src/domain/detection/grounds'
import type { GroundKind } from '../src/domain/detection/grounds'
import { ORIGINS_FOR_THREAD, searchQueryOf, termsOf } from '../src/domain/detection/topics'
import type { ThreadPage } from '../src/domain/detection/topics'
import { WINDOW_MS } from '../src/domain/detection/detect'
import type { WorkDetected } from '../src/domain/detection/detect'

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
})

describe('sufficiency — one of these AND two of those', () => {
  /** Three origins, deep reading, a long span. No query, nothing returned to. */
  const investmentOnly = [
    page({ url: 'https://a.example/1', engagedMs: DEEP_READ_MS * 2, at: T0 }),
    page({ url: 'https://b.example/1', engagedMs: DEEP_READ_MS, at: T0 + SUSTAINED_MS / 2 }),
    page({ url: 'https://c.example/1', engagedMs: DEEP_READ_MS, at: T0 + SUSTAINED_MS }),
  ]

  it('three investment grounds and no intent is not enough', () => {
    const result = groundsFor(detected(SUBJECT, investmentOnly), investmentOnly)

    // Every investment ground fires. The rule is what refuses, not a shortage
    // of evidence — which is the whole argument against three-of-six.
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

  it('is refused despite every investment ground firing', () => {
    expect(result.kinds).toEqual([...INVESTMENT_GROUNDS])
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
   */
  const skimmed = [
    page({
      url: 'https://news.example/digest',
      title: 'The World After Models',
      engagedMs: 45_000,
      at: T0,
      visits: 2,
    }),
    page({
      url: 'https://forum.example/thread/9',
      title: 'World Models, discussed',
      engagedMs: 45_000,
      at: T0 + 4 * MINUTE,
    }),
    page({
      url: 'https://blog.example/posts/world-models',
      title: 'Notes on World Models',
      engagedMs: 45_000,
      at: T0 + 9 * MINUTE,
    }),
  ]

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

  it('is admitted once the same afternoon runs past SUSTAINED_MS, and that is the known cost', () => {
    // Not a wall, a price, and the price is time passing. Pinned rather than
    // hidden: `INVESTMENT_REQUIRED`'s comment says the same thing in words, and
    // ADR-0009's revisit list names this direction. If a real person is ever
    // interrupted this way, this is the test that says it was expected.
    const longer = [
      ...skimmed.slice(0, 2),
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
      // however fast the durations are made.
      expect(fast.ORIGINS_FOR_OFFER).toBe(ORIGINS_FOR_OFFER)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
