/**
 * Boundary 2 of 6 — draft a HandoffContract from a SessionReading.
 *
 * ── The one thing this boundary must not do ──────────────────────────────
 *
 * It may not populate `guidance` from an inferred `constraint` claim.
 *
 * ADR-0006 made that structural: a constraint found in page text is
 * display-only and appears beside the agreement as an attributed quotation.
 * Only a human keystroke turns it into something the worker follows. This is
 * the single point where page prose could otherwise become instruction, so the
 * schema simply has no field for it — the model is never asked.
 *
 * ── And what it may not propose ──────────────────────────────────────────
 *
 * `allowedActionKinds` is absent from the output. There is no session-level
 * action grant for a `proposed ⊆ granted` check to compare against, and a
 * vacuous narrowing check is worse than none — it looks like a safeguard.
 *
 * Source narrowing IS offered, because there the subset check is real: the
 * model may propose a subset of the sources already observed this session, and
 * deterministic code verifies containment before the draft renders.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client.js'

export interface HandoffInput {
  /** Claims from the reading, already human-editable and possibly edited. */
  readonly claims: ReadonlyArray<{ kind: string; text: string; confidence?: string | undefined }>
  /** Sources actually observed this session, as `S1..Sn` handles. Same trick as
   *  evidence handles: the grammar cannot enforce referential integrity, so the
   *  model cites handles we resolve rather than ids it could fabricate. */
  readonly sources: ReadonlyArray<{ handle: string; label: string }>
  readonly documentTitle: string
}

export function handoffSchema(sourceHandles: ReadonlySet<string>) {
  return z.object({
    objective: z
      .string()
      .describe('One sentence: what Propositum should accomplish while they are away.'),
    definitionOfDone: z
      .string()
      .describe('How Propositum will know it is finished. Concrete and checkable.'),
    // No `guidance`. No `allowedActionKinds`. See the header.
    narrowedSourceHandles: z
      .array(
        z.string().refine((h) => sourceHandles.has(h), {
          message: 'must be one of the source handles shown in the prompt',
        }),
      )
      .describe(
        'The subset of sources actually needed. Omit any that are not. Never add one that was not listed.',
      ),
    suggestedTimeLimitMinutes: z
      .number()
      .int()
      .describe('A realistic time budget in minutes. The person can change it.'),
  })
}

export type HandoffOutput = z.infer<ReturnType<typeof handoffSchema>>

const PROMPT_VERSION = 'handoff@1'

const SYSTEM = `You turn a reading of someone's work session into a draft working agreement they will review before anything runs.

They will read and correct this. Make it easy to correct: be specific enough to be wrong about, rather than so hedged it says nothing.

Rules:
- The objective is what Propositum should do while they are away — not a restatement of what they were doing.
- "Done" must be checkable. "Improve the document" is not; "Commercials and Close are drafted" is.
- Narrow the sources to what is actually needed. Fewer is better; you cannot add one that was not listed.
- Suggest a time budget you would actually need. They can change it.
- Never invent a constraint or a rule. If the reading mentions one, it is theirs to restate, not yours to encode.`

export const handoffBoundary = (
  sourceHandles: ReadonlySet<string>,
): ModelBoundary<HandoffInput, HandoffOutput> => ({
  name: 'handoff',
  promptVersion: PROMPT_VERSION,
  schema: handoffSchema(sourceHandles),
  maxTokens: 2048,
  buildPrompt(input) {
    const claims = input.claims
      .map((c) => `- [${c.kind}] ${c.text}${c.confidence ? ` (${c.confidence})` : ''}`)
      .join('\n')
    const sources = input.sources.map((s) => `${s.handle} — ${s.label}`).join('\n')

    return {
      system: SYSTEM,
      user: `Document: ${input.documentTitle}\n\nWhat I understand about the session:\n${claims}\n\nSources seen this session:\n${sources}`,
    }
  },
})

export function sourceHandlesFor(sources: ReadonlyArray<{ handle: string }>): ReadonlySet<string> {
  return new Set(sources.map((s) => s.handle))
}
