/**
 * `composed-text` productions become message drafts, one each. Written and
 * **not** sent.
 *
 * ── The whole content of this file is the word "not" ─────────────────────
 *
 * A `message-draft` is `held`, always, and that is not a property this file
 * computes — it is a property of there being no capability that sends anything.
 * `src/policy/tools.ts` ships no code that composes an email, and
 * `tests/architecture.test.ts` asserts as much.
 *
 * The reason it still needs saying: the shapes are close enough to be confused.
 * A `composed-text` production and a `landed` production can both be a message
 * to somebody. The difference is whether it went, and the only thing that
 * decides that is which `ActionKind` produced it. A worker cannot move a
 * production from one to the other, because it does not assign either.
 *
 * ── `forWhat`, not `to` ──────────────────────────────────────────────────
 *
 * The production says what the text is FOR — "a reply to Northwind about the
 * rate" — and carries no address, no recipient field and no channel. There is
 * nowhere to put one, which is the same structural move ADR-0009 makes for the
 * offer schema and a URL: a model that wanted to name a recipient has nowhere to
 * write it down.
 */

import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { OutcomeBody, Production } from './index'

type ComposedText = Extract<OutcomeProposal, { kind: 'composed-text' }>

export function messageDrafts(
  productions: readonly ComposedText[],
  citable: ReadonlySet<string>,
): Production[] {
  return productions.map((production) => {
    const cited = citable.has(production.intentId) ? [production.intentId] : []

    const body: OutcomeBody = {
      headline: `${production.forWhat} — written, not sent`,
      reason: 'Drafted while you were away. Nothing was sent.',
      citedActionIntentIds: cited,
      // `addressedTo` and `body`, the keys `readOutcomeDetail` reads. Note what
      // `addressedTo` is NOT: a send target. It is a label on a piece of text —
      // the production carries no address, no channel and no recipient field,
      // and there is nowhere to put one.
      detail: { addressedTo: production.forWhat, body: production.text },
    }

    return { body, consumed: 1 }
  })
}
