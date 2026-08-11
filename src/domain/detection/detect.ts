/**
 * Noticing that work is underway, without being told.
 *
 * ── This reverses a founding-brief exclusion, deliberately ───────────────
 *
 * The brief excludes "automatic project recognition" and "autonomous background
 * action without an explicit handoff", and `MVP.md` assumption 3 bets that
 * people will start sessions explicitly. That bet lost in the first real
 * try: a session was started, a site was browsed, and the honest summary of
 * the experience was "Propositum didn't do anything".
 *
 * So detection is now in scope. What is NOT in scope, and what keeps this from
 * becoming the surveillance product the exclusion list was refusing:
 *
 *   - **No model runs here.** Every rule below is arithmetic over metadata.
 *     `CONTEXT.md` bans model calls on a timer for two reasons — page text
 *     reaching a model while nobody is watching, and an event stream the eval
 *     harness cannot replay. A deterministic detector keeps both.
 *   - **No page text reaches this layer at all.** Ambient capture carries a
 *     cleaned URL, a title, dwell and scroll. Nothing else. The 2,000-character
 *     excerpt begins only after a session starts.
 *   - **Detection never starts a session.** It produces a suggestion. A human
 *     act still starts the session, which is the invariant `SessionPhase`
 *     depends on.
 *
 * ── Why arithmetic, and not judgment ─────────────────────────────────────
 *
 * The same test the capture layer uses: could two people watching the same
 * screen disagree about whether it happened? Dwell, page count and a query
 * parameter are facts. "They are researching partnerships" is a reading, and a
 * reading needs evidence, a model, and a human looking at the result.
 */

/**
 * Thresholds — and one deliberate escape hatch.
 *
 * `PROPOSITUM_FAST_DETECT=1` divides every duration by twenty, so the whole
 * loop can be exercised in about a minute instead of ten. Page COUNTS are left
 * alone: dropping those would stop testing the rule that a single page is
 * reading rather than work, which is the one most likely to be wrong.
 *
 * This exists because a ten-minute feedback loop is how a false-positive rate
 * goes unmeasured. It is read once, at module load, and never from the request
 * — a threshold that could change between the detection and the offer would
 * make a suggestion impossible to explain afterwards.
 *
 * These numbers are guesses, set before any real browsing existed. They live
 * together in one place so tuning them is a diff rather than an excavation.
 */
const FAST = process.env['PROPOSITUM_FAST_DETECT'] === '1'
const SPEED = FAST ? 20 : 1

import { findThreads, termsOf } from './topics'
import type { ThreadPage } from './topics'

/** The window everything is measured inside. Older observations are dropped. */
export const WINDOW_MS = (30 * 60_000) / SPEED

/** Distinct pages on one origin before it looks like work rather than a visit. */
export const PAGES_FOR_WORK = 3

/** Engaged time across the window. Engagement already required dwell + scroll,
 *  so this is time actually spent reading, not tabs left open. */
export const ENGAGED_MS_FOR_WORK = (8 * 60_000) / SPEED

/** A search plus this many pages is work, even below the page threshold — a
 *  query is a statement of intent in a way a third click is not. */
export const PAGES_AFTER_QUERY = 2

/** Idle this long, after real work, is a natural stopping point. */
export const PAUSE_MS = (4 * 60_000) / SPEED

/** Work done before a pause is worth offering to continue. */
export const WORKED_MS_FOR_HANDOFF = (10 * 60_000) / SPEED

/** True when thresholds are shortened. Surfaced in the UI, because a
 *  suggestion produced under test thresholds must not read like a real one. */
export const FAST_DETECT = FAST

/**
 * One ambient observation. Metadata only — there is deliberately no field that
 * could carry page text, so this layer cannot see any even by mistake.
 */
export interface AmbientObservation {
  readonly at: number
  readonly origin: string
  /** Cleaned URL. Identity for "have I seen this page before". */
  readonly url: string
  readonly title: string
  readonly kind: 'navigation' | 'query' | 'engagement' | 'away'
  /** Engagement only. Already past the dwell and scroll thresholds. */
  readonly engagedMs?: number | undefined
}

/** What was noticed, in enough detail to phrase an offer and to explain it. */
export interface WorkDetected {
  /** The recurring subject words, most common first. Raw material for a name. */
  readonly terms: readonly string[]
  /** Every site the thread runs through. Research is rarely on one. */
  readonly origins: readonly string[]
  readonly pages: number
  readonly searches: number
  readonly engagedMs: number
  readonly since: number
  /** The most-read page, for a concrete sentence rather than a bare hostname. */
  readonly focus: string | null
  /** Page titles, in order. What a naming step would be shown. */
  readonly titles: readonly string[]
  /** Which rule fired. Shown to the person, so it can never be a mystery. */
  readonly because: 'searched-and-followed' | 'followed-across-sites'
}

/**
 * Ambient observations to the pages a thread is built from.
 *
 * Engagement is reported cumulatively and repeatedly, so dwell is the LARGEST
 * report per URL rather than the sum — see `engagedByUrl`.
 */
function pagesOf(observations: readonly AmbientObservation[]): ThreadPage[] {
  const dwell = engagedByUrl(observations)
  const byUrl = new Map<string, ThreadPage>()

  for (const o of observations) {
    if (o.kind === 'away') continue
    const existing = byUrl.get(o.url)

    byUrl.set(o.url, {
      url: o.url,
      origin: o.origin,
      // Keep the most informative title seen for this page — the first report
      // often lands before the document has one.
      title: (o.title || existing?.title) ?? '',
      terms: termsOf((o.title || existing?.title) ?? '', o.url),
      engagedMs: dwell.get(o.url) ?? 0,
      at: Math.min(existing?.at ?? o.at, o.at),
      searched: (existing?.searched ?? false) || o.kind === 'query',
    })
  }

  return [...byUrl.values()]
}

function inWindow(observations: readonly AmbientObservation[], now: number) {
  return observations.filter((o) => now - o.at <= WINDOW_MS)
}

/**
 * Engaged time per page, largest report wins.
 *
 * Engagement is reported repeatedly while a page is open, and every report
 * carries CUMULATIVE dwell rather than a delta. Summing them would count the
 * same minute once per report — a page read for two minutes would arrive as
 * 15s + 30s + 45s + … and look like far more attention than it had.
 *
 * Taking the maximum per URL is also what makes a resend safe: a report lost
 * while the service worker was asleep costs nothing, because the next one
 * carries the time the missed one would have.
 */
function engagedByUrl(observations: readonly AmbientObservation[]): Map<string, number> {
  const byUrl = new Map<string, number>()
  for (const observation of observations) {
    if (observation.engagedMs === undefined) continue
    byUrl.set(observation.url, Math.max(byUrl.get(observation.url) ?? 0, observation.engagedMs))
  }
  return byUrl
}

function engagedTotal(observations: readonly AmbientObservation[]): number {
  let total = 0
  for (const ms of engagedByUrl(observations).values()) total += ms
  return total
}

/**
 * Is coherent work underway on some origin?
 *
 * Returns the strongest candidate, or null. One origin at a time on purpose: an
 * offer that names two sites is asking the person to do the disambiguating,
 * which is the work the feature exists to save.
 */
export function detectWork(
  observations: readonly AmbientObservation[],
  now: number,
): WorkDetected | null {
  const recent = inWindow(observations, now)
  if (recent.length === 0) return null

  const threads = findThreads(pagesOf(recent))
  const thread = threads[0]
  if (!thread) return null

  // A thread is already several pages across several sites sharing a subject.
  // The remaining bar is that they actually read some of it, so a burst of tabs
  // opened and abandoned does not qualify.
  if (thread.engagedMs < ENGAGED_MS_FOR_WORK && thread.searches === 0) return null

  const focusPage = [...thread.pages].sort((a, b) => b.engagedMs - a.engagedMs)[0]

  return {
    terms: thread.terms,
    origins: thread.origins,
    pages: thread.pages.length,
    searches: thread.searches,
    engagedMs: thread.engagedMs,
    since: thread.since,
    focus: focusPage?.title ?? null,
    titles: thread.pages.map((p) => p.title).filter((t) => t !== ''),
    because: thread.searches > 0 ? 'searched-and-followed' : 'followed-across-sites',
  }
}

/** A natural stopping point inside a running session. */
export interface PauseDetected {
  readonly idleForMs: number
  readonly workedMs: number
  readonly since: number
}

/**
 * Has the person stepped away from real work?
 *
 * The offer this feeds is "want me to carry on while you're gone", so both
 * halves matter: enough work to be worth continuing, and a gap long enough that
 * they are actually away rather than reading slowly.
 *
 * Not a `CaptureGap`. A gap is an absence of knowledge; this is a fact we
 * observed — `switchedAway` was recorded, and nothing has happened since.
 */
export function detectPause(
  observations: readonly AmbientObservation[],
  now: number,
): PauseDetected | null {
  const recent = inWindow(observations, now)
  if (recent.length === 0) return null

  const last = recent.reduce((latest, o) => (o.at > latest.at ? o : latest), recent[0]!)
  const idleForMs = now - last.at
  if (idleForMs < PAUSE_MS) return null

  const engagedMs = engagedTotal(recent)
  if (engagedMs < WORKED_MS_FOR_HANDOFF) return null

  return { idleForMs, workedMs: engagedMs, since: Math.min(...recent.map((o) => o.at)) }
}
