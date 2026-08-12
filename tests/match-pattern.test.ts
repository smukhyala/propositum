/**
 * What the side panel tells a person Propositum may see.
 *
 * ── The defect these pin ─────────────────────────────────────────────────
 *
 * `grantState` compared a granted match pattern to a source origin with `===`
 * after stripping `/*`. That worked while every grant was a specific host, and
 * stopped working the moment the manifest went broad for ambient detection:
 * `'https://*' === 'https://northwind.com'` is false for every source there has
 * ever been, so the panel showed an Allow button beside every approved source
 * on a machine where Chrome had already granted all of them — and pressing it
 * did nothing, because `permissions.request()` needs an
 * `optional_host_permissions` entry the manifest no longer has.
 *
 * On the one screen whose entire job is saying what Propositum can read, that
 * is worse than a missing feature.
 */

import { describe, it, expect } from 'vitest'
import { patternCovers } from '../extension/src/match-pattern.js'

describe('a broad grant covers the sources under it', () => {
  it.each([
    'https://northwind.example.com',
    'https://carrier-a.example',
    'https://a.b.c.example.org',
  ])('https://*/* covers %s', (origin) => {
    expect(patternCovers('https://*/*', origin)).toBe(true)
  })

  it('does not cross schemes', () => {
    expect(patternCovers('https://*/*', 'http://northwind.example.com')).toBe(false)
    expect(patternCovers('http://*/*', 'https://northwind.example.com')).toBe(false)
  })

  it('lets *:// mean either, and only either', () => {
    expect(patternCovers('*://*/*', 'https://northwind.example.com')).toBe(true)
    expect(patternCovers('*://*/*', 'http://northwind.example.com')).toBe(true)
    expect(patternCovers('*://*/*', 'ftp://northwind.example.com')).toBe(false)
  })
})

describe('a specific grant covers only what it names', () => {
  it('matches its own host', () => {
    expect(patternCovers('https://northwind.example.com/*', 'https://northwind.example.com')).toBe(
      true,
    )
  })

  it('does not match a different host', () => {
    expect(patternCovers('https://northwind.example.com/*', 'https://contoso.example.org')).toBe(
      false,
    )
  })

  it('does not match a host that merely ends the same way', () => {
    // The failure this shape invites: `endsWith` without the dot would let
    // `evilnorthwind.example.com` pass as `northwind.example.com`.
    expect(
      patternCovers('https://northwind.example.com/*', 'https://evilnorthwind.example.com'),
    ).toBe(false)
  })

  it('honours a subdomain wildcard, including the bare domain', () => {
    expect(patternCovers('https://*.example.com/*', 'https://northwind.example.com')).toBe(true)
    expect(patternCovers('https://*.example.com/*', 'https://example.com')).toBe(true)
    expect(patternCovers('https://*.example.com/*', 'https://notexample.com')).toBe(false)
  })
})

describe('anything it cannot parse is a no', () => {
  it.each([
    ['', 'https://northwind.example.com'],
    ['not a pattern', 'https://northwind.example.com'],
    ['https://*/*', ''],
    ['https://*/*', 'not a url'],
  ])('%s vs %s', (pattern, origin) => {
    // This answers "may Propositum see it". The conservative answer to a
    // question it cannot parse is no.
    expect(patternCovers(pattern, origin)).toBe(false)
  })

  it('ignores the loopback grant the extension filters out anyway', () => {
    expect(patternCovers('http://127.0.0.1/*', 'https://northwind.example.com')).toBe(false)
  })
})
