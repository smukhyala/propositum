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
 * ── And the drift these prevent ──────────────────────────────────────────
 *
 * The rule lives once, in `src/domain/detection/topics.ts`. The extension holds
 * a hand port because it cannot import TypeScript — no build step, on purpose,
 * so the file under review is the file Chrome runs. Every case below is
 * asserted against BOTH implementations, so the port is allowed to exist and is
 * not allowed to diverge. `src/capture/url.ts` no longer has an opinion at all;
 * it defers, and one test here says so.
 */

import { describe, it, expect } from 'vitest'
import {
  SEARCH_PARAMS as EXTENSION_PARAMS,
  looksLikeSearch,
  searchQueryOf as extensionSearchQueryOf,
} from '../extension/src/search-url.js'
import { searchQueryOf } from '../src/domain/detection/topics'
import { QUERY_PARAMS, searchTermOf } from '../src/capture/url'

/** A URL and what both implementations must say about it. */
const CASES: ReadonlyArray<readonly [url: string, term: string | null]> = [
  /* real searches */
  ['https://www.google.com/search?q=world+models', 'world models'],
  ['https://duckduckgo.com/?q=general+intuition', 'general intuition'],
  ['https://www.bing.com/search?q=frontier+labs', 'frontier labs'],
  ['https://arxiv.example/search/?query=world+models', 'world models'],
  ['https://shop.example/results?q=carrier+rates', 'carrier rates'],
  ['https://www.amazon.example/s?k=luggage+scale', 'luggage scale'],
  // Case and whitespace are normalised: it is what they typed, tidied.
  ['https://www.google.com/search?q=World%20%20Models', 'world models'],

  /* a question mark, and nothing more */
  ['https://news.example.com/article?utm_source=newsletter', null],
  ['https://news.example.com/2026/08/piece?ref=twitter', null],
  ['https://blog.example.com/?p=1417', null],
  ['https://app.example.com/inbox?view=unread', null],
  ['https://shop.example.com/product/44?variant=blue', null],
  ['https://docs.example.com/guide?page=3', null],
  // A listing's page two, which is the exact shape `?s=` most often has.
  ['https://shop.example.com/?s=2', null],

  /* searches that are not searches */
  // An empty box somebody landed on is not a statement of intent.
  ['https://shop.example/search', null],
  ['https://shop.example/search?q=', null],
  // One character is a typo or a cursor, not a subject.
  ['https://shop.example/search?q=a', null],
  // Digits only: a page number wearing a search parameter's name.
  ['https://shop.example/search?q=1417', null],

  /* not a URL at all */
  ['', null],
  ['about:blank#x', null],
  ['not a url', null],
]

describe('the domain decides what a search is', () => {
  it.each(CASES)('%s', (url, term) => {
    expect(searchQueryOf(url)).toBe(term)
  })
})

describe('the extension says exactly the same thing', () => {
  it.each(CASES)('%s', (url, term) => {
    expect(extensionSearchQueryOf(url)).toBe(term)
    expect(looksLikeSearch(url)).toBe(term !== null)
  })

  it('keeps the same closed parameter list', () => {
    // Belt to the table's braces: a parameter added on one side and not the
    // other would only show up above if somebody also added a case for it.
    expect([...EXTENSION_PARAMS].sort()).toEqual(['k', 'q', 'query', 'search'])
  })
})

describe('the capture layer has no opinion of its own', () => {
  it.each(CASES)('%s', (url, term) => {
    // `searchTermOf` used to accept any of `QUERY_PARAMS` with a value longer
    // than one character, so `blog.example.com/?p=1417` was recorded as
    // `queried` and the timeline said `searched for "1417"`.
    expect(searchTermOf(url)).toBe(term)
  })

  it('still keeps a WIDER list for what may be stored', () => {
    // `cleanUrl` strips everything not on this list, so a parameter the domain
    // recognises and this one discarded would be a rule that can never fire.
    for (const param of EXTENSION_PARAMS) {
      expect(QUERY_PARAMS as readonly string[]).toContain(param)
    }
    // And it is genuinely wider: being generous here costs a longer URL,
    // being generous there costs a false offer.
    expect(QUERY_PARAMS.length).toBeGreaterThan(EXTENSION_PARAMS.length)
  })
})
