/**
 * Accepting an offer, and the two things the accept path must not let a caller
 * decide.
 *
 * ── What these pin ───────────────────────────────────────────────────────
 *
 * `tests/start-from-suggestion.test.ts` pins the wave-one fix: a requested list
 * of sites is intersected against what the ambient buffer holds, so a crafted
 * `?origins=https://attacker.example` approves nothing. That guard is still in
 * place and still tested there.
 *
 * These pin the wave-two shape, which is stronger and different: the accept
 * path TAKES NO SUBJECT AND NO INTENT FROM ITS CALLER AT ALL, and the only
 * site-shaped input it accepts can narrow and cannot widen. A caller supplies a
 * thread signature and a set of ticks; everything else — what this work is
 * called, which sites Propositum saw it on, what the offer said — is read back
 * off the server-side buffer against that key.
 *
 * They run against a real SQLite file, because the assertions that matter most
 * are about rows that must and must not exist. Asserting on a return value
 * alone would pass just as happily against a version that refused AFTER
 * writing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `revalidatePath` needs a request store that does not exist in a test process.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

type Actions = typeof import('../src/server/actions')
type Db = typeof import('../src/server/db')
type CaptureStore = typeof import('../src/server/capture-store')
type AmbientStore = typeof import('../src/server/ambient-store')

const NORTHWIND = 'https://northwind.example.com'
const CONTOSO = 'https://contoso.example.org'
const ATTACKER = 'https://attacker.example'

let dir: string
let actions: Actions
let db: Db
let stores: CaptureStore
let ambient: AmbientStore

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-accept-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  process.env['DATABASE_URL'] = url

  actions = await import('../src/server/actions')
  db = await import('../src/server/db')
  stores = await import('../src/server/capture-store')
  ambient = await import('../src/server/ambient-store')
}, 120_000)

afterAll(async () => {
  const ctx = await db?.appContext()
  await ctx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  stores.ambientStore().clear()
  stores.captureStore().end()
})

/**
 * A thread Propositum actually watched: three pages across two sites, pinned
 * under a signature the way `/api/session/current` pins one before it will emit
 * an offer at all.
 */
function watched(): string {
  const store = stores.ambientStore()
  const now = Date.now()
  const pages = [
    { url: `${NORTHWIND}/partners`, origin: NORTHWIND, title: 'Northwind partners' },
    { url: `${NORTHWIND}/partners/terms`, origin: NORTHWIND, title: 'Northwind partner terms' },
    { url: `${CONTOSO}/partners`, origin: CONTOSO, title: 'Contoso partners' },
  ]

  for (const page of pages) {
    store.record({ at: now, origin: page.origin, url: page.url, title: page.title, kind: 'navigation' }, now)
  }

  const signature = ambient.signatureOf(['northwind', 'partners'])
  store.rememberThread(signature, pages.map((p) => p.url))
  store.remember({
    signature,
    subject: 'northwind partners',
    confident: true,
    offer: 'deep-research',
    offerLabel: 'Want me to read up on northwind partners?',
  })
  return signature
}

/** A composed offer against the same thread. */
function composed(signature: string): void {
  stores.ambientStore().rememberOffer({
    signature,
    promptVersion: 'offer@1',
    title: 'Write up how the two partner programmes differ.',
    rationale: 'You have been comparing two programmes across their own pages.',
    outline: ['Pull the terms from each', 'Line them up side by side', 'Say which suits you'],
    produces: 'One page comparing the two, with the terms quoted.',
    excludes: ['I will not sign anything', 'I will not email either of them'],
    expects: ['document-changes'],
    grounds: ['You went back to Northwind partners after leaving it.', 'You followed it across 2 different sites.'],
    groundKinds: ['came-back', 'followed-across'],
  })
}

async function approvalsMentioning(host: string): Promise<number> {
  const { db: handle } = await db.appContext()
  return handle.prisma.approvedSource.count({ where: { originPattern: { contains: host } } })
}

async function offerRowFor(sessionId: string) {
  const { repos } = await db.appContext()
  return repos.offers.forSession(sessionId)
}

/* ── the security property ───────────────────────────────────────────────── */

describe('the accept path takes no sites from its caller', () => {
  it('ignores a site nobody browsed, however it is spelt', async () => {
    const signature = watched()

    // Exactly the shape of the crafted link, now arriving as a tick rather than
    // as a query parameter — and it is not filtered out so much as absent: the
    // approved set is `observed ∩ ticked`, and this is in neither.
    const result = await actions.acceptWorkOffer(signature, [
      ATTACKER,
      'attacker.example',
      `${NORTHWIND}/*`,
      CONTOSO,
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await approvalsMentioning('attacker.example')).toBe(0)
    const { repos } = await db.appContext()
    const sources = await repos.projects.approvedSources(result.value.projectId)
    expect(sources.map((s) => s.originPattern).sort()).toEqual([
      `${CONTOSO}/*`,
      `${NORTHWIND}/*`,
    ])
  })

  it('unticking a site narrows what gets approved', async () => {
    const signature = watched()

    const result = await actions.acceptWorkOffer(signature, [NORTHWIND], true)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const { repos } = await db.appContext()
    const sources = await repos.projects.approvedSources(result.value.projectId)
    expect(sources.map((s) => s.originPattern)).toEqual([`${NORTHWIND}/*`])
    // The dropped one is counted, not silently forgotten.
    expect(result.value.discardedOrigins).toBe(0)
  })

  it('refuses, and writes nothing, when nothing is left ticked', async () => {
    const signature = watched()
    const before = await approvalsMentioning('example')

    const result = await actions.acceptWorkOffer(signature, [])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem.code).toBe('invalid-input')
    expect(await approvalsMentioning('example')).toBe(before)
  })

  it('approves nothing for a signature nothing was recorded against', async () => {
    // No `watched()`. A link naming a thread the buffer has never held is the
    // one an attacker can write; it gets the same answer as a stale one.
    //
    // Counted as a DELTA because these tests share one database file, and a
    // bare `toBe(0)` would be measuring the tests above rather than this call.
    const before = await approvalsMentioning('example')

    const result = await actions.acceptWorkOffer('made+up+thread', [NORTHWIND, ATTACKER])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(await approvalsMentioning('example')).toBe(before)
    expect(await approvalsMentioning('attacker.example')).toBe(0)
  })
})

/* ── what the screen is shown, and what accepting records ────────────────── */

describe('what the offer screen is given', () => {
  it('says nothing at all about a thread it does not hold', async () => {
    const found = await actions.offerForThread('made+up+thread')

    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.value).toBeNull()
  })

  it('lists the observed sites and the composed offer', async () => {
    const signature = watched()
    composed(signature)

    const found = await actions.offerForThread(signature)
    expect(found.ok).toBe(true)
    if (!found.ok || found.value === null) throw new Error('expected an offer on screen')

    expect(found.value.subject).toBe('northwind partners')
    expect(found.value.origins.map((o) => o.host).sort()).toEqual([
      'contoso.example.org',
      'northwind.example.com',
    ])
    expect(found.value.offer?.title).toContain('partner programmes')
    expect(found.value.offer?.excludes.length).toBeGreaterThan(0)
    expect(found.value.grounds.length).toBeGreaterThan(0)
  })

  it('degrades rather than dead-ends when nothing has been composed', async () => {
    const signature = watched()

    const found = await actions.offerForThread(signature)
    expect(found.ok).toBe(true)
    if (!found.ok || found.value === null) throw new Error('expected the degraded form')

    // The link still works, the sites are still listed, and the button will
    // still start a session. There is simply no proposal attached.
    expect(found.value.offer).toBeNull()
    expect(found.value.origins.length).toBe(2)
    expect(found.value.sentence.length).toBeGreaterThan(0)
  })
})

describe('an accepted offer becomes durable, and a declined one leaves nothing', () => {
  it('writes the WorkOffer with the grounds frozen onto it', async () => {
    const signature = watched()
    composed(signature)

    const result = await actions.acceptWorkOffer(signature, [NORTHWIND, CONTOSO])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.offerRecorded).toBe(true)

    const row = await offerRowFor(result.value.sessionId)
    expect(row).not.toBeNull()
    if (!row) return

    expect(row.threadSignature).toBe(signature)
    expect(row.promptVersion).toBe('offer@1')
    expect(row.outline.length).toBe(3)
    expect(row.excludes.length).toBe(2)
    expect(row.expectedKinds).toEqual(['document-changes'])
    // Frozen, because the buffer this came from will not hold the answer an
    // hour from now — and "why did it offer me this" is asked an hour later.
    expect(row.grounds['sentences']).toEqual([
      'You went back to Northwind partners after leaving it.',
      'You followed it across 2 different sites.',
    ])
    // CODE-DERIVED, and only the sites actually approved.
    expect([...row.originPatterns].sort()).toEqual([`${CONTOSO}/*`, `${NORTHWIND}/*`])
  })

  it('carries the pages already read into the session', async () => {
    const signature = watched()
    composed(signature)

    const result = await actions.acceptWorkOffer(signature, [NORTHWIND, CONTOSO])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.carriedOver).toBe(3)
  })

  it('starts a session and writes no offer row when nothing was composed', async () => {
    const signature = watched()

    const result = await actions.acceptWorkOffer(signature, [NORTHWIND, CONTOSO])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.offerRecorded).toBe(false)
    expect(await offerRowFor(result.value.sessionId)).toBeNull()
  })

  it('leaves no offer row behind for an offer nobody accepted', async () => {
    /**
     * A durable record of every guess Propositum made about what somebody was
     * doing IS a profile, which is the whole reason the ambient buffer lives in
     * memory. So composing must cost nothing on disk, and only the acceptance
     * writes. The repository has no `draft` and no `decline` for the same
     * reason; this checks the caller has not invented one.
     */
    const { db: handle } = await db.appContext()
    const before = await handle.prisma.workOffer.count()

    const signature = watched()
    composed(signature)

    // Declining is what `clear()` models: the person drew a line under it.
    stores.ambientStore().clear()

    expect(await handle.prisma.workOffer.count()).toBe(before)
    // And the offer is genuinely gone, so a stale one cannot be served against
    // a thread whose evidence has been thrown away.
    expect(stores.ambientStore().offerFor(signature)).toBeNull()
  })
})
