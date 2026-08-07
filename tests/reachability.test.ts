/**
 * Is the code that enforces our guarantees actually reachable?
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * An adversarial review found three pieces of correct, tested code that
 * NOTHING CALLED:
 *
 *   - `repos.reports.create` — so no ShiftReport or DecisionNeeded row was ever
 *     written, so the Accept-all guard the re-entry prototype exists to enforce
 *     could never fire. It would have demoed as fixed having never once run.
 *   - `runWorker` — so pressing Take over stranded the session in `away`
 *     forever, while the UI offered "Take back control".
 *   - `sessions.markObserving` — so the `away → observing` transition CONTEXT
 *     requires never happened.
 *
 * Every one passed typecheck and unit tests. Coverage of a function says
 * nothing about whether the product can reach it, and that gap is invisible in
 * a green suite.
 *
 * These are crude greps on purpose. A sophisticated check would need the thing
 * it is checking to already work.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dirs: string[]): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry)) out.push(full)
    }
  }
  for (const d of dirs) walk(join(repo, d))
  return out
}

const PRODUCTION = sourceFiles(['src', 'scripts'])

/**
 * Strip comments before searching.
 *
 * Found the hard way: the first version of this file counted a COMMENT
 * mentioning `repos.reports.create` as a caller. Verifying the test by deleting
 * the real call showed it still passing — the file's own header comment about
 * the bug was keeping the test green. A reachability check that comments can
 * satisfy is worse than none, because it reads as proof.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Files that CALL `needle` — in code, not in prose — excluding its definition. */
function callersOf(needle: string, definedIn: string): string[] {
  return PRODUCTION.filter((f) => {
    if (relative(repo, f) === definedIn) return false
    return stripComments(readFileSync(f, 'utf8')).includes(needle)
  }).map((f) => relative(repo, f))
}

describe('the safety machinery is reachable from the product', () => {
  it('something writes a ShiftReport, or the Accept-all guard can never fire', () => {
    // The guard reads `decisions`, which comes from `reports.forContract`,
    // which returns nothing if nothing ever called `reports.create`.
    const callers = callersOf('reports.create', 'src/persistence/repositories/index.ts')

    expect(callers, 'no code path writes a ShiftReport — see tests/reachability.test.ts').not.toEqual([])
  })

  it('something calls runWorker, or Take over strands the session', () => {
    const callers = callersOf('runWorker', 'src/runtime/worker-loop.ts')

    expect(callers, 'runWorker has no caller — a handed-over session never completes').not.toEqual([])
  })

  it('something returns the session to the person', () => {
    // Without this the phase stays `away` forever and every control offering to
    // hand the work back is a promise the product cannot keep.
    const callers = callersOf('markObserving', 'src/persistence/repositories/index.ts')

    expect(callers, 'nothing calls markObserving — sessions never come back').not.toEqual([])
  })

  it('there is a way to actually start the worker', () => {
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >

    expect(Object.keys(scripts)).toContain('worker')
  })

  it('the gate is reachable from the run path', () => {
    expect(callersOf('authorize(', 'src/policy/gate.ts')).not.toEqual([])
  })

  it('append-only guards are installed by something that runs', () => {
    // These existed and were tested for a week before anything called them.
    expect(callersOf('ensureAppendOnlyGuards', 'src/persistence/append-only.ts')).not.toEqual([])
  })

  it('events reach the ledger writer rather than a repository', () => {
    expect(callersOf('createLedgerWriter', 'src/persistence/ledger-writer.ts')).not.toEqual([])
  })
})

describe('page-derived prose cannot reach the drafted agreement', () => {
  it('draftContract filters constraint claims before the handoff call', () => {
    // ADR-0006's structural barrier covers `guidance` only, because the schema
    // has no such field. The model WRITES objective and definitionOfDone, and
    // was being shown constraint text to write them from — so an injected
    // constraint could arrive in the agreement as unattributed prose.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')

    expect(actions).toMatch(/filter\(\s*\(?c\)?\s*=>\s*c\.kind\s*!==\s*'constraint'\s*\)/)
  })

  it('a constraint is only quoted when the quote actually verified', () => {
    // Attributing the model's paraphrase to a real site is worse than no
    // attribution: the person retypes it into guidance believing the source
    // said it, which turns the friction into laundering.
    const actions = readFileSync(join(repo, 'src/server/actions.ts'), 'utf8')

    expect(actions).toMatch(/verbatim:\s*quote\s*!==\s*undefined/)
  })
})
