import { describe, it, expect } from 'vitest'
import { ACTION_KINDS, compilePolicy } from '../src/domain/handoff/policy'
import { authorize } from '../src/policy/gate'
import type { AuthorizedAction, RunContext } from '../src/policy/gate'
import {
  SourceNotAllowedError,
  allowlisted,
  fixtureFetcher,
  isAllowed,
  matchesPattern,
} from '../src/policy/fetcher'
import { draftSection, readApprovedSource, readDocument } from '../src/policy/tools'
import { HOSTILE_CASES } from '../src/fixtures/hostile-session'

const ALLOWED = ['https://northwind.example.com/*']

const PAGES = {
  'https://northwind.example.com/partners': {
    url: 'https://northwind.example.com/partners',
    title: 'Northwind — Partnership Programme',
    text: 'Standard partners receive a 15% revenue share.',
  },
}

const run: RunContext = {
  currentStepOrdinal: 1,
  planLength: 3,
  deadlineEpochMs: 10_000,
  nowEpochMs: 0,
}

const policy = compilePolicy(
  {
    approvedSourceIds: ['src-northwind'],
    allowedActionKinds: ['read-approved-source', 'read-document', 'draft-section'],
    baseVersionId: 'ver-1',
  },
  {
    initiative: 'follow-closely',
    progress: 'current-step-only',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  },
)

/** The only way to get a token — there is no other construction site. */
function token<K extends 'read-approved-source' | 'read-document' | 'draft-section'>(
  kind: K,
  params: Record<string, string>,
): AuthorizedAction<K> {
  const result = authorize(
    policy,
    { kind, params, reason: 'test', stepOrdinal: 1 },
    run,
    'intent-1',
  )
  if (!result.authorized) throw new Error(`gate refused: ${result.rule}`)
  return result.action as AuthorizedAction<K>
}

describe('the allowlist pattern is deliberately simple', () => {
  it('matches an origin plus path prefix', () => {
    expect(matchesPattern('https://northwind.example.com/partners', ALLOWED[0]!)).toBe(true)
    expect(matchesPattern('https://northwind.example.com/pricing/tiers', ALLOWED[0]!)).toBe(true)
  })

  it('refuses a different origin, however similar', () => {
    expect(matchesPattern('https://northwind.example.com.evil.net/partners', ALLOWED[0]!)).toBe(false)
    expect(matchesPattern('https://evil.net/northwind.example.com/', ALLOWED[0]!)).toBe(false)
    expect(matchesPattern('http://northwind.example.com/partners', ALLOWED[0]!)).toBe(false)
  })

  it('refuses non-http schemes, which would be a way out of the allowlist entirely', () => {
    expect(matchesPattern('file:///etc/passwd', 'file:///*')).toBe(false)
    expect(matchesPattern('data:text/html,<script>', ALLOWED[0]!)).toBe(false)
  })

  it('refuses a malformed URL rather than throwing', () => {
    expect(isAllowed('not a url', ALLOWED)).toBe(false)
  })
})

describe('the fetcher re-checks at request time', () => {
  it('closes the gap between "authorised source X" and "fetched X"', async () => {
    // The gate authorises an id; this checks the URL that id resolved to. A
    // lookup returning the wrong row is a bug the gate cannot see.
    const fetcher = allowlisted(fixtureFetcher(PAGES), ALLOWED)

    await expect(fetcher.fetch('https://competitor.example.net/contracts')).rejects.toThrow(
      SourceNotAllowedError,
    )
  })

  it('says the failure is a lookup bug, not a permissions one', async () => {
    const fetcher = allowlisted(fixtureFetcher(PAGES), ALLOWED)
    await expect(fetcher.fetch('https://evil.net/')).rejects.toThrow(/lookup bug, not a permissions one/)
  })

  it('allows an approved URL through', async () => {
    const fetcher = allowlisted(fixtureFetcher(PAGES), ALLOWED)
    const page = await fetcher.fetch('https://northwind.example.com/partners')

    expect(page.title).toContain('Northwind')
  })
})

describe('readApprovedSource', () => {
  const deps = {
    fetcher: allowlisted(fixtureFetcher(PAGES), ALLOWED),
    sources: { urlFor: async () => 'https://northwind.example.com/partners' },
  }

  it('reads through the gate and returns raw, undatamarked text', async () => {
    const result = await readApprovedSource(token('read-approved-source', { approvedSourceId: 'src-northwind' }), deps)

    expect(result.untrustedText).toContain('15% revenue share')
    // Deliberately NOT datamarked here — the ledger writer is the one door
    // that sanitises, and marking twice would either double-fence it or tempt
    // a caller into treating this as safe.
    expect(result.untrustedText).not.toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
  })

  it('is refused by the gate for a source outside the contract', () => {
    expect(() => token('read-approved-source', { approvedSourceId: 'src-competitor' })).toThrow(
      /source_not_approved/,
    )
  })

  it('still refuses at the fetcher if a lookup resolves outside the allowlist', async () => {
    const misdirected = {
      fetcher: allowlisted(fixtureFetcher(PAGES), ALLOWED),
      sources: { urlFor: async () => 'https://internal.example.com/pricing' },
    }

    await expect(
      readApprovedSource(token('read-approved-source', { approvedSourceId: 'src-northwind' }), misdirected),
    ).rejects.toThrow(SourceNotAllowedError)
  })
})

describe('readDocument reads the pinned base, never the live document', () => {
  const version = {
    id: 'ver-1',
    documentId: 'doc-1',
    content: 'Base text.',
    contentHash: 'abc',
  }
  const deps = { versions: { byId: async () => version }, baseVersionId: 'ver-1' }

  it('returns the pinned version', async () => {
    const result = await readDocument(token('read-document', { documentId: 'doc-1' }), deps)

    expect(result.versionId).toBe('ver-1')
    expect(result.content).toBe('Base text.')
  })

  it('cannot be pointed at another document, because nothing it is given points anywhere', async () => {
    /**
     * This used to assert a throw on a mismatched `documentId`, and the throw
     * was the defect: the only caller passed a DocumentVersion id under that
     * key, so the comparison failed on every real run and `read-document` had
     * never once succeeded.
     *
     * The property the old test was reaching for still holds, and holds more
     * strongly than a comparison could make it hold. The version comes from
     * `deps.baseVersionId`, which is the ratified contract's, and no argument to
     * this function can move it. So a wrong id is not refused — it is simply
     * not consulted, and there is nothing left to disagree about.
     */
    const result = await readDocument(token('read-document', { documentId: 'doc-other' }), deps)

    expect(result.versionId).toBe('ver-1')
    expect(result.documentId).toBe('doc-1')
    expect(result.content).toBe('Base text.')
  })

  it('still fails loudly when the pinned base has gone', async () => {
    const missing = { versions: { byId: async () => null }, baseVersionId: 'ver-gone' }

    await expect(readDocument(token('read-document', { documentId: 'doc-1' }), missing)).rejects.toThrow(
      /base version ver-gone not found/,
    )
  })
})

describe('draftSection proposes, it does not write', () => {
  it('returns prose for a section', () => {
    const result = draftSection(
      token('draft-section', { documentId: 'doc-1', sectionPath: 'Commercials', text: 'We propose 15%.' }),
    )

    expect(result).toEqual({ sectionPath: 'Commercials', prose: 'We propose 15%.' })
  })

  it('is refused entirely under suggestions-only', () => {
    const researchOnly = compilePolicy(
      { approvedSourceIds: [], allowedActionKinds: ['read-approved-source', 'draft-section'], baseVersionId: 'v' },
      {
        initiative: 'follow-closely',
        progress: 'current-step-only',
        output: 'suggestions-only',
        interruption: 'stop-when-uncertain',
        timeLimitMinutes: 30,
      },
    )
    const result = authorize(
      researchOnly,
      { kind: 'draft-section', params: { documentId: 'd' }, reason: 'r', stepOrdinal: 1 },
      run,
      'i',
    )

    expect(result).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  /**
   * The dial's meaning must not rest on the reversibility classifier.
   *
   * `suggestions-only` removes every kind that can operate a page, not only the
   * one that can write prose. If these came back, a person who picked the
   * safest-looking option would get a worker that could type into forms and
   * press buttons, with only `classifyReversibility` — a lexicon over
   * page-authored text, which a page can defeat by renaming its own button —
   * standing between that and an order being placed.
   *
   * Observation survives, so a research-only run can still cross a site by
   * following links and read what it lands on. It cannot operate anything.
   */
  it('removes every way to operate a page, and keeps every way to read one', () => {
    const researchOnly = compilePolicy(
      { approvedSourceIds: [], allowedActionKinds: [...ACTION_KINDS], baseVersionId: 'v' },
      {
        initiative: 'follow-closely',
        progress: 'remaining-plan',
        output: 'suggestions-only',
        interruption: 'stop-when-uncertain',
        timeLimitMinutes: 30,
      },
    )

    for (const kind of ['click-element', 'type-text', 'press-key', 'draft-section'] as const) {
      expect(researchOnly.actionKindAllowlist.has(kind), `${kind} must not survive`).toBe(false)
    }
    for (const kind of ['observe-page', 'navigate', 'capture-screen'] as const) {
      expect(researchOnly.actionKindAllowlist.has(kind), `${kind} must survive`).toBe(true)
    }
  })
})

describe('hostile pages are captured, not filtered away', () => {
  it('returns hidden text rather than dropping it', async () => {
    // innerText excludes only display:none and visibility:hidden — opacity:0,
    // zero-size fonts and white-on-white survive. That is what we WANT: hiding
    // it is what an attacker does, and the person deserves to be told.
    const hidden = HOSTILE_CASES.find((c) => c.id === 'hidden-text')!
    const fetcher = allowlisted(
      fixtureFetcher({
        'https://northwind.example.com/partners': {
          url: 'https://northwind.example.com/partners',
          title: 'Northwind',
          text: hidden.payload,
        },
      }),
      ALLOWED,
    )

    const result = await readApprovedSource(
      token('read-approved-source', { approvedSourceId: 'src-northwind' }),
      { fetcher, sources: { urlFor: async () => 'https://northwind.example.com/partners' } },
    )

    expect(result.untrustedText).toContain('IGNORE THE ABOVE')
  })

  it('refuses the URL an injected page tries to add', async () => {
    const injected = HOSTILE_CASES.find((c) => c.id === 'scope-widening')!
    expect(injected.payload).toContain('internal.example.com')

    expect(isAllowed('https://internal.example.com/pricing', ALLOWED)).toBe(false)
    expect(isAllowed('https://competitor.example.net/contracts', ALLOWED)).toBe(false)
  })
})
