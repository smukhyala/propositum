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
 */

import type { ActionKind, EnforcedPolicy } from '../domain/handoff/policy'
import { ACTION_KINDS } from '../domain/handoff/policy'

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
  /** Required for `read-approved-source`. */
  readonly approvedSourceId?: string | undefined
  /** Required for `read-document` and `draft-section`. */
  readonly documentId?: string | undefined
  /** Required for `draft-section`. */
  readonly sectionPath?: string | undefined
  readonly text?: string | undefined
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
  | 'plan_limit_exceeded'
  | 'budget_exhausted'

/** Everything the gate needs about the run in flight. All facts, no judgment. */
export interface RunContext {
  /** Monotonic high-water mark, so plan steps stay immutable. */
  readonly currentStepOrdinal: number
  readonly planLength: number
  /** Derived from `contract.acceptedAt + timeLimitMinutes` — never stored, so a
   *  crash-restart loop cannot silently reset the budget. */
  readonly deadlineEpochMs: number
  /** Passed in, never read from the clock here, so the gate stays pure and a
   *  40-minute fixture can replay in 400ms. */
  readonly nowEpochMs: number
}

export type Authorization<K extends ActionKind = ActionKind> =
  | { readonly authorized: true; readonly action: AuthorizedAction<K> }
  | { readonly authorized: false; readonly rule: RefusalRule }

function isActionKind(kind: string): kind is ActionKind {
  return (ACTION_KINDS as readonly string[]).includes(kind)
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

  if (run.planLength > policy.maxPlanSteps) return deny('plan_limit_exceeded')

  // Off-plan and step scope. Initiative governs breadth, Progress governs depth;
  // they are orthogonal and must not collapse into one dial.
  if (proposal.stepOrdinal === undefined) {
    if (!policy.offPlanActions) return deny('off_plan')
  } else if (
    policy.stepScope === 'current-step-only' &&
    proposal.stepOrdinal !== run.currentStepOrdinal
  ) {
    return deny('step_out_of_scope')
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
      if (proposal.params.documentId === undefined) return deny('document_missing')
      break
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
