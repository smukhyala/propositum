/**
 * Boundary 5 of 6 — the reviewer.
 *
 * ── This boundary grants nothing, and is close to decorative ─────────────
 *
 * Say it plainly, because the alternative is someone later assuming the
 * reviewer is load-bearing.
 *
 * Scope adherence is **deterministic** (ADR-0004): sources used ⊆ allowlist,
 * actions ⊆ permitted, both readable straight off the ledger. The gate already
 * refused anything outside the agreement, and a refusal is already recorded.
 * There is nothing for a model to adjudicate there.
 *
 * So `ReviewFinding` is display-only. It cannot block a change, cannot fail a
 * run, and cannot alter a verdict. It annotates.
 *
 * The founding brief mandates a reviewer, and `MVP.md` records "does the
 * reviewer earn its place" as a measured question rather than an assumed
 * answer. This boundary exists to make that measurable.
 *
 * ── What it can honestly do ──────────────────────────────────────────────
 *
 * Judge the things determinism cannot: whether a claim is actually supported by
 * what was read, whether a draft contradicts its source, whether prose is
 * vague where it needed to be specific.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client'
import { UNTRUSTED_CONTENT_RULE } from '../untrusted'
import type { Datamarked } from '../untrusted'

export const FINDING_KINDS = [
  'unsupported',
  'contradicts-source',
  'unclear',
  'outside-agreement',
] as const

export interface ReviewInput {
  readonly objective: string
  readonly definitionOfDone: string
  readonly guidance: readonly string[]
  readonly changes: ReadonlyArray<{ handle: string; section: string; replacement: string; reason: string }>
  readonly sourcesRead: ReadonlyArray<{ label: string; content: Datamarked }>
}

export function reviewSchema(changeHandles: ReadonlySet<string>) {
  return z.object({
    findings: z
      .array(
        z.object({
          changeHandle: z
            .string()
            .refine((h) => changeHandles.has(h), {
              message: 'must be one of the change handles shown in the prompt',
            })
            .describe('Which change this is about.'),
          kind: z
            .string()
            .describe(`One of: ${FINDING_KINDS.join(', ')}. Anything else is dropped.`),
          detail: z.string().describe('One sentence the person can act on.'),
        }),
      )
      .describe('Only real problems. An empty list is a good outcome, not a lazy one.'),
  })
}

export type ReviewOutput = z.infer<ReturnType<typeof reviewSchema>>

const PROMPT_VERSION = 'review@1'

const SYSTEM = `You are checking work done on someone's behalf while they were away, before they see it.

You are NOT checking permissions. Whether the work stayed inside the agreement has already been established deterministically — anything outside it was refused before it happened, and is already recorded. Do not report it.

Check the things a machine cannot:
- Is a claim actually supported by what was read, or does it sound supported?
- Does a draft contradict the source it cites?
- Is it vague where it needed to be specific — a number, a date, a name?

Rules:
- Report only real problems. An empty list is a good outcome.
- One sentence per finding, and make it actionable.
- You cannot block anything. Your findings are shown beside the changes; the person decides.

${UNTRUSTED_CONTENT_RULE}`

export const reviewBoundary = (
  changeHandles: ReadonlySet<string>,
): ModelBoundary<ReviewInput, ReviewOutput> => ({
  name: 'review',
  promptVersion: PROMPT_VERSION,
  schema: reviewSchema(changeHandles),
  maxTokens: 4096,
  buildPrompt(input) {
    const changes = input.changes
      .map((c) => `${c.handle} — ${c.section}\n  reason: ${c.reason}\n  text: ${c.replacement}`)
      .join('\n\n')

    const sources = input.sourcesRead.length
      ? input.sourcesRead.map((s) => `### ${s.label}\n${s.content.forPrompt}`).join('\n\n')
      : '(nothing was read)'

    const guidance = input.guidance.length
      ? `\nTheir guidance:\n${input.guidance.map((g) => `- ${g}`).join('\n')}`
      : ''

    return {
      system: SYSTEM,
      user: [
        `Objective: ${input.objective}`,
        `Done means: ${input.definitionOfDone}${guidance}`,
        '',
        `Proposed changes:\n\n${changes}`,
        '',
        `What was read:\n\n${sources}`,
      ].join('\n'),
    }
  },
})

export function changeHandlesFor(changes: ReadonlyArray<{ handle: string }>): ReadonlySet<string> {
  return new Set(changes.map((c) => c.handle))
}
