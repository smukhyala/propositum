/**
 * The worker loop.
 *
 *   claim → plan → propose → GATE → act → record → check stops → repeat
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
 * when we know exactly what happened.
 *
 * ── Refusals are recorded, not thrown ────────────────────────────────────
 *
 * A gate refusal is a fact about the run, not an error in it. It becomes an
 * `ActionIntent` with `authorized = false` and a deterministic rule id, and the
 * loop continues — refusals are evidence about H3, and three in a row is itself
 * a stop condition.
 *
 * ── No clock ─────────────────────────────────────────────────────────────
 *
 * `now()` is injected. A 40-minute fixture replays in milliseconds, and a
 * budget decision never depends on when the test ran.
 */

import { compilePolicy } from '../domain/handoff/policy'
import type { ActionKind, AutonomyControls, ContractScope } from '../domain/handoff/policy'
import { authorize } from '../policy/gate'
import type { AuthorizedAction, RunContext, ToolProposal } from '../policy/gate'
import { draftSection, readApprovedSource, readDocument } from '../policy/tools'
import type { ReadDocumentDeps, ReadSourceDeps } from '../policy/tools'
import { STOP_RULES, effectOfRaisedQuestion, shouldStop } from '../domain/execution/stop-conditions'
import type { StopRuleId } from '../domain/execution/stop-conditions'
import { datamark } from '../model/untrusted'
import type { Datamarked } from '../model/untrusted'
import type { ModelClient } from '../model/client'
import { planBoundary } from '../model/boundaries/plan'
import { workerActionBoundary } from '../model/boundaries/worker-action'
import type { ShiftOutcomeKind } from '../domain/execution/shift-outcome'

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
  }): Promise<void>
  recordSteps(runId: string, steps: ReadonlyArray<{ ordinal: number; intent: string }>): Promise<string[]>
  advanceProgress(runId: string, step: number): Promise<void>
}

export interface WorkerDeps {
  readonly model: ModelClient
  readonly ledger: RunLedger
  readonly readSource: ReadSourceDeps
  readonly readDoc: ReadDocumentDeps
  /** Injected. Never Date.now() inside the loop. */
  readonly now: () => number
  readonly renewLease?: ((runId: string) => Promise<void>) | undefined
}

export interface WorkerJob {
  readonly runId: string
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
}

export async function runWorker(job: WorkerJob, deps: WorkerDeps): Promise<WorkerResult> {
  const policy = compilePolicy(job.scope, job.controls)
  const mayDraft = policy.actionKindAllowlist.has('draft-section')

  const decisions: DecisionRaised[] = []
  const produced: OutcomeProposal[] = []
  const gathered: Array<{ label: string; content: Datamarked }> = []
  const history: Array<{ kind: string; summary: string; outcome: string }> = []

  let seq = 0
  let refusals = 0
  let actionsTaken = 0
  let consecutiveNoProgress = 0
  let consecutiveRefusals = 0

  const progress = () => ({
    nowEpochMs: deps.now(),
    deadlineEpochMs: job.deadlineEpochMs,
    consecutiveNoProgress,
    consecutiveRefusals,
  })

  const finish = (rules: readonly StopRuleId[], status: 'succeeded' | 'failed'): WorkerResult => ({
    status,
    stoppedBy: rules,
    terminalReason: rules.length ? STOP_RULES[rules[0]!].terminalReason : undefined,
    decisions,
    produced,
    refusals,
    actionsTaken,
  })

  // Budget can already be gone before we plan — check before spending a call.
  const preflight = shouldStop(progress(), job.controls.interruption, false)
  if (preflight.halt) return finish(preflight.rules, 'succeeded')

  /* ── plan ───────────────────────────────────────────────────────────── */

  const planned = await deps.model.run(planBoundary, {
    objective: job.objective,
    definitionOfDone: job.definitionOfDone,
    context: job.context,
    expects: job.expects,
    availableSourceLabels: job.sourceLabels.map((s) => s.label),
    mayDraft,
  })

  if (!planned.ok) return finish([], 'failed')

  const stepIds = await deps.ledger.recordSteps(
    job.runId,
    planned.value.steps.map((s, i) => ({ ordinal: i + 1, intent: s.intent })),
  )

  /* ── step through the plan ──────────────────────────────────────────── */

  for (const [index, step] of planned.value.steps.entries()) {
    const ordinal = index + 1
    await deps.ledger.advanceProgress(job.runId, ordinal)
    await deps.renewLease?.(job.runId)

    // Halts land here — at a boundary, between actions, never inside one.
    const stop = shouldStop(progress(), job.controls.interruption, false)
    if (stop.halt) return finish(stop.rules, 'succeeded')

    const proposed = await deps.model.run(workerActionBoundary, {
      objective: job.objective,
      definitionOfDone: job.definitionOfDone,
      guidance: job.guidance,
      currentStep: {
        ordinal,
        intent: step.intent,
        ...(step.targetSection === undefined ? {} : { targetSection: step.targetSection }),
      },
      allowedActionKinds: [...policy.actionKindAllowlist],
      availableSources: job.sourceLabels,
      history,
      gathered,
    })

    if (!proposed.ok) return finish([], 'failed')
    const action = proposed.value

    // A raised question is not an action and never reaches the gate. Whether it
    // also halts is the Interruption dial's business; that it is recorded is
    // not configurable.
    if (action.decisionNeeded) {
      decisions.push({ ...action.decisionNeeded, atStep: ordinal })

      if (effectOfRaisedQuestion(job.controls.interruption) === 'halt') {
        return finish(['decision-needed'], 'succeeded')
      }
      history.push({ kind: 'question', summary: action.decisionNeeded.question, outcome: 'raised' })
      continue
    }

    seq += 1

    /**
     * The model proposes none of this — every value here comes from the model's
     * own reply or from the ratified job, and `documentId` comes from the job.
     *
     * It used to be `job.scope.baseVersionId`: a version id under a key that
     * means a document. The gate does not look at the value, so the proposal was
     * authorised as normal and `readDocument` then compared the version id
     * against the document id it belonged to, found them different, and threw —
     * every time, on every run that planned a document read. The tool no longer
     * makes that comparison, and this no longer offers it the wrong id to make
     * it with.
     *
     * Absent when the shift has no document. That is the case
     * `document_missing` was written for and, until now, the case it never saw:
     * the key was unconditionally present, so the refusal could not fire.
     */
    const params: Record<string, unknown> = {
      ...(action.approvedSourceId ? { approvedSourceId: action.approvedSourceId } : {}),
      ...(action.targetSection ? { sectionPath: action.targetSection } : {}),
      ...(action.prose ? { text: action.prose } : {}),
      ...(job.documentId === undefined ? {} : { documentId: job.documentId }),
    }

    const proposal: ToolProposal = {
      kind: action.kind,
      params: params as ToolProposal['params'],
      reason: action.reason,
      stepOrdinal: ordinal,
    }

    const verdict = authorize(policy, proposal, runContext(job, ordinal, planned.value.steps.length, deps), 'pending')

    /* ── refused ──────────────────────────────────────────────────────── */

    if (!verdict.authorized) {
      refusals += 1
      consecutiveRefusals += 1
      consecutiveNoProgress += 1

      await deps.ledger.recordIntent({
        runId: job.runId,
        stepId: stepIds[index] ?? null,
        seq,
        kind: action.kind,
        reason: action.reason,
        params,
        authorized: false,
        refusedRule: verdict.rule,
      })

      history.push({ kind: action.kind, summary: action.reason, outcome: `refused: ${verdict.rule}` })

      const afterRefusal = shouldStop(progress(), job.controls.interruption, false)
      if (afterRefusal.halt) return finish(afterRefusal.rules, 'succeeded')
      continue
    }

    /* ── authorised: commit the intent, THEN act ──────────────────────── */

    consecutiveRefusals = 0

    const intentId = await deps.ledger.recordIntent({
      runId: job.runId,
      stepId: stepIds[index] ?? null,
      seq,
      kind: action.kind,
      reason: action.reason,
      params,
      authorized: true,
    })

    try {
      // `performed`, not `outcome`. The word is banned as a column name in this
      // codebase's vocabulary because it is ambiguous between two things a row
      // could hold, and a local called `outcome` sitting three lines above
      // `ledger.recordOutcome` is how the next person comes to write the column.
      const performed = await perform(verdict.action, intentId, deps, gathered)
      actionsTaken += 1
      consecutiveNoProgress = performed.changedSomething ? 0 : consecutiveNoProgress + 1

      if (performed.produced !== undefined) produced.push(performed.produced)

      await deps.ledger.recordOutcome({
        intentId,
        result: 'succeeded',
        scopeVerdict: 'within_scope',
        detail: performed.summary,
        ...(performed.draftText === undefined ? {} : { draftText: performed.draftText }),
      })
      history.push({ kind: action.kind, summary: action.reason, outcome: performed.summary })
    } catch (error) {
      consecutiveNoProgress += 1
      await deps.ledger.recordOutcome({
        intentId,
        result: 'failed',
        scopeVerdict: 'unverified',
        detail: error instanceof Error ? error.message : String(error),
      })
      history.push({ kind: action.kind, summary: action.reason, outcome: 'failed' })
    }

    const afterAction = shouldStop(progress(), job.controls.interruption, false)
    if (afterAction.halt) return finish(afterAction.rules, 'succeeded')
  }

  return finish([], 'succeeded')
}

function runContext(job: WorkerJob, ordinal: number, planLength: number, deps: WorkerDeps): RunContext {
  return {
    currentStepOrdinal: ordinal,
    planLength,
    deadlineEpochMs: job.deadlineEpochMs,
    nowEpochMs: deps.now(),
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
     * The browser kinds, which have a gate but not yet a tool.
     *
     * `ACTION_KINDS` gained six members before anything could carry one out, so
     * for this interval the exhaustiveness guard above is telling the truth: a
     * capability exists in the vocabulary that this loop cannot perform. The
     * honest response is to say so and record a failure, not to fall through
     * and return `undefined` to a caller whose type says otherwise.
     *
     * Nothing reaches here today. `draftContract` grants only
     * `DOCUMENT_ACTION_KINDS`, so no contract can put a browser kind in its
     * scope, and the gate refuses one that arrives anyway. This is the second
     * fence, for the day the first one moves.
     *
     * It is deliberately NOT a `default:` clause. A `default` would swallow the
     * next capability someone adds; naming all six means adding a seventh is
     * still a type error, which is the property the comment above promises.
     *
     * ── What this costs the outcome vocabulary, said plainly ─────────────
     *
     * `OutcomeProposal` has five shapes and exactly one of them is produced
     * here: `section-prose`, from `draft-section`. `item`, `written-answer`,
     * `composed-text` and `landed` have no producing `ActionKind` today, because
     * every kind that exists is a read or a draft. `src/server/outcomes/`
     * handles all five anyway, and its switch is exhaustive for the same reason
     * this one is: the writer for a shape must exist before the capability that
     * makes it, or the first run to produce one silently loses it.
     */
    case 'observe-page':
    case 'navigate':
    case 'click-element':
    case 'type-text':
    case 'press-key':
    case 'capture-screen':
      throw new Error(
        `${kind} is authorized but this runner cannot carry it out yet — the browser tools are not wired`,
      )
  }
}
