/**
 * The worker's own browser.
 *
 * ── Separate from the person's browser, always ───────────────────────────
 *
 * ADR-0002 rejected consolidating this with the extension. A shared browser
 * would put the worker one `page.click()` from acting inside the person's
 * authenticated session — every safety property in the gate assumes the worker
 * cannot do that.
 *
 * So: its own process, a fresh ephemeral context per fetch, no profile, no
 * cookies, no credentials. It is a reader that happens to run a JS engine.
 *
 * ── Why a browser rather than fetch() ────────────────────────────────────
 *
 * A plain `fetch` returns the HTML shell for most modern pages, and a partner
 * programme's pricing table is exactly the kind of thing rendered client-side.
 * Reading a shell and reporting it as the page's content would be a quiet lie
 * to inference — worse than failing, because nothing looks wrong.
 *
 * ── A redirect is refused BEFORE it is taken ─────────────────────────────
 *
 * *(Added 2026-09-03, a day after `src/policy/http-fetcher.ts` was fixed the
 * same way. What was here before is worth stating, because it is the shape most
 * browser readers have and it reads as safe.)* This used to `page.goto(url)`
 * and then compare `new URL(page.url()).origin` against the origin it was
 * asked for. The refusal was real and the page was never read — but Chromium
 * had already completed a full request to the second host by the time it ran,
 * so that host learned the person's IP, their TLS fingerprint and the moment.
 * `docs/SECURITY_AND_PRIVACY.md` §5 promises *"an unapproved host is never
 * asked and never learns you looked"*; this path made it false.
 *
 * It was **less** exposed than the app process's reader — its own OS process,
 * an ephemeral context, no cookies, no credentials, and an origin the gate
 * authorised rather than one typed into a box — and *less* is not *none*.
 *
 * So a request interceptor sits in front of the context now. Every main-frame
 * navigation that came from a redirect is judged by `judgeHop` in
 * `redirect.ts` — the same function, on the same argument, that the app
 * process's reader uses — and a vetoed hop is `route.abort`ed, which stops the
 * request rather than reading its answer. The interceptor is deliberately
 * thin: it counts hops and aborts, and every decision in it belongs to the
 * shared function.
 *
 * The whole allowlist is re-checked per hop, not the origin half of it. A
 * contract that approved `https://northwind.example.com/partners/*` no longer
 * lands on `/pricing` by redirect. That is why this takes a
 * `FollowingFetcher`'s `boundTo` rather than deriving an origin from the
 * address: a reader cannot re-check a pattern it was never handed, and the type
 * is what makes handing it none fail to compile.
 *
 * ── Extraction keeps hidden text on purpose ──────────────────────────────
 *
 * `innerText` excludes only `display:none` and `visibility:hidden`. `opacity:0`,
 * zero-size fonts, white-on-white and off-screen text all survive — and that is
 * the point. Hiding text from a human while leaving it legible to a model is
 * what an injection does, so we WANT it captured. It is sanitised at the ledger
 * and flagged, never filtered here.
 *
 * We read from the LIVE document, never a clone: extracting from a detached
 * container silently degrades to `textContent`, which filters nothing and would
 * change what we capture without any error.
 *
 * ── What this does NOT cover, and it is the interesting half ─────────────
 *
 * **No test in this repository launches a browser, and this file is therefore
 * not executed by one.** `tests/redirect-hop.test.ts` unit-tests `judgeHop`
 * exhaustively and then *greps* this file to pin that the interceptor is wired
 * to it and that the old follow-then-check is gone. A grep cannot prove that
 * Playwright calls the handler for a redirected request, that `route.abort`
 * stops the request before it leaves the machine, or that the handler is
 * registered before the first navigation. Those are read off Playwright's
 * documented behaviour and they are the part a browser test would earn.
 *
 * **The post-hoc `page.url()` check is kept, as a stated backstop.** If
 * interception is ever bypassed — a Playwright change, a service worker, a
 * shape of navigation the handler does not see — the landing address is still
 * checked against the whole allowlist before a word is read. That refusal is
 * *after the fact* and buys nothing on privacy; it stops the text of an
 * unapproved page reaching a prompt, which is a different and still worth
 * having.
 *
 * **It says nothing about what the page embeds.** Images, stylesheets, scripts,
 * fonts, XHR and iframes are not navigations and are not judged. A page on an
 * approved source that pulls a pixel from somewhere else still tells that
 * somewhere else the worker looked. That is what a browser is, it predates this
 * change, and closing it means a subresource policy with a real cost to what
 * pages read correctly. `docs/SECURITY_AND_PRIVACY.md` §2 states it.
 */

import type { Browser, Route } from 'playwright'
import { EXCERPT_BUDGET_CHARS } from '../model/untrusted'
import { isAllowed } from './fetcher'
import type { FetchedSource, FollowingFetcher, SourceFetcher } from './fetcher'
import {
  MAX_REDIRECTS,
  RedirectedOffSourceError,
  TooManyRedirectsError,
  judgeHop,
  refusalOf,
} from './redirect'

export interface PlaywrightFetcherOptions {
  /** Per-page ceiling. A worker waiting 30s on a dead source burns budget the
   *  person set aside for work. */
  readonly timeoutMs?: number
  readonly headless?: boolean
}

export async function createPlaywrightFetcher(
  options: PlaywrightFetcherOptions = {},
): Promise<FollowingFetcher> {
  // Imported lazily so the app and the test suite never pay for it — only the
  // worker process actually launches a browser.
  const { chromium } = await import('playwright')

  const timeout = options.timeoutMs ?? 15_000
  let browser: Browser | null = null

  const ensure = async (): Promise<Browser> => {
    browser ??= await chromium.launch({ headless: options.headless ?? true })
    return browser
  }

  async function read(url: string, allowlist: readonly string[]): Promise<FetchedSource> {
    const b = await ensure()

    // A fresh context per fetch. Nothing carries between pages — no cookies,
    // no storage, no chance of one source seeing another's state.
    // No `storageState` key at all — omitting it IS the no-stored-state
    // default, and passing `undefined` explicitly is a type error under
    // exactOptionalPropertyTypes. No cookies, no credentials, nothing carried.
    const context = await b.newContext({ javaScriptEnabled: true })

    try {
      /**
       * Why the refusal is recorded rather than thrown.
       *
       * A route handler runs inside Playwright's own dispatch; an exception
       * from it is swallowed and the navigation fails with a network error
       * that names nothing. So the handler aborts and puts the reason here,
       * and `goto`'s rejection is translated into it below. The first refusal
       * wins — a chain can produce several and the first is the one that
       * describes what actually happened.
       */
      let refused: Error | null = null
      let hops = 0

      // Registered on the CONTEXT and before any page exists, so there is no
      // window in which a navigation could start unjudged.
      //
      // A RegExp rather than Playwright's usual match-everything glob, and the
      // reason is a guard rather than a preference. That glob is written with a
      // slash next to a star, and `tests/reachability.test.ts` strips comments
      // with a regex that cannot tell such a pair inside a string from one
      // opening a block comment — so it deleted this whole function from its
      // view and reported that nothing here called `judgeHop`. Same class of
      // bug as the one `tests/support/strip-comments.ts` was extracted for, and
      // measured rather than guessed at. `/.*/` matches every request and holds
      // no such pair.
      await context.route(/.*/, async (route: Route) => {
        const request = route.request()

        // Only main-frame navigations. Subresources and iframes are a
        // different exposure and this is not it — the header says so.
        if (!request.isNavigationRequest() || request.frame().parentFrame() !== null) {
          return route.continue()
        }

        const previous = request.redirectedFrom()
        // The address we were asked for. `allowlisted()` in `fetcher.ts`
        // already checked it against these same patterns; re-judging it here
        // would answer the same question for a different reason.
        if (previous === null) return route.continue()

        hops += 1
        if (hops > MAX_REDIRECTS) {
          refused ??= new TooManyRedirectsError(url, MAX_REDIRECTS)
          return route.abort('blockedbyclient')
        }

        // Chromium has already resolved a relative `Location`, so this arrives
        // absolute. `judgeHop` handles both, which is why it is the same call
        // the app process's reader makes.
        const verdict = judgeHop(previous.url(), request.url(), allowlist)
        if (!verdict.taken) {
          refused ??= refusalOf(previous.url(), verdict)
          return route.abort('blockedbyclient')
        }

        return route.continue()
      })

      const page = await context.newPage()

      try {
        await page.goto(url, { timeout, waitUntil: 'domcontentloaded' })
      } catch (error) {
        // A blocked hop reaches here as `net::ERR_BLOCKED_BY_CLIENT`, which
        // says nothing a person could act on. The recorded refusal does.
        if (refused !== null) throw refused
        throw error
      }
      if (refused !== null) throw refused

      // The backstop, not the mechanism — see the header. Against the whole
      // allowlist rather than an origin, so a hop that stayed on the host and
      // left the approved path is caught here as well as above.
      const landed = page.url()
      if (!isAllowed(landed, allowlist)) {
        throw new RedirectedOffSourceError(url, new URL(landed).origin)
      }

      const title = await page.title()

      const text = await page.evaluate((budget: number) => {
        // Live document, never a clone — see the header.
        const main = document.querySelector('main, article, [role="main"]') ?? document.body
        return (main as HTMLElement).innerText.slice(0, budget)
      }, EXCERPT_BUDGET_CHARS)

      return { url: landed, title, text }
    } finally {
      await context.close()
    }
  }

  /**
   * No `fetch` on what comes back — see `FollowingFetcher`. The browser is
   * shared across bindings; `close()` on either shape closes it, which is what
   * `scripts/worker.ts` calls on shutdown.
   */
  return {
    boundTo: (allowlist: readonly string[]): SourceFetcher => ({
      fetch: (url: string) => read(url, allowlist),
      close: async () => {
        await browser?.close()
        browser = null
      },
    }),

    async close() {
      await browser?.close()
      browser = null
    },
  }
}
