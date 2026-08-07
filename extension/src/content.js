/**
 * Content script. Runs only on origins the person approved.
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

function send(event) {
  chrome.runtime.sendMessage({ event }).catch(() => {
    /* the worker may be asleep; the buffer survives in session storage */
  })
}

function readableExcerpt() {
  // Live document, never a clone — a detached node degrades to textContent.
  const main = document.querySelector('main, article, [role="main"]') ?? document.body
  return (main.innerText ?? '').slice(0, BUDGET)
}

send({
  kind: 'visited',
  observedAt: new Date().toISOString(),
  attested: {
    url: location.href,
    title: document.title,
    referrer: document.referrer || undefined,
    navigationType: performance.getEntriesByType('navigation')[0]?.type,
  },
  untrustedText: readableExcerpt(),
})

document.addEventListener('selectionchange', () => {
  const text = (document.getSelection()?.toString() ?? '').trim()
  if (text.length < 3) return

  send({
    kind: 'excerpted',
    observedAt: new Date().toISOString(),
    attested: { url: location.href, length: text.length },
    untrustedText: text.slice(0, BUDGET),
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

addEventListener('pagehide', () => {
  send({
    kind: 'engaged',
    observedAt: new Date().toISOString(),
    attested: { url: location.href, scrollFraction: Math.round(deepest * 100) / 100 },
  })
})
