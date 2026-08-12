/**
 * Types for `search-url.js`, so a test can import the file Chrome actually
 * runs.
 *
 * ── This is not a build step ─────────────────────────────────────────────
 *
 * The extension deliberately has none: the thing under review has to be the
 * thing Chrome executes, which would be an unhelpful property to give up in
 * the component holding the privacy guarantee. A `.d.ts` does not change that.
 * It emits nothing, Chrome never sees it, and `search-url.js` is loaded byte
 * for byte as written. What it buys is that `tests/search-url.test.ts` can
 * exercise the real predicate under `noImplicitAny` instead of a retyped copy
 * of it — and a retyped copy is exactly how the two would drift.
 */

export declare const QUERY_PARAMS: string[]

/** The search term, if this URL is genuinely a search. Null otherwise. */
export declare function searchTermOf(raw: string): string | null

/** Did this page come from searching? */
export declare function looksLikeSearch(raw: string): boolean
