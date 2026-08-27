/**
 * Deciding which proposals have to be shown to a person before they happen.
 *
 * ── What this replaces, and why the replacement is weaker ────────────────
 *
 * ADR-0004 kept the worker away from irreversible effects by not implementing
 * them. There was no `send-message`, so nothing could be sent — a prohibition
 * that could not be misconfigured and could not be re-enabled by a policy bug.
 *
 * A worker that drives the person's real browser cannot be protected that way.
 * `click-element` presses whatever the page put under the pointer, and the page
 * decides whether that is *Save draft* or *Place order*. The capability is one
 * capability; the effects are the page's to choose.
 *
 * So the prohibition becomes a **confirmation pause**, and this file decides
 * when to pull it. Say the cost plainly: a pause is strictly weaker than an
 * absence. It can be defeated by a bug here, by phrasing outside the lexicon,
 * by a page that labels its Buy button *Continue*, and — most likely of all —
 * by a person who has been asked eleven times today and has learned to click
 * yes. None of those can defeat a capability that does not exist.
 *
 * ── The load-bearing property: evidence may only ESCALATE ────────────────
 *
 * Every field of `ElementEvidence` is PAGE-AUTHORED. An accessible name is
 * whatever the page's author typed; `isSubmitControl` is read off markup the
 * page controls; even the form's shape is the page's to arrange. A hostile page
 * can make all of it say anything.
 *
 * That is survivable because of an asymmetry this function is built around:
 *
 *   > Page-derived evidence can turn `ordinary` into `requires-confirmation`.
 *   > **There is no input by which it produces `ordinary`.**
 *
 * Every rule below is of the form "if the page says X, escalate". None is of
 * the form "if the page says Y, relax". So the worst a hostile page can do here
 * is cause us to ask a human a question we did not need to ask — which grants
 * nothing, exactly as ADR-0007's *a model may always decline, because declining
 * grants nothing* grants nothing. This is what makes a function that eats
 * untrusted input compatible with ADR-0006, which otherwise forbids page text
 * from reaching a decision about what the worker may touch.
 *
 * It follows that **absent or malformed evidence returns
 * `requires-confirmation`**. An attacker's best move against a name-based
 * lexicon is to strip the name off the Buy button, so the fail direction has to
 * be the safe one. The cost is real and worth naming: unlabelled icon buttons —
 * a bare ✕, a hamburger, a chevron — will generate confirmations nobody needed.
 * That noise is the price of the fail direction, and if it becomes intolerable
 * the fix is better extraction upstream, never a relaxation here.
 *
 * ── No model, no clock, no I/O ───────────────────────────────────────────
 *
 * A model call in the authorization path would invert "models propose,
 * deterministic code authorizes" — the model would be deciding whether it needs
 * permission, which is the same thing as deciding it does not. `tests/
 * architecture.test.ts` asserts by name that this file imports nothing from
 * `model`, `policy` or `persistence`; the domain-purity check covers it already,
 * but this is the file most likely to grow a model call and a named test is
 * cheaper than remembering.
 *
 * ── The honest limits ────────────────────────────────────────────────────
 *
 * This is the SECONDARY mechanism. The primary one is browser-attested and sits
 * at the network: a non-`GET` request caught at `Fetch.requestPaused`, which is
 * Chrome telling us what is actually about to leave the machine rather than us
 * guessing from a button's label. ~~Another unit builds it.~~ **It is built —
 * `classifyPausedRequest` in `extension/src/cdp.js`, called from the paused-request
 * handler. That clause was stale well before the corrections below.** When both
 * exist this one is the early, legible warning — it can name *what* is about to
 * happen while the person can still recognise it — and the network check is the
 * one that cannot be talked out of firing.
 *
 * ── Two corrections, 2026-08-26, and the second one promotes this file ───
 *
 * **ADR-0024 makes the network check CONDITIONAL.** A non-`GET` covered by a
 * ratified `PurchaseAuthorization` — an origin, a ceiling, a count, an expiry —
 * will be allowed. So *"cannot be talked out of firing"* becomes *"cannot be
 * talked out of firing without a structured authorisation a person ratified"*.
 * Still not a dial, still not a model, and still weaker than what it replaced.
 *
 * **ADR-0025 makes this file the PRIMARY mechanism for anything outside a
 * browser.** There is no paused request on a desktop action, no Chrome, and
 * nothing attested. The whole of what decides irreversibility there is the
 * English-only, escalation-only lexicon below, matched against an accessible
 * name the APPLICATION wrote. That is the secondary mechanism doing a primary
 * job, and the two gaps stated at the end of this header get correspondingly
 * larger: the lexicon has to cover every approved application rather than every
 * approved web page, and `GET`-shaped destruction acquires a desktop analogue
 * with no mechanism behind it at all.
 *
 * Neither ADR is implemented as this is written. Both are decisions, and the
 * reason they are recorded here rather than only in `docs/adr/` is that this is
 * the file whose importance changes, and a file that quietly becomes
 * load-bearing is how a mechanism erodes without anybody choosing it.
 *
 * Two gaps, stated rather than implied:
 *
 *   - **The lexicon is English-only.** *Comprar*, *Absenden*, *购买* are all
 *     invisible to it. Untranslated tokens are not a rounding error on a
 *     browser that goes wherever the person goes.
 *   - **`GET`-shaped destruction is uncovered by both mechanisms.**
 *     `/unsubscribe?token=…` is a `GET`, so the network check will not flag it,
 *     and if the link is labelled *Manage preferences* the lexicon will not
 *     either. There is no proposal here that closes this; it is a known hole.
 */

import type { ActionKind } from '../handoff/policy'
import { CONFIRMABLE_ACTION_KINDS } from '../handoff/policy'

/**
 * Words that mean "this will be hard to take back".
 *
 * Chosen for the verbs that appear on the controls people regret pressing, not
 * for coverage of English. A token appearing here costs one confirmation; a
 * token missing from here costs an unreviewed irreversible act, so the list
 * errs long. `confirm` and `agree` are included precisely because they are the
 * second step of a flow whose first step we may already have confirmed — the
 * pause belongs on both, since the first is usually reversible and the second
 * usually is not.
 */
export const IRREVERSIBLE_INTENT_TOKENS: ReadonlySet<string> = new Set([
  'buy',
  'purchase',
  'order',
  'pay',
  'checkout',
  'subscribe',
  'send',
  'submit',
  'post',
  'publish',
  'delete',
  'remove',
  'cancel',
  'confirm',
  'sign',
  'agree',
  'transfer',
  'book',
  'apply',
  'withdraw',
  'deactivate',
  'unsubscribe',
])

/**
 * Evidence about the target of a proposed action.
 *
 * **EVERY field here is PAGE-AUTHORED.** Not one of them is attested by Chrome
 * or by Propositum. Treat the whole structure as adversarial input; see the
 * escalation-only property in the file header for why that is safe.
 */
export interface ElementEvidence {
  /** The accessible name, already split into tokens by the caller. Empty means
   *  the element has no name — which escalates, rather than reassures. */
  readonly accessibleNameTokens: readonly string[]
  /** The ARIA role, as reported by the tree. */
  readonly role: string
  /** A submit button, or an input of type submit/image. */
  readonly isSubmitControl: boolean
  readonly isInsideForm: boolean
  /** The enclosing form holds a password field or a `cc-*` autocomplete hint. */
  readonly formHasSensitiveField: boolean

  /**
   * WHICH element this describes, so a caller cannot classify one control using
   * evidence gathered about another.
   *
   * Added after a review pointed out that nothing tied the evidence to the
   * proposal: a run that collected evidence once per turn, or carried it across
   * a re-proposal, would classify a *Place order* click using what it learned
   * about *Show more* — and the gate would say yes. The snapshot check protects
   * the REF; nothing protected the EVIDENCE.
   *
   * Optional because the extraction that produces it is another unit's, and a
   * required field would break it from here. The gate treats a mismatch, and a
   * proposal that names a ref against evidence that names none, as **no
   * evidence at all** — which escalates. So the unwired state is the cautious
   * one, and wiring it up removes confirmations rather than adding them.
   */
  readonly ref?: string | undefined
  readonly snapshotId?: string | undefined
}

export type Reversibility = 'ordinary' | 'requires-confirmation'

/**
 * Normalise one page-supplied token into the pieces the lexicon can match.
 *
 * A caller may hand us `"Buy"`, `"buy!"`, `"Buy-now"` or an entire label as a
 * single token. Splitting on non-alphanumerics and lowercasing means none of
 * those hide a lexicon word behind punctuation or capitalisation.
 *
 * Note the direction: splitting can only produce MORE matches, never fewer, so
 * it can only escalate. That is why it is safe to be aggressive here.
 */
function pieces(token: string): string[] {
  return token
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((piece) => piece.length > 0)
}

/**
 * Is this structure actually the shape we require?
 *
 * It crosses a JSON boundary from a page-facing extraction, so the type
 * annotation is a claim rather than a guarantee — the same reason the gate
 * checks `kind` as a `string` rather than trusting `ActionKind`. Anything
 * malformed is treated as absent, and absent escalates.
 */
function isWellFormed(evidence: ElementEvidence): boolean {
  if (!Array.isArray(evidence.accessibleNameTokens)) return false
  for (const token of evidence.accessibleNameTokens) {
    if (typeof token !== 'string') return false
  }
  if (typeof evidence.role !== 'string') return false
  if (typeof evidence.isSubmitControl !== 'boolean') return false
  if (typeof evidence.isInsideForm !== 'boolean') return false
  if (typeof evidence.formHasSensitiveField !== 'boolean') return false
  if (evidence.ref !== undefined && typeof evidence.ref !== 'string') return false
  if (evidence.snapshotId !== undefined && typeof evidence.snapshotId !== 'string') return false
  return true
}

/**
 * Pure. Total. Escalation-only.
 *
 * Reading never confirms, so a kind outside `CONFIRMABLE_ACTION_KINDS` returns
 * `ordinary` and the evidence is not consulted at all — a page cannot cause us
 * to interrupt someone over a page we merely looked at, and more importantly it
 * cannot make a read look like something that needed permission.
 */
export function classifyReversibility(
  kind: ActionKind,
  evidence: ElementEvidence | null,
): Reversibility {
  if (!CONFIRMABLE_ACTION_KINDS.has(kind)) return 'ordinary'

  // Absent or malformed. The safe direction, for the reason in the header: the
  // cheapest attack on a name-based check is to remove the name.
  // `typeof` rather than `=== undefined`: the annotation says `| null`, but this
  // value has crossed a JSON boundary and the annotation is a claim, not a
  // guarantee. Reading a property off `undefined` would throw inside the
  // authorization path, and a throw is not a recorded decision.
  if (evidence === null || typeof evidence !== 'object') return 'requires-confirmation'
  if (!isWellFormed(evidence)) return 'requires-confirmation'

  // A submit control is the page telling us, in its own markup, that pressing
  // this sends the form somewhere. Believe it when it says so; disbelieve it
  // when it says nothing, which is what the malformed branch above does.
  if (evidence.isSubmitControl) return 'requires-confirmation'

  // Credentials and card numbers. We do not need to know what the button says:
  // any interaction inside a form holding a password or a `cc-*` field is one
  // the person should see first.
  if (evidence.formHasSensitiveField) return 'requires-confirmation'

  // Enter inside a form submits it on most pages, and `press-key` carries no
  // element to inspect — the target is whatever holds focus, which the page can
  // move between our snapshot and our keystroke. So a keypress inside a form is
  // treated as a submission attempt regardless of which key it is.
  if (kind === 'press-key' && evidence.isInsideForm) return 'requires-confirmation'

  // An element with no accessible name at all. Escalates: see the header — the
  // cost is noise on unlabelled icon buttons, and that cost is accepted.
  let named = false
  for (const token of evidence.accessibleNameTokens) {
    if (pieces(token).length > 0) named = true
  }
  if (!named) return 'requires-confirmation'

  for (const token of evidence.accessibleNameTokens) {
    for (const piece of pieces(token)) {
      if (IRREVERSIBLE_INTENT_TOKENS.has(piece)) return 'requires-confirmation'
    }
  }

  return 'ordinary'
}
