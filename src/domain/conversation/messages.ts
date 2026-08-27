/**
 * What Propositum may say on a paired message channel, and nothing else.
 *
 * ADR-0021. This file is the message set, as data rather than as scattered
 * template literals, for the same reason `STOP_RULES` is data: so it can be
 * rendered, counted, tested exhaustively, and read by somebody deciding whether
 * the product is talking too much.
 *
 * ── Three rules, and they are the whole of the safety argument ────────────
 *
 * 1. **No model composes a message.** Every member is a template over durable
 *    rows. Where a message carries model prose — an offer's `rationale`, a
 *    shift's `headline` — it QUOTES a stored row and does not generate a
 *    phone-shaped variant of one. ADR-0019 already refused "a shorter
 *    model-written summary" of the agreement on Principle 8; a message is read
 *    on a lock screen, one-handed, in a queue, so the argument is stronger here
 *    and not weaker.
 *
 * 2. **Every member carries a decision.** Principle 13 forbids "a notification
 *    with no decision attached to it" and names notifications as the first
 *    place that rule erodes, "because a notification is the cheapest thing to
 *    add and the hardest to attribute". `decision` below is a required field,
 *    so a member with nothing attached does not compile.
 *
 * 3. **Nothing that crossed `Datamarked` may leave the machine.** No
 *    page-authored text, no quotation, no accessible name, no tab title, no
 *    typed text, no screenshot, no URL but a loopback deep link. This is the
 *    trust boundary extended one hop, and `tests/thread-scope.test.ts` greps
 *    for it — which catches a field named after page text and does not catch a
 *    field that merely holds some. The union being small enough to read in one
 *    sitting is the other half of the mechanism, and a union that outgrows that
 *    has stopped being one.
 *
 * ── What this file deliberately does NOT cover ────────────────────────────
 *
 * It does not decide WHEN to say anything — that reads rows and belongs to
 * `src/server/thread.ts`. It does not send — that is a transport and lives in
 * `src/runtime/`. It holds no clock and no `fetch`, and
 * `tests/architecture.test.ts` greps `src/domain/**` for both.
 *
 * It also does not model the person's reply. Inbound is `./reply.ts`, and the
 * two are separate files because outbound is ours and inbound is untrusted, and
 * a single module handling both invites a helper that forgets which is which.
 */

/**
 * The five things Propositum may say. A closed set.
 *
 * A sixth member is a diff to this union, to `THREAD_MESSAGES` below, and to
 * `tests/conversation.test.ts` — which is the point of writing it here rather
 * than discovering it in a template.
 */
export type ThreadMessageKind =
  | 'offer'
  | 'confirmation-raised'
  | 'decision-raised'
  | 'run-ended'
  | 'capture-gap'

/**
 * What the person can do about a message.
 *
 * `reply-yes-or-not-now` and `reply-prose` accept an answer in the thread.
 * `open-only` does not, and it is not a lesser member: a confirmation carries
 * `open-only` because ADR-0021 refuses to let one be answered by reply, quoting
 * the endpoint built to make it impossible — "a channel that could carry the
 * approval would make that button one line of code away forever."
 *
 * There is no `none`. A message with nothing attached is the thing Principle 13
 * forbids, and the absence of the member is how that is enforced.
 */
export type ThreadDecision = 'reply-yes-or-not-now' | 'reply-prose' | 'open-only'

export interface ThreadMessageShape {
  readonly kind: ThreadMessageKind
  readonly decision: ThreadDecision
  /**
   * Whether this message carries a loopback deep link.
   *
   * Always true for `open-only`, because a message a person can only act on
   * elsewhere and does not say where is a dead end.
   */
  readonly deepLinks: boolean
}

/** The complete set. Exhaustive by construction — `Record` over the union. */
export const THREAD_MESSAGES: Readonly<Record<ThreadMessageKind, ThreadMessageShape>> = {
  /**
   * The ambient detector composed an offer and no session is running.
   *
   * The one message that arrives unprompted about work nobody asked to be
   * watched, so it is also the one that lands in ADR-0015's offers-per-hour
   * denominator. If it did not count there, the only number built to notice
   * this channel getting louder would be measuring the quieter surface and
   * reporting it as the whole.
   */
  offer: { kind: 'offer', decision: 'reply-yes-or-not-now', deepLinks: true },

  /**
   * A run stopped and is waiting on a person, for up to
   * `CONFIRMATION_EXPIRY_HOURS`.
   *
   * `open-only`, and the sentence below carries no verb, because the extension
   * already learned the sharper version of this rule: its notification has ONE
   * button, "Show me", and deliberately not even a "Don't" — "a two-button
   * notification teaches the hand to answer these without reading, and the hand
   * does not distinguish which of the two buttons it learned on."
   */
  'confirmation-raised': {
    kind: 'confirmation-raised',
    decision: 'open-only',
    deepLinks: true,
  },

  /**
   * The worker declined a judgment call, and the run has ended.
   *
   * The only member that takes prose back, because an answer to a decision
   * grants nothing, widens nothing and reverses nothing (ADR-0022). It is a
   * fact the worker did not have, on the same footing as `guidance`.
   *
   * It arrives at run end rather than at the moment the question was raised,
   * because `DecisionNeeded` rows hang off `ShiftReport` and the report is
   * written when the run finishes. That is correct today and would not be if a
   * stopped run could be resumed.
   */
  'decision-raised': { kind: 'decision-raised', decision: 'reply-prose', deepLinks: true },

  /**
   * The run reached a terminal status.
   *
   * Carries the stop rule's `consumerLabel` verbatim — every one of which
   * already starts with "I " and is asserted to by test, so this channel
   * inherits the house voice rather than inventing a second one.
   *
   * `open-only` is not "no decision". The decision is to go and review, which is
   * `finishShift`'s whole subject and cannot happen in a thread: ADR-0019 pins
   * per-change Accept/Reject as per-change, and a bulk accept would change what
   * H2 measures on a hypothesis nobody has scored.
   */
  'run-ended': { kind: 'run-ended', decision: 'open-only', deepLinks: true },

  /**
   * Capture stopped while the person was away.
   *
   * Principle 11 forbids rendering a `CaptureGap` as anything other than "I
   * stopped seeing your work", so this message has exactly one sentence and it
   * is that one.
   */
  'capture-gap': { kind: 'capture-gap', decision: 'open-only', deepLinks: true },
} as const

/** Every kind, in the order they can occur across one Shift. */
export const THREAD_MESSAGE_KINDS: readonly ThreadMessageKind[] = [
  'offer',
  'confirmation-raised',
  'decision-raised',
  'run-ended',
  'capture-gap',
]

/**
 * A rendered message, ready for a transport.
 *
 * `text` is the whole message. There is no title/body split and no formatting
 * union, because every transport this could reach renders plain text and the
 * two that do more — Telegram's entities, iMessage's tapbacks — would each want
 * a different shape. A transport may decorate what it is given; it may not be
 * handed a structure it has to interpret.
 *
 * `key` is the idempotency marker. The extension's notification path learned
 * this first — keyed on request id so it fires once — and a restart that
 * re-announces an offer somebody already declined is the same defect one
 * process out.
 */
export interface RenderedMessage {
  readonly kind: ThreadMessageKind
  readonly decision: ThreadDecision
  readonly key: string
  readonly text: string
}

/** Facts for the offer message. All rows, no page text. */
export interface OfferFacts {
  readonly threadSignature: string
  /** The composed offer's title. A stored row, not generated here. */
  readonly title: string
  /** The composed offer's rationale. Model prose, quoted from its row. */
  readonly rationale: string
  /** The outline. ADR-0019 forbids folding it, so it is not summarised here. */
  readonly outline: readonly string[]
  /** What it will not do. ADR-0019 forbids folding this too. */
  readonly willNotDo: readonly string[]
  readonly baseUrl: string
}

/** Facts for the confirmation message. Code-generated only. */
export interface ConfirmationFacts {
  readonly requestId: string
  readonly contractId: string
  /**
   * The sentence `confirmationQuestion()` built from attested facts.
   *
   * Quoted, never rebuilt. That function deliberately omits the text about to
   * be typed, the element's accessible name and the HTTP method; rebuilding the
   * sentence here would be a second place those decisions could drift.
   */
  readonly question: string
  readonly baseUrl: string
}

/** Facts for one raised decision. */
export interface DecisionFacts {
  readonly decisionId: string
  readonly contractId: string
  readonly question: string
  readonly whyStopped: string
  readonly baseUrl: string
}

/** Facts for the end of a run. */
export interface RunEndedFacts {
  readonly contractId: string
  /** A stop rule's `consumerLabel`, or null when the run simply finished. */
  readonly stopLabel: string | null
  /** The shift's narrative line, quoted from its row. Null is a designed outcome. */
  readonly headline: string | null
  readonly changeCount: number
  readonly baseUrl: string
}

/** Facts for a gap in capture. */
export interface CaptureGapFacts {
  readonly contractId: string
  readonly baseUrl: string
}

/** A loopback deep link. The only URL shape that may leave the machine. */
const link = (baseUrl: string, path: string): string => `${baseUrl}${path}`

const bullets = (lines: readonly string[]): string =>
  lines.map((line) => `• ${line}`).join('\n')

export function offerMessage(facts: OfferFacts): RenderedMessage {
  /**
   * The outline and the "will not do" list are both present in full.
   *
   * ADR-0019 item 2 puts them on the closed list of things that may never be
   * folded, and a thread has no `<details>` — so the choice here is between
   * printing them and not sending this message at all. A message that named an
   * offer and hid what it excluded would be the offer screen with the guard
   * removed, arriving somewhere it is read faster.
   */
  const parts = [
    facts.title,
    '',
    facts.rationale,
    '',
    'What that means:',
    bullets(facts.outline),
    '',
    'What I will not do:',
    bullets(facts.willNotDo),
    '',
    `Reply yes and I will set it up — ${link(facts.baseUrl, `/start?thread=${encodeURIComponent(facts.threadSignature)}`)}`,
    'Reply not now and I will drop it.',
  ]
  return {
    kind: 'offer',
    decision: 'reply-yes-or-not-now',
    key: `offer:${facts.threadSignature}`,
    text: parts.join('\n'),
  }
}

export function confirmationMessage(facts: ConfirmationFacts): RenderedMessage {
  /**
   * No verb, deliberately.
   *
   * There is no "reply yes", no button and no shortcut, and the sentence says
   * why rather than leaving it to be discovered. A person who learns that this
   * message is the one they have to open is a person who opens it, and that is
   * the entire property being protected.
   */
  return {
    kind: 'confirmation-raised',
    decision: 'open-only',
    key: `confirmation:${facts.requestId}`,
    text: [
      'I stopped, and I need you to say yes to one thing.',
      '',
      facts.question,
      '',
      'I cannot take this answer here — you have to see what you are agreeing to first.',
      link(facts.baseUrl, `/shifts/${facts.contractId}/confirm/${facts.requestId}`),
    ].join('\n'),
  }
}

export function decisionMessage(facts: DecisionFacts): RenderedMessage {
  return {
    kind: 'decision-raised',
    decision: 'reply-prose',
    key: `decision:${facts.decisionId}`,
    text: [
      'I need a decision only you can make.',
      '',
      facts.question,
      '',
      facts.whyStopped,
      '',
      'Reply to this message and I will keep your answer with the note.',
      link(facts.baseUrl, `/shifts/${facts.contractId}`),
    ].join('\n'),
  }
}

export function runEndedMessage(facts: RunEndedFacts): RenderedMessage {
  /**
   * `stopLabel` first, because where it stopped is what a person reads for.
   *
   * A run that finished cleanly has no label, and this says "I finished" rather
   * than inventing one — Principle 11's "say the true thing, including when it
   * is unimpressive" applies to the boring ending as much as to the interesting
   * one.
   */
  const changes =
    facts.changeCount === 0
      ? 'Nothing to review.'
      : facts.changeCount === 1
        ? '1 change waiting on you.'
        : `${facts.changeCount} changes waiting on you.`

  return {
    kind: 'run-ended',
    decision: 'open-only',
    key: `report:${facts.contractId}`,
    text: [
      facts.stopLabel ?? 'I finished.',
      ...(facts.headline === null ? [] : ['', facts.headline]),
      '',
      changes,
      link(facts.baseUrl, `/shifts/${facts.contractId}`),
    ].join('\n'),
  }
}

export function captureGapMessage(facts: CaptureGapFacts): RenderedMessage {
  return {
    kind: 'capture-gap',
    decision: 'open-only',
    key: `gap:${facts.contractId}`,
    text: [
      'I stopped seeing your work.',
      '',
      link(facts.baseUrl, `/shifts/${facts.contractId}`),
    ].join('\n'),
  }
}
