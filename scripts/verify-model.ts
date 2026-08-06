/**
 * Verification for issue #3.
 *
 * Part A runs offline and needs no credentials. It settles the two claims
 * carried over from #6, which were derived from reading SDK source rather
 * than from executing it:
 *
 *   1. Are `const` / `enum` / `default` preserved through schema transformation?
 *      If not, `z.enum()` is a prose hint to the model, not a grammar
 *      constraint — which decides whether discriminated unions are
 *      grammar-safe across all six model boundaries.
 *   2. Does `z.record()` collapse to "the empty object is the only legal
 *      value"?
 *
 * Part B needs ANTHROPIC_API_KEY and makes exactly one call, recording the
 * model id, latency and token cost for later budget decisions.
 *
 *   npm run verify:model
 */

import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'

// Node 22 can load .env itself; absent is fine for Part A.
try {
  process.loadEnvFile('.env')
} catch {
  /* no .env — Part A still runs */
}

const MODEL = process.env['PROPOSITUM_MODEL'] ?? 'claude-opus-5'

type Check = { name: string; question: string; verdict: string; detail: string }
const checks: Check[] = []

function transformed(schema: z.ZodType): Record<string, unknown> {
  // betaZodOutputFormat is the public path — whatever it produces is what
  // actually reaches the API, so inspecting it answers the real question
  // rather than an internal helper's behaviour.
  const format = betaZodOutputFormat(schema) as unknown as { schema?: unknown }
  return (format.schema ?? format) as Record<string, unknown>
}

function show(label: string, value: unknown): void {
  console.log(`\n${label}\n${JSON.stringify(value, null, 2)}`)
}

console.log('='.repeat(78))
console.log('PART A — offline schema transformation (no credentials needed)')
console.log('='.repeat(78))

// ---------------------------------------------------------------- enum
{
  const schema = z.object({ kind: z.enum(['objective', 'constraint', 'next-step']) })
  const out = transformed(schema)
  const json = JSON.stringify(out)
  const kept = json.includes('"enum"')
  show('z.enum() ->', out)
  checks.push({
    name: 'enum',
    question: 'Is z.enum() a grammar constraint or a prose hint?',
    verdict: kept ? 'PRESERVED — grammar constraint' : 'DROPPED — prose hint only',
    detail: kept
      ? 'Discriminated unions are grammar-safe; the model cannot return an out-of-set value.'
      : 'The allowed values survive only inside `description`. The model CAN return an out-of-set value, so every model-facing enum needs a Zod check plus a fail-closed path.',
  })
}

// --------------------------------------------------------------- const
{
  const schema = z.object({ version: z.literal('v1') })
  const out = transformed(schema)
  const kept = JSON.stringify(out).includes('"const"')
  show('z.literal() ->', out)
  checks.push({
    name: 'const',
    question: 'Does z.literal() survive as `const`?',
    verdict: kept ? 'PRESERVED' : 'DROPPED — folded into description',
    detail: kept
      ? 'Literal discriminators are enforced by the grammar.'
      : 'A discriminated union keyed on a literal is NOT grammar-safe. Prefer a flat object with a `kind` string, so a bad value fails on one named field rather than making the whole union unresolvable.',
  })
}

// ------------------------------------------------------------- default
{
  const schema = z.object({ retries: z.number().default(3) })
  const out = transformed(schema)
  const kept = JSON.stringify(out).includes('"default"')
  show('z.number().default(3) ->', out)
  checks.push({
    name: 'default',
    question: 'Does `default` survive?',
    verdict: kept ? 'PRESERVED' : 'DROPPED — folded into description',
    detail: kept ? 'Defaults reach the API.' : 'Defaults are applied client-side by Zod on parse, never by the model.',
  })
}

// -------------------------------------------------------------- record
{
  const schema = z.object({ counts: z.record(z.string(), z.number()) })
  const out = transformed(schema)
  const counts = (out['properties'] as Record<string, Record<string, unknown>> | undefined)?.['counts']
  const collapsed =
    counts?.['type'] === 'object' &&
    counts['additionalProperties'] === false &&
    Object.keys((counts['properties'] as object) ?? {}).length === 0
  show('z.record() ->', out)
  checks.push({
    name: 'record',
    question: 'Does z.record() collapse to an unfillable object?',
    verdict: collapsed ? 'COLLAPSED — only {} is legal' : 'USABLE',
    detail: collapsed
      ? 'z.record() is BANNED in model-facing schemas. properties:{} with additionalProperties:false means the empty object is the only value the grammar admits.'
      : 'z.record() survives transformation and may be used.',
  })
}

// ---------------------------------------------- refinements and bounds
{
  const schema = z.object({
    title: z.string().min(3).max(80),
    slug: z.string().regex(/^[a-z-]+$/),
    tags: z.array(z.string()).min(2),
  })
  const out = transformed(schema)
  const json = JSON.stringify(out)
  const anyKept = json.includes('"minLength"') || json.includes('"pattern"') || json.includes('"maxLength"')
  show('.min()/.max()/.regex() ->', out)
  checks.push({
    name: 'bounds',
    question: 'Do string bounds and patterns constrain the grammar?',
    verdict: anyKept ? 'PARTIALLY PRESERVED' : 'DROPPED — folded into description as prose',
    detail: anyKept
      ? 'Some bounds reach the API. Check which, individually.'
      : 'The grammar enforces SHAPE only; Zod enforces the rest client-side on parse. That gap is exactly where repair logic belongs.',
  })
}

console.log('\n' + '='.repeat(78))
console.log('PART A RESULTS')
console.log('='.repeat(78))
for (const c of checks) {
  console.log(`\n[${c.name}] ${c.question}`)
  console.log(`  ${c.verdict}`)
  console.log(`  -> ${c.detail}`)
}

// ------------------------------------------------------------- Part B
const apiKey = process.env['ANTHROPIC_API_KEY']

console.log('\n' + '='.repeat(78))
console.log('PART B — live round-trip')
console.log('='.repeat(78))

if (!apiKey) {
  console.log(`
SKIPPED — no ANTHROPIC_API_KEY.

  1. cp .env.example .env
  2. Put a key from https://console.anthropic.com in ANTHROPIC_API_KEY
  3. npm run verify:model

Part A above is complete and needed no key.`)
  process.exit(0)
}

const Reading = z.object({
  objective: z.string().describe('One sentence: what the person is trying to accomplish.'),
  confidence: z.enum(['high', 'medium', 'low']),
  openQuestions: z.array(z.string()).describe('What remains unresolved.'),
})

const client = new Anthropic({ apiKey })
const started = performance.now()

try {
  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 1024,
    output_format: betaZodOutputFormat(Reading),
    messages: [
      {
        role: 'user',
        content:
          'A person spent 40 minutes reading three partnership pages and drafting two sections ' +
          'of a proposal document, then stopped mid-sentence in the pricing section. ' +
          'Infer what they were doing.',
      },
    ],
  })

  const elapsedMs = Math.round(performance.now() - started)
  const parsed = message.parsed_output
  const usage = message.usage

  console.log('\nParsed and validated:')
  console.log(JSON.stringify(parsed, null, 2))
  console.log(`\n  model         ${message.model}`)
  console.log(`  stop_reason   ${message.stop_reason}`)
  console.log(`  latency       ${elapsedMs} ms`)
  console.log(`  input tokens  ${usage.input_tokens}`)
  console.log(`  output tokens ${usage.output_tokens}`)
  console.log('\nRecord these on issue #3 — they are the inputs to the budget decision.')
} catch (error) {
  const elapsedMs = Math.round(performance.now() - started)
  console.error(`\nFAILED after ${elapsedMs} ms`)
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
  console.error('\nIf this is an auth error the key is wrong. If it is a 404 on the model id,')
  console.error(`set PROPOSITUM_MODEL to one your account can reach (tried: ${MODEL}).`)
  process.exit(1)
}
