/**
 * Turning an unexpected throw into a sentence a person can act on.
 *
 * ── Why this is its own file ─────────────────────────────────────────────
 *
 * `actions.ts` is `'use server'`, where every export must be an async function.
 * A pure string helper cannot live there and still be testable, and this one
 * has to be tested: it was wrong for the whole build, and the way it was wrong
 * made a real failure unreadable.
 *
 * ── What went wrong, so it is not reintroduced ───────────────────────────
 *
 * Prisma leads with a banner — `Invalid \`prisma.project.create()\` invocation`,
 * then an absolute path into a bundled chunk, then a numbered source excerpt —
 * and puts the ACTUAL cause last. The old version truncated the first 240
 * characters, which spent the entire budget on the banner and cut the reason
 * off completely. What reached the screen was a file path and an ellipsis.
 *
 * That is the exact opposite of what `actions.ts` exists for: "every failure
 * carries a sentence written for the person rather than for a log."
 */

/** Long enough to carry a real cause, short enough not to be a stack trace. */
export const DETAIL_BUDGET = 240

/**
 * Lines that are framing rather than reason.
 *
 * Each pattern is written against a line that has already been trimmed, which
 * is where the first attempt went wrong: the path arrives as a bare
 * `/Users/…/chunk.js:1630:40` because its `in` sits on the previous line, and
 * the source excerpt arrives as `→ 1629   return {` rather than starting with
 * a digit. Both slipped through and put a bundled path on the screen.
 */
function isNoise(line: string): boolean {
  return (
    // The banner naming the call that failed, with or without a trailing `in`.
    /^Invalid\s+[`'"]?.*invocation/i.test(line) ||
    // The file location, which may or may not still carry its `in` prefix.
    /^(in\s+)?\/.*:\d+:\d+\s*$/.test(line) ||
    // Prisma's numbered source excerpt — `1628 function x() {` and the arrowed
    // `→ 1629   return {` that marks the offending line.
    /^→?\s*\d+\s/.test(line) ||
    // Caret/pipe rulers under an excerpt.
    /^[→\s]*[|^`]/.test(line)
  )
}

/**
 * The reason, not the preamble.
 *
 * Drops the framing, and if what is left still does not fit, keeps the **tail**
 * — the last line of a database error is the one that says what went wrong.
 * Falls back to the whole message rather than returning nothing, because a
 * message we failed to parse is still better than silence.
 */
export function readableCause(raw: string): string {
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const meaningful = lines.filter((line) => !isNoise(line))
  const cause = (meaningful.length > 0 ? meaningful : lines).join(' ')

  if (cause.length <= DETAIL_BUDGET) return cause
  return `…${cause.slice(cause.length - DETAIL_BUDGET)}`
}
