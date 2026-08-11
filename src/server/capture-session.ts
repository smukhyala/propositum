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

      const silentFor = nowMs - live.lastHeartbeatMs
      if (silentFor < HEARTBEAT_GRACE_MS) return null

      live.gapOpenedAtMs = live.lastHeartbeatMs
      return {
        startedAtElapsedMs: live.lastHeartbeatMs - live.startedAtMs,
        endedAtElapsedMs: nowMs - live.startedAtMs,
      }
    },

    closeGap() {
      if (live) live.gapOpenedAtMs = null
    },
  }
}
