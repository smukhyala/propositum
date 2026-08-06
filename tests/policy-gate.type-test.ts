/**
 * Compile-time proofs. This file is never run.
 *
 * It is deliberately named `.type-test.ts` rather than `.test.ts` so Vitest
 * ignores it while `tsc --noEmit` still checks it. `npm run typecheck` IS the
 * assertion.
 *
 * Each `@ts-expect-error` below asserts that the following line does NOT
 * compile. If a change ever makes one of them legal, TypeScript reports the
 * now-unused directive as an error and the typecheck fails — so these fail
 * loudly in exactly the direction that matters.
 */

import { compilePolicy } from '../src/domain/handoff/policy.js'
import type { AutonomyControls, ContractScope } from '../src/domain/handoff/policy.js'
import { authorize } from '../src/policy/gate.js'
import type { AuthorizedAction, RunContext } from '../src/policy/gate.js'
import { draftSection, readApprovedSource } from '../src/policy/tools.js'

const scope: ContractScope = {
  approvedSourceIds: ['src-1'],
  allowedActionKinds: ['read-approved-source', 'draft-section'],
  baseVersionId: 'ver-1',
}

const controls: AutonomyControls = {
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
}

const run: RunContext = {
  currentStepOrdinal: 1,
  planLength: 3,
  deadlineEpochMs: 1_000_000,
  nowEpochMs: 0,
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Prose can never reach a policy decision.
//
// The single most important compile-time guarantee in the codebase. If a
// hostile page's text could influence what the worker is PERMITTED to touch —
// rather than merely what it attempts — the safety story would be worthless.
// ─────────────────────────────────────────────────────────────────────────

const statedIntent = {
  objective: 'Draft the Northwind partnership proposal',
  definitionOfDone: 'All sections complete',
  guidance: ['Do not commit to a discount'],
}

// @ts-expect-error — compilePolicy takes no StatedIntent, and must not.
compilePolicy(scope, controls, statedIntent)

// @ts-expect-error — nor smuggled in as part of the scope.
compilePolicy({ ...scope, objective: statedIntent.objective }, controls)

// @ts-expect-error — nor as part of the controls.
compilePolicy(scope, { ...controls, guidance: statedIntent.guidance })

// ─────────────────────────────────────────────────────────────────────────
// 2. Authority cannot be fabricated.
//
// `AuthorizedAction` is branded with a `unique symbol` that gate.ts never
// exports, so `authorize()` is the only construction site in the program.
// ─────────────────────────────────────────────────────────────────────────

// @ts-expect-error — a structurally similar object is not an AuthorizedAction.
const forged: AuthorizedAction<'draft-section'> = {
  kind: 'draft-section',
  params: { documentId: 'doc-1', sectionPath: 'Pricing' },
  intentId: 'intent-1',
}
void forged

// @ts-expect-error — and a tool will not accept a bare object.
draftSection({ kind: 'draft-section', params: {}, intentId: 'x' })

// @ts-expect-error — nor an unauthorized proposal.
readApprovedSource({ kind: 'read-approved-source', params: { approvedSourceId: 'src-1' } })

// ─────────────────────────────────────────────────────────────────────────
// 3. A token authorizes one kind, not all of them.
// ─────────────────────────────────────────────────────────────────────────

const result = authorize(
  compilePolicy(scope, controls),
  { kind: 'read-approved-source', params: { approvedSourceId: 'src-1' }, reason: 'r', stepOrdinal: 1 },
  run,
  'intent-1',
)

if (result.authorized) {
  // @ts-expect-error — a read token cannot be spent on a drafting tool.
  draftSection(result.action)
}

// ─────────────────────────────────────────────────────────────────────────
// 4. The compiled policy is read-only. A caller cannot widen its own permissions.
// ─────────────────────────────────────────────────────────────────────────

const policy = compilePolicy(scope, controls)

// @ts-expect-error — EnforcedPolicy fields are readonly.
policy.sourceAllowlist = new Set(['anything'])

// @ts-expect-error — including the action allowlist.
policy.actionKindAllowlist = new Set(['draft-section'])
