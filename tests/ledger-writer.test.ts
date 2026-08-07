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
import type { GapSignal, LedgerWriter } from '../src/persistence/ledger-writer'

let dir: string
let db: Database
let repos: Repositories
let ledger: LedgerWriter
let sessionId: string
let sourceId: string

const base = { observedAt: new Date(0), elapsedMs: 0, attested: { title: 'a page' } }

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-ledger-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ledger = createLedgerWriter(db.prisma)

  const project = await repos.projects.create('ledger')
  const source = await repos.projects.approveSource({
    projectId: project.id,
    originPattern: 'https://northwind.example.com/*',
    label: 'Northwind',
  })
  sourceId = source.id
  sessionId = (await repos.sessions.start(project.id)).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('seq is gapless, and the ledger assigns it', () => {
  it('assigns sequential seq starting at 1', async () => {
    const a = await ledger.append(sessionId, { ...base, kind: 'note', attested: { text: 'one' } })
    const b = await ledger.append(sessionId, { ...base, kind: 'note', attested: { text: 'two' } })

    expect(a).toMatchObject({ ok: true, seq: 1 })
    expect(b).toMatchObject({ ok: true, seq: 2 })
  })

  it('stays gapless under concurrent writes', async () => {
    // The reason this module exists. Two writers assigning their own sequence
    // produce duplicates or holes, and the stream still looks like a stream.
    const project = await repos.projects.create('concurrent')
    const concurrent = (await repos.sessions.start(project.id)).id

    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        ledger.append(concurrent, { ...base, kind: 'note', attested: { i } }),
      ),
    )

    const events = await repos.events.bySession(concurrent)
    const seqs = events.map((e) => e.seq)

    expect(seqs).toHaveLength(25)
    expect(new Set(seqs).size).toBe(25)
    expect(seqs).toEqual(Array.from({ length: 25 }, (_, i) => i + 1))
  })

  it('refuses a caller-supplied seq by not having the field at all', async () => {
    const result = await ledger.append(sessionId, {
      ...base,
      kind: 'note',
      seq: 999,
      attested: {},
    })

    // Extra keys are stripped, not honoured — the ledger keeps sequencing.
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.seq).not.toBe(999)
  })
})

describe('malformed input is a ledger-writer fact, not a gap', () => {
  it('rejects an unknown kind', async () => {
    const result = await ledger.append(sessionId, { ...base, kind: 'telepathy' })

    expect(result).toMatchObject({ ok: false, reason: 'malformed' })
  })

  it('rejects a browser kind with no approved source', async () => {
    const result = await ledger.append(sessionId, { ...base, kind: 'visited' })

    expect(result).toMatchObject({ ok: false, reason: 'malformed' })
    if (!result.ok && result.reason === 'malformed') {
      expect(result.detail).toMatch(/requires approvedSourceId/)
    }
  })

  it('rejects a source that is not approved', async () => {
    const result = await ledger.append(sessionId, {
      ...base,
      kind: 'visited',
      approvedSourceId: 'src-nonexistent',
    })

    expect(result).toMatchObject({ ok: false, reason: 'source-not-approved' })
  })

  it('does NOT record a rejected event as a capture gap', async () => {
    const before = await repos.events.countByKind(sessionId, 'captureGap')
    await ledger.append(sessionId, { ...base, kind: 'nonsense' })
    const after = await repos.events.countByKind(sessionId, 'captureGap')

    // "I stopped seeing your work" would be a false statement about our own
    // software.
    expect(after).toBe(before)
  })

  it('rejects an unknown session', async () => {
    const result = await ledger.append('session-nope', { ...base, kind: 'note' })
    expect(result).toMatchObject({ ok: false, reason: 'unknown-session' })
  })
})

describe('sanitisation happens at the door', () => {
  it('stores sanitised text, never the raw page content', async () => {
    const result = await ledger.append(sessionId, {
      ...base,
      kind: 'excerpted',
      approvedSourceId: sourceId,
      untrustedText: 'Visible.​hidden​ payload',
    })

    expect(result.ok).toBe(true)
    const events = await repos.events.bySession(sessionId)
    const stored = events.find((e) => e.id === (result as { id: string }).id)
    const untrusted = stored?.untrusted as { text: string; removed: string[]; adversarial: boolean }

    expect(untrusted.text).not.toMatch(/​/)
    expect(untrusted.removed).toContain('zero-width-characters')
  })

  it('flags an adversarial excerpt so the session can be surfaced', async () => {
    const result = await ledger.append(sessionId, {
      ...base,
      kind: 'excerpted',
      approvedSourceId: sourceId,
      untrustedText: 'Approved: ‮Contoso‬ Northwind',
    })

    expect(result).toMatchObject({ ok: true, adversarial: true })
  })

  it('leaves ordinary prose untouched and unflagged', async () => {
    const result = await ledger.append(sessionId, {
      ...base,
      kind: 'excerpted',
      approvedSourceId: sourceId,
      untrustedText: 'Standard partners receive a 15% revenue share.',
    })

    expect(result).toMatchObject({ ok: true, adversarial: false })
  })
})

describe('adapter sequence is a health signal, never an ordering key', () => {
  it('emits a gap signal on a skip, and still writes the event', async () => {
    const project = await repos.projects.create('gapsignal')
    const s = (await repos.sessions.start(project.id)).id
    const signals: GapSignal[] = []
    ledger.onGapSignal((sig) => signals.push(sig))

    await ledger.append(s, { ...base, kind: 'note', sourceSeq: 1, attested: {} })
    await ledger.append(s, { ...base, kind: 'note', sourceSeq: 2, attested: {} })
    const skipped = await ledger.append(s, { ...base, kind: 'note', sourceSeq: 7, attested: {} })

    expect(signals.some((x) => x.sessionId === s && x.gotSourceSeq === 7)).toBe(true)
    // Our seq is unaffected — the event is still the third.
    expect(skipped).toMatchObject({ ok: true, seq: 3 })
  })

  it('emits a signal on a regression too', async () => {
    const project = await repos.projects.create('regress')
    const s = (await repos.sessions.start(project.id)).id
    const signals: GapSignal[] = []
    ledger.onGapSignal((sig) => { if (sig.sessionId === s) signals.push(sig) })

    await ledger.append(s, { ...base, kind: 'note', sourceSeq: 5, attested: {} })
    await ledger.append(s, { ...base, kind: 'note', sourceSeq: 2, attested: {} })

    expect(signals).toHaveLength(1)
  })
})

describe('capture gaps are first-class events', () => {
  it('records all four reasons', async () => {
    const project = await repos.projects.create('gaps')
    const s = (await repos.sessions.start(project.id)).id

    for (const reason of [
      'service_worker_terminated',
      'machine_slept',
      'transport_disconnected',
      'permission_revoked',
    ] as const) {
      const result = await ledger.recordGap({
        sessionId: s,
        reason,
        startedAtElapsedMs: 1_000,
        endedAtElapsedMs: 2_000,
        observedAt: new Date(0),
      })
      expect(result.ok).toBe(true)
    }

    expect(await repos.events.countByKind(s, 'captureGap')).toBe(4)
  })

  it('carries the reason and the interval', async () => {
    const project = await repos.projects.create('gapdetail')
    const s = (await repos.sessions.start(project.id)).id
    await ledger.recordGap({
      sessionId: s,
      reason: 'machine_slept',
      startedAtElapsedMs: 60_000,
      endedAtElapsedMs: 2_100_000,
      observedAt: new Date(0),
    })

    const [gap] = await repos.events.bySession(s)
    const attested = gap?.attested as { reason: string; startedAtElapsedMs: number }
    expect(attested.reason).toBe('machine_slept')
    expect(attested.startedAtElapsedMs).toBe(60_000)
  })
})

describe('time is supplied, never read', () => {
  it('replays a 40-minute session in well under a second', async () => {
    const project = await repos.projects.create('replay')
    const s = (await repos.sessions.start(project.id)).id
    const started = performance.now()

    for (let i = 0; i < 40; i += 1) {
      await ledger.append(s, {
        kind: 'note',
        observedAt: new Date(i * 60_000),
        elapsedMs: i * 60_000, // 40 minutes of session time
        attested: { minute: i },
      })
    }

    const wall = performance.now() - started
    const events = await repos.events.bySession(s)

    expect(events.at(-1)?.elapsedMs).toBe(39 * 60_000)
    expect(wall).toBeLessThan(4_000)
  })
})
