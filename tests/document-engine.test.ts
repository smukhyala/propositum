import { describe, it, expect } from 'vitest'
import { linesOf, normalise } from '../src/domain/document/normalise'
import {
  SIMILARITY_FLOOR,
  checkDrift,
  diff,
  hashContent,
  materialise,
} from '../src/domain/document/changeset'
import type { Decision } from '../src/domain/document/changeset'

const DOC = [
  '# Northwind partnership proposal',
  '',
  '## Scope',
  '',
  'Integration work is scoped to the first quarter. We will support the existing webhook format throughout.',
  '',
  '## Commercials',
  '',
  'We propose a partnership on mutually agreeable terms.',
  '',
].join('\n')

describe('normalise puts one sentence per line', () => {
  it('splits a paragraph into sentences', () => {
    const out = normalise('One sentence here. And a second one.')
    expect(out.split('\n')).toEqual(['One sentence here.', 'And a second one.'])
  })

  it('does not split on abbreviations, decimals or currency', () => {
    // jsdiff's diffSentences splits every one of these. That is why it is banned.
    const tricky =
      'We work with Acme Inc. on this. Revenue was $1.5M last year. See section No. 4 for detail, e.g. the appendix.'
    const lines = normalise(tricky).split('\n')

    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('Acme Inc.')
    expect(lines[1]).toContain('$1.5M')
    expect(lines[2]).toContain('e.g.')
  })

  it('leaves headings, lists and blank lines alone', () => {
    const out = normalise(DOC)
    expect(out).toContain('# Northwind partnership proposal')
    expect(out).toContain('## Scope')
    expect(out.split('\n')).toContain('')
  })

  it('never touches fenced code', () => {
    const code = ['Before.', '', '```js', 'const a = 1. Not a sentence.', '```', '', 'After.'].join('\n')
    expect(normalise(code)).toContain('const a = 1. Not a sentence.')
  })

  it('is idempotent', () => {
    // A normaliser that rewrites on every save silently invalidates every
    // offset pointing at the base.
    const once = normalise(DOC)
    expect(normalise(once)).toBe(once)
  })

  it('gives lines contiguous offsets that address the content', () => {
    const out = normalise(DOC)
    for (const line of linesOf(out)) {
      expect(out.slice(line.start, line.end)).toBe(line.text)
    }
  })
})

describe('diff produces reviewable changes', () => {
  it('finds a small edit and scales it in words', () => {
    const revised = DOC.replace('the first quarter', 'Q3 2026, per your note')
    const { changes } = diff(DOC, revised, 'your note said Q3')

    expect(changes).toHaveLength(1)
    expect(changes[0]?.scale.kind).toBe('edited')
    expect(changes[0]?.scale.label).toMatch(/changed \d+ words?/)
  })

  it('addresses changes by offsets into the base', () => {
    const revised = DOC.replace('the first quarter', 'Q3 2026')
    const base = normalise(DOC)
    const change = diff(DOC, revised, 'r').changes[0]!

    expect(base.slice(change.startOffset, change.endOffset)).toBe(change.exact)
  })

  it('carries a quote anchor that matches the base', () => {
    const revised = DOC.replace('mutually agreeable terms', 'Northwind published tiers')
    const base = normalise(DOC)
    const change = diff(DOC, revised, 'r').changes[0]!

    expect(base.slice(change.startOffset - change.prefix.length, change.startOffset)).toBe(change.prefix)
    expect(base.slice(change.endOffset, change.endOffset + change.suffix.length)).toBe(change.suffix)
  })

  it('labels a wholesale rewrite as rewritten rather than pretending it is an edit', () => {
    const revised = DOC.replace(
      'We propose a partnership on mutually agreeable terms.',
      'Northwind operates two partner tracks and this proposal targets the strategic one.',
    )
    const change = diff(DOC, revised, 'r').changes[0]!

    expect(change.scale.similarity).toBeLessThan(SIMILARITY_FLOOR)
    expect(change.scale.kind).toBe('rewritten')
  })

  it('reports an unchanged document as no changes', () => {
    expect(diff(DOC, DOC, 'r').changes).toHaveLength(0)
  })

  it('ignores a difference that is only line wrapping', () => {
    const rewrapped = DOC.replace(
      'Integration work is scoped to the first quarter. We will support the existing webhook format throughout.',
      'Integration work is scoped to the first quarter.\nWe will support the existing webhook format throughout.',
    )
    expect(diff(DOC, rewrapped, 'r').changes).toHaveLength(0)
  })

  it('finds several independent changes', () => {
    const revised = DOC.replace('the first quarter', 'Q3 2026').replace(
      'mutually agreeable terms',
      'the published tiers',
    )
    expect(diff(DOC, revised, 'r').changes.length).toBeGreaterThanOrEqual(2)
  })
})

describe('materialise is a pure fold', () => {
  const revised = DOC.replace('the first quarter', 'Q3 2026').replace(
    'mutually agreeable terms',
    'the published tiers',
  )
  const { changes } = diff(DOC, revised, 'r')

  it('leaves the base untouched', () => {
    const before = DOC
    materialise(DOC, changes, changes.map((_, i) => ({ changeIndex: i, verdict: 'accept' as const })))
    expect(DOC).toBe(before)
  })

  it('accepting everything reproduces the worker prose', () => {
    const all: Decision[] = changes.map((_, i) => ({ changeIndex: i, verdict: 'accept' }))
    expect(materialise(DOC, changes, all)).toBe(normalise(revised))
  })

  it('rejecting everything reproduces the base', () => {
    const none: Decision[] = changes.map((_, i) => ({ changeIndex: i, verdict: 'reject' }))
    expect(materialise(DOC, changes, none)).toBe(normalise(DOC))
  })

  it('is order-independent — accepting 1 then 3 equals 3 then 1', () => {
    // The property that makes plain offsets safe. If this ever fails, offsets
    // are no longer addressing a fixed base and the whole model is wrong.
    const forward: Decision[] = [
      { changeIndex: 0, verdict: 'accept' },
      { changeIndex: 1, verdict: 'accept' },
    ]
    const reversed: Decision[] = [...forward].reverse()

    expect(materialise(DOC, changes, forward)).toBe(materialise(DOC, changes, reversed))
  })

  it('applies a partial selection without disturbing the others', () => {
    const onlyFirst: Decision[] = [{ changeIndex: 0, verdict: 'accept' }]
    const out = materialise(DOC, changes, onlyFirst)

    expect(out).toContain('Q3 2026')
    expect(out).toContain('mutually agreeable terms')
  })

  it('uses edited text when the human rewrote a change', () => {
    const edited: Decision[] = [
      { changeIndex: 0, verdict: 'edit', editedText: 'Integration work is scoped to Q4 2026.' },
    ]
    expect(materialise(DOC, changes, edited)).toContain('Q4 2026')
  })

  it('treats an undecided change as untouched', () => {
    expect(materialise(DOC, changes, [])).toBe(normalise(DOC))
  })
})

describe('refuse on drift', () => {
  it('passes when the base is unchanged', () => {
    const { baseHash } = diff(DOC, DOC.replace('first quarter', 'Q3'), 'r')
    expect(checkDrift(DOC, baseHash)).toEqual({ ok: true })
  })

  it('refuses when the human edited the document during the shift', () => {
    // ADR-0003: the human is never locked out, so the base genuinely moves.
    const { baseHash } = diff(DOC, DOC.replace('first quarter', 'Q3'), 'r')
    const humanEdited = DOC.replace('## Commercials', '## Commercials and terms')

    const result = checkDrift(humanEdited, baseHash)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('base-moved')
  })

  it('tolerates a re-wrap, because the hash is over normalised content', () => {
    const { baseHash } = diff(DOC, DOC.replace('first quarter', 'Q3'), 'r')
    const rewrapped = DOC.replace(
      'Integration work is scoped to the first quarter. We will support',
      'Integration work is scoped to the first quarter.\nWe will support',
    )
    expect(checkDrift(rewrapped, baseHash).ok).toBe(true)
  })

  it('hashes normalised content, so the hash is stable across formatting', () => {
    expect(hashContent(normalise(DOC))).toBe(hashContent(normalise(normalise(DOC))))
  })
})
