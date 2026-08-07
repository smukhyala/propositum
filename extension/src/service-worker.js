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

const APP_ORIGIN = 'http://127.0.0.1:3117'
const HEARTBEAT_ALARM = 'propositum-heartbeat'
const HEARTBEAT_MINUTES = 0.5

const CUSTOM_HEADER = 'x-propositum-capture'

/* ── session state, which never lives in a module variable ─────────────── */

async function loadSession() {
  const stored = await chrome.storage.session.get(['session'])
  return stored.session ?? null
}

async function saveSession(session) {
  await chrome.storage.session.set({ session })
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

/* ── lifecycle ─────────────────────────────────────────────────────────── */

chrome.runtime.onStartup.addListener(async () => {
  await verifyReachable()
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES })
})

chrome.runtime.onInstalled.addListener(async () => {
  await verifyReachable()
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES })
})

/**
 * The heartbeat does double duty: it flushes the buffer, and it is how the app
 * learns the worker is alive. A missed heartbeat is what the app turns into a
 * `captureGap` with reason `service_worker_terminated` — the gap is detected by
 * absence of a signal, never by the dead worker reporting its own death.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return
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
    kind: 'switchedAway',
    observedAt: new Date().toISOString(),
    elapsedMs: Date.now() - session.startedAtMs,
    attested: { cause: state === 'locked' ? 'lock' : 'idle' },
  })
  await flush()
})

/* ── messages from content scripts ─────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  ;(async () => {
    const session = await loadSession()
    if (!session) return sendResponse({ ok: false, reason: 'no-session' })

    // A content script only runs on an origin the person granted, but check
    // anyway — the sender is the least trustworthy input this file receives.
    const origin = sender.origin ?? ''
    const source = session.sources.find((s) => origin.startsWith(s.origin))
    if (!source) return sendResponse({ ok: false, reason: 'origin-not-approved' })

    await buffer({
      ...message.event,
      approvedSourceId: source.id,
      elapsedMs: Date.now() - session.startedAtMs,
    })
    sendResponse({ ok: true })
  })()

  return true // async response
})

/* ── session control, from the side panel ──────────────────────────────── */

chrome.runtime.onMessageExternal?.addListener?.(() => undefined)

export async function startSession(session) {
  await saveSession({ ...session, startedAtMs: Date.now() })
  await chrome.storage.session.set({ pending: [] })
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_MINUTES })
}

export async function endSession() {
  await flush()
  await chrome.storage.session.remove(['session', 'pending'])
  await chrome.alarms.clear(HEARTBEAT_ALARM)
}
