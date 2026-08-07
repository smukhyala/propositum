import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CUSTOM_HEADER,
  TransportUnreachableError,
  admit,
  verifyTransportReachable,
} from '../src/capture/transport'
import type { TransportContext } from '../src/capture/transport'
import {
  ENGAGEMENT_DWELL_MS,
  classifyAway,
  classifyEngagement,
  classifySelection,
  cleanUrl,
  createNavigationClassifier,
  searchTermOf,
} from '../src/capture/semantics'
import { OBSERVATION_KINDS } from '../src/persistence/ledger-writer'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

const context: TransportContext = {
  expectedOrigin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
  sessionToken: 'tok-12345',
  sessionId: 'sess-1',
}

const good = {
  headers: {
    'content-type': 'application/json',
    [CUSTOM_HEADER]: '1',
    origin: context.expectedOrigin,
  },
  body: { token: 'tok-12345', sessionId: 'sess-1', events: [{ kind: 'note' }] },
}

describe('the manifest asks for nothing frightening', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'extension/manifest.json'), 'utf8')) as {
    permissions: string[]
    optional_host_permissions: string[]
    host_permissions?: string[]
  }

  it('requests only warning-free permissions', () => {
    expect(manifest.permissions.sort()).toEqual(
      ['alarms', 'idle', 'scripting', 'sidePanel', 'storage'].sort(),
    )
  })

  it('does not request tabs, webNavigation, history or debugger', () => {
    // Without `tabs`, the extension is structurally incapable of learning the
    // person visited anything they did not approve. Chrome enforces it.
    for (const forbidden of ['tabs', 'webNavigation', 'history', 'debugger']) {
      expect(manifest.permissions).not.toContain(forbidden)
    }
  })

  it('grants no host access at install — every origin is requested on approval', () => {
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.optional_host_permissions).toBeDefined()
  })
})

describe('the transport does not rely on CORS', () => {
  it('rejects text/plain, which is CORS-safelisted and would be executed', () => {
    // The single most important check. A hostile page can POST this without a
    // preflight; only the response is withheld, and a forgery does not want it.
    const forged = {
      ...good,
      headers: { ...good.headers, 'content-type': 'text/plain' },
    }

    expect(admit(forged, context)).toEqual({ ok: false, reason: 'bad-content-type' })
  })

  it('rejects a missing custom header', () => {
    const headers = { ...good.headers }
    delete (headers as Record<string, string | undefined>)[CUSTOM_HEADER]

    expect(admit({ ...good, headers }, context)).toEqual({
      ok: false,
      reason: 'missing-custom-header',
    })
  })

  it('rejects an Origin that is not our extension', () => {
    const fromPage = { ...good, headers: { ...good.headers, origin: 'https://northwind.example.com' } }

    expect(admit(fromPage, context)).toEqual({ ok: false, reason: 'bad-origin' })
  })

  it('rejects a wrong token', () => {
    const wrong = { ...good, body: { ...good.body, token: 'tok-99999' } }

    expect(admit(wrong, context)).toEqual({ ok: false, reason: 'bad-token' })
  })

  it('rejects a token for a different session', () => {
    const other = { ...good, body: { ...good.body, sessionId: 'sess-2' } }

    expect(admit(other, context)).toEqual({ ok: false, reason: 'wrong-session' })
  })

  it('rejects a malformed envelope', () => {
    expect(admit({ ...good, body: { nope: true } }, context)).toEqual({
      ok: false,
      reason: 'malformed-envelope',
    })
  })

  it('admits a well-formed request with all four controls satisfied', () => {
    const result = admit(good, context)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.events).toHaveLength(1)
  })

  it('needs ALL four — no single control is sufficient', () => {
    // Drop each one in turn; every variant must fail.
    const variants = [
      { ...good.headers, 'content-type': 'text/plain' },
      { ...good.headers, [CUSTOM_HEADER]: undefined },
      { ...good.headers, origin: 'https://evil.example' },
    ]

    for (const headers of variants) {
      expect(admit({ ...good, headers }, context).ok).toBe(false)
    }
    expect(admit({ ...good, body: { ...good.body, token: 'x' } }, context).ok).toBe(false)
  })
})

describe('the startup self-check fails loudly', () => {
  it('throws when the app is unreachable', async () => {
    await expect(verifyTransportReachable({ probe: async () => ({ ok: false, status: 0 }) })).rejects.toThrow(
      TransportUnreachableError,
    )
  })

  it('says capture is off, and names the LNA exemption as a suspect', async () => {
    // Silent capture failure is the worst outcome available: the person
    // believes they are being watched and they are not.
    try {
      await verifyTransportReachable({ probe: async () => ({ ok: false, error: 'refused' }) })
    } catch (error) {
      expect((error as Error).message).toMatch(/Capture is OFF/)
      expect((error as Error).message).toMatch(/Local Network Access/)
    }
  })

  it('passes when reachable', async () => {
    await expect(verifyTransportReachable({ probe: async () => ({ ok: true }) })).resolves.toBeUndefined()
  })
})

describe('semantic classification is deterministic', () => {
  it('emits only kinds the ledger accepts', () => {
    const classifier = createNavigationClassifier()
    const nav = classifier.classify({
      url: 'https://northwind.example.com/partners',
      title: 'Partners',
      approvedSourceId: 'src-1',
      at: new Date(0),
      elapsedMs: 0,
    })

    expect(OBSERVATION_KINDS).toContain(nav.kind)
  })

  it('has no kind for "encountered missing information"', () => {
    // Listed in the founding brief as an example event. It is an
    // INTERPRETATION — a conclusion about what the person did not find — and
    // belongs to inference, not capture.
    expect(OBSERVATION_KINDS).not.toContain('encounteredMissingInformation')
    expect(OBSERVATION_KINDS).not.toContain('missingInformation')
  })

  it('calls the second visit to a page returnedTo', () => {
    const classifier = createNavigationClassifier()
    const nav = {
      url: 'https://northwind.example.com/partners',
      title: 'Partners',
      approvedSourceId: 'src-1',
      at: new Date(0),
      elapsedMs: 0,
    }

    expect(classifier.classify(nav).kind).toBe('visited')
    expect(classifier.classify(nav).kind).toBe('returnedTo')
  })

  it('recognises a search only from known query parameters', () => {
    expect(searchTermOf('https://example.com/?q=revenue+share')).toBe('revenue share')
    expect(searchTermOf('https://example.com/?query=tiers')).toBe('tiers')
    // A tracking parameter is not a search.
    expect(searchTermOf('https://example.com/?ref=newsletter')).toBeNull()
    expect(searchTermOf('https://example.com/partners')).toBeNull()
  })

  it('strips tracking parameters and fragments from the stored URL', () => {
    const clean = cleanUrl('https://northwind.example.com/partners?utm_source=x&q=tiers#pricing')

    expect(clean).toContain('q=tiers')
    expect(clean).not.toContain('utm_source')
    expect(clean).not.toContain('#pricing')
  })

  it('strips credentials from a URL rather than storing them', () => {
    expect(cleanUrl('https://user:secret@example.com/page')).not.toContain('secret')
  })
})

describe('engagement is a threshold, not a guess', () => {
  const base = {
    url: 'https://northwind.example.com/pricing',
    approvedSourceId: 'src-1',
    at: new Date(0),
    elapsedMs: 0,
  }

  it('ignores a glance', () => {
    expect(classifyEngagement({ ...base, dwellMs: 2_000, scrollFraction: 0.9 })).toBeNull()
  })

  it('ignores a long dwell with no scrolling — a tab left open is not reading', () => {
    expect(
      classifyEngagement({ ...base, dwellMs: ENGAGEMENT_DWELL_MS * 5, scrollFraction: 0.01 }),
    ).toBeNull()
  })

  it('records genuine engagement', () => {
    const event = classifyEngagement({ ...base, dwellMs: ENGAGEMENT_DWELL_MS + 1, scrollFraction: 0.6 })

    expect(event?.kind).toBe('engaged')
  })
})

describe('selections', () => {
  const base = {
    url: 'https://northwind.example.com/partners',
    approvedSourceId: 'src-1',
    at: new Date(0),
    elapsedMs: 0,
  }

  it('ignores a stray click', () => {
    expect(classifySelection({ ...base, text: 'a' })).toBeNull()
  })

  it('passes the text through RAW, for the ledger to sanitise', () => {
    // One door. The capture layer must not datamark, or it would be marked
    // twice and a caller might treat it as already safe.
    const event = classifySelection({ ...base, text: 'Standard partners receive 15%.' })

    expect(event?.untrustedText).toBe('Standard partners receive 15%.')
    expect(event?.untrustedText).not.toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
  })

  it('records the length as attested, but never the text', () => {
    const event = classifySelection({ ...base, text: 'Standard partners receive 15%.' })

    expect(event?.attested['length']).toBe(30)
    expect(JSON.stringify(event?.attested)).not.toContain('Standard partners')
  })
})

describe('leaving the desk is a first-class fact', () => {
  it('records why', () => {
    // chrome.idle and windows.onFocusChanged have no CDP equivalent — part of
    // why the extension won ADR-0002.
    expect(classifyAway(new Date(0), 0, 'idle').attested['cause']).toBe('idle')
    expect(classifyAway(new Date(0), 0, 'lock').kind).toBe('switchedAway')
  })

  it('is not attributed to a source, because it is not about one', () => {
    expect(classifyAway(new Date(0), 0, 'blur').approvedSourceId).toBeUndefined()
  })
})
