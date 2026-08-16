/**
 * The two background model calls that run while nobody asked for anything.
 *
 * Both are gated the same way and both are spending money on a thirty-second
 * timer, so what is pinned here is mostly about restraint: the bar in front of
 * the offer, one call per thread, and — the defect that shipped — a failure
 * that is remembered instead of retried on every poll forever.
 *
 * The one place restraint was too much of it is pinned here too. A call that
 * never ARRIVED is not an answer, and settling it as one means a person doing
 * real work silently never gets an offer. So `transport` buys exactly one more
 * attempt, and the tests below hold both halves: that the retry happens, and
 * that it stops — at two, inside the in-flight marker, with no poll able to
 * multiply it.
 */

import { describe, it, expect } from 'vitest'
import { FakeModelClient } from '../src/model/fake'
import type { ScriptedReply } from '../src/model/fake'
import { composeOffer } from '../src/server/compose-offer'
import { nameThread } from '../src/server/name-thread'
import { createAmbientStore, signatureOf } from '../src/server/ambient-store'
import type { AmbientStore, NamedThread } from '../src/server/ambient-store'
import { detectWork, threadPagesOf } from '../src/domain/detection/detect'
import type { AmbientObservation, WorkDetected } from '../src/domain/detection/detect'
import { groundsFor } from '../src/domain/detection/grounds'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

const CARRIER_A = 'https://carrier-a.example.com'
const CARRIER_B = 'https://carrier-b.example.com'
const CARRIER_C = 'https://carrier-c.example.com'
const ENGINE = 'https://search.example.com'

function observation(partial: Partial<AmbientObservation> & { at: number; url: string }): AmbientObservation {
  return {
    origin: new URL(partial.url).origin,
    title: partial.title ?? 'Parcel carrier rates compared',
    kind: partial.kind ?? 'navigation',
    ...partial,
  }
}

/**
 * A thread that clears the grounds bar: a search, then pages from it, held for
 * a while, across three places.
 */
function strongThread(): readonly AmbientObservation[] {
  return [
    observation({
      at: T0,
      url: `${ENGINE}/search?q=parcel+carrier+rates`,
      title: 'parcel carrier rates - Search',
      kind: 'query',
    }),
    observation({ at: T0 + MINUTE, url: `${CARRIER_A}/rates`, title: 'Parcel carrier rates 2026' }),
    observation({
      at: T0 + 2 * MINUTE,
      url: `${CARRIER_A}/rates`,
      title: 'Parcel carrier rates 2026',
      kind: 'engagement',
      engagedMs: 5 * MINUTE,
    }),
    observation({ at: T0 + 8 * MINUTE, url: `${CARRIER_B}/rates`, title: 'Carrier rates and parcel surcharges' }),
    observation({
      at: T0 + 9 * MINUTE,
      url: `${CARRIER_B}/rates`,
      title: 'Carrier rates and parcel surcharges',
      kind: 'engagement',
      engagedMs: 4 * MINUTE,
    }),
    observation({ at: T0 + 14 * MINUTE, url: `${CARRIER_C}/rates`, title: 'Parcel rates by weight' }),
    observation({
      at: T0 + 16 * MINUTE,
      url: `${CARRIER_C}/rates`,
      title: 'Parcel rates by weight',
      kind: 'engagement',
      engagedMs: 6 * MINUTE,
    }),
  ]
}

/**
 * Work by `detectWork`'s standard and not by the offer's.
 *
 * Three pages across two places with real reading on one of them — enough to
 * say something, nothing like enough to propose doing something. No query and
 * no return means no intent ground at all, which is the newsletter afternoon
 * ADR-0009 refuses to interrupt.
 */
function weakThread(): readonly AmbientObservation[] {
  return [
    observation({ at: T0, url: `${CARRIER_A}/rates`, title: 'Parcel carrier rates 2026' }),
    observation({ at: T0 + MINUTE, url: `${CARRIER_A}/rates-2`, title: 'Parcel carrier rates by weight' }),
    observation({
      at: T0 + 2 * MINUTE,
      url: `${CARRIER_B}/rates`,
      title: 'Parcel carrier rates and surcharges',
      kind: 'engagement',
      engagedMs: 9 * MINUTE,
    }),
  ]
}

function loaded(observations: readonly AmbientObservation[]): {
  store: AmbientStore
  detected: WorkDetected
  named: NamedThread
  at: number
} {
  const store = createAmbientStore()
  const at = (observations[observations.length - 1]?.at ?? T0) + MINUTE

  for (const o of observations) store.record(o, o.at)

  const detected = detectWork(store.since(at), at)
  if (!detected) throw new Error('fixture does not detect as work at all')

  const named: NamedThread = {
    signature: signatureOf(detected.terms),
    subject: 'parcel carrier rates',
    confident: true,
  }

  return { store, detected, named, at }
}

const OFFER = {
  title: 'Compare the carriers you have been reading',
  rationale: 'You searched for rates and then read three of them.',
  outline: ['Pull the published rates', 'Put them in one table', 'Say which is cheapest under 5kg'],
  produces: 'One table of published rates with the cheapest marked',
  excludes: ['Book anything', 'Write to any of them'],
  outcomeKinds: ['collection', 'phone-a-friend'],
  confident: true,
}

const ok: ScriptedReply<unknown> = { kind: 'ok', value: OFFER }

describe('the grounds bar is in front of the model, not behind it', () => {
  it('does not call anything when the grounds are not sufficient', async () => {
    const { store, detected, named, at } = loaded(weakThread())
    const model = new FakeModelClient([])

    await composeOffer(store, model, detected, named, at)

    expect(model.calls).toHaveLength(0)
    expect(store.offerFor(named.signature)).toBeNull()
  })

  it('leaves a thread that has not qualified YET able to qualify later', async () => {
    // The ordering that matters: the bar is checked before the attempt is
    // recorded. Marking the thread on the way past a failed bar would mean an
    // afternoon that turns into real work never gets an offer at all.
    const { store, detected, named, at } = loaded(weakThread())
    await composeOffer(store, new FakeModelClient([]), detected, named, at)

    expect(store.attemptedOffer(named.signature)).toBe(false)

    const strong = loaded(strongThread())
    const model = new FakeModelClient([ok])
    await composeOffer(strong.store, model, strong.detected, strong.named, strong.at)

    expect(model.calls).toHaveLength(1)
  })

  it('composes once the two groups are satisfied', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const at20 = T0 + 20 * MINUTE
    const grounds = groundsFor(detected, threadPagesOf(store.since(at20), detected, at20))

    expect(grounds.sufficient).toBe(true)
    expect(grounds.sentences.length).toBeGreaterThan(0)

    const model = new FakeModelClient([ok])
    await composeOffer(store, model, detected, named, at)

    const offer = store.offerFor(named.signature)
    expect(offer?.title).toBe(OFFER.title)
    // The closed set is applied in code: the invented kind is dropped, not
    // mapped to whichever of the five it resembles.
    expect(offer?.expects).toEqual(['collection'])
    expect(offer?.grounds.sufficient).toBe(true)
    expect(offer?.promptVersion).toBe('offer@1')
  })
})

describe('what the offer call is shown', () => {
  it('datamarks every page-authored string, including the subject', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([ok])

    await composeOffer(store, model, detected, named, at)

    const prompt = model.calls[0]?.user ?? ''
    // The subject came back from a model that composed it from titles. Going
    // through a model does not make page-authored text trusted.
    expect(prompt).toContain('UNTRUSTED_PAGE_TEXT')
    const fences = prompt.match(/<<<UNTRUSTED_PAGE_TEXT>>>/g) ?? []
    expect(fences.length).toBeGreaterThan(1)
    expect(prompt).toContain('parcel carrier rates')
  })

  it('carries the arithmetic, and the grounds in words', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([ok])

    await composeOffer(store, model, detected, named, at)

    const prompt = model.calls[0]?.user ?? ''
    // Four, not three: the search page is part of the thread and its engine is
    // one of the places. Counted by code, said in words, and naming none of them.
    expect(prompt).toMatch(/4 pages across 4 places/)
    expect(prompt).toMatch(/Why Propositum thinks this is work/)
    expect(prompt).toMatch(/What Propositum can produce/)
  })

  it('sends a search only when it shares a word with the thread', async () => {
    // The other search of the afternoon. It is in the window, it reaches the
    // function, and it must not reach the prompt — this is the whole of the
    // privacy claim on this input, so the fixture has to make the filter do the
    // work rather than have the buffer do it upstream.
    const stray = observation({
      at: T0 + 17 * MINUTE,
      url: `${ENGINE}/find?q=biopsy+results+meaning`,
      title: 'biopsy results meaning - Search',
      kind: 'query',
    })

    const { store, detected, named, at } = loaded([...strongThread(), stray])

    expect(store.since(at).some((o) => o.url.includes('biopsy'))).toBe(true)

    const model = new FakeModelClient([ok])
    await composeOffer(store, model, detected, named, at)

    const prompt = model.calls[0]?.user ?? ''
    expect(prompt).not.toContain('biopsy')
    // ...and the search that WAS about this went as the person typed it.
    expect(prompt).toContain('parcel carrier rates')
  })

  it('does not call a tracking parameter a search', async () => {
    // The extension marks any URL with a `?` in it as a query, so a newsletter
    // link arrives claiming to be something somebody typed. Sending its title
    // back as "they searched for" would be telling the model something untrue.
    const fromNewsletter = [
      observation({
        at: T0,
        url: `${CARRIER_A}/rates?utm_source=newsletter`,
        title: 'Parcel carrier rates 2026',
        kind: 'query',
      }),
      ...strongThread().slice(1),
    ]

    const { store, detected, named, at } = loaded(fromNewsletter)
    const model = new FakeModelClient([ok])
    await composeOffer(store, model, detected, named, at)

    expect(model.calls[0]?.user ?? '').not.toContain('utm')
  })
})

/**
 * The bar itself is tested in `tests/grounds.test.ts`.
 *
 * This file used to re-test it here, against a `groundsFor` that took raw
 * observations. The version that survived takes the thread's own `ThreadPage`s
 * — per-page dwell, arrival counts, term sets — because that is what the rules
 * actually measure, and the duplicate block was asserting the same product
 * behaviour through a signature that no longer exists. One home for the
 * split-not-count argument is the right number.
 */


describe('one call per thread, including the failures', () => {
  it('does not compose twice for the same signature', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([ok])

    await composeOffer(store, model, detected, named, at)
    await composeOffer(store, model, detected, named, at)

    expect(model.calls).toHaveLength(1)
  })

  it('does not let two polls race to compose the same offer', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([ok])

    await Promise.all([
      composeOffer(store, model, detected, named, at),
      composeOffer(store, model, detected, named, at),
    ])

    expect(model.calls).toHaveLength(1)
  })

  /**
   * The regression test for the defect this unit exists partly to fix.
   *
   * `name-thread.ts` cleared its in-flight marker on failure and recorded
   * nothing, so `nameFor() || isNaming()` was false again immediately and the
   * next thirty-second poll re-fired. Measured at about sixty calls for one
   * thread. It must not be true of either file.
   */
  it('remembers a refusal instead of asking again on the next poll', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    for (let poll = 0; poll < 10; poll += 1) {
      await composeOffer(store, model, detected, named, at)
    }

    expect(model.calls).toHaveLength(1)
    expect(store.offerFor(named.signature)).toBeNull()
    expect(store.isComposing(named.signature)).toBe(false)
    expect(store.attemptedOffer(named.signature)).toBe(true)
  })

  it('remembers a truncation the same way — a bigger budget is not this call´s decision', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([{ kind: 'fail', failure: 'truncation', detail: 'max_tokens' }])

    await composeOffer(store, model, detected, named, at)
    await composeOffer(store, model, detected, named, at)

    expect(model.calls).toHaveLength(1)
  })

  it('remembers a schema mismatch the same way — the client already spent its repair turn', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'schema-mismatch', detail: 'outline: expected array' },
    ])

    await composeOffer(store, model, detected, named, at)
    await composeOffer(store, model, detected, named, at)

    // Well-formed JSON of the wrong shape is an ANSWER. Asking again asks the
    // same model the same thing, which is what `answered()` says out loud.
    expect(model.calls).toHaveLength(1)
  })

  it('treats a thrown error as the same settled outcome', async () => {
    const { store, detected, named, at } = loaded(strongThread())

    // NOT a stand-in for a transport failure. `client.ts` is explicit that a
    // transport failure ARRIVES as `{ ok: false, failure: 'transport' }`; a
    // throw is programmer error the client did not catch, and retrying an
    // unclassified fault on a paid path would just fault twice.
    const throwing = {
      run: async () => {
        throw new Error('socket hang up')
      },
    }

    await composeOffer(store, throwing, detected, named, at)
    expect(store.attemptedOffer(named.signature)).toBe(true)
    expect(store.isComposing(named.signature)).toBe(false)

    const second = new FakeModelClient([ok])
    await composeOffer(store, second, detected, named, at)
    expect(second.calls).toHaveLength(0)
  })
})

/**
 * A call that did not COMPLETE is not an answer, and must not settle the thread.
 *
 * The defect, observed live: `model_call_record` holds
 * `offer | claude-opus-5 | 11179ms | transport` against a thread somebody was
 * really working on. `attemptedOffer` latched, and that person never got an
 * offer for the life of the buffer, with nothing on screen saying why.
 */
describe('a call that never arrived is retried, exactly once', () => {
  it('retries a transport failure and composes on the second attempt', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'socket hang up' },
      ok,
    ])

    await composeOffer(store, model, detected, named, at)

    expect(model.calls).toHaveLength(2)
    expect(store.offerFor(named.signature)?.title).toBe(OFFER.title)
    expect(store.isComposing(named.signature)).toBe(false)
  })

  it('stops at two, and never asks again however many polls arrive', async () => {
    // The bound is the whole design. An unbounded retry fired by a poll loop
    // against a paid API is worse than the bug — that is the sixty-call defect.
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'ECONNRESET' },
      { kind: 'fail', failure: 'transport', detail: 'ECONNRESET' },
    ])

    for (let poll = 0; poll < 10; poll += 1) {
      await composeOffer(store, model, detected, named, at)
    }

    expect(model.calls).toHaveLength(2)
    expect(store.offerFor(named.signature)).toBeNull()
    expect(store.isComposing(named.signature)).toBe(false)
    expect(store.attemptedOffer(named.signature)).toBe(true)
  })

  it('does not retry a refusal, which is a real answer', async () => {
    // The retry must be keyed on "did the call complete", not on "did we get
    // an offer". A refusal reproduced twice is money spent to be told the same
    // thing, and it is the case `recoveryFor` already calls terminal.
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    await composeOffer(store, model, detected, named, at)

    expect(model.calls).toHaveLength(1)
  })

  it('does not let two polls turn one retry into four calls', async () => {
    // The concurrency claim, stated as a test: the retry lives INSIDE the
    // in-flight marker's critical section. `startComposing` records the attempt
    // synchronously before the first await, so the second poll returns at the
    // `attemptedOffer` guard and the two attempts are sequential within one
    // invocation — never two invocations retrying in parallel.
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'socket hang up' },
      ok,
    ])

    await Promise.all([
      composeOffer(store, model, detected, named, at),
      composeOffer(store, model, detected, named, at),
      composeOffer(store, model, detected, named, at),
    ])

    expect(model.calls).toHaveLength(2)
    expect(model.pendingReplies).toBe(0)
    expect(store.offerFor(named.signature)?.title).toBe(OFFER.title)
  })

  it('a retry that lands after a clear leaves nothing behind', async () => {
    // Two attempts is twice as long a window for somebody to decline in. The
    // buffer must still refuse the result — an offer that outlives "no thanks"
    // is the profile the whole object exists to refuse.
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'socket hang up' },
      ok,
    ])

    const composing = composeOffer(store, model, detected, named, at)
    store.clear()
    await composing

    expect(store.offerFor(named.signature)).toBeNull()
    expect(store.attemptedOffer(named.signature)).toBe(false)
  })

  /**
   * The half the test above walked straight past.
   *
   * Asserting that nothing was WRITTEN is not the same as asserting that
   * nothing was SENT, and the second attempt is an outbound call carrying this
   * person's page titles and the searches they typed. `clear()` is what runs
   * when somebody accepts an offer or turns one down — so the buffer these
   * inputs came from has been thrown away, and every other path in this design
   * refuses even to leave a trace of one. A fresh transmission is stronger than
   * a trace, and before the retry existed there was no second call to make.
   *
   * `model.calls` is therefore the assertion, and the reply script is left one
   * short on purpose: `pendingReplies` says the second call was never reached
   * rather than merely never recorded.
   */
  it('makes no second call about a buffer that has been forgotten', async () => {
    const { store, detected, named, at } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'socket hang up' },
      ok,
    ])

    const composing = composeOffer(store, model, detected, named, at)
    store.clear()
    await composing

    expect(model.calls).toHaveLength(1)
    expect(model.pendingReplies).toBe(1)
  })

  it('does not settle a later poll´s call as its own when it gives up', async () => {
    // A clear un-latches `attemptedOffers`, so the next poll starts a genuinely
    // new attempt under the same signature — about new browsing, on a buffer
    // that exists. The invocation from before the clear must not spend the new
    // buffer's budget, and must not touch its markers on the way out: settling
    // somebody else's in-flight call as failed is how a thread becomes
    // permanently unofferable with nothing saying why.
    const { store, detected, named, at } = loaded(strongThread())
    const stale = new FakeModelClient([
      { kind: 'fail', failure: 'transport', detail: 'ECONNRESET' },
      ok,
    ])

    const composing = composeOffer(store, stale, detected, named, at)
    store.clear()

    // The browsing carries on, so the same signature is detected again — this
    // time out of a buffer somebody still holds.
    for (const o of strongThread()) store.record(o, o.at)
    const later = new FakeModelClient([ok])
    await composeOffer(store, later, detected, named, at)
    await composing

    // One call from the invocation that was orphaned, one from the poll that
    // owns the buffer now. Four is what an unguarded retry produced.
    expect(stale.calls).toHaveLength(1)
    expect(later.calls).toHaveLength(1)
    expect(store.offerFor(named.signature)?.title).toBe(OFFER.title)
  })
})

describe('naming does not re-fire on every poll either', () => {
  it('calls a failing model once for a thread, not once per poll', async () => {
    const { store, detected } = loaded(strongThread())
    const model = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    for (let poll = 0; poll < 10; poll += 1) {
      await nameThread(store, model, detected)
    }

    expect(model.calls).toHaveLength(1)
    expect(store.nameFor(signatureOf(detected.terms))).toBeNull()
    expect(store.isNaming(signatureOf(detected.terms))).toBe(false)
    expect(store.attemptedNaming(signatureOf(detected.terms))).toBe(true)
  })

  it('still names a thread once, and keeps the name', async () => {
    const { store, detected } = loaded(strongThread())
    const model = new FakeModelClient([
      { kind: 'ok', value: { subject: 'parcel carrier rates', confident: true } },
    ])

    await nameThread(store, model, detected)
    await nameThread(store, model, detected)

    expect(model.calls).toHaveLength(1)
    expect(store.nameFor(signatureOf(detected.terms))?.subject).toBe('parcel carrier rates')
  })
})
