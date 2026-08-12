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

import { compilePolicy } from '../src/domain/handoff/policy'
import type { AutonomyControls, ContractScope } from '../src/domain/handoff/policy'
import { authorize } from '../src/policy/gate'
import type { AuthorizedAction, RunContext } from '../src/policy/gate'
import { draftSection, readApprovedSource } from '../src/policy/tools'

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

/**
 * Nor via the offer that proposes the work in the first place.
 *
 * An offer is assembled from what Propositum noticed while watching, so it
 * carries prose about the subject — a headline, a summary of what the person
 * seemed to be doing. That prose has page-derived spans in it by construction.
 * The barrier ADR-0006 calls load-bearing is exactly this: no path, however
 * convenient, from a prose-bearing object into the function that decides what
 * the worker may touch.
 *
 * A future refactor that widened `compilePolicy` to "take the offer, it has
 * everything" would be the single change that undoes the trust boundary, and it
 * would look like tidying. This is the line that stops it compiling.
 */
compilePolicy(
  // @ts-expect-error — an offer carries prose, so it cannot reach the compiler.
  { ...scope, headline: 'Compare the partner tiers', summary: 'You read it for 11 minutes' },
  controls,
)

/**
 * The honest limit of the three assertions above.
 *
 * They rest on TypeScript's excess-property check, which fires on object
 * LITERALS. A pre-typed variable holding the same extra fields is structurally
 * assignable to `ContractScope` and would compile.
 *
 * That is not the hole it looks like, and the reason is worth writing down
 * rather than rediscovering. The guarantee is that prose cannot INFLUENCE a
 * permission decision, and that is a property of the function body, which reads
 * exactly three fields and could not consult a fourth if one arrived. The
 * compile error is what makes the rule visible at the call site — it catches
 * the refactor that decides to "just pass the offer, it has everything" — and
 * catching it there is the point. It was never a sandbox.
 */

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
