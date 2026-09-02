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
import { CONFIRMATION_EXPIRY_HOURS, deadlineFor } from '../domain/execution/stop-conditions'
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

type Pause = { requestedAtEpochMs: number; decidedAtEpochMs: number }

/** Every answered pause on this contract, as the immutable pairs
 *  `deadlineFor` sums. An open pause has no `decidedAt` and no pair. */
async function answeredPauses(ctx: ConfirmationContext, contractId: string): Promise<Pause[]> {
  const answered = await ctx.db.prisma.confirmationRequest.findMany({
    where: { run: { contractId }, verdict: { isNot: null } },
    select: { createdAt: true, verdict: { select: { decidedAt: true } } },
  })

  const pauses: Pause[] = []
  for (const request of answered) {
    const decidedAt = request.verdict?.decidedAt
    if (!decidedAt) continue
    pauses.push({
      requestedAtEpochMs: request.createdAt.getTime(),
      decidedAtEpochMs: decidedAt.getTime(),
    })
  }
  return pauses
}

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
 * run more time than an answered one. The one caller that needs the projection
 * anyway passes it in explicitly, below.
 *
 * Returns `null` for a contract nobody accepted. There is no shift, so there is
 * no deadline, and inventing one from `createdAt` would give an unratified
 * contract a budget.
 */
export async function creditedDeadlineFor(
  ctx: ConfirmationContext,
  contractId: string,
  /**
   * A pause that has NOT been answered yet, credited as though it were.
   *
   * Used by the confirmation screen and nowhere else. The screen has to answer
   * "if I say yes right now, will the work carry on?", and the pause it is
   * asking about is by definition still open — so the honest projection has to
   * include it. `admitRun` deliberately does NOT pass one: by the time it runs,
   * the verdict is written and the pause is a real answered pair.
   *
   * It cannot make the deadline earlier: `deadlineFor` clamps a negative
   * interval at zero and the sum only ever grows.
   */
  asIfAnswered?: Pause,
): Promise<number | null> {
  const contract = await ctx.db.prisma.handoffContract.findUnique({
    where: { id: contractId },
    select: { acceptedAt: true, timeLimitMinutes: true },
  })
  if (!contract?.acceptedAt) return null

  const pauses = await answeredPauses(ctx, contractId)
  if (asIfAnswered) pauses.push(asIfAnswered)

  return deadlineFor({
    acceptedAtEpochMs: contract.acceptedAt.getTime(),
    timeLimitMinutes: contract.timeLimitMinutes,
    pauses,
  })
}

/* ── what the gate is allowed to know about a yes ───────────────────────── */

/**
 * Which `ConfirmationRequest` ids on this contract carry a `confirmed` verdict.
 *
 * This is the half of the loop that makes a yes mean anything. `authorize()`
 * refuses `confirmation_required` when `params.confirmationId` is absent from
 * `RunContext.confirmedRequestIds`, and until something fills that set, a
 * person's yes buys a continuation that asks the identical question again —
 * which fails safe and reads as *"Propositum ignored my answer"*.
 *
 * ── Read the two rules before wiring this up ─────────────────────────────
 *
 * **A model may never supply a confirmation id.** A model that could name one
 * could confirm its own action, and that is a GRANT — the exact thing
 * "models propose, deterministic code authorizes" forbids. The id must be
 * injected by deterministic code, matched against the refused intent the
 * continuation is picking up. ADR-0007's asymmetry is precise here: a model may
 * always decline, because declining withholds; it may never assert that it has
 * permission.
 *
 * **Scoped to the CONTRACT, not the run.** A confirmation is answered against
 * the run that asked, and honoured by a different run — the continuation. So a
 * run-scoped query would return the empty set for the only run that needs it.
 * The contract is the right boundary because a Shift is one contract, and a
 * yes given inside a Shift belongs to that Shift and to nothing else.
 *
 * Only `confirmed` counts. `rejected` and absent are indistinguishable to the
 * gate on purpose: all three mean "not permitted", and a set that included
 * rejections would turn a no into a yes.
 */
export async function confirmedRequestIdsFor(
  ctx: ConfirmationContext,
  contractId: string,
): Promise<ReadonlySet<string>> {
  const rows = await ctx.db.prisma.confirmationRequest.findMany({
    where: { run: { contractId }, verdict: { verdict: 'confirmed' } },
    select: { id: true },
  })

  const ids = new Set<string>()
  for (const row of rows) ids.add(row.id)
  return ids
}

/**
 * The confirmed request covering one refused intent, if the person said yes.
 *
 * The deterministic injection point. A continuation rebuilds from the ledger,
 * finds the intent its predecessor was refused on, and asks this whether a
 * human authorised it — then puts the id into `params.confirmationId` itself.
 * Nothing a model returns is consulted at any step.
 */
export async function confirmationForIntent(
  ctx: ConfirmationContext,
  intentId: string,
): Promise<string | null> {
  const row = await ctx.db.prisma.confirmationRequest.findUnique({
    where: { intentId },
    select: { id: true, verdict: { select: { verdict: true } } },
  })
  return row?.verdict?.verdict === 'confirmed' ? row.id : null
}

/* ── what the person is answering ───────────────────────────────────────── */

/** The attested and page-authored halves of one request, kept apart. */
export interface ConfirmationView {
  readonly id: string
  readonly runId: string
  readonly contractId: string
  /**
   * The `WorkSession` this contract was handed over from — the address of the
   * ordinary handover flow, and the whole of what #139 needed here.
   *
   * Carried on the view rather than fetched by the page because it costs
   * nothing: `run` is already joined for `contractId` and `status`, so this is
   * one more column on a query that was happening anyway. It is an ADDRESS and
   * not a permission — following it lands on the agreement screen, where a
   * person ratifies a new `HandoffContract` in full. The shift report's
   * *Hand over again* is built from the same fact.
   */
  readonly sessionId: string
  /** Code-generated from attested facts. Never model prose. */
  readonly summary: string
  readonly askedAt: Date
  /** `confirmed` · `rejected` · `null` when nobody has answered. */
  readonly verdict: string | null
  /** True once the question is older than `CONFIRMATION_EXPIRY_HOURS`. */
  readonly expired: boolean
  /**
   * The run that raised this is no longer parked on it, so the question can no
   * longer be confirmed however promptly the person answers.
   *
   * Separate from `expired` because they are different facts and the person is
   * owed the right one: expiry is *"nobody answered in time"*, this is *"the
   * work ended before your answer arrived"*. Neither is a verdict, and a screen
   * that folded them together would tell somebody who answered within a minute
   * that they were too slow.
   *
   * They are not exclusive, and the overlap is the common case rather than the
   * corner: `expireConfirmations` ends the run it settles, so an expired
   * question is unparked a moment later. `unansweredReason` breaks that tie and
   * expiry wins it.
   */
  readonly abandoned: boolean
  /**
   * Even crediting the wait about to be recorded, the shift is over — so
   * answering yes will be honoured as a yes and the work will still not carry
   * on. Said on the screen, before they press anything.
   *
   * Projected WITH this pause credited, not without it. Computed the other way
   * it fired on the ordinary case: a question asked at 09:05 and opened at
   * 09:40 on a thirty-minute shift would warn that the time had run out, and
   * then the verdict would credit the thirty-five minutes and the run would
   * carry on perfectly well. A red warning that is wrong in exactly the
   * situation it was written for is worse than no warning.
   */
  readonly pastDeadline: boolean
  /**
   * What CHROME asserted. Every field here is browser-attested — a page cannot
   * make Chrome report a `POST` as a `GET`.
   *
   * The tab's title is deliberately NOT here, however natural it looks beside
   * the URL: `document.title` is page-authored, a hostile page sets it to
   * whatever reassures, and a value stated flatly in this panel is being
   * offered as something Chrome vouched for.
   */
  readonly attested: {
    readonly origin: string | null
    readonly url: string | null
    readonly method: string | null
    readonly actionKind: string
  }
  /**
   * Verbatim and UNTRIMMED, because "type this into that box" is only a
   * meaningful question if the person can read the this. A trimmed value is a
   * different string from the one about to be typed, and an all-whitespace one
   * that came back as `null` would remove the section entirely — authorising
   * text the screen never showed.
   */
  readonly typedText: string | null
  /** PAGE-AUTHORED, both of them. Rendered as attributed quotations and read
   *  back by nothing. */
  readonly pageAuthored: {
    readonly elementName: string | null
    readonly tabTitle: string | null
  }
  readonly evidenceId: string | null
  readonly hasImage: boolean
}

/**
 * Which of the two closed-without-a-verdict facts the person is told.
 *
 * Both can be true at once, and after the sweep the ordinary day-old question
 * IS both: `expireConfirmations` ends the run it belongs to, so `abandoned`
 * goes true as a consequence of the expiry being noticed. Expiry wins that tie
 * because it came first and explains the other — the work ended BECAUSE nobody
 * answered — and because telling somebody who was a day late that the work
 * stopped would drop the only part they can act on.
 *
 * It is here rather than inline in the page for one reason: `confirmRequest`
 * breaks the same tie the same way, and a `.tsx` server component is the one
 * thing in this repository nothing can assert against. Two sentences about one
 * row is the defect; this is the single place that picks between them.
 *
 * It decides NOTHING. Neither state is a verdict and neither is answerable, so
 * this only chooses a sentence. It is meaningful only where the caller has
 * already established there is no verdict and the question is closed; with both
 * flags false it has nothing to describe and its answer means nothing.
 */
export function unansweredReason(view: {
  readonly expired: boolean
  readonly abandoned: boolean
}): 'expired' | 'abandoned' {
  return view.expired ? 'expired' : 'abandoned'
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
      // `contract.sessionId` is the address of the ordinary handover flow, and
      // it rides the join that was already here for `contractId` and `status`.
      run: {
        select: { contractId: true, status: true, contract: { select: { sessionId: true } } },
      },
      intent: { select: { kind: true, params: true } },
      // `image` is deliberately NOT selected. It is a multi-megabyte PNG and
      // this function only needs to know whether there is one; the page reads
      // the bytes once, when it is about to render them.
      evidence: { select: { id: true, url: true, untrusted: true } },
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

  // Projected as though this pause were answered right now, because that is
  // the question the screen is actually asking on the person's behalf.
  const creditedDeadline = await creditedDeadlineFor(ctx, row.run.contractId, {
    requestedAtEpochMs: row.createdAt.getTime(),
    decidedAtEpochMs: nowEpochMs,
  })

  /**
   * Untrimmed and unnormalised.
   *
   * `textOf` trims, which is right for a label and wrong for this: the screen
   * says "exactly these characters, nothing added and nothing trimmed", and a
   * trailing newline or a leading space that vanished on the way here makes
   * that sentence false about the one value it is written about.
   */
  const rawInput = params['inputText']
  const typedText = typeof rawInput === 'string' ? rawInput : null

  return {
    id: row.id,
    runId: row.runId,
    contractId: row.run.contractId,
    sessionId: row.run.contract.sessionId,
    summary: row.summary,
    askedAt: row.createdAt,
    verdict: row.verdict?.verdict ?? null,
    expired: confirmationHasExpired({
      requestedAtEpochMs: row.createdAt.getTime(),
      nowEpochMs,
    }),
    // The same test `confirmRequest` applies, read off the same column, so the
    // screen cannot offer a button the answer path would turn down.
    abandoned: row.run.status !== 'awaiting-confirmation',
    pastDeadline: creditedDeadline !== null && nowEpochMs >= creditedDeadline,
    attested: {
      origin,
      url: attestedUrl,
      // The method is browser-attested — Chrome describing a request it is
      // holding — so it is read off the intent the gate saw and never off the
      // page. Absent until the network mechanism writes it; absent renders as
      // absent rather than as a guess.
      method: textOf(params, 'method'),
      actionKind: row.intent.kind,
    },
    typedText,
    pageAuthored: {
      elementName: elementNameOf(untrusted),
      tabTitle: textOf(asRecord(untrusted), 'title'),
    },
    evidenceId: row.evidenceId,
    hasImage: row.evidence === null ? false : await hasImage(ctx, row.evidence.id),
  }
}

/**
 * Is there actually a picture on this evidence row?
 *
 * Raw, because the alternative is selecting the blob to ask about its length —
 * pulling megabytes through Prisma to compute a boolean, and then pulling them
 * again when the page renders. `LENGTH` on a SQLite BLOB reads the stored size
 * rather than the bytes.
 */
async function hasImage(ctx: ConfirmationContext, evidenceId: string): Promise<boolean> {
  const rows = await ctx.db.prisma.$queryRaw<Array<{ bytes: unknown }>>`
    SELECT COALESCE(LENGTH(image), 0) AS bytes
    FROM action_evidence WHERE id = ${evidenceId}
  `
  // SQLite integers arrive as `number` or `bigint` depending on magnitude and
  // driver, and a comparison written for one silently fails for the other —
  // which is how this first shipped reporting "no picture" for every row that
  // had one. `Number()` covers both, and a null row is falsy either way.
  const bytes = rows[0]?.bytes
  return Number(bytes ?? 0) > 0
}

/* ── the two human answers ──────────────────────────────────────────────── */

export type AnswerResult =
  | { readonly ok: true; readonly continuationRunId: string | null }
  | {
      readonly ok: false
      /**
       * `abandoned` — the run that raised the question is no longer parked on
       * it. Added 2026-09-01. It is not a permission failure and it is not the
       * person's mistake: a human really did confirm. It is that the work the
       * question was about had already ended, so there is nothing for a yes to
       * let carry on, and enqueueing a continuation off it would start work on
       * the strength of a run we had stopped trusting to be driving.
       *
       * Reported only when `expired` does not apply, because the expiry sweep
       * ends the run as well: see the order in `confirmRequest`. So this means
       * a run that ended for some OTHER reason, inside the day.
       */
      readonly reason: 'not-found' | 'already-answered' | 'expired' | 'abandoned'
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
      run: { select: { contractId: true, status: true } },
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

  /**
   * The run has to still be parked on this question.
   *
   * Without it, a question raised by a run that ended some other way —
   * `interrupted` / `lease-expired`, credential revoked, precisely because we
   * stopped trusting it to be driving — could be answered, and answering
   * enqueued a continuation off the back of it.
   *
   * This is symmetry rather than a new rule. `expireConfirmations` and
   * `oldestPendingConfirmation` below both already carry
   * `run: { status: 'awaiting-confirmation' }`, so the question had already
   * vanished from the extension's notification while staying answerable by URL.
   * The one function here that GRANTS something was the one not looking.
   *
   * ── Checked AFTER expiry, and the sweep is the reason ────────────────────
   *
   * `expireConfirmations` runs on the worker's five-minute poll and ends the
   * run of every question older than `CONFIRMATION_EXPIRY_HOURS` —
   * `interrupted` / `CONFIRMATION_EXPIRED`. So minutes after the day is up, the
   * ordinary unanswered question is BOTH expired and no longer parked, and
   * reading the status first would answer every day-late yes with *"the work
   * ended"* rather than *"you were too late"*. `unansweredReason` breaks the
   * same tie the same way on the screen, so the two cannot say different things
   * about one row.
   *
   * That leaves this narrow, and deliberately so: `abandoned` is a run that
   * ended for some OTHER reason while its question was still inside its day.
   * Both refuse either way, so the order changes what the person is told and
   * never what is permitted.
   */
  if (request.run.status !== 'awaiting-confirmation') {
    return { ok: false, reason: 'abandoned' }
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
   * It is enqueued WITHOUT a control token, and that is deliberate. A
   * continuation drives the browser and will need one, but it is minted at the
   * claim — by the process that takes the run — not here. A credential written
   * onto a `pending` row would sit there unused for as long as the queue is
   * long, would survive the claim moving between processes, and would be held
   * by a row nobody is driving. That is the stale-claim hazard `claimedBy`
   * exists to close, wearing different clothes.
   */
  const continuation = await ctx.repos.runs.enqueue({
    contractId: request.run.contractId,
    role: 'worker',
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
    select: {
      id: true,
      verdict: { select: { verdict: true } },
      run: { select: { contract: { select: { sessionId: true } } } },
    },
  })
  if (!request) return { ok: false, reason: 'not-found' }
  if (request.verdict) return { ok: false, reason: 'already-answered' }

  // Deliberately NOT gated on expiry. Saying no to a stale question is a
  // decision worth recording — it is the difference between "you said no" and
  // "you never saw it" in the report — and it grants nothing, so the reason to
  // refuse a late yes does not apply to a late no.
  await ctx.repos.confirmations.recordVerdict({ requestId, verdict: 'rejected', decidedAt: now })

  // A no ends the pause with no continuation, so the session comes back. It had
  // been staying `away` for ever, which made every "hand the work over again"
  // sentence in the product point at a screen that could not.
  await handBackTheSession(ctx, request.run.contract.sessionId)

  return { ok: true, continuationRunId: null }
}

/* ── the report, written once ───────────────────────────────────────────── */

/**
 * Make sure this sentence reaches the re-entry note.
 *
 * ── Why it appends rather than skipping ──────────────────────────────────
 *
 * One `ShiftReport` per contract, enforced by a unique column, and
 * `executeRun` already writes one at the end of every run under the same
 * first-one-wins guard. So on a contract whose earlier run finished — a
 * re-accept, a re-claim after a stale lease — a naive "skip if one exists"
 * silently DROPS the sentence saying a question went unanswered, and the
 * person's re-entry screen shows the old narrative with no mention of it.
 * Losing precisely the note these functions exist to write is the failure this
 * guard was supposed to prevent.
 *
 * So an existing report gains the sentence rather than swallowing it, and a
 * report that already carries it is left alone — this runs once per sweep and
 * a sweep may run many times.
 *
 * The `ShiftReport` row is not append-only guarded, which is what makes the
 * update legal. It is a rendering of durable rows, rewritten on return; the
 * ledger underneath it is the receipt and is untouched here.
 */
async function noteInReport(
  ctx: ConfirmationContext,
  contractId: string,
  narrative: string,
): Promise<void> {
  const existing = await ctx.repos.reports.forContract(contractId)

  if (!existing) {
    await ctx.repos.reports.create({ contractId, narrative, decisions: [] })
    return
  }

  if (existing.narrative !== null && existing.narrative.includes(narrative)) return

  await ctx.db.prisma.shiftReport.update({
    where: { contractId },
    data: {
      narrative:
        existing.narrative === null || existing.narrative.trim() === ''
          ? narrative
          : `${existing.narrative} ${narrative}`,
    },
  })
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
    select: {
      id: true,
      contractId: true,
      resumesRunId: true,
      contract: { select: { sessionId: true } },
    },
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
  //
  // The control token goes with it. This run was claimed a moment ago and so
  // holds a live browser credential; it is about to never act, and a token on a
  // run that will not act is a token nothing will ever revoke.
  await ctx.db.prisma.agentRun.update({
    where: { id: runId },
    data: {
      status: 'interrupted',
      terminalReason: admission.terminalReason,
      endedAt: now,
      controlToken: null,
    },
  })

  await noteInReport(ctx, run.contractId, admission.report)
  // The answer was real and arrived too late, so nothing carries on and the
  // session is the person's again. The report already tells them why.
  await handBackTheSession(ctx, run.contract.sessionId)

  return 'settled'
}

/* ── expiry: the one thing here that runs on the clock ──────────────────── */

/**
 * Give the session back to the person, now that the pause is over.
 *
 * ── Why this is not `execute-run.ts`'s job, and where it went missing ────
 *
 * `executeRun` hands the session back on the two paths it owns, and one of them
 * carries the sentence this exists to honour: *"Without this it stays `away`
 * forever, and every control that offers to hand it back is a promise the
 * product cannot keep."*
 *
 * A confirmation pause leaves the session `away` deliberately — ADR-0010's risk
 * list settles that *"`SessionPhase` has no honest value for a confirmation
 * pause… Keeping `away` is the smaller lie"* — and that holds **while the
 * question is live**. It stops holding the moment the pause ends without a
 * continuation, and three paths do that: a rejection, an expiry, and an answer
 * that arrived too late. None of them handed the session back, so a session
 * stayed `away` for ever and `/sessions/<id>` said *"Nothing here can be
 * changed until it hands back."*
 *
 * That was invisible until #139 put a route to that screen on the closed
 * confirmation, at which point the product's three *"hand the work over again"*
 * sentences all pointed at a page that could not.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────
 *
 * It does not touch the run, which each caller has already ended in the way
 * that fits its own reason. It is not idempotent-by-check either — `setPhase`
 * is a plain write, and writing `observing` over `observing` is harmless.
 *
 * The path it deliberately skips is `confirmRequest`'s: a yes enqueues a
 * continuation, the work carries on, and the session is still genuinely away.
 * `executeRun` hands it back when that run ends, like any other.
 */
async function handBackTheSession(ctx: ConfirmationContext, sessionId: string): Promise<void> {
  await ctx.repos.sessions.markObserving(sessionId)
}

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
  /**
   * Bounded IN THE QUERY, and by both terms.
   *
   * A first version selected every unanswered request ever and filtered in
   * JavaScript — the same pattern this file criticises a hundred lines below on
   * `oldestPendingConfirmation`, and worse here, because the set only ever
   * grows: a request nobody answered stays unanswered forever and came back in
   * every result, every five minutes, for the life of the database.
   *
   * The status filter belongs in the query for the same reason. Only a run
   * still parked on the question is in scope: a run that already ended for
   * another reason keeps the reason it ended for, and a question expiring
   * afterwards does not retell the story of why it stopped.
   */
  const expiredBefore = new Date(now.getTime() - CONFIRMATION_EXPIRY_HOURS * 3_600_000)

  const open = await ctx.db.prisma.confirmationRequest.findMany({
    where: {
      verdict: { is: null },
      // `lte`, matching `confirmationHasExpired`'s `>=`: a request expires at
      // the instant the day is up, not one tick later.
      createdAt: { lte: expiredBefore },
      run: { status: 'awaiting-confirmation' },
    },
    select: {
      id: true,
      runId: true,
      // `sessionId` for the hand-back below, off the join already here.
      run: { select: { contractId: true, contract: { select: { sessionId: true } } } },
    },
  })

  let settled = 0
  for (const request of open) {
    await ctx.db.prisma.agentRun.update({
      where: { id: request.runId },
      data: {
        status: 'interrupted',
        terminalReason: CONFIRMATION_EXPIRED,
        endedAt: now,
        // Belt and braces: `complete` already cleared it when the run parked on
        // the question. Writing it again costs nothing and means this path does
        // not depend on remembering that the earlier one did.
        controlToken: null,
      },
    })
    await noteInReport(ctx, request.run.contractId, CONFIRMATION_EXPIRED_REPORT)
    await handBackTheSession(ctx, request.run.contract.sessionId)
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
 * ── It refuses to touch a run that is still alive ────────────────────────
 *
 * A run in `pending | claimed | running` may be MID-ACTION, and its intent with
 * no outcome is in flight rather than abandoned. Writing a `recovery` row over
 * it would race the worker about to write the real one — and `ActionOutcome`
 * has a unique `intentId`, so the worker's write would then fail, propagate out
 * of the loop, and complete a perfectly healthy shift as `failed / error`.
 * Pressing "Take back control" would be the thing that broke the run.
 *
 * So a live run is skipped and this returns 0. The flag is what stops it; the
 * fence lands the halt at an action boundary; and if it turns out the worker
 * was already gone, the startup sweep settles the intent once the lease
 * expires. Nothing is lost, and nothing is claimed early.
 *
 * Returns how many intents it settled.
 */
export async function settleAbandonedIntents(
  ctx: ConfirmationContext,
  runId: string,
): Promise<number> {
  const run = await ctx.db.prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  })
  if (!run) return 0
  if (run.status === 'pending' || run.status === 'claimed' || run.status === 'running') return 0

  const abandoned = await ctx.db.prisma.actionIntent.findMany({
    where: { runId, authorized: true, outcome: { is: null } },
    select: { id: true },
  })

  let settled = 0
  for (const intent of abandoned) {
    if (await recordRecoveryOutcome(ctx, intent.id)) settled += 1
  }

  return settled
}

/**
 * Write one recovery outcome, and treat "already settled" as success.
 *
 * ── Four writers, one unique column ──────────────────────────────────────
 *
 * `ActionOutcome.intentId` is `@unique`, and four different paths select
 * "authorized intents with no outcome" and write to them: the fenced-run
 * handler in `executeRun`, `haltRun`, the five-minute `sweepAbandonedIntents`,
 * and the continuation's own recovery pass. Any two of them overlapping on one
 * row gives a P2002. Inside a server action that is contained by `attempt()`;
 * inside the worker's sweep it would have ended the sweep, and — before the
 * guard in `startWorkerProcess` — the worker with it.
 *
 * A P2002 here means somebody else recorded an outcome for this intent between
 * the select and the insert. That is not a failure: the property these
 * functions exist to hold is "an abandoned action never leaves an intent with
 * no outcome", and it is held either way. So the row is left as whoever won
 * wrote it — a second, contradicting recovery row is neither possible nor
 * wanted — and this reports that nothing new was written.
 *
 * Returns whether THIS call wrote the row, so the counts callers report stay
 * honest rather than counting other people's work.
 */
async function recordRecoveryOutcome(
  ctx: ConfirmationContext,
  intentId: string,
): Promise<boolean> {
  try {
    await ctx.db.prisma.actionOutcome.create({
      data: {
        intentId,
        result: 'failed',
        scopeVerdict: 'unverified',
        detail: 'Propositum stopped before it could see what happened.',
        observedBy: 'recovery',
      },
    })
    return true
  } catch (error) {
    // Narrow, so a real write failure still surfaces. Prisma reports a unique
    // violation as P2002; the append-only trigger's own message is checked too,
    // because `action_outcome_no_replace` turns an INSERT OR REPLACE into a
    // raw SQLite error rather than a Prisma code.
    const code = (error as { code?: unknown }).code
    const message = error instanceof Error ? error.message : String(error)
    if (code === 'P2002' || message.includes('UNIQUE constraint failed')) return false
    throw error
  }
}

/** What a halt did. `stopped` is false when there was nothing left to stop. */
export interface Halted {
  readonly stopped: boolean
  /** Actions that were in flight and are now recorded as unverified. */
  readonly unfinished: number
}

/**
 * Stop this run, from the app side. ONE implementation, two doors.
 *
 * ── The two doors ────────────────────────────────────────────────────────
 *
 * "Take back control" on the shift screen calls it, and so should
 * `POST /api/act/halt` — the endpoint the tab overlay chip and the side panel
 * Stop reach after they have already detached. They are the same act with
 * different reach, and two implementations of "stop" would be two things to
 * keep in agreement about a run that is driving somebody's browser.
 *
 * ── Detach first, POST second, and why that is not an ADR-0007 violation ──
 *
 * The extension detaches the debugger BEFORE telling the app, so stopping works
 * with the app closed, the dev server restarting, or the machine offline. A
 * stop that has to reach a server before it takes effect is not a stop. That
 * detach can land mid-action, which reads like a straight violation of
 * ADR-0007's "halts land at the next action boundary".
 *
 * It is not, because **detaching is not a halt.** A halt is a decision the run
 * makes and then acts on; detaching is the REMOVAL OF THE CAPABILITY the run
 * was using, and it has to work precisely when the run cannot be trusted to
 * make decisions. The property ADR-0007 protects is that an abandoned action
 * never leaves an intent with no outcome — and that is preserved by moving the
 * writer, which is the third step below.
 *
 * ── Three steps, in this order ───────────────────────────────────────────
 *
 * 1. **Flag it.** `cancelRequested` is a column, not a kill. The run re-reads
 *    it at its next action boundary and halts itself, which is the only way to
 *    stop cleanly when the thing being stopped may be mid-navigation.
 * 2. **Revoke the credential.** The app-side half of removing the capability:
 *    the run may not be reachable, but the control channel it drives through
 *    checks this token, and a revoked token cannot be un-revoked by a worker
 *    that did not notice it was stopped.
 * 3. **Settle what was left in flight** — but only if the run is already
 *    terminal. `settleAbandonedIntents` refuses a live run for good reason: a
 *    recovery row over an in-flight intent makes the worker's real write throw
 *    on a unique key and turns a clean stop into a failed shift.
 */
export async function haltRun(ctx: ConfirmationContext, runId: string): Promise<Halted> {
  const stopped = await ctx.repos.runs.requestCancel(runId)

  // Revoked whether or not there was anything to flag. A run that already ended
  // should not be holding one either, and this is cheap.
  await ctx.repos.runs.clearControlToken(runId)

  const unfinished = await settleAbandonedIntents(ctx, runId)

  return { stopped, unfinished }
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

  let settled = 0
  for (const intent of stranded) {
    if (await recordRecoveryOutcome(ctx, intent.id)) settled += 1
  }

  return settled
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
 * Expired requests are excluded IN THE QUERY, not afterwards. A first version
 * took the ten oldest and filtered in JavaScript, which meant ten stale
 * questions were enough to hide every answerable one behind them — the
 * notification would go quiet exactly when a fresh question was waiting, and
 * the cause would be invisible.
 */
export async function oldestPendingConfirmation(
  ctx: ConfirmationContext,
  nowEpochMs: number,
): Promise<PendingConfirmation | null> {
  const answerableSince = new Date(nowEpochMs - CONFIRMATION_EXPIRY_HOURS * 3_600_000)

  const row = await ctx.db.prisma.confirmationRequest.findFirst({
    where: {
      verdict: { is: null },
      run: { status: 'awaiting-confirmation' },
      // Strictly after, matching `confirmationHasExpired`, which expires at the
      // instant the day is up rather than one tick later.
      createdAt: { gt: answerableSince },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, summary: true, createdAt: true, run: { select: { contractId: true } } },
  })
  if (!row) return null

  return {
    requestId: row.id,
    contractId: row.run.contractId,
    summary: row.summary,
    askedAtMs: row.createdAt.getTime(),
  }
}
