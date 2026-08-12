/**
 * The loop's only memory.
 *
 * ── One code path instead of three ───────────────────────────────────────
 *
 * A continuing agent needs to know what it has already done. There are three
 * moments where that question is asked, and the tempting design answers each of
 * them separately:
 *
 *   1. **Resume.** A confirmation was refused, the person said yes, and a new
 *      `AgentRun` continues under the same contract.
 *   2. **Crash recovery.** The Mac slept mid-run; a later run picks the work up.
 *   3. **The startup sweep.** Nobody is picking it up; the app writes down what
 *      was left dangling so the report is honest.
 *
 * The separate answers are: pass state forward on the successor row, keep it in
 * memory, and a bespoke query in the sweeper. All three would then be three
 * places that can disagree about what happened — and they would disagree
 * exactly in the case that matters, which is the one where a process died
 * between two writes.
 *
 * **So there is one answer: read the ledger.** Every field below is derived from
 * durable append-only rows, so it recomputes to the same value after any number
 * of restarts, and the successor run learns what its predecessor did by reading
 * what its predecessor WROTE rather than by being told. That is not a
 * performance decision; it is what makes "the ledger is the record" true rather
 * than aspirational.
 *
 * ── Why per CONTRACT and not per run ─────────────────────────────────────
 *
 * ADR-0010 §5 is explicit that a confirmation is not replayed into the run that
 * was refused: nothing is rewritten, no row changes, and the continuation is a
 * NEW `AgentRun`. So a per-run history would forget everything the moment
 * somebody was asked a question — the agent would come back from the pause with
 * no idea it had already filled in half the form.
 *
 * That has a consequence for the caps, and it is a deliberate one rather than an
 * accident of the query. `MAX_ACTIONS_PER_RUN` and `MAX_MUTATING_ACTIONS_PER_RUN`
 * are named per-run and are, through these counts, enforced **per contract**.
 * That is strictly tighter than their names promise, and it closes a real hole:
 * if each continuation started at zero, then *asking for permission would buy
 * eight more changes*, and a run that wanted a ninth change would only have to
 * propose something that needed confirming. A safeguard that resets when it
 * fires is not a safeguard.
 *
 * ── This module reads. It does not decide ────────────────────────────────
 *
 * Nothing here consults a policy, a clock or a model. It turns rows into facts;
 * the gate and the stop rules turn facts into decisions. Keeping the split means
 * the sweep and the loop can share this without the sweep inheriting a loop's
 * opinions.
 */

/**
 * One `ActionIntent`, with its `ActionOutcome` if it has one.
 *
 * An interface rather than a Prisma type, so this module can be handed rows by
 * the app process, by the worker process, or by a test with an array — and so
 * that `src/runtime/` does not import a database client. The same reason every
 * tool takes its collaborators as an argument.
 */
export interface LedgerIntentRow {
  readonly id: string
  readonly runId: string
  readonly seq: number
  readonly kind: string
  readonly reason: string
  readonly authorized: boolean
  readonly refusedRule: string | null
  /** `null` when nothing has been recorded against this intent yet — which is
   *  either an action in flight, or one whose process died mid-effect. From
   *  here those two are indistinguishable, and that is the honest state. */
  readonly outcome: {
    readonly result: string
    readonly scopeVerdict: string
    readonly detail: string | null
  } | null
}

export interface HistoryReader {
  /** Every authorized-or-refused intent under this contract, in the order they
   *  were committed. Ordering is the caller's to guarantee, because only the
   *  caller knows whether it is reading one run or several. */
  intentsForContract(contractId: string): Promise<readonly LedgerIntentRow[]>
}

export interface HistoryDeps {
  readonly ledger: HistoryReader
  /**
   * The set that decides whether an intent counts against the Progress dial.
   *
   * Passed in rather than imported from `../domain/handoff/policy`, and the
   * reason is not layering pedantry. This module reads STRINGS off durable rows
   * — a `kind` column written months ago, possibly naming a capability that no
   * longer exists in the enum. Importing the live set would tempt a future
   * reader into narrowing `kind` to `ActionKind` here, and then an old row
   * naming a retired capability would either crash the rebuild or silently stop
   * being counted. Neither is acceptable in the code path that recovers a
   * crashed run.
   */
  readonly mutatingKinds: ReadonlySet<string>
}

/** What one earlier action looks like to the model. Deliberately the same shape
 *  the boundary already takes, so nothing translates between two vocabularies. */
export interface HistoryTurn {
  readonly kind: string
  readonly summary: string
  readonly outcome: string
}

export interface RebuiltHistory {
  /** Everything that happened, refusals included, oldest first. */
  readonly turns: readonly HistoryTurn[]
  /** Authorized intents of every kind. What `MAX_ACTIONS_PER_RUN` counts. */
  readonly actionsTaken: number
  /** Of those, the ones whose kind can change something. What the Progress dial
   *  moves and what `MAX_MUTATING_ACTIONS_PER_RUN` counts. */
  readonly mutatingActionsTaken: number
  /**
   * Authorized intents with no outcome at all.
   *
   * The `unknown` ActionStatus, in row form. Under the standing "a local worker
   * stops when the Mac sleeps" constraint this is ROUTINE rather than exotic:
   * the intent is committed before the effect, so a process that dies between
   * the two leaves exactly this.
   */
  readonly orphanedIntentIds: readonly string[]
}

/**
 * Rebuild what a contract's runs have already done.
 *
 * Pure over its input rows: no clock, no policy, no model, and no writes. The
 * recovery outcomes for `orphanedIntentIds` are written by
 * `recoverOrphanedIntents` below, separately and deliberately — see its header.
 */
export async function historyForContract(
  contractId: string,
  deps: HistoryDeps,
): Promise<RebuiltHistory> {
  const rows = await deps.ledger.intentsForContract(contractId)

  const turns: HistoryTurn[] = []
  const orphanedIntentIds: string[] = []
  let actionsTaken = 0
  let mutatingActionsTaken = 0

  for (const row of rows) {
    if (!row.authorized) {
      // A refusal is part of the history the model should see: it is how the
      // agent learns that the thing it wants is not available, rather than
      // proposing it a third time. It counts toward no cap, because nothing
      // happened.
      turns.push({
        kind: row.kind,
        summary: row.reason,
        outcome: `refused: ${row.refusedRule ?? 'unknown'}`,
      })
      continue
    }

    actionsTaken += 1
    if (deps.mutatingKinds.has(row.kind)) mutatingActionsTaken += 1

    if (row.outcome === null) {
      orphanedIntentIds.push(row.id)
      // Said in the words the ledger will shortly record, so the model reads the
      // same sentence whether it is looking at a rebuilt history or at a fresh
      // one. "We do not know" is the fact; it is not softened.
      turns.push({ kind: row.kind, summary: row.reason, outcome: 'unknown — it was interrupted' })
      continue
    }

    turns.push({
      kind: row.kind,
      summary: row.reason,
      outcome: row.outcome.detail ?? row.outcome.result,
    })
  }

  return { turns, actionsTaken, mutatingActionsTaken, orphanedIntentIds }
}

export interface RecoveryWriter {
  recordOutcome(input: {
    intentId: string
    result: 'succeeded' | 'failed'
    scopeVerdict: 'within_scope' | 'out_of_scope' | 'unverified'
    detail?: string | undefined
    observedBy?: string | undefined
  }): Promise<void>
}

/**
 * The first writer `ActionOutcome.observedBy` has ever had.
 *
 * ── What this converts, and what it must not pretend ─────────────────────
 *
 * `observedBy` has been specified in CONTEXT.md §4 since the vocabulary was
 * written, landed in the schema in wave 1, and had no writer at all. Meanwhile a
 * run that died between the effect and the outcome write left a trailing
 * `unknown` forever — authorized, zero outcomes, indistinguishable from a run
 * that genuinely did nothing. That is a REPORTING GAP: the software knew
 * something had been attempted and told no one.
 *
 * This closes it by recording a fact instead of leaving a hole:
 *
 *   > `failed` · `unverified` · `observedBy: 'recovery'`
 *
 * Read that carefully, because every part of it is chosen to avoid claiming more
 * than we know:
 *
 *   - `failed` rather than `succeeded`, because we cannot show it worked. It is
 *     the direction that under-claims. Note it does NOT mean "nothing happened":
 *     a click dispatched before the process died may well have landed.
 *   - `unverified` rather than `out_of_scope`, because scope was decided by the
 *     gate before the effect and was fine. What is unverified is the RESULT.
 *     CONTEXT.md is explicit that `unverified` covers both "nothing happened"
 *     and "we cannot tell", and that under the sleep constraint it is the
 *     routine value rather than the exception.
 *   - `observedBy: 'recovery'` rather than null, because null means *the
 *     authorising run saw this itself*, which is the one thing that is certainly
 *     untrue here.
 *
 * **The recovery writer may only record what it can prove, and may never
 * infer.** It can prove that an authorized intent has no outcome. It cannot
 * prove what the browser did, so it does not say — and nobody may later "improve"
 * this by guessing from the next observation, because a guess written into an
 * append-only ledger is indistinguishable from an observation.
 *
 * ── Why it is separate from `historyForContract` ─────────────────────────
 *
 * The rebuild is a read and this is a write. Fusing them would mean that asking
 * "what has happened so far" mutates the ledger, which is a surprising thing for
 * a function named after a question to do — and it would make the rebuild
 * unusable from anywhere that must not write, such as rendering a report. The
 * continuation calls both, in this order, before it acts.
 */
export async function recoverOrphanedIntents(
  orphanedIntentIds: readonly string[],
  writer: RecoveryWriter,
): Promise<number> {
  for (const intentId of orphanedIntentIds) {
    await writer.recordOutcome({
      intentId,
      result: 'failed',
      scopeVerdict: 'unverified',
      detail: 'The run stopped before it could record what happened. Whether this landed is unknown.',
      observedBy: 'recovery',
    })
  }

  return orphanedIntentIds.length
}
