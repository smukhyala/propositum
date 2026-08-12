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
 * ── This is a HAND PORT of `searchQueryOf`, not a second opinion ─────────
 *
 * The rule lives in `src/domain/detection/topics.ts`, in code the extension
 * cannot widen, and everything below is that rule transcribed. Structural
 * rather than a list of search engines: a recognised parameter, a path that
 * names searching, and a value that looks like words rather than an id. A brand
 * list would need endless maintenance and would still miss the next engine —
 * the same argument that kept a blocklist out of thread detection.
 *
 * It is deliberately possible for this to say no to a real search on some site
 * with an unusual shape. A missed search costs one ground; a false one costs an
 * interruption, and ADR-0008 names which of those is the expensive failure.
 *
 * ── Why a port and not an import ─────────────────────────────────────────
 *
 * The extension has no build step, on purpose: the thing under review has to be
 * the thing Chrome runs, which would be an unhelpful property to give up in the
 * component holding the privacy guarantee. So it cannot import TypeScript.
 * `tests/search-url.test.ts` runs both implementations over the same table of
 * URLs and fails if they ever disagree, which is the cheapest honest version of
 * a duplicated rule: the copy is allowed to exist and is not allowed to drift.
 *
 * ── And why the extension classifies at all, when the domain re-decides ──
 *
 * Because the app's copy of the rule reads a URL that has already been through
 * `cleanUrl`, and because a wrong `kind` on the wire is a wrong `kind` in the
 * buffer that the debug endpoint and the timeline both show. Two honest answers
 * that agree is not redundancy here; one honest answer and one that labels
 * every question mark a search is what this replaces.
 */

/**
 * Query parameters that carry something a person typed.
 *
 * Narrower than `src/capture/url.ts`'s `QUERY_PARAMS`, deliberately: that list
 * decides what may be STORED, where being generous costs a slightly longer URL.
 * Being generous HERE costs a false offer. `s` and `p` are the two dropped —
 * `?p=1234` is a WordPress post id and `?s=2` is page two of a listing at least
 * as often as either is a search.
 *
 * Kept identical to `SEARCH_PARAMS` in `src/domain/detection/topics.ts`.
 */
export const SEARCH_PARAMS = ['q', 'query', 'search', 'k']

/**
 * Paths that name searching: /search, /results, /find, Amazon's /s, /web.
 *
 * The root path counts too, because DuckDuckGo, Kagi and several others put the
 * query straight on the origin — `https://duckduckgo.com/?q=…`.
 *
 * Kept identical to `SEARCH_PATH` in `src/domain/detection/topics.ts`.
 */
const SEARCH_PATH = /^\/((search|results|find|web|s|sp)(\/|$).*)?$/i

/**
 * The thing they typed, if this URL is a search. Null otherwise.
 *
 * Returns the term rather than a boolean because the term is the useful thing
 * to have — it is the clearest statement of intent available without asking —
 * and because a function that hands back what it found is much harder to
 * misread than one that hands back `true`.
 */
export function searchQueryOf(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }

  // Not decoded: a search path is ASCII, and `decodeURIComponent` throws on a
  // stray `%` — a malformed URL must cost a ground, never a crash.
  if (!SEARCH_PATH.test(parsed.pathname)) return null

  for (const param of SEARCH_PARAMS) {
    const value = parsed.searchParams.get(param)
    if (value === null) continue

    const term = value.trim().toLowerCase().replace(/\s+/g, ' ')
    // Two characters and at least one letter. `?q=1` is a page number wearing a
    // search parameter's name, and an id is not something anybody typed.
    if (term.length >= 2 && /[a-z]/.test(term)) return term
  }

  return null
}

/** Did this page come from searching? The predicate the ambient classifier
 *  needs, on top of the term. */
export function looksLikeSearch(raw) {
  return searchQueryOf(raw) !== null
}
