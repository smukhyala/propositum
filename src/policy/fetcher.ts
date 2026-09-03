/**
 * The worker's own browser, and the second allowlist check.
 *
 * ── Why a second check ───────────────────────────────────────────────────
 *
 * The gate already refused any source outside `ContractScope`. This checks
 * again, at the moment of the request, against the same allowlist.
 *
 * That is not redundancy for its own sake. The gate authorises an
 * `approvedSourceId`; this resolves that id to a URL and fetches it. Between
 * those two steps sits a lookup, and a lookup is a place where the wrong row
 * can be returned. Checking the URL that is actually about to be requested
 * closes the gap between "we authorised source X" and "we fetched X".
 *
 * ── Separate from the human's browser, always ────────────────────────────
 *
 * ADR-0002 kept the worker's Playwright process apart from the extension: a
 * consolidated browser would put the worker one `page.click()` from acting
 * inside the person's authenticated session. Own process, ephemeral context, no
 * credentials, no profile.
 *
 * ── Extraction hygiene is the interesting part ───────────────────────────
 *
 * `innerText` excludes only `display:none` and `visibility:hidden`. Everything
 * else survives: `opacity:0`, zero-size fonts, white-on-white, off-screen text.
 * And extracting from a DETACHED container silently degrades to `textContent`,
 * which filters nothing at all.
 *
 * That is a feature here, not a bug to fix — we WANT the hidden text, because
 * hiding it is what an attacker does and the person deserves to be told. It is
 * captured, sanitised at the ledger door, and flagged.
 */

export interface FetchedSource {
  readonly url: string
  readonly title: string
  /** RAW. Datamarked by the ledger writer, which is the only door. */
  readonly text: string
}

export interface SourceFetcher {
  fetch(url: string): Promise<FetchedSource>
  close(): Promise<void>
}

/**
 * A reader that follows redirects on its own, and therefore cannot read
 * anything until it holds the allowlist each hop is judged against.
 *
 * ── The absence is the mechanism ─────────────────────────────────────────
 *
 * **There is no `fetch` on this interface.** That is the whole design: both
 * real readers — `httpFetcher` and `createPlaywrightFetcher` — return one of
 * these rather than a `SourceFetcher`, so *"follow a hop without re-checking
 * the pattern"* is not a mistake somebody has to remember not to make, it is a
 * call that does not typecheck. It is the same move
 * `src/policy/page-import.ts` makes with `allowlisted()` one layer up, and for
 * the same reason: a construction site beats a review note.
 *
 * `allowlisted()` below is the binder, so the allowlist a hop is judged against
 * and the allowlist the first address is checked against are one list, passed
 * once. A caller may bind directly, but only by naming a list.
 *
 * ── What it does NOT promise ─────────────────────────────────────────────
 *
 * **It says nothing about what the reader does with the list.** The type gets
 * the patterns into the reader; `judgeHop` in `redirect.ts` is what decides
 * with them, and `tests/redirect-hop.test.ts` is what says both readers call
 * it. A `boundTo` that ignored its argument would still compile.
 *
 * **`fixtureFetcher` is not one of these**, deliberately. It follows nothing
 * and has no hop to judge, so requiring a list of it would be ceremony. The
 * union in `allowlisted()` is what lets both shapes through one door.
 */
export interface FollowingFetcher {
  boundTo(allowlist: readonly string[]): SourceFetcher
  close(): Promise<void>
}

export class SourceNotAllowedError extends Error {
  constructor(url: string) {
    super(
      `Refused to fetch ${url}: not in the contract's approved sources.\n\n` +
        'The gate should have refused this before a fetcher was reached. If you are ' +
        'seeing this, an authorised source id resolved to a URL outside the allowlist — ' +
        'which is a lookup bug, not a permissions one.',
    )
    this.name = 'SourceNotAllowedError'
  }
}

/**
 * Match a URL against an origin pattern like `https://northwind.example.com/*`.
 *
 * Deliberately simple and deliberately strict: exact origin, then a path
 * prefix. No regex from configuration, no wildcards in the host — a pattern
 * language rich enough to be clever is rich enough to be wrong.
 */
export function matchesPattern(url: string, pattern: string): boolean {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return false
  }

  // Only ever http(s). A `file:` or `data:` URL reaching here would be a way
  // out of the allowlist entirely.
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false

  // `'/\u002a'` is the two characters `/` and `*`, written as an escape so
  // they do not sit next to each other in the source. Spelled literally,
  // they open a block comment to `tests/reachability.test.ts`'s stripper,
  // which then eats everything to the next close marker — here that was the
  // docblock below, taking `isAllowed`'s declaration with it and leaving the
  // guard blind to a function it is supposed to be pinning. Third instance
  // of that class in this repository; the stripper's own docblock records
  // the first two, and `hides no declaration from the stripper` in
  // `tests/reachability.test.ts` is what now catches a fourth.
  const [patternOrigin, ...rest] = pattern.split('/\u002a')
  if (rest.length === 0) return url === pattern

  let allowed: URL
  try {
    allowed = new URL(patternOrigin!)
  } catch {
    return false
  }

  return target.origin === allowed.origin && target.pathname.startsWith(allowed.pathname)
}

export function isAllowed(url: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchesPattern(url, p))
}

/**
 * Wraps any fetcher with the allowlist check, so no implementation can forget.
 *
 * It is also where a `FollowingFetcher` becomes usable at all — *(added
 * 2026-09-03)*. A reader that follows its own redirects has no `fetch` until it
 * is told which addresses a hop may land on, and this is the one place in
 * production that tells it. So the list the first address is checked against
 * and the list every subsequent hop is judged against are the same list, by
 * construction rather than by two call sites agreeing.
 */
export function allowlisted(
  inner: SourceFetcher | FollowingFetcher,
  patterns: readonly string[],
): SourceFetcher {
  const reader = 'boundTo' in inner ? inner.boundTo(patterns) : inner
  return {
    async fetch(url) {
      if (!isAllowed(url, patterns)) throw new SourceNotAllowedError(url)
      return reader.fetch(url)
    },
    close: () => reader.close(),
  }
}

/**
 * A fetcher backed by a fixture map. Used by the eval harness and tests.
 *
 * Real browsing belongs to a Playwright implementation behind this same
 * interface; keeping the seam here means the worker loop never knows which it
 * is talking to.
 */
export function fixtureFetcher(pages: Readonly<Record<string, FetchedSource>>): SourceFetcher {
  return {
    async fetch(url) {
      const page = pages[url]
      if (!page) throw new Error(`fixture fetcher has no page for ${url}`)
      return page
    },
    async close() {
      /* nothing to close */
    },
  }
}
