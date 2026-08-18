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

import { frontDoorRow, noticedAfternoon, noticedStrands, statusWordFor } from '../src/server/front-door'
import { INTENTION_STATES } from '../src/domain/intention/state'
import type { IntentionStateFacts } from '../src/persistence/repositories/index'
import { MAX_THREADS_SHOWN } from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'
import { createAmbientStore } from '../src/server/ambient-store'

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

/* ── what it showed, and what it found and cut ───────────────────────────── */

/**
 * The half of the silence the 2026-08-17 amendment left open.
 *
 * That amendment moved the display bound below the snooze filters, so a strand
 * somebody had answered could no longer spend one of the three slots. What it
 * did not change is what happens to the fourth qualifying strand: it is found,
 * it clears the same bar every shown strand cleared, and it is dropped with
 * nothing anywhere recording that it existed. ADR-0008 calls that *"worse than
 * not finding them, because nothing anywhere recorded that they had been"*.
 *
 * `noticedAfternoon` returns it. What is pinned below is that the shown half is
 * unchanged — `noticedStrands` must return exactly what it always did — and
 * that the cut half is the bound's doing alone: a snoozed strand is NOT in it,
 * because "not now" is the product obeying and is counted as a decline instead.
 */
describe('the strands a screen finds and does not show', () => {
  const AT = Date.UTC(2026, 7, 18, 12, 0, 0)
  const MINUTE = 60_000
  const GOOGLE = 'https://www.google.com'

  /**
   * A search, then two pages on two different hosts. The smallest afternoon a
   * strand can be made of and still clear the detector's bar.
   *
   * Both words are the strand's own and NO WORD IS SHARED with another strand,
   * which is load-bearing rather than tidy: `findThreads` seeds on the commonest
   * term, so one word in common across the fixture — the first draft used
   * "comparison" — collapses all four into a single thread and leaves this file
   * asserting about a bound it never reaches. Measured: it found one strand.
   *
   * **That includes the URL PATHS, which is the half that is easy to miss.**
   * `termsOf` reads the path as well as the title, so a second draft with every
   * strand's pages at `/one` and `/two` gave the words *one* and *two* a count
   * of four against each subject's three — they seeded first, claimed a page
   * from every strand, and left each real subject with too few pages to form a
   * thread at all. Measured: four strands in, zero out, silently. Hence the
   * paths are the strand's own words too — and the titles carry no filler
   * words either, because *"at length"* and *"again"* did the same thing one
   * draft later. Nothing shared may appear anywhere on a page but the search
   * engine's own host, where it reaches only one origin and cannot seed.
   */
  function strand(index: number, word: string, other: string): AmbientObservation[] {
    const at = AT - (10 - index) * MINUTE

    return [
      {
        at,
        origin: GOOGLE,
        url: `${GOOGLE}/search?q=${word}+${other}`,
        title: `${word} ${other} - Google Search`,
        kind: 'query',
      },
      {
        at: at + 10_000,
        origin: `https://${word}.example`,
        url: `https://${word}.example/${word}`,
        title: `${word} ${other}`,
        kind: 'navigation',
        engagedMs: 90_000,
      },
      {
        at: at + 20_000,
        origin: `https://second-${word}.example`,
        url: `https://second-${word}.example/${other}`,
        title: `${word} ${other}`,
        kind: 'navigation',
        engagedMs: 60_000,
      },
    ]
  }

  const AFTERNOON = [
    ...strand(1, 'kalman', 'filters'),
    ...strand(2, 'tokio', 'runtime'),
    ...strand(3, 'sourdough', 'starter'),
    ...strand(4, 'gearbox', 'ratios'),
  ]

  it('finds four qualifying strands, or this fixture is not testing the bound', () => {
    const store = createAmbientStore()

    const afternoon = noticedAfternoon(store, AFTERNOON, AT)

    expect(afternoon.shown.length + afternoon.suppressed.length).toBe(4)
  })

  it('shows three and records the fourth as cut', () => {
    const store = createAmbientStore()

    const afternoon = noticedAfternoon(store, AFTERNOON, AT)

    expect(afternoon.shown).toHaveLength(MAX_THREADS_SHOWN)
    expect(afternoon.suppressed).toHaveLength(1)
  })

  it('returns the same three from noticedStrands, in the same order', () => {
    const store = createAmbientStore()

    // The mutation this would catch: partitioning changing what reaches the
    // screen. The shown half must be byte-identical to what it was.
    expect(noticedStrands(store, AFTERNOON, AT)).toEqual(
      noticedAfternoon(store, AFTERNOON, AT).shown,
    )
  })

  it('does not count a strand somebody turned down as one it cut', () => {
    const store = createAmbientStore()
    const leading = noticedAfternoon(store, AFTERNOON, AT).shown[0]!

    store.declineThread(leading.signature, [], AT)
    const after = noticedAfternoon(store, AFTERNOON, AT)

    // The declined strand is in neither half: it was not shown, and it was not
    // discarded in silence — the person answered it, and that act is counted as
    // a decline. Counting it here as well would report obedience as a failure
    // and would count one act twice.
    expect(after.shown.map((s) => s.signature)).not.toContain(leading.signature)
    expect(after.suppressed.map((s) => s.signature)).not.toContain(leading.signature)
    // And the strand that was behind the bound is promoted onto the screen
    // rather than staying cut, which is the 2026-08-17 amendment still holding.
    expect(after.shown).toHaveLength(MAX_THREADS_SHOWN)
    expect(after.suppressed).toHaveLength(0)
  })

  it('cuts nothing when there is nothing behind the bound', () => {
    const store = createAmbientStore()
    const three = [
      ...strand(1, 'kalman', 'filters'),
      ...strand(2, 'tokio', 'runtime'),
      ...strand(3, 'sourdough', 'starter'),
    ]

    expect(noticedAfternoon(store, three, AT).suppressed).toEqual([])
  })
})
