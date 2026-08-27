/**
 * A message reaches a person. It reaches no prompt, no gate, and no scope.
 *
 * ADR-0021. This is the `groupTitle` containment template from
 * `tests/reachability.test.ts`, applied to the two values that cross the
 * machine's edge in this feature: what Propositum SAYS on a phone, and what a
 * person TYPES back.
 *
 * ── Why containment is asserted rather than described ────────────────────
 *
 * ADR-0021 spends a promise to build this: `SECURITY_AND_PRIVACY.md` said
 * "Nothing about what you read, wrote or handed over is stored anywhere but
 * here", and it does not any more. What is left in place of that promise is a
 * bounded claim — derived prose leaves, page-authored text does not — and a
 * bounded claim with no mechanism is a slogan.
 *
 * Three hazards, and they fail differently:
 *
 *   - **Egress.** A message is the only thing in this product that carries the
 *     SUBJECT of somebody's work off the machine. Anything that has crossed
 *     `Datamarked` must not be in one. The grep here catches a field NAMED after
 *     page-authored text; it cannot catch a field that merely holds some, and
 *     that limit is stated so a green tick is not read as more than it is.
 *   - **A prompt.** An inbound reply is untrusted text on exactly the footing
 *     page text is — a person types it, and a person can be induced to type
 *     anything. `SECURITY_AND_PRIVACY.md` names the timing version of this trap:
 *     "An email that arrives at 3am is a model call at 3am unless something is
 *     designed first to prevent it." What prevents it is that nothing reads a
 *     reply into a prompt at all.
 *   - **A gate.** `compilePolicy` reads a ratified scope and the person's
 *     controls. A sentence that arrived from a phone has no business near it, and
 *     ADR-0022's whole argument for why a `DecisionVerdict` may be given by reply
 *     is that it grants nothing — which is only true while nothing routes it
 *     somewhere that grants.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Comments are prose. A docblock naming a field is not a use of it. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** An import is a declaration of intent, not a call. */
const stripImports = (source: string): string =>
  source.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full) && !/\.type-test\.ts$/.test(full)) out.push(full)
  }
  return out
}

const PRODUCTION = [...walk(join(repo, 'src')), ...walk(join(repo, 'scripts'))]

const bodyOf = (file: string): string => stripImports(stripComments(readFileSync(file, 'utf8')))

const CONVERSATION = join(repo, 'src', 'domain', 'conversation')

describe('what leaves the machine is derived prose and nothing else', () => {
  const rendered = bodyOf(join(CONVERSATION, 'messages.ts'))

  /**
   * The closed list from ADR-0021 §3.
   *
   * Each of these is a field that exists somewhere in this product and holds
   * text a page wrote or a model composed for a page. `imageSrc` is on it
   * because the confirmation screen's own docblock calls a screenshot "the most
   * sensitive byte-string this product holds" and refuses to serve one by id —
   * a channel that could carry one would be that second door with a worse lock.
   */
  it('names no page-authored or attested field', () => {
    for (const forbidden of [
      'elementName',
      'tabTitle',
      'typedText',
      'pageAuthored',
      'attestedUrl',
      'imageSrc',
      'screenshot',
      'accessibleName',
      'datamark',
      'Datamarked',
    ]) {
      expect(rendered, `${forbidden} must not reach a message — ADR-0021 §3`).not.toContain(
        forbidden,
      )
    }
  })

  /**
   * The only URL shape allowed out is a loopback deep link.
   *
   * A message carrying an approved source's address would be telling a third
   * party which sites somebody browses, which is a fact about a person and not
   * about their work.
   */
  it('builds no address but a loopback one', () => {
    expect(rendered).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/)
  })
})

describe('nothing a person typed on a phone reaches a prompt', () => {
  /**
   * The prompt builders name their inputs field by field and `datamark` every
   * page-authored one. A reply appearing in either without crossing that door
   * is raw untrusted text in a prompt, which is the single thing ADR-0006 exists
   * to prevent — and the honest way to add one is to turn this red first.
   */
  it('is absent from every prompt builder', () => {
    for (const builder of [
      join('src', 'server', 'name-thread.ts'),
      join('src', 'server', 'compose-offer.ts'),
    ]) {
      const source = bodyOf(join(repo, builder))
      expect(source, `${builder} builds a prompt and no longer names its inputs`).toContain(
        'datamark(',
      )
      expect(
        source,
        `${builder} now puts a thread reply in a prompt — it is untrusted typed text and must cross datamark first`,
      ).not.toMatch(/\b(parseReply|ThreadReply|threadReply|DecisionVerdict)\b/)
    }
  })

  /**
   * The stronger version, and the one ADR-0021 actually rests on: no model
   * boundary anywhere mentions the reply under any of its names.
   *
   * `src/model/boundaries/` is the whole set of eight, and `tests/boundaries.test.ts`
   * asserts the count does not become nine. This asserts the eight that exist do
   * not quietly gain an input.
   */
  it('is absent from every model boundary', () => {
    for (const file of PRODUCTION) {
      if (!relative(repo, file).startsWith(join('src', 'model'))) continue
      expect(
        bodyOf(file),
        `${relative(repo, file)} is a model boundary and mentions a thread reply — nothing from a phone may inform a prompt`,
      ).not.toMatch(/\b(parseReply|ThreadReply|threadReply|decisionVerdict|DecisionVerdict)\b/)
    }
  })
})

describe('nothing from a phone reaches a gate or a scope', () => {
  /**
   * ADR-0022's argument for why an answer may be given from a lock screen is
   * that it grants nothing: no AuthorizedAction is minted, no ContractScope
   * widens, no ActionKind becomes allowed. That is a claim about wiring, and
   * this is the wiring.
   */
  it('never appears in a file that evaluates the policy', () => {
    for (const file of PRODUCTION) {
      const source = bodyOf(file)
      if (!source.includes('compilePolicy(')) continue
      expect(
        source,
        `${relative(repo, file)} evaluates the policy and mentions a thread value in the same file — nothing from a phone may reach a gate`,
      ).not.toMatch(/\b(parseReply|ThreadReply|threadReply|DecisionVerdict|ThreadConnection)\b/)
    }
  })

  it('never becomes part of a ContractScope', () => {
    for (const file of PRODUCTION) {
      const source = bodyOf(file)
      if (!/\bContractScope\b/.test(source)) continue
      expect(
        source,
        `${relative(repo, file)} builds a ContractScope and mentions a thread value — a scope comes from a ratified contract and from nowhere else`,
      ).not.toMatch(/\b(parseReply|ThreadReply|threadReply|DecisionVerdict|ThreadConnection)\b/)
    }
  })

  /**
   * The compile-time half lives in `tests/policy-gate.type-test.ts`, which
   * `npm run typecheck` runs and vitest never sees. This is the grep half, and
   * the two catch different mistakes: the type proof catches passing the value,
   * this catches somebody reading a field off it and passing that.
   */
  it('keeps the conversation domain out of the policy layer entirely', () => {
    for (const file of PRODUCTION) {
      const path = relative(repo, file)
      if (!path.startsWith(join('src', 'policy'))) continue
      expect(
        bodyOf(file),
        `${path} is the policy layer and imports from the conversation domain`,
      ).not.toMatch(/domain\/conversation/)
    }
  })
})

describe('the conversation domain stays a domain', () => {
  const files = readdirSync(CONVERSATION).map((name) => join(CONVERSATION, name))

  it('reads no clock and reaches no network', () => {
    for (const file of files) {
      const source = bodyOf(file)
      expect(source, `${relative(repo, file)} reads the clock`).not.toMatch(
        /\bDate\.now\(\)|new Date\(/,
      )
      expect(source, `${relative(repo, file)} reaches the network`).not.toMatch(/\bfetch\s*\(/)
    }
  })

  it('imports from no layer above it', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, `${relative(repo, file)} imports a layer above the domain`).not.toMatch(
        /from\s+['"](@\/|\.\.\/\.\.\/)(app|model|persistence|policy|runtime|server)\//,
      )
    }
  })
})
