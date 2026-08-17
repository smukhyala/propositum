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
const MINUTE = 60_000
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

/**
 * Scroll survives the buffer, including the one place a row is rewritten.
 *
 * `withCarriedTitle` is the only function that returns a DIFFERENT observation
 * from the one it was handed, and it does it by spreading. An engagement is both
 * the only kind that can receive a carried title and the only kind that carries a
 * scroll fraction, so those two meet on exactly the same rows — and a future
 * rewrite of that spread into an explicit field list would drop scroll from
 * every page that was being read hardest, silently, because nothing consults the
 * field yet and no other test would go red.
 */
describe('it carries how far down the page they got', () => {
  const engaged = (at: number, url: string, scrollFraction: number, title = url): AmbientObservation => ({
    at,
    origin: ORIGIN,
    url,
    title,
    kind: 'engagement',
    engagedMs: 45_000,
    scrollFraction,
  })

  it('holds it unchanged through record and since', () => {
    const store = createAmbientStore()
    store.record(engaged(T0, '/a', 0.62), T0)

    expect(store.since(T0).map((o) => o.scrollFraction)).toEqual([0.62])
  })

  it('keeps it when a titleless engagement inherits a title', () => {
    // The rewrite path. The engagement arrives with no title, takes the
    // navigation's, and must still be the row it was in every other respect.
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)
    store.record(engaged(T0 + 1_000, '/a', 0.81, ''), T0 + 1_000)

    const carried = store.since(T0 + 1_000).find((o) => o.kind === 'engagement')

    expect(carried?.title).toBe('/a')
    expect(carried?.scrollFraction).toBe(0.81)
    expect(carried?.engagedMs).toBe(45_000)
  })

  it('leaves it absent on the kinds that have none', () => {
    // A navigation has nothing to say about scrolling, and absent must not
    // become zero — zero is a real reading.
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)

    expect(store.since(T0)[0]?.scrollFraction).toBeUndefined()
  })

  it('is forgotten with everything else', () => {
    // It is metadata about somebody's reading, so it lives under the same rules
    // as the rest of the buffer and gets no exemption from clear().
    const store = createAmbientStore()
    store.record(engaged(T0, '/a', 0.62), T0)
    store.clear()

    expect(store.since(T0)).toEqual([])
  })

  it('goes out of the window with the row it sits on', () => {
    const store = createAmbientStore()
    store.record(engaged(T0, '/a', 0.62), T0)

    expect(store.since(T0 + WINDOW_MS + 1)).toEqual([])
  })

  it('is carried into a session by the paths that fold the buffer in', () => {
    // `forOrigin` and `forUrls` are what the accept path reads, so a field the
    // buffer holds and those drop would be a signal that exists only until
    // somebody says yes.
    const store = createAmbientStore()
    store.record(engaged(T0, '/a', 0.62), T0)

    expect(store.forOrigin(ORIGIN, T0).map((o) => o.scrollFraction)).toEqual([0.62])
    expect(store.forUrls(['/a'], T0).map((o) => o.scrollFraction)).toEqual([0.62])
  })
})

describe('it forgets when told', () => {
  it('clear drops everything', () => {
    const store = createAmbientStore()
    store.record(obs(T0, '/a'), T0)
    store.clear()

    expect(store.size()).toBe(0)
  })

  it('clear drops what a model worked out, not only what was watched', () => {
    // A name and an offer are statements about what somebody appeared to be
    // doing. One that outlives the session start meant to fold it in — or a
    // decline — is the profile this object exists to refuse.
    const store = createAmbientStore()
    store.startNaming('sig')
    store.remember({ signature: 'sig', subject: 'parcel carrier rates', confident: true })
    store.startComposing('sig')
    store.rememberOffer('sig', {
      signature: 'sig',
      promptVersion: 'offer@1',
      title: 'Compare those carrier rates',
      rationale: 'You searched, then read three of them.',
      outline: ['Pull the rates'],
      produces: 'One table',
      excludes: [],
      expects: ['collection'],
      grounds: { kinds: [], sufficient: true, sentences: [] },
      confident: true,
    })
    store.rememberThread('sig', ['https://example.com/a'])

    store.clear()

    expect(store.nameFor('sig')).toBeNull()
    expect(store.offerFor('sig')).toBeNull()
    expect(store.pagesOfThread('sig')).toEqual([])
    // ...and the thread may be asked about again, because whatever browsing
    // comes after a session start or a decline is genuinely new.
    expect(store.attemptedNaming('sig')).toBe(false)
    expect(store.attemptedOffer('sig')).toBe(false)
  })

  it('a call that lands after a clear is dropped, not written back', () => {
    // A model call takes about fifteen seconds and a person can decline inside
    // it. Without this, "nothing was kept" would be true for a quarter of a
    // minute and then quietly stop being true.
    const store = createAmbientStore()
    store.startNaming('sig')
    store.clear()
    store.remember({ signature: 'sig', subject: 'parcel carrier rates', confident: true })

    expect(store.nameFor('sig')).toBeNull()
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

/**
 * The page read hardest was contributing the weakest signal.
 *
 * `content.js` sends a title on a navigation and not on an engagement. Inside
 * the window that costs nothing — `pagesOf` keeps the best title per URL — but
 * once the navigation ages out, a page still being read reports minutes of
 * dwell under an empty name and `termsOf('', url)` falls back to the URL alone.
 *
 * Observed: `robot-colosseum.github.io` held three engaged minutes, the most of
 * anything in the buffer, with an empty title.
 */
describe('a title carried forward, and only from inside the window', () => {
  const PAGE = 'https://robot-colosseum.github.io/benchmark'
  const TITLE = 'RLBench Colosseum manipulation benchmark'
  const ORIGIN_B = 'https://robot-colosseum.github.io'

  function titled(at: number, title: string, kind: AmbientObservation['kind'], engagedMs?: number): AmbientObservation {
    return {
      at,
      origin: ORIGIN_B,
      url: PAGE,
      title,
      kind,
      ...(engagedMs === undefined ? {} : { engagedMs }),
    }
  }

  it('gives a titleless report the title the same URL already had', () => {
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(titled(T0 + 1000, '', 'engagement', 60_000), T0 + 1000)

    expect(store.since(T0 + 1000).map((o) => o.title)).toEqual([TITLE, TITLE])
  })

  it('does not lend a title to a different URL', () => {
    // The buffer is keyed by URL and nothing else. A page that happens to be on
    // the same site is a different page, and naming it after its neighbour
    // would invent a term set out of nothing.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(
      { at: T0 + 1, origin: ORIGIN_B, url: `${PAGE}/other`, title: '', kind: 'engagement', engagedMs: 60_000 },
      T0 + 1,
    )

    expect(store.since(T0 + 1)[1]?.title).toBe('')
  })

  it('carries nothing once the titled observation has aged out', () => {
    // The privacy shape, as an assertion. Nothing outside the window may be
    // consulted, so a page whose navigation has expired keeps an empty title —
    // that is the correct outcome, not a gap to be plugged with a longer-lived
    // structure.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)

    const later = T0 + WINDOW_MS + 1
    store.record(titled(later, '', 'engagement', 60_000), later)

    const held = store.since(later)
    expect(held).toHaveLength(1)
    expect(held[0]?.title).toBe('')
  })

  it('keeps the reading legible after the navigation itself has expired', () => {
    // The live defect, end to end. The navigation ages out; the engagement that
    // copied its title while both were in the window is still here, so the
    // detector still knows what the page is about.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(titled(T0 + MINUTE, '', 'engagement', 3 * MINUTE), T0 + MINUTE)

    const afterExpiry = T0 + WINDOW_MS + MINUTE / 2
    const held = store.since(afterExpiry)

    expect(held.map((o) => o.url)).toEqual([PAGE])
    expect(held[0]?.title).toBe(TITLE)
  })

  it('forgets a carried title with everything else', () => {
    // Nothing survives `clear()`. If a title map existed anywhere, this is
    // where it would show.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.clear()

    store.record(titled(T0 + 1, '', 'engagement', 60_000), T0 + 1)

    expect(store.since(T0 + 1)[0]?.title).toBe('')
  })

  it('forgets a carried title when the origin is declined', () => {
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.decline(ORIGIN_B, T0 + 1)

    store.record(titled(T0 + 2, '', 'engagement', 60_000), T0 + 2)

    expect(store.since(T0 + 2)[0]?.title).toBe('')
  })

  it('is not exempt from the row cap', () => {
    // The carried title lives on an ordinary row, so an ordinary row's bounds
    // apply. Pushed past `MAX_OBSERVATIONS` it goes, and there is nothing left
    // to copy from.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    for (let i = 1; i <= MAX_OBSERVATIONS; i += 1) {
      store.record(obs(T0 + i, `/p${i}`), T0 + i)
    }

    const at = T0 + MAX_OBSERVATIONS + 1
    store.record(titled(at, '', 'engagement', 60_000), at)

    expect(store.size()).toBe(MAX_OBSERVATIONS)
    expect(store.since(at).filter((o) => o.url === PAGE)).toHaveLength(1)
    expect(store.since(at).find((o) => o.url === PAGE)?.title).toBe('')
  })

  /**
   * The bound ADR-0008 states, tested as a duration rather than as a hop.
   *
   * A copy used to be a valid source for the next copy, so a page that kept
   * reporting kept its title alive without limit: one navigation at 10:00 and a
   * titleless engagement every ten minutes held that title for three hours,
   * six times the window. ADR-0008 says the buffer is bounded by a 30-minute
   * window AND a 500-row cap and names the title as one of the four things it
   * holds; an unbounded title is that row being false.
   */
  it('does not let a carried title carry itself onward for ever', () => {
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)

    // Three hours of a tab left open and read, reporting every ten minutes.
    for (let step = 1; step <= 18; step += 1) {
      const at = T0 + step * 10 * MINUTE
      store.record(titled(at, '', 'engagement', 60_000), at)
    }

    const long = T0 + 180 * MINUTE
    expect(store.since(long).map((o) => o.title)).toEqual(['', '', '', ''])
  })

  it('will not take a title from a row that only has a carried one', () => {
    // The hop, isolated. The engagement at +1s holds a copy; the engagement
    // after it must not read that copy, because a copy that can be copied is
    // the chain again by a longer road.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(titled(T0 + 1000, '', 'engagement', 60_000), T0 + 1000)

    const afterExpiry = T0 + WINDOW_MS + 1000
    store.record(titled(afterExpiry, '', 'engagement', 120_000), afterExpiry)

    const held = store.since(afterExpiry)
    expect(held.map((o) => o.title)).toEqual([TITLE, ''])
  })

  it('does not carry one onto a navigation, which would make it a source again', () => {
    // The half that does the proving. A navigation always arrives titled from
    // `content.js`, so a titleless one is a page that genuinely had no title —
    // and filling it in would put a row into the buffer that other rows are
    // allowed to copy from.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(titled(T0 + 1000, '', 'navigation'), T0 + 1000)

    expect(store.since(T0 + 1000)[1]?.title).toBe('')
  })

  it('still records only the fields the detector needs when it carries one', () => {
    // The carry copies a title onto a new object. It must not smuggle a field
    // the shape test at the bottom of this file forbids.
    const store = createAmbientStore()
    store.record(titled(T0, TITLE, 'navigation'), T0)
    store.record(titled(T0 + 1, '', 'engagement', 60_000), T0 + 1)

    const carried = store.since(T0 + 1)[1]
    expect(Object.keys(carried ?? {}).sort()).toEqual(['at', 'engagedMs', 'kind', 'origin', 'title', 'url'])
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

    const suggestion = describeWork(detected, signatureOf(detected.terms))

    // Amended 2026-08-17. This asserted the count on `sentence`, and its own
    // reason — *because that is the evidence* — names the field it should have
    // been reading. `sentence` says what the subject is; `because` says what was
    // seen. They are rendered one directly above the other on the front door and
    // concatenated by the extension badge, so the count on both read as "across
    // 4 sites." immediately above "read 4 pages across 4 sites."
    expect(suggestion.because).toContain('3 sites')
    expect(suggestion.sentence).not.toContain('3 sites')
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

/**
 * A call that lands after the buffer was forgotten must leave no trace.
 *
 * `remember` and `rememberOffer` already dropped a late SUCCESS. The finish
 * paths did not drop a late FAILURE — they recorded the attempt unconditionally,
 * so a signature could be marked "already tried" against a buffer that no longer
 * existed, and every later thread with those terms was silently unnameable for
 * the lifetime of the process.
 *
 * Invisible in the ordinary way: a thread that never gets a name reads exactly
 * like a thread the model was not confident about.
 */
describe('a call landing after the buffer was cleared', () => {
  it('does not mark a signature attempted once naming is forgotten', () => {
    const store = createAmbientStore()
    store.startNaming('parcel+rates')
    expect(store.attemptedNaming('parcel+rates')).toBe(true)

    // The person accepted an offer, or declined one. Everything in flight is
    // now about work that has already been resolved.
    store.clear()
    expect(store.attemptedNaming('parcel+rates')).toBe(false)

    // The call fails and lands late.
    store.finishNaming('parcel+rates')

    expect(store.attemptedNaming('parcel+rates')).toBe(false)
    expect(store.isNaming('parcel+rates')).toBe(false)
  })

  it('does not mark a signature attempted once composing is forgotten', () => {
    const store = createAmbientStore()
    store.startComposing('parcel+rates')
    store.clear()

    store.finishComposing('parcel+rates')

    expect(store.attemptedOffer('parcel+rates')).toBe(false)
    expect(store.isComposing('parcel+rates')).toBe(false)
  })

  it('still records an attempt on the ordinary path, so a failure is not retried forever', () => {
    const store = createAmbientStore()
    store.startNaming('parcel+rates')
    store.finishNaming('parcel+rates')

    expect(store.attemptedNaming('parcel+rates')).toBe(true)
    expect(store.isNaming('parcel+rates')).toBe(false)
  })
})
