/**
 * What goes first, when more than one kind of thing is competing. ADR-0036.
 *
 * ── This widens an ordering rather than introducing one ──────────────────
 *
 * `topics.ts` has sorted strands by `(searches, pages, engagedMs)` since
 * 2026-08-11 — *"a thread the person searched for outranks one they merely
 * passed through, then breadth, then time"* — and `front-door.ts` cuts that
 * ordered list after its filters. What was missing was never AN ordering. It
 * was one that could see more than one KIND of thing, which is
 * `docs/ARCHITECTURE.md` layer 4's *what would have to exist first*.
 *
 * ── Named facts in a fixed precedence, never a score ─────────────────────
 *
 * The direction document proposes `usefulness × confidence × urgency − cost`.
 * Nine of those terms are not data in this repository, and `CONTEXT.md`'s
 * `OfferGrounds` entry already retires the vocabulary a float would need —
 * *Displaces: score · threshold · readiness · DetectionConfidence*, on the
 * grounds that *"these are counts of deterministic facts, not a score"*.
 *
 * The practical half of that argument is falsifiability. A person who disagrees
 * with a lexicographic order can point at the key that decided it, and
 * `reasonFor` below returns exactly that sentence. A person who disagrees with
 * 0.83 can only disagree.
 *
 * ── Pure, total, clockless ───────────────────────────────────────────────
 *
 * `now` arrives as a parameter. `src/domain/**` may never read the clock and
 * `tests/architecture.test.ts` enforces it by grepping source text, comments
 * included — which is also what makes a replayed week and a lived one the same
 * input.
 *
 * ── What is deliberately NOT a candidate ─────────────────────────────────
 *
 * **An open wait.** ADR-0035 and ADR-0036 both described one as competing here,
 * and the build declined it; both are amended rather than quietly diverged
 * from. Two reasons, and the second is the one that changed the design:
 *
 * 1. **It carries no decision.** Principle 13 forbids *"a notification with no
 *    decision attached to it"*, and *you are still waiting* is not a decision.
 * 2. **It would hold a slot for ever.** A strand leaves the front door three
 *    ways — an origin snooze, a thread snooze, and reticence. A wait has none,
 *    and ADR-0035's cost section calls that the sharpest hole in the decision.
 *    Keeping open waits off this list closes it by construction rather than by
 *    a fourth suppression mechanism nobody has argued for.
 *
 * An open wait is a word on the project screen, where the person who wrote it
 * can change it or take it back. That is where it can be acted on.
 */

/** One thing that could go in front of a person, before anything is composed
 *  about it. Closed and code-owned; a third member is an ADR. */
export type Candidate =
  /** A thread of browsing the detector found. Ordered among its own kind by the
   *  three keys `topics.ts` has always used. */
  | {
      readonly kind: 'strand'
      readonly signature: string
      readonly searches: number
      readonly pages: number
      readonly engagedMs: number
    }
  /** A wait a person stated, which an `ExternalEvent` has discharged. The only
   *  wait shape that competes — see the docblock. */
  | {
      readonly kind: 'discharged-wait'
      readonly intentionId: string
      readonly statedWait: string
      readonly arrivedAtEpochMs: number
    }

/**
 * Precedence between kinds, argued rather than ordered by taste.
 *
 * A discharged wait outranks every strand, and it is the only cross-kind rule
 * here. The person **said** they were waiting on this, in their own words, and
 * something states that it arrived: that is the strongest evidence this system
 * can hold about what matters, because a person put half of it there
 * deliberately and neither half is inferred. A strand is Propositum noticing.
 *
 * The honest limit: this is a guess, in the same class as `INTENT_REQUIRED = 1`,
 * which ADR-0008 admits was *"set before any real browsing existed"*. Nothing
 * has measured whether a discharged wait is more useful than an afternoon of
 * comparison. It is written down as a guess rather than presented as a finding.
 */
const KIND_ORDER: Readonly<Record<Candidate['kind'], number>> = {
  'discharged-wait': 0,
  strand: 1,
}

/**
 * The comparator. Total, so `sort` is stable and a screen does not reshuffle
 * when nothing changed.
 *
 * Every step is a named fact. There is no weight, no sum and no product, and
 * the tie-breaker at the bottom is an identity rather than a coin toss —
 * without it two candidates equal on every key would order differently between
 * two renders of the same data.
 */
export function compareCandidates(a: Candidate, b: Candidate): number {
  const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  if (byKind !== 0) return byKind

  if (a.kind === 'discharged-wait' && b.kind === 'discharged-wait') {
    // The most recent arrival first: the thing that just happened is the thing
    // a person is likeliest to still have in mind.
    if (a.arrivedAtEpochMs !== b.arrivedAtEpochMs) return b.arrivedAtEpochMs - a.arrivedAtEpochMs
    return a.intentionId < b.intentionId ? -1 : a.intentionId > b.intentionId ? 1 : 0
  }

  if (a.kind === 'strand' && b.kind === 'strand') {
    // `topics.ts`'s three keys, unchanged and in the same order, because this
    // is that comparator widened rather than a second one.
    if (a.searches !== b.searches) return b.searches - a.searches
    if (a.pages !== b.pages) return b.pages - a.pages
    if (a.engagedMs !== b.engagedMs) return b.engagedMs - a.engagedMs
    return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0
  }

  return 0
}

/**
 * How long an arrival is news.
 *
 * ── Why this exists at all, which is a defect this module shipped with ───
 *
 * ADR-0035 named the hole and ADR-0036 claimed to close it: a strand leaves the
 * front door three ways — an origin snooze, a thread snooze, reticence — and a
 * wait had none, so a stale one would hold one of `MAX_THREADS_SHOWN`'s slots
 * for ever. Refusing OPEN waits closed half of it. **A discharged wait has the
 * same property and the first build did not notice**: `statedWait` is cleared
 * only by a person, the discharging `ExternalEvent` is on an append-only table
 * ~~with a no-DELETE guard and can never be removed~~ **nothing removes on the
 * passage of time** *(the guard went 2026-09-08,
 * [ADR-0038](../../../docs/adr/0038-deleting-a-project.md) — the row now goes
 * when the project does, which is a person deciding rather than a decay, so the
 * argument below is unchanged)*, and rank 0 is unconditional.
 * Three of them would have shown zero strands, for ever, and `reasonFor` would
 * have read *"it arrived earlier"* about something from March.
 *
 * So an arrival is a candidate for a week and then stops being one. Seven days
 * because the claim being made is *this is news* — a thing that arrived last
 * month is not, whatever else it is — and because a person who wanted it acted
 * on has had a week of Home saying so.
 *
 * **It is a decay, not a dismissal**, which is the shape `OfferReticence`
 * already uses for the same problem: nothing is deleted, the wait keeps its
 * words on the project screen where a person can still see and clear them, and
 * only its claim on the front door expires.
 */
export const ARRIVAL_IS_NEWS_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Whether this is still worth one of the person's three slots.
 *
 * `now` is a parameter, as everywhere in this module. A strand is always worth
 * saying if it got here — the detector's own thirty-minute window is what bounds
 * it, and re-bounding it here would be two places holding one limit.
 */
export function stillWorthSaying(candidate: Candidate, nowEpochMs: number): boolean {
  if (candidate.kind === 'strand') return true
  return nowEpochMs - candidate.arrivedAtEpochMs < ARRIVAL_IS_NEWS_MS
}

/** Ordered, without mutating the caller's array. */
export function orderCandidates(candidates: readonly Candidate[]): Candidate[] {
  return [...candidates].sort(compareCandidates)
}

/**
 * Why this one is here, in the words the key would use.
 *
 * The precedence IS the explanation, so this is not decoration: it is the half
 * of ADR-0036 that makes a lexicographic order worth having over a float. A
 * person can read the sentence and disagree with the fact in it.
 *
 * `now` is a parameter for the module's reason. Nothing here reads a clock.
 */
export function reasonFor(candidate: Candidate, nowEpochMs: number): string {
  if (candidate.kind === 'discharged-wait') {
    const minutes = Math.max(0, Math.round((nowEpochMs - candidate.arrivedAtEpochMs) / 60_000))
    const when =
      minutes < 1
        ? 'just now'
        : minutes === 1
          ? 'a minute ago'
          : minutes < 60
            ? `${minutes} minutes ago`
            : 'earlier'
    return `You said you were waiting on ${candidate.statedWait}, and it arrived ${when}.`
  }

  // Whichever key actually put it here, named. Searches first, because that is
  // the key the kind's own ordering leads with.
  if (candidate.searches > 0) {
    return `You searched for this, and read ${candidate.pages} pages about it.`
  }
  return `You read ${candidate.pages} pages about this.`
}
