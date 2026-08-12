/**
 * The second, higher bar: is there enough evidence to offer to DO something?
 *
 * ── Two bars, and why the second one exists ──────────────────────────────
 *
 * `detectWork` decides whether Propositum may SAY something, and its bar is
 * deliberately low — the cost of a wrong subject line is a sentence nobody
 * agrees with. Offering to do work is a different ask entirely: it spends a
 * person's attention on ratifying something, and then their sources, their
 * Chrome and their time on running it. ADR-0009 §2 sets that second bar and
 * this file is it.
 *
 * No model runs here, and none ever should. Every rule below is arithmetic
 * over the same metadata the detector already had — a cleaned URL, a title,
 * dwell, and the order things happened in. The thresholds are the ones already
 * in `detect.ts`, and like those they are guesses set before any real browsing
 * existed. Saying so is cheaper than pretending otherwise.
 *
 * ── Why two groups rather than three-of-six ──────────────────────────────
 *
 * The two axes fail differently, and a single counter cannot say *one of these
 * and two of those*.
 *
 * INTENT separates pursuing from receiving. Someone who searched and then read
 * chose the subject; someone who read three pages of a site they arrived at
 * from a newsletter chose nothing. Without an intent ground, absorption alone
 * qualifies — a long feature, a forum argument, a recipe — and that is the
 * expensive false positive: it interrupts somebody reading the news and teaches
 * them the feature is noise.
 *
 * INVESTMENT separates "worth an offer" from "a lucky click". Depth on a page,
 * span across the thread and breadth across sites are three different
 * accidents, and needing two of them is not much to ask of real work.
 *
 * Three-of-six admits both failures directly: `read-deeply + stayed-with-it +
 * followed-across` is the newsletter afternoon with no intent at all, and all
 * three intent grounds inside ninety seconds having read nothing is what a
 * search going badly looks like. Both are ordinary browsing.
 *
 * ── The sentences are the person's own facts ─────────────────────────────
 *
 * Each ground carries a sentence written in the second person about something
 * that observably happened. They are rendered VERBATIM and ABOVE anything a
 * model wrote, because the order on screen is the argument: the person's own
 * facts first, the model's reading of them second. A sentence here may never
 * contain a conclusion — "you searched three different ways" is a fact,
 * "you are researching carriers" is a reading and belongs to the offer.
 */

import { ENGAGED_MS_FOR_WORK } from './detect'
import type { AmbientObservation, WorkDetected } from './detect'
import { termsOf } from './topics'

/** The six. Closed, and split into the two groups the sufficiency rule needs. */
export const INTENT_GROUNDS = ['searched-then-read', 'refined-the-search', 'came-back'] as const
export const INVESTMENT_GROUNDS = ['read-deeply', 'stayed-with-it', 'followed-across'] as const

export type IntentGround = (typeof INTENT_GROUNDS)[number]
export type InvestmentGround = (typeof INVESTMENT_GROUNDS)[number]
export type OfferGroundKind = IntentGround | InvestmentGround

/**
 * What the detector saw, in the form the offer screen and the durable
 * `WorkOffer.grounds` column both take.
 *
 * `kinds` is what code reasons about; `sentences` is what a person reads; and
 * `sufficient` is the only thing that may gate composing an offer. Keeping all
 * three on one value means the screen cannot show grounds that did not count
 * and the gate cannot count grounds the screen does not show.
 */
export interface OfferGrounds {
  readonly kinds: readonly OfferGroundKind[]
  readonly sufficient: boolean
  readonly sentences: readonly string[]
}

/**
 * One page held for this long is depth rather than a glance.
 *
 * A quarter of the whole-thread engagement bar. The number is a guess in
 * exactly the way `detect.ts` says its numbers are guesses; what matters is
 * that it is a THRESHOLD ON ONE PAGE, so three tabs skimmed for a minute each
 * cannot add up to it the way the thread total can.
 */
export const READ_DEEPLY_MS = ENGAGED_MS_FOR_WORK / 4

/**
 * The thread's own span — first page to last — past which this is a sitting
 * rather than a detour.
 *
 * Span, not engaged time, and the two are different on purpose: engaged time
 * already has its own ground above it. Someone who opened a page, went to a
 * meeting and came back to it twenty minutes later has stayed with the subject
 * in a way that ten unbroken minutes of reading does not capture.
 */
export const STAYED_WITH_IT_MS = ENGAGED_MS_FOR_WORK

/** Distinct sites in one thread before breadth is itself evidence. */
export const ORIGINS_FOR_BREADTH = 3

/** Pages read after a query before the query counts as having been followed. */
export const PAGES_AFTER_QUERY_FOR_INTENT = 2

/** Minutes, as a person would say them. */
function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
function host(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The observations that made up this thread, oldest first.
 *
 * Restricted to the thread's own pages, because every ground below is a claim
 * about ONE subject. A search for a car in another tab is not evidence that
 * somebody is pursuing a hiking trip, and the detector already worked out which
 * pages belonged together — throwing that away here would re-introduce the bug
 * `WorkDetected.urls` exists to fix.
 */
function threadObservations(
  detected: WorkDetected,
  observations: readonly AmbientObservation[],
): AmbientObservation[] {
  const wanted = new Set(detected.urls)
  return observations.filter((o) => wanted.has(o.url)).sort((a, b) => a.at - b.at)
}

/** Largest engagement report per page. Reports are cumulative, so the biggest
 *  one is the answer and summing them would count the same minute repeatedly. */
function engagedByUrl(observations: readonly AmbientObservation[]): Map<string, number> {
  const byUrl = new Map<string, number>()
  for (const o of observations) {
    if (o.engagedMs === undefined) continue
    byUrl.set(o.url, Math.max(byUrl.get(o.url) ?? 0, o.engagedMs))
  }
  return byUrl
}

/** The most informative title seen for a page. The first report often lands
 *  before the document has one at all. */
function titleByUrl(observations: readonly AmbientObservation[]): Map<string, string> {
  const byUrl = new Map<string, string>()
  for (const o of observations) {
    if (o.title !== '') byUrl.set(o.url, o.title)
  }
  return byUrl
}

/**
 * Everything Propositum can say it saw, and whether it adds up to enough.
 *
 * Takes `nowMs` rather than reading the clock: the domain layer is replayable,
 * and a ground that depended on when it was evaluated could not be re-derived
 * from a fixture. `tests/architecture.test.ts` enforces that.
 */
export function groundsFor(
  detected: WorkDetected,
  observations: readonly AmbientObservation[],
  nowMs: number,
): OfferGrounds {
  const thread = threadObservations(detected, observations)
  const kinds: OfferGroundKind[] = []
  const sentences: string[] = []

  const say = (kind: OfferGroundKind, sentence: string) => {
    kinds.push(kind)
    sentences.push(sentence)
  }

  /* ── intent ───────────────────────────────────────────────────────────── */

  /**
   * A query, then at least two pages from what it returned.
   *
   * "From what it returned" is approximated by "after it, in this thread" —
   * ambient capture has no referrer and the `webNavigation` permission that
   * would carry the transition type was given up deliberately (ADR-0002). The
   * thread restriction is what keeps the approximation honest: the pages
   * counted already share subject matter with the query, which is most of what
   * "came from it" was trying to establish.
   */
  const queries = thread.filter((o) => o.kind === 'query')
  const firstQuery = queries[0]
  if (firstQuery) {
    const read = new Set<string>()
    for (const o of thread) {
      if (o.kind === 'query' || o.kind === 'away') continue
      if (o.at >= firstQuery.at) read.add(o.url)
    }
    if (read.size >= PAGES_AFTER_QUERY_FOR_INTENT) {
      say(
        'searched-then-read',
        `You searched, then read ${read.size} page${read.size === 1 ? '' : 's'} of what came back.`,
      )
    }
  }

  /**
   * A second query sharing terms with the first.
   *
   * Sharing terms, not merely being a second query: two unrelated searches are
   * two subjects, and treating them as a refinement would let an afternoon of
   * scattered lookups qualify as pursuit of any one of them.
   */
  const queryTerms = queries.map((o) => termsOf(o.title, o.url))
  let refined = false
  for (let i = 1; i < queryTerms.length && !refined; i += 1) {
    const later = queryTerms[i]
    if (!later) continue
    for (let j = 0; j < i; j += 1) {
      const earlier = queryTerms[j]
      if (!earlier) continue
      if (queries[i]?.url === queries[j]?.url) continue
      for (const term of later) {
        if (earlier.has(term)) {
          refined = true
          break
        }
      }
      if (refined) break
    }
  }
  if (refined) {
    say('refined-the-search', 'You searched more than one way for the same thing.')
  }

  /**
   * A return to a site already in the thread, after having left it.
   *
   * Leaving matters. Two pages in a row on one site is browsing it; two pages
   * on it with somebody else's site in between is a decision to go back, which
   * is the only reason this is an INTENT ground rather than an investment one.
   */
  const order = thread.filter((o) => o.kind !== 'away')
  let cameBackTo: AmbientObservation | null = null
  for (let i = 1; i < order.length && cameBackTo === null; i += 1) {
    const here = order[i]
    if (!here) continue
    let leftIt = false
    for (let j = i - 1; j >= 0; j -= 1) {
      const before = order[j]
      if (!before) continue
      if (before.origin !== here.origin) {
        leftIt = true
        continue
      }
      if (leftIt) cameBackTo = here
      break
    }
  }
  if (cameBackTo) {
    const titles = titleByUrl(thread)
    const what = titles.get(cameBackTo.url) ?? host(cameBackTo.origin)
    say('came-back', `You went back to ${what} after leaving it.`)
  }

  /* ── investment ───────────────────────────────────────────────────────── */

  const engaged = engagedByUrl(thread)
  let deepest = 0
  for (const ms of engaged.values()) deepest = Math.max(deepest, ms)
  if (deepest >= READ_DEEPLY_MS) {
    say('read-deeply', `You spent ${minutes(deepest)} on one page.`)
  }

  const last = order[order.length - 1]
  const span = Math.max(0, (last ? Math.max(last.at, nowMs) : nowMs) - detected.since)
  if (span >= STAYED_WITH_IT_MS) {
    say('stayed-with-it', `You have been at this for ${minutes(span)}.`)
  }

  if (detected.origins.length >= ORIGINS_FOR_BREADTH) {
    say(
      'followed-across',
      `You followed it across ${detected.origins.length} different sites.`,
    )
  }

  /* ── the bar ──────────────────────────────────────────────────────────── */

  const intent = kinds.filter((k) => (INTENT_GROUNDS as readonly string[]).includes(k)).length
  const investment = kinds.length - intent

  return {
    kinds,
    sentences,
    sufficient: intent >= 1 && investment >= 2,
  }
}
