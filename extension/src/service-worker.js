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

const APP_ORIGIN = 'http://127.0.0.1:3117'
const HEARTBEAT_ALARM = 'propositum-heartbeat'
const HEARTBEAT_MINUTES = 0.5

const CUSTOM_HEADER = 'x-propositum-capture'

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
    await chrome.action.setBadgeText({ text: '' })
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

/* ── the one interruption that is not an offer ──────────────────────────── */

/**
 * A run stopped and is waiting for the person to say yes to one thing.
 *
 * ── Why this interrupts when almost nothing else does ────────────────────
 *
 * `showSuggestionBadge` above spends four paragraphs arguing that a suggestion
 * which interrupts is a suggestion people turn off. All of that is still true
 * and none of it applies here, because this is not a suggestion. The person
 * already handed work over; a run is stopped mid-shift; and the thing it is
 * stopped on is something it cannot take back. Waiting for them to wander back
 * to a tab is how a confirmation quietly expires into nothing.
 *
 * ── ONE button, and it says "Show me" ────────────────────────────────────
 *
 * There is deliberately no Approve button, and there is deliberately no path
 * from this file to a verdict. Approving from a notification is approving
 * without seeing what you are approving, and the entire value of a confirmation
 * pause is that the human review is real. This file already holds the
 * precedent, in its own words: *the person lands on a page showing the durable
 * things about to be created in their name, rather than a toast claiming it
 * happened.*
 *
 * So the button opens the screen. What the person sees there is the origin, the
 * method Chrome attested, the words about to be typed VERBATIM, a picture of
 * the page, and the button's own label quoted with attribution — and only then
 * two controls. None of that fits in a notification, which is the point.
 *
 * ── There is no second button, not even "Don't" ──────────────────────────
 *
 * Tempting, because a no grants nothing and could safely be taken from here.
 * Left out anyway: a two-button notification teaches the hand to answer these
 * without reading, and the hand does not distinguish which of the two buttons
 * it learned on. The offer notification can afford *Not now* because the worst
 * a mis-tap costs there is an hour of quiet.
 *
 * ── Once per request, and never quietened by "Not now" ───────────────────
 *
 * Keyed on the request id, which is stable and unique — unlike a thread
 * signature, which moves. `quietUntil` is NOT consulted: declining an offer
 * buys quiet from offers, and a run the person themselves started, now blocked
 * on them, is not an offer. Snoozing it would mean an hour of a stopped shift
 * with nothing on screen to explain why.
 */
async function showPendingConfirmation() {
  try {
    const response = await fetch(`${APP_ORIGIN}/api/act/confirmation`, {
      headers: { [CUSTOM_HEADER]: '1' },
    })
    if (!response.ok) return

    const { confirmation } = await response.json()
    if (!confirmation?.id || !confirmation.href) return

    const key = `asked:${confirmation.id}`
    const { [key]: alreadyAsked } = await chrome.storage.session.get([key])
    if (alreadyAsked) return

    await chrome.storage.session.set({
      [key]: true,
      // Stored so the click has somewhere to go. The href comes from the app,
      // not from this file, so the extension cannot send the person to a screen
      // for a request the app does not have.
      [`confirm:${confirmation.id}`]: confirmation.href,
    })

    chrome.notifications.create(`propositum-confirm:${confirmation.id}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: 'Propositum needs you to say yes to one thing',
      // CODE-GENERATED by the app from facts Chrome attested — not model prose
      // and not the page's words. Safe to put in a notification for exactly
      // that reason.
      message: confirmation.summary,
      buttons: [{ title: 'Show me' }],
      // It stays until answered. A confirmation that auto-dismisses is a
      // confirmation that expires because somebody was in another window.
      requireInteraction: true,
    })
  } catch {
    /* the health check owns the unreachable case, and says so louder */
  }
}

/**
 * Open the screen. This is the only thing a notification click can do.
 *
 * A USER GESTURE, which is what makes `chrome.tabs.create` available at all —
 * and it is also the honest shape of the interaction: the person asked to look,
 * and looking is what happens.
 */
async function showMeTheConfirmation(notificationId) {
  const requestId = notificationId.slice('propositum-confirm:'.length)
  const key = `confirm:${requestId}`
  const { [key]: href } = await chrome.storage.session.get([key])
  if (!href) return

  await chrome.tabs.create({ url: `${APP_ORIGIN}${href}` })
}

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

  // After the badge, and unconditionally — a paused run is waiting whether or
  // not there is a session, because a Shift outlives the session that started
  // it and the run parked on a question holds no lease at all.
  await showPendingConfirmation()

  const session = await loadSession()
  if (!session) return

  await flush()
  try {
    await post('/api/capture/heartbeat', {}, session)
  } catch {
    /* the app will notice the silence */
  }
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
    // The panel asks; everything else reports.
    if (message?.ask === 'grants') return sendResponse(await grantState())
    if (message?.ask === 'reconcile') {
      await reconcileContentScripts()
      return sendResponse(await grantState())
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
  /**
   * Two prefixes, and they must not be confused.
   *
   * `propositum:` is an offer, where index 0 is yes and index 1 is "Not now".
   * `propositum-confirm:` is a paused run waiting on a human, where there is
   * exactly ONE button and it opens a screen. Routing a confirmation through
   * `answeredYes` would start work off a notification tap — which is the
   * failure this whole feature is spent preventing — so it is checked first.
   */
  if (id.startsWith('propositum-confirm:')) {
    chrome.notifications.clear(id)
    await showMeTheConfirmation(id)
    return
  }

  if (!id.startsWith('propositum:')) return
  chrome.notifications.clear(id)
  await (index === 0 ? answeredYes() : answeredNo())
})

// Clicking the body, rather than a button, means "tell me more" — same as yes.
chrome.notifications.onClicked.addListener(async (id) => {
  // For a confirmation, the body and the button do the same thing, because
  // there is only one thing either of them can do: show the person the screen.
  if (id.startsWith('propositum-confirm:')) {
    chrome.notifications.clear(id)
    await showMeTheConfirmation(id)
    return
  }

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
