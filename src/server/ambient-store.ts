/**
 * What Propositum has seen while no session is running.
 *
 * ── The privacy shape, stated once ───────────────────────────────────────
 *
 * This is the part of the product that watches without being asked, so the
 * constraints on it are the ones worth being loud about:
 *
 *   - **In memory only.** Nothing here touches SQLite. It dies with the
 *     process, and there is no path by which it can outlive one. The ledger
 *     still means "the record of a session", which is what makes
 *     `ObservationEvent` interpretable at all.
 *   - **Metadata only.** A cleaned URL, a title, dwell and scroll. There is no
 *     field for page text, and the 2,000-character excerpt begins only after a
 *     session starts. A test asserts the shape so this cannot drift.
 *   - **Bounded twice** — by a rolling time window and by a hard row cap, so a
 *     day of browsing cannot accumulate into a profile.
 *   - **Discarded by default.** Declining an offer clears it. Accepting one
 *     folds it into the new session, where it becomes a normal, auditable
 *     ObservationEvent with the ordinary rules applying.
 *
 * ── Why "discarded" is the honest word ───────────────────────────────────
 *
 * `clear()` drops the reference. Node may hold the memory until it collects,
 * and this cannot promise otherwise — so it does not claim to erase, only to
 * forget. The stronger guarantee is the one above it: none of this was ever
 * written down.
 */

import { FAST_DETECT, WINDOW_MS } from '../domain/detection/detect'
import type { AmbientObservation, PauseDetected, WorkDetected } from '../domain/detection/detect'

/**
 * A hard ceiling independent of the window.
 *
 * The window alone is not a bound: a busy hour could hold thousands of rows and
 * still be "the last 30 minutes". This makes the worst case a number someone
 * can reason about.
 */
export const MAX_OBSERVATIONS = 500

/** Once declined, stay quiet about the same origin for this long. */
export const SNOOZE_MS = 60 * 60_000

export interface AmbientStore {
  /** Record one ambient observation. Trims by window and cap on the way in. */
  record(observation: AmbientObservation, nowMs: number): void
  /** Everything still inside the window, oldest first. */
  since(nowMs: number): readonly AmbientObservation[]
  /** Forget everything. Called on decline, on session start, and on stop. */
  clear(): void
  /** Stop offering for this origin until the snooze expires. */
  decline(origin: string, nowMs: number): void
  isSnoozed(origin: string, nowMs: number): boolean
  /** Observations for one origin, for folding into a session on accept. */
  forOrigin(origin: string, nowMs: number): readonly AmbientObservation[]
  size(): number
}

export function createAmbientStore(): AmbientStore {
  let observations: AmbientObservation[] = []
  const declined = new Map<string, number>()

  const trim = (nowMs: number) => {
    observations = observations.filter((o) => nowMs - o.at <= WINDOW_MS)
    if (observations.length > MAX_OBSERVATIONS) {
      // Drop the oldest. Recent activity is what a detection is about.
      observations = observations.slice(observations.length - MAX_OBSERVATIONS)
    }
  }

  return {
    record(observation, nowMs) {
      observations.push(observation)
      trim(nowMs)
    },

    since(nowMs) {
      trim(nowMs)
      return observations
    },

    clear() {
      observations = []
    },

    decline(origin, nowMs) {
      declined.set(origin, nowMs)
      // Declining is also a statement that what was seen was not work. Keeping
      // it would mean the next detection fires off the same evidence.
      observations = observations.filter((o) => o.origin !== origin)
    },

    isSnoozed(origin, nowMs) {
      const at = declined.get(origin)
      return at !== undefined && nowMs - at < SNOOZE_MS
    },

    forOrigin(origin, nowMs) {
      trim(nowMs)
      return observations.filter((o) => o.origin === origin)
    },

    size: () => observations.length,
  }
}

/* ── the suggestion the person actually sees ───────────────────────────── */

/**
 * An offer, never an action.
 *
 * Detection produces one of these and stops. Starting a session and handing
 * over both remain human acts — `SessionPhase` says only a human act ends a
 * session, and the same reasoning applies to starting one. A product that
 * silently began recording because it thought you looked busy would be the
 * thing the founding brief's exclusion list was refusing.
 */
export type Suggestion =
  | {
      readonly kind: 'start-session'
      readonly origin: string
      /** Rendered verbatim. Says what was seen, never what it means. */
      readonly sentence: string
      readonly because: string
      readonly detected: WorkDetected
    }
  | {
      readonly kind: 'hand-off'
      readonly sentence: string
      readonly because: string
      readonly detected: PauseDetected
    }

/** Said out loud, because a suggestion produced under shortened test thresholds
 *  must not read like one produced by real work. */
const UNDER_TEST = FAST_DETECT ? ' (fast-detect is on — thresholds are 20× shorter than normal.)' : ''

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function describeWork(detected: WorkDetected): Suggestion {
  const host = hostOf(detected.origin)
  const focus = detected.focus ? ` — mostly ${detected.focus}` : ''

  return {
    kind: 'start-session',
    origin: detected.origin,
    sentence: `You have been reading ${host}${focus}.`,
    because:
      detected.because === 'query-then-reading'
        ? `You searched there and then read ${detected.pages} pages, for ${minutes(detected.engagedMs)}.${UNDER_TEST}`
        : `${detected.pages} pages, ${minutes(detected.engagedMs)} of reading.${UNDER_TEST}`,
    detected,
  }
}

export function describePause(detected: PauseDetected): Suggestion {
  return {
    kind: 'hand-off',
    sentence: 'You have stepped away.',
    because: `${minutes(detected.workedMs)} of work, then quiet for ${minutes(detected.idleForMs)}.${UNDER_TEST}`,
    detected,
  }
}
