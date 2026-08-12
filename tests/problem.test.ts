/**
 * Does a failure say what went wrong?
 *
 * `actions.ts` promises "every failure carries a sentence written for the
 * person rather than for a log". It did not. Prisma leads with a banner and a
 * bundled path and puts the cause LAST, so truncating the first 240 characters
 * showed a file path and an ellipsis — everything except the reason.
 *
 * The message in `PRISMA_CREATE_FAILURE` is the real one, off the screen, in a
 * live debugging session. That is what these are written against.
 */

import { describe, it, expect } from 'vitest'
import { DETAIL_BUDGET, readableCause } from '../src/server/problem'

/** Verbatim shape of what reached the screen, cause restored. */
const PRISMA_CREATE_FAILURE = [
  'Invalid `(name)=>prisma.project.create()` invocation in',
  '/Users/sanjay/projects/ProjOTW/propositum/.next/dev/server/chunks/ssr/[root-of-the-server]__04sj91n._.js:1630:40',
  '  1627 }',
  '  1628 function projectRepository(prisma) {',
  '→ 1629   return {',
  'Unable to open the database file',
].join('\n')

describe('the reason survives, not the preamble', () => {
  it('keeps what actually went wrong', () => {
    expect(readableCause(PRISMA_CREATE_FAILURE)).toContain('Unable to open the database file')
  })

  it('drops the invocation banner', () => {
    expect(readableCause(PRISMA_CREATE_FAILURE)).not.toContain('invocation')
  })

  it('drops the bundled chunk path, which tells a person nothing', () => {
    const cause = readableCause(PRISMA_CREATE_FAILURE)

    expect(cause).not.toContain('.next/dev/server/chunks')
    expect(cause).not.toContain('__04sj91n')
  })

  it('drops the numbered source excerpt', () => {
    const cause = readableCause(PRISMA_CREATE_FAILURE)

    expect(cause).not.toContain('projectRepository')
    expect(cause).not.toContain('1629')
  })

  it('is short enough to render as a sentence', () => {
    expect(readableCause(PRISMA_CREATE_FAILURE).length).toBeLessThanOrEqual(DETAIL_BUDGET + 1)
  })

  it('would have failed under the old head-truncation', () => {
    // The regression, stated as the thing it is. Head-truncation spends the
    // whole budget before reaching the cause.
    const oldBehaviour = `${PRISMA_CREATE_FAILURE.slice(0, DETAIL_BUDGET)}…`

    expect(oldBehaviour).not.toContain('Unable to open the database file')
    expect(readableCause(PRISMA_CREATE_FAILURE)).toContain('Unable to open the database file')
  })
})

describe('it does not lose messages it cannot parse', () => {
  it('passes an ordinary one-line error through unchanged', () => {
    expect(readableCause('Unique constraint failed on the fields: (`name`)')).toBe(
      'Unique constraint failed on the fields: (`name`)',
    )
  })

  it('falls back to the whole message when every line looks like framing', () => {
    // Better a noisy sentence than an empty one — silence is the failure this
    // file exists to prevent.
    const allNoise = 'Invalid `prisma.x.create()` invocation in\n/a/b/c.js:1:2'

    expect(readableCause(allNoise).length).toBeGreaterThan(0)
  })

  it('keeps the TAIL when the cause is still too long', () => {
    const long = `${'x'.repeat(DETAIL_BUDGET * 2)} the actual reason`

    const cause = readableCause(long)
    expect(cause).toContain('the actual reason')
    expect(cause.startsWith('…')).toBe(true)
  })

  it('survives an empty message without throwing', () => {
    expect(readableCause('')).toBe('')
  })
})
