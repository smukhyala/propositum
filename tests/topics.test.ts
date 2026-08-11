/**
 * Does it find the thread a person would have named instantly?
 *
 * The fixture below is a REAL recorded buffer, from the first session where
 * detection was tried in anger. The person's summary was that they had been
 * "browsing stuff on world models and projects" and that Propositum "didn't
 * realize I was searching up stuff related to world models, which I feel was
 * pretty obvious".
 *
 * It was obvious. The per-origin detector could not see it, and produced a
 * suggestion about a video call instead.
 */

import { describe, it, expect } from 'vitest'
import { PAGES_FOR_THREAD, findThreads, termsOf } from '../src/domain/detection/topics'
import type { ThreadPage } from '../src/domain/detection/topics'

const T0 = 1_786_471_000_000

function page(
  origin: string,
  url: string,
  title: string,
  engagedMinutes: number,
  searched = false,
  at = T0,
): ThreadPage {
  return {
    origin,
    url,
    title,
    terms: termsOf(title, url),
    engagedMs: engagedMinutes * 60_000,
    at,
    searched,
  }
}

/** Verbatim from `/api/capture/ambient/debug` on 2026-08-11. */
const REAL_SESSION: ThreadPage[] = [
  page('https://meet.google.com', 'https://meet.google.com/abc-defg', 'Google Meet', 27),
  page('https://chatgpt.com', 'https://chatgpt.com/c/1', '', 2),
  page(
    'https://www.google.com',
    'https://www.google.com/search?q=general+intuition',
    'general intuition - Google Search',
    0,
    true,
  ),
  page(
    'https://www.generalintuition.com',
    'https://www.generalintuition.com/',
    'General Intuition | The frontier lab for acting in space and time.',
    0,
  ),
  page(
    'https://jobs.ashbyhq.com',
    'https://jobs.ashbyhq.com/general-intuition',
    'General Intuition & Medal Jobs',
    1,
  ),
  page('https://sanjay-mukhyala.com', 'https://sanjay-mukhyala.com/projects', 'Projects', 0),
]

describe('the session that was missed', () => {
  const threads = findThreads(REAL_SESSION)

  it('finds a thread at all', () => {
    expect(threads.length).toBeGreaterThan(0)
  })

  it('the thread is General Intuition, not the video call', () => {
    const top = threads[0]
    expect(top).toBeDefined()
    if (!top) return

    expect(top.terms).toContain('general')
    expect(top.terms).toContain('intuition')
    expect(top.origins.some((o) => o.includes('meet.google.com'))).toBe(false)
  })

  it('spans several sites, which is why per-origin detection could not see it', () => {
    const top = threads[0]
    expect(top?.origins.length).toBeGreaterThanOrEqual(2)
    expect(top?.pages.length).toBeGreaterThanOrEqual(PAGES_FOR_THREAD)
  })

  it('knows it was searched for', () => {
    expect(threads[0]?.searches).toBeGreaterThanOrEqual(1)
  })

  it('the 27-minute video call forms no thread of its own', () => {
    // Not by a blocklist. "Google Meet" shares no subject with anything else,
    // and sitting in one place is structurally not following a subject.
    const meetThread = threads.find((t) => t.origins.some((o) => o.includes('meet.google.com')))
    expect(meetThread).toBeUndefined()
  })
})

describe('terms', () => {
  it('strips search-engine branding from a title', () => {
    const terms = termsOf('world models - Google Search', 'https://www.google.com/search?q=world+models')
    expect(terms.has('world')).toBe(true)
    expect(terms.has('models')).toBe(true)
    expect(terms.has('google')).toBe(false)
  })

  it('reads the subject out of a search query even with an unhelpful title', () => {
    const terms = termsOf('Search', 'https://duckduckgo.com/?q=diffusion+world+models')
    expect(terms.has('diffusion')).toBe(true)
    expect(terms.has('models')).toBe(true)
  })

  it('reads the subject out of a URL path when the title is useless', () => {
    const terms = termsOf('Loading', 'https://arxiv.org/abs/world-models-survey')
    expect(terms.has('world')).toBe(true)
    expect(terms.has('models')).toBe(true)
  })

  it('drops platform names that would otherwise bind everything together', () => {
    const terms = termsOf('Some Repo', 'https://github.com/a/b')
    expect(terms.has('github')).toBe(false)
  })

  it('drops short tokens and bare numbers', () => {
    const terms = termsOf('AI in 2026 is on', 'https://x.example/a')
    expect(terms.has('2026')).toBe(false)
    expect(terms.has('in')).toBe(false)
  })
})

describe('what must not become a thread', () => {
  it('one site read deeply is not a cross-site subject', () => {
    const pages = [
      page('https://blog.example', 'https://blog.example/a', 'Widgets and Sprockets', 10),
      page('https://blog.example', 'https://blog.example/b', 'Widgets Explained', 10),
      page('https://blog.example', 'https://blog.example/c', 'More Widgets', 10),
    ]

    expect(findThreads(pages)).toHaveLength(0)
  })

  it('two pages sharing a word is a coincidence, not a subject', () => {
    const pages = [
      page('https://a.example', 'https://a.example/1', 'Quarterly Widgets', 5),
      page('https://b.example', 'https://b.example/1', 'Widgets Weekly', 5),
    ]

    expect(findThreads(pages)).toHaveLength(0)
  })

  it('unrelated browsing produces nothing', () => {
    const pages = [
      page('https://news.example', 'https://news.example/1', 'Election Results', 5),
      page('https://recipes.example', 'https://recipes.example/1', 'Lasagne', 5),
      page('https://weather.example', 'https://weather.example/1', 'Forecast', 5),
    ]

    expect(findThreads(pages)).toHaveLength(0)
  })

  it('a page belongs to one thread only', () => {
    const pages = [
      page('https://a.example', 'https://a.example/1', 'World Models Survey', 5),
      page('https://b.example', 'https://b.example/1', 'World Models Explained', 5),
      page('https://c.example', 'https://c.example/1', 'World Models In Practice', 5),
    ]

    const threads = findThreads(pages)
    const seen = threads.flatMap((t) => t.pages.map((p) => p.url))
    expect(new Set(seen).size).toBe(seen.length)
  })
})
