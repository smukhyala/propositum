/**
 * Reticence decays, and this is what makes that true rather than intended.
 *
 * A person who stopped caring about a subject a month ago should not still be
 * paying for having said no to it, and a reticence that only ever accumulates
 * would eventually silence the product one strand at a time. Thirty days is
 * chosen to be longer than a piece of work and shorter than a habit.
 *
 * Lives beside `sweepActionEvidence` in the worker for the reason that file
 * already argues: the worker is the only long-lived process Propositum owns,
 * and retention that runs only on a machine that restarts is the worst shape a
 * retention promise can take.
 */

import { dayBucket } from './offer-tally'
import type { OfferReticenceRepository } from '../persistence/repositories/index'

export const RETICENCE_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60_000

export interface ReticenceSweepDeps {
  readonly reticence: Pick<OfferReticenceRepository, 'sweepDeclinedBefore'>
  readonly now: () => Date
}

export async function sweepReticence(deps: ReticenceSweepDeps): Promise<{ deleted: number }> {
  const cutoff = dayBucket(deps.now().getTime() - RETICENCE_RETENTION_DAYS * DAY_MS)

  return { deleted: await deps.reticence.sweepDeclinedBefore(cutoff) }
}
