/**
 * Executing one claimed run, and writing the note when it ends.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * Before this file, `runWorker` had no caller and `repos.reports.create` had no
 * caller. Both were built, tested, and unreachable. The visible consequence was
 * worse than "a feature is missing":
 *
 *   - Pressing Take over stranded the session in `away` forever. The UI offered
 *     "Take back control" pointing at a disabled button, and the shift page said
 *     "Propositum is still working" in perpetuity — which Principle 11 forbids.
 *   - No `DecisionNeeded` row was ever written, so the Accept-all guard the
 *     re-entry prototype exists to enforce could never fire. It would have
 *     demoed as fixed while having never once run.
 *
 * ── Who writes the ShiftReport, and why it matters ───────────────────────
 *
 * The app process, when the run ends — never the `AgentRun` itself. A report
 * only a live runner could produce cannot exist on `interrupted`, which is the
 * outcome that most needs one, and under the "leave your desk" constraint it is
 * a routine outcome rather than an exotic one.
 *
 * So the runner returns a `WorkerResult` and this file turns it into rows.
 *
 * ── What this file used to assume, and no longer may ─────────────────────
 *
 * It used to load a version, split its content on `## ` headings, hand the
 * worker a title and a section list, and turn the prose that came back into a
 * `Changeset`. Every one of those steps was correct and every one of them said
 * the same thing: *a run works on a document*. A run that did anything else had
 * nowhere to put its result, because the result WAS the changeset.
 *
 * So the spine is generic now. A run produces `ShiftOutcome`s, of which
 * `document-changes` is one kind among five, and the machinery that knows about
 * Markdown lives in `./outcomes/document-changes.ts` where it can be the special
 * case rather than the shape of everything.
 *
 * The check that this actually happened, rather than the assumption moving one
 * directory over: **this file contains no Markdown, no `##`, no `diff(` and no
 * `Document` import.** That is greppable, and it is grepped.
 */

import { runWorker } from '../runtime/worker-loop'
import type { RunLedger, WorkerJob, WorkerResult } from '../runtime/worker-loop'
import { STOP_RULES } from '../domain/execution/stop-conditions'
import { allowlisted } from '../policy/fetcher'
import type { SourceFetcher } from '../policy/fetcher'
import { readableCause } from './problem'
import { FINDING_KINDS, reviewBoundary, reviewHandlesFor } from '../model/boundaries/review'
import type { ReviewedOutcome } from '../model/boundaries/review'
import { loadWorkspace } from './outcomes/workspace'
import { recordOutcomes } from './outcomes/index'
import { sectionTitleFor } from './outcomes/document-changes'
import type { AppContext } from './db'
import type { ModelClient } from '../model/client'
import type { ActionKind } from '../domain/handoff/policy'

export interface ExecuteDeps {
  readonly ctx: AppContext
  readonly model: ModelClient
  readonly fetcher: SourceFetcher
  readonly now: () => number
}

/** A ledger backed by real rows. The worker writes intents before effects
 *  through this, so a run that dies mid-action still shows what it attempted. */
function ledgerFor(ctx: AppContext, runId: string): RunLedger {
  return {
    async recordIntent(input) {
      const row = await ctx.db.prisma.actionIntent.create({
        data: {
          runId: input.runId,
          ...(input.stepId === null ? {} : { stepId: input.stepId }),
          seq: input.seq,
          kind: input.kind,
          reason: input.reason,
          params: input.params as object,
          authorized: input.authorized,
          ...(input.refusedRule === undefined ? {} : { refusedRule: input.refusedRule }),
        },
        select: { id: true },
      })
      return row.id
    },

    async recordOutcome(input) {
      await ctx.db.prisma.actionOutcome.create({
        data: {
          intentId: input.intentId,
          result: input.result,
          scopeVerdict: input.scopeVerdict,
          ...(input.detail === undefined ? {} : { detail: input.detail }),
          ...(input.draftText === undefined ? {} : { draftText: input.draftText }),
        },
      })
    },

    async recordSteps(_runId, steps) {
      const ids: string[] = []
      for (const step of steps) {
        const row = await ctx.db.prisma.planStep.create({
          data: { runId, ordinal: step.ordinal, intent: step.intent },
          select: { id: true },
        })
        ids.push(row.id)
      }
      return ids
    },

    advanceProgress: (id, step) => ctx.repos.runs.advanceProgress(id, step),
  }
}

/**
 * Execute one claimed run end to end, then write the note.
 *
 * Never throws for a run-level failure — a failed run is a recorded outcome,
 * and throwing would lose the ledger context the person needs on return.
 */
export async function executeRun(runId: string, deps: ExecuteDeps): Promise<void> {
  const { ctx } = deps

  const run = await ctx.repos.runs.byId(runId)
  if (!run) return

  const contract = await ctx.repos.contracts.byId(run.contractId)
  if (!contract) {
    await ctx.repos.runs.complete(runId, 'failed', new Date(deps.now()), 'error')
    return
  }

  /**
   * Everything the ratified contract gives this run to work with — and the
   * branch that used to be a refusal.
   *
   * Wave 1 left a refusal here: `baseVersionId` had just become nullable, and a
   * runner whose entire shape assumed a document declined the null rather than
   * casting it away. It was unreachable, because nothing wrote a null yet, and
   * it was there so that whoever started writing them would find a refusal to
   * replace instead of a cast that had already lied on their behalf.
   *
   * This is that replacement. A missing base is now an ordinary state that
   * `loadWorkspace` returns and everything downstream holds: the gate refuses
   * the document capabilities with `no_document_pinned`, the outcome writers
   * drop a `section-prose` production they cannot apply, and the run completes
   * normally having produced whatever else it produced.
   */
  const workspace = await loadWorkspace(ctx, contract)

  // The deadline is DERIVED from an immutable pair, never stored — a
  // crash-restart loop must not be able to silently reset the budget.
  const acceptedAt = contract.acceptedAt?.getTime() ?? deps.now()
  const deadlineEpochMs = acceptedAt + contract.timeLimitMinutes * 60_000

  const job: WorkerJob = {
    runId,
    objective: contract.objective,
    definitionOfDone: contract.definitionOfDone,
    guidance: contract.guidance,
    scope: {
      approvedSourceIds: contract.approvedSourceIds,
      allowedActionKinds: contract.allowedActionKinds as ActionKind[],
      // Still the contract's own pin, still the only thing that fixes which
      // version a tool may read. `undefined` rather than `null` because the
      // scope's optional field is what `compilePolicy` reads to decide whether
      // the document capability exists at all.
      ...(contract.baseVersionId === null ? {} : { baseVersionId: contract.baseVersionId }),
    },
    controls: {
      initiative: contract.initiative as 'follow-closely' | 'use-judgment',
      progress: contract.progress as 'current-step-only' | 'remaining-plan',
      output: contract.output as 'suggestions-only' | 'draft-changes',
      interruption: contract.interruption as 'stop-when-uncertain' | 'stop-only-when-blocked',
      timeLimitMinutes: contract.timeLimitMinutes,
    },
    context: workspace.context,
    expects: workspace.expects,
    // Resolved through the pinned version. Undefined when nothing is pinned, or
    // when the pin no longer resolves — the gate turns those into
    // `no_document_pinned` and `document_missing` respectively, rather than a
    // run that drafts into nothing.
    documentId: workspace.documentId,
    sourceLabels: workspace.sources.map((s) => ({ id: s.id, label: s.label })),
    deadlineEpochMs,
  }

  let result: WorkerResult
  try {
    result = await runWorker(job, {
      model: deps.model,
      ledger: ledgerFor(ctx, runId),
      readSource: {
        fetcher: allowlisted(deps.fetcher, workspace.sources.map((s) => s.originPattern)),
        sources: {
          urlFor: async (id) => {
            const source = workspace.sources.find((s) => s.id === id)
            return source ? source.originPattern.replace(/\/\*$/, '/') : null
          },
        },
      },
      readDoc: {
        versions: { byId: (id) => ctx.repos.documents.version(id) },
        ...(contract.baseVersionId === null ? {} : { baseVersionId: contract.baseVersionId }),
      },
      now: deps.now,
      renewLease: (id) => ctx.repos.runs.renewLease(id, new Date(deps.now() + 60_000)),
    })
  } catch (error) {
    await ctx.repos.runs.complete(runId, 'failed', new Date(deps.now()), 'error')
    await writeReport(ctx, contract.id, null, [], error instanceof Error ? error.message : String(error))
    return
  }

  /* ── what the run produced, whatever kind of thing that was ──────────── */

  // Deterministic code decides what each production IS. The worker returned
  // shapes; nothing it returned named a kind, claimed a reversibility, or
  // asserted which of its own actions supports what.
  const recorded = await recordOutcomes(ctx, {
    run: { id: runId },
    contract: { id: contract.id },
    workspace,
    produced: result.produced,
  })

  await ctx.repos.runs.complete(
    runId,
    result.status,
    new Date(deps.now()),
    result.terminalReason ?? undefined,
  )

  /* ── the second pass ─────────────────────────────────────────────────── */

  // Runs when there is at least one HELD outcome, which is the generalisation of
  // "if there is a changeset". A `landed` outcome is deliberately excluded: the
  // reviewer's whole output is advice to somebody who still has a decision to
  // make, and there is no decision left on something that already happened.
  if (recorded.heldOutcomeIds.length > 0) await review(ctx, deps, contract, runId)

  /* ── the note ───────────────────────────────────────────────────────── */

  const stopLabel = result.stoppedBy.length ? STOP_RULES[result.stoppedBy[0]!].consumerLabel : null

  await writeReport(ctx, contract.id, stopLabel, result.decisions, undefined, recorded.dropped)

  // The session goes back to the person. Without this it stays `away` forever,
  // and every control that offers to hand it back is a promise the product
  // cannot keep.
  await ctx.repos.sessions.markObserving(contract.sessionId)
}

/**
 * A second pass over what the worker proposed, before the person sees it.
 *
 * ── It grants nothing, and cannot fail the shift ─────────────────────────
 *
 * `ReviewFinding` is display-only: it cannot block a change, fail a run or
 * alter a verdict. Scope adherence is deterministic and the gate already
 * enforced it, so there is nothing here for a model to adjudicate. This judges
 * only what determinism cannot — whether a claim is actually supported, whether
 * a draft contradicts its source, whether prose is vague where it needed a
 * number.
 *
 * So every failure below is swallowed. Acceptance bullet 9 requires the
 * `ShiftReport` to render WITHOUT a reviewer pass, and this file writes that
 * report specifically so one exists on `interrupted`. A reviewer that throws
 * must not take the note down with it.
 *
 * ── An honest limitation, stated rather than implied ─────────────────────
 *
 * `sourcesRead` is EMPTY, and will be until something retains fetched page
 * text. `ActionOutcome.detail` holds "read <title>", not the body. So the
 * reviewer can check internal support and vagueness, and **cannot** compare a
 * draft against the source it cites — which is the check it looks most capable
 * of making. Re-fetching is the fix and is not slice 0.
 *
 * `docs/MVP.md` assumption 4 calls the reviewer "currently doubtful" and says
 * slice 0 ships it and measures whether it earns its place. This is that ship.
 */
async function review(
  ctx: AppContext,
  deps: ExecuteDeps,
  contract: { id: string; objective: string; definitionOfDone: string; guidance: readonly string[] },
  workerRunId: string,
): Promise<void> {
  try {
    const produced = await ctx.repos.outcomes.forRun(workerRunId)
    const held = produced.filter((outcome) => outcome.reversibility === 'held')
    if (held.length === 0) return

    // Its own run row, so the second pass is visible in the ledger as a thing
    // that happened rather than folded into the worker's record.
    const run = await ctx.repos.runs.enqueue({ contractId: contract.id, role: 'reviewer' })

    // The model sees handles, never ids — the same rule every other boundary
    // follows, and a Zod refinement resolves them back.
    const changeIdByHandle = new Map<string, string>()
    const outcomeIdByHandle = new Map<string, string>()

    const handles: ReviewedOutcome[] = []

    for (const [index, outcome] of held.entries()) {
      const handle = `O${index + 1}`
      outcomeIdByHandle.set(handle, outcome.id)

      /**
       * The changes under this outcome, looked up BY THE OUTCOME.
       *
       * Not `changesets.forContract`, which returns the newest changeset for the
       * contract. A contract can carry more than one worker run — a re-accept
       * enqueues another, a stale lease re-claims — and the reviewer is judging
       * one run's own work. Reading the newest would let it annotate a different
       * run's changes and then resolve its findings onto their ids, which is a
       * mis-attribution the person has no way to notice.
       */
      const changeset =
        outcome.kind === 'document-changes'
          ? await ctx.repos.changesets.forOutcome(outcome.id)
          : null

      const changes = changeset?.changes.map((change, position) => {
        const changeHandle = `C${position + 1}`
        changeIdByHandle.set(changeHandle, change.id)
        return {
          handle: changeHandle,
          section: sectionTitleFor(change.exact) ?? 'the document',
          replacement: change.replacement,
          reason: change.reason,
        }
      })

      handles.push({
        handle,
        headline: outcome.headline,
        reason: outcome.reason,
        summary: outcome.headline,
        ...(changes === undefined ? {} : { changes }),
      })
    }

    const judged = await deps.model.run(reviewBoundary(reviewHandlesFor(handles)), {
      objective: contract.objective,
      definitionOfDone: contract.definitionOfDone,
      guidance: contract.guidance,
      outcomes: handles,
      // Empty, and see the note above. Not a bug to fix here.
      sourcesRead: [],
    })

    if (!judged.ok) {
      await ctx.repos.runs.complete(run.id, 'failed', new Date(deps.now()), 'error')
      return
    }

    const kinds = new Set<string>(FINDING_KINDS)

    const findings = judged.value.findings
      // A kind outside the closed list is dropped rather than stored. The
      // grammar enforces shape only, so `kind` is a free string at the wire and
      // the constraint has to be applied here.
      .filter((finding: { kind: string }) => kinds.has(finding.kind))
      .map((finding: { handle: string; kind: string; detail: string }) => {
        // At most one of the two is set, and that is a property of the handle
        // spaces being disjoint rather than a rule applied afterwards. A finding
        // that resolves to neither is about the run as a whole, which is already
        // how a null `changeId` behaved.
        const changeId = changeIdByHandle.get(finding.handle) ?? null
        return {
          changeId,
          outcomeId: changeId === null ? outcomeIdByHandle.get(finding.handle) ?? null : null,
          kind: finding.kind,
          detail: finding.detail,
        }
      })

    await ctx.repos.findings.create({ runId: run.id, findings })
    await ctx.repos.runs.complete(run.id, 'succeeded', new Date(deps.now()))
  } catch {
    // Deliberately silent. The note is the thing the person came back for.
  }
}

async function writeReport(
  ctx: AppContext,
  contractId: string,
  stopLabel: string | null,
  decisions: ReadonlyArray<{ question: string; whyItMatters: string }>,
  failureDetail?: string,
  /**
   * Productions the outcome writers could not realise.
   *
   * Nearly always zero, and it has to be SAID when it is not. The writers count
   * every drop precisely so the count is evidence that the closed set of kinds
   * is wrong — and a count returned to a caller that reads only the held ids is
   * a count nobody has. That is the same shape as the swallowed notification and
   * the blank report: the software knew something was lost and told no one.
   *
   * It is one sentence, not a number on a screen. "Two things it made could not
   * be kept" is actionable — the person knows to ask. A tally of dropped
   * productions is an internal metric wearing consumer clothes.
   */
  dropped?: number,
): Promise<void> {
  const existing = await ctx.repos.reports.forContract(contractId)
  if (existing) return

  const lost =
    dropped === undefined || dropped === 0
      ? ''
      : ` ${dropped === 1 ? 'One thing it made' : `${dropped} things it made`} could not be kept, so ${dropped === 1 ? 'it is' : 'they are'} not below.`

  await ctx.repos.reports.create({
    contractId,
    /**
     * A failure has to SAY something, or it is undiagnosable.
     *
     * This used `failureDetail` as a boolean and discarded the message. A run
     * failed in real use, the report said nothing, the ledger held no intents,
     * and the only copy of the reason was a line in a terminal nobody had kept.
     * That is the same shape as the blank page and the swallowed notification:
     * the software knew what went wrong and told no one.
     *
     * The narrative boundary still fails open — a null narrative is a designed
     * outcome. A CRASH is not, and now reads as one.
     */
    narrative: failureDetail
      ? `Propositum stopped before it could finish, and nothing was changed. (${readableCause(failureDetail)})`
      : stopLabel === null
        ? lost === ''
          ? null
          : lost.trim()
        : `${stopLabel}${lost}`,
    decisions: decisions.map((d, i) => ({
      question: d.question,
      whyStopped: d.whyItMatters,
      needs: 'A decision only you can make.',
      ordinal: i,
    })),
  })
}
