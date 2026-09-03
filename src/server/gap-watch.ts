/**
 * The clock that turns extension silence into a gap row.
 *
 * ── Why this file exists at all ──────────────────────────────────────────
 *
 * `sweepForGap` in `./gap-sweeper.ts` has been correct and tested since the
 * capture work landed, and nothing ever called it.
 * `tests/reachability.test.ts` asserted that absence deliberately, in the
 * *deferred, and asserted as deferred* block, with the consequence spelled out:
 * with no caller the `service_worker_terminated` reason is unreachable, and so
 * is `machine_slept` — two of the four gap reasons were unwritable.
 *
 * A gap reason that cannot occur is worse than one that is missing, because the
 * timeline reads as continuous when the truth is that nobody was watching.
 *
 * ── Why the clock lives in the app process and not the worker ────────────
 *
 * The store this reads is `captureStore()`, which is per-process, in memory and
 * hung off `globalThis` (see `./capture-store.ts`). The worker is a SEPARATE OS
 * process (ADR-0001) and cannot see it — a sweep there would read an empty
 * store and report nothing, for ever, which is exactly the failure this file is
 * closing rather than a new one.
 *
 * ── Why it is bound to the session and not to process start ──────────────
 *
 * The obvious home was `build()` in `./db.ts`, and it is wrong twice. It would
 * make `db.ts` import `capture-store.ts`, which imports `extension-pairing.ts`,
 * which imports `db.ts` — a cycle through the app's composition root. And it
 * would run a timer for the whole life of a process that spends most of it with
 * no session at all.
 *
 * So the lifetime is the session's: `startSession` starts this, `endSession`
 * stops it. `sweepForGap` already returns `false` when nothing is live, so a
 * stray tick is inert rather than wrong — the binding is about not running a
 * timer nobody needs, not about correctness.
 *
 * ── The clock is also the sensor ─────────────────────────────────────────
 *
 * ~~It does not make `machine_slept` writable. That reason needs something that
 * can tell a slept machine from a dead service worker, and elapsed time alone
 * cannot: both look identical from here. This file closes one of the two
 * unreachable reasons and leaves the other exactly as unreachable as it was.~~
 *
 * **Corrected 2026-09-03
 * ([ADR-0033](../../docs/adr/0033-a-late-tick-is-a-slept-machine.md)):** it
 * does now, and the thing that made it possible was already in this file. The
 * struck paragraph is right about *elapsed time* and wrong about what this
 * timer knows. Elapsed silence is the extension's clock and it is ambiguous.
 * **The lateness of this interval's own tick is ours**, and it is not: a dead
 * service worker does not stop the app process being scheduled, and a suspended
 * machine stops everything. So each tick is sampled by
 * `createSuspensionDetector` before anything else happens, and a tick that
 * arrives a minute or more past its period is handed to the sweeper as proof
 * that nobody was watching over that window.
 *
 * `src/server/suspension.ts` states what this cannot separate — a stopped
 * process, and a wall clock stepped forward — and neither is a thing that
 * happens on a machine doing ordinary work.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not survive a process restart mid-session. A dev-server reload
 * clears the interval along with everything else on `globalThis`; the next
 * session start re-arms it, and a gap that opened during the reload is recorded
 * on the first tick after it if the extension is still silent.
 */

import { sweepForGap } from './gap-sweeper'
import { captureStore } from './capture-store'
import { createSuspensionDetector, type Suspension } from './suspension'
import { existingAppContext } from './db'
import { sayCaptureGap } from './thread'

/**
 * Well inside `HEARTBEAT_GRACE_MS` (75s), so a gap is noticed within about half
 * a grace period of becoming one.
 *
 * Not tighter, because `detectGap` marks a gap open when it reports it and a
 * second call returns `null` until a heartbeat closes it — so a faster clock
 * buys latency on the first report and nothing else, at the cost of waking a
 * SQLite file that has nothing to do.
 */
export const GAP_SWEEP_INTERVAL_MS = 30_000

/**
 * How late a tick has to be before the lateness is evidence of a suspension —
 * two whole periods past the one it was scheduled for.
 *
 * Derived rather than typed, so there is one number here and it is the interval
 * above. The size is chosen against what else can make a timer late: scheduler
 * jitter and a contended SQLite write are milliseconds, and this process does
 * not block its own loop for a minute while it is running.
 */
export const SUSPENSION_TOLERANCE_MS = GAP_SWEEP_INTERVAL_MS * 2

declare global {
  // eslint-disable-next-line no-var
  var __propositumGapWatch: ReturnType<typeof setInterval> | undefined
  // eslint-disable-next-line no-var
  var __propositumSuspensionDetector: ReturnType<typeof createSuspensionDetector> | undefined
}

/**
 * One pass, swallowing whatever it hits.
 *
 * **This is the one seam in the file that is not a value**, and it is worth
 * naming rather than leaving to the `catch`. Everywhere else in this repository
 * failures are values — `ActionResult`, `BoundaryResult`, `AppendResult`. Here
 * the caller is a timer, so there is nobody to return a value TO, and a
 * rejected promise out of a `setInterval` callback is an unhandled rejection
 * that can take the app process down.
 *
 * What that costs, stated: a database error while recording a gap is logged and
 * dropped. The gap stays open in the store, so the NEXT tick tries again — the
 * loss is bounded at one interval per failure rather than at the whole gap.
 *
 * ── `existingAppContext`, never `appContext` ─────────────────────────────
 *
 * The same rule `countQuietly` follows, for the same reason and stated in full
 * in `./db.ts`: **a sweep may write to a database somebody else opened, and may
 * never open one.** `appContext()` here would take `DATABASE_URL` from `.env`
 * and open the developer's real `propositum.db` from a timer — in a vitest
 * worker that is how a test file with no idea a sweeper exists ends up writing
 * gap rows into the file the eval harness reports from.
 *
 * It costs nothing real, because the only caller is `startSession`, which has
 * already awaited `appContext()` several lines earlier. A context always exists
 * by the time this ticks; if one somehow does not, the sweep is inert, which is
 * the correct behaviour for a process with no session in it.
 */
async function sweepOnce(suspension: Suspension | null): Promise<void> {
  try {
    const context = await existingAppContext()
    if (!context) return
    await sweepForGap({
      store: captureStore(),
      ledger: context.ledger,
      now: () => Date.now(),
      ...(suspension === null ? {} : { suspension }),
      // ADR-0021's "a CaptureGap while away", and the thread's third feed. It
      // decides for itself whether the session is away and whether anything is
      // paired, and swallows its own failures — so a phone that cannot be
      // reached costs the sweep nothing, and the row is written by the time it
      // runs.
      say: (sessionId) => sayCaptureGap(context, sessionId),
    })
  } catch (error) {
    console.error(
      `[gap-watch] sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * Arm the clock. Idempotent — two sessions started back to back must not leave
 * two intervals running, and `globalThis` is what survives Next's hot reload.
 */
export function startGapWatch(): void {
  if (globalThis.__propositumGapWatch) return

  const detector = createSuspensionDetector({
    intervalMs: GAP_SWEEP_INTERVAL_MS,
    toleranceMs: SUSPENSION_TOLERANCE_MS,
  })
  // On `globalThis` for the same reason the timer is, and for one more: it is
  // how a test can see that the detector dies with the timer rather than
  // outliving it into the next session. The tick reads the closure.
  globalThis.__propositumSuspensionDetector = detector

  // Sampled synchronously, in the callback rather than inside `sweepOnce`, so
  // the reading is when the timer fired and not when a database happened to
  // answer. An await between the two would be measuring ourselves.
  const timer = setInterval(
    () => void sweepOnce(detector.sample(Date.now())),
    GAP_SWEEP_INTERVAL_MS,
  )
  // Never hold the process open for this. A sweep is housekeeping.
  timer.unref?.()
  globalThis.__propositumGapWatch = timer
}

/**
 * Disarm it. Safe to call when nothing is armed.
 *
 * The detector goes with the timer rather than outliving it. Its whole state is
 * the previous tick's reading, and that reading only means anything while the
 * timer that took it is still running — kept across a disarm, it would compare
 * the first tick of the next session against a moment before the app went idle
 * and report the idle as sleep.
 */
export function stopGapWatch(): void {
  globalThis.__propositumSuspensionDetector = undefined
  if (!globalThis.__propositumGapWatch) return
  clearInterval(globalThis.__propositumGapWatch)
  globalThis.__propositumGapWatch = undefined
}
