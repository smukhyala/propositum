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
 */

import type { Browser } from 'playwright'
import { EXCERPT_BUDGET_CHARS } from '../model/untrusted'
import type { FetchedSource, SourceFetcher } from './fetcher'

export interface PlaywrightFetcherOptions {
  /** Per-page ceiling. A worker waiting 30s on a dead source burns budget the
   *  person set aside for work. */
  readonly timeoutMs?: number
  readonly headless?: boolean
}

export async function createPlaywrightFetcher(
  options: PlaywrightFetcherOptions = {},
): Promise<SourceFetcher> {
  // Imported lazily so the app and the test suite never pay for it — only the
  // worker process actually launches a browser.
  const { chromium } = await import('playwright')

  const timeout = options.timeoutMs ?? 15_000
  let browser: Browser | null = null

  const ensure = async (): Promise<Browser> => {
    browser ??= await chromium.launch({ headless: options.headless ?? true })
    return browser
  }

  return {
    async fetch(url: string): Promise<FetchedSource> {
      const b = await ensure()

      // A fresh context per fetch. Nothing carries between pages — no cookies,
      // no storage, no chance of one source seeing another's state.
      // No `storageState` key at all — omitting it IS the no-stored-state
      // default, and passing `undefined` explicitly is a type error under
      // exactOptionalPropertyTypes. No cookies, no credentials, nothing carried.
      const context = await b.newContext({ javaScriptEnabled: true })

      try {
        const page = await context.newPage()

        // Never follow a redirect off the origin we were authorised for. The
        // allowlist check happened against the URL we were asked for; a
        // redirect could otherwise land us somewhere nobody approved.
        const requestedOrigin = new URL(url).origin

        await page.goto(url, { timeout, waitUntil: 'domcontentloaded' })

        const landedOrigin = new URL(page.url()).origin
        if (landedOrigin !== requestedOrigin) {
          throw new Error(
            `${url} redirected to ${landedOrigin}, which is outside the source that was approved`,
          )
        }

        const title = await page.title()

        const text = await page.evaluate((budget: number) => {
          // Live document, never a clone — see the header.
          const main =
            document.querySelector('main, article, [role="main"]') ?? document.body
          return (main as HTMLElement).innerText.slice(0, budget)
        }, EXCERPT_BUDGET_CHARS)

        return { url: page.url(), title, text }
      } finally {
        await context.close()
      }
    },

    async close() {
      await browser?.close()
      browser = null
    },
  }
}
