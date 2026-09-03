/**
 * Whether one redirect hop gets taken — decided before anything is asked of it.
 *
 * ── Why this is a file rather than two loops ─────────────────────────────
 *
 * Propositum has two readers. `src/policy/http-fetcher.ts` is the app process's
 * one, added by [ADR-0032](../../docs/adr/0032-a-page-from-a-source-already-approved.md)
 * for the page import; `src/policy/playwright-fetcher.ts` is the worker's
 * browser, older and separate for the reason ADR-0002 gives. On 2026-09-03 the
 * first was fixed to refuse an off-origin hop **before** requesting anything
 * from it, and the second was left following-then-checking. A day later that
 * divergence is the whole point of this file: the two readers now share one
 * decision, so neither can be fixed alone again.
 *
 * The decision is pure — no clock, no network, no browser. That matters more
 * here than usual, because **no test in this repository launches a browser**,
 * so the Playwright side's judgement cannot be exercised end to end. Extracting
 * it means the judgement is unit-tested exhaustively and only the wiring is
 * unproven. `tests/redirect-hop.test.ts` says exactly which half is which.
 *
 * ── The allowlist, not the origin ────────────────────────────────────────
 *
 * `isAllowed` and not an origin comparison, which is the second thing fixed
 * here. An `ApprovedSource` pattern has an origin half and a path-prefix half —
 * `https://northwind.example.com/partners/*` — and until now only the origin
 * half was re-checked per hop. A project that approved `/partners/*` could be
 * redirected to `/pricing`: the same host, the same bytes it was already
 * willing to serve, but a gap between the check at the door and the check on
 * the way. The full pattern is re-checked now, through `matchesPattern`, which
 * is the matcher the door itself uses. There is deliberately no second matcher
 * — one that drifted from the first would be worse than the gap it closed.
 *
 * ── What this does NOT decide ────────────────────────────────────────────
 *
 * **It does not decide the first request.** The address a reader is handed was
 * checked by `allowlisted()` in `fetcher.ts`, against the same patterns. This
 * judges hops two onward, and a reader that called it on hop one would get the
 * same answer for a different reason.
 *
 * **It does not bound the chain.** `MAX_REDIRECTS` lives here so both readers
 * count to the same number, but counting is the caller's — this function is
 * given one hop and knows nothing about the ones before it.
 *
 * **It says nothing about subresources.** A page's own images, stylesheets,
 * scripts and iframes are a separate exposure, they are not navigations, and
 * the worker's browser has always loaded them. `docs/SECURITY_AND_PRIVACY.md`
 * §3 states that; closing it is a different change with a different cost.
 */

import { isAllowed } from './fetcher'

/**
 * How many hops either reader will take before giving up.
 *
 * Five, because a redirect chain longer than that on a page somebody wants to
 * read is a misconfiguration rather than a route, and because the bound has to
 * exist at all: a reader that owns its own following owns a loop that can be
 * made to run for ever. Refusing past the bound rather than returning the last
 * response, so a chain that never arrives is never reported as a page that did.
 */
export const MAX_REDIRECTS = 5

/** The statuses that carry a `Location` and mean *ask somewhere else*. */
export const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])

/**
 * What a refused hop is refused for. A closed set of three, because each is a
 * different sentence and collapsing them would turn *"that host is not one of
 * yours"* into *"something went wrong"* — the distinction a person most needs.
 */
export type HopRefusal =
  /** Outside the allowlist: a different origin, or the same one off the path
   *  prefix that was approved. `named` is what the person is told. */
  | { readonly taken: false; readonly refusal: 'off_source'; readonly named: string }
  /** A `Location` that did not parse, or that is not `http(s)`. Nothing of it
   *  is echoed back — a `data:` payload is not an address and not a sentence. */
  | { readonly taken: false; readonly refusal: 'not_an_address' }
  /** A redirect status with no `Location` at all. */
  | { readonly taken: false; readonly refusal: 'unstated' }

export type HopVerdict = { readonly taken: true; readonly url: string } | HopRefusal

export class RedirectedOffSourceError extends Error {
  constructor(from: string, to: string) {
    super(`${from} redirected to ${to}, which is outside the source that was approved`)
    this.name = 'RedirectedOffSourceError'
  }
}

export class TooManyRedirectsError extends Error {
  constructor(url: string, hops: number) {
    super(`${url} redirected more than ${hops} times without arriving anywhere`)
    this.name = 'TooManyRedirectsError'
  }
}

/**
 * Judge one hop.
 *
 * `from` is the address that issued the redirect — not the address the person
 * asked for — because `Location` is routinely relative and a relative one is
 * resolved against the hop that sent it. `location` is what that hop said, raw:
 * either an absolute address or a relative one, or `null` when it said nothing.
 *
 * A verdict, never an exception. `refusalOf` below turns a refusal into the
 * error a reader throws, so both readers say the same sentence for the same
 * refusal.
 */
export function judgeHop(
  from: string,
  location: string | null,
  allowlist: readonly string[],
): HopVerdict {
  if (location === null || location.trim() === '') {
    return { taken: false, refusal: 'unstated' }
  }

  let next: URL
  try {
    next = new URL(location, from)
  } catch {
    return { taken: false, refusal: 'not_an_address' }
  }

  // `matchesPattern` refuses these too. Refusing here as well is what makes the
  // SENTENCE right, exactly as `page-import.ts` argues for the typed address: a
  // `data:` Location is not an unapproved source, it is not an address, and
  // naming an origin of `null` would be the wrong thing to tell somebody.
  if (next.protocol !== 'https:' && next.protocol !== 'http:') {
    return { taken: false, refusal: 'not_an_address' }
  }

  if (!isAllowed(next.href, allowlist)) {
    // Which half failed decides what is worth naming. An off-origin hop is
    // named by its origin and nothing more — the path a host redirects to can
    // carry a token it generated about this read, and repeating it back on
    // screen would publish it. A hop that stayed on the approved host has no
    // such secret in it, and the path is the whole of what went wrong, so it
    // is named: *"redirected to https://northwind.example.com/pricing"* is a
    // refusal somebody can act on and a bare origin is not.
    const sameHost = originOf(from) === next.origin
    return {
      taken: false,
      refusal: 'off_source',
      named: sameHost ? next.origin + next.pathname : next.origin,
    }
  }

  return { taken: true, url: next.href }
}

/** The error a refused hop becomes. Shared so the two readers cannot drift into
 *  two vocabularies for one refusal. */
export function refusalOf(from: string, verdict: HopRefusal): Error {
  switch (verdict.refusal) {
    case 'off_source':
      return new RedirectedOffSourceError(from, verdict.named)
    case 'not_an_address':
      return new Error(`${from} redirected to something that is not an address`)
    case 'unstated':
      return new Error(`${from} answered a redirect without saying where to`)
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
