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
function watchedAs(subject: string, terms: readonly string[]): string {
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

  const signature = ambient.signatureOf([...terms])
  store.rememberThread(signature, pages.map((p) => p.url))
  store.startNaming(signature)
  store.remember({ signature, subject, confident: true })
  return signature
}

function watched(): string {
  return watchedAs('northwind partners', ['northwind', 'partners'])
}

/** A composed offer against the same thread. */
function composed(signature: string): void {
  const store = stores.ambientStore()
  store.startComposing(signature)
  store.rememberOffer(signature, {
    signature,
    promptVersion: 'offer@1',
    title: 'Write up how the two partner programmes differ.',
    rationale: 'You have been comparing two programmes across their own pages.',
    outline: ['Pull the terms from each', 'Line them up side by side', 'Say which suits you'],
    produces: 'One page comparing the two, with the terms quoted.',
    excludes: ['I will not sign anything', 'I will not email either of them'],
    expects: ['document-changes'],
    grounds: {
      kinds: ['came-back', 'followed-across'],
      sufficient: true,
      sentences: [
        'You went back to Northwind partners after leaving it.',
        'You followed it across 2 different sites.',
      ],
    },
    confident: true,
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

/** Counted rather than read by id, because the assertion that matters most in
 *  the degraded case is that NO row appeared anywhere. */
async function intentionCount(): Promise<number> {
  const { db: handle } = await db.appContext()
  return handle.prisma.intention.count()
}

async function intentionFor(projectId: string) {
  const { repos } = await db.appContext()
  return repos.intentions.forProject(projectId)
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

  it('carries one row per page, however many times the page was reported', async () => {
    /**
     * The content script reports engagement for the focused page every fifteen
     * seconds, so a page read for five minutes is about twenty observations of
     * one URL. That is right for the buffer, which takes the largest dwell
     * report, and wrong for the ledger: each one used to become an
     * `ObservationEvent` saying "opened this page", so accepting wrote twenty
     * "opened" rows for one page, seconds apart. An end-to-end run of four
     * pages produced forty events, and the timeline read as somebody
     * frantically reopening the same tab.
     */
    const signature = watched()
    const store = stores.ambientStore()
    const now = Date.now()

    for (let i = 0; i < 8; i += 1) {
      store.record(
        {
          at: now + i * 1_000,
          origin: NORTHWIND,
          url: `${NORTHWIND}/partners`,
          title: 'Northwind partners',
          kind: 'engagement',
          engagedMs: (i + 1) * 15_000,
        },
        now,
      )
    }

    const result = await actions.acceptWorkOffer(signature, [NORTHWIND, CONTOSO])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Three distinct pages, whatever the report count.
    expect(result.value.carriedOver).toBe(3)

    const { db: handle } = await db.appContext()
    const events = await handle.prisma.observationEvent.findMany({
      where: { sessionId: result.value.sessionId },
      select: { attested: true },
    })
    const urls = events.map((e) => (e.attested as Record<string, unknown>)['url'])
    expect(new Set(urls).size).toBe(urls.length)
  })

  it('starts a session and writes no offer row when nothing was composed', async () => {
    const signature = watched()

    const before = await intentionCount()
    const result = await actions.acceptWorkOffer(signature, [NORTHWIND, CONTOSO])
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.offerRecorded).toBe(false)
    expect(await offerRowFor(result.value.sessionId)).toBeNull()

    // And no Intention either. Nothing was on screen, so nobody ratified
    // anything, and Propositum does not state a purpose nobody was shown.
    expect(await intentionCount()).toBe(before)
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

/**
 * The Intention writer — the one path in the system that creates one.
 *
 * ── Why these exist as behavioural tests and not unit ones ───────────────
 *
 * `tests/repositories.test.ts` proves the row round-trips and
 * `tests/intention.test.ts` proves the state function is right. Neither touches
 * `acceptWorkOffer`, and both stayed green under two mutations that deleted the
 * feature: replacing the ratified statement with `undefined`, and replacing
 * both `intentionId` writes with `null`. A path the suite EXECUTES but never
 * LOOKS AT is indistinguishable from one that does nothing, which is the same
 * argument `tests/reachability.test.ts` opens with, one layer up.
 *
 * Each case uses a subject of its own so `matchProject` cannot fold it into a
 * project some earlier case in this file created — these share one database
 * file, and "reuses the existing Intention" is only an assertion if the test
 * controls which project it lands in.
 */
describe('accepting an offer writes the Intention, and nothing else does', () => {
  it('writes the two strings that were on screen, and hands back its id', async () => {
    const signature = watchedAs('zephyr migration', ['zephyr', 'migration'])
    composed(signature)

    const before = await intentionCount()
    // New work, so this founds its own project and cannot inherit one.
    const result = await actions.acceptWorkOffer(signature, [NORTHWIND], true)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(await intentionCount()).toBe(before + 1)

    // On the result, not only in the database: ADR-0011's softest claim is *on
    // screen wherever it is used*, and an id no caller can see is a screen that
    // cannot meet it.
    expect(result.value.intentionId).not.toBeNull()

    const intention = await intentionFor(result.value.projectId)
    expect(intention).toMatchObject({
      id: result.value.intentionId,
      // Field for field off the offer: `title` → `objective`, `produces` →
      // `definitionOfDone`. Nothing is composed here, nothing summarised, and
      // no second model call happens — the row holds the sentences that were on
      // the screen when the person clicked.
      objective: 'Write up how the two partner programmes differ.',
      definitionOfDone: 'One page comparing the two, with the terms quoted.',
      // No status column, so nothing but a person can ever make this non-null.
      completedAt: null,
    })

    // And the sitting points at it, which is what makes `working` reachable.
    const { repos } = await db.appContext()
    expect((await repos.sessions.byId(result.value.sessionId))?.intentionId).toBe(
      result.value.intentionId,
    )
  })

  it('a second sitting on the same work reuses it rather than minting a rival', async () => {
    const first = watchedAs('halogen rollout', ['halogen', 'rollout'])
    composed(first)

    const one = await actions.acceptWorkOffer(first, [NORTHWIND], true)
    expect(one.ok).toBe(true)
    if (!one.ok) return

    // One live session at a time; the person finished the first sitting and
    // came back to the same work later.
    stores.captureStore().end()

    const after = await intentionCount()
    const second = watchedAs('halogen rollout', ['halogen', 'rollout'])
    composed(second)

    const two = await actions.acceptWorkOffer(second, [NORTHWIND])
    expect(two.ok).toBe(true)
    if (!two.ok) return

    // Same project, same Intention, no second row. At most one per Project is
    // held as a unique index, so a writer that minted a rival would raise P2002
    // rather than quietly producing two statements of purpose for one job.
    expect(two.value.projectId).toBe(one.value.projectId)
    expect(two.value.intentionId).toBe(one.value.intentionId)
    expect(await intentionCount()).toBe(after)
  })

  it('does not rewrite the sentence when the offer says something else', async () => {
    /**
     * The correction channel is the person rewriting it, and there is no second
     * one. A model composing a new title in August must not silently replace
     * what somebody ratified in March — that is the whole of "human-ratified",
     * and it is why the accept path creates or reuses and never edits.
     */
    const first = watchedAs('cobalt audit', ['cobalt', 'audit'])
    composed(first)

    const one = await actions.acceptWorkOffer(first, [NORTHWIND], true)
    expect(one.ok).toBe(true)
    if (!one.ok) return

    stores.captureStore().end()

    const second = watchedAs('cobalt audit', ['cobalt', 'audit'])
    const store = stores.ambientStore()
    store.startComposing(second)
    store.rememberOffer(second, {
      signature: second,
      promptVersion: 'offer@1',
      title: 'Something else entirely.',
      rationale: 'A later guess.',
      outline: ['One'],
      produces: 'A different thing.',
      excludes: [],
      expects: ['document-changes'],
      grounds: { kinds: ['came-back'], sufficient: true, sentences: ['You came back.'] },
      confident: true,
    })

    const two = await actions.acceptWorkOffer(second, [NORTHWIND])
    expect(two.ok).toBe(true)
    if (!two.ok) return

    expect(await intentionFor(one.value.projectId)).toMatchObject({
      objective: 'Write up how the two partner programmes differ.',
      definitionOfDone: 'One page comparing the two, with the terms quoted.',
    })
  })

  it('sitting back down at the same project picks the Intention up again', async () => {
    /**
     * The blocking half, and the reason it is blocking.
     *
     * `startSession` is the ordinary way a person returns to work that already
     * exists, and it used to start the sitting with no Intention at all. That
     * made `IntentionState` almost unreachable past `sleeping`: `working`
     * derives from a live WorkSession ON THE INTENTION and `delegated` from an
     * accepted HandoffContract on it, which `draftContract` stamps off the
     * sitting — so both facts died with the one sitting that ratified it, and
     * every later visit read as asleep with the person sat in front of it.
     *
     * Nothing here writes an Intention. The count is asserted precisely because
     * the fix must be a READ of a row somebody already ratified.
     */
    const signature = watchedAs('tungsten review', ['tungsten', 'review'])
    composed(signature)

    const accepted = await actions.acceptWorkOffer(signature, [NORTHWIND], true)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.value.intentionId).not.toBeNull()

    const { repos } = await db.appContext()
    await actions.endSession(accepted.value.sessionId)

    const before = await intentionCount()
    const again = await actions.startSession(accepted.value.projectId)
    expect(again.ok).toBe(true)
    if (!again.ok) return

    expect((await repos.sessions.byId(again.value.sessionId))?.intentionId).toBe(
      accepted.value.intentionId,
    )
    expect(await intentionCount()).toBe(before)
  })

  it('a sitting split out of the wrong project leaves the Intention behind', async () => {
    /**
     * The one correction a person has for *this is not that work*. The sitting
     * used to keep pointing at the Intention filed under the project it just
     * left, and `draftContract` reads `session.intentionId` onto the contract —
     * so the sentence they had just rejected would have arrived on a contract in
     * the new project, with nothing on screen saying it had. Null is the honest
     * value for the same reason every pre-ADR-0011 row carries one: nobody has
     * stated an Intention for this newly-split work.
     */
    const first = watchedAs('platinum handbook', ['platinum', 'handbook'])
    composed(first)

    const one = await actions.acceptWorkOffer(first, [NORTHWIND], true)
    expect(one.ok).toBe(true)
    if (!one.ok) return

    stores.captureStore().end()

    // A second sitting on the same work, so the project has the two siblings
    // `splitIntoNewProject` requires — and so the split is the ordinary case
    // rather than an exotic one.
    const second = watchedAs('platinum handbook', ['platinum', 'handbook'])
    composed(second)
    const two = await actions.acceptWorkOffer(second, [NORTHWIND])
    expect(two.ok).toBe(true)
    if (!two.ok) return
    expect(two.value.intentionId).toBe(one.value.intentionId)

    const split = await actions.splitIntoNewProject(two.value.sessionId, 'actually something else')
    expect(split.ok).toBe(true)
    if (!split.ok) return

    const { repos } = await db.appContext()
    expect(await repos.sessions.byId(two.value.sessionId)).toMatchObject({
      projectId: split.value.projectId,
      intentionId: null,
    })

    // The Intention itself is untouched — a correction re-files a sitting, it
    // does not edit or delete a sentence a person ratified.
    expect(await intentionFor(one.value.projectId)).toMatchObject({
      id: one.value.intentionId,
    })
  })
})
