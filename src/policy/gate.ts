/**
 * The authorization gate. The only way to obtain permission to act.
 *
 * ── How "unbypassable" is actually achieved ──────────────────────────────
 *
 * Not by discipline, and not by a wrapper someone can forget to use.
 *
 * Every tool in `./tools.ts` requires an `AuthorizedAction` as its first
 * argument. `AuthorizedAction` carries a brand keyed on a `unique symbol` that
 * is declared here and never exported. TypeScript therefore permits exactly one
 * construction site — `authorize()`, below — and no code anywhere else can
 * fabricate one, cast to one from a plain object, or build one structurally.
 *
 * So a worker holding a `ToolProposal` can do nothing with it. To reach a tool
 * it must call `authorize()`, and `authorize()` either returns a token or
 * refuses. There is no third path, and adding one requires exporting the
 * symbol — a change no reviewer would miss.
 *
 * A refusal is not an exception. It is a recorded fact: the caller writes an
 * `ActionIntent` with `authorized = false` and the returned `rule`. Refusals
 * are evidence about H3 (calibrated stopping), so they must be queryable rather
 * than thrown away.
 *
 * ── What this gate deliberately does NOT do ──────────────────────────────
 *
 * It never consults a model. Every check below is a set membership test, a
 * comparison, or a boolean. That is the whole point: models propose,
 * deterministic code authorizes.
 *
 * It does not evaluate semantic stop conditions — that is #15. It enforces the
 * structural ones that are already implied by the compiled policy.
 *
 * ── What a confirmation pause is, and what it is not ─────────────────────
 *
 * `ActionKind` now enumerates MECHANISMS rather than EFFECTS, so the gate can
 * no longer refuse *send a message* by having no such kind — `click-element`
 * presses whatever the page put under the pointer. See the header of
 * `../domain/handoff/policy.ts` for the full concession; the short version is
 * that ADR-0004's strongest claim is now materially weaker and the code should
 * not pretend otherwise.
 *
 * The replacement lives here as an ordinary refusal. `authorize()` stays **pure,
 * total and TWO-ARMED**: `{ authorized: true, action }` or
 * `{ authorized: false, rule }`, and nothing else. There is deliberately no
 * third `{ needsConfirmation }` arm, for three reasons that all point the same
 * way:
 *
 *   1. `ActionIntent.authorization` is declared closed at `allowed | refused` in
 *      CONTEXT.md. A third arm would force a non-terminal value into it.
 *   2. That column is append-only. A row meaning "we have not decided yet"
 *      cannot be updated into a decision later, so the ledger would carry a
 *      permanently unresolved fact.
 *   3. A caller holding a three-armed result has to remember to handle the
 *      third, and forgetting looks exactly like success.
 *
 * So **a confirmation arrives as a FACT on `RunContext`** — the person already
 * said yes, and their id is in `confirmedRequestIds` — and its **absence is an
 * ordinary refusal** with rule `confirmation_required`. The worker loop turns
 * that refusal into a question and asks; the pause happens outside the gate,
 * where a pause belongs, and the gate keeps a decision space small enough to
 * test exhaustively.
 */

import type { ActionKind, EnforcedPolicy } from '../domain/handoff/policy'
import {
  ACTION_KINDS,
  MUTATING_ACTION_KINDS,
  SNAPSHOT_DEPENDENT_ACTION_KINDS,
} from '../domain/handoff/policy'
import { classifyReversibility } from '../domain/execution/reversibility'
import type { ElementEvidence } from '../domain/execution/reversibility'

/**
 * The entire enforcement mechanism. A real runtime symbol, never exported.
 *
 * It must be a real value, not a `declare const` — a declared symbol is
 * type-only and emits nothing, so the token would carry no brand at runtime and
 * every construction would throw. The `unique symbol` annotation is what lets
 * TypeScript treat it as nominal rather than as plain `symbol`.
 *
 * Being unexported is what makes `authorize()` the only construction site the
 * type system will admit. This is a COMPILE-TIME guarantee: it makes accidental
 * bypass impossible and deliberate bypass loud. It is not a runtime sandbox —
 * code inside this repo could reach the symbol reflectively off a real token.
 * The threat model is our own future carelessness, not an attacker who can
 * already run arbitrary code in the worker.
 */
const authorized: unique symbol = Symbol('propositum.policy.authorized')

/**
 * Proof that the gate permitted this action. Obtainable only from `authorize()`.
 *
 * The `kind` is a type parameter so a tool can require its own kind
 * specifically: `readApprovedSource` will not accept a token authorizing
 * `draft-section`, even though both are `AuthorizedAction`s.
 */
export interface AuthorizedAction<K extends ActionKind = ActionKind> {
  readonly [authorized]: true
  readonly kind: K
  readonly params: ActionParams
  /** The `ActionIntent` row already committed for this action. Written and
   *  committed BEFORE any effect, so a run that dies mid-action still shows
   *  what it was attempting. */
  readonly intentId: string
}

/**
 * `| undefined` on every optional field is deliberate under
 * `exactOptionalPropertyTypes`. These shapes are parsed from model output,
 * where "the key is absent" and "the key is explicitly null/undefined" are both
 * things that actually arrive — and the gate must treat them identically rather
 * than have one path type-check and the other not.
 */
export interface ActionParams {
  /** Required for `read-approved-source` and `navigate`. */
  readonly approvedSourceId?: string | undefined
  /** Required for `read-document` and `draft-section`. */
  readonly documentId?: string | undefined
  /** Required for `draft-section`. */
  readonly sectionPath?: string | undefined
  readonly text?: string | undefined

  /**
   * The accessibility-tree snapshot `ref` was read from.
   *
   * Carried so the gate can refuse a ref that belongs to a tree the page has
   * since replaced. Without it, "click ref 47" is a bet that nothing re-rendered
   * between looking and clicking.
   */
  readonly snapshotId?: string | undefined
  /** An element id within that snapshot. Never a CSS selector and never text:
   *  a selector is re-resolved against the live page, which is the same bet. */
  readonly ref?: string | undefined

  /**
   * Where to navigate — **a path, not a URL**, and the distinction is the check.
   *
   * CONTEXT.md: every `ContractScope` reference is by id, never by URL. So a
   * `navigate` names an approved source by id and supplies a path to join to
   * that source's origin. **A path cannot escape an origin it is joined to** —
   * which is why the gate validates its shape rather than merely its presence.
   * `//evil.example` is protocol-relative and joins to a different host
   * entirely; `https://evil.example` is not a path at all. Both are refused.
   */
  readonly path?: string | undefined

  /**
   * Text to type. Deliberately separate from `text`.
   *
   * `text` is drafted prose destined for a Changeset that a human reviews.
   * `inputText` goes into someone's real browser, and a confirmation screen has
   * to show it to the person VERBATIM — "type this into that box" is only a
   * meaningful question if they can read the this. Folding them into one field
   * would make the confirmation screen guess which meaning it held.
   */
  readonly inputText?: string | undefined

  /** A closed set. The gate re-checks it at runtime because the grammar does
   *  not enforce unions any more than it enforces enums (#3). */
  readonly key?: 'Enter' | 'Tab' | 'Escape' | undefined

  /** The id of the confirmation the person answered. Present means "they were
   *  asked, and they said yes"; the gate checks it against the run's durable
   *  set rather than trusting its presence. */
  readonly confirmationId?: string | undefined
}

/** What a worker proposes. Carries no authority whatsoever. */
export interface ToolProposal {
  /** Deliberately `string`, not `ActionKind`. The model can return anything —
   *  `enum` is verified not to survive schema transformation (#3) — so the gate
   *  must handle an unknown kind rather than assume the type holds. */
  readonly kind: string
  readonly params: ActionParams
  /** Why the worker wants this. Recorded on the intent; never evaluated here. */
  readonly reason: string
  /** The plan step this belongs to. Absent or undefined both mean "off plan",
   *  and the gate must not distinguish them — see ActionParams above. */
  readonly stepOrdinal?: number | undefined
}

/** Deterministic rule ids. Never prose — these are queried, counted, and
 *  rendered, so they are identifiers rather than messages. */
export type RefusalRule =
  | 'unknown_action_kind'
  | 'action_kind_not_allowed'
  | 'source_not_approved'
  | 'source_missing'
  | 'document_missing'
  | 'off_plan'
  | 'step_out_of_scope'
  /** Retained even though the plan no longer bounds the browser path. Refused
   *  ActionIntent rows are append-only and some already carry it, so removing
   *  the member would make old rows unrenderable to satisfy tidiness. */
  | 'plan_limit_exceeded'
  | 'budget_exhausted'
  | 'action_limit_exceeded'
  | 'stale_snapshot'
  | 'element_ref_missing'
  | 'navigation_target_missing'
  | 'confirmation_required'
  | 'password_field'
  | 'key_not_allowed'
  | 'no_document_pinned'

/**
 * Everything the gate needs about the run in flight. All facts, no judgment.
 *
 * **Every field is read off durable rows BEFORE the call.** The gate never
 * queries anything: it cannot count its own actions, cannot look up whether a
 * confirmation was answered, and cannot ask the page what it is pointing at.
 * That is what keeps it pure, and purity is what makes the decision space
 * exhaustively testable rather than merely sampled.
 *
 * ── Why the browser-era fields are optional ──────────────────────────────
 *
 * They are declared `?: T | undefined` rather than required, and the reason is
 * worth stating rather than discovering. The run path that constructs a
 * `RunContext` today (`src/runtime/worker-loop.ts`) is owned by the unit wiring
 * the continuing executor; making these required would break that file from
 * here, before it is ready to supply them.
 *
 * So each absent field resolves to the value that GRANTS THE LEAST, with one
 * named exception:
 *
 *   - absent `currentSnapshotId` → `null`, so every snapshot-dependent kind is
 *     refused as stale. Safe.
 *   - absent `confirmedRequestIds` → empty, so nothing counts as confirmed.
 *     Safe.
 *   - absent `targetEvidence` → `null`, which the classifier escalates. Safe.
 *   - absent `actionsTaken` / `mutatingActionsTaken` → `0`, which means the two
 *     caps **do not bind**. This is the exception, and it is a real gap: an
 *     unwired caller gets exactly the enforcement it had before the caps
 *     existed — none — rather than a fail-closed refusal. Fail-closed here
 *     would refuse the first action of every existing drafting run, which is a
 *     worse failure than the one it prevents. The gap closes when the run path
 *     passes real counts; `tests/policy-gate.test.ts` covers the bound
 *     behaviour so wiring it up is a matter of supplying numbers, not of
 *     discovering what they do.
 */
export interface RunContext {
  /** Monotonic high-water mark, so plan steps stay immutable. */
  readonly currentStepOrdinal: number
  readonly planLength: number
  /** Derived from `contract.acceptedAt + timeLimitMinutes` — never stored, so a
   *  crash-restart loop cannot silently reset the budget. See `deadlineFor` in
   *  `../domain/execution/stop-conditions` for how confirmation pauses are
   *  credited back into it without reintroducing a stored deadline. */
  readonly deadlineEpochMs: number
  /** Passed in, never read from the clock here, so the gate stays pure and a
   *  40-minute fixture can replay in 400ms. */
  readonly nowEpochMs: number

  /** The snapshot the run last observed, or `null` if it has not observed one.
   *  A ref from any other snapshot is stale by definition. */
  readonly currentSnapshotId?: string | null | undefined
  /** Authorized actions so far, of every kind. Counted off ActionIntent rows. */
  readonly actionsTaken?: number | undefined
  /** Of those, how many were of a mutating kind. */
  readonly mutatingActionsTaken?: number | undefined
  /** Confirmations the person has actually answered YES to. An id absent from
   *  this set has either never been asked, been declined, or expired — and the
   *  gate must not distinguish them, because all three mean "not permitted". */
  readonly confirmedRequestIds?: ReadonlySet<string> | undefined
  /** What the page says about the element this proposal targets. Page-authored
   *  in every field; see `../domain/execution/reversibility`. */
  readonly targetEvidence?: ElementEvidence | null | undefined
}

/**
 * Two arms. There is no third, and adding one is not a small change — see the
 * file header. A confirmation is a fact on `RunContext`, and its absence is an
 * ordinary refusal.
 */
export type Authorization<K extends ActionKind = ActionKind> =
  | { readonly authorized: true; readonly action: AuthorizedAction<K> }
  | { readonly authorized: false; readonly rule: RefusalRule }

function isActionKind(kind: string): kind is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(kind)
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set(['Enter', 'Tab', 'Escape'])

/**
 * A sentinel origin that exists only to be resolved against. Never fetched.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve to a
 * real host, which matters because the whole point is to notice when a path
 * moves the origin somewhere else.
 */
const ORIGIN_PROBE = 'https://origin-probe.invalid'

/**
 * A same-origin path, and nothing that can be talked into being anything else.
 *
 * The executor joins this to an approved source's origin. `new URL(path, origin)`
 * is a RESOLVER, not a validator: given `//evil.example/x` it happily returns
 * `https://evil.example/x`, because a leading double slash is protocol-relative
 * and replaces the host. Given `https://evil.example` it returns that. So the
 * origin containment this whole "path, not URL" design rests on holds only if
 * the path is genuinely a path, checked HERE rather than assumed downstream.
 *
 * ── Two checks, because the shape check alone was not enough ─────────────
 *
 * The shape check came first and looked complete: non-empty, starts with `/`,
 * not `//`, no backslash (browsers normalise `\` to `/`, so `\\evil.example` is
 * the double-slash case wearing a hat).
 *
 * **A code review found it bypassable.** The WHATWG URL parser strips ASCII
 * tab, LF and CR from its input BEFORE parsing, so `"/\t/evil.example"` passes
 * every one of those checks and then resolves to `https://evil.example/`. That
 * is a model-proposed string navigating the person's real browser to an
 * arbitrary host while the gate reports success against an approved source id —
 * the exact failure this function exists to prevent, defeated by one character.
 *
 * So the shape check is now backed by the resolution itself: join the path to a
 * sentinel origin and require the result to still be on it. That check cannot
 * be out-argued by parser trivia, because it asks the parser. The shape checks
 * stay in front of it because they refuse things a resolution test would accept
 * (`partners` resolves fine and is still not a path we should take), and
 * because a specific refusal is worth more than a general one.
 */
function isSameOriginPath(path: string): boolean {
  if (path.length === 0) return false
  if (!path.startsWith('/')) return false
  if (path.startsWith('//')) return false
  if (path.includes('\\')) return false

  // Anything the URL parser removes before parsing, plus the rest of C0. These
  // are never legitimate in a path a model composed, and each one is a chance
  // for what we validated to differ from what gets fetched.
  for (const char of path) {
    const code = char.charCodeAt(0)
    if (code <= 0x20 || code === 0x7f) return false
  }

  try {
    const resolved = new URL(path, ORIGIN_PROBE)
    if (resolved.origin !== ORIGIN_PROBE) return false
    // The parser is also what decides where the path ends, so compare against
    // its answer rather than ours.
    if (!resolved.pathname.startsWith('/')) return false
  } catch {
    // An unparseable path is not a path. `new URL` throwing here is a refusal,
    // not an error condition — the gate must never propagate an exception,
    // because a throw is not a recorded decision.
    return false
  }

  return true
}

/**
 * The evidence the gate is willing to believe describes THIS proposal.
 *
 * Evidence with no element identity, or with an identity that is not the one
 * being proposed, is treated as **no evidence at all** — which the classifier
 * escalates. A review found the hole this closes: nothing tied
 * `run.targetEvidence` to `params.ref`, so a loop that gathered evidence once
 * per turn could classify a *Place order* click using what it learned about
 * *Show more*, and the gate would have said yes.
 *
 * Escalation-only, like everything else here: a mismatch can only cause us to
 * ask, never to skip asking. So an executor that has not started populating
 * `ref` yet gets more confirmations rather than fewer, and wiring it up makes
 * the pause quieter rather than weaker.
 */
function evidenceFor(params: ActionParams, run: RunContext): ElementEvidence | null {
  const evidence = run.targetEvidence ?? null
  if (evidence === null || typeof evidence !== 'object') return null

  // No ref means nothing to bind the evidence TO, so there is no evidence about
  // this proposal — only evidence about some other element the run happened to
  // look at. Returning it would be the de-escalation this function exists to
  // prevent, and a second review caught exactly that: this line used to
  // `return evidence`, which handed `press-key` whatever was learned about the
  // last element with a ref. A keystroke inside a payment form would then be
  // classified `ordinary` because the previous turn had inspected a benign link.
  //
  // `press-key` is the case that matters, and it is unbindable BY CONSTRUCTION:
  // its target is whatever holds focus, which the page may move between our
  // snapshot and our keystroke. `reversibility.ts` says so in its own comment
  // and then never gets the chance to act on it, because the evidence it
  // receives describes a different element entirely.
  //
  // So: null, which the classifier escalates. The cost is that every `press-key`
  // asks — Tab and Escape included, which are harmless — and that cost is
  // accepted for the same reason the unnamed-element branch accepts noise on
  // icon buttons. The alternative is a confirmation that can be skipped by
  // showing the gate evidence about something else.
  if (params.ref === undefined) return null

  if (evidence.ref !== params.ref) return null
  if (evidence.snapshotId !== undefined && evidence.snapshotId !== params.snapshotId) return null

  return evidence
}

/**
 * The single construction site for `AuthorizedAction`.
 *
 * `intentId` is the already-committed `ActionIntent` row. The caller writes that
 * row — with `authorized` and, on refusal, `rule` — regardless of the outcome.
 *
 * Pure: no clock, no I/O, no model. Given the same policy, proposal, and
 * context it always returns the same answer, which is what makes the whole
 * decision space exhaustively testable.
 *
 * ── What the gate checks, in order ───────────────────────────────────────
 *
 * Deny by default. **No denylist** — a second mechanism creates a precedence
 * question with no principled answer.
 *
 * | # | Check | Refusal rule |
 * |---|---|---|
 * | 1 | budget exhausted | `budget_exhausted` |
 * | 2 | kind outside the enum | `unknown_action_kind` |
 * | 3 | kind not in the contract's allowlist | `action_kind_not_allowed` |
 * | 4 | total actions at the cap | `action_limit_exceeded` |
 * | 5 | mutating, and mutating actions at the cap | `step_out_of_scope` |
 * | 6 | plan longer than the cap | `plan_limit_exceeded` |
 * | 7 | off-plan without `use-judgment`; later step under `current-step-only` | `off_plan`, `step_out_of_scope` |
 * | 8 | element ref from a snapshot the run has replaced | `stale_snapshot` |
 * | 9 | per-kind params | `element_ref_missing`, `navigation_target_missing`, `source_missing`, `document_missing`, `key_not_allowed`, `password_field`, `no_document_pinned` |
 * | 10 | source not approved | `source_not_approved` |
 * | 11 | irreversible and unconfirmed | `confirmation_required` |
 *
 * **Budget stays first**, for the reason it was already first: an exhausted run
 * should report the real reason rather than whichever narrower rule happens to
 * also apply. And it refuses *everything*, including reads — a time limit is a
 * limit on working, not on writing, or the dial does not mean what its label
 * says.
 *
 * **Confirmation is LAST, deliberately.** The person is only ever asked about a
 * proposal that would otherwise have been permitted. Asking someone to approve
 * something the gate was going to refuse anyway teaches them that the question
 * is a formality — and a person who has learned to click through a confirmation
 * is worse off than one who was never asked, because we have taken a real
 * safeguard and spent it on noise.
 *
 * Rows 6 and 7 apply only where a plan exists. A continuing worker proposes no
 * `stepOrdinal`, so it lands in the off-plan branch and needs `use-judgment` —
 * which is the correct reading of *follow the plan closely* when there is no
 * plan to follow.
 */
export function authorize(
  policy: EnforcedPolicy,
  proposal: ToolProposal,
  run: RunContext,
  intentId: string,
): Authorization {
  const deny = (rule: RefusalRule): Authorization => ({ authorized: false, rule })

  // Budget first. An exhausted run may do nothing at all, including reads —
  // otherwise "your time limit" would be a limit on writing rather than on
  // working, which is not what the dial says.
  if (run.nowEpochMs >= run.deadlineEpochMs) return deny('budget_exhausted')

  // The model can return a kind outside the set, because the grammar does not
  // enforce enums. Deny by default covers it; the cost is one wasted turn.
  if (!isActionKind(proposal.kind)) return deny('unknown_action_kind')
  const kind: ActionKind = proposal.kind

  if (!policy.actionKindAllowlist.has(kind)) return deny('action_kind_not_allowed')

  // How much has already happened. Absent counts resolve to 0 — see RunContext
  // for why that is the one place absence grants rather than withholds.
  const actionsTaken = run.actionsTaken ?? 0
  const mutatingActionsTaken = run.mutatingActionsTaken ?? 0

  if (actionsTaken >= policy.maxActions) return deny('action_limit_exceeded')

  // The mutating cap IS the Progress dial under its new definition: a step is
  // the interval between two mutating actions, so exceeding the cap under
  // `current-step-only` is literally proposing a second step. Same rule id as
  // the ordinal check below because it is the same refusal — "that is further
  // than you were allowed to go" — reached by whichever bound applies to the
  // path in flight.
  if (MUTATING_ACTION_KINDS.has(kind) && mutatingActionsTaken >= policy.maxMutatingActions) {
    return deny('step_out_of_scope')
  }

  if (run.planLength > policy.maxPlanSteps) return deny('plan_limit_exceeded')

  // Off-plan and step scope. Initiative governs breadth, Progress governs depth;
  // they are orthogonal and must not collapse into one dial.
  //
  // The ordinal comparison is retained alongside the mutating cap rather than
  // replaced by it, because it still binds the plan-driven drafting path, which
  // still exists. It cannot be a model grant: `currentStepOrdinal` is a
  // code-owned high-water mark, so a model naming a step can only match it or
  // be refused — never widen it.
  if (proposal.stepOrdinal === undefined) {
    if (!policy.offPlanActions) return deny('off_plan')
  } else if (
    policy.stepScope === 'current-step-only' &&
    proposal.stepOrdinal !== run.currentStepOrdinal
  ) {
    return deny('step_out_of_scope')
  }

  // A ref means nothing without the tree it was read from. Refusing a ref whose
  // snapshot is not the one the run last observed is the difference between
  // clicking `Cancel order` and clicking whatever re-rendered into its place.
  // A run that has observed nothing has `currentSnapshotId === null`, and every
  // snapshot-dependent kind is stale against it — deny by default, with no
  // special case for "the first one".
  if (SNAPSHOT_DEPENDENT_ACTION_KINDS.has(kind)) {
    const current = run.currentSnapshotId ?? null
    if (current === null || proposal.params.snapshotId !== current) {
      return deny('stale_snapshot')
    }
  }

  switch (kind) {
    case 'read-approved-source': {
      const id = proposal.params.approvedSourceId
      if (id === undefined) return deny('source_missing')
      if (!policy.sourceAllowlist.has(id)) return deny('source_not_approved')
      break
    }
    case 'read-document':
    case 'draft-section': {
      // Capability before payload: with no base pinned there is no document
      // capability at all, so that is the honest reason to report even when the
      // proposal also forgot to name a document.
      if (!policy.documentBasePinned) return deny('no_document_pinned')
      if (proposal.params.documentId === undefined) return deny('document_missing')
      break
    }
    case 'navigate': {
      const path = proposal.params.path
      if (path === undefined || !isSameOriginPath(path)) {
        return deny('navigation_target_missing')
      }
      // The origin comes from an approved source by id, never from the
      // proposal. That is what makes the path unable to escape: the worker
      // chooses where within a site, we choose which site.
      const id = proposal.params.approvedSourceId
      if (id === undefined) return deny('source_missing')
      if (!policy.sourceAllowlist.has(id)) return deny('source_not_approved')
      break
    }
    case 'click-element': {
      if (proposal.params.ref === undefined) return deny('element_ref_missing')
      break
    }
    case 'type-text': {
      if (proposal.params.ref === undefined) return deny('element_ref_missing')

      // Never type into a form holding a password or a card number — refused
      // outright, not confirmed. A confirmation screen here would be a prompt
      // asking someone to approve an agent entering their credentials, and the
      // right answer to that question is not "let them decide": it is a
      // capability we do not offer. Deny is also the honest report, because
      // there is no follow-up that turns it into a yes.
      //
      // Reads the RAW evidence rather than `evidenceFor`, deliberately: unbound
      // evidence saying "there is a password field here" should still refuse.
      // Routing it through the binding check would downgrade that to a
      // confirmation the person could approve, and this is the one signal we
      // want acted on even when we are not sure it describes this element.
      if (run.targetEvidence?.formHasSensitiveField === true) return deny('password_field')
      break
    }
    case 'press-key': {
      // Note this kind does NOT get the `password_field` refusal, and the
      // asymmetry is intended: entering credentials is a capability we decline
      // to have, but submitting a form the PERSON filled in themselves is an
      // ordinary act that merely needs their say-so. The classifier escalates
      // any keypress inside a form to `confirmation_required`, so it is asked
      // about rather than silently allowed.
      //
      // Checked at runtime rather than trusted from the type. The grammar does
      // not enforce unions any more than it enforces enums (#3), so a model can
      // genuinely return `key: "Meta+Shift+Delete"`.
      const key = proposal.params.key
      if (key === undefined || !ALLOWED_KEYS.has(key)) return deny('key_not_allowed')
      break
    }
    case 'observe-page':
    case 'capture-screen': {
      // Looking needs nothing beyond the capability itself. Note `inputText` is
      // likewise not checked for `type-text`: a missing payload is a validity
      // problem for the tool to throw on, not a permission problem, and the
      // refusal vocabulary is about permission. Text does not widen anything.
      break
    }
  }

  // Last, and only over proposals that would otherwise have been permitted.
  if (classifyReversibility(kind, evidenceFor(proposal.params, run)) === 'requires-confirmation') {
    const confirmationId = proposal.params.confirmationId
    const confirmed = run.confirmedRequestIds ?? new Set<string>()
    if (confirmationId === undefined || !confirmed.has(confirmationId)) {
      return deny('confirmation_required')
    }
  }

  return {
    authorized: true,
    action: { [authorized]: true, kind, params: proposal.params, intentId },
  }
}

/** Narrow a token to a specific kind, for tools that require one. Cannot mint
 *  authority — it only refines a token the gate already issued. */
export function isKind<K extends ActionKind>(
  action: AuthorizedAction,
  kind: K,
): action is AuthorizedAction<K> {
  return action.kind === kind
}
