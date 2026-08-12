/**
 * Boundary 3 of 6 — an ordered plan.
 *
 * ── A list, never a graph ────────────────────────────────────────────────
 *
 * The founding brief called ExecutionPlan "a bounded graph". ADR-0003 refuted
 * that: one worker and one reviewer cannot use dependencies or parallelism, so
 * a graph would be structure with no consumer — the speculative generality the
 * brief's own anti-overengineering rule forbids.
 *
 * The schema therefore has no `dependsOn`, and there is nowhere to put one.
 *
 * ── Why plan length is capped in the schema and again at the gate ────────
 *
 * MAX_PLAN_STEPS bounds blast radius (ADR-0004): one step is one action, and
 * each drafting step targets a distinct section, so capping steps caps how much
 * of the document a run can touch.
 *
 * `.max()` here is a PROSE HINT ONLY — verified in #3, the grammar does not
 * enforce it. Zod rejects an over-long plan client-side, and the gate refuses
 * `plan_limit_exceeded` regardless. Two checks because the first one is
 * advisory and the second one is the actual boundary.
 */

import { z } from 'zod'
import { MAX_PLAN_STEPS } from '../../domain/handoff/policy'
import type { ShiftOutcomeKind } from '../../domain/outcome/shift-outcome'
import type { ModelBoundary } from '../client'

export interface PlanInput {
  readonly objective: string
  readonly definitionOfDone: string
  /**
   * One-line facts about what this Shift is working on.
   *
   * This replaced `documentTitle` and `sections`, and the replacement is the
   * whole reason `plan@1` became `plan@2`. Two named document fields meant the
   * prompt could only ever describe a document: a run that collected shipping
   * rates or answered a question had to be handed a title and a heading list
   * anyway, and the planner would dutifully plan around them.
   *
   * The app process assembles these — `"Document: Q3 proposal"`, `"Sections:
   * Overview, Pricing"`, or nothing at all — so the same prompt serves a shift
   * that pins a document and one that pins nothing.
   */
  readonly context: readonly string[]
  /** What kind of result the ratified contract is after. Deterministic code
   *  derives it; a model never proposes it. It shapes what the plan aims at and
   *  grants nothing — see `WorkerJob.expects`. */
  readonly expects: readonly ShiftOutcomeKind[]
  readonly availableSourceLabels: readonly string[]
  readonly mayDraft: boolean
}

/**
 * How a kind reads to a worker that must not know what it is working on.
 *
 * Deliberately says what the RESULT is and never where it goes. "changes to
 * what you were given" rather than "edits to a Markdown document", because the
 * moment the prompt names the medium the planner starts planning for it.
 */
const EXPECTED_AS: Record<ShiftOutcomeKind, string> = {
  'document-changes': 'changes to the text you were given, written as prose',
  collection: 'a set of things found and kept, each one decidable on its own',
  answer: 'a written answer, resting on what you read',
  'message-draft': 'text addressed to somebody, written and not sent',
  'external-effect': 'something done out there, reported back',
}

export const planSchema = z.object({
  steps: z
    .array(
      z.object({
        intent: z
          .string()
          .describe('One action, in plain terms. "Read the Northwind pricing page."'),
        /** Present for drafting steps. Not validated against the section list —
         *  a step naming a section that does not exist is a planning error the
         *  reviewer should see, not something to silently drop. */
        targetSection: z.string().optional(),
      }),
    )
    .max(MAX_PLAN_STEPS)
    .describe(`An ordered list. At most ${MAX_PLAN_STEPS} steps. One action each.`),
})

export type PlanOutput = z.infer<typeof planSchema>

const PROMPT_VERSION = 'plan@2'

const SYSTEM = `You turn a working agreement into an ordered list of steps.

Rules:
- One action per step. If a step needs two things done, it is two steps.
- Ordered. Later steps may rely on earlier ones having happened; there is no way to express any other relationship, and you do not need one.
- Each drafting step targets ONE section. Two changes to one section is one step.
- Read before you write. A drafting step that precedes the reading it depends on will stall.
- Stop planning at the point where a decision you cannot make is required. Do not plan past it.`

export const planBoundary: ModelBoundary<PlanInput, PlanOutput> = {
  name: 'plan',
  promptVersion: PROMPT_VERSION,
  schema: planSchema,
  maxTokens: 2048,
  buildPrompt(input) {
    // "text", not "document text". The Output dial removes one ActionKind; it
    // does not know what the text was going to become, and neither should this.
    const drafting = input.mayDraft
      ? 'You may draft text.'
      : 'You may NOT draft text — this run is research only. Plan reading and note-taking steps only.'

    // Omitted entirely when the shift pins nothing. A browser handoff has no
    // document, and an absent block is honest where the old `Document: the
    // document` fallback was a sentence about a thing that did not exist.
    const working = input.context.length
      ? `What you are working with:\n${input.context.map((c) => `- ${c}`).join('\n')}\n\n`
      : ''

    const expects = input.expects.length
      ? `What this should end with:\n${input.expects.map((kind) => `- ${EXPECTED_AS[kind]}`).join('\n')}\n\n`
      : ''

    return {
      system: SYSTEM,
      user:
        `Objective: ${input.objective}\n` +
        `Done means: ${input.definitionOfDone}\n\n` +
        working +
        `Sources you may read: ${input.availableSourceLabels.join(', ') || '(none)'}\n\n` +
        expects +
        drafting,
    }
  },
}
