/**
 * The second ledger: bounded on the way in, swept on the way out.
 *
 * ── What is actually at stake here ──────────────────────────────────────
 *
 * `CONTEXT.md` and `docs/SECURITY_AND_PRIVACY.md` publish a sentence — *at most
 * the first 2,000 characters of readable article text*. An accessibility tree
 * is ten to a hundred times that and arrives every turn. If the two budgets
 * ever collapse into one, or if the sweep stops running, that published
 * sentence becomes false in the document whose entire job is being true — and
 * nothing about the failure looks like a failure. Every assertion below is
 * about keeping one half of that sentence honest.
 *
 * Runs against the REAL schema pushed into a temporary database, because the
 * two things most likely to break are a SQL trigger and a `deleteMany` filter,
 * and neither is visible against a fake.
 *
 * NOTE: `prisma db push` silently drops triggers on a table rebuild, so
 * `createDatabase` — which installs and VERIFIES the guards — is the thing that
 * makes a result here trustworthy. That is why this file boots the app's own
 * database helper rather than a bare PrismaClient.
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
import type { LedgerWriter } from '../src/persistence/ledger-writer'
import { EXCERPT_BUDGET_CHARS, SNAPSHOT_BUDGET_CHARS } from '../src/model/untrusted'
import { ACTION_EVIDENCE_RETENTION_DAYS, sweepActionEvidence } from '../src/server/evidence-sweep'

let dir: string
let db: Database
let repos: Repositories
let ledger: LedgerWriter
let projectId: string

const DAY_MS = 24 * 60 * 60 * 1000

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-evidence-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ledger = createLedgerWriter(db.prisma)
  projectId = (await repos.projects.create('evidence')).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** A run to hang evidence off. The contract is real because the FK is real. */
async function newRun(): Promise<string> {
  const sessionId = (await repos.sessions.start(projectId)).id
  const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
  const contract = await repos.contracts.createDraft({
    sessionId,
    readingId: reading.id,
    objective: 'Do the thing.',
    definitionOfDone: 'The thing is done.',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['read-document'],
    baseVersionId: null,
    initiative: 'use-judgment',
    progress: 'remaining-plan',
    output: 'draft-changes',
    interruption: 'stop-only-when-blocked',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date())
  return (await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })).id
}

/** A serialised accessibility tree of roughly `chars` characters. */
const tree = (chars: number) => 'button "Send" [ref=e1]\n'.repeat(Math.ceil(chars / 23)).slice(0, chars)

/* ── 1. bounded twice, and the second bound never wedges ─────────────────── */

describe('an oversized tree is truncated and recorded, never refused', () => {
  it('cuts at the snapshot budget and says so on the row', async () => {
    const runId = await newRun()

    const result = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://northwind.example.com/orders',
      untrustedText: tree(SNAPSHOT_BUDGET_CHARS + 50_000),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.truncated).toBe(true)

    const stored = await repos.evidence.byId(result.id)
    expect(stored?.truncated).toBe(true)
    const untrusted = stored?.untrusted as { text: string; removed: string[] }
    expect(untrusted.text).toHaveLength(SNAPSHOT_BUDGET_CHARS)
    expect(untrusted.removed).toContain('truncated-to-snapshot-budget')
  })

  it('accepts the very next normal-sized write, which is the wave-2 defect', async () => {
    /**
     * THE REGRESSION TEST.
     *
     * The ambient path had exactly this shape and deadlocked on it: the
     * extension buffered 200 observations against a route that accepted 100,
     * every flush failed validation, the buffer cleared only on success, and
     * ambient capture died permanently for the life of that session storage.
     * The comment above it read "Bounded here too. The app bounds it again;
     * neither trusts the other" — the principle was right and the arithmetic
     * turned it into a lock.
     *
     * So the property is not "oversized input is handled". It is that an
     * oversized write leaves NOTHING BEHIND that can stop the next one. A
     * rejection here would be something a sender must retry, and a sender that
     * retries forever is the wedge.
     */
    const runId = await newRun()

    const huge = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://northwind.example.com/a',
      untrustedText: tree(SNAPSHOT_BUDGET_CHARS * 3),
    })
    const ordinary = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://northwind.example.com/b',
      untrustedText: 'button "Continue" [ref=e2]',
    })

    expect(huge.ok).toBe(true)
    expect(ordinary.ok).toBe(true)
    if (!ordinary.ok) return

    expect(ordinary.truncated).toBe(false)
    expect(await repos.evidence.forRun(runId)).toHaveLength(2)
  })

  it('refuses only a shape it cannot read, and size is never a shape', async () => {
    const runId = await newRun()

    expect(await ledger.appendEvidence({ runId, kind: 'guesswork', url: 'https://x.example' })).toMatchObject({
      ok: false,
      reason: 'malformed',
    })

    // ...and the door is not wedged by having refused one.
    const after = await ledger.appendEvidence({
      runId,
      kind: 'screen-capture',
      url: 'https://x.example',
      image: new Uint8Array([1, 2, 3]),
    })
    expect(after.ok).toBe(true)
  })

  it('sanitises and cleans at the same door the observation ledger uses', async () => {
    const runId = await newRun()

    const result = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      // Credentials and tracking parameters are stripped here exactly as they
      // are for an ObservationEvent. The URL is browser-attested, which makes
      // it trustworthy about WHERE the tab is — not harmless to store.
      url: 'https://user:secret@northwind.example.com/orders?utm_source=mail',
      untrustedText: 'link "Confirm"​‮hidden‬',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.adversarial).toBe(true)

    const stored = await repos.evidence.byId(result.id)
    expect(stored?.url).not.toContain('secret')
    expect(stored?.url).not.toContain('utm_source')

    const untrusted = stored?.untrusted as { removed: string[]; adversarial: boolean }
    expect(untrusted.removed).toContain('zero-width-characters')
    expect(untrusted.adversarial).toBe(true)
  })

  it('leaves the observation ledger governed by the OTHER budget', async () => {
    /**
     * The assertion that keeps the published 2,000-character sentence true.
     *
     * The two budgets must not collapse into one. If a future change routes
     * `append` through the snapshot budget — or reuses the constant next to it,
     * which is how this actually happens — a person's own browsing starts being
     * retained thirty times over and no other test notices.
     */
    const sessionId = (await repos.sessions.start(projectId)).id
    const source = await repos.projects.approveSource({
      projectId,
      originPattern: 'https://northwind.example.com/*',
      label: 'Northwind',
    })

    const appended = await ledger.append(sessionId, {
      kind: 'excerpted',
      observedAt: new Date(0),
      elapsedMs: 0,
      approvedSourceId: source.id,
      attested: { url: 'https://northwind.example.com/terms' },
      untrustedText: 'y'.repeat(SNAPSHOT_BUDGET_CHARS),
    })

    expect(appended.ok).toBe(true)
    if (!appended.ok) return

    const events = await repos.events.bySession(sessionId)
    const untrusted = events[0]?.untrusted as { text: string; removed: string[] }

    expect(untrusted.text).toHaveLength(EXCERPT_BUDGET_CHARS)
    expect(untrusted.removed).toContain('truncated-to-excerpt-budget')
  })
})

/* ── 2. immutable, but not undeletable ───────────────────────────────────── */

describe('action evidence cannot be rewritten, and CAN be swept', () => {
  it('accepts an INSERT', async () => {
    const runId = await newRun()
    const result = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://x.example',
      untrustedText: 'tree',
    })

    expect(result.ok).toBe(true)
  })

  it('rejects an UPDATE, so what a person was shown stays what they were shown', async () => {
    const runId = await newRun()
    const written = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://x.example/original',
      untrustedText: 'tree',
    })
    expect(written.ok).toBe(true)
    if (!written.ok) return

    await expect(
      db.prisma.actionEvidence.update({ where: { id: written.id }, data: { url: 'https://x.example/rewritten' } }),
    ).rejects.toThrow()

    const after = await repos.evidence.byId(written.id)
    expect(after?.url).toBe('https://x.example/original')
  })

  it('rejects INSERT OR REPLACE — the case a two-trigger design misses', async () => {
    const runId = await newRun()
    const written = await ledger.appendEvidence({
      runId,
      kind: 'page-snapshot',
      url: 'https://x.example/original',
    })
    expect(written.ok).toBe(true)
    if (!written.ok) return

    await expect(
      db.prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO action_evidence (id, runId, kind, url, truncated, createdAt)
         VALUES ('${written.id}', '${runId}', 'page-snapshot', 'https://x.example/forged', 0, 0)`,
      ),
    ).rejects.toThrow()

    const after = await repos.evidence.byId(written.id)
    expect(after?.url).toBe('https://x.example/original')
  })

  it('permits a DELETE, which is the whole reason it has two guards and not three', async () => {
    // ADR-0010: "a no-DELETE trigger and a sweep cannot both be true". The
    // trigger shipped anyway, which made the published retention window
    // unenforceable at the storage layer while a green suite read as though it
    // were enforced. This assertion is the correction, stated as behaviour.
    const runId = await newRun()
    const written = await ledger.appendEvidence({ runId, kind: 'page-snapshot', url: 'https://x.example' })
    expect(written.ok).toBe(true)
    if (!written.ok) return

    await db.prisma.actionEvidence.delete({ where: { id: written.id } })

    expect(await repos.evidence.byId(written.id)).toBeNull()
  })
})

/* ── 3. the sweep ────────────────────────────────────────────────────────── */

describe('the retention sweep removes what is past the window and nothing else', () => {
  /** Evidence with a chosen age, on a run with no outcomes — so only the window
   *  can reach it. */
  async function agedEvidence(runId: string, daysAgo: number, url: string): Promise<string> {
    const row = await db.prisma.actionEvidence.create({
      data: {
        runId,
        kind: 'page-snapshot',
        url,
        createdAt: new Date(Date.now() - daysAgo * DAY_MS),
      },
      select: { id: true },
    })
    return row.id
  }

  it('deletes past the window and leaves everything inside it', async () => {
    const runId = await newRun()
    const old = await agedEvidence(runId, ACTION_EVIDENCE_RETENTION_DAYS + 1, 'https://x.example/old')
    const recent = await agedEvidence(runId, ACTION_EVIDENCE_RETENTION_DAYS - 1, 'https://x.example/recent')

    const result = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })

    expect(result.expired.deleted).toBeGreaterThanOrEqual(1)
    expect(await repos.evidence.byId(old)).toBeNull()
    expect(await repos.evidence.byId(recent)).not.toBeNull()
  })

  it('reaps a settled run immediately, which is the ordinary case', async () => {
    const runId = await newRun()
    const fresh = await agedEvidence(runId, 0, 'https://x.example/settled')

    const outcome = await db.prisma.shiftOutcome.create({
      data: {
        runId,
        ordinal: 1,
        kind: 'answer',
        reversibility: 'held',
        headline: 'An answer',
        reason: 'because',
        citedActionIntentIds: [],
        detail: {},
      },
      select: { id: true },
    })

    // Held and undecided: the person has not looked yet, so the evidence stays.
    const before = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })
    expect(before.settled.deleted).toBe(0)
    expect(await repos.evidence.byId(fresh)).not.toBeNull()

    await repos.outcomes.recordVerdict({ outcomeId: outcome.id, verdict: 'accept' })

    const after = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })
    expect(after.settled.deleted).toBeGreaterThanOrEqual(1)
    expect(await repos.evidence.byId(fresh)).toBeNull()
  })

  it('treats a landed outcome as settled, because it admits no verdict', async () => {
    const runId = await newRun()
    const fresh = await agedEvidence(runId, 0, 'https://x.example/landed')

    await db.prisma.shiftOutcome.create({
      data: {
        runId,
        ordinal: 1,
        kind: 'external-effect',
        reversibility: 'landed',
        headline: 'It was sent',
        reason: 'because you said yes',
        citedActionIntentIds: [],
        detail: {},
      },
    })

    await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })

    expect(await repos.evidence.byId(fresh)).toBeNull()
  })

  it('keeps — and counts — what a confirmation question points at', async () => {
    /**
     * The published exception, asserted rather than discovered.
     *
     * `ConfirmationRequest.evidenceId` is a foreign key to the exact row the
     * person was looking at when they authorised an irreversible effect, and
     * `confirmation_request` is append-only. Deleting the row would delete the
     * record of a human being asked, on the one class of action where that
     * record matters most.
     */
    const runId = await newRun()
    const held = await agedEvidence(runId, ACTION_EVIDENCE_RETENTION_DAYS + 30, 'https://x.example/asked')

    const intent = await db.prisma.actionIntent.create({
      data: {
        runId,
        seq: 1,
        kind: 'click-element',
        params: {},
        reason: 'press Send',
        authorized: false,
        refusedRule: 'confirmation_required',
      },
      select: { id: true },
    })
    await db.prisma.confirmationRequest.create({
      data: { runId, intentId: intent.id, summary: 'POST to northwind.example.com', evidenceId: held },
    })

    const result = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })

    expect(await repos.evidence.byId(held)).not.toBeNull()
    expect(result.expired.keptForConfirmation).toBeGreaterThanOrEqual(1)
  })

  it('is safe to run twice, and reports nothing the second time', async () => {
    const runId = await newRun()
    await agedEvidence(runId, ACTION_EVIDENCE_RETENTION_DAYS + 2, 'https://x.example/twice')

    const first = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })
    const second = await sweepActionEvidence({ evidence: repos.evidence, now: () => new Date() })

    expect(first.deleted).toBeGreaterThanOrEqual(1)
    expect(second.deleted).toBe(0)
  })
})
