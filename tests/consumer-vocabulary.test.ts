/**
 * The words the interface is not allowed to use, checked rather than reviewed.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * `CONTEXT.md` is the glossary and it has always carried a banned-words table.
 * Nothing ran it. Four bans leaked onto screens anyway and stayed there long
 * enough to be quoted in a todo file:
 *
 *   - `shift` — an internal computed view whose consumer wording `CONTEXT.md`
 *     fixes as *"While you were away"* — appeared in **twelve** places, from the
 *     agreement's permission panel to the front door's count sentence. Nothing
 *     on any screen ever said what one was.
 *   - `claims` appeared twice, in the one screen that renders them, and nowhere
 *     else in the product.
 *   - *Take over* and *Hand over* were both live, on adjacent screens, pointing
 *     in opposite directions, so a first-timer could not tell who was taking
 *     over what.
 *
 * `docs/todo/04-quick-fixes.md` named `tests/canonical-terms.test.ts` as the
 * home for these. That file is about typo-merging in
 * `src/domain/detection/topics.ts` and has nothing to do with consumer copy.
 * This is the file that was missing.
 *
 * ── What it reads, and why that is the hard part ─────────────────────────
 *
 * A grep for `shift` over `src/ui` is useless: the word is *correct* as an
 * identifier, a type name, a route path and a docblock, and it is only wrong in
 * something a person reads. So this extracts **prose** and checks only that:
 *
 *   1. JSX text nodes — the words between the tags, with `{…}` expressions
 *      removed so an interpolated count does not break the sentence in half;
 *   2. string literals **inside** those `{…}` expressions, which is where
 *      `{n === 1 ? 'shift' : 'shifts'}` lives — the exact shape the front door
 *      used, and the one an extractor that merely deleted braces would be blind
 *      to;
 *   3. the value of any attribute in a prose allowlist (`title`, `subtitle`,
 *      `next`, `placeholder`, `aria-label`, …);
 *   4. free-standing string literals of four words or more, which is where the
 *      `? 'There is no document under this agreement…' : …` sentences live.
 *
 * Comments go through `tests/support/strip-comments.ts` first — the repository
 * has exactly one comment stripper on purpose, and the second one was a guard
 * away from blind.
 *
 * ── The guard on the guard ───────────────────────────────────────────────
 *
 * An extractor that returned nothing would pass every assertion below while
 * checking nothing, which is the failure mode of every source-text guard. So
 * `prose()` is run against a fixture holding one example of each of the four
 * shapes, and against each shape's near-miss that must NOT be picked up. If the
 * extractor goes blind, that describe block goes red before the ban checks do.
 *
 * ── What this does NOT cover, stated because it reads stronger than it is ─
 *
 * **It cannot see a sentence assembled at runtime.** `'This ' + noun + ' has'`
 * defeats it, and so does a banned word arriving from the database or from a
 * model. Nothing here is a substitute for reading the screen.
 *
 * **It is source text, not rendered output.** A component that computes the
 * right words and renders others passes — the same limit
 * `tests/reachability.test.ts` states about itself, and the reason
 * `tests/agreement-words.test.ts` renders instead of grepping where the
 * property is what a person actually reads.
 *
 * **It checks the app and the side panel, and nothing else.** Prompts, schema
 * comments and ADRs are governed by the same table and are not read here.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { stripComments } from './support/strip-comments'

const repo = fileURLToPath(new URL('..', import.meta.url))

/* ── the extractor ───────────────────────────────────────────────────────── */

/** Attributes whose value is a sentence rather than a class, a path or an id. */
const PROSE_ATTRS =
  /(?:title|subtitle|next|label|placeholder|summary|kicker|detail|aria-label)=\{?["'`]([^"'`]{4,})["'`]/g

/** Anything that survives extraction still carrying these is code, not copy. */
const CODE = /[=<>{}()[\]]|&&|\|\||=>|\$\{/

/** Remove balanced `{…}` groups, innermost first, so nesting unwinds. */
function withoutExpressions(text: string): string {
  let out = text
  for (;;) {
    const next = out.replace(/\{[^{}]*\}/g, ' ')
    if (next === out) return out
    out = next
  }
}

/** Every quoted string inside a chunk of source. */
function literalsIn(text: string): string[] {
  return [...text.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)]
    .map((m) => m[1] ?? m[2] ?? '')
    .filter((s) => s.length > 0)
}

/**
 * What a person can read in this file.
 *
 * Deliberately over-collects and then filters on `CODE`: a false positive here
 * costs one assertion someone has to look at, and a false negative is a banned
 * word on a screen with a green suite underneath it.
 */
export function prose(source: string): string[] {
  const code = stripComments(source)
  const out: string[] = []

  for (const match of code.matchAll(/>([^<>]{2,})</g)) {
    const span = match[1]!
    // (1) the words, with interpolations taken out rather than the sentence.
    out.push(withoutExpressions(span))
    // (2) the literals inside those interpolations — `{n === 1 ? 'a' : 'b'}`.
    for (const brace of span.matchAll(/\{[^{}]*\}/g)) out.push(...literalsIn(brace[0]))
  }

  // (3) prose-carrying attributes.
  for (const match of code.matchAll(PROSE_ATTRS)) out.push(match[1]!)

  // (4) free-standing sentences. Four words is the floor that keeps CSS
  //     declarations, class names and ids out without a second rule.
  for (const literal of literalsIn(code)) {
    if (literal.split(' ').length < 4) continue
    if (literal.includes(': ') || literal.includes(';')) continue
    out.push(literal)
  }

  return out
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 2 && !CODE.test(s))
}

/* ── the guard on the guard ──────────────────────────────────────────────── */

describe('the extractor can see each shape it claims to see', () => {
  const FIXTURE = `
    // a comment saying shift, which is the correct internal word
    /* and a block comment saying take over */
    const CSS = \`.x-shift { font-family: var(--mono); color: red; }\`
    const WHY = away
      ? 'A whole sentence about the shift a person reads.'
      : 'Another one.'
    export function Screen() {
      return (
        <Sheet>
          <Link className="x-go" href={\`/shifts/\${id}\`}>Open it</Link>
          <p>Propositum finished {countWord(n)} {n === 1 ? 'shift' : 'shifts'} for you.</p>
          <Empty title="There is no shift here" next="Start again." />
        </Sheet>
      )
    }
  `
  const seen = prose(FIXTURE)
  const has = (needle: string) => seen.some((s) => s.includes(needle))

  it('sees a JSX text node', () => {
    expect(has('Open it')).toBe(true)
  })

  it('sees a sentence an interpolation runs through the middle of', () => {
    // The front door's count sentence had exactly this shape. An extractor that
    // rejected any span containing a brace would have been blind to it.
    expect(has('Propositum finished')).toBe(true)
    expect(has('for you.')).toBe(true)
  })

  it('sees a literal inside an interpolation, which is where a plural hides', () => {
    // `{n === 1 ? 'shift' : 'shifts'}` is the shape this file was written for.
    // Stripping braces and stopping there would drop both words on the floor.
    expect(seen).toContain('shift')
    expect(seen).toContain('shifts')
  })

  it('sees a prose attribute', () => {
    expect(has('There is no shift here')).toBe(true)
  })

  it('sees a free-standing sentence of four words or more', () => {
    expect(has('A whole sentence about the shift')).toBe(true)
  })

  it('does not see a comment', () => {
    expect(has('the correct internal word')).toBe(false)
    expect(has('and a block comment')).toBe(false)
  })

  it('does not see a stylesheet, a class name or a route path', () => {
    expect(has('x-shift')).toBe(false)
    expect(has('font-family')).toBe(false)
    expect(seen.some((s) => s.includes('/shifts/'))).toBe(false)
  })
})

/* ── the surfaces ────────────────────────────────────────────────────────── */

function screens(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(repo, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.tsx')) found.push(rel)
    }
  }
  walk('src/ui')
  walk('src/app')
  // The MV3 side panel is a second interface built separately, and
  // `tests/shared-copy.test.ts` already exists because its wording drifted.
  found.push('extension/src/panel.html')
  return found
}

/** Every readable sentence in the product, with the file it is in. */
function everything(): { readonly file: string; readonly said: string }[] {
  return screens().flatMap((file) =>
    prose(readFileSync(join(repo, file), 'utf8')).map((said) => ({ file, said })),
  )
}

describe('the surfaces this reads are actually there', () => {
  it('finds the screens, or every ban below is checking an empty list', () => {
    const files = screens()

    expect(files.length).toBeGreaterThan(15)
    expect(files).toContain('src/app/page.tsx')
    expect(files).toContain('src/ui/agreement.tsx')
    expect(files).toContain('extension/src/panel.html')
  })

  it('reads a sentence off each of the three surfaces that matter most', () => {
    // Not a count — a count would pass on an extractor that returned the same
    // sentence three hundred times. These are one known sentence per surface.
    const said = everything()
    const on = (file: string, needle: string) =>
      said.some((row) => row.file === file && row.said.includes(needle))

    expect(on('src/app/page.tsx', 'Go and read about something for a while')).toBe(true)
    expect(on('src/ui/agreement.tsx', 'Nothing runs until you press this')).toBe(true)
    expect(on('extension/src/panel.html', 'Nothing has been recorded')).toBe(true)
  })
})

/* ── the bans ────────────────────────────────────────────────────────────── */

/**
 * Each ban names the word, what to write instead, and where the ruling is.
 *
 * The message is the whole value of this file when it goes red: a guard that
 * says *"expected false to be true"* sends somebody to `CONTEXT.md` to work out
 * which of thirty rows they broke.
 */
const BANNED: readonly {
  readonly word: RegExp
  readonly instead: string
}[] = [
  {
    word: /\btake(?:s|n)? over\b|\btaking over\b/i,
    instead:
      '“hand over” — the person is always the subject, as they are in every other consumer verb (CONTEXT.md, banned words)',
  },
  {
    word: /\bshifts?\b/i,
    instead:
      '“While you were away”, or make Propositum the subject and drop the noun (CONTEXT.md, Shift — Consumer: While you were away)',
  },
  {
    word: /\bclaims?\b/i,
    instead:
      'the sentences themselves, under their kind’s heading (CONTEXT.md, SessionClaim — Consumer: internal)',
  },
  {
    word: /\btasks?\b/i,
    instead: 'PlanStep · ActionIntent · AgentRun (CONTEXT.md, banned words — `Task` is banned outright)',
  },
]

describe('no screen uses a word CONTEXT.md bans from consumer copy', () => {
  const said = everything()

  for (const { word, instead } of BANNED) {
    it(`never says ${String(word)}`, () => {
      const broken = said
        .filter((row) => word.test(row.said))
        .map((row) => `${row.file}: “${row.said.slice(0, 110)}”`)

      expect(broken, `write ${instead}`).toEqual([])
    })
  }
})
