/**
 * Schema snapshot tests — layer 3 of the strategy in
 * docs/research/structured-model-output.md.
 *
 * These assert what the Anthropic SDK actually does to a Zod schema on its way
 * to the API. They need no network and no credentials, and they exist to fail
 * loudly if a Zod or SDK upgrade silently changes the grammar.
 *
 * That failure mode is the dangerous one: a bump that starts (or stops)
 * enforcing `enum` would change what the model can return, with no error and
 * no visible symptom until a model-facing boundary quietly accepts garbage.
 *
 * If one of these fails, do not "fix" the test. Read the diff, work out what
 * the SDK now does, and revisit the affected boundary schemas first.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'

function transformed(schema: z.ZodType): Record<string, unknown> {
  const format = betaZodOutputFormat(schema) as unknown as { schema?: unknown }
  return (format.schema ?? format) as Record<string, unknown>
}

function propertyOf(schema: z.ZodType, key: string): Record<string, unknown> {
  const props = transformed(schema)['properties'] as Record<string, Record<string, unknown>>
  const prop = props[key]
  if (!prop) throw new Error(`no property ${key}`)
  return prop
}

describe('the grammar enforces shape only', () => {
  it('drops z.enum() to a prose hint, so an out-of-set value is possible', () => {
    const prop = propertyOf(z.object({ kind: z.enum(['objective', 'constraint']) }), 'kind')

    expect(prop['enum']).toBeUndefined()
    expect(prop['type']).toBe('string')
    expect(String(prop['description'])).toContain('objective')
  })

  it('drops z.literal() to a prose hint, so discriminated unions are not grammar-safe', () => {
    const prop = propertyOf(z.object({ version: z.literal('v1') }), 'version')

    expect(prop['const']).toBeUndefined()
    expect(String(prop['description'])).toContain('v1')
  })

  it('drops defaults — Zod applies them client-side, the model never sees them enforced', () => {
    const prop = propertyOf(z.object({ retries: z.number().default(3) }), 'retries')

    expect(prop['default']).toBeUndefined()
  })

  it('drops string bounds and patterns into the description', () => {
    const schema = z.object({
      title: z.string().min(3).max(80),
      slug: z.string().regex(/^[a-z-]+$/),
    })

    const title = propertyOf(schema, 'title')
    expect(title['minLength']).toBeUndefined()
    expect(title['maxLength']).toBeUndefined()
    expect(String(title['description'])).toContain('minLength')

    const slug = propertyOf(schema, 'slug')
    expect(slug['pattern']).toBeUndefined()
  })
})

describe('constructs that are banned in model-facing schemas', () => {
  it('z.record() collapses so the empty object is the only legal value', () => {
    const prop = propertyOf(z.object({ counts: z.record(z.string(), z.number()) }), 'counts')

    expect(prop['type']).toBe('object')
    expect(prop['properties']).toEqual({})
    expect(prop['additionalProperties']).toBe(false)
  })
})

describe('what the grammar does enforce', () => {
  it('forbids additional properties and keeps the required list', () => {
    const out = transformed(z.object({ a: z.string(), b: z.number() }))

    expect(out['additionalProperties']).toBe(false)
    expect(out['required']).toEqual(['a', 'b'])
  })

  it('keeps types and nesting intact', () => {
    const out = transformed(
      z.object({ outer: z.object({ inner: z.array(z.string()) }) }),
    )
    const outer = (out['properties'] as Record<string, Record<string, unknown>>)['outer']

    expect(outer?.['type']).toBe('object')
    expect(
      (outer?.['properties'] as Record<string, Record<string, unknown>>)['inner']?.['type'],
    ).toBe('array')
  })

  it('keeps optional fields out of required', () => {
    const out = transformed(z.object({ needed: z.string(), maybe: z.string().optional() }))

    expect(out['required']).toEqual(['needed'])
  })
})
