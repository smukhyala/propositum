/**
 * One row of the front door, derived rather than written.
 *
 * ── Why this is a file and not eleven lines inside `page.tsx` ────────────
 *
 * It was eleven lines inside `page.tsx`, and an adversarial review showed what
 * that cost: appending `&& ('sleeping' as IntentionStateId)` to the
 * `intentionState(...)` call — so every project renders *Sleeping*, no row ever
 * reaches `needs-you`, and the re-entry link never appears — left the whole
 * suite green. The only guard was `tests/reachability.test.ts` GREPPING for the
 * call, and a grep stays green through a call whose result is discarded. That
 * is the mechanism ADR-0011 names as its own weak link: *"on screen wherever it
 * is used is a sentence someone has to keep true in `.tsx` files, and this ADR
 * ships no test that would notice if it stopped being true."*
 *
 * A `.tsx` server component is the one thing in this repo nothing can assert
 * against — there is no renderer in the test suite and adding one for three
 * fields would be a build. So the three fields move out to where a test can
 * hold them, and what stays in `page.tsx` is markup plus a lookup in
 * `INTENTION_STATES`. The grep is still there and still worth having; it is now
 * the second line of defence rather than the only one.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not domain code. It reads `IntentionStateFacts`, which is the persistence
 * layer's row-shaped half, and it encodes a decision that is the app process's
 * alone: which open sittings this process is actually feeding. `src/domain`
 * may not learn either of those things, and `intentionState` is deliberately a
 * pure function of counts and epoch milliseconds so that this file can be the
 * one that knows both halves.
 */

import { INTENTION_STATES, intentionState } from '../domain/intention/state'
import type { IntentionStateId } from '../domain/intention/state'
import type { IntentionStateFacts } from '../persistence/repositories/index'
import { EVERY_STRAND, MAX_THREADS_SHOWN, detectThreads } from '../domain/detection/detect'
import type { AmbientObservation, WorkDetected } from '../domain/detection/detect'
import { signatureOf } from './ambient-store'
import type { AmbientStore } from './ambient-store'

/** One sitting, as `sessions.forProject` returns it. A sitting is over when its
 *  phase says so — that reader carries no `endedAt`. */
export interface FrontDoorSitting {
  readonly id: string
  readonly phase: string
}

export interface FrontDoorRow {
  /**
   * Where the Intention is, or NULL when this Project has none.
   *
   * Null is ordinary rather than broken: an Intention is written only when a
   * person accepted an offer that had two sentences on it, so the degraded path
   * — no key, no composed offer — leaves a project with work in it and nothing
   * ratified about what the work is for.
   */
  readonly state: IntentionStateId | null
  /** An open sitting that this process is not feeding. */
  readonly openUnwatched: boolean
  /** The re-entry note to open, when something is waiting on the person. */
  readonly waitingContractId: string | null
}

/**
 * The phases this process is prepared to vouch for.
 *
 * A `WorkSession` whose phase is `observing` means a human started one and no
 * human has ended it. It does not mean anything is being captured: the live
 * token lives in memory in the app process, so a restart leaves an open session
 * row that nothing is feeding. `intentionState` turns `observing` into
 * `working`, whose consumer word is *Working* — so handing it a phase this
 * process cannot vouch for would put that word on the front door for a sitting
 * nobody is watching, which is the false statement about our own software that
 * §11 rules out.
 *
 * An open sitting the capture store is not feeding therefore contributes
 * NOTHING, and the Intention falls through to the member that claims least —
 * which is the behaviour `IntentionFacts.sessionPhases` documents for a phase
 * it does not recognise, reached deliberately here rather than by accident.
 * Being wrong this way costs a reader nothing: `sleeping` asserts nothing and
 * asks nothing of anybody. The fact is not thrown away either — `openUnwatched`
 * carries it, and the line under the name still says the sitting is open and
 * not being watched, which was the truer sentence all along.
 */
function phasesWeCanVouchFor(
  facts: IntentionStateFacts,
  liveSessionId: string | null,
): string[] {
  const phases: string[] = []
  for (const sitting of facts.openSessions) {
    if (sitting.id === liveSessionId) phases.push(sitting.phase)
  }
  return phases
}

/**
 * The three derived fields of one row, from rows plus `now`.
 *
 * ── Why `openUnwatched` reads the Project's sittings, not the Intention's ─
 *
 * Because it is a fact about the Project, and it used to be lost with the
 * Intention. When the derivation first moved onto `IntentionStateFacts` the
 * capture fact moved with it, and `factsForEveryProject` returns nothing at all
 * for a Project with no Intention — so a project on the degraded path with an
 * open sitting nothing is feeding said only *nothing stated yet* and went quiet
 * about the sitting. The sittings are already in hand on that route for the
 * count and the date, so the fact costs nothing and survives a null Intention.
 *
 * `facts.openSessions` stays as the input to `phasesWeCanVouchFor`, which is
 * the one place the question genuinely is *which sittings belong to this
 * Intention*.
 */
export function frontDoorRow(input: {
  readonly facts: IntentionStateFacts | null
  readonly sittings: readonly FrontDoorSitting[]
  readonly liveSessionId: string | null
  readonly nowEpochMs: number
}): FrontDoorRow {
  const { facts, liveSessionId } = input

  /**
   * The facts, converted at this boundary and nowhere else.
   *
   * `intentionState` is a pure function of rows plus `now`, and `now` arrives
   * as a parameter because `src/domain/**` may never read the clock — so the
   * epoch conversion is the app layer's job. The domain names no table.
   */
  const state =
    facts === null
      ? null
      : intentionState(
          {
            completedAtEpochMs: facts.completedAt === null ? null : facts.completedAt.getTime(),
            sessionPhases: phasesWeCanVouchFor(facts, liveSessionId),
            liveAcceptedContracts: facts.liveAcceptedContracts,
            unansweredConfirmationsAskedAtEpochMs: facts.unansweredConfirmationsAskedAt.map(
              (askedAt) => askedAt.getTime(),
            ),
            openDecisions: facts.openDecisions,
            undecidedHeldOutcomes: facts.undecidedHeldOutcomes,
          },
          input.nowEpochMs,
        )

  return {
    state,
    openUnwatched: input.sittings.some(
      (sitting) => sitting.phase !== 'ended' && sitting.id !== liveSessionId,
    ),
    waitingContractId: facts?.waitingContractId ?? null,
  }
}

/**
 * The lifecycle word, in the person's own terms.
 *
 * `INTENTION_STATES` rather than a literal, so the five sentences CONTEXT.md
 * fixes are rendered from the one place that holds them. A Project with no
 * Intention gets a sentence that is not one of the five and does not pretend to
 * be a sixth: nobody has said what this is for, and Home never asks them to.
 */
export function statusWordFor(state: IntentionStateId | null): string {
  return state === null ? 'nothing stated yet' : INTENTION_STATES[state].consumerLabel
}

/* ── what the front door has noticed, and would show ────────────────────── */

/** One strand of an afternoon, as the front door renders it. */
export interface NoticedStrand {
  readonly detected: WorkDetected
  /** The thread's identity. The only thing the accept and decline forms carry,
   *  and the key everything per-thread is stored under. */
  readonly signature: string
}

/**
 * Every strand this screen will show, in order, already filtered and deduped.
 *
 * ── Why this is not eight lines inside `page.tsx` ────────────────────────
 *
 * The same argument this file opens with, now load-bearing for something that
 * can go wrong in a worse way than a status word. There are three decisions
 * here and each of them fails silently:
 *
 *   - **The bar.** Every strand must clear the one `detectWork` applies. That is
 *     enforced inside `detectThreads`, and this function must not widen it.
 *   - **The snooze.** Two of them, asking different questions — a strand
 *     somebody turned down here, and the coarser origin decline the extension
 *     still sends. A missing check means "not now" does not hold.
 *   - **The signature.** It keys `rememberThread`, the name cache, the offer
 *     cache, and the hidden field under every button on the screen. Two strands
 *     sharing one would put the second one's button in front of the first one's
 *     work.
 *
 * A `.tsx` server component is the one thing in this repo nothing can assert
 * against, and "the wrong strand was started" is not a defect anybody would spot
 * by looking. So the derivation lives here and `page.tsx` keeps the markup.
 *
 * ── The bound is the detector's number, applied here, and that is the fix ─
 *
 * ~~`detectThreads` defaults to `MAX_THREADS_SHOWN` and carries the argument for
 * the number. This does not re-state it, because two places holding one limit is
 * how the screen and the poll that names for the screen come apart.~~
 *
 * **Amended 2026-08-17.** Letting the detector do the cutting meant the cut
 * happened BEFORE the three filters below, so a snoozed strand spent one of the
 * three slots and a qualifying strand behind it never reached the screen — found
 * and discarded in silence, which is the failure this function exists to end.
 * Measured at four qualifying strands: snoozing the strongest showed two.
 *
 * So the detector is asked for `EVERY_STRAND` and the bound is applied at the
 * bottom of this loop. The number is still the detector's and is still imported
 * rather than written twice; what moved is where it bites. `MAX_THREADS_SHOWN`
 * carries the amendment and the poll does the same thing in the same order, so
 * the screen and the pass that names for it still agree about which three exist.
 *
 * ── And the cut is now visible, added 2026-08-18 ─────────────────────────
 *
 * The loop moved into `noticedAfternoon` below, which returns what was cut as
 * well as what survived. This function is its `shown` half, unchanged in what it
 * returns and in what order — the amendment above still describes it exactly.
 * What was missing was that the amendment closed the snooze half of the silence
 * and left the other half open: a strand cut by the bound is still found and
 * discarded with nothing recording it. Now something counts it.
 */
export function noticedStrands(
  store: AmbientStore,
  observations: readonly AmbientObservation[],
  nowMs: number,
): NoticedStrand[] {
  return noticedAfternoon(store, observations, nowMs).shown
}

/** What the screen shows, and what it found and did not. */
export interface NoticedAfternoon {
  /** In order, bounded by `MAX_THREADS_SHOWN`. What `noticedStrands` returns. */
  readonly shown: NoticedStrand[]
  /**
   * Strands that cleared the detector's bar, were not snoozed, were not
   * duplicates — and were cut by the display bound anyway.
   *
   * ── Why the snoozed ones are not in here ─────────────────────────────
   *
   * A strand the person answered is not a strand discarded in silence. "Not
   * now" is the product doing exactly what it was told, and that suppression is
   * already counted where it belongs — as a decline. Putting it here as well
   * would report obedience as a failure and would double-count one act.
   *
   * A duplicate signature is not in here either, for a different reason: it is
   * a defensive drop of something that should not be constructible, and if it
   * ever fires the thing to do is fix it rather than count it.
   *
   * What IS in here is the one thing ADR-0008 names as the failure the
   * multi-strand change existed to remove — *"found and discarded, which is
   * worse than not finding them, because nothing anywhere recorded that they
   * had been"* — and which `MAX_THREADS_SHOWN` still does. Now something
   * records it: a number, per day, with no subject attached. See
   * `src/server/offer-tally.ts`.
   */
  readonly suppressed: NoticedStrand[]
}

/**
 * Both halves, from one pass.
 *
 * A second function walking the same strands with the same three filters is how
 * the screen and the count would come to disagree about which strands existed —
 * the same argument this file already makes about the screen and the poll. So
 * the bound partitions rather than terminating, and `noticedStrands` is this
 * function's `shown` half and nothing else.
 *
 * The loop no longer stops at `MAX_THREADS_SHOWN`, which costs one map lookup
 * per extra strand and no detection work at all: `detectThreads` was already
 * asked for `EVERY_STRAND` and had already built them.
 */
export function noticedAfternoon(
  store: AmbientStore,
  observations: readonly AmbientObservation[],
  nowMs: number,
): NoticedAfternoon {
  const shown: NoticedStrand[] = []
  const suppressed: NoticedStrand[] = []
  const seen = new Set<string>()

  for (const detected of detectThreads(observations, nowMs, EVERY_STRAND)) {
    const signature = signatureOf(detected.terms)
    if (seen.has(signature)) continue
    // This screen's own "Not now", against the subject the person answered.
    if (store.isThreadSnoozed(signature, nowMs)) continue
    // The extension's coarser decline, against a site. Kept because the decline
    // endpoint takes an origin; it can suppress a strand that merely shares a
    // site with one somebody turned down, and `AmbientStore.declineThread`
    // records that gap rather than hiding it.
    if (store.isSnoozed(detected.origins[0] ?? '', nowMs)) continue

    seen.add(signature)
    // The bound, spent only on strands that survived everything above it.
    if (shown.length >= MAX_THREADS_SHOWN) suppressed.push({ detected, signature })
    else shown.push({ detected, signature })
  }

  return { shown, suppressed }
}

/**
 * The strand a button belonged to, found again in a buffer that has moved.
 *
 * ── Why the form carries a signature and the rest is recomputed ──────────
 *
 * `page.tsx` recomputes detection on accept rather than trusting a hidden field,
 * and its own note says why: the buffer moves while a page sits open, and the
 * pages pinned as "the thread" are exactly what gets folded into the ledger. The
 * screen can now show three strands, so something has to say WHICH — and the
 * signature is already the only identifier this product lets a request carry.
 *
 * It SELECTS among strands detected a moment ago. It supplies no subject, no
 * page list and no origin, so the second strand's button carries the second
 * strand's pages, freshly computed, and a crafted value finds nothing.
 *
 * Null is the ordinary "gone quiet" answer as well as the crafted one, and both
 * want the same sentence.
 *
 * ── Unbounded, deliberately, and it is `MAX_THREADS_SHOWN`'s doing ───────
 *
 * `EVERY_STRAND` rather than the display bound, because this is asking WHICH
 * STRAND, not how many to show. Once the bound is applied after the snooze
 * filters — which is the fix in `noticedStrands` — the third row of the screen
 * can be the detector's fourth-ranked strand, and a bounded lookup here would
 * answer a button that is on screen with "that has gone quiet". This does not
 * widen anything: it can still only return a strand that cleared the detector's
 * own bar, and the caller already had its signature.
 */
export function strandBySignature(
  observations: readonly AmbientObservation[],
  nowMs: number,
  signature: string,
): WorkDetected | null {
  const wanted = signature.trim()
  if (wanted === '') return null

  return (
    detectThreads(observations, nowMs, EVERY_STRAND).find(
      (candidate) => signatureOf(candidate.terms) === wanted,
    ) ?? null
  )
}
