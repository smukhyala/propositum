/**
 * The test that fails if someone adds an ungated path.
 *
 * The policy gate's guarantee is only as good as the rule that every capability
 * goes through it. A rule that lives in an ADR is a rule people forget; this
 * one is parsed out of the source and checked.
 *
 * It catches the realistic failure: a contributor adds a helper to tools.ts
 * that reaches the network directly, or a worker module starts calling `fetch`
 * without a token. Neither is malice — both are Tuesday.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

function tsFilesUnder(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
    }
  }
  walk(dir)
  return out
}

describe('every tool requires an AuthorizedAction', () => {
  /**
   * Matches `export function` AND `export async function`, and tolerates a
   * signature broken across lines.
   *
   * The first version of this only matched single-line `export function`, so
   * when the tools became `export async function` with multi-line signatures it
   * silently found one of three — a guard that had stopped guarding. Only the
   * "did the regex match anything" canary below revealed it, which is why that
   * assertion exists.
   */
  const EXPORTED_FN = /export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*(\w+)\s*:\s*([^,)]+)/g

  const tools = () =>
    [...readFileSync(join(repo, 'src/policy/tools.ts'), 'utf8').matchAll(EXPORTED_FN)].map(
      ([, name, , type]) => ({ name: name ?? '', type: (type ?? '').trim().replace(/\s+/g, ' ') }),
    )

  it('finds every tool, including async ones (guards against the regex silently matching nothing)', () => {
    const names = tools().map((t) => t.name)

    expect(names).toContain('readApprovedSource')
    expect(names).toContain('readDocument')
    expect(names).toContain('draftSection')
  })

  it.each(tools())('$name takes an AuthorizedAction', ({ type }) => {
    expect(type).toMatch(/^AuthorizedAction(<|$)/)
  })
})

describe('the authorization brand is never exported', () => {
  it('keeps authorize() the only construction site for AuthorizedAction', () => {
    const gate = readFileSync(join(repo, 'src/policy/gate.ts'), 'utf8')

    // The brand must exist as a REAL runtime symbol typed `unique symbol`. A
    // `declare const` would be type-only, emit nothing, and every token
    // construction would throw at runtime — caught the hard way.
    expect(gate).toMatch(/^const authorized: unique symbol = Symbol\(/m)
    expect(gate).not.toMatch(/declare const authorized/)

    // ...and must NOT be exported, or anything could mint authority.
    expect(gate).not.toMatch(/export\s+const\s+authorized/)
    expect(gate).not.toMatch(/export\s*\{[^}]*\bauthorized\b[^}]*\}/)
  })
})

describe('capabilities the brief excludes do not exist', () => {
  it('has no tool for sending, purchasing, publishing, or deleting', () => {
    const tools = readFileSync(join(repo, 'src/policy/tools.ts'), 'utf8')

    // Absence of capability is the strongest prohibition available — these are
    // not denied by a rule, they are simply not implemented.
    for (const forbidden of ['sendMessage', 'sendEmail', 'purchase', 'publish', 'deleteFile']) {
      expect(tools).not.toContain(`export function ${forbidden}`)
    }
  })
})

describe('the domain layer stays pure', () => {
  const domainFiles = tsFilesUnder(join(repo, 'src/domain'))

  it('has files to check', () => {
    expect(domainFiles.length).toBeGreaterThan(0)
  })

  it('imports nothing from app, model, persistence, or policy', () => {
    const offenders: string[] = []

    for (const file of domainFiles) {
      const source = readFileSync(file, 'utf8')
      for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        if (/(^|\/)(app|model|persistence|policy)\//.test(spec ?? '')) {
          offenders.push(`${relative(repo, file)} -> ${spec}`)
        }
      }
    }

    // The domain is where the rules live. If it can reach the model client or
    // the database, "no framework-specific logic inside core domain models"
    // has already stopped being true.
    expect(offenders).toEqual([])
  })

  it('makes no network or filesystem calls', () => {
    const offenders: string[] = []

    for (const file of domainFiles) {
      const source = readFileSync(file, 'utf8')
      if (/\bfetch\s*\(/.test(source)) offenders.push(`${relative(repo, file)}: fetch`)
      if (/from\s+['"]node:fs/.test(source)) offenders.push(`${relative(repo, file)}: node:fs`)
    }

    expect(offenders).toEqual([])
  })

  it('never reads the clock, so policy decisions stay reproducible', () => {
    const offenders: string[] = []

    for (const file of domainFiles) {
      const source = readFileSync(file, 'utf8')
      // Time is passed in (RunContext.nowEpochMs), never read. Otherwise a
      // 40-minute fixture could not replay in 400ms, and a gate decision would
      // depend on when it ran.
      if (/Date\.now\s*\(|new Date\s*\(\s*\)/.test(source)) {
        offenders.push(relative(repo, file))
      }
    }

    expect(offenders).toEqual([])
  })
})
