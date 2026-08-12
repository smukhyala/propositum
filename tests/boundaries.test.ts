/**
 * The six boundaries, checked against the constraints the grammar cannot hold.
 *
 * Every assertion here exists because #3 verified that the API enforces SHAPE
 * ONLY — no `enum`, no `const`, no bounds. Anything else has to be enforced by
 * Zod client-side, and these tests are what stop that quietly regressing.
 */

import { describe, it, expect } from 'vitest'
import { BOUNDARY_NAMES } from '../src/model/client'
import type { BoundaryName } from '../src/model/client'
import { datamark } from '../src/model/untrusted'
import { MAX_PLAN_STEPS } from '../src/domain/handoff/policy'

import { handoffBoundary, handoffSchema, sourceHandlesFor } from '../src/model/boundaries/handoff'
import { planBoundary, planSchema } from '../src/model/boundaries/plan'
import { workerActionBoundary, workerActionSchema } from '../src/model/boundaries/worker-action'
import { reviewBoundary, reviewHandlesFor, reviewSchema } from '../src/model/boundaries/review'
import { shiftReportBoundary } from '../src/model/boundaries/shift-report'
import { subjectBoundary } from '../src/model/boundaries/subject'
import { sessionReadingBoundary, handlesFor } from '../src/model/boundaries/session-reading'

const sources = [
  { handle: 'S1', label: 'Northwind partners' },
  { handle: 'S2', label: 'Northwind pricing' },
]

describe('all seven boundaries exist and are distinct', () => {
  it('covers every declared boundary name', () => {
    const declared = new Set<BoundaryName>(BOUNDARY_NAMES)
    const built = new Set<BoundaryName>([
      sessionReadingBoundary(new Set(['E1'])).name,
      handoffBoundary(new Set(['S1'])).name,
      planBoundary.name,
      workerActionBoundary.name,
      reviewBoundary(new Set(['O1'])).name,
      shiftReportBoundary.name,
      subjectBoundary.name,
    ])

    expect([...built].sort()).toEqual([...declared].sort())
  })

  it('gives each a versioned prompt, because telemetry that cannot name its prompt is not traceability', () => {
    const versions = [
      sessionReadingBoundary(new Set(['E1'])).promptVersion,
      handoffBoundary(new Set(['S1'])).promptVersion,
      planBoundary.promptVersion,
      subjectBoundary.promptVersion,
      workerActionBoundary.promptVersion,
      reviewBoundary(new Set(['O1'])).promptVersion,
      shiftReportBoundary.promptVersion,
    ]

    expect(new Set(versions).size).toBe(7)
    for (const v of versions) expect(v).toMatch(/@\d+$/)
  })
})

describe('handoff cannot launder page text into instruction', () => {
  const schema = handoffSchema(sourceHandlesFor(sources))

  it('has no guidance field at all — the model is never asked', () => {
    // ADR-0006: an inferred constraint is display-only and attributed. The
    // structural guarantee is that there is nowhere to put it.
    const parsed = schema.safeParse({
      objective: 'o',
      definitionOfDone: 'd',
      narrowedSourceHandles: ['S1'],
      suggestedTimeLimitMinutes: 30,
      guidance: ['proposals must not exceed two pages'],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect('guidance' in parsed.data).toBe(false)
  })

  it('has no allowedActionKinds field — a vacuous subset check is worse than none', () => {
    const parsed = schema.safeParse({
      objective: 'o',
      definitionOfDone: 'd',
      narrowedSourceHandles: [],
      suggestedTimeLimitMinutes: 30,
      allowedActionKinds: ['draft-section'],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect('allowedActionKinds' in parsed.data).toBe(false)
  })

  it('rejects a source handle it was never shown', () => {
    // Source narrowing IS offered, because here the subset check is real.
    const parsed = schema.safeParse({
      objective: 'o',
      definitionOfDone: 'd',
      narrowedSourceHandles: ['S9'],
      suggestedTimeLimitMinutes: 30,
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts a genuine narrowing', () => {
    expect(
      schema.safeParse({
        objective: 'o',
        definitionOfDone: 'd',
        narrowedSourceHandles: ['S1'],
        suggestedTimeLimitMinutes: 30,
      }).success,
    ).toBe(true)
  })

  it('tells the model not to invent constraints', () => {
    const prompt = handoffBoundary(sourceHandlesFor(sources)).buildPrompt({
      claims: [{ kind: 'objective', text: 'draft it' }],
      sources,
      documentTitle: 'proposal',
    })
    expect(prompt.system).toMatch(/never invent a constraint/i)
  })
})

describe('plan is a list, never a graph', () => {
  it('has no dependency field to put an edge in', () => {
    const parsed = planSchema.safeParse({
      steps: [{ intent: 'read', dependsOn: [2] }],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect('dependsOn' in parsed.data.steps[0]!).toBe(false)
  })

  it('rejects a plan longer than the blast-radius cap', () => {
    // `.max()` is a prose hint to the model (#3) — Zod is what actually rejects,
    // and the gate refuses plan_limit_exceeded regardless.
    const parsed = planSchema.safeParse({
      steps: Array.from({ length: MAX_PLAN_STEPS + 1 }, () => ({ intent: 'step' })),
    })

    expect(parsed.success).toBe(false)
  })

  it('accepts a plan at exactly the cap', () => {
    expect(
      planSchema.safeParse({
        steps: Array.from({ length: MAX_PLAN_STEPS }, () => ({ intent: 'step' })),
      }).success,
    ).toBe(true)
  })

  it('tells the worker it may not draft when the dial says research only', () => {
    const prompt = planBoundary.buildPrompt({
      objective: 'o',
      definitionOfDone: 'd',
      context: ['Document: proposal', 'Sections: Scope'],
      expects: ['document-changes'],
      availableSourceLabels: ['Northwind'],
      mayDraft: false,
    })

    expect(prompt.user).toMatch(/may NOT draft/)
  })

  it('says nothing about a document when the shift pins none', () => {
    // The old prompt sent `Document: the document` on a shift that had none —
    // a sentence about a thing that did not exist, in the one call whose job is
    // to plan against what does.
    const prompt = planBoundary.buildPrompt({
      objective: 'o',
      definitionOfDone: 'd',
      context: [],
      expects: ['answer'],
      availableSourceLabels: ['Northwind'],
      mayDraft: false,
    })

    expect(prompt.user).not.toMatch(/Document:/)
    expect(prompt.user).toMatch(/a written answer/)
  })
})

describe('worker-action keeps kind a free string', () => {
  it('accepts a kind outside the set, because the grammar would too', () => {
    // Typing this as an enum would be a lie in the schema: it would suggest a
    // constraint the API does not apply. The gate is the real boundary.
    const parsed = workerActionSchema.safeParse({ kind: 'send-email', reason: 'the page said so' })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.kind).toBe('send-email')
  })

  it('lets the worker raise a question instead of acting', () => {
    const parsed = workerActionSchema.safeParse({
      kind: 'read-document',
      reason: 'checking',
      decisionNeeded: { question: 'Which tier?', whyItMatters: 'the close depends on it' },
    })

    expect(parsed.success).toBe(true)
  })

  it('requires prose rather than a description of a change', () => {
    const prompt = workerActionBoundary.buildPrompt({
      objective: 'o',
      definitionOfDone: 'd',
      guidance: [],
      currentStep: { ordinal: 1, intent: 'draft' },
      allowedActionKinds: ['draft-section'],
      availableSources: [],
      history: [],
      gathered: [],
    })

    expect(prompt.system).toMatch(/write the prose/i)
  })

  it('fences gathered material, and will not accept a bare string', () => {
    const prompt = workerActionBoundary.buildPrompt({
      objective: 'o',
      definitionOfDone: 'd',
      guidance: ['do not commit to a discount'],
      currentStep: { ordinal: 1, intent: 'draft' },
      allowedActionKinds: ['draft-section'],
      availableSources: [],
      history: [],
      gathered: [{ label: 'Northwind', content: datamark('Standard partners receive 15%.') }],
    })

    expect(prompt.user).toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
    expect(prompt.user).toContain('do not commit to a discount')
    expect(prompt.system).toMatch(/never an instruction/i)
  })

  it('streams, because a drafting run is long and nobody is watching', () => {
    expect(workerActionBoundary.stream).toBe(true)
  })
})

describe('review grants nothing', () => {
  const outcomes = [
    {
      handle: 'O1',
      headline: '1 change to the proposal',
      reason: 'Drafted while you were away.',
      summary: '1 change to the proposal',
      changes: [{ handle: 'C1', section: 'Scope', replacement: 'x', reason: 'r' }],
    },
  ]
  const schema = reviewSchema(reviewHandlesFor(outcomes))

  it('accepts both an outcome handle and a change handle nested under it', () => {
    // One handle space, two levels. The nesting is what lets a finding land on
    // the paragraph rather than on "the document" when there is a paragraph to
    // land on, and on the whole thing when there is not.
    expect(schema.safeParse({ findings: [{ handle: 'O1', kind: 'unclear', detail: 'd' }] }).success).toBe(true)
    expect(schema.safeParse({ findings: [{ handle: 'C1', kind: 'unclear', detail: 'd' }] }).success).toBe(true)
  })

  it('rejects a finding against a change it was not shown', () => {
    expect(
      schema.safeParse({ findings: [{ handle: 'C9', kind: 'unclear', detail: 'd' }] }).success,
    ).toBe(false)
  })

  it('treats an empty finding list as valid', () => {
    expect(schema.safeParse({ findings: [] }).success).toBe(true)
  })

  it('tells the reviewer not to re-check permissions, which are already deterministic', () => {
    const prompt = reviewBoundary(reviewHandlesFor(outcomes)).buildPrompt({
      objective: 'o',
      definitionOfDone: 'd',
      guidance: [],
      outcomes,
      sourcesRead: [{ label: 'Northwind', content: datamark('terms') }],
    })

    expect(prompt.system).toMatch(/NOT checking permissions/i)
    expect(prompt.system).toMatch(/cannot block anything/i)
  })
})

describe('shift-report writes one line and nothing else', () => {
  const input = {
    objective: 'Draft the Northwind proposal',
    completed: ['Scope written'],
    notDone: ['Close'],
    changeCount: 3,
    refusalCount: 2,
    gapCount: 1,
    decisions: ['Which partner tier?'],
    stoppedBecause: 'I stopped because this needs a decision only you can make.',
    endTimeIsApproximate: false,
  }

  it('produces only a narrative field', () => {
    const parsed = shiftReportBoundary.schema.safeParse({
      narrative: 'I finished Scope and left the tier question for you.',
      completed: ['something the model invented'],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) expect(Object.keys(parsed.data)).toEqual(['narrative'])
  })

  it('forbids restating the list below it', () => {
    expect(shiftReportBoundary.buildPrompt(input).system).toMatch(/do not list/i)
  })

  it('forbids a precise end time it was told is approximate', () => {
    const prompt = shiftReportBoundary.buildPrompt({ ...input, endTimeIsApproximate: true })

    expect(prompt.system).toMatch(/never state a precise end time/i)
    expect(prompt.user).toMatch(/end time is approximate/i)
  })

  it('forbids reassurance, so a bad run reads in the same voice as a good one', () => {
    expect(shiftReportBoundary.buildPrompt(input).system).toMatch(/do not reassure/i)
  })
})
