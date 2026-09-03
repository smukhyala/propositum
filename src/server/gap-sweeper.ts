/**
 * Turning silence — and our own absence — into a recorded gap.
 *
 * The extension's service worker cannot report its own death. So the app polls:
 * if no heartbeat has arrived within the grace period, that silence becomes a
 * `captureGap` with reason `service_worker_terminated`.
 *
 * Recorded ONCE per silence, not once per poll — otherwise a five-minute
 * outage would fill the timeline with identical gaps and the person would learn
 * nothing from any of them.
 *
 * ── The second reason, and why it is not read off the same signal ────────
 *
 * *(2026-09-03, [ADR-0033](../../docs/adr/0033-a-late-tick-is-a-slept-machine.md).)*
 * A slept machine and a dead service worker produce identical silence, so
 * `machine_slept` is never inferred from how long the extension has been quiet.
 * It is written only when the caller hands over a `Suspension` — proof that
 * this process itself stopped being scheduled, which a dead service worker
 * cannot cause.
 *
 * The two are recorded separately and both can happen in one pass: a machine
 * that slept and woke to a service worker that never came back has two true
 * gaps with two different reasons, and neither is an amendment of the other.
 * That matters more than it reads — an `ObservationEvent` is append-only, so a
 * reason decided after the row was written would need an `UPDATE` the ledger
 * refuses. Attribution happens before the write or not at all.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * With no suspension supplied, nothing changes: the gap is recorded with the
 * reason that was actually observed — the extension went quiet — rather than
 * with a guess about the machine. On a platform or a run where the signal never
 * arrives, `machine_slept` simply never occurs, which is the state this file
 * shipped in and the correct fail direction.
 */

import type { CaptureSessionStore } from './capture-session'
import type { Suspension } from './suspension'
import type { LedgerWriter } from '../persistence/ledger-writer'

export interface GapSweeperDeps {
  readonly store: CaptureSessionStore
  readonly ledger: LedgerWriter
  readonly now: () => number
  /**
   * The window the app process was not running, when the tick driving this
   * sweep arrived late enough to prove one. Absent on every ordinary tick.
   */
  readonly suspension?: Suspension
}

/** One pass. Returns true when at least one gap was recorded. */
export async function sweepForGap(deps: GapSweeperDeps): Promise<boolean> {
  const live = deps.store.current()
  if (!live) return false

  let recorded = false

  if (deps.suspension) {
    const slept = deps.store.noteSuspension(
      deps.suspension.startedAtMs,
      deps.suspension.endedAtMs,
    )
    if (slept) {
      await deps.ledger.recordGap({
        sessionId: live.sessionId,
        reason: 'machine_slept',
        startedAtElapsedMs: slept.startedAtElapsedMs,
        endedAtElapsedMs: slept.endedAtElapsedMs,
        observedAt: new Date(deps.now()),
      })
      recorded = true
    }
  }

  // After a suspension this is a fresh silence measured from the wake, not the
  // one that ran through it.
  const gap = deps.store.detectGap(deps.now())
  if (gap) {
    await deps.ledger.recordGap({
      sessionId: live.sessionId,
      reason: 'service_worker_terminated',
      startedAtElapsedMs: gap.startedAtElapsedMs,
      endedAtElapsedMs: gap.endedAtElapsedMs,
      observedAt: new Date(deps.now()),
    })
    recorded = true
  }

  return recorded
}
