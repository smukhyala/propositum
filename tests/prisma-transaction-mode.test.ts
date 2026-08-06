/**
 * Does Prisma open SQLite transactions with BEGIN IMMEDIATE?
 *
 * This matters for exactly one reason, and it is load-bearing.
 *
 * The worker claims a queued run with a read-then-write: find a pending row,
 * mark it claimed. Under a DEFERRED `BEGIN`, SQLite starts that transaction as
 * a reader and only tries to upgrade to a writer at the UPDATE. If another
 * connection wrote in between, the upgrade fails with SQLITE_BUSY_SNAPSHOT —
 * and unlike ordinary SQLITE_BUSY, the busy timeout does NOT retry it. The
 * claim fails hard instead of waiting.
 *
 * `BEGIN IMMEDIATE` takes the write lock up front, so the race cannot occur.
 *
 * docs/research/durable-local-execution.md flagged Prisma's behaviour here as
 * unverified. Verified 2026-08-06 against Prisma 6.19.3: it emits BEGIN
 * IMMEDIATE for both interactive and batch transactions, so the claim path
 * needs no raw SQL.
 *
 * If this test ever fails, the run-claim path must switch to raw
 * `BEGIN IMMEDIATE` before anything else is debugged.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir: string
let prisma: PrismaClient
let emitted: string[] = []

const transactionKeywords = () =>
  emitted.filter((q) => /^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(q)).map((q) => q.trim().toUpperCase())

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-tx-'))
  prisma = new PrismaClient({
    datasources: { db: { url: `file:${join(dir, 'test.db')}` } },
    log: [{ emit: 'event', level: 'query' }],
  })

  // Create the table directly rather than shelling out to `prisma db push`,
  // so the test stays fast and self-contained.
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "project" (
       "id" TEXT PRIMARY KEY NOT NULL,
       "name" TEXT NOT NULL,
       "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  )

  // @ts-expect-error Prisma's event typing does not narrow on the log config
  prisma.$on('query', (e: { query: string }) => emitted.push(e.query))
})

afterAll(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('Prisma SQLite transaction mode', () => {
  it('opens an interactive transaction with BEGIN IMMEDIATE', async () => {
    emitted = []

    await prisma.$transaction(async (tx) => {
      await tx.project.findFirst()
      await tx.project.create({ data: { name: 'interactive' } })
    })

    expect(transactionKeywords()).toContain('BEGIN IMMEDIATE')
  })

  it('opens a batch transaction with BEGIN IMMEDIATE', async () => {
    emitted = []

    await prisma.$transaction([prisma.project.findMany(), prisma.project.count()])

    expect(transactionKeywords()).toContain('BEGIN IMMEDIATE')
  })

  it('never opens a bare deferred BEGIN, which is the unretryable case', async () => {
    emitted = []

    await prisma.$transaction(async (tx) => {
      await tx.project.findFirst()
      await tx.project.create({ data: { name: 'deferred-check' } })
    })

    // A bare `BEGIN` with nothing after it is the deferred form. `BEGIN
    // IMMEDIATE` is fine; anything else opening a transaction is not.
    expect(transactionKeywords().filter((q) => q === 'BEGIN')).toHaveLength(0)
  })
})
