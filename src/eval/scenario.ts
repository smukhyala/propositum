/**
 * What a scenario is.
 *
 * A scenario is a TypeScript module rather than JSON, for two reasons that are
 * not stylistic: page text must be constructed through `datamark()`, whose
 * brand cannot survive serialisation; and a fixture that type-checks against
 * the real boundary types cannot drift into a shape the pipeline could never
 * receive.
 *
 * ── The reference is the answer key, and it is sealed ────────────────────
 *
 * `reference` is what a person would have written, authored BEFORE the
 * scenario is ever run. `expectedStop` is the same for H3.
 *
 * Both are protected by src/eval/seal.ts: their hash is committed to
 * references.lock.json, and the harness refuses to score a scenario whose
 * reference has changed since sealing. Without that, "written before the run"
 * is an intention, and intentions do not survive a disappointing result.
 */

import { z } from 'zod'
import { CLAIM_KINDS, CONFIDENCE_BANDS } from '../model/boundaries/session-reading'
import type { PromptEvent } from '../model/boundaries/session-reading'

/** The four classes from ADR-0007's H3 rubric. */
export const SCENARIO_CLASSES = [
  'judgment-required',
  'information-missing',
  'straightforward',
  'structural',
] as const
export type ScenarioClass = (typeof SCENARIO_CLASSES)[number]

/** A claim in the human-authored reference. Deliberately the same shape the
 *  model must produce, so the comparison is like-for-like. */
export const referenceClaimSchema = z.object({
  kind: z.enum(CLAIM_KINDS),
  text: z.string(),
  confidence: z.enum(CONFIDENCE_BANDS).optional(),
  /** Handles a correct reading should be able to cite. Not scored directly —
   *  used to spot a reading that got the right answer from the wrong evidence. */
  supportingHandles: z.array(z.string()),
})

export type ReferenceClaim = z.infer<typeof referenceClaimSchema>

/** The H1 rubric's six components, from docs/MVP.md. */
export const H1_COMPONENTS = [
  'objective',
  'completedWork',
  'openThreads',
  'constraints',
  'nextActions',
  'uncertainties',
] as const
export type H1Component = (typeof H1_COMPONENTS)[number]

export interface ExpectedStop {
  /** Should a correct run raise a DecisionNeeded? */
  readonly shouldRaise: boolean
  /** If it should, roughly what about. Free text — used by the human scorer to
   *  judge whether the right question was asked, not matched mechanically. */
  readonly about?: string | undefined
  /** Structural rules a correct run should hit, if any. */
  readonly structuralRules?: readonly string[] | undefined
}

export interface Scenario {
  readonly id: string
  readonly title: string
  readonly class: ScenarioClass
  /** Why this scenario exists — what it is trying to catch. */
  readonly rationale: string

  /** The session as the inference boundary would see it. */
  readonly events: readonly PromptEvent[]
  readonly notes: readonly string[]

  /** The starting document, normalised to one sentence per line. */
  readonly documentTitle: string
  readonly baseContent: string

  /** SEALED. Authored before any run. Never edited afterwards — if it was
   *  wrong, that is a finding about the fixture and becomes a new scenario. */
  readonly reference: readonly ReferenceClaim[]
  readonly expectedStop: ExpectedStop
}

/**
 * The bytes that get hashed when a reference is sealed.
 *
 * Only the answer key is covered — the events, the document and the rationale
 * can be corrected without breaking the seal, because they are the QUESTION.
 * Changing the question invalidates the scenario for a different reason and is
 * caught by review, not by the lock.
 */
export function sealedPayload(scenario: Scenario): string {
  return JSON.stringify(
    {
      id: scenario.id,
      reference: scenario.reference,
      expectedStop: scenario.expectedStop,
    },
    null,
    0,
  )
}
