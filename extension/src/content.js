/**
 * Content script. Runs only on origins the person granted.
 *
 * Registered dynamically by the service worker at grant time, never by a
 * `content_scripts` manifest block — see ADR-0002 and the note in
 * service-worker.js. Chrome refuses to register this for an origin the
 * extension has no host permission for, so the set of pages it runs on IS the
 * set the person approved, enforced by the browser rather than by an `if`
 * further down.
 *
 * ── This file reports, it does not classify ──────────────────────────────
 *
 * It used to send `kind: 'visited'` and `kind: 'engaged'` directly. That was
 * wrong in three ways at once: `queried` and `returnedTo` could never be
 * produced, `engaged` fired on every pagehide with no dwell measured at all,
 * and the tested classification logic in src/capture/semantics.ts was imported
 * by nothing.
 *
 * A page also cannot know it is a RETURN — that needs memory of the whole
 * sitting, and this script has seen only itself. So it reports raw signals and
 * the app decides what they were. The wire format has no `kind` field, and an
 * extension that could name one could name `sourceApproved`.
 *
 * ── Extraction hygiene, and why we deliberately keep hidden text ─────────
 *
 * `innerText` excludes only `display:none` and `visibility:hidden`. Everything
 * else survives: `opacity:0`, zero-size fonts, white-on-white, off-screen.
 *
 * That is not a bug to fix here. Hiding text from a human while leaving it
 * legible to a model is exactly what an injection does, so we WANT it captured.
 * It is sanitised at the ledger, flagged as adversarial, and surfaced to the
 * person. Filtering it here would throw away the evidence.
 *
 * One real trap: extracting from a DETACHED container silently degrades to
 * `textContent`, which filters nothing at all. So we always read from the live
 * document, never from a clone.
 */

const BUDGET = 2000 // published product constant, see SECURITY_AND_PRIVACY.md

// When this page became visible. Engagement is measured from here, and the app
// discards anything under its dwell threshold — so a glance costs a message and
// no row, rather than becoming a false "they read this".
/**
 * A page Chrome preloaded and the person never saw is not a page they visited.
 *
 * Typing in the omnibox makes Chrome prerender `google.com/search/warmup.html`
 * in a hidden document, and this script fired on it exactly like a real page.
 * In one recorded session that stub was THE most-captured page in a piece of
 * research about a waterfall — 13 of 45 events — and the classifier dutifully
 * reported `returnedTo` for somewhere nobody had been once.
 *
 * So nothing is reported until the document is actually visible. Two cases:
 *
 *   - `document.prerendering` — Chrome says outright that this is a preload.
 *     Wait for activation, and reset the dwell clock to it, because time spent
 *     prerendering is not time spent reading.
 *   - hidden at load — a background tab opened from a link. It becomes real
 *     when it is looked at, and not before.
 *
 * A page that is never activated reports nothing at all, which is correct: it
 * was never seen.
 */
function whenSeen(run) {
  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => whenSeen(run), { once: true })
    return
  }
  if (document.visibilityState === 'hidden') {
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState !== 'hidden') whenSeen(run)
      },
      { once: true },
    )
    return
  }
  run()
}

/** Reset when the page is finally shown — prerender time is not reading time. */
let seenAt = Date.now()

/**
 * Has this page ever actually been looked at?
 *
 * ── The overnight background tab, reported as attention ──────────────────
 *
 * `whenSeen` gates the navigation signal, but the `pagehide` listener below is
 * registered at module scope and fired unconditionally. So a tab opened in the
 * background from a middle-click and never looked at reported, on close, a
 * dwell of `Date.now() - seenAt` measured from MODULE LOAD — hours of it.
 *
 * The hidden-time subtraction did not save it: `hiddenSince` is only ever set
 * by a `visibilitychange` event, and a tab that starts hidden and stays hidden
 * never fires one. So the correction was zero and the figure was full wall
 * clock.
 *
 * That lands in the ambient path, which has no engagement threshold of its own
 * and takes the LARGEST report per URL — so one such tab becomes the most
 * confident-looking evidence in the buffer, for a page nobody read. `Dwell`
 * is the input to two of the three investment grounds.
 *
 * A page that was never seen now reports nothing at all, which is what
 * `whenSeen`'s own comment already promised.
 */
let wasSeen = false

/**
 * Everything goes to the worker, which decides where it belongs.
 *
 * This script does not know whether a session is running, and must not — a
 * content script asking "am I being recorded?" is a question a hostile page
 * could learn the answer to by timing. The worker knows, and it is the worker
 * that strips page text when the answer is no.
 */
function send(signal) {
  chrome.runtime.sendMessage({ signal }).catch(() => {
    /* the worker may be asleep; the buffer survives in session storage */
  })
}

function readableExcerpt() {
  // Live document, never a clone — a detached node degrades to textContent.
  const main = document.querySelector('main, article, [role="main"]') ?? document.body
  return (main.innerText ?? '').slice(0, BUDGET)
}

whenSeen(() => {
  seenAt = Date.now()
  wasSeen = true

  send({
    signal: 'navigation',
    at: new Date().toISOString(),
    url: location.href,
    title: document.title,
    referrer: document.referrer || undefined,
    navigationType: performance.getEntriesByType('navigation')[0]?.type,
    text: readableExcerpt(),
  })
})

document.addEventListener('selectionchange', () => {
  const text = (document.getSelection()?.toString() ?? '').trim()
  // The app applies the real floor. This only avoids sending a message per
  // keystroke-sized selection change.
  if (text.length < 3) return

  send({
    signal: 'selection',
    at: new Date().toISOString(),
    url: location.href,
    text: text.slice(0, BUDGET),
  })
})

let deepest = 0
let interacted = false

/**
 * Scroll, from ANY element — not just the window.
 *
 * `window.scrollY` was the only thing measured, and modern sites scroll inside
 * a container, so it stayed at 0 no matter how far someone read. TripAdvisor
 * was read seven times across several minutes and produced a scroll fraction of
 * zero, which made the engagement rule reject it forever.
 *
 * Scroll events do not bubble, but they DO fire during capture — so listening
 * at the document with `capture: true` catches a scrolling div the window knows
 * nothing about.
 */
addEventListener(
  'scroll',
  (event) => {
    interacted = true

    const target = event.target
    const el = target === document || target === document.documentElement ? null : target

    if (el && typeof el.scrollTop === 'number' && el.scrollHeight > el.clientHeight) {
      deepest = Math.max(deepest, el.scrollTop / (el.scrollHeight - el.clientHeight))
      return
    }

    const height = document.documentElement.scrollHeight - innerHeight
    if (height > 0) deepest = Math.max(deepest, scrollY / height)
  },
  { passive: true, capture: true },
)

/**
 * Reading is not only scrolling.
 *
 * The scroll requirement existed to separate reading from a tab left open, and
 * it is a poor proxy: a short page read fully, or a long one read above the
 * fold, involves no scrolling at all. What actually distinguishes the two is a
 * PERSON BEING THERE, so any deliberate act counts.
 */
for (const kind of ['click', 'keydown', 'selectionchange', 'wheel']) {
  document.addEventListener(
    kind,
    () => {
      interacted = true
    },
    { passive: true, capture: true },
  )
}

/**
 * Dwell stops accruing when the tab is hidden.
 *
 * Without this a backgrounded tab left open overnight reports fourteen hours of
 * engagement, which is both false and the most confident-looking row in the
 * session.
 */
let hiddenSince = null
let hiddenMs = 0

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenSince = Date.now()
  } else if (hiddenSince !== null) {
    hiddenMs += Date.now() - hiddenSince
    hiddenSince = null
  }
})

/**
 * Report while the page is still open, not only when it closes.
 *
 * This used to fire on `pagehide` alone, which meant dwell was reported only
 * when you LEFT a page — so someone reading four tabs they had not closed yet
 * produced no engagement at all, and detection could never fire while the
 * reading was still happening. That is precisely when the offer is worth
 * making.
 *
 * Every report carries CUMULATIVE dwell for this page, not a delta. A delta
 * would be lost for good if a message failed while the service worker was
 * asleep; a cumulative figure is self-correcting — the next report carries the
 * time the missed one would have. The app takes the largest report per URL
 * rather than summing them, which is what makes resending safe.
 */
function engagedMs() {
  const hidden = hiddenMs + (hiddenSince === null ? 0 : Date.now() - hiddenSince)
  return Math.max(0, Date.now() - seenAt - hidden)
}

function reportEngagement() {
  // Never seen, never read. See `wasSeen`: this is the guard that stops a
  // background tab's `pagehide` reporting hours of imaginary attention.
  if (!wasSeen) return

  send({
    signal: 'engagement',
    at: new Date().toISOString(),
    url: location.href,
    dwellMs: engagedMs(),
    scrollFraction: Math.round(deepest * 100) / 100,
    interacted,
  })
}

/** Often enough to notice a person mid-read, rarely enough not to be chatter. */
const REPORT_EVERY_MS = 15_000

setInterval(() => {
  // A hidden tab is not being read. Reporting anyway would let a backgrounded
  // tab accumulate a claim on attention it never had.
  if (document.visibilityState === 'hidden') return
  reportEngagement()
}, REPORT_EVERY_MS)

// Still report on the way out, so the final few seconds are not lost and a page
// read for less than one interval is still counted.
addEventListener('pagehide', reportEngagement)
