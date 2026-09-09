/**
 * The schema and the migrations say the same thing.
 *
 * ── The failure this exists to catch ─────────────────────────────────────
 *
 * Since [ADR-0039](../docs/adr/0039-a-migration-history-and-a-copy-before-it.md)
 * a database is brought forward by `prisma migrate deploy`, and `deploy` applies
 * the files in `prisma/migrations/` — it never looks at `schema.prisma`. So a
 * schema change committed without a migration beside it produces a repository
 * where:
 *
 *   - the generated client, the types and every test agree with the new schema;
 *   - `npm test`, `npm run typecheck` and `npm run build` are all green;
 *   - a **fresh** database built from the migrations is missing the change;
 *   - and every existing database has nothing to bring it forward, for ever.
 *
 * Nothing else in the suite can see that, because everything else builds its
 * database with `prisma db push`, which reads the schema and is therefore always
 * right by construction. The one artefact that would be wrong is the one nothing
 * was looking at. ADR-0039 shipped naming this as discipline; this is the guard
 * that was owed.
 *
 * ── Why `migrate diff` and not a file check ──────────────────────────────
 *
 * *"A migration was added when the schema changed"* is checkable against git and
 * would be the wrong question: it passes for a migration that does not say what
 * the schema says, which is the actual defect. `migrate diff` compares the two
 * artefacts semantically — replay the migrations into a shadow database, read
 * the schema, and report whether they describe the same tables.
 *
 * ── This is slower than the rest of the suite, and it is worth it ────────
 *
 * Two Prisma subprocesses, each replaying 38 tables into a temporary file. About
 * ten seconds. The alternative is discovering the mismatch when somebody's
 * database of real work will not open, so the budget argument does not apply
 * here any more than it does anywhere else in `AGENTS.md`.
 */

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * `migrate diff --exit-code`: 0 for no difference, 2 for a difference.
 *
 * Returns the code rather than throwing, because both outcomes are results here
 * — the second test wants the failure.
 */
function diffAgainstMigrations(schemaPath: string, shadow: string): number {
  try {
    execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema-datamodel',
        schemaPath,
        '--shadow-database-url',
        `file:${shadow}`,
        '--exit-code',
      ],
      { cwd: repo, stdio: 'pipe' },
    )
    return 0
  } catch (error) {
    return (error as { status?: number }).status ?? 1
  }
}

describe('the migrations describe the schema', () => {
  it('has no difference between prisma/migrations and prisma/schema.prisma', () => {
    const dir = mkdtempSync(join(tmpdir(), 'propositum-migdiff-'))

    try {
      const code = diffAgainstMigrations(join(repo, 'prisma/schema.prisma'), join(dir, 'shadow.db'))

      expect(
        code,
        'prisma/schema.prisma has moved ahead of prisma/migrations. Every existing database has ' +
          'nothing to bring it forward. Write one: `npx prisma migrate dev --name <what-changed>`',
      ).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)

  /**
   * The half that keeps the test above honest.
   *
   * A guard that reports "no difference" because the path is wrong, the flag was
   * renamed, or the subprocess failed in a way that looks like success is worse
   * than no guard: it is a green tick that has stopped meaning anything, which
   * this repository has already produced twice this week. So drift is
   * manufactured and the guard has to notice it.
   */
  it('and would say so — a schema with one added field is a difference', () => {
    const dir = mkdtempSync(join(tmpdir(), 'propositum-migdiff-'))

    try {
      const drifted = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8').replace(
        'model Project {',
        'model Project {\n  driftProbe String?',
      )
      const schemaPath = join(dir, 'drifted.prisma')
      writeFileSync(schemaPath, drifted)

      // Guard the guard's own fixture: a replace that silently matched nothing
      // would leave the schema unchanged and this test would pass by agreeing
      // with the one above.
      expect(drifted, 'the drift probe was not inserted, so this test proves nothing').toContain(
        'driftProbe',
      )

      expect(
        diffAgainstMigrations(schemaPath, join(dir, 'shadow.db')),
        'a schema with an extra column read as identical to the migrations — the comparison is ' +
          'not comparing anything',
      ).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 180_000)
})
