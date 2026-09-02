/**
 * `landed` productions become external effects — the one kind that is not
 * `held`, ~~and the one kind nothing can currently produce~~ **and since
 * 2026-09-01 one kind can produce it: `complete-purchase` (ADR-0024)**.
 *
 * ── ~~It has no producing `ActionKind`~~ It has exactly one, and the check
 * below is what makes that a fact rather than a claim ──
 *
 * `LANDING_ACTION_KINDS` holds `complete-purchase`. Every other kind is still
 * a read or a draft: `draft-section` proposes text a person still has to
 * accept, and even `click-element` — which can press a page's own Send button
 * into a request the network refuses — is not a landing kind, because landing
 * is about whose act put the effect into the world, not about whether an
 * effect is possible.
 *
 * The DROP below stopped being this file's whole behaviour and became its
 * enforcement: a `landed` production whose intent is not a succeeded
 * `complete-purchase` in this run is still dropped, and the tool's own rule —
 * an ok report without the attested charge throws — is what makes `succeeded`
 * mean "the covered request left the machine". `tests/reachability.test.ts`
 * now pins the set's exact membership in its reachable section; the emptiness
 * pin did its job on the day this landed and was moved up, as its own text
 * instructed.
 *
 * ── Why a `landed` production is dropped unless the ledger agrees ────────
 *
 * A production says "this happened out there". Believing it would be letting a
 * model assign its own reversibility, which is granting — and the grant it makes
 * is the worst one available: an outcome marked `landed` is offered NO verdict,
 * so a model could remove the person's ability to reject its work by describing
 * the work as already done.
 *
 * The check is therefore the other way round. The producing `ActionIntent` must
 * be one this run completed AND its kind must be in `LANDING_ACTION_KINDS`.
 * Neither fact comes from the production. A `landed` production that fails
 * either is dropped and counted, because a claim about the world that the ledger
 * cannot corroborate is not a weaker outcome — it is a different one.
 *
 * ── And no verdict path ──────────────────────────────────────────────────
 *
 * Nothing here writes an `OutcomeVerdict` and nothing may. The interface reports
 * *"This already happened, outside Propositum"* and shows what happened. A
 * person who clicks Reject on a sent message and is told "rejected" has been
 * lied to by the one screen the entire trust model rests on.
 */

import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { OutcomeBody, Production } from './index'

type Landed = Extract<OutcomeProposal, { kind: 'landed' }>

export function externalEffects(
  productions: readonly Landed[],
  /** Intents this run completed whose kind is in `LANDING_ACTION_KINDS`. Empty
   *  today, by construction rather than by accident. */
  landed: ReadonlySet<string>,
): Production[] {
  const kept: Production[] = []

  for (const production of productions) {
    if (!landed.has(production.intentId)) continue

    const body: OutcomeBody = {
      headline: `${production.what} — ${production.where}`,
      reason: 'This happened while you were away, outside Propositum.',
      citedActionIntentIds: [production.intentId],
      /**
       * `where` and `whatYouCanDo`, the keys `readOutcomeDetail` reads.
       *
       * `whatYouCanDo` is WORDS and must stay words. The re-entry screen offers
       * no control here — the effect is outside Propositum, so anything that
       * offered to reverse it would be claiming a capability the product does
       * not have. The sentence points at the place the person would have to go,
       * which is the only true thing there is to say.
       */
      detail: {
        what: production.what,
        where: production.where,
        whatYouCanDo: `Propositum cannot undo this. If it needs reversing, that has to happen at ${production.where}.`,
      },
    }

    kept.push({ body, consumed: 1 })
  }

  return kept
}
