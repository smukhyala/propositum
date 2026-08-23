/**
 * The hash, and the one thing it must never do.
 *
 * A signature is readable terms — `forecast+kauai+south+weather` — and the
 * whole reason this file exists is that those terms must not reach a durable
 * row. The assertion that matters is the third one: no fragment of the input
 * survives into the output.
 */
import { describe, expect, it } from 'vitest'

import { hashSignature, installSalt } from '../src/domain/detection/reticence'
import type { SaltStore } from '../src/domain/detection/reticence'

const SALT = 'a'.repeat(64)

describe('hashing a thread signature', () => {
  it('is stable for the same signature and salt', () => {
    expect(hashSignature('forecast+kauai', SALT)).toBe(hashSignature('forecast+kauai', SALT))
  })

  it('differs when the salt differs, so two installs never match', () => {
    expect(hashSignature('forecast+kauai', SALT)).not.toBe(
      hashSignature('forecast+kauai', 'b'.repeat(64)),
    )
  })

  it('carries no fragment of the terms it was made from', () => {
    const hashed = hashSignature('forecast+kauai+south+weather', SALT)

    for (const term of ['forecast', 'kauai', 'south', 'weather']) {
      expect(hashed).not.toContain(term)
    }
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the install salt', () => {
  function store(initial: string | null): SaltStore & { written: string[] } {
    const written: string[] = []
    let held = initial
    return {
      written,
      read: async () => held,
      write: async (salt) => {
        written.push(salt)
        held = salt
      },
    }
  }

  it('generates one on first use and keeps it', async () => {
    const s = store(null)

    const first = await installSalt(s)
    const second = await installSalt(s)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
    // Written once. A salt that rotated would orphan every row silently.
    expect(s.written).toHaveLength(1)
  })

  it('never overwrites one that already exists', async () => {
    const s = store(SALT)

    expect(await installSalt(s)).toBe(SALT)
    expect(s.written).toHaveLength(0)
  })
})
