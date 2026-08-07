/**
 * Turning silence into a recorded gap.
 *
 * The extension's service worker cannot report its own death. So the app polls:
 * if no heartbeat has arrived within the grace period, that silence becomes a
 * `captureGap` with reason `service_worker_terminated`.
 *
 * Recorded ONCE per silence, not once per poll — otherwise a five-minute
 * outage would fill the timeline with identical gaps and the person would learn
 * nothing from any of them.
 */

import type { CaptureSessionStore } from './capture-session'
import type { LedgerWriter } from '../persistence/ledger-writer'

export interface GapSweeperDeps {
  readonly store: CaptureSessionStore
  readonly ledger: LedgerWriter
  readonly now: () => number
}

/** One pass. Returns true when a gap was recorded. */
export async function sweepForGap(deps: GapSweeperDeps): Promise<boolean> {
  const live = deps.store.current()
  if (!live) return false

  const gap = deps.store.detectGap(deps.now())
  if (!gap) return false

  await deps.ledger.recordGap({
    sessionId: live.sessionId,
    reason: 'service_worker_terminated',
    startedAtElapsedMs: gap.startedAtElapsedMs,
    endedAtElapsedMs: gap.endedAtElapsedMs,
    observedAt: new Date(deps.now()),
  })

  return true
}
