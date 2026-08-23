/**
 * The sentences both surfaces say, said the same way on both.
 *
 * Propositum has two interfaces built separately — the Next app and the MV3
 * side panel — and `extension/src/panel.html` is static markup with no module
 * graph reaching `src/`. So a sentence that must match on both cannot be
 * imported into one of them; it can only be duplicated, and duplication with
 * nothing watching it is how the two wordings drifted apart in the first place.
 *
 * This is the watcher. It is the same source-text guard
 * `tests/calendar-scope.test.ts` uses, for the same stated reason: the coupling
 * is real whether or not a test knows about it, so something has to go red when
 * it breaks.
 *
 * If this fails, the fix is to make the panel match `shared-copy.ts` — not to
 * relax the assertion. The whole value of the constant is that it is the one
 * place the wording is decided.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { NOTHING_RECORDED_YET } from '../src/ui/shared-copy'

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8')
}

describe('the retention promise is one sentence, not two', () => {
  it('is on the side panel exactly as it is in the app', () => {
    const panel = read('extension/src/panel.html')

    /* Whitespace is collapsed because HTML wraps and JSX does not, and a line
     * break is not a difference in what was promised. Everything else is
     * compared character for character. */
    const flattened = panel.replace(/\s+/g, ' ')

    expect(flattened).toContain(NOTHING_RECORDED_YET)
  })

  it('is on the front door through the constant rather than retyped', () => {
    const home = read('src/app/page.tsx')

    /* A second literal copy in `page.tsx` would pass the assertion above and
     * still be the bug: two strings that happen to agree today. The import is
     * what makes them one string. */
    expect(home).toContain('NOTHING_RECORDED_YET')
    expect(home).not.toContain('Nothing has been recorded. Propositum holds')
  })

  it('still says the three things it is there to say', () => {
    /* A rewrite is allowed. Quietly dropping one of the claims while rewriting
     * is what is not: that nothing is stored yet, that there is a limit, and
     * that the default outcome is deletion. */
    expect(NOTHING_RECORDED_YET).toContain('Nothing has been recorded')
    expect(NOTHING_RECORDED_YET).toMatch(/half an hour/)
    expect(NOTHING_RECORDED_YET).toMatch(/throws it away|thrown away/)
  })
})
