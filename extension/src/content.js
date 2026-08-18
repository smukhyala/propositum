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

/**
 * How a page was left. ADR-0013.
 *
 * ── Why this is worth a field at all ─────────────────────────────────────
 *
 * `docs/research/intent-suggestion-quality.md` §2.1 quotes the ablation inside
 * Fox et al. (TOIS 2005), the study that founded implicit-feedback research:
 * *"The two most important variables in the Bayesian model were Difference in
 * Seconds and Exit Type… Using just these two variables… accuracy for
 * predicting SAT was 66%… very close to the model using the full set of 19
 * predictor variables."* Dwell is the one Propositum already has. Exit type is
 * the other one, and §9's table calls it **the single best-evidenced addition**.
 *
 * ── The set is CLOSED, and it is closed here ─────────────────────────────
 *
 * Three values, listed once, in code, exactly as `ObservationKind` and
 * `GroundKind` are. There is deliberately no `other` and no `unknown`: a
 * catch-all is where a value nobody argued for goes to live, and the first
 * consumer that treats it as "probably fine" has silently invented a fourth
 * meaning. A lifecycle transition this file does not recognise sends nothing,
 * and the absence is honest — `exitType` is optional at every layer below.
 *
 * ── What each one IS, and what a content script can actually see ──────────
 *
 *   'hidden'         `visibilitychange` fired and the document is still alive.
 *                    The tab stopped being the one on screen. Two people
 *                    watching agree: the page is still open and nobody is
 *                    looking at it.
 *   'left-cached'    `pagehide` with `event.persisted === true`. The person
 *                    navigated away and Chrome KEPT this document, so coming
 *                    straight back runs no script at all. Chrome attests the
 *                    flag; we do not infer it.
 *   'left-unloaded'  `pagehide` with `event.persisted === false`. The document
 *                    is being destroyed.
 *
 * ── What is NOT distinguishable, said rather than papered over ───────────
 *
 * **`'left-unloaded'` genuinely means four things**: navigated onward in this
 * tab, closed the tab, quit the browser, and reloaded. A content script sees
 * one `pagehide` for all four, and the APIs that would separate them —
 * `chrome.tabs` events, `webNavigation.transitionType`, `chrome.history` — are
 * refused by `manifest.json` and by `tests/extension-permissions.test.ts`.
 * Splitting it would mean shipping a value that means two things and hoping,
 * which is the thing this comment exists to refuse.
 *
 * That matters for what may later be built on it. Fox's decision-tree nodes
 * condition on *"did not go back to the results list"* — a distinction inside
 * the branch we cannot split. So the evidence for exit type is stronger than
 * the evidence for **our** exit type, and any consumer has to argue that gap
 * rather than inherit the citation. See the deferral in
 * `tests/reachability.test.ts`.
 *
 * ── One exit can produce two rows ────────────────────────────────────────
 *
 * On an ordinary same-tab navigation Chrome fires `visibilitychange` (hidden)
 * and then `pagehide`, so this page reports `'hidden'` and then `'left-cached'`
 * or `'left-unloaded'`. Both are true and neither is a duplicate. A consumer
 * must therefore take the LAST exit recorded for a URL, not the first; that
 * rule is stated here because the place it would be got wrong is a layer that
 * does not exist yet.
 */
const EXIT_TYPES = ['hidden', 'left-cached', 'left-unloaded']

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
    /**
     * Report on the way out of view, which is a NEW send and the only one.
     *
     * ── Why it has to be a send, and not a flag on the next report ────────
     *
     * A tab switched away from and never returned to fires nothing else, ever.
     * `setInterval` skips hidden tabs by design, and `pagehide` may not come
     * for hours or at all. So an exit that is only ever attached to some later
     * report is an exit that is never reported for the commonest way of
     * leaving a page — which is the case `visitsByUrl` in `detect.ts` already
     * names as invisible to it: *"switching to a tab that is already loaded
     * produces nothing at all."*
     *
     * ── What this changes, stated rather than discovered ──────────────────
     *
     * It is a full engagement report, deliberately, because the shape is what
     * both doors already accept — `rawSignalSchema` requires `dwellMs` and
     * `scrollFraction` on an engagement, so a leaner "exit only" message would
     * be recorded as a REJECTED signal on the session path, once per tab
     * switch, forever.
     *
     * The consequence is real and is not nothing: dwell for a page that gets
     * hidden is now measured to the moment it was hidden, rather than to the
     * last `REPORT_EVERY_MS` tick before it. The app takes the largest report
     * per URL, so every hidden page's dwell rises by **up to one interval —
     * fifteen seconds**. That can carry a page over `READ_AROUND_MS` (20s) or
     * `DEEP_READ_MS` (60s) that would previously have fallen just short.
     *
     * It is argued rather than apologised for: the old figure under-reported by
     * an amount that depended on where the polling tick happened to land, not
     * on anything the person did. `hiddenMs` above already says dwell stops
     * accruing at this instant; this is the report that finally carries the
     * value that rule produces. An accurate measurement is not a threshold
     * move — but it does move which afternoons qualify, so it is written down
     * here, in ADR-0013, and in the commit rather than left to be found.
     */
    reportEngagement('hidden')
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

/**
 * Where `scrollFraction` goes, and the one hop that still drops it.
 *
 * Worth writing down here because this is where the value is produced and it
 * spent the whole build being computed for nobody.
 *
 * On the SESSION path it has always been consumed: the service worker forwards
 * the raw signal, `rawSignalSchema` validates it at `min(0).max(1)`, and
 * `classifyEngagement` reads it against `ENGAGEMENT_SCROLL_FRACTION`.
 *
 * On the AMBIENT path — the one that runs when nobody has started a session,
 * and the one detection is built on — it was discarded, because
 * `src/app/api/capture/ambient/route.ts` had no field to receive it. ~~**That
 * field exists as of 2026-08-17.** One hop is still missing and it is not in
 * this file: `flushAmbient` in `service-worker.js` projects each buffered signal
 * onto the wire shape by hand and copies `dwellMs` across as `engagedMs` without
 * copying `scrollFraction`. Until that line exists the app's new field is
 * reachable by `curl` and by nothing the extension sends.~~
 *
 * **Closed 2026-08-17 (ADR-0013).** `flushAmbient` now copies it, so the field
 * is reachable by a browser for the first time. It is copied only when it is
 * already inside `[0, 1]` — see the clamp argument immediately below, and
 * `flushAmbient`'s own note on why omitting an out-of-range reading is not the
 * clamp that was refused. **Nothing in the detector reads it even now**;
 * `tests/reachability.test.ts` holds that as a deferred assertion.
 *
 * ── Why the rounding here is not a bound, and no clamp was added ─────────
 *
 * `Math.round(deepest * 100) / 100` is a precision decision, not a range one:
 * `deepest` is a ratio of live layout numbers, and a container that reports a
 * `scrollTop` past its own maximum — overscroll, a transform, a resize mid-event
 * — yields a value above 1. The bound lives at the app's two doors, where a
 * non-browser caller is bounded by the same rule.
 *
 * A clamp here was considered and rejected: `rawSignalSchema` currently REFUSES
 * an engagement whose scroll exceeds 1, so clamping would start admitting rows
 * the session path drops today. That is a change to which events reach the
 * ledger, which is not this change.
 */
function reportEngagement(exitType) {
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
    /**
     * The closed set, enforced at the one place a value leaves this file.
     *
     * `EXIT_TYPES` would otherwise be a comment with a list next to it, and a
     * list nothing consults is the shape `detect.ts` spent two constants
     * learning to distrust. A caller passing something not on it sends no exit
     * rather than a fourth meaning — the app's schema refuses it too, and two
     * bounds that agree about which is tighter is the discipline `flushAmbient`
     * already argues for at length.
     */
    ...(EXIT_TYPES.includes(exitType) ? { exitType } : {}),
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

/**
 * Still report on the way out, so the final few seconds are not lost and a page
 * read for less than one interval is still counted.
 *
 * ── The wrapper is not decoration ────────────────────────────────────────
 *
 * This was `addEventListener('pagehide', reportEngagement)`. The moment
 * `reportEngagement` took a parameter, that line started handing it the
 * PageTransitionEvent as its exit type — which the `EXIT_TYPES.includes` guard
 * above rejects, so the field would simply have gone missing on the one path
 * that can produce two of the three values. Silent, and green.
 *
 * `event.persisted` is Chrome's own answer to "did I keep this document", so
 * `'left-cached'` is attested rather than inferred. It is the closest thing
 * available to Fox et al.'s *"went back to the results list"*: a page Chrome
 * kept is a page the person can return to instantly, and a return served from
 * bfcache runs no script — which is the defect `visitsByUrl` documents about
 * itself. This does not fix that defect. It records the condition under which
 * it is about to happen.
 */
addEventListener('pagehide', (event) => {
  reportEngagement(event.persisted ? 'left-cached' : 'left-unloaded')
})
