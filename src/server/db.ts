/**
 * The app process's database handle.
 *
 * ── Why a memoised singleton here, when client.ts refuses one ────────────
 *
 * `createDatabase()` deliberately has no module-level state: the app and the
 * worker are separate processes with different lifetimes, and tests use
 * throwaway files. That decision stands.
 *
 * But *within* the app process there must be exactly one handle, for a reason
 * specific to Next: the dev server hot-reloads modules on every edit, and a
 * fresh `PrismaClient` per reload leaks connections until SQLite refuses. The
 * standard fix is to hang it off `globalThis`, which survives HMR.
 *
 * So: the library exposes a factory with no hidden state, and this file — the
 * app's composition root — owns exactly one instance of it. That is
 * dependency injection with a single wiring point, not a global by accident.
 *
 * The worker never imports this. It calls `createDatabase()` itself.
 */

import { createDatabase } from '../persistence/client'
import type { Database } from '../persistence/client'
import { createRepositories } from '../persistence/repositories/index'
import type { Repositories } from '../persistence/repositories/index'
import { createLedgerWriter } from '../persistence/ledger-writer'
import type { LedgerWriter } from '../persistence/ledger-writer'

export interface AppContext {
  readonly db: Database
  readonly repos: Repositories
  /** The single door observation events enter by. Routes must use this and
   *  never a repository — `seq` gaplessness depends on it. */
  readonly ledger: LedgerWriter
}

declare global {
  // eslint-disable-next-line no-var
  var __propositum: Promise<AppContext> | undefined
}

async function build(): Promise<AppContext> {
  // Installs and VERIFIES the append-only guards, and throws if any is
  // missing. A route handler will never see an unguarded database.
  const db = await createDatabase({})

  return {
    db,
    repos: createRepositories(db.prisma),
    ledger: createLedgerWriter(db.prisma),
  }
}

export function appContext(): Promise<AppContext> {
  globalThis.__propositum ??= build()
  return globalThis.__propositum
}
