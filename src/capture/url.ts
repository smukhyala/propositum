/**
 * What a stored URL is allowed to contain.
 *
 * ── Why this is its own file ─────────────────────────────────────────────
 *
 * `semantics.ts` imports a type from the ledger writer, and the ledger writer
 * now needs `cleanUrl` — so the two would import each other. This file sits
 * below both, which is the property that keeps the cycle from existing and
 * keeps the privacy rule cheap enough to call at the innermost write.
 *
 * Its one import is `searchQueryOf` from the domain, which imports nothing at
 * all. That direction is safe and is the point: the domain is the lowest layer
 * here, and a capture rule that disagreed with it about what a search is would
 * be a second opinion in the layer least able to afford one.
 *
 * ── The promise this file holds ──────────────────────────────────────────
 *
 * `docs/SECURITY_AND_PRIVACY.md` says Propositum keeps a *cleaned* URL:
 * query parameters stripped except a recognised search term. That promise is
 * about what is COLLECTED AND STORED. A raw URL crossing loopback to a local
 * process on the same machine, behind four transport controls, is not exposure;
 * the same URL persisted in `observation_event.attested` is.
 *
 * So the stripping happens server-side before the row is written, and the
 * innermost caller is the ledger writer — the one door. Doing it in the
 * extension's `content.js` instead would mean duplicating this into untyped
 * plain JS, and the copy holding the promise would be the untested one.
 */

import { searchQueryOf } from '../domain/detection/topics'

/**
 * Query parameters that carry a search term, by convention across engines and
 * site search. A closed list — guessing at arbitrary parameters would capture
 * things the person did not search for.
 *
 * Deliberately WIDER than the domain's `SEARCH_PARAMS`, and the asymmetry is
 * the right way round. This list decides what survives `cleanUrl`, where being
 * generous costs a slightly longer stored URL. That list decides whether
 * something was a search, where being generous costs a false offer. Every
 * parameter the domain recognises appears here, or its rule could never fire
 * against a cleaned URL.
 */
export const QUERY_PARAMS = ['q', 'query', 'search', 's', 'k', 'p'] as const

/**
 * Strip everything that is not needed to identify the page.
 *
 * Credentials go because a URL is not a place to keep one. Tracking parameters
 * go because they are noise at best and identifying at worst. The fragment goes
 * because it never reaches a server and says nothing about what was read.
 *
 * A string that is not a URL is returned unchanged rather than thrown on — a
 * malformed URL is a ledger-writer fact, and the writer's own schema is what
 * decides whether the row is admissible.
 */
export function cleanUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }

  url.hash = ''
  url.username = ''
  url.password = ''

  const keep = new URLSearchParams()
  for (const [key, value] of url.searchParams) {
    if ((QUERY_PARAMS as readonly string[]).includes(key.toLowerCase())) keep.set(key, value)
  }
  url.search = keep.toString()

  return url.toString()
}

/**
 * The search term, if this URL is a search.
 *
 * ── One answer to "was that a search", and it lives in the domain ────────
 *
 * This used to have an opinion of its own: any of `QUERY_PARAMS` with a value
 * longer than one character. That is far too generous, because the list above
 * is answering a different question — what may be STORED, where keeping one
 * parameter too many costs a slightly longer URL. Here it cost truthfulness:
 * `blog.example.com/?p=1417` was recorded as `queried`, and the timeline said
 * *searched for "1417"* about somebody who had clicked a link.
 *
 * `searchQueryOf` is the structural test — a recognised parameter, a path that
 * names searching, and a value a person could plausibly have typed. It lives in
 * the domain because that is where a wrong answer is most expensive: a search
 * is an INTENT ground, and the whole "did they pursue this or merely receive
 * it" half of the offer bar rests on it.
 *
 * So there is one answer, in one place, and this defers to it. The extension
 * holds a hand-ported copy — it cannot import TypeScript, deliberately — and
 * `tests/search-url.test.ts` asserts the copy has not drifted.
 */
export function searchTermOf(raw: string): string | null {
  return searchQueryOf(raw)
}
