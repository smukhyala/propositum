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
  ['decision_verdict_no_update', 'decision_verdict'],
  ['decision_verdict_no_delete', 'decision_verdict'],
  ['decision_verdict_no_replace', 'decision_verdict'],
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

/**
 * The schema on disk is older than the code. A different fault, said differently.
 *
 * ── Why this is not an `AppendOnlyGuardError` ────────────────────────────
 *
 * That one means *"the ledger is unprotected, do not proceed"* — a table exists
 * and its triggers do not. This means the table does not exist at all, so
 * nothing can be written to it and nothing is unprotected. It is a setup step
 * somebody has not run, and telling them the ledger is compromised would send
 * them looking for a data problem they do not have.
 *
 * ── Why it exists at all ─────────────────────────────────────────────────
 *
 * Because of what it replaced. A `CREATE TRIGGER` on a missing table throws a
 * `PrismaClientKnownRequestError` whose stack is preceded by roughly five
 * thousand characters of minified client, and the one useful line — *"no such
 * table: main.decision_verdict"* — is at the bottom of it. Measured on a real
 * run: the worker crash-looped three times, printed that wall three times, and
 * the actual fix was one command that appeared nowhere in the output.
 *
 * So this names the table, names the command, and says what it is not.
 */
export class SchemaBehindError extends Error {
  constructor(public readonly table: string) {
    super(
      `The database has no \`${table}\` table, so its append-only guards cannot be installed.\n\n` +
        'The schema on disk is older than this code. Run:\n\n' +
        '  npx prisma db push\n\n' +
        'and start again. Nothing is wrong with the data that is already there — ' +
        'this is a table that has not been created yet, not a ledger that has lost ' +
        'its protection.',
    )
    this.name = 'SchemaBehindError'
  }
}

/**
 * The table SQLite says is missing, out of whatever the driver threw.
 *
 * Read off the message rather than a code, because there is no code for it:
 * every DDL failure here arrives as P2010 with the real reason nested in
 * `meta.message`. Returns null for anything else, so an unrecognised failure
 * still throws its original error rather than being relabelled as a setup step
 * somebody can fix by running one command.
 */
function missingTableIn(error: unknown): string | null {
  const text =
    error instanceof Error
      ? `${error.message} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`
      : String(error)
  return /no such table:\s*(?:main\.)?([A-Za-z0-9_]+)/.exec(text)?.[1] ?? null
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
 * What this costs, measured on Linux 2026-09-03.
 *
 * ── Why anybody asked ────────────────────────────────────────────────────
 *
 * Three tests timed out on CI and passed on a re-run of the same commit. That
 * had three candidate explanations, and only the first was ever measured: the
 * `testTimeout` in `vitest.config.ts` cured it, and that comment says plainly
 * it is a cure and not a diagnosis. The third candidate was this function — the
 * suspicion that reinstalling the guards is disproportionately expensive on a
 * runner as against a developer machine, and that the files which build a
 * database of their own each pay for it. A pull request headed *"TEMPORARY:
 * diagnose the append-only guard install on Linux"* was opened and closed on
 * exactly that suspicion and the answer was never written down.
 *
 * The reason it was worth taking now rather than later is that the cure hides
 * it: with thirty seconds of headroom, an install that has quietly become five
 * times slower is invisible until it is thirty times slower.
 *
 * ── The number ───────────────────────────────────────────────────────────
 *
 * Taken by timing each part of the `beforeAll` in `tests/append-only.test.ts`
 * on x86-64 Linux, four cores. Medians, not means:
 *
 *   idle, 9 samples            `npx prisma db push`   1168 ms   94.6%
 *                              install and verify       29 ms    2.3%
 *                              install alone, warm      22 ms
 *                              verify alone              <1 ms
 *                              the whole beforeAll    1235 ms
 *
 *   four of those at once,     `npx prisma db push`   1.7–1.9 s  94–96%
 *   20 samples                 install and verify     38–62 ms   2.1–3.1%
 *
 * The second block is the one that answers the question, because contention
 * between parallel workers is the mechanism the timeout exists for. Under it
 * the install roughly doubles and remains a rounding error, while the
 * subprocess in front of it absorbs everything.
 *
 * ── The verdict ──────────────────────────────────────────────────────────
 *
 * Proportionate. The install is two to three per cent of a database-backed test
 * file's setup, and `testTimeout` stands as the whole answer. There is no
 * performance ticket here and no argument for hoisting this out of a test
 * file's `beforeAll`: doing so would save two per cent of something that runs
 * once per file, and cost every file its own database. If CI time is ever worth
 * attacking, `prisma db push` is where it went, and that is a different piece
 * of work with a different risk attached to it.
 *
 * ── What this does NOT cover, which is half the comparison ───────────────
 *
 *   - **No Mac number was taken.** The measurement was made in a Linux
 *     container and there was no Mac to hand. ~0.8 s per push warm on an
 *     M-series machine is on record from the work that added the timeout; it is
 *     cited here as somebody else's prior, not as a figure measured beside
 *     these. So the Linux-against-Mac ratio for the install itself is still
 *     unknown. What has changed is that it matters less, because the install is
 *     small on the side that can be seen.
 *   - **This is not `ubuntu-latest`.** It is Linux with four cores; the runner
 *     the flakes happened on has two, and different disk. Absolute numbers
 *     there will be worse. The claim being made is the share, and a share is
 *     what survives the difference — fewer cores slow the push and the install
 *     together.
 *   - **Nothing asserts any of this.** It is the record of one run on one
 *     machine, kept here for the reason the CI workflow keeps its own runner
 *     timings in prose: there is nowhere cheaper for it to live. Re-measure
 *     rather than believe it if the suite gets slow again.
 *
 * ── The install itself ───────────────────────────────────────────────────
 *
 * Idempotent — every statement is DROP-then-CREATE.
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
  let missing: string[]
  try {
    missing = await db.$transaction(
      async (tx) => {
        await runStatements(tx, statements)
        return findMissingGuards(tx)
      },
      { timeout: INSTALL_TIMEOUT_MS },
    )
  } catch (error) {
    // A missing table is a setup step, not a compromised ledger. Anything else
    // is rethrown untouched — relabelling an unknown failure as "run db push"
    // would send somebody to the wrong place with confidence.
    const table = missingTableIn(error)
    if (table !== null) throw new SchemaBehindError(table)
    throw error
  }

  if (missing.length > 0) throw new AppendOnlyGuardError(missing)
}
