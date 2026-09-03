/**
 * The app process's reader. No browser, no credentials, no JavaScript.
 *
 * ── Why this is not the worker's fetcher ─────────────────────────────────
 *
 * `src/policy/playwright-fetcher.ts` launches Chromium, and its own header
 * argues why: a plain `fetch` returns the HTML shell for most modern pages, and
 * *"reading a shell and reporting it as the page's content would be a quiet lie
 * to inference — worse than failing, because nothing looks wrong."*
 *
 * That argument is correct on the worker's path and does not transfer to this
 * one, because on this path there is no inference to lie to. This fetcher
 * exists for ADR-0032's page import: a person presses a button and the result
 * lands in the box in front of them, before anything is stored. A shell is
 * visible in the second it arrives, and the person's recourse — open it in
 * their own browser and paste — is the thing they were already doing.
 *
 * What that buys is the reason it is a refusal rather than a shortcut: **the
 * process holding the person's SQLite file and their API key never executes a
 * host's JavaScript.** ADR-0002 kept the worker's browser in its own process
 * for a version of that reason, and putting one here would undo it on the
 * convenience path.
 *
 * ── What it sends ────────────────────────────────────────────────────────
 *
 * No cookies, no credentials, no `Referer`, and nothing about the person. The
 * host learns their address and the moment they pressed, which is what
 * `docs/SECURITY_AND_PRIVACY.md` publishes and is unavoidable in any fetch.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * **It does not check the allowlist.** `allowlisted()` in `fetcher.ts` is the
 * wrapper that does, and `importApprovedPage` is the only place that builds
 * one around this. A bare `httpFetcher()` will fetch whatever it is handed,
 * which is exactly why nothing but the import may construct it.
 *
 * **It does not sanitise.** `datamark()` is the door, one layer up.
 *
 * **It does not follow a redirect off the origin.** It follows redirects and
 * then refuses if the landing origin changed, the same shape and the same
 * sentence the Playwright fetcher uses.
 */

import { declaredTitle, readableText } from '../domain/document/from-html'
import type { FetchedSource, SourceFetcher } from './fetcher'

export interface HttpFetcherOptions {
  /** Per-page ceiling. A person waiting on a dead host should be told, not
   *  left watching a control that never comes back. */
  readonly timeoutMs?: number
  /** Injected so a test never reaches the network. Production passes nothing
   *  and gets the platform's own. */
  readonly fetchImpl?: typeof fetch
}

/**
 * A response that is not text is not a document.
 *
 * Deliberately a short list rather than "anything that is not an image": a PDF,
 * a spreadsheet and a zip all decode to bytes that would arrive in the box as
 * mojibake, and a person cannot tell mojibake from a page that failed. Saying
 * *this is not a document* names the real problem.
 */
const READABLE_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/xhtml+xml']

export class NotReadableError extends Error {
  constructor(readonly contentType: string) {
    super(
      contentType === ''
        ? 'That address did not answer with text.'
        : `That address answered with ${contentType}, which is not text.`,
    )
    this.name = 'NotReadableError'
  }
}

export class RedirectedOffSourceError extends Error {
  constructor(from: string, to: string) {
    super(`${from} redirected to ${to}, which is outside the source that was approved`)
    this.name = 'RedirectedOffSourceError'
  }
}

export function httpFetcher(options: HttpFetcherOptions = {}): SourceFetcher {
  const timeoutMs = options.timeoutMs ?? 15_000
  const call = options.fetchImpl ?? fetch

  return {
    async fetch(url: string): Promise<FetchedSource> {
      const requestedOrigin = new URL(url).origin
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), timeoutMs)

      try {
        const response = await call(url, {
          // Nothing of the person's travels with this. `omit` is the whole
          // credential story: no cookies out, no cookies kept.
          credentials: 'omit',
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
          headers: { accept: READABLE_TYPES.join(', ') },
          signal: abort.signal,
        })

        // Redirects are followed and then checked, because the allowlist ran
        // against the URL we were ASKED for and a redirect can land anywhere.
        // The gated path makes the same check for the same reason.
        const landed = response.url === '' ? url : response.url
        const landedOrigin = new URL(landed).origin
        if (landedOrigin !== requestedOrigin) {
          throw new RedirectedOffSourceError(url, landedOrigin)
        }

        if (!response.ok) {
          throw new Error(`${url} answered ${response.status}`)
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
        const mediaType = contentType.split(';')[0]?.trim() ?? ''
        if (!READABLE_TYPES.includes(mediaType)) throw new NotReadableError(mediaType)

        const body = await response.text()
        const isHtml = mediaType === 'text/html' || mediaType === 'application/xhtml+xml'

        return {
          url: landed,
          // Page-authored and unverified — ADR-0006 §3. It is shown as what the
          // page called itself and names nothing.
          title: isHtml ? declaredTitle(body) : '',
          // RAW. Datamarked by the import, which is the door.
          text: isHtml ? readableText(body) : body,
        }
      } finally {
        clearTimeout(timer)
      }
    },

    async close() {
      /* nothing to close — there is no browser and no pool */
    },
  }
}
