/**
 * Did the person actually search, or does the URL merely contain a `?`.
 *
 * ── The defect these pin ─────────────────────────────────────────────────
 *
 * The service worker classified an ambient observation as a query with
 * `o.url.includes('?')`. So a newsletter link carrying `?utm_source=` was a
 * search, and the offer screen said *"You searched for it, then read 4 pages"*
 * to somebody who had searched for nothing.
 *
 * That is a lie in the one piece of copy the product's trust story rests on,
 * and one layer down it is worse: `searched-then-read` is an INTENT ground, and
 * intent is the group that separates pursuing a subject from having one handed
 * to you. Satisfiable by any question mark, the group separates nothing and the
 * newsletter afternoon clears the bar for offering to do work.
 *
 * These run against the extension's own plain-JS module — the same file Chrome
 * loads, because the extension has no build step on purpose.
 */

import { describe, it, expect } from 'vitest'
import { QUERY_PARAMS as EXTENSION_PARAMS, looksLikeSearch, searchTermOf } from '../extension/src/search-url.js'
import { QUERY_PARAMS as APP_PARAMS } from '../src/capture/url'

describe('a query is a real query', () => {
  it('recognises the engines', () => {
    expect(looksLikeSearch('https://www.google.com/search?q=world+models')).toBe(true)
    expect(looksLikeSearch('https://duckduckgo.com/?q=general+intuition')).toBe(true)
    expect(looksLikeSearch('https://www.bing.com/search?q=frontier+labs')).toBe(true)
  })

  it('recognises site search, which is where most real intent lives', () => {
    expect(looksLikeSearch('https://arxiv.example/search/?query=world+models')).toBe(true)
    expect(looksLikeSearch('https://shop.example/results?q=carrier+rates')).toBe(true)
  })

  it('returns the term, because the term is the useful thing', () => {
    expect(searchTermOf('https://www.google.com/search?q=world%20models')).toBe('world models')
  })
})

describe('a question mark is not a search', () => {
  /** The exact shapes that produced the false sentence. */
  it.each([
    'https://news.example.com/article?utm_source=newsletter',
    'https://news.example.com/2026/08/piece?ref=twitter',
    'https://blog.example.com/?p=1417',
    'https://app.example.com/inbox?view=unread',
    'https://shop.example.com/product/44?variant=blue',
    'https://docs.example.com/guide?page=3',
  ])('does not call %s a search', (url) => {
    expect(looksLikeSearch(url)).toBe(false)
  })

  it('does not call an empty search box a search', () => {
    // Landing on /search with nothing typed is not a statement of intent about
    // anything, and it is a very ordinary way to arrive somewhere.
    expect(looksLikeSearch('https://shop.example/search')).toBe(false)
    expect(looksLikeSearch('https://shop.example/search?q=')).toBe(false)
  })

  it('does not call a one-character value a search', () => {
    // A pagination cursor or a typo. Not a subject.
    expect(looksLikeSearch('https://shop.example/search?q=a')).toBe(false)
  })

  it('survives something that is not a URL at all', () => {
    expect(looksLikeSearch('')).toBe(false)
    expect(looksLikeSearch('about:blank#x')).toBe(false)
    expect(looksLikeSearch('not a url')).toBe(false)
  })
})

describe('the two copies of the parameter list have not drifted', () => {
  /**
   * The extension cannot import TypeScript — the whole privacy argument is that
   * the file under review is the file Chrome runs, so there is no build step to
   * import through. That leaves one duplicated constant, and this is the
   * cheapest honest way to hold it: the copy is allowed to exist and is not
   * allowed to diverge.
   */
  it('keeps the same closed list as src/capture/url.ts', () => {
    expect([...EXTENSION_PARAMS].sort()).toEqual([...APP_PARAMS].sort())
  })
})
