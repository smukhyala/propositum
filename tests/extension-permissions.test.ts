/**
 * The promise that used to be Chrome's.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 *
 * `docs/SECURITY_AND_PRIVACY.md` told people, until 2026-08-17, that there was
 * *"no call it can make that returns a tab it did not create itself"* and that
 * the promise was *"still enforced by the browser rather than by our code."*
 * The second sentence was false, and had been since 2026-08-11.
 *
 * `chrome.tabs.query()` requires no permission to call. Chrome's reference is
 * explicit that the `tabs` permission *"does not give access to the
 * `chrome.tabs` namespace"* — it only unscrubs four sensitive properties on the
 * returned `Tab` objects — and that *"host permissions allow an extension to
 * read and query a matching tab's four sensitive `tabs.Tab` properties."*
 * ADR-0008 took `host_permissions: ["https://*\/*"]`. So one line in
 * `service-worker.js` would return the URL and title of every open `https` tab,
 * in every window, today.
 *
 * No line does. That is discipline, and discipline is what this file is. The
 * guarantee moved from structural to behavioural the day the host permissions
 * widened, and **a test is weaker than a refusal** — the same trade ADR-0010
 * named when it said a pause is strictly weaker than an absence. What stands
 * where Chrome used to is below.
 *
 * ── What a grep can see here, and what it cannot ─────────────────────────
 *
 * A grep is a real guard over this component and a poor one over most. The
 * property that makes it real is `extension/`'s, not this file's: the extension
 * has **no build step**, deliberately (ADR-0002), so the text searched below is
 * byte-for-byte the text Chrome runs. There is no bundler, no transpile, no
 * minifier and no dependency that could introduce a call the source does not
 * contain. `tests/extension-cdp.test.ts` rests on the same property and says so
 * at greater length.
 *
 * **What it therefore cannot see, stated so nobody reads more into a green
 * suite than is in it:**
 *
 *  - **Computed member access.** `chrome['tabs']['query']({})`, or a name
 *    assembled from pieces, passes every assertion here. Nothing in this file
 *    is a defence against somebody who wants to get round it; it is a defence
 *    against somebody who does not know they should not.
 *  - **Anything outside `extension/src`.** The app, the worker and any future
 *    native helper are not searched, because none of them can call `chrome.*`.
 *    A desktop process could learn the same facts by other means and nothing
 *    here would notice — that is the conflict the 2026-08-17 meeting notes
 *    raise about a background app, and it is not settled by a grep.
 *  - **Whether the person granted the permissions.** Chrome's own site-access
 *    controls can narrow `https://*\/*` to on-click at any time. The manifest
 *    says what is asked for, not what is held.
 *  - **Intent.** A permission absent from the manifest is a capability the
 *    browser refuses. A call absent from the source is only a call nobody has
 *    written yet. The two halves below are not the same strength and this file
 *    does not present them as though they were.
 *
 * ── How this file stops guarding, and what stops that ────────────────────
 *
 * The two failure modes are `tests/extension-cdp.test.ts`'s, found the hard way
 * in this repo, and defended the same way:
 *
 *  1. **A comment satisfies it.** Comments are stripped before any search, so
 *     the paragraphs in `manifest.json` and `cdp.js` that explain at length why
 *     `tabs` is absent cannot themselves read as the violation — and, more
 *     importantly, cannot keep a forbidden-call assertion green after the real
 *     call is deleted.
 *  2. **It stops matching anything.** A guard that searches files that no
 *     longer exist passes forever. So there are four canaries: the file list
 *     must still contain the files this is written about, the `chrome.tabs`
 *     calls the extension is SUPPOSED to make must still be found, and — both
 *     added 2026-08-17, because this file was found the hard way too — **no
 *     file may lose a line of code to the stripper**, and **the stripper itself
 *     is unit-tested against the shapes that broke it.**
 *
 * ── The third canary, and the hole it closes ─────────────────────────────
 *
 * *(Added 2026-08-17. This file shipped on 2026-08-17 with the defect below and
 * it was caught in review the same day, before anything rested on it.)*
 *
 * The first version stripped comments with two regular expressions, and the
 * block-comment one — `/\/\*[\s\S]*?\*\//g` — cannot tell a comment from the
 * two characters `/*` **inside a string literal**. `panel.html:177` is
 * `return origin.endsWith('/*') ? origin : ${origin}/*`, real code, and the
 * regex read that apostrophe-slash-star as an opening delimiter and deleted
 * everything up to the next `*​/` it found: **lines 177–233, thirty-three of
 * them executable**. A `chrome.tabs.query()` written anywhere in that span
 * passed all eleven assertions green — verified by injecting exactly that call
 * at line 200 and watching the suite pass, and by injecting it at line 170,
 * before the swallow, and watching it fail.
 *
 * That is the worst possible shape for this particular file: `panel.html` is
 * the reason `.html` is searched at all, the docblock above `SOURCES` says so,
 * and `docs/SECURITY_AND_PRIVACY.md` names this test as what now holds the
 * tab-list promise Chrome stopped holding.
 *
 * Two things changed, and the second matters more than the first:
 *
 *  - **The stripper is a scanner rather than a regex.** It walks the source
 *    once, and a quote opens a string that a `/*` cannot escape from. String
 *    and template bodies are kept, deliberately: a call is not written inside
 *    one, and keeping them is what makes the tail tokens below assertable.
 *  - **Non-vacuity is asserted per FILE and per LINE, not per directory.** The
 *    existing canaries prove the *directory* still contains code and the
 *    *extension* as a whole still calls `chrome.tabs.create`. Neither noticed a
 *    third of one file going missing, because the surviving two thirds
 *    satisfied both. So a second, dumber reader now walks each file and
 *    requires every code-shaped line to survive the strip.
 *
 * A better stripper without those canaries would have fixed this bug and left
 * the class of bug live. The canaries are the part that generalises.
 *
 * **`tests/extension-cdp.test.ts` still uses the regex form, and is not
 * exposed today by luck rather than by design:** it searches `.js` only, and
 * no `.js` source in `extension/src` currently loses a line to it (checked, the
 * same way). The first `'/*'` or `'//'` written in a string in `cdp.js` or
 * `service-worker.js` re-opens it there. Correcting that file is owed and is
 * not this one — the same form of debt ADR-0008 records about the manifest
 * comment.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = join(repo, 'extension', 'src')

/**
 * Comments out, code in — including the code that contains the characters a
 * comment starts with.
 *
 * Same reason as `tests/extension-cdp.test.ts`'s stripper and no longer the
 * same implementation, because the regex form is wrong on `panel.html` and the
 * header above says how. This is a single left-to-right scan with four states,
 * which is the least machinery that gets the answer right:
 *
 *  - `/* … *​/`, `// …` — dropped. A comment must not be able to satisfy a
 *    forbidden-call assertion, and must not be able to keep one green after the
 *    real call is deleted.
 *  - `<!-- … -->` — dropped, because `panel.html` has three of them and one
 *    contains the word *Chrome's*. An apostrophe in prose would otherwise open
 *    a string that swallows the rest of the script.
 *  - `'…'`, `"…"`, `` `…` `` — **kept**, verbatim, and only entered so that a
 *    `/*`, a `//` or an apostrophe inside one cannot be mistaken for a
 *    delimiter. Backslash escapes are consumed in pairs.
 *
 * What it still does not do, said plainly: it does not know a regular
 * expression from a division, so a regex literal containing an unpaired quote
 * would confuse it. No extension source has one — and if one arrives, the
 * per-file tail assertion below is what says so.
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0

  while (i < source.length) {
    const here = source[i]!
    const next = source[i + 1]

    if (here === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      out += ' '
      i = end === -1 ? source.length : end + 2
      continue
    }

    if (here === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2)
      i = end === -1 ? source.length : end
      continue
    }

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4)
      out += ' '
      i = end === -1 ? source.length : end + 3
      continue
    }

    if (here === '"' || here === "'" || here === '`') {
      out += here
      i += 1
      while (i < source.length) {
        const inside = source[i]!
        if (inside === '\\') {
          out += source.slice(i, i + 2)
          i += 2
          continue
        }
        out += inside
        i += 1
        if (inside === here) break
      }
      continue
    }

    out += here
    i += 1
  }

  return out
}

/**
 * Every file Chrome can execute a line of, not only the modules.
 *
 * `panel.html` carries an inline `<script>` and calls `chrome.tabs.create` from
 * it. A search restricted to `.js` would leave the side panel as the one place
 * in the extension where any of this could be written unobserved.
 */
const SOURCES = readdirSync(extensionDir)
  .filter((name) => name.endsWith('.js') || name.endsWith('.html'))
  .map((name) => ({ name, code: stripComments(readFileSync(join(extensionDir, name), 'utf8')) }))

const ALL_CODE = SOURCES.map(({ code }) => code).join('\n')

const manifest = JSON.parse(readFileSync(join(repo, 'extension/manifest.json'), 'utf8')) as {
  permissions?: string[]
  optional_permissions?: string[]
  host_permissions?: string[]
  optional_host_permissions?: string[]
}

describe('the stripper keeps code and drops comments', () => {
  /**
   * The stripper under test, tested — because everything below it is only as
   * true as it is.
   *
   * Each case is a shape that either broke the regex form this replaced or is
   * one line away from breaking it. Read as a pair: the FIRST expectation in
   * each is that a call written after the awkward construct is still visible,
   * which is the property the whole file rests on.
   */
  const CALL = 'chrome.tabs.query({})'

  /**
   * The trailing comment is not decoration.
   *
   * A stray `/*` only eats anything if there is a later `*​/` for it to stop at,
   * and in a real file there always is — the next docblock. A fixture without
   * one passes under the broken stripper too, which is how a test for this can
   * be written and prove nothing.
   */
  const LATER_COMMENT = '/** an ordinary docblock, further down the file */'

  it('keeps a call written after a string containing /*', () => {
    // `panel.html:177` exactly. This is the case that shipped green.
    const source = `const pattern = origin.endsWith('/*') ? origin : origin + '/*'\n${CALL}\n${LATER_COMMENT}\n`

    expect(stripComments(source)).toContain(CALL)
  })

  it('keeps a call written after a template literal containing /*', () => {
    const source = `const pattern = \`\${origin}/*\`\n${CALL}\n${LATER_COMMENT}\n`

    expect(stripComments(source)).toContain(CALL)
  })

  it('keeps a call written after a string containing //', () => {
    // On one line on purpose: a line comment stops at the newline, so this is
    // only observable when the call shares the line with the string.
    const source = `const separator = 'a // b'; ${CALL}\n`

    expect(stripComments(source)).toContain(CALL)
  })

  it('keeps a call written after an HTML comment containing an apostrophe', () => {
    // `panel.html:38-46` — "Chrome's own attachment bar…". Without the HTML
    // comment rule the apostrophe opens a string that runs to the next one.
    const source = `<!-- Chrome's own bar is unsuppressible -->\n<script>\n${CALL}\n</script>\n`

    expect(stripComments(source)).toContain(CALL)
  })

  it('still drops a call written inside a block comment', () => {
    expect(stripComments(`/* once did ${CALL} */\nconst x = 1\n`)).not.toContain(CALL)
  })

  it('still drops a call written inside a line comment', () => {
    expect(stripComments(`// never ${CALL}\nconst x = 1\n`)).not.toContain(CALL)
  })

  it('still drops a call written inside an HTML comment', () => {
    expect(stripComments(`<!-- never ${CALL} -->\n<script></script>\n`)).not.toContain(CALL)
  })

  it('does not let an escaped quote end a string early', () => {
    const source = `const s = 'it\\'s /* not a comment */ fine'\n${CALL}\n`

    expect(stripComments(source)).toContain(CALL)
  })
})

describe('the files this guard is written about are still here', () => {
  it('finds the extension source it claims to search', () => {
    // Without this, renaming or moving `extension/src` makes every assertion
    // below pass over an empty string, which reads as proof and is its opposite.
    const names = SOURCES.map(({ name }) => name)

    expect(names, 'extension/src/service-worker.js is gone — this guard now greps nothing').toContain(
      'service-worker.js',
    )
    expect(names, 'extension/src/content.js is gone — the capture path is unguarded').toContain(
      'content.js',
    )
    expect(names, 'extension/src/panel.html is gone — the inline script is unguarded').toContain(
      'panel.html',
    )
    expect(names.length).toBeGreaterThan(3)
  })

  it('does not lose a line of code to the stripper, in any file', () => {
    /**
     * The canary the `panel.html` swallow needed, and the only one of the four
     * that is per-file and per-line.
     *
     * ── Why a tail token was not enough ──────────────────────────────────
     *
     * The obvious version of this — pin a token from each file's last few
     * lines — was written first and it does not work here. The swallow that
     * shipped ran from `panel.html:177` to the next `*​/`, at line 233, and then
     * the regex resumed: the file's tail survived intact and a tail assertion
     * stayed green over a hole in the middle. A tail token only catches a
     * swallow that runs to end-of-file.
     *
     * ── What this asserts instead ────────────────────────────────────────
     *
     * `stripComments` may only ever DELETE, so every line that looked like code
     * before it ran must still be findable after. The check below reads the
     * original with a deliberately stupid, independent heuristic — a line is
     * comment-shaped if it is blank, opens or continues a `/*`-block, starts
     * `//`, or falls inside an HTML comment — and requires every other line to
     * survive the strip verbatim. It is not the lexer checking itself: it is a
     * second, dumber reader disagreeing loudly when the first one eats
     * something.
     *
     * Under the regex stripper this file shipped with, it fails on 32 lines of
     * `panel.html`. Under the scanner it is clean across all seven sources.
     *
     * **What it skips, and why that is a real gap rather than a rounded one.**
     * Lines containing `//` or `/*` anywhere are excluded, because a trailing
     * comment is legitimately rewritten and this check cannot tell that from a
     * swallow. So a stripper that ate a span where every single line carried a
     * trailing comment would still pass. That is narrow, and it is the price of
     * a cross-check that needs no second parser.
     */
    const COMMENT_SHAPED = /^(\*|\/\/|\/\*|<!--|-->|$)/

    /** Line numbers inside `<!-- … -->`, found by regex rather than by the
     *  scanner under test — HTML comments do not nest, so this is safe, and it
     *  has to be independent of `stripComments` to be worth anything. */
    const htmlCommentLines = (source: string): ReadonlySet<number> => {
      const inside = new Set<number>()
      for (const match of source.matchAll(/<!--[\s\S]*?-->/g)) {
        const from = source.slice(0, match.index).split('\n').length
        for (let line = from; line < from + match[0].split('\n').length; line += 1) {
          inside.add(line)
        }
      }
      return inside
    }

    for (const { name } of SOURCES) {
      const source = readFileSync(join(extensionDir, name), 'utf8')
      const stripped = stripComments(source)
      const html = htmlCommentLines(source)
      const lost: number[] = []

      source.split('\n').forEach((line, index) => {
        const text = line.trim()
        if (html.has(index + 1)) return
        if (COMMENT_SHAPED.test(text)) return
        if (text.includes('//') || text.includes('/*')) return
        if (stripped.includes(text)) return
        lost.push(index + 1)
      })

      expect(
        lost,
        `stripComments ate code in ${name} at line(s) ${lost.join(', ')} — every assertion in this file is now running over a hole, and a forbidden call written there would pass`,
      ).toEqual([])
    }
  })

  it('still makes the chrome.tabs calls it is supposed to make', () => {
    /**
     * The half of the canary that bites. A file that forbids only is satisfied
     * by an empty one, and the forbidden list below is all `chrome.tabs.*`
     * members — so if the extension stopped touching `chrome.tabs` at all, every
     * assertion here would go quietly, permanently green.
     *
     * These three are the whole of the extension's legitimate tab surface, and
     * each is a tab it created or a tab it is already driving: `create` is the
     * ONLY source of a tab id in this extension (`cdp.js` says so where it is
     * called), `remove` closes one it opened, and `sendMessage` speaks to the
     * content script in one it is controlling.
     */
    for (const expected of ['chrome.tabs.create', 'chrome.tabs.remove', 'chrome.tabs.sendMessage']) {
      expect(
        ALL_CODE,
        `${expected} is gone — either the extension moved or this guard is now searching for nothing`,
      ).toContain(expected)
    }
  })
})

describe('no call that would return a tab Propositum did not open', () => {
  /**
   * Each entry is a door and the note is what walking through it costs.
   *
   * `chrome.tabs.query` is first because it is the only one on this list that
   * **works today**. The rest are namespaces Chrome gates behind a permission
   * the manifest does not hold, so writing one would be dead code rather than a
   * leak — they are here because dead code is how a permission gets added later
   * to "make the existing call work", which is the edit nobody reviews.
   */
  const FORBIDDEN: ReadonlyArray<readonly [pattern: RegExp, needle: string, why: string]> = [
    [
      /chrome\.tabs\.query\s*\(/,
      'chrome.tabs.query(',
      'it needs no permission, and under host_permissions ["https://*/*"] it returns the URL and title of EVERY open https tab — the exact thing docs/SECURITY_AND_PRIVACY.md promises does not happen',
    ],
    [
      /chrome\.tabs\.get\s*\(/,
      'chrome.tabs.get(',
      'the same four sensitive properties, one tab at a time, for a tab id that came from somewhere other than chrome.tabs.create',
    ],
    [
      /chrome\.history\./,
      'chrome.history.',
      'everything the person visited before the process started, plus typedCount and visitCount — the one permission on this list whose warning Chrome does NOT absorb, and the one consumers recognise',
    ],
    [
      /chrome\.webNavigation\./,
      'chrome.webNavigation.',
      'transitionType on every navigation in every tab; ADR-0008 records why the exclusion now stands on capability rather than on the warning it used to cost',
    ],
    [
      /chrome\.debugger\.getTargets\s*\(/,
      'chrome.debugger.getTargets(',
      'enumeration hands back every open tab through the permission ADR-0010 did grant — guarded here as well as in tests/extension-cdp.test.ts, deliberately, because that file guards it as a CDP decision and this one guards it as the tab-list promise',
    ],
  ]

  for (const [pattern, needle, why] of FORBIDDEN) {
    it(`never calls ${needle}`, () => {
      const offenders = SOURCES.filter(({ code }) => pattern.test(code)).map(({ name }) => name)

      expect(offenders, `${needle} appears in ${offenders.join(', ')} — ${why}`).toEqual([])
    })
  }
})

describe('the manifest asks for exactly what it asks for', () => {
  /**
   * Pinned as a SET rather than as a list of absences, and that is the point of
   * this block.
   *
   * An absence test answers "is `tabs` here?" and says nothing about the next
   * permission somebody adds. Chrome will not stop them: under `https://*\/*` the
   * install warnings for `tabs`, `webNavigation`, `topSites` and `favicon` are
   * absorbed into the prompt the person already accepted, and Chrome decides
   * whether an update is a privilege increase by comparing rendered MESSAGES
   * rather than permission ids — so an absorbed permission can be added in an
   * update without the extension being disabled pending re-approval, and without
   * the person being asked anything at all.
   *
   * A capability that can be taken without anybody being asked again is exactly
   * the one that needs a deliberate act somewhere. This is that act: adding a
   * permission turns this red, and turning it green means editing the list below
   * in the same diff, where a reviewer can see it.
   */
  const EXPECTED_PERMISSIONS = [
    'alarms',
    'debugger',
    'idle',
    'notifications',
    'scripting',
    'sidePanel',
    'storage',
  ]

  it('holds exactly the expected permission set, so adding one is a deliberate act', () => {
    expect(
      [...(manifest.permissions ?? [])].sort(),
      'the manifest permission list changed — if that is intended, change it here too, in this diff',
    ).toEqual(EXPECTED_PERMISSIONS)
  })

  it('does not ask for any permission that reads the person’s other browsing', () => {
    /**
     * Redundant against the set assertion above, and kept anyway: the set says
     * *what changed*, this says *why it matters*, and a failure message naming
     * the permission is worth more at three in the afternoon than a diff of two
     * sorted arrays.
     */
    for (const forbidden of [
      'tabs',
      'webNavigation',
      'history',
      'bookmarks',
      'topSites',
      'sessions',
    ]) {
      expect(
        manifest.permissions ?? [],
        `the manifest now requests "${forbidden}"`,
      ).not.toContain(forbidden)
    }
  })

  it('does not park one in optional_permissions either', () => {
    /**
     * `chrome.permissions.request()` can take any of them at runtime, and of the
     * permissions relevant here only `debugger` carries Chromium's
     * `kFlagCannotBeOptional`. So an optional list is a full-strength grant with
     * a later start date, and a set assertion over `permissions` alone would
     * step straight over it.
     */
    expect(
      manifest.optional_permissions ?? [],
      'optional_permissions exists — a runtime grant is still a grant',
    ).toEqual([])
  })

  it('pins the host permissions this promise is measured against', () => {
    /**
     * Not a constraint on the hosts — ADR-0008 took `https://*\/*` deliberately
     * and this file does not relitigate it. It is the PREMISE: the tab-list
     * promise is behavioural rather than structural *because* this string is
     * here, and `tabs.query` unscrubs URLs and titles under it. If it ever
     * narrows back, the guarantee changes shape and the amended bullet in
     * `docs/SECURITY_AND_PRIVACY.md` needs re-reading rather than inheriting.
     */
    expect([...(manifest.host_permissions ?? [])].sort()).toEqual([
      'http://127.0.0.1/*',
      'https://*/*',
    ])
  })
})
