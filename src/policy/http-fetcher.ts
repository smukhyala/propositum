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
 * ── A redirect is refused BEFORE it is taken ─────────────────────────────
 *
 * *(Corrected 2026-09-03. What was here before is worth stating, because it is
 * the shape most fetchers have and it reads as safe.)* This used to request
 * with `redirect: 'follow'` and compare origins afterwards, which is what
 * ADR-0032 §1 described as *"refused after the fact"*. The refusal was real and
 * the body was never read — but the request to the second host had already
 * completed by the time it ran. An approved origin that is hostile, or that
 * merely carries somebody's open redirect, could answer
 * `302 https://anything.example/<token>` and that host would learn the person's
 * IP, their TLS fingerprint, the moment, and whatever the redirect target
 * encoded. That made
 * `docs/SECURITY_AND_PRIVACY.md` §5's *"never asked and never learns you
 * looked"* false on exactly the path a person would not think to check.
 *
 * So redirects are `'manual'` now, and each hop's `Location` is resolved and
 * checked against the approved origin **before** anything is requested from it.
 * An off-origin hop is refused with nothing sent to it. The bound on hops is
 * `MAX_REDIRECTS`, and past it the reader gives up rather than looping.
 *
 * **`src/policy/playwright-fetcher.ts` still follows and then checks**, so the
 * two fetchers now differ, deliberately and not by oversight. Playwright's
 * `page.goto` follows redirects inside the browser and offers no per-hop veto
 * short of a request interceptor, which is a larger change than this one; it
 * runs in the worker's own process rather than the one holding the database and
 * the API key, and it is out of ADR-0032's scope entirely.
 * `docs/todo/03-document-loop.md` records it.
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
 * **It does not hide that a redirect happened.** Refusing an off-origin hop
 * tells the person which host was pointed at. That is the address the approved
 * host chose to publish, not anything of theirs, and naming it is the
 * difference between a refusal they can act on and *"something went wrong"*.
 *
 * **The hop check is origin equality, not the allowlist's path prefix.** A
 * redirect inside the approved origin but outside an approved path prefix is
 * followed here. `allowlisted()` ran against the address the person typed and
 * does not re-run per hop, so a project that approved
 * `https://northwind.example.com/partners/*` can still land on `/pricing` by
 * redirect. It is the same origin, the same host, and the same bytes it was
 * always willing to serve — but it is a gap between the two checks and it is
 * stated rather than implied closed.
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

/** The statuses that carry a `Location` and mean *ask somewhere else*. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * How many same-origin hops the reader will take before giving up.
 *
 * Five, because a redirect chain longer than that on a page somebody wants to
 * read is a misconfiguration rather than a route, and because the bound has to
 * exist at all: `redirect: 'manual'` moves the loop into this file, and a loop
 * this file owns is a loop this file can be made to run for ever. Refusing past
 * the bound rather than returning the last response, so a chain that never
 * arrives is never reported as a page that did.
 */
const MAX_REDIRECTS = 5

/**
 * How many bytes the app process will hold from one host before refusing.
 *
 * `IMPORT_BUDGET_CHARS` (200,000) bounds the *extracted text*, and it is
 * checked in `page-import.ts` after the whole body is already in memory — so
 * before this, an approved host that chose to answer with a gigabyte would have
 * been buffered in full and then politely refused. That is a resource cost
 * rather than a privacy one, and it was stated nowhere.
 *
 * Five million bytes, which is a transport ceiling and **not** a fourth
 * `RetentionBudget`: the set in `src/model/untrusted.ts` is closed and
 * code-owned on purpose, its members are promises about what Propositum keeps,
 * and this is a promise about what it will hold in memory for a moment. It sits
 * generously above the published bound — 200,000 characters of readable prose
 * inside markup is comfortably under a megabyte — so a page that would have
 * been refused for its length still gets that sentence rather than this one.
 */
export const RESPONSE_BYTE_CEILING = 5_000_000

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

export class TooManyRedirectsError extends Error {
  constructor(url: string, hops: number) {
    super(`${url} redirected more than ${hops} times without arriving anywhere`)
    this.name = 'TooManyRedirectsError'
  }
}

export class ResponseTooLargeError extends Error {
  constructor(url: string, ceiling: number) {
    super(`${url} answered with more than ${ceiling} bytes, which is past what the reader will hold`)
    this.name = 'ResponseTooLargeError'
  }
}

/** Drop a body we are not going to read, rather than leaving a socket open. */
async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    /* a body already consumed or already errored is nothing to clean up */
  }
}

/**
 * Read a response as text, refusing past `RESPONSE_BYTE_CEILING`.
 *
 * Two bounds, because either alone is a half-measure. `Content-Length` is
 * cheap and refuses before a byte of body arrives, but a host may omit it or
 * lie; counting what actually arrives is the one that holds, and it stops at
 * the ceiling rather than after it.
 *
 * Decoded as UTF-8 regardless of what the response declared, which is what
 * `Response.text()` does and is therefore not a change in behaviour. A page
 * served in another encoding arrives as mojibake here exactly as it did before.
 */
async function readBounded(url: string, response: Response, ceiling: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > ceiling) {
    await discard(response)
    throw new ResponseTooLargeError(url, ceiling)
  }

  const body = response.body
  if (!body) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > ceiling) throw new ResponseTooLargeError(url, ceiling)
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    // Releases the connection on the refusal path. A no-op once the stream has
    // closed on its own.
    await reader.cancel().catch(() => {})
  }
}

export function httpFetcher(options: HttpFetcherOptions = {}): SourceFetcher {
  const timeoutMs = options.timeoutMs ?? 15_000
  const call = options.fetchImpl ?? fetch

  return {
    async fetch(url: string): Promise<FetchedSource> {
      const requestedOrigin = new URL(url).origin
      const abort = new AbortController()
      // One deadline for the whole read, redirects included. A chain of slow
      // same-origin hops is still a person watching a control that never comes
      // back.
      const timer = setTimeout(() => abort.abort(), timeoutMs)

      try {
        let current = url
        let response: Response | undefined

        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
          response = await call(current, {
            // Nothing of the person's travels with this. `omit` is the whole
            // credential story: no cookies out, no cookies kept.
            credentials: 'omit',
            // The fix. Nothing is requested from the next host until its origin
            // has been checked against the one that was approved.
            redirect: 'manual',
            referrerPolicy: 'no-referrer',
            headers: { accept: READABLE_TYPES.join(', ') },
            signal: abort.signal,
          })

          if (!REDIRECT_STATUSES.has(response.status)) break

          const location = response.headers.get('location')
          await discard(response)
          if (location === null || location.trim() === '') {
            throw new Error(`${current} answered ${response.status} without saying where to`)
          }

          let next: URL
          try {
            // Resolved against the hop that issued it, because `Location` is
            // routinely relative and a relative one cannot leave the origin.
            next = new URL(location, current)
          } catch {
            throw new Error(`${current} redirected to something that is not an address`)
          }

          if (next.origin !== requestedOrigin) {
            // Refused with nothing sent to it. This is the whole point.
            throw new RedirectedOffSourceError(current, next.origin)
          }

          current = next.href
          response = undefined
        }

        if (response === undefined) throw new TooManyRedirectsError(url, MAX_REDIRECTS)

        // A backstop, not the mechanism. The loop above is what keeps the
        // promise; this catches a `fetchImpl` that followed redirects anyway —
        // which the platform's own will not, given `manual`, but an injected
        // one is not the platform's.
        const landed = response.url === '' ? current : response.url
        const landedOrigin = new URL(landed).origin
        if (landedOrigin !== requestedOrigin) {
          await discard(response)
          throw new RedirectedOffSourceError(url, landedOrigin)
        }

        if (!response.ok) {
          await discard(response)
          throw new Error(`${url} answered ${response.status}`)
        }

        const contentType = (response.headers.get('content-type') ?? '').toLowerCase()
        const mediaType = contentType.split(';')[0]?.trim() ?? ''
        if (!READABLE_TYPES.includes(mediaType)) {
          await discard(response)
          throw new NotReadableError(mediaType)
        }

        const body = await readBounded(landed, response, RESPONSE_BYTE_CEILING)
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
