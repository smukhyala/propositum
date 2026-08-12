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

/**
 * A confirmation the person actually answered YES to, with the action it was
 * about.
 *
 * Carries the REFUSED INTENT's own `kind` and `params` — not the continuation's
 * — because that is what the person was shown. The question they answered was
 * built by code from attested facts about that intent, so the only action their
 * yes covers is one that matches it.
 */
export interface ConfirmedAction {
  /** The `ConfirmationRequest` id. What the gate checks membership of. */
  readonly requestId: string
  /** The refused `ActionIntent` the request was raised against. */
  readonly intentId: string
  readonly kind: string
  readonly params: Record<string, unknown>
}

export interface HistoryReader {
  /** Every authorized-or-refused intent under this contract, in the order they
   *  were committed. Ordering is the caller's to guarantee, because only the
   *  caller knows whether it is reading one run or several. */
  intentsForContract(contractId: string): Promise<readonly LedgerIntentRow[]>
  /**
   * Confirmations under this contract that a human ANSWERED YES to.
   *
   * Deliberately not "requests" — a request with no verdict, a rejected one and
   * an expired one are all the same thing to the gate, which is *not
   * permitted*, and a reader that returned all three would invite a caller to
   * tell them apart itself. **Expiry never approves**, and the cheapest way to
   * keep that true is for the unanswered ones never to arrive here.
   *
   * Optional so a caller with no confirmation story — every existing drafting
   * run — is not obliged to implement it. Absent means nothing is confirmed,
   * which is the same state the gate defaults to.
   */
  confirmationsForContract?(contractId: string): Promise<readonly ConfirmedAction[]>
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
  /**
   * A run whose own intents must never be reported as orphaned.
   *
   * ── The hazard this closes, and the larger one it does not ───────────
   *
   * An orphan is an authorized intent with no outcome, and that is
   * indistinguishable from an action THAT IS STILL IN FLIGHT. Writing a
   * recovery outcome for one of those would put a `failed / unverified` row
   * against an action that is about to succeed — and, because `intentId` is
   * unique on `action_outcome`, the real outcome would then fail to insert and
   * take the run down with it.
   *
   * Passing the caller's own run id makes this function safe to call from
   * inside a live run, which is the entire point of there being one rebuild
   * path rather than three: the continuation, the crash sweep and the startup
   * sweep all use it, and only the last of them runs when nothing is live.
   *
   * **It does not close the cross-run case, and that is not a gap this file can
   * close.** Two worker processes holding the same contract — a stale lease
   * re-claimed while the first is still alive — would let one recover the
   * other's in-flight intents. The fence for that is `AgentRun.claimedBy`,
   * which CONTEXT.md §4 has described since the vocabulary was written and
   * which nothing reads yet. Naming it here rather than papering over it: when
   * that fence lands, this comment is where the interaction is written down.
   */
  readonly excludeRunId?: string | undefined
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
  /**
   * What the person has said yes to under this contract.
   *
   * Two shapes of the same fact, because the gate and the loop need different
   * halves of it: the gate checks MEMBERSHIP of `confirmedRequestIds`, and the
   * loop needs the action each id was about so deterministic code can decide
   * which proposal a yes covers.
   */
  readonly confirmedRequestIds: ReadonlySet<string>
  readonly confirmations: readonly ConfirmedAction[]
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
  const confirmations = (await deps.ledger.confirmationsForContract?.(contractId)) ?? []

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
      // Not an orphan if it belongs to the run doing the asking — that is an
      // action in flight, and the run that owns it will write its outcome.
      if (row.runId !== deps.excludeRunId) orphanedIntentIds.push(row.id)
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

  return {
    turns,
    actionsTaken,
    mutatingActionsTaken,
    orphanedIntentIds,
    confirmations,
    confirmedRequestIds: new Set(confirmations.map((c) => c.requestId)),
  }
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

/**
 * Which confirmation, if any, covers this proposal.
 *
 * ── Deterministic code decides this, and that is the whole point ─────────
 *
 * The obvious shape is to let the model name the confirmation it is acting
 * under. That is a **grant**: a model that can name a `confirmationId` can
 * confirm its own action, and granting is the one thing a model may never do.
 * ADR-0007's asymmetry is exact — declining withholds, permitting does not — so
 * the id is injected here, from durable rows, keyed on what the person was
 * actually shown.
 *
 * ── What must match, and the one thing that cannot ──────────────────────
 *
 * The kind and every identifying parameter must be equal to the refused
 * intent's: the same element, the same text, the same key. `snapshotId` is
 * excluded and CANNOT be included — the continuation is a new run that observed
 * the page again, so its snapshot is necessarily different, and requiring
 * equality would mean no confirmation ever applied to anything.
 *
 * **That exclusion is a real residual risk and is not closed here.** A page
 * that re-rendered between the question and the answer can move `ref` onto a
 * different control, so a yes given about *Track shipment* could attach to
 * whatever took its place. ADR-0010 §5 designs this flow — the continuation
 * proposes the action again and is allowed — and it records the adjacent hazard
 * ("re-clicking after approval may double-fire") without closing this one. What
 * bounds it today is that the gate still refuses a stale snapshot, still runs
 * the classifier against the NEW element's evidence, and still counts the
 * action against the mutating cap. What would close it is the request carrying
 * the element's attested identity and this function requiring that to match
 * too; that needs the evidence the confirmation was raised with, which is
 * another unit's to plumb.
 */
export function confirmationIdFor(
  kind: string,
  params: Record<string, unknown>,
  confirmations: readonly ConfirmedAction[],
): string | undefined {
  for (const confirmed of confirmations) {
    if (confirmed.kind !== kind) continue
    if (!identifyingParamsMatch(confirmed.params, params)) continue
    return confirmed.requestId
  }
  return undefined
}

/**
 * The parameters that say WHICH action this is, compared exactly.
 *
 * A closed list rather than a whole-object comparison, and the direction of the
 * risk decides which: an over-broad list makes a confirmation apply to fewer
 * things (the person is asked again — annoying), while a missing field makes it
 * apply to MORE (the person's yes covers something they were not shown). So a
 * field is included unless there is a reason it cannot be, and `snapshotId` is
 * the only such reason — see above.
 */
function identifyingParamsMatch(
  confirmed: Record<string, unknown>,
  proposed: Record<string, unknown>,
): boolean {
  for (const field of ['ref', 'inputText', 'key', 'path', 'approvedSourceId', 'sectionPath']) {
    if (confirmed[field] !== proposed[field]) return false
  }
  return true
}
