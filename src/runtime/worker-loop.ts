/**
 * The worker loop.
 *
 *   claim → rebuild history from the ledger → repeat:
 *     should I stop?  → finish
 *     one action, or a question, or done
 *     authorize (pure)
 *     refused? → record the intent, count it, carry on
 *     record the intent (committed BEFORE the effect)
 *     perform — and the tool hands back THE NEW PAGE
 *     record the outcome, advance to the snapshot it returned
 *
 * ── What changed: the plan stopped authorizing ───────────────────────────
 *
 * This loop used to be a `for` over `PlanStep`s. One step, one turn, one action,
 * and when the list ran out the run was over. That was coherent while a step was
 * a row the gate could compare against — and it is incoherent for an agent that
 * looks at a page and then decides, because *the list was written before it
 * looked*. ADR-0010 §6 demotes the plan from authorizing to REPORTING: the steps
 * are still written down, still rendered in the shift report, and cited by
 * nothing.
 *
 * Two things ADR-0004 leaned on had to be replaced rather than reassured away:
 *
 *   **Blast radius.** `MAX_PLAN_STEPS = 12` bounded it on the reasoning that one
 *   step was one action. With no authorizing plan that bound evaporates, so it
 *   is replaced by two counters read straight off durable rows —
 *   `MAX_ACTIONS_PER_RUN` so a loop ends, and `MAX_MUTATING_ACTIONS_PER_RUN`
 *   because forty page reads and forty changes out in the world are different
 *   categories of event. The second is the one people care about.
 *
 *   **The Progress dial.** *A step is now the interval between two mutating
 *   actions*, so `current-step-only` compiles to `maxMutatingActions = 1` —
 *   "make at most one change out there, then come back to me". That is a
 *   set-membership test over a counter the ledger already supports, which is
 *   what CONTEXT.md requires of a dial: name the deterministic check or it is
 *   theatre.
 *
 * **The Initiative dial is what still ends a plan-shaped run.** Inside the plan
 * the loop supplies a code-owned `stepOrdinal`; past the end of it there is no
 * ordinal, so `follow-closely` refuses to continue and `use-judgment` carries
 * on. That is the honest reading of *follow the plan closely* when there is no
 * plan left to follow, and it is why a drafting run behaves exactly as it did
 * before while a browser run keeps going. The ordinal is never model-proposed:
 * it is this loop's own counter, so a model naming a step can only match it or
 * be refused, never widen it.
 *
 * ── Every action is committed before it happens ──────────────────────────
 *
 * `ActionIntent` is written and committed BEFORE any effect, `ActionOutcome`
 * after. A run that dies mid-action still shows what it was attempting, which
 * is exactly when the audit story matters.
 *
 * That ordering is also why a halt lands at the next action boundary and never
 * mid-action: abandoning an authorised action in flight leaves an intent with
 * no outcome, indistinguishable from a crash, and the person is told `unknown`
 * when we know exactly what happened. What is new is that the `unknown` no
 * longer has to be permanent — `recoverOrphanedIntents` writes the recovery
 * outcome before a continuation acts, so the gap becomes a recorded fact.
 *
 * ── Refusals are recorded, not thrown ────────────────────────────────────
 *
 * A gate refusal is a fact about the run, not an error in it. It becomes an
 * `ActionIntent` with `authorized = false` and a deterministic rule id, and the
 * loop continues — refusals are evidence about H3, and three in a row is itself
 * a stop condition.
 *
 * **Except for the ones in `PAUSING_RULES`.** `confirmation_required` is the
 * gate working exactly as designed: the worker proposed something irreversible
 * and we stopped to ask. Counting it toward `refusal-loop` would make a run that
 * correctly asked permission three times look like one going in circles, halt it
 * at the precise moment the person was about to answer, and report the halt as
 * *"I kept needing things the agreement does not allow"* — which is both wrong
 * and discouraging about a behaviour we want more of.
 *
 * ── The model has three terminals, and only one is a proposal ────────────
 *
 * An action goes to the gate. A `decisionNeeded` and a `done` do not: both are
 * the model DECLINING to continue, which ADR-0007 says is always safe because
 * declining withholds. `done` in particular is a stop and not a grant — it can
 * end a run early and can never extend one.
 *
 * ── No clock ─────────────────────────────────────────────────────────────
 *
 * `now()` is injected. A 40-minute fixture replays in milliseconds, and a
 * budget decision never depends on when the test ran.
 */

import { ACTION_KINDS, compilePolicy, MUTATING_ACTION_KINDS } from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls, ContractScope } from '../domain/handoff/policy'
import { authorize } from '../policy/gate'
import type { AuthorizedAction, RunContext, ToolProposal } from '../policy/gate'
import {
  captureScreen,
  clickElement,
  draftSection,
  navigateTo,
  observePage,
  pressKey,
  readApprovedSource,
  readDocument,
  typeText,
} from '../policy/tools'
import type { BrowserDeps, NavigateDeps, ReadDocumentDeps, ReadSourceDeps } from '../policy/tools'
import {
  confirmationIdFor,
  descriptorFor,
  historyForContract,
  recoverOrphanedIntents,
} from './history'
import type { ConfirmedAction, HistoryReader, HistoryTurn } from './history'
import { BrowserControlError, UNVERIFIED_FAILURES } from './browser-control'
import type { PageObservation, ScreenCapture } from './browser-control'
import {
  PAUSING_RULES,
  STOP_RULES,
  effectOfRaisedQuestion,
  shouldStop,
} from '../domain/execution/stop-conditions'
import type { StopRuleId } from '../domain/execution/stop-conditions'
import { confirmationQuestion } from '../domain/execution/confirmation-question'
import type { ElementEvidence } from '../domain/execution/reversibility'
import { SNAPSHOT_BUDGET_CHARS, datamark } from '../model/untrusted'
import type { Datamarked } from '../model/untrusted'
import type { BoundaryName, FailureKind, ModelClient } from '../model/client'
import { planBoundary } from '../model/boundaries/plan'
import { workerActionBoundary } from '../model/boundaries/worker-action'
import type { PageForModel } from '../model/boundaries/worker-action'
import type { ShiftOutcomeKind } from '../domain/outcome/shift-outcome'

/**
 * What one authorized action yielded, before deterministic code decides what it
 * IS.
 *
 * ── It mirrors `ToolProposal`, and for the same reason ───────────────────
 *
 * A `ToolProposal` is what a model asks to do; it carries no authority, and the
 * gate turns it into an `AuthorizedAction` or refuses it. This is the other end
 * of the same move: it is what a tool handed back, it carries no authority
 * either, and `src/server/outcomes/` turns it into a `ShiftOutcome` or drops it.
 * Neither shape is persisted, and neither may name its own kind — the worker
 * returns a SHAPE and code reads the shape.
 *
 * That is what stops the worker knowing what it is working on. `section-prose`
 * does not say "Markdown heading"; `item` does not say "row of a table";
 * `landed` does not say "form submitted on a website". Whether a `section-prose`
 * becomes a `Changeset` against an immutable base, or is dropped because this
 * Shift pinned no document, is a decision made in the app process from the
 * ratified contract — where the worker cannot reach it.
 *
 * ── The name it shares with a table that does not exist yet ──────────────
 *
 * CONTEXT.md reserves `OutcomeProposal` for a TABLE: one independently decidable
 * unit of a held outcome, the non-document sibling of `ProposedChange`. That
 * table is not in `prisma/schema.prisma` — wave 1 landed `ShiftOutcome` and
 * `OutcomeVerdict` and stopped there, so `OutcomeVerdict` currently addresses a
 * whole outcome rather than a unit of one.
 *
 * The name is used here because the two are the same idea seen at two moments:
 * this is the unit before it is durable, that is the unit once it is. When the
 * table lands, the row is written FROM one of these, and the shared name will be
 * accurate rather than confusing. Said out loud because a reader who knows
 * CONTEXT.md will otherwise assume one of the two is a mistake.
 */
export type OutcomeProposal =
  /** Prose for one named place in a structured document. */
  | { kind: 'section-prose'; intentId: string; section: string; prose: string }
  /** One thing found and kept, decidable on its own — a rate, a candidate, a
   *  quotation. Fields rather than prose, because a collection is a table. */
  | { kind: 'item'; intentId: string; label: string; fields: Record<string, string> }
  /** A written response to a question, resting on what this run read. */
  | { kind: 'written-answer'; intentId: string; text: string }
  /** Text addressed to somebody, written and NOT sent. */
  | { kind: 'composed-text'; intentId: string; forWhat: string; text: string }
  /** Something that happened out there. The only shape that can be `landed`,
   *  and even then only if the action behind it carried a landing kind. */
  | { kind: 'landed'; intentId: string; what: string; where: string }

export interface RunLedger {
  /** Committed BEFORE any effect. Returns the intent id. */
  recordIntent(input: {
    /**
     * The row's id, minted by the CALLER rather than by the database.
     *
     * ── Why this moved out of the database, which is not a small thing ───
     *
     * `authorize()` stamps the intent id onto the `AuthorizedAction` it returns,
     * and every tool reads it — most visibly `src/policy/tools.ts`, where it
     * becomes the browser channel's IDEMPOTENCY KEY. One authorised intent, at
     * most one dispatch, so a retry after a transport error cannot click twice.
     *
     * That only works if the id is real. The loop used to authorize with the
     * literal string `'pending'`, because the row could not be written until the
     * verdict was known, and then commit the row afterwards and let the database
     * pick an id. Nothing noticed, because the only readers were error messages.
     * The moment a browser action existed, **every dispatch in every run carried
     * the same key**, and a channel deduplicating on it would have collapsed a
     * whole run's instructions into one.
     *
     * Minting it here fixes the ordering rather than papering over it: the id
     * exists before the decision, the decision names it, and the row is
     * committed under that id before any effect. `AuthorizedAction.intentId`
     * therefore names a row that is on disk by the time a tool can run, which is
     * what its docstring always claimed.
     */
    id: string
    runId: string
    stepId: string | null
    seq: number
    kind: string
    reason: string
    params: Record<string, unknown>
    authorized: boolean
    refusedRule?: string | undefined
  }): Promise<string>
  recordOutcome(input: {
    intentId: string
    result: 'succeeded' | 'failed'
    scopeVerdict: 'within_scope' | 'out_of_scope' | 'unverified'
    detail?: string | undefined
    draftText?: string | undefined
    /**
     * Who saw this. Absent means the authorising run saw it itself, which is
     * the only thing the loop below ever writes.
     *
     * It exists on this interface so `recoverOrphanedIntents` can write
     * `'recovery'` through the same door rather than reaching for a second
     * writer — one outcome table, one way in.
     */
    observedBy?: string | undefined
  }): Promise<void>
  recordSteps(
    runId: string,
    steps: ReadonlyArray<{ ordinal: number; intent: string }>,
  ): Promise<string[]>
  advanceProgress(runId: string, step: number): Promise<void>
}

export interface WorkerDeps {
  readonly model: ModelClient
  readonly ledger: RunLedger
  readonly readSource: ReadSourceDeps
  readonly readDoc: ReadDocumentDeps
  /**
   * The channel to the person's real Chrome, when this run has one.
   *
   * OPTIONAL, and its absence is not a gap. A drafting contract grants only
   * `DOCUMENT_ACTION_KINDS`, so the gate refuses every browser kind with
   * `action_kind_not_allowed` long before a tool is reached, and a run that
   * cannot propose a browser action has no use for a channel. Wiring one
   * unconditionally would mean every drafting run held a handle to a debugger
   * attachment it never uses, which is a capability granted by tidiness.
   *
   * If a browser kind is somehow authorized without one, `perform` records a
   * failed outcome saying so rather than throwing past the ledger.
   */
  readonly browser?: BrowserDeps | undefined
  /**
   * What the page says about one element in the snapshot the run is looking at.
   *
   * The gate needs this to classify reversibility, and the gate never queries —
   * it is handed facts. The extraction that produces these lives with whoever
   * owns the snapshot map, so it arrives as a function rather than as a field on
   * `PageObservation`: the observation is what the BROWSER reported, and every
   * field of `ElementEvidence` is what the PAGE claims about itself. Folding the
   * second into the first would put attested and page-authored values in one
   * structure with no marker between them, which is the confusion the whole
   * `attested` distinction exists to prevent.
   *
   * **Absent is the safe state, and it is safe by construction rather than by
   * care.** With no lookup the gate sees `null`, `classifyReversibility`
   * escalates, and every `click-element`, `type-text` and `press-key` is refused
   * `confirmation_required` until a person answers. Wiring this up therefore
   * makes the pause QUIETER, never weaker — there is no input to it that can
   * turn `requires-confirmation` back into `ordinary`.
   */
  readonly elementEvidence?:
    ((input: { snapshotId: string; ref: string }) => ElementEvidence | null) | undefined
  /**
   * Where the run reads what has already happened under this contract.
   *
   * Optional so that a caller with nothing to resume — and every existing test —
   * gets an empty history rather than a required dependency it cannot supply.
   * Absent means "this contract has done nothing", which is true of a first run
   * and is the safe direction anyway: the caps start from zero either way, and
   * supplying real counts can only make them bind sooner.
   */
  readonly history?: HistoryReader | undefined
  /** Injected. Never Date.now() inside the loop. */
  readonly now: () => number
  /**
   * Where an `ActionIntent` id comes from.
   *
   * Injected for the same reason `now` is: it is the loop's only other source of
   * a value it did not compute, and a fixture that can fix it can assert on the
   * exact key a dispatch carried. Unlike `now`, it is not a decision — nothing
   * branches on an id — so the default below is a convenience rather than a
   * policy hiding in a default argument.
   */
  readonly newIntentId?: (() => string) | undefined
  readonly renewLease?: ((runId: string) => Promise<void>) | undefined
}

export interface WorkerJob {
  readonly runId: string
  /**
   * The contract this run works under. The unit of history, of the two caps, and
   * of a confirmation pause — see `./history.ts` for why it is the contract and
   * not the run.
   */
  readonly contractId: string
  readonly objective: string
  readonly definitionOfDone: string
  readonly guidance: readonly string[]
  readonly scope: ContractScope
  readonly controls: AutonomyControls
  /**
   * One-line facts about what this Shift is working on, already flattened.
   *
   * `"Document: Q3 proposal"`, `"Sections: Overview, Pricing"`, `"Nothing is
   * pinned to write into"` — sentences, assembled by the app process from the
   * ratified contract and handed over as text.
   *
   * This replaced `documentTitle` and `sections`, and the replacement is the
   * point of the field rather than a tidying of it. Two named document fields on
   * the job meant the worker could always tell it was working on a document,
   * because the shape of its own input said so — and a runtime that knows it is
   * drafting Markdown is a runtime that will grow a second branch the day it is
   * asked to fill in a spreadsheet or read a browser tab. A flat list of facts
   * cannot be branched on: there is no `job.sections` to check, and inventing
   * one means inventing a parser for a string the app process wrote.
   *
   * It is deliberately NOT structured. Structure here would be re-derivable —
   * "if it has a `sections` key it is a document" — which is the same knowledge
   * arriving through a longer path.
   */
  readonly context: readonly string[]
  /**
   * The shapes of result this contract is after.
   *
   * Derived by deterministic code from what the person ratified — never asked of
   * a model, and never proposed by one. `WorkOffer.expects` holds these too, and
   * ADR-0009 is explicit about why that is safe when proposing an `ActionKind`
   * is not: a statement about the SHAPE OF THE RESULT grants nothing. There is
   * no capability behind `answer` that `document-changes` lacks.
   *
   * The worker sees it so its plan aims at the right thing. It cannot widen it,
   * and producing something outside it is not refused — it is dropped when the
   * outcome writers cannot realise it, and counted.
   */
  readonly expects: readonly ShiftOutcomeKind[]
  /**
   * The `Document` the shift works on, or `undefined` when there is not one.
   *
   * A real `Document.id`, and deliberately not `scope.baseVersionId` — that is a
   * `DocumentVersion` id, and passing it here as though it named a document is
   * the mistake this field exists to make impossible to repeat. It rides on the
   * job rather than on `ContractScope` because it grants nothing: the version a
   * tool may read is still fixed by `baseVersionId` alone, and adding a second
   * identifier to the scope would invite the idea that this one also authorises
   * something.
   *
   * `undefined` is a real state — a contract whose base version has gone — and
   * the gate is what handles it, refusing `read-document` and `draft-section`
   * with `document_missing` rather than letting a run work on nothing.
   */
  readonly documentId: string | undefined
  readonly sourceLabels: ReadonlyArray<{ id: string; label: string }>
  /** contract.acceptedAt + timeLimitMinutes. Derived, never stored, so a
   *  crash-restart loop cannot silently reset the budget. */
  readonly deadlineEpochMs: number
}

export interface DecisionRaised {
  readonly question: string
  readonly whyItMatters: string
  readonly atStep: number
}

/**
 * The run stopped because it needs a person to say yes to one thing.
 *
 * ── Why the loop reports this instead of writing it ──────────────────────
 *
 * A `ConfirmationRequest` is a row, and rows on the run's terminal transition
 * belong to `src/server/execute-run.ts` — the loop returns a `WorkerResult` and
 * that file turns it into rows. More than tidiness: parking the run is one
 * transaction with `runs.complete(…, 'awaiting-confirmation', …)`, which clears
 * the control token, and a loop that could write the request without ending the
 * run could leave a question outstanding against a run still holding a
 * credential and driving a browser.
 *
 * ── Why it is a single value and not a list ──────────────────────────────
 *
 * **One pause per run**, and the reason is arithmetic rather than taste.
 * `creditedDeadlineFor` credits a shift back the time it spent waiting, by
 * summing `(requestedAt, decidedAt)` pairs. Two questions asked a minute apart
 * and answered together are two pairs covering almost the same interval, so the
 * wait would be credited twice — and the person's time limit, which they set,
 * would quietly stop meaning what it says. Serial pauses are what make the sum
 * correct, and one per run is what makes them serial.
 *
 * It also matches ADR-0010 §5, which halts the run at the refusal rather than
 * carrying on: a run that has been told it needs permission should stop
 * touching the person's signed-in session, not keep operating it elsewhere.
 */
export interface ConfirmationNeeded {
  /** The REFUSED `ActionIntent`. Committed before this was returned, so the
   *  row `ConfirmationRequest.intentId` points at is already on disk. */
  readonly intentId: string
  readonly kind: ActionKind
  /** Code-generated from attested facts. Never model prose — see
   *  `../domain/execution/confirmation-question`. */
  readonly question: string
}

export interface WorkerResult {
  readonly status: 'succeeded' | 'failed'
  readonly stoppedBy: readonly StopRuleId[]
  readonly terminalReason: string | undefined
  readonly decisions: readonly DecisionRaised[]
  /** What the run yielded, in the order it yielded it. Shapes, not outcomes —
   *  `src/server/outcomes/` decides what each one IS. */
  readonly produced: readonly OutcomeProposal[]
  readonly refusals: number
  readonly actionsTaken: number
  /**
   * What the model said when it declared itself finished, if it did.
   *
   * `undefined` when the run ended any other way — a stop rule, a cap, the end
   * of a plan under `follow-closely`. It is model prose about model work, so it
   * is reported and never acted on: nothing downstream branches on it, and it
   * cannot become an outcome. It exists so that a run which finished cleanly can
   * say what it did in its own words rather than leaving the report blank.
   */
  readonly summary: string | undefined
  /** Authorized intents this run found already dangling and recorded a recovery
   *  outcome for. Reported so a caller can see the sweep did something, rather
   *  than having to diff the ledger to find out. */
  readonly recovered: number
  /**
   * Which boundary failed, and how, on a run that ended `failed`.
   *
   * Absent on every other ending. It exists because the alternative was what
   * shipped: `finish([], 'failed')` returned a run with an empty `stoppedBy`,
   * an undefined `terminalReason` and no other field, so a boundary failure
   * carried NO INFORMATION AT ALL. A `worker-action` call that threw inside the
   * SDK on every single attempt reached the caller as a run that did nothing,
   * and the caller could not tell it from a run that chose to do nothing.
   *
   * A diagnosis path, not a feature. Nothing branches on it — the loop has
   * already decided the run is over — and it is not a `terminalReason`, which
   * is a closed code-assigned set. It is the `BoundaryResult` the loop had in
   * its hand and used to throw away.
   */
  readonly boundaryFailure?:
    | {
        readonly boundary: BoundaryName
        readonly failure: FailureKind
        readonly detail: string
      }
    | undefined
  /**
   * The run stopped to ask, and this is what about. Absent on every other
   * ending.
   *
   * A caller that ignores it gets a run which recorded a refusal and told
   * nobody — which is what happened before this field existed, and is why
   * `confirmations.create` had no caller for the whole of wave 2.
   */
  readonly awaiting?: ConfirmationNeeded | undefined
}

export async function runWorker(job: WorkerJob, deps: WorkerDeps): Promise<WorkerResult> {
  const policy = compilePolicy(job.scope, job.controls)
  const mayDraft = policy.actionKindAllowlist.has('draft-section')

  const decisions: DecisionRaised[] = []
  const produced: OutcomeProposal[] = []
  const gathered: Array<{ label: string; content: Datamarked }> = []

  /* ── what this contract has already done ────────────────────────────── */

  /**
   * The rebuild, and then the recovery, in that order and before anything acts.
   *
   * The order is the whole point. A continuation that acted first would be
   * writing new rows on top of an intent whose fate was still unrecorded, and
   * the two would then be untangleable: an `ActionIntent` with no outcome
   * followed by more work looks exactly like an action still in flight. Writing
   * the recovery outcome first draws a line — everything before it is settled,
   * however unsatisfyingly, and everything after it belongs to this run.
   */
  const rebuilt = deps.history
    ? await historyForContract(job.contractId, {
        ledger: deps.history,
        mutatingKinds: MUTATING_ACTION_KINDS,
        // This run's own intents are never orphans. None exist yet at this
        // point, so today it changes nothing — it is what makes the rebuild
        // safe to call from a live process at all, which is what "one code
        // path, not three" requires.
        excludeRunId: job.runId,
      })
    : {
        turns: [] as HistoryTurn[],
        actionsTaken: 0,
        mutatingActionsTaken: 0,
        orphanedIntentIds: [],
        confirmations: [] as ConfirmedAction[],
        confirmedRequestIds: new Set<string>(),
      }

  const recovered = await recoverOrphanedIntents(rebuilt.orphanedIntentIds, deps.ledger)

  const history: HistoryTurn[] = [...rebuilt.turns]

  let seq = 0
  let refusals = 0
  let actionsTaken = rebuilt.actionsTaken
  let mutatingActionsTaken = rebuilt.mutatingActionsTaken
  let consecutiveNoProgress = 0
  let consecutiveRefusals = 0
  let summary: string | undefined

  /**
   * The page the run last saw, and the snapshot the gate will accept a ref
   * against.
   *
   * There is exactly one writer for each — the `perform` result below — and that
   * is what makes "the model only ever acts on what it just saw" hold. See the
   * header of `src/policy/tools.ts`: because every acting tool returns the page
   * it produced, a snapshot id has no other source, so a stale one cannot be
   * obtained rather than merely being refused.
   */
  let page: PageObservation | null = null
  let screenshot: ScreenCapture | null = null

  /**
   * The hands are gone, and every further proposal is into a dead channel.
   *
   * Set once and never cleared, because losing the tab is not a hiccup: the
   * attachment ended, and only a person creating a new one brings it back.
   * `evaluateStructuralStops` turns it into `control-lost`, whose sentence is
   * *"I lost the tab I was working in."*
   *
   * Without it the run kept going — authorising, dispatching, failing, recording
   * `unverified` — until three consecutive failures tripped `no-progress` and
   * the person was told it had been going in circles. That is a true sentence
   * about the wrong thing, and it blames the machine for something the person
   * very often did on purpose by closing the tab.
   *
   * Only `control-lost` sets it. `not-delivered` means the instruction never
   * left the app and `not-reported` means nobody answered; neither says the
   * attachment is over, and quitting on either would abandon a run over a
   * recoverable hiccup.
   */
  let controlLost = false

  const progress = () => ({
    nowEpochMs: deps.now(),
    deadlineEpochMs: job.deadlineEpochMs,
    consecutiveNoProgress,
    consecutiveRefusals,
    actionsTaken,
    maxActions: policy.maxActions,
    controlLost,
  })

  const finish = (rules: readonly StopRuleId[], status: 'succeeded' | 'failed'): WorkerResult => ({
    status,
    stoppedBy: rules,
    /**
     * A failed run says `boundary-failure`, which is what the glossary has
     * always said it says.
     *
     * This used to be `undefined` whenever no stop rule fired, and for
     * `status: 'failed'` that is the code contradicting CONTEXT.md's `AgentRun`
     * entry — which partitions `terminalReason` strictly by status and gives
     * `failed` exactly one reason. A run row written with `failed` and no
     * reason is a row that cannot say what happened to it, and the shift report
     * renders it through the same default branch either way. `succeeded` is
     * untouched: an ending with no rule is a plan running out or a model
     * declaring itself done, and neither is a terminal reason.
     */
    terminalReason: rules.length
      ? STOP_RULES[rules[0]!].terminalReason
      : status === 'failed'
        ? 'boundary-failure'
        : undefined,
    decisions,
    produced,
    refusals,
    actionsTaken,
    summary,
    recovered,
  })

  /**
   * The other half of the same repair: WHICH boundary, and what it said.
   *
   * `finish` can name the category. Only the call site has the `failure` and
   * the `detail`, and those are the two strings a person debugging a run
   * actually needs — the difference between "the model refused" and "every
   * request threw before it left the process" is invisible from
   * `boundary-failure` alone.
   */
  const failedAt = (
    boundary: BoundaryName,
    outcome: { failure: FailureKind; detail: string },
  ): WorkerResult => ({
    ...finish([], 'failed'),
    boundaryFailure: { boundary, failure: outcome.failure, detail: outcome.detail },
  })

  /**
   * The other ending: the run stopped to ask, and stopped for no other reason.
   *
   * Deliberately NOT a `StopRuleId`. A stop rule is a limit that happened TO the
   * run and renders under *"Where I stopped"*; this is the gate working exactly
   * as designed, and reporting it beside `budget-exhausted` would tell somebody
   * their shift ran into a wall when what it did was wait for them. `stoppedBy`
   * stays empty and `terminalReason` stays undefined — `awaiting-confirmation`
   * takes none, because the question is the explanation.
   */
  const askFirst = (awaiting: ConfirmationNeeded): WorkerResult => ({
    ...finish([], 'succeeded'),
    awaiting,
  })

  // Budget can already be gone before we plan — check before spending a call.
  const preflight = shouldStop(progress(), job.controls.interruption, false)
  if (preflight.halt) return finish(preflight.rules, 'succeeded')

  /* ── the plan, which reports and does not authorize ─────────────────── */

  const planned = await deps.model.run(planBoundary, {
    objective: job.objective,
    definitionOfDone: job.definitionOfDone,
    context: job.context,
    expects: job.expects,
    availableSourceLabels: job.sourceLabels.map((s) => s.label),
    mayDraft,
  })

  if (!planned.ok) return failedAt(planBoundary.name, planned)

  const steps = planned.value.steps

  // The rows are still written, because the shift report renders them as what
  // the run said it intended. Nothing reads the ids back onto an intent any
  // more — see `stepIdFor` below.
  await deps.ledger.recordSteps(
    job.runId,
    steps.map((s, i) => ({ ordinal: i + 1, intent: s.intent })),
  )

  /* ── observe → act → observe, until something says stop ─────────────── */

  for (let turn = 0; ; turn += 1) {
    /**
     * Past the plan, and told not to leave it.
     *
     * Deterministic code reading the compiled policy, not a model declaring
     * itself finished: `offPlanActions` is the Initiative dial, and *follow the
     * plan closely* has an obvious meaning once the plan is exhausted. Checked
     * here rather than left to the gate so the run ends cleanly instead of
     * burning three model calls on `off_plan` refusals and then reporting
     * "I kept needing things the agreement does not allow" — which would be a
     * true sentence about a false situation.
     */
    if (turn >= steps.length && !policy.offPlanActions) return finish([], 'succeeded')

    /**
     * A hard bound on TURNS, not on authorized actions.
     *
     * `action-limit` below counts what the gate permitted, which is the number
     * people care about — and it is not a bound on the loop, because a refusal
     * increments nothing. That was survivable while every refusal also counted
     * toward `no-progress`; the moment a pause stopped counting toward either
     * loop rule, a run whose every proposal is refused `confirmation_required`
     * had NOTHING ending it but the deadline. Thirty minutes of model calls in
     * production, and a genuinely infinite loop under an injected clock.
     *
     * So the same number bounds both: forty gate evaluations, however they went.
     * `MAX_ACTIONS_PER_RUN` exists, in the ADR's own words, "so a loop ends",
     * and a loop that proposes forty things and is refused forty times has
     * looped. The counter the gate reads keeps its narrower meaning — authorized
     * actions, matching what `historyForContract` counts off rows — because two
     * definitions of one number is how a cap comes to bind differently in two
     * places.
     */
    if (turn >= policy.maxActions) return finish(['action-limit'], 'succeeded')

    const step = steps[turn]
    const ordinal = turn + 1

    await deps.ledger.advanceProgress(job.runId, Math.min(ordinal, Math.max(steps.length, 1)))
    await deps.renewLease?.(job.runId)

    // Halts land here — at a boundary, between actions, never inside one. This
    // is also where `action-limit` fires, because `progress()` now carries the
    // real count and the compiled cap.
    const stop = shouldStop(progress(), job.controls.interruption, false)
    if (stop.halt) return finish(stop.rules, 'succeeded')

    const proposed = await deps.model.run(workerActionBoundary, {
      objective: job.objective,
      definitionOfDone: job.definitionOfDone,
      guidance: job.guidance,
      ...(step === undefined
        ? {}
        : {
            currentStep: {
              ordinal,
              intent: step.intent,
              ...(step.targetSection === undefined ? {} : { targetSection: step.targetSection }),
            },
          }),
      allowedActionKinds: [...policy.actionKindAllowlist],
      availableSources: job.sourceLabels,
      history,
      gathered,
      page: pageForModel(page),
      ...(screenshot === null
        ? {}
        : { screenshot: { mediaType: screenshot.mediaType, base64: screenshot.base64 } }),
      mutatingActionsRemaining: Math.max(0, policy.maxMutatingActions - mutatingActionsTaken),
    })

    if (!proposed.ok) return failedAt(workerActionBoundary.name, proposed)
    const proposal = proposed.value

    /**
     * Done. A stop, never a grant — see the boundary header.
     *
     * Checked before `decisionNeeded` and before the gate, because a model that
     * says it has finished has proposed nothing for the gate to decide. Nothing
     * downstream trusts the claim: what the run produced is whatever it already
     * recorded, and this only ends the loop early.
     */
    if (proposal.done) {
      summary = proposal.done.summary
      return finish([], 'succeeded')
    }

    // A raised question is not an action and never reaches the gate. Whether it
    // also halts is the Interruption dial's business; that it is recorded is
    // not configurable.
    if (proposal.decisionNeeded) {
      decisions.push({ ...proposal.decisionNeeded, atStep: ordinal })

      if (effectOfRaisedQuestion(job.controls.interruption) === 'halt') {
        return finish(['decision-needed'], 'succeeded')
      }

      /**
       * A question counts as a turn that changed nothing — which it did.
       *
       * This is new, and it is here because the plan used to do the bounding by
       * accident. Under `stop-only-when-blocked` a raised question does not halt,
       * and the loop used to move on to the next plan step, so a model that
       * asked something every single turn ran out of steps. With no plan to run
       * out of, the same model asks questions until the DEADLINE — thirty
       * minutes of calls producing nothing, reported as a budget the person
       * gave it.
       *
       * `no-progress` already means "going in circles without changing
       * anything", and three questions in a row is exactly that. Counting it
       * here is the rule doing its job rather than a new bound: a question
       * followed by real work resets the counter, so the demo's centrepiece —
       * complete the draft AND raise one strategic decision — is untouched.
       */
      consecutiveNoProgress += 1

      history.push({
        kind: 'question',
        summary: proposal.decisionNeeded.question,
        outcome: 'raised',
      })

      const afterQuestion = shouldStop(progress(), job.controls.interruption, false)
      if (afterQuestion.halt) return finish(afterQuestion.rules, 'succeeded')
      continue
    }

    seq += 1

    /**
     * The model proposes none of this — every value here comes from the model's
     * own reply or from the ratified job, and `documentId` comes from the job.
     *
     * `snapshotId` is the exception that proves the rule, and it is worth being
     * precise about. The model DOES name one, and the gate compares it against
     * `currentSnapshotId` — the value this loop last received from a tool. So a
     * model naming any other snapshot is refused `stale_snapshot`, and a model
     * naming the right one has told us nothing we did not already know. It is
     * carried rather than substituted because substituting it would make the
     * check vacuous: a proposal that always agrees with us can never disagree,
     * and disagreement is the entire signal.
     *
     * `documentId` absent when the shift has no document. That is the case
     * `document_missing` was written for and, until wave 1, the case it never
     * saw: the key was unconditionally present, so the refusal could not fire.
     */
    const params: Record<string, unknown> = {
      ...(proposal.approvedSourceId ? { approvedSourceId: proposal.approvedSourceId } : {}),
      ...(proposal.targetSection ? { sectionPath: proposal.targetSection } : {}),
      ...(proposal.prose ? { text: proposal.prose } : {}),
      ...(proposal.ref ? { ref: proposal.ref } : {}),
      ...(proposal.snapshotId ? { snapshotId: proposal.snapshotId } : {}),
      ...(proposal.path ? { path: proposal.path } : {}),
      ...(proposal.inputText === undefined ? {} : { inputText: proposal.inputText }),
      ...(proposal.key ? { key: proposal.key } : {}),
      ...(job.documentId === undefined ? {} : { documentId: job.documentId }),
    }

    /**
     * The person's yes, attached by DETERMINISTIC CODE.
     *
     * Never proposed by the model, and the schema has no field for it — a model
     * that could name a `confirmationId` could confirm its own action, which is
     * a grant, and grants are the one thing a model may never make. This looks
     * the id up from `ConfirmationVerdict` rows and attaches it only when the
     * proposal matches the action the person was actually shown.
     *
     * Without this the whole pause is a dead end: `confirmRequest` records the
     * yes, the continuation run proposes the same action, and the gate refuses
     * it `confirmation_required` all over again — because `confirmedRequestIds`
     * is empty and no proposal ever carries an id. It fails safe, and it reads
     * to the person as *Propositum ignored my answer*, which costs more trust
     * than a refusal does.
     *
     * ── The element has to be the same element, not the same coordinate ─────
     *
     * A `ref` is meaningful only against the snapshot that issued it, and the
     * continuation is a new run looking at a new snapshot — so `ref` equality
     * alone let a page that re-rendered between the question and the answer move
     * a yes about *Track shipment* onto whatever took its place (issue #109).
     * The DESCRIPTOR is the identity: the element's own line of the tree. This
     * computes it from the tree in hand, and `confirmationIdFor` requires it to
     * equal the line the person was looking at.
     *
     * Sanitised through `datamark` first, because the stored side was: the
     * comparison is between what this app made of two trees, not between a page
     * and a row. Raw against sanitised would differ on a stripped zero-width
     * character and cost somebody the same question twice.
     *
     * Only computed when there IS something to match. On the overwhelming
     * majority of turns `confirmations` is empty, and datamarking a whole
     * snapshot to compare it against nothing is work with no question behind it.
     */
    const proposedDescriptor =
      rebuilt.confirmations.length === 0 || page === null
        ? null
        : descriptorFor(datamark(page.tree, { budget: 'snapshot' }).sanitized, params['ref'])

    const confirmationId = confirmationIdFor(
      proposal.kind,
      params,
      rebuilt.confirmations,
      proposedDescriptor,
    )
    if (confirmationId !== undefined) params.confirmationId = confirmationId

    const toolProposal: ToolProposal = {
      kind: proposal.kind,
      params: params as ToolProposal['params'],
      reason: proposal.reason,
      // Inside the plan, the ordinal this loop is counting. Past it, nothing —
      // which is what makes Initiative bite rather than the plan.
      ...(step === undefined ? {} : { stepOrdinal: ordinal }),
    }

    /**
     * The row's id, minted before the decision so the decision can name it.
     *
     * `authorize()` stamps this onto the `AuthorizedAction`, and the browser
     * tools use it as the channel's idempotency key. It used to be the literal
     * string `'pending'` — harmless while the only readers were error messages,
     * and a defect the moment one authorised intent had to map to at most one
     * dispatch. See `RunLedger.recordIntent`.
     */
    const intentId = (deps.newIntentId ?? defaultIntentId)()

    const verdict = authorize(
      policy,
      toolProposal,
      runContext(job, ordinal, steps.length, deps, {
        currentSnapshotId: page?.snapshotId ?? null,
        actionsTaken,
        mutatingActionsTaken,
        // Looked up against the snapshot the RUN last saw, never against the one
        // the proposal named. A proposal naming a stale snapshot is refused
        // before this matters, and looking evidence up by the model's own value
        // would let a proposal choose which element it is judged as.
        targetEvidence:
          page !== null && proposal.ref
            ? (deps.elementEvidence?.({ snapshotId: page.snapshotId, ref: proposal.ref }) ?? null)
            : null,
        // Read off durable `ConfirmationVerdict` rows before the call, because
        // the gate never queries. Membership is all it checks: an id absent from
        // this set has been never asked, declined, or expired, and the gate must
        // not distinguish them — **expiry never approves**.
        confirmedRequestIds: rebuilt.confirmedRequestIds,
      }),
      intentId,
    )

    /* ── refused ──────────────────────────────────────────────────────── */

    if (!verdict.authorized) {
      refusals += 1

      /**
       * A pause is exempt from BOTH loop counters, or it is exempt from neither.
       *
       * The first version of this exempted `confirmation_required` from
       * `consecutiveRefusals` only — and a review found that this changed
       * nothing observable, because the line above it incremented
       * `consecutiveNoProgress` on every refusal and `NO_PROGRESS_LIMIT` and
       * `REFUSAL_LOOP_LIMIT` are both 3. Three consecutive pauses still halted
       * the run on the same turn, now labelled *"I stopped because I was going
       * in circles without changing anything."*
       *
       * That label is worse than the one it replaced. A person reading it about
       * a run that asked their permission three times concludes the machine got
       * confused, when what it was doing was waiting for them. An exemption that
       * moves the halt from one rule to another has not exempted anything.
       */
      if (!PAUSING_RULES.has(verdict.rule)) {
        consecutiveRefusals += 1
        consecutiveNoProgress += 1
      }

      await deps.ledger.recordIntent({
        id: intentId,
        runId: job.runId,
        stepId: stepIdFor(),
        seq,
        kind: proposal.kind,
        reason: proposal.reason,
        params,
        authorized: false,
        refusedRule: verdict.rule,
      })

      history.push({
        kind: proposal.kind,
        summary: proposal.reason,
        outcome: `refused: ${verdict.rule}`,
      })

      /**
       * The pause, raised the moment the gate asks for it.
       *
       * ADR-0010 §5 in order: the refused intent is written (above), a question
       * is composed from attested facts, and the run halts. The person answers,
       * and a NEW `AgentRun` picks the work up carrying their yes. Nothing here
       * is rewritten and no row changes — at this moment the truth is *it asked,
       * and it was not yet allowed*, and that is what the ledger says.
       *
       * `page?.url` is what CHROME reported about the tab, not what the page
       * said about itself, and the worker's own `reason` is not consulted: a
       * model that could write the words asking for its own permission is a
       * model that can argue for itself.
       */
      const askedAbout = ACTION_KINDS.find((candidate) => candidate === proposal.kind)
      if (verdict.rule === 'confirmation_required' && askedAbout !== undefined) {
        return askFirst({
          intentId,
          kind: askedAbout,
          question: confirmationQuestion({
            kind: askedAbout,
            attestedUrl: page?.url ?? null,
            ...(typeof params.key === 'string' ? { key: params.key } : {}),
          }),
        })
      }

      const afterRefusal = shouldStop(progress(), job.controls.interruption, false)
      if (afterRefusal.halt) return finish(afterRefusal.rules, 'succeeded')
      continue
    }

    /* ── authorised: commit the intent, THEN act ──────────────────────── */

    consecutiveRefusals = 0

    await deps.ledger.recordIntent({
      id: intentId,
      runId: job.runId,
      stepId: stepIdFor(),
      seq,
      kind: proposal.kind,
      reason: proposal.reason,
      params,
      authorized: true,
    })

    /**
     * ONLY the effect is guarded, and the outcome write sits outside.
     *
     * The obvious shape puts both in the `try` — act, then record success;
     * record failure in the `catch`. It has a hole with teeth: if the SUCCESS
     * write is the thing that throws, the `catch` immediately attempts a second
     * write for the same intent, `ActionOutcome.intentId` is unique, and the
     * second insert fails too. The run then dies with an error about a duplicate
     * row, having successfully done the thing it was trying to record.
     *
     * `performed`, not `outcome`. The word is banned as a column name in this
     * codebase's vocabulary because it is ambiguous between two things a row
     * could hold, and a local called `outcome` sitting three lines above
     * `ledger.recordOutcome` is how the next person comes to write the column.
     */
    let performed: Performed | null = null
    let failed: string | null = null

    try {
      performed = await perform(verdict.action, intentId, deps, gathered)
    } catch (error) {
      // Includes every `BrowserControlError`. A channel failure is a recorded
      // fact about one action — the intent is already committed, so the ledger
      // says what was attempted — and never an exception that escapes the loop
      // and takes the run's record with it.
      failed = describeFailure(error)

      // ...and one of those failures is not about an action at all. `control-lost`
      // says the attachment ended — the person closed the tab, pressed Chrome's
      // own Cancel, or clicked the overlay chip — so there is nothing left to
      // act through and the next forty proposals would each fail the same way.
      // Recorded here rather than inferred from a run of failures, because
      // "three things failed" and "the hands are gone" are different facts and
      // only one of them has an honest sentence.
      if (error instanceof BrowserControlError && error.failure === 'control-lost') {
        controlLost = true
      }
    }

    // Attempted either way. An action that was authorised and dispatched counts
    // against both caps whether or not we can show it worked — a failure is not
    // a refund, and a run whose every action fails must still end.
    actionsTaken += 1
    if (MUTATING_ACTION_KINDS.has(verdict.action.kind)) mutatingActionsTaken += 1

    if (performed !== null) {
      consecutiveNoProgress = performed.changedSomething ? 0 : consecutiveNoProgress + 1

      if (performed.produced !== undefined) produced.push(performed.produced)

      // The one place `currentSnapshotId` moves. Everything the gate will accept
      // a ref against, for the rest of this run, was returned by a tool right
      // here.
      if (performed.observed !== undefined) {
        page = performed.observed
        // A new tree makes an old screenshot a picture of a page that is gone.
        screenshot = null
      }
      if (performed.captured !== undefined) screenshot = performed.captured

      await deps.ledger.recordOutcome({
        intentId,
        result: 'succeeded',
        scopeVerdict: 'within_scope',
        detail: performed.summary,
        ...(performed.draftText === undefined ? {} : { draftText: performed.draftText }),
      })
      history.push({ kind: proposal.kind, summary: proposal.reason, outcome: performed.summary })
    } else {
      consecutiveNoProgress += 1

      await deps.ledger.recordOutcome({
        intentId,
        result: 'failed',
        scopeVerdict: 'unverified',
        detail: failed ?? 'unknown',
      })
      history.push({ kind: proposal.kind, summary: proposal.reason, outcome: `failed: ${failed}` })
    }

    const afterAction = shouldStop(progress(), job.controls.interruption, false)
    if (afterAction.halt) return finish(afterAction.rules, 'succeeded')
  }
}

/**
 * What the ledger says about an action that did not come back cleanly.
 *
 * ── The distinction this exists to preserve ──────────────────────────────
 *
 * Every browser failure is recorded `unverified`, because CONTEXT.md is
 * explicit that the verdict covers both *nothing happened* and *we cannot
 * tell*. The verdict cannot separate them; the SENTENCE can, and must.
 *
 * `not-delivered` means the instruction expired while still queued — no
 * browser ever saw it, and the world is unchanged. `not-reported` means it WAS
 * delivered and never answered: it may have pressed the button, may have
 * pressed it twice, may have done nothing. Telling somebody "it did not go
 * through" about the second is the most damaging sentence this ledger could
 * write, because they will act on it — retry the order, re-send the message.
 * The opposite error only makes them check something that never happened.
 *
 * So the honest half of the pair says so in words, on the row the person
 * eventually reads.
 */
function describeFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)

  if (error instanceof BrowserControlError && UNVERIFIED_FAILURES.has(error.failure)) {
    return `${detail} — whether this landed is unknown.`
  }
  return detail
}

/**
 * The bound applied at the PROMPT door, which is not the published retention
 * constant and must not be confused with it.
 *
 * `SNAPSHOT_BUDGET_CHARS` is the retention promise, declared beside the one
 * writer that can enforce it — `appendEvidence` in
 * `src/persistence/ledger-writer.ts` — and it governs what Propositum KEEPS.
 * This governs what reaches a prompt, and it exists because those are not the
 * same journey: an observation comes back from `dispatch` as a plain string,
 * and whether it also passed through the ledger writer on its way is somebody
 * else's route's business. A tree that never went through that door must still
 * not arrive unbounded.
 *
 * The number matches the published one deliberately, so the loop never silently
 * shows the model LESS of a page than Propositum was willing to keep. If the two
 * ever diverge, the ledger's is the published promise and this one is a
 * defensive second fence — never the other way round, and never a knob to raise
 * when a page does not fit.
 *
 * So it is DERIVED from the published constant rather than repeating its value.
 * Written as a literal, the two agreed on the day this landed and nothing kept
 * them agreeing — and a prompt bound that silently fell behind the retention
 * bound would show the model less of a page than the ledger holds, which is the
 * one direction this fence is not allowed to fail in. Two homes for one number
 * is how that happens; there is one home, and this names it.
 */
const PROMPT_TREE_BUDGET_CHARS = SNAPSHOT_BUDGET_CHARS

/**
 * The budget by NAME, which is the only way `datamark` accepts one.
 *
 * `datamark` takes a name from a closed set rather than a number, precisely so a
 * caller cannot invent a third budget and quietly publish a promise nobody
 * wrote down. This loop is a caller like any other, so it names the snapshot
 * budget rather than handing over a figure of its own.
 */
const SNAPSHOT_BUDGET = 'snapshot' as const

/**
 * The default id source: the platform's UUID generator.
 *
 * `crypto` off `globalThis` rather than an import from `node:crypto`, so this
 * module stays runnable in both processes that use it without either of them
 * pulling in a Node built-in it did not ask for. Ids are opaque everywhere they
 * are read, so a UUID sitting beside the database's own `cuid()` values in the
 * same column costs nothing but a difference in appearance.
 */
function defaultIntentId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * `ActionIntent.stepId`, which is now null.
 *
 * A function rather than a literal `null` at two call sites, so the reason lives
 * in one place: **no `PlanStep` authorizes anything any more**, so an intent that
 * pointed at one would be asserting a relationship the gate did not use and the
 * report does not need. ADR-0010 §6 puts it plainly — the plan is what the run
 * said it intended, cited by nothing.
 *
 * The column stays nullable and the relation stays in the schema, because rows
 * already written under the old reading are still true about the run that wrote
 * them, and an append-only ledger does not get to tidy its own history.
 */
function stepIdFor(): string | null {
  return null
}

/**
 * The page, wrapped so it cannot reach a prompt unfenced.
 *
 * `title` and `tree` are page-authored — on a hostile page every accessible name
 * in that tree is attacker-controlled — so both go through `datamark`, which is
 * the only construction site for the brand the boundary requires. A caller who
 * forgot would not compile.
 *
 * The budget is `PROMPT_TREE_BUDGET_CHARS` and NOT `EXCERPT_BUDGET_CHARS`, whose
 * 2,000 characters would cut most real pages off before their primary controls
 * and make the agent conclude that half the page does not exist.
 */
function pageForModel(observed: PageObservation | null): PageForModel | null {
  if (observed === null) return null

  const tree = datamark(observed.tree, { budget: SNAPSHOT_BUDGET })

  return {
    snapshotId: observed.snapshotId,
    url: observed.url,
    title: datamark(observed.title, { budget: SNAPSHOT_BUDGET }),
    tree,
    // Either the browser cut it short, or our own budget did. Both mean the same
    // thing to a model deciding whether a missing button is really missing, and
    // reporting only the first would let our own truncation masquerade as a
    // complete page.
    truncated: observed.truncated || tree.removed.includes('truncated-to-snapshot-budget'),
  }
}

function runContext(
  job: WorkerJob,
  ordinal: number,
  planLength: number,
  deps: WorkerDeps,
  ledgerFacts: {
    currentSnapshotId: string | null
    actionsTaken: number
    mutatingActionsTaken: number
    targetEvidence: ElementEvidence | null
    confirmedRequestIds: ReadonlySet<string>
  },
): RunContext {
  return {
    currentStepOrdinal: ordinal,
    planLength,
    deadlineEpochMs: job.deadlineEpochMs,
    nowEpochMs: deps.now(),
    ...ledgerFacts,
  }
}

interface Performed {
  readonly summary: string
  readonly changedSomething: boolean
  readonly draftText?: string | undefined
  /**
   * What this action YIELDED, if it yielded anything.
   *
   * Absent for a read: reading changes nothing and produces nothing the person
   * has to decide about. Present for anything that made a thing — and the thing
   * is a shape, not a `ShiftOutcome`. This runtime never says what kind of
   * result it just made, because saying so is the assumption being removed.
   */
  readonly produced?: OutcomeProposal | undefined
  /** The page as it stands after this action. Present for every browser kind
   *  that drives a page, which is why the loop needs no separate look. */
  readonly observed?: PageObservation | undefined
  /** Pixels, only from `capture-screen`. Carries no refs, so it never advances
   *  the snapshot. */
  readonly captured?: ScreenCapture | undefined
}

/** Dispatch by kind. Exhaustive over ActionKind, so adding a capability without
 *  handling it here is a type error rather than a silent no-op. */
async function perform(
  action: AuthorizedAction,
  /** The committed `ActionIntent` this is the effect of. It rides on the
   *  production so provenance closes as a JOIN rather than a claim: the outcome
   *  writers intersect these against the run's own completed intents, and an id
   *  that is not among them is dropped. */
  intentId: string,
  deps: WorkerDeps,
  gathered: Array<{ label: string; content: Datamarked }>,
): Promise<Performed> {
  const kind: ActionKind = action.kind

  switch (kind) {
    case 'read-approved-source': {
      const source = await readApprovedSource(
        action as AuthorizedAction<'read-approved-source'>,
        deps.readSource,
      )
      // Datamarked before it can reach another prompt. The worker never holds a
      // bare string of page text.
      gathered.push({ label: source.title, content: datamark(source.untrustedText) })
      return { summary: `read ${source.title}`, changedSomething: false }
    }

    case 'read-document': {
      const doc = await readDocument(action as AuthorizedAction<'read-document'>, deps.readDoc)
      return { summary: `read the document (v${doc.versionId})`, changedSomething: false }
    }

    case 'draft-section': {
      const drafted = draftSection(action as AuthorizedAction<'draft-section'>)
      return {
        summary: `drafted ${drafted.sectionPath}`,
        changedSomething: true,
        draftText: drafted.prose,
        // Prose for a named place. NOT "a change to a Markdown document" — that
        // sentence is written in the app process, against the base version the
        // contract pinned, and only if it pinned one.
        produced: {
          kind: 'section-prose',
          intentId,
          section: drafted.sectionPath,
          prose: drafted.prose,
        },
      }
    }

    /**
     * The six that drive the person's own Chrome.
     *
     * Every one of them returns the page AFTER it acted, which is what collapses
     * observe → act → observe into a single round trip and — the part that
     * matters — makes acting on a page the run did not just see structurally
     * impossible rather than merely refused. See the header of
     * `src/policy/tools.ts`.
     *
     * `changedSomething` is deliberately NOT "is this a mutating kind", and it
     * is deliberately NOT "did the tree come back different". It feeds exactly
     * one rule — `no-progress`, the one that catches a run going in circles —
     * so it answers *did this move the work along*. `navigate` is not a mutating
     * kind and does count here: opening a page gets somewhere, where re-reading
     * the same document three times does not. Comparing two trees instead would
     * be worse in both directions, counting a click that opened a menu as
     * progress and a click that submitted a form to an unchanged page as none.
     *
     * The mutating count is a separate thing, read off `MUTATING_ACTION_KINDS`
     * in the loop above, and the two must not be collapsed: one bounds a lost
     * run, the other bounds what happens to somebody's account.
     *
     * ── What this costs the outcome vocabulary, said plainly ─────────────
     *
     * `OutcomeProposal` has five shapes and exactly one is produced here:
     * `section-prose`, from `draft-section`. `landed` still has no producer,
     * because `LANDING_ACTION_KINDS` is empty and `click-element` is not in it —
     * landing is about whose act put the effect into the world, not about
     * whether an effect is possible. `src/server/outcomes/` handles all five
     * anyway, and its switch is exhaustive for the same reason this one is: the
     * writer for a shape must exist before the capability that makes it.
     */
    case 'observe-page': {
      const observed = await observePage(
        action as AuthorizedAction<'observe-page'>,
        browserFor(deps, kind),
      )
      return { summary: `looked at ${observed.url}`, changedSomething: false, observed }
    }

    case 'navigate': {
      const observed = await navigateTo(action as AuthorizedAction<'navigate'>, {
        ...browserFor(deps, kind),
        sources: deps.readSource.sources,
      } satisfies NavigateDeps)
      // Reaching the world and changing something are different: loading a page
      // is a read that happens to travel, which is why `navigate` is not a
      // mutating kind. But it is progress — a run that keeps navigating is
      // getting somewhere, unlike one that keeps re-reading the same document.
      return { summary: `opened ${observed.url}`, changedSomething: true, observed }
    }

    case 'click-element': {
      const observed = await clickElement(
        action as AuthorizedAction<'click-element'>,
        browserFor(deps, kind),
      )
      return {
        summary: `clicked, and the page is now ${observed.url}`,
        changedSomething: true,
        observed,
      }
    }

    case 'type-text': {
      const observed = await typeText(
        action as AuthorizedAction<'type-text'>,
        browserFor(deps, kind),
      )
      return { summary: 'typed into the page', changedSomething: true, observed }
    }

    case 'press-key': {
      const observed = await pressKey(
        action as AuthorizedAction<'press-key'>,
        browserFor(deps, kind),
      )
      return {
        summary: `pressed a key, and the page is now ${observed.url}`,
        changedSomething: true,
        observed,
      }
    }

    case 'capture-screen': {
      const captured = await captureScreen(
        action as AuthorizedAction<'capture-screen'>,
        browserFor(deps, kind),
      )
      return { summary: 'took a picture of the page', changedSomething: false, captured }
    }
  }
}

/**
 * The channel, or a refusal to pretend there is one.
 *
 * Nothing should reach here without a browser: `draftContract` grants only
 * `DOCUMENT_ACTION_KINDS`, so a document contract cannot put a browser kind in
 * its scope, and the gate refuses one that arrives anyway. This is the second
 * fence, for the day the first one moves — and it throws rather than returning a
 * no-op channel because a silent no-op would be recorded as a SUCCEEDED outcome
 * for an action that never happened, which is the one kind of ledger row that
 * cannot be recovered from later.
 */
function browserFor(deps: WorkerDeps, kind: ActionKind): BrowserDeps {
  if (!deps.browser) {
    throw new Error(`${kind} is authorized but this run has no browser to carry it out in`)
  }
  return deps.browser
}
