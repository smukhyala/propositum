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
 * ~~`Intl.Segmenter` knows about abbreviations and decimals, ships with Node, and
 * costs nothing.~~ **Narrowed 2026-08-26, measured rather than assumed.** It
 * ships with Node and costs nothing, and it is decisively better than the naive
 * rule — but it knows about *some* abbreviations, not all, and which ones
 * depends on what follows them:
 *
 *     "See section No. 4 for detail"        one segment
 *     "$1,250. No. 7 Rua da Boavista."      splits after "No."
 *     "Acme Inc. on this"                   one segment
 *     "the 4th. Dr. Alves confirmed"        splits after "Dr."
 *
 * A title or an abbreviation followed by a capitalised word or a bare numeral
 * reads to it as a sentence end. Found by importing a real document; the
 * existing test happened to use the spellings that survive.
 *
 * **Left as it is, deliberately, and this is not a shrug.** The failure is in
 * the safe direction — the unit gets *smaller*, and the paragraph-sized unit
 * this function exists to avoid is the one that shreds a diff. Nothing is lost
 * or altered: the lines rejoin to the same text. And changing the split is not
 * a local decision, because `linesOf` hands out offsets that live changesets
 * already point at. `tests/document-engine.test.ts` pins the real behaviour so
 * nobody reads the stronger claim off this docblock again.
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
 *
 * ── Line endings, added 2026-08-26 ───────────────────────────────────────
 *
 * `\r\n` and a lone `\r` both become `\n` before anything else happens.
 *
 * This was found by the file import, and it was already reachable by pasting
 * from a Windows editor. A prose line survived it by accident — `\s+` collapses
 * a stray `\r` on the way into a paragraph — but a heading, a list item, a table
 * row and every line inside a fence are pushed through verbatim, so they kept
 * theirs. The result was a document that looked identical on screen, hashed
 * differently, and therefore drifted against a Shift that had pinned the other
 * spelling of the same words.
 *
 * **What it costs**, stated because this function's whole promise is that it
 * does not alter content: a fenced block that genuinely needed carriage returns
 * cannot have them. That is a fair trade and barely a trade at all — the lines
 * are rejoined with `\n` on the way out regardless, so a surviving `\r` was
 * never fidelity, only an inconsistency that happened to be invisible.
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

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
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
