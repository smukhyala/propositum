/** The scenario corpus, and the harness entry point. */

import { partnershipClean } from '../fixtures/scenarios/partnership-clean.js'
import { partnershipMessy } from '../fixtures/scenarios/partnership-messy.js'
import type { Scenario } from './scenario.js'

export const SCENARIOS: readonly Scenario[] = [partnershipClean, partnershipMessy]

export * from './scenario.js'
export * from './seal.js'
export * from './score.js'
export * from './baseline.js'
export * from './run.js'
export * from './record.js'
