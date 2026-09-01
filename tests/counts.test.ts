/**
 * A count may be stated. If it is, it has to be true.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `README.md` documents five of its own counts going stale, and the sentence
 * counting the stale counts had gone stale too. That is not carelessness; it is
 * what keeping a number in two places does, and every one of those corrections
 * was written by a person who noticed by accident.
 *
 * Measured again on 2026-08-19, after the CI work: the README said 11 ADRs
 * against 15 on disk, and 54 terms against 56 in `CONTEXT.md`. Two more, found
 * the same way — by looking.
 *
 * ── What this checks, and what it deliberately allows ────────────────────
 *
 * Every rule here is conditional: *if* a document states a count, the count must
 * match the file that knows. Deleting the number is always allowed and always
 * passes, which is the outcome the README argues for in its own prose. What is
 * not allowed is a number nothing checks.
 *
 * Struck text is skipped. `~~1,028 tests~~` is history the README keeps on
 * purpose — the point of leaving it visible is that it is WRONG and was — so a
 * guard that bound it would forbid the honesty it exists to protect.
 *
 * The one count with no cheap source of truth is the size of this suite. There
 * is no way to know it without running it, so the rule for that one is the other
 * direction: the README may not state it at all.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path: string): string => readFileSync(join(repo, path), 'utf8')

/** Struck spans are history. Only live prose makes a claim. */
const live = (markdown: string): string => markdown.replace(/~~[\s\S]*?~~/g, '')

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
}

/**
 * Every number attached to `noun`, as digits or as a word.
 *
 * Returns a list rather than one value: a document is allowed to say the same
 * count twice, and if it does, both have to be right.
 */
function claimed(markdown: string, noun: string): number[] {
  const words = Object.keys(WORDS).join('|')
  const pattern = new RegExp(`\\b([0-9][0-9,]*|${words})\\s+${noun}\\b`, 'gi')
  const found: number[] = []
  for (const match of markdown.matchAll(pattern)) {
    const raw = (match[1] ?? '').toLowerCase()
    found.push(raw in WORDS ? (WORDS[raw] as number) : Number(raw.replace(/,/g, '')))
  }
  return found
}

/** Rows in the first table whose header row contains `header`. */
function tableRows(markdown: string, header: string): number {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.startsWith('|') && line.includes(header))
  if (start < 0) return -1
  let rows = 0
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    rows++
  }
  return rows
}

const README = live(read('README.md'))
const CONTEXT = read('CONTEXT.md')

/** A glossary entry is `### Name — *what it is*`. The one heading without the
 *  dash is a rationale section, not a term. */
const terms = CONTEXT.split('\n').filter((line) => line.startsWith('### ') && line.includes(' — '))
const adrs = readdirSync(join(repo, 'docs', 'adr')).filter((name) => /^\d{4}-.*\.md$/.test(name))
const principles = read('docs/PRODUCT_PRINCIPLES.md')
  .split('\n')
  .filter((line) => /^## \d+\. /.test(line))

describe('a count is checked against the file that knows it', () => {
  it('counts the glossary terms the way the README says', () => {
    for (const stated of claimed(README, 'terms')) expect(stated).toBe(terms.length)
  })

  it('counts the banned words', () => {
    const rows = tableRows(CONTEXT, 'Banned')
    for (const stated of claimed(README, 'rows in the banned table')) expect(stated).toBe(rows)
  })

  it('counts the decisions on disk, not the ones it remembers', () => {
    for (const stated of claimed(README, 'decisions')) expect(stated).toBe(adrs.length)
  })

  it('counts the principles', () => {
    for (const stated of claimed(README, 'principles')) expect(stated).toBe(principles.length)
    // The document that tells the others to say the true thing, checked against
    // its own body. Its header carried a wrong count for four principles.
    for (const stated of claimed(live(read('docs/PRODUCT_PRINCIPLES.md')), 'principles')) {
      expect(stated).toBe(principles.length)
    }
  })

  it('counts the layers, and how many of them are not built', () => {
    const architecture = read('docs/ARCHITECTURE.md')
    const start = architecture.split('\n').findIndex((line) => line.startsWith('| Layer |'))
    const rows = architecture
      .split('\n')
      .slice(start + 2)
      .filter((line) => line.startsWith('|'))

    // The noun is qualified so "five layers are partial" is not read as a claim
    // about how many layers there are — the two numbers are both true and different.
    for (const stated of claimed(README, 'layers(?! are partial or absent)')) {
      expect(stated).toBe(rows.length)
    }

    // A layer is unfinished if its own Status cell says so. Anything else would
    // be this test having an opinion about the architecture.
    const unfinished = rows.filter((row) => /partial|unimplemented/i.test(row.split('|')[2] ?? ''))
    for (const stated of claimed(README, 'layers are partial or absent')) {
      expect(stated).toBe(unfinished.length)
    }
  })

  it('does not state the size of this suite, because nothing here can check it', () => {
    // The only honest place for that number is the run that produced it.
    expect(claimed(README, 'tests')).toEqual([])
  })
})

/**
 * The CI workflow's header, which is a promise about what a green check means.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `.github/workflows/ci.yml` opens with a block headed *"WHAT THIS DOES NOT
 * DO, stated because a green check reads as a stronger promise than it is"* —
 * the most careful paragraph in the repository about its own limits, and
 * nothing read it. Two of its claims had gone false by 2026-09-01:
 *
 *   - *"It does not touch a database."* True of the developer's own
 *     `propositum.db`, which is what `tests/support/no-real-database.ts`
 *     guarantees. False of CI, where every run builds temp SQLite databases and
 *     spawns `npx prisma db push` once per file that needs one.
 *   - *"1,551 tests across 52 files"*, in a comment whose own next sentence
 *     says the number is deliberately not repeated. It was wrong on both
 *     figures, which is exactly what `AGENTS.md` forbids a hand-maintained
 *     count for.
 *
 * The first is the load-bearing one, and not because it is untidy: it is the
 * same fact that explains why three tests time out on a 2-core runner and pass
 * on re-run. A header that says CI never touches a database is the reason
 * nobody looked there.
 *
 * ── What this does NOT check ─────────────────────────────────────────────
 *
 * The other three claims in that header — no live tests, no `ANTHROPIC_API_KEY`,
 * no extension — are unbound. They are true, and binding them would need this
 * file to know what a live test is. `tests/eval-flags.test.ts` and
 * `tests/extension-permissions.test.ts` are nearer to those.
 */
describe('the CI header says what is true of CI, not of a developer', () => {
  // Struck, like the README's. The corrections below keep the old sentences on
  // the page on purpose, and a guard that bound them would forbid the honesty.
  const CI = live(read('.github/workflows/ci.yml'))

  /** Test files that build a database of their own, counted off the call. */
  const databaseBuilders = readdirSync(join(repo, 'tests'))
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => /'prisma',\s*'db',\s*'push'|prisma db push/.test(read(join('tests', name))))

  it('has test files that build a database, or the rest of this is about nothing', () => {
    expect(databaseBuilders.length).toBeGreaterThan(0)
  })

  it('does not claim CI never touches a database while that many files build one', () => {
    expect(live(CI)).not.toMatch(/does not touch a database/i)
  })

  it('does not state the size of this suite, for the reason the README may not', () => {
    // Same rule as the README's: there is no way to know it without running it,
    // so the only honest place for the number is the run that produced it.
    expect(claimed(CI, 'tests')).toEqual([])
    expect(claimed(CI, 'files')).toEqual([])
  })

  it('gives a suite that builds databases longer than vitest s default', () => {
    // Not a taste question. The default is 5000ms; a file here spawns
    // `prisma db push` and reinstalls the append-only triggers before its first
    // assertion, and on a 2-core runner that has lost the race three times.
    // Deleting this line puts the flake back, so the line is pinned.
    expect(read('vitest.config.ts')).toMatch(/testTimeout:\s*[0-9_]+/)
  })
})
