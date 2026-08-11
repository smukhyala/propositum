/**
 * What a stored URL is allowed to contain.
 *
 * ── Why this is its own file ─────────────────────────────────────────────
 *
 * `semantics.ts` imports a type from the ledger writer, and the ledger writer
 * now needs `cleanUrl` — so the two would import each other. This file has no
 * imports at all, which is the property that keeps the cycle from existing and
 * keeps the privacy rule cheap enough to call at the innermost write.
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

/** Query parameters that carry a search term, by convention across engines and
 *  site search. A closed list — guessing at arbitrary parameters would capture
 *  things the person did not search for. */
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

/** The search term, if this URL is a search. Only from the closed parameter
 *  list — otherwise a `?ref=` would become a "search". */
export function searchTermOf(raw: string): string | null {
  try {
    const url = new URL(raw)
    for (const param of QUERY_PARAMS) {
      const value = url.searchParams.get(param)
      if (value && value.trim().length > 1) return value.trim()
    }
  } catch {
    /* not a URL */
  }
  return null
}
