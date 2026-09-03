/**
 * The capture session store and the gap sweeper.
 *
 * Route handlers are thin — they call `admit()` (tested in capture.test.ts) and
 * the ledger writer (tested in ledger-writer.test.ts). What is worth testing
 * here is the thing neither of those covers: **a gap is detected by silence**,
 * because a dead service worker cannot report its own death.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest'
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
import {
  GAP_SWEEP_INTERVAL_MS,
  SUSPENSION_TOLERANCE_MS,
  startGapWatch,
  stopGapWatch,
} from '../src/server/gap-watch'
import { createSuspensionDetector } from '../src/server/suspension'
import { existingAppContext } from '../src/server/db'

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

  /**
   * The thread is told AFTER the row, once per pass, and only when a row went.
   *
   * `sayCaptureGap` sat exported and uncalled from 2026-08-26 to 2026-09-03 —
   * a message asserted as sent that nothing could send. The wire is this
   * callback; what it says, and whether the session is away, is
   * `tests/thread-channel.test.ts`'s to prove.
   */
  it('tells the caller which session a gap was recorded for, and only then', async () => {
    const project = await repos.projects.create('a gap, said')
    const fresh = (await repos.sessions.start(project.id)).id
    const store = createCaptureSessionStore()
    store.start(fresh, 0)
    const said: string[] = []
    const say = async (id: string) => {
      // By the time this runs the row exists, so a phone is never told about a
      // gap the ledger refused.
      const events = await repos.events.bySession(fresh)
      expect(events.some((e) => e.kind === 'captureGap')).toBe(true)
      said.push(id)
    }

    expect(await sweepForGap({ store, ledger, now: () => HEARTBEAT_GRACE_MS + 1, say })).toBe(true)
    expect(said).toEqual([fresh])

    // The same silence on the next tick is not a second gap, and not a second
    // sentence.
    expect(await sweepForGap({ store, ledger, now: () => HEARTBEAT_GRACE_MS + 2_000, say })).toBe(
      false,
    )
    expect(said).toEqual([fresh])
  })

  it('tells the caller once when a pass records two gaps', async () => {
    const store = createCaptureSessionStore()
    store.start(sessionId, 0)
    store.heartbeat(0)
    const said: string[] = []
    const say = async (id: string) => {
      said.push(id)
    }
    const wake = 600_000

    // A slept machine and a service worker that never came back: two rows.
    expect(
      await sweepForGap({
        store,
        ledger,
        now: () => wake + HEARTBEAT_GRACE_MS + 1,
        suspension: { startedAtMs: 1_000, endedAtMs: wake },
        say,
      }),
    ).toBe(true)
    expect(said).toEqual([sessionId])
  })
})

/**
 * Telling a slept machine from a dead service worker.
 *
 * `machine_slept` was a `CaptureGap` reason no row could carry, and the reason
 * was not wiring: from the app's side the two causes produce identical silence.
 * ADR-0033 uses the one clock the app owns rather than the extension's — a tick
 * of the sweep interval that arrives long after its own period proves this
 * process was not being scheduled, and a dead service worker cannot cause that.
 *
 * Every assertion below is about the SEPARATION rather than about the reason
 * string, because a reason that can be produced by guessing is worse than one
 * that cannot be produced at all.
 */
describe('a late tick, and only a late tick, says the machine slept', () => {
  const detector = () =>
    createSuspensionDetector({
      intervalMs: GAP_SWEEP_INTERVAL_MS,
      toleranceMs: SUSPENSION_TOLERANCE_MS,
    })

  it('claims nothing on the first sample, because there is nothing to compare', () => {
    // A process that starts up inside a gap has no reading from before it. The
    // correct answer is silence about the cause, not a guess from one point.
    expect(detector().sample(1_000_000)).toBeNull()
  })

  it('claims nothing while ticks arrive on time', () => {
    const d = detector()
    d.sample(0)

    expect(d.sample(GAP_SWEEP_INTERVAL_MS)).toBeNull()
    expect(d.sample(GAP_SWEEP_INTERVAL_MS * 2 + 400)).toBeNull()
  })

  it('claims nothing for lateness inside the tolerance', () => {
    // Scheduler jitter and a contended SQLite write live here. If this fired,
    // an ordinary busy afternoon would be reported to the person as sleep.
    const d = detector()
    d.sample(0)

    expect(d.sample(GAP_SWEEP_INTERVAL_MS + SUSPENSION_TOLERANCE_MS - 1)).toBeNull()
  })

  it('reports the window when a tick arrives past the tolerance', () => {
    const d = detector()
    d.sample(0)

    const wake = GAP_SWEEP_INTERVAL_MS + SUSPENSION_TOLERANCE_MS + 1
    expect(d.sample(wake)).toEqual({ startedAtMs: 0, endedAtMs: wake })
  })

  it('claims nothing when the wall clock goes backwards', () => {
    // A clock corrected backwards is not negative time and is not sleep.
    const d = detector()
    d.sample(1_000_000)

    expect(d.sample(500_000)).toBeNull()
  })

  it('dies with the timer rather than outliving it into the next session', () => {
    /**
     * The reading only means anything while the timer that took it is running.
     * A detector kept across a disarm would compare the first tick of the next
     * session against a moment before the app went idle, and report however
     * long the person was away as sleep.
     */
    startGapWatch()
    expect(globalThis.__propositumSuspensionDetector).toBeDefined()

    stopGapWatch()
    expect(globalThis.__propositumSuspensionDetector).toBeUndefined()
  })
})

describe('the store turns a suspension into a gap the ledger can hold', () => {
  it('clamps the start to the last heartbeat, so it contradicts no event', () => {
    // We know we heard from the extension at 20s. Saying we stopped watching at
    // 10s would call a row in the ledger a lie.
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    store.heartbeat(20_000)

    expect(store.noteSuspension(10_000, 900_000)).toEqual({
      startedAtElapsedMs: 20_000,
      endedAtElapsedMs: 900_000,
    })
  })

  it('reports nothing when there is no session to attribute it to', () => {
    expect(createCaptureSessionStore().noteSuspension(0, 900_000)).toBeNull()
  })

  it('does not let the same minutes be reported again as silence', () => {
    // The sleep ran through the grace period. Without this the person would be
    // told twice about one absence, with two different causes.
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    store.noteSuspension(0, 900_000)

    expect(store.detectGap(900_000 + HEARTBEAT_GRACE_MS - 1)).toBeNull()
  })

  it('but a silence that outlives the wake is a second, true gap', () => {
    const store = createCaptureSessionStore()
    store.start('s1', 0)
    store.noteSuspension(0, 900_000)

    const after = store.detectGap(900_000 + HEARTBEAT_GRACE_MS + 1)
    expect(after?.startedAtElapsedMs).toBe(900_000)
  })
})

describe('the sweeper attributes the gap it can prove', () => {
  let sleptSessionId: string

  beforeAll(async () => {
    const project = await repos.projects.create('sleep')
    sleptSessionId = (await repos.sessions.start(project.id)).id
  })

  const reasonsIn = async (id: string) =>
    (await repos.events.bySession(id))
      .filter((e) => e.kind === 'captureGap')
      .map((e) => (e.attested as { reason: string }).reason)

  it('records machine_slept when the tick that drove it was late', async () => {
    const store = createCaptureSessionStore()
    store.start(sleptSessionId, 0)

    const recorded = await sweepForGap({
      store,
      ledger,
      now: () => 900_000,
      suspension: { startedAtMs: 0, endedAtMs: 900_000 },
    })

    expect(recorded).toBe(true)
    expect(await reasonsIn(sleptSessionId)).toEqual(['machine_slept'])
  })

  it('records service_worker_terminated for silence with no suspension behind it', async () => {
    /**
     * The assertion that matters most in this file. Elapsed silence is exactly
     * what a slept machine also produces, so if it could reach `machine_slept`
     * on its own the reason would be a guess dressed as a finding.
     */
    const project = await repos.projects.create('silence only')
    const id = (await repos.sessions.start(project.id)).id
    const store = createCaptureSessionStore()
    store.start(id, 0)

    await sweepForGap({ store, ledger, now: () => HEARTBEAT_GRACE_MS * 10 })

    expect(await reasonsIn(id)).toEqual(['service_worker_terminated'])
  })

  it('leaves the reason unattributed when the signal is unavailable', async () => {
    /**
     * A machine where nothing can supply the signal — or a process that
     * restarted inside the gap, so its detector has no earlier reading — writes
     * the reason that was actually observed and never the one about the
     * hardware. Six sweeps of pure silence, and `machine_slept` appears in none
     * of them.
     */
    const project = await repos.projects.create('no signal')
    const id = (await repos.sessions.start(project.id)).id
    const store = createCaptureSessionStore()
    store.start(id, 0)

    const d = createSuspensionDetector({
      intervalMs: GAP_SWEEP_INTERVAL_MS,
      toleranceMs: SUSPENSION_TOLERANCE_MS,
    })

    for (let tick = 1; tick <= 6; tick += 1) {
      const at = tick * GAP_SWEEP_INTERVAL_MS
      const suspension = d.sample(at)
      expect(suspension).toBeNull()
      store.closeGap()
      await sweepForGap({ store, ledger, now: () => at })
    }

    const reasons = await reasonsIn(id)
    expect(reasons).not.toContain('machine_slept')
    expect(reasons.length).toBeGreaterThan(0)
  })

  it('records both when a slept machine wakes to a dead service worker', async () => {
    // Two true gaps with two different causes, written as two rows. Neither is
    // an amendment of the other, which is what an append-only ledger requires.
    const project = await repos.projects.create('slept and stayed quiet')
    const id = (await repos.sessions.start(project.id)).id
    const store = createCaptureSessionStore()
    store.start(id, 0)

    await sweepForGap({
      store,
      ledger,
      now: () => 900_000,
      suspension: { startedAtMs: 0, endedAtMs: 900_000 },
    })
    await sweepForGap({ store, ledger, now: () => 900_000 + HEARTBEAT_GRACE_MS + 1 })

    expect(await reasonsIn(id)).toEqual(['machine_slept', 'service_worker_terminated'])
  })
})

/**
 * The clock that calls the sweeper.
 *
 * `sweepForGap` was correct and tested above from the day it was written, and
 * nothing called it — so `service_worker_terminated` was a reason no row could
 * ever carry. `tests/reachability.test.ts` is what pins the caller's existence;
 * what is worth testing HERE is the two properties that file cannot see.
 *
 * Both are about not doing damage rather than about doing work, which is why
 * neither is covered by the sweeper's own tests: the sweeper is handed its
 * dependencies, and these are the two ways the timer around it could hurt.
 */
describe('the gap watch is armed by a session and disarmed with it', () => {
  afterEach(() => {
    stopGapWatch()
    vi.useRealTimers()
  })

  it('arms once, however many times a session starts', () => {
    startGapWatch()
    const first = globalThis.__propositumGapWatch
    startGapWatch()
    startGapWatch()

    // Two intervals sweeping one store would be two callers racing to record
    // the same silence, and `detectGap` only defends against the second READ —
    // it has no idea two timers exist.
    expect(globalThis.__propositumGapWatch).toBe(first)

    stopGapWatch()
    expect(globalThis.__propositumGapWatch).toBeUndefined()

    // Disarming something already disarmed is not an error. `endSession` runs
    // on a session that may never have armed one.
    stopGapWatch()
    expect(globalThis.__propositumGapWatch).toBeUndefined()
  })

  it('opens no database when a tick finds no context', async () => {
    /**
     * The loaded gun `src/server/db.ts` documents, aimed at this file.
     *
     * `appContext()` would take `DATABASE_URL` from `.env` and open the
     * developer's real `propositum.db` — from a TIMER, in any process that
     * imported this module, including a vitest worker running a file that has
     * no idea a sweeper exists. That is how `npm run eval -- --report` came to
     * print counts its own test suite had manufactured, once already.
     *
     * So the assertion is the absence: with no context built, a tick returns
     * having touched nothing. `existingAppContext()` is what makes that true,
     * and swapping it back to `appContext()` turns this red.
     */
    expect(existingAppContext()).toBeUndefined()

    vi.useFakeTimers()
    startGapWatch()
    await vi.advanceTimersByTimeAsync(GAP_SWEEP_INTERVAL_MS * 3)

    expect(existingAppContext()).toBeUndefined()
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

    await ambientRoute(
      ambientPost([engagement(now, 0), { ...engagement(now, 1), url: 'https://a.example/2' }]),
    )

    expect(
      ambientStore()
        .since(now)
        .map((o) => o.scrollFraction),
    ).toEqual([0, 1])
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

      await ambientRoute(ambientPost([{ ...engagement(now, 0.4), groupTitle: 'world models' }]))

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

      await ambientRoute(ambientPost([{ ...engagement(now, 0.4), groupTitle: '  world models ' }]))

      expect(ambientStore().since(now)[0]?.groupTitle).toBe('world models')
    })
  })

  /**
   * How the page was arrived at — and, more to the point, what does NOT arrive.
   *
   * ── The half of this that is a privacy assertion ─────────────────────────
   *
   * `content.js` has sent `referrer` and `navigationType` on every navigation
   * since the signal existed, and `src/capture/semantics.ts` cleans and stores
   * both — on the SESSION path. This path deliberately takes neither. It takes
   * one of five words computed from them inside the content script.
   *
   * ~~so the URL of the page somebody came from never leaves the page it was
   * read on.~~ **Corrected 2026-08-18, the same day, after review.** It does
   * leave the page: `content.js` cannot know whether a session is running — a
   * page that could time what its own script may do would learn something about
   * the person — so it sends the referrer every time, and the extension's
   * service worker decides. On the no-session branch the worker now deletes it
   * beside page text, and `flushAmbient` never copied it in any case. What this
   * file can assert is the door: **no referrer reaches this endpoint, and if one
   * were sent it would be dropped here.**
   *
   * The last test in this block is therefore not a schema test. It is the one
   * that says a referrer sent to this door is dropped, which is what makes the
   * paragraph above a property rather than an intention.
   *
   * ── And the ordinary half ────────────────────────────────────────────────
   *
   * A `z.enum` over a closed set written in three places — `ARRIVALS` in
   * `content.js`, this schema, and `Arrival` in `detect.ts` — so the failure
   * worth catching is a sixth value drifting in from the browser.
   */
  describe('and how the page was arrived at, without the page they came from', () => {
    const navigation = (at: number, arrival?: unknown) => ({
      at,
      url: 'https://a.example/1',
      title: 'World Models Survey',
      kind: 'navigation',
      ...(arrival === undefined ? {} : { arrival }),
    })

    for (const value of [
      'no-referrer',
      'same-origin',
      'cross-origin',
      'reloaded',
      'back-or-forward',
    ] as const) {
      it(`carries the arrival "${value}" into the buffer`, async () => {
        const now = Date.now()

        const response = await ambientRoute(ambientPost([navigation(now, value)]))
        expect(response.status).toBe(200)

        const held = ambientStore().since(now)
        expect(held).toHaveLength(1)
        expect(held[0]?.arrival).toBe(value)
        // Beside the page it is about, not instead of it.
        expect(held[0]?.url).toBe('https://a.example/1')
      })
    }

    it('refuses a sixth arrival rather than letting the vocabulary widen from the browser', async () => {
      // The whole point of a `z.enum` over a `z.string()`, and the same
      // assertion the exit type gets one block up. `content.js` owns the set at
      // the one place a value leaves it; if it ever invents a member, it is
      // refused here rather than arriving as a string nothing has a case for.
      const now = Date.now()

      const response = await ambientRoute(ambientPost([navigation(now, 'typed')]))

      expect(response.status).toBe(400)
      expect(ambientStore().size()).toBe(0)
    })

    it('refuses a referrer URL smuggled in as an arrival', async () => {
      // The value that must never be on this path, offered in the field built
      // to keep it off. A `z.string()` would have taken it.
      const now = Date.now()

      const response = await ambientRoute(
        ambientPost([navigation(now, 'https://mail.example/inbox/9')]),
      )

      expect(response.status).toBe(400)
      expect(ambientStore().size()).toBe(0)
    })

    it('leaves the arrival absent when none was sent — an unclassified navigation is not a value', async () => {
      // `arrivalOf` returns nothing for a `prerender` entry, for a missing
      // navigation entry, and for a referrer that will not parse. Absent must
      // stay absent rather than defaulting to the member that reads as intent.
      const now = Date.now()

      await ambientRoute(ambientPost([navigation(now)]))

      const held = ambientStore().since(now)
      expect(held).toHaveLength(1)
      expect(held[0]?.arrival).toBeUndefined()
      expect(Object.keys(held[0] ?? {})).not.toContain('arrival')
    })

    it('has nowhere to put a referrer, so one sent anyway is dropped', async () => {
      /**
       * The assertion this whole block exists for.
       *
       * The session path stores a cleaned referrer URL, and that is defensible
       * there: a session is consented, scoped to approved sources, and every
       * row is auditable. This buffer is what Propositum saw while nobody
       * asked, and a referrer names a page the person came FROM — possibly a
       * site nothing else here observes. `ambientSchema` has no field for it,
       * so Zod strips it, and a future hand that adds one has to turn this red
       * first.
       */
      const now = Date.now()

      const response = await ambientRoute(
        ambientPost([
          {
            ...navigation(now, 'cross-origin'),
            referrer: 'https://mail.example/inbox/9',
            navigationType: 'navigate',
          },
        ]),
      )

      expect(response.status).toBe(200)

      const held = ambientStore().since(now)
      expect(held[0]?.arrival).toBe('cross-origin')
      expect(Object.keys(held[0] ?? {})).not.toContain('referrer')
      expect(Object.keys(held[0] ?? {})).not.toContain('navigationType')
      // And not hiding anywhere else in the row either.
      expect(JSON.stringify(held[0])).not.toContain('mail.example')
    })
  })
})
