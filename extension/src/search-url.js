/**
 * Was this page reached by SEARCHING, or does it merely have a question mark in
 * it?
 *
 * ── The lie this replaces ────────────────────────────────────────────────
 *
 * The service worker classified an ambient observation as a query like this:
 *
 *     o.url && o.url.includes('?') ? 'query' : 'navigation'
 *
 * So `https://news.example.com/article?utm_source=newsletter` was a search.
 * `https://mail.example.com/u/0?inbox` was a search. Anything with a tracking
 * parameter, a pagination cursor or a session id was a search, and the offer
 * screen then said *"You searched for it, then read 4 pages"* to somebody who
 * had searched for nothing at all.
 *
 * That is a truthfulness bug in the one piece of copy this product's whole
 * trust story rests on. The offer is defensible because every sentence in it is
 * something two people watching the same screen would agree happened; a
 * sentence that is simply false costs more than a missing feature.
 *
 * It is also a correctness bug one layer down. `searched-then-read` is an
 * INTENT ground, and intent is the group that separates pursuing a subject from
 * having one delivered to you (ADR-0009 §2). If any URL containing a `?`
 * satisfies it, the group stops separating anything: an afternoon of newsletter
 * links passes the intent bar, and the expensive false positive — interrupting
 * somebody reading the news — is back.
 *
 * ── What counts as a real query ──────────────────────────────────────────
 *
 * A recognised search parameter, on a search-shaped origin. Both halves are
 * needed and each is useless alone.
 *
 * The parameter list alone is too generous, because the short names are common
 * as anything else: `?s=` is WordPress search AND a sort key, `?p=` is a
 * WordPress post id far more often than it is a query, `?q=` turns up as a
 * generic filter. Anchoring on the shape of the URL is what stops
 * `blog.example.com/?p=1417` from being "you searched for 1417".
 *
 * The shape alone is too generous in the other direction: `/search` with no
 * parameters is an empty search box somebody landed on, which is not a
 * statement of intent about anything.
 *
 * ── Why a copy of `src/capture/url.ts` and not an import ─────────────────
 *
 * The extension has no build step, on purpose: the thing under review has to be
 * the thing Chrome runs, which would be an unhelpful property to give up in the
 * component holding the privacy guarantee. So it cannot import TypeScript. The
 * parameter list is kept identical to `QUERY_PARAMS` there and a test asserts
 * that the two have not drifted, which is the cheapest honest version of this.
 */

/**
 * Query parameters that carry a search term, by convention across engines and
 * site search. Deliberately the same closed list as `QUERY_PARAMS` in
 * `src/capture/url.ts` — guessing at arbitrary parameters would capture things
 * the person did not search for.
 */
export const QUERY_PARAMS = ['q', 'query', 'search', 's', 'k', 'p']

/**
 * Path segments that mean "this page is a set of results".
 *
 * Matched as whole segments, so `/research/papers` is not a search and
 * `/search/results` is one.
 */
const SEARCH_SEGMENTS = new Set([
  'search',
  'searches',
  'results',
  'find',
  'query',
  's',
  'sp', // Bing's video/image result paths, and a few site searches.
])

/**
 * Hosts whose ROOT is a search box. These answer at `/` and at `/search` alike,
 * so the path test cannot carry them.
 *
 * Matched on the registrable-looking tail rather than the full hostname, so
 * `www.google.com`, `google.co.uk` and `duckduckgo.com` all land. This is a
 * convenience list, not a security boundary — being wrong here costs one
 * sentence of copy, and the parameter test still has to pass.
 */
const SEARCH_HOSTS = [
  'google.',
  'bing.',
  'duckduckgo.',
  'search.brave.',
  'search.yahoo.',
  'ecosia.',
  'startpage.',
  'kagi.',
  'perplexity.',
  'yandex.',
  'baidu.',
]

function isSearchHost(hostname) {
  const host = hostname.toLowerCase()
  for (const marker of SEARCH_HOSTS) {
    if (host === marker.replace(/\.$/, '') || host.includes(marker)) return true
  }
  return false
}

function hasSearchSegment(pathname) {
  for (const segment of pathname.toLowerCase().split('/')) {
    if (segment !== '' && SEARCH_SEGMENTS.has(segment)) return true
  }
  return false
}

/**
 * The search term, if this URL is genuinely a search. Null otherwise.
 *
 * Returns the term rather than a boolean because the term is the useful thing
 * to have — it is the clearest statement of intent available without asking —
 * and because a function that hands back what it found is much harder to
 * misread than one that hands back `true`.
 */
export function searchTermOf(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (!isSearchHost(url.hostname) && !hasSearchSegment(url.pathname)) return null

  for (const param of QUERY_PARAMS) {
    const value = url.searchParams.get(param)
    // One character is a typo or a pagination cursor, not a subject.
    if (value && value.trim().length > 1) return value.trim()
  }
  return null
}

/** Did this page come from searching? The predicate the ambient classifier
 *  needs, on top of the term. */
export function looksLikeSearch(raw) {
  return searchTermOf(raw) !== null
}
