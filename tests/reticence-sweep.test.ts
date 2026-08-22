/**
 * A retention promise that nothing runs is the kind that quietly stops being
 * true, so the cutoff is computed here and asserted rather than described.
 */
import { describe, expect, it } from 'vitest'

import { RETICENCE_RETENTION_DAYS, sweepReticence } from '../src/server/reticence-sweep'

function deps(now: string) {
  const asked: string[] = []
  return {
    asked,
    reticence: {
      sweepDeclinedBefore: async (day: string) => {
        asked.push(day)
        return 3
      },
    },
    now: () => new Date(now),
  }
}

describe('the reticence sweep', () => {
  it('asks for everything last declined before thirty days ago', async () => {
    const d = deps('2026-08-22T12:00:00')

    const result = await sweepReticence(d)

    expect(RETICENCE_RETENTION_DAYS).toBe(30)
    // 2026-08-22 minus 30 days.
    expect(d.asked).toEqual(['2026-07-23'])
    expect(result.deleted).toBe(3)
  })

  it('uses a day bucket, so the cutoff carries no time of day', async () => {
    const morning = deps('2026-08-22T01:00:00')
    const evening = deps('2026-08-22T23:00:00')

    await sweepReticence(morning)
    await sweepReticence(evening)

    // Same day in, same cutoff out. A sweep whose boundary moved with the clock
    // would make retention depend on when the worker happened to start.
    expect(morning.asked).toEqual(evening.asked)
  })

  /**
   * What this pins, and what it deliberately does not.
   *
   * `sweepReticence` computes a cutoff and hands it over; the deps here are a
   * mock, so the only thing observable from this file is the STRING that was
   * asked for. That is what these cases assert: the exact cutoff for a given
   * clock reading, and — from the two days either side — that the day
   * arithmetic carries no off-by-one, so a sweep is never a day early or a day
   * late.
   *
   * Whether a row dated exactly at that cutoff is kept or deleted is a fact
   * about `sweepDeclinedBefore`'s `lt`, which no mock can demonstrate. It is
   * pinned where it lives, against a real database, by
   * `tests/reticence-store.test.ts` — "sweeps rows last declined strictly
   * before a day and keeps the cutoff day itself". Claiming it here as well
   * would be this file vouching for something it never exercises.
   */
  it('computes the cutoff as exactly thirty days back, not twenty-nine or thirty-one', async () => {
    const dayBefore = deps('2026-08-21T12:00:00')
    const onTheDay = deps('2026-08-22T12:00:00')
    const dayAfter = deps('2026-08-23T12:00:00')

    await sweepReticence(dayBefore)
    await sweepReticence(onTheDay)
    await sweepReticence(dayAfter)

    expect(dayBefore.asked).toEqual(['2026-07-22'])
    expect(onTheDay.asked).toEqual(['2026-07-23'])
    expect(dayAfter.asked).toEqual(['2026-07-24'])
  })
})
