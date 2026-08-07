/**
 * The baseline: the same events, dumped raw, with no structured inference.
 *
 * ── The question it isolates ─────────────────────────────────────────────
 *
 * Without a baseline, "H1 scored 10/12" means nothing — it could reflect the
 * value of structured inference, or merely the value of having the events at
 * all.
 *
 * So the baseline gives a model the identical event list and asks the identical
 * question, with none of the apparatus: no claim kinds, no evidence handles, no
 * confidence band, no instruction about untrusted content beyond the fence.
 *
 * **If the raw dump scores as well, `SessionReading` is not earning its place**,
 * and the honest response is to delete most of the inference layer rather than
 * tune its prompt. That is an outcome this harness is built to be able to
 * report.
 *
 * It is deliberately NOT a strawman. It gets the same events, the same model,
 * the same token budget, and a prompt written to succeed rather than to lose.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../model/client'
import { UNTRUSTED_CONTENT_RULE } from '../model/untrusted'
import type { PromptEvent, SessionReadingInput } from '../model/boundaries/session-reading'

export const baselineSchema = z.object({
  summary: z
    .string()
    .describe('What the person was working on and where they got to. A short paragraph.'),
  nextSteps: z.array(z.string()).describe('What you would do next.'),
})

export type BaselineOutput = z.infer<typeof baselineSchema>

const PROMPT_VERSION = 'baseline-raw-log@1'

const SYSTEM = `You are shown a raw log of someone's work session. Describe what they were working on and where they got to, then say what you would do next.

Be concrete and use their own vocabulary where the log shows it.

${UNTRUSTED_CONTENT_RULE}`

function renderEvents(events: readonly PromptEvent[]): string {
  return events
    .map((e) => {
      const untrusted = e.untrusted ? `\n  page text:\n${e.untrusted.forPrompt}` : ''
      return `${e.at} [${e.kind}] ${e.attested}${untrusted}`
    })
    .join('\n\n')
}

export const baselineBoundary: ModelBoundary<SessionReadingInput, BaselineOutput> = {
  // Reuses the session-reading slot deliberately: same boundary, same telemetry
  // row shape, so cost and latency compare directly.
  name: 'session-reading',
  promptVersion: PROMPT_VERSION,
  schema: baselineSchema,
  maxTokens: 4096,
  buildPrompt(input) {
    const notes =
      input.notes.length > 0
        ? `\n\nNotes they typed themselves:\n${input.notes.map((n) => `- ${n}`).join('\n')}`
        : ''

    return { system: SYSTEM, user: `Work session log:\n\n${renderEvents(input.events)}${notes}` }
  },
}
