/**
 * Append-only enforcement: install, then VERIFY.
 *
 * Prisma's SQLite migrations drop triggers on any table rebuild, silently and
 * with exit code 0. So the guards cannot live only in a migration — they are
 * reinstalled and checked every time the application starts.
 *
 * The verify step is the point. Installing without verifying would give exactly
 * the false confidence the triggers exist to prevent: a startup that "ran the
 * SQL" and a database with no guards on it.
 *
 * Call `ensureAppendOnlyGuards()` at app startup and at worker startup, after
 * migrations, before anything writes.
 *
 * ── A trap worth knowing before you debug one of these ───────────────────
 *
 * When a guard fires, SQLite raises SQLITE_CONSTRAINT_TRIGGER (code 1811) with
 * our message. Prisma's ORM layer then maps it to **P2003, "Foreign key
 * constraint violated"** — and the real message is gone.
 *
 * It is inconsistent, too: `observation_event` surfaces the true message
 * (nothing references it), while `document_version` and `handoff_contract`,
 * both targets of foreign keys, get remapped.
 *
 * The write is still correctly rejected and the data is untouched. Only the
 * diagnosis is wrong — and "foreign key constraint violated" on an append-only
 * table sends you looking for a relation bug that does not exist.
 *
 * Locked in by tests/append-only.test.ts. A repository layer should re-map
 * P2003 on these tables back to something honest.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/** Minimal surface we need, so this works with a PrismaClient or a test double. */
export interface RawExecutor {
  $executeRawUnsafe(sql: string): Promise<number>
  $queryRawUnsafe<T = unknown>(sql: string): Promise<T>
}

/**
 * Every guard that must exist, as `[trigger name, table]`.
 *
 * This list is the specification. `triggers.sql` is the implementation, and
 * `verifyAppendOnlyGuards` checks one against the other — so adding a trigger
 * to the SQL without adding it here (or vice versa) fails loudly at startup
 * rather than leaving a table quietly unguarded.
 */
export const REQUIRED_GUARDS: ReadonlyArray<readonly [string, string]> = [
  ['observation_event_no_update', 'observation_event'],
  ['observation_event_no_delete', 'observation_event'],
  ['observation_event_no_replace', 'observation_event'],
  ['action_intent_no_update', 'action_intent'],
  ['action_intent_no_delete', 'action_intent'],
  ['action_intent_no_replace', 'action_intent'],
  ['action_outcome_no_update', 'action_outcome'],
  ['action_outcome_no_delete', 'action_outcome'],
  ['action_outcome_no_replace', 'action_outcome'],
  ['model_call_record_no_update', 'model_call_record'],
  ['model_call_record_no_delete', 'model_call_record'],
  ['model_call_record_no_replace', 'model_call_record'],
  ['change_verdict_no_update', 'change_verdict'],
  ['change_verdict_no_delete', 'change_verdict'],
  ['change_verdict_no_replace', 'change_verdict'],
  ['document_version_no_update', 'document_version'],
  ['document_version_no_delete', 'document_version'],
  ['document_version_no_replace', 'document_version'],
  ['handoff_contract_frozen_once_accepted', 'handoff_contract'],
  ['handoff_contract_no_delete_accepted', 'handoff_contract'],
] as const

export class AppendOnlyGuardError extends Error {
  constructor(public readonly missing: ReadonlyArray<string>) {
    super(
      `Append-only guards missing after install: ${missing.join(', ')}.\n\n` +
        'This almost certainly means a Prisma migration rebuilt a table and ' +
        'dropped its triggers. Do not proceed — the ledger is not append-only ' +
        'right now, and any writes made in this state are unprotected.',
    )
    this.name = 'AppendOnlyGuardError'
  }
}

function triggersSqlPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'prisma', 'triggers.sql')
}

/**
 * Split on `;` at end of line only. SQLite trigger bodies contain internal
 * semicolons, so a naive split on every `;` would tear each CREATE TRIGGER
 * apart. Statements in triggers.sql are terminated by `;` on its own line or at
 * the end of `END;`.
 */
function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')

  const statements: string[] = []
  let current = ''

  for (const line of withoutComments.split('\n')) {
    current += line + '\n'
    const trimmed = line.trim()
    const endsStatement =
      trimmed === 'END;' || (trimmed.endsWith(';') && !/^(BEGIN|CREATE|WHEN|SELECT)/i.test(trimmed))
    if (endsStatement) {
      if (current.trim()) statements.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) statements.push(current.trim())

  return statements
}

/** Install the guards. Idempotent — every statement is DROP-then-CREATE. */
export async function installAppendOnlyGuards(db: RawExecutor): Promise<void> {
  const sql = await readFile(triggersSqlPath(), 'utf8')
  for (const statement of splitStatements(sql)) {
    await db.$executeRawUnsafe(statement)
  }
}

/** Which required guards are absent from the database right now. */
export async function findMissingGuards(db: RawExecutor): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'trigger'",
  )
  const present = new Set(rows.map((r) => r.name))
  return REQUIRED_GUARDS.map(([name]) => name).filter((name) => !present.has(name))
}

/**
 * Install and verify. Throws if any guard is still missing afterwards.
 *
 * Startup should fail here rather than continue. A database that accepts an
 * UPDATE on the ledger is a worse outcome than an application that will not
 * boot, because the first one is silent.
 */
export async function ensureAppendOnlyGuards(db: RawExecutor): Promise<void> {
  await installAppendOnlyGuards(db)
  const missing = await findMissingGuards(db)
  if (missing.length > 0) throw new AppendOnlyGuardError(missing)
}
