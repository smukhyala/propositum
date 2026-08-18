/**
 * One comment stripper, for every guard that greps the extension.
 *
 * ── Why this is a module and not two copies ──────────────────────────────
 *
 * It was two copies, and one of them was wrong. `tests/extension-permissions.
 * test.ts` shipped a regex version on 2026-08-17 that treated the code-level
 * string `'/*'` in `panel.html` as opening a block comment and deleted the
 * thirty-three executable lines that followed it. An injected
 * `chrome.tabs.query({})` inside that span passed all eleven assertions. The
 * regex was replaced there with the scanner below; `tests/extension-cdp.test.ts`
 * kept its copy.
 *
 * That second copy is not exposed today — measured, on 2026-08-18: no `.js`
 * file in `extension/src` currently loses a line to it. It is exposed the first
 * time somebody writes `'/*'` or `'//'` inside a string in `cdp.js` or
 * `service-worker.js`, and `service-worker.js` grew by a third the day before
 * this file was written. A guard whose correctness depends on nobody writing a
 * particular two characters is not a guard, and two strippers that must agree
 * are the same shape as the two tokenisers `topics.ts` refuses.
 *
 * ── What it can and cannot see ───────────────────────────────────────────
 *
 * It tracks string state (`'`, `"`, backtick, with backslash escapes) and HTML
 * comments, so a comment marker inside a string survives. It does NOT
 * distinguish a regex literal from division, so a regex containing an unpaired
 * quote would desynchronise it. No extension source contains one; `losesNoCode`
 * below is what says so if that changes.
 */

export function stripComments(source: string): string {
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
 * Lines of real code the stripper swallowed, if any.
 *
 * The independent check. It reimplements "is this line a comment" with a dumb
 * heuristic that shares no code with the scanner above, so the two have to
 * agree by both being right rather than by both being the same. A line with a
 * marker anywhere in it is skipped, because a trailing comment is legitimately
 * rewritten and this cannot tell that from a swallow — so a stripper that ate a
 * span in which EVERY line carried a trailing comment would still pass. Narrow,
 * and stated rather than discovered.
 */
export function losesNoCode(source: string): readonly string[] {
  const stripped = stripComments(source)
  const lost: string[] = []
  let inHtmlComment = false

  for (const line of source.split('\n')) {
    const text = line.trim()
    if (text.includes('<!--')) inHtmlComment = true
    const skip =
      inHtmlComment ||
      text === '' ||
      text.startsWith('*') ||
      text.startsWith('//') ||
      text.startsWith('/*') ||
      text.includes('//') ||
      text.includes('/*')
    if (text.includes('-->')) inHtmlComment = false
    if (skip) continue
    if (!stripped.includes(text)) lost.push(text)
  }

  return lost
}
