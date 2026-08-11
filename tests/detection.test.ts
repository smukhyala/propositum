/**
 * When does Propositum decide you are working on something?
 *
 * This layer reverses a founding-brief exclusion, so the tests are written
 * against the two ways it can be wrong, and they are not symmetric:
 *
 *   - A MISSED detection costs a suggestion nobody sees. Annoying.
 *   - A FALSE detection interrupts someone who was reading the news, and
 *     teaches them to ignore the thing. That is the expensive one.
 *
 * So most of what is pinned here is what must NOT fire.
 */

import { describe, it, expect } from 'vitest'
import {
  ENGAGED_MS_FOR_WORK,
  PAGES_FOR_WORK,
  PAUSE_MS,
  WINDOW_MS,
  WORKED_MS_FOR_HANDOFF,
  detectPause,
  detectWork,
} from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'

const T0 = 1_000_000

function nav(at: number, url: string, origin = 'https://northwind.example.com'): AmbientObservation {
  return { at, origin, url, title: url, kind: 'navigation' }
}

function read(
  at: number,
  url: string,
  engagedMs: number,
  origin = 'https://northwind.example.com',
): AmbientObservation {
  return { at, origin, url, title: url, kind: 'engagement', engagedMs }
}

function query(at: number, url: string, origin = 'https://northwind.example.com'): AmbientObservation {
  return { at, origin, url, title: url, kind: 'query' }
}

describe('what must not be mistaken for work', () => {
  it('an empty window detects nothing', () => {
    expect(detectWork([], T0)).toBeNull()
  })

  it('one page, however long, is reading — not work', () => {
    const observations = [nav(T0, '/a'), read(T0 + 1, '/a', ENGAGED_MS_FOR_WORK * 3)]

    expect(detectWork(observations, T0 + 2)).toBeNull()
  })

  it('many pages skimmed with no engagement is browsing', () => {
    // Ten pages, no dwell past the engagement threshold. This is the news.
    const observations = Array.from({ length: 10 }, (_, i) => nav(T0 + i, `/p${i}`))

    expect(detectWork(observations, T0 + 20)).toBeNull()
  })

  it('enough pages but not enough engaged time does not fire', () => {
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK / 4),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })

  it('revisiting one page repeatedly is not three pages', () => {
    // Distinct URLs, not visit count — a refresh loop is not research.
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/a'),
      nav(T0 + 2, '/a'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK * 2),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })

  it('work that has aged out of the window is gone', () => {
    const observations = [
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK),
    ]

    // Past the LAST observation's window, not the first — the window rolls per
    // observation, so aging out the earliest proves nothing.
    expect(detectWork(observations, T0 + 3 + WINDOW_MS + 1)).toBeNull()
  })

  it('the window rolls, so old work stops counting while new work still does', () => {
    const observations = [
      // Yesterday's session, still in the buffer.
      nav(T0, '/a'),
      nav(T0 + 1, '/b'),
      nav(T0 + 2, '/c'),
      read(T0 + 3, '/a', ENGAGED_MS_FOR_WORK),
      // A single page now. Not work on its own.
      nav(T0 + WINDOW_MS + 10, '/d'),
      read(T0 + WINDOW_MS + 11, '/d', 60_000),
    ]

    // The old four are out of window; the new two are not enough.
    expect(detectWork(observations, T0 + WINDOW_MS + 12)).toBeNull()
  })

  it('does not add up activity across unrelated sites', () => {
    // Two pages here, two there. Neither is work, and the sum is not either.
    const observations = [
      nav(T0, '/a', 'https://a.example.com'),
      read(T0 + 1, '/a', ENGAGED_MS_FOR_WORK, 'https://a.example.com'),
      nav(T0 + 2, '/b', 'https://b.example.com'),
      read(T0 + 3, '/b', ENGAGED_MS_FOR_WORK, 'https://b.example.com'),
    ]

    expect(detectWork(observations, T0 + 4)).toBeNull()
  })
})

describe('what is work', () => {
  const working: AmbientObservation[] = [
    nav(T0, '/partners'),
    read(T0 + 1, '/partners', ENGAGED_MS_FOR_WORK / 2),
    nav(T0 + 2, '/tiers'),
    read(T0 + 3, '/tiers', ENGAGED_MS_FOR_WORK / 2),
    nav(T0 + 4, '/pricing'),
    read(T0 + 5, '/pricing', ENGAGED_MS_FOR_WORK / 2),
  ]

  it('several pages on one site, genuinely read', () => {
    const found = detectWork(working, T0 + 6)

    expect(found).not.toBeNull()
    expect(found?.origin).toBe('https://northwind.example.com')
    expect(found?.pages).toBeGreaterThanOrEqual(PAGES_FOR_WORK)
    expect(found?.because).toBe('pages-and-dwell')
  })

  it('a search followed by reading fires below the page threshold', () => {
    // A query is a statement of intent in a way a third click is not.
    const observations = [
      query(T0, '/search?q=partner+tiers'),
      nav(T0 + 1, '/tiers'),
      read(T0 + 2, '/tiers', 60_000),
    ]

    const found = detectWork(observations, T0 + 3)
    expect(found?.because).toBe('query-then-reading')
    expect(found?.queries).toBe(1)
  })

  it('names the page they spent longest on, not the one they landed on', () => {
    const observations = [
      nav(T0, '/index'),
      read(T0 + 1, '/index', 10_000),
      nav(T0 + 2, '/tiers'),
      read(T0 + 3, '/tiers', ENGAGED_MS_FOR_WORK),
      nav(T0 + 4, '/contact'),
      read(T0 + 5, '/contact', 5_000),
    ]

    expect(detectWork(observations, T0 + 6)?.focus).toBe('/tiers')
  })

  it('picks the site with the most engaged time when two qualify', () => {
    const busy = 'https://busy.example.com'
    const quiet = 'https://quiet.example.com'
    const observations = [
      ...[0, 1, 2].map((i) => nav(T0 + i, `/q${i}`, quiet)),
      read(T0 + 3, '/q0', ENGAGED_MS_FOR_WORK, quiet),
      ...[0, 1, 2].map((i) => nav(T0 + 10 + i, `/b${i}`, busy)),
      read(T0 + 13, '/b0', ENGAGED_MS_FOR_WORK * 3, busy),
    ]

    expect(detectWork(observations, T0 + 20)?.origin).toBe(busy)
  })

  it('reports why it fired, so the offer is never a mystery', () => {
    const found = detectWork(working, T0 + 6)

    expect(found?.because).toBeDefined()
    expect(found?.engagedMs).toBeGreaterThanOrEqual(ENGAGED_MS_FOR_WORK)
    expect(found?.since).toBe(T0)
  })
})

describe('a natural stopping point', () => {
  const worked: AmbientObservation[] = [
    nav(T0, '/partners'),
    read(T0 + 1, '/partners', WORKED_MS_FOR_HANDOFF),
  ]

  it('does not fire while they are still here', () => {
    expect(detectPause(worked, T0 + 2)).toBeNull()
  })

  it('does not fire on a short gap', () => {
    expect(detectPause(worked, T0 + PAUSE_MS / 2)).toBeNull()
  })

  it('does not offer to continue work that barely happened', () => {
    const barely = [nav(T0, '/a'), read(T0 + 1, '/a', 30_000)]

    expect(detectPause(barely, T0 + PAUSE_MS * 2)).toBeNull()
  })

  it('fires after real work followed by a real gap', () => {
    const found = detectPause(worked, T0 + PAUSE_MS + 1)

    expect(found).not.toBeNull()
    expect(found?.idleForMs).toBeGreaterThanOrEqual(PAUSE_MS)
    expect(found?.workedMs).toBeGreaterThanOrEqual(WORKED_MS_FOR_HANDOFF)
  })

  it('stops firing once everything has aged out', () => {
    // Measured from the last observation, not the first.
    expect(detectPause(worked, T0 + 1 + WINDOW_MS + 1)).toBeNull()
  })
})

describe('the detector cannot see page text', () => {
  it('has no field that could carry it', () => {
    // Structural, not a convention. If someone adds one, this fails and they
    // have to argue for it — ambient capture is metadata only.
    const observation: AmbientObservation = {
      at: T0,
      origin: 'https://northwind.example.com',
      url: '/a',
      title: 'Partners',
      kind: 'navigation',
    }

    expect(Object.keys(observation).sort()).toEqual(['at', 'kind', 'origin', 'title', 'url'])
  })
})
