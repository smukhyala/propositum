/**
 * The composed offer — what Propositum would do about what it saw, in its own
 * words.
 *
 * ── Why this replaces a two-member enum ──────────────────────────────────
 *
 * ADR-0008 shipped `OFFERABLE = ['draft-document', 'deep-research']`: a closed
 * list of two use cases, written before anyone had watched the product be used,
 * in a system whose stated ambition is to have no predetermined use cases at
 * all. It held for exactly one real thread. Somebody comparing three shipping
 * carriers is not served by either member, and the honest offer — "shall I
 * collect their published rates into one table and say which is cheapest under
 * 5kg?" — is not expressible in the enum and never will be.
 *
 * So a model composes the offer. What widens is what an offer may SAY. What it
 * may DO is untouched: ADR-0009 §1.
 *
 * ── The field that does not exist ────────────────────────────────────────
 *
 * There is NO field here for a site, a host, an origin, a URL or a source id.
 * Not "must not carry one" — there is nowhere to put one. `ContractScope`'s
 * sources are derived by deterministic code from the pages the thread actually
 * ran through, read off the ambient buffer, and a model that wanted to widen
 * that has no way to write it down. `tests/architecture.test.ts` greps this
 * file for those words so the property cannot be lost to a helpful refactor.
 *
 * Nor is there a field for an `ActionKind`. `expects` holds `ShiftOutcomeKind`s
 * — a statement about the SHAPE OF THE RESULT, which grants nothing. The kinds
 * a run may actually take come from the contract template, the Output control
 * and the person, exactly as before.
 *
 * ── Titles are page-authored ─────────────────────────────────────────────
 *
 * Every title crossing this boundary is datamarked, because a title is written
 * by whoever wrote the page. ADR-0009 states the exposure this does not close
 * plainly: a hostile page title now has a path to the sentence at the top of
 * the offer screen, which is the one sentence a person is most likely to read
 * and least likely to interrogate. The mitigations are structural — the offer
 * names no source, ratification is non-optional, and the screen shows the
 * outline and the will-not-do list rather than the title alone.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client'
import { UNTRUSTED_CONTENT_RULE } from '../untrusted'
import type { Datamarked } from '../untrusted'

/**
 * What a run can produce. Five kinds, closed, code-owned. There is no `other`:
 * an `other` kind is a free-text field wearing an enum's clothes, and the
 * fallback branch every consumer would then need is exactly where a landed
 * effect gets rendered as a reviewable proposal.
 */
export const SHIFT_OUTCOME_KINDS = [
  'document-changes',
  'collection',
  'answer',
  'message-draft',
  'external-effect',
] as const
export type ShiftOutcomeKind = (typeof SHIFT_OUTCOME_KINDS)[number]

export interface OfferInput {
  /** Recurring words from the thread. Code-derived, not page-authored. */
  readonly terms: readonly string[]
  /** The subject, already named by the subject boundary. */
  readonly subject: string
  /** Page titles, datamarked. Page-authored, and treated as such. */
  readonly titles: readonly Datamarked[]
  /** What the deterministic grounds say was seen. Facts, not readings. */
  readonly grounds: readonly string[]
  readonly siteCount: number
}

export const offerSchema = z.object({
  title: z
    .string()
    .max(90)
    .describe(
      'What you would do, as one short sentence in the first person. "Write up the three labs and how they differ."',
    ),
  rationale: z
    .string()
    .max(300)
    .describe('Why that is the useful thing to do, given what they were reading. Two sentences at most.'),
  outline: z
    .array(z.string().max(120))
    .min(2)
    .max(6)
    .describe('The shape of the work, in order. One line each. Display only — never a plan.'),
  produces: z
    .string()
    .max(140)
    .describe('What they end up holding when it is done. A thing, not a promise.'),
  excludes: z
    .array(z.string().max(120))
    .min(1)
    .max(4)
    .describe(
      'What you will NOT do, in your own words. Be concrete and be honest — this is the half people read hardest.',
    ),
  expects: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(`Each one of: ${SHIFT_OUTCOME_KINDS.join(', ')}. Anything else is dropped.`),
})

export type OfferOutput = z.infer<typeof offerSchema>

const PROMPT_VERSION = 'offer@1'

const SYSTEM = `You are proposing one piece of work, to someone whose browsing you have seen the titles of and nothing else.

Propose what YOU would do about it. There is no list to pick from — say the useful thing, in the words the person would use. If the useful thing is small, propose the small thing.

Rules:
- Write in the first person, plainly. "Collect their published rates into one table and say which is cheapest under 5kg."
- You have NOT read the pages, only their titles. Never claim a finding.
- Never name a website, a company's site, a URL or a domain. You are describing work, not places.
- The exclusions are not a disclaimer. Name the things somebody would reasonably assume you were about to do, and say you will not.
- Choose the kinds of result this would produce, from the closed list.

${UNTRUSTED_CONTENT_RULE}`

export const offerBoundary: ModelBoundary<OfferInput, OfferOutput> = {
  name: 'offer',
  promptVersion: PROMPT_VERSION,
  schema: offerSchema,
  maxTokens: 2048,
  buildPrompt(input) {
    return {
      system: SYSTEM,
      user: [
        `They appear to be working on: ${input.subject}`,
        `Recurring words across the pages: ${input.terms.join(', ')}`,
        `Read across ${input.siteCount} different sites.`,
        '',
        `What was observed:\n${input.grounds.map((g) => `- ${g}`).join('\n')}`,
        '',
        `Page titles:\n${input.titles.map((t) => `- ${t.forPrompt}`).join('\n')}`,
      ].join('\n'),
    }
  },
}

/** The model writes free strings; the closed set is applied here. A kind it
 *  invented is DROPPED rather than stored, so the column can only ever hold
 *  members of the enum ADR-0009 closed. */
export function outcomeKindsOf(raw: readonly string[]): ShiftOutcomeKind[] {
  const kinds: ShiftOutcomeKind[] = []
  for (const value of raw) {
    if ((SHIFT_OUTCOME_KINDS as readonly string[]).includes(value)) {
      const kind = value as ShiftOutcomeKind
      if (!kinds.includes(kind)) kinds.push(kind)
    }
  }
  return kinds
}

export const OFFER_PROMPT_VERSION = PROMPT_VERSION
