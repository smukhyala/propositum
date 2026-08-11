/**
 * Raw browser signals in, semantic ObservationEvents out.
 *
 * ── Why the extension no longer names a kind ─────────────────────────────
 *
 * It used to. `content.js` hardcoded `kind: 'visited'` on load and
 * `kind: 'engaged'` on pagehide, which had three consequences nobody had
 * written down:
 *
 *   - `queried` and `returnedTo` were NEVER PRODUCED. Four of ten
 *     ObservationKinds existed only in fixtures.
 *   - `engaged` fired unconditionally, with no `dwellMs`, so
 *     `classifyEngagement`'s dwell and scroll thresholds were not merely
 *     unused — they were contradicted. Every glance was an engagement.
 *   - `src/capture/semantics.ts` was 205 lines of tested classification that
 *     no production file imported.
 *
 * A content script also CANNOT know `returnedTo`: that needs memory of the
 * whole sitting, and the page it runs in has seen only itself. So the extension
 * reports what it observed and this layer decides what it was.
 *
 * ── Classification is deterministic and never interprets ─────────────────
 *
 * The test for anything here, from semantics.ts: could two people watching the
 * same screen disagree about whether it happened? If yes it is inference, and
 * inference happens once, later, when the person asks to hand over.
 *
 * ── Where the per-session memory lives ───────────────────────────────────
 *
 * `returnedTo` needs a `seen` set spanning requests, and route handlers are
 * stateless. It hangs off `LiveSession`, which is already the per-session
 * in-memory holder and already dies at exactly the right moment — when the
 * session ends or the process restarts, both of which should forget.
 */

import { z } from 'zod'

import {
  classifyEngagement,
  classifySelection,
  createNavigationClassifier,
} from '../capture/semantics'
import type { SemanticEvent } from '../capture/semantics'

export type NavigationClassifier = ReturnType<typeof createNavigationClassifier>

/**
 * What the extension is allowed to send.
 *
 * `kind` is deliberately absent. An extension that could name a kind could name
 * `sourceApproved`, and approval is a human act recorded by the app.
 */
export const rawSignalSchema = z.discriminatedUnion('signal', [
  z.object({
    signal: z.literal('navigation'),
    at: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    url: z.string(),
    title: z.string(),
    referrer: z.string().optional(),
    navigationType: z.enum(['navigate', 'reload', 'back_forward']).optional(),
    text: z.string().optional(),
  }),
  z.object({
    signal: z.literal('selection'),
    at: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    url: z.string(),
    text: z.string(),
  }),
  z.object({
    signal: z.literal('engagement'),
    at: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    url: z.string(),
    dwellMs: z.number().int().nonnegative(),
    scrollFraction: z.number().min(0).max(1),
    interacted: z.boolean().optional(),
  }),
  // The one the service worker still produces itself, because chrome.idle is
  // not a page event and no content script can observe it.
  z.object({
    signal: z.literal('away'),
    at: z.string(),
    elapsedMs: z.number().int().nonnegative(),
    cause: z.enum(['idle', 'blur', 'lock']),
  }),
])

export type RawSignal = z.infer<typeof rawSignalSchema>

/**
 * One signal to at most one event.
 *
 * Returns null when the signal was real but not worth a row — a glance rather
 * than engagement, a stray two-character selection. That is a classification
 * outcome, not a failure: the timeline is better for not carrying it.
 */
export function toSemanticEvent(
  signal: RawSignal,
  approvedSourceId: string,
  classifier: NavigationClassifier,
): SemanticEvent | null {
  const at = new Date(signal.at)

  switch (signal.signal) {
    case 'navigation': {
      const event = classifier.classify({
        url: signal.url,
        title: signal.title,
        approvedSourceId,
        at,
        elapsedMs: signal.elapsedMs,
        ...(signal.referrer ? { referrer: signal.referrer } : {}),
        ...(signal.navigationType ? { navigationType: signal.navigationType } : {}),
      })

      // The readable excerpt rides along with the navigation rather than
      // arriving as its own row — it is what the page said, not a second thing
      // the person did. Raw; the ledger writer datamarks.
      return signal.text === undefined ? event : { ...event, untrustedText: signal.text }
    }

    case 'selection':
      return classifySelection({
        url: signal.url,
        approvedSourceId,
        at,
        elapsedMs: signal.elapsedMs,
        text: signal.text,
      })

    case 'engagement': {
      // One `engaged` row per page per sitting. Reports keep arriving while the
      // page is open; the first crossing is the fact, the rest restate it.
      if (classifier.hasEngaged(signal.url)) return null

      const engagement = classifyEngagement({
        url: signal.url,
        approvedSourceId,
        at,
        elapsedMs: signal.elapsedMs,
        dwellMs: signal.dwellMs,
        scrollFraction: signal.scrollFraction,
        ...(signal.interacted === undefined ? {} : { interacted: signal.interacted }),
      })

      // Mark only on a real crossing. An early report below the dwell threshold
      // must not claim the page and silence the crossing that follows it.
      if (engagement !== null) classifier.markEngaged(signal.url)
      return engagement
    }

    case 'away':
      // Not attributable to an approved source by construction — the person
      // left, and where they went is none of our business.
      return {
        kind: 'switchedAway',
        observedAt: at,
        elapsedMs: signal.elapsedMs,
        attested: { cause: signal.cause },
      }
  }
}
