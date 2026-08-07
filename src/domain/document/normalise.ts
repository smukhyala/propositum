/**
 * One sentence per line.
 *
 * ── Why bother ───────────────────────────────────────────────────────────
 *
 * Diffs land on whatever unit the text is broken into. With paragraphs as
 * lines, changing four words marks the whole paragraph changed, and the
 * re-entry screen shows a wall of red for a trivial edit — which fails the
 * one-minute comprehension target regardless of how good the differ is.
 *
 * ── Why not jsdiff's diffSentences ───────────────────────────────────────
 *
 * Its entire rule is `.`/`!`/`?` followed by whitespace, and jsdiff's own
 * README calls it naive. "e.g.", "Inc.", "$1.5M" and "No. 4" all split
 * mid-sentence, which shreds the diff exactly where prose gets specific —
 * which in a partnership proposal is the commercially important part.
 *
 * `Intl.Segmenter` knows about abbreviations and decimals, ships with Node, and
 * costs nothing.
 */

/** Lines that are structure rather than prose, and must never be split or
 *  merged: headings, list items, blockquotes, fences, tables, blanks. */
function isStructural(line: string): boolean {
  const t = line.trimStart()
  return (
    t === '' ||
    t.startsWith('#') ||
    t.startsWith('>') ||
    t.startsWith('```') ||
    t.startsWith('|') ||
    /^[-*+]\s/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(t)
  )
}

let segmenter: Intl.Segmenter | undefined

function sentencesOf(text: string): string[] {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' })
  return [...segmenter.segment(text)].map((s) => s.segment)
}

/**
 * Normalise a Markdown document to one sentence per line.
 *
 * Structural lines pass through untouched. Prose paragraphs are re-flowed so
 * each sentence occupies its own line; the paragraph break is preserved.
 *
 * Idempotent: normalising a normalised document changes nothing, which the
 * tests assert because a non-idempotent normaliser silently rewrites the base
 * on every save and invalidates every offset pointing at it.
 */
export function normalise(markdown: string): string {
  const out: string[] = []
  let paragraph: string[] = []
  let inFence = false

  const flush = () => {
    if (paragraph.length === 0) return
    const joined = paragraph.join(' ').replace(/\s+/g, ' ').trim()
    for (const sentence of sentencesOf(joined)) {
      const trimmed = sentence.trim()
      if (trimmed) out.push(trimmed)
    }
    paragraph = []
  }

  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      flush()
      inFence = !inFence
      out.push(line)
      continue
    }

    // Inside a fence, every byte is content.
    if (inFence) {
      out.push(line)
      continue
    }

    if (isStructural(line)) {
      flush()
      out.push(line)
      continue
    }

    paragraph.push(line)
  }

  flush()
  return out.join('\n')
}

/** Split normalised content into addressable units with their offsets, so a
 *  change can name where it lands without re-deriving the split. */
export interface Line {
  readonly index: number
  readonly start: number
  readonly end: number
  readonly text: string
}

export function linesOf(normalised: string): Line[] {
  const lines: Line[] = []
  let offset = 0
  let index = 0

  for (const text of normalised.split('\n')) {
    lines.push({ index, start: offset, end: offset + text.length, text })
    offset += text.length + 1 // the newline
    index += 1
  }

  return lines
}
