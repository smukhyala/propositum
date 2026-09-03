/**
 * Model boundary: failure classification, the fake's contract, and the
 * reference boundary's schema.
 *
 * Layer 1 of the four-layer strategy (fakes). Layer 3 lives in
 * schema-transformation.test.ts. Layer 2 (cassettes) and layer 4 (tagged live
 * contract tests) arrive with the build slices — noting that here rather than
 * leaving the gap implicit.
 */

import { describe, it, expect, afterEach } from 'vitest'
import Anthropic, { AnthropicError, APIConnectionError, APIError } from '@anthropic-ai/sdk'
import {
  BOUNDARY_NAMES,
  NON_STREAMING_MAX_TOKENS,
  classifyStopReason,
  recoveryFor,
} from '../src/model/client'
import type { CallTelemetry, FailureKind, ModelBoundary } from '../src/model/client'
import { AnthropicModelClient, classifyThrow } from '../src/model/anthropic'
import { FakeModelClient } from '../src/model/fake'
import {
  handlesFor,
  sessionReadingBoundary,
  sessionReadingSchema,
} from '../src/model/boundaries/session-reading'
import type { PromptEvent } from '../src/model/boundaries/session-reading'
import { handoffBoundary } from '../src/model/boundaries/handoff'
import { offerBoundary } from '../src/model/boundaries/offer'
import { planBoundary } from '../src/model/boundaries/plan'
import { reviewBoundary } from '../src/model/boundaries/review'
import { shiftReportBoundary } from '../src/model/boundaries/shift-report'
import { subjectBoundary } from '../src/model/boundaries/subject'
import { workerActionBoundary } from '../src/model/boundaries/worker-action'
import { datamark } from '../src/model/untrusted'

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

/* ── the shape failure, end to end ──────────────────────────────────────── */

/**
 * What the client does with a reply that came back whole and wrong.
 *
 * ── Why these run against a stubbed `fetch` and not the fake ─────────────
 *
 * `FakeModelClient` never touches the SDK, and the SDK is where the defect
 * was: `betaZodOutputFormat` hands `beta.messages.parse()` a validator that
 * THROWS, so a reply in the wrong shape arrived as an exception rather than a
 * message. `AnthropicModelClient` builds its own SDK, so `globalThis.fetch` is
 * the only seam — the same one `tests/model-telemetry.test.ts` uses, and for
 * the same reason.
 *
 * The scenario is the real one, from the 2026-09-02 eval run: a session
 * reading citing an evidence handle it was never shown. The refinement in
 * `boundaries/session-reading.ts` rejects it correctly; before this the throw
 * was filed `transport`, `recoveryFor('transport')` is `none`, and the one
 * repair turn that exists for exactly this never fired. `partnership-messy`
 * produced no reading at all, and the failed attempt was recorded as free.
 *
 * These do NOT test the streaming path, which never reaches the SDK's parser
 * and has decoded its own text since 2026-08-20, or a live call — that is
 * `tests/model-boundary.live.test.ts`, which costs money and is excluded here.
 */
describe('a reply that is whole and the wrong shape', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** One assistant reply, as the API would put it on the wire. */
  function reply(text: string, stopReason: string): unknown {
    return {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5',
      content: [{ type: 'text', text }],
      stop_reason: stopReason,
      stop_sequence: null,
      usage: { input_tokens: 1235, output_tokens: 1053 },
    }
  }

  const citing = (handle: string) =>
    JSON.stringify({ claims: [{ ...validClaim, evidence: [{ ref: handle }] }] })

  /** Replies handed out in order, with every request body kept. */
  function scriptedFetch(replies: readonly unknown[]): {
    fetch: typeof globalThis.fetch
    requests: Array<Record<string, unknown>>
  } {
    const requests: Array<Record<string, unknown>> = []
    let next = 0

    const fetch = (async (_url: unknown, init: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      const body = replies[next] ?? replies[replies.length - 1]
      next += 1
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof globalThis.fetch

    return { fetch, requests }
  }

  function clientOver(replies: readonly unknown[]) {
    const script = scriptedFetch(replies)
    globalThis.fetch = script.fetch
    const seen: Array<{ t: CallTelemetry; f?: FailureKind }> = []

    const client = new AnthropicModelClient({
      apiKey: 'not-a-real-key',
      onCall: (t, f) => seen.push({ t, ...(f === undefined ? {} : { f }) }),
    })

    return { client, seen, requests: script.requests }
  }

  it('repairs a fabricated evidence handle exactly once, and succeeds', async () => {
    // The failure that lost `partnership-messy`. Before this the SDK threw on
    // the first reply, the throw was `transport`, and there was no second call.
    const { client, seen, requests } = clientOver([
      reply(citing('E99'), 'end_turn'),
      reply(citing('E1'), 'end_turn'),
    ])

    const result = await client.run(boundary, { events, notes: [] })

    expect(requests).toHaveLength(2)
    expect(result.ok).toBe(true)

    expect(seen).toHaveLength(2)
    expect(seen[0]?.f).toBe('schema-mismatch')
    expect(seen[0]?.t.repairTurns).toBe(0)
    expect(seen[1]?.f).toBeUndefined()
    expect(seen[1]?.t.repairTurns).toBe(1)
  })

  it('quotes the Zod issue back, which is the only reason re-asking is rational', async () => {
    const { client, requests } = clientOver([
      reply(citing('E99'), 'end_turn'),
      reply(citing('E1'), 'end_turn'),
    ])

    await client.run(boundary, { events, notes: [] })

    const second = JSON.stringify(requests[1])
    expect(second).toMatch(/did not match the required shape/i)
    expect(second).toMatch(/event handles shown in the prompt/i)
  })

  it('records what the failed attempt actually billed, not zero', async () => {
    // The cost half. A reply that arrives and is rejected was generated and
    // charged for; `$0.0000 · 22298 ms` is how a run total becomes a floor
    // printed as a figure.
    const { client, seen } = clientOver([reply(citing('E99'), 'end_turn')])

    await client.run(boundary, { events, notes: [] })

    expect(seen[0]?.t.inputTokens).toBe(1235)
    expect(seen[0]?.t.outputTokens).toBe(1053)
    expect(seen[0]?.t.stopReason).toBe('end_turn')
  })

  it('escalates the budget once when the reply ran out of tokens', async () => {
    // Truncated JSON is not JSON, so the SDK's validator threw on this too and
    // every truncated non-streaming reply was `transport` — parse before
    // classify, forced on us from inside the SDK, which is the exact order
    // ADR-0005 spends a section forbidding.
    const { client, seen, requests } = clientOver([
      reply('{"claims":[{"kind":"objec', 'max_tokens'),
      reply(citing('E1'), 'end_turn'),
    ])

    const result = await client.run(boundary, { events, notes: [] })

    expect(seen[0]?.f).toBe('truncation')
    expect(requests[0]?.max_tokens).toBe(boundary.maxTokens)
    expect(requests[1]?.max_tokens).toBe(boundary.maxTokens * 2)
    expect(result.ok).toBe(true)
  })

  it('does not repair a transport failure, and reports no tokens rather than none spent', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          type: 'error',
          error: { type: 'invalid_request_error', message: 'no transport in tests' },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch

    const seen: Array<{ t: CallTelemetry; f?: FailureKind }> = []
    const client = new AnthropicModelClient({
      apiKey: 'not-a-real-key',
      onCall: (t, f) => seen.push({ t, ...(f === undefined ? {} : { f }) }),
    })

    const result = await client.run(boundary, { events, notes: [] })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toBe('transport')
    // One attempt. The SDK already backs off; stacking our own retries hides
    // the real error behind a timeout.
    expect(seen).toHaveLength(1)
    // Null, not zero: the usage block was on a message nobody ever held.
    expect(seen[0]?.t.inputTokens).toBeNull()
    expect(seen[0]?.t.outputTokens).toBeNull()
  })
})

/* ── the throw that reaches us anyway ───────────────────────────────────── */

/**
 * `classifyThrow`, on its own.
 *
 * `structuredOutput` stops the SDK throwing for a shape failure on the
 * non-streaming path, which is the fix. This is the fallback for a throw that
 * arrives regardless — from the streaming path, or from a future SDK — and it
 * is unit-tested because the whole defect was one branch of a conditional
 * nobody could reach without the network.
 */
describe('classifying a throw out of the SDK', () => {
  it('reads the whole HTTP family as transport, structurally', () => {
    // `APIConnectionError` extends `APIError`, so one instanceof covers a 4xx,
    // a 5xx, a socket that never opened and an abort.
    expect(classifyThrow(new APIConnectionError({ message: 'socket hung up' }))).toBe('transport')
    expect(classifyThrow(new APIError(400, undefined, 'bad request', new Headers()))).toBe(
      'transport',
    )
  })

  it('does not mistake a 400 whose body mentions max_tokens for our own oversized request', () => {
    // The HTTP test runs first for this reason: the API talking about a field
    // is not us asking for a budget this call shape cannot carry.
    const httpError = new APIError(
      400,
      { message: 'max_tokens: must be less than or equal to 8192' },
      undefined,
      new Headers(),
    )

    expect(classifyThrow(httpError)).toBe('transport')
  })

  it('reads a local budget refusal as truncation', () => {
    expect(classifyThrow(new AnthropicError('max_tokens is too large for this call'))).toBe(
      'truncation',
    )
  })

  it('reads the SDK’s own refusal of an oversized non-streaming request as truncation', () => {
    // The message the installed SDK actually raises, verbatim from
    // `calculateNonstreamingTimeout` in `@anthropic-ai/sdk/src/client.ts`. It
    // names no field, so the `max_tokens` arm above never matched it, and until
    // 2026-09-03 it was filed `transport` — the one classification that grants
    // no retry. Item 11 of `docs/todo/04-quick-fixes.md`.
    const refused = new AnthropicError(
      'Streaming is required for operations that may take longer than 10 minutes. ' +
        'See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details',
    )

    expect(classifyThrow(refused)).toBe('truncation')
    expect(recoveryFor(classifyThrow(refused))).toBe('escalate-tokens')
  })

  it('reads the SDK parser’s own throw as a shape failure, so the repair turn fires', () => {
    // What `partnership-messy` produced, and what was filed as `transport`.
    // The `cause:` in that log line is TEXT INSIDE THE MESSAGE — the SDK
    // interpolates the Zod issues rather than attaching them — which is why
    // this last test is a message test and not a structural one.
    const thrown = new AnthropicError(
      'Failed to parse structured output: Error: Failed to parse structured output: ' +
        '[ { "code": "custom", "path": ["claims",0,"evidence",4,"ref"], ' +
        '"message": "must be one of the event handles shown in the prompt" } ] ' +
        'cause: [object Object]',
    )

    expect(classifyThrow(thrown)).toBe('schema-mismatch')
    expect(recoveryFor(classifyThrow(thrown))).toBe('repair')
  })

  it('leaves anything else as transport, which grants no retry of ours', () => {
    expect(classifyThrow(new Error('something else entirely'))).toBe('transport')
    expect(classifyThrow('not an error at all')).toBe('transport')
  })
})

/* ── the doubled budget, against the constants ──────────────────────────── */

/**
 * What `escalate-tokens` does to every budget in `src/model/boundaries`.
 *
 * The todo that deferred the arm above claimed the doubled budget "crosses
 * `NON_STREAMING_MAX_TOKENS` and flips the call onto the streaming path". It
 * does not: the largest budget doubled is still under the constant, so the
 * retry `recoveryFor('truncation')` buys runs on the SAME transport as the
 * attempt it retries. This is asserted against the boundaries and the constant
 * rather than against a copied number, so a budget raised past half the
 * threshold fails here and not at 2am.
 *
 * The constant itself is pinned to the installed SDK through the public
 * `calculateNonstreamingTimeout`, which is the function that throws: one token
 * over is refused, the constant itself is not.
 *
 * What this does NOT cover: the SDK's per-model cap, `MODEL_NONSTREAMING_TOKENS`
 * in `@anthropic-ai/sdk/src/internal/constants.ts`, which refuses the opus-4
 * family well under the constant. The default model is not in that map, and
 * nothing here reads it — a `PROPOSITUM_MODEL` in that family can meet the
 * refusal on a doubled budget this file calls safe.
 */
describe('the doubled budget stays on the non-streaming path', () => {
  const someHandles: ReadonlySet<string> = new Set(['E1'])
  const budgets: ReadonlyArray<ModelBoundary<unknown, unknown>> = [
    sessionReadingBoundary(someHandles),
    handoffBoundary(someHandles),
    reviewBoundary(someHandles),
    offerBoundary,
    planBoundary,
    subjectBoundary,
    shiftReportBoundary,
    workerActionBoundary,
  ] as ReadonlyArray<ModelBoundary<unknown, unknown>>

  it('names every boundary once', () => {
    // A boundary added to `BOUNDARY_NAMES` without a line above would make the
    // arithmetic below a statement about fewer budgets than exist. The closed
    // set is the thing that knows how many there are; no count is kept here.
    expect(new Set(budgets.map((b) => b.name)).size).toBe(budgets.length)
    expect(budgets.map((b) => b.name).sort()).toEqual([...BOUNDARY_NAMES].sort())
  })

  it('doubles under NON_STREAMING_MAX_TOKENS for every boundary', () => {
    expect(recoveryFor('truncation')).toBe('escalate-tokens')
    for (const b of budgets) {
      expect(b.maxTokens * 2, `${b.name} doubled`).toBeLessThanOrEqual(NON_STREAMING_MAX_TOKENS)
    }
  })

  it('has NON_STREAMING_MAX_TOKENS pinned to the installed SDK’s threshold', () => {
    const sdk = new Anthropic({ apiKey: 'not-a-real-key' })

    expect(() => sdk.calculateNonstreamingTimeout(NON_STREAMING_MAX_TOKENS)).not.toThrow()
    expect(() => sdk.calculateNonstreamingTimeout(NON_STREAMING_MAX_TOKENS + 1)).toThrow(
      /Streaming is required/,
    )
  })
})

/* ── the retry, watched ─────────────────────────────────────────────────── */

/**
 * The escalation the arm above unlocks, seen through `run`.
 *
 * No real budget can reach the SDK's refusal: `attempt` flips to streaming
 * above `NON_STREAMING_MAX_TOKENS` before the SDK sees the request, and the
 * suite above says every doubled budget is under it. So the boundary here is
 * contrived on purpose — `stream: false` said explicitly, which `attempt`
 * honours over its own guard, and a budget one over the threshold. The SDK
 * then refuses locally, before `fetch`, on both attempts.
 *
 * What is being watched is the loop: one attempt, one `truncation`, one
 * doubled retry, one more `truncation`, no third. Before 2026-09-03 the same
 * run recorded ONE `transport` failure and stopped. What this does NOT cover
 * is a retry that succeeds — that needs the SDK's threshold to be the thing
 * the doubling fixes, and here it is not, which is the honest shape of this
 * recovery when the message is the cause.
 */
describe('the refusal, through the loop', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('retries once at double the budget, files both as truncation, and stops', async () => {
    let fetches = 0
    globalThis.fetch = (async () => {
      fetches += 1
      throw new Error('the SDK must refuse before any request is built')
    }) as unknown as typeof globalThis.fetch

    const seen: Array<{ t: CallTelemetry; f?: FailureKind }> = []
    const client = new AnthropicModelClient({
      apiKey: 'not-a-real-key',
      onCall: (t, f) => seen.push({ t, ...(f === undefined ? {} : { f }) }),
    })

    const oversized: typeof boundary = {
      ...boundary,
      maxTokens: NON_STREAMING_MAX_TOKENS + 1,
      stream: false,
    }

    const result = await client.run(oversized, { events, notes: [] })

    expect(fetches).toBe(0)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('truncation')
    expect(result.detail).toMatch(/Streaming is required/)

    expect(seen.map((s) => s.f)).toEqual(['truncation', 'truncation'])
    expect(seen.map((s) => s.t.repairTurns)).toEqual([0, 1])
    expect(seen[0]?.t.inputTokens).toBeNull()
  })
})
