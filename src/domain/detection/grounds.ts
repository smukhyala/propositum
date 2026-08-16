/**
 * Why Propositum is willing to offer to DO something, not merely to name it.
 *
 * ── Two bars, and this is the higher one ─────────────────────────────────
 *
 * `detectWork` decides whether Propositum may SAY something: a thread, plus
 * either eight minutes of reading or one search. ADR-0008 pins that bar and
 * this file does not touch it. It is deliberately low, because the cost of a
 * wrong subject line is a sentence nobody agrees with, and a person who
 * disagrees scrolls past it.
 *
 * Offering to do WORK is a different ask. It spends a person's attention on
 * reading and ratifying an offer, and then — if they accept — their sources,
 * their Chrome and their time on running it. So there is a second bar above the
 * first, it is arithmetic, and it lives here.
 *
 * ── Why one-intent-and-two-investment, and not three-of-six ──────────────
 *
 * Because the two groups measure different things and a single counter cannot
 * say *one of these AND two of those*. Both halves are necessary, and each
 * excludes a failure the other admits.
 *
 * **Intent separates pursuing from receiving.** Somebody who searched and then
 * read chose the subject. Somebody who read four pages of a site they arrived
 * at from a newsletter chose nothing — the subject was handed to them. Nobody
 * refines a search, or navigates back to a page they left, for something they
 * were idly served. Without an intent ground, absorption alone qualifies: a
 * long feature article, a forum argument, a recipe. That is exactly the false
 * positive ADR-0008 names as the expensive failure, because it interrupts
 * someone reading the news and teaches them the feature is noise.
 *
 * **Investment separates "worth an offer" from "a lucky click".** One strong
 * ground is cheap to produce by accident. Depth on one page, span across the
 * thread, and breadth across sites are three different accidents, and needing
 * two of them is not much to ask of real work.
 *
 * Three-of-six would admit both failures directly. It passes `read-deeply` +
 * `stayed-with-it` + `followed-across` with no intent at all — the newsletter
 * afternoon. And it passes all three intent grounds with no investment —
 * somebody who searched, refined and came back inside ninety seconds having
 * read nothing, which is what a search going badly looks like, and the worst
 * possible moment to interrupt. Both are ordinary browsing.
 *
 * ── No model runs here, ever ─────────────────────────────────────────────
 *
 * Same discipline as `ObservationKind`: `GroundKind` is closed and code-owned.
 * Adding a member is a change to this file, never configuration and never model
 * output. A model composes the offer AFTER this says there is enough to offer
 * — it never gets a say in whether there is.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * `CONTEXT.md` sketches this as `{ intent: GroundKind[], investment:
 * GroundKind[] }`. It ships as one ordered `kinds` list plus the two `as const`
 * groups a caller can partition by, because the consumer copy is a single block
 * in a fixed order and two arrays would have to be re-merged to render it. The
 * grouping is still part of the type rather than a comment — it is what
 * `INTENT_GROUNDS` and `INVESTMENT_GROUNDS` are.
 */

import { FAST_DETECT } from './detect'
import type { WorkDetected } from './detect'
import { searchQueryOf } from './topics'
import type { ThreadPage } from './topics'

/**
 * Thresholds, on exactly the terms `detect.ts` sets out for its own.
 *
 * Divided by the same `SPEED`, from the same environment variable, read once at
 * module load. Durations shorten under fast-detect; COUNTS do not, because
 * dropping a count would stop testing the rule the count exists to state — that
 * one page is reading, one search is a whim, and one site is not following
 * anything across.
 *
 * These numbers are guesses, set before any real browsing existed, and nothing
 * has yet told us which of them is wrong. They live together in one block so
 * that tuning them is a diff rather than an excavation.
 */
const SPEED = FAST_DETECT ? 20 : 1

/** One page held their attention this long. Ninety seconds is a page read, not
 *  a page skimmed for the one line it was opened for. */
export const DEEP_READ_MS = (90 * 1000) / SPEED

/** The thread's own span, first page to last. Fifteen minutes of returning to
 *  the same subject is a different fact from fifteen minutes of one tab open. */
export const SUSTAINED_MS = (15 * 60_000) / SPEED

/** Distinct origins before following a subject counts as following it ACROSS.
 *  Two is the bar a thread already had to clear to exist — see
 *  `ORIGINS_FOR_THREAD` — so two here would be no additional evidence at all. */
export const ORIGINS_FOR_OFFER = 3

/** Distinct queries on the subject before it counts as refining rather than
 *  asking. The second query is the evidence: it says the first answer was read
 *  and found wanting. */
export const QUERIES_FOR_REFINEMENT = 2

/** Pages of the thread read AFTER a query, before the query counts as followed.
 *  This is the rule `PAGES_AFTER_QUERY` named in `detect.ts` and nothing
 *  enforced; it applies here, at the bar where offering to act is decided,
 *  rather than at the naming bar ADR-0008 pins. */
export const PAGES_AFTER_QUERY_FOR_OFFER = 2

/**
 * Evidence they were PURSUING this, rather than receiving it.
 *
 * Every member is an act of navigation a person had to choose. None of them can
 * be produced by sitting still, which is the property that makes the group
 * worth requiring.
 */
export const INTENT_GROUNDS = ['searched-then-read', 'refined-the-search', 'came-back'] as const

/**
 * Evidence enough was spent that carrying on is worth offering.
 *
 * Depth, span and breadth. Three different accidents, so two of them together
 * are unlikely to be one.
 */
export const INVESTMENT_GROUNDS = ['read-deeply', 'stayed-with-it', 'followed-across'] as const

/**
 * Closed, code-owned, never model output — the same discipline as
 * `ObservationKind`. There is no `other`.
 */
export type GroundKind = (typeof INTENT_GROUNDS)[number] | (typeof INVESTMENT_GROUNDS)[number]

export interface OfferGrounds {
  readonly kinds: readonly GroundKind[]
  readonly sufficient: boolean
  /** One consumer sentence per fired ground, in the order shown. */
  readonly sentences: readonly string[]
}

/** How many intent grounds must fire. */
export const INTENT_REQUIRED = 1

/** How many investment grounds must fire. */
export const INVESTMENT_REQUIRED = 2

/**
 * Said out loud, exactly as `describeWork` says it.
 *
 * An offer produced under 20× thresholds must not read like one produced by
 * real work: ninety seconds of fast-detect reading renders as the sentence
 * "you have been at this for 15 minutes" would if the thresholds were real.
 * Anyone shown that without the note is being told something false about their
 * own afternoon.
 *
 * It rides on the LAST sentence rather than arriving as an extra one, so the
 * "one sentence per fired ground" contract survives and a caller rendering the
 * list as rows does not grow a row that names no ground.
 */
const UNDER_TEST = FAST_DETECT
  ? ' (fast-detect is on — thresholds are 20× shorter than normal.)'
  : ''

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The queries in this thread that were actually about this thread.
 *
 * A search is only ever recognised by `searchQueryOf`, never by `ThreadPage.
 * searched` — that field needs the extension to have labelled the navigation a
 * query, and the extension labels any URL with a `?` a query. This half of the
 * sufficiency rule must not be satisfiable by a question mark, so the domain
 * decides for itself and the extension's opinion is not consulted.
 *
 * The search must also be ABOUT the thread. Somebody who looked up a lunch
 * place in the middle of an afternoon of research did not refine anything; that
 * page joined the thread on some incidental word.
 *
 * That test is `page.terms` against the thread's terms, and not a fresh
 * tokenisation of the query.
 *
 * ~~The reason was that `termsOf` strips trailing site branding from whatever
 * string it is given, and a bare query is not a title: `termsOf('gpt-4 vs
 * claude', '')` returned `{gpt}` — the hyphen read as a branding separator —
 * and `termsOf('e-processes sequential testing', '')` returned nothing at all.
 * Every hyphenated search failed this test silently.~~
 *
 * **Amended 2026-08-16: that bug is fixed at its source.** `BRANDING` now
 * requires whitespace before the separator, so a hyphen inside a word is part
 * of the word; those two calls return `{gpt, claude}` and `{process,
 * sequential, testing}`. This comment described a workaround for a defect
 * nobody had gone and fixed, which is how a routing-around outlives the thing
 * it routed around.
 *
 * The conclusion survives its own justification, on a narrower argument:
 * `page.terms` is built from the URL as well as the title, so a query that
 * reaches the page through the path branch is matched on words the title may
 * never have carried. Re-tokenising the query alone would see less.
 */
function pursuitOf(
  detected: WorkDetected,
  pages: readonly ThreadPage[],
): { readonly queries: readonly string[]; readonly readAfterQuery: number } {
  const subject = new Set(detected.terms)
  const queries: string[] = []
  let firstAt: number | null = null

  for (const page of pages) {
    const query = searchQueryOf(page.url)
    if (query === null) continue

    let onSubject = false
    for (const word of page.terms) {
      if (subject.has(word)) onSubject = true
    }
    if (!onSubject) continue

    if (!queries.includes(query)) queries.push(query)
    firstAt = firstAt === null ? page.at : Math.min(firstAt, page.at)
  }

  /**
   * Pages of the thread READ after that first query.
   *
   * Three things are excluded and each is deliberate. The searches themselves,
   * because a second query is a refinement and the ground below already
   * notices it. Pages first seen before the query, because nothing that
   * happened earlier was returned by it. And pages with no engagement at all,
   * because a burst of tabs opened from a result page and closed unread is the
   * exact accident this group exists to keep out of an offer — and because a
   * sentence saying somebody READ four pages had better be true.
   */
  const after = firstAt
  const readAfterQuery =
    after === null
      ? 0
      : pages.filter(
          (page) =>
            searchQueryOf(page.url) === null && page.at > after && page.engagedMs > 0,
        ).length

  return { queries, readAfterQuery }
}

/** The page they came back to, if any — the most-returned-to one, so the
 *  sentence names the page that best supports it. */
function returnedTo(pages: readonly ThreadPage[]): ThreadPage | null {
  const returns = [...pages].filter((page) => page.visits >= 2).sort((a, b) => b.visits - a.visits)
  return returns[0] ?? null
}

/** Longest single page read in the thread. */
function deepestRead(pages: readonly ThreadPage[]): number {
  let deepest = 0
  for (const page of pages) deepest = Math.max(deepest, page.engagedMs)
  return deepest
}

/**
 * First page to last.
 *
 * Deliberately conservative: `at` is when a page was FIRST seen, so the time
 * spent on the last page of the thread is not counted. A span measured from the
 * last page's dwell would be a guess about when they stopped, and this rule is
 * about how long they have been at it, which the first sightings already say.
 */
function spanOf(pages: readonly ThreadPage[]): number {
  if (pages.length === 0) return 0
  const times = pages.map((page) => page.at)
  return Math.max(...times) - Math.min(...times)
}

/**
 * Is there enough here to offer to do something about it?
 *
 * Pure arithmetic over what was already detected. No clock — every time this
 * needs is already on a page — so the same buffer produces the same grounds
 * whenever it is asked, which is what makes an offer explainable afterwards.
 */
export function groundsFor(detected: WorkDetected, pages: readonly ThreadPage[]): OfferGrounds {
  const { queries, readAfterQuery } = pursuitOf(detected, pages)
  const back = returnedTo(pages)
  const deepest = deepestRead(pages)
  const span = spanOf(pages)
  const origins = new Set(pages.map((page) => page.origin)).size

  const kinds: GroundKind[] = []
  const sentences: string[] = []

  const fired = (kind: GroundKind, sentence: string) => {
    kinds.push(kind)
    sentences.push(sentence)
  }

  // Intent first, then investment. The order is the order of the two `as const`
  // groups, so the block a person reads opens with why Propositum thinks they
  // chose this — which is the part they are most likely to disagree with.
  if (queries.length > 0 && readAfterQuery >= PAGES_AFTER_QUERY_FOR_OFFER) {
    fired('searched-then-read', `You searched, then read ${readAfterQuery} more pages.`)
  }

  if (queries.length >= QUERIES_FOR_REFINEMENT) {
    fired('refined-the-search', `You searched ${queries.length} different ways.`)
  }

  if (back !== null) {
    fired('came-back', `You went back to ${hostOf(back.origin)} after leaving it.`)
  }

  if (deepest >= DEEP_READ_MS) {
    fired('read-deeply', `You spent ${minutes(deepest)} on a single page.`)
  }

  if (span >= SUSTAINED_MS) {
    fired('stayed-with-it', `You have been at this for ${minutes(span)}.`)
  }

  if (origins >= ORIGINS_FOR_OFFER) {
    fired('followed-across', `You followed it across ${origins} sites.`)
  }

  const intent = kinds.filter((kind) => (INTENT_GROUNDS as readonly GroundKind[]).includes(kind))
  const investment = kinds.filter((kind) =>
    (INVESTMENT_GROUNDS as readonly GroundKind[]).includes(kind),
  )

  const last = sentences.length - 1
  if (last >= 0 && UNDER_TEST !== '') sentences[last] = `${sentences[last] ?? ''}${UNDER_TEST}`

  return {
    kinds,
    sufficient: intent.length >= INTENT_REQUIRED && investment.length >= INVESTMENT_REQUIRED,
    sentences,
  }
}
