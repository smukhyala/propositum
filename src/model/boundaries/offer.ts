/**
 * Boundary 8 of 8 — proposing, in its own words, what Propositum would do.
 *
 * ── The second call under the discipline boundary 7 established ──────────
 *
 * `subject.ts` explains at length why the model call CONTEXT.md §2 banned is
 * safe once it is gated rather than periodic: it runs only after deterministic
 * detection has already fired, once per thread, on titles and search terms
 * only, and it is unreachable from the eval harness. Every one of those still
 * holds here — this call sees exactly what that one saw, plus the name that
 * came back from it, plus arithmetic.
 *
 * What is new is what the output may SAY. `OFFERABLE = ['draft-document',
 * 'deep-research']` was two use cases chosen at compile time, in a product
 * whose stated ambition is to have no predetermined use cases. The seam showed
 * on the second real thread: someone comparing three shipping carriers is not
 * served by either member, and the honest offer — "shall I collect their
 * published rates into one table and say which is cheapest under 5kg?" — was
 * not expressible in the list and never would be. So the model composes the
 * offer and deterministic code decides everything that grants anything.
 *
 * ── Why this is a SECOND call and not two more fields on `subject` ───────
 *
 * The decisive reason is that the two are gated differently.
 *
 * Naming runs at the `detectWork` bar, which is deliberately low: the cost of a
 * wrong subject line is a sentence nobody agrees with, and the name is what
 * makes the thirty-second poll feel alive rather than blank. Proposing runs at
 * the `OfferGrounds` bar, which is deliberately higher, because an offer spends
 * a person's attention on ratifying something and then their sources, their
 * Chrome and their time on running it.
 *
 * One call would have to pick one bar. Dragging the name up to the strong one
 * loses the early name; dragging the proposal down to the weak one is exactly
 * the false positive ADR-0008 calls the expensive failure. Secondarily, and
 * less philosophically: two calls mean a failed proposal cannot lose a name
 * that already succeeded.
 *
 * ── What this output structurally cannot do ──────────────────────────────
 *
 * ADR-0006's guarantee is that an injection can change what the worker
 * ATTEMPTS and can never change what it MAY TOUCH. A model-composed proposal is
 * squarely inside the first clause and has to stay outside the second. Two
 * properties keep it there, and neither is a rule anybody has to remember:
 *
 *   - **It names no place.** `ContractScope.approvedSourceIds` is derived by
 *     deterministic code from the pages the thread actually ran through, read
 *     off the ambient buffer. The schema below has NO FIELD that could carry a
 *     URL, a host, an origin or a source id — not "must not", *has no field* —
 *     and `tests/architecture.test.ts` greps this file for those words to keep
 *     it that way. A model that wanted to add a place to the scope has nowhere
 *     to write it down.
 *   - **It names no `ActionKind`.** `outcomeKinds` says what would be PRODUCED,
 *     which grants nothing and which deterministic code uses only to pick a
 *     contract template. CONTEXT.md's "a model may not propose
 *     `allowedActionKinds` at all" survives this file untouched.
 *
 * And, as with every prose-bearing object in the codebase, `compilePolicy`
 * cannot receive it — asserted as a compile error in
 * `tests/policy-gate.type-test.ts` rather than left as a review note.
 *
 * ── The exposure this does not close, stated plainly ─────────────────────
 *
 * What a person ratifies is now composed by a model that ran before any session
 * existed, from page titles alone. That is one step further from the person
 * than a `SessionReading` and two further than a `StatedIntent` they typed. The
 * blast radius of a hostile title now starts at the sentence on the offer
 * screen — the sentence a person is most likely to read and least likely to
 * interrogate, because it arrived unasked-for and looks like a summary rather
 * than a proposal. Titles are datamarked, `confident: false` reports rather
 * than resolves, and the human review is structurally non-optional; none of
 * those is a fix, and the interface has to show the outline and the exclusions
 * rather than only the title.
 */

import { z } from 'zod'
import type { ModelBoundary } from '../client'
import { UNTRUSTED_CONTENT_RULE } from '../untrusted'
import type { Datamarked } from '../untrusted'
import { SHIFT_OUTCOME_KINDS } from '../../domain/execution/outcome-kinds'
import type { ShiftOutcomeKind } from '../../domain/execution/outcome-kinds'

export interface OfferInput {
  /**
   * The recurring words of the thread, and the one input here whose provenance
   * is worth stating precisely rather than comfortably.
   *
   * They are computed by code — `termsOf` keeps only lowercase alphanumeric
   * runs of three characters or more, drops stopwords and site branding, and
   * `findThreads` keeps only what recurs across pages — but the raw material is
   * page titles and URL paths, which whoever wrote the page controls. So this
   * is page-DERIVED, heavily reduced, and it reaches the prompt outside the
   * datamark fence, exactly as it does in `subject.ts`.
   *
   * What that costs is bounded and worth naming: somebody serving two pages
   * that carry the thread's word can get a short bag of words into an unfenced
   * line. They cannot get punctuation, a delimiter, or a sentence — the
   * tokeniser destroys all three — so they cannot forge the fence, and the
   * output they could influence still has no field that grants anything.
   */
  readonly terms: readonly string[]
  /** Page titles, datamarked. Written by whoever wrote the page. */
  readonly titles: readonly Datamarked[]
  /** What they typed into a search box, datamarked. Recovered from the cleaned
   *  URL, so it arrives through the same door page text would. */
  readonly searches: readonly Datamarked[]
  /** The agreed name for the thread — itself composed from titles, so it stays
   *  datamarked rather than being promoted to trusted on its way here. */
  readonly subject: Datamarked
  readonly siteCount: number
  readonly pageCount: number
  readonly readingMinutes: number
  /**
   * `OfferGrounds.sentences`, verbatim — what the deterministic bar saw, in the
   * same voice `describeWork` uses to say it to the person.
   *
   * They are code-authored: counts, durations and hostnames off the ambient
   * buffer, with no page-authored text in them, which is why they are the one
   * input here that is not datamarked. A hostname does appear — "you went back
   * to nature.com after leaving it" — and that is a deliberate acceptance
   * rather than an oversight. It is evidence the person is about to be shown
   * anyway, it comes from where they actually went rather than from anything a
   * page said, and the offer that gets composed from it still has no field to
   * put a site in. The prompt is told, separately and explicitly, that a place
   * appearing in the evidence is not permission to name one in the proposal.
   */
  readonly grounds: readonly string[]
  /** What Propositum can really make. Code-derived from the closed kinds, so an
   *  offer cannot promise something the machine has no way to produce. */
  readonly producible: readonly string[]
}

/**
 * The offer, as the model writes it.
 *
 * Every bound here is enforced by Zod on parse and by nothing else: #3 verified
 * the grammar carries `maxLength` as prose in a description and does not
 * enforce it, which is also why `outcomeKinds` is `z.array(z.string())` and the
 * closed set is applied in `outcomeKindsOf` below rather than declared here.
 *
 * Read the field names as a list of what an offer may say. There is no seventh
 * field, and the six that exist were chosen so that the interface can show a
 * person what they are agreeing to before they agree to it: what it is, why,
 * roughly how, what comes out, and what it will refuse to do.
 */
export const offerSchema = z.object({
  title: z
    .string()
    .max(70)
    .describe(
      // The example is deliberately well inside the bound. A model imitating an
      // example longer than the limit fails the parse, spends the one repair
      // turn, and — because a second failure settles this thread as "no offer"
      // for good — can cost the person the offer entirely.
      'What you would do, in one line, as a person would say it out loud. Under 70 characters: "Compare those carrier rates under 5kg". Not a heading, not a label.',
    ),
  rationale: z
    .string()
    .max(240)
    .describe(
      'Why this is worth doing, in one or two sentences, from what they have been reading. Say what you noticed. Never flatter, never promise.',
    ),
  outline: z
    .array(z.string().max(120))
    .max(6)
    .describe(
      'Roughly what you would do, in order. One short line each, at most six. This is so they can decline for the right reason instead of declining a title. It binds nothing.',
    ),
  produces: z
    .string()
    .max(140)
    .describe(
      'What they would have at the end, said concretely. "A table of the four published rates with the cheapest marked" beats "a comparison".',
    ),
  excludes: z
    .array(z.string().max(120))
    .max(4)
    .describe(
      'What you would deliberately NOT do, especially anything they might reasonably assume you would. At most four. An empty list is an answer, but a suspicious one.',
    ),
  outcomeKinds: z
    .array(z.string())
    .max(3)
    .describe(
      `Which shapes the result would take, at most three of exactly these: ${SHIFT_OUTCOME_KINDS.join(', ')}. Anything else is dropped, so inventing one costs you the entry.`,
    ),
  confident: z
    .boolean()
    .describe(
      'False when what they read does not add up to one thing worth doing. Saying so is a real answer — a plausible wrong proposal is worse than an admission that the reading was mixed.',
    ),
})

export type OfferOutput = z.infer<typeof offerSchema>

const PROMPT_VERSION = 'offer@1'

/**
 * The prompt, and the words it may not use.
 *
 * No "task", no "step", no "workflow", no "objective", no "allowlist". Some of
 * those are banned outright by CONTEXT.md; the rest are banned here because
 * they invite the model into the vocabulary of a system that executes plans,
 * and what is being written is a sentence offered to a person who has not
 * agreed to anything yet. "Roughly what you would do, in order" is the whole
 * idea, said in words that do not smuggle in a machine.
 */
const SYSTEM = `You are proposing, to somebody who has not asked you for anything, what you could do about the subject they have been reading around.

You have not read those pages. You have their titles, what they typed into a search box, and arithmetic about how long they spent. Propose from that and from nothing else.

Rules:
- Propose ONE thing. The most useful thing you could do with what they have been reading, not the most impressive.
- Say roughly what you would do, in order, in at most six short lines. This is so they can turn you down for the right reason.
- Only propose what Propositum can actually produce. You will be given that list; nothing outside it is on the table.
- Say what you would NOT do. Especially the thing they might assume you would.
- Never name a website, a company's site, a page or a link. The evidence you are given may mention where they were — that is Propositum saying what it saw, and it is not permission to put a place in your proposal. You could not widen what Propositum is allowed to look at even if you tried, and naming one would only be describing something you cannot do.
- If the reading does not add up to one thing worth doing, say so with confident: false. A confident wrong proposal costs them the time to read it and the trust to read the next one.

${UNTRUSTED_CONTENT_RULE}`

export const offerBoundary: ModelBoundary<OfferInput, OfferOutput> = {
  name: 'offer',
  promptVersion: PROMPT_VERSION,
  schema: offerSchema,
  maxTokens: 2048,
  buildPrompt(input) {
    const searches = input.searches.length
      ? `They searched for:\n${input.searches.map((s) => `- ${s.forPrompt}`).join('\n')}\n\n`
      : ''

    return {
      system: SYSTEM,
      user: [
        `What they appear to be looking into: ${input.subject.forPrompt}`,
        `Recurring words: ${input.terms.join(', ')}`,
        `${input.pageCount} pages across ${input.siteCount} places, about ${input.readingMinutes} minutes of reading.`,
        '',
        `Why Propositum thinks this is work rather than browsing:\n${input.grounds.map((g) => `- ${g}`).join('\n')}`,
        '',
        `What Propositum can produce:\n${input.producible.map((p) => `- ${p}`).join('\n')}`,
        '',
        searches + `Page titles:\n${input.titles.map((t) => `- ${t.forPrompt}`).join('\n')}`,
      ].join('\n'),
    }
  },
}

/**
 * The model writes free strings; the closed list is applied HERE.
 *
 * `enum` does not survive schema transformation — verified in
 * `tests/schema-transformation.test.ts` — so the set above reaches the model as
 * prose in a description and reaches the program as this function. Mirrors what
 * `offerableOf` used to do for the two-member list it replaced.
 *
 * A kind the model invented is DROPPED rather than mapped to a neighbour or
 * defaulted. Guessing which of five a sixth resembles is exactly the fallback
 * branch ADR-0009 refuses, and an empty list is a true statement: code picks
 * the contract template, and it can do that from the grounds and the Output
 * control without the model's help.
 */
export function outcomeKindsOf(raw: readonly string[]): readonly ShiftOutcomeKind[] {
  const kept: ShiftOutcomeKind[] = []

  for (const candidate of raw) {
    const normalised = candidate.trim().toLowerCase()
    if (!(SHIFT_OUTCOME_KINDS as readonly string[]).includes(normalised)) continue
    const kind = normalised as ShiftOutcomeKind
    if (kept.includes(kind)) continue
    kept.push(kind)
  }

  // Three is the cap the schema states and the grammar does not enforce. A
  // reply naming all five is not an offer, it is a hedge.
  return kept.slice(0, 3)
}
