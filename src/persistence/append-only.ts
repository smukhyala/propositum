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
 * A client that can pin a sequence of statements to ONE connection.
 *
 * Prisma pools connections and hands each `$executeRawUnsafe` whichever one is
 * free. That is invisible until two statements depend on each other, which is
 * exactly what `triggers.sql` is made of: every `CREATE TRIGGER` is preceded by
 * the `DROP TRIGGER IF EXISTS` that makes room for it. Scatter the pair across
 * two connections under load and the CREATE fails with *"already exists"* for a
 * trigger `sqlite_master` reports as absent — see the test that pins this.
 */
export interface TransactionalExecutor extends RawExecutor {
  $transaction<T>(
    fn: (tx: RawExecutor) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T>
}

/**
 * Every guard that must exist, as `[trigger name, table]`.
 *
 * This list is the specification. `triggers.sql` is the implementation, and
 * `verifyAppendOnlyGuards` checks one against the other — so adding a trigger
 * to the SQL without adding it here (or vice versa) fails loudly at startup
 * rather than leaving a table quietly unguarded.
 *
 * That loudness is the feature and it is worth defending, because the failure
 * mode it prevents is silent. If you arrived here because startup threw, the
 * fix is to add the missing half, never to shorten this list.
 *
 * `agent_run` and `action_dispatch` are ABSENT ON PURPOSE. Both are claim
 * targets, and a claim is by definition a mutation. The append-only record of
 * what a dispatch was for is its `action_intent`, which is guarded and is
 * committed before the dispatch exists.
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
  ['work_offer_no_update', 'work_offer'],
  ['work_offer_no_delete', 'work_offer'],
  ['work_offer_no_replace', 'work_offer'],
  ['shift_outcome_no_update', 'shift_outcome'],
  ['shift_outcome_no_delete', 'shift_outcome'],
  ['shift_outcome_no_replace', 'shift_outcome'],
  ['outcome_verdict_no_update', 'outcome_verdict'],
  ['outcome_verdict_no_delete', 'outcome_verdict'],
  ['outcome_verdict_no_replace', 'outcome_verdict'],
  ['confirmation_request_no_update', 'confirmation_request'],
  ['confirmation_request_no_delete', 'confirmation_request'],
  ['confirmation_request_no_replace', 'confirmation_request'],
  ['confirmation_verdict_no_update', 'confirmation_verdict'],
  ['confirmation_verdict_no_delete', 'confirmation_verdict'],
  ['confirmation_verdict_no_replace', 'confirmation_verdict'],
  /**
   * `action_evidence` has TWO guards, not three, and `action_evidence_no_delete`
   * is absent on purpose.
   *
   * This is the only entry in this list that needs an argument, so here it is.
   * ActionEvidence is the one durable table that is SWEPT: ADR-0010's retention
   * section states plainly that "a no-DELETE trigger and a sweep cannot both be
   * true", and CONTEXT.md's ActionEvidence entry says the same. The trigger
   * shipped anyway, which made a published retention promise unenforceable at
   * the storage layer while a green suite read as though it were enforced.
   *
   * The two remaining guards carry the whole of what append-only was protecting
   * here: a ConfirmationRequest points at one of these rows as the thing the
   * person was looking at when they authorised an effect, and a row that can be
   * rewritten is not a record of what they were shown. Immutability is about
   * rewriting history. Retention is about how long history is kept. Only the
   * second needs DELETE.
   *
   * `prisma/triggers.sql` still DROPs the old trigger every startup, so a
   * database created before this change is corrected rather than left with a
   * sweep that fails on one machine and works on another.
   */
  ['action_evidence_no_update', 'action_evidence'],
  ['action_evidence_no_replace', 'action_evidence'],
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

/**
 * How long the install may hold its connection.
 *
 * Generous on purpose: the default interactive-transaction timeout is five
 * seconds, and this runs ~75 DDL statements on a machine that may be running a
 * test suite at the same time. A timeout here fails startup, and startup
 * failing because a laptop was busy is a worse outcome than holding one SQLite
 * connection for a few seconds at boot.
 */
const INSTALL_TIMEOUT_MS = 60_000

/** Every statement, in file order, on the connection it was handed. */
async function runStatements(tx: RawExecutor, statements: ReadonlyArray<string>): Promise<void> {
  for (const statement of statements) {
    await tx.$executeRawUnsafe(statement)
  }
}

/**
 * Install the guards. Idempotent — every statement is DROP-then-CREATE.
 *
 * On ONE connection, and atomically. The pairing is the reason: a `CREATE` that
 * runs on a different connection from its `DROP` fails under load, and a reader
 * on a third connection can catch the table between the two with no guard on it
 * at all. Both were possible for the whole build; see `TransactionalExecutor`.
 */
export async function installAppendOnlyGuards(db: TransactionalExecutor): Promise<void> {
  const statements = splitStatements(await readFile(triggersSqlPath(), 'utf8'))
  await db.$transaction((tx) => runStatements(tx, statements), { timeout: INSTALL_TIMEOUT_MS })
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
export async function ensureAppendOnlyGuards(db: TransactionalExecutor): Promise<void> {
  const statements = splitStatements(await readFile(triggersSqlPath(), 'utf8'))

  // The check reads `sqlite_master` on the same pinned connection that just
  // wrote it. On a pooled one it could read a connection that had not caught up
  // and refuse to start a database that is in fact guarded — the same disagreement
  // as the install, pointed the other way.
  const missing = await db.$transaction(
    async (tx) => {
      await runStatements(tx, statements)
      return findMissingGuards(tx)
    },
    { timeout: INSTALL_TIMEOUT_MS },
  )

  if (missing.length > 0) throw new AppendOnlyGuardError(missing)
}
