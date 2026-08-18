/**
 * The front door survives a broken calendar. That is the whole file.
 *
 * ── Why this needed its own file, and its own mock ───────────────────────
 *
 * Every other calendar test hands its dependencies in. `calendarRow` cannot:
 * it is the one function on this path that resolves its own — the environment
 * for the client id, `appContext` for the repository — because it is called
 * from a server component that has nothing to hand it. So the only way to make
 * its dependency FAIL is to replace the module underneath it.
 *
 * The failure being modelled is not exotic. It is: somebody pulls this commit
 * onto an existing `propositum.db`, sets `GOOGLE_OAUTH_CLIENT_ID`, and has not
 * run `prisma db push` — so `calendar_connection` does not exist and Prisma
 * throws `P2021` on the first read. Before 2026-08-18 that threw straight
 * through `src/app/page.tsx` and the ENTRY SCREEN of the product returned a
 * 500: every project, every offer, every shift, gone, because an optional
 * feature could not read an optional table. SQLITE_BUSY does the same thing
 * transiently, on a database that is otherwise fine.
 *
 * ADR-0014's fifth prohibition is the standard: *"It may not surface an error
 * where a suggestion would have been … every one of these leaves the product
 * exactly as it is today."* A page that does not render is the largest possible
 * violation of that, so the guard is an execution rather than a reading.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const appContext = vi.fn()

vi.mock('../src/server/db', () => ({ appContext }))

const { calendarRow } = await import('../src/server/calendar')

beforeEach(() => {
  appContext.mockReset()
  process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'front-door-test.apps.googleusercontent.com'
})

describe('the calendar row cannot take the screen down with it', () => {
  it('returns null when the table is missing, rather than throwing', async () => {
    // Prisma's own shape for a table that is not there.
    const missing = Object.assign(new Error('The table `main.calendar_connection` does not exist'), {
      code: 'P2021',
    })
    appContext.mockResolvedValue({
      repos: { calendar: { status: () => Promise.reject(missing) } },
    })

    await expect(calendarRow()).resolves.toBeNull()
  })

  it('returns null when the database is busy', async () => {
    appContext.mockResolvedValue({
      repos: { calendar: { status: () => Promise.reject(new Error('SQLITE_BUSY')) } },
    })

    await expect(calendarRow()).resolves.toBeNull()
  })

  it('returns null when the context itself cannot be built', async () => {
    appContext.mockRejectedValue(new Error('no database'))

    await expect(calendarRow()).resolves.toBeNull()
  })

  it('still returns the row when the read succeeds, so the null above means something', async () => {
    // The canary. Every assertion here would pass forever against a function
    // that returned null unconditionally.
    appContext.mockResolvedValue({
      repos: {
        calendar: {
          status: () =>
            Promise.resolve({
              provider: 'google',
              scope: 'https://www.googleapis.com/auth/calendar.freebusy',
              connectedAt: new Date(0),
              refreshRejectedAt: null,
            }),
        },
      },
    })

    await expect(calendarRow()).resolves.toEqual({ state: 'connected', canReconnect: true })
  })

  it('renders a stored connection even with the client id blanked back out', async () => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    appContext.mockResolvedValue({
      repos: {
        calendar: {
          status: () =>
            Promise.resolve({
              provider: 'google',
              scope: 'https://www.googleapis.com/auth/calendar.freebusy',
              connectedAt: new Date(0),
              refreshRejectedAt: null,
            }),
        },
      },
    })

    // A credential on disk is never invisible: this row is the only control in
    // the product that can delete it.
    await expect(calendarRow()).resolves.toEqual({ state: 'connected', canReconnect: false })
  })

  it('draws nothing at all on a fresh checkout', async () => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID']
    appContext.mockResolvedValue({
      repos: { calendar: { status: () => Promise.resolve(null) } },
    })

    await expect(calendarRow()).resolves.toBeNull()
  })
})
