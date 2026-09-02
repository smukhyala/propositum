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
import { stripComments } from './support/strip-comments'

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
 *     spawns `npx prisma db push` once per `beforeAll` that needs one.
 *   - *"1,551 tests across 52 files"*, in a comment whose own next sentence
 *     says the number is deliberately not repeated. It was wrong on both
 *     figures, which is exactly what `AGENTS.md` forbids a hand-maintained
 *     count for.
 *
 * The first is the load-bearing one, and not because it is untidy: it is the
 * same fact that explains why three tests time out on a 2-core runner and pass
 * on re-run. Not because a push runs ahead of the failing test's own first
 * assertion — every push here sits in a `beforeAll(…, 120_000)`, which vitest
 * bounds with `hookTimeout` and never with `testTimeout`, so no builder's own
 * setup was ever charged to the 5000 ms that expired. It is contention: files
 * run in parallel workers, and the ones spawning a Node process for
 * `prisma db push` and reinstalling the append-only triggers starve the `it()`
 * bodies running beside them, which is what all three failures in #97 were. A
 * header that says CI never touches a database is the reason nobody looked
 * there.
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

  /**
   * Test files that build a database of their own, counted off the spawn.
   *
   * Comments are stripped first, because the first version of this count did
   * not. It matched the raw text of any file saying `prisma db push` anywhere,
   * which caught its own regex literal and three files that only mention the
   * phrase in a comment or an asserted string — measured 2026-09-01, twenty-four
   * files of which twenty spawned. A count that cannot come out below its own
   * floor makes the assertion under it a tautology, and it is the hole
   * `tests/reachability.test.ts` strips comments to close.
   *
   * The self-exclusion below is belt and braces rather than load-bearing: the
   * pattern's own source escapes the paren, so this file does not match itself
   * today. It is there so that stops being something to reason about.
   *
   * WHAT IT DOES NOT COUNT: pushes. `tests/eval.test.ts` spawns three times,
   * once per `beforeAll` that needs one, and is one file here.
   */
  const SPAWNS_A_PUSH = /execFileSync\(\s*'npx',\s*\[\s*'prisma',\s*'db',\s*'push'/
  const databaseBuilders = readdirSync(join(repo, 'tests'))
    .filter((name) => name.endsWith('.test.ts'))
    .filter((name) => name !== 'counts.test.ts')
    .filter((name) => SPAWNS_A_PUSH.test(stripComments(read(join('tests', name)))))

  it('has test files that build a database, or the rest of this is about nothing', () => {
    expect(databaseBuilders.length).toBeGreaterThan(0)
  })

  it('does not claim CI never touches a database', () => {
    // The sentence and the count are bound by the test above, not by this one:
    // if no file spawned a push any more, that one would go red and this rule
    // would be the wrong rule rather than a failing one. Deleting the sentence
    // is what passes here; correcting it in place, which is what happened, is
    // what the strike above the line does.
    expect(live(CI)).not.toMatch(/does not touch a database/i)
  })

  it('does not state the size of this suite, for the reason the README may not', () => {
    // Same rule as the README's: there is no way to know it without running it,
    // so the only honest place for the number is the run that produced it.
    expect(claimed(CI, 'tests')).toEqual([])
    expect(claimed(CI, 'files')).toEqual([])
  })

  it('gives a suite that builds databases longer than the vitest default', () => {
    // Not a taste question. The default is 5000ms, and on a 2-core runner an
    // ordinary assertion has lost that three times while sibling workers were
    // spawning `prisma db push` and reinstalling the append-only triggers.
    //
    // The number is parsed rather than matched, because the first version of
    // this rule asserted the shape only and `testTimeout: 1000` would have
    // satisfied it — a pin that accepts a value below the default is not a pin.
    // The floor is the value that cured it; anything under 30_000 has never
    // been run against the contention this exists for, so raising the ceiling
    // is free here and lowering it has to be argued.
    const pinned = /testTimeout:\s*([0-9_]+)/.exec(read('vitest.config.ts'))
    expect(pinned).not.toBeNull()
    expect(Number((pinned?.[1] ?? '0').replace(/_/g, ''))).toBeGreaterThanOrEqual(30_000)
  })
})

/**
 * `npm run typecheck` compiles this repository, and not a copy of it.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `tsconfig.json` includes `**\/*.ts` and excluded only `node_modules`, so it
 * also compiled everything under `src-tauri/target` and `dist-runtime` — where
 * the tray build stages a FULL COPY of `src/` into the bundle it ships. Two
 * trees, the same declarations, and `tsc` comparing them against each other.
 *
 * Both exclusions landed with the tray and purchase work rather than with a
 * guard, and nothing held them. This is the guard, added 2026-09-02 after the
 * same failure was hit and diagnosed a second time on a branch that predated
 * them.
 *
 * The way it fails is why it is worth pinning. On a clean checkout there is no
 * `target/` and typecheck passes. After one `cargo` or tray build the copy
 * exists, is byte-identical, and typecheck STILL passes — so nothing is wrong
 * until somebody edits a type in `src/`, at which point they are handed a page
 * of errors about a path they have never opened, in a directory
 * `src-tauri/.gitignore` calls build output. The signal points at the
 * developer's own change and the cause is a stale artefact.
 *
 * ── What this does NOT check ─────────────────────────────────────────────
 *
 * Any other generated tree. `.next` is already named in `include` on purpose,
 * and there is no general rule here about build output — this pins the two
 * directories that hold a second copy of the sources, because those are the
 * ones that turn into a type error rather than into noise.
 */
describe('the typechecker is not handed a second copy of the sources', () => {
  it('excludes the trees the tray build stages the whole of src/ into', () => {
    const config = JSON.parse(read('tsconfig.json')) as { exclude?: string[] }
    expect(config.exclude ?? []).toContain('src-tauri/target')
    expect(config.exclude ?? []).toContain('dist-runtime')
  })
})
