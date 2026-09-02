/**
 * The confirmation pause, and the kill switch.
 *
 * ── Why this file is longer than it looks like it should be ──────────────
 *
 * ADR-0010's own first paragraph says it: `ActionKind` now enumerates
 * MECHANISMS rather than EFFECTS, so `click-element` can press *Send*, and
 * ADR-0004's "a prohibition implemented as a missing capability cannot be
 * misconfigured" is substantively false while its test still passes. What
 * replaced the absence is a pause, and **a pause is strictly weaker than an
 * absence**. These are the assertions standing in for the guarantee that was
 * spent, so they are written against the failure modes rather than against the
 * happy path:
 *
 *   - a refusal that gets rewritten into an approval
 *   - a timeout that decays into a yes
 *   - a run that resumes after its deadline and silently does nothing
 *   - a stale claim that presses a button
 *   - an abandoned action with no outcome
 *
 * They run against a real SQLite file with the append-only triggers installed,
 * because three of the properties — the refusal never being mutated, one
 * verdict per request, one report per shift — are enforced by the database
 * rather than by the code above it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import {
  admitRun,
  confirmationView,
  confirmRequest,
  confirmationForIntent,
  confirmedRequestIdsFor,
  creditedDeadlineFor,
  expireConfirmations,
  haltRun,
  oldestPendingConfirmation,
  rejectRequest,
  settleAbandonedIntents,
  sweepAbandonedIntents,
  unansweredReason,
} from '../src/server/confirmations'
import type { ConfirmationContext } from '../src/server/confirmations'
import {
  ANSWERED_TOO_LATE,
  ANSWERED_TOO_LATE_REPORT,
  CONFIRMATION_EXPIRED,
  admitContinuation,
  confirmationHasExpired,
} from '../src/domain/execution/continuation'
import {
  CONFIRMATION_EXPIRY_HOURS,
  MAX_PAUSE_CREDIT_MINUTES,
  deadlineFor,
} from '../src/domain/execution/stop-conditions'
import { startWorkerProcess } from '../src/runtime/worker-process'
import type { FenceVerdict, RunFence } from '../src/runtime/worker-process'
import { ConfirmationScreen, SettledConfirmation } from '../src/ui/confirm'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { executeRun } from '../src/server/execute-run'
import { stripComments } from './support/strip-comments'
import { FakeModelClient } from '../src/model/fake'
import { fixtureFetcher } from '../src/policy/fetcher'

// `revalidatePath` needs a request store that does not exist in a test process.
// The server actions below are imported for one assertion — the SENTENCE a
// person reads when their yes arrives after the work ended — because that is
// the mapping the two closed states could quietly collapse into one.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

type Actions = typeof import('../src/server/actions')
type ServerDb = typeof import('../src/server/db')

const MINUTE = 60_000
const HOUR = 60 * MINUTE

let dir: string
let db: Database
let repos: Repositories
let ctx: ConfirmationContext
let projectId: string
let actions: Actions
let serverDb: ServerDb

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-confirm-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ctx = { db, repos }
  projectId = (await repos.projects.create('northwind')).id

  // Set before the module loads: `appContext()` builds its client from the
  // environment the first time an action asks for it, and it must land on the
  // same file the rows above are in.
  process.env['DATABASE_URL'] = url
  actions = await import('../src/server/actions')
  serverDb = await import('../src/server/db')
}, 120_000)

afterAll(async () => {
  await db?.close()
  const appCtx = await serverDb?.appContext()
  await appCtx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/* ── a shift, paused on a question ──────────────────────────────────────── */

interface Paused {
  readonly contractId: string
  readonly runId: string
  readonly refusedIntentId: string
  readonly requestId: string
  readonly acceptedAt: Date
}

/**
 * The state a confirmation starts from: a run that proposed something
 * irreversible, a gate that refused it for want of a human, and a question.
 *
 * Built through the same repositories the run path uses, so nothing here is a
 * shape that could only exist in a test.
 */
async function pausedShift(options: {
  acceptedAt: Date
  askedAt: Date
  timeLimitMinutes?: number
  inputText?: string
  accessibleName?: string
  withImage?: boolean
}): Promise<Paused> {
  const sessionId = (await repos.sessions.start(projectId)).id
  const reading = await repos.readings.create({
    sessionId,
    throughSeq: 0,
    claims: [{ kind: 'objective', text: 'Reply to the thread.', ordinal: 0, evidence: [] }],
  })
  const contract = await repos.contracts.createDraft({
    sessionId,
    readingId: reading.id,
    objective: 'Reply to the thread.',
    definitionOfDone: 'The reply is sent.',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['click-element'],
    baseVersionId: null,
    initiative: 'use-judgment',
    progress: 'remaining-plan',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: options.timeLimitMinutes ?? 30,
  })
  await repos.contracts.accept(contract.id, options.acceptedAt)

  const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

  // The refusal. Exactly like any other refusal: authorized = false, a rule id,
  // and no outcome. Nothing about it says "waiting".
  const refused = await db.prisma.actionIntent.create({
    data: {
      runId: run.id,
      seq: 1,
      kind: 'click-element',
      reason: 'The reply is written and Send is the next control.',
      params: {
        ref: 'e47',
        snapshotId: 'snap-1',
        method: 'POST',
        ...(options.inputText === undefined ? {} : { inputText: options.inputText }),
      },
      authorized: false,
      refusedRule: 'confirmation_required',
    },
    select: { id: true, createdAt: true },
  })

  const evidence = await repos.evidence.create({
    runId: run.id,
    intentId: refused.id,
    kind: 'page-snapshot',
    url: 'https://mail.example.test/u/0/#inbox/thread-9',
    untrusted: {
      title: 'Re: Q1 partnership terms',
      ...(options.accessibleName === undefined ? {} : { accessibleName: options.accessibleName }),
    },
    ...(options.withImage ? { image: new Uint8Array([137, 80, 78, 71]) } : {}),
  })

  /**
   * Inserted directly, with `createdAt` set at INSERT time.
   *
   * `confirmations.create` is the production door and takes no timestamp,
   * because in production the question is asked now. Every clock question in
   * this file turns on when it was asked, and the row cannot be updated
   * afterwards — `confirmation_request` is append-only and the trigger says so
   * — so the value has to arrive with the row.
   */
  const request = await db.prisma.confirmationRequest.create({
    data: {
      runId: run.id,
      intentId: refused.id,
      summary: 'Propositum wants to press Send on mail.example.test.',
      evidenceId: evidence.id,
      createdAt: options.askedAt,
    },
    select: { id: true },
  })

  await repos.runs.complete(run.id, 'awaiting-confirmation', options.askedAt)

  return {
    contractId: contract.id,
    runId: run.id,
    refusedIntentId: refused.id,
    requestId: request.id,
    acceptedAt: options.acceptedAt,
  }
}

/* ══════════════════════════════════ 1. the refusal is recorded AS a refusal ══ */

describe('the refusal is a refusal, and stays one', () => {
  it('produces a ConfirmationRequest against an intent that is never mutated', async () => {
    const askedAt = new Date('2026-08-11T15:04:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-08-11T15:00:00Z'), askedAt })

    const before = await db.prisma.actionIntent.findUniqueOrThrow({
      where: { id: paused.refusedIntentId },
    })
    expect(before.authorized).toBe(false)
    expect(before.refusedRule).toBe('confirmation_required')

    // The whole point of an append-only ledger: at 15:04 the truth was "it
    // asked, and it was not yet allowed", and confirming later does not make
    // that untrue.
    await confirmRequest(ctx, paused.requestId, new Date('2026-08-11T15:20:00Z'))

    const after = await db.prisma.actionIntent.findUniqueOrThrow({
      where: { id: paused.refusedIntentId },
    })
    expect(after.authorized).toBe(false)
    expect(after.refusedRule).toBe('confirmation_required')
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime())

    // And the database itself refuses, so this cannot be undone by a future
    // caller who decides an UPDATE would be tidier.
    await expect(
      db.prisma.actionIntent.update({
        where: { id: paused.refusedIntentId },
        data: { authorized: true },
      }),
    ).rejects.toThrow()
  })

  it('leaves the refused intent with no outcome, because nothing happened', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-08-11T09:00:00Z'),
      askedAt: new Date('2026-08-11T09:05:00Z'),
    })

    const outcome = await db.prisma.actionOutcome.findUnique({
      where: { intentId: paused.refusedIntentId },
    })
    expect(outcome).toBeNull()
  })
})

/* ══════════════════════════════ 2. confirmed enqueues, rejected does not ══ */

describe('the continuation is a new run', () => {
  it('confirmed enqueues a pending run with resumesRunId set', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-08-11T15:00:00Z'),
      askedAt: new Date('2026-08-11T15:04:00Z'),
    })

    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-08-11T15:10:00Z'))
    expect(answered.ok).toBe(true)
    if (!answered.ok) return
    expect(answered.continuationRunId).not.toBeNull()

    const continuation = await repos.runs.byId(answered.continuationRunId ?? '')
    expect(continuation?.status).toBe('pending')
    expect(continuation?.resumesRunId).toBe(paused.runId)
    expect(continuation?.contractId).toBe(paused.contractId)
    /**
     * It will drive the browser and it does NOT hold a credential yet.
     *
     * The control token is minted at the CLAIM, by the process that takes the
     * run. A token written onto a `pending` row would sit unused for as long as
     * the queue is long and would survive the claim moving between processes —
     * a credential held by a row nobody is driving, which is the stale-claim
     * hazard `claimedBy` exists to close, wearing different clothes.
     */
    expect(continuation?.controlToken).toBeNull()

    // The paused run is untouched. Its ledger is closed.
    const original = await repos.runs.byId(paused.runId)
    expect(original?.status).toBe('awaiting-confirmation')
  })

  it('rejected records the no and enqueues nothing', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-08-11T15:00:00Z'),
      askedAt: new Date('2026-08-11T15:04:00Z'),
    })

    const before = await db.prisma.agentRun.count({ where: { contractId: paused.contractId } })

    const answered = await rejectRequest(ctx, paused.requestId, new Date('2026-08-11T15:10:00Z'))
    expect(answered.ok).toBe(true)
    if (!answered.ok) return
    expect(answered.continuationRunId).toBeNull()

    const after = await db.prisma.agentRun.count({ where: { contractId: paused.contractId } })
    expect(after).toBe(before)

    // Recorded rather than dropped: "you said no" and "you never saw it" are
    // different sentences in the report, and only a row can tell them apart.
    const verdict = await db.prisma.confirmationVerdict.findUnique({
      where: { requestId: paused.requestId },
    })
    expect(verdict?.verdict).toBe('rejected')
  })

  it('will not take a second answer to the same question', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-08-11T15:00:00Z'),
      askedAt: new Date('2026-08-11T15:04:00Z'),
    })

    await rejectRequest(ctx, paused.requestId, new Date('2026-08-11T15:10:00Z'))
    const again = await confirmRequest(ctx, paused.requestId, new Date('2026-08-11T15:11:00Z'))

    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.reason).toBe('already-answered')
  })
})

/* ═══════════════════════════ 3. only the human path writes a verdict ══ */

describe('only a human writes a ConfirmationVerdict', () => {
  it('is written by exactly two functions, both on the human path', async () => {
    // Not enforceable by a column — the database cannot see who is holding the
    // keyboard — so it is enforced by there being exactly one writer, reached
    // from exactly two places. This asserts that by inspection of the source,
    // which is the only mechanism available and is better than nothing.
    const { readFileSync } = await import('node:fs')
    const root = new URL('../src/', import.meta.url)

    const files = [
      'server/confirmations.ts',
      'server/actions.ts',
      'runtime/worker-process.ts',
      'runtime/worker-loop.ts',
      'server/execute-run.ts',
      'policy/gate.ts',
      'persistence/repositories/index.ts',
      'domain/execution/continuation.ts',
    ]

    const writers: string[] = []
    for (const file of files) {
      const source = readFileSync(new URL(file, root), 'utf8')
      // The repository method, and the Prisma call it wraps. Comments mention
      // both by name all over this codebase, so only real calls count.
      if (/confirmationVerdict\.create\(/.test(source)) writers.push(`${file}:prisma`)
      if (/(?<!\/\/.*)\brecordVerdict\(\{\s*\n?\s*requestId/.test(source)) {
        writers.push(`${file}:recordVerdict`)
      }
    }

    // The Prisma call lives in the repository and nowhere else.
    expect(writers).toContain('persistence/repositories/index.ts:prisma')
    expect(writers.filter((w) => w.endsWith(':prisma'))).toHaveLength(1)

    // And no run path calls it. If this fails, somebody has given a model, a
    // worker or a reviewer the ability to answer its own question.
    for (const file of [
      'runtime/worker-loop.ts',
      'runtime/worker-process.ts',
      'server/execute-run.ts',
      'policy/gate.ts',
    ]) {
      expect(writers.some((w) => w.startsWith(file))).toBe(false)
    }
  })

  it('expiry writes no verdict at all, in either direction', async () => {
    const askedAt = new Date('2026-08-10T09:00:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-08-10T08:55:00Z'), askedAt })

    const settled = await expireConfirmations(
      ctx,
      new Date(askedAt.getTime() + (CONFIRMATION_EXPIRY_HOURS + 1) * HOUR),
    )
    expect(settled).toBe(1)

    // THE assertion this whole feature exists for. There is no value elapsed
    // time could write, because there is no code path from elapsed time to
    // permission.
    const verdict = await db.prisma.confirmationVerdict.findUnique({
      where: { requestId: paused.requestId },
    })
    expect(verdict).toBeNull()
  })
})

/* ══════════════ 4. the coordinator's decision: answered after the deadline ══ */

describe('a confirmation answered after the credited deadline', () => {
  it('completes the continuation without entering the loop, and says so', async () => {
    const acceptedAt = new Date('2026-08-11T09:00:00Z')
    const askedAt = new Date('2026-08-11T09:05:00Z')
    // Answered at 18:00 — inside the 24-hour expiry, far outside the four hours
    // of credit a thirty-minute shift can be given.
    const answeredAt = new Date('2026-08-11T18:00:00Z')

    const paused = await pausedShift({ acceptedAt, askedAt, timeLimitMinutes: 30 })

    const answered = await confirmRequest(ctx, paused.requestId, answeredAt)
    expect(answered.ok).toBe(true)
    if (!answered.ok || answered.continuationRunId === null) return

    const intentsBefore = await db.prisma.actionIntent.count({
      where: { run: { contractId: paused.contractId } },
    })

    const admission = await admitRun(ctx, answered.continuationRunId, answeredAt)
    expect(admission).toBe('settled')

    const run = await db.prisma.agentRun.findUniqueOrThrow({
      where: { id: answered.continuationRunId },
    })
    expect(run.status).toBe('interrupted')
    expect(run.terminalReason).toBe(ANSWERED_TOO_LATE)

    // The person is TOLD. A run that appears to resume and then silently does
    // nothing is the failure this arrangement exists to avoid.
    const report = await repos.reports.forContract(paused.contractId)
    expect(report?.narrative).toBe(ANSWERED_TOO_LATE_REPORT)
    expect(report?.narrative).toContain('after the time limit')

    // And it did not act. Zero new ActionIntent rows.
    const intentsAfter = await db.prisma.actionIntent.count({
      where: { run: { contractId: paused.contractId } },
    })
    expect(intentsAfter).toBe(intentsBefore)
  })

  it('admits a continuation answered inside the credited deadline', async () => {
    const acceptedAt = new Date('2026-08-11T09:00:00Z')
    const askedAt = new Date('2026-08-11T09:05:00Z')
    const answeredAt = new Date('2026-08-11T10:05:00Z')

    const paused = await pausedShift({ acceptedAt, askedAt, timeLimitMinutes: 30 })
    const answered = await confirmRequest(ctx, paused.requestId, answeredAt)
    if (!answered.ok || answered.continuationRunId === null) throw new Error('expected a run')

    // Asked at 09:05, answered at 10:05 — one hour credited, so the shift now
    // runs to 10:30. Without the credit it died at 09:30 and asking permission
    // would have destroyed the run.
    const admission = await admitRun(ctx, answered.continuationRunId, answeredAt)
    expect(admission).toBe('proceed')
  })

  it('does not gate a first run, which has a budget path of its own', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-08-01T09:00:00Z'),
      askedAt: new Date('2026-08-01T09:05:00Z'),
    })

    // Long past every deadline, and still admitted: it is not a continuation,
    // so `budget-exhausted` inside the loop is its story to tell.
    const admission = await admitRun(ctx, paused.runId, new Date('2026-08-09T09:00:00Z'))
    expect(admission).toBe('proceed')
  })

  it('refuses at the instant of the deadline, not one tick after', () => {
    expect(admitContinuation({ nowEpochMs: 1_000, creditedDeadlineEpochMs: 1_000 }).admit).toBe(
      false,
    )
    expect(admitContinuation({ nowEpochMs: 999, creditedDeadlineEpochMs: 1_000 }).admit).toBe(true)
  })
})

/* ═════════════════════════════════════ 5. expiry at 24 hours ══ */

describe('expiry', () => {
  it('turns an unanswered question into interrupted / confirmation-expired', async () => {
    const askedAt = new Date('2026-07-01T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-07-01T09:00:00Z'), askedAt })

    await expireConfirmations(ctx, new Date(askedAt.getTime() + 25 * HOUR))

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: paused.runId } })
    expect(run.status).toBe('interrupted')
    expect(run.terminalReason).toBe(CONFIRMATION_EXPIRED)

    const report = await repos.reports.forContract(paused.contractId)
    expect(report?.narrative).toContain('went unanswered')
    expect(report?.narrative).toContain('Nothing was done')
  })

  it('leaves a question alone until the day is actually up', async () => {
    const askedAt = new Date('2026-07-02T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-07-02T09:00:00Z'), askedAt })

    await expireConfirmations(ctx, new Date(askedAt.getTime() + 23 * HOUR))

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: paused.runId } })
    expect(run.status).toBe('awaiting-confirmation')
  })

  it('refuses a yes that arrives after expiry rather than honouring it', async () => {
    const askedAt = new Date('2026-07-03T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-07-03T09:00:00Z'), askedAt })

    const late = await confirmRequest(
      ctx,
      paused.requestId,
      new Date(askedAt.getTime() + 25 * HOUR),
    )
    expect(late.ok).toBe(false)
    if (late.ok) return
    expect(late.reason).toBe('expired')

    const verdict = await db.prisma.confirmationVerdict.findUnique({
      where: { requestId: paused.requestId },
    })
    expect(verdict).toBeNull()
  })

  it('still records a late NO, because saying no grants nothing', async () => {
    const askedAt = new Date('2026-07-04T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-07-04T09:00:00Z'), askedAt })

    const late = await rejectRequest(ctx, paused.requestId, new Date(askedAt.getTime() + 25 * HOUR))
    expect(late.ok).toBe(true)

    const verdict = await db.prisma.confirmationVerdict.findUnique({
      where: { requestId: paused.requestId },
    })
    expect(verdict?.verdict).toBe('rejected')
  })

  it('agrees with the pure predicate at the boundary', () => {
    const asked = 1_000_000
    const day = CONFIRMATION_EXPIRY_HOURS * HOUR
    expect(confirmationHasExpired({ requestedAtEpochMs: asked, nowEpochMs: asked + day - 1 })).toBe(
      false,
    )
    expect(confirmationHasExpired({ requestedAtEpochMs: asked, nowEpochMs: asked + day })).toBe(
      true,
    )
  })
})

/* ════════════════════════════ 6. deadlineFor is pure and restart-stable ══ */

describe('the credited deadline is a pure function of immutable timestamps', () => {
  it('credits an answered pause and recomputes identically after a restart', async () => {
    const acceptedAt = new Date('2026-06-01T09:00:00Z')
    const askedAt = new Date('2026-06-01T09:05:00Z')
    const answeredAt = new Date('2026-06-01T09:35:00Z')

    const paused = await pausedShift({ acceptedAt, askedAt, timeLimitMinutes: 30 })
    await confirmRequest(ctx, paused.requestId, answeredAt)

    const first = await creditedDeadlineFor(ctx, paused.contractId)
    expect(first).toBe(acceptedAt.getTime() + 30 * MINUTE + 30 * MINUTE)

    // A simulated restart: a brand-new handle onto the same file, with nothing
    // carried over. Every term is an immutable timestamp on a durable row, so
    // the number cannot move.
    const reopened = await createDatabase({ url: `file:${join(dir, 'test.db')}` })
    try {
      const again = await creditedDeadlineFor(
        { db: reopened, repos: createRepositories(reopened.prisma) },
        paused.contractId,
      )
      expect(again).toBe(first)
    } finally {
      await reopened.close()
    }
  })

  it('credits nothing for a pause nobody has answered', async () => {
    const acceptedAt = new Date('2026-06-02T09:00:00Z')
    const paused = await pausedShift({
      acceptedAt,
      askedAt: new Date('2026-06-02T09:05:00Z'),
      timeLimitMinutes: 30,
    })

    // An unanswered question must not buy a run more time than an answered one.
    const deadline = await creditedDeadlineFor(ctx, paused.contractId)
    expect(deadline).toBe(acceptedAt.getTime() + 30 * MINUTE)
  })

  it('caps the credit however long the wait ran', () => {
    const acceptedAt = 0
    const deadline = deadlineFor({
      acceptedAtEpochMs: acceptedAt,
      timeLimitMinutes: 30,
      pauses: [{ requestedAtEpochMs: 0, decidedAtEpochMs: 20 * HOUR }],
    })

    // Twenty hours waited, four hours credited. A run paused over a weekend
    // must not wake with three days of budget.
    expect(deadline).toBe(30 * MINUTE + MAX_PAUSE_CREDIT_MINUTES * MINUTE)
  })
})

/* ═══════════════════════════════════════ 7. the fence and the kill switch ══ */

describe('the fence CONTEXT.md always described', () => {
  function harness(
    row: { status: string; claimedBy: string | null; cancelRequested: boolean } | null,
  ) {
    let captured: RunFence | null = null
    const deps = {
      sweepExpiredLeases: vi.fn(async () => 0),
      claimNext: vi.fn(async (lease: { claimedBy: string }) => {
        claimedWith.push(lease.claimedBy)
        return remaining-- > 0 ? { id: 'run-1' } : null
      }),
      admit: vi.fn(async (): Promise<'proceed' | 'settled'> => 'proceed'),
      readRun: vi.fn(async () => row),
      execute: vi.fn(async (_id: string, fence: RunFence) => {
        captured = fence
      }),
      now: () => new Date(0),
      sleep: vi.fn(async (_ms: number): Promise<void> => undefined),
    }
    const claimedWith: string[] = []
    let remaining = 1
    return { deps, claimedWith, fence: () => captured }
  }

  it('writes claimedBy at claim time, so there is something to compare against', async () => {
    const h = harness({ status: 'running', claimedBy: null, cancelRequested: false })
    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    await handle.done

    expect(h.claimedWith).toContain('worker-under-test')
  })

  it('stops the run when the claim has moved to another process', async () => {
    const h = harness({ status: 'running', claimedBy: 'some-other-worker', cancelRequested: false })
    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    await handle.done

    const fence = h.fence()
    expect(fence).not.toBeNull()
    const verdict: FenceVerdict = await (fence as RunFence).check()
    expect(verdict.proceed).toBe(false)
    if (verdict.proceed) return
    // A browser-driving run is the first run where a stale claim can press a
    // button on a live page.
    expect(verdict.reason).toBe('claim-lost')
  })

  it('stops the run when the person asked it to', async () => {
    const h = harness({ status: 'running', claimedBy: 'worker-under-test', cancelRequested: true })
    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    await handle.done

    const verdict = await (h.fence() as RunFence).check()
    expect(verdict.proceed).toBe(false)
    if (verdict.proceed) return
    expect(verdict.reason).toBe('cancel-requested')
  })

  it('stops the run when a sweep already ended it', async () => {
    const h = harness({
      status: 'interrupted',
      claimedBy: 'worker-under-test',
      cancelRequested: false,
    })
    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    await handle.done

    const verdict = await (h.fence() as RunFence).check()
    expect(verdict.proceed).toBe(false)
    if (verdict.proceed) return
    expect(verdict.reason).toBe('run-ended')
  })

  it('lets a run holding its own live claim carry on', async () => {
    const h = harness({ status: 'running', claimedBy: 'worker-under-test', cancelRequested: false })
    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    await handle.done

    expect((await (h.fence() as RunFence).check()).proceed).toBe(true)
  })

  it('never enters the loop for a run the admission settled', async () => {
    const h = harness({ status: 'running', claimedBy: 'worker-under-test', cancelRequested: false })
    h.deps.admit = vi.fn(async (): Promise<'proceed' | 'settled'> => 'settled')

    const handle = startWorkerProcess(h.deps, { maxRuns: 1, workerId: 'worker-under-test' })
    const { runsCompleted } = await handle.done

    expect(h.deps.execute).not.toHaveBeenCalled()
    // Still counted. A maxRuns that ignored settlements would spin forever on a
    // queue full of them.
    expect(runsCompleted).toBe(1)
  })
})

describe('taking back control', () => {
  it('flags the run and records an outcome for anything left in flight', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-01T09:00:00Z'),
      askedAt: new Date('2026-05-01T09:05:00Z'),
    })

    // An authorised action whose effect went out and whose result nobody came
    // back to record — the state a detach mid-click leaves behind.
    const inFlight = await db.prisma.actionIntent.create({
      data: {
        runId: paused.runId,
        seq: 2,
        kind: 'click-element',
        reason: 'Open the reply box.',
        params: { ref: 'e12', snapshotId: 'snap-1' },
        authorized: true,
      },
      select: { id: true },
    })

    const stopped = await repos.runs.requestCancel(paused.runId)
    // The run already ended for the pause, so there was nothing left to flag —
    // which is exactly what `requestCancel` reports rather than pretending.
    expect(stopped).toBe(false)

    const settled = await settleAbandonedIntents(ctx, paused.runId)
    expect(settled).toBe(1)

    const outcome = await db.prisma.actionOutcome.findUniqueOrThrow({
      where: { intentId: inFlight.id },
    })
    // May only record what it can prove. It cannot prove the click landed and
    // it cannot prove it did not.
    expect(outcome.observedBy).toBe('recovery')
    expect(outcome.scopeVerdict).toBe('unverified')
    expect(outcome.detail).toContain('before it could see')

    // The refused intent is not touched: a refusal has no outcome by design.
    const refusedOutcome = await db.prisma.actionOutcome.findUnique({
      where: { intentId: paused.refusedIntentId },
    })
    expect(refusedOutcome).toBeNull()
  })

  it('flags a live run and reports that it did', async () => {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Anything.',
      definitionOfDone: 'Done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['click-element'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

    expect(await repos.runs.requestCancel(run.id)).toBe(true)
    expect((await repos.runs.byId(run.id))?.cancelRequested).toBe(true)
  })

  it('sweeps stranded intents only for runs that have actually ended', async () => {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Anything.',
      definitionOfDone: 'Done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['click-element'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    const live = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })
    await repos.runs.advanceProgress(live.id, 1) // status becomes `running`

    const stillGoing = await db.prisma.actionIntent.create({
      data: {
        runId: live.id,
        seq: 1,
        kind: 'click-element',
        reason: 'In flight right now.',
        params: {},
        authorized: true,
      },
      select: { id: true },
    })

    await sweepAbandonedIntents(ctx)

    // A LIVE run's intent with no outcome is in flight, not abandoned. Settling
    // it would race the run about to write the real thing.
    const outcome = await db.prisma.actionOutcome.findUnique({
      where: { intentId: stillGoing.id },
    })
    expect(outcome).toBeNull()
  })
})

/* ═══════════════════════ what the gate is told about a yes ══ */

describe('a yes reaches the gate', () => {
  it('lists the confirmed ids for the contract, and only the confirmed ones', async () => {
    const yes = await pausedShift({
      acceptedAt: new Date('2025-10-01T09:00:00Z'),
      askedAt: new Date('2025-10-01T09:05:00Z'),
    })
    await confirmRequest(ctx, yes.requestId, new Date('2025-10-01T09:10:00Z'))

    const ids = await confirmedRequestIdsFor(ctx, yes.contractId)
    expect(ids.has(yes.requestId)).toBe(true)

    // Without this, `RunContext.confirmedRequestIds` stays empty, the
    // continuation proposes the same click, and the gate refuses it
    // `confirmation_required` again — the person's yes buying a run that
    // re-asks. It fails safe and it reads as "you ignored my answer".
    const no = await pausedShift({
      acceptedAt: new Date('2025-10-02T09:00:00Z'),
      askedAt: new Date('2025-10-02T09:05:00Z'),
    })
    await rejectRequest(ctx, no.requestId, new Date('2025-10-02T09:10:00Z'))
    expect((await confirmedRequestIdsFor(ctx, no.contractId)).has(no.requestId)).toBe(false)

    // Unanswered is indistinguishable from rejected here, on purpose: all three
    // states mean "not permitted", and a set that included rejections would
    // turn a no into a yes.
    const open = await pausedShift({
      acceptedAt: new Date('2025-10-03T09:00:00Z'),
      askedAt: new Date('2025-10-03T09:05:00Z'),
    })
    expect((await confirmedRequestIdsFor(ctx, open.contractId)).has(open.requestId)).toBe(false)
  })

  it('names the confirmation covering one refused intent, deterministically', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2025-10-04T09:00:00Z'),
      askedAt: new Date('2025-10-04T09:05:00Z'),
    })

    // Before the answer: nothing. There is no id a continuation could inject,
    // which is the correct state — and no id a model could name either.
    expect(await confirmationForIntent(ctx, paused.refusedIntentId)).toBeNull()

    await confirmRequest(ctx, paused.requestId, new Date('2025-10-04T09:10:00Z'))

    // After: the id, found by walking from the refused intent rather than by
    // asking anything to remember it. A model that could name a confirmation
    // id could confirm its own action, which is a grant.
    expect(await confirmationForIntent(ctx, paused.refusedIntentId)).toBe(paused.requestId)
  })

  it('does not name a rejected confirmation', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2025-10-05T09:00:00Z'),
      askedAt: new Date('2025-10-05T09:05:00Z'),
    })
    await rejectRequest(ctx, paused.requestId, new Date('2025-10-05T09:10:00Z'))

    expect(await confirmationForIntent(ctx, paused.refusedIntentId)).toBeNull()
  })
})

/* ══════════════════════════ the browser credential, minted and revoked ══ */

describe('the control token lives exactly as long as the claim', () => {
  /** A pending run, and the claim that takes it. */
  async function claimedRun(): Promise<{ runId: string; token: string }> {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Anything.',
      definitionOfDone: 'Done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['click-element'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    const enqueued = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

    // A pending run holds nothing. This is the assertion that stops somebody
    // minting at enqueue for convenience.
    expect((await repos.runs.byId(enqueued.id))?.controlToken).toBeNull()

    // `claim` takes the OLDEST pending run, and the tests above leave some
    // behind. Drain until ours comes up rather than assuming it is first —
    // asserting on queue position would make this file depend on the order the
    // rest of it happened to run in.
    await claimUntil(enqueued.id, `token-${enqueued.id}`)

    const run = await repos.runs.byId(enqueued.id)
    expect(run?.controlToken).toBe(`token-${enqueued.id}`)

    return { runId: enqueued.id, token: run?.controlToken ?? '' }
  }

  async function claimUntil(runId: string, controlToken: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const claimed = await repos.runs.claim({
        leaseUntil: new Date(Date.now() + 60_000),
        startedAt: new Date(),
        claimedBy: 'worker-under-test',
        controlToken,
      })
      if (!claimed) throw new Error('the queue emptied before the run came up')
      if (claimed.id === runId) return
      // Someone else's leftover. Complete it so the queue moves on — and note
      // that completing revokes ITS token, which is the property under test.
      await repos.runs.complete(claimed.id, 'succeeded', new Date())
    }
    throw new Error('never reached the run under test')
  }

  it('is minted at the claim and revoked when the run completes', async () => {
    const { runId } = await claimedRun()
    await repos.runs.complete(runId, 'succeeded', new Date())

    // The credential dies with the run. A token that outlives the run it was
    // issued to is a dead worker still holding the keys to a live browser.
    expect((await repos.runs.byId(runId))?.controlToken).toBeNull()
  })

  it('is revoked when a run parks on a question, not only when it fails', async () => {
    const { runId } = await claimedRun()
    await repos.runs.complete(runId, 'awaiting-confirmation', new Date())

    // `awaiting-confirmation` is terminal FOR THIS RUN and is not a failure —
    // and a run parked overnight while somebody reads must not still be able to
    // drive a browser. The continuation mints its own at its own claim.
    expect((await repos.runs.byId(runId))?.controlToken).toBeNull()
  })

  it('is revoked when the lease sweep reaps an orphan', async () => {
    const { runId } = await claimedRun()
    await repos.runs.renewLease(runId, new Date(Date.now() - 60_000))

    await repos.runs.sweepExpiredLeases(new Date())

    // The whole reason to reap is that the worker is no longer trusted to be
    // driving. Leaving its credential behind would reap the claim and not the
    // capability.
    expect((await repos.runs.byId(runId))?.controlToken).toBeNull()
  })

  it('is revoked by a halt, along with the flag the fence reads', async () => {
    const { runId } = await claimedRun()

    const halted = await haltRun(ctx, runId)
    expect(halted.stopped).toBe(true)

    const run = await repos.runs.byId(runId)
    // Flag, revoke, settle — in that order, behind one implementation shared
    // with `POST /api/act/halt`.
    expect(run?.cancelRequested).toBe(true)
    expect(run?.controlToken).toBeNull()
    // The run is still live, so nothing in flight is settled early: a recovery
    // row over an in-flight intent turns a clean stop into a failed shift.
    expect(halted.unfinished).toBe(0)
  })

  it('is revoked when an answer arrives after the deadline', async () => {
    const acceptedAt = new Date('2025-12-01T09:00:00Z')
    const paused = await pausedShift({
      acceptedAt,
      askedAt: new Date('2025-12-01T09:05:00Z'),
      timeLimitMinutes: 30,
    })
    const answeredAt = new Date('2025-12-01T18:00:00Z')

    const answered = await confirmRequest(ctx, paused.requestId, answeredAt)
    if (!answered.ok || answered.continuationRunId === null) throw new Error('expected a run')

    await claimUntil(answered.continuationRunId, 'token-late')
    expect((await repos.runs.byId(answered.continuationRunId))?.controlToken).toBe('token-late')

    expect(await admitRun(ctx, answered.continuationRunId, answeredAt)).toBe('settled')

    // Claimed a moment ago, so it holds a live credential — and it is about to
    // never act. A token on a run that will not act is a token nothing will
    // ever revoke.
    const run = await repos.runs.byId(answered.continuationRunId)
    expect(run?.controlToken).toBeNull()
  })

  it('is revoked when a question times out', async () => {
    const askedAt = new Date('2025-11-01T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2025-11-01T09:00:00Z'), askedAt })

    await expireConfirmations(ctx, new Date(askedAt.getTime() + 25 * HOUR))

    expect((await repos.runs.byId(paused.runId))?.controlToken).toBeNull()
  })
})

/* ═══════════════════════════════ the ways this was got wrong once ══ */

describe('the near-misses, kept red', () => {
  it('does not warn about the deadline in the ordinary case', async () => {
    // Asked at 09:05, opened at 09:40, thirty-minute shift accepted at 09:00.
    // Computed WITHOUT crediting the pause being answered, the shift looks over
    // and the screen shows a red warning — then the verdict credits 35 minutes,
    // the run carries on perfectly well, and the warning was wrong in exactly
    // the situation it was written for.
    const paused = await pausedShift({
      acceptedAt: new Date('2026-02-01T09:00:00Z'),
      askedAt: new Date('2026-02-01T09:05:00Z'),
      timeLimitMinutes: 30,
    })

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-02-01T09:40:00Z'))
    expect(view?.pastDeadline).toBe(false)

    // And the projection agrees with what actually happens next.
    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-02-01T09:40:00Z'))
    if (!answered.ok || answered.continuationRunId === null) throw new Error('expected a run')
    expect(await admitRun(ctx, answered.continuationRunId, new Date('2026-02-01T09:40:00Z'))).toBe(
      'proceed',
    )
  })

  it('shows the text about to be typed untrimmed', async () => {
    const typed = '  Yes — go ahead.\n'
    const paused = await pausedShift({
      acceptedAt: new Date('2026-02-02T09:00:00Z'),
      askedAt: new Date('2026-02-02T09:05:00Z'),
      inputText: typed,
    })

    // The screen says "exactly these characters, nothing added and nothing
    // trimmed". A trimmed value makes that sentence false about the one value
    // it is written about.
    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-02-02T09:06:00Z'))
    expect(view?.typedText).toBe(typed)
  })

  it('keeps whitespace-only text visible rather than hiding the section', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-02-03T09:00:00Z'),
      askedAt: new Date('2026-02-03T09:05:00Z'),
      inputText: '   ',
    })

    // Trimming to null would remove "The words it would type" entirely — the
    // person authorising text the screen never showed them.
    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-02-03T09:06:00Z'))
    expect(view?.typedText).toBe('   ')
  })

  it('refuses to settle intents belonging to a run that is still alive', async () => {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Anything.',
      definitionOfDone: 'Done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['click-element'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })
    await repos.runs.advanceProgress(run.id, 1)

    const inFlight = await db.prisma.actionIntent.create({
      data: {
        runId: run.id,
        seq: 1,
        kind: 'click-element',
        reason: 'Mid-action right now.',
        params: {},
        authorized: true,
      },
      select: { id: true },
    })

    // `ActionOutcome.intentId` is unique. A recovery row written over a live
    // run's in-flight intent makes the worker's real write throw, which
    // propagates out and completes a healthy shift as failed — pressing "Take
    // back control" would be the thing that broke the run.
    expect(await settleAbandonedIntents(ctx, run.id)).toBe(0)
    expect(
      await db.prisma.actionOutcome.findUnique({ where: { intentId: inFlight.id } }),
    ).toBeNull()
  })

  it('adds the expiry note to a report the shift already has', async () => {
    const askedAt = new Date('2026-02-04T09:05:00Z')
    const paused = await pausedShift({ acceptedAt: new Date('2026-02-04T09:00:00Z'), askedAt })

    // An earlier run already wrote one, which is ordinary: `executeRun` writes
    // a report at the end of every run.
    await repos.reports.create({
      contractId: paused.contractId,
      narrative: 'I read three pages.',
      decisions: [],
    })

    await expireConfirmations(ctx, new Date(askedAt.getTime() + 25 * HOUR))

    const report = await repos.reports.forContract(paused.contractId)
    expect(report?.narrative).toContain('I read three pages.')
    // Dropping this sentence would lose exactly the note the sweep exists to
    // write, on the screen the person actually reads.
    expect(report?.narrative).toContain('went unanswered')

    // And a second sweep does not say it twice.
    await expireConfirmations(ctx, new Date(askedAt.getTime() + 26 * HOUR))
    const again = await repos.reports.forContract(paused.contractId)
    expect(again?.narrative?.match(/went unanswered/g)).toHaveLength(1)
  })

  it('finds a fresh question behind a pile of stale ones', async () => {
    const stale = new Date('2026-01-01T09:00:00Z')
    for (let i = 0; i < 12; i += 1) {
      await pausedShift({ acceptedAt: stale, askedAt: new Date(stale.getTime() + i * MINUTE) })
    }

    const fresh = await pausedShift({
      acceptedAt: new Date('2026-01-05T09:00:00Z'),
      askedAt: new Date('2026-01-05T09:05:00Z'),
    })

    // Paging the oldest ten and filtering in JavaScript made twelve dead
    // questions enough to hide every answerable one, forever and invisibly.
    const found = await oldestPendingConfirmation(ctx, Date.parse('2026-01-05T09:06:00Z'))
    expect(found?.requestId).toBe(fresh.requestId)
  })

  it('settles an abandoned intent idempotently, however many writers race', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2025-09-01T09:00:00Z'),
      askedAt: new Date('2025-09-01T09:05:00Z'),
    })

    const abandoned = await db.prisma.actionIntent.create({
      data: {
        runId: paused.runId,
        seq: 2,
        kind: 'click-element',
        reason: 'Nobody came back to this.',
        params: {},
        authorized: true,
      },
      select: { id: true },
    })

    // Four paths select "authorized intents with no outcome" and write to them:
    // the fenced-run handler, `haltRun`, the five-minute sweep, and the
    // continuation's own recovery pass. `ActionOutcome.intentId` is unique, so
    // two overlapping gives P2002 — fatal inside a sweep.
    const [first, second, third] = await Promise.all([
      settleAbandonedIntents(ctx, paused.runId),
      sweepAbandonedIntents(ctx),
      settleAbandonedIntents(ctx, paused.runId),
    ])

    // Exactly one of them wrote it, and none of them threw.
    expect(first + second + third).toBeGreaterThanOrEqual(1)

    const outcome = await db.prisma.actionOutcome.findUniqueOrThrow({
      where: { intentId: abandoned.id },
    })
    expect(outcome.observedBy).toBe('recovery')

    // And a fourth pass over the settled row reports honestly that it wrote
    // nothing, rather than counting somebody else's work.
    expect(await settleAbandonedIntents(ctx, paused.runId)).toBe(0)
  })

  it('keeps sweeping after a sweep throws', async () => {
    let calls = 0
    let handle: ReturnType<typeof startWorkerProcess>
    let clock = 0

    const deps = {
      sweepExpiredLeases: vi.fn(async () => {
        calls += 1
        if (calls >= 3) handle.stop()
        // The sweep now expires confirmations and settles intents row by row
        // against a file the Next process is also writing. A transient busy
        // error there used to reject `done` and end the loop — a worker that
        // has silently stopped claiming runs until somebody restarts it.
        throw new Error('database is locked')
      }),
      claimNext: vi.fn(async (): Promise<{ id: string } | null> => null),
      admit: vi.fn(async (): Promise<'proceed' | 'settled'> => 'proceed'),
      readRun: vi.fn(
        async (): Promise<{
          status: string
          claimedBy: string | null
          cancelRequested: boolean
        } | null> => null,
      ),
      execute: vi.fn(async (): Promise<void> => undefined),
      now: () => new Date((clock += 10 * MINUTE)),
      sleep: vi.fn(async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      }),
    }

    handle = startWorkerProcess(deps, { idlePollMs: 1, sweepEveryMs: MINUTE })
    const { runsCompleted } = await handle.done

    // A failed sweep costs one interval. A dead worker costs every run after it.
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(runsCompleted).toBe(0)
  })

  it('sweeps again while idle, so a question does not wait for a restart', async () => {
    let sweeps = 0
    let handle: ReturnType<typeof startWorkerProcess>
    let clock = 0

    const deps = {
      sweepExpiredLeases: vi.fn(async () => {
        sweeps += 1
        if (sweeps >= 3) handle.stop()
        return 0
      }),
      claimNext: vi.fn(async (): Promise<{ id: string } | null> => null),
      admit: vi.fn(async (): Promise<'proceed' | 'settled'> => 'proceed'),
      readRun: vi.fn(
        async (): Promise<{
          status: string
          claimedBy: string | null
          cancelRequested: boolean
        } | null> => null,
      ),
      execute: vi.fn(async (): Promise<void> => undefined),
      // Time moves, because the idle sweep is rate-limited on it.
      now: () => new Date((clock += 10 * MINUTE)),
      sleep: vi.fn(async (ms: number) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
      }),
    }

    handle = startWorkerProcess(deps, { idlePollMs: 1, sweepEveryMs: MINUTE })
    await handle.done

    // A run parked on `awaiting-confirmation` holds no lease, so the lease
    // sweep cannot see it — and expiring the question ran exactly once per
    // worker lifetime. On a worker left up for a week the question never
    // expired: no ending, and no re-entry note.
    expect(sweeps).toBeGreaterThanOrEqual(3)
  })
})

/* ════════════════════════════════════════════ 8. the screen itself ══ */

describe('the confirmation screen', () => {
  it('shows the verbatim text and offers exactly two controls', async () => {
    const typed = 'Confirmed — we can do 15%.\n\nBest,\nSam'
    const paused = await pausedShift({
      acceptedAt: new Date('2026-04-01T09:00:00Z'),
      askedAt: new Date('2026-04-01T09:05:00Z'),
      inputText: typed,
      accessibleName: 'Send',
      withImage: true,
    })

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-04-01T09:06:00Z'))
    expect(view).not.toBeNull()
    if (!view) return

    expect(view.typedText).toBe(typed)
    expect(view.attested.origin).toBe('https://mail.example.test')
    expect(view.attested.method).toBe('POST')
    expect(view.hasImage).toBe(true)

    // Both page-authored values are on the page-authored side. `document.title`
    // is not a fact Chrome vouched for, however naturally it reads beside a URL.
    expect(view.pageAuthored.elementName).toBe('Send')
    expect(view.pageAuthored.tabTitle).toBe('Re: Q1 partnership terms')

    const html = renderToStaticMarkup(
      createElement(ConfirmationScreen, {
        detail: {
          summary: view.summary,
          pastDeadline: view.pastDeadline,
          attested: view.attested,
          typedText: view.typedText,
          pageAuthored: view.pageAuthored,
          imageSrc: 'data:image/png;base64,iVBOR',
        },
        goAhead: () => undefined,
        dont: () => undefined,
      }),
    )

    // The words, exactly, newlines and all.
    expect(html).toContain('Confirmed — we can do 15%.')
    expect(html).toContain('Best,\nSam')

    // The attested half.
    expect(html).toContain('https://mail.example.test')
    expect(html).toContain('POST')

    // The page-authored half, quoted and attributed — never in Propositum's
    // own voice.
    expect(html).toContain('says')
    expect(html).toContain('Send')

    // Exactly two controls. Not three, and never one that says Approve.
    const buttons = html.match(/<button\b/g) ?? []
    expect(buttons).toHaveLength(2)
    expect(html).toContain('Go ahead')
    expect(html).toContain('Don')
    expect(html).not.toContain('Approve')
  })

  it('warns before the buttons when the shift has already run out', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-04-02T09:00:00Z'),
      askedAt: new Date('2026-04-02T09:05:00Z'),
      timeLimitMinutes: 30,
    })

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-04-02T18:00:00Z'))
    expect(view?.pastDeadline).toBe(true)

    const html = renderToStaticMarkup(
      createElement(ConfirmationScreen, {
        detail: {
          summary: 'Propositum wants to press Send.',
          pastDeadline: true,
          attested: {
            origin: null,
            url: null,
            method: null,
            actionKind: 'click-element',
          },
          typedText: null,
          pageAuthored: { elementName: null, tabTitle: null },
          imageSrc: null,
        },
        goAhead: () => undefined,
        dont: () => undefined,
      }),
    )

    expect(html).toContain('has already run out')
    // Absent facts are shown as absent. A screen whose job is being checkable
    // cannot fill a gap with something plausible.
    expect(html).toContain('Propositum was not told')
  })
})

/* ═══════════════════════════ what the extension is allowed to be told ══ */

describe('what the notification is told', () => {
  let pending: Paused

  beforeEach(async () => {
    pending = await pausedShift({
      acceptedAt: new Date('2026-03-01T09:00:00Z'),
      askedAt: new Date('2026-03-01T09:05:00Z'),
    })
  })

  it('offers the oldest unanswered question and a link to the screen', async () => {
    const found = await oldestPendingConfirmation(ctx, Date.parse('2026-03-01T09:06:00Z'))
    expect(found).not.toBeNull()
    expect(found?.summary).toContain('press Send')
  })

  it('says nothing about a question that can no longer be answered', async () => {
    const found = await oldestPendingConfirmation(ctx, Date.parse('2026-03-05T09:06:00Z'))
    // Interrupting somebody about a question that will be refused is the worst
    // kind of notification.
    expect(found?.requestId).not.toBe(pending.requestId)
  })

  it('says nothing once it has been answered', async () => {
    await rejectRequest(ctx, pending.requestId, new Date('2026-03-01T09:10:00Z'))
    const found = await oldestPendingConfirmation(ctx, Date.parse('2026-03-01T09:11:00Z'))
    expect(found?.requestId).not.toBe(pending.requestId)
  })
})

/* ══════════════════════════════ 9. a run actually gets into that state ══════ */

/**
 * Everything above starts from a paused shift this file builds by hand.
 *
 * That was the only option available: `confirmations.create` had no caller, so
 * the transition INTO the state could not be exercised, and the whole of the
 * machinery below it — the screen, the two verdicts, the expiry sweep, the
 * credited deadline, the continuation — was tested against rows nothing had
 * ever written. `tests/reachability.test.ts` pinned that absence and called it
 * *"the one worth watching"*, on the grounds that a rule nothing raises is a
 * rule that never fires and is invisible in a green suite.
 *
 * This is the transition, driven end to end: a ratified contract that grants
 * the browser verbs, a run that observes a page through a stubbed control
 * channel, a click the gate refuses because there is no evidence about the
 * element, and the row a person is eventually shown.
 */
describe('a run reaches the paused state on its own', () => {
  /**
   * The app's half of `/api/act/dispatch`, small enough to read.
   *
   * `createBrowserControl` posts a JSON body and parses a `dispatchResponse`.
   * Standing in for the route rather than starting a server keeps this a test
   * about the run path — whether the pause is raised and the run parked — and
   * `tests/act-channel.test.ts` already drives the real routes.
   *
   * It answers ONE dispatch, the `observe-page`. The click that follows never
   * reaches a browser, because the gate refuses it first, and that is the whole
   * assertion: a scripted second answer going unused is the evidence that
   * nothing was dispatched.
   */
  function stubbedChannel(observation: Record<string, unknown>): {
    fetch: typeof globalThis.fetch
    dispatched: string[]
  } {
    const dispatched: string[] = []
    const fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { kind?: string }
      dispatched.push(body.kind ?? 'unknown')
      return new Response(JSON.stringify({ ok: true, report: { ok: true, observation } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch

    return { fetch, dispatched }
  }

  async function browserShift(): Promise<{ contractId: string }> {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({
      sessionId,
      throughSeq: 0,
      claims: [{ kind: 'objective', text: 'Find my delivery date.', ordinal: 0, evidence: [] }],
    })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Find my delivery date.',
      definitionOfDone: 'The date is written down.',
      guidance: [],
      approvedSourceIds: [],
      // What `draftContract` now grants a shift with nothing pinned. Written out
      // rather than imported so this test says what it is exercising.
      allowedActionKinds: [
        'observe-page',
        'navigate',
        'click-element',
        'type-text',
        'press-key',
        'capture-screen',
      ],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())

    // What handing the work over does. Set here so the pause path can be asked
    // whether it hands the session BACK — starting from `observing` would make
    // that question unanswerable, which is how the first version of the last
    // assertion in this block passed while checking nothing.
    await repos.sessions.markAway(sessionId)

    return { contractId: contract.id }
  }

  const OBSERVATION = {
    snapshotId: 'snap-1',
    url: 'https://orders.example.test/orders/8812',
    title: 'Your orders',
    tree: 'e1 button "Track shipment"',
    truncated: false,
  }

  const REPLIES = [
    { kind: 'ok' as const, value: { steps: [{ intent: 'Open my orders and find the date.' }] } },
    { kind: 'ok' as const, value: { kind: 'observe-page', reason: 'See what is on the page.' } },
    {
      kind: 'ok' as const,
      value: {
        kind: 'click-element',
        reason: 'Track shipment shows the delivery date.',
        ref: 'e1',
        snapshotId: 'snap-1',
      },
    },
    { kind: 'ok' as const, value: { kind: 'observe-page', reason: 'Read it.' } },
  ]

  async function drive(
    /** The page the run sees. Defaults to the one the question is asked about;
     *  a continuation is handed a different tree to show what happens when the
     *  page has moved under the person's answer. */
    observation?: Record<string, unknown>,
  ): Promise<{ runId: string; contractId: string; dispatched: string[] }> {
    const { contractId } = await browserShift()
    const enqueued = await repos.runs.enqueue({ contractId, role: 'worker' })

    /**
     * Claimed by id rather than through `runs.claim`, which takes the OLDEST
     * pending row.
     *
     * Other tests in this file leave continuations pending on purpose — that is
     * what a confirmed question produces — so `claim()` here would take one of
     * those and leave this run without a token. The failure is subtle and
     * order-dependent: no token means `browserFor` returns undefined, the run
     * has no hands, and `observe-page` fails with *"no browser to carry it out
     * in"* instead of reaching the click. Worth the note, because the same shape
     * would make a real second worker steal a run mid-suite.
     *
     * The mint site is still `scripts/worker.ts`, and
     * `tests/reachability.test.ts` is what holds that.
     */
    await db.prisma.agentRun.update({
      where: { id: enqueued.id },
      data: {
        status: 'claimed',
        claimedBy: 'test-runner',
        startedAt: new Date(),
        leaseUntil: new Date(Date.now() + 60_000),
        controlToken: 'control-token-for-this-run',
      },
    })

    // The page the person will be shown beside the question. Written here
    // because `/api/act/report` is what writes one in production and this test
    // stands in for the route.
    //
    // Through the LEDGER WRITER rather than the repository, and carrying the
    // tree rather than only the title — because that is what the route does, and
    // because the stored shape is now read back: `confirmedDescriptor` in
    // `src/server/execute-run.ts` pulls the confirmed element's line out of
    // `untrusted.text` so a re-render cannot move a yes onto another control. A
    // fixture that wrote a title and no tree would leave that derivation testable
    // only against a shape production never produces.
    await createLedgerWriter(db.prisma).appendEvidence({
      runId: enqueued.id,
      kind: 'page-snapshot',
      url: OBSERVATION.url,
      untrustedText: OBSERVATION.tree,
    })

    const { fetch, dispatched } = stubbedChannel(observation ?? OBSERVATION)

    await executeRun(enqueued.id, {
      // The full `AppContext`, which is `ConfirmationContext` plus a ledger and
      // a closable database. `ctx` above is the narrower shape on purpose — see
      // its docblock in `src/server/confirmations.ts` — so this reassembles the
      // wide one rather than widening the field every other test here uses.
      ctx: { db, repos, ledger: createLedgerWriter(db.prisma) },
      model: new FakeModelClient(REPLIES as never),
      fetcher: fixtureFetcher({}),
      fence: { check: async () => ({ proceed: true as const }) },
      now: () => Date.now(),
      fetch,
    })

    return { runId: enqueued.id, contractId, dispatched }
  }

  it('writes the ConfirmationRequest nothing used to write', async () => {
    const { runId } = await drive()

    const request = await db.prisma.confirmationRequest.findFirstOrThrow({ where: { runId } })

    // Code-generated from the browser-attested URL and the kind. The worker's
    // own `reason` — "Track shipment shows the delivery date" — is model prose
    // and must not be what a person is asked to authorise.
    expect(request.summary).toBe('Press something on orders.example.test')
    expect(request.summary).not.toContain('Track shipment')
  })

  it('points the question at the refused intent, and leaves it refused', async () => {
    const { runId } = await drive()

    const request = await db.prisma.confirmationRequest.findFirstOrThrow({ where: { runId } })
    const intent = await db.prisma.actionIntent.findUniqueOrThrow({
      where: { id: request.intentId },
      include: { outcome: true },
    })

    expect(intent.kind).toBe('click-element')
    expect(intent.authorized).toBe(false)
    expect(intent.refusedRule).toBe('confirmation_required')
    // A refusal produces exactly one row and NO ActionOutcome — its fate was
    // fully determined the moment the gate decided.
    expect(intent.outcome).toBeNull()
  })

  it('shows the person the page the run was looking at', async () => {
    const { runId } = await drive()

    const request = await db.prisma.confirmationRequest.findFirstOrThrow({ where: { runId } })
    expect(request.evidenceId).not.toBeNull()

    const view = await confirmationView(ctx, request.id, Date.now())
    expect(view?.attested.url).toContain('orders.example.test')
  })

  it('parks the run and takes its browser credential away', async () => {
    const { runId } = await drive()

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })

    expect(run.status).toBe('awaiting-confirmation')
    // No terminalReason: there is nothing terminal to explain, and the question
    // is the explanation.
    expect(run.terminalReason).toBeNull()
    // A run parked overnight on a question must not still hold a credential
    // that drives somebody's browser.
    expect(run.controlToken).toBeNull()
  })

  it('dispatches the looking and never the clicking', async () => {
    const { dispatched } = await drive()

    // The gate refused the click before any tool ran, so the only thing that
    // reached the channel was the observation. If this ever holds
    // `click-element`, something pressed a button in a live page without a
    // person having said yes.
    expect(dispatched).toEqual(['observe-page'])
  })

  it('writes no ShiftReport, because the shift has not ended', async () => {
    const { contractId } = await drive()

    // The pause is not an ending. `expireConfirmations` writes the note if the
    // question goes unanswered for a day; `admitRun` writes it if the answer
    // arrives too late; a yes starts a continuation which writes its own.
    expect(await repos.reports.forContract(contractId)).toBeNull()
  })

  it('leaves the session away rather than inventing a phase for waiting', async () => {
    const { contractId } = await drive()

    const contract = await db.prisma.handoffContract.findUniqueOrThrow({
      where: { id: contractId },
      select: { sessionId: true },
    })
    const session = await db.prisma.workSession.findUniqueOrThrow({
      where: { id: contract.sessionId },
    })

    // ADR-0010 records this as a lie it is knowingly telling: `SessionPhase` has
    // no honest value for a person sitting at their desk being asked a question
    // under a screen headed "While you were away". Keeping `away` is the
    // smaller lie, and marking the session observing would be the larger one —
    // it would say the work came back when it is still waiting for them.
    expect(session.phase).toBe('away')
  })

  /* ═════════════════════ 10. the yes lands on the element it was given for ══ */

  /**
   * The whole loop, once, against a real database: pause → confirm → continue.
   *
   * ── Why this did not exist ───────────────────────────────────────────────
   *
   * Section 9 drives a run INTO the paused state and stops there. Everything
   * after the answer — the continuation claiming the work, rebuilding what the
   * person said yes to, and the gate letting the click through on the strength of
   * it — was only ever exercised against `FakeModelClient` in
   * `tests/browser-loop.test.ts`, with the confirmed action handed in as a
   * literal. Nothing checked that the row a real pause writes is a row a real
   * continuation can read.
   *
   * That gap is exactly where issue #109 lived. `confirmationIdFor` matched on
   * `ref` alone, and a ref is meaningful only against the snapshot that issued it
   * — so a page that re-rendered between the question and the answer could move a
   * yes about *Track shipment* onto whatever took its place. The fix compares the
   * element's own line of the tree, and the confirmed side of that comparison is
   * DERIVED from `ConfirmationRequest.evidenceId` — the page-snapshot the person
   * was shown. Deriving it is what these two cases actually test; the matching
   * itself is unit-tested next door.
   *
   * ── The two pages ────────────────────────────────────────────────────────
   *
   * Same ref, `e1`, in both. In the first it still says what it said when the
   * person answered, and the click goes through. In the second something else has
   * taken that position, and the run asks again rather than pressing it.
   */
  describe('a confirmed click lands on the element the person was shown', () => {
    const MOVED = {
      // The SAME snapshot id as `OBSERVATION`, deliberately. The gate refuses a
      // stale ref (stage 8) long before it reaches confirmation (stage 11), so a
      // different id here would refuse for a reason that has nothing to do with
      // what this case is about — and the test would pass without the fix.
      snapshotId: 'snap-1',
      url: 'https://orders.example.test/orders/8812',
      title: 'Your orders',
      // The page re-rendered. `e1` is still a button and it is not the same one.
      tree: 'e1 button "Cancel order"',
      truncated: false,
    }

    /** Answer yes, then run the continuation the answer enqueued. */
    async function continueAfterYes(seenNow?: Record<string, unknown>): Promise<{
      intents: Array<{ kind: string; authorized: boolean; refusedRule: string | null }>
    }> {
      const { runId } = await drive()
      const request = await db.prisma.confirmationRequest.findFirstOrThrow({ where: { runId } })

      const answered = await confirmRequest(ctx, request.id, new Date())
      expect(answered.ok).toBe(true)
      const continuationId = answered.ok ? answered.continuationRunId : null
      expect(continuationId).not.toBeNull()

      // Claimed by id for the reason `drive` gives: `claim()` takes the oldest
      // pending row, and this file leaves other continuations pending on purpose.
      await db.prisma.agentRun.update({
        where: { id: continuationId ?? '' },
        data: {
          status: 'claimed',
          claimedBy: 'test-runner',
          startedAt: new Date(),
          leaseUntil: new Date(Date.now() + 60_000),
          controlToken: 'control-token-for-the-continuation',
        },
      })

      const { fetch } = stubbedChannel(seenNow ?? OBSERVATION)

      await executeRun(continuationId ?? '', {
        ctx: { db, repos, ledger: createLedgerWriter(db.prisma) },
        model: new FakeModelClient(REPLIES as never),
        fetcher: fixtureFetcher({}),
        fence: { check: async () => ({ proceed: true as const }) },
        now: () => Date.now(),
        fetch,
      })

      const intents = await db.prisma.actionIntent.findMany({
        where: { runId: continuationId ?? '' },
        orderBy: [{ seq: 'asc' }],
        select: { kind: true, authorized: true, refusedRule: true },
      })

      return { intents }
    }

    it('presses it when the page still says what it said', async () => {
      const { intents } = await continueAfterYes()

      const click = intents.find((intent) => intent.kind === 'click-element')
      expect(click?.authorized).toBe(true)
      expect(click?.refusedRule).toBeNull()
    })

    it('asks again when something else has taken that position', async () => {
      const { intents } = await continueAfterYes(MOVED)

      const click = intents.find((intent) => intent.kind === 'click-element')
      // The yes was about "Track shipment". Pressing whatever replaced it is the
      // failure this comparison exists to prevent, and asking twice is the cost
      // that buys it.
      expect(click?.authorized).toBe(false)
      expect(click?.refusedRule).toBe('confirmation_required')
    })
  })
})

/* ══════════════════════════════════ 9. parking is one write or no write ══ */

/**
 * The park must be atomic, because the loop's docblock says it already is.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `ConfirmationNeeded` in `src/runtime/worker-loop.ts` explains why the loop
 * returns the pause instead of writing it: *"parking the run is one transaction
 * with `runs.complete(…, 'awaiting-confirmation', …)`, which clears the control
 * token, and a loop that could write the request without ending the run could
 * leave a question outstanding against a run still holding a credential and
 * driving a browser."*
 *
 * That was the right property and it was not the one the code had. The park was
 * two sequential awaits — `confirmations.create` then `runs.complete` — so a
 * crash, a `SIGKILL` or a lid closing between them produced exactly the state
 * that paragraph names as the thing the shape exists to prevent. The claim was
 * worse than the gap: a reader of it was told the window did not exist.
 *
 * ── Why this is a grep and not a rollback test ───────────────────────────
 *
 * The behaviour is covered above and covered well: `drive()` runs `executeRun`
 * to a real park against real SQLite, and the cases there read the request, the
 * status and the cleared token off the rows that resulted. What none of them
 * can show is that the two writes are ONE — a rollback test would have to
 * induce a failure between them, and the only failure available at that seam
 * (a bad foreign key on the request) aborts the FIRST write, which was already
 * safe before this change and proves nothing about it.
 *
 * So the property asserted here is the one that is actually ours: **the two
 * writes are inside a single `$transaction`, and neither non-transactional door
 * is reachable from the park.** That Prisma rolls an interactive transaction
 * back when its callback throws is Prisma's guarantee, not this repository's,
 * and testing it here would be testing the dependency.
 *
 * Its limit, stated: it cannot catch a transaction that is opened and then
 * awaited wrongly, and it cannot catch a third write being added outside it
 * somewhere other than this block. It refuses the revert, which is what the
 * comparable guard in `tests/architecture.test.ts` claims for itself too.
 */
describe('a paused run is parked in one transaction', () => {
  const source = () =>
    stripComments(readFileSync(new URL('../src/server/execute-run.ts', import.meta.url), 'utf8'))

  /** The `if (result.awaiting !== undefined) { … }` body, balanced to its close. */
  const parkBlock = (): string | null => {
    const text = source()
    const at = text.indexOf('result.awaiting !== undefined')
    if (at === -1) return null

    let depth = 0
    for (let i = text.indexOf('{', at); i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) return text.slice(at, i + 1)
      }
    }
    return text.slice(at)
  }

  it('still has a park block, or every assertion below is about nothing', () => {
    expect(parkBlock()).not.toBeNull()
  })

  it('parks through the one door that is a transaction, and awaits it', () => {
    const block = parkBlock() ?? ''
    expect(block).toMatch(/await\s+ctx\.repos\.confirmations\.raiseAndPark\(/)
  })

  it('writes the question and the status through the same transaction', () => {
    const repositories = stripComments(
      readFileSync(new URL('../src/persistence/repositories/index.ts', import.meta.url), 'utf8'),
    )
    const at = repositories.indexOf('raiseAndPark: (')
    expect(at).toBeGreaterThan(-1)

    // Balanced from the brace that opens the TRANSACTION CALLBACK, not from the
    // first brace after the name — that one is the destructured argument, and it
    // closes on the same line, which is how this guard first passed vacuously
    // against a body it had never read.
    const arrow = repositories.indexOf('=>', at)
    let depth = 0
    let body = ''
    for (let i = repositories.indexOf('{', arrow); i < repositories.length; i += 1) {
      if (repositories[i] === '{') depth += 1
      else if (repositories[i] === '}') {
        depth -= 1
        if (depth === 0) {
          body = repositories.slice(at, i + 1)
          break
        }
      }
    }

    expect(body).toContain('prisma.$transaction')
    expect(body).toMatch(/tx\.confirmationRequest\.create\(/)
    // ~~`tx.agentRun.update(`~~ **Corrected 2026-09-02 (#140).** An unpredicated
    // `update` is what let a reaped run be rewritten back to parked. The write
    // is now an `updateMany` scoped on the live statuses, and the count decides
    // whether the question is asked at all — so this asserts the guarded form
    // and would go red on a return to the unguarded one.
    expect(body).toMatch(/tx\.agentRun\.updateMany\(/)
    expect(body).not.toMatch(/tx\.agentRun\.update\(/)
    // If this goes, a run parked overnight on a question is holding a credential
    // that drives somebody's browser.
    expect(body).toContain('controlToken: null')
    expect(body).toContain("status: 'awaiting-confirmation'")
  })

  /**
   * The status write comes FIRST, and the order is load-bearing.
   *
   * Creating the question and then discovering the run cannot be parked would
   * leave a `ConfirmationRequest` against a terminal run — a question on
   * somebody's phone about work that is over, which is the state section 10
   * below spends a refusal and a screen on. Writing the status first means a
   * refused park writes nothing at all.
   */
  it('decides whether it may park before it writes the question', () => {
    const repositories = stripComments(
      readFileSync(new URL('../src/persistence/repositories/index.ts', import.meta.url), 'utf8'),
    )
    const at = repositories.indexOf('raiseAndPark: (')
    const status = repositories.indexOf('tx.agentRun.updateMany(', at)
    const question = repositories.indexOf('tx.confirmationRequest.create(', at)

    expect(status).toBeGreaterThan(-1)
    expect(question).toBeGreaterThan(-1)
    expect(status).toBeLessThan(question)
  })

  it('reaches neither non-transactional door', () => {
    const block = parkBlock() ?? ''
    // These are the two calls the park used to make, in this order, outside any
    // transaction. Either one appearing here is the bug returning.
    expect(block).not.toContain('repos.confirmations.create')
    expect(block).not.toContain('repos.runs.complete')
  })
})

/* ═════════════════════════ 10. a question whose work is over ═════════════ */

/**
 * The half of #108 that PR #111 left open on purpose.
 *
 * `raiseAndPark` closed the window where a question could exist beside a run
 * still holding a control token. It did not close the other end: `confirmRequest`
 * checked that the request existed, had no verdict and had not expired, and
 * never read the parent run's status. So a question raised by a run that was
 * later reaped — `interrupted` / `lease-expired`, credential revoked, precisely
 * because we stopped trusting it to be driving — could still be answered, and
 * answering enqueued a continuation off the back of it.
 *
 * That was never a permission failure. A human really did confirm. It is a
 * person being asked about work that had been abandoned, and not being told.
 *
 * ── Why the fix is symmetry rather than invention ────────────────────────
 *
 * Two sibling queries in `src/server/confirmations.ts` already filter on
 * `run: { status: 'awaiting-confirmation' }` — `expireConfirmations` and
 * `oldestPendingConfirmation`. So the question already vanished from the
 * extension's notification while staying fully answerable by URL. The one that
 * GRANTS something was the one not looking.
 *
 * ── What actually reaches it, said rather than implied ───────────────────
 *
 * Two populations, and the first is routine rather than rare.
 * `expireConfirmations` runs on the worker's five-minute poll and ends the run
 * of every question older than `CONFIRMATION_EXPIRY_HOURS`, so minutes after
 * the day is up an unanswered question is BOTH expired and no longer parked.
 * That is why `confirmRequest` reads the status AFTER the expiry check and why
 * `unansweredReason` breaks the same tie the same way: somebody a day late is
 * owed "too slow", not "the work ended", and one row must not get two
 * explanations.
 *
 * The second is what `abandoned` is left for: a run that ended for some other
 * reason while its question was still inside its day. Today that is a row
 * written before `raiseAndPark` landed — the old create-then-complete pair, a
 * crash between them, the lease sweep. Nothing currently ends a correctly
 * parked run early. `sweepExpiredLeases` matches `claimed | running` and
 * `requestCancel` matches `pending | claimed | running`, which means a person
 * pressing Stop on a parked run changes nothing at all and the question stays
 * answerable — its own defect, and #141.
 *
 * The population an earlier draft of this paragraph named — "a run reaped
 * before it got as far as parking" — does not reach this state, and the reason
 * is worth writing down rather than quietly dropping. `raiseAndPark` writes
 * `awaiting-confirmation` with no status predicate, so it rewrites a reaped run
 * back to parked, carrying the stale `terminalReason 'lease-expired'` with it.
 * That row looks correctly parked and its question is answerable. Separate
 * pre-existing defect, #140.
 *
 * The tests below construct the abandoned state directly rather than pretending
 * a live sweep produces it. The expiry pair at the end runs the real sweep,
 * because there the sweep is the point.
 */
describe('a question is not answerable once the work behind it is over', () => {
  /** The state, however it was arrived at: a request whose run is not parked. */
  async function reaped(): Promise<Paused> {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-04T09:00:00Z'),
      askedAt: new Date('2026-05-04T09:05:00Z'),
    })
    await db.prisma.agentRun.update({
      where: { id: paused.runId },
      data: { status: 'interrupted', terminalReason: 'lease-expired', controlToken: null },
    })
    return paused
  }

  it('turns the yes down rather than enqueueing work off an abandoned run', async () => {
    const paused = await reaped()

    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-05-04T09:06:00Z'))

    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.reason).toBe('abandoned')
  })

  it('writes no verdict, so the gate sees the absence it saw before', async () => {
    const paused = await reaped()
    await confirmRequest(ctx, paused.requestId, new Date('2026-05-04T09:06:00Z'))

    // The same property expiry has. A refusal that recorded a `confirmed` row
    // and then did not act on it would leave a permission on disk for the next
    // thing that reads one. ("Declined" stood here until 2026-09-01, and that
    // is the model's verb — deterministic code refuses.)
    const verdict = await db.prisma.confirmationVerdict.findUnique({
      where: { requestId: paused.requestId },
    })
    expect(verdict).toBeNull()
  })

  it('still lets the person say no, because saying no grants nothing', async () => {
    const paused = await reaped()

    // Same asymmetry `rejectRequest` already has against expiry. A no is a
    // record of what the person wanted, and it authorises nothing, so there is
    // no reason to refuse it — and refusing would leave them unable to answer
    // at all.
    const rejected = await rejectRequest(ctx, paused.requestId, new Date('2026-05-04T09:06:00Z'))
    expect(rejected.ok).toBe(true)
  })

  it('leaves a properly parked question answerable, or this rule eats the product', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-04T09:00:00Z'),
      askedAt: new Date('2026-05-04T09:05:00Z'),
    })

    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-05-04T09:06:00Z'))
    expect(answered.ok).toBe(true)
  })

  it('tells the screen so, before the person is offered a button', async () => {
    const paused = await reaped()

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-05-04T09:06:00Z'))
    expect(view).not.toBeNull()
    if (!view) return

    // Neither answered nor expired, so without this the page falls through to
    // the live screen with both controls — under copy promising that Propositum
    // picks the work up again afterwards, which by then is false.
    expect(view.verdict).toBeNull()
    expect(view.expired).toBe(false)
    expect(view.abandoned).toBe(true)
  })

  it('says what happened in words that name no verdict nobody gave', async () => {
    const html = renderToStaticMarkup(
      createElement(SettledConfirmation, {
        summary: 'Propositum wants to press Send on mail.example.test.',
        verdict: null,
        unanswered: 'abandoned' as const,
      }),
    )
    const said = html.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&rsquo;/g, "'")

    expect(said).toContain('stopped before anyone answered')
    // The expiry sentence is a different fact and must not stand in for this one.
    expect(said).not.toContain('went unanswered for a day')
  })

  /**
   * The ordinary day-late yes, produced by the real sweep rather than
   * constructed — because the sweep is what makes it the ordinary one.
   *
   * `expireConfirmations` ends the run of every question older than
   * `CONFIRMATION_EXPIRY_HOURS`, so a few minutes after the day is up an
   * unanswered question is both expired AND no longer parked. Read the status
   * first and every day-late yes is told the work ended rather than that it
   * was too late, while the screen breaks the same tie the other way — two
   * sentences about one row.
   */
  it('tells a day-late yes it was too late, not that the work ended', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-05T09:00:00Z'),
      askedAt: new Date('2026-05-05T09:05:00Z'),
    })

    const afterTheSweep = new Date('2026-05-06T09:10:00Z')
    await expireConfirmations(ctx, afterTheSweep)

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: paused.runId } })
    expect(run.status).toBe('interrupted')
    expect(run.terminalReason).toBe(CONFIRMATION_EXPIRED)

    const answered = await confirmRequest(ctx, paused.requestId, afterTheSweep)
    expect(answered.ok).toBe(false)
    if (answered.ok) return
    expect(answered.reason).toBe('expired')
  })

  it('hands the screen both facts about a swept question, not one of them', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-07T09:00:00Z'),
      askedAt: new Date('2026-05-07T09:05:00Z'),
    })

    const afterTheSweep = Date.parse('2026-05-08T09:10:00Z')
    await expireConfirmations(ctx, new Date(afterTheSweep))

    const view = await confirmationView(ctx, paused.requestId, afterTheSweep)
    expect(view).not.toBeNull()
    if (!view) return

    // Both, and that is routine rather than a corner: the sweep that notices
    // the expiry is the thing that ends the run.
    expect(view.expired).toBe(true)
    expect(view.abandoned).toBe(true)

    // And the screen says the same thing the answer path does about that row.
    expect(unansweredReason(view)).toBe('expired')
  })

  /**
   * The page cannot be rendered here — a `.tsx` server component is the one
   * thing in this repository nothing can assert against — so the tie-break
   * lives beside `confirmRequest` and is tested directly. Two places breaking
   * the same tie is how one row acquires two explanations, and that is what
   * this pair is guarding.
   */
  it('names the expiry when both are true, and the abandonment when only it is', () => {
    expect(unansweredReason({ expired: true, abandoned: true })).toBe('expired')
    expect(unansweredReason({ expired: false, abandoned: true })).toBe('abandoned')
    expect(unansweredReason({ expired: true, abandoned: false })).toBe('expired')
  })

  /**
   * The sentence, not the reason code.
   *
   * `confirmOnePendingRequest` is where a reason becomes words, and the expiry
   * message sits directly below this branch saying the opposite thing about the
   * same refusal. A branch that fell through to it would be a one-line mistake
   * telling somebody who answered within a minute that they took a day.
   *
   * Asked NOW rather than through `reaped()`, and that is not a convenience:
   * the server action reads the wall clock — `confirmRequest(ctx, id, new
   * Date())` — so a fixture dated months ago is expired before it is anything
   * else, and this branch is only reachable inside the day. Written the other
   * way it passed against the expiry sentence and asserted nothing.
   */
  it('tells the person the work stopped rather than that they were too slow', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date(Date.now() - MINUTE),
      askedAt: new Date(),
    })
    await db.prisma.agentRun.update({
      where: { id: paused.runId },
      data: { status: 'interrupted', terminalReason: 'lease-expired', controlToken: null },
    })

    const result = await actions.confirmOnePendingRequest(paused.requestId)
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.problem.message).toContain('stopped before your answer arrived')
    expect(result.problem.message).not.toContain('sat unanswered for a day')
  })
})

/* ═════════════════════ 11. a park that checks what it overwrites ═════════ */

/**
 * The half of #108's neighbourhood that #111 and #132 both left open — #140.
 *
 * `raiseAndPark` wrote the run's status with an unpredicated `update`, so the
 * question is only half the story: a run the lease sweep had already reaped
 * came back out of the park reading `awaiting-confirmation` while still
 * carrying `terminalReason: 'lease-expired'`. `prisma/schema.prisma` partitions
 * that column strictly by status and documents `awaiting-confirmation` as
 * taking none, *"because there is nothing terminal to explain"* — so the row
 * said two things a reader cannot reconcile, in the table the shift report is
 * built from. It also meant the population #132's refusal was written for never
 * reached it: the run came out looking correctly parked, and its question was
 * answerable.
 *
 * ── Why the window is real, and where it is ──────────────────────────────
 *
 * The claim fence in `ledgerFor` is checked when the REFUSED intent is
 * committed. Everything after that — the loop returning through `askFirst`,
 * `executeRun` reading `lastPageSnapshot` — is time the sweep can land in. So
 * the fence is not the thing that closes this; the predicate is.
 *
 * ── What these tests do NOT cover ────────────────────────────────────────
 *
 * The race itself. Both call the sweep and then the park, in order, on one
 * connection — which is the state the race produces, not the race. A test that
 * interleaved two real workers would be measuring SQLite's locking rather than
 * this predicate.
 */
describe('a park refuses a run that something else already ended', () => {
  /** A claimed run whose lease is already in the past. */
  async function reapableRun(): Promise<{ runId: string; intentId: string }> {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Anything.',
      definitionOfDone: 'Done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['click-element'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    const enqueued = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

    // `claim` takes the oldest pending run and this file leaves some behind, so
    // drain until ours comes up rather than assuming queue position.
    for (let attempt = 0; ; attempt += 1) {
      if (attempt >= 200) throw new Error('never reached the run under test')
      const claimed = await repos.runs.claim({
        leaseUntil: new Date(Date.now() - 60_000),
        startedAt: new Date(),
        claimedBy: 'worker-under-test',
        controlToken: `token-${enqueued.id}`,
      })
      if (!claimed) throw new Error('the queue emptied before the run came up')
      if (claimed.id === enqueued.id) break
      await repos.runs.complete(claimed.id, 'succeeded', new Date())
    }

    // A real refused intent, because before the fix the park CREATED the
    // question and the foreign key had to resolve. A fabricated id would have
    // made this pass for the wrong reason.
    const refused = await db.prisma.actionIntent.create({
      data: {
        runId: enqueued.id,
        seq: 1,
        kind: 'click-element',
        reason: 'Send is the next control.',
        params: { ref: 'e47', snapshotId: 'snap-1', method: 'POST' },
        authorized: false,
        refusedRule: 'confirmation_required',
      },
      select: { id: true },
    })

    return { runId: enqueued.id, intentId: refused.id }
  }

  it('leaves a reaped run reaped, and asks nothing', async () => {
    const { runId, intentId } = await reapableRun()

    expect(await repos.runs.sweepExpiredLeases(new Date())).toBeGreaterThan(0)
    const reaped = await repos.runs.byId(runId)
    expect(reaped?.status).toBe('interrupted')

    const parked = await repos.confirmations.raiseAndPark({
      runId,
      intentId,
      summary: 'Propositum wants to press Send on mail.example.test.',
      endedAt: new Date(),
    })

    expect(parked.parked).toBe(false)

    // The row the sweep wrote, untouched. Before #140 this came back
    // `awaiting-confirmation` with `terminalReason: 'lease-expired'` still on
    // it — a status and a terminal reason that contradict each other.
    const after = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })
    expect(after.status).toBe('interrupted')
    expect(after.terminalReason).toBe('lease-expired')
    expect(after.controlToken).toBeNull()

    // And no question. A refused park writes nothing at all, which is why the
    // status is decided before the request is created.
    expect(await db.prisma.confirmationRequest.count({ where: { runId } })).toBe(0)
  })

  it('still parks a run that is genuinely live', async () => {
    const { runId, intentId } = await reapableRun()

    // Same shape, no sweep. The guard has to refuse the reaped run WITHOUT
    // refusing the ordinary one, or it is not a fix but an outage.
    await repos.runs.renewLease(runId, new Date(Date.now() + 60_000))

    const parked = await repos.confirmations.raiseAndPark({
      runId,
      intentId,
      summary: 'Propositum wants to press Send on mail.example.test.',
      endedAt: new Date(),
    })

    expect(parked.parked).toBe(true)

    const after = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } })
    expect(after.status).toBe('awaiting-confirmation')
    expect(after.terminalReason).toBeNull()
    expect(after.controlToken).toBeNull()
    expect(await db.prisma.confirmationRequest.count({ where: { runId } })).toBe(1)
  })

  /**
   * The same defect one layer up, and the one that made the fence a paragraph.
   *
   * `advanceProgress` runs at the top of every worker turn and writes
   * `status: 'running'` along with the step. Unpredicated, it put a reaped run
   * back to `running` — and status is the ONLY one of `fenceFor`'s three
   * signals that a lease sweep moves, because the sweep touches neither
   * `claimedBy` nor `cancelRequested`. So the reaped worker resurrected itself,
   * passed its own fence one step later, and carried on driving.
   */
  it('does not let a reaped run put itself back to running', async () => {
    const { runId } = await reapableRun()

    await repos.runs.sweepExpiredLeases(new Date())
    await repos.runs.advanceProgress(runId, 2)

    const after = await repos.runs.byId(runId)
    expect(after?.status).toBe('interrupted')
  })
})

/* ═══════════════════ 12. a way back from a question that is over ═════════ */

/**
 * The half of #108 that #132 left, and that `stop-conditions.ts` decided before
 * anything was built — #139.
 *
 * Three sentences in the product tell a person to hand the work over again:
 * `confirmOnePendingRequest` says it twice, once for a run that ended and once
 * for a question that sat a day, and `ANSWERED_TOO_LATE_REPORT` says it in the
 * shift report. None of the three was beside anything that does it, and the
 * closed confirm screen — which could — rendered no href of its own at all.
 *
 * `stop-conditions.ts` wrote the requirement down in 2026: *"a person answering
 * a question whose shift has already ended should be TOLD that, and offered a
 * fresh shift."* #132 built the telling. This is the offering.
 *
 * ── Why an offer here is not a pre-approval ──────────────────────────────
 *
 * Because it authorises nothing. The link lands on the ordinary agreement
 * screen and a person ratifies a new `HandoffContract` there in full, with the
 * same panel and the same dials as any other handover. That is the whole reason
 * this is the ONE control a dead end may carry: the two buttons that would lie
 * are still absent.
 *
 * ── What these tests do NOT cover ────────────────────────────────────────
 *
 * That `/sessions/<id>` renders anything. It is the same address the drifted
 * shift report has used for its own *Hand over again* since before this, and
 * nothing in this repository renders that route in a test either.
 */
describe('a question that is over offers the handover its own copy asks for', () => {
  /**
   * Every href on an ANCHOR, in order.
   *
   * Anchors only, because every primitive here renders a
   * `<style href="…" precedence>` element for React to hoist and de-duplicate —
   * so a bare `href="` count is never zero and an emptiness assertion written
   * that way passes for the wrong reason.
   */
  function hrefsOf(props: Parameters<typeof SettledConfirmation>[0]): string[] {
    const html = renderToStaticMarkup(createElement(SettledConfirmation, props))
    return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] ?? '')
  }

  const CLOSED = [
    { label: 'confirmed', verdict: 'confirmed' as string | null },
    { label: 'rejected', verdict: 'rejected' as string | null },
    { label: 'expired', verdict: null, unanswered: 'expired' as const },
    { label: 'abandoned', verdict: null, unanswered: 'abandoned' as const },
  ]

  it('rendered no route out of its own at all, which is what made counting enough', () => {
    // The state before #139, kept as a case: with no `handoverHref` this screen
    // is the dead end it was, and the only links on the page came from the
    // caller's `children`. That is also the contract for a caller with no
    // session in reach — a missing link rather than a broken one.
    for (const state of CLOSED) {
      expect(hrefsOf({ summary: 'Send it?', ...state })).toEqual([])
    }
  })

  it('offers a fresh handover on every closed state, including the two verdicts', () => {
    // `confirmed` and `rejected` included on purpose. A person who said don't
    // may still want the rest of the work, and a person who said go ahead is
    // looking at a shift that has ended either way. Excluding a state would be
    // this screen deciding on their behalf that the work is over.
    for (const state of CLOSED) {
      const hrefs = hrefsOf({ summary: 'Send it?', ...state, handoverHref: '/sessions/s-1' })
      expect(hrefs, `${state.label} offers no way back`).toContain('/sessions/s-1')
    }
  })

  it('says the words the rest of the product uses for this act, and no other', () => {
    const html = renderToStaticMarkup(
      createElement(SettledConfirmation, {
        summary: 'Send it?',
        verdict: null,
        unanswered: 'abandoned' as const,
        handoverHref: '/sessions/s-1',
      }),
    )
    const said = html.replace(/<[^>]*>/g, ' ').replace(/&#x27;|&rsquo;/g, "'")

    // The drifted shift report's label, unchanged. Two wordings for one act is
    // how one of them comes to be wrong, and `take over` is banned outright.
    expect(said).toContain('Hand over again')
    expect(said).not.toMatch(/take over/i)
    // And it must not read as a resumption of the dead run. Nothing carries
    // over; the person ratifies a new contract on the ordinary screen.
    expect(said).toContain('nothing starts on its own')
  })

  it('carries the session the page needs to build that address', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-05-05T09:00:00Z'),
      askedAt: new Date('2026-05-05T09:05:00Z'),
    })

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-05-05T09:06:00Z'))
    expect(view).not.toBeNull()
    if (!view) return

    // Read off the contract through the join that was already there for
    // `contractId` and `status`, so the page makes no second query and cannot
    // reach for a row the view has not vouched for.
    const contract = await repos.contracts.byId(paused.contractId)
    expect(view.sessionId).toBe(contract?.sessionId)
    expect(view.sessionId).not.toBe('')
  })
})

/**
 * The link #139 adds has to reach a screen that can actually hand over.
 *
 * `/sessions/<id>` renders its *Write the working agreement* control only while
 * the session is `observing` (`src/ui/reading.tsx`); on `away` it says *"Nothing
 * here can be changed until it hands back."* A confirmation pause leaves the
 * session `away` on purpose — ADR-0010 settles that as the smaller lie — and
 * that holds while the question is LIVE.
 *
 * It stopped holding the moment the pause ended without a continuation, and
 * three paths do that. None handed the session back, so it stayed `away` for
 * ever and the closed confirmation's new route landed on a dead end one click
 * further away — the exact defect #139 exists to remove. `executeRun` carries
 * the sentence: *"Without this it stays `away` forever, and every control that
 * offers to hand it back is a promise the product cannot keep."*
 */
describe('a pause that ends without a continuation gives the session back', () => {
  /**
   * `pausedShift` builds its rows straight through the repositories and never
   * marks the session away — the real handover does that. Set it here so each
   * case starts from the state the product is actually in when a run parks.
   */
  async function parkedAndAway(over: { acceptedAt: Date; askedAt: Date }) {
    const paused = await pausedShift(over)
    const contract = await db.prisma.handoffContract.findUniqueOrThrow({
      where: { id: paused.contractId },
      select: { sessionId: true },
    })
    await repos.sessions.markAway(contract.sessionId)
    return paused
  }

  async function phaseOf(contractId: string): Promise<string> {
    const contract = await db.prisma.handoffContract.findUniqueOrThrow({
      where: { id: contractId },
      select: { sessionId: true },
    })
    const session = await db.prisma.workSession.findUniqueOrThrow({
      where: { id: contract.sessionId },
    })
    return session.phase
  }

  it('hands it back when the person says no', async () => {
    const paused = await parkedAndAway({
      acceptedAt: new Date('2026-07-01T09:00:00Z'),
      askedAt: new Date('2026-07-01T09:05:00Z'),
    })
    expect(await phaseOf(paused.contractId)).toBe('away')

    const answered = await rejectRequest(ctx, paused.requestId, new Date('2026-07-01T09:06:00Z'))
    expect(answered.ok).toBe(true)

    expect(await phaseOf(paused.contractId), 'a no left the session away for ever').toBe('observing')
  })

  it('hands it back when the question expires unanswered', async () => {
    const paused = await parkedAndAway({
      acceptedAt: new Date('2026-07-02T09:00:00Z'),
      askedAt: new Date('2026-07-02T09:05:00Z'),
    })

    await expireConfirmations(ctx, new Date('2026-07-03T09:10:00Z'))

    expect(await phaseOf(paused.contractId)).toBe('observing')
  })

  it('leaves it away while the question is still live, which is the argued case', async () => {
    // The half ADR-0010 settled and this must not spend: a person being asked a
    // question is not a person the work has come back to.
    const paused = await parkedAndAway({
      acceptedAt: new Date('2026-07-04T09:00:00Z'),
      askedAt: new Date('2026-07-04T09:05:00Z'),
    })

    expect(await phaseOf(paused.contractId)).toBe('away')
  })

  it('leaves it away on a yes, because the work carries on', async () => {
    // A continuation is enqueued and `executeRun` hands the session back when
    // that run ends, like any other. Handing it back here would say the work
    // came back while a new run is about to claim a browser credential.
    const paused = await parkedAndAway({
      acceptedAt: new Date('2026-07-05T09:00:00Z'),
      askedAt: new Date('2026-07-05T09:05:00Z'),
    })

    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-07-05T09:06:00Z'))
    expect(answered.ok).toBe(true)

    expect(await phaseOf(paused.contractId)).toBe('away')
  })
})

/* ══════════════════ 13. a stop that closes the question ══════════════════ */

/**
 * ADR-0030, and the state it replaced.
 *
 * `haltRun` did three things and on a run parked in `awaiting-confirmation`
 * each was a no-op: `requestCancel` is scoped to the three live statuses and a
 * parked run matched none, the park had already revoked the token, and the
 * parked run's one unfinished intent is the refused one, which is not
 * authorised and has no outcome. So the person pressed Stop, was told nothing
 * had happened, and the question stayed live — and answering yes afterwards
 * still enqueued a continuation, which claims a run and mints a fresh control
 * token, on a shift they had stopped.
 *
 * Not a permission failure: the yes is real and the person gave it. Stop and
 * yes are two decisions by the same person about the same work, arriving in an
 * order nobody reconciled, and the later one silently won.
 *
 * ── What these tests do NOT cover ────────────────────────────────────────
 *
 * That a stop works with the app closed. The extension detaches the debugger
 * before telling the app, and nothing in this repository can assert that —
 * ADR-0010 says so about itself.
 */
describe('stopping a run parked on a question closes the question', () => {
  it('ends the parked run rather than reporting that nothing happened', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-06-01T09:00:00Z'),
      askedAt: new Date('2026-06-01T09:05:00Z'),
    })

    const halted = await haltRun(ctx, paused.runId)

    // Before ADR-0030 this was `false` — true of the flag, false of what the
    // person had just done.
    expect(halted.stopped).toBe(true)

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: paused.runId } })
    expect(run.status).toBe('interrupted')
    // The cancel fence's own reason, not a new one: the person called the run
    // back, and both renderers already have a sentence for that.
    expect(run.terminalReason).toBe('cancelled')
    expect(run.controlToken).toBeNull()
  })

  it('turns the yes down afterwards, instead of starting a run on a stopped shift', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-06-02T09:00:00Z'),
      askedAt: new Date('2026-06-02T09:05:00Z'),
    })

    await haltRun(ctx, paused.runId)

    const answered = await confirmRequest(ctx, paused.requestId, new Date('2026-06-02T09:06:00Z'))
    expect(answered.ok).toBe(false)
    if (answered.ok) return
    // The refusal #132 wrote for a run reaped before it parked. A halted run
    // joins that population by the front door, which is the whole argument for
    // this option over the other two — nothing new had to be built to make the
    // closure mean something.
    expect(answered.reason).toBe('abandoned')

    // And no continuation. This is the sentence the ADR is about: a yes on a
    // stopped shift used to claim a run and mint a fresh control token.
    const runs = await db.prisma.agentRun.findMany({
      where: { contractId: paused.contractId },
      select: { id: true, resumesRunId: true },
    })
    expect(runs.filter((run) => run.resumesRunId !== null)).toEqual([])
  })

  it('says so on the screen, rather than offering a button the answer turns down', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-06-03T09:00:00Z'),
      askedAt: new Date('2026-06-03T09:05:00Z'),
    })

    await haltRun(ctx, paused.runId)

    const view = await confirmationView(ctx, paused.requestId, Date.parse('2026-06-03T09:06:00Z'))
    expect(view).not.toBeNull()
    if (!view) return

    // Derived off the same column `confirmRequest` reads, so the screen and the
    // answer path cannot disagree about this row. Within its day, so not expiry.
    expect(view.abandoned).toBe(true)
    expect(view.expired).toBe(false)
    expect(view.verdict).toBeNull()
  })

  it('leaves a run that some other path already ended exactly as it found it', async () => {
    const paused = await pausedShift({
      acceptedAt: new Date('2026-06-04T09:00:00Z'),
      askedAt: new Date('2026-06-04T09:05:00Z'),
    })

    // Reaped first. The status write is scoped for this reason as well as the
    // live-run one: an unpredicated `update` here would reintroduce #140's
    // defect in a new place, rewriting a terminal run and its reason.
    await db.prisma.agentRun.update({
      where: { id: paused.runId },
      data: { status: 'interrupted', terminalReason: 'lease-expired', controlToken: null },
    })

    await haltRun(ctx, paused.runId)

    const run = await db.prisma.agentRun.findUniqueOrThrow({ where: { id: paused.runId } })
    expect(run.terminalReason).toBe('lease-expired')
  })

  it('still stops a live run the way it always did', async () => {
    // The guard has to close the question WITHOUT taking over the job of
    // stopping a run that can still act — that one is flagged and halts itself
    // at its next action boundary, because it may be mid-navigation.
    const paused = await pausedShift({
      acceptedAt: new Date('2026-06-05T09:00:00Z'),
      askedAt: new Date('2026-06-05T09:05:00Z'),
    })
    const runId = paused.runId
    await db.prisma.agentRun.update({
      where: { id: runId },
      data: { status: 'running', terminalReason: null, controlToken: 'token-live' },
    })

    const halted = await haltRun(ctx, runId)
    expect(halted.stopped).toBe(true)

    const run = await repos.runs.byId(runId)
    expect(run?.cancelRequested).toBe(true)
    expect(run?.controlToken).toBeNull()
    // Not ended from outside. The status write is scoped to a parked run.
    expect(run?.status).not.toBe('interrupted')
  })
})
