/**
 * The machine-wide lifecycle word, for a surface that is not a page.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * ADR-0023's tray app renders one status light, and its table is explicit
 * about where the word comes from: `intentionState()`, *"not a second
 * implementation"*. Home already derives the word per project through
 * `frontDoorRow`; what the light needs is the same derivation folded across
 * every project into one member, because a menu bar has room for one word and
 * a person glancing at it is asking one question — does anything need me.
 *
 * ── Why the fold reuses `frontDoorRow` rather than a factored converter ──
 *
 * The conversion from `IntentionStateFacts` to an `IntentionStateId` — epoch
 * milliseconds, the phases this process can vouch for — lives in
 * `frontDoorRow` and nowhere else, and `tests/reachability.test.ts` holds the
 * project screen to the same rule: one derivation, not two. So this calls
 * `frontDoorRow` per project and keeps only `state`. The `sittings` input is
 * handed an empty list on purpose: it feeds `openUnwatched`, a per-project
 * fact Home renders under a name, and the fold discards it — a light with one
 * word has nowhere truthful to put it.
 *
 * ── The fold, and why `done` is excluded ─────────────────────────────────
 *
 * Precedence is the one `src/domain/intention/state.ts` already argues:
 * `needs-you` outranks everything, then `delegated`, then `working`. `done`
 * is excluded from the fold and the empty machine folds to `sleeping` — a
 * machine-wide *Done* burning for ever over finished projects would be the
 * light claiming credit while asking nothing, and `sleeping` is the member
 * that claims least. Principle 13: the system should be comfortable doing
 * nothing.
 *
 * ── What this does not cover ─────────────────────────────────────────────
 *
 * A machine with no database yet answers `sleeping` rather than creating one:
 * a poll is a probe, and `resolveExtensionOrigin` set the precedent that a
 * probe never builds an `AppContext`. Per-project detail, the re-entry link,
 * and `openUnwatched` are Home's, not this fold's — every control on the tray
 * is a link to a page that has room for them.
 */

import { INTENTION_STATES } from '../domain/intention/state'
import type { IntentionStateId } from '../domain/intention/state'
import { frontDoorRow } from './front-door'
import { existingAppContext } from './db'
import { captureStore } from './capture-store'

export interface OverallIntentionState {
  readonly state: IntentionStateId
  /** `INTENTION_STATES`' consumer label, verbatim — the tray renders this and
   *  never invents its own words. */
  readonly label: string
}

/** Fold order, highest claim first. `done` is deliberately absent — see the
 *  header — and `sleeping` is what everything falls through to. */
const FOLD_ORDER = ['needs-you', 'delegated', 'working'] as const

/**
 * One member from many, by the precedence the members already carry.
 *
 * Pure, so the ordering — the only decision this file adds — is testable
 * without a database. `null` entries are projects with no Intention; they
 * contribute nothing, exactly as they contribute no lifecycle word on Home.
 */
export function foldIntentionStates(
  states: readonly (IntentionStateId | null)[],
): IntentionStateId {
  for (const candidate of FOLD_ORDER) {
    if (states.includes(candidate)) return candidate
  }
  return 'sleeping'
}

/** The word plus its consumer label, from the one place that holds the five. */
function labelled(state: IntentionStateId): OverallIntentionState {
  return { state, label: INTENTION_STATES[state].consumerLabel }
}

/**
 * The whole machine's lifecycle word, from rows plus `now`.
 *
 * `now` arrives as a parameter for the same reason it does everywhere else:
 * the conversion underneath is a pure function of counts and epoch
 * milliseconds, and the caller — a route handler — is the layer that may read
 * the clock.
 */
export async function overallIntentionState(nowEpochMs: number): Promise<OverallIntentionState> {
  const context = existingAppContext()
  if (context === undefined) return labelled('sleeping')

  const { repos } = await context
  const live = captureStore().current()

  const states: (IntentionStateId | null)[] = []
  for (const facts of await repos.intentions.factsForEveryProject()) {
    states.push(
      frontDoorRow({
        facts,
        sittings: [],
        liveSessionId: live?.sessionId ?? null,
        nowEpochMs,
      }).state,
    )
  }

  return labelled(foldIntentionStates(states))
}
