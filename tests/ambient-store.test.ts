/**
 * The buffer that watches when nobody asked it to.
 *
 * This is the most privacy-sensitive object in the product, so what is pinned
 * here is mostly what it must NOT do: outlive a process, grow without bound,
 * carry page text, or keep nagging after it has been told no.
 */

import { describe, it, expect } from 'vitest'
import {
  MAX_OBSERVATIONS,
  SNOOZE_MS,
  createAmbientStore,
  describePause,
  describeWork,
  hostOf,
  signatureOf,
} from '../src/server/ambient-store'
import { WINDOW_MS, detectWork } from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'

const T0 = 1_000_000
const ORIGIN = 'https://northwind.example.com'

function obs(at: number, url: string, origin = ORIGIN): AmbientObservation {
  return { at, origin, url, title: url, kind: 'navigation' }
}

describe('it is bounded, twice', () => {
  it('drops observations older than the window', () => {
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)
    store.record(obs(T0 + 10, '/b'), T0 + 10)

    expect(store.since(T0 + 10)).toHaveLength(2)
    expect(store.since(T0 + 10 + WINDOW_MS + 1)).toHaveLength(0)
  })

  it('caps total rows, because a busy hour is still "the last 30 minutes"', () => {
    const store = createAmbientStore()
    for (let i = 0; i < MAX_OBSERVATIONS + 200; i += 1) {
      store.record(obs(T0 + i, `/p${i}`), T0 + i)
    }

    expect(store.size()).toBe(MAX_OBSERVATIONS)
  })

  it('keeps the most recent when it caps, not the oldest', () => {
    const store = createAmbientStore()
    for (let i = 0; i < MAX_OBSERVATIONS + 5; i += 1) {
      store.record(obs(T0 + i, `/p${i}`), T0 + i)
    }

    const urls = store.since(T0 + MAX_OBSERVATIONS + 5).map((o) => o.url)
    expect(urls).toContain(`/p${MAX_OBSERVATIONS + 4}`)
    expect(urls).not.toContain('/p0')
  })
})

describe('it forgets when told', () => {
  it('clear drops everything', () => {
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)
    store.clear()

    expect(store.size()).toBe(0)
  })

  it('declining removes the evidence, so the same detection cannot re-fire', () => {
    // Without this, the next poll sees the same observations and offers again —
    // which is how a well-meaning prompt becomes something people mute.
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)
    store.record(obs(T0 + 1, '/b'), T0 + 1)

    store.decline(ORIGIN, T0 + 2)

    expect(store.forOrigin(ORIGIN, T0 + 3)).toHaveLength(0)
  })

  it('declining one site does not forget another', () => {
    const store = createAmbientStore()
    store.record(obs(T0, '/a', ORIGIN), T0)
    store.record(obs(T0 + 1, '/x', 'https://other.example.com'), T0 + 1)

    store.decline(ORIGIN, T0 + 2)

    expect(store.forOrigin('https://other.example.com', T0 + 3)).toHaveLength(1)
  })

  it('stays quiet about a declined origin for the snooze, then allows it again', () => {
    const store = createAmbientStore()
    store.decline(ORIGIN, T0)

    expect(store.isSnoozed(ORIGIN, T0 + SNOOZE_MS / 2)).toBe(true)
    expect(store.isSnoozed(ORIGIN, T0 + SNOOZE_MS + 1)).toBe(false)
  })

  it('a site never declined is never snoozed', () => {
    const store = createAmbientStore()
    expect(store.isSnoozed(ORIGIN, T0)).toBe(false)
  })
})

describe('accepting carries the thread, not the neighbourhood', () => {
  /**
   * The real pollution, from the Kauai session. Five pages were the thread;
   * thirty-seven were carried, because everything on google.com came along —
   * including a search for a used car and a browser warmup page.
   */
  const KAUAI = 'https://www.google.com/search?q=kauai+secret+falls'
  const TRIP = 'https://www.tripadvisor.com/secret-falls'
  const ALTIMA = 'https://www.google.com/search?q=nissan+altima'
  const WARMUP = 'https://www.google.com/warmup'

  function loaded() {
    const store = createAmbientStore()
    for (const [url, title] of [
      [KAUAI, 'kauai secret falls - Google Search'],
      [TRIP, 'Secret Falls Trail'],
      [ALTIMA, 'nissan altima - Google Search'],
      [WARMUP, 'Warmup Page'],
    ] as const) {
      const origin = new URL(url).origin
      store.record({ at: T0, origin, url, title, kind: 'navigation' }, T0)
    }
    return store
  }

  it('returns only the pages the thread was made of', () => {
    const store = loaded()
    store.rememberThread('kauai+falls', [KAUAI, TRIP])

    const carried = store.forUrls(store.pagesOfThread('kauai+falls'), T0)
    const urls = carried.map((o) => o.url)

    expect(urls).toContain(KAUAI)
    expect(urls).toContain(TRIP)
    expect(urls).not.toContain(ALTIMA)
    expect(urls).not.toContain(WARMUP)
  })

  it('does not sweep in the rest of an origin just because one page qualified', () => {
    // google.com hosted both the thread's search AND the car search. Carrying
    // by origin is what made the second one evidence for a hiking trip.
    const store = loaded()
    store.rememberThread('kauai+falls', [KAUAI, TRIP])

    const carried = store.forUrls(store.pagesOfThread('kauai+falls'), T0)
    const fromGoogle = carried.filter((o) => o.origin === 'https://www.google.com')

    expect(fromGoogle).toHaveLength(1)
  })

  it('an unknown thread carries nothing, rather than falling back to everything', () => {
    // The fallback has to be silence. A reading built on the wrong pages is
    // worse than one built on none.
    const store = loaded()

    expect(store.pagesOfThread('never-seen')).toEqual([])
    expect(store.forUrls(store.pagesOfThread('never-seen'), T0)).toEqual([])
  })
})

describe('it cannot hold page text', () => {
  it('records only the fields the detector needs', () => {
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)

    const stored = store.since(T0)[0]
    expect(stored).toBeDefined()
    expect(Object.keys(stored ?? {}).sort()).toEqual(['at', 'kind', 'origin', 'title', 'url'])
  })
})

describe('what the offer says', () => {
  /** One subject across three sites — what research actually looks like. */
  const working: AmbientObservation[] = [
    { at: T0, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'navigation' },
    { at: T0 + 1, origin: 'https://a.example', url: 'https://a.example/1', title: 'World Models Survey', kind: 'engagement', engagedMs: 5 * 60_000 },
    { at: T0 + 2, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'navigation' },
    { at: T0 + 3, origin: 'https://b.example', url: 'https://b.example/1', title: 'World Models Explained', kind: 'engagement', engagedMs: 5 * 60_000 },
    { at: T0 + 4, origin: 'https://c.example', url: 'https://c.example/1', title: 'Training World Models', kind: 'navigation' },
  ]

  it('names the SUBJECT, not the site', () => {
    const detected = detectWork(working, T0 + 5)
    expect(detected).not.toBeNull()
    if (!detected) return

    const suggestion = describeWork(detected, signatureOf(detected.terms))

    expect(suggestion.sentence.toLowerCase()).toContain('world')
    expect(suggestion.sentence.toLowerCase()).toContain('models')
  })

  it('says how many sites it ran across, because that is the evidence', () => {
    const detected = detectWork(working, T0 + 5)
    if (!detected) throw new Error('expected a detection')

    expect(describeWork(detected, signatureOf(detected.terms)).sentence).toContain('3 sites')
  })

  it('says what was seen and never what it means', () => {
    // ADR-0008: naming the subject in a sentence a person would recognise needs
    // a model, and a model on a timer is what CONTEXT.md §2 forbids.
    const detected = detectWork(working, T0 + 5)
    if (!detected) throw new Error('expected a detection')

    const suggestion = describeWork(detected, signatureOf(detected.terms))
    for (const overclaim of ['researching', 'you are trying', 'you want']) {
      expect(suggestion.sentence.toLowerCase()).not.toContain(overclaim)
    }
  })

  it('always explains why it fired', () => {
    const detected = detectWork(working, T0 + 5)
    if (!detected) throw new Error('expected a detection')

    expect(describeWork(detected, signatureOf(detected.terms)).because.length).toBeGreaterThan(0)
  })

  it('describes a pause in the person’s terms, not the clock’s', () => {
    const suggestion = describePause({ idleForMs: 5 * 60_000, workedMs: 12 * 60_000, since: T0 })

    expect(suggestion.kind).toBe('hand-off')
    expect(suggestion.because).toContain('12 minutes')
    expect(suggestion.because).toContain('5 minutes')
  })

  it('says minute, not minutes, when it is one', () => {
    const suggestion = describePause({ idleForMs: 60_000, workedMs: 60_000, since: T0 })

    expect(suggestion.because).toContain('1 minute of work')
    expect(suggestion.because).not.toContain('1 minutes')
  })

  it('strips the scheme from a host', () => {
    expect(hostOf('https://northwind.example.com')).toBe('northwind.example.com')
    expect(hostOf('http://127.0.0.1:3117')).toBe('127.0.0.1:3117')
  })
})
