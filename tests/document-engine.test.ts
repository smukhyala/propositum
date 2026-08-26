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

  it('splits after a title or an abbreviation that a capital follows', () => {
    /**
     * The limit of the test above, pinned rather than left to be discovered.
     *
     * `Intl.Segmenter` is decisively better than the naive `.`-plus-space rule,
     * and it is not the "knows about abbreviations" that this file's docblock
     * used to claim. Which abbreviations survive depends on what comes next: a
     * lowercase word keeps the sentence together, a capitalised word or a bare
     * numeral ends it. `See section No. 4` above is the surviving spelling and
     * this is the other one.
     *
     * Found by importing a real document on 2026-08-26. Asserted as the
     * behaviour rather than fixed, because the unit getting SMALLER is the safe
     * direction — a paragraph-sized unit is what shreds a diff — and because
     * `linesOf` hands out offsets that live changesets already point at, so
     * moving the split is an ADR rather than an edit.
     *
     * If this goes red because somebody improved the segmentation: good. Check
     * what it does to stored offsets before you celebrate.
     */
    const lines = normalise('We fly on the 4th. Dr. Alves confirmed it. No. 7 Rua da Boavista.')
      .split('\n')

    expect(lines).toEqual([
      'We fly on the 4th.',
      'Dr.',
      'Alves confirmed it.',
      'No.',
      '7 Rua da Boavista.',
    ])

    // What is NOT lost: every word, in order. The split is about where a change
    // can point, never about the text.
    expect(lines.join(' ')).toBe('We fly on the 4th. Dr. Alves confirmed it. No. 7 Rua da Boavista.')
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

  it('folds Windows line endings, including inside a fence', () => {
    /**
     * Found by the file import on 2026-08-26, and reachable before it by
     * pasting from a Windows editor.
     *
     * A prose line survived a stray `\r` by accident — the paragraph join runs
     * `\s+` over it — but headings, list items, table rows and fenced lines are
     * pushed through verbatim and kept theirs. So the same words arriving from
     * a CRLF file produced a different string, a different `contentHash`, and a
     * Shift that had pinned the other spelling drifted against words nobody had
     * touched.
     */
    const unix = '# Heading\n\n- one\n- two\n\n```\ncode()\n```\n'

    expect(normalise(unix.replace(/\n/g, '\r\n'))).toBe(normalise(unix))
    expect(normalise(unix.replace(/\n/g, '\r'))).toBe(normalise(unix))
    expect(normalise(unix)).not.toContain('\r')
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

/**
 * What a stored DocumentVersion owes the changeset that will pin it.
 *
 * `createDocument` and `saveDocument` store `normalise(content)` and hash that
 * same string. These tests pin WHY, because the alternative — store the raw
 * bytes, hash the normalised form — typechecks, reads fine, and fails much
 * later as a drift refusal against a document nobody touched.
 */
describe('a stored version is self-consistent', () => {
  const stored = normalise(DOC)
  const storedHash = hashContent(stored)

  it('a freshly stored document does not read as drifted', () => {
    expect(checkDrift(stored, storedHash)).toEqual({ ok: true })
  })

  it('survives the round trip a shift makes through it', () => {
    // Pin, propose, then check the base again — the sequence execute-run and
    // finishReview both perform.
    const { baseHash } = diff(stored, stored.replace('first quarter', 'Q3'), 'r')
    expect(baseHash).toBe(storedHash)
    expect(checkDrift(stored, baseHash).ok).toBe(true)
  })

  it('storing raw bytes while hashing normalised content would break it', () => {
    // The trap, demonstrated rather than described. DOC has two sentences on one
    // line, so raw and normalised genuinely differ.
    const raw = DOC
    expect(raw).not.toBe(stored)

    // `checkDrift` normalises its input, so this specific pairing survives...
    expect(checkDrift(raw, storedHash).ok).toBe(true)

    // ...but the invariant a reader will assume — that contentHash is
    // hashContent(content) — does not hold, and re-deriving it gets the wrong
    // answer for a document that never moved.
    expect(hashContent(raw)).not.toBe(storedHash)
    expect(hashContent(stored)).toBe(storedHash)
  })

  it('offsets address the stored bytes, not the pasted ones', () => {
    // ProposedChange.startOffset indexes the normalised base. If the stored
    // content were raw, every offset would point into a different string.
    const { changes } = diff(stored, stored.replace('first quarter', 'Q3'), 'r')
    const change = changes[0]
    expect(change).toBeDefined()
    if (!change) return

    expect(stored.slice(change.startOffset, change.endOffset)).toContain('first quarter')
  })
})
