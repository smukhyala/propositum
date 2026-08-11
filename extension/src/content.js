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
const ARRIVED_AT = Date.now()

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

send({
  signal: 'navigation',
  at: new Date().toISOString(),
  url: location.href,
  title: document.title,
  referrer: document.referrer || undefined,
  navigationType: performance.getEntriesByType('navigation')[0]?.type,
  text: readableExcerpt(),
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
addEventListener(
  'scroll',
  () => {
    const height = document.documentElement.scrollHeight - innerHeight
    if (height > 0) deepest = Math.max(deepest, scrollY / height)
  },
  { passive: true },
)

/**
 * Dwell stops accruing when the tab is hidden.
 *
 * Without this a backgrounded tab left open overnight reports fourteen hours of
 * engagement, which is both false and the most confident-looking row in the
 * session.
 */
let hiddenSince = document.visibilityState === 'hidden' ? ARRIVED_AT : null
let hiddenMs = 0

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    hiddenSince = Date.now()
  } else if (hiddenSince !== null) {
    hiddenMs += Date.now() - hiddenSince
    hiddenSince = null
  }
})

addEventListener('pagehide', () => {
  const hidden = hiddenMs + (hiddenSince === null ? 0 : Date.now() - hiddenSince)

  send({
    signal: 'engagement',
    at: new Date().toISOString(),
    url: location.href,
    dwellMs: Math.max(0, Date.now() - ARRIVED_AT - hidden),
    scrollFraction: Math.round(deepest * 100) / 100,
  })
})
