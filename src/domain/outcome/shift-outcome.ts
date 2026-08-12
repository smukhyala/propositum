/**
 * What a Shift produced, as the closed sets the interface has to render.
 *
 * ── Why the reader is here and not in the screen that uses it ─────────────
 *
 * `ShiftOutcome.kind`, `ShiftOutcome.reversibility` and `ShiftOutcome.detail`
 * come out of the database as `string`, `string` and `Json`. Three places now
 * need to make sense of them — the re-entry screen, the card that renders one,
 * and the server action that decides whether a verdict may be recorded — and
 * three private opinions about what `landed` means is precisely how one of them
 * ends up offering a Reject button over a sent message.
 *
 * So the narrowing lives in one file, it is pure, and it fails in the safe
 * direction every time.
 *
 * ── The fail directions, stated, because they are the whole point ────────
 *
 * **An unrecognised `reversibility` is treated as `landed`.** ADR-0009 and
 * PRODUCT_PRINCIPLES §9 both say the same thing in different words: the one
 * rendering error in this design that lies to somebody is a landed effect drawn
 * as a reviewable proposal. A row whose reversibility is a value this code has
 * never heard of is a row we know nothing about, and the honest thing to do
 * with a thing we know nothing about is to report it rather than offer to undo
 * it.
 *
 * So the only question anyone may ask about reversibility is `isDecidable`,
 * which answers it as `=== 'held'`. There is deliberately no function that
 * narrows the column to a two-member union: such a function has three possible
 * answers, and the third — "I do not recognise this" — is the one a caller
 * forgets to handle, at which point the unrecognised row falls into whichever
 * branch was written first. One question, one boolean, deny by default.
 *
 * **An unrecognised `kind` stays decidable.** This is the opposite direction
 * and it is deliberate, because the failure is the opposite. `kind` chooses the
 * words and the shape of the body; it does not choose whether a person may
 * decide. If an unknown kind lost its controls, a `held` outcome would sit
 * undecidable forever and `finishShift` — which refuses while any `held`
 * outcome is undecided — would never let the person finish. Stranding somebody
 * inside their own review is a worse failure than a card with generic wording,
 * and the generic wording is still true.
 *
 * ── Why `detail` is read tolerantly ──────────────────────────────────────
 *
 * `detail` is a kind-shaped payload written by the run path, and the schema
 * calls it canonical JSON without fixing the keys per kind. A reader that threw
 * on an unexpected shape would take the whole re-entry screen down over a
 * payload nobody can see, which is the one screen that has to survive
 * everything — it is what a person comes back to when a run went badly. So
 * every field here is optional, absence is normal, and a card with nothing but
 * a headline and a reason is a supported rendering rather than a degraded one.
 */

export const SHIFT_OUTCOME_KINDS = [
  'document-changes',
  'collection',
  'answer',
  'message-draft',
  'external-effect',
] as const

export type ShiftOutcomeKind = (typeof SHIFT_OUTCOME_KINDS)[number]

/** The stored kind, or `null` when it is outside the closed set. */
export function asShiftOutcomeKind(raw: string): ShiftOutcomeKind | null {
  return (SHIFT_OUTCOME_KINDS as readonly string[]).includes(raw) ? (raw as ShiftOutcomeKind) : null
}

/**
 * May a person be offered a decision on this outcome at all?
 *
 * Written as `=== 'held'` rather than `!== 'landed'` so that a value nobody has
 * seen before is reported rather than reviewed. Deny by default, in the one
 * place where the default matters most.
 */
export function isDecidable(reversibility: string): boolean {
  return reversibility === 'held'
}

/**
 * What a `ShiftOutcome.detail` holds, once it has been read defensively.
 *
 * Every field is nullable or empty-able. Nothing here is required, because the
 * screen has to render a row whose payload is missing, half-written, or of a
 * shape written after this file was.
 */
export interface OutcomeDetail {
  /** A `collection`'s items, as lines. One decidable set, not one row each —
   *  the verdict is over the whole outcome. */
  readonly items: readonly string[]
  /** The text of an `answer` or a `message-draft`. */
  readonly body: string | null
  /** Who a `message-draft` is addressed to. Never a send target — nothing in
   *  this product sends anything, and this is a label on a piece of text. */
  readonly addressedTo: string | null
  /** Where an `external-effect` landed, in the words a person would use. */
  readonly where: string | null
  /**
   * What the person can do about an effect that already happened.
   *
   * In WORDS, always. There is no control here and there must not be one: the
   * effect is outside Propositum, so anything that offered to reverse it would
   * be claiming a capability the product does not have.
   */
  readonly whatYouCanDo: string | null
}

const EMPTY: OutcomeDetail = {
  items: [],
  body: null,
  addressedTo: null,
  where: null,
  whatYouCanDo: null,
}

/**
 * One JSON scalar, as something a person can read.
 *
 * Numbers and booleans are kept rather than discarded, and that is the whole
 * reason this is a function. A collected rate is as likely to arrive as
 * `{ label: 'Fabrikam', value: 3.95 }` as it is to arrive as a sentence, and a
 * reader that took only strings would show the carrier's name with the price
 * silently gone — or, for a bare array of numbers, an empty list. An empty list
 * is indistinguishable from "it collected nothing", which is a different
 * sentence and a much worse one.
 */
function scalarText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return String(value)
  return null
}

function textAt(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const text = scalarText(source[key])
    if (text !== null) return text
  }
  return null
}

/**
 * One item of a `collection`, as a line.
 *
 * Objects are flattened rather than rejected, for the same reason `scalarText`
 * keeps numbers: a collected rate is plausibly `{ label, value }` and plausibly
 * a bare string, and a reader that accepted only one of those would render an
 * empty list for the other.
 */
function itemLine(value: unknown): string | null {
  const scalar = scalarText(value)
  if (scalar !== null) return scalar
  if (typeof value !== 'object' || value === null) return null

  const record = value as Record<string, unknown>
  const label = textAt(record, ['label', 'title', 'name'])
  const body = textAt(record, ['body', 'text', 'value', 'detail'])

  if (label && body) return `${label} — ${body}`
  return label ?? body
}

export function readOutcomeDetail(raw: unknown): OutcomeDetail {
  if (typeof raw !== 'object' || raw === null) return EMPTY
  const record = raw as Record<string, unknown>

  const rawItems = record['items']
  const items: string[] = []
  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      const line = itemLine(entry)
      if (line !== null) items.push(line)
    }
  }

  return {
    items,
    body: textAt(record, ['body', 'text']),
    addressedTo: textAt(record, ['addressedTo', 'to']),
    where: textAt(record, ['where', 'site']),
    whatYouCanDo: textAt(record, ['whatYouCanDo']),
  }
}
