/** The scenario corpus, and the harness entry point. */

import { partnershipClean } from '../fixtures/scenarios/partnership-clean'
import { partnershipMessy } from '../fixtures/scenarios/partnership-messy'
import type { Scenario } from './scenario'

export const SCENARIOS: readonly Scenario[] = [partnershipClean, partnershipMessy]

export * from './scenario'
export * from './seal'
export * from './score'
export * from './baseline'
export * from './run'
export * from './record'
