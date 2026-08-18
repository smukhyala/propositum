/**
 * No test may reach the developer's real database by omission.
 *
 * *(Added 2026-08-18, after review, as the second of two guards.)*
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * `.env` sets `DATABASE_URL="file:../propositum.db"`, and `vitest` loads no
 * `.env` itself — but `createDatabase({})` with no override hands the URL to
 * Prisma, which reads the file. Every test that wants a database creates a
 * throwaway one and says so; the danger is the test that does NOT want one and
 * gets it anyway, from a module reaching for a process-global three imports
 * down. That is exactly what happened: `countQuietly` called `appContext()`,
 * `tests/multiple-threads.test.ts` declined a strand, and rows landed in the
 * real `propositum.db`, corrupting the one metric the change existed to add.
 *
 * The first guard is the real one and it is structural — `countQuietly` can no
 * longer open a database at all, see `existingAppContext` in
 * `src/server/db.ts`. This is the second, and it is deliberately dumber: it
 * makes the DEFAULT wrong rather than the caller careful, so the next
 * accidental reach lands somewhere harmless without anybody having thought
 * about it.
 *
 * ── How it works, and what it does not do ────────────────────────────────
 *
 * Setup files run once per test file, before that file's imports, so each file
 * gets its own path under the OS temp directory. The path is a file that does
 * not exist and no schema is pushed to it: an accidental `createDatabase({})`
 * therefore fails in `ensureAppendOnlyGuards` against an empty database, which
 * is a loud failure for a test that meant it and a swallowed one for a
 * fire-and-forget counter that did not.
 *
 * *It does not stop* a test from setting `DATABASE_URL` back to the real file,
 * and it is not meant to — a dozen files legitimately set it to their own temp
 * database in `beforeAll`, which runs after this and wins. It also does not
 * stop a test from passing `{ url }` explicitly, which is the normal path.
 *
 * The stray files are left behind rather than cleaned up, because the only ones
 * ever created are made by a bug this is trying to surface, and a temp file
 * nobody can find is a worse outcome than a temp file nobody deletes.
 */

import { join } from 'node:path'
import { tmpdir } from 'node:os'

const unique = `propositum-unset-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`

process.env['DATABASE_URL'] = `file:${join(tmpdir(), unique, 'never-created.db')}`
