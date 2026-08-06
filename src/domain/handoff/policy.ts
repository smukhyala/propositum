/**
 * The policy compiler: consumer dials in, a deterministic rule set out.
 *
 * The founding brief's words: "Translate consumer settings into a structured
 * internal policy." Two names, not one — the `HandoffContract` is the agreement
 * a human ratified; the `EnforcedPolicy` is the rule set the gate evaluates.
 *
 * ── The load-bearing property of this file ───────────────────────────────
 *
 * `compilePolicy` takes `ContractScope` and `AutonomyControls`. It CANNOT take
 * `StatedIntent`, and that is enforced by the type system rather than by
 * reviewer attention.
 *
 * `StatedIntent` holds the objective, the definition of done, and guidance —
 * prose, parts of which originate in page text a hostile source could have
 * authored. If prose could reach a policy decision, a successful injection
 * would change not only what the worker attempts but what it is permitted to
 * touch, and the entire safety story would collapse.
 *
 * Passing it here is a compile error. See tests/policy-gate.type-test.ts.
 */

/** The closed set of things a worker can attempt. Capabilities the brief
 *  excludes — send a message, purchase, publish, delete — are ABSENT from this
 *  enum rather than denied by a rule. Absence of capability is the strongest
 *  prohibition available. */
export const ACTION_KINDS = ['read-approved-source', 'read-document', 'draft-section'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/** Whether a kind can change anything, so the UI can distinguish "I only read a
 *  source, nothing changed" from "your proposal may be partially drafted". */
export const MUTATING_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>(['draft-section'])

/**
 * Blast radius, as a product constant rather than a policy field.
 *
 * An all-red diff is a POLICY failure, not a rendering one — no differ rescues
 * a wholesale rewrite, so re-entry quality dies regardless of the diff UI.
 *
 * It needs no dedicated field because the plan already bounds it: one PlanStep
 * is one action, and each drafting step targets a distinct section. Capping
 * plan length therefore caps sections touched. Adding `maxSectionsPerRun`
 * beside it would be a second mechanism for one truth.
 */
export const MAX_PLAN_STEPS = 12

/** What the contract permits. Deliberately contains NO prose. */
export interface ContractScope {
  readonly approvedSourceIds: readonly string[]
  readonly allowedActionKinds: readonly ActionKind[]
  readonly baseVersionId: string
}

/** The human-set dials. Absent from every model-facing schema — a model that
 *  could pre-set "use judgment / stop only when blocked" would be the autonomy
 *  dial itself hijacked. */
export interface AutonomyControls {
  /** Breadth: may the worker act outside the plan? */
  readonly initiative: 'follow-closely' | 'use-judgment'
  /** Depth: may it go past the step in flight? */
  readonly progress: 'current-step-only' | 'remaining-plan'
  /** A real permission, not a display mode. */
  readonly output: 'suggestions-only' | 'draft-changes'
  readonly interruption: 'stop-when-uncertain' | 'stop-only-when-blocked'
  readonly timeLimitMinutes: number
}

/**
 * The compiled rule set. A COMPUTED VIEW with no table — two stores for one
 * truth is exactly how a UI comes to display something the gate cannot enforce.
 *
 * No `deadlineAt` field: a deadline is not a function of scope and controls,
 * and recomputing one on restart would reset the budget on every crash loop.
 * It is derived from `contract.acceptedAt + timeLimitMinutes`, an immutable pair.
 */
export interface EnforcedPolicy {
  readonly sourceAllowlist: ReadonlySet<string>
  readonly actionKindAllowlist: ReadonlySet<ActionKind>
  readonly stepScope: 'current-step-only' | 'remaining-plan'
  readonly offPlanActions: boolean
  readonly haltOnWorkerReportedUncertainty: boolean
  readonly maxPlanSteps: number
  readonly timeLimitMinutes: number
}

/**
 * Pure and total. Same inputs, same policy, always — so the whole domain
 * (2 x 2 x 2 controls x the ActionKind set) is exhaustively table-testable.
 *
 * Note the deliberate absence of a `statedIntent` parameter. That absence is
 * the safety property; see the file header.
 */
export function compilePolicy(scope: ContractScope, controls: AutonomyControls): EnforcedPolicy {
  const allowed = new Set<ActionKind>(scope.allowedActionKinds)

  // "Suggestions only" is a REAL permission: it removes the ability to propose
  // document text at all, rather than changing how the result is displayed.
  // Because review already produces decisions rather than documents, a
  // presentational reading would yield the identical artifact either way — and
  // a person who picks the safest-looking option and receives a drafted
  // document has been lied to by a panel they read as a permission panel.
  if (controls.output === 'suggestions-only') {
    allowed.delete('draft-section')
  }

  return {
    sourceAllowlist: new Set(scope.approvedSourceIds),
    actionKindAllowlist: allowed,
    stepScope: controls.progress,
    offPlanActions: controls.initiative === 'use-judgment',
    haltOnWorkerReportedUncertainty: controls.interruption === 'stop-when-uncertain',
    maxPlanSteps: MAX_PLAN_STEPS,
    timeLimitMinutes: controls.timeLimitMinutes,
  }
}
