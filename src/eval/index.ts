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
 * `summariseH3`'s *"at most one false stop"* rule governed nothing. ~~The two
 * additions fill `straightforward` and `structural`~~ **— struck 2026-09-01
 * ([#101](https://github.com/smukhyala/propositum/issues/101)). They filled
 * both for eleven days. `lisbon-thread` was re-classed `straightforward` when
 * the halt it predicted was ruled a false stop and removed, so `structural` is
 * empty again; `docs/todo/00-score-the-hypotheses.md` carries the owed
 * scenario, and `tests/eval.test.ts` pins the gap.** They are comparison
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
