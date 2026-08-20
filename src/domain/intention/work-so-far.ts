/**
 * `WorkSoFar` — what has already happened under one Intention, folded.
 *
 * ── What this file is allowed to be ──────────────────────────────────────
 *
 * A **computed view**, never stored, on the precedent `EnforcedPolicy`, `Shift`,
 * `ActionStatus` and `IntentionState` all set: *two stores for one truth is
 * exactly how a UI comes to display something the gate cannot enforce.* Here the
 * argument is sharper than usual and [ADR-0017](../../../docs/adr/0017-continuing-an-intention.md)
 * says why: a STORED version of this is the thing ADR-0011 forbids, so
 * *computed* is not a preference about where state lives, it is **the property
 * that makes the design legal**. There is no `WorkSoFar` column and no
 * `WorkSoFar` table, and this ADR authorised no schema change of any kind.
 *
 * ── What it may never contain ────────────────────────────────────────────
 *
 * A model-written summary. An inferred objective. Anything from `SessionClaim`,
 * which stays per-sitting, model-inferred and cold every time. A prediction
 * about what comes next. Every member below folds a row **a person wrote,
 * approved, accepted or rejected**, which is what lets a durable statement of
 * prior work exist at all without reopening ADR-0011 — there is no path from a
 * model to this view and no field a model could write.
 *
 * The one row that comes close is `DecisionNeeded`, whose `question` a worker
 * model wrote. Only the COUNT of them crosses into this fold. The questions
 * themselves stay on the re-entry note where they were asked, with the run that
 * asked them and the evidence beside them — carrying the prose here would be
 * moving model text onto a screen that has none of that context, one paragraph
 * away from a claim that nothing here is model-written.
 *
 * ── It may inform a person; it may not inform a decision ─────────────────
 *
 * Same posture as `BusyInterval` under ADR-0014, and stated here as well as in
 * `CONTEXT.md` because this is the file somebody would wire. It does not reach
 * `compilePolicy`, it does not reach `src/policy/gate.ts`, and it is not in a
 * prompt. The moment it is interpolated into a boundary it stops being a display
 * and becomes context a model acts on, and every claim in ADR-0017's *Why this
 * does not reverse ADR-0011* has to be re-argued against prompt injection
 * reaching it through the rows it folds.
 *
 * ── Why the sentences are here and not in the two screens ────────────────
 *
 * Because SAYING is the whole feature. ADR-0017 opens by naming what already
 * carries forward — `carryOnCandidate` renders `{sittings: 3, sources: 5,
 * documents: 1, overlap: 0.7}` — and then names the gap: *"The gap is not that
 * nothing carries forward — it is that what carries forward is counted rather
 * than said. A person who spent three evenings on a trip is not helped by being
 * told there were three evenings."* A fold that returned only the numbers would
 * close none of that, and two screens each phrasing them would be two answers to
 * one question, which is the failure `front-door.ts` opens by refusing.
 *
 * The precedent for consumer wording living in the domain is `INTENTION_STATES`
 * one file over, and the reason is the same: the words are fixed by
 * `CONTEXT.md`, so they belong where a test can hold them rather than in a
 * `.tsx` nothing in this repository can render.
 *
 * ── Pure, total, and clockless ───────────────────────────────────────────
 *
 * `now` arrives as a parameter. `src/domain/**` may never read the clock — no
 * `Date.now`, no bare `new Date` — and `tests/architecture.test.ts` enforces
 * that by GREPPING SOURCE TEXT, comments included, which is why this sentence
 * names those two without writing either of them out.
 *
 * The input is a plain facts object the CALLER assembles from rows. The domain
 * layer does not know that Prisma exists, and this file names no table.
 */

import type { Verdict } from '../document/changeset'
import {
  KIND_IN_A_SENTENCE,
  SHIFT_OUTCOME_KINDS,
  asShiftOutcomeKind,
  isDecidable,
} from '../outcome/shift-outcome'
import type { ShiftOutcomeKind } from '../outcome/shift-outcome'

/** The consumer wording, fixed by `CONTEXT.md`. Both screens render this rather
 *  than each choosing a heading, and it is never the type name. */
export const WHERE_YOU_LEFT_OFF = 'Where you left off'

/** One `ShiftOutcome` under this Intention, as the row holds it. */
export interface StoredOutcome {
  /** `ShiftOutcome.kind`. A raw string, because the closed set belongs to
   *  `src/domain/outcome/shift-outcome.ts` and a row may hold a member written
   *  by a later version of this product. */
  readonly kind: string
  /** `ShiftOutcome.reversibility`. Also raw, and asked exactly one question —
   *  `isDecidable` — for the reason that file argues at length. */
  readonly reversibility: string
  /** The `OutcomeVerdict` a person wrote, or null while it is undecided. */
  readonly verdict: string | null
}

/** Where the last `AgentRun` under this Intention stopped. */
export interface StoppedAt {
  readonly status: string
  readonly terminalReason: string | null
}

/**
 * Everything the fold reads. All facts, no judgment, all durable.
 *
 * Each field names rows that already exist. Nothing here is inferred, nothing is
 * a model's opinion, and there is no field an inference could write.
 */
export interface WorkSoFarFacts {
  /**
   * One entry per `WorkSession` under this Intention: when a person ended it, in
   * epoch milliseconds, or **null while it is still open**.
   *
   * Null is carried rather than filtered because the two facts are different
   * sentences. Only a human act ends a sitting, so rounding an open one to
   * "ended today" would be the screen claiming somebody did something they have
   * not done.
   */
  readonly sittingsEndedAtEpochMs: readonly (number | null)[]
  /** `ApprovedSource`s on this Intention's Project that Chrome has actually
   *  granted. A withdrawn one is not something Propositum can see. */
  readonly approvedSources: number
  /** `Document`s on this Intention's Project. */
  readonly documents: number
  /** Every `ShiftOutcome` produced under this Intention, oldest or newest first
   *  — the fold does not depend on the order. */
  readonly produced: readonly StoredOutcome[]
  /**
   * One entry per `ProposedChange` under this Intention: the `ChangeVerdict` a
   * person wrote, or **null while it is undecided**.
   *
   * A change with no verdict row is undecided and is not applied by the fold
   * that materialises a document; the same rule is read here.
   */
  readonly changeVerdicts: readonly (string | null)[]
  /**
   * `DecisionNeeded` rows raised under this Intention that are still open —
   * **which is all of them, and the caller owns knowing that.**
   *
   * Nothing in the schema can close one: there is no answered, resolved or
   * verdict column, nothing deletes one, and the contract carrying it never
   * leaves `accepted`. `IntentionStateFacts.openDecisions` reports zero for
   * exactly that reason, and this field does not, because the two drive
   * different things. There, a non-zero count pins the lifecycle word
   * `needs-you` onto a Project permanently — a status word that is always on is
   * a status word nobody reads. Here it is one sentence in a paragraph a person
   * reads once before starting, and *a question was raised and nothing has
   * closed it* is simply true.
   */
  readonly openQuestions: number
  /**
   * The newest `AgentRun` under this Intention that has ended, or null when
   * Propositum has never held this work.
   *
   * A run still going is NOT reported here. This paragraph is about what a
   * person is coming back to; a live run is `IntentionState`'s job and it has
   * the word for it.
   */
  readonly lastStop: StoppedAt | null
}

/** How many of one kind were produced. Ordered by `SHIFT_OUTCOME_KINDS`, so two
 *  Intentions with the same work read the same way round. */
export interface ProducedCount {
  readonly kind: ShiftOutcomeKind
  readonly count: number
}

/** What a person decided about each decidable unit. */
export interface DecidedCounts {
  readonly accepted: number
  readonly rejected: number
  readonly edited: number
  readonly undecided: number
}

export interface WorkSoFar {
  /** Whether there is anything to render at all. False on a Project that has
   *  only just been created, which is the ordinary case and gets no box. */
  readonly anythingToSay: boolean
  readonly sittings: number
  /** Whole days between the newest ended sitting and `now`, or null when no
   *  sitting has been ended yet. Never negative. */
  readonly daysSinceLastSitting: number | null
  readonly approvedSources: number
  readonly documents: number
  readonly produced: readonly ProducedCount[]
  /** Outcomes whose `kind` is outside the closed set — reported rather than
   *  dropped, because a sentence that under-reports what Propositum has done is
   *  wrong in the direction a person cannot check. */
  readonly unrecognisedKinds: number
  readonly decided: DecidedCounts
  readonly openQuestions: number
  readonly stopped: StoppedAt | null
  /** What a person reads, in a fixed order. Empty when there is nothing to
   *  say. */
  readonly lines: readonly string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The fold.
 *
 * ── Order is part of the answer ──────────────────────────────────────────
 *
 * Where the work is, then what it has, then what came out of it, then what was
 * decided about that, then what is still owed, then where it stopped. It runs
 * oldest-fact-first because a person reading before they start is orienting, not
 * triaging — the opposite order from the re-entry note, which opens with what is
 * waiting because the person is already inside the work by then.
 */
export function workSoFar(facts: WorkSoFarFacts, nowEpochMs: number): WorkSoFar {
  const sittings = facts.sittingsEndedAtEpochMs.length
  const anyOpen = facts.sittingsEndedAtEpochMs.some((endedAt) => endedAt === null)

  const ends = facts.sittingsEndedAtEpochMs.filter((at): at is number => at !== null)
  const lastEnd = ends.length === 0 ? null : Math.max(...ends)
  // Clamped at zero rather than reported. A sitting that ended "in the future"
  // is two clocks disagreeing, and "-3 days ago" is the screen showing its own
  // arithmetic to somebody who cannot act on it.
  const daysSinceLastSitting =
    lastEnd === null ? null : Math.max(0, Math.floor((nowEpochMs - lastEnd) / DAY_MS))

  const { produced, unrecognisedKinds } = countKinds(facts.produced)
  const decided = countVerdicts(facts)

  const lines = [
    sittingsLine(sittings, anyOpen, daysSinceLastSitting),
    aroundHereLine(facts.approvedSources, facts.documents),
    producedLine(produced, unrecognisedKinds),
    decidedLine(decided),
    questionsLine(facts.openQuestions),
    stoppedLine(facts.lastStop),
  ].filter((line): line is string => line !== null)

  return {
    anythingToSay: lines.length > 0,
    sittings,
    daysSinceLastSitting,
    approvedSources: facts.approvedSources,
    documents: facts.documents,
    produced,
    unrecognisedKinds,
    decided,
    openQuestions: facts.openQuestions,
    stopped: facts.lastStop,
    lines,
  }
}

/* ── the arithmetic ─────────────────────────────────────────────────────── */

function countKinds(outcomes: readonly StoredOutcome[]): {
  produced: ProducedCount[]
  unrecognisedKinds: number
} {
  const tally = new Map<ShiftOutcomeKind, number>()
  let unrecognisedKinds = 0

  for (const outcome of outcomes) {
    const kind = asShiftOutcomeKind(outcome.kind)
    if (kind === null) unrecognisedKinds += 1
    else tally.set(kind, (tally.get(kind) ?? 0) + 1)
  }

  const produced: ProducedCount[] = []
  // Iterating the closed set rather than the map, so the order is the
  // vocabulary's and not whatever order the database happened to return.
  for (const kind of SHIFT_OUTCOME_KINDS) {
    const count = tally.get(kind)
    if (count !== undefined) produced.push({ kind, count })
  }

  return { produced, unrecognisedKinds }
}

/**
 * Every decidable unit, counted once.
 *
 * ── Why a `document-changes` outcome is not a unit ───────────────────────
 *
 * Because its changes are. That kind is settled one `ProposedChange` at a time
 * and **never receives an `OutcomeVerdict` at all**, which is the distinction
 * the repository's `UNSETTLED` predicate exists to hold and the one it has
 * already been wrong about once in the expensive direction. Counting the
 * outcome as well would report one more thing waiting than exists, on every
 * project that has ever had a drafting shift, forever.
 *
 * ── Why a landed outcome contributes nothing ─────────────────────────────
 *
 * There was never a verdict to give. The effect is already outside Propositum,
 * and putting it into an undecided count would tell a person something is
 * waiting on them that they cannot act on. `isDecidable` is asked rather than
 * `reversibility` being read, so a value nobody has seen before is reported
 * rather than reviewed — deny by default, in the one place the default matters.
 *
 * ── Why an unrecognised verdict lands in no bucket ───────────────────────
 *
 * A row exists, so the unit is not undecided; the word is not one this version
 * wrote, so it is not evidence that a person accepted, rejected or reworded
 * anything either. The buckets therefore do not have to sum to the number of
 * units, and no sentence below states a total — a number that claims to be a
 * whole and is not is worse than three numbers that claim to be three.
 */
function countVerdicts(facts: WorkSoFarFacts): DecidedCounts {
  let accepted = 0
  let rejected = 0
  let edited = 0
  let undecided = 0

  const count = (verdict: string | null): void => {
    if (verdict === null) {
      undecided += 1
      return
    }
    const known: Verdict | null =
      verdict === 'accept' || verdict === 'reject' || verdict === 'edit' ? verdict : null
    if (known === 'accept') accepted += 1
    if (known === 'reject') rejected += 1
    if (known === 'edit') edited += 1
  }

  for (const verdict of facts.changeVerdicts) count(verdict)

  for (const outcome of facts.produced) {
    if (!isDecidable(outcome.reversibility)) continue
    if (asShiftOutcomeKind(outcome.kind) === 'document-changes') continue
    count(outcome.verdict)
  }

  return { accepted, rejected, edited, undecided }
}

/* ── the sentences ──────────────────────────────────────────────────────── */

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/** `a, b and c`. The Oxford comma is deliberately absent; the house voice does
 *  not use one. */
function joined(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

function sittingsLine(
  sittings: number,
  anyOpen: boolean,
  daysSinceLastSitting: number | null,
): string | null {
  if (sittings === 0) return null

  const many = sittings === 1 ? 'One sitting so far' : `${sittings} sittings so far`

  if (anyOpen) {
    return sittings === 1
      ? 'One sitting so far, and it is still open.'
      : `${many}, and the latest is still open.`
  }

  if (daysSinceLastSitting === null) return `${many}.`
  if (daysSinceLastSitting === 0) return `${many}. The last one ended less than a day ago.`
  if (daysSinceLastSitting === 1) return `${many}. The last one ended a day ago.`
  return `${many}. The last one ended ${daysSinceLastSitting} days ago.`
}

function aroundHereLine(approvedSources: number, documents: number): string | null {
  if (approvedSources === 0 && documents === 0) return null

  const sites =
    approvedSources === 0
      ? 'Nothing is approved here yet'
      : approvedSources === 1
        ? 'One site is already approved here'
        : `${approvedSources} sites are already approved here`

  const document =
    documents === 0
      ? 'there is no document yet'
      : documents === 1
        ? 'there is a document to work in'
        : `there are ${documents} documents to work in`

  return `${sites}, and ${document}.`
}

function producedLine(
  produced: readonly ProducedCount[],
  unrecognisedKinds: number,
): string | null {
  if (produced.length === 0 && unrecognisedKinds === 0) return null

  const parts = produced.map(({ kind, count }) =>
    count === 1 ? KIND_IN_A_SENTENCE[kind].one : KIND_IN_A_SENTENCE[kind].many(count),
  )

  // Said rather than dropped. A row whose kind this version has no word for came
  // from a later one, and a sentence that quietly omits it under-reports what
  // Propositum has done — wrong in the direction a person cannot check.
  if (unrecognisedKinds > 0) {
    parts.push(
      unrecognisedKinds === 1
        ? 'one thing this version does not have a word for'
        : `${unrecognisedKinds} things this version does not have words for`,
    )
  }

  return `Propositum has produced ${joined(parts)}.`
}

/**
 * What a person did about it, and what is still theirs to do.
 *
 * No total is stated, deliberately. An unrecognised verdict is in no bucket —
 * see `countVerdicts` — so accepted + rejected + reworded + undecided is not
 * guaranteed to be the number of units, and a number that claims to be a whole
 * and is not is worse than three that claim to be three.
 *
 * `none` rather than `0`, because *"you accepted 4, rejected 0 and reworded 0"*
 * is a person being read their own decisions back out of a database.
 */
function decidedLine(decided: DecidedCounts): string | null {
  const settled = decided.accepted + decided.rejected + decided.edited
  if (settled === 0 && decided.undecided === 0) return null

  const waiting =
    decided.undecided === 0
      ? ''
      : decided.undecided === 1
        ? ' — 1 is still undecided'
        : ` — ${decided.undecided} are still undecided`

  // Nothing settled and nothing waiting is the `null` above, so reaching here
  // with `settled === 0` means there is something waiting to name.
  if (settled === 0) return `None of it has been decided yet${waiting}.`

  const said = joined([
    `you accepted ${decided.accepted === 0 ? 'none' : decided.accepted}`,
    `rejected ${decided.rejected === 0 ? 'none' : decided.rejected}`,
    `reworded ${decided.edited === 0 ? 'none' : decided.edited}`,
  ])

  return `Of those, ${said}${waiting}.`
}

function questionsLine(openQuestions: number): string | null {
  if (openQuestions === 0) return null
  return openQuestions === 1
    ? 'One question is still waiting on you.'
    : `${plural(openQuestions, 'question')} are still waiting on you.`
}

/**
 * Where the last one stopped, in the person's words.
 *
 * ── Why this is not `whereItStopped` on the re-entry note ────────────────
 *
 * They answer the same question for two different readers and the overlap is
 * named here rather than left to be discovered. That one is the note's own
 * section: first person, about the shift the person is reading, covering the
 * live case, and carrying how many plan steps were reached. This one is a single
 * clause in a paragraph a person reads BEFORE starting the next sitting, about a
 * stretch of work that is over — so it is third person, has no live case, and
 * has no plan to count through.
 *
 * A shared function would have to serve both and would end up with a `live`
 * flag, a step count and a voice parameter, at which point it is two functions
 * sharing a body. What is genuinely shared is the closed set of stored reasons,
 * and the failure to guard against is a reason that arrives here with no word
 * for it — which is why the default claims nothing rather than guessing.
 */
function stoppedLine(stopped: StoppedAt | null): string | null {
  if (stopped === null) return null

  const what = ((): string => {
    switch (stopped.terminalReason) {
      case 'budget-exhausted':
        return 'ran out of the time you gave it'
      case 'lease-expired':
        return 'stopped when your Mac slept'
      case 'cancelled':
        return 'stopped because you called it back'
      case 'error':
        return 'hit something it could not get past, and stopped'
      case 'stop-condition':
        return 'stopped itself rather than keep going'
      case null:
        return stopped.status === 'succeeded'
          ? 'worked through the plan and stopped there'
          : 'stopped before finishing'
      default:
        // A reason written by a version this one has never met. Saying the
        // stored value would put a machine word on a screen; guessing at it
        // would be worse. So the sentence claims exactly what the row supports.
        return 'stopped before finishing'
    }
  })()

  return `Last time, Propositum ${what}.`
}
