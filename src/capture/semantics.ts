/**
 * Raw browser signals to semantic ObservationEvents, by deterministic heuristic.
 *
 * ── This layer never interprets ──────────────────────────────────────────
 *
 * It classifies observable facts. It does not summarise, does not judge
 * relevance, and does not call a model.
 *
 * `encountered missing information` is listed in the founding brief as an
 * example ObservationEvent, and it is NOT a kind here. It is an
 * interpretation — a conclusion about what the person did not find — and
 * putting it in the capture layer would break "observation never acts" one
 * level up, where nobody is watching for it. It belongs to inference, as a
 * `SessionClaim` with evidence.
 *
 * The test for anything proposed here: could two people watching the same
 * screen disagree about whether it happened? If yes, it is inference.
 */

import type { ObservationKind } from '../persistence/ledger-writer'
import { cleanUrl, searchTermOf } from './url'

/** Re-exported so callers keep one import for the capture vocabulary. The
 *  definitions live in `./url` because the ledger writer needs them too, and a
 *  module importing the ledger writer's types cannot also be its dependency. */
export { cleanUrl, searchTermOf }

/** Dwell past this, with some scroll, counts as engagement rather than a glance. */
export const ENGAGEMENT_DWELL_MS = 20_000
export const ENGAGEMENT_SCROLL_FRACTION = 0.25

export interface RawNavigation {
  readonly url: string
  readonly title: string
  readonly approvedSourceId: string
  readonly at: Date
  readonly elapsedMs: number
  /** From document.referrer — our partial substitute for transitionType, which
   *  we gave up with the webNavigation permission. */
  readonly referrer?: string | undefined
  /** performance.getEntriesByType('navigation')[0].type */
  readonly navigationType?: 'navigate' | 'reload' | 'back_forward' | undefined
}

export interface RawEngagement {
  readonly url: string
  readonly approvedSourceId: string
  readonly at: Date
  readonly elapsedMs: number
  readonly dwellMs: number
  readonly scrollFraction: number
}

export interface RawSelection {
  readonly url: string
  readonly approvedSourceId: string
  readonly at: Date
  readonly elapsedMs: number
  readonly text: string
}

export interface SemanticEvent {
  readonly kind: ObservationKind
  readonly observedAt: Date
  readonly elapsedMs: number
  readonly approvedSourceId?: string | undefined
  readonly attested: Record<string, unknown>
  /** Raw. The ledger writer datamarks — one door. */
  readonly untrustedText?: string | undefined
}

/**
 * Track which sources have been seen, so a second visit is a `returnedTo`
 * rather than another `visited`. Per session — the distinction is only
 * meaningful within one sitting.
 */
export function createNavigationClassifier() {
  const seen = new Set<string>()

  return {
    classify(nav: RawNavigation): SemanticEvent {
      const url = cleanUrl(nav.url)
      const term = searchTermOf(nav.url)

      const attested: Record<string, unknown> = {
        url,
        title: nav.title,
        ...(nav.referrer ? { referrer: cleanUrl(nav.referrer) } : {}),
        ...(nav.navigationType ? { navigationType: nav.navigationType } : {}),
      }

      // A search is a search whether or not the origin was seen before.
      if (term) {
        seen.add(url)
        return {
          kind: 'queried',
          observedAt: nav.at,
          elapsedMs: nav.elapsedMs,
          approvedSourceId: nav.approvedSourceId,
          attested: { ...attested, term },
        }
      }

      const kind: ObservationKind = seen.has(url) ? 'returnedTo' : 'visited'
      seen.add(url)

      return {
        kind,
        observedAt: nav.at,
        elapsedMs: nav.elapsedMs,
        approvedSourceId: nav.approvedSourceId,
        attested,
      }
    },

    /** New session, new memory. */
    reset() {
      seen.clear()
    },
  }
}

/** Engagement, or nothing. Returning null rather than a weak event keeps the
 *  timeline free of "they glanced at a page" noise. */
export function classifyEngagement(raw: RawEngagement): SemanticEvent | null {
  if (raw.dwellMs < ENGAGEMENT_DWELL_MS) return null
  if (raw.scrollFraction < ENGAGEMENT_SCROLL_FRACTION) return null

  return {
    kind: 'engaged',
    observedAt: raw.at,
    elapsedMs: raw.elapsedMs,
    approvedSourceId: raw.approvedSourceId,
    attested: {
      url: cleanUrl(raw.url),
      dwellMs: raw.dwellMs,
      scrollFraction: Math.round(raw.scrollFraction * 100) / 100,
    },
  }
}

/** A deliberate selection. The text is page-authored and goes to the ledger
 *  raw, where it is sanitised. */
export function classifySelection(raw: RawSelection): SemanticEvent | null {
  const text = raw.text.trim()
  // A stray click produces a one- or two-character selection. Not intent.
  if (text.length < 3) return null

  return {
    kind: 'excerpted',
    observedAt: raw.at,
    elapsedMs: raw.elapsedMs,
    approvedSourceId: raw.approvedSourceId,
    attested: { url: cleanUrl(raw.url), length: text.length },
    untrustedText: text,
  }
}

/** The human left. From chrome.idle and windows.onFocusChanged — neither has a
 *  CDP equivalent, which is part of why the extension won ADR-0002. */
export function classifyAway(at: Date, elapsedMs: number, cause: 'idle' | 'blur' | 'lock'): SemanticEvent {
  return {
    kind: 'switchedAway',
    observedAt: at,
    elapsedMs,
    attested: { cause },
  }
}
