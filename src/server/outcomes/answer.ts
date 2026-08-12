/**
 * `written-answer` productions become answers, one each.
 *
 * ── `answer`, not `finding` ──────────────────────────────────────────────
 *
 * `ReviewFinding` owns the word "finding", and two things called a finding whose
 * authorship differs — one written by the worker about the work, one written by
 * the reviewer about the worker — is the collision CONTEXT.md spends a paragraph
 * refusing. The rename is not cosmetic: the two are shown on the same screen,
 * beside each other.
 *
 * ── One outcome per answer, unlike a collection ──────────────────────────
 *
 * Two answers to two questions are two things a person decides about
 * separately — accepting one says nothing about the other. Grouping them would
 * make the accept control mean "both", which is the same mistake as a Reject
 * button on something already sent, one size down.
 *
 * ── Citations are intersected, never trusted ─────────────────────────────
 *
 * The provenance chain closes as a JOIN and not as a claim. An answer arrives
 * carrying the `ActionIntent` it rests on; that id is checked against the
 * COMPLETED intents OF THIS RUN, and an id that is not among them is DROPPED —
 * not rejected, not recorded as suspicious, not stored with a flag. What
 * survives is intersection.
 *
 * The case that matters is not a hostile one, though it covers that too. It is
 * an id from ANOTHER run: a worker that has seen a previous shift's ledger, or a
 * retry that reused a stale reference. Storing it would make the provenance walk
 * — `ShiftOutcome → AgentRun → HandoffContract` — arrive at a contract nobody
 * ratified for this work, and every hop after that reads as sound.
 *
 * An answer whose every citation is dropped is still stored. It is a worse
 * answer and the person should see it, uncited, rather than not see it at all —
 * the alternative silently deletes work over a provenance detail nobody asked
 * about.
 */

import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { OutcomeBody, Production } from './index'

type WrittenAnswer = Extract<OutcomeProposal, { kind: 'written-answer' }>

/** The first sentence, or the first hundred characters if there is no full
 *  stop. Code-composed from the answer's own text, so the headline cannot say
 *  something the body does not. */
function opening(text: string): string {
  const trimmed = text.trim()
  const stop = trimmed.indexOf('. ')
  const first = stop === -1 ? trimmed : trimmed.slice(0, stop + 1)
  return first.length > 120 ? `${first.slice(0, 117)}…` : first
}

export function answers(
  productions: readonly WrittenAnswer[],
  citable: ReadonlySet<string>,
): Production[] {
  return productions.map((production) => {
    const cited = citable.has(production.intentId) ? [production.intentId] : []

    const body: OutcomeBody = {
      headline: opening(production.text) || 'An answer',
      reason: 'Worked out while you were away.',
      citedActionIntentIds: cited,
      // `body` — the key `readOutcomeDetail` reads first for an answer.
      detail: { body: production.text },
    }

    return { body, consumed: 1 }
  })
}
