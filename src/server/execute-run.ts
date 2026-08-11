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
 */

import { runWorker } from '../runtime/worker-loop'
import type { RunLedger, WorkerJob, WorkerResult } from '../runtime/worker-loop'
import { STOP_RULES } from '../domain/execution/stop-conditions'
import { allowlisted } from '../policy/fetcher'
import type { SourceFetcher } from '../policy/fetcher'
import { diff } from '../domain/document/changeset'
import { readableCause } from './problem'
import { FINDING_KINDS, changeHandlesFor, reviewBoundary } from '../model/boundaries/review'
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

  const version = await ctx.repos.documents.version(contract.baseVersionId)
  const document = version ? await ctx.repos.documents.byId(version.documentId) : null

  const sources = await ctx.db.prisma.approvedSource.findMany({
    where: { id: { in: contract.approvedSourceIds } },
    select: { id: true, label: true, originPattern: true },
  })

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
      baseVersionId: contract.baseVersionId,
    },
    controls: {
      initiative: contract.initiative as 'follow-closely' | 'use-judgment',
      progress: contract.progress as 'current-step-only' | 'remaining-plan',
      output: contract.output as 'suggestions-only' | 'draft-changes',
      interruption: contract.interruption as 'stop-when-uncertain' | 'stop-only-when-blocked',
      timeLimitMinutes: contract.timeLimitMinutes,
    },
    documentTitle: document?.title ?? 'the document',
    sections: sectionsOf(version?.content ?? ''),
    sourceLabels: sources.map((s) => ({ id: s.id, label: s.label })),
    deadlineEpochMs,
  }

  let result: WorkerResult
  try {
    result = await runWorker(job, {
      model: deps.model,
      ledger: ledgerFor(ctx, runId),
      readSource: {
        fetcher: allowlisted(deps.fetcher, sources.map((s) => s.originPattern)),
        sources: {
          urlFor: async (id) => {
            const source = sources.find((s) => s.id === id)
            return source ? source.originPattern.replace(/\/\*$/, '/') : null
          },
        },
      },
      readDoc: { versions: { byId: (id) => ctx.repos.documents.version(id) }, baseVersionId: contract.baseVersionId },
      now: deps.now,
      renewLease: (id) => ctx.repos.runs.renewLease(id, new Date(deps.now() + 60_000)),
    })
  } catch (error) {
    await ctx.repos.runs.complete(runId, 'failed', new Date(deps.now()), 'error')
    await writeReport(ctx, contract.id, null, [], error instanceof Error ? error.message : String(error))
    return
  }

  /* ── the changeset, computed deterministically from the worker's prose ── */

  if (result.drafts.length > 0 && version) {
    let proposed = version.content
    for (const draft of result.drafts) proposed = replaceSection(proposed, draft.section, draft.prose)

    const { baseHash, changes } = diff(version.content, proposed, 'Drafted while you were away.')
    if (changes.length > 0) {
      await ctx.repos.changesets.create({
        contractId: contract.id,
        baseVersionId: version.id,
        baseHash,
        changes: changes.map((c) => ({
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          prefix: c.prefix,
          exact: c.exact,
          suffix: c.suffix,
          replacement: c.replacement,
          reason: c.reason,
        })),
      })
    }
  }

  await ctx.repos.runs.complete(
    runId,
    result.status,
    new Date(deps.now()),
    result.terminalReason ?? undefined,
  )

  /* ── the second pass ─────────────────────────────────────────────────── */

  await review(ctx, deps, contract)

  /* ── the note ───────────────────────────────────────────────────────── */

  const stopLabel = result.stoppedBy.length ? STOP_RULES[result.stoppedBy[0]!].consumerLabel : null

  await writeReport(ctx, contract.id, stopLabel, result.decisions)

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
): Promise<void> {
  try {
    const changeset = await ctx.repos.changesets.forContract(contract.id)
    if (!changeset || changeset.changes.length === 0) return

    // Its own run row, so the second pass is visible in the ledger as a thing
    // that happened rather than folded into the worker's record.
    const run = await ctx.repos.runs.enqueue({ contractId: contract.id, role: 'reviewer' })

    // The model sees handles, never ids — the same rule every other boundary
    // follows, and a Zod refinement resolves them back.
    const handles = changeset.changes.map((change, index) => ({
      handle: `C${index + 1}`,
      changeId: change.id,
      section: sectionTitleFor(change.exact) ?? 'the document',
      replacement: change.replacement,
      reason: change.reason,
    }))

    const outcome = await deps.model.run(reviewBoundary(changeHandlesFor(handles)), {
      objective: contract.objective,
      definitionOfDone: contract.definitionOfDone,
      guidance: contract.guidance,
      changes: handles,
      // Empty, and see the note above. Not a bug to fix here.
      sourcesRead: [],
    })

    if (!outcome.ok) {
      await ctx.repos.runs.complete(run.id, 'failed', new Date(deps.now()), 'error')
      return
    }

    const byHandle = new Map(handles.map((h) => [h.handle, h.changeId]))
    const kinds = new Set<string>(FINDING_KINDS)

    const findings = outcome.value.findings
      // A kind outside the closed list is dropped rather than stored. The
      // grammar enforces shape only, so `kind` is a free string at the wire and
      // the constraint has to be applied here.
      .filter((finding: { kind: string }) => kinds.has(finding.kind))
      .map((finding: { changeHandle: string; kind: string; detail: string }) => ({
        changeId: byHandle.get(finding.changeHandle) ?? null,
        kind: finding.kind,
        detail: finding.detail,
      }))

    await ctx.repos.findings.create({ runId: run.id, findings })
    await ctx.repos.runs.complete(run.id, 'succeeded', new Date(deps.now()))
  } catch {
    // Deliberately silent. The note is the thing the person came back for.
  }
}

/** The `## ` heading a change sits under, if the anchor happens to carry one. */
function sectionTitleFor(exact: string): string | null {
  const heading = /^#{2,3}\s+(.+)$/m.exec(exact)
  return heading?.[1]?.trim() ?? null
}

async function writeReport(
  ctx: AppContext,
  contractId: string,
  stopLabel: string | null,
  decisions: ReadonlyArray<{ question: string; whyItMatters: string }>,
  failureDetail?: string,
): Promise<void> {
  const existing = await ctx.repos.reports.forContract(contractId)
  if (existing) return

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
      : stopLabel,
    decisions: decisions.map((d, i) => ({
      question: d.question,
      whyStopped: d.whyItMatters,
      needs: 'A decision only you can make.',
      ordinal: i,
    })),
  })
}

/** Markdown `## ` headings, in order. */
function sectionsOf(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => /^#{2,3}\s/.test(l.trim()))
    .map((l) => l.replace(/^#+\s*/, '').trim())
}

/** Replace a named section's body with new prose, leaving its heading. Appends
 *  when the section does not exist — a worker drafting a section the document
 *  lacks is a planning error the reviewer should see, not something to drop. */
function replaceSection(content: string, section: string, prose: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l.trim()) && l.replace(/^#+\s*/, '').trim() === section)

  if (start === -1) return `${content.trimEnd()}\n\n## ${section}\n\n${prose}\n`

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{2,3}\s/.test(lines[i]!.trim())) {
      end = i
      break
    }
  }

  return [...lines.slice(0, start + 1), '', prose, '', ...lines.slice(end)].join('\n')
}
