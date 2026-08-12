/**
 * Turning what a run produced into what it IS.
 *
 * ── The one place a kind or a reversibility is assigned ──────────────────
 *
 * `ShiftOutcomeKind` and `Reversibility` are written here and nowhere else, and
 * `tests/architecture.test.ts` greps for that rather than trusting it. The rule
 * is worth a test because both are the sort of value that looks harmless to set
 * from a second place: a UI that needs to render a collection, a repository that
 * defaults a column, a migration that backfills.
 *
 * The one that would actually hurt is `reversibility`. It decides whether a
 * person is offered a verdict at all, so a second writer is a second answer to
 * *"can this still be undone"*, and the two would drift in the direction that
 * silently costs somebody an accept button — or worse, offers one over something
 * that already left the building.
 *
 * ── The switch is exhaustive, and that is the point of the switch ────────
 *
 * Five production shapes, five branches, no `default`. A sixth shape is a type
 * error here rather than a silent no-op, which is the same property
 * `perform()` in the worker loop maintains at the other end. Both matter for the
 * same reason: the failure mode of a partially-wired capability is not a crash,
 * it is work that quietly does not arrive, and green tests all the way down.
 *
 * ── Dropped, and counted ─────────────────────────────────────────────────
 *
 * There is deliberately no `other` kind, so a production that cannot be realised
 * is dropped. Every drop is counted and returned. The count is the evidence that
 * the closed set is wrong — a silent drop is not evidence of anything, and a run
 * whose work vanished with nothing said is the exact failure this codebase keeps
 * finding in its own history.
 */

import type { AppContext } from '../db'
import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { ShiftOutcomeKind } from '../../domain/execution/shift-outcome'
import { LANDING_ACTION_KINDS } from '../../domain/handoff/policy'
import type { ActionKind } from '../../domain/handoff/policy'
import type { JsonObject } from '../../persistence/repositories/index'
import type { Workspace } from './workspace'

import { documentChanges } from './document-changes'
import { collection } from './collection'
import { answers } from './answer'
import { messageDrafts } from './message-draft'
import { externalEffects } from './external-effect'

/**
 * Everything about one outcome EXCEPT what it is.
 *
 * The per-kind writers return this. They compose the prose, intersect the
 * citations and shape the payload; they do not name the kind and they do not
 * decide whether it can be undone. That separation is the whole reason the grep
 * in `tests/architecture.test.ts` can be a grep.
 */
export interface OutcomeBody {
  readonly headline: string
  readonly reason: string
  /** Already intersected against this run's completed intents by the writer. */
  readonly citedActionIntentIds: readonly string[]
  readonly detail: JsonObject
}

/** A body, plus anything that has to happen once the row has an id — today only
 *  the `Changeset` that hangs off a `document-changes` outcome. */
export interface Production {
  readonly body: OutcomeBody
  readonly attach?: ((ctx: AppContext, outcomeId: string) => Promise<void>) | undefined
}

export interface RecordOutcomesInput {
  readonly run: { readonly id: string }
  readonly contract: { readonly id: string }
  readonly workspace: Workspace
  readonly produced: readonly OutcomeProposal[]
}

export interface RecordedOutcomes {
  /** The ids of every outcome a person may still decide about. `review()` runs
   *  when there is at least one; a `landed` outcome is not among them, because
   *  there is nothing left to advise on. */
  readonly heldOutcomeIds: readonly string[]
  readonly written: number
  /** Productions that matched no realisable kind. See the header. */
  readonly dropped: number
}

/**
 * Write one run's productions.
 *
 * Never throws for a production it cannot realise — that is a drop, and drops
 * are counted. It can still throw on a database failure, and the caller treats
 * that as it treats any other write failure.
 */
export async function recordOutcomes(
  ctx: AppContext,
  input: RecordOutcomesInput,
): Promise<RecordedOutcomes> {
  const { citable, landed } = await ledgerFacts(ctx, input.run.id)

  /**
   * Bucketed before anything is written, because two of the five kinds group.
   *
   * A `for` over the productions writing as it goes would produce one
   * `document-changes` outcome per drafted section, and the decidable unit for a
   * document is a `ProposedChange` rather than a section — so the grouping is
   * not an optimisation, it is what keeps the changeset the single thing the
   * review fold reads.
   */
  const sectionProse: Array<Extract<OutcomeProposal, { kind: 'section-prose' }>> = []
  const items: Array<Extract<OutcomeProposal, { kind: 'item' }>> = []
  const writtenAnswers: Array<Extract<OutcomeProposal, { kind: 'written-answer' }>> = []
  const composed: Array<Extract<OutcomeProposal, { kind: 'composed-text' }>> = []
  const landings: Array<Extract<OutcomeProposal, { kind: 'landed' }>> = []

  for (const production of input.produced) {
    switch (production.kind) {
      case 'section-prose':
        sectionProse.push(production)
        break
      case 'item':
        items.push(production)
        break
      case 'written-answer':
        writtenAnswers.push(production)
        break
      case 'composed-text':
        composed.push(production)
        break
      case 'landed':
        landings.push(production)
        break
    }
  }

  /**
   * Kind and reversibility, assigned here and only here.
   *
   * Reversibility is `held` for four of the five by construction: nothing left
   * Propositum, so the person's accept or reject still decides. `external-effect`
   * is `landed`, and its writer has already refused every production the LEDGER
   * does not corroborate — so this line is not trusting a kind, it is naming
   * what survived a check made against rows the gate authorised.
   */
  const planned: Array<{ kind: ShiftOutcomeKind; reversibility: 'held' | 'landed'; production: Production }> = []

  const document = documentChanges(
    sectionProse,
    input.workspace.base,
    input.workspace.documentTitle,
    input.contract.id,
    citable,
  )
  if (document) planned.push({ kind: 'document-changes', reversibility: 'held', production: document })

  const collected = collection(items, citable)
  if (collected) planned.push({ kind: 'collection', reversibility: 'held', production: collected })

  for (const production of answers(writtenAnswers, citable)) {
    planned.push({ kind: 'answer', reversibility: 'held', production })
  }

  for (const production of messageDrafts(composed, citable)) {
    planned.push({ kind: 'message-draft', reversibility: 'held', production })
  }

  for (const production of externalEffects(landings, landed)) {
    planned.push({ kind: 'external-effect', reversibility: 'landed', production })
  }

  // Every production that did not become part of a planned outcome. Counted as
  // productions rather than as outcomes, because "eleven items were dropped" is
  // the number that tells you the set is wrong; "one collection was dropped"
  // hides ten of them.
  const dropped = input.produced.length - realised(planned, input.produced)

  if (planned.length === 0) {
    // CONTEXT.md's rule, generalised from the empty changeset: a run with no
    // completed work writes NO row, and the shift report says so in words.
    return { heldOutcomeIds: [], written: 0, dropped }
  }

  const rows = await ctx.repos.outcomes.create({
    runId: input.run.id,
    outcomes: planned.map((entry) => ({
      kind: entry.kind,
      reversibility: entry.reversibility,
      headline: entry.production.body.headline,
      reason: entry.production.body.reason,
      citedActionIntentIds: entry.production.body.citedActionIntentIds,
      detail: entry.production.body.detail,
    })),
  })

  const heldOutcomeIds: string[] = []
  for (const [index, entry] of planned.entries()) {
    const row = rows[index]
    if (!row) continue
    if (entry.reversibility === 'held') heldOutcomeIds.push(row.id)
    await entry.production.attach?.(ctx, row.id)
  }

  return { heldOutcomeIds, written: rows.length, dropped }
}

/**
 * How many of the run's productions actually made it into a row.
 *
 * Computed by re-counting what each planned outcome consumed rather than by a
 * flag on the production, because a flag would be a second place for the same
 * fact and the two would disagree on exactly the case that matters: a
 * `document-changes` outcome whose diff came out empty consumed nothing, even
 * though its writer was handed six drafted sections.
 */
function realised(
  planned: ReadonlyArray<{ kind: ShiftOutcomeKind }>,
  produced: readonly OutcomeProposal[],
): number {
  const kinds = new Set(planned.map((entry) => entry.kind))
  let count = 0

  for (const production of produced) {
    switch (production.kind) {
      case 'section-prose':
        if (kinds.has('document-changes')) count += 1
        break
      case 'item':
        if (kinds.has('collection')) count += 1
        break
      case 'written-answer':
        if (kinds.has('answer')) count += 1
        break
      case 'composed-text':
        if (kinds.has('message-draft')) count += 1
        break
      case 'landed':
        if (kinds.has('external-effect')) count += 1
        break
    }
  }

  return count
}

/**
 * The two things about a run that only its own ledger can say.
 *
 * `citable` is the set of `ActionIntent` ids THIS RUN authorised and completed.
 * `landed` is the subset of those whose kind leaves Propositum. Both are read
 * off durable rows the gate already passed, which is what makes the provenance
 * chain a join rather than a claim.
 */
async function ledgerFacts(
  ctx: AppContext,
  runId: string,
): Promise<{ citable: ReadonlySet<string>; landed: ReadonlySet<string> }> {
  const rows = await ctx.db.prisma.actionIntent.findMany({
    where: { runId, authorized: true, outcome: { is: { result: 'succeeded' } } },
    select: { id: true, kind: true },
  })

  const citable = new Set<string>()
  const landed = new Set<string>()

  for (const row of rows) {
    citable.add(row.id)
    if (LANDING_ACTION_KINDS.has(row.kind as ActionKind)) landed.add(row.id)
  }

  return { citable, landed }
}
