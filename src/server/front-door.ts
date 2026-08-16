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
