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
import type { AutonomyControls } from '../domain/handoff/policy'

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

/**
 * One page the worker may read, with the text a fetcher will serve for it.
 *
 * `text` is RAW. It is datamarked by the same seam the worker uses in
 * production — `fixtureFetcher` behind `allowlisted`, exactly as
 * `src/policy/fetcher.ts` describes — so a fixture cannot hand the worker
 * pre-fenced text and quietly skip the one door.
 */
export interface ScenarioSource {
  readonly id: string
  readonly label: string
  readonly url: string
  readonly title: string
  readonly text: string
}

/**
 * What the person ratified, so a scenario is a whole question.
 *
 * ── Why this is not part of the seal ─────────────────────────────────────
 *
 * `sealedPayload` covers `reference` and `expectedStop` and nothing else. This
 * is the QUESTION — the same category as the events and the document — and the
 * rule in docs/EVALUATION.md is that a question can be corrected without
 * breaking the seal, because changing it invalidates a scenario for a different
 * reason and is caught by review rather than by a hash.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 *
 * No objective, no definition of done, and no guidance. Those come from the
 * `handoff` boundary run against the reading the model just produced, which is
 * the production path: a person ratifies what Propositum drafted. Writing them
 * here would put the answer key's own objective into the run's input, and the
 * measurement after that would be of a worker handed the answer.
 *
 * `allowedActionKinds` is absent for the reason ADR-0004 gives: what a document
 * contract grants is `DOCUMENT_ACTION_KINDS`, derived by subtraction so a new
 * browser capability is not granted by default. A fixture naming its own set
 * would be the one place that derivation could be bypassed.
 */
export interface ScenarioHandoff {
  readonly sources: readonly ScenarioSource[]
  /** The human-set dials. A model may not propose these anywhere, and a fixture
   *  standing in for a person is still not a model. */
  readonly controls: AutonomyControls
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

  /** The agreement the run works under. Part of the question, not the key. */
  readonly handoff: ScenarioHandoff

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
