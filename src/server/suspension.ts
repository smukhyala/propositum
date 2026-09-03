/**
 * Telling a slept machine from a dead service worker, from inside our own
 * process.
 *
 * ── The problem this closes ──────────────────────────────────────────────
 *
 * `CaptureGap` has four reasons and one of them could never be written.
 * `src/server/gap-sweeper.ts` turns extension silence into a gap, and silence
 * is ambiguous: a dead MV3 service worker and a slept Mac both look like *no
 * heartbeat for N minutes*. So every gap was recorded as
 * `service_worker_terminated`, including the ones where the person had simply
 * closed the lid, and `machine_slept` was a reason no row could carry.
 *
 * ── The signal ───────────────────────────────────────────────────────────
 *
 * The gap watch already runs a `setInterval` on a known period. A timer is not
 * serviced while the machine is suspended, so **a tick that arrives far later
 * than its own period is evidence that this process was not running** — and a
 * process that was not running was not watching anything.
 *
 * That is a different observation from silence, and it is the one that
 * separates the two reasons: a dead service worker does not stop OUR clock. If
 * the tick is on time and the extension is quiet, the extension died. If the
 * tick itself is late, the machine went away and took the browser with it.
 *
 * The inference *"we were suspended, therefore capture stopped"* is sound only
 * because the app and the browser are on the same machine, and that is
 * structural rather than assumed: the extension talks to `127.0.0.1` and the
 * transport pins the `Origin` to the extension id ([ADR-0002](../../docs/adr/0002-observation-capture.md)).
 * There is no arrangement in which the observer is elsewhere.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * - **It cannot separate a suspended machine from a stopped process.** A
 *   `kill -STOP` held for longer than the tolerance reads as sleep, and
 *   [ADR-0025](../../docs/adr/0025-computer-use-beyond-the-browser.md) §2's
 *   kill-switch verification is exactly that command. The gap is real either
 *   way — nothing was watching — but the reason names the wrong cause.
 * - **It cannot separate sleep from a forward step of the wall clock.** A
 *   machine whose clock is corrected forward by more than the tolerance
 *   records a gap it did not have. A step *backwards* is ignored rather than
 *   read as negative time.
 * - **It says nothing about a window it did not span.** The first tick after
 *   this process starts has nothing to compare against, so a suspension that
 *   ended in a restart is not attributed at all — which is the correct fail
 *   direction, and leaves the silence to be recorded as what was actually
 *   observed rather than as a guess about the hardware.
 * - **It does not know when sleep began**, only that it began somewhere inside
 *   the interval before the late tick. The sweeper clamps the start to the last
 *   heartbeat, so the recorded gap never contradicts an event the ledger holds.
 */

/** The window this process was not running, in wall-clock milliseconds. */
export interface Suspension {
  readonly startedAtMs: number
  readonly endedAtMs: number
}

export interface SuspensionDetectorOptions {
  /** The period the driving timer was asked for. */
  readonly intervalMs: number
  /**
   * How late a tick may be before lateness becomes evidence.
   *
   * This is the whole of the false-positive defence and it is a threshold, not
   * a proof. Scheduler jitter, a garbage collection and a contended SQLite
   * write are milliseconds; nothing in this process is late by a minute while
   * still running.
   */
  readonly toleranceMs: number
}

export interface SuspensionDetector {
  /**
   * Feed one tick's wall-clock reading. Returns the window this process was
   * away, or `null` — which is the answer for the first sample, for a tick that
   * arrived on time, and for a clock that moved backwards.
   *
   * A value, never a throw: the caller is a timer and has nobody to catch for
   * it.
   */
  sample(nowMs: number): Suspension | null
}

/**
 * Deliberately stateful and deliberately per-arming.
 *
 * The previous sample is only meaningful while the timer that produced it is
 * still running. A detector kept across a disarm would compare the first tick
 * of the next session against a reading from before the app went idle and
 * report the idle time as sleep — so `stopGapWatch` drops this and
 * `startGapWatch` builds a new one.
 */
export function createSuspensionDetector(
  options: SuspensionDetectorOptions,
): SuspensionDetector {
  let previousMs: number | null = null

  return {
    sample(nowMs) {
      const previous = previousMs
      previousMs = nowMs

      if (previous === null) return null
      if (nowMs <= previous) return null

      const lateBy = nowMs - previous - options.intervalMs
      if (lateBy < options.toleranceMs) return null

      return { startedAtMs: previous, endedAtMs: nowMs }
    },
  }
}
