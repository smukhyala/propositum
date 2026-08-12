/**
 * Layer 4 for the offer boundary — one round trip of real evidence.
 *
 * Excluded from `npm test` by `vitest.config.ts`. Run deliberately:
 *
 *   npm run test:live
 *
 * Worth the money, once. The schema is new, it is the widest prose any model
 * writes in this product, and it drops more constraints to the grammar than any
 * other boundary: `outcomeKinds` is a free string array whose closed set exists
 * only as prose in a description, and every length bound is enforced by Zod
 * after the fact. A fake cannot tell us whether a real model, given the real
 * prompt, stays inside them — that is the whole reason this layer exists.
 *
 * It also observes, without asserting, whether the model names a website when
 * told not to. It cannot cause harm if it does — there is no field for one —
 * but a model that keeps trying is worth knowing about, because the sentence it
 * would put on the offer screen is the one a person reads first.
 */

import { describe, it, expect } from 'vitest'
import { AnthropicModelClient } from '../src/model/anthropic'
import { offerBoundary, outcomeKindsOf } from '../src/model/boundaries/offer'
import { SHIFT_OUTCOME_KINDS, PRODUCIBLE } from '../src/domain/outcome/shift-outcome'
import { datamark } from '../src/model/untrusted'

try {
  process.loadEnvFile('.env')
} catch {
  /* CI may provide the key directly */
}

const apiKey = process.env['ANTHROPIC_API_KEY']

const titles = [
  'Parcel carrier rates 2026 — published price list',
  'Compare parcel carriers: weight bands explained',
  'Surcharges by carrier — fuel, remote area, oversize',
  'Parcel rates by weight: what changes above 5kg',
  'Carrier rate card — small business tiers',
]

describe.skipIf(!apiKey)('live: offer boundary', () => {
  it('composes an offer inside every bound the grammar does not enforce', async () => {
    const client = new AnthropicModelClient({ apiKey: apiKey as string })

    const result = await client.run(offerBoundary, {
      terms: ['parcel', 'carrier', 'rates', 'surcharges'],
      titles: titles.map((t) => datamark(t)),
      searches: [datamark('cheapest parcel carrier under 5kg')],
      subject: datamark('parcel carrier rates'),
      siteCount: 4,
      pageCount: 7,
      readingMinutes: 16,
      grounds: [
        'You searched for it, then read what came back.',
        'You stayed on one page long enough to have read it properly.',
        'You followed the subject across several places rather than reading one.',
      ],
      producible: PRODUCIBLE,
    })

    if (!result.ok) throw new Error(`boundary failed: ${result.failure} — ${result.detail}`)

    const offer = result.value

    // The bounds. Zod already refused anything outside them on the way in, so
    // this is really a statement that the model can work inside them at all —
    // a boundary whose only successful path is the repair turn is a bad prompt.
    expect(offer.title.length).toBeLessThanOrEqual(70)
    expect(offer.rationale.length).toBeLessThanOrEqual(240)
    expect(offer.outline.length).toBeLessThanOrEqual(6)
    expect(offer.outline.length).toBeGreaterThan(0)
    expect(offer.excludes.length).toBeLessThanOrEqual(4)

    // The closed set as prose: does a real model stay inside a list it was
    // shown in a description and nowhere else?
    const kept = outcomeKindsOf(offer.outcomeKinds)
    const invented = offer.outcomeKinds.filter(
      (k) => !(SHIFT_OUTCOME_KINDS as readonly string[]).includes(k.trim().toLowerCase()),
    )

    expect(result.telemetry.promptVersion).toBe('offer@1')

    console.log(
      `\n  model        ${result.telemetry.model}` +
        `\n  latency      ${result.telemetry.latencyMs} ms` +
        `\n  tokens       ${result.telemetry.inputTokens} in / ${result.telemetry.outputTokens} out` +
        `\n  repairs      ${result.telemetry.repairTurns}` +
        `\n  confident    ${offer.confident}` +
        `\n  title        ${offer.title}` +
        `\n  produces     ${offer.produces}` +
        `\n  kinds kept   ${kept.join(', ') || '(none)'}` +
        `\n  kinds dropped ${invented.join(', ') || '(none)'}` +
        `\n  outline:\n${offer.outline.map((o) => `    - ${o}`).join('\n')}` +
        `\n  will not:\n${offer.excludes.map((e) => `    - ${e}`).join('\n')}\n`,
    )

    // OBSERVED, NOT ASSERTED. There is no field for a place, so naming one in
    // prose grants nothing — but it is the sentence a person reads first, and
    // a model that keeps reaching for a hostname is worth knowing about.
    const prose = `${offer.title} ${offer.rationale} ${offer.outline.join(' ')} ${offer.produces}`
    console.log(`  names a hostname in prose (observation, not a failure): ${/\.(com|io|net|org)\b/i.test(prose)}`)
  }, 120_000)
})
