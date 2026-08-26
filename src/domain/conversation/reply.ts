/**
 * What a person may say back, and what happens to everything else.
 *
 * ADR-0021 §5. Kept apart from `./messages.ts` because outbound is ours and
 * inbound is untrusted, and one module handling both invites a helper that
 * forgets which is which.
 *
 * ── The two properties this file exists to hold ───────────────────────────
 *
 * 1. **A reply is a verdict or a selection. It is never an observation.**
 *    `ObservationEvent.sessionId` is required and `ledger-writer.ts` is the
 *    single door every event enters by. ADR-0014 wrote down the consequence
 *    before there was anything to apply it to: "A connector is therefore not an
 *    integration job. It is a schema change plus a second writer, and the second
 *    writer is the thing that argument exists to forbid." Nothing here writes an
 *    event, so no second writer appears.
 *
 * 2. **Nothing here reaches a model.** `SECURITY_AND_PRIVACY.md` states the trap
 *    in one sentence — "An email that arrives at 3am is a model call at 3am
 *    unless something is designed first to prevent it." What prevents it is that
 *    a reply produces a row and nothing else. The next model call is the one the
 *    worker was going to make anyway, on the schedule it was already on.
 *
 * ── Why unrecognised is a member rather than a silence ────────────────────
 *
 * A channel that swallows what it cannot parse is a channel that APPEARS to have
 * been told something. Somebody who types "yeah go for it but only the first
 * one" has said something real and this parser cannot use it; the honest answer
 * is to say so and write nothing, not to guess at the half it recognises. The
 * cost is a person occasionally being told their sentence did not land, which is
 * strictly better than them believing it did.
 *
 * ── What this file deliberately does NOT do ───────────────────────────────
 *
 * It does not interpret prose. `answer-decision` carries the person's text
 * VERBATIM and this module makes no claim about what it means — that is the
 * whole reason ADR-0022 refused a decision-class taxonomy, quoting CONTEXT.md:
 * "'which partner tier to propose' is not plausibly enumerable in advance."
 *
 * It also does not decide whether a reply is ALLOWED. Whether the decision it
 * names is still open, whether an offer has expired, whether a confirmation is
 * being answered here when it may not be — all of that reads rows and belongs to
 * `src/server/thread.ts`. This module turns bytes into a shape.
 */

/**
 * Everything a reply may turn into. Closed.
 *
 * There is no member for a confirmation, and its absence is the enforcement.
 * ADR-0021 refuses to let a `ConfirmationVerdict` be given by reply, and the
 * strongest available version of that refusal is that this union has no shape a
 * confirmation answer could take — the same argument
 * `src/app/api/act/confirmation/route.ts` makes about having no POST.
 */
export type ThreadReply =
  /** Yes to the offer this thread most recently carried. */
  | { readonly kind: 'accept-offer' }
  /** Not now to the same. Declining is durable and decays — ADR-0020. */
  | { readonly kind: 'decline-offer' }
  /**
   * Prose in answer to one raised decision.
   *
   * `answer` is the person's own words, untouched. `repliedTo` is the transport's
   * identifier for the message being answered, which is how a reply is bound to
   * ONE decision rather than to whichever was most recent — the same problem the
   * confirmation path solves by matching an element's descriptor rather than its
   * ref, because "a page that re-rendered between the question and the answer
   * could otherwise move a yes about Track shipment onto whatever took its place".
   */
  | { readonly kind: 'answer-decision'; readonly answer: string; readonly repliedTo: string }
  /** Anything else. Writes nothing, and says so. */
  | { readonly kind: 'unrecognised' }

/**
 * Yes, in the forms a person actually types.
 *
 * Deliberately short. A generous matcher here would start accepting sentences
 * whose meaning it is guessing at, and the thing being accepted is permission to
 * start watching somebody's work.
 */
const YES = new Set(['yes', 'y', 'yeah', 'yep', 'ok', 'okay', 'go', 'go ahead', 'do it', 'sure'])

/** Not now, in the same spirit. */
const NO = new Set([
  'no',
  'n',
  'nope',
  'not now',
  'later',
  'no thanks',
  'no thank you',
  'nah',
  'stop',
])

/**
 * The message this reply was sent in response to, if the transport knows.
 *
 * Optional because not every channel has the concept. Where it is absent, a
 * prose reply cannot be bound to a decision and is `unrecognised` — which is the
 * correct answer, not a degradation: an answer attached to the wrong question is
 * worse than no answer, and this is the one field that distinguishes them.
 */
export interface InboundContext {
  /** The key of the message being replied to, or null. */
  readonly repliedTo: string | null
  /** Whether an offer is currently open on this thread. */
  readonly offerOpen: boolean
}

/**
 * Normalise for matching only. The stored answer is never this value.
 *
 * Trailing punctuation is stripped so "yes!" lands, and nothing else is touched:
 * a normaliser that collapsed whitespace or folded accents would be making
 * decisions about somebody's prose on the way to storing it verbatim.
 */
const forMatching = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[.!]+$/, '')

export function parseReply(raw: string, context: InboundContext): ThreadReply {
  const text = raw.trim()
  if (text === '') return { kind: 'unrecognised' }

  const matchable = forMatching(text)

  /**
   * A reply to a specific message wins over a bare yes/no, and that order
   * matters.
   *
   * Somebody answering the question "annual or monthly?" with the single word
   * "no" has answered THAT, not declined an offer that happens to still be open.
   * Reading the reply target first is what makes the answer land where the person
   * aimed it.
   */
  if (context.repliedTo !== null && context.repliedTo.startsWith('decision:')) {
    return { kind: 'answer-decision', answer: text, repliedTo: context.repliedTo }
  }

  if (context.offerOpen && YES.has(matchable)) return { kind: 'accept-offer' }
  if (context.offerOpen && NO.has(matchable)) return { kind: 'decline-offer' }

  return { kind: 'unrecognised' }
}

/**
 * What to send when nothing was recognised.
 *
 * One sentence, and it names what it did rather than apologising: "I didn't
 * follow that" tells somebody their message landed nowhere, which is the fact
 * they need. Principle 11's register — say the true thing, including when it is
 * unimpressive — applies to the software's own failures first.
 */
export const NOT_FOLLOWED =
  "I didn't follow that, so I have not written anything down. Reply to a question I asked, or open the note."
