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
import type { ModelBoundary } from '../client'

export interface PlanInput {
  readonly objective: string
  readonly definitionOfDone: string
  readonly documentTitle: string
  /** Section headings in the base version, so steps can target real sections
   *  rather than invented ones. */
  readonly sections: readonly string[]
  readonly availableSourceLabels: readonly string[]
  readonly mayDraft: boolean
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

const PROMPT_VERSION = 'plan@1'

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
    const drafting = input.mayDraft
      ? 'You may draft document text.'
      : 'You may NOT draft document text — this run is research only. Plan reading and note-taking steps only.'

    return {
      system: SYSTEM,
      user: [
        `Objective: ${input.objective}`,
        `Done means: ${input.definitionOfDone}`,
        '',
        `Document: ${input.documentTitle}`,
        `Sections: ${input.sections.join(', ') || '(none yet)'}`,
        `Sources you may read: ${input.availableSourceLabels.join(', ') || '(none)'}`,
        '',
        drafting,
      ].join('\n'),
    }
  },
}
