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
import { mkdtempSync, rmSync } from 'node:fs'
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
  creditedDeadlineFor,
  expireConfirmations,
  oldestPendingConfirmation,
  rejectRequest,
  settleAbandonedIntents,
  sweepAbandonedIntents,
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
import { ConfirmationScreen } from '../src/ui/confirm'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

let dir: string
let db: Database
let repos: Repositories
let ctx: ConfirmationContext
let projectId: string

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
}, 120_000)

afterAll(async () => {
  await db?.close()
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
    // It drives the browser, so it holds a control token — a fresh one. Reusing
    // the paused run's would outlive the run it was issued to.
    expect(continuation?.controlToken).toBeTruthy()

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
    for (const file of ['runtime/worker-loop.ts', 'runtime/worker-process.ts', 'server/execute-run.ts', 'policy/gate.ts']) {
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

    const late = await confirmRequest(ctx, paused.requestId, new Date(askedAt.getTime() + 25 * HOUR))
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
    expect(confirmationHasExpired({ requestedAtEpochMs: asked, nowEpochMs: asked + day })).toBe(true)
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
  function harness(row: { status: string; claimedBy: string | null; cancelRequested: boolean } | null) {
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
    expect(await db.prisma.actionOutcome.findUnique({ where: { intentId: inFlight.id } })).toBeNull()
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
