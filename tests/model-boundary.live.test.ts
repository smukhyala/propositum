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
import { AnthropicModelClient } from '../src/model/anthropic.js'
import type { CallTelemetry, FailureKind } from '../src/model/client.js'
import { handlesFor, sessionReadingBoundary } from '../src/model/boundaries/session-reading.js'
import type { PromptEvent } from '../src/model/boundaries/session-reading.js'

try {
  process.loadEnvFile('.env')
} catch {
  /* CI may provide the key directly */
}

const apiKey = process.env['ANTHROPIC_API_KEY']

const events: PromptEvent[] = [
  { handle: 'E1', kind: 'visited', at: '14:02', attested: 'Northwind — Partnership Programme' },
  { handle: 'E2', kind: 'queried', at: '14:05', attested: 'searched "northwind revenue share tiers"' },
  {
    handle: 'E3',
    kind: 'excerpted',
    at: '14:09',
    attested: 'selection on the Northwind pricing page',
    untrusted: 'Standard partners receive 15%; strategic partners are negotiated individually.',
  },
  { handle: 'E4', kind: 'documentEdited', at: '14:20', attested: 'wrote the "Scope" section' },
  { handle: 'E5', kind: 'documentEdited', at: '14:38', attested: 'started "Commercials", stopped mid-sentence' },
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
