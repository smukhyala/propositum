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

import { looksLikeSearch } from './search-url.js'

const APP_ORIGIN = 'http://127.0.0.1:3117'
const HEARTBEAT_ALARM = 'propositum-heartbeat'
const HEARTBEAT_MINUTES = 0.5

const CUSTOM_HEADER = 'x-propositum-capture'

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
  // Bounded here too. The app bounds it again; neither trusts the other.
  await chrome.storage.session.set({ ambient: ambient.slice(-200) })
}

async function flushAmbient() {
  const { ambient = [] } = await chrome.storage.session.get(['ambient'])
  if (ambient.length === 0) return

  try {
    const response = await fetch(`${APP_ORIGIN}/api/capture/ambient`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CUSTOM_HEADER]: '1' },
      body: JSON.stringify({
        observations: ambient.map((o) => ({
          at: o.at,
          url: o.url ?? '',
          title: o.title ?? '',
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
    // 409 means a session started under us. Drop them: the ledger is now the
    // right destination and these would be a duplicate of what it records.
    if (response.ok || response.status === 409) {
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
     * The previous thread's key is dropped when the thread changes, so this
     * cannot accumulate a key per subject anyone has ever looked at, and a
     * thread genuinely returned to after an hour is allowed to interrupt again.
     *
     * Only a `work-offer` interrupts. The degraded form is a real offer and it
     * keeps the badge, but "Propositum noticed you are reading about something"
     * with no proposal attached is not worth a notification — that is the
     * interruption people turn the feature off over.
     */
    const thread = suggestion.thread ?? ''
    const key = `told:${thread}`
    const { toldKey: previous } = await chrome.storage.session.get(['toldKey'])
    if (previous && previous !== key) await chrome.storage.session.remove([previous])

    const already = await chrome.storage.session.get([key])
    if (suggestion.kind === 'work-offer' && thread && !already[key]) {
      await chrome.storage.session.set({ [key]: true, toldKey: key })

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
    granted: origins.some((o) => o.replace(/\/\*$/, '') === source.origin.replace(/\/\*$/, '')),
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
