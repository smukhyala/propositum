/**
 * Boundary 6 of 6 — the narrative line, and nothing else.
 *
 * ── This boundary produces one sentence ──────────────────────────────────
 *
 * Every other section of the ShiftReport is a deterministic rendering of
 * durable rows: completed work from the ledger, changes from the Changeset,
 * refusals from ActionIntents, gaps from captureGap events, decisions from
 * DecisionNeeded, where it stopped from AgentRun.
 *
 * That split is deliberate. **A model summarising its own ledger can soften or
 * omit**, and the brief forbids anthropomorphic fluff concealing uncertainty.
 * The narrative is a summary; the ledger underneath is the receipt.
 *
 * ── It fails open, and that has a cost ───────────────────────────────────
 *
 * If this boundary fails, the report renders without it. Nothing else is lost.
 *
 * The prototype findings (#16) flagged the other half of that: with the
 * narrative gone, the top of the re-entry screen is just a time window, which
 * is the least useful version. Failing open is right — the alternative is a
 * report that cannot be shown at all — but it is not free, and the retry policy
 * should reflect that.
 *
 * ── Why it never writes the report ───────────────────────────────────────
 *
 * The ShiftReport row is written in the APP process when the person returns,
 * never by an AgentRun. A report producible only by a live runner cannot exist
 * on `interrupted` — the outcome that most needs one.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client.js'

export interface ShiftReportInput {
  readonly objective: string
  /** Plain facts, already established from rows. The model summarises these;
   *  it does not discover them. */
  readonly completed: readonly string[]
  readonly notDone: readonly string[]
  readonly changeCount: number
  readonly refusalCount: number
  readonly gapCount: number
  readonly decisions: readonly string[]
  /** Consumer label from the stop rule, e.g. "I ran out of the time you gave
   *  me." Already human-readable — the model must not restate it. */
  readonly stoppedBecause: string | null
  /** True when the run ended by lease sweep. The end time is then the SWEEP's
   *  clock, not the lid's, and may be hours late — so the copy must hedge. */
  readonly endTimeIsApproximate: boolean
}

export const shiftReportSchema = z.object({
  narrative: z
    .string()
    .describe(
      'One or two sentences. What you got done, and the single most important thing they need to know.',
    ),
})

export type ShiftReportOutput = z.infer<typeof shiftReportSchema>

const PROMPT_VERSION = 'shift-report@1'

const SYSTEM = `Write the opening line of a handover note to someone who has just sat back down.

One or two sentences. What you got done, and the one thing they most need to know.

Rules:
- Write as "I". You are the colleague who covered their shift, not a system reporting status.
- If there is a decision waiting for them, that is the thing they most need to know. Say it.
- Do not list. The list is directly below your sentence and repeating it wastes the only line they are guaranteed to read.
- Do not reassure. If a run stopped early or missed most of the work, say so in the same plain voice you would use for success.
- Never state a precise end time you were told is approximate. "Sometime before" is honest; a specific minute you do not know is not.
- No apologies, no enthusiasm, no "Great news!". Calm and specific.`

export const shiftReportBoundary: ModelBoundary<ShiftReportInput, ShiftReportOutput> = {
  name: 'shift-report',
  promptVersion: PROMPT_VERSION,
  schema: shiftReportSchema,
  maxTokens: 512,
  buildPrompt(input) {
    const list = (label: string, items: readonly string[]) =>
      items.length ? `${label}:\n${items.map((i) => `- ${i}`).join('\n')}` : ''

    return {
      system: SYSTEM,
      user: [
        `Objective: ${input.objective}`,
        '',
        list('Completed', input.completed),
        list('Not done', input.notDone),
        list('Decisions waiting for them', input.decisions),
        '',
        `${input.changeCount} proposed change(s), ${input.refusalCount} refused action(s), ${input.gapCount} gap(s) in what I could see.`,
        input.stoppedBecause ? `Where I stopped: ${input.stoppedBecause}` : '',
        input.endTimeIsApproximate
          ? 'The end time is approximate — the machine slept and I only noticed on wake.'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  },
}
