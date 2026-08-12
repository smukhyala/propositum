/**
 * The two background model calls that run while nobody asked for anything.
 *
 * Both are gated the same way and both are spending money on a thirty-second
 * timer, so what is pinned here is mostly about restraint: the bar in front of
 * the offer, one call per thread, and — the defect that shipped — a failure
 * that is remembered instead of retried on every poll forever.
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
    const grounds = groundsFor(
      detected,
      threadPagesOf(store.forUrls(detected.urls, T0 + 20 * MINUTE), detected, T0 + 20 * MINUTE),
    )

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
 * The bar itself is tested in `tests/grounds.test.ts`, not here.
 *
 * This file used to carry its own table over `groundsFor`, written against a
 * provisional copy of `grounds.ts` that existed only so this unit could compile
 * before the owning one landed. Both are gone: the real `groundsFor` reads
 * `ThreadPage`s rather than raw observations, and `tests/grounds.test.ts` covers
 * every ground firing and not firing, the sufficiency split, and the false
 * positive that must not qualify — including the two cases this table was added
 * to pin, that one query seen twice is not a refinement and that a results page
 * is not one of the pages returned to.
 *
 * What stays here is the seam: that the bar is consulted BEFORE the model, and
 * before the attempt is remembered.
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

  it('treats a thrown error as the same settled outcome', async () => {
    const { store, detected, named, at } = loaded(strongThread())

    // The stand-in for a transport error that escapes as an exception rather
    // than arriving as a BoundaryResult.
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
