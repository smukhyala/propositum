/**
 * Driving one tab over the Chrome DevTools Protocol.
 *
 * ── Read ADR-0010 before changing anything here ──────────────────────────
 *
 * This file is the reversal of ADR-0002's refusal of the `debugger`
 * permission. That refusal was correct, and its reasoning is what this file
 * exists to hold up now that the permission is granted:
 *
 *   > Consolidation is not worth the coupling. Sharing infrastructure would
 *   > save perhaps 200–400 lines, against a worker one `page.click()` away
 *   > from acting inside the person's authenticated session.
 *
 * That sentence is still true. Propositum is now one `Input.dispatchMouseEvent`
 * away from acting inside a real signed-in session, and everything below is
 * what stands in that one step. None of it is defence in depth for its own
 * sake; each constraint is here because removing it re-opens a specific door.
 *
 * ── Plain JS, no bundler, on purpose ─────────────────────────────────────
 *
 * The extension is loaded unpacked. A build step would mean the thing under
 * review is not the thing running — an unhelpful property anywhere, and a
 * disqualifying one for the component holding the privacy guarantee. So the
 * enforcement mechanism for "these CDP calls are never made" is a grep, in
 * `tests/extension-cdp.test.ts`, over this exact file. See that file: it
 * strips comments first, so the paragraphs below naming `Runtime.evaluate` do
 * not keep the guard green the way a comment once kept `tests/reachability`
 * green.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 *
 * **No Runtime domain, ever.** Not `Runtime.evaluate`, not
 * `Runtime.callFunctionOn`, and not `DOM.resolveNode` — which is the doorway
 * to both, since a resolved node is a `RemoteObject` and a `RemoteObject` is
 * an argument to a function call. There is no path by which a string
 * Propositum composed becomes JavaScript executing in a page the person is
 * signed into. Not for reading, not for clicking, not for convenience.
 *
 * The price is paid in the click path. A click is
 * `DOM.scrollIntoViewIfNeeded` → `DOM.getBoxModel` → the centre of the
 * content quad → `Input.dispatchMouseEvent`, never `element.click()`. So an
 * element behind a cookie banner, under a sticky header, or covered by a modal
 * gets the click delivered to whatever is actually on top, and **fails**.
 *
 * That failure direction is the correct one, and it is worth being explicit
 * about why, because the other direction looks like robustness:
 *
 *   - A visible failure costs one wasted turn. The next accessibility tree
 *     shows the agent that nothing moved, and the ledger records an attempt
 *     that did not land.
 *   - `element.click()` would have fired the handler *through* the overlay and
 *     succeeded silently — doing something no person with a mouse could have
 *     done, in a real account, and reporting it as ordinary.
 *
 * And the occlusion is very often the site telling a human to stop and look: a
 * consent gate, a modal, an "are you sure". Walking through one of those
 * silently is the exact class of event this whole design exists to prevent. An
 * occluded click that fails loudly beats a click that bypassed an overlay the
 * site put there deliberately.
 *
 * **No scroll capability.** Not "unused" — absent. `Accessibility.getFullAXTree`
 * is not viewport-bounded, so the agent already sees the whole page, and
 * `DOM.scrollIntoViewIfNeeded` scrolls the click target into view on its own.
 * A scroll action would be a capability with nothing to do, and a capability
 * with nothing to do is one somebody finds a use for later.
 *
 * **`chrome.debugger.getTargets` is never called.** This is the load-bearing
 * one. `chrome.debugger.attach` needs a tab id, and enumeration is the obvious
 * way to get one — it would also hand back the URL and title of *every open
 * tab*, reinstating through a back door precisely the capability ADR-0002
 * refused the `tabs` permission to avoid, at a moment when nobody is looking.
 * So the tab id comes from `chrome.tabs.create`, which returns the id of a tab
 * we opened ourselves, and nothing else is ever a candidate.
 *
 * > **The agent works in a tab Propositum created, and can never learn that
 * > any other tab exists.**
 *
 * **The product cost is real and is not a bug to fix later.** The agent cannot
 * continue in a tab the person was already reading. If they have a half-filled
 * form open, Propositum opens its own tab and navigates to the approved origin
 * itself — which sometimes means a sign-in flow, and sometimes means the work
 * simply cannot be picked up where it was left. That is the price of the
 * guarantee above, and it is worth it.
 */

/* ── the bounds, and why there are two of them ─────────────────────────── */

/**
 * How many accessibility nodes may leave the browser in one snapshot.
 *
 * The receiver bounds this again at the ledger. Neither side trusts the other,
 * which is the standing rule — but wave 2 shipped a version of that rule that
 * *wedged*, and the shape of that bug is worth carrying here as a warning
 * rather than rediscovering it.
 *
 * The ambient path had the extension buffering 200 observations against a
 * route schema that accepted `.max(100)`, and cleared its buffer only on
 * success. Past 100 every flush failed validation with a 400, the buffer was
 * never cleared, and ambient detection was dead for the life of that session
 * storage — no offers, ever, on a machine where everything looked healthy.
 *
 * Three things stop that here, and only the first is about numbers:
 *
 *  1. **This side is the stricter one.** Defence in depth is two bounds that
 *     agree about which is tighter. Two that disagree is a lock. See
 *     `SNAPSHOT_BUDGET_CHARS` below for the pairing.
 *  2. **The receiver does not reject for size at all.** `appendEvidence`
 *     truncates an oversized tree, flags it, and writes it. So the failure the
 *     wave-2 bug needed — a permanent refusal — is not available on this path.
 *  3. **There is no buffer to wedge.** An observation is produced, sent once,
 *     and forgotten. Nothing is retained across a report, so nothing can be
 *     retained across a *failed* report either.
 *
 * This bound still earns its place: it is what stops a 100,000-node page
 * crossing the wire in the first place.
 */
export const SNAPSHOT_NODE_CAP = 1500

/**
 * The character budget for one snapshot, and a published product constant.
 *
 * `docs/SECURITY_AND_PRIVACY.md` names it in the retention table for acting:
 * *"the page as the browser describes it to assistive technology … at most
 * `SNAPSHOT_BUDGET_CHARS` per turn"*. It has the same standing as the 2,000
 * character excerpt budget — the promise is the artifact and the number is
 * downstream of the promise sentence.
 *
 * It exists because an accessibility tree is ten to a hundred times an article
 * excerpt and arrives every single turn, so an unbounded one would quietly
 * become the largest thing Propositum stores.
 *
 * ── 48,000 here against 60,000 there, and the order matters ──────────────
 *
 * The app's `SNAPSHOT_BUDGET_CHARS` in `src/model/untrusted.ts` is **60,000**.
 * This one is deliberately below it, exactly as `AMBIENT_BATCH_MAX` in
 * `service-worker.js` sits at or below what the ambient route accepts, and for
 * the same reason written in that comment: defence in depth is two bounds that
 * agree about which is tighter, and two that disagree is a lock.
 *
 * The headroom between the two is not slack — it is what makes a version skew
 * survivable. An older extension sending a slightly larger tree than a newer
 * app expects is truncated at the ledger rather than refused, and neither side
 * has to know the other's number to be correct.
 */
export const SNAPSHOT_BUDGET_CHARS = 48_000

/**
 * The longest one accessible name may be before it is cut.
 *
 * Per-name rather than only per-snapshot, because a single hostile `aria-label`
 * of 20,000 characters would otherwise consume the whole budget and push every
 * real control out of the tree — a denial of observation that costs the
 * attacker one attribute.
 */
export const NAME_BUDGET_CHARS = 240

/* ── how long we wait for things ───────────────────────────────────────── */

/** Ceiling on waiting for a page to settle after navigating or clicking. */
export const SETTLE_CEILING_MS = 10_000

/**
 * Floor on the same wait.
 *
 * A click that triggers navigation has not started it yet at the moment
 * `Input.dispatchMouseEvent` resolves, so an immediate `networkIdle` is the
 * *previous* page's. Waiting a beat first makes the idle we observe the one we
 * caused.
 */
export const SETTLE_FLOOR_MS = 400

/**
 * How long the "Propositum is working here" indicator may be missing before
 * control is given up.
 *
 * Not a nicety. An indicator that can be lost silently is **worse than none**,
 * because a person who sees it most of the time learns to read its absence as
 * "nothing is happening" — and then the one time it is absent because the
 * injection failed, they are being acted for while believing they are not.
 *
 * So the rule is inverted from the usual: the indicator is not a decoration on
 * top of the capability, the capability is conditional on the indicator. No
 * command is dispatched while the chip has been quiet for longer than this,
 * and a watchdog detaches rather than waiting to be asked.
 */
export const INDICATOR_GRACE_MS = 1500

/** The keys `press-key` accepts. A closed set, not a passthrough. */
export const PRESSABLE_KEYS = {
  Enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
}

/* ── pure predicates, exported so a test can hold them still ───────────── */

/**
 * The origin of a URL, or null if it does not have one we can reason about.
 *
 * Total, and null on anything malformed. Null is treated as "not approved"
 * everywhere it is consulted, so an unparseable URL fails closed.
 */
export function originOf(url) {
  try {
    const parsed = new URL(String(url))
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Is this URL inside the run's approved sources?
 *
 * Exact origin equality, never a prefix test. `startsWith` would say yes to
 * `https://mail.google.com.attacker.net` for an approved
 * `https://mail.google.com`, which is the oldest allowlist bug there is.
 *
 * An entry containing `*` is read as a Chrome host match pattern and handed to
 * `patternCovers`, which is already tested against the pattern table in
 * `tests/match-pattern.test.ts`. A pattern this file cannot parse is a no.
 */
export function isApprovedOrigin(url, origins, patternCovers) {
  const origin = originOf(url)
  if (origin === null) return false
  if (!Array.isArray(origins)) return false

  for (const entry of origins) {
    if (typeof entry !== 'string' || entry.length === 0) continue

    if (entry.includes('*')) {
      if (typeof patternCovers === 'function' && patternCovers(entry, origin)) return true
      continue
    }

    const approved = originOf(entry)
    if (approved !== null && approved === origin) return true
  }

  return false
}

/**
 * The centre of a CDP content quad.
 *
 * `DOM.getBoxModel` returns `content` as eight numbers — four corners, in
 * order. The centre of the bounding box of those corners is where the pointer
 * goes. Averaging the corners rather than taking `(x1+x3)/2` handles a rotated
 * or skewed element without pretending the quad is a rectangle.
 *
 * Returns null for a quad that is not eight finite numbers, or for a zero-area
 * box: an element with no area cannot be clicked by a person either, and
 * inventing a coordinate for it would be exactly the silent success this file
 * refuses elsewhere.
 */
export function centreOfContentQuad(quad) {
  if (!Array.isArray(quad) || quad.length !== 8) return null

  let sumX = 0
  let sumY = 0
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let i = 0; i < 8; i += 2) {
    const x = quad[i]
    const y = quad[i + 1]
    if (typeof x !== 'number' || typeof y !== 'number') return null
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null

    sumX += x
    sumY += y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  if (maxX - minX <= 0 || maxY - minY <= 0) return null

  return { x: sumX / 4, y: sumY / 4 }
}

/**
 * Make one page-authored string safe to put on a line of the tree.
 *
 * Every accessible name in a snapshot is attacker-controlled on a hostile
 * page, and the tree is a **line-oriented format the model reads**. So a name
 * containing a newline could append a line of its own —
 * `e99 button "Send"` — describing a control that does not exist, and a name
 * containing a quote could close the one around it early. Neither is exotic;
 * both are one attribute.
 *
 * This does not make the tree trustworthy. ADR-0006 is explicit that
 * datamarking is depth, not a boundary, and depth scaled a hundredfold is
 * still depth. What it does is make the *frame* unforgeable: a name can say
 * anything, and it cannot pretend to be a different field or a different node.
 *
 * Quotes become apostrophes rather than being backslash-escaped, because an
 * escape only moves the ambiguity into whether the reader unescapes.
 */
export function sanitiseName(text) {
  if (typeof text !== 'string') return ''

  return text
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]+/g, ' ')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_BUDGET_CHARS)
}

/**
 * Roles that carry an editable or selected value the agent needs to see.
 *
 * These get a `value:""` clause even when the node reports no value at all,
 * because "this textbox is empty" and "this node has no value concept" are
 * different facts and the agent has to be able to tell them apart before it
 * types into something.
 */
const VALUE_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'slider',
  'checkbox',
  'radio',
  'switch',
])

/**
 * Roles that are structure rather than content, and are dropped when they
 * carry no name of their own.
 *
 * `InlineTextBox` is dropped unconditionally — it is a layout artefact that
 * duplicates the `StaticText` above it, and on a long page it is most of the
 * tree. Dropping it is the difference between a snapshot that fits the budget
 * and one that is 80% duplicated prose.
 */
const STRUCTURAL_ROLES = new Set(['generic', 'none', 'presentation', 'GenericContainer'])

function axValue(field) {
  if (field === null || typeof field !== 'object') return undefined
  const value = field.value
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * Flatten `Accessibility.getFullAXTree` into the lines the model reads, and
 * the ref map it may address.
 *
 * ── Refs are per-snapshot, and that is the whole point ───────────────────
 *
 * The model only ever sees `e1…eN`. Never a `backendNodeId`, never an XPath,
 * never a selector — so it **cannot address a node it did not just observe**.
 * One snapshot is live per tab; taking a new one invalidates every ref in the
 * previous one, and that invalidation is a feature rather than bookkeeping:
 * a page can re-render between two turns and hand the same position to a
 * different control, and the difference between clicking *Cancel order* and
 * clicking whatever moved into its place is exactly what a stale ref buys.
 *
 * `backendNodeId` is the underlying identity. It is opaque, it is an integer,
 * and it leaks nothing about the page — which is why it is safe to hold on
 * this side of the boundary and never worth sending across it.
 *
 * ── Document order, flattened ────────────────────────────────────────────
 *
 * Depth-first from the roots, following `childIds`. Ignored nodes are dropped
 * but *walked through*, because an ignored container routinely has meaningful
 * descendants. Any node the walk never reached is appended in array order
 * rather than discarded, so a malformed `childIds` costs ordering and not
 * content.
 *
 * No indentation. The structure is dropped deliberately — the ADR's table says
 * flatten, and a line the receiver must strip leading whitespace from is a
 * line two parsers can disagree about.
 */
export function flattenAXTree(nodes, options) {
  const nodeCap = options?.nodeCap ?? SNAPSHOT_NODE_CAP
  const charBudget = options?.charBudget ?? SNAPSHOT_BUDGET_CHARS

  const refs = {}
  const lines = []
  let used = 0
  let truncated = false

  if (!Array.isArray(nodes)) return { tree: '', refs, truncated: false }

  const byId = new Map()
  for (const node of nodes) {
    if (node && typeof node === 'object' && node.nodeId !== undefined) {
      byId.set(String(node.nodeId), node)
    }
  }

  const claimed = new Set()
  for (const node of byId.values()) {
    for (const child of node.childIds ?? []) claimed.add(String(child))
  }

  const seen = new Set()
  const ordered = []

  const walk = (id) => {
    const key = String(id)
    if (seen.has(key)) return
    const node = byId.get(key)
    if (node === undefined) return

    seen.add(key)
    ordered.push(node)
    for (const child of node.childIds ?? []) walk(child)
  }

  for (const node of byId.values()) {
    if (!claimed.has(String(node.nodeId))) walk(node.nodeId)
  }
  // Whatever the walk could not reach — a cycle, a dangling childId, a node
  // whose parent was omitted. Appended rather than dropped.
  for (const node of byId.values()) walk(node.nodeId)

  let next = 1

  for (const node of ordered) {
    if (node.ignored === true) continue

    const backendNodeId = node.backendDOMNodeId
    if (typeof backendNodeId !== 'number') continue

    const role = axValue(node.role) ?? ''
    if (role === 'InlineTextBox') continue

    const name = sanitiseName(axValue(node.name) ?? '')
    if (role === '' && name === '') continue
    if (STRUCTURAL_ROLES.has(role) && name === '') continue

    const rawValue = axValue(node.value)
    const showValue = rawValue !== undefined || VALUE_ROLES.has(role)

    const ref = `e${next}`
    let line = `${ref} ${role} "${name}"`
    if (showValue) line += ` value:"${sanitiseName(rawValue ?? '')}"`

    // Both bounds are checked before the line is committed, so a snapshot that
    // hits either is short rather than partly over.
    if (lines.length >= nodeCap) {
      truncated = true
      break
    }
    if (used + line.length + 1 > charBudget) {
      truncated = true
      break
    }

    lines.push(line)
    refs[ref] = backendNodeId
    used += line.length + 1
    next += 1
  }

  return { tree: lines.join('\n'), refs, truncated }
}

/**
 * Is this paused request one the browser is about to send irreversibly?
 *
 * ── Attested by Chrome, not asserted by the page ─────────────────────────
 *
 * `Fetch.requestPaused` describes a request Chrome is *holding*, before it
 * leaves the machine. A page can put the word *Cancel* on a button that posts
 * an order; it cannot make Chrome report a `POST` as a `GET`. That is the same
 * distinction `ObservationEvent.attested` draws, applied one layer down, and
 * it is why this is the primary mechanism and the accessible-name lexicon in
 * `src/domain/execution/reversibility.ts` is secondary and escalation-only.
 * This file does not duplicate that classifier and must not grow one.
 *
 * ── Two rules, and one of them is narrower than it first reads ───────────
 *
 * **Any non-`GET` is blocked.** No scoping, no exceptions. The property that
 * buys is unconditional: while Propositum holds this tab, it does not send a
 * request that changes something without a human having confirmed it.
 *
 * **Off-origin is checked on the TOP-LEVEL `Document` request only** — that is,
 * on the tab navigating somewhere. This is narrower than a literal reading of
 * ADR-0010's *"a request to an origin outside the contract's approved
 * sources"*, and the narrowing is deliberate rather than an oversight:
 *
 *   - A real page pulls fonts, images, stylesheets and scripts from a dozen
 *     origins. Blocking those would render every approved page unusable while
 *     proving nothing — the person's own browser fetches exactly the same
 *     subresources when they read the page themselves, so no new capability is
 *     involved.
 *   - What the rule is *about* is the agent leaving approved territory. That
 *     is a navigation of the tab, and nothing else.
 *
 * ── Why the frame check is not an optimisation ───────────────────────────
 *
 * CDP has **no separate resource type for a sub-frame**: an `<iframe>`'s own
 * navigation arrives as `Document` too. So resource type alone would classify
 * every third-party frame on an approved page — a consent manager, a payment
 * frame, an embedded video, a captcha — as the agent leaving approved
 * territory, fail the request, and halt the run. That is the same "every page
 * unusable" outcome the narrowing above exists to avoid, arriving through the
 * one subresource class that is also a document.
 *
 * `mainFrameId` is therefore load-bearing. When it is not known the check
 * applies to every `Document`, which is the closed direction: a run that
 * aborts on an iframe is a bad afternoon, and one that walks off the approved
 * origin unnoticed is the thing this function exists for.
 *
 * Two honest costs of the narrowing, recorded rather than smoothed over: a
 * sign-in redirect to an identity provider outside the approved sources is
 * blocked, and an off-origin `GET` beacon is allowed.
 */
export function classifyPausedRequest(paused, approvedOrigins, patternCovers, mainFrameId) {
  const method = String(paused?.request?.method ?? '').toUpperCase()
  const url = paused?.request?.url ?? ''
  const resourceType = String(paused?.resourceType ?? '')

  // Absent or malformed is treated as the dangerous case, for the reason the
  // reversibility classifier gives: the cheapest attack on a check is to
  // remove the thing it checks.
  if (method === '') return 'blocked-request'
  if (method !== 'GET') return 'blocked-request'

  // A request Chrome described in a shape this function does not recognise is
  // checked as though it were a navigation. Failing open on a missing field,
  // in the same function that fails closed on a missing method one branch up,
  // would be the inconsistency an attacker looks for.
  const unrecognised = resourceType === ''

  const topLevelDocument =
    resourceType === 'Document' &&
    (typeof mainFrameId !== 'string' || mainFrameId === '' || paused?.frameId === mainFrameId)

  if (topLevelDocument || unrecognised) {
    if (!isApprovedOrigin(url, approvedOrigins, patternCovers)) return 'off-origin'
  }

  return 'allow'
}

/* ── everything below talks to Chrome ──────────────────────────────────── */

/**
 * Session-scoped control state.
 *
 * Nothing here lives in a module variable, for the reason the service worker's
 * header gives at length: MV3 kills an idle worker every 30 seconds and a
 * module variable does not survive it. `controlledTabId` in particular *must*
 * be durable, because it is the single assertion standing between "the tab we
 * opened" and "any tab at all".
 */
const CONTROL_KEYS = [
  'controlledTabId',
  'controlledRunId',
  'approvedOrigins',
  'snapshot',
  'indicatorAliveAt',
  'indicatorGraceUntil',
  'actionWindow',
  'mainFrameId',
]

/**
 * The command in flight, which is deliberately NOT one of the control keys.
 *
 * It belongs to the command, not to the tab, and conflating the two orphaned
 * an intent: a failed `chrome.debugger.attach` — DevTools already open on the
 * tab, another extension holding it, the tab closed under us — ran
 * `clearControlState()` in its clean-up, which took `inFlightIntentId` with
 * it. The caller's own catch then found nothing in flight and reported
 * nothing, and the app was left with an ActionIntent that never received an
 * ActionOutcome: indistinguishable from a crash, and shown to the person as
 * `unknown` when we knew exactly what happened.
 *
 * Giving up a tab and giving up on a command are different events. Only the
 * code that reports the command may clear this.
 */
const IN_FLIGHT_KEY = 'inFlightIntentId'

export async function controlState() {
  const state = await chrome.storage.session.get([...CONTROL_KEYS, IN_FLIGHT_KEY])
  return {
    tabId: typeof state.controlledTabId === 'number' ? state.controlledTabId : null,
    runId: typeof state.controlledRunId === 'string' ? state.controlledRunId : null,
    approvedOrigins: Array.isArray(state.approvedOrigins) ? state.approvedOrigins : [],
    snapshot: state.snapshot ?? null,
    inFlightIntentId:
      typeof state.inFlightIntentId === 'string' ? state.inFlightIntentId : null,
    indicatorAliveAt: typeof state.indicatorAliveAt === 'number' ? state.indicatorAliveAt : 0,
    indicatorGraceUntil:
      typeof state.indicatorGraceUntil === 'number' ? state.indicatorGraceUntil : 0,
    actionWindow: typeof state.actionWindow === 'number' ? state.actionWindow : 0,
    mainFrameId: typeof state.mainFrameId === 'string' ? state.mainFrameId : null,
  }
}

export async function clearControlState() {
  await chrome.storage.session.remove(CONTROL_KEYS)
}

/**
 * Every command in flight goes through here, and every one of them asserts the
 * tab id against `controlledTabId` first.
 *
 * The assertion is cheap and it is the whole guarantee: there is no code path
 * in this extension that sends a CDP command to a tab it did not open.
 */
async function send(tabId, method, params) {
  const state = await controlState()
  if (state.tabId === null || state.tabId !== tabId) {
    throw new ControlLost('the tab Propositum opened is no longer under control')
  }

  /**
   * A CDP command that never settles, and why it needs its own failure.
   *
   * `chrome.debugger.sendCommand` can simply not come back — a renderer that
   * has stopped responding, a beforeunload dialog nothing will dismiss, a
   * navigation that hangs. Without a ceiling, the poll loop parks here
   * forever: no report, no halt, the person's tab held open by `Fetch.enable`,
   * and an intent that stays in flight until somebody restarts Chrome.
   *
   * `timed-out` is the extension's word and only the extension's. The app's
   * dispatch expiry says `not-delivered` when the row never left and
   * `not-reported` when it did — an honest distinction about whether the
   * command reached a browser. This one says something different and narrower:
   * it reached a browser, the browser accepted it, and the browser did not
   * finish.
   */
  const ceiling = new Promise((_resolve, reject) => {
    setTimeout(() => reject(new TimedOut(`${method} did not come back`)), CDP_CEILING_MS)
  })

  return Promise.race([chrome.debugger.sendCommand({ tabId }, method, params ?? {}), ceiling])
}

/** How long one CDP command may take before it is called a non-answer. */
export const CDP_CEILING_MS = 20_000

export class ControlLost extends Error {}
export class TimedOut extends Error {}

/**
 * Lifecycle and request events, kept where the worker can be woken for them.
 *
 * MV3 only wakes a terminated worker for listeners registered **synchronously
 * during module evaluation**. Registering these inside a function that runs
 * later would mean a `Fetch.requestPaused` arriving after a worker death is
 * never answered — and because `Fetch.enable` holds every request until it is
 * answered, the person's tab would hang forever with no explanation. So this
 * is called from the top level of `service-worker.js`, and the fact that it is
 * a function rather than a bare call is only so that this file can be imported
 * by a test without touching `chrome`.
 */
let networkIdleSince = 0

export function registerControlListeners(handlers) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    void (async () => {
      const state = await controlState()
      if (state.tabId === null || source.tabId !== state.tabId) return

      if (method === 'Page.lifecycleEvent' && params?.name === 'networkIdle') {
        networkIdleSince = Date.now()
        return
      }

      /**
       * A page is being replaced, so the marker is *expected* to be missing.
       *
       * Without this the watchdog would let go of the tab in the middle of
       * every ordinary navigation — the overlay dies with the old document and
       * cannot be re-injected until the new one has loaded, which is routinely
       * longer than the grace window.
       *
       * ── One grace per marker, not one per navigation ───────────────────
       *
       * The obvious version — extend the window on every `init` — is a
       * SLIDING window, and a sliding window is not a cap. A page that
       * navigates itself every few seconds would push the deadline forward
       * forever, and both the watchdog and `performCommand` would stay
       * suppressed indefinitely while nothing on screen said anything was
       * happening. That is the whole failure this constant exists to prevent,
       * arriving through the mechanism meant to prevent it.
       *
       * So the window is only opened when one is not already open, and it is
       * closed again by a SUCCESSFUL injection — see `showIndicator`, which
       * clears it alongside setting `indicatorAliveAt`. One grace per period
       * of the marker actually being alive: a page that navigates in a loop
       * gets ten seconds total and is then let go of.
       */
      if (method === 'Page.lifecycleEvent' && params?.name === 'init') {
        if (Date.now() < state.indicatorGraceUntil) return

        await chrome.storage.session.set({
          indicatorGraceUntil: Date.now() + SETTLE_CEILING_MS,
        })
        return
      }

      /**
       * Which frame is the tab, as opposed to something embedded in it.
       *
       * `classifyPausedRequest` needs this to tell "the agent navigated off
       * the approved origin" from "the page embedded a third-party iframe",
       * which CDP reports with the same resource type.
       */
      if (method === 'Page.frameNavigated' && params?.frame?.parentId === undefined) {
        const id = params?.frame?.id
        if (typeof id === 'string') await chrome.storage.session.set({ mainFrameId: id })
        return
      }

      if (method === 'Page.loadEventFired') {
        // Navigation destroys the indicator, so it is re-injected on every
        // load rather than once at attach. The watchdog is what catches the
        // case where this injection fails.
        await handlers.onPageLoaded(state.tabId)
        return
      }

      if (method === 'Fetch.requestPaused') {
        /**
         * A held request must never outlive a mistake in here.
         *
         * `Fetch.enable` holds EVERY request until something answers it, so an
         * exception escaping this handler — a storage read that failed, a
         * malformed event, anything — leaves the person looking at a tab that
         * has stopped loading, wearing Propositum's own border, with no
         * explanation and no way to tell it from the site being slow. That is
         * the worst-looking failure this design can produce.
         *
         * Failing the request rather than continuing it, because an internal
         * error is not evidence that a request is safe to send, and because
         * one failed subresource is a visible, ordinary, recoverable thing
         * whereas a hung page is not.
         */
        try {
          await onRequestPaused(state, params, handlers)
        } catch (error) {
          console.error('[propositum] could not judge a held request:', error)
          await chrome.debugger
            .sendCommand({ tabId: state.tabId }, 'Fetch.failRequest', {
              requestId: params?.requestId,
              errorReason: 'Aborted',
            })
            .catch(() => {})
        }
      }
    })()
  })

  chrome.debugger.onDetach.addListener((source, reason) => {
    void (async () => {
      const state = await controlState()
      if (state.tabId === null || source.tabId !== state.tabId) return
      await handlers.onDetached(state, reason)
    })()
  })
}

/**
 * Answer a held request.
 *
 * Blocking is unconditional; **aborting the action is scoped to the action's
 * own window**, and the split is what makes the rule both airtight and
 * survivable on a real site.
 *
 *   - Unconditional block: nothing non-`GET` leaves this tab, ever. Ambient
 *     telemetry a page fires while the agent is idle is failed at the network
 *     the same as anything else, and nothing about the run changes — nothing
 *     was sent, so there is nothing to abort and nothing to tell anyone about.
 *   - Scoped abort: when the block lands *between dispatching an action and
 *     the page settling*, that request is plausibly the one our input caused.
 *     That is the case worth reporting as `blocked-request` / `off-origin` and
 *     halting the run over.
 *
 * A beacon that happens to fire inside the window produces a spurious abort.
 * That is a real cost, it is the safe direction, and it is written down here
 * rather than discovered later.
 */
async function onRequestPaused(state, params, handlers) {
  const verdict = classifyPausedRequest(
    params,
    state.approvedOrigins,
    handlers.patternCovers,
    state.mainFrameId,
  )
  const requestId = params?.requestId

  if (verdict === 'allow') {
    await chrome.debugger
      .sendCommand({ tabId: state.tabId }, 'Fetch.continueRequest', { requestId })
      .catch(() => {})
    return
  }

  await chrome.debugger
    .sendCommand({ tabId: state.tabId }, 'Fetch.failRequest', {
      requestId,
      errorReason: 'Aborted',
    })
    .catch(() => {})

  if (Date.now() > state.actionWindow) return

  await handlers.onIrreversibleBlocked(verdict, {
    method: String(params?.request?.method ?? ''),
    origin: originOf(params?.request?.url ?? '') ?? '(unparseable)',
  })
}

/**
 * Open the tab the agent will work in, and take control of it.
 *
 * `chrome.tabs.create` is the ONLY source of a tab id in this extension. It is
 * also, usefully, one that tells us nothing: without the `tabs` permission the
 * `Tab` object Chrome hands back has no `url` and no `title` — even for a tab
 * we opened. We know where it went because we said so, not because Chrome told
 * us.
 *
 * `active: false` so the person is not yanked out of what they were doing. See
 * ADR-0010's risk list: whether synthesised input behaves identically in a
 * background tab is not established for this exact path, and if it turns out a
 * foregrounded tab is required, the agent steals focus and the interruption
 * argument reopens.
 */
export async function openControlledTab({ runId, approvedOrigins }) {
  /**
   * The tab starts blank, and the real URL is a navigation we make afterwards.
   *
   * Creating it directly on the target would start the load before the
   * debugger is attached, which loses two things that matter: the request
   * interceptor would not see the first document request at all, and the
   * lifecycle events for that load would have fired before we were listening —
   * so every run would sit out the full settle ceiling waiting for an idle
   * that already happened.
   */
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
  if (typeof tab.id !== 'number') throw new ControlLost('Chrome did not return a tab id')

  /**
   * Attach FIRST, then claim the tab in storage.
   *
   * `controlledTabId` is not bookkeeping — it is what every other surface in
   * this extension reads to answer *"is Propositum working right now"*. Written
   * before the attach succeeded, a failed attach (DevTools already open on the
   * tab, another extension holding it, the tab closed under us) leaves that
   * flag set with nothing attached: no watchdog, no badge, no way to stop
   * something that is not happening — and, because `showSuggestionBadge`
   * stands down while it is set, offers silently stop appearing until the
   * browser is restarted. A flag that says work is in progress when none is
   * has to be harder to set than that.
   *
   * On any failure the tab is closed as well as released. We opened it, it is
   * blank, and nobody is looking at it.
   */
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3')

    await chrome.storage.session.set({
      controlledTabId: tab.id,
      controlledRunId: runId ?? null,
      approvedOrigins: approvedOrigins ?? [],
      indicatorAliveAt: Date.now(),
      indicatorGraceUntil: Date.now() + SETTLE_CEILING_MS,
      actionWindow: 0,
      snapshot: null,
      mainFrameId: null,
    })

    // Order matters. `Fetch.enable` last, so the interceptor is the last thing
    // installed and nothing is held before we are ready to answer it.
    await send(tab.id, 'Page.enable')
    await send(tab.id, 'DOM.enable')
    await send(tab.id, 'Accessibility.enable')
    await send(tab.id, 'Page.setLifecycleEventsEnabled', { enabled: true })
    await send(tab.id, 'Fetch.enable', { patterns: [{ requestStage: 'Request' }] })

    // Whichever frame the blank page is, is the tab. `Page.frameNavigated`
    // keeps it current from here; asking now means the very first navigation
    // is already classifiable.
    const { frameTree } = await send(tab.id, 'Page.getFrameTree')
    const mainFrameId = frameTree?.frame?.id
    if (typeof mainFrameId === 'string') await chrome.storage.session.set({ mainFrameId })

    return tab.id
  } catch (error) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {})
    await clearControlState()
    await chrome.tabs.remove(tab.id).catch(() => {})
    throw error
  }
}

/**
 * Give up control, and do it before telling anyone.
 *
 * **Detach first, POST second.** Stopping must work with the app closed, the
 * dev server restarting, or the machine offline. A stop that has to reach a
 * server before it takes effect is not a stop.
 */
export async function detachControl(tabId) {
  await chrome.debugger.detach({ tabId }).catch(() => {})
}

/* ── the command set ───────────────────────────────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wait for the page to stop moving.
 *
 * `Page.lifecycleEvent` with name `networkIdle`, floor then ceiling. Returning
 * `false` on the ceiling is not an error — a page with a long-poll of its own
 * never goes idle, and the agent reads the tree it has.
 */
async function waitForSettle() {
  const startedAt = Date.now()
  await sleep(SETTLE_FLOOR_MS)

  /**
   * The idle we are waiting for is one that happens AFTER the floor.
   *
   * Comparing against `startedAt` instead would defeat the floor entirely: an
   * idle that fired during it is the previous document's — the exact thing the
   * floor exists to skip — and it would satisfy the check on the first
   * iteration. `observePage` would then snapshot the outgoing page after a
   * click that triggered navigation, and the agent would get refs for a tree
   * that is about to be replaced. The ceiling still runs from `startedAt`, so
   * "ten seconds" means ten seconds.
   */
  const floorPassed = Date.now()

  while (Date.now() - startedAt < SETTLE_CEILING_MS) {
    if (networkIdleSince > floorPassed) return true
    await sleep(100)
  }
  return false
}

/**
 * Read the page, and mint the refs the next action may name.
 *
 * Writing the snapshot replaces the previous one, which invalidates every ref
 * in it. That is the point rather than a side effect — see `flattenAXTree`.
 */
export async function observePage(tabId) {
  const { nodes } = await send(tabId, 'Accessibility.getFullAXTree')
  const { tree, refs, truncated } = flattenAXTree(nodes)

  const { frameTree } = await send(tabId, 'Page.getFrameTree')
  const url = frameTree?.frame?.url ?? ''

  const snapshotId = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  await chrome.storage.session.set({ snapshot: { id: snapshotId, refs, url } })

  return {
    snapshotId,
    url,
    // The AX root's own name is the document title, and it is the only place a
    // title is available without the `tabs` permission.
    title: sanitiseName(axValue(nodes?.[0]?.name) ?? ''),
    tree,
    truncated,
  }
}

/**
 * Resolve a ref against the live snapshot, refusing on mismatch.
 *
 * **This check is independent of the gate.** The gate checks the snapshot id
 * too, from the app's own record of what the run last observed, and neither
 * trusts the other. Two checks over the same fact, on opposite sides of a
 * transport, is the cheapest possible defence against the one that matters:
 * an action landing on whatever moved into the position of the thing it meant
 * to touch.
 */
async function resolveRef(snapshotId, ref) {
  const { snapshot } = await chrome.storage.session.get(['snapshot'])

  if (!snapshot || snapshot.id !== snapshotId) throw new StaleSnapshot()
  const backendNodeId = snapshot.refs?.[ref]
  if (typeof backendNodeId !== 'number') throw new StaleSnapshot()

  return backendNodeId
}

export class StaleSnapshot extends Error {}

async function clickElement(tabId, params) {
  const backendNodeId = await resolveRef(params.snapshotId, params.ref)

  await send(tabId, 'DOM.scrollIntoViewIfNeeded', { backendNodeId })
  const { model } = await send(tabId, 'DOM.getBoxModel', { backendNodeId })

  const centre = centreOfContentQuad(model?.content)
  if (centre === null) {
    return { failure: 'not-delivered', detail: 'that control has no clickable area on the page' }
  }

  // mouseMoved first so hover handlers run the way they would for a person.
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: centre.x,
    y: centre.y,
    buttons: 0,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: centre.x,
    y: centre.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  })
  await send(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: centre.x,
    y: centre.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  })

  await waitForSettle()
  return null
}

async function typeText(tabId, params) {
  const backendNodeId = await resolveRef(params.snapshotId, params.ref)

  await send(tabId, 'DOM.focus', { backendNodeId })
  await send(tabId, 'Input.insertText', { text: String(params.text ?? '') })
  return null
}

async function pressKey(tabId, params) {
  // A closed set, checked here as well as in the gate. `press-key` is the one
  // command whose target is not an element but whatever holds focus, so the
  // key itself is the only thing bounding it.
  const descriptor = Object.prototype.hasOwnProperty.call(PRESSABLE_KEYS, params.key)
    ? PRESSABLE_KEYS[params.key]
    : undefined
  if (descriptor === undefined) {
    return { failure: 'not-delivered', detail: `${params.key} is not a key Propositum may press` }
  }

  if (typeof params.ref === 'string' && params.ref.length > 0) {
    const backendNodeId = await resolveRef(params.snapshotId, params.ref)
    await send(tabId, 'DOM.focus', { backendNodeId })
  }

  for (const type of ['rawKeyDown', 'keyUp']) {
    await send(tabId, 'Input.dispatchKeyEvent', {
      type,
      key: descriptor.key,
      code: descriptor.code,
      windowsVirtualKeyCode: descriptor.keyCode,
      nativeVirtualKeyCode: descriptor.keyCode,
    })
  }

  await waitForSettle()
  return null
}

async function navigate(tabId, params, approvedOrigins, patternCovers) {
  // Checked here as well as at the network. `Page.navigate` to an unapproved
  // origin would be caught by the paused Document request anyway — this
  // refuses it a step earlier so the failure names the cause rather than
  // arriving as an aborted load.
  if (!isApprovedOrigin(params.url, approvedOrigins, patternCovers)) {
    return { failure: 'off-origin', detail: originOf(params.url) ?? '(unparseable)' }
  }

  await send(tabId, 'Page.navigate', { url: params.url })
  await waitForSettle()
  return null
}

/**
 * Run one command and say what happened.
 *
 * Always returns a report body — never throws past here — because an
 * unreported intent is an orphan, and an orphan is indistinguishable from a
 * crash to everything downstream.
 */
export async function performCommand(command, handlers) {
  const state = await controlState()
  if (state.tabId === null) {
    return { ok: false, failure: 'control-lost', detail: 'no tab is under control' }
  }

  /**
   * The indicator gates the capability, not the other way round.
   *
   * The grace window is honoured here as well as in the watchdog, and the
   * reason it is safe to honour it is worth spelling out rather than
   * assuming. The window is open in exactly two situations: the tab has just
   * been created and has no page in it yet, and a navigation is in flight.
   * In both, there is no rendered document — so the only commands that can do
   * anything are `observe-page`, `navigate` and `capture-screen`, none of
   * which change anything out in the world.
   *
   * Every command that touches an element resolves a ref against a snapshot,
   * and a snapshot only exists after an `observe-page`, which only happens
   * after a load, which is the same event that injects the marker. So the
   * mutating path is guarded by construction: there is no ordering in which
   * Propositum clicks something on a page that never got a marker.
   *
   * If the injection itself fails, `indicatorGraceUntil` is cleared rather
   * than left to expire, so this refuses on the very next command.
   */
  const markerQuiet = Date.now() - state.indicatorAliveAt > INDICATOR_GRACE_MS
  if (markerQuiet && Date.now() > state.indicatorGraceUntil) {
    await handlers.onIndicatorLost(state)
    return { ok: false, failure: 'control-lost', detail: 'the working-here marker was lost' }
  }

  /**
   * Arm the window the request interceptor scopes its aborts to.
   *
   * Generous rather than tight, and it deliberately OUTLIVES the command. The
   * shape that matters is `type-text`, which returns the instant
   * `Input.insertText` resolves — the autosave or search-suggest POST it
   * provoked arrives a second or two later, when the command is long finished.
   * Closing the window on return would mean that request is failed at the
   * network (good) and then nothing is reported (bad): the run carries on
   * reasoning about a page whose request silently did not go.
   *
   * So it is left to expire on its own clock. The next command re-arms it, and
   * a block landing between two commands still finds an in-flight intent
   * roughly as often as not — and when it does not, `onIrreversibleBlocked`
   * still halts the run, which is the half that must not be optional.
   */
  await chrome.storage.session.set({ actionWindow: Date.now() + SETTLE_CEILING_MS + 2000 })

  try {
    let failure = null

    switch (command.kind) {
      case 'observe-page':
        break
      case 'navigate':
        failure = await navigate(
          state.tabId,
          command.params ?? {},
          state.approvedOrigins,
          handlers.patternCovers,
        )
        break
      case 'click-element':
        failure = await clickElement(state.tabId, command.params ?? {})
        break
      case 'type-text':
        failure = await typeText(state.tabId, command.params ?? {})
        break
      case 'press-key':
        failure = await pressKey(state.tabId, command.params ?? {})
        break
      case 'capture-screen': {
        const { data } = await send(state.tabId, 'Page.captureScreenshot', { format: 'png' })
        return { ok: true, capture: { mediaType: 'image/png', base64: data } }
      }
      default:
        return {
          ok: false,
          failure: 'not-delivered',
          detail: `${command.kind} is not something Propositum can do in a browser`,
        }
    }

    if (failure !== null) return { ok: false, ...failure }

    return { ok: true, observation: await observePage(state.tabId) }
  } catch (error) {
    if (error instanceof StaleSnapshot) {
      return {
        ok: false,
        failure: 'stale-snapshot',
        detail: 'the page changed since Propositum last looked at it',
      }
    }
    if (error instanceof TimedOut) {
      return { ok: false, failure: 'timed-out', detail: error.message }
    }
    if (error instanceof ControlLost) {
      return { ok: false, failure: 'control-lost', detail: error.message }
    }
    return { ok: false, failure: 'not-delivered', detail: String(error?.message ?? error) }
  }
  // No `finally` clearing `actionWindow` — see the comment where it is armed.
  // Closing it on return would blind the interceptor to exactly the requests a
  // just-finished action provoked.
}
