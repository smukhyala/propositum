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
  readonly documentTitle: string
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
  readonly sections: readonly string[]
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
  readonly drafts: ReadonlyArray<{ section: string; prose: string }>
  readonly refusals: number
  readonly actionsTaken: number
}

export async function runWorker(job: WorkerJob, deps: WorkerDeps): Promise<WorkerResult> {
  const policy = compilePolicy(job.scope, job.controls)
  const mayDraft = policy.actionKindAllowlist.has('draft-section')

  const decisions: DecisionRaised[] = []
  const drafts: Array<{ section: string; prose: string }> = []
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
    drafts,
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
    documentTitle: job.documentTitle,
    sections: job.sections,
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
      const outcome = await perform(verdict.action, deps, gathered, drafts)
      actionsTaken += 1
      consecutiveNoProgress = outcome.changedSomething ? 0 : consecutiveNoProgress + 1

      await deps.ledger.recordOutcome({
        intentId,
        result: 'succeeded',
        scopeVerdict: 'within_scope',
        detail: outcome.summary,
        ...(outcome.draftText === undefined ? {} : { draftText: outcome.draftText }),
      })
      history.push({ kind: action.kind, summary: action.reason, outcome: outcome.summary })
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
}

/** Dispatch by kind. Exhaustive over ActionKind, so adding a capability without
 *  handling it here is a type error rather than a silent no-op. */
async function perform(
  action: AuthorizedAction,
  deps: WorkerDeps,
  gathered: Array<{ label: string; content: Datamarked }>,
  drafts: Array<{ section: string; prose: string }>,
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
      drafts.push({ section: drafted.sectionPath, prose: drafted.prose })
      return {
        summary: `drafted ${drafted.sectionPath}`,
        changedSomething: true,
        draftText: drafted.prose,
      }
    }
  }
}
