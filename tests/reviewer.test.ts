/**
 * Does the second pass run, and can it hurt anything if it doesn't?
 *
 * `reviewBoundary` was built and tested and had zero callers. `runs.enqueue` was
 * only ever called with `role: 'worker'`, so `ReviewFinding` rows never existed
 * and `docs/MVP.md` assumption 4 — "does the reviewer earn its place" — was
 * unanswerable rather than answered.
 *
 * The property that matters most here is the negative one. Acceptance bullet 9
 * requires the ShiftReport to render WITHOUT a reviewer pass, and `execute-run`
 * writes that report in the app process specifically so one exists on
 * `interrupted`. A reviewer that throws must not take the note down with it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { executeRun } from '../src/server/execute-run'
import { FakeModelClient } from '../src/model/fake'
import { fixtureFetcher } from '../src/policy/fetcher'
import { hashContent } from '../src/domain/document/changeset'
import { normalise } from '../src/domain/document/normalise'
import type { AppContext } from '../src/server/db'

const DOC = [
  '# Northwind partnership proposal',
  '',
  '## Commercials',
  '',
  'We propose a partnership on standard terms.',
  '',
].join('\n')

let dir: string
let db: Database
let repos: Repositories
let ctx: AppContext
let projectId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-review-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ctx = { db, repos, ledger: createLedgerWriter(db.prisma) }
  projectId = (await repos.projects.create('northwind')).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * An accepted document contract, ready for a run.
 *
 * ── It no longer writes the changeset itself ─────────────────────────────
 *
 * The reviewer used to run "if there is a changeset", and now runs when the
 * worker run produced at least one HELD `ShiftOutcome`. That is the same
 * condition generalised — a document run writes exactly one `document-changes`
 * outcome with the changeset hanging off it — but it means a changeset written
 * by hand, belonging to no run, is a state the product can no longer reach.
 *
 * So the drafting happens for real, through the worker, and this only sets up
 * the agreement it happens under.
 */
async function shiftWithChanges() {
  const stored = normalise(DOC)
  const document = await repos.documents.create({
    projectId,
    title: 'Proposal',
    content: stored,
    contentHash: hashContent(stored),
  })
  const sessionId = (await repos.sessions.start(projectId)).id
  const reading = await repos.readings.create({
    sessionId,
    throughSeq: 0,
    claims: [{ kind: 'objective', text: 'Finish Commercials.', ordinal: 0, evidence: [] }],
  })
  const contract = await repos.contracts.createDraft({
    sessionId,
    readingId: reading.id,
    objective: 'Finish Commercials.',
    definitionOfDone: 'Commercials names a tier.',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['draft-section'],
    baseVersionId: document.versionId,
    initiative: 'use-judgment',
    progress: 'keep-going',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date())

  return { contractId: contract.id }
}

/**
 * A worker that drafts exactly one section, so the run produces one
 * `document-changes` ShiftOutcome with a real changeset under it.
 *
 * This used to be a worker that raised a question and drafted nothing, with the
 * changeset written into the database by hand beside it. That was the right
 * shape while "is there a changeset" was the reviewer's trigger and a changeset
 * could exist without a run having made one. It is the wrong shape now: the
 * trigger is "did this run produce something a person still decides about", and
 * a fixture that writes rows the product cannot produce is a fixture that stops
 * measuring the product.
 */
const DRAFTING_WORKER = [
  {
    kind: 'ok' as const,
    value: { steps: [{ intent: 'Draft Commercials.', targetSection: 'Commercials' }] },
  },
  {
    kind: 'ok' as const,
    value: {
      kind: 'draft-section',
      reason: 'Commercials needs a tier named.',
      targetSection: 'Commercials',
      prose: 'We propose a partnership on Gold tier terms.',
    },
  },
]

/**
 * A worker that plans one step and then raises a question, so it terminates
 * cleanly having produced nothing at all.
 */
const QUIET_WORKER = [
  { kind: 'ok' as const, value: { steps: [{ intent: 'Decide the tier.' }] } },
  {
    kind: 'ok' as const,
    value: {
      kind: 'read-document',
      reason: 'The tier is not something I can settle.',
      decisionNeeded: {
        question: 'Silver or Gold for Northwind?',
        whyItMatters: 'Commercials cannot be finished without it.',
      },
    },
  },
]

async function runWith(replies: ReadonlyArray<unknown>, contractId: string) {
  const run = await repos.runs.enqueue({ contractId, role: 'worker' })
  await repos.runs.claim({ leaseUntil: new Date(Date.now() + 60_000), startedAt: new Date() })
  await executeRun(run.id, {
    ctx,
    model: new FakeModelClient(replies as never),
    fetcher: fixtureFetcher({}),
    now: () => Date.now(),
  })
  return run.id
}

describe('the second pass runs and is recorded', () => {
  it('writes ReviewFinding rows against the right changes', async () => {
    const { contractId } = await shiftWithChanges()

    await runWith(
      [
        ...DRAFTING_WORKER,
        {
          kind: 'ok' as const,
          value: {
            findings: [
              { handle: 'C1', kind: 'unsupported', detail: 'Nothing read says Gold is the right tier.' },
            ],
          },
        },
      ],
      contractId,
    )

    const changeset = await repos.changesets.forContract(contractId)
    if (!changeset) throw new Error('no changeset')

    const findings = await repos.findings.forChangeset(changeset.id)

    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('unsupported')
    expect(findings[0]?.changeId).toBe(changeset.changes[0]?.id)
  })

  it('records the reviewer as its own run, not folded into the worker', async () => {
    const { contractId } = await shiftWithChanges()
    await runWith([...DRAFTING_WORKER, { kind: 'ok' as const, value: { findings: [] } }], contractId)

    const runs = await db.prisma.agentRun.findMany({
      where: { contractId },
      select: { role: true, status: true },
    })

    expect(runs.filter((r) => r.role === 'reviewer')).toHaveLength(1)
    expect(runs.find((r) => r.role === 'reviewer')?.status).toBe('succeeded')
  })

  it('drops a finding whose kind is outside the closed list', async () => {
    // The grammar enforces shape only, so `kind` arrives as a free string.
    const { contractId } = await shiftWithChanges()

    await runWith(
      [
        ...DRAFTING_WORKER,
        {
          kind: 'ok' as const,
          value: {
            findings: [
              { handle: 'C1', kind: 'made-up-kind', detail: 'Should not be stored.' },
              { handle: 'C1', kind: 'unclear', detail: 'Which quarter?' },
            ],
          },
        },
      ],
      contractId,
    )

    const changeset = await repos.changesets.forContract(contractId)
    if (!changeset) throw new Error('no changeset')
    const findings = await repos.findings.forChangeset(changeset.id)

    expect(findings.map((f) => f.kind)).toEqual(['unclear'])
  })

  it('an empty finding list is a good outcome, not a failure', async () => {
    const { contractId } = await shiftWithChanges()
    await runWith([...DRAFTING_WORKER, { kind: 'ok' as const, value: { findings: [] } }], contractId)

    const changeset = await repos.changesets.forContract(contractId)
    if (!changeset) throw new Error('no changeset')

    expect(await repos.findings.forChangeset(changeset.id)).toEqual([])
    const reviewer = await db.prisma.agentRun.findFirst({ where: { contractId, role: 'reviewer' } })
    expect(reviewer?.status).toBe('succeeded')
  })
})

describe('the reviewer cannot take the note down — acceptance bullet 9', () => {
  it('a ShiftReport still exists when the reviewer boundary fails', async () => {
    const { contractId } = await shiftWithChanges()

    // No scripted reply for `review`, so FakeModelClient throws on that call.
    await runWith(DRAFTING_WORKER, contractId)

    const report = await repos.reports.forContract(contractId)

    expect(report, 'the report is what the person came back for').not.toBeNull()
  })

  it('the session still comes back to the person', async () => {
    const { contractId } = await shiftWithChanges()
    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')

    await repos.sessions.markAway(contract.sessionId)
    await runWith(DRAFTING_WORKER, contractId)

    const session = await repos.sessions.byId(contract.sessionId)
    expect(session?.phase).toBe('observing')
  })
})

describe('the reviewer runs only when there is something to review', () => {
  it('a run that produced nothing gets no reviewer run at all', async () => {
    // A `suggestions-only` shift, or one that stopped before drafting.
    const stored = normalise(DOC)
    const document = await repos.documents.create({
      projectId,
      title: 'Untouched',
      content: stored,
      contentHash: hashContent(stored),
    })
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({
      sessionId,
      throughSeq: 0,
      claims: [{ kind: 'objective', text: 'Research only.', ordinal: 0, evidence: [] }],
    })
    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Research only.',
      definitionOfDone: 'Understand the tiers.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: document.versionId,
      initiative: 'use-judgment',
      progress: 'keep-going',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())

    await runWith(QUIET_WORKER, contract.id)

    const runs = await db.prisma.agentRun.findMany({
      where: { contractId: contract.id },
      select: { role: true },
    })

    expect(runs.filter((r) => r.role === 'reviewer')).toHaveLength(0)
  })
})
