/**
 * Boundary 4 of 6 — one action proposal at a time.
 *
 * ── `kind` is a free string, deliberately ────────────────────────────────
 *
 * #3 verified that `z.enum()` does not survive schema transformation: the
 * allowed values reach the model as prose in a `description`, and the grammar
 * will happily emit anything.
 *
 * So typing this field as an enum would be a lie in the schema — it would
 * suggest a constraint the API does not apply, and the first `send-email` would
 * arrive as a validation error at the wrong layer.
 *
 * It is a string. The gate default-denies an unknown kind and records a refused
 * ActionIntent with `unknown_action_kind`. That is the real boundary, and it
 * costs one wasted turn.
 *
 * ── Why one action, not a batch ──────────────────────────────────────────
 *
 * Every action passes the gate individually, and each is committed as an
 * ActionIntent before any effect. Batching would mean either gating a batch
 * (so one refusal poisons the rest) or gating members after the model has
 * committed to a sequence that assumes they all pass.
 *
 * ── Raising a question is not an action ──────────────────────────────────
 *
 * `DecisionNeeded` is a separate output shape, not an ActionKind. Per
 * ADR-0007 it is not a halt and not a gate refusal — the worker declining a
 * judgment call, which the Interruption dial may or may not turn into a stop.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client.js'
import { UNTRUSTED_CONTENT_RULE } from '../untrusted.js'
import type { Datamarked } from '../untrusted.js'

export interface WorkerActionInput {
  readonly objective: string
  readonly definitionOfDone: string
  /** Unenforceable prose the human typed. Labelled as such to the model, and
   *  scored as bad work rather than a bad stop if violated. */
  readonly guidance: readonly string[]
  readonly currentStep: { ordinal: number; intent: string; targetSection?: string | undefined }
  readonly allowedActionKinds: readonly string[]
  readonly availableSources: ReadonlyArray<{ id: string; label: string }>
  /** What has already happened this run, so the model does not repeat itself. */
  readonly history: ReadonlyArray<{ kind: string; summary: string; outcome: string }>
  /** Material already read. Datamarked — a bare string will not type-check. */
  readonly gathered: ReadonlyArray<{ label: string; content: Datamarked }>
}

export const workerActionSchema = z.object({
  /** Free string on purpose — see the header. */
  kind: z
    .string()
    .describe(
      'One of: read-approved-source, read-document, draft-section. Anything else will be refused.',
    ),
  reason: z.string().describe('Why this action, now. Recorded whether or not it is permitted.'),
  approvedSourceId: z.string().optional().describe('For read-approved-source.'),
  targetSection: z.string().optional().describe('For draft-section.'),
  /** For draft-section: PROSE, not a patch. Deterministic code diffs it against
   *  the base — the model never asserts what changed, only what the text should
   *  say. */
  prose: z
    .string()
    .optional()
    .describe(
      'For draft-section: the full replacement text for that section, written out. Not a description of the change.',
    ),
  /** Raising a question instead of acting. Not an ActionKind. */
  decisionNeeded: z
    .object({
      question: z.string().describe('The decision only they can make. Phrased as a question.'),
      whyItMatters: z.string().describe('What depends on it, and why you cannot decide it.'),
    })
    .optional(),
})

export type WorkerActionOutput = z.infer<typeof workerActionSchema>

const PROMPT_VERSION = 'worker-action@1'

const SYSTEM = `You are continuing someone's work while they are away, under an agreement they ratified.

Propose exactly ONE next action, or raise a question if the next thing genuinely needs their judgment.

Rules:
- One action. Not a plan, not a batch.
- Stay inside the agreement. Anything outside it will be refused and recorded, which wastes their time budget.
- For a drafting action, write the section's full replacement text. Do not describe the change — write the prose.
- If the next step needs a decision only they can make, raise it instead of guessing. Raising a question is never the wrong call when the alternative is committing them to something.
- Guidance is theirs and is not enforced by anything. Follow it. Violating it is bad work.

${UNTRUSTED_CONTENT_RULE}`

export const workerActionBoundary: ModelBoundary<WorkerActionInput, WorkerActionOutput> = {
  name: 'worker-action',
  promptVersion: PROMPT_VERSION,
  schema: workerActionSchema,
  maxTokens: 8192,
  // Recommended for this boundary in ADR-0005: a genuine liveness signal on a
  // run nobody is watching, and drafting output can be long.
  stream: true,
  buildPrompt(input) {
    const history = input.history.length
      ? input.history.map((h) => `- ${h.kind}: ${h.summary} → ${h.outcome}`).join('\n')
      : '(nothing yet)'

    const gathered = input.gathered.length
      ? input.gathered.map((g) => `### ${g.label}\n${g.content.forPrompt}`).join('\n\n')
      : '(nothing read yet)'

    const guidance = input.guidance.length
      ? `\nTheir guidance (not enforced, but theirs):\n${input.guidance.map((g) => `- ${g}`).join('\n')}`
      : ''

    return {
      system: SYSTEM,
      user: [
        `Objective: ${input.objective}`,
        `Done means: ${input.definitionOfDone}${guidance}`,
        '',
        `Current step (${input.currentStep.ordinal}): ${input.currentStep.intent}`,
        input.currentStep.targetSection ? `Target section: ${input.currentStep.targetSection}` : '',
        '',
        `Actions you may take: ${input.allowedActionKinds.join(', ')}`,
        `Sources you may read: ${input.availableSources.map((s) => `${s.label} (${s.id})`).join(', ') || '(none)'}`,
        '',
        `What you have done so far:\n${history}`,
        '',
        `What you have read:\n${gathered}`,
      ]
        .filter(Boolean)
        .join('\n'),
    }
  },
}
