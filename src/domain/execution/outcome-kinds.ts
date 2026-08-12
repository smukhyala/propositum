/**
 * What a shift can produce, as five closed kinds.
 *
 * Slice 0's sentence was "the run produced a Changeset", which was true while
 * the only thing a run could do was draft prose. It stops being true the moment
 * a run can collect, answer, address or act, and ADR-0009's generalisation is a
 * statement of what KIND of thing this run produced.
 *
 * ── Why there is no `other` ──────────────────────────────────────────────
 *
 * An `other` kind is a free-text field wearing an enum's clothes. Every
 * consumer would need a fallback branch, and the fallback branch is exactly
 * where a landed effect gets rendered as a reviewable proposal — the one
 * rendering error in this design that lies to somebody about whether the thing
 * has already happened.
 *
 * `answer`, not `finding`: `ReviewFinding` owns "finding", and two things
 * called a finding whose authorship differs is the collision CONTEXT.md spends
 * a paragraph on.
 *
 * ── This is a statement about a RESULT, never a grant ────────────────────
 *
 * A kind says what shape the work would come back in. It authorises nothing,
 * and nothing downstream reads it to widen what may be touched — CONTEXT.md §3
 * still says a model may not propose `allowedActionKinds` at all, and this list
 * exists precisely so that an offer can describe its output without going
 * anywhere near that sentence.
 *
 * Adding a member is a schema change plus a migration, never configuration. It
 * should feel heavy; if a sixth is reached for twice, the kinds are wrong
 * rather than incomplete.
 */

export const SHIFT_OUTCOME_KINDS = [
  /** A Changeset of ProposedChanges against an immutable BaseVersion. */
  'document-changes',
  /** Things found and kept — rates, candidates, quotations — decidable one at a time. */
  'collection',
  /** A written response to a question, citing the actions that support it. */
  'answer',
  /** Text addressed to somebody, written and NOT sent. */
  'message-draft',
  /** Something that happened out there: a form submitted, a reply sent. */
  'external-effect',
] as const

export type ShiftOutcomeKind = (typeof SHIFT_OUTCOME_KINDS)[number]

/**
 * The five kinds as one line each, in the words a person would use.
 *
 * Handed to the offer boundary as `producible` so that the model composes an
 * offer Propositum can actually keep. A model asked to propose work with no
 * statement of what the machine can make will cheerfully offer to phone
 * somebody, and the person then declines an offer that was never on the table —
 * which teaches them the feature guesses, when in fact nobody had told it.
 */
export const PRODUCIBLE: readonly string[] = [
  'changes to a document you already have, held for you to accept or reject one at a time',
  'a collection of things found and kept, decidable one at a time',
  'a written answer to a question, citing what was read to support it',
  'a message written for somebody and left unsent',
  'something done out on a page — a form filled in, a reply sent — which cannot be taken back',
]
