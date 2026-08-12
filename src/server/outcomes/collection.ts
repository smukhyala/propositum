/**
 * `item` productions become one collection.
 *
 * ── One outcome for many items, and why that is not a shortcut ───────────
 *
 * Eleven shipping rates are one thing a person came back to, not eleven things.
 * The re-entry screen has a minute; a list of eleven separate outcomes each
 * headlined "a rate" is the shape that makes someone press Accept all, which is
 * the exact failure the whole re-entry design exists to avoid.
 *
 * The items stay individually decidable — that is what CONTEXT.md's
 * `OutcomeProposal` table is for, once it exists. Until then they ride in
 * `detail`, and the honest reading of that is: the grouping is right and the
 * per-item verdict is owed. `OutcomeVerdict` currently addresses the whole
 * outcome, so accepting a collection today accepts all of it.
 *
 * ── The fields are the model's words and stay untrusted ──────────────────
 *
 * `label` and `fields` came back from a tool that read a page. They are stored
 * as data, rendered as data, and never re-enter a prompt without datamarking —
 * the same rule every other page-derived string in this system follows.
 */

import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { OutcomeBody, Production } from './index'

type Item = Extract<OutcomeProposal, { kind: 'item' }>

/** The item's fields as one readable line. Insertion order is the worker's, and
 *  it is kept — a rate sheet reads in the order it was read off the page. */
function lineOf(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' · ')
}

export function collection(
  productions: readonly Item[],
  citable: ReadonlySet<string>,
): Production | null {
  if (productions.length === 0) return null

  const cited = productions.map((p) => p.intentId).filter((id) => citable.has(id))

  const body: OutcomeBody = {
    headline: `${productions.length} ${productions.length === 1 ? 'thing' : 'things'} collected`,
    reason: 'Found and kept while you were away.',
    citedActionIntentIds: cited,
    // `items`, with each entry carrying `label` and `body` — the keys
    // `readOutcomeDetail` in `src/domain/outcome/shift-outcome.ts` reads. The
    // fields are flattened into one line here rather than left as a nested
    // record, because the reader renders an item as a line and a record it
    // cannot flatten would render as the label with the numbers silently gone.
    detail: {
      items: productions.map((p) => ({ label: p.label, body: lineOf(p.fields) })),
    },
  }

  return { body, consumed: productions.length }
}
