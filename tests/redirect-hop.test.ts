/**
 * A redirect hop is judged before it is taken, in both readers.
 *
 * ── What this is about ───────────────────────────────────────────────────
 *
 * Propositum has two readers and they used to disagree. `http-fetcher.ts` was
 * fixed on 2026-09-03 to refuse an off-origin hop before requesting anything
 * from it; `playwright-fetcher.ts` was left following-then-checking, so the
 * worker's browser completed a full request to an unapproved host and refused
 * it afterwards — by which time that host had the person's IP, their TLS
 * fingerprint and the moment. A second gap sat under both: the allowlist has an
 * origin half and a path-prefix half, and only the origin half was re-checked
 * per hop, so a contract that approved `/partners/*` could be redirected to
 * `/pricing`.
 *
 * Both are closed by one function — `judgeHop` in `src/policy/redirect.ts` —
 * and this file is in two halves accordingly:
 *
 *   1. **The decision, executed.** `judgeHop` is pure, so every case below runs
 *      for real: off-origin, off-path, relative `Location`, scheme downgrade,
 *      a `data:` address, a redirect that says nowhere, and the bound.
 *   2. **The wiring, grepped.** The Playwright side cannot be executed here,
 *      and the next section says exactly what that costs.
 *
 * ── This is a grep, and here is what a grep does not prove ───────────────
 *
 * **No test in this repository launches a browser, and none may start.** The
 * suite runs with no network and adding a Chromium launch to it would be a
 * large and unwelcome change. So the second half searches the text of
 * `src/policy/playwright-fetcher.ts` the way `tests/extension-cdp.test.ts`
 * searches the extension, and it therefore proves only that the code says the
 * right things. It does **not** prove:
 *
 *   - that Playwright calls a route handler for a request produced by a
 *     redirect, which is the load-bearing assumption of the whole mechanism;
 *   - that `route.abort()` stops the request before any packet leaves the
 *     machine, rather than after headers are on the wire;
 *   - that a handler registered on the context covers the first navigation of a
 *     page created afterwards;
 *   - that `page.goto` rejects, rather than resolving, when the navigation it
 *     was waiting on is aborted;
 *   - anything at all about service workers, `<meta refresh>`, or a
 *     JavaScript-driven `location =` that Chromium may not route as a redirect.
 *
 * Those are read off Playwright's documented behaviour. They are exactly the
 * things a browser test would earn and this file does not. The post-hoc
 * `page.url()` check is kept in that file as a stated backstop for precisely
 * this reason, and the first assertion in the grep half is that it is still
 * there.
 *
 * ── And the two ways a grep guard silently stops guarding ────────────────
 *
 * Both defended against below, both learned the hard way in this repository
 * (`tests/extension-cdp.test.ts` tells the story). Comments are stripped first,
 * because this file's target carries eight paragraphs arguing about redirects
 * and a naive search would read the prose as the code. And there is a canary:
 * the calls that ARE expected must be present, so renaming or splitting the
 * file turns the suite red instead of quietly disarming every assertion.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { MAX_REDIRECTS, judgeHop, refusalOf } from '../src/policy/redirect'
import type { HopRefusal } from '../src/policy/redirect'
import { httpFetcher } from '../src/policy/http-fetcher'
import { stripComments } from './support/strip-comments'

const repo = fileURLToPath(new URL('..', import.meta.url))
const code = (relative: string) => stripComments(readFileSync(join(repo, relative), 'utf8'))

const PARTNERS = 'https://northwind.example.com/partners/*'
const ALLOW = [PARTNERS]
const FROM = 'https://northwind.example.com/partners'

/** Narrowed for the assertions, which all care about the refused arm. */
function refused(verdict: ReturnType<typeof judgeHop>): HopRefusal {
  expect(verdict.taken, 'the hop was taken when it should have been refused').toBe(false)
  return verdict as HopRefusal
}

/* -- the decision itself -------------------------------------------------- */

describe('a hop off the approved sources is refused', () => {
  it('refuses another host, and names only its origin', () => {
    // Only the origin, deliberately. The path a host redirects to can carry a
    // token it minted about this read; repeating it back on screen publishes
    // it, and the origin is the whole of what the person can act on.
    const verdict = refused(
      judgeHop(FROM, 'https://contoso.example.com/deal?who=northwind-reader', ALLOW),
    )

    expect(verdict.refusal).toBe('off_source')
    expect(verdict.refusal === 'off_source' && verdict.named).toBe('https://contoso.example.com')
    expect(refusalOf(FROM, verdict).message).toMatch(/outside the source that was approved/)
    expect(refusalOf(FROM, verdict).message).not.toContain('who=northwind-reader')
  })

  it('refuses a host that merely ends with an approved one', () => {
    const verdict = refused(judgeHop(FROM, 'https://evil-northwind.example.com/partners', ALLOW))
    expect(verdict.refusal).toBe('off_source')
  })

  it('refuses a scheme downgrade on the same host, because an origin is not a hostname', () => {
    const verdict = refused(judgeHop(FROM, 'http://northwind.example.com/partners', ALLOW))
    expect(verdict.refusal).toBe('off_source')
  })

  it('refuses everything when the allowlist is empty', () => {
    // The deny is the absence. A reader bound to nothing follows no hop at all.
    expect(refused(judgeHop(FROM, 'https://northwind.example.com/partners/2026', [])).refusal).toBe(
      'off_source',
    )
  })

  it('refuses a scheme that is not a web address, and echoes none of it', () => {
    for (const location of [
      'data:text/html,<script>fetch("https://contoso.example.com")</script>',
      'javascript:void 0',
      'file:///etc/passwd',
    ]) {
      const verdict = refused(judgeHop(FROM, location, ALLOW))
      expect(verdict.refusal, location).toBe('not_an_address')
      expect(refusalOf(FROM, verdict).message).not.toContain('contoso')
    }
  })

  it('refuses a redirect status that said nowhere', () => {
    expect(refused(judgeHop(FROM, null, ALLOW)).refusal).toBe('unstated')
    expect(refused(judgeHop(FROM, '   ', ALLOW)).refusal).toBe('unstated')
  })
})

describe('a hop inside the approved sources is taken', () => {
  it('follows the approved host moving its own page', () => {
    // The fix is not "refuse redirects". A host moving its own page is
    // ordinary, and the reading should get the page.
    const verdict = judgeHop(FROM, 'https://northwind.example.com/partners/2026', ALLOW)
    expect(verdict).toEqual({ taken: true, url: 'https://northwind.example.com/partners/2026' })
  })

  it('resolves a relative Location against the hop that issued it, not the first address', () => {
    // `Location` is routinely relative, and it is resolved against the hop that
    // SENT it — which is the whole reason `judgeHop` takes `from` rather than
    // the address the reader was originally handed.
    const second = 'https://northwind.example.com/partners/2026/'
    expect(judgeHop(second, 'terms', ALLOW)).toEqual({
      taken: true,
      url: 'https://northwind.example.com/partners/2026/terms',
    })
    expect(judgeHop(second, '/partners/current', ALLOW)).toEqual({
      taken: true,
      url: 'https://northwind.example.com/partners/current',
    })
  })

  it('a relative Location cannot leave the origin, and is not refused for trying', () => {
    expect(judgeHop(FROM, '../partners/current', ALLOW).taken).toBe(true)
  })
})

describe('the path prefix is re-checked per hop, not only at the door', () => {
  /**
   * The second residual. `matchesPattern` has an origin half and a path-prefix
   * half; until 2026-09-03 only the origin half was re-checked on a hop, so a
   * contract that approved `/partners/*` could be redirected to `/pricing`.
   * Same host, same bytes it was already willing to serve — but a gap between
   * two checks, and it is closed by judging with the whole pattern.
   */
  it('refuses a same-origin hop outside the approved prefix', () => {
    const verdict = refused(judgeHop(FROM, 'https://northwind.example.com/pricing', ALLOW))
    expect(verdict.refusal).toBe('off_source')
  })

  it('names the path when the host was approved, because that is what went wrong', () => {
    const verdict = refused(judgeHop(FROM, '/pricing', ALLOW))
    expect(verdict.refusal === 'off_source' && verdict.named).toBe(
      'https://northwind.example.com/pricing',
    )
  })

  it('allows the same hop when the allowlist covers the whole origin', () => {
    expect(
      judgeHop(FROM, 'https://northwind.example.com/pricing', ['https://northwind.example.com/*'])
        .taken,
    ).toBe(true)
  })

  it('uses the matcher the door itself uses, rather than a second one', () => {
    // A pattern with no `/*` is an exact-address allowlist in
    // `matchesPattern`, and a hop is judged by exactly that rule. The value
    // here is not the rule — it is that there is only one place stating it.
    const exact = ['https://northwind.example.com/partners']
    expect(judgeHop(FROM, 'https://northwind.example.com/partners', exact).taken).toBe(true)
    expect(judgeHop(FROM, 'https://northwind.example.com/partners/2026', exact).taken).toBe(false)
  })

  it('inherits the looseness of that matcher, which is stated rather than fixed here', () => {
    // `/partners` as a prefix also covers `/partnerships`, because the check is
    // `startsWith` on the pathname. That is pre-existing behaviour of the door
    // itself; sharing the matcher means sharing this, and a second matcher that
    // did not would be the worse of the two problems.
    expect(judgeHop(FROM, 'https://northwind.example.com/partnerships', ALLOW).taken).toBe(true)
  })
})

describe('the chain is bounded, and both readers count to the same number', () => {
  it('the app process reader stops at MAX_REDIRECTS', async () => {
    const asked: string[] = []
    // A host that redirects to itself for ever, inside its own approved path.
    const impl = (async (input: string | URL) => {
      asked.push(String(input))
      return new Response(null, { status: 302, headers: { location: FROM } })
    }) as unknown as typeof fetch

    await expect(
      httpFetcher({ fetchImpl: impl }).boundTo(ALLOW).fetch(FROM),
    ).rejects.toThrow(/redirected more than \d+ times/)

    // One request for the address itself, then one per hop it was willing to
    // take. Asserted as a bound rather than an equality because the loop's own
    // shape is the fetcher's business and the number is not.
    expect(asked.length).toBeLessThanOrEqual(MAX_REDIRECTS + 2)
    expect(asked.length).toBeGreaterThan(1)
  })

  it('neither reader carries a bound of its own', () => {
    // The point of moving the constant. Two readers counting to two different
    // numbers is the shape this whole change exists to end.
    for (const file of ['src/policy/http-fetcher.ts', 'src/policy/playwright-fetcher.ts']) {
      expect(code(file), `${file} declares its own hop bound`).not.toMatch(
        /const\s+MAX_REDIRECTS\s*=/,
      )
      expect(code(file), `${file} does not use the shared bound`).toContain('MAX_REDIRECTS')
    }
  })

  it('neither reader carries its own list of redirect statuses', () => {
    for (const file of ['src/policy/http-fetcher.ts', 'src/policy/playwright-fetcher.ts']) {
      expect(code(file), `${file} spells out redirect statuses of its own`).not.toMatch(/\b30[1238]\b/)
    }
    expect(code('src/policy/redirect.ts')).toMatch(/\b301\b/)
  })
})

/* -- the wiring, which is a grep ----------------------------------------- */

describe('the browser in the worker process routes every hop through the shared decision', () => {
  const fetcher = code('src/policy/playwright-fetcher.ts')

  it('the canary: the other guard\u2019s stripper can still see this file', () => {
    /**
     * `tests/reachability.test.ts` asserts that both readers call `judgeHop`,
     * and it strips comments with a regex that cannot tell a slash next to a
     * star inside a string from one opening a block comment. Playwright's
     * match-everything route glob is written with exactly that pair, and it
     * deleted the whole `read` function from that guard's view — the assertion
     * went red for a file that was correct. This pins the fix: whatever the
     * interceptor matches on, the naive stripper must still see the call.
     */
    const naive = readFileSync(join(repo, 'src/policy/playwright-fetcher.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

    expect(naive, 'a comment marker in this file blinds the reachability guard').toContain(
      'judgeHop(',
    )
  })

  it('the canary: the file is still where this test looks, and still a browser', () => {
    // A guard that searches a file which no longer exists passes for ever.
    // Every assertion below is an argument about this text, so if these two
    // stop matching the assertions have stopped meaning anything.
    expect(fetcher).toContain('chromium.launch(')
    expect(fetcher).toContain('page.goto(')
  })

  it('intercepts requests and vetoes a hop with the shared function', () => {
    expect(fetcher, 'no request interceptor — nothing can refuse before the hop').toContain(
      'context.route(',
    )
    expect(fetcher, 'the interceptor does not consult the shared decision').toContain('judgeHop(')
    expect(fetcher, 'a vetoed hop is not actually stopped').toContain("route.abort('blockedbyclient')")
    expect(fetcher, 'a hop is judged against the address that issued it').toContain(
      'redirectedFrom()',
    )
  })

  it('registers the interceptor before anything can navigate', () => {
    // Positional, because ordering is the whole of it: a handler installed
    // after the page exists leaves a window in which a navigation is unjudged.
    expect(fetcher.indexOf('context.route(')).toBeGreaterThan(-1)
    expect(
      fetcher.indexOf('context.route('),
      'the route handler is registered after the page is created',
    ).toBeLessThan(fetcher.indexOf('context.newPage('))
  })

  it('the follow-then-check it used to have is gone', () => {
    // What shipped before was `page.goto(url)`, then
    // `new URL(page.url()).origin !== requestedOrigin`. The comparison is the
    // tell: an origin equality standing in for the allowlist is both defects at
    // once, and it is what this asserts is absent.
    expect(fetcher, 'an origin comparison is being used as the check again').not.toMatch(
      /Origin\s*(!==|===)/,
    )
    expect(fetcher).not.toContain('requestedOrigin')
  })

  it('keeps the post-hoc check as a backstop, against the whole allowlist', () => {
    // Stated as a backstop in that file's header and asserted here, because it
    // is the only thing left if interception is ever bypassed — and because
    // deleting it would look like a tidy-up.
    expect(fetcher, 'the landing address is no longer checked at all').toContain('page.url()')
    expect(fetcher, 'the backstop checks an origin rather than the allowlist').toContain(
      'isAllowed(',
    )
  })

  it('the judgement is shared and not copied, which is the point', () => {
    // Both readers, one function. A second implementation that drifted from the
    // first is the failure this whole change exists to prevent, so it is
    // asserted rather than trusted.
    expect(code('src/policy/http-fetcher.ts')).toContain('judgeHop(')
    expect(fetcher).toContain('judgeHop(')
    expect(code('src/policy/redirect.ts'), 'the decision does not use the matcher the door uses').toContain(
      'isAllowed(',
    )
  })

  it('the allowlist reaches it as an argument rather than a derived origin', () => {
    // The type half of the fix. A reader with no allowlist has no `fetch`, so
    // "follow a hop without re-checking the pattern" is a call that does not
    // compile — see `FollowingFetcher` in `src/policy/fetcher.ts`.
    for (const file of ['src/policy/http-fetcher.ts', 'src/policy/playwright-fetcher.ts']) {
      expect(code(file), `${file} no longer returns a reader that must be bound`).toContain(
        'FollowingFetcher',
      )
      expect(code(file), `${file} does not take an allowlist to judge hops against`).toContain(
        'boundTo',
      )
    }
    expect(code('src/policy/fetcher.ts'), 'nothing binds the reader in production').toContain(
      "'boundTo' in inner",
    )
  })
})
