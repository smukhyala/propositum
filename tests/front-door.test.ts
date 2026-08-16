/**
 * The front door's three derived fields, and the word a person actually reads.
 *
 * ── Why this file exists, in the words of the mutation that found it ─────
 *
 * The derivation lived inside `src/app/page.tsx`. Appending
 * `&& ('sleeping' as IntentionStateId)` to its `intentionState(...)` call — so
 * every project renders *Sleeping*, no row ever reaches `needs-you`, no
 * attention colour, and the "While you were away" link never appears — left
 * `npm test` and `npm run typecheck` both completely green. The only guard was
 * `tests/reachability.test.ts` GREPPING for the call, and a grep stays green
 * through a call whose result is thrown away.
 *
 * So the assertions below are on the CONSUMER LABEL wherever the label is what
 * the mutation would have changed. `intentionState` returning `'needs-you'` is
 * `tests/intention.test.ts`'s subject; what is defended here is that the word
 * *Needs you* and the re-entry link are what a row with an undecided question
 * produces, from facts shaped the way the repository actually returns them.
 *
 * ADR-0011 calls this the weak link in its own argument: *"on screen wherever
 * it is used is a sentence someone has to keep true in `.tsx` files, and this
 * ADR ships no test that would notice if it stopped being true."* This is not
 * that test — nothing here renders JSX — but it moves everything except the
 * markup to where a test can hold it.
 */

import { describe, it, expect } from 'vitest'

import { frontDoorRow, statusWordFor } from '../src/server/front-door'
import { INTENTION_STATES } from '../src/domain/intention/state'
import type { IntentionStateFacts } from '../src/persistence/repositories/index'

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)

/** Facts for an Intention nothing is happening to. Every case below is this
 *  plus one difference, so the difference is what the case is about. */
function quiet(over: Partial<IntentionStateFacts> = {}): IntentionStateFacts {
  return {
    intentionId: 'i1',
    projectId: 'p1',
    completedAt: null,
    openSessions: [],
    liveAcceptedContracts: 0,
    unansweredConfirmationsAskedAt: [],
    openDecisions: 0,
    undecidedHeldOutcomes: 0,
    waitingContractId: null,
    ...over,
  }
}

function row(over: {
  facts?: IntentionStateFacts | null
  sittings?: ReadonlyArray<{ id: string; phase: string }>
  liveSessionId?: string | null
}) {
  return frontDoorRow({
    facts: over.facts === undefined ? quiet() : over.facts,
    sittings: over.sittings ?? [],
    liveSessionId: over.liveSessionId ?? null,
    nowEpochMs: NOW,
  })
}

describe('the word beside a row is the state, in the person’s terms', () => {
  it('says Needs you, and offers the note, when a held outcome is undecided', () => {
    // The case the old ternary got wrong in the expensive direction: a shift
    // that ended with something waiting rendered the same word as a project
    // nobody had touched in a month.
    const derived = row({
      facts: quiet({ undecidedHeldOutcomes: 1, waitingContractId: 'c1' }),
    })

    expect(derived.state).toBe('needs-you')
    expect(statusWordFor(derived.state)).toBe('Needs you')
    expect(derived.waitingContractId).toBe('c1')
  })

  it('says Needs you for an unanswered question, and stops once it has expired', () => {
    // Expiry is `confirmationHasExpired`'s and is read through the domain, not
    // reimplemented: a request the system will refuse to accept an answer to
    // must not pin *Needs you* on a project forever.
    const asked = new Date(NOW - 60_000)
    const live = row({ facts: quiet({ unansweredConfirmationsAskedAt: [asked] }) })
    expect(statusWordFor(live.state)).toBe('Needs you')

    const stale = new Date(NOW - 1000 * 60 * 60 * 24 * 30)
    const gone = row({ facts: quiet({ unansweredConfirmationsAskedAt: [stale] }) })
    expect(statusWordFor(gone.state)).toBe('Sleeping')
  })

  it('says Needs you over every activity word, which is the whole precedence rule', () => {
    // ADR-0011: a false `needs-you` costs a person one look, a missed one costs
    // them the shift. A row that is simultaneously being worked on, delegated,
    // and carrying a question says the question.
    const derived = row({
      facts: quiet({
        openSessions: [{ id: 's1', phase: 'observing' }],
        liveAcceptedContracts: 1,
        undecidedHeldOutcomes: 1,
        waitingContractId: 'c1',
      }),
      liveSessionId: 's1',
    })

    expect(statusWordFor(derived.state)).toBe('Needs you')
  })

  it('says Propositum is on it while a Shift is running', () => {
    const derived = row({ facts: quiet({ liveAcceptedContracts: 1 }) })

    expect(derived.state).toBe('delegated')
    expect(statusWordFor(derived.state)).toBe('Propositum is on it')
  })

  it('says Done when a person said so, over everything else', () => {
    const derived = row({
      facts: quiet({ completedAt: new Date(NOW - 1000), undecidedHeldOutcomes: 1 }),
    })

    expect(statusWordFor(derived.state)).toBe('Done')
  })

  it('says nothing stated yet for a Project with no Intention, and not a sixth state', () => {
    const derived = row({ facts: null })

    expect(derived.state).toBeNull()
    expect(statusWordFor(null)).toBe('nothing stated yet')
    expect(Object.values(INTENTION_STATES).map((rule) => rule.consumerLabel)).not.toContain(
      'nothing stated yet',
    )
  })
})

describe('only a sitting this process is feeding counts as Working', () => {
  it('says Working for the live sitting', () => {
    const derived = row({
      facts: quiet({ openSessions: [{ id: 's1', phase: 'observing' }] }),
      sittings: [{ id: 's1', phase: 'observing' }],
      liveSessionId: 's1',
    })

    expect(derived.state).toBe('working')
    expect(statusWordFor(derived.state)).toBe('Working')
    // The live sitting is the one being watched, so nothing is unwatched.
    expect(derived.openUnwatched).toBe(false)
  })

  it('falls back to Sleeping for an open sitting nothing is feeding, and says so underneath', () => {
    // The capture token lives in memory in the app process, so a restart leaves
    // an open row nothing is watching. *Working* beside it would be a false
    // statement about our own software; the fact is kept, in the line that has
    // always carried it.
    const derived = row({
      facts: quiet({ openSessions: [{ id: 's1', phase: 'observing' }] }),
      sittings: [{ id: 's1', phase: 'observing' }],
      liveSessionId: null,
    })

    expect(statusWordFor(derived.state)).toBe('Sleeping')
    expect(derived.openUnwatched).toBe(true)
  })

  it('vouches for nothing when the live sitting belongs to another project', () => {
    const derived = row({
      facts: quiet({ openSessions: [{ id: 's1', phase: 'observing' }] }),
      sittings: [{ id: 's1', phase: 'observing' }],
      liveSessionId: 'somebody-else',
    })

    expect(statusWordFor(derived.state)).toBe('Sleeping')
    expect(derived.openUnwatched).toBe(true)
  })
})

describe('the capture fact survives a Project with no Intention', () => {
  it('still reports an open unwatched sitting when there are no facts at all', () => {
    // The regression this exists for: `openUnwatched` was derived from
    // `facts.openSessions`, and `factsForEveryProject` returns nothing for a
    // Project with no Intention — so a project on the degraded path with an
    // open sitting said only *nothing stated yet* and went quiet about the
    // sitting it had. The sittings are already in hand for the count and the
    // date, and that is where the fact comes from.
    const derived = row({ facts: null, sittings: [{ id: 's1', phase: 'observing' }] })

    expect(derived.state).toBeNull()
    expect(derived.openUnwatched).toBe(true)
  })

  it('says nothing about sittings that have ended', () => {
    const derived = row({ facts: null, sittings: [{ id: 's1', phase: 'ended' }] })

    expect(derived.openUnwatched).toBe(false)
  })
})
