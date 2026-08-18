/**
 * The capture session store and the gap sweeper.
 *
 * Route handlers are thin — they call `admit()` (tested in capture.test.ts) and
 * the ledger writer (tested in ledger-writer.test.ts). What is worth testing
 * here is the thing neither of those covers: **a gap is detected by silence**,
 * because a dead service worker cannot report its own death.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { POST as ambientRoute } from '../src/app/api/capture/ambient/route'
import { CUSTOM_HEADER } from '../src/capture/transport'
import { ambientStore } from '../src/server/capture-store'
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

/**
 * How far down the page they got, from the wire into the buffer.
 *
 * `content.js` has computed a scroll fraction on every engagement report for as
 * long as the report has existed, and `ambientSchema` had no field for it — so
 * it was dropped on arrival while ADR-0008's decision table and two comments in
 * `detect.ts` all said ambient capture carried "dwell and scroll". Three
 * true-sounding sentences over a discarded field.
 *
 * The route handler is exercised directly rather than through `fetch`, the same
 * way `tests/act-channel.test.ts` drives the control channel: the thing worth
 * pinning is the SCHEMA and the projection into `AmbientObservation`, and a
 * running server would add nothing but flakiness.
 *
 * ── Where this stops, said rather than implied ───────────────────────────
 *
 * `store.since()` is exactly the array `/api/capture/ambient/debug` renders
 * from, so this covers the round trip up to that endpoint's own projection —
 * which aggregates per origin and does not yet emit scroll. That route was out
 * of scope for this change and its one-line addition is owed. Nothing here
 * pretends otherwise.
 */
describe('the ambient path carries how far down the page they got', () => {
  const ambientPost = (observations: readonly unknown[]) =>
    new Request('http://127.0.0.1:3117/api/capture/ambient', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CUSTOM_HEADER]: '1',
        // A forbidden header name, so no page can forge it, and free to a
        // non-browser caller. See src/capture/transport.ts.
        'sec-fetch-site': 'none',
      },
      body: JSON.stringify({ observations }),
    })

  const engagement = (at: number, scrollFraction?: unknown) => ({
    at,
    url: 'https://a.example/1',
    title: 'World Models Survey',
    kind: 'engagement',
    engagedMs: 45_000,
    ...(scrollFraction === undefined ? {} : { scrollFraction }),
  })

  beforeEach(() => {
    // The store is a process-wide singleton hung off globalThis. `clear()` is
    // not enough — a snooze deliberately outlives one — so the honest reset is
    // to drop the instance, as tests/multiple-threads.test.ts does.
    globalThis.__propositumAmbient = undefined
  })

  it('lands a scroll fraction in the buffer the detector reads', async () => {
    const now = Date.now()

    const response = await ambientRoute(ambientPost([engagement(now, 0.62)]))
    expect(response.status).toBe(200)

    const held = ambientStore().since(now)
    expect(held).toHaveLength(1)
    expect(held[0]?.scrollFraction).toBe(0.62)
    // And the field it sits beside is untouched, so this is an addition rather
    // than a reshuffle.
    expect(held[0]?.engagedMs).toBe(45_000)
  })

  it('keeps both ends of the range, because 0 and 1 are real readings', async () => {
    const now = Date.now()

    await ambientRoute(ambientPost([engagement(now, 0), { ...engagement(now, 1), url: 'https://a.example/2' }]))

    expect(ambientStore().since(now).map((o) => o.scrollFraction)).toEqual([0, 1])
  })

  it('leaves the field absent when the sender says nothing, rather than calling it zero', async () => {
    // Absent and zero are different facts — "nobody measured" against "they did
    // not scroll" — and a default would put a navigation and an unscrolled page
    // in the same bucket.
    const now = Date.now()

    await ambientRoute(ambientPost([engagement(now)]))

    const held = ambientStore().since(now)
    expect(held).toHaveLength(1)
    expect(held[0]?.scrollFraction).toBeUndefined()
    expect(Object.keys(held[0] ?? {})).not.toContain('scrollFraction')
  })

  /**
   * A fraction that is not a fraction refuses the batch.
   *
   * The route has no session token — that is the whole reason it accepts
   * metadata only — so the schema is doing more work here than it does on the
   * ledger path. An unbounded "fraction" is the field a hostile or buggy sender
   * puts `1e9` in, and the buffer holds it for the life of the window.
   */
  for (const [name, value] of [
    ['a negative fraction', -0.1],
    ['a fraction above one', 1.5],
    ['a wildly out-of-range number', 1e9],
    ['a number sent as a string', '0.5'],
    ['a null', null],
    ['a boolean', true],
  ] as const) {
    it(`refuses ${name}, and holds nothing`, async () => {
      const now = Date.now()

      const response = await ambientRoute(ambientPost([engagement(now, value)]))

      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ ok: false, reason: 'malformed' })
      // Refusing the batch means refusing all of it. A partial write here would
      // be a row nobody can account for.
      expect(ambientStore().size()).toBe(0)
    })
  }

  it('refuses the whole batch, so one bad row cannot smuggle the rest past', async () => {
    const now = Date.now()

    const response = await ambientRoute(
      ambientPost([engagement(now, 0.5), { ...engagement(now, 42), url: 'https://a.example/2' }]),
    )

    expect(response.status).toBe(400)
    expect(ambientStore().size()).toBe(0)
  })

  /**
   * How the page was left, and what the person called their own tabs. ADR-0013.
   *
   * Same door, same shape of guard, and the same reason it is worth having: the
   * route holds no session token, so the schema is the whole of what stands
   * between a `curl` and the buffer detection is computed from.
   *
   * The two fields are tested together because they arrive together and fail
   * differently. `exitType` is a CLOSED SET written in three places —
   * `EXIT_TYPES` in `content.js`, the `z.enum` here, and `ExitType` in
   * `detect.ts` — and the failure worth catching is a fourth value drifting in
   * from the browser. `groupTitle` is free text a person typed, and the failure
   * worth catching is that it is unbounded.
   */
  describe('and how the page was left, and what the person called it', () => {
    const withExit = (at: number, exitType?: unknown) => ({
      ...engagement(at, 0.4),
      ...(exitType === undefined ? {} : { exitType }),
    })

    for (const value of ['hidden', 'left-cached', 'left-unloaded'] as const) {
      it(`carries the exit type "${value}" into the buffer`, async () => {
        const now = Date.now()

        const response = await ambientRoute(ambientPost([withExit(now, value)]))
        expect(response.status).toBe(200)

        const held = ambientStore().since(now)
        expect(held[0]?.exitType).toBe(value)
        // Beside the two figures it travels with, not instead of them.
        expect(held[0]?.engagedMs).toBe(45_000)
        expect(held[0]?.scrollFraction).toBe(0.4)
      })
    }

    it('refuses a fourth exit type rather than letting the vocabulary widen from the browser', async () => {
      // The whole point of a `z.enum` over a `z.string()`. `content.js` owns the
      // set; if it ever invents a value, it is refused here rather than arriving
      // as a string nothing downstream has a case for. Three authors, one set.
      const now = Date.now()

      const response = await ambientRoute(ambientPost([withExit(now, 'closed')]))

      expect(response.status).toBe(400)
      expect(ambientStore().size()).toBe(0)
    })

    it('leaves the exit absent when none was sent — an interval report is not an exit', async () => {
      const now = Date.now()

      await ambientRoute(ambientPost([withExit(now)]))

      const held = ambientStore().since(now)
      expect(held[0]?.exitType).toBeUndefined()
      expect(Object.keys(held[0] ?? {})).not.toContain('exitType')
    })

    it('carries a tab group title, which is the one thing here the person wrote', async () => {
      const now = Date.now()

      await ambientRoute(
        ambientPost([{ ...engagement(now, 0.4), groupTitle: 'world models' }]),
      )

      expect(ambientStore().since(now)[0]?.groupTitle).toBe('world models')
    })

    it('refuses a group title past the bound rather than truncating it', async () => {
      /**
       * The sender bounds it at 120 too (`AMBIENT_GROUP_TITLE_MAX`), so this can
       * only be hit by a non-browser caller — which is exactly who this route
       * has no token from. Refusing rather than truncating is the same rule the
       * scroll fraction follows: a repair here would let a sender establish a
       * value the schema says is impossible, and the extension's 4xx handling
       * drops a refused batch rather than looping on it.
       */
      const now = Date.now()

      const response = await ambientRoute(
        ambientPost([{ ...engagement(now, 0.4), groupTitle: 'x'.repeat(121) }]),
      )

      expect(response.status).toBe(400)
      expect(ambientStore().size()).toBe(0)
    })

    it('treats a whitespace-only group title as no group title at all', async () => {
      // A label of spaces is not a name somebody authored, and `describeWork`
      // would render it as one — "You have been looking into  ." — which reads
      // as the product losing its place mid-sentence.
      const now = Date.now()

      await ambientRoute(ambientPost([{ ...engagement(now, 0.4), groupTitle: '   ' }]))

      const held = ambientStore().since(now)
      expect(held).toHaveLength(1)
      expect(Object.keys(held[0] ?? {})).not.toContain('groupTitle')
    })

    it('trims a group title, so "  world models " and "world models" are one label', async () => {
      // They have to be, or `authoredLabelOf`'s count splits across two spellings
      // of the same thing and the tie-break picks whichever sorts first.
      const now = Date.now()

      await ambientRoute(
        ambientPost([{ ...engagement(now, 0.4), groupTitle: '  world models ' }]),
      )

      expect(ambientStore().since(now)[0]?.groupTitle).toBe('world models')
    })
  })
})
