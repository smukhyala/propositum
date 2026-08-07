/**
 * Process startup: one client, guards on, or refuse to run.
 *
 * ── No module-level singleton ────────────────────────────────────────────
 *
 * `createDatabase()` returns a handle the caller owns and injects. The
 * engineering standard forbids hidden global state, and there is a concrete
 * reason here beyond principle: the app and the worker are SEPARATE PROCESSES
 * (ADR-0001) with different lifetimes, and tests spin up throwaway databases
 * per file. A module-level client makes all three quietly share one connection
 * pool and one set of assumptions.
 *
 * ── Startup fails rather than warns ──────────────────────────────────────
 *
 * `ensureAppendOnlyGuards()` has existed and been tested since ADR-0003, and
 * until now nothing called it. The guards were real and switched off.
 *
 * A database that accepts an UPDATE on the ledger is worse than an application
 * that will not boot, because the first one is silent. So this throws.
 */

import { PrismaClient } from '@prisma/client'
import { ensureAppendOnlyGuards } from './append-only'

export interface Database {
  readonly prisma: PrismaClient
  readonly close: () => Promise<void>
}

export interface DatabaseOptions {
  /** Overrides `DATABASE_URL`. Tests pass a temp file; production omits it. */
  readonly url?: string | undefined
  /** Emit every query. Off by default — useful logging that does not leak
   *  private content is the standard, and query text carries user content. */
  readonly logQueries?: boolean | undefined
}

/**
 * Create a client and install the guards. Never returns a handle to an
 * unguarded database.
 */
export async function createDatabase(options: DatabaseOptions = {}): Promise<Database> {
  const prisma = new PrismaClient({
    ...(options.url ? { datasources: { db: { url: options.url } } } : {}),
    ...(options.logQueries ? { log: [{ emit: 'stdout', level: 'query' as const }] } : {}),
  })

  // After migrations, before anything writes. Prisma's SQLite migrations drop
  // triggers on any table rebuild — exit code 0, no warning — so this is a
  // runtime invariant, not a migration artifact.
  await ensureAppendOnlyGuards(prisma)

  return {
    prisma,
    close: () => prisma.$disconnect(),
  }
}
