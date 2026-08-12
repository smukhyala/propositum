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

/**
 * One thing the run produced, as the reviewer sees it.
 *
 * ── Why the handles are nested rather than flat ──────────────────────────
 *
 * A run used to produce exactly one thing — a `Changeset` — so a flat list of
 * change handles `C1…Cn` was the whole surface. It now produces `ShiftOutcome`s,
 * and only one of the five kinds decomposes into independently decidable parts.
 * A collection has items; an answer is one thing; a message draft is one thing.
 *
 * Flattening everything to `C1…Cn` would have meant inventing a change handle
 * for a message that has no parts, and the reviewer would then be annotating a
 * unit the person is never shown a control for. So the outcome is the handle,
 * and the `document-changes` case carries its changes underneath — which is the
 * only case where "this specific paragraph is unsupported" is a sentence the
 * interface can render next to something.
 */
export interface ReviewedOutcome {
  /** `O1`, `O2`, … */
  readonly handle: string
  readonly headline: string
  readonly reason: string
  /** A one-line rendering shaped by the kind — "6 changes to Q3 proposal", "11
   *  rates", "a message to Northwind, unsent". Code-composed, never the model's
   *  own words about its own work. */
  readonly summary: string
  /** Present only for `document-changes`, where the decidable unit is smaller
   *  than the outcome. */
  readonly changes?:
    | ReadonlyArray<{ handle: string; section: string; replacement: string; reason: string }>
    | undefined
}

export interface ReviewInput {
  readonly objective: string
  readonly definitionOfDone: string
  readonly guidance: readonly string[]
  readonly outcomes: readonly ReviewedOutcome[]
  readonly sourcesRead: ReadonlyArray<{ label: string; content: Datamarked }>
}

/**
 * `handle`, one field, resolving to either an outcome or a change.
 *
 * Two fields — `outcomeHandle` and `changeHandle` — was the obvious shape and is
 * worse: the model would have to decide which one to fill, both-set and
 * neither-set would be representable at the wire, and the resolver would need a
 * precedence rule with no principled answer. One field with one closed set makes
 * "at most one of `changeId` and `outcomeId` is set" a property of the mapping
 * rather than a rule someone enforces.
 */
export function reviewSchema(handles: ReadonlySet<string>) {
  return z.object({
    findings: z
      .array(
        z.object({
          handle: z
            .string()
            .refine((h) => handles.has(h), {
              message: 'must be one of the handles shown in the prompt',
            })
            .describe('Which thing this is about. One of the handles in the prompt.'),
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

const PROMPT_VERSION = 'review@2'

const SYSTEM = `You are checking work done on someone's behalf while they were away, before they see it.

You are NOT checking permissions. Whether the work stayed inside the agreement has already been established deterministically — anything outside it was refused before it happened, and is already recorded. Do not report it.

Check the things a machine cannot:
- Is a claim actually supported by what was read, or does it sound supported?
- Does a draft contradict the source it cites?
- Is it vague where it needed to be specific — a number, a date, a name?

Rules:
- Report only real problems. An empty list is a good outcome.
- One sentence per finding, and make it actionable.
- Cite the most specific handle you can. Where a thing is broken into parts, name the part; otherwise name the thing.
- You cannot block anything. Your findings are shown beside the work; the person decides.

${UNTRUSTED_CONTENT_RULE}`

export const reviewBoundary = (
  handles: ReadonlySet<string>,
): ModelBoundary<ReviewInput, ReviewOutput> => ({
  name: 'review',
  promptVersion: PROMPT_VERSION,
  schema: reviewSchema(handles),
  maxTokens: 4096,
  buildPrompt(input) {
    const produced = input.outcomes
      .map((o) => {
        const head = `${o.handle} — ${o.summary}\n  why: ${o.reason}`
        const changes = (o.changes ?? [])
          .map((c) => `  ${c.handle} — ${c.section}\n    reason: ${c.reason}\n    text: ${c.replacement}`)
          .join('\n')
        return changes ? `${head}\n${changes}` : head
      })
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
        `What was produced:\n\n${produced}`,
        '',
        `What was read:\n\n${sources}`,
      ].join('\n'),
    }
  },
})

/**
 * Every handle the model may cite — outcome handles, plus the change handles
 * nested under any `document-changes` outcome.
 *
 * One set, so the Zod refinement has one membership test and the resolver in
 * `execute-run` has one map to look in. A finding citing a handle that was never
 * shown fails validation rather than resolving to null and being stored against
 * nothing.
 */
export function reviewHandlesFor(outcomes: readonly ReviewedOutcome[]): ReadonlySet<string> {
  const handles = new Set<string>()
  for (const outcome of outcomes) {
    handles.add(outcome.handle)
    for (const change of outcome.changes ?? []) handles.add(change.handle)
  }
  return handles
}
