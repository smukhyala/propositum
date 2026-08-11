/**
 * Boundary 7 of 7 — naming what someone has been looking into.
 *
 * ── This is the model call CONTEXT.md §2 banned, narrowed until it is safe ──
 *
 * The ban had two reasons and both were good: page text must not reach a model
 * while nobody is watching, and a timer-driven call makes the event stream
 * non-reproducible so the harness cannot re-score a fixture.
 *
 * What changed is that the deterministic detector can find the thread and
 * cannot name it. It produces "general intuition — across 3 sites". The person
 * asked for "you're researching world models", and no amount of string
 * arithmetic gets there.
 *
 * So the call is gated rather than periodic:
 *
 *   - It runs ONLY after `detectWork` has already fired. The model never sees
 *     anything that did not first clear a deterministic bar, so a quiet
 *     afternoon of browsing produces no calls at all.
 *   - It runs ONCE per thread. The cache key is the thread's terms, so the same
 *     subject is never named twice however long it is followed.
 *   - It sees TITLES AND SEARCH TERMS ONLY. Ambient capture holds no page text,
 *     so there is none to send — the strongest form of this guarantee, because
 *     it does not depend on remembering to leave anything out.
 *   - It cannot reach the eval harness. Detection is not part of any scored
 *     scenario, so reproducibility of `SessionReading` is untouched.
 *
 * ── Titles are page-authored ─────────────────────────────────────────────
 *
 * A title is written by whoever wrote the page, so it is exactly the injection
 * surface ADR-0006 is about. Every one is datamarked. The output is a phrase
 * shown to a person and a choice of two fixed actions — it grants nothing,
 * names no source, and cannot widen what anything is permitted to do.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client'
import { UNTRUSTED_CONTENT_RULE } from '../untrusted'
import type { Datamarked } from '../untrusted'

/** What Propositum can offer to do next. A closed list — the model chooses
 *  between them and cannot invent a third. */
export const OFFERABLE = ['draft-document', 'deep-research'] as const
export type Offerable = (typeof OFFERABLE)[number]

export interface SubjectInput {
  /** Recurring words from the thread. Code-derived, not page-authored. */
  readonly terms: readonly string[]
  /** Page titles, datamarked. Page-authored, and treated as such. */
  readonly titles: readonly Datamarked[]
  /** What they typed into a search box, datamarked. The clearest statement of
   *  intent available without asking. */
  readonly searches: readonly Datamarked[]
  readonly siteCount: number
}

export const subjectSchema = z.object({
  subject: z
    .string()
    .max(60)
    .describe(
      'What they appear to be looking into, as a person would say it. Two to five words. Lowercase unless a proper noun. No hedging, no "possibly".',
    ),
  confident: z
    .boolean()
    .describe(
      'False when the pages do not agree on a subject. A wrong guess said plainly is worse than admitting the pages were mixed.',
    ),
  offer: z
    .string()
    .describe(`One of: ${OFFERABLE.join(', ')}. Anything else is ignored and the offer falls back.`),
  offerLabel: z
    .string()
    .max(80)
    .describe(
      'The offer as a question, naming the subject. "Want me to draft a doc on projects you could build with world models?"',
    ),
})

export type SubjectOutput = z.infer<typeof subjectSchema>

const PROMPT_VERSION = 'subject@1'

const SYSTEM = `You are naming what someone has been reading about, from the titles of the pages they visited and anything they typed into a search box.

You are NOT summarising the pages. You have not read them — only their titles. Name the SUBJECT, in the words a colleague would use looking over their shoulder.

Rules:
- Two to five words. "world models", "series A term sheets", "General Intuition".
- If the pages do not agree on one subject, say so with confident: false rather than picking the loudest.
- Never invent specificity the titles do not support. "machine learning" is a worse answer than admitting you are not sure.
- Then choose ONE thing to offer:
  - draft-document — they seem to be gathering material toward something they will write.
  - deep-research — they seem to be still finding out, and would want more read for them.
- Write the offer as a short question naming the subject.

${UNTRUSTED_CONTENT_RULE}`

export const subjectBoundary: ModelBoundary<SubjectInput, SubjectOutput> = {
  name: 'subject',
  promptVersion: PROMPT_VERSION,
  schema: subjectSchema,
  maxTokens: 1024,
  buildPrompt(input) {
    const searches = input.searches.length
      ? `They searched for:\n${input.searches.map((s) => `- ${s.forPrompt}`).join('\n')}\n\n`
      : ''

    return {
      system: SYSTEM,
      user: [
        `Recurring words across the pages: ${input.terms.join(', ')}`,
        `Read across ${input.siteCount} different sites.`,
        '',
        searches + `Page titles:\n${input.titles.map((t) => `- ${t.forPrompt}`).join('\n')}`,
      ].join('\n'),
    }
  },
}

/** The model writes a free string; the closed list is applied here. */
export function offerableOf(raw: string): Offerable {
  return (OFFERABLE as readonly string[]).includes(raw) ? (raw as Offerable) : 'deep-research'
}
