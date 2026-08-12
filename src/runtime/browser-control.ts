/**
 * The one channel between a gated action and the person's real Chrome.
 *
 * ── This file is a CONTRACT, and it is deliberately only a contract ──────
 *
 * There is no implementation here and there must not be one. The transport —
 * the `ActionDispatch` row, the long poll, the extension on the other end of it,
 * the `chrome.debugger` attachment — belongs to the control-channel unit. What
 * this file owns is the SHAPE those two units agreed on, written down once so
 * that neither has to guess and so that `src/policy/tools.ts` can be written and
 * tested against a fake before a single byte reaches a browser.
 *
 * If you are reading this because the real implementation has landed and this
 * file now looks redundant: it is not. The tools import `BrowserControl` from
 * here, so this is where the seam is. An implementation module that also
 * declared the interface would make the tools depend on the transport, and the
 * whole point of the tool surface is that it depends on nothing it cannot be
 * handed.
 *
 * ── Why one `dispatch`, and not six methods ──────────────────────────────
 *
 * A `click(ref)` / `type(ref, text)` / `press(key)` interface would put the
 * `ActionKind` vocabulary in two places, and the second copy would drift. More
 * importantly it would let a caller reach the channel without an
 * `AuthorizedAction`, because a six-method interface is six things to remember
 * to gate. One `dispatch` taking a kind and an opaque bag of params is exactly
 * as expressive, and every caller of it lives in `src/policy/tools.ts` where the
 * gate token is the first parameter.
 *
 * `intentId` rides along because it is the IDEMPOTENCY KEY. One authorised
 * intent yields at most one dispatch, so a worker that retries after a transport
 * error cannot double-deliver — which, for a browser action, means clicking
 * twice.
 *
 * ── Every acting kind returns an OBSERVATION, not an acknowledgement ─────
 *
 * `dispatch` returns the page as it stands AFTER the input landed. That is the
 * single most load-bearing decision in this file, and the argument for it is in
 * the header of `src/policy/tools.ts` under "the model only ever acts on what it
 * just saw". In short: if the only way to obtain a `snapshotId` is as the return
 * value of an action, then acting on a page the run did not just see is not a
 * rule the gate enforces — it is a value the caller cannot obtain.
 */

/**
 * What the page looks like right now, as the BROWSER describes it.
 *
 * ── Two attested fields and two page-authored ones, in one structure ─────
 *
 * `snapshotId` and `url` are attested: Propositum minted the first and Chrome
 * reported the second. `title` and `tree` are written by the page, in full, with
 * every accessible name in them chosen by whoever wrote the markup. On a hostile
 * page all of it is attacker-controlled.
 *
 * They travel together because separating them would mean two structures that
 * must be kept in step, and the failure mode of that is a tree paired with the
 * wrong url — which is precisely the confusion an attested field exists to
 * prevent. They are kept honest instead by TYPE at the next boundary: the model
 * input declares `title` and `tree` as `Datamarked`, so a bare string does not
 * type-check and the wrapping cannot be forgotten (ADR-0006).
 */
export interface PageObservation {
  /**
   * Identifies THIS tree. Minted by the extension, never by a page.
   *
   * The gate refuses a snapshot-dependent action whose `snapshotId` is not the
   * one the run last observed, so this value is what makes "click ref 47" mean
   * something. A ref without it is a bet that nothing re-rendered between
   * looking and clicking.
   */
  readonly snapshotId: string
  /** Browser-attested. Chrome said this is where the tab is; the page did not. */
  readonly url: string
  /** PAGE-AUTHORED. Datamark before it reaches a prompt. */
  readonly title: string
  /**
   * PAGE-AUTHORED, and the largest untrusted string in the product.
   *
   * The accessibility tree with element refs — the whole interactive surface,
   * read every turn. ADR-0010 records the consequence rather than burying it:
   * this grows the injection surface by roughly two orders of magnitude over a
   * 2,000-character excerpt, and datamarking is depth rather than a boundary.
   */
  readonly tree: string
  /** Whether the capture was cut short of what the page actually held. A
   *  truncated tree that reads as complete is how an agent concludes a button
   *  does not exist. */
  readonly truncated: boolean
}

/** Pixels of the person's real screen, for when the tree is not enough to act
 *  on. Its own kind, and its own grant, because of what it costs in privacy. */
export interface ScreenCapture {
  readonly mediaType: 'image/png'
  readonly base64: string
  /** The observation this capture belongs to, so a screenshot and a tree can
   *  never be shown to the model as though they described the same moment when
   *  they do not. */
  readonly snapshotId: string
}

/**
 * Why an instruction did not land. A closed set of DETERMINISTIC codes.
 *
 * Never prose, for the same reason `RefusalRule` is never prose: these are
 * counted, rendered and reasoned about. The human-readable half rides in
 * `detail`.
 *
 * ── `blocked` is the one worth understanding ─────────────────────────────
 *
 * ADR-0010 §2 synthesises input at coordinates and never calls `element.click()`,
 * so a control behind a cookie banner gets its click delivered to the banner.
 * That FAILS, visibly, and the next tree shows the agent it did not work — where
 * `element.click()` would have fired the handler through the overlay and
 * succeeded silently. The occlusion is very often the site telling a human to
 * stop and look, so a failure here is usually the correct outcome rather than a
 * defect to engineer around.
 */
export type ControlFailure =
  /**
   * The instruction expired while still QUEUED. It never left.
   *
   * The strongest negative statement the channel can make: no browser ever saw
   * this, so nothing happened. Distinguished from `not-reported` below because
   * the two are opposite epistemic states wearing the same word "timeout", and
   * collapsing them would lose the one case where we can honestly say the world
   * is unchanged.
   */
  | 'not-delivered'
  /**
   * It WAS delivered, and nothing came back. **We do not know what happened.**
   *
   * This is the honest `unverified` case, and the loop must not report it as a
   * failure that knows more than it does. A click that reached the browser and
   * never reported may have pressed the button, may have pressed it twice, or
   * may have done nothing at all — and under this project's standing "the Mac
   * sleeps mid-run" constraint it is routine rather than exotic.
   */
  | 'not-reported'
  /** A CDP operation that did not settle, reported by the extension itself.
   *  Narrower than the two above: the browser was there and answered. */
  | 'timed-out'
  /** No tab is attached — nothing was opened, or it was closed. */
  | 'no-tab'
  /** The attachment ended: Chrome's own infobar, the in-tab chip, or Stop. */
  | 'detached'
  /** The ref does not resolve against the live page any more. */
  | 'element-gone'
  /** The input was delivered somewhere else — occluded, off-screen, covered. */
  | 'blocked'
  /** The channel itself failed. Says nothing about whether the effect landed. */
  | 'transport'

/**
 * The failures after which we cannot say whether the world changed.
 *
 * Every browser failure is recorded `unverified` — CONTEXT.md is explicit that
 * the verdict covers both "nothing happened" and "we cannot tell". What this set
 * changes is the SENTENCE the ledger carries, and that distinction is the whole
 * reason `not-delivered` and `not-reported` are separate codes.
 *
 * Telling somebody "it did not go through" about an instruction that reached
 * their browser and may well have pressed Send is the single most damaging
 * thing this ledger could say, because they will act on it — retry the order,
 * re-send the message. The reverse error is merely annoying: they check
 * something that never happened.
 */
export const UNVERIFIED_FAILURES: ReadonlySet<ControlFailure> = new Set<ControlFailure>([
  'not-reported',
  'timed-out',
  'transport',
])

/**
 * What came back. Three arms, and the third is not an exception.
 *
 * A failed instruction is a FACT about the run — it becomes an `ActionOutcome`
 * with `result: 'failed'` beside the intent that was already committed. Throwing
 * it out of the channel would be fine too, right up until the throw escaped the
 * loop and took the ledger with it, which is the failure this shape exists to
 * make impossible to write by accident.
 */
export type BrowserReport =
  | { readonly ok: true; readonly observation: PageObservation }
  | { readonly ok: true; readonly capture: ScreenCapture }
  | { readonly ok: false; readonly failure: ControlFailure; readonly detail: string }

export interface BrowserControl {
  dispatch(input: {
    /** The already-committed `ActionIntent`. Idempotency key — see the header. */
    readonly intentId: string
    readonly kind: string
    readonly params: Record<string, unknown>
    readonly timeoutMs: number
  }): Promise<BrowserReport>
}

/**
 * How long one instruction may take before the channel gives up.
 *
 * Generous, because the other end is a browser loading a real page over a real
 * network, and a timeout that fires while a page is still painting produces a
 * `failed` outcome for an action that actually worked — the worst kind of ledger
 * row, because it is wrong in the direction of under-reporting an effect.
 */
export const DISPATCH_TIMEOUT_MS = 30_000

/**
 * Raised by a tool when the channel reported a failure.
 *
 * A class rather than a bare `Error` so the loop can record the deterministic
 * `failure` code beside the prose, instead of parsing a message. The loop
 * catches it exactly where it catches everything else a tool can throw — see the
 * `catch` in `runWorker` — so nothing about the ledger ordering changes.
 */
export class BrowserControlError extends Error {
  readonly failure: ControlFailure

  constructor(failure: ControlFailure, detail: string) {
    super(`${failure}: ${detail}`)
    this.name = 'BrowserControlError'
    this.failure = failure
  }
}
