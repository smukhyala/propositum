/**
 * What the calendar does, and — mostly — what it does not do.
 *
 * ── The weighting of this file is deliberate ─────────────────────────────
 *
 * Most of what is below pins ABSENCE. That is the right shape for this feature,
 * because the requirement it was built under is not *"a suggestion appears"* —
 * it is *"a person who never connects a calendar cannot tell this shipped"*.
 * Six failures collapse to one behaviour, and each of the six is a separate
 * test rather than a shared parameterised one, because each has a different
 * side effect it must NOT have: the rejected token is the only one that writes
 * a row, and the network error is the one most likely to be mistaken for it.
 *
 * ── The three things a green run here actually proves ────────────────────
 *
 *  1. The arithmetic is arithmetic. `freeWindowUntilBusy` and
 *     `suggestTimeLimit` are pure, take `now`, and cannot name a number that is
 *     not already on the dial.
 *  2. Every failure degrades to today's behaviour, and the drafted contract is
 *     byte-identical when there is nothing to say.
 *  3. A refresh token handed to this path appears in nothing that comes back
 *     out of it, and in nothing written to a console.
 *
 * What a green run does NOT prove, said here rather than left to be assumed:
 * that Google behaves as documented. Every response below is a fixture written
 * from the reference. `freebusy.query` returning something this file has not
 * imagined is a real risk, and the mitigation is `intervalsFrom`'s defensive
 * shape rather than any assertion here.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import {
  freeWindowUntilBusy,
  suggestTimeLimit,
} from '../src/domain/handoff/calendar-window'
import { TIME_LIMIT_CHOICES } from '../src/domain/handoff/policy'
import {
  CALENDAR_FREEBUSY_SCOPE,
  FREEBUSY_HORIZON_MS,
  GOOGLE,
  forgetConnection,
  readBusy,
  rowFor,
  suggestionFrom,
  withCalendarSuggestion,
} from '../src/server/calendar'
import type { CalendarDeps, CalendarRead } from '../src/server/calendar'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** A Tuesday afternoon. Fixed, because every number below is relative to it. */
const NOW = 1_786_471_000_000

/* ══════════════════════════════════════════════════ the arithmetic, pure ══ */

describe('the gap before the next busy interval', () => {
  const at = (fromNowMs: number, lengthMs: number) => ({
    startMs: NOW + fromNowMs,
    endMs: NOW + fromNowMs + lengthMs,
  })

  it('is clear when nothing is in the calendar', () => {
    expect(freeWindowUntilBusy([], NOW, FREEBUSY_HORIZON_MS)).toEqual({ kind: 'clear' })
  })

  it('is clear when everything busy is already over', () => {
    expect(freeWindowUntilBusy([at(-2 * HOUR, HOUR)], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'clear',
    })
  })

  it('is clear when the next thing is past the horizon', () => {
    const beyond = at(FREEBUSY_HORIZON_MS + MINUTE, HOUR)
    expect(freeWindowUntilBusy([beyond], NOW, FREEBUSY_HORIZON_MS)).toEqual({ kind: 'clear' })
  })

  it('is busy-now when an interval covers this instant', () => {
    expect(freeWindowUntilBusy([at(-10 * MINUTE, HOUR)], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'busy-now',
    })
  })

  it('counts a meeting starting exactly now as busy', () => {
    // The cautious direction. A meeting starting on the tick is a meeting.
    expect(freeWindowUntilBusy([at(0, HOUR)], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'busy-now',
    })
  })

  it('ignores an interval that ends exactly now', () => {
    expect(freeWindowUntilBusy([at(-HOUR, HOUR)], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'clear',
    })
  })

  it('measures to the start of the next one', () => {
    expect(freeWindowUntilBusy([at(90 * MINUTE, HOUR)], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'until',
      minutes: 90,
      startsAtMs: NOW + 90 * MINUTE,
    })
  })

  it('takes the earliest start, not the first in the array', () => {
    // Google does not promise an order and this must not depend on one.
    const found = freeWindowUntilBusy(
      [at(4 * HOUR, HOUR), at(45 * MINUTE, HOUR), at(2 * HOUR, HOUR)],
      NOW,
      FREEBUSY_HORIZON_MS,
    )

    expect(found).toEqual({ kind: 'until', minutes: 45, startsAtMs: NOW + 45 * MINUTE })
  })

  it('rounds the gap DOWN, so a suggestion cannot overrun what it came from', () => {
    const found = freeWindowUntilBusy([at(30 * MINUTE + 59_000, HOUR)], NOW, FREEBUSY_HORIZON_MS)
    expect(found).toEqual({ kind: 'until', minutes: 30, startsAtMs: NOW + 30 * MINUTE + 59_000 })
  })

  it('drops a pair it cannot interpret rather than repairing it', () => {
    const backwards = { startMs: NOW + 2 * HOUR, endMs: NOW + HOUR }
    const rubbish = { startMs: Number.NaN, endMs: NOW + HOUR }
    const real = at(3 * HOUR, HOUR)

    expect(freeWindowUntilBusy([backwards, rubbish, real], NOW, FREEBUSY_HORIZON_MS)).toEqual({
      kind: 'until',
      minutes: 180,
      startsAtMs: NOW + 3 * HOUR,
    })
  })
})

describe('the suggestion can only name a number the person could already click', () => {
  const until = (minutes: number) =>
    ({ kind: 'until', minutes, startsAtMs: NOW + minutes * MINUTE }) as const

  it('says nothing when the calendar is clear', () => {
    expect(suggestTimeLimit({ kind: 'clear' }, TIME_LIMIT_CHOICES)).toBeNull()
  })

  it('says nothing when the person is already in something', () => {
    expect(suggestTimeLimit({ kind: 'busy-now' }, TIME_LIMIT_CHOICES)).toBeNull()
  })

  it('says nothing when the gap is shorter than the smallest choice', () => {
    expect(suggestTimeLimit(until(14), TIME_LIMIT_CHOICES)).toBeNull()
  })

  it('takes the largest choice that fits inside the gap', () => {
    expect(suggestTimeLimit(until(65), TIME_LIMIT_CHOICES)).toBe(60)
    expect(suggestTimeLimit(until(119), TIME_LIMIT_CHOICES)).toBe(60)
    expect(suggestTimeLimit(until(120), TIME_LIMIT_CHOICES)).toBe(120)
  })

  it('never proposes a number that is not on the dial', () => {
    // The property the whole design rests on: pressing the calendar's button is
    // byte-for-byte the same state change as pressing a radio. Walked over
    // every gap from nothing to nine hours, a minute at a time.
    for (let minutes = 0; minutes <= 9 * 60; minutes += 1) {
      const proposed = suggestTimeLimit(until(minutes), TIME_LIMIT_CHOICES)
      if (proposed === null) continue

      expect(TIME_LIMIT_CHOICES).toContain(proposed)
      expect(proposed).toBeLessThanOrEqual(minutes)
    }
  })

  it('never exceeds the longest limit the dial offers, however empty the day', () => {
    expect(suggestTimeLimit(until(60 * 24), TIME_LIMIT_CHOICES)).toBe(240)
  })
})

/* ═══════════════════════════════════════════ the read, against a database ══ */

let dir: string
let db: Database
let repos: Repositories

/** A token that could not occur by accident, so its absence is meaningful. */
const SECRET = 'refresh-token-CANARY-4f9c2b7e-never-log-me'

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-calendar-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

beforeEach(async () => {
  await repos.calendar.forget(GOOGLE)
})

/** A `fetch` that answers from a script and records what it was asked. */
function stubFetch(script: Array<() => Promise<Response>>) {
  const calls: Array<{ url: string; body: string }> = []
  let turn = 0

  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body ?? '') })
    const next = script[turn]
    turn += 1
    if (next === undefined) throw new Error('unscripted request')
    return next()
  }) as typeof globalThis.fetch

  return { fetcher, calls }
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

function depsWith(fetcher: typeof globalThis.fetch): CalendarDeps {
  return {
    connections: repos.calendar,
    fetcher,
    config: {
      clientId: 'test-client-id.apps.googleusercontent.com',
      clientSecret: 'test-client-secret',
      redirectUri: 'http://127.0.0.1:3117/api/calendar/callback',
    },
  }
}

async function connect(scope = CALENDAR_FREEBUSY_SCOPE): Promise<void> {
  await repos.calendar.save({ provider: GOOGLE, scope, refreshToken: SECRET })
}

/** An access token, then a free/busy answer — the happy two-request script. */
function happy(busy: Array<{ start: string; end: string }>) {
  return [
    () => json({ access_token: 'access-token-abc', expires_in: 3599 }),
    () => json({ kind: 'calendar#freeBusy', calendars: { primary: { busy } } }),
  ]
}

describe('a read with a real connection', () => {
  it('returns the busy intervals it was given', async () => {
    await connect()
    const { fetcher, calls } = stubFetch(
      happy([
        {
          start: new Date(NOW + 90 * MINUTE).toISOString(),
          end: new Date(NOW + 150 * MINUTE).toISOString(),
        },
      ]),
    )

    const read = await readBusy(depsWith(fetcher), NOW)

    expect(read).toEqual({
      kind: 'busy',
      intervals: [{ startMs: NOW + 90 * MINUTE, endMs: NOW + 150 * MINUTE }],
    })

    // Two requests, in order, to the two endpoints Google documents — and the
    // second asks for `primary` and a bounded window, never a calendar list.
    expect(calls).toHaveLength(2)
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[1]!.url).toBe('https://www.googleapis.com/calendar/v3/freeBusy')

    const asked = JSON.parse(calls[1]!.body) as { items: unknown; timeMin: string; timeMax: string }
    expect(asked.items).toEqual([{ id: 'primary' }])
    expect(Date.parse(asked.timeMax) - Date.parse(asked.timeMin)).toBe(FREEBUSY_HORIZON_MS)

    // ADR-0014's requirement, asserted rather than described: the outbound
    // request contains a time window, the literal string `primary`, and an
    // access token. No URL, no page title, no subject, nothing off the ambient
    // buffer — Google gets "is this person busy between these two moments" and
    // cannot tell why anybody is asking.
    expect(Object.keys(JSON.parse(calls[1]!.body))).toEqual(['timeMin', 'timeMax', 'items'])
  })

  it('turns that into a suggestion drawn from the dial', async () => {
    await connect()
    const { fetcher } = stubFetch(
      happy([
        {
          start: new Date(NOW + 95 * MINUTE).toISOString(),
          end: new Date(NOW + 155 * MINUTE).toISOString(),
        },
      ]),
    )

    const read = await readBusy(depsWith(fetcher), NOW)

    expect(suggestionFrom(read, NOW)).toEqual({
      minutes: 60,
      busyFromMs: NOW + 95 * MINUTE,
    })
  })
})

/* ══════════════════════════════════════════════ the six ways it goes quiet ══ */

describe('every failure degrades to saying nothing', () => {
  it('absent: no connection means no request and no suggestion', async () => {
    const { fetcher, calls } = stubFetch([])

    const read = await readBusy(depsWith(fetcher), NOW)

    expect(read).toEqual({ kind: 'not-connected' })
    expect(suggestionFrom(read, NOW)).toBeNull()
    // Nothing left the machine. This is the state of a fresh checkout.
    expect(calls).toEqual([])
  })

  it('expired: an invalid_grant is recorded, once, and reported nowhere else', async () => {
    await connect()
    const { fetcher, calls } = stubFetch([
      () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400),
    ])

    const read = await readBusy(depsWith(fetcher), NOW)

    expect(read).toEqual({ kind: 'reauthorise' })
    // The point of the whole feature's failure design: even the one failure a
    // person IS told about produces no suggestion, so the handoff screen is
    // unchanged. The telling happens on the front door.
    expect(suggestionFrom(read, NOW)).toBeNull()
    expect(calls).toHaveLength(1)

    const status = await repos.calendar.status(GOOGLE)
    expect(status?.refreshRejectedAt).toBeInstanceOf(Date)
    expect(status?.refreshRejectedAt?.getTime()).toBe(NOW)

    // ...and the front door says the one thing a person can act on.
    expect(rowFor(status, true)).toEqual({ state: 'reauthorise', canReconnect: true })
  })

  it('network error: no suggestion, and NOT mistaken for a dead credential', async () => {
    await connect()
    const { fetcher } = stubFetch([() => Promise.reject(new Error('ECONNREFUSED'))])

    const read = await readBusy(depsWith(fetcher), NOW)

    expect(read).toEqual({ kind: 'unavailable' })
    expect(suggestionFrom(read, NOW)).toBeNull()

    // The distinction this test exists for. A flaky network that looked like a
    // revoked grant would send somebody to re-authorise something that was
    // working, and they would learn to ignore the notice.
    const status = await repos.calendar.status(GOOGLE)
    expect(status?.refreshRejectedAt).toBeNull()
    expect(rowFor(status, true)).toEqual({ state: 'connected', canReconnect: true })
  })

  it('a 500 from Google is also not a dead credential', async () => {
    await connect()
    const { fetcher } = stubFetch([() => json({ error: 'backendError' }, 500)])

    expect(await readBusy(depsWith(fetcher), NOW)).toEqual({ kind: 'unavailable' })
    expect((await repos.calendar.status(GOOGLE))?.refreshRejectedAt).toBeNull()
  })

  it('malformed response: a body that is not what the reference describes', async () => {
    await connect()

    for (const body of [
      { kind: 'calendar#freeBusy' },
      { calendars: null },
      { calendars: { primary: {} } },
      { calendars: { primary: { busy: 'soon' } } },
      { calendars: { primary: { busy: [{ start: 'not-a-date', end: 'nor-this' }] } } },
      { calendars: { primary: { busy: [{ start: 42, end: 43 }] } } },
    ]) {
      const { fetcher } = stubFetch([
        () => json({ access_token: 'access-token-abc' }),
        () => json(body),
      ])

      const read = await readBusy(depsWith(fetcher), NOW)

      expect(read, JSON.stringify(body)).toEqual({ kind: 'busy', intervals: [] })
      expect(suggestionFrom(read, NOW), JSON.stringify(body)).toBeNull()
    }
  })

  it('unparseable body: not JSON at all', async () => {
    await connect()
    const { fetcher } = stubFetch([
      () => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 200 })),
    ])

    expect(await readBusy(depsWith(fetcher), NOW)).toEqual({ kind: 'unavailable' })
  })

  it('empty busy[]: a free afternoon suggests nothing at all', async () => {
    await connect()
    const { fetcher } = stubFetch(happy([]))

    const read = await readBusy(depsWith(fetcher), NOW)

    // Deliberately not "suggest the maximum". An empty calendar is not evidence
    // that somebody has four hours; it is evidence that they wrote nothing down.
    expect(read).toEqual({ kind: 'busy', intervals: [] })
    expect(suggestionFrom(read, NOW)).toBeNull()
  })

  it('a stored grant wider than freebusy is refused rather than used', async () => {
    await connect('https://www.googleapis.com/auth/calendar')
    const { fetcher, calls } = stubFetch([])

    expect(await readBusy(depsWith(fetcher), NOW)).toEqual({ kind: 'unavailable' })
    // Refused before the token is even fetched, let alone sent.
    expect(calls).toEqual([])
    expect(rowFor(await repos.calendar.status(GOOGLE), true)).toEqual({
      state: 'reauthorise',
      canReconnect: true,
    })
  })
})

/* ══════════════════════════════════════════════════ the drafted contract ══ */

describe('with no calendar connected, the drafted contract is unchanged', () => {
  /**
   * The exact shape `draftContract` returns today, as it returned it before
   * ADR-0014. If this literal ever needs editing to keep the test green,
   * something below it has started adding a key.
   */
  const drafted = {
    contractId: 'ctr_1',
    objective: 'Compare the partner tiers',
    definitionOfDone: 'A one-page summary of the three tiers',
    suggestedTimeLimitMinutes: 60,
    approvedSourceIds: ['src_1', 'src_2'],
    allowedActionKinds: ['read-approved-source', 'read-document', 'draft-section'],
    documentTitle: 'Northwind',
    quotedConstraints: [],
  }

  it('is byte-identical when there is nothing to suggest', () => {
    const before = JSON.stringify(drafted)
    const after = JSON.stringify(withCalendarSuggestion(drafted, null))

    expect(after).toBe(before)
  })

  it('has the same keys in the same order, so nothing hints the feature exists', () => {
    expect(Object.keys(withCalendarSuggestion(drafted, null))).toEqual(Object.keys(drafted))
    expect('calendarSuggestion' in withCalendarSuggestion(drafted, null)).toBe(false)
  })

  it('adds exactly one key when there IS something to suggest', () => {
    const withOne = withCalendarSuggestion(drafted, { minutes: 60, busyFromMs: NOW + 95 * MINUTE })

    expect(Object.keys(withOne)).toEqual([...Object.keys(drafted), 'calendarSuggestion'])
    // ...and changes nothing else. In particular not the time limit, which is
    // still the model's clamped proposal.
    expect(withOne.suggestedTimeLimitMinutes).toBe(60)
    expect(JSON.stringify({ ...withOne, calendarSuggestion: undefined })).toBe(
      JSON.stringify({ ...drafted, calendarSuggestion: undefined }),
    )
  })

  it('carries no title, no event id and no calendar name — there is nothing to carry', () => {
    const withOne = withCalendarSuggestion(drafted, { minutes: 60, busyFromMs: NOW + 95 * MINUTE })

    // The scope returns start/end and nothing else, and the type has no field
    // for anything else. This asserts the shape rather than trusting it.
    expect(Object.keys(withOne.calendarSuggestion!)).toEqual(['minutes', 'busyFromMs'])
  })
})

/* ═════════════════════════════════════════════════════════ the secret ══ */

describe('the refresh token appears in nothing that comes back out', () => {
  /**
   * The runtime half of `tests/calendar-scope.test.ts`'s greps.
   *
   * A grep proves nobody has WRITTEN a leak. This proves nothing leaks when the
   * code actually runs — including through a failure path, which is where a
   * leak would realistically be introduced, because the instinct on a failing
   * HTTP call is to log what was sent.
   */
  function watchConsole() {
    const said: string[] = []
    const spies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        said.push(args.map((a) => String(a)).join(' '))
      }),
    )
    return {
      said,
      stop: () => spies.forEach((spy) => spy.mockRestore()),
    }
  }

  it('is not in a successful read, nor in anything logged during one', async () => {
    await connect()
    const watching = watchConsole()

    const { fetcher, calls } = stubFetch(
      happy([
        {
          start: new Date(NOW + 2 * HOUR).toISOString(),
          end: new Date(NOW + 3 * HOUR).toISOString(),
        },
      ]),
    )

    const read = await readBusy(depsWith(fetcher), NOW)
    const suggestion = suggestionFrom(read, NOW)
    watching.stop()

    expect(JSON.stringify(read)).not.toContain(SECRET)
    expect(JSON.stringify(suggestion)).not.toContain(SECRET)
    expect(watching.said.join('\n')).not.toContain(SECRET)

    // It IS on the wire, once, to Google's token endpoint — which is the whole
    // purpose of holding one. Asserted rather than assumed, so this test cannot
    // pass by the token never being used.
    expect(calls[0]!.body).toContain(encodeURIComponent(SECRET))
    expect(calls[1]!.body).not.toContain(SECRET)
  })

  it('is not in a failure, nor in anything logged during one', async () => {
    await connect()
    const watching = watchConsole()

    const { fetcher } = stubFetch([
      () => json({ error: 'invalid_grant', error_description: `token ${SECRET} revoked` }, 400),
    ])

    const read = await readBusy(depsWith(fetcher), NOW)
    watching.stop()

    // Note the fixture: Google's own error body carries the token back. Nothing
    // here may pass that on — the returned value is a bare discriminant.
    expect(JSON.stringify(read)).not.toContain(SECRET)
    expect(watching.said.join('\n')).not.toContain(SECRET)
  })

  it('is not in the status a screen can read', async () => {
    await connect()

    const status = await repos.calendar.status(GOOGLE)

    expect(JSON.stringify(status)).not.toContain(SECRET)
    // The structural half: the type has no field for it, so this is not a
    // matter of the repository remembering to leave it out.
    expect(Object.keys(status!)).toEqual([
      'provider',
      'scope',
      'connectedAt',
      'refreshRejectedAt',
    ])
  })

  it('is reachable only through the one method named for handing it over', async () => {
    await connect()

    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBe(SECRET)
    expect(await repos.calendar.refreshTokenFor('nobody')).toBeNull()
  })
})

describe('disconnecting removes the credential rather than flagging it', () => {
  it('leaves no row and no token behind', async () => {
    await connect()
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBe(SECRET)

    await repos.calendar.forget(GOOGLE)

    expect(await repos.calendar.status(GOOGLE)).toBeNull()
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBeNull()
    // ...and the front door falls back to the offer, not to an error.
    expect(rowFor(await repos.calendar.status(GOOGLE), true)).toEqual({
      state: 'not-connected',
      canReconnect: true,
    })
  })

  it('reconnecting clears a previous rejection', async () => {
    await connect()
    await repos.calendar.markRefreshRejected(GOOGLE, new Date(NOW))
    expect(rowFor(await repos.calendar.status(GOOGLE), true)).toEqual({
      state: 'reauthorise',
      canReconnect: true,
    })

    await repos.calendar.save({
      provider: GOOGLE,
      scope: CALENDAR_FREEBUSY_SCOPE,
      refreshToken: `${SECRET}-2`,
    })

    // A fresh grant is by definition not a rejected one. Leaving the timestamp
    // would leave the front door telling somebody to reconnect a calendar they
    // just reconnected.
    expect(rowFor(await repos.calendar.status(GOOGLE), true)).toEqual({
      state: 'connected',
      canReconnect: true,
    })
  })

  /**
   * The path a person actually presses, rather than the repository underneath
   * it. `forgetConnection` is `disconnectCalendar` with its three dependencies
   * handed in, which is the only way to reach the interesting case: **no client
   * id and a stored token.**
   */
  it('revokes at Google and then deletes, when there is a client id', async () => {
    await connect()
    const { fetcher, calls } = stubFetch([() => json({})])

    await forgetConnection(repos.calendar, depsWith(fetcher).config, fetcher)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://oauth2.googleapis.com/revoke')
    expect(await repos.calendar.status(GOOGLE)).toBeNull()
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBeNull()
  })

  it('deletes anyway when Google cannot be reached', async () => {
    await connect()
    const { fetcher } = stubFetch([() => Promise.reject(new Error('ECONNREFUSED'))])

    await forgetConnection(repos.calendar, depsWith(fetcher).config, fetcher)

    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBeNull()
  })

  it('deletes with NO client id, rather than orphaning the token', async () => {
    // The regression this test exists for. Blanking `GOOGLE_OAUTH_CLIENT_ID` is
    // what `.env.example` tells a person to do to switch the feature off; the
    // old code returned before the delete, so switching it off left a live
    // Google credential in SQLite with nothing in the product able to remove it.
    await connect()
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBe(SECRET)

    const { fetcher, calls } = stubFetch([])
    await forgetConnection(repos.calendar, null, fetcher)

    // Nothing was sent — a revocation is made AS the client, and there is no
    // client. The row went regardless, which is the whole point.
    expect(calls).toEqual([])
    expect(await repos.calendar.status(GOOGLE)).toBeNull()
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBeNull()
  })

  it('holds at most one connection, by the database rather than by convention', async () => {
    await connect()
    await repos.calendar.save({
      provider: GOOGLE,
      scope: CALENDAR_FREEBUSY_SCOPE,
      refreshToken: `${SECRET}-replaced`,
    })

    const rows = await db.prisma.calendarConnection.count()
    expect(rows).toBe(1)
    expect(await repos.calendar.refreshTokenFor(GOOGLE)).toBe(`${SECRET}-replaced`)
  })
})

describe('the calendar row on the front door', () => {
  it('has three states and no fourth', () => {
    expect(rowFor(null, true)).toEqual({ state: 'not-connected', canReconnect: true })
    expect(rowFor({ scope: CALENDAR_FREEBUSY_SCOPE, refreshRejectedAt: null }, true)).toEqual({
      state: 'connected',
      canReconnect: true,
    })
    expect(
      rowFor({ scope: CALENDAR_FREEBUSY_SCOPE, refreshRejectedAt: new Date(NOW) }, true),
    ).toEqual({ state: 'reauthorise', canReconnect: true })
  })

  it('reads a wider stored grant as something to reconnect, not as connected', () => {
    expect(
      rowFor({ scope: 'https://www.googleapis.com/auth/calendar', refreshRejectedAt: null }, true),
    ).toEqual({ state: 'reauthorise', canReconnect: true })
  })

  /**
   * The unconfigured half, which is where a credential used to go invisible.
   *
   * `.env.example` presents blanking `GOOGLE_OAUTH_CLIENT_ID` as the way to
   * switch this feature off, and the row used to be gated on that value before
   * the database was read at all. So a person who connected a calendar and then
   * blanked the id had a live refresh token in SQLite, no row on any screen
   * saying so, and no control anywhere that could delete it.
   */
  it('draws nothing when there is neither a client id nor a stored connection', () => {
    expect(rowFor(null, false)).toBeNull()
  })

  it('still draws a stored connection with no client id, so it can be deleted', () => {
    expect(rowFor({ scope: CALENDAR_FREEBUSY_SCOPE, refreshRejectedAt: null }, false)).toEqual({
      state: 'connected',
      canReconnect: false,
    })

    // A rejected one too. It is the state most likely to be abandoned, and it
    // is still a credential on disk.
    expect(
      rowFor({ scope: CALENDAR_FREEBUSY_SCOPE, refreshRejectedAt: new Date(NOW) }, false),
    ).toEqual({ state: 'reauthorise', canReconnect: false })
  })
})

/* ═══════════════════════════════ what a CalendarRead can and cannot become ══ */

describe('nothing but a busy read can produce a suggestion', () => {
  const reads: CalendarRead[] = [
    { kind: 'not-configured' },
    { kind: 'not-connected' },
    { kind: 'reauthorise' },
    { kind: 'unavailable' },
  ]

  it.each(reads.map((read) => [read.kind, read] as const))('%s suggests nothing', (_kind, read) => {
    expect(suggestionFrom(read, NOW)).toBeNull()
  })
})
