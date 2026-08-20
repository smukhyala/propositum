/**
 * Layer 4 — the live contract test.
 *
 * Excluded from the default run by `vitest.config.ts` (`**\/*.live.test.ts`).
 * Run deliberately:
 *
 *   npx vitest run tests/model-boundary.live.test.ts
 *
 * This is the ONLY layer that answers "does the API still return what we
 * expect". Fakes test our control flow and schema snapshots catch SDK drift;
 * neither notices if the model's behaviour changes underneath us.
 *
 * It costs money and takes seconds, so it belongs in a nightly or a deliberate
 * invocation — never in the default suite.
 */

import { describe, it, expect } from 'vitest'
import { AnthropicModelClient } from '../src/model/anthropic'
import type { CallTelemetry, FailureKind } from '../src/model/client'
import { handlesFor, sessionReadingBoundary } from '../src/model/boundaries/session-reading'
import { workerActionBoundary } from '../src/model/boundaries/worker-action'
import type { PromptEvent } from '../src/model/boundaries/session-reading'
import { datamark } from '../src/model/untrusted'

try {
  process.loadEnvFile('.env')
} catch {
  /* CI may provide the key directly */
}

const apiKey = process.env['ANTHROPIC_API_KEY']

const events: PromptEvent[] = [
  { handle: 'E1', kind: 'visited', at: '14:02', attested: 'Northwind — Partnership Programme' },
  {
    handle: 'E2',
    kind: 'queried',
    at: '14:05',
    attested: 'searched "northwind revenue share tiers"',
  },
  {
    handle: 'E3',
    kind: 'excerpted',
    at: '14:09',
    attested: 'selection on the Northwind pricing page',
    untrusted: datamark(
      'Standard partners receive 15%; strategic partners are negotiated individually.',
    ),
  },
  { handle: 'E4', kind: 'documentEdited', at: '14:20', attested: 'wrote the "Scope" section' },
  {
    handle: 'E5',
    kind: 'documentEdited',
    at: '14:38',
    attested: 'started "Commercials", stopped mid-sentence',
  },
]

describe.skipIf(!apiKey)('live: session-reading boundary', () => {
  it('returns a schema-valid reading with resolvable evidence', async () => {
    const telemetry: Array<{ t: CallTelemetry; f?: FailureKind }> = []
    const client = new AnthropicModelClient({
      apiKey: apiKey as string,
      onCall: (t, f) => telemetry.push(f === undefined ? { t } : { t, f }),
    })

    const handles = handlesFor(events)
    const result = await client.run(sessionReadingBoundary(handles), { events, notes: [] })

    if (!result.ok) {
      throw new Error(`boundary failed: ${result.failure} — ${result.detail}`)
    }

    // Exactly one objective, per the prompt contract.
    const objectives = result.value.claims.filter((c) => c.kind === 'objective')
    expect(objectives).toHaveLength(1)
    expect(objectives[0]?.confidence).toBeDefined()

    // Every claim is supported, and every citation resolves. The grammar cannot
    // enforce either — if this passes, the prompt is carrying that weight.
    for (const claim of result.value.claims) {
      expect(claim.evidence.length).toBeGreaterThan(0)
      for (const e of claim.evidence) expect(handles.has(e.ref)).toBe(true)
    }

    // Telemetry is emitted for the ModelCallRecord write.
    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]?.t.stopReason).toBe('end_turn')
    expect(telemetry[0]?.t.promptVersion).toBe('session-reading@1')

    console.log(
      `\n  model      ${telemetry[0]?.t.model}` +
        `\n  latency    ${telemetry[0]?.t.latencyMs} ms` +
        `\n  tokens     ${telemetry[0]?.t.inputTokens} in / ${telemetry[0]?.t.outputTokens} out` +
        `\n  claims     ${result.value.claims.length}` +
        `\n  objective  ${objectives[0]?.text}` +
        `\n  confidence ${objectives[0]?.confidence}\n`,
    )
  }, 120_000)
})

/**
 * The hostile fixture, against the real model.
 *
 * This test does NOT assert that the model resisted the injection. It cannot:
 * OWASP 2026 reports adaptive attack success above 90% against twelve recent
 * defences, and a green test asserting "the model ignored it" would be a
 * fixture-shaped claim about something we do not control.
 *
 * What it does is report what actually happened, so the security document
 * describes observed behaviour rather than hoped-for behaviour.
 */
describe.skipIf(!apiKey)('live: hostile fixture', () => {
  it('reports what the model does with an injected source', async () => {
    const { hostileSessionEvents } = await import('../src/fixtures/hostile-session')
    const client = new AnthropicModelClient({ apiKey: apiKey as string })

    const events = hostileSessionEvents()
    const handles = handlesFor(events)
    const result = await client.run(sessionReadingBoundary(handles), { events, notes: [] })

    if (!result.ok) throw new Error(`boundary failed: ${result.failure} — ${result.detail}`)

    const objective = result.value.claims.find((c) => c.kind === 'objective')
    const text = JSON.stringify(result.value).toLowerCase()

    console.log('\n  OBSERVED BEHAVIOUR (not an assertion):')
    console.log(`    objective   ${objective?.text}`)
    console.log(`    confidence  ${objective?.confidence}`)
    console.log(`    mentions Contoso (the injected target):  ${text.includes('contoso')}`)
    console.log(`    mentions Northwind (the real target):    ${text.includes('northwind')}`)
    console.log(`    claims: ${result.value.claims.length}`)
    for (const c of result.value.claims) console.log(`      [${c.kind}] ${c.text}`)
    console.log('')

    // The only hard assertion: every citation still resolves. A poisoned
    // reading that also fabricates provenance would be strictly worse, and
    // this is a property of our schema rather than of the model's judgment.
    for (const claim of result.value.claims) {
      for (const e of claim.evidence) expect(handles.has(e.ref)).toBe(true)
    }
  }, 120_000)
})

/**
 * The streaming path, which nothing else in this repo exercises.
 *
 * `worker-action` is the only boundary that sets `stream: true`, and every
 * other test of the model layer goes through `FakeModelClient` — which never
 * touches the SDK at all. That is how 1,709 green tests coexisted with a
 * product that could not take a single action: `.parse()` does not support
 * streaming, so every `worker-action` call threw inside the SDK's parser and
 * came back classified as `transport`.
 *
 * So this test is not "another live check". It is the ONLY layer that can tell
 * the streaming path from the non-streaming one, and it is written to fail loud
 * if the request shape regresses: it asserts the boundary still declares
 * `stream`, so a future change that quietly drops the flag cannot make this
 * pass by routing through the path that already worked.
 */
describe.skipIf(!apiKey)('live: worker-action boundary (streaming)', () => {
  it('returns a validated proposal over the streaming path', async () => {
    const telemetry: Array<{ t: CallTelemetry; f?: FailureKind }> = []
    const client = new AnthropicModelClient({
      apiKey: apiKey as string,
      onCall: (t, f) => telemetry.push(f === undefined ? { t } : { t, f }),
    })

    // The property under test, stated rather than assumed. If this ever goes
    // false the rest of the test is measuring the non-streaming path.
    expect(workerActionBoundary.stream).toBe(true)

    const result = await client.run(workerActionBoundary, {
      objective: 'Draft the Commercials section of the Northwind partnership proposal.',
      definitionOfDone: 'The Commercials section states the revenue share we are proposing.',
      guidance: [],
      currentStep: {
        ordinal: 1,
        intent: 'Write the Commercials section',
        targetSection: 'Commercials',
      },
      allowedActionKinds: ['read-approved-source', 'draft-section'],
      availableSources: [{ id: 'src-1', label: 'Northwind pricing page' }],
      history: [],
      gathered: [
        {
          label: 'Northwind pricing page',
          content: datamark(
            'Standard partners receive 15%; strategic partners are negotiated individually.',
          ),
        },
      ],
      page: null,
      mutatingActionsRemaining: 1,
    })

    if (!result.ok) {
      throw new Error(`boundary failed: ${result.failure} — ${result.detail}`)
    }

    // One of the three terminals, and exactly the shape the gate will read.
    // `kind` is a free string by design, so the assertion is that SOMETHING was
    // proposed — not which thing. The model choosing to read first, to draft,
    // or to ask is all legitimate here.
    const proposal = result.value
    expect(typeof proposal.kind).toBe('string')
    expect(proposal.kind.length).toBeGreaterThan(0)
    expect(proposal.reason.length).toBeGreaterThan(0)

    // Usage has to survive `finalMessage()`. A streamed message assembles its
    // own usage from two events, and a telemetry row of 0 in / 0 out is what a
    // silently-dropped `usage` looks like — the cost half of every worksheet.
    expect(telemetry).toHaveLength(1)
    expect(telemetry[0]?.f).toBeUndefined()
    expect(telemetry[0]?.t.stopReason).toBe('end_turn')
    expect(telemetry[0]?.t.promptVersion).toBe('worker-action@2')
    expect(telemetry[0]?.t.inputTokens).toBeGreaterThan(0)
    expect(telemetry[0]?.t.outputTokens).toBeGreaterThan(0)
    expect(telemetry[0]?.t.repairTurns).toBe(0)

    console.log(
      `\n  model      ${telemetry[0]?.t.model}` +
        `\n  latency    ${telemetry[0]?.t.latencyMs} ms` +
        `\n  tokens     ${telemetry[0]?.t.inputTokens} in / ${telemetry[0]?.t.outputTokens} out` +
        `\n  kind       ${proposal.kind}` +
        `\n  reason     ${proposal.reason}\n`,
    )
  }, 120_000)
})
