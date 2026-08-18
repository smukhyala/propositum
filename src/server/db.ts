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

/**
 * The context if one has already been built, and never a new one.
 *
 * *(Added 2026-08-18, after review, and it exists for one caller:
 * `countQuietly` in `src/server/offer-tally.ts`.)*
 *
 * ── What went wrong, exactly ─────────────────────────────────────────────
 *
 * `countQuietly` is fire-and-forget by design and reached for `appContext()`.
 * In the app that is the right handle. In a `vitest` worker it is a loaded gun:
 * `build()` calls `createDatabase({})`, which takes `DATABASE_URL` from `.env`,
 * which is the developer's real `propositum.db`. So an ordinary
 * `npx vitest run tests/multiple-threads.test.ts` — a file that declines a
 * strand, and has no idea a counter exists — wrote `offersShown: 3,
 * offersDeclined: 2` into the real database, twice over on a second run.
 *
 * The damage is not a dirty file. It is that the one measurement this
 * workstream exists to produce was being manufactured by its own test suite:
 * `npm run eval -- --report` on a database nobody had used printed *"3 shown ·
 * 2 declined (67% declined) over 0 observed minutes"*, which displaced the
 * honest *"nothing counted yet"* that `src/eval/offer-rate.ts` goes to some
 * trouble to distinguish from zero.
 *
 * ── Why this shape rather than an argument ───────────────────────────────
 *
 * Passing `repos` in from each call site was the other option and it fails on
 * the two sites that matter: the ambient route and the extension's decline
 * endpoint hold no context on purpose — *"the ambient endpoint keeps its shape
 * of touching no database on the request path"* — and handing them one to pass
 * along would make them open a database to count that they did not open one.
 *
 * So the rule is narrower and it is about capability rather than wiring: **a
 * counter may write to a database somebody else opened, and may never open
 * one.** That is a true sentence about what a self-measurement is allowed to
 * do, and it happens to make the counter inert in any process that has not
 * already built a context — which is every test file that does not ask for one.
 *
 * ── What it costs, named rather than rounded ─────────────────────────────
 *
 * On a freshly started app the first ambient POST can arrive before anything
 * has built a context, and its observed minute is lost. The bound is small and
 * it is worth stating: the extension polls `/api/session/current` every thirty
 * seconds and that route awaits `appContext()` on its first line, and any Home
 * render does the same — so the loss is at most the minute or two before the
 * app serves its first page or poll, once per process start. A lost count is
 * the failure `countQuietly` already chooses everywhere else.
 */
export function existingAppContext(): Promise<AppContext> | undefined {
  return globalThis.__propositum
}
