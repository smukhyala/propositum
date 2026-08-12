/**
 * A run produces a ShiftOutcome, and the document path is one kind among five.
 *
 * ── The most important assertion in this file is the first one ───────────
 *
 * The document path already worked. Generalising a spine is exactly the change
 * that breaks the special case it grew out of, quietly, in a suite that stays
 * green because the special case was only ever tested through the spine. So the
 * first block runs a real drafting shift end to end against a real database and
 * checks the whole chain — `ShiftOutcome` → `Changeset` → `ProposedChange` —
 * still arrives.
 *
 * ── And the second is the tripwire it replaced ───────────────────────────
 *
 * Wave 1 left `executeRun` refusing a contract with no base version, on the
 * grounds that a document runner should decline a null rather than cast it away.
 * The second block is the same situation and now completes normally: no
 * changeset, no crash, and a ShiftReport, which is what the person came back
 * for.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { executeRun } from '../src/server/execute-run'
import { recordOutcomes } from '../src/server/outcomes/index'
import { loadWorkspace } from '../src/server/outcomes/workspace'
import { FakeModelClient } from '../src/model/fake'
import { fixtureFetcher } from '../src/policy/fetcher'
import { hashContent } from '../src/domain/document/changeset'
import { readOutcomeDetail } from '../src/domain/outcome/shift-outcome'
import { normalise } from '../src/domain/document/normalise'
import type { AppContext } from '../src/server/db'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

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
  dir = mkdtempSync(join(tmpdir(), 'propositum-outcomes-'))
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

/** An accepted contract. `pinned: false` is the browser/answer shape — nothing
 *  to write into, and the gate refuses the document capabilities. */
async function acceptedContract(pinned: boolean) {
  const stored = normalise(DOC)
  const document = pinned
    ? await repos.documents.create({
        projectId,
        title: 'Proposal',
        content: stored,
        contentHash: hashContent(stored),
      })
    : null

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
    allowedActionKinds: ['read-document', 'draft-section'],
    baseVersionId: document?.versionId ?? null,
    initiative: 'use-judgment',
    progress: 'remaining-plan',
    output: 'draft-changes',
    interruption: 'stop-only-when-blocked',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date())

  return { contractId: contract.id, sessionId }
}

const DRAFTS = [
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
  /**
   * The third terminal, and it is now how a run ENDS.
   *
   * The plan used to be the turn budget: one step, one turn, and the loop
   * stopped when the list ran out. ADR-0010 §6 demoted the plan to reporting, so
   * under `use-judgment` a run keeps deciding what to do next until it stops
   * itself, hits a stop rule, or reaches `MAX_ACTIONS_PER_RUN`. A fixture that
   * simply stopped scripting replies was relying on the plan to end the run, and
   * that is exactly the thing that no longer authorizes anything.
   *
   * `kind` is still required by the schema and is ignored on this arm — the
   * same shape `decisionNeeded` already had.
   */
  {
    kind: 'ok' as const,
    value: {
      kind: 'read-document',
      reason: 'Commercials names a tier now.',
      done: { summary: 'I drafted Commercials and named the Gold tier.' },
    },
  },
]

const NO_FINDINGS = { kind: 'ok' as const, value: { findings: [] } }

async function run(contractId: string, replies: ReadonlyArray<unknown>) {
  const enqueued = await repos.runs.enqueue({ contractId, role: 'worker' })
  await repos.runs.claim({ leaseUntil: new Date(Date.now() + 60_000), startedAt: new Date() })
  await executeRun(enqueued.id, {
    ctx,
    model: new FakeModelClient(replies as never),
    fetcher: fixtureFetcher({}),
    now: () => Date.now(),
  })
  return enqueued.id
}

/* ── 1. the path that already worked ────────────────────────────────────── */

describe('a document shift still produces document changes', () => {
  it('writes one document-changes outcome with a Changeset and ProposedChanges under it', async () => {
    const { contractId } = await acceptedContract(true)

    const runId = await run(contractId, [...DRAFTS, NO_FINDINGS])

    const produced = await repos.outcomes.forRun(runId)
    expect(produced).toHaveLength(1)
    expect(produced[0]?.kind).toBe('document-changes')

    // Held, because Propositum is still holding it and the person's accept or
    // reject decides its fate. Nothing about drafting leaves the building.
    expect(produced[0]?.reversibility).toBe('held')

    const changeset = await repos.changesets.forContract(contractId)
    if (!changeset) throw new Error('no changeset')
    expect(changeset.changes.length).toBeGreaterThan(0)
    expect(changeset.changes[0]?.replacement).toContain('Gold tier')

    // The new hop in the provenance walk: ProposedChange → Changeset →
    // ShiftOutcome → AgentRun → HandoffContract, every step a foreign key.
    const row = await db.prisma.changeset.findUnique({
      where: { id: changeset.id },
      select: { outcomeId: true },
    })
    expect(row?.outcomeId).toBe(produced[0]?.id)
  })

  it('cites the drafting intent, because the citation is a join against the ledger', async () => {
    const { contractId } = await acceptedContract(true)
    const runId = await run(contractId, [...DRAFTS, NO_FINDINGS])

    const produced = await repos.outcomes.forRun(runId)
    const intents = await db.prisma.actionIntent.findMany({
      where: { runId, authorized: true },
      select: { id: true },
    })

    expect(produced[0]?.citedActionIntentIds).toEqual(intents.map((i) => i.id))
  })

  it('writes no outcome at all when the run produced nothing', async () => {
    // CONTEXT.md's rule, generalised from the empty changeset: a run with no
    // completed work writes no row, and the report says so in words.
    const { contractId } = await acceptedContract(true)

    const runId = await run(contractId, [
      { kind: 'ok' as const, value: { steps: [{ intent: 'Decide the tier.' }] } },
      {
        kind: 'ok' as const,
        value: {
          kind: 'read-document',
          reason: 'Not mine to settle.',
          decisionNeeded: { question: 'Silver or Gold?', whyItMatters: 'the close depends on it' },
        },
      },
      {
        kind: 'ok' as const,
        value: {
          kind: 'read-document',
          reason: 'The question is out with them; there is nothing further I can do.',
          done: { summary: 'I stopped on the tier question.' },
        },
      },
    ])

    expect(await repos.outcomes.forRun(runId)).toEqual([])
    expect(await repos.changesets.forContract(contractId)).toBeNull()
  })
})

/* ── 2. the tripwire the refusal was standing in for ────────────────────── */

describe('a shift that pins no document runs to completion', () => {
  it('finishes, writes a report, and produces no Changeset', async () => {
    const { contractId, sessionId } = await acceptedContract(false)
    await repos.sessions.markAway(sessionId)

    // The same script as the document path. `draft-section` is refused with
    // `no_document_pinned` rather than drafting into nothing, and the run
    // carries on and ends normally — where it used to be failed outright before
    // the worker was even started.
    const runId = await run(contractId, DRAFTS)

    const finished = await repos.runs.byId(runId)
    expect(finished?.status).toBe('succeeded')

    expect(await repos.changesets.forContract(contractId)).toBeNull()
    expect(await repos.reports.forContract(contractId)).not.toBeNull()

    // And the session comes back to the person, which the old refusal path
    // never reached.
    expect((await repos.sessions.byId(sessionId))?.phase).toBe('observing')

    const refusals = await db.prisma.actionIntent.findMany({
      where: { runId, authorized: false },
      select: { refusedRule: true },
    })
    expect(refusals.map((r) => r.refusedRule)).toContain('no_document_pinned')
  })

  it('records a written answer as an answer outcome, with no document anywhere near it', async () => {
    const { contractId } = await acceptedContract(false)
    const runId = await run(contractId, DRAFTS)

    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')
    const workspace = await loadWorkspace(ctx, contract)

    expect(workspace.base).toBeNull()
    expect(workspace.expects).toEqual(['answer'])

    const recorded = await recordOutcomes(ctx, {
      run: { id: runId },
      contract: { id: contractId },
      workspace,
      produced: [
        {
          kind: 'written-answer',
          // No completed intent of this run, so the citation drops. The answer
          // itself is kept — a worse answer the person can still see beats work
          // deleted over a provenance detail nobody asked about.
          intentId: 'intent-from-nowhere',
          text: 'Gold tier is the cheapest above 40 units. Silver is cheaper below that.',
        },
      ],
    })

    expect(recorded.written).toBe(1)
    expect(recorded.dropped).toBe(0)

    const produced = await repos.outcomes.forRun(runId)
    expect(produced.map((o) => o.kind)).toEqual(['answer'])
    expect(produced[0]?.reversibility).toBe('held')
    // `body`, because that is the key the re-entry screen's reader looks for
    // first — see `readOutcomeDetail` in src/domain/outcome/shift-outcome.ts.
    expect(produced[0]?.detail.body).toContain('Gold tier is the cheapest')
    expect(await repos.changesets.forContract(contractId)).toBeNull()
  })
})

/* ── 3. citations are intersected against this run's own ledger ─────────── */

describe('a citation is a join, not a claim', () => {
  it("drops an intent id belonging to another run, and keeps one belonging to this one", async () => {
    const mine = await acceptedContract(true)
    const theirs = await acceptedContract(true)

    const myRun = await run(mine.contractId, [...DRAFTS, NO_FINDINGS])
    const theirRun = await run(theirs.contractId, [...DRAFTS, NO_FINDINGS])

    const myIntent = await db.prisma.actionIntent.findFirst({
      where: { runId: myRun, authorized: true },
      select: { id: true },
    })
    const theirIntent = await db.prisma.actionIntent.findFirst({
      where: { runId: theirRun, authorized: true },
      select: { id: true },
    })

    if (!myIntent || !theirIntent) throw new Error('no intents')

    const contract = await repos.contracts.byId(mine.contractId)
    if (!contract) throw new Error('no contract')
    const workspace = await loadWorkspace(ctx, contract)

    await recordOutcomes(ctx, {
      run: { id: myRun },
      contract: { id: mine.contractId },
      workspace,
      produced: [
        { kind: 'written-answer', intentId: theirIntent.id, text: 'Cited from somebody else.' },
        { kind: 'written-answer', intentId: myIntent.id, text: 'Cited from this run.' },
      ],
    })

    const produced = await repos.outcomes.forRun(myRun)
    const written = produced.filter((o) => o.kind === 'answer')

    expect(written).toHaveLength(2)
    // Their id is not in this run's completed intents, so it does not survive
    // the intersection. If it did, the provenance walk would arrive at a
    // contract nobody ratified for this work and every hop after would read as
    // sound.
    expect(written[0]?.citedActionIntentIds).toEqual([])
    expect(written[1]?.citedActionIntentIds).toEqual([myIntent.id])
  })

  it('drops a landed production, because nothing can land today', async () => {
    // `LANDING_ACTION_KINDS` is empty, so no completed intent of any run carries
    // a landing kind — and a production claiming otherwise is a model assigning
    // its own reversibility, which would remove the person's ability to reject
    // its work by describing the work as already done.
    const { contractId } = await acceptedContract(true)
    const runId = await run(contractId, [...DRAFTS, NO_FINDINGS])

    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')
    const workspace = await loadWorkspace(ctx, contract)

    const before = (await repos.outcomes.forRun(runId)).length

    const recorded = await recordOutcomes(ctx, {
      run: { id: runId },
      contract: { id: contractId },
      workspace,
      produced: [
        { kind: 'landed', intentId: 'anything', what: 'Sent the reply', where: 'their contact form' },
      ],
    })

    expect(recorded.written).toBe(0)
    expect(recorded.dropped).toBe(1)
    expect((await repos.outcomes.forRun(runId)).length).toBe(before)
  })

  it('says so in the report when something it made could not be kept', async () => {
    /**
     * A drop that nobody is told about is not a counted drop.
     *
     * The writers count every production they cannot realise, precisely so the
     * count is evidence that the closed set of kinds is wrong. A count returned
     * to a caller that reads only the held ids is a count nobody has — the same
     * shape as the swallowed notification and the blank report, where the
     * software knew something was lost and told no one.
     */
    const { contractId } = await acceptedContract(true)

    // A real drop, through the whole spine: the worker drafts prose IDENTICAL to
    // what the section already says. The production is genuine, `diff()` finds
    // nothing to change, and an empty changeset is no row — so the production
    // cannot be realised and is dropped.
    const runId = await run(contractId, [
      {
        kind: 'ok' as const,
        value: { steps: [{ intent: 'Draft Commercials.', targetSection: 'Commercials' }] },
      },
      {
        kind: 'ok' as const,
        value: {
          kind: 'draft-section',
          reason: 'It already says the right thing.',
          targetSection: 'Commercials',
          prose: 'We propose a partnership on standard terms.',
        },
      },
      {
        kind: 'ok' as const,
        value: {
          kind: 'read-document',
          reason: 'Commercials reads correctly.',
          done: { summary: 'I went over Commercials.' },
        },
      },
    ])

    expect(await repos.outcomes.forRun(runId)).toEqual([])
    expect(await repos.changesets.forContract(contractId)).toBeNull()

    const report = await repos.reports.forContract(contractId)
    expect(report?.narrative).toContain('could not be kept')
  })

  it('says nothing about drops when there were none', async () => {
    const { contractId } = await acceptedContract(true)
    await run(contractId, [...DRAFTS, NO_FINDINGS])

    const report = await repos.reports.forContract(contractId)
    expect(report?.narrative ?? '').not.toContain('could not be kept')
  })

  it('drops section prose when the shift pins nothing to apply it to', async () => {
    const { contractId } = await acceptedContract(false)
    const runId = await run(contractId, DRAFTS)

    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')
    const workspace = await loadWorkspace(ctx, contract)

    const recorded = await recordOutcomes(ctx, {
      run: { id: runId },
      contract: { id: contractId },
      workspace,
      produced: [
        { kind: 'section-prose', intentId: 'anything', section: 'Commercials', prose: 'Gold tier.' },
      ],
    })

    expect(recorded.written).toBe(0)
    expect(recorded.dropped).toBe(1)
    expect(await repos.changesets.forContract(contractId)).toBeNull()
  })
})

/* ── 4. what the writers store is what the screen reads ─────────────────── */

describe('the detail payload is the shape the re-entry screen reads', () => {
  /**
   * The seam between the unit that WRITES `ShiftOutcome.detail` and the unit
   * that renders it.
   *
   * `readOutcomeDetail` is deliberately tolerant — it degrades to a headline and
   * a reason rather than throwing, so a payload it does not recognise cannot
   * take down the one screen a person comes back to when a run went badly. That
   * tolerance is exactly why a mismatch here would be invisible: the screen
   * would render, the card would be blank below the headline, and nothing would
   * fail. So the writers are checked against the reader directly.
   */
  const detailOf = async (produced: Parameters<typeof recordOutcomes>[1]['produced']) => {
    const { contractId } = await acceptedContract(true)
    const runId = await run(contractId, [...DRAFTS, NO_FINDINGS])
    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')

    await recordOutcomes(ctx, {
      run: { id: runId },
      contract: { id: contractId },
      workspace: await loadWorkspace(ctx, contract),
      produced,
    })

    const rows = await repos.outcomes.forRun(runId)
    return rows.filter((o) => o.kind !== 'document-changes').map((o) => readOutcomeDetail(o.detail))
  }

  it('renders a collection as lines, keeping the numbers', async () => {
    const [collected] = await detailOf([
      {
        kind: 'item',
        intentId: 'x',
        label: 'Fabrikam',
        fields: { 'under 5kg': '£3.95', 'next day': 'yes' },
      },
    ])

    // The label and the fields both survive. An item that arrived as a record
    // the reader could not flatten would render as the carrier's name with the
    // price silently gone.
    expect(collected?.items).toEqual(['Fabrikam — under 5kg: £3.95 · next day: yes'])
  })

  it('renders an answer as a body', async () => {
    const [answered] = await detailOf([
      { kind: 'written-answer', intentId: 'x', text: 'Fabrikam is cheapest under 5kg.' },
    ])

    expect(answered?.body).toBe('Fabrikam is cheapest under 5kg.')
  })

  it('renders a message draft with who it is for, and nothing that could send it', async () => {
    const [drafted] = await detailOf([
      {
        kind: 'composed-text',
        intentId: 'x',
        forWhat: 'a reply to Northwind about the rate',
        text: 'Thanks — could you confirm the under-5kg price?',
      },
    ])

    expect(drafted?.addressedTo).toBe('a reply to Northwind about the rate')
    expect(drafted?.body).toContain('confirm the under-5kg price')
  })
})

/* ── 5. the spine, grepped ──────────────────────────────────────────────── */

describe('the run spine carries no document knowledge', () => {
  /**
   * Duplicated from `tests/architecture.test.ts` on purpose, and it is one
   * assertion rather than four.
   *
   * That file is where the rule lives and where it will be maintained. This is
   * the unit's own receipt: somebody reading the outcome tests to find out
   * whether the document assumption was actually removed should not have to know
   * that the answer is in a different file.
   */
  it('has no Markdown, no diff and no Document in it', () => {
    const source = readFileSync(join(repo, 'src/server/execute-run.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

    expect(source).not.toMatch(/##/)
    expect(source).not.toMatch(/\bdiff\(/)
    expect(source).not.toMatch(/\bDocument\b/)
  })
})
