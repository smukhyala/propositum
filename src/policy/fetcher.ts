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

  const [patternOrigin, ...rest] = pattern.split('/*')
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

/** Wraps any fetcher with the allowlist check, so no implementation can forget. */
export function allowlisted(inner: SourceFetcher, patterns: readonly string[]): SourceFetcher {
  return {
    async fetch(url) {
      if (!isAllowed(url, patterns)) throw new SourceNotAllowedError(url)
      return inner.fetch(url)
    },
    close: () => inner.close(),
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
