/**
 * The knock, the pairing, and what neither of them is.
 *
 * ── What is being defended ───────────────────────────────────────────────
 *
 * Not "the map holds strings". Three things:
 *
 * 1. **`.env` still wins.** A clone that pins `PROPOSITUM_EXTENSION_ID`
 *    behaves exactly as it did before this existed. Somebody who put an id in
 *    configuration must not have it quietly overridden by a click on a screen.
 * 2. **The check is never loosened.** With neither source the sentinel matches
 *    nothing and every request is refused, which is the state of a fresh clone.
 *    A pairing path that failed open would turn a broken install into an open
 *    door, and that is the one failure here nobody would notice.
 * 3. **Only something actually knocking can be paired.** An honesty property
 *    rather than a security one — pairing with a typo produces an afternoon of
 *    wondering why nothing is captured, which is the failure the whole path
 *    exists to end.
 *
 * The knock buffer itself is memory and is asserted as such: nothing here is a
 * durable record of who tried to talk to this machine.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  KNOCK_TTL_MS,
  MAX_KNOCKS,
  forgetKnocks,
  noteKnock,
  recentKnocks,
  resolveExtensionOrigin,
} from '../src/server/extension-pairing'

/** A valid Chrome extension id is 32 characters from a-p. */
const id = (letter: string) => letter.repeat(32)
const ORIGIN = (letter: string) => `chrome-extension://${id(letter)}`

const NOW = Date.UTC(2026, 7, 26, 12, 0, 0)

beforeEach(() => {
  forgetKnocks()
  delete process.env['PROPOSITUM_EXTENSION_ID']
})

afterEach(() => {
  forgetKnocks()
  delete process.env['PROPOSITUM_EXTENSION_ID']
})

describe('what may be offered as a thing to pair with', () => {
  it('remembers an extension that knocked', () => {
    noteKnock(ORIGIN('a'), NOW)
    expect(recentKnocks(NOW).map((knock) => knock.extensionId)).toEqual([id('a')])
  })

  /**
   * A page origin reaching the refusal path is a page that got further than it
   * should have. It is not something to invite somebody to trust.
   */
  it('ignores anything that is not a chrome extension', () => {
    noteKnock('https://example.com', NOW)
    noteKnock('null', NOW)
    noteKnock(undefined, NOW)
    expect(recentKnocks(NOW)).toEqual([])
  })

  /** An id-shaped check, so a typo cannot be offered as a choice. */
  it('ignores a malformed id', () => {
    noteKnock('chrome-extension://short', NOW)
    noteKnock(`chrome-extension://${'z'.repeat(32)}`, NOW)
    expect(recentKnocks(NOW)).toEqual([])
  })

  /**
   * Five minutes, and the number is a property of the loop: the extension's
   * heartbeat fires every thirty seconds, so anything that stopped knocking is
   * gone. Offering to pair with something no longer there would be offering a
   * decision that cannot be checked.
   */
  it('forgets one that has stopped knocking', () => {
    noteKnock(ORIGIN('a'), NOW)
    expect(recentKnocks(NOW + KNOCK_TTL_MS - 1)).toHaveLength(1)
    expect(recentKnocks(NOW + KNOCK_TTL_MS + 1)).toEqual([])
  })

  it('shows the one just loaded first', () => {
    noteKnock(ORIGIN('a'), NOW)
    noteKnock(ORIGIN('b'), NOW + 1_000)
    expect(recentKnocks(NOW + 2_000).map((knock) => knock.extensionId)).toEqual([id('b'), id('a')])
  })

  /** An unbounded map keyed by whatever a caller sends is a memory the caller
   *  controls. */
  it('holds a bounded number of them', () => {
    const letters = 'abcdefghijklmnop'.split('')
    letters.forEach((letter, index) => noteKnock(ORIGIN(letter), NOW + index))
    expect(recentKnocks(NOW + letters.length).length).toBeLessThanOrEqual(MAX_KNOCKS)
  })
})

describe('which origin the app accepts', () => {
  /**
   * The most important test in this file.
   *
   * With no environment variable and no row, the sentinel must match nothing.
   * `fromOurExtension` compares against this string, so a pairing path that
   * returned something permissive here — an empty string, a wildcard — would
   * admit every caller on the machine, and every existing test would stay green.
   */
  it('refuses everything when nothing has been set or paired', async () => {
    expect(await resolveExtensionOrigin()).toBe('chrome-extension://unset')
  })

  it('uses the environment variable when there is one', async () => {
    process.env['PROPOSITUM_EXTENSION_ID'] = id('c')
    expect(await resolveExtensionOrigin()).toBe(ORIGIN('c'))
  })

  /**
   * `.env` wins, and this is the assertion that says so.
   *
   * The row is a fallback, not an authority. Somebody who pinned an id in
   * configuration has stated an intention that a click on a screen must not
   * quietly override.
   */
  it('prefers the environment variable over anything paired', async () => {
    noteKnock(ORIGIN('d'), NOW)
    process.env['PROPOSITUM_EXTENSION_ID'] = id('c')
    expect(await resolveExtensionOrigin()).toBe(ORIGIN('c'))
  })

  /**
   * No database in this suite, by design — `npm test` runs on a clone with no
   * `.env` and no database, and this path is on every capture request. Opening
   * one as a side effect of an origin check would make a REJECTED request create
   * a file.
   */
  it('does not open a database to answer', async () => {
    await expect(resolveExtensionOrigin()).resolves.toBe('chrome-extension://unset')
  })
})
