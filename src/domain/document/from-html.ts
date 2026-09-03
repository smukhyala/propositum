/**
 * HTML to readable text, without a browser.
 *
 * ── Why this exists at all ───────────────────────────────────────────────
 *
 * ADR-0032 §5 refuses a browser in the app process: the process holding the
 * person's database and their API key does not execute a host's JavaScript for
 * the sake of a nicer import. So the page import fetches bytes and this turns
 * them into words.
 *
 * ── What it is honestly worth ────────────────────────────────────────────
 *
 * Considerably less than `innerText` on a live document, and the gap is the
 * cost ADR-0032 §5 states out loud. This does not build a DOM, does not resolve
 * entities beyond a handful, does not know which part of a page is the article,
 * and cannot see anything a script would have written. A client-rendered page
 * comes through as a near-empty shell.
 *
 * That is acceptable HERE and nowhere else, because the result goes to a person
 * looking at a screen before anything is stored. On the worker's path — where a
 * shell would be reported to a model as the page's content — the same shortcut
 * would be the quiet lie `src/policy/playwright-fetcher.ts` refuses to tell.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * **It does not sanitise, and it does not decide what is safe.** Hidden text,
 * white-on-white text, an `aria-label` holding an injected document — all of it
 * survives, exactly as it survives the worker's extraction, and for the same
 * reason: hiding text from a human while leaving it legible to a model is what
 * an attack does, so the text is wanted rather than filtered. `datamark()` is
 * the door that sanitises, one layer up.
 *
 * **It is not an HTML parser and must not become one.** A parser rich enough to
 * be clever is rich enough to be wrong, and nothing downstream treats this
 * output as structured — it is prose in a textarea that a person edits.
 */

/** Elements whose contents are not prose. Dropped whole, including their text. */
const NOT_PROSE = /<(script|style|noscript|template|svg|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi

/** Elements that end a line when they open or close. */
const BLOCK =
  /<\/?(p|div|section|article|main|header|footer|nav|aside|h[1-6]|li|ul|ol|tr|td|th|table|blockquote|pre|figure|figcaption|dl|dt|dd|form|hr|br)\b[^>]*>/gi

/**
 * The entities worth naming, and no more.
 *
 * Five, chosen because they are the ones that appear in ordinary prose and read
 * as damage when they survive. A full table would be a lookup nobody reviews;
 * anything absent from this list arrives as its literal `&name;`, which is
 * visibly wrong to the person reading it rather than silently wrong.
 *
 * Numeric references are decoded for the same reason — `&#8217;` in the middle
 * of a word is the single commonest one — and only in the ranges that cannot
 * produce a control character, because a decoder able to mint one out of
 * `&#1;` would be handing `datamark()` work it should never have been given.
 */
const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d{1,7});/g, (whole, digits: string) => codePoint(whole, Number(digits)))
    .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (whole, hex: string) => codePoint(whole, parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole)
}

/** A code point, or the reference left as it was. Anything below U+0020 and the
 *  surrogate range are refused here rather than removed later, so this function
 *  cannot be the thing that introduces a control character. */
function codePoint(whole: string, value: number): string {
  if (!Number.isFinite(value)) return whole
  if (value < 0x20 || (value >= 0xd800 && value <= 0xdfff) || value > 0x10ffff) return whole
  return String.fromCodePoint(value)
}

/**
 * The readable text of an HTML document, as prose with blank lines between
 * blocks.
 *
 * Passing something that is not HTML is fine and is the ordinary case for a
 * `.md` or `.txt` response: there are no tags to remove, so the text comes back
 * as it went in apart from entity decoding and whitespace collapsing.
 */
export function readableText(html: string): string {
  const stripped = html
    .replace(NOT_PROSE, '\n')
    // An unclosed <script> or <style> — a truncated response, or a page that
    // never closes one — would otherwise leak its source as prose.
    //
    // `head` is deliberately NOT in this list even though it is in the one
    // above. Browsers close it implicitly and plenty of pages never write the
    // tag, so treating an unclosed one as "everything after this is not prose"
    // would silently return an empty document for a page that renders fine.
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*$/i, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(BLOCK, '\n')
    .replace(/<[^>]*>/g, '')

  return decodeEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The title a page declares, or nothing.
 *
 * Page-authored and unverified, exactly as ADR-0006 §3 says a title is — it is
 * shown to the person as *what the page called itself* and is never treated as
 * a fact about the page. It is not used to name anything.
 */
export function declaredTitle(html: string): string {
  const found = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  if (!found?.[1]) return ''
  return decodeEntities(found[1].replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
}
