/**
 * The evaluation harness CLI.
 *
 *   npm run eval -- --seal            seal any unsealed references
 *   npm run eval -- --check           verify every seal, run nothing
 *   npm run eval -- --dry             run against a fake model (no cost)
 *   npm run eval                      run against the real model
 *   npm run eval -- --baseline        also run the raw-log baseline
 *
 * Produces a scoring worksheet per scenario. It does not produce H1 scores —
 * those are entered by a person, because a model judge shares the generator's
 * blind spots and at n=1 there is no second signal to catch that.
 */

import { AnthropicModelClient } from '../src/model/anthropic.js'
import { FakeModelClient } from '../src/model/fake.js'
import type { ModelClient } from '../src/model/client.js'
import { SCENARIOS } from '../src/eval/index.js'
import { checkSeal, readSeals, sealNew, writeSeals } from '../src/eval/seal.js'
import { renderWorksheet, runScenario } from '../src/eval/run.js'

try {
  process.loadEnvFile('.env')
} catch {
  /* --dry and --seal need no key */
}

const args = new Set(process.argv.slice(2))
const wantsBaseline = args.has('--baseline')

/* ── --check ────────────────────────────────────────────────────────────── */

if (args.has('--check')) {
  const seals = readSeals()
  let bad = 0

  for (const scenario of SCENARIOS) {
    const status = checkSeal(scenario, seals)
    const label =
      status.state === 'sealed'
        ? `sealed ${status.sealedAt}`
        : status.state === 'unsealed'
          ? 'UNSEALED'
          : `BROKEN (sealed ${status.sealedAt})`
    if (status.state === 'broken') bad += 1
    console.log(`  ${status.state === 'sealed' ? '✓' : '✗'} ${scenario.id.padEnd(24)} ${label}`)
  }

  if (bad > 0) {
    console.error(`\n${bad} broken seal(s). H1 scores from these scenarios are not admissible.`)
    process.exit(1)
  }
  process.exit(0)
}

/* ── --seal ─────────────────────────────────────────────────────────────── */

if (args.has('--seal')) {
  // Timestamp passed in rather than read inside the module, so the lock stays
  // reproducible in tests.
  const now = new Date().toISOString()
  const { seals, newlySealed, broken } = sealNew(SCENARIOS, now)

  if (broken.length) {
    console.error(
      `Refusing to re-seal: ${broken.join(', ')}\n\n` +
        'A broken seal means an answer key changed after it was written. Re-sealing ' +
        'discards the measurements it invalidates, so it has to be a deliberate edit ' +
        'to references.lock.json, not a flag.',
    )
    process.exit(1)
  }

  if (!newlySealed.length) {
    console.log('Nothing to seal — every reference is already sealed.')
    process.exit(0)
  }

  writeSeals(seals)
  console.log(`Sealed ${newlySealed.length}:`)
  for (const id of newlySealed) console.log(`  ${id}`)
  console.log('\nCommit references.lock.json. The answer keys are now fixed.')
  process.exit(0)
}

/* ── run ────────────────────────────────────────────────────────────────── */

const dry = args.has('--dry')
let client: ModelClient

if (dry) {
  // Enough scripted replies for one reading (plus a baseline) per scenario.
  // Deliberately thin: --dry proves the harness runs, nothing more.
  const replies = SCENARIOS.flatMap((s) => {
    const one = {
      kind: 'ok' as const,
      value: {
        claims: [
          {
            kind: 'objective' as const,
            text: `(fake reading for ${s.id})`,
            confidence: 'low' as const,
            evidence: [{ ref: s.events[0]?.handle ?? 'E1' }],
          },
        ],
      },
    }
    return wantsBaseline
      ? [one, { kind: 'ok' as const, value: { summary: '(fake baseline)', nextSteps: [] } }]
      : [one]
  })
  client = new FakeModelClient(replies)
} else {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) {
    console.error('No ANTHROPIC_API_KEY. Use --dry to exercise the harness without one.')
    process.exit(1)
  }
  client = new AnthropicModelClient({ apiKey })
}

let exitCode = 0

for (const scenario of SCENARIOS) {
  try {
    const run = await runScenario(client, scenario, { withBaseline: wantsBaseline })
    console.log('\n' + renderWorksheet(run))
    if (run.failures.length) exitCode = 1
  } catch (error) {
    console.error(`\n${scenario.id}: ${error instanceof Error ? error.message : String(error)}`)
    exitCode = 1
  }
}

if (!dry) {
  console.log(
    '\nEnter the H1 component scores against the worksheets above.\n' +
      'Every reported number carries its protocol: n=1, references sealed before the run.',
  )
}

process.exit(exitCode)
