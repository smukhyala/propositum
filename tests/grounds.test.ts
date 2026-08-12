/**
 * The second bar: enough evidence to offer to DO something.
 *
 * ADR-0009 §2 argues the whole shape, and these are the two failures it names,
 * written down so a later "simplification" to three-of-six turns red:
 *
 *   - the NEWSLETTER AFTERNOON — depth, span and breadth with no intent at all,
 *     which is somebody reading, and interrupting them is the expensive false
 *     positive ADR-0008 warns about;
 *   - the BAD SEARCH — searched, refined and came back inside ninety seconds
 *     having read nothing, which is what a search going badly looks like.
 *
 * Both pass three-of-six. Neither passes one-intent-and-two-investment.
 */

import { describe, it, expect } from 'vitest'
import { detectWork } from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'
import { STAYED_WITH_IT_MS, READ_DEEPLY_MS, groundsFor } from '../src/domain/detection/grounds'

const T0 = 1_700_000_000_000

function nav(at: number, origin: string, path: string, title: string): AmbientObservation {
  return { at, origin, url: `${origin}${path}`, title, kind: 'navigation' }
}

function query(at: number, origin: string, path: string, title: string): AmbientObservation {
  return { at, origin, url: `${origin}${path}`, title, kind: 'query' }
}

function engaged(
  at: number,
  origin: string,
  path: string,
  title: string,
  ms: number,
): AmbientObservation {
  return { at, origin, url: `${origin}${path}`, title, kind: 'engagement', engagedMs: ms }
}

/** Grounds for whatever the detector found in these observations. */
function groundsOf(observations: readonly AmbientObservation[], now: number) {
  const detected = detectWork(observations, now)
  if (!detected) throw new Error('expected a detection to build grounds from')
  return groundsFor(detected, observations, now)
}

/* ── real work ───────────────────────────────────────────────────────────── */

describe('real research clears the bar', () => {
  const now = T0 + STAYED_WITH_IT_MS + 60_000
  const observations: AmbientObservation[] = [
    query(T0, 'https://www.google.com', '/search?q=world+models', 'world models - Google Search'),
    nav(T0 + 1_000, 'https://a.example', '/world-models', 'World Models Survey'),
    engaged(T0 + 2_000, 'https://a.example', '/world-models', 'World Models Survey', READ_DEEPLY_MS + 1),
    nav(T0 + 3_000, 'https://b.example', '/world-models', 'Training World Models'),
    engaged(T0 + 4_000, 'https://b.example', '/world-models', 'Training World Models', 4 * 60_000),
    nav(now - 1_000, 'https://a.example', '/world-models-2', 'World Models, part two'),
  ]

  it('is sufficient', () => {
    expect(groundsOf(observations, now).sufficient).toBe(true)
  })

  it('says why, in sentences a person could check against their own memory', () => {
    const grounds = groundsOf(observations, now)

    expect(grounds.sentences.length).toBe(grounds.kinds.length)
    for (const sentence of grounds.sentences) {
      expect(sentence.startsWith('You ')).toBe(true)
      // A ground is a fact. A reading of the facts belongs to the offer.
      for (const overclaim of ['researching', 'you want', 'you are trying', 'probably']) {
        expect(sentence.toLowerCase()).not.toContain(overclaim)
      }
    }
  })

  it('notices the return to a site it had left', () => {
    expect(groundsOf(observations, now).kinds).toContain('came-back')
  })

  it('notices the search that was followed', () => {
    expect(groundsOf(observations, now).kinds).toContain('searched-then-read')
  })
})

/* ── the two failures the rule exists for ────────────────────────────────── */

describe('absorption alone is not enough', () => {
  /**
   * The newsletter afternoon. Three sites, deep reading, a long span — and
   * nothing anywhere that says this person went looking. Three-of-six passes
   * it. This must not.
   */
  const now = T0 + STAYED_WITH_IT_MS + 60_000
  const observations: AmbientObservation[] = [
    nav(T0, 'https://a.example', '/piece', 'The Coming Wave of World Models'),
    engaged(T0 + 100, 'https://a.example', '/piece', 'The Coming Wave of World Models', 9 * 60_000),
    nav(T0 + 200, 'https://b.example', '/reply', 'On world models, a reply'),
    engaged(T0 + 300, 'https://b.example', '/reply', 'On world models, a reply', 8 * 60_000),
    nav(now - 5_000, 'https://c.example', '/thread', 'World models thread'),
    engaged(now - 4_000, 'https://c.example', '/thread', 'World models thread', 7 * 60_000),
  ]

  it('collects investment grounds', () => {
    const grounds = groundsOf(observations, now)

    expect(grounds.kinds).toContain('read-deeply')
    expect(grounds.kinds).toContain('stayed-with-it')
    expect(grounds.kinds).toContain('followed-across')
  })

  it('is NOT sufficient, because nothing here is pursuit', () => {
    const grounds = groundsOf(observations, now)

    expect(grounds.kinds).not.toContain('searched-then-read')
    expect(grounds.kinds).not.toContain('refined-the-search')
    expect(grounds.sufficient).toBe(false)
  })
})

describe('pursuit alone is not enough either', () => {
  /**
   * A search going badly: searched, refined, went back, ninety seconds, nothing
   * read. Every intent ground and no investment.
   */
  const now = T0 + 90_000
  const observations: AmbientObservation[] = [
    query(T0, 'https://www.google.com', '/search?q=world+models', 'world models - Google Search'),
    nav(T0 + 10_000, 'https://a.example', '/world-models', 'World Models'),
    nav(T0 + 20_000, 'https://b.example', '/world-models', 'World Models, again'),
    query(T0 + 30_000, 'https://www.google.com', '/search?q=world+models+labs', 'world models labs - Google Search'),
    nav(T0 + 40_000, 'https://a.example', '/world-models-3', 'World Models, three'),
  ]

  it('collects intent grounds', () => {
    expect(groundsOf(observations, now).kinds).toContain('searched-then-read')
  })

  it('is NOT sufficient, because nothing was actually read', () => {
    const grounds = groundsOf(observations, now)

    expect(grounds.kinds).not.toContain('read-deeply')
    expect(grounds.kinds).not.toContain('stayed-with-it')
    expect(grounds.sufficient).toBe(false)
  })
})

/* ── the rule itself ─────────────────────────────────────────────────────── */

describe('the sufficiency rule is one intent and two investment', () => {
  it('one intent and one investment is not enough', () => {
    const now = T0 + 60_000
    // A SITE search, so the search page is not a third origin in its own right
    // — the point of this case is exactly two sites.
    const observations: AmbientObservation[] = [
      query(T0, 'https://a.example', '/search?q=world+models', 'world models'),
      nav(T0 + 1_000, 'https://a.example', '/world-models', 'World Models'),
      engaged(T0 + 2_000, 'https://a.example', '/world-models', 'World Models', READ_DEEPLY_MS + 1),
      nav(T0 + 3_000, 'https://b.example', '/world-models', 'World Models Explained'),
    ]

    const grounds = groundsOf(observations, now)
    expect(grounds.kinds).toContain('searched-then-read')
    expect(grounds.kinds).toContain('read-deeply')
    // Two origins, short span: no breadth and no span.
    expect(grounds.kinds).not.toContain('followed-across')
    expect(grounds.kinds).not.toContain('stayed-with-it')
    expect(grounds.sufficient).toBe(false)
  })

  it('never claims a ground it has no sentence for', () => {
    const now = T0 + STAYED_WITH_IT_MS + 60_000
    const observations: AmbientObservation[] = [
      query(T0, 'https://www.google.com', '/search?q=carrier+rates', 'carrier rates - Google Search'),
      nav(T0 + 1_000, 'https://a.example', '/carrier-rates', 'Carrier rates 2026'),
      engaged(T0 + 2_000, 'https://a.example', '/carrier-rates', 'Carrier rates 2026', 6 * 60_000),
      nav(T0 + 3_000, 'https://b.example', '/carrier-rates', 'Comparing carrier rates'),
      nav(now - 1_000, 'https://c.example', '/carrier-rates', 'Carrier rates, a table'),
    ]

    const grounds = groundsOf(observations, now)
    expect(grounds.sentences.length).toBe(grounds.kinds.length)
    expect(new Set(grounds.kinds).size).toBe(grounds.kinds.length)
  })
})
