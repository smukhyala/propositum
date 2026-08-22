/**
 * The row, and the columns it must not have.
 *
 * The column-list assertion is the important one and it is the same shape
 * `tests/eval.test.ts` uses for `OfferTally`: "no column a subject could go in"
 * is checkable rather than promised, and a migration that adds one turns this
 * red.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'

let dir: string
let prisma: PrismaClient
let repos: Repositories

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-reticence-'))
  const url = `file:${join(dir, 'test.db')}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  prisma = new PrismaClient({ datasources: { db: { url } } })
  repos = createRepositories(prisma)
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('the reticence table', () => {
  it('holds four columns and none of them could carry a subject', async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM pragma_table_info('offer_reticence')`,
    )
    const names = columns.map((c) => c.name).sort()

    expect(names).toEqual(['declines', 'lastDeclinedOn', 'signatureHash'])
  })

  it('counts declines against one hash and leaves others alone', async () => {
    await repos.reticence.record('hash-a', '2026-08-22')
    await repos.reticence.record('hash-a', '2026-08-23')
    await repos.reticence.record('hash-b', '2026-08-23')

    const found = await repos.reticence.declinesFor(['hash-a', 'hash-b', 'hash-c'])

    expect(found.get('hash-a')).toBe(2)
    expect(found.get('hash-b')).toBe(1)
    // Absent, not zero — the caller decides what "never declined" means.
    expect(found.has('hash-c')).toBe(false)
  })

  it('forgets a hash entirely when it is cleared', async () => {
    await repos.reticence.record('hash-cleared', '2026-08-22')
    await repos.reticence.clear('hash-cleared')

    const found = await repos.reticence.declinesFor(['hash-cleared'])
    expect(found.has('hash-cleared')).toBe(false)
  })

  it('sweeps rows last declined before a day and keeps the rest', async () => {
    await repos.reticence.record('hash-old', '2026-07-01')
    await repos.reticence.record('hash-new', '2026-08-22')

    const deleted = await repos.reticence.sweepDeclinedBefore('2026-08-01')

    expect(deleted).toBe(1)
    const found = await repos.reticence.declinesFor(['hash-old', 'hash-new'])
    expect(found.has('hash-old')).toBe(false)
    expect(found.get('hash-new')).toBe(1)
  })

  it('returns one salt and the same salt every time', async () => {
    const first = await repos.reticence.salt()
    const second = await repos.reticence.salt()

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
  })
})
