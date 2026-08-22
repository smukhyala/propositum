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
   * `sweepDeclinedBefore` deletes rows strictly before the day it is given —
   * that is where "strictly" is enforced. `sweepReticence` only computes the
   * cutoff and hands it over, so this is the one place that arithmetic is
   * pinned. The Task 2 review caught the identical gap in the evidence
   * sweep's test: nothing asserted the boundary, so changing `lt` to `lte` in
   * the repository would have left every test green. A row dated exactly at
   * the cutoff must survive — that is what "strictly before" means — so the
   * cutoff itself, not just its neighbourhood, has to be exact. The two extra
   * cases (one day either side) exist so an off-by-one in the day arithmetic
   * fails this test instead of shipping.
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
