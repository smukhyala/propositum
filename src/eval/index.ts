/** The scenario corpus, and the harness entry point. */

import { partnershipClean } from '../fixtures/scenarios/partnership-clean'
import { partnershipMessy } from '../fixtures/scenarios/partnership-messy'
import { monitorShortlist } from '../fixtures/scenarios/monitor-shortlist'
import { lisbonThread } from '../fixtures/scenarios/lisbon-thread'
import type { Scenario } from './scenario'

/**
 * The corpus, in the order it grew.
 *
 * Two of ADR-0007's four H3 classes were unrepresented until 2026-08-20, and
 * the consequence was sharper than a gap: with every scenario sealing
 * `shouldRaise: true`, `scoreH3` could not produce a false stop and
 * `summariseH3`'s *"at most one false stop"* rule governed nothing. The two
 * additions fill `straightforward` and `structural`, and they are comparison
 * shopping and trip planning because ADR-0018 makes those targets rather than
 * the residual false positives `grounds.ts` had them down as.
 *
 * `information-missing` is still absent, and it is absent honestly: the messy
 * partnership session already carries a 34-minute hole, so the class would need
 * a scenario where the missing thing is the point rather than the texture, and
 * nobody has written one.
 */
export const SCENARIOS: readonly Scenario[] = [
  partnershipClean,
  partnershipMessy,
  monitorShortlist,
  lisbonThread,
]

export * from './scenario'
export * from './seal'
export * from './score'
export * from './baseline'
export * from './run'
export * from './record'
export * from './offer-rate'
