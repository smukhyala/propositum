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
import { stripComments } from './support/strip-comments'

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

/**
 * Propositum holds no password of the person's, and there is nowhere to put one.
 *
 * ── The decision this enforces ───────────────────────────────────────────
 *
 * [ADR-0025](../docs/adr/0025-computer-use-beyond-the-browser.md) §4 signs in
 * by clicking Chrome's own saved-password prompt. The credential goes from
 * Chrome's encrypted store into Chrome's own form; Propositum never reads it,
 * stores it, prompts with it or logs it. The safety property is not *"the vault
 * is well built"* — it is *"there is no vault"*, which is the pattern `AGENTS.md`
 * asks for: prefer absence to a rule, and a type to a convention.
 *
 * An absence needs something to notice when it stops being one. These are that.
 *
 * ── Why each of the three ────────────────────────────────────────────────
 *
 * A vault does not arrive as a pull request titled "add a vault". It arrives as
 * a field, a helper, or a checkbox that makes a confirmation stop happening.
 * Each assertion below closes one of those three doors, and ADR-0025 §5 records
 * that the vault was argued for at its strongest and declined.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * A secret in a field whose name is innocuous — `value`, `data`, `blob`. Naming
 * is the guard here and naming is a convention, so this is weaker than the
 * brand-based guarantees elsewhere in this file. It is worth having because the
 * honest name is what a person reaches for first, and having to pick a dishonest
 * one is a moment where somebody notices.
 */
describe('there is no credential of the person’s, and nowhere to put one', () => {
  it('has no schema field that could hold one, beyond the four already argued for', () => {
    const schema = stripComments(readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8'))

    const fields = [...schema.matchAll(/^\s{2}(\w+)\s+\w/gm)]
      .map((m) => m[1] ?? '')
      .filter((name) => /password|passphrase|credential|vault|wallet|card|secret|token/i.test(name))

    /**
     * The four that exist, each with the ADR that argued for it:
     *
     *  - `controlToken`   per-run browser control (ADR-0010). Not a person's.
     *  - `inputTokens`,
     *    `outputTokens`   model call accounting. Not a credential at all, and
     *                     kept in the list rather than excluded by a cleverer
     *                     regex — a narrower pattern is a pattern with more
     *                     places to hide.
     *  - `refreshToken`   the Google calendar grant (ADR-0014)
     *  - `botToken`       the person's own Telegram bot (ADR-0021)
     *
     * A fifth means somebody is storing something new. That is an ADR, not a
     * migration.
     */
    expect(
      [...new Set(fields)].sort(),
      'a new secret-shaped column appeared — ADR-0025 says Propositum holds no credential of the ' +
        "person's, so this is either a decision that needs its own ADR or a field that needs a different name",
    ).toEqual(['botToken', 'controlToken', 'inputTokens', 'outputTokens', 'refreshToken'])
  })

  it('has no action kind that carries one', () => {
    const tools = stripComments(readFileSync(join(repo, 'src/policy/tools.ts'), 'utf8'))
    const policy = stripComments(readFileSync(join(repo, 'src/domain/handoff/policy.ts'), 'utf8'))

    // `fill-credential` is the shape an earlier draft of ADR-0025 proposed, and
    // the reason the words are banned in CONTEXT.md: a name is how a field
    // arrives. Typing a password is `type-text` with a model-authored string,
    // which is exactly what `password_field` below refuses.
    for (const forbidden of ['fill-credential', 'fillCredential', 'enterPassword', 'signInWith']) {
      expect(
        `${tools}\n${policy}`,
        `${forbidden} means an action kind now carries a secret — see ADR-0025 §4`,
      ).not.toContain(forbidden)
    }
  })

  it('refuses a credential form outright, and never by confirmation', () => {
    const gate = stripComments(readFileSync(join(repo, 'src/policy/gate.ts'), 'utf8'))
    const classifier = stripComments(
      readFileSync(join(repo, 'src/domain/execution/reversibility.ts'), 'utf8'),
    )

    /**
     * The gate's own comment is the specification:
     *
     *   > A confirmation screen here would be a prompt asking someone to approve
     *   > an agent entering their credentials, and the right answer to that
     *   > question is not "let them decide": it is a capability we do not offer.
     *
     * The failure this guards is not deletion — it is *downgrade*. Moving this
     * from the gate into the classifier would turn a refusal into a question a
     * tired person can answer yes to, and the diff would read like a
     * simplification.
     */
    expect(gate, 'the password_field refusal is gone').toContain("deny('password_field')")
    expect(
      classifier,
      'password_field appears in the reversibility classifier — a credential form must be REFUSED, ' +
        'not escalated to a confirmation somebody can click through',
    ).not.toContain('password_field')
  })

  it('has no remembered yes', () => {
    /**
     * `src/policy/tools.ts` already argues this — *"a remembered yes is a
     * confirmation that outlives the thing it was about, granted at a moment
     * when the person was looking at something else"* — and this makes the
     * argument executable.
     *
     * It is the guard most likely to be tripped by a well-meaning change, because
     * "stop asking me this" is the most reasonable-sounding feature request in
     * the product. What answers it is ADR-0024's `PurchaseAuthorization`: a
     * NARROWER permission, ratified deliberately, that expires — not a
     * remembered click.
     */
    const surfaces = ['src/policy/tools.ts', 'src/policy/gate.ts', 'src/server/actions.ts'].map(
      (path) => ({ path, code: stripComments(readFileSync(join(repo, path), 'utf8')) }),
    )

    for (const forbidden of ['alwaysAllow', 'rememberThisAnswer', 'trustThisSite', 'dontAskAgain']) {
      const offenders = surfaces.filter(({ code }) => code.includes(forbidden)).map((s) => s.path)
      expect(
        offenders,
        `${forbidden} is a remembered yes — ADR-0024 grants a scoped, expiring PurchaseAuthorization instead`,
      ).toEqual([])
    }
  })
})

/**
 * The screen stops saying *"Buy anything"* on the day it stops being true.
 *
 * **That day was 2026-09-01.** The guard fired on the commit that moved the
 * branch, exactly as the paragraphs below predicted, and was deliberately
 * updated in the same commit — the history below is kept because it is the
 * argument for the replacement's shape.
 *
 * ── The failure this exists for, ~~which has not happened yet~~ ──────────
 *
 * `src/ui/agreement.tsx` renders an `ABSENT` list — *"Send an email or a
 * message · Publish anything · Buy anything · Delete a file"* — under a heading
 * that tells a person these things cannot happen. Today that is accurate for
 * buying, and not because of a policy: `extension/src/cdp.js` fails every
 * non-`GET` request unconditionally, so a checkout never leaves the machine.
 *
 * [ADR-0024](../docs/adr/0024-purchases-within-a-ratified-authorisation.md)
 * spends that block. When it is implemented, the extension will allow a
 * non-`GET` covered by a ratified `PurchaseAuthorization` — and the sentence on
 * the screen becomes a false statement about money, shown to somebody deciding
 * whether to leave their desk. That is the worst class of stale claim this
 * repository has, because `docs/PRODUCT_PRINCIPLES.md` §11 is about exactly this
 * and the interface is where it costs the most.
 *
 * So the two are coupled here rather than trusted to move together. The
 * unconditional block and the sentence live in different files, different
 * languages and different layers, and nothing else connects them.
 *
 * ── Why the assertion is shaped this way ─────────────────────────────────
 *
 * It does not check that buying is impossible — `tests/extension-cdp.test.ts`
 * covers the mechanism. It checks that the CLAIM and the MECHANISM agree. Either
 * both change or the suite goes red, and the person doing the ADR-0024 work is
 * told, in the same run, that there is a screen to fix.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * The other three entries. `sendMessage`, `publish` and `deleteFile` are absent
 * as functions and reachable as effects via `click-element`, which ADR-0010
 * already records — the copy above the list carries that correction in prose,
 * and prose is what holds it.
 */
describe('what the agreement screen promises about money matches the transport', () => {
  /**
   * ~~says "Buy anything" only while every non-GET is blocked~~ **Deliberately
   * updated 2026-09-01 — this guard went red on the commit that built ADR-0024,
   * which is the system working, and its replacement holds the new promise the
   * way the old one held the old.** The transport is permit-conditional now,
   * so the coupled claim becomes: the screen may say buying is impossible ONLY
   * in the arm where no authorisation was ratified, and the transport must
   * refuse any non-`GET` that arrives without a permit. The screen side is
   * comment-stripped too, which the old guard did not do — a docblock quoting
   * the phrase used to satisfy it.
   */
  it('confines “Buy anything” to the no-authorisation arm, and the block to the no-permit arm', () => {
    const cdp = stripComments(readFileSync(join(repo, 'extension/src/cdp.js'), 'utf8'))
    const screen = stripComments(readFileSync(join(repo, 'src/ui/agreement.tsx'), 'utf8'))

    const unconditionalBlock = /method\s*!==\s*'GET'\)\s*return\s*'blocked-request'/.test(cdp)
    const permitGuardedBlock =
      /typeof permit !== 'object'\)\s*\{\s*return 'blocked-request'/.test(cdp)
    const unconditionalPromise = /ABSENT[^]{0,400}'Buy anything'/.test(screen)
    const conditionalPromise =
      /purchaseAuthorization === undefined[^]{0,120}'Buy anything/.test(screen)

    // The canary, both directions: each side must be FOUND before it is judged,
    // so a rename cannot make the couplings below pass vacuously.
    expect(
      permitGuardedBlock,
      'the permit-guarded refusal is gone from extension/src/cdp.js — either the transport ' +
        'regressed or this guard is reading nothing; read ADR-0024 before making this pass',
    ).toBe(true)
    expect(
      conditionalPromise,
      'the conditional “Buy anything” arm is gone from src/ui/agreement.tsx — the screen no ' +
        'longer tells the no-authorisation case the truth about money',
    ).toBe(true)

    expect(
      unconditionalBlock,
      'the unconditional non-GET refusal is back beside the permit-guarded one — two authors ' +
        'for one refusal is how they drift; there is one branch and ADR-0024 is its argument',
    ).toBe(false)
    expect(
      unconditionalPromise,
      'src/ui/agreement.tsx puts “Buy anything” back in the static ABSENT list — that sentence ' +
        'is false the moment an authorisation is ratified, on the screen where somebody decides ' +
        'whether to leave their desk',
    ).toBe(false)
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

describe('a streaming boundary never reaches the non-streaming call site', () => {
  /**
   * The guard for the defect that took the product's hands off.
   *
   * `beta.messages.parse()` does not support streaming. Handed `stream: true`
   * it pipes the returned Stream into the SDK's own parser, which maps over a
   * `content` array a Stream does not have, throws a TypeError, and — because
   * the client's catch cannot tell a local TypeError from a socket — reports it
   * as `transport`. `worker-action` is the only boundary that streams, so every
   * action proposal in the product failed while 1,709 tests stayed green:
   * `FakeModelClient` never touches the SDK, which is precisely what made a
   * suite that size compatible with a worker that could not act.
   *
   * This is a grep, and deliberately a crude one. The property it wants — "the
   * streaming request is not the `.parse()` request" — is a runtime fact that
   * only a live call can confirm, and there is a live test for it
   * (`tests/model-boundary.live.test.ts`). What a grep CAN do is refuse the
   * revert: the two call shapes have to stay two, and `stream: true` must not
   * appear in the one that cannot carry it.
   *
   * Comments are stripped first, for the same reason `execute-run.ts` is
   * stripped above — that file's header explains the trap at length and quotes
   * both call shapes, and a guard that failed on its own explanation would
   * leave deleting the explanation as the only way back to green.
   */
  const source = () =>
    readFileSync(join(repo, 'src/model/anthropic.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  /** The `messages.parse({ … })` argument, or null if the call site is gone. */
  const parseCall = () => {
    const text = source()
    const at = text.indexOf('messages.parse({')
    if (at === -1) return null

    // Balanced to the closing brace, so a later call cannot leak in.
    let depth = 0
    for (let i = text.indexOf('{', at); i < text.length; i += 1) {
      if (text[i] === '{') depth += 1
      else if (text[i] === '}') {
        depth -= 1
        if (depth === 0) return text.slice(at, i + 1)
      }
    }
    return text.slice(at)
  }

  it('still has both call sites, so this test is checking something', () => {
    // The canary, and the same one the tool regex above needed. If either call
    // is renamed away, every assertion below passes vacuously and the guard has
    // quietly stopped guarding.
    expect(source()).toContain('messages.parse({')
    expect(source()).toContain('messages.stream({')
  })

  it('never sends stream: true through messages.parse()', () => {
    const call = parseCall()
    expect(call).not.toBeNull()
    expect(call).not.toMatch(/stream:\s*(true|stream)\b/)

    // Pinned rather than merely absent: the argument says `stream: false` out
    // loud, so a revert has to be a visible edit and cannot be a deletion.
    expect(call).toMatch(/stream:\s*false\b/)
  })

  it('keeps output_format on the parse call and output_config on the stream call', () => {
    // The asymmetry the client's header explains, checked so it cannot be
    // tidied away by somebody who reads it as an oversight. `output_format` is
    // deprecated on the streaming endpoint (a 400) and is the ONLY field the
    // SDK's parser consults on the non-streaming one — so each call needs the
    // field the other rejects, and making them match breaks one of them.
    const call = parseCall()
    expect(call).toMatch(/output_format:/)
    expect(call).not.toMatch(/output_config:/)

    const text = source()
    const streamAt = text.indexOf('messages.stream({')
    const streamCall = text.slice(streamAt, text.indexOf('})', streamAt) + 2)
    expect(streamCall).toMatch(/output_config:\s*\{\s*format:/)
    expect(streamCall).not.toMatch(/output_format:/)
  })

  it('routes a boundary that declares stream to the streaming call', () => {
    // The branch itself. Flatten this ternary back to one call and the product
    // loses its hands again, with only a live run to say so.
    expect(source()).toMatch(/stream\s*\?\s*await this\.streamed\(/)
    expect(source()).toMatch(/:\s*await this\.parsed\(/)
  })

  it('classifies a complete non-JSON response as a shape failure, not transport', () => {
    // The other half of why this hid. A TypeError filed under `transport` is
    // the one classification nobody investigates, and `recoveryFor('transport')`
    // is `none` — so the repair turn ADR-0005 grants never fired either.
    const text = source()
    const decoder = text.slice(text.indexOf('function decodeStreamedOutput'))
    expect(decoder).toContain('JSON.parse')
    expect(decoder).not.toContain('transport')
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
