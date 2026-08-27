/**
 * The machine-wide lifecycle word: the fold's ordering, and the route the
 * menu-bar light polls.
 *
 * The fold is the only decision `src/server/intention-state.ts` adds — the
 * per-project derivation is `frontDoorRow`'s and is held by
 * `tests/front-door.test.ts` — so this file holds the ordering in both
 * directions, and holds the route to the same header posture as
 * `capture/health`. The database-backed path is deliberately not exercised
 * here: with no `AppContext` built, the route answers `sleeping` without
 * creating one, and asserting that IS the assertion that a poll never builds
 * a database.
 *
 * What this does not cover: the poller. The consumer is the tray app's Rust,
 * which no vitest file can see — `tests/reachability.test.ts` pins the route
 * as the greppable seam and says so.
 */

import { describe, expect, it } from 'vitest'

import { GET as intentionStateRoute } from '../src/app/api/intention-state/route'
import { foldIntentionStates } from '../src/server/intention-state'
import { INTENTION_STATES } from '../src/domain/intention/state'
import { CUSTOM_HEADER } from '../src/capture/transport'

describe('foldIntentionStates', () => {
  it('lets needs-you outrank everything, the way one project already does', () => {
    expect(foldIntentionStates(['sleeping', 'working', 'delegated', 'needs-you'])).toBe('needs-you')
    expect(foldIntentionStates(['delegated', 'working'])).toBe('delegated')
    expect(foldIntentionStates(['sleeping', 'working'])).toBe('working')
  })

  it('claims least when there is nothing to claim', () => {
    expect(foldIntentionStates([])).toBe('sleeping')
    expect(foldIntentionStates([null, null])).toBe('sleeping')
  })

  it('never says Done for the whole machine', () => {
    // A finished project beside a working one must not mute the working one,
    // and a machine of finished projects is a machine doing nothing.
    expect(foldIntentionStates(['done', 'working'])).toBe('working')
    expect(foldIntentionStates(['done'])).toBe('sleeping')
    expect(foldIntentionStates(['done', 'needs-you'])).toBe('needs-you')
  })
})

describe('GET /api/intention-state', () => {
  const request = (headers: Record<string, string> = {}) =>
    new Request('http://127.0.0.1:3117/api/intention-state', { headers })

  it('refuses a probe without the custom header, like capture/health', async () => {
    const response = await intentionStateRoute(request())
    expect(response.status).toBe(400)
  })

  it('answers sleeping with no database, and does not create one', async () => {
    // No test here builds an AppContext, so this is the fresh-machine path:
    // the answer claims least, and the label is INTENTION_STATES' own
    // consumer sentence rather than a word the route made up.
    const response = await intentionStateRoute(request({ [CUSTOM_HEADER]: '1' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      state: 'sleeping',
      label: INTENTION_STATES.sleeping.consumerLabel,
    })
  })
})
