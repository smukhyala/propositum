/**
 * The stronger bar: enough reason to offer to DO something.
 *
 * `detectWork` decides whether Propositum may SAY something, and that bar is
 * deliberately low — the cost of a wrong subject line is a sentence nobody
 * agrees with. Offering to do work is a different ask. It spends a person's
 * attention on reading a proposal, and if they accept it spends their sources,
 * their Chrome and their time. ADR-0009 puts a second bar in front of that, and
 * this file is it.
 *
 * ── Still arithmetic, still no model ─────────────────────────────────────
 *
 * Nothing here is a judgment. Every ground below is a fact two people watching
 * the same screen would agree happened, computed from the ambient buffer's
 * metadata — a cleaned URL, a title, dwell. The model runs AFTER this says yes,
 * and it composes prose; it never decides whether there was enough reason.
 *
 * ── Two groups, not three-of-six ─────────────────────────────────────────
 *
 *   sufficient = at least one INTENT ground AND at least two INVESTMENT ones.
 *
 * The two axes fail differently and a single counter cannot say "one of these
 * and two of those".
 *
 * *Intent* separates pursuing from receiving. Someone who searched and then
 * read chose the subject; someone who read three pages of a place they arrived
 * at from a newsletter chose nothing. Without an intent ground, absorption
 * alone qualifies — a long feature, a forum argument, a recipe — and that is
 * the expensive false positive: it interrupts someone reading the news and
 * teaches them the feature is noise.
 *
 * *Investment* separates work from a lucky click. Depth on one page, span
 * across the thread and breadth across places are three different accidents,
 * and needing two of them is not much to ask of real work.
 *
 * Three-of-six would admit both failures directly: `read-deeply +
 * stayed-with-it + followed-across` is the newsletter afternoon with no intent
 * at all, and all three intent grounds inside ninety seconds having read
 * nothing is what a search going badly looks like.
 *
 * ── The thresholds are guesses ───────────────────────────────────────────
 *
 * Inherited from `detect.ts`, set before any real browsing existed, and now
 * gating something more expensive than a sentence. They live together here so
 * tuning them is a diff rather than an excavation.
 */

import { FAST_DETECT, PAGES_AFTER_QUERY } from './detect'
import type { AmbientObservation, WorkDetected } from './detect'

/** The same escape hatch `detect.ts` reads, for the same reason: a ten-minute
 *  feedback loop is how a false-positive rate goes unmeasured. */
const SPEED = FAST_DETECT ? 20 : 1

/** One page held for this long is depth rather than a glance. Engagement was
 *  already gated on dwell AND scroll before it reached the buffer, so this is
 *  time genuinely spent on a page, not a tab left open. */
export const READ_DEEPLY_MS = (3 * 60_000) / SPEED

/** The thread's own span — first page to last — past which it has been carried
 *  rather than merely opened. */
export const STAYED_WITH_IT_MS = (10 * 60_000) / SPEED

/** Distinct places one thread runs through before it counts as following a
 *  subject rather than reading a site. */
export const ORIGINS_FOR_FOLLOWED = 3

/** The six, closed. Named so a person can be told which one fired. */
export const INTENT_GROUNDS = ['searched-then-read', 'refined-the-search', 'came-back'] as const
export const INVESTMENT_GROUNDS = ['read-deeply', 'stayed-with-it', 'followed-across'] as const

export type IntentGround = (typeof INTENT_GROUNDS)[number]
export type InvestmentGround = (typeof INVESTMENT_GROUNDS)[number]
export type OfferGroundKind = IntentGround | InvestmentGround

/**
 * Why Propositum thought there was work here — and whether that is enough.
 *
 * `sentences` is what the person is shown and what gets frozen onto the
 * accepted offer, because the buffer these were computed from is bounded by a
 * thirty-minute window and a five-hundred-row cap and will not hold the answer
 * an hour later. "Why did it offer me this" is the first question somebody asks
 * when an offer was wrong, and a system that cannot answer it is asking to be
 * turned off.
 */
export interface OfferGrounds {
  readonly kinds: readonly OfferGroundKind[]
  readonly sufficient: boolean
  readonly sentences: readonly string[]
}

const SAYS: Record<OfferGroundKind, string> = {
  'searched-then-read': 'You searched for it, then read what came back.',
  'refined-the-search': 'You searched again, narrowing what you were after.',
  'came-back': 'You went away and came back to it.',
  'read-deeply': 'You stayed on one page long enough to have read it properly.',
  'stayed-with-it': 'You have been at this for a while, not in one sitting on one page.',
  'followed-across': 'You followed the subject across several places rather than reading one.',
}

/**
 * Search parameters that carry a term, by convention across engines and site
 * search. The same closed list `cleanUrl` keeps, which is what makes this
 * check possible: everything else has already been stripped by the time an
 * observation is stored.
 */
const QUERY_PARAMS = ['q', 'query', 'search', 's', 'k', 'p']

/**
 * What they actually typed, or empty when they typed nothing.
 *
 * `AmbientObservation.kind === 'query'` is NOT enough on its own, and this is
 * the difference between the bar working and the bar being decorative: the
 * extension marks a page as a query when its raw URL has a `?` in it, so a
 * newsletter link carrying `?utm_source=` arrives here claiming to be a search.
 * Accepting that would fire `searched-then-read` on an afternoon of reading
 * links somebody sent — precisely the newsletter afternoon the two-group rule
 * exists to refuse, and it would then tell the model "they searched for" over a
 * term the person never typed.
 *
 * So the term has to be in the URL. `cleanUrl` has already dropped every
 * parameter outside the list above, so a surviving `q=` really was a search
 * box.
 */
function searchTermIn(observation: AmbientObservation): string {
  if (observation.kind !== 'query') return ''

  try {
    const params = new URL(observation.url).searchParams
    for (const key of QUERY_PARAMS) {
      const value = params.get(key)
      if (value !== null && value.trim() !== '') return value.trim().toLowerCase()
    }
  } catch {
    /* not a URL; it cannot have carried a search term either */
  }

  return ''
}

function sharesTerm(a: Set<string>, b: Set<string>): boolean {
  for (const term of a) {
    if (b.has(term)) return true
  }
  return false
}

/**
 * The grounds for offering to work on a detected thread.
 *
 * `observations` are the ambient rows the thread was built from, oldest first —
 * ordering is load-bearing for `searched-then-read` and `came-back`, both of
 * which are statements about sequence rather than about totals.
 */
export function groundsFor(
  detected: WorkDetected,
  observations: readonly AmbientObservation[],
): OfferGrounds {
  const ordered = [...observations].sort((a, b) => a.at - b.at)

  /**
   * The searches, one per distinct thing typed.
   *
   * Deduplicated on the term itself, because a results page is observed
   * several times — once for the navigation, again for engagement, again when
   * the back button returns to it — and counting those as separate searches
   * would let one search satisfy "you searched again, narrowing what you were
   * after". That sentence is shown to the person and frozen onto the accepted
   * offer, so a system that says it about a single search is not merely
   * lenient, it is telling them something untrue about their own afternoon.
   */
  const searches: { readonly term: string; readonly url: string; readonly at: number }[] = []
  for (const observation of ordered) {
    const term = searchTermIn(observation)
    if (term === '') continue
    if (searches.some((s) => s.term === term)) continue
    searches.push({ term, url: observation.url, at: observation.at })
  }

  const searchUrls = new Set(searches.map((s) => s.url))
  const kinds: OfferGroundKind[] = []

  /* ── intent ─────────────────────────────────────────────────────────── */

  // A search, then at least two pages from what it returned. The pages come
  // AFTER the search — one run at the end of an afternoon says something quite
  // different about what the person was doing — and the results page itself
  // does not count, or a search plus one real page would clear a bar that says
  // two.
  const searched = searches.some((search) => {
    const after = new Set(
      ordered
        .filter((o) => o.at > search.at && o.kind !== 'away' && !searchUrls.has(o.url))
        .map((o) => o.url),
    )
    return after.size >= PAGES_AFTER_QUERY
  })
  if (searched) kinds.push('searched-then-read')

  // A second search sharing words with an earlier one. Refining is the
  // clearest statement available that the person is pursuing something rather
  // than being shown it, and sharing words is what separates refining from
  // moving on to an unrelated subject.
  const refined = searches.some((search, index) => {
    if (index === 0) return false
    const words = new Set(search.term.split(/[^a-z0-9]+/).filter((w) => w.length >= 3))
    return searches
      .slice(0, index)
      .some((earlier) =>
        sharesTerm(words, new Set(earlier.term.split(/[^a-z0-9]+/).filter((w) => w.length >= 3))),
      )
  })
  if (refined) kinds.push('refined-the-search')

  // A return to somewhere already in the thread, after having left it. Coming
  // back is a decision; staying is only inertia.
  const left = new Set<string>()
  let previousOrigin: string | null = null
  let returned = false
  for (const observation of ordered) {
    if (observation.kind === 'away' || observation.origin === '') continue
    if (previousOrigin !== null && observation.origin !== previousOrigin) left.add(previousOrigin)
    if (left.has(observation.origin)) returned = true
    previousOrigin = observation.origin
  }
  if (returned) kinds.push('came-back')

  /* ── investment ─────────────────────────────────────────────────────── */

  // Dwell is reported cumulatively and repeatedly for the same page, so the
  // largest report per page is the reading — summing them would count the same
  // minute several times and make a glance look like an hour.
  const deepest = new Map<string, number>()
  for (const observation of ordered) {
    const engaged = observation.engagedMs ?? 0
    deepest.set(observation.url, Math.max(deepest.get(observation.url) ?? 0, engaged))
  }
  if ([...deepest.values()].some((ms) => ms >= READ_DEEPLY_MS)) kinds.push('read-deeply')

  const last = ordered[ordered.length - 1]
  if (last && last.at - detected.since >= STAYED_WITH_IT_MS) kinds.push('stayed-with-it')

  if (detected.origins.length >= ORIGINS_FOR_FOLLOWED) kinds.push('followed-across')

  const intent = kinds.filter((k) => (INTENT_GROUNDS as readonly string[]).includes(k))
  const investment = kinds.filter((k) => (INVESTMENT_GROUNDS as readonly string[]).includes(k))

  return {
    kinds,
    sufficient: intent.length >= 1 && investment.length >= 2,
    sentences: kinds.map((k) => SAYS[k]),
  }
}
