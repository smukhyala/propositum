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
    //
    // ── Read this before trusting this test ────────────────────────────────
    //
    // It still passes and it now MEANS LESS THAN IT USED TO. `ActionKind` has
    // stopped enumerating effects and started enumerating mechanisms, so
    // `click-element` can press the page's own Send button. What survives here
    // is a statement about OUR TOOL SURFACE — we ship no code that composes a
    // message — and no longer a statement about reachable effects.
    //
    // The replacement for the missing capability is a confirmation pause
    // (`src/domain/execution/reversibility.ts`), and a pause is strictly weaker
    // than an absence: it can be defeated by a bug in the classifier, by
    // phrasing outside the lexicon, or by a person who has learned to click
    // yes. Nobody should read a green run of this test as ADR-0004's guarantee
    // surviving intact.
    for (const forbidden of ['sendMessage', 'sendEmail', 'purchase', 'publish', 'deleteFile']) {
      expect(tools).not.toContain(`export function ${forbidden}`)
    }
  })
})

describe('a composed offer has nowhere to name a place', () => {
  /**
   * ADR-0009's first structural property, checked rather than asserted.
   *
   * `ContractScope.approvedSourceIds` is derived by deterministic code from the
   * pages the thread actually ran through. The offer boundary composes prose,
   * and the guarantee that it cannot widen what the agent may touch is not
   * "the prompt says not to" — it is that there is NO FIELD for a URL, a host,
   * an origin or a source id. A model that could name one could add one.
   *
   * The same move ADR-0008 already relies on for the ambient endpoint, which is
   * grepped for `text` in tests/capture.test.ts. Crude on purpose: a
   * sophisticated check would need the thing it is checking to already work.
   */
  const file = join(repo, 'src/model/boundaries/offer.ts')

  it('exists, so this test cannot pass by checking nothing', () => {
    expect(readFileSync(file, 'utf8')).toContain('export const offerSchema')
  })

  it('has no field, description or example that could carry one', () => {
    const source = readFileSync(file, 'utf8')
    const start = source.indexOf('export const offerSchema')
    const end = source.indexOf('export type OfferOutput')

    // The canary the tools regex above exists because of: if the slice is
    // empty, every assertion below passes having read nothing.
    expect(end).toBeGreaterThan(start)
    const schema = source.slice(start, end)
    expect(schema.length).toBeGreaterThan(200)

    expect(
      schema,
      'the offer schema names a place — a model that can name one can add one',
    ).not.toMatch(/url|origin|host|site|domain|source/i)
  })

  it('names no ActionKind either, so it proposes no permission', () => {
    // CONTEXT.md §3: a model may not propose `allowedActionKinds` at all,
    // because there is no session-level grant for a subset check to compare
    // against and a vacuous check is worse than none. `outcomeKinds` describes
    // the shape of a RESULT, which grants nothing.
    const source = readFileSync(file, 'utf8')
    const schema = source.slice(
      source.indexOf('export const offerSchema'),
      source.indexOf('export type OfferOutput'),
    )

    expect(schema).not.toMatch(/allowedActionKinds|actionKinds|ActionKind/)
  })
})

describe('the reversibility classifier stays domain code', () => {
  /**
   * Covered by the domain-purity block below, and asserted separately anyway.
   *
   * This is the file most likely to grow a model call: "ask a model whether
   * this button is dangerous" is the obvious next idea and it is exactly wrong
   * — a model call in the authorization path inverts "models propose,
   * deterministic code authorizes", because the model would be deciding whether
   * it needs permission, which is the same thing as deciding it does not. A
   * named test is cheaper than remembering that argument.
   */
  const file = join(repo, 'src/domain/execution/reversibility.ts')

  it('exists, so this test cannot pass by checking nothing', () => {
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0)
  })

  it('imports nothing from model, policy, or persistence', () => {
    const source = readFileSync(file, 'utf8')
    const offenders: string[] = []

    for (const [, spec] of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (/(^|\/)(app|model|persistence|policy)\//.test(spec ?? '')) offenders.push(spec ?? '')
    }

    expect(offenders).toEqual([])
  })

  it('calls no model client and reads no clock', () => {
    const source = readFileSync(file, 'utf8')

    expect(source).not.toMatch(/\bModelClient\b/)
    expect(source).not.toMatch(/\bawait\b/)
    expect(source).not.toMatch(/Date\.now\s*\(/)
  })
})

describe('one author for what a run produced', () => {
  /**
   * `ShiftOutcomeKind` and `Reversibility` are assigned in exactly one file.
   *
   * The one that would actually hurt is `reversibility`. It decides whether a
   * person is offered a verdict at all, so a second writer is a second answer to
   * *"can this still be undone"* — and the two would drift in the direction that
   * eventually offers an Accept button over something that already left the
   * building. A person who clicks Reject on a sent message and is told
   * "rejected" has been lied to by the one screen the trust model rests on.
   *
   * The greps look for the ASSIGNMENT form rather than the literals. Reading a
   * value back (`outcome.reversibility === 'held'`) is fine and happens in
   * several places; writing one is what has a single owner.
   */
  const WRITER = 'src/server/outcomes/index.ts'
  const production = tsFilesUnder(join(repo, 'src'))

  const writersOf = (pattern: RegExp) =>
    production
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repo, file))

  it('assigns a reversibility in one place only', () => {
    expect(writersOf(/reversibility:\s*'(held|landed)'/)).toEqual([WRITER])
  })

  it('assigns a ShiftOutcomeKind in one place only', () => {
    expect(
      writersOf(/\bkind:\s*'(document-changes|collection|answer|message-draft|external-effect)'/),
    ).toEqual([WRITER])
  })
})

describe('the run spine does not know what a document is', () => {
  /**
   * The check that the document assumption was REMOVED rather than relocated.
   *
   * `execute-run.ts` used to load a version, split it on `## ` headings, and
   * diff the worker's prose against it. Every step was correct and every step
   * said the same thing — a run works on a document — so everything downstream
   * inherited it. Moving that logic into `src/server/outcomes/document-changes.ts`
   * is only worth anything if the spine genuinely cannot reach it any more, and
   * "genuinely" is a grep rather than a promise.
   *
   * Comments are stripped first, and the reason is the mirror image of the one
   * in `tests/reachability.test.ts`. There, a comment MENTIONING a call could
   * satisfy a check it should have failed. Here, the file's own header explains
   * that it no longer splits content on `## ` headings — and an unstripped grep
   * would fail on the sentence describing the property it is checking, which
   * would leave the only way to keep the test green being to stop explaining
   * why the rule exists.
   */
  const source = () =>
    readFileSync(join(repo, 'src/server/execute-run.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  it('has no Markdown heading syntax and no heading regex', () => {
    expect(source()).not.toMatch(/##/)
    expect(source()).not.toMatch(/#\{2,3\}/)
  })

  it('never diffs anything', () => {
    expect(source()).not.toMatch(/\bdiff\(/)
  })

  it('does not import Document, DocumentVersion, or anything named for one', () => {
    // Capitalised deliberately: `ctx.repos.documents` is how the spine reaches
    // storage and stays fine. A type called `Document` arriving here means the
    // shape of a document has reached the file again.
    expect(source()).not.toMatch(/\bDocument\b/)
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
