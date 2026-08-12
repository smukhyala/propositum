/**
 * Every capability the worker has. This file is the complete list.
 *
 * ── The invariant this file exists to hold ───────────────────────────────
 *
 * EVERY exported tool takes an `AuthorizedAction` as its first parameter. That
 * token can only come from `authorize()`, so there is no way to reach a tool
 * without passing the gate — not by carelessness, not by a refactor, not by a
 * future contributor who has not read the ADR.
 *
 * `tests/architecture.test.ts` parses this file and fails if an exported
 * function is added without that parameter. The rule is checkable rather than
 * remembered, which is the only kind of rule that survives.
 *
 * ── Every acting tool returns the page AFTER it acted ────────────────────
 *
 * `clickElement`, `typeText`, `pressKey` and `navigateTo` all return a
 * `PageObservation`. That looks like a convenience — one round trip instead of
 * act-then-look — and the convenience is real, but it is not the reason.
 *
 * The reason is that it makes **"the model only ever acts on what it just saw"
 * STRUCTURALLY TRUE rather than enforced.** A snapshot-dependent action needs a
 * `snapshotId`, the gate refuses any `snapshotId` that is not the one the run
 * last observed, and — because of the return type above — *the only place a
 * `snapshotId` comes from is the return value of an action*. There is no other
 * source. A model cannot invent one that will pass, cannot reuse one from three
 * turns ago, and cannot be handed one by a page, because nothing in the page
 * block is a snapshot id and nothing else in the loop mints one.
 *
 * Compare the alternative, which was the obvious first design: acting tools
 * return an acknowledgement, and the loop calls `observePage` afterwards. That
 * works, and it holds the same property — until the day someone writes a loop
 * that skips the second observation on a turn where nothing looked like it
 * changed. Then the property is a convention, held by whoever last edited the
 * loop. Here it is held by the type of the function.
 *
 * `observePage` therefore exists for the FIRST turn, when there is no page yet,
 * and for "let me look at that again" — not as the second half of every turn.
 *
 * ── What is absent, and why absence is worth less than it was ────────────
 *
 * There is still no `sendMessage`, no `purchase`, no `publish`, no `deleteFile`
 * and no `materialiseWorkingCopy`. `tests/architecture.test.ts` still asserts
 * it, and that assertion still passes.
 *
 * **It now means considerably less than it did, and pretending otherwise would
 * be the dishonest version of this comment.** `ActionKind` enumerates
 * MECHANISMS, not effects (ADR-0010). `clickElement` presses whatever the page
 * put under the pointer, and the page decides whether that is *Save draft* or
 * *Place order*. What survives is a statement about OUR TOOL SURFACE — we ship
 * no code that composes a message — and no longer a statement about reachable
 * effects. The replacement is a confirmation pause in the gate, and a pause is
 * strictly weaker than an absence: it can be defeated by a classifier bug, by
 * phrasing outside the lexicon, or by a person who has learned to click yes.
 *
 * So here is what is still GENUINELY absent, meaning there is no function below
 * and no parameter that reaches it:
 *
 *   - **`evaluateScript`.** No `Runtime.evaluate`, no `Runtime.callFunctionOn`,
 *     no `DOM.resolveNode`. There is no path by which a string Propositum
 *     composed becomes JavaScript executing in a page the person is signed into.
 *     ADR-0010 §2 spends real robustness on this and names it as the property
 *     that needs its own ADR to spend.
 *   - **`listTabs` / `attachToTab`.** The agent works only in a tab Propositum
 *     opened. `chrome.debugger.getTargets` is never called and `tabs` is never
 *     requested, so there is no call that returns a tab we did not create.
 *   - **Cookie and storage reads.** No `Network.getCookies`, no
 *     `DOMStorage.getDOMStorageItems`. A session Propositum can act inside is
 *     not a session Propositum may copy out.
 *   - **`readResponseBody`.** Requests are inspected for method and origin —
 *     which is how irreversibility is attested — and their bodies are not read.
 *   - **File upload and download.** No `DOM.setFileInputFiles`, no download
 *     interception. Neither the person's filesystem nor ours is reachable.
 *   - **Drag, device emulation, and clipboard.** Three separate capabilities
 *     that each sound minor and each widen what "input" means.
 *   - **`rememberThisAnswer` / `alwaysAllow`.** **There is no "always allow".**
 *     A confirmation confirms exactly one action: a `ConfirmationVerdict` names
 *     a single `ConfirmationRequest`, which names a single `ActionIntent`. There
 *     is no field on any of those three rows that could hold a standing
 *     permission, and that absence is the one on this list most likely to be
 *     proposed as a small usability fix. It is not small. A remembered yes is a
 *     confirmation that outlives the thing it was about, granted at a moment
 *     when the person was looking at something else.
 *
 * ── Dependencies are passed, not imported ────────────────────────────────
 *
 * Each tool takes its collaborators as an explicit second argument. A tool that
 * reached for a module-level fetcher, database or browser channel would be a
 * tool that could be called anywhere, and the whole point is that it can only be
 * called from a gated worker loop holding real dependencies.
 */

import type { AuthorizedAction } from './gate'
import type { SourceFetcher } from './fetcher'
import { BrowserControlError, DISPATCH_TIMEOUT_MS, UNVERIFIED_FAILURES } from '../runtime/browser-control'
import type { BrowserControl, DispatchableKind, PageObservation, ScreenCapture } from '../runtime/browser-control'

export interface SourceText {
  readonly approvedSourceId: string
  readonly title: string
  /** Cleaned. Never the raw href. */
  readonly url: string
  /**
   * RAW page text, bounded by the fetcher.
   *
   * Deliberately NOT datamarked here. The ledger writer is the one door that
   * sanitises (#35), and marking it twice would either double-fence it or
   * tempt a caller into treating this as already safe. It is not safe: it is
   * page-authored, and the type name says so.
   */
  readonly untrustedText: string
}

export interface DocumentText {
  readonly documentId: string
  readonly versionId: string
  /** Normalised to one sentence per line. */
  readonly content: string
  readonly contentHash: string
}

/** What the worker returns for a drafting step: PROSE, not a patch.
 *  Deterministic code diffs it against the base, so the model never asserts
 *  what changed — only what the text should say. */
export interface DraftedSection {
  readonly sectionPath: string
  readonly prose: string
}

/* ── collaborators ─────────────────────────────────────────────────────── */

export interface SourceLookup {
  /** Resolve an approved source id to the URL it stands for. */
  urlFor(approvedSourceId: string): Promise<string | null>
}

export interface VersionLookup {
  /** Read a pinned version. Never "the current document" — the base is fixed
   *  for the whole shift, and reading live content would let a mid-run human
   *  edit silently change what the worker is drafting against. */
  byId(versionId: string): Promise<{ id: string; documentId: string; content: string; contentHash: string } | null>
}

export interface ReadSourceDeps {
  readonly fetcher: SourceFetcher
  readonly sources: SourceLookup
}

/**
 * What the browser tools need. One channel, and — for `navigateTo` — the same
 * `SourceLookup` the reading tool uses.
 *
 * There is deliberately no `tabId`, no `sessionId` and no handle of any kind.
 * Which tab the channel is attached to is the channel's business and is not
 * addressable from here: a tool that could name a tab would be a tool that could
 * name a DIFFERENT tab, and ADR-0010 §1 rests on there being no such value in
 * the process at all.
 */
export interface BrowserDeps {
  readonly control: BrowserControl
  /** Overridable so a slow site does not need a code change, and so a test does
   *  not need a real one. Never proposed by a model — a timeout a model could
   *  set is a timeout a model could set to zero, and the failure would read as
   *  the page's fault. */
  readonly timeoutMs?: number | undefined
}

export interface NavigateDeps extends BrowserDeps {
  readonly sources: SourceLookup
}

export interface ReadDocumentDeps {
  readonly versions: VersionLookup
  /**
   * The version pinned by `ContractScope.baseVersionId`. Passed in rather than
   * looked up from the action, so a tool cannot be pointed at another version.
   *
   * OPTIONAL, because a Shift can pin no document at all. That case never
   * reaches here — the gate refuses `read-document` with `no_document_pinned`
   * before any tool runs — so the guard below is the second fence, and it names
   * the condition rather than failing on a lookup for an empty id. A sentinel
   * empty string would have kept the type simple and made the eventual error
   * read as "version '' not found", which describes a corrupted pin rather than
   * an absent one.
   */
  readonly baseVersionId?: string | undefined
}

/* ── the three that never touch a browser ──────────────────────────────── */

export async function readApprovedSource(
  action: AuthorizedAction<'read-approved-source'>,
  deps: ReadSourceDeps,
): Promise<SourceText> {
  const id = action.params.approvedSourceId
  if (!id) throw new Error(`authorized read-approved-source with no source id (${action.intentId})`)

  const url = await deps.sources.urlFor(id)
  if (!url) throw new Error(`approved source ${id} has no URL`)

  // The fetcher re-checks the allowlist against the URL actually being
  // requested, closing the gap between "we authorised source X" and
  // "we fetched X".
  const page = await deps.fetcher.fetch(url)

  return {
    approvedSourceId: id,
    title: page.title,
    url: page.url,
    untrustedText: page.text,
  }
}

/**
 * Read the document, meaning the version this shift is pinned to.
 *
 * ── Why `action.params.documentId` is not consulted at all ───────────────
 *
 * It used to be. This compared the param against `version.documentId` and threw
 * when they differed, and the mismatch was described as the safeguard that kept
 * a shift from being pointed at another document.
 *
 * It was not a safeguard, and it never once let a read through. The only caller
 * put `ContractScope.baseVersionId` in that param — a `DocumentVersion` id being
 * compared against a `Document` id, two different rows that can never be equal.
 * So every planned document read passed the gate, committed an `ActionIntent`,
 * threw, and was recorded as a failed `ActionOutcome` with an `unverified`
 * scope verdict. A capability that had never succeeded looked, in the ledger,
 * exactly like a capability that kept going wrong.
 *
 * Deleting the check rather than fixing the id it was fed is the stronger
 * choice, because the check could not add anything even when correct. What is
 * read is `deps.baseVersionId`, which comes from the ratified contract and is
 * passed in for precisely this reason: there is no argument to this function
 * that can move it. A param that cannot change the outcome can only ever
 * disagree with it, and disagreeing was the whole failure.
 *
 * The gate still requires `documentId` on a `read-document` proposal, and that
 * requirement now bites for real — `src/runtime/worker-loop.ts` passes the
 * shift's actual `Document` id, so `document_missing` refuses a run that has no
 * document instead of being unreachable.
 */
export async function readDocument(
  _action: AuthorizedAction<'read-document'>,
  deps: ReadDocumentDeps,
): Promise<DocumentText> {
  const base = deps.baseVersionId
  if (base === undefined || base === '') {
    throw new Error(`authorized read-document on a shift that pins no document (${_action.intentId})`)
  }

  const version = await deps.versions.byId(base)
  if (!version) throw new Error(`base version ${base} not found`)

  return {
    documentId: version.documentId,
    versionId: version.id,
    content: version.content,
    contentHash: version.contentHash,
  }
}

export function draftSection(action: AuthorizedAction<'draft-section'>): DraftedSection {
  const sectionPath = action.params.sectionPath
  const prose = action.params.text

  if (!sectionPath) throw new Error(`authorized draft-section with no section (${action.intentId})`)
  if (prose === undefined) throw new Error(`authorized draft-section with no prose (${action.intentId})`)

  // Nothing is written here. The worker returns prose; deterministic code
  // computes the changeset and the human decides. "Drafting" is a proposal.
  return { sectionPath, prose }
}

/* ── the six that drive the person's own Chrome ────────────────────────── */

/**
 * One trip to the channel, and one place that turns a reported failure into a
 * throw.
 *
 * Every tool below funnels through here, which is what keeps the failure
 * handling from being six slightly different opinions about what `ok: false`
 * means. It throws rather than returning a union because the loop already has a
 * `try/catch` around every effect that records a failed `ActionOutcome` against
 * the intent it already committed — so a throw lands in the ledger, and a second
 * error-shaped return type would be a second thing every caller has to remember
 * to check.
 *
 * NOT exported, and not taking an `AuthorizedAction`: it is unreachable from
 * outside this module, so there is no ungated path through it. The architecture
 * test parses exported functions only, which is exactly right — an unexported
 * helper cannot be called by anyone who has not already passed the gate.
 */
async function report(
  action: AuthorizedAction,
  params: Record<string, unknown>,
  deps: BrowserDeps,
): Promise<{ observation?: PageObservation; capture?: ScreenCapture }> {
  /**
   * Narrow the nine kinds to the six the channel can carry.
   *
   * `AuthorizedAction` is generic over all of `ActionKind`, and only the browser
   * six have a timeout and a meaning on the wire. A drafting kind arriving here
   * is a programming error rather than a refusal — the gate has already said yes,
   * so there is nobody left to tell — and it must be loud rather than dispatched
   * as something the extension will not recognise.
   */
  const kind = action.kind
  if (!(kind in DISPATCH_TIMEOUT_MS)) {
    throw new Error(`${kind} is not a browser capability and cannot be dispatched`)
  }
  const dispatchable = kind as DispatchableKind

  const dispatched = await deps.control.dispatch({
    intentId: action.intentId,
    kind: dispatchable,
    params,
    // Per kind, because a navigation and a keystroke are not the same wait. The
    // override is a ceiling for a slow site, not a way to widen one.
    timeoutMs: deps.timeoutMs ?? DISPATCH_TIMEOUT_MS[dispatchable],
  })

  if (!dispatched.ok) throw new BrowserControlError(dispatched.failure, dispatched.detail)

  return 'observation' in dispatched
    ? { observation: dispatched.observation }
    : { capture: dispatched.capture }
}

/**
 * The arm of `BrowserReport` a caller was expecting, or a throw.
 *
 * A channel that answered a click with a screenshot, or a screenshot request
 * with a tree, has malfunctioned in a way that must not be papered over: the
 * loop advances `currentSnapshotId` from what comes back, so accepting the wrong
 * arm would advance it to a snapshot that does not describe the page — and every
 * subsequent ref would be resolved against a tree the run never saw.
 */
function observationFrom(
  action: AuthorizedAction,
  reported: { observation?: PageObservation; capture?: ScreenCapture },
): PageObservation {
  if (!reported.observation) {
    throw new Error(`${action.kind} came back without a page observation (${action.intentId})`)
  }
  return reported.observation
}

/**
 * Look at the page.
 *
 * The first turn's tool, and the "let me check that again" tool. Every other
 * tool below already returns an observation, so this is deliberately NOT the
 * second half of each turn — see the file header for why that matters more than
 * the round trip it saves.
 */
export async function observePage(
  action: AuthorizedAction<'observe-page'>,
  deps: BrowserDeps,
): Promise<PageObservation> {
  return observationFrom(action, await report(action, {}, deps))
}

/**
 * Go somewhere within an approved source.
 *
 * ── The origin comes from an id, the path comes from the model ───────────
 *
 * That split is the entire containment story and it is worth stating in the one
 * place that performs the join. `params.path` is model-composed, so it may not
 * choose a host; `params.approvedSourceId` names a source the person ratified,
 * so it may not be anything else. The gate has already checked that the path
 * cannot escape an origin it is joined to — including the WHATWG parser trivia
 * that made an earlier shape check bypassable — and this function does the join
 * it validated.
 *
 * The re-check below is not redundant with the gate for the same reason
 * `allowlisted()` re-checks the fetched URL: the gate authorised *a source id
 * and a path*, and this is the one line that turns those into *a URL a browser
 * will actually load*. A mismatch between what was authorised and what is
 * requested is exactly the gap a second check at the door closes.
 */
export async function navigateTo(
  action: AuthorizedAction<'navigate'>,
  deps: NavigateDeps,
): Promise<PageObservation> {
  const sourceId = action.params.approvedSourceId
  const path = action.params.path

  if (!sourceId) throw new Error(`authorized navigate with no source id (${action.intentId})`)
  if (path === undefined) throw new Error(`authorized navigate with no path (${action.intentId})`)

  const origin = await deps.sources.urlFor(sourceId)
  if (!origin) throw new Error(`approved source ${sourceId} has no URL`)

  const base = new URL(origin)
  const target = new URL(path, base)

  if (target.origin !== base.origin) {
    throw new Error(`navigate resolved off ${base.origin} (${action.intentId})`)
  }

  return observationFrom(action, await report(action, { url: target.href }, deps))
}

/**
 * Press something.
 *
 * The kind that ADR-0010 concedes most about: this can press *Send*, *Buy* and
 * *Delete*, and nothing in this function knows which. What stands between it and
 * an irreversible effect is the confirmation pause in the gate and the
 * browser-attested request check at the network — neither of which lives here,
 * and both of which have already run by the time this executes.
 *
 * `ref` and `snapshotId` travel together to the channel. The extension resolves
 * the ref against the snapshot map it minted, so a ref from a tree it has
 * replaced fails there as `element-gone` rather than clicking whatever moved
 * into its place. That is the closed set of refs being re-applied at the only
 * place that can actually apply it: the gate can check WHICH snapshot, and only
 * the extension knows what was in it.
 */
export async function clickElement(
  action: AuthorizedAction<'click-element'>,
  deps: BrowserDeps,
): Promise<PageObservation> {
  const ref = action.params.ref
  if (!ref) throw new Error(`authorized click-element with no ref (${action.intentId})`)

  return observationFrom(
    action,
    await report(action, { ref, snapshotId: action.params.snapshotId }, deps),
  )
}

/**
 * Type into something.
 *
 * Reads `inputText` and never `text`. The two are separate fields on
 * `ActionParams` precisely so this cannot pick up drafted prose destined for a
 * Changeset, and so the confirmation screen can show the person VERBATIM what is
 * about to be typed into their browser — "type this into that box" is only a
 * meaningful question if they can read the this.
 *
 * Empty is allowed and `undefined` is not. Clearing a field is a real thing to
 * want; typing nothing because a parameter went missing is a bug that would
 * otherwise land as a successful no-op.
 */
export async function typeText(
  action: AuthorizedAction<'type-text'>,
  deps: BrowserDeps,
): Promise<PageObservation> {
  const ref = action.params.ref
  const inputText = action.params.inputText

  if (!ref) throw new Error(`authorized type-text with no ref (${action.intentId})`)
  if (inputText === undefined) throw new Error(`authorized type-text with no text (${action.intentId})`)

  return observationFrom(
    action,
    await report(action, { ref, snapshotId: action.params.snapshotId, inputText }, deps),
  )
}

/**
 * Send a keystroke to whatever holds focus.
 *
 * The one kind with no element to name, which is why the gate cannot bind
 * evidence to it and why the classifier escalates every keypress inside a form.
 * The key is re-checked against the closed set in the gate rather than trusted
 * from the type — the grammar enforces unions no more than it enforces enums —
 * and this function re-reads it only to fail loudly if that check were ever
 * removed.
 */
export async function pressKey(
  action: AuthorizedAction<'press-key'>,
  deps: BrowserDeps,
): Promise<PageObservation> {
  const key = action.params.key
  if (key === undefined) throw new Error(`authorized press-key with no key (${action.intentId})`)

  return observationFrom(action, await report(action, { key, snapshotId: action.params.snapshotId }, deps))
}

/**
 * Take a picture of the tab, for when the tree is not enough to act on.
 *
 * Its own `ActionKind` and its own grant, because it carries a different cost
 * from everything else here: pixels of the person's real screen, in a table the
 * person does not read. It returns a `ScreenCapture` rather than a
 * `PageObservation` and therefore does NOT advance `currentSnapshotId` — looking
 * harder at a page is not the same as looking at it again, and a screenshot
 * carries no element refs to act on.
 */
export async function captureScreen(
  action: AuthorizedAction<'capture-screen'>,
  deps: BrowserDeps,
): Promise<ScreenCapture> {
  const reported = await report(action, {}, deps)

  if (!reported.capture) {
    throw new Error(`capture-screen came back without an image (${action.intentId})`)
  }
  return reported.capture
}
