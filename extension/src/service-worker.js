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

/* ── one discipline for touching session storage ───────────────────────── */

/**
 * Serialise every read-modify-write over `chrome.storage.session`.
 *
 * ── The bug this closes, which was silent and non-deterministic ──────────
 *
 * `get` then `set` is two awaits with a gap in the middle, and the gap is a
 * scheduling point. Two `onMessage` handlers that interleave there both read
 * the same array, both push one item, and the second `set` wins — so one
 * observation is gone, with nothing logged and nothing to notice.
 *
 * It was survivable while content scripts ran on a handful of granted origins.
 * Since the manifest went broad (ADR-0008) `content.js` runs on every https
 * page and each tab reports engagement every fifteen seconds, so with a few
 * tabs open the interleave is routine rather than exotic. What is lost is
 * precisely the dwell and visit signal the offer grounds are computed from,
 * which means the arithmetic that decides whether Propositum may offer to DO
 * work is running on a quietly incomplete record.
 *
 * The acting path adds more concurrent writers still — the controlled tab id,
 * the snapshot ref map, the set of intents already reported — and every one of
 * them has the same shape. Two disciplines in one file is how you get a third,
 * so everything goes through here.
 *
 * A promise chain rather than a lock: it serialises within one worker
 * instance, which is where the interleave happens. It does NOT survive worker
 * death, and it does not need to — a dead worker has no concurrent handlers.
 */
let storageQueue = Promise.resolve()

function withStorage(work) {
  const done = storageQueue.then(work, work)
  // The queue itself must never reject, or every later caller inherits it.
  storageQueue = done.then(
    () => undefined,
    () => undefined,
  )
  return done
}

/* ── buffering, because the worker dies mid-flush ──────────────────────── */

async function buffer(event) {
  await withStorage(async () => {
    const { pending = [] } = await chrome.storage.session.get(['pending'])
    pending.push({ ...event, sourceSeq: pending.length })
    await chrome.storage.session.set({ pending })
  })
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
 * The longest tab group title that leaves the browser. ADR-0013.
 *
 * ── Why there is a bound at all ──────────────────────────────────────────
 *
 * The same reason `AMBIENT_TITLE_MAX` exists, and it is not hypothetical here:
 * an untruncated title was sent against `title: z.string().max(300)` and every
 * flush failed Zod with a 400 forever. `chrome.tabGroups` publishes **no
 * documented limit** on `title` — it is whatever a person typed into the
 * rename box, and nothing stops a paste. So the sender bounds it, at or below
 * what the receiver accepts, which is the discipline the comment above spends
 * its length on: two bounds that disagree about which is tighter is a lock.
 *
 * ── Why 120 and not 300 ──────────────────────────────────────────────────
 *
 * A page title is a document's name and is routinely long; a group title is a
 * LABEL a person typed for a handful of tabs, and it is rendered into a
 * sentence about their own afternoon. Something past a line and a half is not
 * a label any more, and truncating a label mid-word is better than putting a
 * paragraph into "You have been looking into …". The number is a judgement, not
 * a measurement, and it is written down as one.
 */
const AMBIENT_GROUP_TITLE_MAX = 120

/**
 * The label a person typed for their own group of tabs. ADR-0013.
 *
 * ── The one sanctioned path, and why it is the only one ──────────────────
 *
 * A page **we are already observing** sends us a message; Chrome fills in
 * `sender.tab`, which a page cannot forge and which needs no permission to
 * read — this file already relies on exactly that for the working-here marker,
 * and says so there. `groupId` is not one of the four sensitive properties the
 * `tabs` permission gates (`url`, `pendingUrl`, `title`, `favIconUrl`), so it
 * arrives unscrubbed. That id, and only that id, is then handed to
 * `chrome.tabGroups.get`.
 *
 * **What that reveals is bounded by construction:** the group of a tab we were
 * already watching, and nothing else. `chrome.tabGroups.get` returns group
 * METADATA — `{id, title?, color, collapsed, windowId}` — and never the tabs
 * inside it. Chrome's own reference is explicit: *"To group and ungroup tabs,
 * or to query what tabs are in groups, use the `chrome.tabs` API."* We do not,
 * and `tests/extension-permissions.test.ts` keeps it that way, including a new
 * assertion that this namespace is only ever reached with an id from
 * `sender.tab`. There is deliberately no `chrome.tabGroups.query`: that would
 * enumerate every group in every window, which is a different capability with a
 * different argument, and nobody has made it.
 *
 * ── Why it is worth a permission ─────────────────────────────────────────
 *
 * `docs/research/intent-signals.md` §4.3 puts it plainly: `topics.ts` is a
 * stopword list, a branding regex, a Damerau-Levenshtein neighbour test and a
 * canonicalisation pass, and the output of all of it is a ranked list of words
 * that a model then spends a call turning into a sentence. **A tab group titled
 * "world models" is that sentence, typed by the person.** The same research
 * found the pattern four separate times: the best intent signals are the ones
 * somebody authored.
 *
 * ── What it costs, honestly ──────────────────────────────────────────────
 *
 * One install warning: *"View and manage your tab groups."* That is a real
 * price and it is not absorbed by the broad host permission the way `tabs` and
 * `webNavigation` are. It buys a signal that is **excellent when present and
 * absent most of the time** — most people do not use tab groups — which is why
 * it may only ever improve a NAME and may never gate a detection or an offer.
 *
 * ── Every way this returns nothing, and it must return nothing quietly ───
 *
 *   - the message did not come from a tab (the side panel asks things too);
 *   - `chrome.tabGroups` is missing, on a Chrome older than 89;
 *   - `groupId` is `TAB_GROUP_ID_NONE` — the tab is in no group, which is the
 *     common case and is why the lookup is skipped before it is attempted;
 *   - the group was deleted between the message and the lookup, so `get`
 *     rejects. A person collapsing and closing a group while a page in it is
 *     reporting is ordinary, not exotic;
 *   - the group exists and has no title. `title` is optional in the API and
 *     Chrome shows an unnamed group as a coloured stub. An unnamed group is
 *     not an authored label, so it is the same answer as no group at all.
 */
const TAB_GROUP_ID_NONE = -1

async function groupTitleOf(sender) {
  const groupId = sender?.tab?.groupId
  if (typeof groupId !== 'number' || groupId === TAB_GROUP_ID_NONE) return undefined
  if (typeof chrome.tabGroups?.get !== 'function') return undefined

  try {
    // `get(groupId)`, never `query({})`. A query returns every group in the
    // browser, including groups made entirely of tabs Propositum has never
    // seen — which is the one thing this whole mechanism exists not to do.
    // A `query({})` sat here, its result discarded into `void`, and it cost
    // nothing to remove and everything to keep.
    const group = await chrome.tabGroups.get(groupId)
    const title = (group?.title ?? '').trim()
    // An empty title is absent, not empty-string: the app's schema would take
    // `''` happily and the naming path would then have to know that one
    // particular label means "there is no label".
    return title === '' ? undefined : title.slice(0, AMBIENT_GROUP_TITLE_MAX)
  } catch {
    // Gone between the message and the lookup. Nothing to say, and saying
    // nothing is the correct answer rather than a degraded one.
    return undefined
  }
}

/**
 * Ambient observations, held separately from session events.
 *
 * A separate buffer and a separate endpoint, because they have different
 * destinations and different rules. Mixing them would mean one flush deciding
 * per-item where each belongs, which is exactly the kind of branch that
 * eventually sends page text to the wrong place.
 */
/**
 * What kind of ambient observation a raw signal is, or null for "none".
 *
 * ── A selection is not an arrival, and calling it one broke a ground ─────
 *
 * The mapping used to special-case `engagement` and `away` and let everything
 * else fall through to `looksLikeSearch(url) ? 'query' : 'navigation'`.
 * `content.js` also emits `signal: 'selection'`, so every selection arrived at
 * the app labelled as somebody NAVIGATING to the page.
 *
 * `detect.ts` counts `navigation` and `query` as arrivals and dedupes only
 * against the immediately preceding URL. So: read A, visit B, switch back to
 * the tab showing A — which fires no navigation — and select a sentence. That
 * selection lands as an arrival at A whose predecessor is B, `visits(A)`
 * becomes two, and `returnedTo` fires. The offer then tells somebody they
 * "came back to" a page they never re-navigated to. On a results page the same
 * selection counts as an extra query instead.
 *
 * That is not a cosmetic mislabel. `came-back` and `refined-the-search` are
 * INTENT grounds, and an offer to actually DO work requires one — so a
 * manufactured arrival manufactures the permission to act. And
 * `selectionchange` fires repeatedly while dragging, so one paragraph produced
 * several of them.
 *
 * It is the same failure as `url.includes('?')` meaning "searched": a signal
 * relabelled as a stronger one on the way past. So this is an exhaustive map
 * with **no fall-through**. A signal kind nothing here recognises is dropped,
 * not guessed at — because the guess is always toward the kind that reads as
 * more intentional.
 *
 * A selection is dropped rather than remapped to `engagement`: the ambient
 * record already carries dwell and scroll for that page from `reportEngagement`,
 * so a selection minus its text (stripped before it ever reaches here) adds
 * nothing the app does not already have.
 */
function ambientKindOf(signal, url) {
  if (signal === 'engagement') return 'engagement'
  if (signal === 'away') return 'away'
  if (signal === 'navigation') return looksLikeSearch(url) ? 'query' : 'navigation'
  return null
}

async function bufferAmbient(observation) {
  if (ambientKindOf(observation?.signal, observation?.url ?? '') === null) return

  await withStorage(async () => {
    const { ambient = [] } = await chrome.storage.session.get(['ambient'])
    ambient.push(observation)
    // Bounded here too, and never above what the app will accept. The oldest go
    // first: recent activity is what a detection is about.
    await chrome.storage.session.set({ ambient: ambient.slice(-AMBIENT_BATCH_MAX) })
  })
}

/**
 * Put a batch back after the app turned out to be unavailable.
 *
 * In front of whatever arrived while it was away, because these are older, and
 * re-bounded because the buffer may have filled behind them.
 */
async function returnAmbient(batch) {
  await withStorage(async () => {
    const { ambient = [] } = await chrome.storage.session.get(['ambient'])
    await chrome.storage.session.set({
      ambient: [...batch, ...ambient].slice(-AMBIENT_BATCH_MAX),
    })
  })
}

async function flushAmbient() {
  /**
   * Take the batch and clear the buffer in one go, BEFORE sending.
   *
   * The obvious order — send, then `set({ ambient: [] })` on success — throws
   * away everything that arrived during the fetch. On loopback that window is
   * short; with a content script on every https page and engagement reports
   * every fifteen seconds it is not short enough, and what is lost is
   * indistinguishable from the person not having read anything.
   *
   * Taking first means concurrent appends land in a fresh buffer that nothing
   * is about to clear, and the only thing at risk is the batch in flight —
   * which is put back if the app turns out to be unavailable.
   */
  const ambient = await withStorage(async () => {
    const { ambient: held = [] } = await chrome.storage.session.get(['ambient'])
    if (held.length === 0) return []

    // A buffer written by an older build of this file can hold signals this
    // one has no truthful kind for — `selection`, most of all. Dropping them
    // on the way out means a version skew costs a few observations rather than
    // a batch the schema will refuse.
    const batch = held
      .filter((o) => ambientKindOf(o?.signal, o?.url ?? '') !== null)
      .slice(-AMBIENT_BATCH_MAX)

    await chrome.storage.session.set({ ambient: [] })
    return batch
  })

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
           *
           * The classification itself lives in `ambientKindOf`, which is also
           * what `bufferAmbient` consults to decide whether a signal belongs in
           * this buffer at all. One author for "what kind is this", so a signal
           * cannot be refused entry by one rule and relabelled by another.
           */
          kind: ambientKindOf(o.signal, o.url ?? ''),
          ...(typeof o.dwellMs === 'number' ? { engagedMs: o.dwellMs } : {}),
          /**
           * The three fields this projection used to drop on the floor.
           *
           * ── The shape of the bug, kept because it is the general one ─────
           *
           * This object is hand-built field by field, so a field added to the
           * app's schema and to `content.js` is carried by NOBODY until a line
           * appears here. `scrollFraction` spent the whole build in exactly
           * that state: computed on every engagement report, given a field at
           * the app's door on 2026-08-17, and reachable by `curl` and by
           * nothing a browser does. Three places in the corpus said ambient
           * capture carried "dwell and scroll" while this function quietly did
           * not. A projection is where a wire format goes to disagree with
           * itself, and the fix is a line, not a rewrite: a spread of `o` would
           * carry `signal` and `interacted` and any future field straight past
           * the one door that decides what may travel.
           *
           * ── Why scroll is guarded and dwell is not ───────────────────────
           *
           * `ambientSchema` bounds it `min(0).max(1)`, and a batch containing
           * one out-of-range value is refused whole and then DROPPED — a 4xx is
           * not retried here, deliberately. `content.js` does not clamp, and
           * argues at length for not clamping: `deepest` is a ratio of live
           * layout numbers and overscroll can put it above 1. Copying it
           * unguarded would therefore start throwing away entire batches over
           * one rubbery number on one page.
           *
           * So an out-of-range reading is OMITTED, which is exactly what
           * happened to every reading until today. This is not the clamp
           * `content.js` refused: a clamp asserts 1.02 was 1, and would let a
           * sender establish a value the session path drops. Omitting says
           * nothing at all, which is what an absent field already means. Which
           * batches the app accepts is therefore unchanged; what changed is
           * that the ones it accepts now carry a scroll fraction.
           *
           * `exitType` needs no such guard — the app's `z.enum` and
           * `content.js`'s `EXIT_TYPES` are the same closed set, and the value
           * is one of three literals rather than arithmetic over layout.
           *
           * `groupTitle` is bounded on the way IN, by `groupTitleOf`, at or
           * below what the schema takes. Bounding at both ends is the same
           * discipline `AMBIENT_TITLE_MAX` exists for.
           */
          ...(typeof o.scrollFraction === 'number' &&
          o.scrollFraction >= 0 &&
          o.scrollFraction <= 1
            ? { scrollFraction: o.scrollFraction }
            : {}),
          ...(typeof o.exitType === 'string' ? { exitType: o.exitType } : {}),
          ...(typeof o.groupTitle === 'string'
            ? { groupTitle: o.groupTitle.slice(0, AMBIENT_GROUP_TITLE_MAX) }
            : {}),
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
     * unwilling, so those go back in the buffer — that is the case it exists
     * for. Everything else is already gone from it, because the batch was
     * taken before the send.
     */
    if (response.ok || response.status === 409) return

    if (response.status >= 400 && response.status < 500) {
      console.warn('[propositum] ambient batch refused, dropping it:', response.status)
      return
    }

    await returnAmbient(ambient)
  } catch {
    await returnAmbient(ambient)
  }
}

async function flush() {
  const session = await loadSession()
  if (!session) return

  // Taken before the send, for the reason `flushAmbient` gives at length: a
  // clear-on-success discards everything buffered during the fetch, and these
  // are the events the ledger is built from.
  const pending = await withStorage(async () => {
    const { pending: held = [] } = await chrome.storage.session.get(['pending'])
    if (held.length === 0) return []

    await chrome.storage.session.set({ pending: [] })
    return held
  })

  if (pending.length === 0) return

  try {
    await post('/api/capture/events', { events: pending }, session)
  } catch (error) {
    // Put them back. The app records a gap if the disconnection outlasts it;
    // dropping events silently would be the one unrecoverable mistake.
    console.warn('[propositum] flush failed, keeping buffer:', error)
    await withStorage(async () => {
      const { pending: arrived = [] } = await chrome.storage.session.get(['pending'])
      await chrome.storage.session.set({ pending: [...pending, ...arrived] })
    })
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

    const thread = suggestion.thread ?? ''

    await chrome.action.setBadgeText({ text: '•' })
    await chrome.action.setBadgeBackgroundColor({ color: '#7c6cf0' })
    await chrome.action.setTitle({ title: `${suggestion.sentence} ${suggestion.because}` })

    /**
     * The offer is stored UNDER ITS THREAD, not as "the current offer".
     *
     * ── An answer applied to a target that moved underneath it ───────────
     *
     * There used to be one `offer` key, rewritten on every thirty-second poll,
     * and `answeredYes` / `answeredNo` read it. Notifications are
     * `requireInteraction: true`, so they sit there until somebody answers.
     *
     * Leave one unanswered, let a later poll advertise a different thread, and
     * pressing **Yes** on the first notification opened `/start` for the
     * SECOND thread and approved the second thread's sites. "Not now" on the
     * first snoozed the second's origin. The person answered a question about
     * one piece of work and got another — and the sites half of that is a
     * permission decision taken on their behalf about something they were not
     * looking at.
     *
     * It is the same shape as a stale element ref: an answer resolved against
     * mutable shared state that moved between the question and the answer. The
     * fix is the same in kind — resolve against something that identifies the
     * thing itself. The notification id already carries the thread
     * (`propositum:${thread}`), so it is the key, and each thread's offer is
     * stored under its own name. A key is a few bytes and session storage dies
     * with the browser, which is the same trade the `told:` keys already make.
     */
    if (thread) await chrome.storage.session.set({ [`offer:${thread}`]: suggestion })

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
 * How long a controlled tab may sit with no command before it is given up.
 *
 * ── A run that ends does not tell us it ended ────────────────────────────
 *
 * The wire protocol has a shape for "here is a command" and a shape for
 * "nothing right now", and nothing at all for "that was the last one". A run
 * finishes, the app simply stops queueing, and this side is left holding an
 * attachment: Chrome's bar still saying Propositum is attached, a border and a
 * chip still saying *"Propositum is working here"*, and a tab nobody is doing
 * anything in.
 *
 * That is the indicator problem inverted, and it is just as bad. An indicator
 * that outlives the work teaches the person that the border means nothing —
 * and the whole reason the border exists is so that when it IS there,
 * something is happening.
 *
 * So the extension decides on its own, from something it can see: no command
 * for two minutes means the work is over. Deliberately generous — a model turn
 * plus a slow page is comfortably inside it — and deliberately not dependent
 * on the app saying anything, since the app going quiet is exactly the case
 * this covers. Letting go early costs a `control-lost` on a run that was still
 * thinking; never letting go costs the meaning of the marker.
 */
const CONTROL_IDLE_MS = 120_000

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

/**
 * Claim the lease, and take a token proving who holds it.
 *
 * ── Both halves of this were broken, and in the same direction ───────────
 *
 * The claim was a bare `get` → `await` → `set` — precisely the shape
 * `withStorage` was introduced to eliminate, whose own header says
 * "everything goes through here", bypassed at the one call site where losing
 * the race means TWO consumers of `/api/act/next` and two `runCommand`s over
 * one in-flight intent. For a browser action a duplicated command is a
 * duplicated click. It is reachable on an ordinary browser start, where
 * `onStartup` → `wake()` → `pollForWork` runs beside a persisted alarm firing
 * into the same function.
 *
 * The release was worse, because it needed no race at all: it set the lease to
 * zero unconditionally, with no check that the caller still held it. So the
 * first loop to exit freed the SECOND loop's lease and the next alarm started
 * a third. A lease anybody may release is not a lease.
 *
 * A token rather than a flag, because "am I still the holder" has to be
 * answerable after a worker death and a resurrection — and a module variable
 * cannot answer it.
 */
async function claimPollLease() {
  return withStorage(async () => {
    const { pollLeaseUntil = 0 } = await chrome.storage.session.get(['pollLeaseUntil'])
    if (Date.now() < pollLeaseUntil) return null

    const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    await chrome.storage.session.set({
      pollLeaseUntil: Date.now() + POLL_LEASE_MS,
      pollLeaseToken: token,
    })
    return token
  })
}

/** Extend the lease, but only while it is still ours. */
async function renewPollLease(token) {
  return withStorage(async () => {
    const { pollLeaseToken } = await chrome.storage.session.get(['pollLeaseToken'])
    if (pollLeaseToken !== token) return false

    await chrome.storage.session.set({ pollLeaseUntil: Date.now() + POLL_LEASE_MS })
    return true
  })
}

async function releasePollLease(token) {
  await withStorage(async () => {
    const { pollLeaseToken } = await chrome.storage.session.get(['pollLeaseToken'])
    if (pollLeaseToken !== token) return

    await chrome.storage.session.set({ pollLeaseUntil: 0, pollLeaseToken: null })
  })
}

/**
 * How long a report or a halt may take before it is abandoned.
 *
 * ── A hung socket is not an error, and that is the whole problem ─────────
 *
 * `postReport` and `postHalt` used to be bare `fetch`es. Their `catch`
 * handlers deal with *errors*; a dev server that accepts the connection
 * mid-restart and never answers produces no error at all — it produces a
 * promise that never settles.
 *
 * `releaseControl` awaits both of them inside a re-entrancy guard that is only
 * reset in its `finally`, so one hung socket pinned `releasing = true` for the
 * life of the worker. Every later clean-up — including the one from a genuine
 * detach on the NEXT run — then returned immediately without clearing
 * `controlledTabId`. Downstream of that: the acting badge stuck on, offers
 * silently suppressed because `showSuggestionBadge` stands down while acting,
 * and every command reporting `control-lost` against a tab nothing is attached
 * to. A stop that hangs is worse than a stop that fails, because a failure is
 * something the next attempt can recover from.
 *
 * The poll already arms an `AbortController`. These now do too, and it is the
 * same argument: this file must never wait forever on the app, on any path,
 * and least of all on the path whose entire promise is that it works when the
 * app is unreachable.
 */
const ACT_POST_TIMEOUT_MS = 5_000

function actFetch(path, init) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? POLL_ABORT_MS)

  return fetch(`${APP_ORIGIN}${path}`, {
    ...init,
    signal: init?.signal ?? controller.signal,
    headers: { ...(init?.headers ?? {}), [ACT_HEADER]: '1' },
  }).finally(() => clearTimeout(timer))
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
function claimInFlight() {
  return withStorage(async () => {
    const { inFlightIntentId } = await chrome.storage.session.get(['inFlightIntentId'])
    if (typeof inFlightIntentId !== 'string') return null

    await chrome.storage.session.remove(['inFlightIntentId'])
    await rememberReported(inFlightIntentId)
    return inFlightIntentId
  })
}

async function reportInFlight(body) {
  const intentId = await claimInFlight()
  if (intentId === null) return false

  await postReport(intentId, body)
  return true
}

/**
 * Intents this extension has already answered.
 *
 * ── Two mechanisms, neither trusting the other ───────────────────────────
 *
 * The app's side of this had a real bug: the poll handed out a run's OLDEST
 * queued row rather than the one it was awaiting, so a live page could have
 * been sent an orphaned command — a click meant for a page that is no longer
 * there. That is fixed on their side.
 *
 * This is the other side of the same hazard, and it exists precisely because
 * the fix is on their side. A command that arrives twice is a click that
 * happens twice, and for a browser action "delivered twice" and "did it twice"
 * are the same sentence. Refusing an intent this file has already answered
 * costs a set lookup and does not depend on the app being correct.
 *
 * Bounded, and the bound is the reason it is safe to keep at all: a session's
 * worth of ids is a few kilobytes, and the oldest go first because a command
 * two hundred intents ago is not one the app is about to re-issue.
 */
const REPORTED_INTENT_CAP = 200

async function rememberReported(intentId) {
  const { reportedIntents = [] } = await chrome.storage.session.get(['reportedIntents'])
  if (reportedIntents.includes(intentId)) return

  reportedIntents.push(intentId)
  await chrome.storage.session.set({
    reportedIntents: reportedIntents.slice(-REPORTED_INTENT_CAP),
  })
}

async function alreadyReported(intentId) {
  const { reportedIntents = [] } = await chrome.storage.session.get(['reportedIntents'])
  return reportedIntents.includes(intentId)
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
      timeoutMs: ACT_POST_TIMEOUT_MS,
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
    timeoutMs: ACT_POST_TIMEOUT_MS,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runId, reason }),
  }).catch(() => {})
}

/* ── the indicator, layer 2 of 3 ───────────────────────────────────────── */

/**
 * Put the marker back on the page.
 *
 * Called on every `Page.loadEventFired` and only there, because that is the
 * first moment there is a document to put it in — the tab is created on
 * `about:blank`, which no host permission covers, so injecting at attach time
 * would fail and take the grace window down with it. On success the marker is
 * live as of now, and the overlay's own heartbeat renews it twice a second
 * from there.
 *
 * The consequence is worth stating rather than leaving implicit: between
 * attach and the first load there is no marker, and what covers that gap is
 * the grace window plus the rule in `performCommand` that no element command
 * runs without a live marker. A page that never fires `load` therefore never
 * gets clicked in, which is the correct outcome.
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
    /**
     * Claim the command, drop the tab, and only then reach the network.
     *
     * Claiming first is what makes this the ONE writer for that intent: a
     * later path finds nothing in flight and cannot overwrite the outcome
     * below. Clearing the tab state second is what makes every subsequent CDP
     * call impossible, and neither may be conditional on the app answering —
     * the whole point of detaching before posting is that stopping works with
     * the app closed.
     */
    var intentId = await claimInFlight()

    await clearControlState()
    await clearActingBadge()
  } finally {
    /**
     * The guard covers the LOCAL clean-up and nothing else.
     *
     * It used to be held across the two POSTs below, so a socket that hung
     * rather than failed pinned `releasing = true` for the life of the worker
     * and every later clean-up returned without clearing `controlledTabId`.
     * The POSTs now carry their own timeouts as well, but the ordering is the
     * real fix: what this guard protects is a pair of storage writes, and
     * nothing about telling the app needs to be inside it.
     *
     * Re-entering after this point is harmless. `claimInFlight` has already
     * taken the intent, so a second caller reports nothing, and `stopActing`
     * and `onDetached` both return early once `controlledTabId` is gone.
     */
    releasing = false
  }

  // Telling the app comes last and may fail, hang, or never happen. Letting go
  // of the tab has already happened, which is the half that must not depend on
  // anything outside this process.
  if (intentId !== null) {
    await postReport(intentId, { ok: false, failure: 'control-lost', detail: reason })
  }

  await postHalt(state.runId, reason)
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
    /**
     * `target_closed`, `canceled_by_user`, `replaced_with_devtools` — treated
     * identically on purpose. Control is gone the instant Chrome says so, and
     * sorting out why is not a thing to do while still holding a tab.
     *
     * ── Take the marker down HERE, not only in `stopActing` ──────────────
     *
     * This used to go straight to `releaseControl`, which never touches the
     * overlay — so the two paths that go through `stopActing` (the chip's own
     * Stop, and the app's) cleaned up, and every Chrome-initiated detach did
     * not. That is the wrong way round: **Chrome's infobar Cancel is the
     * primary kill switch** in ADR-0010 §7, the one that cannot be suppressed
     * or broken. Pressing it left a purple border and a chip reading
     * *"Propositum is working here"* permanently on a live page with nothing
     * driving it — the exact inversion `overlay.js` is written against, on the
     * control most likely to be used in a hurry.
     *
     * The detach has already happened by the time this runs, which is fine:
     * `chrome.tabs.sendMessage` needs a host permission, not a debugger.
     */
    await hideIndicator(state.tabId)
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
 * ── Where the run id and the approved origins come from ──────────────────
 *
 * `GET /api/act/next` returns `{ intentId, kind, params }` and nothing else —
 * no run id. But `POST /api/act/halt` takes one, and stopping is the thing
 * that must work when everything else does not, so the id cannot be looked up
 * at the moment it is needed.
 *
 * **The decision: the run id arrives with the command that opens the tab, and
 * is stored beside `controlledTabId` for the life of the attachment.** The
 * first command of a run is always `navigate` — it has to be, since the only
 * tab Propositum may touch is one it created — so there is exactly one moment
 * where it can be handed over, and it is the same moment the tab comes into
 * existence. The two are written in the same `set`, so a controlled tab with
 * no run id attached is not a state this file can be in.
 *
 * That is deliberately the opposite of asking the app who is running when a
 * halt is needed. The app is exactly what may be unreachable then.
 *
 * The approved sources ride along the same way. Both are read tolerantly from
 * either spelling — the pin is on the envelope, not on what is inside it. When
 * the app sends no origins, the set is seeded with the origin of the URL it
 * asked us to open: sound rather than a shortcut, because the app gated that
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
  await chrome.storage.session.set({ lastCommandAt: Date.now() })
  await showActingBadge()
  setTimeout(() => void watchIndicator(), INDICATOR_GRACE_MS)

  return { tabId }
}

async function runCommand(command) {
  /**
   * A command answered once is never run again.
   *
   * Not a retry guard — a re-delivery guard. For a browser action "delivered
   * twice" and "clicked twice" are the same sentence, and there is no undo for
   * the second one. Silence is the right answer: reporting again would be the
   * duplicate this exists to prevent, and the app already has an outcome for
   * this intent.
   */
  if (await alreadyReported(command.intentId)) {
    console.warn('[propositum] refusing a command already answered:', command.intentId)
    return
  }

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

/**
 * Give up a tab nothing has asked anything of for a while. See CONTROL_IDLE_MS.
 *
 * Checked on every empty poll AND on the heartbeat alarm, because the poll
 * loop is the thing most likely to have stopped when this is needed — the app
 * going away is both the reason the run ended and the reason the loop exited.
 */
async function letGoIfIdle() {
  const { controlledTabId, lastCommandAt = 0 } = await chrome.storage.session.get([
    'controlledTabId',
    'lastCommandAt',
  ])
  if (typeof controlledTabId !== 'number') return
  if (Date.now() - lastCommandAt < CONTROL_IDLE_MS) return

  console.warn('[propositum] nothing has been asked of this tab for a while — letting go')
  await stopActing('control-lost')
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
      await letGoIfIdle()
      if (Date.now() - startedAt < POLL_FLOOR_MS) await sleep(POLL_FLOOR_MS)
      return 'continue'
    }

    await chrome.storage.session.set({ lastCommandAt: Date.now() })
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
  const lease = await claimPollLease()
  if (lease === null) return

  /**
   * Refresh the lease WHILE the loop runs, not between turns.
   *
   * Refreshing only after `pollOnce` returns is not enough, and the arithmetic
   * is not close. One turn is up to 25 seconds of long poll PLUS the whole
   * command: a click that triggers a slow navigation adds `SETTLE_CEILING_MS`
   * and an accessibility snapshot on top. A 22-second poll that returns such a
   * command comfortably exceeds the 35-second lease, the heartbeat alarm finds
   * it expired and claims it, and there are two loops consuming
   * `/api/act/next` and writing the same in-flight intent — the exact thing
   * the lease exists to make impossible.
   *
   * A timer rather than a check, because the loop is parked inside an `await`
   * for almost all of its life and has nowhere to put a check.
   */
  let lost = false
  const keepLease = setInterval(() => {
    void renewPollLease(lease).then((held) => {
      // Somebody else holds it now, which can only mean this loop was
      // presumed dead. Stand down rather than compete: two consumers of
      // `/api/act/next` is the thing the lease exists to prevent.
      if (!held) lost = true
    })
  }, Math.floor(POLL_LEASE_MS / 3))

  try {
    for (;;) {
      if ((await pollOnce()) === 'stop') return
      if (lost) return
    }
  } finally {
    clearInterval(keepLease)
    await releasePollLease(lease)
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

  // Before anything else that could take a while: a marker still on screen for
  // work that finished is the same lie as a marker missing from work that has
  // not. This is the path that still runs when the poll loop has stopped.
  //
  // FIRST, deliberately. Letting go of a stale marker is the safety-relevant
  // half, and everything below it can block — a hung app, a slow tab. An
  // ordering that surfaces a question before it drops a false "working here"
  // is one where the lie outlives the alarm that was supposed to end it.
  await letGoIfIdle()

  // Then the paused run, unconditionally — one is waiting whether or not there
  // is a session, because a Shift outlives the session that started it and a
  // run parked on a question holds no lease at all.
  await showPendingConfirmation()

  // One read, used by both halves below. The two sides of this merge each
  // loaded it for themselves; a second `const session` in the same scope is a
  // syntax error, and two reads of a value that can change between them would
  // have been a subtler bug than the one that failed to parse.
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

      /**
       * The group title is attached HERE, and only on this branch.
       *
       * Two reasons, and the second is the one that matters:
       *
       *  1. **The content script cannot ask.** `chrome.tabGroups` is not
       *     available to it, and it must not be — a page that could learn its
       *     own group has learned a word the person typed about a set of tabs,
       *     which is not a page's business.
       *  2. **Ambient only, on purpose.** The session path below goes to
       *     `/api/capture/events` and through `rawSignalSchema`, which has no
       *     field for this; a signal carrying one would be recorded as
       *     REJECTED, once per report. Carrying it there is a separate
       *     decision about a separate ledger, and nobody has taken it. ADR-0013
       *     scopes this to the ambient path and says so.
       *
       * `sender` is Chrome's, not the page's. See `groupTitleOf` for the whole
       * argument about what that does and does not reveal.
       */
      const groupTitle = await groupTitleOf(sender)

      await bufferAmbient({
        ...metadataOnly,
        at: Date.now(),
        ...(groupTitle === undefined ? {} : { groupTitle }),
      })
      return sendResponse({ ok: true, ambient: true })
    }

    /**
     * A session IS running. Full capture — but only on approved sources.
     *
     * ── Why this is `patternCovers` and not `startsWith` ─────────────────
     *
     * It was `origin.startsWith(s.origin)`, which is the oldest allowlist bug
     * there is: with `https://mail.google.com` approved, a page at
     * `https://mail.google.com.attacker.example` matches. That was
     * theoretical while `optional_host_permissions` meant content scripts ran
     * only on specifically granted origins. It stopped being theoretical when
     * the manifest went broad (ADR-0008): `content.js` now runs on every https
     * page, so an attacker-registered lookalike host **executes the capture
     * script**, prefix-matches here, and gets its full 2,000-character excerpt
     * and every selection buffered as approved-source capture.
     *
     * The server re-matches and files those as `unattributed`, so nothing
     * reaches the ledger. That backstop is not the answer: this is where the
     * promise is stated, this is the layer the privacy argument is written
     * about, and a boundary that fails open while a second one quietly catches
     * it is a boundary that will be relied on the day the second one moves.
     *
     * `patternCovers` is the tested predicate — `tests/match-pattern.test.ts`
     * — and it is exact on the host, anchors `*.` on a dot, and answers no to
     * anything it cannot parse. `cdp.js` makes the identical argument for the
     * acting path's origin check; there is no reason for the two to differ.
     */
    const origin = sender.origin ?? ''
    const approved = session.sources.some((s) => patternCovers(s.origin, origin))
    if (!approved) {
      /**
       * Not an approved source, and NOT buffered as ambient either.
       *
       * This branch used to buffer, on the reasoning that the person may be
       * working somewhere they have not set up. The reasoning is right and the
       * mechanism does not exist: `/api/capture/ambient` returns 409
       * unconditionally while a session is live, and 409 is read here as "the
       * ledger has these now, drop them". The ledger does not have them — the
       * events route never saw them, because this is exactly the branch that
       * decided not to send them there.
       *
       * So every one of these was buffered and then discarded for the whole
       * life of every session. Buffering them was not a feature that
       * half-worked; it was a cost with no benefit, and the honest version is
       * to say so here rather than leave the appearance of coverage.
       *
       * Making it work is the app's call, not this file's: it means the
       * ambient route accepting observations during a session, which is a
       * decision about whether Propositum may notice a SECOND piece of work
       * while it is already watching one.
       */
      return sendResponse({ ok: true, ambient: false, reason: 'session-scoped' })
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
/**
 * Which thread a notification was about — read off the notification itself.
 *
 * The id is minted as `propositum:${thread}` and Chrome hands it straight back
 * to the answer handlers, so it is an identity that cannot have moved between
 * the question and the answer. See the storage comment in
 * `showSuggestionBadge` for what reading a mutable "current offer" instead
 * used to do.
 */
function threadOf(notificationId) {
  const prefix = 'propositum:'
  if (!notificationId.startsWith(prefix)) return null

  const thread = notificationId.slice(prefix.length)
  return thread.length > 0 ? thread : null
}

async function offerFor(thread) {
  const key = `offer:${thread}`
  const stored = await chrome.storage.session.get([key])
  return stored[key] ?? null
}

/**
 * Take the offer dot down — unless the badge is saying something louder.
 *
 * `verifyReachable` was already taught this and `showSuggestionBadge` stands
 * down while acting, but the notification answers were missed, and they are
 * the easiest of the three to hit: a notification raised before a run started
 * sits there with `requireInteraction: true` until somebody answers it, and
 * answering it wiped the `▶` that the panel and the badge comment both
 * describe as layer three of the working-here indicator.
 *
 * The dot is a "when you have a moment". Work in progress is a "right now".
 */
async function clearOfferBadge() {
  if (await acting()) return
  await chrome.action.setBadgeText({ text: '' })
}

async function answeredYes(notificationId) {
  const thread = threadOf(notificationId)
  if (thread === null) return

  const params = new URLSearchParams({ thread })
  await chrome.tabs.create({ url: `${APP_ORIGIN}/start?${params.toString()}` })
  await clearOfferBadge()
}

async function answeredNo(notificationId) {
  const thread = threadOf(notificationId)
  const offer = thread === null ? null : await offerFor(thread)
  await clearOfferBadge()

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
  await (index === 0 ? answeredYes(id) : answeredNo(id))
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
  await answeredYes(id)
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
