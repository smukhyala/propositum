/**
 * Translating Prisma's errors back into the truth.
 *
 * ── The specific lie this fixes ──────────────────────────────────────────
 *
 * When an append-only trigger fires, SQLite raises SQLITE_CONSTRAINT_TRIGGER
 * (code 1811) carrying our own message — "observation_event is append-only:
 * UPDATE forbidden".
 *
 * Prisma's ORM layer then maps that to **P2003, "Foreign key constraint
 * violated"**, and the real message is gone. Worse, it is inconsistent:
 * `observation_event` surfaces the true message (nothing references it), while
 * `document_version` and `handoff_contract` — both targets of foreign keys —
 * get remapped.
 *
 * The write is still correctly rejected and the data is untouched. Only the
 * diagnosis is wrong, and "foreign key constraint violated" on an append-only
 * table sends you hunting a relation bug that does not exist.
 *
 * Discovered in ADR-0003 the expensive way, when two tests failed for a reason
 * that had nothing to do with what they were testing.
 */

/** Tables whose writes are guarded by append-only or freeze triggers. A P2003
 *  on one of these is far more likely a guard firing than a real FK problem. */
const GUARDED_TABLES = [
  'observation_event',
  'action_intent',
  'action_outcome',
  'model_call_record',
  'change_verdict',
  'document_version',
  'handoff_contract',
] as const

export type GuardedTable = (typeof GUARDED_TABLES)[number]

export class AppendOnlyViolationError extends Error {
  constructor(
    public readonly table: GuardedTable,
    public readonly operation: string,
    cause?: unknown,
  ) {
    super(
      `${table} is append-only — the ${operation} was rejected by a database guard, ` +
        `and the row is unchanged.\n\n` +
        `Prisma reports this as P2003 "Foreign key constraint violated". That is ` +
        `wrong: SQLite raised SQLITE_CONSTRAINT_TRIGGER and Prisma remapped it. ` +
        `There is no relation problem here — something tried to mutate a row that ` +
        `cannot be mutated.`,
      cause === undefined ? undefined : { cause },
    )
    this.name = 'AppendOnlyViolationError'
  }
}

interface PrismaLikeError {
  readonly code?: string
  readonly message?: string
}

function isPrismaLike(error: unknown): error is PrismaLikeError {
  return typeof error === 'object' && error !== null
}

/**
 * Re-throw with an honest error when a guard fired; otherwise pass through
 * untouched.
 *
 * The table and operation are supplied by the caller rather than parsed out of
 * Prisma's message, because that message is exactly the thing that is wrong.
 */
export function translateGuardError(
  error: unknown,
  table: GuardedTable,
  operation: 'update' | 'delete' | 'upsert',
): never {
  if (isPrismaLike(error)) {
    const message = String(error.message ?? '')

    // The honest case: the message survived, so the guard is already legible.
    if (/append-only|insert-only|frozen once accepted/i.test(message)) {
      throw new AppendOnlyViolationError(table, operation, error)
    }

    // The dishonest case: P2003 on a guarded table.
    if (error.code === 'P2003') {
      throw new AppendOnlyViolationError(table, operation, error)
    }
  }

  throw error
}

/** Wrap a mutation that must not succeed on a guarded table, so the error a
 *  caller sees names the real cause. */
export async function guarded<T>(
  table: GuardedTable,
  operation: 'update' | 'delete' | 'upsert',
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run()
  } catch (error) {
    translateGuardError(error, table, operation)
  }
}
