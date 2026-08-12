/**
 * The extension service worker.
 *
 * ── Assume this file dies every 30 seconds ───────────────────────────────
 *
 * MV3 terminates an idle service worker aggressively. Nothing here may hold
 * state in a module variable and expect it to survive; everything durable goes
 * through `chrome.storage.session`, and a `chrome.alarms` heartbeat is what
 * brings the worker back.
 *
 * This is where capture bugs will live, and it is the reason `captureGap` is a
 * first-class event rather than an inferred absence: when the worker dies
 * mid-session, we know we stopped watching, and the person is told.
 *
 * ── Written as plain JS on purpose ───────────────────────────────────────
 *
 * The extension is loaded unpacked from this directory. Adding a build step
 * between the source and what Chrome runs would mean the thing being reviewed
 * is not the thing being executed — an unhelpful property for the component
 * holding the privacy guarantee. The shared logic that benefits from types
 * lives in src/capture/ and is tested there.
 */

import { patternCovers } from './match-pattern.js'
import { looksLikeSearch } from './search-url.js'
import {
  INDICATOR_GRACE_MS,
  clearControlState,
  controlState,
  detachControl,
  openControlledTab,
  originOf,
  performCommand,
  registerControlListeners,
} from './cdp.js'

const APP_ORIGIN = 'http://127.0.0.1:3117'
const HEARTBEAT_ALARM = 'propositum-heartbeat'
const HEARTBEAT_MINUTES = 0.5

const CUSTOM_HEADER = 'x-propositum-capture'

/**
 * The acting channel's own header.
 *
 * Separate from the capture header on purpose. They are different
 * conversations with different consequences — one reports what a person
 * looked at, the other asks what to do in their browser — and a route that
 * accepted either would be one `if` away from letting a forged capture event
 * ask for an instruction.
 */
const ACT_HEADER = 'x-propositum-act'

/**
 * How long "Not now" buys, for notifications only.
 *
 * Mirrors `SNOOZE_MS` in `src/server/ambient-store.ts` rather than reading it.
 * The duplication is deliberate: that one governs whether the app OFFERS, this
 * one governs whether this file INTERRUPTS, and the notification is entirely
 * this file's to decide. Keeping them equal is a courtesy; keeping this one at
 * all is what makes declining mean something.
 */
const DECLINE_QUIET_MS = 60 * 60_000

/* ── session state, which never lives in a module variable ─────────────── */

/**
 * The session comes from the APP, not from here.
 *
 * A person starts a session in the UI, which mints the bearer token this
 * extension must present on every event. Before, that token never reached us —
 * so capture silently 403'd while the interface said a session was running.
 * That is the worst failure available: they believe they are being watched and
 * they are not.
 *
 * So we ask. `GET /api/session/current` returns the live session and its token,
 * guarded by the same Origin + custom-header checks as everything else.
 */
async function loadSession() {
  const cached = (await chrome.storage.session.get(['session'])).session ?? null

  try {
    const response = await fetch(`${APP_ORIGIN}/api/session/current`, {
      headers: { [CUSTOM_HEADER]: '1' },
    })
    if (!response.ok) return cached

    const { session } = await response.json()
    if (!session) {
      // The app says no session is running. Believe it, and stop capturing —
      // a stale local session would keep buffering events with nowhere to go.
      if (cached) await chrome.storage.session.remove(['session'])
      return null
    }

    await chrome.storage.session.set({ session })
    return session
  } catch {
    // The app is unreachable. Keep what we have so a brief outage does not
    // drop the session; the health badge already says capture is at risk.
    return cached
  }
}

/* ── transport ─────────────────────────────────────────────────────────── */

/**
 * All four controls on every request. `application/json` and the custom header
 * are what force a preflight a hostile page cannot satisfy — CORS alone would
 * let `text/plain` straight through, delivered and executed.
 */
async function post(path, body, session) {
  const response = await fetch(`${APP_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CUSTOM_HEADER]: '1',
    },
    body: JSON.stringify({ ...body, token: session.token, sessionId: session.id }),
  })

  if (!response.ok) throw new Error(`transport ${response.status}`)
  return response.json()
}

/**
 * Startup self-check. Fails LOUDLY.
 *
 * Chrome extensions are currently exempt from Local Network Access
 * restrictions, but that is documented only in an unversioned Google document
 * that says "currently". Silent capture failure is the worst outcome
 * available — the person believes they are being watched and they are not.
 */
async function verifyReachable() {
  try {
    const response = await fetch(`${APP_ORIGIN}/api/capture/health`, {
      headers: { [CUSTOM_HEADER]: '1' },
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
    // Not while something is being worked on. Clearing the badge here would
    // take down the acting indicator's third layer every thirty seconds, which
    // is the same class of mistake as an indicator that can be lost silently.
    if (!(await acting())) await chrome.action.setBadgeText({ text: '' })
    return true
  } catch (error) {
    // Visible, not logged-and-forgotten.
    await chrome.action.setBadgeText({ text: '!' })
    await chrome.action.setBadgeBackgroundColor({ color: '#9c4708' })
    await chrome.action.setTitle({
      title:
        'Propositum cannot reach the app — capture is OFF.\n' +
        'If this started after a Chrome update, check whether extensions are ' +
        'still exempt from Local Network Access.',
    })
    console.error('[propositum] capture is OFF:', error)
    return false
  }
}

/* ── buffering, because the worker dies mid-flush ──────────────────────── */

async function buffer(event) {
  const { pending = [] } = await chrome.storage.session.get(['pending'])
  pending.push({ ...event, sourceSeq: pending.length })
  await chrome.storage.session.set({ pending })
}

/**
 * The app's own limits on one ambient POST, mirrored here.
 *
 * ── "Neither trusts the other" has to mean the sender is the STRICTER one ──
 *
 * The comment below used to say the app bounds this again and neither side
 * trusts the other, which is the right principle. The numbers did not
 * implement it: this side kept 200 observations and the app's schema accepts
 * `.max(100)`, so the looser bound was the one being applied by the sender.
 *
 * The consequence was not a dropped batch, it was a DEADLOCK. Past 100, every
 * flush failed Zod with a 400, the clear below only ran on `ok` or 409, and so
 * the buffer stayed over 100 forever. Ambient detection died for the rest of
 * that session storage's life — no offers, ever, on a machine where everything
 * looked healthy — and the only cure was dropping session storage. A dev-server
 * restart with a few tabs open reaches it.
 *
 * Titles were the same wedge by a different route: sent untruncated against
 * `title: z.string().max(300)`.
 *
 * So both numbers are at or below the receiver's, and the flush no longer
 * treats a 400 as retryable. Defence in depth is two bounds that agree about
 * which is tighter; two that disagree is a lock.
 */
const AMBIENT_BATCH_MAX = 100
const AMBIENT_TITLE_MAX = 300

/**
 * Ambient observations, held separately from session events.
 *
 * A separate buffer and a separate endpoint, because they have different
 * destinations and different rules. Mixing them would mean one flush deciding
 * per-item where each belongs, which is exactly the kind of branch that
 * eventually sends page text to the wrong place.
 */
async function bufferAmbient(observation) {
  const { ambient = [] } = await chrome.storage.session.get(['ambient'])
  ambient.push(observation)
  // Bounded here too, and never above what the app will accept. The oldest go
  // first: recent activity is what a detection is about.
  await chrome.storage.session.set({ ambient: ambient.slice(-AMBIENT_BATCH_MAX) })
}

async function flushAmbient() {
  const { ambient = [] } = await chrome.storage.session.get(['ambient'])
  if (ambient.length === 0) return

  try {
    const response = await fetch(`${APP_ORIGIN}/api/capture/ambient`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CUSTOM_HEADER]: '1' },
      body: JSON.stringify({
        // Already bounded by `bufferAmbient`, and bounded again here so a
        // buffer written by an older version of this file cannot wedge a newer
        // one on its first flush.
        observations: ambient.slice(-AMBIENT_BATCH_MAX).map((o) => ({
          at: o.at,
          url: o.url ?? '',
          // Truncated to what the app's schema accepts. A long title is a page
          // being verbose; an untruncated one was a permanently rejected batch.
          title: (o.title ?? '').slice(0, AMBIENT_TITLE_MAX),
          /**
           * A query is a REAL query, not a question mark.
           *
           * This used to be `o.url.includes('?')`, so a newsletter link with a
           * tracking parameter arrived at the app labelled as a search — and
           * the offer screen then told somebody "you searched for it, then read
           * 4 pages" when they had searched for nothing. See search-url.js: the
           * lie is bad on its own terms, and it also makes the
           * `searched-then-read` intent ground satisfiable by any URL with a
           * `?` in it, which is the ground that separates pursuing a subject
           * from having one delivered to you.
           *
           * `looksLikeSearch` is a hand port of `searchQueryOf` in
           * `src/domain/detection/topics.ts`, and the two MUST agree —
           * `tests/search-url.test.ts` runs both over the same table and fails
           * if they ever stop agreeing.
           */
          kind:
            o.signal === 'engagement'
              ? 'engagement'
              : o.signal === 'away'
                ? 'away'
                : looksLikeSearch(o.url ?? '')
                  ? 'query'
                  : 'navigation',
          ...(typeof o.dwellMs === 'number' ? { engagedMs: o.dwellMs } : {}),
        })),
      }),
    })
    /**
     * What is worth keeping, and what is worth admitting is never going to be
     * accepted.
     *
     * 409 means a session started under us. Drop them: the ledger is now the
     * right destination and these would be a duplicate of what it records.
     *
     * 4xx means the app looked at these observations and said no. Retrying is
     * then not resilience, it is a loop — the same bytes rejected the same way
     * every thirty seconds, with the buffer never emptying and ambient
     * detection dead until session storage is dropped. That is exactly the
     * wedge the two disagreeing bounds above produced, and the bounds alone are
     * not enough of a fix: any future validation failure would recreate it.
     * Losing a batch of metadata costs one missed offer; a permanent wedge
     * costs every offer after it, silently.
     *
     * A 5xx or a thrown fetch is the app being unavailable rather than
     * unwilling, so those are kept — that is the case the buffer exists for.
     */
    if (response.ok || response.status === 409) {
      await chrome.storage.session.set({ ambient: [] })
      return
    }

    if (response.status >= 400 && response.status < 500) {
      console.warn('[propositum] ambient batch refused, dropping it:', response.status)
      await chrome.storage.session.set({ ambient: [] })
    }
  } catch {
    /* the app is down; keep them until the window ages them out */
  }
}

async function flush() {
  const session = await loadSession()
  if (!session) return

  const { pending = [] } = await chrome.storage.session.get(['pending'])
  if (pending.length === 0) return

  try {
    await post('/api/capture/events', { events: pending }, session)
    await chrome.storage.session.set({ pending: [] })
  } catch (error) {
    // Keep the buffer. The app records a gap if the disconnection outlasts it;
    // dropping events silently would be the one unrecoverable mistake.
    console.warn('[propositum] flush failed, keeping buffer:', error)
  }
}

/**
 * The badge is the whole of the interruption.
 *
 * No notification, no popup, no sound. A suggestion that interrupts is one
 * people turn off, and the offer is worth nothing if it arrives while someone
 * is mid-sentence. A dot on the toolbar icon waits until they look.
 */
async function showSuggestionBadge() {
  // An offer is a "when you have a moment"; work in progress is a "right now".
  // The second wins the badge, and the offer is still there when it ends.
  if (await acting()) return

  try {
    const response = await fetch(`${APP_ORIGIN}/api/session/current`, {
      headers: { [CUSTOM_HEADER]: '1' },
    })
    if (!response.ok) return

    const { suggestion } = await response.json()
    if (!suggestion) {
      const current = await chrome.action.getBadgeText({})
      if (current === '•') await chrome.action.setBadgeText({ text: '' })
      return
    }

    await chrome.action.setBadgeText({ text: '•' })
    await chrome.action.setBadgeBackgroundColor({ color: '#7c6cf0' })
    await chrome.action.setTitle({ title: `${suggestion.sentence} ${suggestion.because}` })

    /**
     * The current offer is stored on EVERY poll, not only when we notify.
     *
     * `answeredYes` reads this, and it used to be written only alongside a
     * notification. So the badge could be advertising Thursday's thread while
     * storage still held Tuesday's, and clicking through opened a link for work
     * the person had stopped doing an hour ago. Writing it unconditionally
     * costs one storage set per thirty seconds and makes "what the badge is
     * about" and "what the click opens" the same object by construction.
     */
    await chrome.storage.session.set({ offer: suggestion })

    /**
     * Actually interrupt, once, when there is something worth interrupting for.
     *
     * This was `chrome.sidePanel.open()` and it never fired. That call requires
     * a USER GESTURE, and an alarm handler has none — so it threw into a catch
     * every thirty seconds while the app sat there having correctly worked out
     * "hiking to Kauai's Secret Falls". The person saw a small dot and
     * concluded detection had failed. It had not; the surfacing had.
     *
     * A notification is the only thing that can appear unprompted, which is
     * what "it pops up and says, hey, I see you're doing this" requires.
     *
     * ── Once per THREAD, not once per subject ──────────────────────────────
     *
     * The suppression key used to be the subject, and the subject is a phrase a
     * model wrote. Two different threads can be named the same thing — "world
     * models" on Tuesday and again on Thursday — and the second one was then
     * silently suppressed by the first: the badge appeared, no notification
     * ever came, and the offer for genuinely new work went unmentioned. The
     * thread signature is the identity the app itself keys everything on, and
     * it changes when the shape of the work changes.
     *
     * ── Keys are kept, not rotated ─────────────────────────────────────────
     *
     * A first version dropped the previous thread's key whenever the thread
     * changed, to stop `chrome.storage.session` accumulating one entry per
     * subject. It also re-armed the notification for a thread that flapped:
     * signatures do move as a term crosses the frequency cut-off, so A → B → A
     * across three polls deleted A's key and then notified about A a second
     * time. The bookkeeping cost more than it saved — session storage dies with
     * the browser and a key is a few bytes — so every told key simply stays.
     *
     * ── Declining buys quiet, and it has to be enforced here ───────────────
     *
     * "Not now" snoozes the origin server-side AND drops the observations that
     * produced the offer. That second half re-detects as a DIFFERENT thread:
     * different pages, different terms, different signature — so a suppression
     * key on the signature does not survive it, and the offer people had just
     * turned down came back about a minute later with `requireInteraction`.
     * The old subject-keyed version hid this by accident, because the model
     * re-named the same work identically.
     *
     * So the extension keeps its own quiet period. It mirrors the app's
     * `SNOOZE_MS` rather than reading it, deliberately: this is a question
     * about INTERRUPTING, the notification belongs to this file, and a decline
     * that only reached the server would still leave this file free to pop up.
     * The badge is unaffected — declining should quieten the interruption, not
     * hide the offer from somebody who goes looking.
     *
     * Only a `work-offer` interrupts. The degraded form is a real offer and it
     * keeps the badge, but "Propositum noticed you are reading about something"
     * with no proposal attached is not worth a notification — that is the
     * interruption people turn the feature off over.
     */
    const thread = suggestion.thread ?? ''
    const key = `told:${thread}`
    const { [key]: alreadyTold, quietUntil = 0 } = await chrome.storage.session.get([
      key,
      'quietUntil',
    ])

    if (suggestion.kind === 'work-offer' && thread && !alreadyTold && Date.now() >= quietUntil) {
      await chrome.storage.session.set({ [key]: true })

      chrome.notifications.create(`propositum:${thread}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: suggestion.title || `Looks like you're working on ${suggestion.subject}.`,
        message: suggestion.rationale || suggestion.because,
        buttons: [{ title: 'Yes, do it' }, { title: 'Not now' }],
        requireInteraction: true,
      })
    }
  } catch {
    /* the health check owns the unreachable case, and says so louder */
  }
}

/* ══ acting in the person's own browser — ADR-0010 ══════════════════════ */

/**
 * ── The long poll, and why there are two keepalives ──────────────────────
 *
 * `GET /api/act/next` hangs for up to 25 seconds on the app side, which is
 * deliberately below MV3's 30-second idle window, and this file re-arms it the
 * moment it returns. Two mechanisms keep the worker around, and **neither is
 * load-bearing on its own**:
 *
 *  1. **The awaited fetch.** A service worker with an outstanding `await` on a
 *     network request is not idle, so in principle it is not killed. In
 *     principle. ADR-0010 lists this in its risks: MV3 lifetime under a held
 *     socket across an agent turn is **undocumented for exactly this case**,
 *     and the failure mode — an agent that stops mid-run for no visible
 *     reason — is one of the worst-shaped bugs available.
 *  2. **The 30-second alarm.** `chrome.alarms` is the resurrector, not the
 *     driver. It brings the worker back if it died anyway, and the first thing
 *     it does is re-arm the poll.
 *
 * So this is designed for the keepalive turning out to be wrong. Nothing is
 * held in a module variable, the in-flight intent id is in session storage,
 * and a resurrected worker can pick up from what it finds there. If the
 * awaited-fetch keepalive works, the alarm costs one no-op every 30 seconds.
 * If it does not, the alarm is the whole mechanism and the run continues with
 * a stutter rather than dying.
 */
const POLL_TIMEOUT_MS = 25_000
const POLL_ABORT_MS = POLL_TIMEOUT_MS + 5_000

/**
 * The floor between two polls that returned nothing.
 *
 * If the app answers instantly rather than hanging — an older build, a route
 * that does not exist yet, a misconfiguration — an immediate re-arm is a hot
 * loop against loopback that pins a core and never stops. One second is
 * invisible against a 25-second hang and turns a spin into a poll.
 */
const POLL_FLOOR_MS = 1_000

/**
 * Only one poll may be in flight, and the lease is what says so.
 *
 * A module variable would be the obvious guard and would be wrong: the worker
 * dies, the variable goes with it, and the alarm starts a second poll beside
 * the first. Session storage survives the worker; a lease that expires
 * survives a worker that died holding it.
 */
const POLL_LEASE_MS = POLL_ABORT_MS + 5_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function claimPollLease() {
  const { pollLeaseUntil = 0 } = await chrome.storage.session.get(['pollLeaseUntil'])
  if (Date.now() < pollLeaseUntil) return false

  await chrome.storage.session.set({ pollLeaseUntil: Date.now() + POLL_LEASE_MS })
  return true
}

async function releasePollLease() {
  await chrome.storage.session.set({ pollLeaseUntil: 0 })
}

function actFetch(path, init) {
  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), [ACT_HEADER]: '1' },
  })
}

/**
 * Report whatever is in flight, and make sure only one thing ever does.
 *
 * ── One intent, one outcome ──────────────────────────────────────────────
 *
 * Three code paths can end up wanting to report the same intent, and for a
 * while all three did: `onIrreversibleBlocked` reported `blocked-request`,
 * then `stopActing` → `releaseControl` reported `control-lost` for the same id,
 * then the `ControlLost` thrown out of `performCommand` produced a third. The
 * receiver takes the last one, so the person was told *"I lost the browser"*
 * about the moment Propositum had correctly refused to send a POST — the
 * single most important thing that could have been said, overwritten by the
 * least informative.
 *
 * Claiming the id out of session storage before reporting makes the first
 * writer the only writer. The two later paths find nothing in flight and stay
 * quiet, which is right: they have nothing to add.
 */
async function reportInFlight(body) {
  const { inFlightIntentId } = await chrome.storage.session.get(['inFlightIntentId'])
  if (typeof inFlightIntentId !== 'string') return false

  await chrome.storage.session.remove(['inFlightIntentId'])
  await postReport(inFlightIntentId, body)
  return true
}

/**
 * ── Nothing is held, so nothing can wedge ────────────────────────────────
 *
 * A report is produced, sent once, and forgotten. There is no buffer on this
 * path, which is the structural half of not repeating the wave-2 ambient bug —
 * the extension buffered 200 observations against a route accepting 100 and
 * cleared only on success, so past 100 the same bytes were rejected the same
 * way every thirty seconds and ambient detection was dead until session
 * storage was dropped.
 *
 * The receiver cannot refuse for size either: `appendEvidence` truncates an
 * oversized tree and writes it. So a 4xx here is the app objecting to
 * something other than the payload's length, and the answer is a *minimal*
 * failure report for the same intent — sent once, never looped, carrying no
 * page-derived content and therefore not refusable for the same reason twice.
 *
 * That fallback is not there to salvage the observation. It is there because
 * an ActionIntent with no ActionOutcome is indistinguishable from a crash, and
 * gets reported to the person as `unknown` when we know exactly what happened.
 */
async function postReport(intentId, report) {
  const send = (body) =>
    actFetch('/api/act/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intentId, ...body }),
    })

  try {
    const response = await send(report)
    if (response.ok) return
    if (response.status < 400 || response.status >= 500) return

    console.warn('[propositum] the app refused a report, saying so plainly instead:', response.status)
    await send({
      ok: false,
      failure: 'not-reported',
      detail: `the app would not accept what Propositum saw (${response.status})`,
    }).catch(() => {})
  } catch {
    // The app is unreachable. Its own recovery sweep is what writes the
    // outcome in that case, marked as recovery rather than inferred — see
    // ADR-0010 §7. Retrying here would be this file guessing on its behalf.
  }
}

/**
 * Stop, and say so afterwards.
 *
 * `POST` last, always. Detaching is the removal of the capability, and it has
 * to work with the app closed, the dev server restarting, or the machine
 * offline. A stop that has to reach a server before it takes effect is not a
 * stop.
 */
async function postHalt(runId, reason) {
  await actFetch('/api/act/halt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, reason }),
  }).catch(() => {})
}

/* ── the indicator, layer 2 of 3 ───────────────────────────────────────── */

/**
 * Put the marker back on the page.
 *
 * Called after attach and again on every `Page.loadEventFired`, because
 * navigation destroys it. On success the marker is live as of now, and the
 * overlay's own heartbeat renews it twice a second from there.
 *
 * On FAILURE the grace window is cleared rather than left to expire, so the
 * very next command is refused instead of one that happens to arrive inside
 * the remaining grace. An indicator that can be lost silently is worse than
 * none: it teaches the person to read its absence as "nothing is happening".
 */
async function showIndicator(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/overlay.js'] })
    // The marker is back, so the navigation grace is spent and closed. That is
    // what makes the grace ONE window per marker rather than a sliding one a
    // page could keep pushing forward by navigating itself in a loop.
    await chrome.storage.session.set({ indicatorAliveAt: Date.now(), indicatorGraceUntil: 0 })
    return true
  } catch (error) {
    console.warn('[propositum] could not mark the tab it is working in:', error)
    await chrome.storage.session.set({ indicatorGraceUntil: 0 })
    return false
  }
}

async function hideIndicator(tabId) {
  await chrome.tabs.sendMessage(tabId, { propositumIndicator: 'clear' }).catch(() => {})
}

/**
 * The watchdog.
 *
 * Runs while the worker is alive and something is attached. It does not need
 * to survive worker death: if the worker is gone then nothing is dispatching
 * commands either, and the first thing a resurrected worker does is check the
 * marker before it dispatches anything.
 */
async function watchIndicator() {
  const state = await controlState()
  if (state.tabId === null) return

  const quiet = Date.now() - state.indicatorAliveAt > INDICATOR_GRACE_MS
  if (quiet && Date.now() > state.indicatorGraceUntil) {
    console.warn('[propositum] the working-here marker went quiet — letting go of the tab')
    await stopActing('control-lost')
    return
  }

  setTimeout(() => void watchIndicator(), Math.floor(INDICATOR_GRACE_MS / 2))
}

/* ── the third badge state ─────────────────────────────────────────────── */

/**
 * A third state beside `!` (cannot reach the app) and `•` (there is an offer).
 *
 * Layer 3 of the indicator, and the weakest of the three: it is the one you
 * see when you are not looking at the tab being worked in. It exists so that
 * "is Propositum doing something right now" is answerable from anywhere in
 * Chrome without hunting for a tab.
 */
const ACTING_BADGE = '▶'

async function acting() {
  const { controlledTabId } = await chrome.storage.session.get(['controlledTabId'])
  return typeof controlledTabId === 'number'
}

async function showActingBadge() {
  await chrome.action.setBadgeText({ text: ACTING_BADGE })
  await chrome.action.setBadgeBackgroundColor({ color: '#7c6cf0' })
  await chrome.action.setTitle({
    title:
      'Propositum is working in a tab it opened.\n' +
      'Open that tab and press Stop to end it, or use Chrome’s own Cancel bar.',
  })
}

async function clearActingBadge() {
  await chrome.action.setBadgeText({ text: '' })
  await chrome.action.setTitle({ title: 'Propositum' })
}

/* ── the control session ───────────────────────────────────────────────── */

/**
 * Let go of the tab, then tell the app.
 *
 * One path for all three ways of stopping — Chrome's infobar Cancel, the
 * overlay chip, and the app — because control is gone the instant Chrome says
 * so and there is nothing to be gained by treating the three differently.
 * `chrome.debugger.detach` raises `onDetach`, which is where the clean-up
 * actually happens, so this function is a request rather than the act.
 */
async function stopActing(reason) {
  const state = await controlState()
  if (state.tabId === null) return

  await hideIndicator(state.tabId)
  await detachControl(state.tabId)

  // Belt and braces: if the detach never raised `onDetach` — because the tab
  // had already gone, say — the clean-up still has to happen.
  await releaseControl(state, reason)
}

/**
 * Clean up after control has gone, whoever ended it.
 *
 * ── Order is the whole design ────────────────────────────────────────────
 *
 * State first, POSTs second. Clearing `controlledTabId` and the snapshot is
 * what makes every subsequent CDP call impossible, and it must not be
 * conditional on the app being reachable.
 *
 * Then the in-flight intent is reported as `control-lost` **so it never
 * becomes an orphan**, and only then is the run halted. Both are best-effort:
 * if they fail, the app's own recovery sweep writes the outcome, which is
 * exactly the arrangement ADR-0010 §7 describes — the abandoning worker does
 * not write the outcome, the app does, and it may only record what it can
 * prove.
 */
let releasing = false

async function releaseControl(state, reason) {
  if (releasing) return
  releasing = true

  try {
    /**
     * The poll lease is NOT released here, and that is not an omission.
     *
     * It belongs to whichever `pollForWork` loop took it, and that loop is
     * almost certainly still running — parked on the 25-second long poll, which
     * is exactly where it is when somebody presses Stop or closes the tab.
     * Releasing it from underneath would let the next heartbeat alarm claim it
     * and start a SECOND loop beside the first: two consumers of
     * `/api/act/next`, two `runCommand`s racing over one in-flight intent. The
     * lease exists to make that impossible, so only its owner may give it up.
     */
    // Read the in-flight id, then drop ALL of it, and only then reach the
    // network. Clearing first is what makes every subsequent CDP call
    // impossible, and it must not be conditional on the app answering. It also
    // takes `inFlightIntentId` with it, so a later path finds nothing in
    // flight and cannot overwrite the outcome written below.
    const { inFlightIntentId } = await chrome.storage.session.get(['inFlightIntentId'])

    await clearControlState()
    await clearActingBadge()

    if (typeof inFlightIntentId === 'string') {
      await postReport(inFlightIntentId, { ok: false, failure: 'control-lost', detail: reason })
    }

    await postHalt(state.runId, reason)
  } finally {
    releasing = false
  }
}

/**
 * Everything the CDP layer needs from this file, in one place.
 *
 * Registered at the TOP LEVEL below, because MV3 only wakes a terminated
 * worker for listeners installed synchronously during module evaluation. A
 * `Fetch.requestPaused` that arrives after a worker death and is never
 * answered would leave the person's tab hanging forever with no explanation,
 * since `Fetch.enable` holds every request until somebody replies.
 */
const controlHandlers = {
  patternCovers,

  onPageLoaded: async (tabId) => {
    await showIndicator(tabId)
  },

  onDetached: async (state, reason) => {
    // `target_closed`, `canceled_by_user`, `replaced_with_devtools` — treated
    // identically on purpose. Control is gone the instant Chrome says so, and
    // sorting out why is not a thing to do while still holding a tab.
    await releaseControl(state, reason ?? 'control-lost')
  },

  onIndicatorLost: async () => {
    await stopActing('control-lost')
  },

  /**
   * The browser held a request it was about to send that this run may not make.
   *
   * Reported and then stopped, in that order. The request itself is already
   * failed at the network by the time this runs, so nothing left the machine —
   * which is what makes the stop clean rather than mid-effect.
   */
  onIrreversibleBlocked: async (failure, detail) => {
    // First writer wins, and this is the one that knows something. Claiming
    // the intent here means the `control-lost` that follows from stopping
    // finds nothing in flight and stays quiet, rather than overwriting "I was
    // about to send a POST and did not" with "I lost the browser".
    await reportInFlight({ ok: false, failure, detail: `${detail.method} ${detail.origin}` })
    await stopActing(failure)
  },
}

/* ── one command, start to finish ──────────────────────────────────────── */

/**
 * Open the tab, if this run has not got one yet.
 *
 * The FIRST command of a run must be `navigate`, and that is a consequence of
 * the guarantee rather than a protocol quirk: the only tab Propositum may
 * touch is one it created, so there is nothing to click in until it has
 * opened one and gone somewhere.
 *
 * ── Where the approved origins come from ─────────────────────────────────
 *
 * The command envelope is `{ intentId, kind, params }` and this file has no
 * other channel, so the run's identity and its approved sources travel in
 * `params`. Read tolerantly from either spelling, because the pin is on the
 * envelope and not on what is inside it.
 *
 * When the app sends none, the set is seeded with the origin of the URL it
 * asked us to open. That is sound rather than a shortcut: the app gated that
 * navigation before dispatching it, so the destination is app-attested. What
 * it is NOT is a widening — the extension can only ever narrow from what the
 * app told it.
 */
async function ensureControlledTab(command) {
  const params = command.params ?? {}
  const runId = command.runId ?? params.runId ?? null
  const declared = params.approvedOrigins ?? params.origins ?? null

  if (command.kind !== 'navigate') {
    return {
      ok: false,
      failure: 'control-lost',
      detail: 'Propositum has not opened a tab for this work yet',
    }
  }

  const seeded =
    Array.isArray(declared) && declared.length > 0
      ? declared
      : [originOf(params.url)].filter((origin) => origin !== null)

  if (seeded.length === 0) {
    return { ok: false, failure: 'off-origin', detail: 'that is not a web address' }
  }

  const tabId = await openControlledTab({ runId, approvedOrigins: seeded })
  await showActingBadge()
  setTimeout(() => void watchIndicator(), INDICATOR_GRACE_MS)

  return { tabId }
}

async function runCommand(command) {
  await chrome.storage.session.set({ inFlightIntentId: command.intentId })

  try {
    const state = await controlState()
    if (state.tabId === null) {
      const opened = await ensureControlledTab(command)
      if (opened.ok === false) {
        await reportInFlight(opened)
        return
      }
    }

    // `reportInFlight` rather than `postReport`: something that went wrong
    // mid-command — a blocked request, a detach — may already have said what
    // happened, and it knew more than this line does.
    await reportInFlight(await performCommand(command, controlHandlers))
  } catch (error) {
    // Nothing may escape this. An unreported intent is an orphan, and an
    // orphan is indistinguishable from a crash to everything downstream.
    await reportInFlight({
      ok: false,
      failure: 'not-delivered',
      detail: String(error?.message ?? error),
    })
  } finally {
    await chrome.storage.session.remove(['inFlightIntentId'])
  }
}

async function pollOnce() {
  const startedAt = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), POLL_ABORT_MS)

  try {
    const response = await actFetch('/api/act/next', { signal: controller.signal })
    if (!response.ok) return 'stop'

    const { command } = await response.json()
    if (!command || typeof command.intentId !== 'string') {
      // Nothing to do. If the app answered instantly rather than hanging,
      // wait before asking again — see POLL_FLOOR_MS.
      if (Date.now() - startedAt < POLL_FLOOR_MS) await sleep(POLL_FLOOR_MS)
      return 'continue'
    }

    await runCommand(command)
    return 'continue'
  } catch {
    // Unreachable, aborted, or answering something that is not JSON. The alarm
    // brings this back in thirty seconds; spinning here would not make the app
    // come up any sooner.
    return 'stop'
  } finally {
    clearTimeout(timer)
  }
}

async function pollForWork() {
  if (!(await claimPollLease())) return

  try {
    for (;;) {
      if ((await pollOnce()) === 'stop') return

      // Refresh the lease rather than re-taking it: this loop still holds it,
      // and letting it lapse mid-loop would let the alarm start a second one.
      await chrome.storage.session.set({ pollLeaseUntil: Date.now() + POLL_LEASE_MS })
    }
  } finally {
    await releasePollLease()
  }
}

/**
 * Registered here, at the top level, and not inside `wake()`.
 *
 * See `controlHandlers`. A listener installed later does not wake a dead
 * worker, and a `Fetch.requestPaused` nobody answers hangs the tab.
 */
registerControlListeners(controlHandlers)

/* ── lifecycle ─────────────────────────────────────────────────────────── */

async function wake() {
  // The panel is where a host grant is requested, because that needs a user
  // gesture and a service worker responding to a message does not have one.
  // Clicking the toolbar icon has to be able to open it.
  await chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})

  await verifyReachable()
  // Dynamic registrations do not survive an extension reload, and a grant can
  // be withdrawn while this worker is dead. Reconcile rather than assume.
  await reconcileContentScripts()
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES })

  /**
   * A worker that came back holding a tab it no longer drives.
   *
   * `chrome.debugger` attachments belong to the extension rather than to this
   * worker instance, so `controlledTabId` can survive a restart the attachment
   * did not — and an extension RELOAD detaches everything without raising
   * `onDetach` in the new worker. Left alone, that state is a tab id nothing
   * is attached to, an indicator nobody is renewing, and an intent that would
   * never be reported. Reconciling rather than assuming is the same rule the
   * content-script registration follows two lines up.
   */
  const state = await controlState()
  if (state.tabId !== null) {
    await hideIndicator(state.tabId)
    await detachControl(state.tabId)
    await releaseControl(state, 'control-lost')
  }

  // Last, because it does not return while the app has work to hand out.
  await pollForWork()
}

chrome.runtime.onStartup.addListener(wake)
chrome.runtime.onInstalled.addListener(wake)

/**
 * The heartbeat does double duty: it flushes the buffer, and it is how the app
 * learns the worker is alive. A missed heartbeat is what the app turns into a
 * `captureGap` with reason `service_worker_terminated` — the gap is detected by
 * absence of a signal, never by the dead worker reporting its own death.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return

  // Ambient first, and unconditionally — it is the path that runs when there is
  // no session, which is precisely when the rest of this returns early.
  await flushAmbient()
  await showSuggestionBadge()

  const session = await loadSession()
  if (session) {
    await flush()
    try {
      await post('/api/capture/heartbeat', {}, session)
    } catch {
      /* the app will notice the silence */
    }
  }

  /**
   * The resurrector, and it comes last.
   *
   * `pollForWork` does not return while the app has work to hand out, so
   * anything after it would never run. Reaching it unconditionally — outside
   * the session gate above — matters because acting happens under a ratified
   * contract, and whether a capture session is also running is a different
   * question this file has no business conflating with it.
   *
   * Two alarm handlers overlapping is normal and is what the poll lease is
   * for: the second finds the lease held and does the heartbeat half only.
   */
  await pollForWork()
})

/** The human left. No CDP equivalent for either of these signals. */
chrome.idle.onStateChanged.addListener(async (state) => {
  const session = await loadSession()
  if (!session) return
  if (state === 'active') return

  await buffer({
    signal: 'away',
    at: new Date().toISOString(),
    elapsedMs: Date.now() - session.startedAtMs,
    cause: state === 'locked' ? 'lock' : 'idle',
  })
  await flush()
})

/* ── messages from content scripts ─────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    /**
     * The working-here marker, and its Stop.
     *
     * Checked FIRST, and checked against `controlledTabId` before anything is
     * believed. Every other page in Chrome can send this extension a message —
     * the content script runs on every https origin — so an unchecked
     * `propositumIndicator: 'alive'` from any tab would let a hostile page
     * renew a marker it is not displaying, which is the precise failure the
     * grace window exists to catch.
     *
     * The tab id comes from `sender`, which Chrome fills in and the page
     * cannot forge. Reading it needs no `tabs` permission: it is our own
     * script reporting, not an enumeration.
     */
    if (message?.propositumIndicator !== undefined) {
      const state = await controlState()
      if (state.tabId === null || sender.tab?.id !== state.tabId) {
        return sendResponse({ ok: false })
      }

      if (message.propositumIndicator === 'alive') {
        await chrome.storage.session.set({ indicatorAliveAt: Date.now() })
        return sendResponse({ ok: true })
      }

      if (message.propositumIndicator === 'stop') {
        // A user gesture, so it may do everything — and what it does is give
        // up the tab before it tells anyone, so Stop works with the app shut.
        await stopActing('canceled_by_user')
        return sendResponse({ ok: true })
      }

      return sendResponse({ ok: false })
    }

    // The panel asks; everything else reports.
    if (message?.ask === 'grants') return sendResponse(await grantState())
    if (message?.ask === 'acting') {
      const state = await controlState()
      return sendResponse({ acting: state.tabId !== null })
    }
    if (message?.ask === 'stop-acting') {
      await stopActing('canceled_by_user')
      return sendResponse({ acting: false })
    }
    if (message?.ask === 'reconcile') {
      await reconcileContentScripts()
      return sendResponse(await grantState())
    }

    /**
     * Nothing the agent browses is anything the PERSON browsed.
     *
     * The capture content script runs on every granted origin, and the tab
     * Propositum opened is on one of them — so without this line every page
     * the agent visited would arrive here as an ordinary observation, and the
     * person's own browsing record would fill up with somewhere they never
     * went. Detection would then offer them work off the back of work they had
     * already handed over.
     *
     * It is also the standing rule from ADR-0010's retention section: the two
     * ledgers are disjoint. `EXCERPT_BUDGET_CHARS` governs what Propositum
     * retains about a person's own browsing; `ActionEvidence` is what the
     * agent saw while acting under a ratified contract. Nothing crosses.
     */
    const control = await controlState()
    if (control.tabId !== null && sender.tab?.id === control.tabId) {
      return sendResponse({ ok: true, ignored: true })
    }

    const session = await loadSession()

    /**
     * No session: this is AMBIENT, and it is metadata only.
     *
     * The strip happens here rather than in the content script because the
     * content script must not know whether a session is running — a page could
     * learn the answer by timing what its own script is allowed to do.
     *
     * `text` is deleted rather than omitted at the source, so there is exactly
     * one line in this extension that decides page text may travel, and it is
     * this one.
     */
    if (!session) {
      const { text, ...metadataOnly } = message.signal ?? {}
      void text

      await bufferAmbient({ ...metadataOnly, at: Date.now() })
      return sendResponse({ ok: true, ambient: true })
    }

    // A session IS running. Full capture, but only on approved sources — the
    // sender is the least trustworthy input this file receives, and the app
    // checks again against its own grant list before anything is stored.
    const origin = sender.origin ?? ''
    const approved = session.sources.some((s) => origin.startsWith(s.origin))
    if (!approved) {
      // Approved-source capture is off here, but the person may still be
      // working somewhere they have not set up. That is what ambient is for.
      const { text, ...metadataOnly } = message.signal ?? {}
      void text

      await bufferAmbient({ ...metadataOnly, at: Date.now() })
      return sendResponse({ ok: true, ambient: true })
    }

    // No `approvedSourceId` and no `kind`. The app decides both: which source
    // this belongs to, from its own grant list, and what the signal was, from
    // the tested classifiers. See src/server/capture-adapter.ts.
    await buffer({
      ...message.signal,
      elapsedMs: Date.now() - session.startedAtMs,
    })
    sendResponse({ ok: true })
  })()

  return true // async response
})

/* ── answering the notification ────────────────────────────────────────── */

/**
 * Both answers are a USER GESTURE, which is what makes them able to do things
 * the alarm cannot. Opening a tab is deliberate: the person lands on a page
 * showing the durable things about to be created in their name, rather than a
 * toast claiming it happened.
 *
 * ── One parameter, and it is not a decision ──────────────────────────────
 *
 * The link used to carry the subject, the sites and the intent, and the app
 * approved the sites it was handed. That made approval a function of the LINK
 * rather than of what had been observed, and a crafted one could put a site
 * nobody had visited into `ApprovedSource` behind a single click.
 *
 * Now it carries the thread signature and nothing else. The app reads the
 * subject, the offer, the grounds and the sites off its own server-side buffer
 * against that key, so this file cannot widen anything even if it wanted to —
 * and neither can anything that forges a link to look like this one.
 *
 * It also fixes a dead end. `?subject=` rendered "that link has gone stale" for
 * the first thirty seconds of every offer, because the subject only exists once
 * the app has named the thread, and permanently on a machine with no
 * `ANTHROPIC_API_KEY`. `?thread=` is available from the very first poll that
 * detected anything, so the link works whether or not a model ever ran; the
 * page shows the composed offer when there is one and the deterministic
 * "start watching" form when there is not.
 */
async function answeredYes() {
  const { offer } = await chrome.storage.session.get(['offer'])
  if (!offer?.thread) return

  const params = new URLSearchParams({ thread: offer.thread })
  await chrome.tabs.create({ url: `${APP_ORIGIN}/start?${params.toString()}` })
  await chrome.action.setBadgeText({ text: '' })
}

async function answeredNo() {
  const { offer } = await chrome.storage.session.get(['offer'])
  await chrome.action.setBadgeText({ text: '' })

  /**
   * Quiet, before anything else, and whether or not the server hears about it.
   *
   * Declining drops the observations that produced the offer, which re-detects
   * as a different thread with a different signature — so the per-thread
   * suppression key does not survive a decline and the same work came back
   * about a minute later with `requireInteraction: true`. This is the thing
   * that actually holds "not now": one hour, mirroring the app's `SNOOZE_MS`.
   */
  await chrome.storage.session.set({ quietUntil: Date.now() + DECLINE_QUIET_MS })

  // A `work-offer` has no single primary site — it has the thread's sites — so
  // the first of those is what gets snoozed. Reading only `origin` meant "Not
  // now" silently did nothing for every composed offer.
  const origin = offer?.origin || offer?.origins?.[0]
  if (!origin) return

  // Declining drops the evidence as well as snoozing, so the same detection
  // cannot immediately re-fire off the pages that produced it.
  await fetch(`${APP_ORIGIN}/api/capture/ambient/decline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CUSTOM_HEADER]: '1' },
    body: JSON.stringify({ origin }),
  }).catch(() => {})
}

chrome.notifications.onButtonClicked.addListener(async (id, index) => {
  if (!id.startsWith('propositum:')) return
  chrome.notifications.clear(id)
  await (index === 0 ? answeredYes() : answeredNo())
})

// Clicking the body, rather than a button, means "tell me more" — same as yes.
chrome.notifications.onClicked.addListener(async (id) => {
  if (!id.startsWith('propositum:')) return
  chrome.notifications.clear(id)
  await answeredYes()
})

/* ── host grants, and the content scripts that follow from them ────────── */

/**
 * Registration is dynamic, and that is the whole privacy argument.
 *
 * A static `content_scripts` block in the manifest would need `https://*​/*` to
 * cover origins chosen at runtime, which costs "Read and change all your data
 * on all websites" at install and puts the injected set back under our control
 * — an `if` statement we could get wrong.
 *
 * `chrome.scripting.registerContentScripts` inverts it: Chrome REFUSES to
 * register for an origin the extension has no host permission for. So the set
 * of pages this runs on is the set the person granted, enforced by the browser,
 * and withdrawing a grant in Chrome's own UI stops the injection whether or not
 * our code notices. That is ADR-0002's claim made structural.
 */
const SCRIPT_PREFIX = 'propositum-'

function scriptIdFor(origin) {
  return `${SCRIPT_PREFIX}${origin.replace(/[^a-z0-9]/gi, '-')}`
}

/** Origins Chrome has actually granted, as match patterns. */
async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll()
  return origins.filter((o) => !o.startsWith('http://127.0.0.1'))
}

/**
 * Make the registered scripts match the grants, in both directions.
 *
 * Dynamic registrations survive a browser restart but NOT an extension reload,
 * and a grant can be withdrawn while the worker is dead. So this runs on every
 * startup rather than only on change — reconciling is cheap and drift here is
 * silent.
 */
async function reconcileContentScripts() {
  const origins = await grantedOrigins()
  const wanted = new Map(origins.map((o) => [scriptIdFor(o), o]))

  const registered = await chrome.scripting.getRegisteredContentScripts()
  const ours = registered.filter((s) => s.id.startsWith(SCRIPT_PREFIX))

  const stale = ours.filter((s) => !wanted.has(s.id)).map((s) => s.id)
  if (stale.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: stale }).catch(() => {})
  }

  const have = new Set(ours.map((s) => s.id))
  const missing = [...wanted].filter(([id]) => !have.has(id))
  if (missing.length === 0) return

  await chrome.scripting
    .registerContentScripts(
      missing.map(([id, origin]) => ({
        id,
        matches: [origin],
        js: ['src/content.js'],
        runAt: 'document_idle',
      })),
    )
    .catch((error) => {
      // Registration failing is capture silently not happening, which is the
      // failure this whole file is written against.
      console.error('[propositum] could not register capture for', missing, error)
    })
}

/** What the panel renders: which approved sources still need a grant. */
async function grantState() {
  const session = await loadSession()
  const origins = await grantedOrigins()

  const sources = (session?.sources ?? []).map((source) => ({
    ...source,
    granted: origins.some((pattern) => patternCovers(pattern, source.origin)),
  }))

  return { running: session !== null, sources }
}

chrome.permissions.onAdded.addListener(async () => {
  await reconcileContentScripts()
})

chrome.permissions.onRemoved.addListener(async (removed) => {
  await reconcileContentScripts()

  // Tell the app. Until now nothing ever wrote `grantState = 'revoked'` — only
  // `'granted'` was ever set — so five UI surfaces rendered a withdrawn state
  // that was unreachable, and a `permission_revoked` CaptureGap could not occur.
  const session = await loadSession()
  if (!session) return

  for (const origin of removed.origins ?? []) {
    try {
      await post('/api/capture/revoked', { origin }, session)
    } catch {
      // The app will find out on its next grant check. Losing this is a stale
      // `granted` flag, which leaks nothing: the extension is structurally
      // incapable of reading a revoked origin.
    }
  }
})
