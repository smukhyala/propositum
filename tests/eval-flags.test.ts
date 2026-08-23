/**
 * A typo may not spend money.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * `scripts/eval.ts` reads its flags out of a `Set` and every branch asks
 * `args.has('--known-flag')`. Anything else fell through to the LIVE path,
 * which calls the real API for the whole corpus — so `--dry-run`, `--dryrun`,
 * `-d` and `--reprot` all ran the paid corpus, and on a machine with a key set
 * they did it without saying anything first.
 *
 * `AGENTS.md` singles this script out for costing money. The near-miss is
 * likely rather than exotic: the invocation is `npm run eval -- --flag`, so the
 * `--` already invites a mistake about where the flag boundary is.
 *
 * ── Why one of these tests spawns a process and the other greps ──────────
 *
 * *A typo cannot spend money* is a claim about what the program DOES, and a
 * grep cannot make it — the validation could be present and unreachable, or
 * reachable and after the point of no return. So the first two cases run the
 * real script and read its exit code, which costs about 0.4s each and is the
 * only shape that can fail for the right reason.
 *
 * The third is a grep, and it covers a failure the spawns cannot: a flag added
 * to a branch below and never registered in `KNOWN_FLAGS` would be rejected as
 * unknown the first time somebody typed it correctly. That is a drift between
 * two lists in one file, and a list-against-list comparison is exactly what a
 * grep is good for.
 *
 * ── Cost, stated ─────────────────────────────────────────────────────────
 *
 * Two subprocesses. They run `tsx` on a script that exits before it opens a
 * database, reads a key, or constructs a client, so they need no `.env`, no
 * network and no credentials — the same standing promise the rest of the suite
 * makes. What they do NOT cover is any path past the flag check; every other
 * behaviour of this script is `tests/eval.test.ts`'s.
 */

import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { stripComments } from './support/strip-comments'

const repo = join(import.meta.dirname, '..')

/** Run the script and return what a person would see. Never throws — a non-zero
 *  exit is the thing under test, not an error in the test. */
function run(...flags: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', 'scripts/eval.ts', ...flags], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string }
    return { code: failure.status ?? -1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('an unrecognised flag stops the harness before it can spend anything', () => {
  it('refuses a near-miss of --dry, naming it', () => {
    const { code, out } = run('--dry-run')
    expect(code).toBe(1)
    expect(out).toContain('Unrecognised: --dry-run')
    // The usage comes with the refusal, because a person who mistyped is asking
    // the question the usage answers.
    expect(out).toContain('npm run eval -- --dry')
  })

  it('answers --help with the usage rather than with a sentence about credentials', () => {
    const { code, out } = run('--help')
    expect(code).toBe(0)
    expect(out).toContain('npm run eval -- --report')
    expect(out).not.toContain('ANTHROPIC_API_KEY')
  })
})

describe('every flag the script branches on is a flag it admits', () => {
  /**
   * The drift guard. Both lists live in one file, which is what makes this
   * checkable at all — and what makes it worth checking, because adding a
   * branch is the natural way to add a flag and registering it is the step
   * nobody is reminded about.
   */
  // Comments stripped first, for the reason `tests/architecture.test.ts` strips
  // them: this file's own docblock quotes `args.has('--known-flag')` to explain
  // the defect, and a guard that failed on its own explanation would leave
  // deleting the explanation as the only way back to green.
  const source = stripComments(readFileSync(join(repo, 'scripts/eval.ts'), 'utf8'))

  it('still has both lists, or this test is checking nothing', () => {
    expect(source).toContain('const KNOWN_FLAGS = [')
    expect(source).toMatch(/args\.has\('--/)
  })

  it('registers every flag that a branch asks for', () => {
    const declared = new Set(
      [...source.matchAll(/'(--[a-z-]+)',/g)]
        .map((match) => match[1])
        .filter((flag): flag is string => flag !== undefined),
    )

    const branched = [...source.matchAll(/args\.has\('(--[a-z-]+)'\)/g)]
      .map((match) => match[1])
      .filter((flag): flag is string => flag !== undefined)

    expect(branched.length).toBeGreaterThan(0)
    for (const flag of branched) expect(declared).toContain(flag)
  })
})
