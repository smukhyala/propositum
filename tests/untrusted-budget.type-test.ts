/**
 * Compile-time proofs about the second budget. This file is never run.
 *
 * Named `.type-test.ts` rather than `.test.ts` so Vitest ignores it while
 * `tsc --noEmit` still checks it. `npm run typecheck` IS the assertion, and
 * each `@ts-expect-error` asserts that the following line does NOT compile — if
 * a change ever makes one legal, TypeScript reports the now-unused directive as
 * an error and the typecheck fails.
 *
 * ── What is being proved, and why it needs a compile-time proof ─────────
 *
 * ADR-0006 rests on `Datamarked` having ONE construction site: page text
 * reaching a prompt undatamarked is a compile error, not a review note. Adding
 * a second, much larger budget for accessibility trees is exactly the change
 * that would tempt someone to add a second brand beside it — and the moment
 * there are two, some prompt builder accepts `Datamarked | SnapshotDatamarked`
 * to keep both callers happy, and the next one accepts `string` as well.
 *
 * So the properties below are not stylistic. They are the guarantee itself:
 *
 *   1. a bare `string` is still not a `Datamarked`, anywhere;
 *   2. a snapshot is the SAME type as an excerpt, so there is nothing to widen;
 *   3. the budget is a NAME from a closed set, not a number a caller invents.
 */

import { datamark, EXCERPT_BUDGET_CHARS, SNAPSHOT_BUDGET_CHARS } from '../src/model/untrusted'
import type { Datamarked, RetentionBudget } from '../src/model/untrusted'

const excerpt: Datamarked = datamark('article text')
const snapshot: Datamarked = datamark('button "Send" [ref=e12]', { budget: 'snapshot' })

/** Both budgets produce one type, so anything accepting `Datamarked` takes either. */
function acceptsMarked(_d: Datamarked): void {}
acceptsMarked(excerpt)
acceptsMarked(snapshot)

/** ...and assignment works in both directions, which is what "same brand" means. */
const eitherWay: Datamarked = snapshot
acceptsMarked(eitherWay)

// A bare string is still not a Datamarked. This is the whole of ADR-0006 and
// the budget parameter must not have spent it.
// @ts-expect-error — raw page text cannot reach a prompt builder
acceptsMarked('button "Send" [ref=e12]')

// Nor is an object that merely has the right visible fields. The brand is a
// `unique symbol` the module never exports, so it cannot be forged structurally.
// @ts-expect-error — the brand is not structural
acceptsMarked({ forPrompt: 'x', sanitized: 'x', removed: [] })

// The budget is a name from a closed set. A raw number would make the budget a
// caller's decision, which is precisely what "a product constant, not a tuning
// knob" denies — and a third budget could then be invented at a call site with
// no doc change and nobody the wiser.
// @ts-expect-error — a budget is a published promise, not a number
datamark('tree', { budget: 100_000 })

// @ts-expect-error — and not an unpublished name either
datamark('tree', { budget: 'whatever-fits' })

/** The names that do exist, proved exhaustive. */
const budgets: readonly RetentionBudget[] = ['excerpt', 'snapshot']
for (const budget of budgets) datamark('text', { budget })

/**
 * The two constants are separate values and stay that way.
 *
 * `as number` defeats the literal-type narrowing that would otherwise make this
 * comparison a compile error in its own right; the point being made is that two
 * distinct constants exist to be compared, not what they currently equal.
 */
const twoBudgetsExist: boolean = (EXCERPT_BUDGET_CHARS as number) !== (SNAPSHOT_BUDGET_CHARS as number)
void twoBudgetsExist
