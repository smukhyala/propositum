/**
 * The confirmation pause, and everything that touches durable rows on its
 * behalf.
 *
 * ── Why this is a module and not just server actions ─────────────────────
 *
 * `src/server/actions.ts` is `'use server'`, so every export it carries becomes
 * a callable endpoint. The worker process needs two of the functions below and
 * is a different Node process entirely — it never imports `src/server/db`. So
 * the logic lives here, takes its context as a parameter, and the server
 * actions are a thin human-facing skin over it.
 *
 * ── The one rule everything here is arranged around ──────────────────────
 *
 * **Only a human writes a `ConfirmationVerdict`.** No model, no worker run, no
 * reviewer run, and no timer. The database cannot see who is holding the
 * keyboard, so the rule is enforced by there being exactly one writer —
 * `recordVerdict` on the confirmations repository — reached from exactly two
 * functions here, both of which are called only from a page the person is
 * looking at.
 *
 * `expireConfirmations` is in this file precisely so the contrast is visible:
 * it is the one thing here that runs on elapsed time, and it writes NO VERDICT
 * AT ALL. An expired request keeps its absence, the gate sees the same nothing
 * it saw before anybody was asked, and refuses. There is no code path from
 * elapsed time to permission because there is no value for elapsed time to
 * write.
 *
 * ── The refusal stays a refusal ──────────────────────────────────────────
 *
 * At 15:04 the gate refused a click on *Send* because it needed the person. At
 * 18:30 the person said yes. At 18:30 a NEW run proposed the same click and it
 * was allowed. That is two `ActionIntent` rows — one refused, one allowed —
 * both true, neither rewritten, and nothing here ever reaches back to mutate
 * the first. A design that turned the refusal into an approval would be
 * deleting the only evidence that a human was ever consulted, on the exact
 * action where that evidence matters most.
 *
 * ── The continuation is a new run, not a re-claim ────────────────────────
 *
 * `enqueue` and `claim` are used unchanged. The old run's ledger is closed, and
 * a crash between the person's yes and the worker picking the run up leaves an
 * ordinary `pending` row that the ordinary recovery path drains. Nothing is
 * replayed, because there is nothing to replay: the loop holds no memory of its
 * own and rebuilds from the ledger.
 */

import type { PrismaClient } from '@prisma/client'

import type { AppContext } from './db'
import { deadlineFor } from '../domain/execution/stop-conditions'
import {
  ANSWERED_TOO_LATE_REPORT,
  CONFIRMATION_EXPIRED,
  CONFIRMATION_EXPIRED_REPORT,
  admitContinuation,
  confirmationHasExpired,
} from '../domain/execution/continuation'

/**
 * Everything this module needs from the world.
 *
 * `AppContext` satisfies it, and so does a hand-built object in a test. Taking
 * the narrower shape rather than `AppContext` itself is what lets the worker
 * process — which builds its own database handle and never touches the Next
 * process's memoised one — call the same functions.
 */
export interface ConfirmationContext {
  readonly db: { readonly prisma: PrismaClient }
  readonly repos: AppContext['repos']
}

/* ── the credited deadline ──────────────────────────────────────────────── */

/**
 * When this contract's shift actually ends, with confirmation waits credited.
 *
 * Every term is an immutable timestamp on a durable row — `acceptedAt` on the
 * contract, and a `(createdAt, decidedAt)` pair per ANSWERED confirmation — so
 * this recomputes to the identical number after any number of restarts. That is
 * the property `EnforcedPolicy`'s missing `deadlineAt` field was protecting,
 * and it is why summing pauses does not reintroduce the thing that was banned.
 *
 * An OPEN pause credits nothing. It has no `decidedAt`, so there is no pair to
 * sum, and reaching for the clock to close one would make this function
 * time-dependent — the exact property that would break the restart guarantee.
 * The direction is also the correct one: an unanswered question must not buy a
 * run more time than an answered one.
 *
 * Returns `null` for a contract nobody accepted. There is no shift, so there is
 * no deadline, and inventing one from `createdAt` would give an unratified
 * contract a budget.
 */
export async function creditedDeadlineFor(
  ctx: ConfirmationContext,
  contractId: string,
): Promise<number | null> {
  const contract = await ctx.db.prisma.handoffContract.findUnique({
    where: { id: contractId },
    select: { acceptedAt: true, timeLimitMinutes: true },
  })
  if (!contract?.acceptedAt) return null

  const answered = await ctx.db.prisma.confirmationRequest.findMany({
    where: { run: { contractId }, verdict: { isNot: null } },
    select: { createdAt: true, verdict: { select: { decidedAt: true } } },
  })

  const pauses: Array<{ requestedAtEpochMs: number; decidedAtEpochMs: number }> = []
  for (const request of answered) {
    const decidedAt = request.verdict?.decidedAt
    if (!decidedAt) continue
    pauses.push({
      requestedAtEpochMs: request.createdAt.getTime(),
      decidedAtEpochMs: decidedAt.getTime(),
    })
  }

  return deadlineFor({
    acceptedAtEpochMs: contract.acceptedAt.getTime(),
    timeLimitMinutes: contract.timeLimitMinutes,
    pauses,
  })
}

/* ── what the person is answering ───────────────────────────────────────── */

/** The attested and page-authored halves of one request, kept apart. */
export interface ConfirmationView {
  readonly id: string
  readonly runId: string
  readonly contractId: string
  /** Code-generated from attested facts. Never model prose. */
  readonly summary: string
  readonly askedAt: Date
  /** `confirmed` · `rejected` · `null` when nobody has answered. */
  readonly verdict: string | null
  /** True once the question is older than `CONFIRMATION_EXPIRY_HOURS`. */
  readonly expired: boolean
  /** Past its shift's credited deadline — so answering yes will be honoured as
   *  a yes and the continuation will still stop. Said on the screen, before
   *  they press anything. */
  readonly pastDeadline: boolean
  /** What the browser attested about where this would land. */
  readonly attested: {
    readonly origin: string | null
    readonly url: string | null
    readonly method: string | null
    readonly tabTitle: string | null
    readonly actionKind: string
  }
  /** Verbatim, because "type this into that box" is only a meaningful question
   *  if the person can read the this. */
  readonly typedText: string | null
  /** Page-authored. Rendered as an attributed quotation and nothing else. */
  readonly elementName: string | null
  readonly evidenceId: string | null
  readonly hasImage: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function textOf(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/**
 * The element's accessible name, out of whichever shape the capture unit wrote.
 *
 * Two shapes are read because two exist upstream: `classifyReversibility` takes
 * `accessibleNameTokens`, and a snapshot writer may reasonably store the whole
 * name. Both are PAGE-AUTHORED and neither is trusted for anything — the value
 * reaches exactly one place, an attributed quotation on the screen, and there
 * is deliberately no path from it into anything the machine then acts on.
 */
function elementNameOf(untrusted: unknown): string | null {
  const record = asRecord(untrusted)

  const whole = textOf(record, 'accessibleName')
  if (whole !== null) return whole

  const tokens = record['accessibleNameTokens']
  if (Array.isArray(tokens)) {
    const words: string[] = []
    for (const token of tokens) {
      if (typeof token === 'string' && token.trim().length > 0) words.push(token.trim())
    }
    if (words.length > 0) return words.join(' ')
  }

  return null
}

/**
 * One request, assembled for the screen.
 *
 * Reads `prisma` directly rather than through a repository, for the reason the
 * shift page already gives: there is no reader for `ActionIntent` and the
 * intent's `params` ARE the question — the verbatim text and the target are
 * what the person is being asked about. Everything still goes through
 * `appContext`, so the append-only guards are verified before this can read
 * anything.
 */
export async function confirmationView(
  ctx: ConfirmationContext,
  requestId: string,
  nowEpochMs: number,
): Promise<ConfirmationView | null> {
  const row = await ctx.db.prisma.confirmationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      runId: true,
      summary: true,
      createdAt: true,
      evidenceId: true,
      verdict: { select: { verdict: true } },
      run: { select: { contractId: true } },
      intent: { select: { kind: true, params: true } },
      evidence: { select: { url: true, untrusted: true, image: true } },
    },
  })
  if (!row) return null

  const params = asRecord(row.intent.params)
  const untrusted = row.evidence?.untrusted ?? null

  const attestedUrl = row.evidence?.url ?? null
  let origin: string | null = null
  if (attestedUrl !== null) {
    try {
      origin = new URL(attestedUrl).origin
    } catch {
      // A stored URL that will not parse is a curiosity, not a reason to fail
      // the screen. The person still sees the summary, the text and the image.
      origin = null
    }
  }

  const creditedDeadline = await creditedDeadlineFor(ctx, row.run.contractId)

  return {
    id: row.id,
    runId: row.runId,
    contractId: row.run.contractId,
    summary: row.summary,
    askedAt: row.createdAt,
    verdict: row.verdict?.verdict ?? null,
    expired: confirmationHasExpired({
      requestedAtEpochMs: row.createdAt.getTime(),
      nowEpochMs,
    }),
    pastDeadline: creditedDeadline !== null && nowEpochMs >= creditedDeadline,
    attested: {
      origin,
      url: attestedUrl,
      // The method is browser-attested — Chrome describing a request it is
      // holding — so it is read off the intent the gate saw and never off the
      // page. Absent until the network mechanism writes it; absent renders as
      // absent rather than as a guess.
      method: textOf(params, 'method'),
      tabTitle: textOf(asRecord(untrusted), 'title'),
      actionKind: row.intent.kind,
    },
    typedText: textOf(params, 'inputText'),
    elementName: elementNameOf(untrusted),
    evidenceId: row.evidenceId,
    hasImage: (row.evidence?.image?.length ?? 0) > 0,
  }
}

/* ── the two human answers ──────────────────────────────────────────────── */

export type AnswerResult =
  | { readonly ok: true; readonly continuationRunId: string | null }
  | {
      readonly ok: false
      readonly reason: 'not-found' | 'already-answered' | 'expired'
    }

/**
 * The person said yes.
 *
 * **This is one of exactly two functions that write a `ConfirmationVerdict`,
 * and both are reached only from a screen a human is looking at.** If you are
 * here because a run needs to resolve its own confirmation, stop: that is the
 * feature this whole mechanism exists to not have.
 *
 * Order matters and is the safe one. The verdict is written FIRST and the
 * continuation is enqueued second, so a crash between them leaves a recorded
 * yes with no run — which the person can act on by handing the work over again
 * — rather than a run authorised by a yes that was never recorded.
 */
export async function confirmRequest(
  ctx: ConfirmationContext,
  requestId: string,
  now: Date,
): Promise<AnswerResult> {
  const request = await ctx.db.prisma.confirmationRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      runId: true,
      createdAt: true,
      verdict: { select: { verdict: true } },
      run: { select: { contractId: true } },
    },
  })
  if (!request) return { ok: false, reason: 'not-found' }
  if (request.verdict) return { ok: false, reason: 'already-answered' }

  /**
   * Expiry refuses the yes rather than converting it into one.
   *
   * Note which direction this fails in. An expired request cannot be confirmed
   * — the answer arrives too late to be an answer — and the row that does NOT
   * get written is the permission. The opposite arrangement, where expiry
   * quietly becomes a yes to unblock a stuck run, is the failure mode this
   * feature exists to prevent, and it would arrive as a two-line change.
   */
  if (confirmationHasExpired({ requestedAtEpochMs: request.createdAt.getTime(), nowEpochMs: now.getTime() })) {
    return { ok: false, reason: 'expired' }
  }

  await ctx.repos.confirmations.recordVerdict({ requestId, verdict: 'confirmed', decidedAt: now })

  /**
   * A NEW run, not a re-claim of the paused one.
   *
   * `enqueue` and `claim` are used exactly as every other run uses them, so the
   * continuation inherits the whole recovery path for free: a crash right here
   * leaves a `pending` row the worker picks up on its next poll, identical to
   * every other interrupted enqueue. Re-claiming the old run would need a
   * second mechanism for reviving a row that has already ended, and would put
   * two runs' actions under one `AgentRun` in an append-only ledger.
   *
   * The control token is minted fresh. A continuation drives the browser, and
   * reusing the paused run's token would mean a credential outliving the run it
   * was issued to — which is how a stale worker comes to hold a live one.
   */
  const continuation = await ctx.repos.runs.enqueue({
    contractId: request.run.contractId,
    role: 'worker',
    controlToken: globalThis.crypto.randomUUID(),
    resumesRunId: request.runId,
  })

  return { ok: true, continuationRunId: continuation.id }
}

/**
 * The person said no.
 *
 * A `rejected` verdict and nothing else. No continuation is enqueued, because
 * there is nothing to continue — the run that asked has already ended, and the
 * action it wanted was refused and stays refused.
 *
 * The absence of a row and a `rejected` row are identical to the gate and
 * different in the report: one says *"you said no"*, the other says *"I asked
 * and you never saw it"*. That distinction is the whole reason a rejection
 * writes a row at all.
 */
export async function rejectRequest(
  ctx: ConfirmationContext,
  requestId: string,
  now: Date,
): Promise<AnswerResult> {
  const request = await ctx.db.prisma.confirmationRequest.findUnique({
    where: { id: requestId },
    select: { id: true, verdict: { select: { verdict: true } } },
  })
  if (!request) return { ok: false, reason: 'not-found' }
  if (request.verdict) return { ok: false, reason: 'already-answered' }

  // Deliberately NOT gated on expiry. Saying no to a stale question is a
  // decision worth recording — it is the difference between "you said no" and
  // "you never saw it" in the report — and it grants nothing, so the reason to
  // refuse a late yes does not apply to a late no.
  await ctx.repos.confirmations.recordVerdict({ requestId, verdict: 'rejected', decidedAt: now })

  return { ok: true, continuationRunId: null }
}

/* ── the report, written once ───────────────────────────────────────────── */

/**
 * Write the re-entry note, unless the shift already has one.
 *
 * One `ShiftReport` per contract, enforced by a unique column. This checks
 * first rather than catching, so a shift that already has a report keeps the
 * one it has: a later note overwriting an earlier one would lose whatever the
 * first run needed to say.
 */
async function writeReportOnce(
  ctx: ConfirmationContext,
  contractId: string,
  narrative: string,
): Promise<void> {
  const existing = await ctx.repos.reports.forContract(contractId)
  if (existing) return
  await ctx.repos.reports.create({ contractId, narrative, decisions: [] })
}

/* ── admission: the coordinator's decision, implemented ─────────────────── */

/**
 * May this claimed run enter the worker loop?
 *
 * ── The decision this implements ─────────────────────────────────────────
 *
 * Expiry is 24 hours; pause credit is capped at 240 minutes; **the two are
 * allowed to disagree.** Somebody who answers at six in the evening a question
 * asked at nine in the morning has given a valid yes into a shift whose time is
 * gone. What happens then was decided explicitly: **tell them plainly and
 * stop.**
 *
 * So the check happens HERE, before the loop, and not as a `budget_exhausted`
 * refusal inside it. The person must never see a run that appears to resume and
 * then silently does nothing — and a run that enters the loop, plans, proposes
 * and is refused looks exactly like that from the outside. The time limit stays
 * a real bound they set, which is the whole reason this was chosen over
 * crediting the full wait.
 *
 * ── Why only continuations are checked ───────────────────────────────────
 *
 * A first run past its deadline is the ordinary `budget-exhausted` path and has
 * a report of its own; nothing here should change what it does. A continuation
 * is different in kind: the person did something — they answered a question —
 * and the outcome of that act has to be legible to them.
 */
export async function admitRun(
  ctx: ConfirmationContext,
  runId: string,
  now: Date,
): Promise<'proceed' | 'settled'> {
  const run = await ctx.db.prisma.agentRun.findUnique({
    where: { id: runId },
    select: { id: true, contractId: true, resumesRunId: true },
  })
  if (!run) return 'settled'
  if (run.resumesRunId === null) return 'proceed'

  const deadline = await creditedDeadlineFor(ctx, run.contractId)
  if (deadline === null) return 'proceed'

  const admission = admitContinuation({
    nowEpochMs: now.getTime(),
    creditedDeadlineEpochMs: deadline,
  })
  if (admission.admit) return 'proceed'

  // Completed as `interrupted`, not `failed`. Nothing went wrong: a bound the
  // person set was reached before their answer arrived, and a `failed` run
  // would put an error where an explanation belongs.
  await ctx.db.prisma.agentRun.update({
    where: { id: runId },
    data: { status: 'interrupted', terminalReason: admission.terminalReason, endedAt: now },
  })

  await writeReportOnce(ctx, run.contractId, admission.report)

  return 'settled'
}

/* ── expiry: the one thing here that runs on the clock ──────────────────── */

/**
 * Stop waiting for answers nobody gave.
 *
 * **Writes no `ConfirmationVerdict`, ever.** Read that again before changing
 * anything below. An expired request keeps its absence: the gate sees the same
 * nothing it saw before the question was asked, and refuses. There is no value
 * this could write that would mean "expired" — `ConfirmationVerdict` has two
 * members and both are decisions a human made — and adding a third to make this
 * function tidier would put a code path between elapsed time and permission.
 *
 * What it does write is the run's ending: `interrupted` with
 * `confirmation-expired`, plus a report saying what was asked and that nothing
 * happened. Without that, a shift with an unanswered question sits in
 * `awaiting-confirmation` forever and the person's re-entry screen never
 * arrives.
 *
 * Returns how many runs it settled, so a caller can log it.
 */
export async function expireConfirmations(ctx: ConfirmationContext, now: Date): Promise<number> {
  const open = await ctx.db.prisma.confirmationRequest.findMany({
    where: { verdict: { is: null } },
    select: { id: true, runId: true, createdAt: true, run: { select: { contractId: true, status: true } } },
  })

  let settled = 0
  for (const request of open) {
    if (!confirmationHasExpired({ requestedAtEpochMs: request.createdAt.getTime(), nowEpochMs: now.getTime() })) {
      continue
    }
    // Only a run still parked on the question. A run that already ended for
    // another reason keeps the reason it ended for — the question expiring
    // afterwards does not retell the story of why it stopped.
    if (request.run.status !== 'awaiting-confirmation') continue

    await ctx.db.prisma.agentRun.update({
      where: { id: request.runId },
      data: { status: 'interrupted', terminalReason: CONFIRMATION_EXPIRED, endedAt: now },
    })
    await writeReportOnce(ctx, request.run.contractId, CONFIRMATION_EXPIRED_REPORT)
    settled += 1
  }

  return settled
}

/* ── the kill switch's ledger half ──────────────────────────────────────── */

/**
 * Record an outcome for an action nobody came back to.
 *
 * ── Why the APP writes this and the worker does not ──────────────────────
 *
 * ADR-0007 requires halts to land at the next action boundary, because an
 * abandoned action leaves an `ActionIntent` with no `ActionOutcome` — a state
 * indistinguishable from a crash and reported as `unknown` when we know exactly
 * what happened. ADR-0010's kill switches detach the debugger BEFORE telling
 * the app, which can happen mid-action, and that reads like a violation.
 *
 * It is not, because **detaching is not a halt.** A halt is a decision the run
 * makes and acts on; detaching is the removal of the capability the run was
 * using, and it has to work when the run cannot be trusted to make decisions —
 * so it cannot wait for a POST to land. The property ADR-0007 protects is that
 * an abandoned action never leaves an intent with no outcome, and that property
 * is preserved by moving the WRITER: not the abandoning worker, which is gone,
 * but the app, here, on the next return or on the startup sweep.
 *
 * ── What it may claim ────────────────────────────────────────────────────
 *
 * `observedBy: 'recovery'` in the ADR-0003 sense: it may only record what it
 * can prove, and it may never infer. It cannot prove the click landed and it
 * cannot prove it did not, so it records `scopeVerdict: 'unverified'` — "an
 * effect may have landed and no check ran" — and `result: 'failed'`.
 *
 * That `failed` deserves its objection stated, because it IS a claim and it may
 * be wrong: the *Send* may well have gone through. The alternative is worse.
 * `succeeded` is the value the rest of the system treats as work done — a
 * `ShiftOutcome` may cite it, a report may count it — and claiming an
 * unobserved effect succeeded is the direction that lets an unverified act be
 * reported as an ordinary one. The honesty lives in `unverified` and in the
 * detail line, which say plainly that nobody looked.
 *
 * Returns how many intents it settled.
 */
export async function settleAbandonedIntents(
  ctx: ConfirmationContext,
  runId: string,
): Promise<number> {
  const abandoned = await ctx.db.prisma.actionIntent.findMany({
    where: { runId, authorized: true, outcome: { is: null } },
    select: { id: true },
  })

  for (const intent of abandoned) {
    await ctx.db.prisma.actionOutcome.create({
      data: {
        intentId: intent.id,
        result: 'failed',
        scopeVerdict: 'unverified',
        detail: 'Propositum stopped before it could see what happened.',
        observedBy: 'recovery',
      },
    })
  }

  return abandoned.length
}

/**
 * The startup-sweep half of the same job.
 *
 * ADR-0010 says the outcome for an abandoned action is written by the app "on
 * the next return or on the startup sweep". This is the second of those: a
 * worker that was killed mid-click — by the lid closing, by the person pressing
 * Cancel on Chrome's infobar, by anything — left an intent with no outcome, and
 * the process that could have written one is gone.
 *
 * Scoped to runs in a terminal status. A LIVE run's intent with no outcome is
 * not abandoned, it is IN FLIGHT, and settling it would race the run that is
 * about to write the real thing — producing a `recovery` row for an action that
 * completed normally, which is a lie in the direction of alarm.
 */
export async function sweepAbandonedIntents(ctx: ConfirmationContext): Promise<number> {
  const stranded = await ctx.db.prisma.actionIntent.findMany({
    where: {
      authorized: true,
      outcome: { is: null },
      run: { status: { in: ['succeeded', 'failed', 'interrupted', 'awaiting-confirmation'] } },
    },
    select: { id: true },
  })

  for (const intent of stranded) {
    await ctx.db.prisma.actionOutcome.create({
      data: {
        intentId: intent.id,
        result: 'failed',
        scopeVerdict: 'unverified',
        detail: 'Propositum stopped before it could see what happened.',
        observedBy: 'recovery',
      },
    })
  }

  return stranded.length
}

/* ── what the extension asks about ──────────────────────────────────────── */

export interface PendingConfirmation {
  readonly requestId: string
  readonly contractId: string
  /** Code-generated from attested facts. Safe to put in a notification because
   *  no page wrote it. */
  readonly summary: string
  readonly askedAtMs: number
}

/**
 * The oldest question nobody has answered, or null.
 *
 * One at a time, deliberately. A notification per open request would be a queue
 * of interruptions, and the person can only look at one screen anyway — the
 * next one surfaces when this one is answered.
 *
 * Expired requests are excluded. Interrupting somebody about a question that
 * can no longer be answered is the worst kind of notification: it asks for an
 * act that will be refused.
 */
export async function oldestPendingConfirmation(
  ctx: ConfirmationContext,
  nowEpochMs: number,
): Promise<PendingConfirmation | null> {
  const rows = await ctx.db.prisma.confirmationRequest.findMany({
    where: { verdict: { is: null }, run: { status: 'awaiting-confirmation' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, summary: true, createdAt: true, run: { select: { contractId: true } } },
    take: 10,
  })

  for (const row of rows) {
    if (confirmationHasExpired({ requestedAtEpochMs: row.createdAt.getTime(), nowEpochMs })) continue
    return {
      requestId: row.id,
      contractId: row.run.contractId,
      summary: row.summary,
      askedAtMs: row.createdAt.getTime(),
    }
  }

  return null
}
