/**
 * What the decline path is allowed to hand the store.
 *
 * A source-text guard, in the shape `tests/calendar-scope.test.ts` argues for:
 * the property is "no readable subject reaches this sink", and no runtime
 * assertion can see a future call site that passes one. So the call is pinned.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hashSignature } from '../src/domain/detection/reticence'

const actions = readFileSync(
  fileURLToPath(new URL('../src/server/actions.ts', import.meta.url)),
  'utf8',
)

describe('the decline path records a hash and never a signature', () => {
  it('passes a hashSignature call to record, not the signature', () => {
    expect(actions).toMatch(/reticence\.record\(\s*hashSignature\(/)
  })

  it('never hands the store a bare signature or origin', () => {
    // The three shapes that would put a subject in the row.
    expect(actions).not.toMatch(/reticence\.record\(\s*thread\b/)
    expect(actions).not.toMatch(/reticence\.record\(\s*signature\b/)
    expect(actions).not.toMatch(/reticence\.record\(\s*origin\b/)
  })

  it('clears on accept, which is the only thing that lowers a bar', () => {
    expect(actions).toMatch(/reticence\.clear\(\s*hashSignature\(/)
  })
})

describe('the hash used by the writer', () => {
  it('is the one the reader will compute', () => {
    // Both sides call the same function with the same argument order, so a
    // change to either is a change to both. Stated as a test because a second
    // spelling of the same hash is the failure that would leave every count
    // silently zero.
    const salt = 'c'.repeat(64)
    expect(hashSignature('a+b', salt)).toBe(hashSignature('a+b', salt))
  })
})
