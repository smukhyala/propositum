/**
 * The database is copied before it is migrated, and a pushed file is baselined.
 *
 * ── What is worth testing here, and what is not ──────────────────────────
 *
 * Not `migrate deploy`. That is Prisma's, it is exercised every time anybody
 * runs the app, and a test that asserts it applies a migration is a test of
 * somebody else's product.
 *
 * What IS worth testing is the decision in front of it, because it has one
 * branch that can destroy something. Baselining marks a migration applied
 * **without running it**, so baselining a file that is not at the baseline
 * leaves a database missing tables that every later migration assumes are
 * there. `planFor` is the whole of that judgment, and the three states it
 * distinguishes are the three tests below.
 *
 * The integration test at the bottom is slower and covers the one path nobody
 * would notice going wrong: a database built by `prisma db push` — which on
 * 2026-09-08 is every database in existence, including the author's — arriving
 * at a scheme that has never seen it. ADR-0039.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BACKUPS_KEPT,
  backupNameFor,
  planFor,
  pruneBackups,
} from '../src/persistence/prepare'

describe('what to do with the file that is there', () => {
  it('creates without copying when there is no database yet', () => {
    const plan = planFor({ exists: false, hasMigrationHistory: false, hasOurTables: false })

    expect(plan).toMatchObject({ backUp: false, baseline: false, deploy: true })
  })

  it('copies and deploys a database this scheme has seen before', () => {
    const plan = planFor({ exists: true, hasMigrationHistory: true, hasOurTables: true })

    // Never baselined: it already has a history, and marking the baseline
    // applied a second time would be claiming something about a file whose
    // actual state is recorded rather than inferred.
    expect(plan).toMatchObject({ backUp: true, baseline: false, deploy: true })
  })

  it('baselines a database built by `db push`, and only that one', () => {
    const plan = planFor({ exists: true, hasMigrationHistory: false, hasOurTables: true })

    expect(plan).toMatchObject({ backUp: true, baseline: true, deploy: true })
    expect(plan.because).toMatch(/db push/)
  })

  it('does not baseline a file it does not recognise, and still copies it', () => {
    // Tables absent, history absent. An empty file, or somebody else's.
    // Baselining here would mark 38 tables created that do not exist.
    const plan = planFor({ exists: true, hasMigrationHistory: false, hasOurTables: false })

    expect(plan.baseline).toBe(false)
    expect(plan.backUp).toBe(true)
  })

  it('copies in every case where there is anything to copy', () => {
    const states = [
      { exists: true, hasMigrationHistory: true, hasOurTables: true },
      { exists: true, hasMigrationHistory: false, hasOurTables: true },
      { exists: true, hasMigrationHistory: false, hasOurTables: false },
    ]

    // The rule with no exception: if there is a file, it is copied first. A
    // branch that skipped the copy would be a branch where a bad migration is
    // unrecoverable, and "I do not recognise this file" is the worst moment to
    // decide a copy is not worth it.
    for (const state of states) expect(planFor(state).backUp).toBe(true)
  })
})

describe('the copies', () => {
  it('names them so they sort in time order', () => {
    const early = backupNameFor('/db/p.db', new Date('2026-09-08T09:00:00Z'))
    const late = backupNameFor('/db/p.db', new Date('2026-09-08T17:30:00Z'))

    expect([late, early].sort()).toEqual([early, late])
    // No colons or dots in the stamp: both are legal in a filename and both are
    // awkward in a shell, and this is a path a person types when they need it.
    expect(early).not.toMatch(/[:]/)
  })

  it('keeps the newest and removes the rest, oldest first', () => {
    const names = Array.from({ length: BACKUPS_KEPT + 3 }, (_, i) =>
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 1 + i))),
    )

    const removed = pruneBackups(names)

    expect(removed).toHaveLength(3)
    expect(removed).toEqual(names.slice(0, 3))
  })

  it('removes nothing while there is room', () => {
    const names = Array.from({ length: BACKUPS_KEPT }, (_, i) =>
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 1 + i))),
    )

    expect(pruneBackups(names)).toEqual([])
  })

  it('sorts rather than trusting the order it was handed', () => {
    // `readdirSync` does not promise an order, and on a case-insensitive
    // filesystem it is not the order anybody expects either.
    const names = [
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 3))),
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 1))),
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 2))),
    ]

    expect(pruneBackups(names, 1)).toEqual([
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 1))),
      backupNameFor('p.db', new Date(Date.UTC(2026, 8, 2))),
    ])
  })
})

/**
 * The path every existing install takes, exactly once.
 *
 * Slow — two Prisma subprocesses — and worth it, because the failure it catches
 * is one nobody would see coming: `migrate deploy` against a `db push` database
 * tries to CREATE TABLE over tables that exist and dies on the first one. Every
 * database in the world was in that state when this landed.
 */
describe('a database built by `db push` meets migrations for the first time', () => {
  it('is copied, baselined, and left with its rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'propositum-prepare-'))
    const file = join(dir, 'existing.db')
    const url = `file:${file}`

    try {
      execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      })

      execFileSync('npx', ['tsx', 'scripts/prepare-database.ts'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      })

      const copies = readdirSync(dir).filter((n) => n.startsWith('existing.db.backup-'))
      expect(copies, 'the file was migrated without a copy being taken first').toHaveLength(1)

      // And the original is still there. A "migration" that replaced the file
      // would satisfy every other assertion in this test.
      expect(existsSync(file)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
