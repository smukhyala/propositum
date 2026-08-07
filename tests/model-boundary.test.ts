/**
 * Model boundary: failure classification, the fake's contract, and the
 * reference boundary's schema.
 *
 * Layer 1 of the four-layer strategy (fakes). Layer 3 lives in
 * schema-transformation.test.ts. Layer 2 (cassettes) and layer 4 (tagged live
 * contract tests) arrive with the build slices — noting that here rather than
 * leaving the gap implicit.
 */

import { describe, it, expect } from 'vitest'
import { classifyStopReason, recoveryFor } from '../src/model/client.js'
import { FakeModelClient } from '../src/model/fake.js'
import {
  handlesFor,
  sessionReadingBoundary,
  sessionReadingSchema,
} from '../src/model/boundaries/session-reading.js'
import type { PromptEvent } from '../src/model/boundaries/session-reading.js'
import { datamark } from '../src/model/untrusted.js'

const events: PromptEvent[] = [
  { handle: 'E1', kind: 'visited', at: '14:02', attested: 'Northwind partnership terms' },
  {
    handle: 'E2',
    kind: 'excerpted',
    at: '14:09',
    attested: 'selection on Northwind pricing',
    untrusted: datamark('Partners must not exceed a 20% revenue share.'),
  },
  { handle: 'E3', kind: 'documentEdited', at: '14:31', attested: 'edited "Scope" section' },
]

const handles = handlesFor(events)
const boundary = sessionReadingBoundary(handles)

const validClaim = {
  kind: 'objective' as const,
  text: 'Drafting the Northwind partnership proposal.',
  confidence: 'medium' as const,
  evidence: [{ ref: 'E1' }],
}

describe('classify by stop_reason before parsing', () => {
  it('treats refusal as terminal', () => {
    expect(classifyStopReason('refusal')).toBe('refusal')
    expect(recoveryFor('refusal')).toBe('none')
  })

  it('treats max_tokens as truncation, recoverable once by escalating', () => {
    expect(classifyStopReason('max_tokens')).toBe('truncation')
    expect(recoveryFor('truncation')).toBe('escalate-tokens')
  })

  it('treats end_turn as no failure, so the parse decides', () => {
    expect(classifyStopReason('end_turn')).toBeNull()
  })

  it('repairs a schema mismatch exactly once', () => {
    expect(recoveryFor('schema-mismatch')).toBe('repair')
  })

  it('does not stack retries on transport, which the SDK already backs off', () => {
    expect(recoveryFor('transport')).toBe('none')
  })
})

describe('the reference schema enforces what the grammar cannot', () => {
  const schema = sessionReadingSchema(handles)

  it('accepts a well-formed reading', () => {
    expect(schema.safeParse({ claims: [validClaim] }).success).toBe(true)
  })

  it('rejects a claim kind outside the set, which the grammar permits', () => {
    // z.enum() is a prose hint (#3), so the model genuinely can send this.
    const result = schema.safeParse({
      claims: [{ ...validClaim, kind: 'vibes' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a confidence band outside the set', () => {
    expect(schema.safeParse({ claims: [{ ...validClaim, confidence: 0.83 }] }).success).toBe(false)
  })

  it('rejects evidence citing a handle that was never shown', () => {
    // The single most important check here: the grammar cannot enforce
    // referential integrity, so fabricated citations arrive well-formed.
    const result = schema.safeParse({
      claims: [{ ...validClaim, evidence: [{ ref: 'E99' }] }],
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/event handles/i)
    }
  })

  it('accepts every handle that was shown', () => {
    for (const handle of handles) {
      const result = schema.safeParse({
        claims: [{ ...validClaim, evidence: [{ ref: handle }] }],
      })
      expect(result.success).toBe(true)
    }
  })
})

describe('the prompt', () => {
  it('numbers events by handle and never leaks database ids', () => {
    const prompt = boundary.buildPrompt({ events, notes: [] })

    expect(prompt.user).toContain('E1 [visited]')
    expect(prompt.user).toContain('E3 [documentEdited]')
  })

  it('labels page-authored text so it cannot be mistaken for the person', () => {
    const prompt = boundary.buildPrompt({ events, notes: [] })

    expect(prompt.user).toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
    expect(prompt.user).toContain('Partners must not exceed')
    expect(prompt.system).toMatch(/never an instruction/i)
  })

  it('carries a version, because a telemetry row that cannot name its prompt is not traceability', () => {
    expect(boundary.promptVersion).toBe('session-reading@1')
  })

  it('includes typed notes separately from observed events', () => {
    const prompt = boundary.buildPrompt({ events, notes: ['ask legal about exclusivity'] })

    expect(prompt.user).toContain('Notes the person typed themselves')
    expect(prompt.user).toContain('ask legal about exclusivity')
  })
})

describe('the fake is held to the real contract', () => {
  it('returns a scripted value that satisfies the schema', async () => {
    const fake = new FakeModelClient([{ kind: 'ok', value: { claims: [validClaim] } }])

    const result = await fake.run(boundary, { events, notes: [] })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.claims[0]?.kind).toBe('objective')
    expect(fake.pendingReplies).toBe(0)
  })

  it('refuses a fixture the real API could never produce', async () => {
    // A fake that can return impossible values tests nothing — the suite goes
    // green on a shape production would reject.
    const fake = new FakeModelClient([
      { kind: 'ok', value: { claims: [{ ...validClaim, evidence: [{ ref: 'E404' }] }] } },
    ])

    await expect(fake.run(boundary, { events, notes: [] })).rejects.toThrow(
      /does not satisfy the boundary schema/i,
    )
  })

  it('records what it was asked, so control-flow tests can assert on the prompt', async () => {
    const fake = new FakeModelClient([{ kind: 'ok', value: { claims: [validClaim] } }])
    await fake.run(boundary, { events, notes: [] })

    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.boundary).toBe('session-reading')
    expect(fake.calls[0]?.promptVersion).toBe('session-reading@1')
  })

  it('scripts failures so the unattended paths are testable without the network', async () => {
    const fake = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    const result = await fake.run(boundary, { events, notes: [] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toBe('refusal')
  })

  it('throws on an unscripted call rather than inventing a default', async () => {
    const fake = new FakeModelClient([])

    await expect(fake.run(boundary, { events, notes: [] })).rejects.toThrow(/unscripted call/i)
  })
})
