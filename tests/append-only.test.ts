/**
 * The test that fails if append-only is ever violated.
 *
 * This runs against the REAL schema pushed into a temporary database, not a
 * hand-made table — otherwise it would prove the triggers work on a fixture
 * while saying nothing about the tables that actually hold the ledger.
 *
 * NOTE ON SPEED: beforeAll shells out to `prisma db push`, which takes a few
 * seconds and contends with anything else invoking Prisma at the same time
 * (running `next build` alongside it pushed this file from 3s to 23s and made
 * it fail). That is not a realistic CI condition — CI does not build and test
 * concurrently against one install — so the subprocess stays, because pushing
 * the REAL schema is the whole point. If it ever flakes in CI, that is the
 * thing to look at first rather than the assertions.
 *
 * The third case is the one worth having. `INSERT OR REPLACE` walks straight
 * through a no-UPDATE + no-DELETE pair, because `PRAGMA recursive_triggers`
 * defaults OFF so the DELETE trigger never fires. A two-trigger design looks
 * complete and silently overwrites rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ensureAppendOnlyGuards,
  findMissingGuards,
  installAppendOnlyGuards,
  REQUIRED_GUARDS,
} from '../src/persistence/append-only'

let dir: string
let prisma: PrismaClient
let sessionId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-appendonly-'))
  const url = `file:${join(dir, 'test.db')}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  prisma = new PrismaClient({ datasources: { db: { url } } })
  await ensureAppendOnlyGuards(prisma)

  const project = await prisma.project.create({ data: { name: 'test' } })
  const session = await prisma.workSession.create({ data: { projectId: project.id } })
  sessionId = session.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

async function insertEvent(id: string, seq: number) {
  return prisma.observationEvent.create({
    data: {
      id,
      sessionId,
      seq,
      observedAt: new Date(0),
      elapsedMs: seq * 1000,
      kind: 'visited',
      attested: { title: 'a page' },
    },
  })
}

describe('guard installation', () => {
  it('installs every required guard', async () => {
    expect(await findMissingGuards(prisma)).toEqual([])
  })

  it('is idempotent — reinstalling leaves the guards intact', async () => {
    await installAppendOnlyGuards(prisma)
    await installAppendOnlyGuards(prisma)
    expect(await findMissingGuards(prisma)).toEqual([])
  })

  it('detects a dropped guard, which is what a Prisma table rebuild causes', async () => {
    await prisma.$executeRawUnsafe('DROP TRIGGER observation_event_no_update')

    expect(await findMissingGuards(prisma)).toContain('observation_event_no_update')

    await ensureAppendOnlyGuards(prisma)
    expect(await findMissingGuards(prisma)).toEqual([])
  })

  it('covers every append-only table named in the schema', () => {
    const tables = new Set(REQUIRED_GUARDS.map(([, table]) => table))
    for (const table of ['observation_event', 'action_intent', 'action_outcome', 'model_call_record', 'change_verdict', 'document_version']) {
      expect(tables).toContain(table)
    }
  })
})

describe('observation_event is append-only', () => {
  it('accepts an INSERT', async () => {
    const event = await insertEvent('evt-insert', 1)
    expect(event.id).toBe('evt-insert')
  })

  it('rejects an UPDATE', async () => {
    await insertEvent('evt-update', 2)

    await expect(
      prisma.observationEvent.update({ where: { id: 'evt-update' }, data: { kind: 'queried' } }),
    ).rejects.toThrow(/append-only/i)
  })

  it('rejects a DELETE', async () => {
    await insertEvent('evt-delete', 3)

    await expect(
      prisma.observationEvent.delete({ where: { id: 'evt-delete' } }),
    ).rejects.toThrow(/append-only/i)
  })

  it('rejects INSERT OR REPLACE — the case a two-trigger design misses', async () => {
    await insertEvent('evt-replace', 4)

    await expect(
      prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO observation_event
           (id, sessionId, seq, observedAt, elapsedMs, kind, attested)
         VALUES ('evt-replace', '${sessionId}', 4, 0, 0, 'note', '{}')`,
      ),
    ).rejects.toThrow(/append-only/i)

    // And the original row is untouched.
    const row = await prisma.observationEvent.findUnique({ where: { id: 'evt-replace' } })
    expect(row?.kind).toBe('visited')
  })
})

describe('handoff_contract freezes once accepted', () => {
  async function makeContract(id: string, status: string) {
    const project = await prisma.project.findFirstOrThrow()
    const doc = await prisma.document.create({
      data: { projectId: project.id, title: `doc-${id}` },
    })
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        ordinal: 1,
        contentHash: 'hash',
        content: 'Base text.',
        origin: 'human',
      },
    })
    const reading = await prisma.sessionReading.create({
      data: { sessionId, throughSeq: 0 },
    })
    return prisma.handoffContract.create({
      data: {
        id,
        sessionId,
        readingId: reading.id,
        status,
        objective: 'o',
        definitionOfDone: 'd',
        guidance: [],
        approvedSourceIds: [],
        allowedActionKinds: ['read-approved-source'],
        baseVersionId: version.id,
        initiative: 'follow-closely',
        progress: 'current-step-only',
        output: 'suggestions-only',
        interruption: 'stop-when-uncertain',
        timeLimitMinutes: 30,
      },
    })
  }

  it('allows editing a draft', async () => {
    await makeContract('contract-draft', 'draft')

    const updated = await prisma.handoffContract.update({
      where: { id: 'contract-draft' },
      data: { objective: 'edited by the human' },
    })
    expect(updated.objective).toBe('edited by the human')
  })

  it('rejects editing an accepted contract, leaving it unchanged', async () => {
    await makeContract('contract-accepted', 'accepted')

    // Assert the SECURITY PROPERTY, not the message — see the mapping quirk below.
    await expect(
      prisma.handoffContract.update({
        where: { id: 'contract-accepted' },
        data: { timeLimitMinutes: 999 },
      }),
    ).rejects.toThrow()

    const after = await prisma.handoffContract.findUniqueOrThrow({
      where: { id: 'contract-accepted' },
    })
    expect(after.timeLimitMinutes).toBe(30)
  })
})

describe('document_version is insert-only', () => {
  it('rejects an UPDATE, which would invalidate every changeset hash pointing at it', async () => {
    const project = await prisma.project.findFirstOrThrow()
    const doc = await prisma.document.create({ data: { projectId: project.id, title: 'immutable' } })
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        ordinal: 1,
        contentHash: 'abc',
        content: 'Original.',
        origin: 'human',
      },
    })

    await expect(
      prisma.documentVersion.update({ where: { id: version.id }, data: { content: 'Tampered.' } }),
    ).rejects.toThrow()

    const after = await prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } })
    expect(after.content).toBe('Original.')
  })
})

/**
 * Prisma reports trigger aborts as foreign-key violations.
 *
 * This is not a nitpick — it will send someone hunting a relation bug that does
 * not exist. SQLite raises SQLITE_CONSTRAINT_TRIGGER (code 1811) carrying our
 * actual message. Prisma's ORM layer maps that to P2003, "Foreign key
 * constraint violated", and the real message is gone.
 *
 * Worse, it is inconsistent: `observation_event` surfaces the true message
 * (nothing references it), while `document_version` and `handoff_contract` —
 * both targets of foreign keys — get remapped.
 *
 * Every guard still holds. Only the diagnosis is wrong. Assert rejection plus
 * unchanged data, never the message, and re-map P2003 at the repository layer
 * when one is built.
 */
describe('Prisma error mapping (documenting a trap, not testing our code)', () => {
  it('raw SQL surfaces the real trigger message; the ORM reports P2003 instead', async () => {
    const project = await prisma.project.findFirstOrThrow()
    const doc = await prisma.document.create({ data: { projectId: project.id, title: 'mapping' } })
    const version = await prisma.documentVersion.create({
      data: {
        documentId: doc.id,
        ordinal: 1,
        contentHash: 'h',
        content: 'Original.',
        origin: 'human',
      },
    })

    // Raw: the truth.
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE document_version SET content = 'Tampered.' WHERE id = '${version.id}'`,
      ),
    ).rejects.toThrow(/insert-only: UPDATE forbidden/i)

    // ORM: the same rejection, misattributed.
    const ormError = await prisma.documentVersion
      .update({ where: { id: version.id }, data: { content: 'Tampered.' } })
      .then(() => null)
      .catch((e: unknown) => e as { code?: string })

    expect(ormError?.code).toBe('P2003')

    const after = await prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } })
    expect(after.content).toBe('Original.')
  })
})
