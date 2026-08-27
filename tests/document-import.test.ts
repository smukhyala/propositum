/**
 * A document can now come in from a file and go out again, and neither is a
 * second door.
 *
 * ── What this is about ───────────────────────────────────────────────────
 *
 * Until 2026-08-26 the only way into `Document` was a paste, and the only way
 * out was selecting the text with a mouse. `docs/todo/03-document-loop.md`:
 * *"There is no file import, no URL import, no Google Docs, no Word, no Notion,
 * no export, no download and no copy button anywhere in the product."*
 *
 * Adding an import is the kind of change that is easy to do twice — an upload
 * endpoint that parses the file server-side is the obvious shape, and it is a
 * second path into the same table with its own idea of what a document is. The
 * one that shipped is deliberately not that: the file is read in the browser,
 * put in the textarea the person is looking at, and submitted by the same form
 * and the same server action a paste always used.
 *
 * ── Why the assertions are shaped the way they are ───────────────────────
 *
 * The property is a **negative** — *there is no other way in* — and a negative
 * cannot be demonstrated by exercising the happy path. So most of this file
 * checks absences: no `name` on the file input, so the browser cannot submit
 * the file even if somebody wired a route for it; no `fetch` in the component,
 * so nothing leaves the page except through the form; no multipart route.
 *
 * That is the same move `tests/architecture.test.ts` makes about tools, and it
 * carries the same caveat: an absence asserted by grep is worth exactly as much
 * as the grep is specific. Each one below says what would defeat it.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * **It never opens a file.** `renderToStaticMarkup` runs one render with no
 * DOM, so `File.text()`, the clipboard and the download anchor are all
 * unreachable here — they are browser APIs, and this repository has no browser
 * in its test suite. What is checked is the shape around them: the limit is a
 * named constant with a number in it, the file input cannot be submitted, and
 * the export helpers are pure and tested directly. The by-hand step in
 * `docs/todo/03-document-loop.md` is what checks that a real file arrives.
 *
 * **It says nothing about URL import**, which is not built and needs an ADR
 * before it is: text fetched from the network is untrusted in a way a file a
 * person chose is not.
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DocumentDraft,
  DocumentWorkbench,
  IMPORT_LIMIT_BYTES,
  countWords,
  fileNameFor,
} from '../src/ui/document'
import { normalise } from '../src/domain/document/normalise'

const repo = fileURLToPath(new URL('..', import.meta.url))
const read = (relative: string) => readFileSync(join(repo, relative), 'utf8')

const draft = () => renderToStaticMarkup(createElement(DocumentDraft, { action: () => undefined }))
const workbench = (over: { saved?: string; ordinal?: number } = {}) =>
  renderToStaticMarkup(
    createElement(DocumentWorkbench, {
      documentId: 'doc-1',
      title: 'Northwind partnership proposal',
      saved: 'A first sentence.\nA second one.\n',
      ordinal: 3,
      action: () => undefined,
      ...over,
    }),
  )

/* ── the way in ──────────────────────────────────────────────────────────── */

describe('a file goes into the box a person is looking at, and nowhere else', () => {
  it('offers a file picker on both forms', () => {
    for (const html of [draft(), workbench()]) {
      expect(html).toContain('type="file"')
      expect(html).toContain('accept=".md,.markdown,.txt,text/markdown,text/plain"')
    }
  })

  it('the file input has no name, so the form cannot carry the file itself', () => {
    // The structural half of "same path, no second door". A `name` here would
    // put the file in the FormData, and a server action that read it would be
    // a second parser with its own idea of what a document is — reachable
    // without the person ever seeing the words.
    for (const html of [draft(), workbench()]) {
      const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? ''
      expect(input, 'no file input rendered — this assertion is about nothing').toContain('accept=')
      expect(input, 'the file input gained a name, so the file can now be submitted').not.toMatch(
        /\bname=/,
      )
    }
  })

  it('the file input has a name a screen reader can use', () => {
    /**
     * A bare `<input type="file">` announces as *"Choose File, No file
     * chosen"* — its own name, and a value that stops being true the moment a
     * file is read. Hiding it visually leaves both in the accessibility tree,
     * so a person using a screen reader hears the visible label and then the
     * browser's, which is two names for one control and one of them false.
     * PRODUCT_PRINCIPLES §10.
     */
    for (const html of [draft(), workbench()]) {
      const input = html.match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? ''

      expect(input, 'the file input has no accessible name of its own').toContain(
        'aria-label="Open a file"',
      )
      // And the visible words are not announced a second time.
      expect(html).toContain('aria-hidden="true"')
    }
  })

  it('the textarea is what carries the content, on both forms', () => {
    // The other half: whatever is submitted is what was on screen.
    for (const html of [draft(), workbench()]) {
      expect(html).toMatch(/<textarea[^>]*name="content"/)
    }
  })

  it('nothing in the component reaches the network', () => {
    // If the file could be posted somewhere directly, everything above is
    // decoration. `fetch`, XHR and `navigator.sendBeacon` are the three ways
    // out of a page that do not go through the form.
    const source = read('src/ui/document.tsx')

    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
    expect(source).not.toMatch(/sendBeacon/)
  })

  it('there is no upload route for one to appear beside', () => {
    // A route that took a file would be the second door whether or not the
    // component used it. Checked over the whole API surface rather than by
    // name, because the name is the part somebody would choose freshly.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel, out)
        else if (entry.name === 'route.ts') out.push(rel)
      }
      return out
    }

    for (const route of walk('src/app/api')) {
      const source = read(route)
      expect(source, `${route} reads multipart form data`).not.toContain('multipart/form-data')
      expect(source, `${route} reads a file off a request`).not.toMatch(/\.formData\(\)/)
    }
  })

  it('both server actions still normalise, so one shape is stored', () => {
    // The reason a file can share the paste's path at all: the path already
    // does the only transformation there is. If either of these stopped
    // normalising, an imported document would keep its own line breaks and
    // every offset pointing into it would address the wrong sentence.
    const actions = read('src/server/actions.ts')
    const createDocument = actions.slice(actions.indexOf('export async function createDocument'))
    const saveDocument = actions.slice(actions.indexOf('export async function saveDocument'))

    expect(createDocument.slice(0, 2000)).toContain('normalise(body)')
    expect(saveDocument.slice(0, 2000)).toContain('normalise(body)')
  })
})

/* ── the limit ───────────────────────────────────────────────────────────── */

describe('a file too big is refused rather than truncated', () => {
  it('the limit is a named constant, so the message can quote it', () => {
    // A document that arrives with its ending silently removed is the worst of
    // the three possible behaviours, and it is the one that happens when a cap
    // is a magic number inside a `slice`.
    expect(IMPORT_LIMIT_BYTES).toBe(200_000)
  })

  it('the component refuses on size before it reads anything', () => {
    const source = read('src/ui/document.tsx')
    const guard = source.indexOf('IMPORT_LIMIT_BYTES')
    const readCall = source.indexOf('await file.text()')

    expect(guard).toBeGreaterThan(-1)
    expect(readCall).toBeGreaterThan(-1)
    expect(guard, 'the size check moved below the read').toBeLessThan(readCall)
    expect(source, 'a truncating slice appeared').not.toMatch(/\.slice\(0,\s*IMPORT_LIMIT/)
  })
})

/* ── the way out ─────────────────────────────────────────────────────────── */

describe('export gives you what is on screen, and says which version that is', () => {
  it('offers copy and download once the document exists', () => {
    const html = workbench()

    expect(html).toContain('>Copy<')
    expect(html).toContain('>Download<')
  })

  it('does not offer them on a document that has no text yet', () => {
    // There is nothing to copy, and a control that produces an empty file is a
    // control that lies about having done something.
    const html = draft()

    expect(html).not.toContain('>Copy<')
    expect(html).not.toContain('>Download<')
  })

  it('names the version and says it is saved when nothing has been typed', () => {
    // First render, before any keystroke: the box holds exactly the stored
    // version, so the line has to say so rather than hedge.
    const said = workbench().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

    expect(said).toContain('Version 3')
    expect(said).toContain('saved')
    expect(said).not.toContain('changes you have not saved')
  })

  it('counts the words in the box, not in the stored version', () => {
    const said = workbench({ saved: 'One two three four five.' })
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')

    expect(said).toContain('5 words')
  })

  it('says out loud that the two controls act on the box', () => {
    // The sentence is the whole answer to "which version did I just copy",
    // and it is asserted because a rewrite that dropped it would leave the
    // controls behaving correctly and nobody able to tell.
    const said = workbench().replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')

    expect(said).toContain('what is in the box, not the last version Propositum stored')
  })
})

describe('the exported file is named after the document', () => {
  it('slugifies the title', () => {
    expect(fileNameFor('Northwind partnership proposal')).toBe(
      'northwind-partnership-proposal.md',
    )
  })

  it('collapses punctuation rather than carrying it into a filename', () => {
    expect(fileNameFor('Q3 review: commercials & close')).toBe('q3-review-commercials-close.md')
  })

  it('still produces a name when the title survives nothing', () => {
    // A document called "———" is silly and a download called ".md" is broken.
    expect(fileNameFor('———')).toBe('document.md')
  })
})

/* ── the round trip ──────────────────────────────────────────────────────── */

describe('a document survives going out and coming back', () => {
  /**
   * The property the import and the export have to share, and the reason both
   * go through `normalise`: the text that leaves is the text that returns.
   *
   * `tests/document-engine.test.ts` already pins that `normalise` is idempotent.
   * What is added here is that the export does not undo it — a writer that
   * re-wrapped paragraphs on the way out would produce a file that normalises
   * to something else on the way back, and every offset into the stored version
   * would then address a different sentence.
   */
  const ORIGINAL = [
    '# Northwind',
    '',
    'The renewal closes in March. Commercials are agreed at $1.5M. No. 4 on the list is still open.',
    '',
    '- Tier comparison',
    '- Close plan',
    '',
    '```',
    'do not touch me. really.',
    '```',
  ].join('\n')

  it('normalises once and then stays put', () => {
    const stored = normalise(ORIGINAL)

    // Out of the box verbatim, back in through the same door.
    expect(normalise(stored)).toBe(stored)
  })

  it('keeps the sentence split a change points at', () => {
    const stored = normalise(ORIGINAL)

    expect(stored).toContain('The renewal closes in March.\n')
    expect(stored).toContain('Commercials are agreed at $1.5M.\n')
    // The abbreviation that would shred the diff if the split were naive.
    expect(stored).toContain('No. 4 on the list is still open.')
  })

  it('leaves a fenced block exactly as it was, across the round trip', () => {
    expect(normalise(normalise(ORIGINAL))).toContain('do not touch me. really.')
  })

  it('a file with Windows line endings comes back the same as one without', () => {
    // The single likeliest difference between a paste and a file, and the one
    // that would otherwise mint a spurious version on the first save.
    expect(normalise(ORIGINAL.replace(/\n/g, '\r\n'))).toBe(normalise(ORIGINAL))
  })
})

describe('the word count is the person’s unit', () => {
  it('counts words, never characters', () => {
    // Characters are the retention budget's unit; reusing them here would imply
    // the two are related, and they are not.
    expect(countWords('One two three.')).toBe(3)
    expect(countWords('  spaced   out  ')).toBe(2)
    expect(countWords('')).toBe(0)
    expect(countWords('\n\n')).toBe(0)
  })
})
