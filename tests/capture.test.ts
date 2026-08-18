import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
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

  it('requests only warning-free permissions, and two that are not', () => {
    // `notifications` is warning-free and is the ONLY way to surface an offer
    // nobody asked for. `sidePanel.open()` needs a user gesture, so calling it
    // from an alarm silently throws — which is what happened: the app named
    // "hiking to Kauai's Secret Falls" correctly and the person saw a dot.
    //
    // `debugger` is the exception, and this list is the second place that says
    // so out loud. ADR-0002 refused it — "would make every constraint below
    // advisory" — and ADR-0010 grants it anyway, stating in its opening
    // paragraph that it is the first decision in the series whose net effect
    // on safety is negative. The test below is the half that still holds:
    // `debugger` WITHOUT `tabs` is confined to a tab Propositum opened.
    //
    // `tabGroups` is the second exception, added 2026-08-17 by ADR-0013, and it
    // is the only one that costs a warning Chrome actually SHOWS — *"View and
    // manage your tab groups"*, not absorbed by the broad host permission the
    // way `tabs` and `webNavigation` would be. It is pinned here as well as in
    // `tests/extension-permissions.test.ts` because that file's set assertion
    // is the deliberate-act gate and this one is the second reader of the same
    // list; two pins that can disagree is how a list stops meaning anything.
    // The argument for the permission, what it does not grant, and the
    // `sender.tab`-only mechanism that keeps it narrow all live in that file's
    // docblock rather than being re-argued here.
    expect(manifest.permissions.sort()).toEqual(
      [
        'alarms',
        'debugger',
        'idle',
        'notifications',
        'scripting',
        'sidePanel',
        'storage',
        'tabGroups',
      ].sort(),
    )
  })

  it('can actually raise a notification — icon and all', () => {
    // `type: 'basic'` REQUIRES an iconUrl. Without the file the create call
    // fails silently and the popup simply never appears, which is the same
    // symptom as no detection at all.
    const worker = readFileSync(join(repo, 'extension/src/service-worker.js'), 'utf8')

    expect(worker).toContain('notifications.create')
    expect(worker).toContain("getURL('icon.png')")
    expect(existsSync(join(repo, 'extension/icon.png'))).toBe(true)
  })

  it('never reports a page the person has not actually seen', () => {
    // Typing in the omnibox makes Chrome prerender search/warmup.html in a
    // hidden document, and the content script fired on it like a real page. In
    // one recorded session that stub was the MOST-captured page in a piece of
    // research about a waterfall: 13 of 45 events, complete with `returnedTo`
    // for somewhere nobody had been once.
    const content = readFileSync(join(repo, 'extension/src/content.js'), 'utf8')

    expect(content).toContain('document.prerendering')
    expect(content).toContain('prerenderingchange')
    // And a background tab is not a visit until it is looked at.
    expect(content).toContain("visibilityState === 'hidden'")
  })

  it('measures scroll from any element, not just the window', () => {
    // Scroll events do not bubble but do fire during capture. Without this,
    // a site that scrolls inside a container reports 0 however far you read.
    const content = readFileSync(join(repo, 'extension/src/content.js'), 'utf8')

    expect(content).toMatch(/capture:\s*true/)
    expect(content).toContain('scrollHeight > el.clientHeight')
  })

  it('answers to the notification, or it is just a dismissable banner', () => {
    const worker = readFileSync(join(repo, 'extension/src/service-worker.js'), 'utf8')

    expect(worker).toContain('notifications.onButtonClicked')
    expect(worker).toContain('notifications.onClicked')
  })

  it('does not request tabs, webNavigation or history', () => {
    // Without `tabs`, the extension is structurally incapable of learning the
    // person visited anything they did not approve. Chrome enforces it.
    //
    // `debugger` used to be in this list and was moved out by ADR-0010. Its
    // absence from here makes THIS assertion carry more than it used to, not
    // less: `chrome.debugger.attach` needs a tab id, and without `tabs` the
    // only tab id the extension can obtain is one `chrome.tabs.create`
    // returned. `tests/extension-cdp.test.ts` closes the other door by
    // asserting `chrome.debugger.getTargets` is never called.
    for (const forbidden of ['tabs', 'webNavigation', 'history']) {
      expect(manifest.permissions).not.toContain(forbidden)
    }
  })

  it('grants broad website access at install — a REVERSAL, priced in the open', () => {
    // This test used to assert the opposite, and the assertion was load-bearing:
    // ADR-0002's whole argument was that Chrome, not our code, decides what the
    // extension may see.
    //
    // Detection cannot work on sources the person has not set up yet, and
    // noticing work before being told about it is the entire feature. So the
    // broad grant is deliberate, and it costs Chrome's "Read and change all
    // your data on all websites" warning at install.
    //
    // The limit is now BEHAVIOURAL, not a permission, which is a weaker kind of
    // guarantee and is written down as such. The two tests below are what
    // enforce it.
    const hosts: string[] = manifest.host_permissions ?? []

    expect(hosts).toContain('https://*/*')
    expect(hosts).toContain('http://127.0.0.1/*')
  })

  it('the content script strips page text when no session is running', () => {
    // The behavioural half of the guarantee above. There is exactly one place
    // that decides page text may travel, and it is the service worker — the
    // content script deliberately does not know whether a session is running,
    // because a page could learn that by timing what its own script may do.
    const worker = readFileSync(join(repo, 'extension/src/service-worker.js'), 'utf8')

    expect(worker).toContain('bufferAmbient')
    // `text` destructured out and discarded on the no-session path.
    expect(worker).toMatch(/const \{ text, \.\.\.metadataOnly \} = message\.signal/)
  })

  it('the ambient endpoint has no field that could carry page text', () => {
    const route = readFileSync(join(repo, 'src/app/api/capture/ambient/route.ts'), 'utf8')
    const schema = route.slice(route.indexOf('ambientSchema'), route.indexOf('export async function'))

    for (const banned of ['text', 'excerpt', 'content', 'untrusted', 'body']) {
      expect(schema, `ambient observations must not carry ${banned}`).not.toMatch(
        new RegExp(`\\b${banned}\\s*:`),
      )
    }
  })

  it('the app accepts the origin the extension is pinned to', () => {
    // 127.0.0.1 and localhost are the same machine and DIFFERENT ORIGINS. The
    // dev server announces itself as localhost and 403s dev-asset requests from
    // origins it was not told about — so a static chunk requested with
    // `Origin: http://127.0.0.1:3117` failed, hydration never completed, and
    // every motion section stayed at the opacity:0 its own server render
    // emitted. A blank page, 200 in the log, no error anywhere.
    //
    // The extension is buildless and hardcodes 127.0.0.1, so the app is the
    // side that has to accept it.
    const config = readFileSync(join(repo, 'next.config.ts'), 'utf8')
    const workerOrigin = /const APP_ORIGIN = 'https?:\/\/([^:']+)/.exec(
      readFileSync(join(repo, 'extension/src/service-worker.js'), 'utf8'),
    )?.[1]

    expect(workerOrigin).toBeDefined()
    expect(
      config,
      `next.config.ts must allow ${workerOrigin} as a dev origin, or the client bundle 403s`,
    ).toContain(`'${workerOrigin}'`)
  })

  it('keeps the app port pinned to the one the extension talks to', () => {
    // The extension is buildless on purpose (ADR-0002), so this constant cannot
    // be read from config — it is duplicated, and the duplication is only safe
    // if something notices when it drifts. It drifted: APP_ORIGIN said 3117
    // while `next dev` served 3000, so capture was off out of the box and the
    // badge blamed the wrong thing.
    const scripts = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).scripts as Record<
      string,
      string
    >

    const devPort = /-p\s+(\d+)/.exec(scripts['dev'] ?? '')?.[1]
    const startPort = /-p\s+(\d+)/.exec(scripts['start'] ?? '')?.[1]
    const workerOrigin = /const APP_ORIGIN = '([^']+)'/.exec(
      readFileSync(join(repo, 'extension/src/service-worker.js'), 'utf8'),
    )?.[1]

    expect(devPort, 'the dev script must pin a port the extension can be told about').toBeDefined()
    expect(workerOrigin).toBe(`http://127.0.0.1:${devPort}`)
    expect(startPort, 'start and dev must agree, or a built app is unreachable').toBe(devPort)
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

  /**
   * The real shape of an extension request, captured off the wire.
   *
   * Granting `host_permissions` for loopback — which the extension cannot work
   * without — makes Chrome treat the fetch as privileged and send NO Origin at
   * all. Requiring one meant the extension reached the app and was refused by
   * its own transport every 30 seconds, silently, while the interface said
   * capture was running.
   */
  const EXTENSION_REQUEST = {
    headers: {
      'content-type': 'application/json',
      [CUSTOM_HEADER]: '1',
      'sec-fetch-site': 'none',
      'sec-fetch-mode': 'cors',
      // No `origin`. This is the point.
    },
    body: good.body,
  }

  it('admits the extension when Chrome sends no Origin at all', () => {
    expect(admit(EXTENSION_REQUEST, context).ok).toBe(true)
  })

  it('rejects a missing Origin that is NOT browser-attested as non-page', () => {
    // A page-initiated request carries `cross-site`. Only a privileged caller
    // with no initiating document sends `none`, and Sec-Fetch-* is a forbidden
    // header name, so no script can set or suppress it.
    const headers = { ...EXTENSION_REQUEST.headers, 'sec-fetch-site': 'cross-site' }

    expect(admit({ ...EXTENSION_REQUEST, headers }, context)).toEqual({
      ok: false,
      reason: 'bad-origin',
    })
  })

  it('rejects a missing Origin with no Sec-Fetch-Site at all', () => {
    const headers = { ...EXTENSION_REQUEST.headers, 'sec-fetch-site': undefined }

    expect(admit({ ...EXTENSION_REQUEST, headers }, context)).toEqual({
      ok: false,
      reason: 'bad-origin',
    })
  })

  it('still rejects a hostile page even if it claims sec-fetch-site: none', () => {
    // Belt: a present Origin is checked against ours regardless of what else
    // the request claims, so a forged Sec-Fetch-Site cannot launder a page.
    const headers = {
      ...EXTENSION_REQUEST.headers,
      origin: 'https://northwind.example.com',
      'sec-fetch-site': 'none',
    }

    expect(admit({ ...EXTENSION_REQUEST, headers }, context)).toEqual({
      ok: false,
      reason: 'bad-origin',
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
