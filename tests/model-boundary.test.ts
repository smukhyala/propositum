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
import { AnthropicError, APIConnectionError, APIError } from '@anthropic-ai/sdk'
import { classifyStopReason, recoveryFor } from '../src/model/client'
import type { CallTelemetry, FailureKind } from '../src/model/client'
import { AnthropicModelClient, classifyThrow } from '../src/model/anthropic'
import { FakeModelClient } from '../src/model/fake'
import {
  handlesFor,
  sessionReadingBoundary,
  sessionReadingSchema,
} from '../src/model/boundaries/session-reading'
import type { PromptEvent } from '../src/model/boundaries/session-reading'
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

/**
 * The SDK's own refusal, verbatim.
 *
 * From `calculateNonstreamingTimeout` in `client.js` of `@anthropic-ai/sdk`
 * 0.71.2, raised as a bare `AnthropicError` before the request is built.
 * Copied rather than imported, because it is not exported and the whole point
 * of these tests is that our classification still matches the words the
 * installed SDK ships. **If an upgrade reworks that sentence this string is
 * the thing to re-check**, and the tests below will say so by going red.
 */
const SDK_STREAMING_REFUSAL =
  'Streaming is required for operations that may take longer than 10 minutes. ' +
  'See https://github.com/anthropics/anthropic-sdk-typescript#long-requests for more details'

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

  it('reads the refusal the SDK actually raises, which names no field at all', () => {
    // The branch above is not what catches this. Until 2026-09-03 the only
    // local-refusal test here was `/max_tokens/i`, and the sentence the SDK
    // ships mentions no field — so this was `transport`, and
    // `recoveryFor('transport')` is `none`. The escalation its comment
    // promised had never once fired.
    expect(SDK_STREAMING_REFUSAL).not.toMatch(/max_tokens/i)
    expect(classifyThrow(new AnthropicError(SDK_STREAMING_REFUSAL))).toBe('truncation')
    expect(recoveryFor(classifyThrow(new AnthropicError(SDK_STREAMING_REFUSAL)))).toBe(
      'escalate-tokens',
    )
  })

  it('does not mistake an API error using the same words for our own refusal', () => {
    // The same reason the `max_tokens` case runs after the HTTP check: the
    // words are only ours when nothing was sent. A 400 saying them is a round
    // trip that happened, and doubling the budget would not answer it.
    const httpError = new APIError(
      400,
      { message: SDK_STREAMING_REFUSAL },
      undefined,
      new Headers(),
    )

    expect(classifyThrow(httpError)).toBe('transport')
    expect(recoveryFor(classifyThrow(httpError))).toBe('none')
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

/* ── the request the SDK will not send ──────────────────────────────────── */

/**
 * What happens once that refusal is classified, end to end.
 *
 * ── Why the model here is an Opus 4 id ───────────────────────────────────
 *
 * Because it is the only way to reach the refusal at all. `attempt` computes
 * `stream = boundary.stream ?? maxTokens > NON_STREAMING_MAX_TOKENS`, so a
 * budget over that constant already streams and never asks the SDK for the
 * shape it refuses. What the constant does not know is that the SDK carries a
 * PER-MODEL non-streaming cap as well — `MODEL_NONSTREAMING_TOKENS` in
 * `internal/constants.js`, 8,192 for the Opus 4 family — and `PROPOSITUM_MODEL`
 * picks the model at runtime. A 12,000-token budget on that model is under our
 * bound, over the SDK's, and refused locally: the real reachable case rather
 * than a contrivance.
 *
 * No boundary in `src/model/boundaries` is sized to hit this on the default
 * model, and that is said rather than hidden — what these two buy is that the
 * recovery is watched happening at all, on a path where it was only ever a
 * comment.
 *
 * They do NOT cover a live call, an SDK that has reworded its refusal, or the
 * repair turn — that is `describe('a reply that is whole and the wrong shape')`
 * above, and `tests/model-boundary.live.test.ts` for the real API.
 */
describe('an oversized non-streaming request', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  /** A model the SDK holds a non-streaming cap for. See the block above. */
  const CAPPED_MODEL = 'claude-opus-4-1-20250805'

  /** One streamed assistant reply, as the API would put it on the wire. */
  function streamed(json: string): string {
    const wire: ReadonlyArray<readonly [string, unknown]> = [
      [
        'message_start',
        {
          type: 'message_start',
          message: {
            id: 'msg_streamed',
            type: 'message',
            role: 'assistant',
            model: CAPPED_MODEL,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 640, output_tokens: 1 },
          },
        },
      ],
      [
        'content_block_start',
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      ],
      [
        'content_block_delta',
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json } },
      ],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      [
        'message_delta',
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 812 },
        },
      ],
      ['message_stop', { type: 'message_stop' }],
    ]

    return wire.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
  }

  /** Answers a streaming request and nothing else — a non-streaming one that
   *  reached here would mean the escalation had not flipped the call shape. */
  function streamingOnlyFetch(): {
    fetch: typeof globalThis.fetch
    requests: Array<Record<string, unknown>>
  } {
    const requests: Array<Record<string, unknown>> = []

    const fetch = (async (_url: unknown, init: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      requests.push(body)

      if (body.stream !== true) {
        return new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'this stub only answers a stream' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      return new Response(streamed(JSON.stringify({ claims: [validClaim] })), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })
    }) as unknown as typeof globalThis.fetch

    return { fetch, requests }
  }

  function clientOn(model: string) {
    const script = streamingOnlyFetch()
    globalThis.fetch = script.fetch
    const seen: Array<{ t: CallTelemetry; f?: FailureKind }> = []

    const client = new AnthropicModelClient({
      apiKey: 'not-a-real-key',
      model,
      onCall: (t, f) => seen.push({ t, ...(f === undefined ? {} : { f }) }),
    })

    return { client, seen, requests: script.requests }
  }

  it('escalates onto the streaming path, which is the one shape the SDK will send', async () => {
    const { client, seen, requests } = clientOn(CAPPED_MODEL)

    const result = await client.run({ ...boundary, maxTokens: 12_000 }, { events, notes: [] })

    // The first attempt never reached the network: the SDK refuses before it
    // builds a request, which is why filing this as `transport` was a claim
    // about a round trip that had not happened.
    expect(requests).toHaveLength(1)
    expect(requests[0]?.max_tokens).toBe(24_000)
    expect(requests[0]?.stream).toBe(true)
    // The streaming call shape, not the parse one. See the file header in
    // `anthropic.ts` for why the two cannot be one field.
    expect(requests[0]).toHaveProperty('output_config')

    expect(seen).toHaveLength(2)
    expect(seen[0]?.f).toBe('truncation')
    // Null rather than zero: there was no message and so no usage on it.
    expect(seen[0]?.t.inputTokens).toBeNull()
    expect(seen[1]?.f).toBeUndefined()
    expect(seen[1]?.t.repairTurns).toBe(1)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.claims[0]?.kind).toBe('objective')
  })

  it('says the budget was the problem, not the network, when doubling does not help', async () => {
    // 9,000 doubles to 18,000 — over the SDK's per-model cap, under ours — so
    // the retry is refused the same way and the call ends terminal. It costs
    // nothing but microseconds: neither attempt is built, sent or billed. Worth
    // pinning because it is the honest half — what the fix buys here is a truer
    // report, not a recovery.
    const { client, seen, requests } = clientOn(CAPPED_MODEL)

    const result = await client.run({ ...boundary, maxTokens: 9_000 }, { events, notes: [] })

    expect(requests).toHaveLength(0)
    expect(seen).toHaveLength(2)
    expect(seen.every((call) => call.f === 'truncation')).toBe(true)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure).toBe('truncation')
      expect(result.detail).toMatch(/streaming is required/i)
    }
  })
})
