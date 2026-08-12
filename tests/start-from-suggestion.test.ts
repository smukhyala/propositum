/**
 * Can a link approve a site Propositum has never seen?
 *
 * ── The defect these pin ─────────────────────────────────────────────────
 *
 * `/start` reads its list of sites off the query string and handed it to
 * `startFromSuggestion`, which approved every entry that parsed as a hostname.
 * So this link
 *
 *   http://localhost:3117/start?subject=Invoices&origins=https://attacker.example
 *
 * wrote an `ApprovedSource` for a site nobody had visited and started a session
 * watching it, behind a single click, under a heading whose words the link also
 * chose. One local user and one click kept the severity low. The shape was the
 * problem: approval was a function of the request rather than of what had been
 * observed, and the honest path only ever passed sites Propositum had seen by
 * coincidence.
 *
 * These run against a real SQLite file, because the assertion that matters most
 * is about a row that must not exist. Asserting on a return value alone would
 * pass just as happily against a version that refused AFTER writing.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// `revalidatePath` needs a request store that does not exist in a test process.
// It is Next's cache talking to itself and has nothing to do with what is under
// test here.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

type Actions = typeof import('../src/server/actions')
type Db = typeof import('../src/server/db')
type CaptureStore = typeof import('../src/server/capture-store')

const NORTHWIND = 'https://northwind.example.com'
const ATTACKER = 'https://attacker.example'
const THREAD = 'northwind+partners'

let dir: string
let actions: Actions
let db: Db
let stores: CaptureStore

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-start-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  // Set before the modules load, because `appContext()` builds its client from
  // the environment the first time an action asks for it.
  process.env['DATABASE_URL'] = url

  actions = await import('../src/server/actions')
  db = await import('../src/server/db')
  stores = await import('../src/server/capture-store')
}, 120_000)

afterAll(async () => {
  const ctx = await db?.appContext()
  await ctx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  stores.ambientStore().clear()
  // One session at a time is enforced, so a test that started one would
  // otherwise decide the next test's answer for it.
  stores.captureStore().end()
})

/** One page, seen. Metadata only — the buffer has nowhere to put anything else. */
function seen(url: string, origin: string): void {
  const now = Date.now()
  stores.ambientStore().record(
    { at: now, origin, url, title: 'Northwind — Partners', kind: 'navigation' },
    now,
  )
}

async function approvedPatterns(projectId: string): Promise<string[]> {
  const { repos } = await db.appContext()
  const sources = await repos.projects.approvedSources(projectId)
  return sources.map((s) => s.originPattern)
}

async function anyApprovalMentioning(host: string): Promise<number> {
  const { db: handle } = await db.appContext()
  return handle.prisma.approvedSource.count({ where: { originPattern: { contains: host } } })
}

/**
 * Every carried-over page, paired with the site the event was filed under.
 *
 * The pairing is the whole point: an event attributed to the wrong
 * `ApprovedSource` is a page filed under a site it did not come from, and
 * nothing downstream can tell that from the truth.
 */
async function carriedPages(
  sessionId: string,
): Promise<Array<{ url: string; filedUnder: string | null }>> {
  const { db: handle } = await db.appContext()
  const events = await handle.prisma.observationEvent.findMany({
    where: { sessionId },
    select: { attested: true, source: { select: { originPattern: true } } },
    orderBy: { seq: 'asc' },
  })

  return events.map((event) => {
    const attested = (event.attested ?? {}) as Record<string, unknown>
    return {
      url: typeof attested['url'] === 'string' ? attested['url'] : '',
      filedUnder: event.source?.originPattern ?? null,
    }
  })
}

describe('a link cannot approve a site Propositum never saw', () => {
  it('approves nothing at all when the buffer is empty', async () => {
    const result = await actions.startFromSuggestion(
      'Invoices',
      [ATTACKER],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem.code).toBe('invalid-input')
    // A person can act on it: browse, and the offer comes back.
    expect(result.problem.message).toMatch(/Browse for a while/)

    expect(await anyApprovalMentioning('attacker.example')).toBe(0)
  })

  it('leaves no project, document or session behind when it refuses', async () => {
    const { db: handle } = await db.appContext()
    const before = await handle.prisma.project.count()

    await actions.startFromSuggestion('Invoices', [ATTACKER], 'deep-research', THREAD)

    expect(await handle.prisma.project.count()).toBe(before)
    expect(stores.captureStore().current()).toBeNull()
  })

  it('drops an unobserved site while keeping an observed one, and counts the drop', async () => {
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND, ATTACKER],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Counted, not silently skipped — a discard means something asked
    // Propositum to watch a site on evidence it does not have.
    expect(result.value.discardedOrigins).toBe(1)
    expect(await approvedPatterns(result.value.projectId)).toEqual([`${NORTHWIND}/*`])
    expect(await anyApprovalMentioning('attacker.example')).toBe(0)
  })

  it('matches on the stored pattern, so a bare hostname in the link still works', async () => {
    // The link says `northwind.example.com`; the buffer holds
    // `https://northwind.example.com`. Comparing raw strings would drop a site
    // the person really had been reading.
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      ['northwind.example.com'],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.discardedOrigins).toBe(0)
    expect(await approvedPatterns(result.value.projectId)).toEqual([`${NORTHWIND}/*`])
    // And the pages still arrive, which is what a raw-string match would have
    // silently lost.
    expect(result.value.carriedOver).toBe(1)
  })

  it('approves nothing when the thread is unknown, even for a site being browsed', async () => {
    /**
     * The hole an earlier fix left open.
     *
     * Falling back to "every origin in the window" when no signature arrived
     * sounded conservative and was not: every honest caller supplies one, so the
     * fallback was reachable only by a link that left it out — and it handed
     * that link any site the person had touched in the last half hour. Here
     * northwind IS in the buffer, and it still must not be approved, because
     * nothing ties it to the work this link claims to be about.
     */
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    const before = await anyApprovalMentioning('northwind.example.com')

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND],
      'deep-research',
      'a-signature-nobody-recorded',
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem.code).toBe('invalid-input')
    expect(await anyApprovalMentioning('northwind.example.com')).toBe(before)
  })

  it('approves nothing when the link carries no thread at all', async () => {
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    const before = await anyApprovalMentioning('northwind.example.com')

    const result = await actions.startFromSuggestion('Northwind partners', [NORTHWIND], 'deep-research')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem.code).toBe('invalid-input')
    expect(await anyApprovalMentioning('northwind.example.com')).toBe(before)
  })

  it('approves nothing for a site outside the thread, however recently it was read', async () => {
    // Two sites in the buffer, one thread covering only the first. The second
    // was genuinely browsed and is still not part of this work.
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    seen('https://mail.example.com/inbox', 'https://mail.example.com')
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND, 'https://mail.example.com'],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.discardedOrigins).toBe(1)
    expect(await approvedPatterns(result.value.projectId)).toEqual([`${NORTHWIND}/*`])
    expect(await anyApprovalMentioning('mail.example.com')).toBe(0)
  })

  it('files every carried page under the site it actually came from', async () => {
    /**
     * A skipped site used to poison every site after it.
     *
     * The sources were collected into an array that only grew when an origin
     * survived, and then zipped POSITIONALLY back against the full requested
     * list. One skip and the two ran out of step: from that point on each site
     * was paired with the id belonging to the previous surviving one, so
     * carried-over pages were filed under a site they had never been on — or
     * dropped outright once the index ran past the end of the array.
     *
     * Filtering unobserved sites makes skips ordinary rather than exotic, which
     * is why this is asserted rather than reasoned about: the map is now built
     * inside the loop, keyed by the pattern actually approved.
     *
     * The skipped site is deliberately FIRST, so a positional zip would
     * mis-attribute everything that follows it.
     */
    const TRADE = 'https://trade.example.com'
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    seen(`${TRADE}/terms`, TRADE)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`, `${TRADE}/terms`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      [ATTACKER, NORTHWIND, TRADE],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.discardedOrigins).toBe(1)
    expect(result.value.carriedOver).toBe(2)

    const carried = await carriedPages(result.value.sessionId)
    expect(carried).toHaveLength(2)
    for (const page of carried) {
      // The site a page is filed under must be the site the page is on.
      expect(page.filedUnder).toBe(`${new URL(page.url).origin}/*`)
    }
  })

  it('files pages correctly when the link spells the site without a scheme', async () => {
    // The same attribution, through the other path that used to lose it: a link
    // saying `northwind.example.com` never matched an observation's
    // `https://northwind.example.com`, so the site was approved and then none of
    // its pages were carried — silently, with a session that looked started.
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      ['northwind.example.com'],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    const carried = await carriedPages(result.value.sessionId)
    expect(carried).toEqual([{ url: `${NORTHWIND}/partners`, filedUnder: `${NORTHWIND}/*` }])
  })

  it('says a session is already running rather than blaming the sites', async () => {
    // Starting a session empties the buffer, so a second click on the same link
    // finds nothing observed. The person needs telling about the session they
    // already have, not about a buffer they cannot see.
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const first = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND],
      'deep-research',
      THREAD,
    )
    expect(first.ok).toBe(true)

    const again = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND],
      'deep-research',
      THREAD,
    )

    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.problem.code).toBe('already-done')
  })

  it('counts a malformed site as a discard rather than ignoring it', async () => {
    seen(`${NORTHWIND}/partners`, NORTHWIND)
    stores.ambientStore().rememberThread(THREAD, [`${NORTHWIND}/partners`])

    const result = await actions.startFromSuggestion(
      'Northwind partners',
      [NORTHWIND, 'not a site at all'],
      'deep-research',
      THREAD,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.discardedOrigins).toBe(1)
  })
})
