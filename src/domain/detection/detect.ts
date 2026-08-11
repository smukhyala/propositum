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

/** The window everything is measured inside. Older observations are dropped. */
export const WINDOW_MS = 30 * 60_000

/** Distinct pages on one origin before it looks like work rather than a visit. */
export const PAGES_FOR_WORK = 3

/** Engaged time across the window. Engagement already required dwell + scroll,
 *  so this is time actually spent reading, not tabs left open. */
export const ENGAGED_MS_FOR_WORK = 8 * 60_000

/** A search plus this many pages is work, even below the page threshold — a
 *  query is a statement of intent in a way a third click is not. */
export const PAGES_AFTER_QUERY = 2

/** Idle this long, after real work, is a natural stopping point. */
export const PAUSE_MS = 4 * 60_000

/** Work done before a pause is worth offering to continue. */
export const WORKED_MS_FOR_HANDOFF = 10 * 60_000

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
  readonly origin: string
  /** Distinct cleaned URLs seen on that origin, inside the window. */
  readonly pages: number
  readonly queries: number
  readonly engagedMs: number
  /** Earliest observation on this origin in the window. */
  readonly since: number
  /** The most-read page, for a concrete sentence rather than a bare hostname. */
  readonly focus: string | null
  /** Which rule fired. Shown to the person, so it can never be a mystery. */
  readonly because: 'pages-and-dwell' | 'query-then-reading'
}

function inWindow(observations: readonly AmbientObservation[], now: number) {
  return observations.filter((o) => now - o.at <= WINDOW_MS)
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

  const byOrigin = new Map<string, AmbientObservation[]>()
  for (const observation of recent) {
    if (observation.kind === 'away') continue
    const list = byOrigin.get(observation.origin) ?? []
    list.push(observation)
    byOrigin.set(observation.origin, list)
  }

  const candidates: WorkDetected[] = []

  for (const [origin, list] of byOrigin) {
    const pages = new Set(list.map((o) => o.url)).size
    const queries = list.filter((o) => o.kind === 'query').length
    const engagedMs = list.reduce((total, o) => total + (o.engagedMs ?? 0), 0)
    const since = Math.min(...list.map((o) => o.at))

    // The page someone spent longest on says more than the one they landed on.
    const dwellByUrl = new Map<string, number>()
    for (const o of list) {
      if (o.engagedMs === undefined) continue
      dwellByUrl.set(o.url, (dwellByUrl.get(o.url) ?? 0) + o.engagedMs)
    }
    let focus: string | null = null
    let best = 0
    for (const [url, ms] of dwellByUrl) {
      if (ms > best) {
        best = ms
        focus = list.find((o) => o.url === url)?.title ?? null
      }
    }

    const byVolume = pages >= PAGES_FOR_WORK && engagedMs >= ENGAGED_MS_FOR_WORK
    const byIntent = queries >= 1 && pages >= PAGES_AFTER_QUERY && engagedMs > 0

    if (!byVolume && !byIntent) continue

    candidates.push({
      origin,
      pages,
      queries,
      engagedMs,
      since,
      focus,
      because: byVolume ? 'pages-and-dwell' : 'query-then-reading',
    })
  }

  if (candidates.length === 0) return null

  // Most engaged time wins. Ties go to the one with more pages.
  candidates.sort((a, b) => b.engagedMs - a.engagedMs || b.pages - a.pages)
  return candidates[0] ?? null
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

  const engagedMs = recent.reduce((total, o) => total + (o.engagedMs ?? 0), 0)
  if (engagedMs < WORKED_MS_FOR_HANDOFF) return null

  return { idleForMs, workedMs: engagedMs, since: Math.min(...recent.map((o) => o.at)) }
}
