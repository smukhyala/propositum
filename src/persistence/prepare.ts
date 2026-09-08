/**
 * What has to happen to the database file before anything opens it.
 *
 * Three steps, in an order that is the whole of the argument: **copy, baseline,
 * migrate.** This module decides all three and performs none of the Prisma
 * ones — `scripts/prepare-database.ts` is the process that runs them, and the
 * split is so the decisions can be tested without spawning a CLI.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * The tray ran `prisma db push` at every launch, and so did every developer.
 * `db push` is a **development** command: it reconciles the file to whatever
 * the schema says and asks nobody. On a narrowing change it drops the column
 * and the data in it, and the only copy of a person's work is that file.
 * `prisma/migrations/` did not exist, so there was no history, nothing that
 * could refuse a destructive change, and no way to know what version a file on
 * somebody's disk was.
 *
 * That was survivable while the only database was the author's and every schema
 * change was additive. It stops being survivable the moment a stranger installs
 * a `.dmg`, because the failure is silent, permanent, and lands on data nobody
 * else has a copy of. See ADR-0039.
 *
 * ── The three states a file can be in, which is the actual work ──────────
 *
 * `migrate deploy` handles two of them and cannot handle the third:
 *
 *   - **No file.** Deploy creates it from the migrations. Nothing to copy.
 *   - **A file this scheme has seen** — it has `_prisma_migrations`. Deploy
 *     applies whatever is pending.
 *   - **A file built by `db push`** — every table, no `_prisma_migrations`.
 *     Deploy would try to create tables that already exist and fail on the
 *     first one. This is every database in existence on 2026-09-08, including
 *     the author's, so it is not an edge case: it is the migration path.
 *
 * The third is answered by BASELINING — telling Prisma the baseline migration
 * is already applied, without running it. That is only sound because the
 * baseline was generated from the same schema those files were pushed from
 * (`migrate diff --from-empty`), so the tables it would create are the tables
 * they already have.
 *
 * **The dangerous version of this is baselining a file that is NOT at the
 * baseline**, which would mark a migration applied that never ran and leave a
 * database missing tables that every later migration assumes. So the check is
 * narrow on purpose: a file is baselined only when it has our tables AND no
 * migration history. A file with neither is a new file, and a file with both
 * needs nothing.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not verify the append-only guards. `prisma db push` and
 * `migrate deploy` both drop triggers on a table rebuild, and the reinstall is
 * `ensureAppendOnlyGuards` inside `createDatabase()`, once per process, after
 * this has finished. The ordering is preflight's, not this module's.
 *
 * It does not restore. A copy is written and its path is reported; putting one
 * back is a person moving a file, deliberately, and a product that silently
 * restored a backup would be a product that can silently lose the work done
 * since. ADR-0039 refuses an automatic restore for that reason.
 *
 * It does not run on a test database. Every temporary database in the suite is
 * built by `prisma db push` and thrown away, which is the correct tool for a
 * file nobody will ever open twice.
 */

/** Where a database is, and what we know about it. */
export interface DatabaseState {
  /** The file exists on disk. */
  readonly exists: boolean
  /** It holds `_prisma_migrations` — this scheme has seen it before. */
  readonly hasMigrationHistory: boolean
  /** It holds tables of ours. A file with tables and no history was pushed. */
  readonly hasOurTables: boolean
}

/** What `prepareDatabase` decided to do, in order. */
export interface PreparePlan {
  /** Copy the file first. False only when there is no file to copy. */
  readonly backUp: boolean
  /**
   * Mark the baseline applied without running it.
   *
   * True only for a `db push` database. See the header: baselining a file that
   * is not at the baseline is the one way this module can destroy something.
   */
  readonly baseline: boolean
  /** Always true. Deploy is a no-op when nothing is pending. */
  readonly deploy: true
  /** Why, in a sentence, for the log. */
  readonly because: string
}

export const BASELINE_MIGRATION = '0_baseline'

/**
 * How many copies to keep.
 *
 * Enough that a person who launches twice without noticing a problem still has
 * the file from before it, and few enough that the directory does not become a
 * second copy of the database growing without bound. A person who wants more
 * than this wants a backup tool, which this is not.
 */
export const BACKUPS_KEPT = 5

/**
 * The decision, as a value. No filesystem, no Prisma, no clock.
 *
 * Split out from the doing so the three states above can each be a test rather
 * than a thing somebody reasons about while reading a shell script.
 */
export function planFor(state: DatabaseState): PreparePlan {
  if (!state.exists) {
    return {
      backUp: false,
      baseline: false,
      deploy: true,
      because: 'no database yet — deploy will create it from the migrations',
    }
  }

  if (state.hasMigrationHistory) {
    return {
      backUp: true,
      baseline: false,
      deploy: true,
      because: 'migration history present — applying whatever is pending',
    }
  }

  if (state.hasOurTables) {
    return {
      backUp: true,
      baseline: true,
      deploy: true,
      because:
        'tables but no migration history — this file was built by `db push`, so the baseline is ' +
        'marked applied rather than run',
    }
  }

  // A file that exists, holds none of our tables and no history. Empty, or
  // somebody else's. Deploy will create the tables; it is still copied first,
  // because "I do not recognise this" is the worst moment to skip the copy.
  return {
    backUp: true,
    baseline: false,
    deploy: true,
    because: 'a file with neither our tables nor a history — treated as empty, and copied first',
  }
}

/**
 * The name of a copy, given when it was taken.
 *
 * Sorts lexicographically in time order, which is what `pruneBackups` relies on
 * rather than reading mtimes — a filename that carries its own ordering cannot
 * be reordered by a file copy that preserves timestamps.
 */
export function backupNameFor(databaseFile: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  return `${databaseFile}.backup-${stamp}`
}

/** Which copies to remove, oldest first, keeping `BACKUPS_KEPT`. */
export function pruneBackups(
  existing: readonly string[],
  keep: number = BACKUPS_KEPT,
): readonly string[] {
  const ordered = [...existing].sort()
  if (ordered.length <= keep) return []
  return ordered.slice(0, ordered.length - keep)
}
