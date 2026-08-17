/**
 * A typo should join the subject it meant.
 *
 * ── The observation these tests are written from ─────────────────────────
 *
 * Watched live. One sitting, three searches:
 *
 *     "techniques to measure peturbation robotcs"   google
 *     "DMD vs SPO robotics"                          google
 *     "Extended Kalman Filters"                      google -> medium.com
 *
 * After `singular` the buffer holds `robotc` from the first and `robotic` from
 * the second. One person, one subject, two unrelated tokens.
 *
 * ── The first test in this file is the one that says what this does NOT fix
 *
 * That session is still detected as nothing, for two independent reasons, and
 * `the session this came from, which still produces nothing` below pins both.
 * A test file about a typo fix that opened with the typo merging would be
 * quietly claiming a session was rescued. It was not.
 *
 * Weighted like `grounds.test.ts`: most of what follows pins what must NOT
 * merge, because a false merge is the silent failure — two subjects wearing one
 * name, with nothing on screen saying a decision was made.
 */

import { describe, it, expect } from 'vitest'
import {
  CANONICAL_MIN_LENGTH,
  canonicalise,
  findThreads,
  termsOf,
  searchQueryOf,
  surfacesOf,
  vocabularyOf,
} from '../src/domain/detection/topics'
import type { ThreadPage } from '../src/domain/detection/topics'
import { detectWork, threadPagesOf, WINDOW_MS } from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'
import { groundsFor } from '../src/domain/detection/grounds'
import { matchProject, projectTerms } from '../src/domain/detection/match-project'
import { signatureOf } from '../src/server/ambient-store'

const T0 = 1_786_471_000_000
const MINUTE = 60_000

function page(url: string, title: string, engagedMs = 0, at = T0): ThreadPage {
  return {
    url,
    origin: new URL(url).origin,
    title,
    terms: termsOf(title, url),
    engagedMs,
    at,
    searched: searchQueryOf(url) !== null,
    visits: 1,
  }
}

/** The same title on `count` different sites, so a term's page count is exactly
 *  what the fixture says it is. */
function repeated(title: string, count: number, prefix: string): ThreadPage[] {
  const pages: ThreadPage[] = []
  for (let n = 0; n < count; n += 1) {
    pages.push(page(`https://${prefix}${n}.example/a`, title))
  }
  return pages
}

/**
 * A page somebody reached by typing, on its own site.
 *
 * The distinction this helper exists for is the whole first rule: a word on a
 * page a person SEARCHED is a word they typed, and a word in a title is a word
 * its author wrote. Fixtures that want a merge have to use this one.
 */
function searched(query: string, host = 'https://www.google.com'): ThreadPage {
  return page(`${host}/search?q=${encodeURIComponent(query)}`, `${query} - Google Search`)
}

const canonicalOf = (pages: readonly ThreadPage[]) => vocabularyOf(pages).canonical

/* ── what this does not fix ──────────────────────────────────────────────── */

describe('the session this came from, which still produces nothing', () => {
  /**
   * Verbatim. Three google searches and one click through to medium.
   *
   * Two things refuse it, and it is worth being able to see both fail at once,
   * because fixing either one alone would leave this test passing and the claim
   * "this fixes that session" still false.
   */
  const SESSION: AmbientObservation[] = [
    {
      at: T0,
      origin: 'https://www.google.com',
      url: 'https://www.google.com/search?q=techniques+to+measure+peturbation+robotcs',
      title: 'techniques to measure peturbation robotcs - Google Search',
      kind: 'query',
    },
    {
      at: T0 + MINUTE,
      origin: 'https://www.google.com',
      url: 'https://www.google.com/search?q=DMD+vs+SPO+robotics',
      title: 'DMD vs SPO robotics - Google Search',
      kind: 'query',
    },
    {
      at: T0 + 2 * MINUTE,
      origin: 'https://www.google.com',
      url: 'https://www.google.com/search?q=Extended+Kalman+Filters',
      title: 'Extended Kalman Filters - Google Search',
      kind: 'query',
    },
    {
      at: T0 + 3 * MINUTE,
      origin: 'https://medium.com',
      url: 'https://medium.com/@someone/extended-kalman-filters',
      title: 'Extended Kalman Filters',
      kind: 'navigation',
      engagedMs: 4 * MINUTE,
    },
  ]

  it('still detects nothing, because two google searches are one origin', () => {
    // `ORIGINS_FOR_THREAD` wants a term on two sites. Merging `robotc` into
    // `robotic` merges two searches on the SAME site, which produces one origin
    // and no thread. The blocker in that sitting was that the person never
    // clicked through, and no amount of spelling repair is that.
    expect(detectWork(SESSION, T0 + 4 * MINUTE)).toBeNull()
  })

  it('does not even merge the two spellings, because neither carries a thread', () => {
    // The honest version of the claim. `robotc` was seen once and `robotic` was
    // seen once; absorbing takes `PAGES_FOR_THREAD` pages across
    // `ORIGINS_FOR_THREAD` origins and one page is neither, so both stand. This
    // fix is for the class, not for this instance.
    const pages = SESSION.filter((o) => o.kind !== 'away').map((o) => page(o.url, o.title))
    const canonical = canonicalOf(pages)

    expect(canonical.get('robotc')).toBe('robotc')
    expect(canonical.get('robotic')).toBe('robotic')
    // `perturbation` never appeared spelled correctly at all, so there was
    // nothing for the typo to merge into even in principle.
    expect(canonical.get('peturbation')).toBe('peturbation')
  })
})

/* ── the rule itself ─────────────────────────────────────────────────────── */

describe('the length floor, pinned so it has to be moved on purpose', () => {
  it('will not touch anything under six characters', () => {
    // At one edit apart, short words are a minefield — form/from, trial/trail,
    // cat/cot. `robotc` is exactly six, which is why six and not seven.
    expect(CANONICAL_MIN_LENGTH).toBe(6)
  })
})

describe('a typo joins the word it was a typo of', () => {
  /**
   * The two real pairs, in the shape that actually pays off: the destination
   * pages spell the subject correctly several times over, and the typo appears
   * once, in the search that started it.
   */
  const pages = [
    page(
      'https://www.google.com/search?q=techniques+to+measure+peturbation+robotcs',
      'techniques to measure peturbation robotcs - Google Search',
    ),
    page('https://arxiv.org/abs/1', 'Perturbation-Aware Robotics Navigation'),
    page('https://science.example/1', 'Robustness to Perturbation in Legged Robotics'),
    page('https://github.example/1', 'Perturbation Simulation for Robotics'),
  ]

  const canonical = canonicalOf(pages)

  it('merges peturbation into perturbation', () => {
    expect(canonical.get('peturbation')).toBe('perturbation')
  })

  it('merges robotc into robotic, which needs a deletion rather than a swap', () => {
    expect(canonical.get('robotc')).toBe('robotic')
  })

  it('leaves the representative alone, so a second pass changes nothing', () => {
    expect(canonical.get('perturbation')).toBe('perturbation')
    expect(canonical.get('robotic')).toBe('robotic')
  })

  it('adds the representative to the page that carried the typo', () => {
    const rewritten = canonicalise(pages)
    const search = rewritten[0]
    expect(search).toBeDefined()
    if (!search) return

    expect(search.terms.has('perturbation')).toBe(true)
    expect(search.terms.has('robotic')).toBe(true)
    // Words with no eligible neighbour are untouched. The pass is a rewrite of
    // near-duplicates, not a normaliser with opinions.
    expect(search.terms.has('measure')).toBe(true)
    // The title is the raw material the vocabulary is derived from, so it must
    // survive intact or the pass stops being idempotent.
    expect(search.title).toBe(pages[0]?.title)
  })

  it('keeps the spelling the page actually used, beside the one it meant', () => {
    // The first version REPLACED, and that is how `contest` vanished from a
    // sitting with three contest pages on it — see `a false merge must not
    // refile a sitting` below for what the deletion then did to `matchProject`.
    // A page's terms must always contain what the page said.
    const search = canonicalise(pages)[0]
    expect(search).toBeDefined()
    if (!search) return

    expect(search.terms.has('peturbation')).toBe(true)
    expect(search.terms.has('robotc')).toBe(true)
  })

  it('is idempotent, which is what lets it sit on two paths at once', () => {
    const once = canonicalise(pages)
    const twice = canonicalise(once)

    expect(twice.map((p) => [...p.terms].sort())).toEqual(once.map((p) => [...p.terms].sort()))
  })
})

/* ── what must not merge ─────────────────────────────────────────────────── */

describe('the absorbed word must be typed, exactly once', () => {
  /**
   * `filter` and `filler` are one substitution apart, share a first letter and
   * both clear the length floor. Edit distance alone would merge them. Every
   * test in this block is a different reason the pass refuses to.
   */
  const evenly = [
    ...repeated('Kalman Filter Design', 3, 'a'),
    ...repeated('Ceramic Filler Notes', 3, 'b'),
  ]

  it('refuses a merge when both spellings are equally common', () => {
    const canonical = canonicalOf(evenly)

    expect(canonical.get('filter')).toBe('filter')
    expect(canonical.get('filler')).toBe('filler')
  })

  it('merges the pair when the rare one was typed into a search, once', () => {
    // Deliberately shown rather than hidden: distance is not doing the work
    // here, the two rules are. Five pages saying `filter` across five sites,
    // and one search where the person typed `filler`, is the shape of a slip —
    // and this cannot tell that from two real words in that shape.
    const lopsided = [...repeated('Kalman Filter Design', 5, 'a'), searched('ceramic filler notes')]

    expect(canonicalOf(lopsided).get('filler')).toBe('filter')
  })

  it('refuses the same pair when the one-off is a word somebody else wrote', () => {
    // The rule the earlier version did not have, and the one that stops an
    // unrelated page joining a thread. `Ceramic Filler Notes` is a title: its
    // author chose that word and spelled it the way they meant it. Nothing in
    // this window is evidence that anybody made a mistake.
    const lopsided = [
      ...repeated('Kalman Filter Design', 5, 'a'),
      ...repeated('Ceramic Filler Notes', 1, 'b'),
    ]

    expect(canonicalOf(lopsided).get('filler')).toBe('filler')
  })

  it('refuses a typed word that was typed twice', () => {
    // Two searches spelling it the same way is a word, not a slip. The prose
    // always said "a one-off"; `count <= mine` did not, and that gap is what
    // merged thirty-nine pages into forty.
    const twice = [
      ...repeated('Kalman Filter Design', 5, 'a'),
      searched('ceramic filler notes'),
      searched('ceramic filler suppliers', 'https://duckduckgo.com'),
    ]

    expect(canonicalOf(twice).get('filler')).toBe('filler')
  })

  it('refuses a near-tie at 3 against 2, and a near-tie at 10 against 9', () => {
    // `content` and `contest` are both ordinary words with different meanings,
    // and neither is a typo of anything. Strictly-greater alone merged them at
    // every ratio it was tried at, including 39 against 40.
    for (const [common, rare] of [
      [3, 2],
      [10, 9],
      [40, 39],
    ] as const) {
      const pages = [
        ...repeated('content strategy notes', common, 'x'),
        ...repeated('contest strategy notes', rare, 'y'),
      ]

      expect(canonicalOf(pages).get('contest')).toBe('contest')
      expect(canonicalOf(pages).get('content')).toBe('content')
    }
  })
})

describe('the absorbing word must already carry a thread of its own', () => {
  /**
   * The second rule, and the one that bounds the damage when the first is wrong
   * about a particular word. A merge may add a page to a thread that already
   * exists. It may never be what brings one into existence.
   */
  it('will not let a typed one-off supply a thread its deciding page', () => {
    // `waiting` is on two pages across two origins — one page short of
    // `PAGES_FOR_THREAD`, so there is no thread. A search for `writing tips`
    // one edit away must not become the third page and the third origin at
    // once, because those pages become approved sources on accept.
    const near = [
      page('https://blog.acme.test/waiting-lists', 'waiting lists that convert'),
      page('https://growth.test/waiting', 'waiting room design'),
      searched('writing an outline'),
    ]

    expect(canonicalOf(near).get('writing')).toBe('writing')
    expect(findThreads(near)).toHaveLength(0)
  })

  it('will not let one merge give a one-origin subject its second origin', () => {
    // Three pages, all on one site, so `ORIGINS_FOR_THREAD` is unmet and
    // sitting on one place is structurally not research. A search elsewhere
    // must not supply the second origin either.
    const oneSite = [
      page('https://growth.test/a', 'waiting lists that convert'),
      page('https://growth.test/b', 'waiting room design'),
      page('https://growth.test/c', 'waiting time analysis'),
      searched('writing an outline'),
    ]

    expect(canonicalOf(oneSite).get('writing')).toBe('writing')
  })

  it('still merges once the subject stands up without the search', () => {
    // The other side of the same rule, so this is a bound and not a ban.
    const enough = [
      page('https://blog.acme.test/waiting-lists', 'waiting lists that convert'),
      page('https://growth.test/waiting', 'waiting room design'),
      page('https://ux.test/waiting', 'waiting room copy'),
      searched('writing an outline'),
    ]

    expect(canonicalOf(enough).get('writing')).toBe('waiting')
  })
})

describe('a whole detection cannot be manufactured out of one unrelated page', () => {
  const BASE: AmbientObservation[] = [
    {
      at: T0,
      origin: 'https://blog.acme.test',
      url: 'https://blog.acme.test/waiting-lists',
      title: 'waiting lists that convert',
      kind: 'navigation',
      engagedMs: 5 * MINUTE,
    },
    {
      at: T0 + MINUTE,
      origin: 'https://growth.test',
      url: 'https://growth.test/waiting',
      title: 'waiting room design',
      kind: 'navigation',
      engagedMs: 5 * MINUTE,
    },
  ]

  const NOW = T0 + 6 * MINUTE

  it('detects nothing from the subject alone, which is the control', () => {
    expect(detectWork(BASE, NOW)).toBeNull()
  })

  it('still detects nothing once an unrelated page is added beside it', () => {
    // Measured against the first version: this produced a three-page,
    // three-origin detection whose `urls` included the outline — a page about
    // a different subject entirely, carried into the session as an approved
    // source, with nothing on screen saying a decision had been made.
    const withOutline: AmbientObservation[] = [
      ...BASE,
      {
        at: T0 + 2 * MINUTE,
        origin: 'https://novelcraft.test',
        url: 'https://novelcraft.test/outline',
        title: 'writing an outline',
        kind: 'navigation',
        engagedMs: 5 * MINUTE,
      },
    ]

    expect(detectWork(withOutline, NOW)).toBeNull()
  })

  it('still detects nothing when the unrelated page is a search', () => {
    const withSearch: AmbientObservation[] = [
      ...BASE,
      {
        at: T0 + 2 * MINUTE,
        origin: 'https://www.google.com',
        url: 'https://www.google.com/search?q=writing+an+outline',
        title: 'writing an outline - Google Search',
        kind: 'query',
        engagedMs: 5 * MINUTE,
      },
    ]

    expect(detectWork(withSearch, NOW)).toBeNull()
  })
})

/**
 * Each of these puts the typo in a SEARCH, so the two rules above are satisfied
 * and the guard named in the test is the only thing left refusing. A fixture
 * that failed on two rules at once would keep passing if either were deleted.
 */
describe('the guards that keep distance-1 affordable', () => {
  it('refuses two words shorter than the floor, however lopsided', () => {
    // trial/trail is one transposition apart and five characters long. Five
    // characters is where one edit stops meaning anything.
    const pages = [...repeated('Hiking Trail Notes', 5, 'a'), searched('clinical trial notes')]
    const canonical = canonicalOf(pages)

    expect(canonical.get('trial')).toBe('trial')
    expect(canonical.get('trail')).toBe('trail')
  })

  it('refuses two edits, even with everything else satisfied', () => {
    // filter/folder: two substitutions, same first letter, both six long.
    const pages = [...repeated('Kalman Filter Design', 5, 'a'), searched('folder layout notes')]

    expect(canonicalOf(pages).get('folder')).toBe('folder')
  })

  it('refuses a typed one-off two edits away by length alone', () => {
    // Two characters dropped from a twelve-character word. Refused before the
    // edit walk even runs, on the length difference.
    const pages = [...repeated('Perturbation Simulation', 5, 'a'), searched('peturbaton notes')]

    expect(canonicalOf(pages).get('peturbaton')).toBe('peturbaton')
  })

  it('refuses a merge that would have to change the first character', () => {
    // walking/talking is a single substitution at index 0. Typos rarely land on
    // the first letter; real words often differ only there.
    const pages = [...repeated('Robot Walking Gait', 5, 'a'), searched('talking points memo')]

    expect(canonicalOf(pages).get('talking')).toBe('talking')
  })

  it('refuses to follow a chain, so nothing lands two edits from where it started', () => {
    // `cashing` -> `caching` -> `coaching` is two edits, and the loop that used
    // to follow chains produced exactly that. It cannot form now — absorbing
    // needs three pages and being absorbed needs one — but the invariant is the
    // claim worth pinning, not the mechanism.
    for (const [rare, middle, common] of [
      ['cashing', 'caching', 'coaching'],
      ['writing', 'waiting', 'waiving'],
      ['founder', 'flounder', 'flounded'],
    ] as const) {
      const pages = [
        searched(`${rare} notes`),
        ...repeated(`${middle} notes`, 2, 'b'),
        ...repeated(`${common} notes`, 3, 'c'),
      ]
      const canonical = canonicalOf(pages)

      expect(canonical.get(rare)).not.toBe(common)
      expect(canonical.get(middle)).not.toBe(common)
    }
  })
})

/* ── filing, which is where a false merge is silent ──────────────────────── */

/**
 * `matchProject` decides which Project a sitting is filed under, and its own
 * header says a false merge there is the expensive failure: the wrong sources
 * become approved, the wrong document is offered, and nothing on screen says a
 * decision was made.
 *
 * `projectTerms(name)` is NOT canonicalised and cannot be — the project was
 * named in some other window. So anything this pass deletes from a thread's
 * terms is a word `matchProject` can no longer see.
 */
describe('a false merge must not refile a sitting under the wrong project', () => {
  it('keeps a contest sitting on the contest project', () => {
    // Three contest pages, four content pages, no typo anywhere. The first
    // version erased `contest` from `detected.terms` and this moved to the
    // Content project.
    const pages = [
      page('https://cf.test/1', 'contest editorial round'),
      page('https://ac.test/1', 'contest editorial notes'),
      page('https://tc.test/1', 'contest editorial recap'),
      ...repeated('content editorial post', 4, 'blog'),
    ]

    const thread = findThreads(pages)[0]
    expect(thread).toBeDefined()
    if (!thread) return

    expect(thread.terms).toContain('contest')

    const candidates = [
      { id: 'p-contest', name: 'contest editorial', terms: projectTerms('contest editorial') },
      { id: 'p-content', name: 'content editorial', terms: projectTerms('content editorial') },
    ]

    expect(matchProject(thread.terms, candidates)?.projectId).toBe('p-contest')
  })

  it('keeps matching a project as unrelated pages pile up elsewhere in the window', () => {
    // `modelling` absorbing `modeling` is not a typo repair, it is a spelling
    // preference winning a headcount. Adding deepmind pages that say
    // `modelling` used to rewrite an unchanged thread's terms until the World
    // Modeling project stopped matching at all.
    const candidates = [{ id: 'p1', name: 'world modeling', terms: projectTerms('world modeling') }]
    const spare = ['alpha', 'bravo', 'charlie', 'delta']

    for (let n = 1; n <= 4; n += 1) {
      const pages = [
        searched('world modeling survey'),
        page('https://arxiv.test/1', 'World Modeling Survey'),
        page('https://ieee.test/1', 'World Modeling Survey Two'),
      ]
      for (let k = 0; k < n; k += 1) {
        pages.push(page(`https://deepmind.example/${k}`, `World Modelling ${spare[k]}`))
      }

      const thread = findThreads(pages)[0]
      expect(thread).toBeDefined()
      if (!thread) return

      expect(thread.terms).toContain('modeling')
      expect(matchProject(thread.terms, candidates)?.projectId).toBe('p1')
    }
  })
})

/* ── determinism ─────────────────────────────────────────────────────────── */

describe('the canonical form is a pure function of the window', () => {
  /**
   * `filler` has two neighbours at distance one, both on three pages. Which one
   * wins is arbitrary; that it is the SAME one every time is not.
   * `signatureOf` derives an offer's identity from these strings, and
   * `extension/src/service-worker.js` already records a signature flapping
   * A->B->A across polls. A canonical choice that moved with insertion order
   * would make that worse and would make an offer impossible to explain an hour
   * later.
   */
  const ambiguous = [
    ...repeated('Kalman Filter Design', 3, 'a'),
    ...repeated('Salmon Fillet Recipe', 3, 'b'),
    searched('ceramic filler notes'),
  ]

  it('breaks a tie on frequency lexicographically, and says which way', () => {
    // `fillet` beats `filter` only because it sorts first. Arbitrary, fixed,
    // and written down so nobody has to rediscover it from a diff.
    expect(canonicalOf(ambiguous).get('filler')).toBe('fillet')
  })

  it('gives the same answer twice for the same buffer', () => {
    const first = [...canonicalOf(ambiguous)].sort()
    const second = [...canonicalOf(ambiguous)].sort()

    expect(second).toEqual(first)
  })

  it('gives the same answer whatever order the buffer arrived in', () => {
    const forwards = [...canonicalOf(ambiguous)].sort()
    const backwards = [...canonicalOf([...ambiguous].reverse())].sort()

    expect(backwards).toEqual(forwards)
  })

  /**
   * The determinism tests above run one fixed window twice and reversed. That
   * is not the instability that matters: an offer is polled repeatedly, and
   * what moves between polls is the WINDOW, as pages age past `WINDOW_MS`.
   *
   * `signatureOf(detected.terms)` keys the offer cache, `rememberThread` and the
   * durable `WorkOffer.threadSignature` column, and `service-worker.js` already
   * records a signature flapping A->B->A. A merge that holds at one poll and
   * dissolves at the next enlarges exactly that defect. The first version did:
   * "content+review+note" at T+29m became "review+note+content+contest" at
   * T+31m, off one page ageing out.
   */
  it('keeps the same signature as a page ages out of the window', () => {
    const titles = [
      ['https://c1.test/a', 'content review notes one'],
      ['https://c2.test/a', 'content review notes two'],
      ['https://c3.test/a', 'content review notes three'],
      ['https://c4.test/a', 'content review notes four'],
      ['https://k1.test/a', 'contest review notes five'],
      ['https://k2.test/a', 'contest review notes six'],
      ['https://k3.test/a', 'contest review notes seven'],
    ] as const

    const buffer: AmbientObservation[] = titles.map(([url, title], index) => ({
      at: T0 + index * MINUTE,
      origin: new URL(url).origin,
      url,
      title,
      kind: 'navigation',
      engagedMs: 3 * MINUTE,
    }))

    const before = detectWork(buffer, T0 + WINDOW_MS - MINUTE)
    const after = detectWork(buffer, T0 + WINDOW_MS + MINUTE)

    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    // The oldest page really did age out — otherwise this asserts nothing.
    expect(after?.pages).toBe((before?.pages ?? 0) - 1)
    expect(signatureOf(after?.terms ?? [])).toBe(signatureOf(before?.terms ?? []))
  })
})

/* ── the consistency trap ────────────────────────────────────────────────── */

/**
 * Two paths build `ThreadPage[]` from one buffer: `detectWork` -> `findThreads`,
 * and `threadPagesOf`, which `compose-offer.ts` and the ambient debug route call
 * separately. `grounds.ts` intersects the second path's `page.terms` with the
 * first path's `detected.terms`.
 *
 * If the rewrite happened in one and not the other, the two would disagree about
 * which word is on a page, every intent ground would stop firing, and nothing
 * would look wrong from the outside. These are the tests that would go red.
 */
describe('both paths out of one buffer agree about what a word is', () => {
  const SEARCH = 'https://www.google.com/search?q=techniques+to+measure+peturbation+robotcs'

  const SESSION: AmbientObservation[] = [
    {
      at: T0,
      origin: 'https://www.google.com',
      url: SEARCH,
      title: 'techniques to measure peturbation robotcs - Google Search',
      kind: 'query',
    },
    {
      at: T0 + MINUTE,
      origin: 'https://arxiv.org',
      url: 'https://arxiv.org/abs/2401.1',
      title: 'Perturbation-Aware Robotics Navigation',
      kind: 'navigation',
      engagedMs: 90_000,
    },
    {
      at: T0 + 2 * MINUTE,
      origin: 'https://science.example',
      url: 'https://science.example/legged',
      title: 'Robustness to Perturbation in Legged Robotics',
      kind: 'navigation',
      engagedMs: 40_000,
    },
    {
      at: T0 + 3 * MINUTE,
      origin: 'https://github.example',
      url: 'https://github.example/sim',
      title: 'Perturbation Simulation for Robotics',
      kind: 'navigation',
      engagedMs: 30_000,
    },
  ]

  const NOW = T0 + 4 * MINUTE
  const detected = detectWork(SESSION, NOW)

  it('lets the mistyped search join the thread it belongs to', () => {
    // The whole point, at the level a person would recognise. Without the
    // rewrite this search shares no word with the three pages it produced, so
    // the thread forms without it and the session reads as browsing nobody
    // asked for.
    expect(detected).not.toBeNull()
    expect(detected?.urls).toContain(SEARCH)
    expect(detected?.terms).toContain('robotic')
    expect(detected?.terms).toContain('perturbation')
  })

  it('rebuilds that page through the other path with the same terms on it', () => {
    expect(detected).not.toBeNull()
    if (detected === null) return

    const rebuilt = threadPagesOf(SESSION, detected, NOW).find((p) => p.url === SEARCH)
    expect(rebuilt).toBeDefined()
    expect(rebuilt?.terms.has('robotic')).toBe(true)
    // And still carrying what the person typed. The rewrite adds, it does not
    // replace — `pursuitOf` only needs the intersection to be non-empty, and a
    // deletion is what makes two views of one page disagree elsewhere.
    expect(rebuilt?.terms.has('robotc')).toBe(true)
  })

  it('leaves no page of the thread sharing nothing with the detected subject', () => {
    // The shape of the silent failure, stated as an invariant: `pursuitOf`
    // decides a search is on-subject by intersecting exactly these two sets, so
    // an empty intersection anywhere here is a ground that has stopped firing.
    expect(detected).not.toBeNull()
    if (detected === null) return

    const subject = new Set(detected.terms)
    for (const rebuilt of threadPagesOf(SESSION, detected, NOW)) {
      const shared = [...rebuilt.terms].filter((term) => subject.has(term))
      expect(shared.length).toBeGreaterThan(0)
    }
  })

  it('counts the mistyped query as a search about this subject', () => {
    expect(detected).not.toBeNull()
    if (detected === null) return

    const grounds = groundsFor(detected, threadPagesOf(SESSION, detected, NOW))
    expect(grounds.kinds).toContain('searched-then-read')
  })
})

/* ── what a person is shown ──────────────────────────────────────────────── */

describe('the label is the spelling they meant', () => {
  const pages = [
    page(
      'https://www.google.com/search?q=techniques+to+measure+peturbation+robotcs',
      'techniques to measure peturbation robotcs - Google Search',
    ),
    page('https://arxiv.org/abs/1', 'Perturbation-Aware Robotics Navigation', 90_000, T0 + 1),
    page('https://science.example/1', 'Robustness to Perturbation in Legged Robotics', 40_000, T0 + 2),
    page('https://github.example/1', 'Perturbation Simulation for Robotics', 30_000, T0 + 3),
  ]

  const thread = findThreads(pages)[0]

  it('finds the thread the typo would have split', () => {
    expect(thread).toBeDefined()
    expect(thread?.pages).toHaveLength(4)
  })

  it('shows the most common surface of the merged cluster, not the typo', () => {
    expect(thread).toBeDefined()
    if (!thread) return

    // The cluster has to have merged for this to be a claim about labels at
    // all: without the merge the search page is not a member and there is no
    // typo spelling in the running.
    expect(thread.pages).toHaveLength(4)
    expect(thread.terms).toContain('robotic')

    const labelFor = (term: string) => thread.labels[thread.terms.indexOf(term)]

    expect(labelFor('robotic')).toBe('robotics')
    expect(labelFor('perturbation')).toBe('perturbation')
  })

  it('shows the common surface even when the typo arrived first', () => {
    // First-seen-wins would have rendered this thread as "robotcs", because the
    // mistyped search is the first page in the buffer. Counting is the fix.
    expect(thread?.labels).not.toContain('robotcs')
    expect(thread?.labels).not.toContain('peturbation')
  })

  it('counts spellings rather than taking the first one seen', () => {
    // No typo anywhere here, and the point stands on its own: the first page
    // says "Robotic" and two later ones say "Robotics", so first-seen would
    // label this thread "robotic" and counting labels it "robotics".
    const spread = [
      page('https://a.example/1', 'Robotic Arm Design'),
      page('https://b.example/1', 'Robotics Overview'),
      page('https://c.example/1', 'Robotics Papers'),
    ]

    const found = findThreads(spread)[0]
    expect(found?.terms).toContain('robotic')
    expect(found?.labels[found.terms.indexOf('robotic')]).toBe('robotics')
  })

  it('keeps labels aligned index-for-index with terms', () => {
    expect(thread?.labels).toHaveLength(thread?.terms.length ?? -1)
  })

  /**
   * The invariant the counting version claimed and did not hold: a
   * representative's label is one of ITS OWN spellings, never an absorbed
   * word's. Pooling them and taking the commonest handed the label to `robotcs`
   * whenever the representative's pages were split across `robotic` and
   * `robotics` — which is the exact split `singular()` exists to normalise.
   *
   * Stated honestly: this cannot currently be made to fail by reverting the
   * label fix alone, because the fixture that broke it needed the typo on two
   * pages and rule 1 now refuses that. It is here as the property, so a future
   * loosening of rule 1 does not quietly bring the label back with it.
   */
  it('never labels a word with a spelling that belongs to a different word', () => {
    const { canonical, surface } = vocabularyOf(pages)

    const spellingsOf = new Map<string, Set<string>>()
    for (const p of pages) {
      for (const [term, word] of surfacesOf(p.title, p.url)) {
        const seen = spellingsOf.get(term) ?? new Set<string>()
        seen.add(word)
        spellingsOf.set(term, seen)
      }
    }

    for (const [term, label] of surface) {
      expect(canonical.get(term)).toBe(term)
      expect([...(spellingsOf.get(term) ?? [])]).toContain(label)
    }
  })
})

/* ── the failure this must not have introduced ───────────────────────────── */

describe('an afternoon of ordinary reading still does not qualify', () => {
  /**
   * ADR-0008's expensive failure, run through the real detection path rather
   * than a hand-built page list, so the canonicalisation pass is on it.
   *
   * Three sites, one subject, twenty-seven minutes of genuine reading, nothing
   * searched for and nothing returned to. Every investment ground fires and the
   * offer must still not be made.
   */
  const AFTERNOON: AmbientObservation[] = [
    {
      at: T0,
      origin: 'https://news.example',
      url: 'https://news.example/long-read',
      title: 'The World After Models',
      kind: 'navigation',
      engagedMs: 12 * MINUTE,
    },
    {
      at: T0 + 14 * MINUTE,
      origin: 'https://forum.example',
      url: 'https://forum.example/thread/9',
      title: 'World Models, discussed',
      kind: 'navigation',
      engagedMs: 9 * MINUTE,
    },
    {
      at: T0 + 25 * MINUTE,
      origin: 'https://blog.example',
      url: 'https://blog.example/posts/world-models',
      title: 'Notes on World Models',
      kind: 'navigation',
      engagedMs: 6 * MINUTE,
    },
  ]

  const NOW = T0 + 26 * MINUTE
  const detected = detectWork(AFTERNOON, NOW)

  it('is still detected as a subject, which was never the complaint', () => {
    expect(detected).not.toBeNull()
  })

  it('is still refused an offer, because nothing here was pursued', () => {
    expect(detected).not.toBeNull()
    if (detected === null) return

    const grounds = groundsFor(detected, threadPagesOf(AFTERNOON, detected, NOW))
    expect(grounds.sufficient).toBe(false)
    expect(grounds.kinds).not.toContain('searched-then-read')
    expect(grounds.kinds).not.toContain('refined-the-search')
    expect(grounds.kinds).not.toContain('came-back')
  })
})
