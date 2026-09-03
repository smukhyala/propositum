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
 * ── `tabGroups`, added 2026-08-17 (ADR-0013) ─────────────────────────────
 *
 * This block exists so that adding a permission is a deliberate act, and this
 * is the first time anything has had to walk through it. Read it as the record
 * of what was agreed to, because that is what the docblock is for.
 *
 * **What the permission GRANTS.** `chrome.tabGroups`: the metadata of a tab
 * group — `id`, `title`, `color`, `collapsed`, `windowId`. Chrome shows one
 * warning for it, *"View and manage your tab groups"*, and — unlike `tabs`,
 * `webNavigation`, `topSites` and `favicon` — that warning is **not absorbed**
 * by `host_permissions: ["https://*\/*"]`. So this one is shown at install, and
 * adding it in an update disables the extension pending re-approval. ~~It is the
 * only permission in the manifest that is not warning-free~~ — **corrected
 * 2026-08-17 against Chrome's
 * [permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list):
 * it is the THIRD.** `notifications` shows *"Display notifications."* and
 * `debugger` shows *"Access the page debugger backend."* alongside the
 * all-websites string. `alarms`, `idle`, `scripting`, `sidePanel` and `storage`
 * are the warning-free five. What is true of `tabGroups`, and is what the
 * decision rested on, is that it is the first string bought for a **capture
 * signal** rather than for a mechanism, and that it is not absorbed. The
 * manifest's opening sentence was struck the same day rather than quietly
 * edited.
 *
 * **What it does NOT grant, which is the whole reason it was affordable.** The
 * tabs inside a group. Chrome's reference is explicit: *"To group and ungroup
 * tabs, or to query what tabs are in groups, use the `chrome.tabs` API."* Every
 * assertion in this file forbidding `chrome.tabs.query`, `chrome.tabs.get`,
 * `chrome.history.`, `chrome.webNavigation.` and `chrome.debugger.getTargets`
 * is unchanged, and so is the block below refusing `tabs`, `webNavigation`,
 * `history`, `bookmarks`, `topSites` and `sessions` in the manifest. Reading a
 * group's title tells you nothing about a page you were not already watching.
 *
 * **The mechanism that keeps it narrow, which is code and not intent.** The
 * only group id the extension ever looks up arrives on `sender.tab.groupId` —
 * Chrome's own field, on a message sent by a content script the person granted
 * an origin for. `groupId` is not among the four sensitive `tabs.Tab`
 * properties the `tabs` permission gates, so no permission is needed to read
 * it, and a page cannot forge it. That id goes to `chrome.tabGroups.get` and
 * nothing else. The set of groups this extension can see is therefore the set
 * containing a page it was already observing.
 *
 * `chrome.tabGroups.query` — which would enumerate every group in every window,
 * including groups of tabs we have never seen — is granted by this permission
 * and is refused by us, which is the same behavioural-rather-than-structural
 * guarantee the `tabs.query` bullet at the top of this file is about. It is
 * asserted below, along with the `sender`-provenance rule, in the grep style
 * the rest of this file already uses and with the same honest limits: a
 * computed member access walks past it, and it is a defence against somebody
 * who does not know they should not.
 *
 * ~~**`tests/extension-cdp.test.ts` still uses the regex form, and is not
 * exposed today by luck rather than by design:** it searches `.js` only, and
 * no `.js` source in `extension/src` currently loses a line to it (checked, the
 * same way). The first `'/*'` or `'//'` written in a string in `cdp.js` or
 * `service-worker.js` re-opens it there. Correcting that file is owed and is
 * not this one.~~
 *
 * **Paid 2026-08-18.** There is one stripper now, in
 * `tests/support/strip-comments.ts`, and both guards import it — because two
 * that must agree are the same shape as the two tokenisers `topics.ts` refuses,
 * and one of them was already wrong. The debt was called in by measurement
 * rather than by a deadline: `service-worker.js` grew by a third the day
 * before, and the counterfactual was run rather than argued. Injecting
 * `const SWALLOW_CANARY = '/*'` followed by `chrome.debugger.getTargets()`
 * into `service-worker.js`, the regex form left the call **invisible** and the
 * CDP suite green; the shared scanner sees it and the suite fails. That call is
 * ADR-0010's central property, and the guard over it was one string literal
 * from blind.
 */

import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { losesNoCode, stripComments } from './support/strip-comments'

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

/**
 * Every file Chrome can execute a line of, not only the modules.
 *
 * `panel.html` carries an inline `<script>` and calls `chrome.tabs.create` from
 * it. A search restricted to `.js` would leave the side panel as the one place
 * in the extension where any of this could be written unobserved.
 */
const SOURCES = readdirSync(extensionDir)
  .filter((name) => name.endsWith('.js') || name.endsWith('.html'))
  .map((name) => {
    // `raw` is kept beside `code` because the per-line canary below has to
    // compare the two. Re-reading the file there would let the check drift onto
    // a different byte sequence than the one the greps actually search.
    const raw = readFileSync(join(extensionDir, name), 'utf8')
    return { name, raw, code: stripComments(raw) }
  })

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
     * A tail token was written first and does not work: the swallow that
     * shipped ran from `panel.html:177` to the next block-comment close at 233
     * and then resumed, so the file's tail survived and a tail assertion stayed
     * green over a hole in the middle.
     *
     * `losesNoCode` is the check, and it lives in `tests/support/` because
     * `tests/extension-cdp.test.ts` needs the identical one. Its heuristic is
     * deliberately dumber than the scanner and shares no code with it, so the
     * two agree by both being right rather than by being the same. What it
     * skips is stated where it is defined.
     */
    for (const { name, raw } of SOURCES) {
      expect(losesNoCode(raw), `${name}: the stripper swallowed code`).toEqual([])
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

/**
 * The narrowing that made `tabGroups` affordable, asserted rather than trusted.
 *
 * The permission grants the whole namespace. What keeps it to "the group of a
 * tab we were already watching" is two properties of our own code, and both are
 * one edit away from being lost:
 *
 *   1. `chrome.tabGroups.query` is never called. That call enumerates every
 *      group in every window — groups of tabs the extension has no host
 *      permission for and has never observed — and it is the single line that
 *      would turn this permission into the tab-adjacent enumeration
 *      `docs/SECURITY_AND_PRIVACY.md` says does not happen.
 *   2. The only id handed to `chrome.tabGroups.get` comes from `sender.tab`.
 *      A number from anywhere else — a loop, a stored value, a message body —
 *      is a group we were not led to by a page we are already watching.
 *
 * The second is checked structurally rather than by taste: the extension may
 * contain exactly one `chrome.tabGroups.` call site, it must be `.get(`, and
 * the function containing it must read the id off `sender`. That is a coarse
 * check and it is coarse on purpose — the same trade the rest of this file
 * makes, and with the same stated hole: computed member access walks past it.
 */
describe('tabGroups is only ever reached through a tab that messaged us', () => {
  const worker = SOURCES.find(({ name }) => name === 'service-worker.js')?.code ?? ''

  it('never enumerates tab groups', () => {
    // Not on the FORBIDDEN list above, deliberately: that list is about calls
    // Chrome would refuse or that read other people's tabs. This one Chrome
    // WOULD allow, now that the permission is held, which is precisely why it
    // needs its own assertion and its own sentence.
    // `\??\.` so that `chrome.tabGroups?.query(…)` — the shape the availability
    // check in `groupTitleOf` already uses for `get` — cannot walk past it.
    const offenders = SOURCES.filter(({ code }) =>
      /chrome\.tabGroups\??\.query\s*\(/.test(code),
    ).map(({ name }) => name)

    expect(
      offenders,
      'chrome.tabGroups.query appears in ' +
        offenders.join(', ') +
        ' — that returns every group in every window, including groups of tabs this extension has never observed. The permission allows it; ADR-0013 does not.',
    ).toEqual([])
  })

  it('touches exactly one member of chrome.tabGroups, and it is get()', () => {
    // Members, not call sites: `groupTitleOf` names `get` twice — once to check
    // the API exists on an older Chrome, once to call it — and counting sites
    // would make this assertion a fact about that style rather than about the
    // capability. Optional chaining is tolerated for the same reason it is in
    // the query check above.
    const members = [...ALL_CODE.matchAll(/chrome\.tabGroups\??\.(\w+)/g)].map((m) => m[1])

    // Non-vacuous. If the lookup is deleted this goes red rather than green,
    // which is the failure mode the canaries at the top of this file exist for.
    expect(
      members,
      'nothing reads a tab group any more — either ADR-0013 was reverted, or this guard is now searching for nothing',
    ).not.toEqual([])
    expect(
      [...new Set(members)],
      'chrome.tabGroups is used for something other than get() — every other member either enumerates every group in every window, or mutates one',
    ).toEqual(['get'])
  })

  it('reads the group id off sender, and off nothing else', () => {
    /**
     * The provenance rule, checked over the function that makes the call.
     *
     * `groupTitleOf` is sliced out of the worker source and required to (a)
     * contain the call and (b) derive its id from `sender`. Slicing rather than
     * searching the whole file matters: `sender.tab` appears elsewhere in this
     * worker for the indicator check, so a whole-file grep would stay green for
     * a lookup that took its id from a message body.
     */
    const from = worker.indexOf('function groupTitleOf')
    expect(from, 'groupTitleOf is gone — the sender-provenance rule has nothing to be about').toBeGreaterThan(-1)

    // To the next top-level declaration, which is enough of a function body for
    // a grep and does not need a parser to be honest about.
    const rest = worker.slice(from + 1)
    const next = rest.search(/\n(async function|function|const|chrome\.)/)
    const body = next === -1 ? rest : rest.slice(0, next)

    expect(body, 'groupTitleOf no longer looks a group up — this guard is vacuous').toContain(
      'chrome.tabGroups.get(',
    )
    expect(
      body,
      'groupTitleOf takes its group id from something other than sender.tab — that is a group Propositum was not led to by a page it was already watching',
    ).toMatch(/sender[?.]+tab[?.]+groupId/)
  })
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
    'tabGroups',
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

describe('the extension id is pinned', () => {
  /**
   * Until 2026-09-03 the manifest held no `key` and a comment saying to add one
   * before any real install. So the id was whatever Chrome minted from the
   * folder path, and moving the clone re-minted it. Pinning is a one-way door:
   * the id is derived from the public key, and `PROPOSITUM_EXTENSION_ID`, the
   * loopback `Origin` check and every existing pairing follow it — a
   * regenerated key orphans all of them. That is why the id is written here as
   * a literal rather than read back from the manifest: a change to the key
   * goes red, and turning it green means somebody typed the new id into this
   * file on purpose, where a reviewer can see it.
   *
   * The derivation is Chrome's: SHA-256 over the DER-encoded public key, the
   * first 128 bits, each hex digit mapped to `a`–`p`. Recomputing it here is
   * what keeps the id in `manifest.json`'s own comment and the id in
   * `extension/README.md` from being two numbers maintained by hand.
   *
   * What this does not cover: whether the Chrome Web Store keeps this id on
   * first upload. That is the store's behaviour, `extension/README.md` records
   * what the documentation does and does not say about it, and no test here
   * can reach it. Nor does it prove the private half exists anywhere — the
   * `.pem` is the owner's, outside the repository, and only packing a `.crx`
   * would notice it missing.
   */
  const PINNED_ID = 'oeeehaokemppjoedlccgggmhlmhcdeln'

  const withKey = manifest as { key?: string; _comment_key?: string[] }

  it('holds a key, so the id no longer depends on where the clone lives', () => {
    expect(typeof withKey.key, 'manifest.json has no "key" — the id is unpinned again').toBe('string')
  })

  it('derives the recorded id from that key', () => {
    const der = Buffer.from(withKey.key ?? '', 'base64')
    const hex = createHash('sha256').update(der).digest('hex').slice(0, 32)
    const derived = [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join('')
    expect(
      derived,
      'the key changed — that mints a new id and orphans every install; if that is intended, change the literal here in the same diff',
    ).toBe(PINNED_ID)
  })

  it('says the same id in its own comment', () => {
    expect((withKey._comment_key ?? []).join(' ')).toContain(PINNED_ID)
  })
})
