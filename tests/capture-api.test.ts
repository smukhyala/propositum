/**
 * The capture session store and the gap sweeper.
 *
 * Route handlers are thin — they call `admit()` (tested in capture.test.ts) and
 * the ledger writer (tested in ledger-writer.test.ts). What is worth testing
 * here is the thing neither of those covers: **a gap is detected by silence**,
 * because a dead service worker cannot report its own death.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import type { LedgerWriter } from '../src/persistence/ledger-writer'
import { HEARTBEAT_GRACE_MS, createCaptureSessionStore } from '../src/server/capture-session'
import { sweepForGap } from '../src/server/gap-sweeper'

let dir: string
let db: Database
let repos: Repositories
let ledger: LedgerWriter
let sessionId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-api-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ledger = createLedgerWriter(db.prisma)

  const project = await repos.projects.create('capture api')
  sessionId = (await repos.sessions.start(project.id)).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('the session token', () => {
  it('is unguessable rather than relying on the other three controls', () => {
    const store = createCaptureSessionStore()
    const a = store.start('s1', 0).token
    store.end()
    const b = store.start('s1', 0).token

    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(40)
  })

  it('is gone when the session ends, so a stale one cannot be replayed', () => {
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    store.end()

    expect(store.current()).toBeNull()
  })
})

describe('a gap is detected by silence', () => {
  it('stays quiet while heartbeats arrive', () => {
    const store = createCaptureSessionStore()
    store.start('s1', 0)

    store.heartbeat(30_000)
    expect(store.detectGap(40_000)).toBeNull()
  })

  it('reports a gap once the grace period passes', () => {
    // The service worker cannot tell us it died. Silence is the signal.
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    store.heartbeat(10_000)

    const gap = store.detectGap(10_000 + HEARTBEAT_GRACE_MS + 1)

    expect(gap).not.toBeNull()
    expect(gap?.startedAtElapsedMs).toBe(10_000)
  })

  it('reports it ONCE, not once per poll', () => {
    // A five-minute outage must not fill the timeline with identical gaps.
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    const late = HEARTBEAT_GRACE_MS + 1

    expect(store.detectGap(late)).not.toBeNull()
    expect(store.detectGap(late + 1_000)).toBeNull()
    expect(store.detectGap(late + 60_000)).toBeNull()
  })

  it('can report a second gap after the extension comes back', () => {
    const store = createCaptureSessionStore()
    store.start('s1', 0)

    expect(store.detectGap(HEARTBEAT_GRACE_MS + 1)).not.toBeNull()

    // The extension returns.
    store.heartbeat(HEARTBEAT_GRACE_MS + 2_000)
    store.closeGap()

    expect(store.detectGap(HEARTBEAT_GRACE_MS * 3)).not.toBeNull()
  })
})

describe('the sweeper writes the gap to the ledger', () => {
  it('records a captureGap with service_worker_terminated', async () => {
    const store = createCaptureSessionStore()
    store.start(sessionId, 0)

    const recorded = await sweepForGap({
      store,
      ledger,
      now: () => HEARTBEAT_GRACE_MS + 1,
    })

    expect(recorded).toBe(true)

    const events = await repos.events.bySession(sessionId)
    const gap = events.find((e) => e.kind === 'captureGap')
    expect((gap?.attested as { reason: string })?.reason).toBe('service_worker_terminated')
  })

  it('does nothing when there is no session', async () => {
    const store = createCaptureSessionStore()

    expect(await sweepForGap({ store, ledger, now: () => 10_000_000 })).toBe(false)
  })

  it('does nothing while the extension is healthy', async () => {
    const store = createCaptureSessionStore()
    store.start(sessionId, 0)
    store.heartbeat(1_000)

    expect(await sweepForGap({ store, ledger, now: () => 2_000 })).toBe(false)
  })
})
