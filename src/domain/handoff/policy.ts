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
 *
 * ── What changed when the worker learned to drive a browser ──────────────
 *
 * Read this before touching `ACTION_KINDS`, because the honest version is not
 * flattering.
 *
 * ADR-0004 made a strong claim and earned it: *"a prohibition implemented as a
 * missing capability cannot be misconfigured, and cannot be re-enabled by a
 * policy bug."* There was no `send-message`, so no configuration and no bug
 * could send one. `tests/architecture.test.ts` still asserts no `sendMessage`
 * function exists, and that assertion still passes.
 *
 * **It now means considerably less than it used to.** `ActionKind` has stopped
 * enumerating EFFECTS and started enumerating MECHANISMS. `click-element` can
 * press *Send*. It can press *Buy*. It can press *Delete*. The enum is telling
 * the truth about what the worker may do — press a button — and no longer
 * telling you anything at all about what pressing it causes.
 *
 * The replacement is a confirmation pause: `classifyReversibility` in
 * `../execution/reversibility` escalates a proposal to *ask the person first*,
 * and the gate refuses it until they have. **A pause is strictly weaker than an
 * absence.** An absence cannot be misconfigured; a pause can be — by a bug in
 * the classifier, by page text that dodges the lexicon, by a person who has
 * been asked so often that they stop reading. Nobody should read this file and
 * come away believing ADR-0004's guarantee survived intact. It did not. What
 * survived is the shape of the argument: deterministic code still decides, and
 * a model still cannot widen anything.
 *
 * ── Six new members, when adding one was supposed to feel heavy ──────────
 *
 * ADR-0004 closed with *"adding a capability to `ActionKind` should feel heavy,
 * because it is."* Six arrive at once. The honest accounting:
 *
 * Five of them — `observe-page`, `navigate`, `click-element`, `type-text`,
 * `press-key` — are **one** capability, *drive a page*, split into verbs that a
 * ledger can render as sentences. A single `interact-with-page` kind carrying a
 * free-text script would have been one member and a far heavier grant: the
 * refusal rules could not name what was missing, the allowlist could not
 * distinguish looking from typing, and "what I did" would read as a script
 * rather than as *"I opened the orders page, then I clicked Track shipment"*.
 * The split buys legibility in the ledger and precision in the gate; it does
 * not buy any additional authority.
 *
 * The sixth, `capture-screen`, is genuinely separate: it is the fallback for
 * when the accessibility tree is not enough to act on, and it carries its own
 * privacy weight — pixels of the person's real screen — so it is grantable and
 * refusable on its own rather than hidden inside `observe-page`.
 */

/**
 * The closed set of things a worker can attempt.
 *
 * Note what is still absent: there is no `send-message`, no `purchase`, no
 * `publish`, no `delete-file`. That absence is now a statement about our TOOL
 * SURFACE — we ship no code that composes an email — and no longer a statement
 * about REACHABLE EFFECTS, because `click-element` reaches the page's own Send
 * button. See the file header; the distinction is the whole reason this comment
 * is longer than the array.
 */
export const ACTION_KINDS = [
  'read-approved-source',
  'read-document',
  'draft-section',
  'observe-page',
  'navigate',
  'click-element',
  'type-text',
  'press-key',
  'capture-screen',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

/**
 * Whether a kind can change anything, so the UI can distinguish "I only read a
 * source, nothing changed" from "your proposal may be partially drafted".
 *
 * `navigate` is deliberately NOT here, and the reason generalises:
 * `read-approved-source` already reaches the world with a network fetch and is
 * not mutating either. **Reaching the world and changing something are
 * different.** Loading a page is a read that happens to travel; this flag exists
 * so a person returning to an interrupted shift can be told whether their stuff
 * might be half-changed, and "I opened a page" is not that.
 *
 * `capture-screen` and `observe-page` are absent for the same reason: looking
 * changes nothing.
 */
export const MUTATING_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'draft-section',
  'click-element',
  'type-text',
  'press-key',
])

/**
 * Kinds the reversibility classifier runs on at all. **Reading never confirms.**
 *
 * Deliberately narrower than `MUTATING_ACTION_KINDS`: `draft-section` mutates,
 * but it mutates a proposal inside Propositum that a human reviews before
 * anything reaches a document. Asking permission for that would be asking
 * permission to think.
 */
export const CONFIRMABLE_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'click-element',
  'type-text',
  'press-key',
])

/**
 * The kinds whose effects leave Propositum. Code-owned, static, and **EMPTY**.
 *
 * A `ShiftOutcome` is `landed` iff a landing kind produced it. Today nothing
 * lands: every effect the worker can produce is a proposal a human still has to
 * accept, so the set has no members and the distinction costs nothing to carry.
 *
 * It exists empty rather than not existing because the day something does land
 * — a kind that posts, pays, or sends on the person's behalf without a second
 * human act — the question *"is this run's output already out in the world?"*
 * must have one code-owned answer rather than being re-derived at each call
 * site. `compilePolicy` already removes every member of this set under
 * `suggestions-only`, so adding one inherits that rule for free instead of
 * needing someone to remember it.
 *
 * Note carefully what it does NOT mean: `click-element` is not a landing kind,
 * and it can still press Send. Landing is about whose act put the effect into
 * the world, not about whether an effect is possible.
 */
export const LANDING_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>()

/**
 * The kinds that drive the person's real browser.
 *
 * Grouped because "does this need a live page under it" recurs — in the gate,
 * in what a contract should grant by default, and in what the agreement panel
 * has to describe. A contract drafted for document work has no business
 * carrying these, and a caller building a default allowlist should subtract
 * this set rather than hand-maintain a second list that can drift.
 */
export const BROWSER_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'observe-page',
  'navigate',
  'click-element',
  'type-text',
  'press-key',
  'capture-screen',
])

/**
 * What a DOCUMENT contract grants: everything that is not browser-driving.
 *
 * Exists because the drafting handoff previously granted `[...ACTION_KINDS]` —
 * "all of them" — which was correct while the enum held three document
 * capabilities and became an over-grant the moment it held nine. A person
 * drafting a proposal would have been shown *"Click something on the page"* on
 * their agreement screen and would have granted it.
 *
 * Derived by subtraction rather than listed, so a new document capability is
 * granted by default and a new browser capability is not. That is the right
 * default in both directions: the browser set is the one where a mistake costs
 * something out in the world.
 */
export const DOCUMENT_ACTION_KINDS: readonly ActionKind[] = ACTION_KINDS.filter(
  (kind) => !BROWSER_ACTION_KINDS.has(kind),
)

/**
 * Kinds whose target is an element in a specific accessibility-tree snapshot.
 *
 * An element ref is only meaningful against the tree it came from: the page can
 * re-render between two turns and hand the same ref to a different control. So
 * the gate refuses these unless the snapshot the worker is reasoning about is
 * still the one the run last observed — `stale_snapshot`. This is not a
 * performance concern; it is the difference between clicking *Cancel order* and
 * clicking whatever moved into its place.
 */
export const SNAPSHOT_DEPENDENT_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'click-element',
  'type-text',
  'press-key',
])

/**
 * Blast radius.
 *
 * An all-red diff is a POLICY failure, not a rendering one — no differ rescues
 * a wholesale rewrite, so re-entry quality dies regardless of the diff UI.
 *
 * ── Why `maxSectionsPerRun` was refused, and why its refusal expired ─────
 *
 * ADR-0004 declined to add a blast-radius field, and the reason was good: the
 * plan already bounded it. One PlanStep was one action, each drafting step
 * targeted a distinct section, so capping plan length capped sections touched.
 * A second field would have been *a second mechanism for one truth*.
 *
 * **That reason has expired along with the mechanism it rested on.** A worker
 * driving a browser does not execute a plan; it observes, acts, observes again,
 * and decides what to do next from what it just saw. There is no list of steps
 * to count, so plan length bounds nothing on that path — and a bound that only
 * applies to the path we are moving away from is not a bound.
 *
 * `MAX_PLAN_STEPS` stays, because the plan-driven drafting path still exists
 * and is still bounded by it. But it is now one bound on one path rather than
 * the bound, which is why the two caps below are policy fields the gate reads
 * rather than a constant only the planner respects.
 */
export const MAX_PLAN_STEPS = 12

/**
 * Total gate-authorized actions in one run, of every kind.
 *
 * This is the "how long a leash" number. Forty is enough to read a page, click
 * through two or three screens, type into a form and check the result several
 * times over; it is not enough to grind through a site all afternoon. It bounds
 * a worker that is lost as well as one that is misbehaving, and the two look
 * identical from here.
 */
export const MAX_ACTIONS_PER_RUN = 40

/**
 * Of those, how many may CHANGE something.
 *
 * The number people actually care about is not "how many pages did it load", it
 * is "how many times did it alter my stuff". Eight is deliberately small.
 * A run that needs a ninth change is a run that should be reporting back.
 *
 * ── It is smaller than `MAX_PLAN_STEPS`, and that is a real collision ────
 *
 * `draft-section` is a mutating kind, so once a run path supplies real counts a
 * twelve-step plan with nine or more drafting steps will have its last steps
 * refused with `step_out_of_scope` — and under `current-step-only`, where this
 * compiles to `1`, a plan-driven run could draft exactly one section.
 *
 * That is a behaviour change and not an oversight. Under the old reading the
 * Progress dial never bound the drafting path at all: the worker loop passes
 * `stepOrdinal` equal to `currentStepOrdinal` on every proposal, so the ordinal
 * comparison always matched and *Current step only* meant nothing there. The
 * dial now binds. Whoever wires the counts should expect drafting runs to get
 * shorter under the cautious setting, decide whether that is the product they
 * want, and change the NUMBER rather than reintroducing a dial that does not.
 */
export const MAX_MUTATING_ACTIONS_PER_RUN = 8

/**
 * What the contract permits. Deliberately contains NO prose.
 *
 * `baseVersionId` is **optional**, and its absence is load-bearing. A browser
 * handoff has no document under it — there is nothing to pin — and the honest
 * encoding of that is a missing pin rather than a sentinel string. The gate
 * refuses `read-document` and `draft-section` outright when nothing is pinned
 * (`no_document_pinned`), so the document capability is present **iff** a base
 * is pinned. Deny-by-default, expressed in a field that already existed, with
 * no new mechanism to keep in sync.
 */
export interface ContractScope {
  readonly approvedSourceIds: readonly string[]
  readonly allowedActionKinds: readonly ActionKind[]
  readonly baseVersionId?: string | undefined
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
  /** Total actions of any kind. See MAX_ACTIONS_PER_RUN. */
  readonly maxActions: number
  /** Of those, how many may change something. The Progress dial moves this. */
  readonly maxMutatingActions: number
  /**
   * Whether a DocumentVersion is pinned at all. A boolean rather than the id,
   * deliberately: the gate needs to know a base EXISTS, and putting the id on a
   * permission object invites someone to resolve a version off it — which would
   * make the compiled policy a lookup table as well as a rule set, and the two
   * drift in different directions.
   */
  readonly documentBasePinned: boolean
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

    // ...and every landing kind, for the same reason rather than a related one:
    // "research only, don't write" cannot coherently permit a capability whose
    // effects leave Propositum without a second human act. The set is empty
    // today, so this loop removes nothing — it exists so that adding a landing
    // kind inherits the rule instead of requiring someone to notice.
    for (const kind of LANDING_ACTION_KINDS) allowed.delete(kind)

    // ── What `suggestions-only` does NOT remove, and why it is arguable ──
    //
    // `click-element`, `type-text` and `press-key` survive. A reviewer called
    // this a hole and the objection is fair: a person who picks the
    // safest-looking option can still get a worker that types into forms.
    //
    // The case for keeping them: clicking is how you READ a site. Pagination,
    // an expander, a filter, a "show full text" link — a research-only run that
    // cannot click is a research-only run that can see the first page of
    // everything and the second page of nothing. Removing them would not make
    // the dial safer so much as make it useless on a browser handoff, and a
    // dial people turn off is worth less than a dial that binds a little less
    // than they hoped.
    //
    // What stands between "research only" and an order being placed is
    // therefore the confirmation pause, NOT this line — and a pause is weaker
    // than a removal. If the pause turns out not to hold, this is the first
    // place to change, and the change is one `delete` per kind.
  }

  return {
    sourceAllowlist: new Set(scope.approvedSourceIds),
    actionKindAllowlist: allowed,
    stepScope: controls.progress,
    offPlanActions: controls.initiative === 'use-judgment',
    haltOnWorkerReportedUncertainty: controls.interruption === 'stop-when-uncertain',
    maxPlanSteps: MAX_PLAN_STEPS,
    maxActions: MAX_ACTIONS_PER_RUN,

    // ── The Progress dial, redefined ─────────────────────────────────────
    //
    // Progress used to mean "may it go past the plan step in flight". A worker
    // that observes and decides has no plan steps, so on that path the dial
    // would have compiled to nothing — which is the failure mode CONTEXT.md
    // names for every control: a dial that becomes prompt wording is a dial
    // that lies.
    //
    // So a STEP IS THE INTERVAL BETWEEN TWO MUTATING ACTIONS. `current-step-only`
    // becomes "make at most one change out there, then come back to me". That
    // is enforceable by counting durable rows, it reads honestly to a person,
    // and it keeps the dial a real permission.
    //
    // The alternative — letting the worker declare "this is still the same
    // step" — was never available. A model-declared step boundary is a model
    // GRANTING itself depth, and granting is the one thing a model may never
    // do. Declining is always safe; granting never is.
    maxMutatingActions:
      controls.progress === 'current-step-only' ? 1 : MAX_MUTATING_ACTIONS_PER_RUN,

    // Empty string counts as unpinned. An id that is present but blank is not a
    // pin, and treating it as one would let a caller acquire the document
    // capability by forgetting to fill a field.
    documentBasePinned: scope.baseVersionId !== undefined && scope.baseVersionId.length > 0,

    timeLimitMinutes: controls.timeLimitMinutes,
  }
}
