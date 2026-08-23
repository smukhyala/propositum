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
import { descriptorFor } from '../runtime/history'
import type { ConfirmedAction, HistoryReader } from '../runtime/history'
import { STOP_RULES } from '../domain/execution/stop-conditions'
import { allowlisted } from '../policy/fetcher'
import type { SourceFetcher } from '../policy/fetcher'
import { readableCause } from './problem'
import {
  confirmationForIntent,
  confirmedRequestIdsFor,
  creditedDeadlineFor,
  settleAbandonedIntents,
} from './confirmations'
import type { RunFence } from '../runtime/worker-process'
import { FINDING_KINDS, reviewBoundary, reviewHandlesFor } from '../model/boundaries/review'
import type { ReviewedOutcome } from '../model/boundaries/review'
import { loadWorkspace } from './outcomes/workspace'
import { recordOutcomes } from './outcomes/index'
import { sectionTitleFor } from './outcomes/document-changes'
import { createBrowserControl } from '../runtime/browser-control'
import type { BrowserDeps } from '../policy/tools'
import type { AppContext } from './db'
import type { ModelClient } from '../model/client'
import { BROWSER_ACTION_KINDS } from '../domain/handoff/policy'
import type { ActionKind } from '../domain/handoff/policy'

export interface ExecuteDeps {
  readonly ctx: AppContext
  readonly model: ModelClient
  readonly fetcher: SourceFetcher
  readonly now: () => number
  /**
   * The claim fence, from the process that claimed this run.
   *
   * REQUIRED, not optional, and that is the difference between the fence
   * existing and the fence being a paragraph. CONTEXT.md §4 has said for a long
   * time that "every action boundary re-reads `status` and `claimedBy`; a
   * Runner that no longer holds the claim aborts without writing" — and until
   * the columns landed there was nothing to read. An optional dep defaulting to
   * "carry on" would put it straight back into the state where the sentence is
   * true of the documentation and false of the software.
   */
  readonly fence: RunFence
  /**
   * How the browser control reaches this app, for the runs that have one.
   *
   * Injected like every other piece of I/O this file takes — the model, the
   * fetcher, the clock — rather than reached for off the global, and for the
   * same reason: a run that drives a browser is otherwise only exercisable
   * against a listening dev server, which means the pause that ends such a run
   * could only be tested by hand-writing the rows it produces. Those rows were
   * hand-written for a whole wave, and `confirmations.create` had no caller
   * underneath them.
   *
   * Defaults to `globalThis.fetch`, which is what production uses.
   */
  readonly fetch?: typeof globalThis.fetch | undefined
}

/**
 * Where the worker posts its instructions, which is this app.
 *
 * The worker is a separate OS process (ADR-0001) and cannot call a route
 * in-process, so it goes over HTTP to the dev server on loopback — the same
 * address `src/server/calendar.ts` resolves for the OAuth redirect, read the
 * same way, because two spellings of "where Propositum is" is how one of them
 * comes to be wrong on the machine that changed its port.
 *
 * Not a secret and not a permission. The control token on the run is what the
 * `/api/act/*` door checks; this is only the address it is knocking on.
 */
function appOrigin(): string {
  return process.env['PROPOSITUM_BASE_URL'] ?? 'http://127.0.0.1:3117'
}

/**
 * The channel to the person's real Chrome, for the runs that have one.
 *
 * ── Why this is conditional, and what the condition is ───────────────────
 *
 * `WorkerDeps.browser` is optional and its docblock says why: wiring one
 * unconditionally would mean every drafting run held a handle to a debugger
 * attachment it never uses, *"which is a capability granted by tidiness"*. So
 * the condition is the only honest one available — does the contract the person
 * ratified actually grant a kind that needs a live page under it.
 *
 * The token is the second half. It is minted at the claim by whoever claimed
 * the run (`scripts/worker.ts`) and cleared on every terminal transition, so a
 * run without one is a run that is not currently anybody's to drive. Building a
 * control around a null token would produce a client that gets a 403 on its
 * first dispatch and reports it as `not-delivered` — a channel failure standing
 * in for a missing credential, which is the least legible failure available.
 * Absent is better: `perform` records *"this run has no browser to carry it out
 * in"*, which names the actual condition.
 *
 * ── What this does NOT decide ────────────────────────────────────────────
 *
 * Anything about what may be done through it. The gate decides every action,
 * `classifyReversibility` decides what has to be asked about first, and the
 * extension refuses to let a non-`GET` request leave the tab at all. This
 * function decides only whether there is a channel.
 */
function browserFor(input: {
  runId: string
  controlToken: string | null
  allowedActionKinds: readonly string[]
  fetch: typeof globalThis.fetch
}): BrowserDeps | undefined {
  const needsBrowser = input.allowedActionKinds.some((kind) =>
    BROWSER_ACTION_KINDS.has(kind as ActionKind),
  )
  if (!needsBrowser || input.controlToken === null) return undefined

  return {
    control: createBrowserControl({
      appOrigin: appOrigin(),
      runId: input.runId,
      token: input.controlToken,
      fetch: input.fetch,
    }),
  }
}

/**
 * The page the person should be looking at while they decide.
 *
 * ── Why the LAST snapshot is the right one ───────────────────────────────
 *
 * A run halts at its first pause, so the tree it last observed is the tree the
 * proposal was made against — the page the action would have landed on. That
 * only holds because pauses are serial: if a run could ask about a click, carry
 * on navigating, and ask again, the latest snapshot would be a different page
 * and this would show somebody the wrong one.
 *
 * ── Why a screenshot is not preferred, even when there is one ────────────
 *
 * `ConfirmationRequest.evidenceId` is a foreign key from an append-only table,
 * so the sweep can neither delete the row it points at nor clear the pointer —
 * ADR-0010 records that as a permanent retention created by a section headed
 * *retention*, and names screenshots as the rows most likely to be caught by it
 * because a tree being insufficient is exactly what produces one. Pinning the
 * page-snapshot rather than the capture keeps the kept-forever row the cheaper
 * and less revealing of the two, without costing the person anything: the
 * screen renders the tree's attested URL either way.
 *
 * Returns null when the run observed nothing, which the gate makes unreachable
 * for a confirmable kind — `stale_snapshot` refuses a ref against no snapshot —
 * and which is handled anyway, because a question with no picture beside it is
 * far better than no question.
 */
async function lastPageSnapshot(ctx: AppContext, runId: string): Promise<string | null> {
  const rows = await ctx.repos.evidence.forRun(runId)
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i]
    if (row !== undefined && row.kind === 'page-snapshot') return row.id
  }
  return null
}

/**
 * The fence said stop, so the run stopped without writing the intent.
 *
 * A sentinel rather than an ordinary failure, because "another process owns
 * this run now" and "this run crashed" must not produce the same report. It is
 * thrown from inside `recordIntent`, which is the action boundary itself: the
 * intent is committed BEFORE any effect, so refusing to write it is refusing to
 * take the action, and nothing has happened out in the world at that point.
 */
class ClaimFenced extends Error {
  constructor(readonly fenceReason: 'claim-lost' | 'cancel-requested' | 'run-ended') {
    super(`run fenced: ${fenceReason}`)
    this.name = 'ClaimFenced'
  }
}

/** A ledger backed by real rows. The worker writes intents before effects
 *  through this, so a run that dies mid-action still shows what it attempted. */
function ledgerFor(ctx: AppContext, runId: string, fence: RunFence): RunLedger {
  return {
    async recordIntent(input) {
      /**
       * THE action boundary, and the only place the fence needs to be checked.
       *
       * An `ActionIntent` is committed before any effect. So the instant before
       * writing one is the instant before the run does anything out in the
       * world, and a halt landing here lands exactly where ADR-0007 requires:
       * at the next action boundary, never mid-action, never leaving an intent
       * with no outcome.
       *
       * Putting the check in the ledger rather than in the loop is deliberate.
       * The loop can be rewritten, and a check the loop owns is a check the
       * next rewrite can drop; a run physically cannot take an action without
       * coming through here first, because coming through here is what makes an
       * action auditable at all.
       *
       * A lost claim then "aborts WITHOUT writing", in CONTEXT.md's own words.
       * That matters more than it sounds: two workers writing interleaved
       * intents into an append-only ledger under one `AgentRun` cannot be
       * untangled afterwards, and the loser is the one holding stale beliefs
       * about a live page.
       */
      const verdict = await fence.check()
      if (!verdict.proceed) throw new ClaimFenced(verdict.reason)

      const row = await ctx.db.prisma.actionIntent.create({
        data: {
          // The caller's id, not `@default(cuid())`. The gate stamped this onto
          // the `AuthorizedAction` before the row existed, and the browser
          // channel uses it as an idempotency key — so the row has to be the one
          // the token names. See `RunLedger.recordIntent`.
          id: input.id,
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
          // NULL when the authorising run saw the result itself, which is every
          // outcome the loop writes. `'recovery'` arrives here from
          // `recoverOrphanedIntents` — the first writer this column has had
          // since CONTEXT.md specified it.
          ...(input.observedBy === undefined ? {} : { observedBy: input.observedBy }),
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
 * The element as it stood on the page the person was looking at.
 *
 * ── Derived, not stored, and that is the whole reason this is cheap ─────
 *
 * `confirmationIdFor` needs the confirmed element's own line of the
 * accessibility tree so a re-render cannot move a yes onto a different
 * control (issue #109). Its docblock used to say that closing this needed
 * *"the request carrying the element's attested identity"* — a column, a
 * migration and a new schema word. It does not.
 * `ConfirmationRequest.evidenceId` has always pointed at the page-snapshot
 * the person was shown, and `ActionEvidence.untrusted.text` is that tree.
 * So the line is read back out of the row that already exists.
 *
 * ── Sanitised against sanitised ────────────────────────────────────────
 *
 * The stored tree is what `datamark` made of what the extension sent, not
 * what the extension sent. The live tree the continuation holds is raw. So
 * the caller sanitises the live one through the same door before extracting
 * from it — see `worker-loop.ts` — and the two sides are then the same
 * function of the same kind of input. Comparing a sanitised line against a
 * raw one would fail on nothing more than a stripped zero-width character,
 * and would fail in the direction that asks a person the same question
 * twice.
 *
 * ── Null is an answer and it means no ──────────────────────────────────
 *
 * A request with no evidence, a screen-capture rather than a tree, an
 * `untrusted` shape this cannot read: each returns null, and null on either
 * side of the comparison refuses the match. That costs one extra question on
 * a state the gate already makes unreachable for a confirmable kind, and it
 * is the only direction worth failing in.
 */
async function confirmedDescriptor(
  ctx: AppContext,
  requestId: string,
  ref: unknown,
): Promise<string | null> {
  if (typeof ref !== 'string' || ref === '') return null

  const request = await ctx.db.prisma.confirmationRequest.findUnique({
    where: { id: requestId },
    select: { evidence: { select: { kind: true, untrusted: true } } },
  })

  const evidence = request?.evidence
  if (!evidence || evidence.kind !== 'page-snapshot') return null

  const untrusted = evidence.untrusted as { text?: unknown } | null
  return descriptorFor(untrusted?.text, ref)
}

/**
 * Everything this contract's runs have already committed, oldest first.
 *
 * ── Why it is a query here rather than a repository method ───────────────
 *
 * `ledgerFor` above already reaches `ctx.db.prisma` directly for the same three
 * tables, and for the same reason: this is the run spine's own private view of
 * the ledger, not a shape any screen renders. A repository method would be a
 * second public surface over rows whose only consumer is `historyForContract`,
 * and the repositories are shared with the UI — a query added there tends to
 * grow readers who then need it to mean something slightly different.
 *
 * The ORDER is this function's promise, not the rebuilder's. `createdAt` then
 * `seq`: runs are sequential under one contract, `seq` is unique per run, and
 * `createdAt` on an append-only table is monotonic within a run. Sorting by
 * `seq` alone would interleave a continuation's first action with its
 * predecessor's first action, which would tell the model it did things in an
 * order it did not.
 */
function historyReaderFor(ctx: AppContext): HistoryReader {
  return {
    async intentsForContract(contractId) {
      const rows = await ctx.db.prisma.actionIntent.findMany({
        where: { run: { contractId } },
        orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }],
        select: {
          id: true,
          runId: true,
          seq: true,
          kind: true,
          reason: true,
          authorized: true,
          refusedRule: true,
          outcome: { select: { result: true, scopeVerdict: true, detail: true } },
        },
      })

      return rows.map((row) => ({
        id: row.id,
        runId: row.runId,
        seq: row.seq,
        kind: row.kind,
        reason: row.reason,
        authorized: row.authorized,
        refusedRule: row.refusedRule,
        outcome: row.outcome
          ? {
              result: row.outcome.result,
              scopeVerdict: row.outcome.scopeVerdict,
              detail: row.outcome.detail,
            }
          : null,
      }))
    },

    /**
     * The confirmations a human answered YES to, paired with what they covered.
     *
     * -- Two helpers, and why both --------------------------------------
     *
     * `confirmedRequestIdsFor` is the membership set the gate checks.
     * `confirmationForIntent` is the deterministic injection point: it walks
     * from a REFUSED intent to the request a person answered about it. Both are
     * contract-scoped on purpose -- the yes is answered against the run that
     * asked and honoured by the continuation, so a run-scoped lookup would lose
     * it at exactly the moment it is needed.
     *
     * Only `confirmed` counts in either. A rejected verdict and an absent one
     * are indistinguishable here on purpose: all three mean *not permitted*, and
     * **expiry never approves**, because an unanswered request has no verdict
     * row and time does not write rows.
     *
     * The refused intent's own `kind` and `params` ride along because they are
     * what the person was SHOWN -- the question was built by code from attested
     * facts about that intent -- so `confirmationIdFor` can require a proposal
     * to match it before attaching the id.
     *
     * The walk covers this contract's refused intents only, and runs at all only
     * when something is confirmed, so the common case is one query returning
     * nothing.
     */
    async confirmationsForContract(contractId) {
      const confirmedIds = await confirmedRequestIdsFor(ctx, contractId)
      if (confirmedIds.size === 0) return []

      const refused = await ctx.db.prisma.actionIntent.findMany({
        where: { run: { contractId }, authorized: false },
        orderBy: [{ createdAt: 'asc' }, { seq: 'asc' }],
        select: { id: true, kind: true, params: true },
      })

      const covered: ConfirmedAction[] = []
      for (const intent of refused) {
        const requestId = await confirmationForIntent(ctx, intent.id)
        if (requestId === null || !confirmedIds.has(requestId)) continue

        const params = (intent.params ?? {}) as Record<string, unknown>

        covered.push({
          requestId,
          intentId: intent.id,
          kind: intent.kind,
          params,
          descriptor: await confirmedDescriptor(ctx, requestId, params['ref']),
        })
      }
      return covered
    },
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

  /**
   * The deadline is DERIVED, never stored — a crash-restart loop must not be
   * able to silently reset the budget — and it now includes confirmation waits.
   *
   * ── Why the two clocks had to be reconciled here ─────────────────────────
   *
   * `admitRun` lets a continuation into the loop when its CREDITED deadline is
   * still ahead. If this line then computed `acceptedAt + timeLimit` without the
   * credit, the run would be admitted and every proposal inside it refused with
   * `budget_exhausted` — a shift accepted at 09:00 for thirty minutes, asked at
   * 09:05, answered at 09:35, admitted against 10:00 and then starved against
   * 09:30. That is precisely the failure `continuation.ts` names as the worst
   * of its options: a run that appears to resume and then silently does
   * nothing, with the only evidence being refusal rows written in the gate's
   * vocabulary rather than the person's.
   *
   * `creditedDeadlineFor` sums immutable `(requestedAt, decidedAt)` pairs, so
   * this stays a pure function of durable timestamps and recomputes to the same
   * number after any number of restarts — the property the missing `deadlineAt`
   * field was protecting. It falls back to the uncredited value only when the
   * contract has no `acceptedAt`, which is the same case the old line guessed
   * at with the clock.
   */
  const acceptedAt = contract.acceptedAt?.getTime() ?? deps.now()
  const deadlineEpochMs =
    (await creditedDeadlineFor(ctx, contract.id)) ?? acceptedAt + contract.timeLimitMinutes * 60_000

  const job: WorkerJob = {
    runId,
    // The unit of history and of both blast-radius caps. A confirmation pause
    // ends one run and starts another under the same contract, so anything
    // counted per run would reset every time somebody was asked a question.
    contractId: contract.id,
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
      ledger: ledgerFor(ctx, runId, deps.fence),
      readSource: {
        fetcher: allowlisted(
          deps.fetcher,
          workspace.sources.map((s) => s.originPattern),
        ),
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
      /**
       * The hands, when this contract granted any.
       *
       * This is ADR-0010's middle. Both ends of the control channel existed —
       * the five `/api/act/*` routes are live and `createBrowserControl` is the
       * client — and nothing held it, so the app could hand out instructions
       * nobody had written and the routes could have been deleted with every
       * test still green. `tests/reachability.test.ts` asserted that absence on
       * purpose; this is the line that makes the assertion move.
       *
       * `elementEvidence` is deliberately NOT supplied beside it, and that is
       * the safe direction rather than an omission. With no lookup the gate sees
       * `null`, `classifyReversibility` escalates, and every `click-element`,
       * `type-text` and `press-key` stops and asks the person. Wiring the
       * extraction up makes the pause QUIETER; there is no input to it that can
       * turn `requires-confirmation` back into `ordinary`. Building the thing
       * that removes confirmations in the same change that first grants the
       * capability is exactly the erosion ADR-0010 warns arrives as an
       * improvement, so it stays for the unit that owns the snapshot map.
       */
      ...(() => {
        const browser = browserFor({
          runId,
          controlToken: run.controlToken,
          allowedActionKinds: contract.allowedActionKinds,
          fetch: deps.fetch ?? globalThis.fetch,
        })
        return browser === undefined ? {} : { browser }
      })(),
      // Resume, crash recovery and the startup sweep all read the same rows
      // through this. See `src/runtime/history.ts` for why there is one path and
      // not three.
      history: historyReaderFor(ctx),
      now: deps.now,
      renewLease: (id) => ctx.repos.runs.renewLease(id, new Date(deps.now() + 60_000)),
    })
  } catch (error) {
    /**
     * A fenced run is not a failed run, and must not be reported as one.
     *
     * Three endings, three different sentences, and the difference is what the
     * person actually did.
     */
    if (error instanceof ClaimFenced) {
      // Another process holds the claim. Abort WITHOUT WRITING — not the
      // status, not a report, not anything. The row belongs to the winner now,
      // and the loser's last useful act is to touch nothing.
      if (error.fenceReason === 'claim-lost') return

      if (error.fenceReason === 'cancel-requested') {
        await ctx.db.prisma.agentRun.update({
          where: { id: runId },
          data: {
            status: 'interrupted',
            terminalReason: 'cancelled',
            endedAt: new Date(deps.now()),
            // The browser credential dies with the run. `haltRun` already
            // revoked it on the app side; doing it again here means the
            // property holds even for a stop that never went through the app —
            // Chrome's own infobar Cancel, which is not ours to intercept.
            controlToken: null,
          },
        })
      }

      /**
       * Settle anything the run left in flight, now that it is terminal.
       *
       * The stop landed at an action boundary, so ordinarily there is nothing:
       * the intent that would have been abandoned is the one that was never
       * written. It runs anyway because the OTHER kill switches — Chrome's
       * infobar, the tab overlay chip — remove the capability mid-action and do
       * not come through here at all, and a run cancelled just after one of
       * those really can have an intent with no outcome.
       */
      await settleAbandonedIntents(ctx, runId)

      await writeReport(
        ctx,
        contract.id,
        error.fenceReason === 'cancel-requested'
          ? 'You stopped me, so I put everything down where it was.'
          : 'Something else ended this before I finished.',
        [],
      )
      await ctx.repos.sessions.markObserving(contract.sessionId)
      return
    }

    await ctx.repos.runs.complete(runId, 'failed', new Date(deps.now()), 'error')
    await writeReport(
      ctx,
      contract.id,
      null,
      [],
      error instanceof Error ? error.message : String(error),
    )
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

  /**
   * The run stopped to ask, so it parks rather than finishes.
   *
   * ── ADR-0010 §5, in the order it gives ───────────────────────────────────
   *
   * The refused `ActionIntent` is already written and committed — the loop did
   * that before returning — so the row this request points at is on disk. Here
   * the question is written, and the run ends `awaiting-confirmation`, which
   * `runs.complete` treats as terminal and which clears the control token: a run
   * parked overnight on a question must not still hold a credential that drives
   * a browser. If the person says yes, `confirmRequest` enqueues a NEW
   * `AgentRun` carrying `resumesRunId`, and it mints its own.
   *
   * **Nothing is rewritten and no row changes.** At this moment the truth is
   * *it asked, and it was not yet allowed*, and that is what the ledger says. A
   * design that reached back and turned the refusal into an approval would be
   * deleting the only evidence a human was ever consulted, on the exact action
   * where that evidence matters most.
   *
   * ── The three things this deliberately does not do ───────────────────────
   *
   * **No `ShiftReport`.** `awaiting-confirmation` takes no `terminalReason`
   * because there is nothing terminal to explain — the `ConfirmationRequest` IS
   * the explanation. The report gets written when the pause resolves badly:
   * `expireConfirmations` after a day, `admitRun` when the answer arrived past
   * the credited deadline.
   *
   * **No `markObserving`.** The session stays `away`, which ADR-0010's own risk
   * list settles: *"`SessionPhase` has no honest value for a confirmation
   * pause… Keeping `away` is the smaller lie."* It is still a lie and it is
   * still written down there rather than smoothed over here.
   *
   * **No reviewer pass.** A second pass over half a shift's work would judge a
   * production the continuation is still adding to. `ReviewFinding` is
   * display-only and cannot block anything, so deferring it costs advice on the
   * outcomes this leg produced and nothing else — recorded as a real cost in
   * ADR-0010's amendment rather than left to be discovered.
   *
   * The outcomes themselves ARE recorded, above. `historyForContract` rebuilds
   * turns and counts off durable rows and does not rebuild `produced`, so a
   * paused run that skipped `recordOutcomes` would silently bin whatever it had
   * managed to do before it needed permission.
   */
  if (result.awaiting !== undefined) {
    // Hoisted out of the closure below, because narrowing does not survive one
    // and a `!` inside a transaction that parks a run is the wrong place to be
    // asserting anything.
    const awaiting = result.awaiting
    const evidenceId = await lastPageSnapshot(ctx, runId)

    /**
     * Both writes or neither, because the loop's docblock promises exactly that.
     *
     * `ConfirmationNeeded` in `src/runtime/worker-loop.ts` says why the loop
     * returns this instead of writing it: *"parking the run is one transaction
     * with `runs.complete(…, 'awaiting-confirmation', …)`, which clears the
     * control token, and a loop that could write the request without ending the
     * run could leave a question outstanding against a run still holding a
     * credential and driving a browser."*
     *
     * That was the right property and it was not the one the code had. These
     * were two sequential awaits — `confirmations.create` then `runs.complete` —
     * so a crash, a `SIGKILL` or a lid closing between them produced precisely
     * the state that paragraph names. The claim was worse than the gap: a reader
     * of it was told the window did not exist.
     *
     * The transaction is `raiseAndPark`'s, in the repository, rather than a
     * `$transaction` opened here. `src/persistence/` is the only Prisma
     * consumer, and a park written at this level would have reached around
     * `runs.complete` to write a run status — the one write whose docblock
     * explains why the control token goes with it.
     *
     * `lastPageSnapshot` stays outside, deliberately: it reads an append-only
     * table nothing in the transaction writes to, and pulling it in would hold a
     * write transaction open across a query for no property gained.
     */
    await ctx.repos.confirmations.raiseAndPark({
      runId,
      intentId: awaiting.intentId,
      summary: awaiting.question,
      ...(evidenceId === null ? {} : { evidenceId }),
      endedAt: new Date(deps.now()),
    })
    return
  }

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

  await writeReport(
    ctx,
    contract.id,
    stopLabel,
    result.decisions,
    undefined,
    recorded.dropped,
    result.summary,
  )

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
  contract: {
    id: string
    objective: string
    definitionOfDone: string
    guidance: readonly string[]
  },
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

    /**
     * One counter for every change handle in the prompt, not one per outcome.
     *
     * A per-outcome counter would restart at `C1` under each outcome, and two
     * outcomes each holding a `C1` would put the same handle in the set twice —
     * so the map would keep whichever was written last and every finding citing
     * `C1` would resolve onto that one. One run holds at most one
     * `document-changes` outcome today, because its writer groups every drafted
     * section into one, so the collision is currently unreachable. It is a
     * counter rather than a comment because the thing keeping it unreachable is
     * a grouping decision in a different file.
     */
    let changeHandles = 0

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

      const changes = changeset?.changes.map((change) => {
        changeHandles += 1
        const changeHandle = `C${changeHandles}`
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
          outcomeId: changeId === null ? (outcomeIdByHandle.get(finding.handle) ?? null) : null,
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
  /**
   * What the run said when it declared itself finished.
   *
   * **This is not boundary 6.** `shiftReportBoundary` narrates a whole Shift
   * from the ledger, after the fact, and is still unwired — `tests/
   * reachability.test.ts` asserts that. This is one sentence the worker wrote at
   * the moment it stopped, in the same call where it declined to continue, and
   * it is used only where the narrative would OTHERWISE BE NULL: a run that
   * finished cleanly and hit no stop rule currently produces a blank note, which
   * is the "the software knew something and told no one" shape this file already
   * fixes twice above.
   *
   * It is model prose about model work and nothing branches on it. When boundary
   * 6 lands it narrates from the ledger and this stops being read — which is the
   * right order, because a narrative built from rows can say what happened even
   * when the run died before it could say anything at all.
   */
  finishedSummary?: string,
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
        ? finishedSummary === undefined
          ? lost === ''
            ? null
            : lost.trim()
          : `${finishedSummary}${lost}`
        : `${stopLabel}${lost}`,
    decisions: decisions.map((d, i) => ({
      question: d.question,
      whyStopped: d.whyItMatters,
      needs: 'A decision only you can make.',
      ordinal: i,
    })),
  })
}
