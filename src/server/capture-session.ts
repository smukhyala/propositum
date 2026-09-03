/**
 * Which session is being captured, and whether the extension is still alive.
 *
 * ── Why the heartbeat matters more than it looks ─────────────────────────
 *
 * The MV3 service worker dies constantly. When it does, it cannot tell us — a
 * dead process reports nothing. So a gap is detected by **absence of a
 * signal**: the extension heartbeats every 30 seconds, and if we have not heard
 * from it in longer than the threshold, that silence becomes a `captureGap`
 * with reason `service_worker_terminated`.
 *
 * This is the whole reason `captureGap` is a first-class event rather than an
 * inferred hole. A hole indistinguishable from inactivity makes inference
 * confidently report a lull that never happened.
 *
 * **Silence alone does not say WHY** *(2026-09-03,
 * [ADR-0033](../../docs/adr/0033-a-late-tick-is-a-slept-machine.md))*. A slept
 * machine produces exactly the same silence as a dead service worker, which is
 * why `machine_slept` was a reason no row could carry for as long as this store
 * had only the heartbeat to go on. `noteSuspension` is the second input: the
 * app process noticing that its own clock stopped being serviced. Nothing here
 * infers sleep from the heartbeat, and it never should — the two are
 * indistinguishable from this side.
 *
 * ── State lives in memory on purpose ─────────────────────────────────────
 *
 * The live token and last-heartbeat are per-process and short-lived. Persisting
 * them would mean a stale token surviving a restart, and a restart is exactly
 * when a session should be re-established rather than silently resumed.
 */

import { randomBytes } from 'node:crypto'

import { createNavigationClassifier } from '../capture/semantics'
import type { NavigationClassifier } from './capture-adapter'

/** Two missed heartbeats. One can be a slow flush; two means it died. */
export const HEARTBEAT_GRACE_MS = 75_000

export interface LiveSession {
  readonly sessionId: string
  readonly token: string
  readonly startedAtMs: number
  lastHeartbeatMs: number
  /** Set while a gap is open, so we record one gap rather than one per poll. */
  gapOpenedAtMs: number | null
  /**
   * How far along we have already told the person we were not watching.
   *
   * A sleep gap is recorded from the suspension itself rather than from
   * silence, so without this the same minutes would be reported a second time
   * as `service_worker_terminated` the moment the grace period passed. It is
   * kept beside `lastHeartbeatMs` rather than folded into it because the two
   * mean different things: one is when we last heard from the extension, the
   * other is what we have already said about the quiet since.
   */
  accountedThroughMs: number
  /**
   * Memory of which pages this sitting has already seen, so a second visit is
   * `returnedTo` rather than another `visited`.
   *
   * It lives here because the distinction is only meaningful within one
   * sitting, and because route handlers are stateless — a classifier built per
   * request would report every page as new forever. Dying with the session is
   * the correct lifetime, not a limitation.
   */
  readonly navigation: NavigationClassifier
}

export interface CaptureSessionStore {
  start(sessionId: string, nowMs: number): LiveSession
  current(): LiveSession | null
  heartbeat(nowMs: number): void
  end(): void
  /**
   * Has the extension gone quiet? Returns the gap to record, once, and marks it
   * open so a second poll does not record it again.
   */
  detectGap(nowMs: number): { startedAtElapsedMs: number; endedAtElapsedMs: number } | null
  /** Called when a heartbeat arrives after silence — closes an open gap. */
  closeGap(): void
  /**
   * This process was not running between these two readings, so nothing was
   * being watched. Returns the gap to record — clamped to the last heartbeat,
   * so it never contradicts an event the ledger already holds — or `null` when
   * there is no session, or when the window is one we have already reported.
   */
  noteSuspension(
    startedMs: number,
    endedMs: number,
  ): { startedAtElapsedMs: number; endedAtElapsedMs: number } | null
}

export function createCaptureSessionStore(): CaptureSessionStore {
  let live: LiveSession | null = null

  return {
    start(sessionId, nowMs) {
      live = {
        sessionId,
        // 32 bytes — the extension holds it in session storage and a page never
        // sees it, but a guessable token would make the other three transport
        // controls carry all the weight.
        token: randomBytes(32).toString('base64url'),
        startedAtMs: nowMs,
        lastHeartbeatMs: nowMs,
        gapOpenedAtMs: null,
        accountedThroughMs: nowMs,
        navigation: createNavigationClassifier(),
      }
      return live
    },

    current: () => live,

    heartbeat(nowMs) {
      if (live) live.lastHeartbeatMs = nowMs
    },

    end() {
      live = null
    },

    detectGap(nowMs) {
      if (!live) return null
      if (live.gapOpenedAtMs !== null) return null // already recorded

      // The later of the two, because a window already reported as a sleep gap
      // is not silence we owe the person a second sentence about.
      const silentSince = Math.max(live.lastHeartbeatMs, live.accountedThroughMs)
      const silentFor = nowMs - silentSince
      if (silentFor < HEARTBEAT_GRACE_MS) return null

      live.gapOpenedAtMs = silentSince
      return {
        startedAtElapsedMs: silentSince - live.startedAtMs,
        endedAtElapsedMs: nowMs - live.startedAtMs,
      }
    },

    closeGap() {
      if (live) live.gapOpenedAtMs = null
    },

    noteSuspension(startedMs, endedMs) {
      if (!live) return null

      const from = Math.max(startedMs, live.lastHeartbeatMs, live.accountedThroughMs)
      if (endedMs <= from) return null

      live.accountedThroughMs = endedMs
      // Whatever silence was open ran into the sleep and has been reported as
      // far as the wake. If the extension is still gone, that is a fresh
      // silence and it earns its own grace period rather than inheriting one.
      live.gapOpenedAtMs = null

      return {
        startedAtElapsedMs: from - live.startedAtMs,
        endedAtElapsedMs: endedMs - live.startedAtMs,
      }
    },
  }
}
