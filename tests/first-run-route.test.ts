/**
 * The tray's one setup read refuses a bare probe.
 *
 * `GET /api/first-run` answers one boolean the menu-bar app opens a window
 * on. The refusal is the unit-testable half: without the custom header the
 * route answers 400 before touching anything, so a hostile page's
 * no-preflight probe learns nothing — `intention-state.test.ts` set the
 * pattern and the argument is its. The happy path needs a database and is
 * covered by the tray:dev hand pass, which `tests/reachability.test.ts`
 * records by pinning this route as `firstRunState`'s one HTTP caller.
 */

import { describe, expect, it } from 'vitest'

import { GET as firstRunRoute } from '../src/app/api/first-run/route'

describe('the first-run route', () => {
  it('refuses a request without the custom header, before reading anything', async () => {
    const response = await firstRunRoute(new Request('http://127.0.0.1:3117/api/first-run'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false })
  })
})
