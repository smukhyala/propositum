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
 *     cleaned URL, a title, dwell and ~~scroll~~ **— a scroll fraction where one
 *     is sent, and nothing sends one yet**. Nothing else. The 2,000-character
 *     excerpt begins only after a session starts.
 *
 *     *"and scroll" was aspirational until 2026-08-17, and this line should not
 *     have said it. Corrected again the same day, because the first correction
 *     overshot.* `content.js` has computed a scroll fraction on every engagement
 *     report since the report existed, and the ambient path drops it — first in
 *     `flushAmbient`, which hand-builds the wire shape and omits the field, and
 *     then, until 2026-08-17, in a schema that had nowhere to put it. The schema
 *     half is fixed and `AmbientObservation.scrollFraction` below is real. **The
 *     extension half is not**, so an ambient observation with a scroll fraction
 *     on it comes from a test or a `curl` and from nothing a browser does. That
 *     is the failure `tests/reachability.test.ts` exists to remember, in its
 *     documentation form rather than its dead-code one, and it took two passes
 *     to state correctly. **Nothing reads the field either, deliberately** —
 *     landing a signal and consulting it are two decisions and neither has been
 *     finished. See the note on `WINDOW_MS`.
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

import { canonicalise, findThreads, searchQueryOf, termsOf } from './topics'
import type { Thread, ThreadPage } from './topics'

/**
 * The window everything is measured inside. Older observations are dropped.
 *
 * ── Honest limit, recorded 2026-08-17: thirty minutes is inherited folklore ──
 *
 * **The number is not changed here and that is the decision, not an oversight.**
 * `docs/research/intent-suggestion-quality.md` §3.1 and §10.4 went looking for
 * the primary source behind the thirty-minute session and found that it does not
 * say what everyone cites it for. Written down so the next person to touch this
 * constant finds the argument rather than rediscovering it:
 *
 *   - **The origin is 25.5 minutes, not 30.** Catledge & Pitkow (WWW3, 1995)
 *     delineated a new session at gaps over **25.5 minutes**, which they derived
 *     as *mean + 1.5 SD of inter-event idle gaps* across 107 XMosaic users. They
 *     never justified the 1.5, never reported the SD, and never checked the
 *     cutoff against any ground truth. Thirty is a later rounding of it.
 *   - **It was never a boundary between two pieces of work.** Its stated purpose
 *     was detecting *"users will often leave XMosaic running for extended
 *     periods of time without interacting with it"* — when somebody walked away
 *     from the browser. Using it to mean *"work older than this is not part of
 *     this thread"* is a repurposing the source does not support.
 *   - **Measured, it is worse than doing nothing — on one of the two analyses,
 *     and the figures must not be mixed.** *(Corrected 2026-08-17: this bullet
 *     originally paired one analysis's accuracies with the other's trained
 *     optima, which read as a single measurement and was two.)* Jones & Klinkner
 *     (CIKM 2008) report both, and they disagree:
 *
 *       - **Table 8, repeat queries removed.** A 30-minute timeout scores
 *         **57.2%** on goal boundaries against a **63.1%** always-say-no
 *         baseline — worse than doing nothing. The trained optima in that same
 *         table are *"1.5 mins for goals and 6 mins for missions"*.
 *       - **Table 3, repeat queries included.** The 30-minute timeout scores
 *         **66.5%** on goal boundaries against a **54.2%** baseline — better
 *         than doing nothing — and there the trained optima are *"5 mins and 13
 *         minutes"*. Even so, five minutes beats thirty on goals, 71.2% to
 *         66.5%.
 *
 *     So *"worse than doing nothing"* is specific to goal boundaries with
 *     repeats removed, and it is stated that narrowly on purpose. What both
 *     analyses agree on is that thirty is not the best number in either of them,
 *     and the authors' own summary is unconditional: *"The 30-minute standard
 *     receives no support from our results."*
 *
 *     The same pairing sits in `docs/research/intent-suggestion-quality.md`
 *     §3.1 and §10.4 — a table headed by Table 8's accuracies with Table 3's
 *     optima printed under it — which is where this comment inherited it.
 *     Correcting the note is owed and is not this file.
 *
 * **What that does and does not license.** This constant does two jobs and only
 * one of them is hit. As a **retention bound** — how much Propositum is willing
 * to hold in memory about somebody who has not started a session — thirty
 * minutes is a privacy decision, it is argued in ADR-0008, and none of the above
 * touches it. As an implicit **claim about thread membership** it is unsupported
 * in both directions, and Jones & Klinkner also measured that a 30-minute timeout
 * breaks up 15% of goals — so the error is not even one-sided.
 *
 * `SUSTAINED_MS` in `grounds.ts` already half-spotted this: *"a rule that asks a
 * thread to span half the life of the buffer it is measured inside is measuring
 * the window as much as the person"*. The literature says that comment is right.
 *
 * **Deliberately not retuned.** Moving this number would change which sessions
 * qualify, on evidence that argues the number is arbitrary rather than that some
 * other number is correct — and the two jobs above want it moved in opposite
 * directions. Recording the finding is the change; retuning is a separate one,
 * with its own ADR, and it needs the offer-rate measurement §10.5 says nothing
 * currently takes.
 */
export const WINDOW_MS = (30 * 60_000) / SPEED

/**
 * Engaged time across the window. Engagement already required dwell + evidence
 * a person was present, so this is time actually spent reading, not tabs left
 * open.
 *
 * ── Two constants used to sit here and nothing read either ───────────────
 *
 * `PAGES_FOR_WORK = 3` counted distinct pages ON ONE ORIGIN. That rule died
 * with per-origin detection: a thread is now the unit, and `PAGES_FOR_THREAD`
 * in `topics.ts` holds the page bar and is genuinely enforced. Keeping a second
 * page constant that nothing consulted meant the comments described a rule the
 * code did not have — which is worse than having no constant, because it reads
 * as proof the bar exists.
 *
 * `PAGES_AFTER_QUERY = 2` was the other. Wiring it in HERE would have raised
 * the naming bar that ADR-0008 pins at *a thread, plus (enough reading or one
 * search)*, and that bar is deliberately low because a wrong subject line costs
 * a sentence. The rule it names was worth having, so it moved up rather than
 * away: `PAGES_AFTER_QUERY_FOR_OFFER` in `grounds.ts` decides whether a search
 * was FOLLOWED, at the higher bar where offering to do work is decided.
 */
export const ENGAGED_MS_FOR_WORK = (8 * 60_000) / SPEED

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
  /**
   * Engagement only. Cumulative dwell for this page, in milliseconds.
   *
   * ~~Already past the dwell and scroll thresholds.~~ **Amended 2026-08-17: it
   * never was, on this path.** `ENGAGEMENT_DWELL_MS` and
   * `ENGAGEMENT_SCROLL_FRACTION` live in `src/capture/semantics.ts` and are
   * applied by `classifyEngagement`, which sits on the SESSION path behind
   * `capture-adapter.ts`. An ambient observation never passes through it:
   * `content.js` reports every fifteen seconds for any visible page it has seen,
   * and the service worker forwards the report whole. `content.js`'s own
   * `wasSeen` docblock says so in as many words — *"That lands in the ambient
   * path, which has no engagement threshold of its own"* — and names the
   * consequence, which is that the largest such report becomes the most
   * confident-looking row in the buffer.
   *
   * So this is raw dwell, filtered by nothing, and the sentence claiming
   * otherwise read as proof of a floor that is not here. The floors that DO bind
   * ambient dwell are `ENGAGED_MS_FOR_WORK` above and `READ_AROUND_MS` in
   * `grounds.ts`, both of them in the domain, both of them named.
   */
  readonly engagedMs?: number | undefined
  /**
   * Engagement only. How far down the page they got, 0 to 1 inclusive.
   *
   * ── Landed 2026-08-17, and read by nothing on purpose ────────────────────
   *
   * `content.js` has computed this on every engagement report since the report
   * existed — including the awkward part, a scroll container that is not the
   * window — and the ambient schema had no field for it, so it was discarded on
   * arrival while three places in the corpus said it was captured. This is the
   * field those sentences were describing.
   *
   * **Second-best-evidenced implicit signal in the literature, and the cheapest.**
   * `docs/research/intent-suggestion-quality.md` §2.1 and §10.2: Claypool et al.
   * (IUI 2001) found *"the time spent on a page, the amount of scrolling on a
   * page and the combination of time and scrolling had a strong correlation with
   * explicit interest"*, where clicks and individual scroll methods did not. The
   * caution is in the same place and belongs beside the number: Fox et al. (TOIS
   * 2005) had scroll among their nineteen predictors and it did **not** make the
   * top two, so this should be expected to buy less than exit type would.
   *
   * **Nothing here decides anything with it, and that is enforced rather than
   * intended.** `tests/reachability.test.ts` asserts, in its *deferred, and
   * asserted as deferred* block, that no file under `src/domain/detection`
   * consults this beyond the declaration you are reading. Consuming it would
   * change which afternoons clear the offer bar, and the product owner chose to
   * record the research findings without retuning — see the note on `WINDOW_MS`.
   * Wiring it turns that test red, which is the point: the claim has to be moved
   * up deliberately rather than slipped in.
   *
   * **Bounded at the door, not here.** `ambientSchema` refuses anything outside
   * `[0, 1]`, matching `rawSignalSchema`'s bound on the session path, so this
   * layer cannot be handed `1e9` by a hostile or buggy sender. The domain reads
   * no clock and validates nothing; the boundary is where a fraction is proved
   * to be one.
   */
  readonly scrollFraction?: number | undefined
}

/** What was noticed, in enough detail to phrase an offer and to explain it. */
export interface WorkDetected {
  /** The recurring subject words, most common first. Raw material for a name. */
  readonly terms: readonly string[]
  /** The same words as they were written on the pages, aligned index-for-index
   *  with `terms`. Sentences shown to a person use these; nothing compares
   *  them, because comparing spellings is what `terms` exists to stop. */
  readonly labels: readonly string[]
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
  /** The exact pages that formed the thread. What gets carried into a session
   *  on accept — NOT everything from the same site, which is how a search for
   *  "nissan altima" ended up as evidence for a hiking trip. */
  readonly urls: readonly string[]
  /** Which rule fired. Shown to the person, so it can never be a mystery. */
  readonly because: 'searched-and-followed' | 'followed-across-sites'
}

/**
 * Ambient observations to the pages a thread is built from.
 *
 * Engagement is reported cumulatively and repeatedly, so dwell is the LARGEST
 * report per URL rather than the sum — see `engagedByUrl`. Arrivals are counted
 * separately, by `visitsByUrl`, and the two must not be conflated: one is a
 * maximum and the other is a tally.
 *
 * ── Why the canonicalisation pass lives here and not in either caller ─────
 *
 * This is the only function both page-building paths go through. `detectWork`
 * calls it and hands the result to `findThreads`; `threadPagesOf` calls it and
 * filters the result down to the thread's URLs, for `compose-offer.ts` and the
 * ambient debug route. `grounds.ts` then intersects the second path's
 * `page.terms` with the first path's `detected.terms`.
 *
 * Collapsing near-identical spellings in one of those and not the other would
 * put the two views of one page into disagreement about which word is on it —
 * `pursuitOf` would find no overlap, every intent ground would stop firing, and
 * nothing would look wrong: a green suite and a product that quietly never
 * offers. Both paths are given the same window, so both get the same rewrite.
 */
function pagesOf(observations: readonly AmbientObservation[]): ThreadPage[] {
  const dwell = engagedByUrl(observations)
  const visits = visitsByUrl(observations)
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
      // `kind === 'query'` is necessary and NOT sufficient. The service worker
      // labels any URL with a `?` a query, so trusting it made `searches` — and
      // with it the `searched-and-followed` sentence — fire on checkout pages
      // and paginated listings. `searchQueryOf` is the domain's own test and
      // the extension cannot widen it.
      searched: (existing?.searched ?? false) || (o.kind === 'query' && searchQueryOf(o.url) !== null),
      visits: visits.get(o.url) ?? 0,
    })
  }

  return canonicalise([...byUrl.values()])
}

/**
 * How many times each page was ARRIVED at, after having been somewhere else.
 *
 * A reload, or two navigation reports for the same page in a row, is not a
 * return — it is the same arrival reported twice, and counting it would make
 * `came-back` fire on a page that refreshes itself. So an arrival counts only
 * when the previous navigation went somewhere else, which is exactly the fact
 * the ground is named for: they left, and they chose to come back.
 *
 * Sorted by time first, because the buffer's insertion order is the order
 * reports ARRIVED and a service worker that woke up late can deliver two
 * sittings out of sequence.
 *
 * ── What this misses, and why it is the right direction to miss in ───────
 *
 * `content.js` sends a navigation once per DOCUMENT. A back-navigation served
 * from bfcache runs no script, and switching to a tab that is already loaded
 * produces nothing at all — and both of those are somebody leaving a page and
 * choosing to come back. So `came-back` under-fires, and it will keep
 * under-firing until the extension can report a return without a document load.
 *
 * That is the direction to be wrong in. A missed ground costs an offer nobody
 * sees; a `came-back` that fired on a page nobody returned to would be an
 * intent ground manufactured out of a reload, and ADR-0008 is explicit about
 * which of those is the expensive failure.
 */
function visitsByUrl(observations: readonly AmbientObservation[]): Map<string, number> {
  const byUrl = new Map<string, number>()
  const arrivals = observations.filter((o) => o.kind === 'navigation' || o.kind === 'query')
  let previous: string | null = null

  for (const observation of [...arrivals].sort((a, b) => a.at - b.at)) {
    if (observation.url !== previous) {
      byUrl.set(observation.url, (byUrl.get(observation.url) ?? 0) + 1)
    }
    previous = observation.url
  }

  return byUrl
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
 * How many strands of one afternoon may be shown at once.
 *
 * ~~One origin at a time on purpose: an offer that names two sites is asking
 * the person to do the disambiguating, which is the work the feature exists to
 * save.~~
 *
 * **Amended 2026-08-17. Half of that survives and the other half stopped being
 * true a while ago, so it is worth separating them rather than striking the
 * whole line.**
 *
 * *"One origin"* was already false. A thread has been multi-origin since
 * `topics.ts` replaced per-origin detection — `WorkDetected.origins` is a list,
 * and *"General Intuition, across 3 sites"* is the sentence the front door
 * ships. The comment was describing a rule the code had not had for some time.
 *
 * The argument underneath it is still right, and it is about an OFFER: a
 * notification that names two subjects and asks which one is making the person
 * do the disambiguating. That is why the extension badge and the notification
 * still name only the strongest strand, and why nothing here multiplies
 * notifications — ADR-0008 names interruption as the expensive failure and
 * PRODUCT_PRINCIPLES §13 requires notifications be actionable and sparse.
 *
 * **Showing several named strands on a page somebody chose to open is a
 * different act from interrupting them with a choice.** Home is a place a
 * person goes; nothing about arriving there is an interruption, so more
 * information on it costs nothing this ADR is protecting.
 *
 * Three, and the number carries its own argument rather than being a round one:
 * a wall of suggestions is its own kind of noise, and the fourth strand of an
 * afternoon is rarely the one somebody wants. It is exported so the two places
 * that must agree about it — the screen and the poll that names and composes
 * for what the screen will show — read the same constant.
 *
 * **Amended 2026-08-17. It bounds what is SHOWN, and it was being spent on
 * strands nobody could see.** Both callers handed it to `detectThreads` and
 * filtered the snoozed strands out of the RESULT, so a subject somebody had
 * already answered "not now" to still consumed one of the three slots and a
 * qualifying strand behind it fell off the screen with nothing saying so. That
 * is the exact failure this whole change exists to remove — a strand found and
 * discarded in silence — reintroduced one line further down from where it was
 * fixed. Measured: four qualifying strands with the strongest snoozed showed
 * two, and the fourth was never named or pinned either.
 *
 * So the cut happens AFTER the filters, in both places. The number is unchanged
 * and no more strands reach the screen than before; what changed is that the
 * three are three the person can actually see.
 */
export const MAX_THREADS_SHOWN = 3

/**
 * Every strand, however many there are.
 *
 * The limit for asking *which strands exist*, which is a different question from
 * *how many may be shown at once* and needs a different answer. Four callers ask
 * it, and every one of them is wrong when it is bounded:
 *
 *   - `noticedStrands` and the poll, which do the filtering that decides what
 *     the three shown strands ARE. Cutting before the filter is the defect
 *     above.
 *   - `strandBySignature` and `declineThreadOffer`, which SELECT a strand by the
 *     signature a button carried. A button on the third row has to find its own
 *     subject, and it cannot if the lookup only ever considers the first three
 *     the detector ranked — the person would press "Set this up for me" on a
 *     strand in front of them and be told it had gone quiet.
 *
 * It widens nothing anybody sees. `MAX_THREADS_SHOWN` still bounds the screen
 * and the poll; it is applied at the end rather than at the start.
 */
export const EVERY_STRAND = Number.MAX_SAFE_INTEGER

/** One found thread, as the rest of the system reads it. */
function detectedFrom(thread: Thread): WorkDetected {
  const focusPage = [...thread.pages].sort((a, b) => b.engagedMs - a.engagedMs)[0]

  return {
    terms: thread.terms,
    labels: thread.labels,
    origins: thread.origins,
    pages: thread.pages.length,
    searches: thread.searches,
    engagedMs: thread.engagedMs,
    since: thread.since,
    focus: focusPage?.title ?? null,
    titles: thread.pages.map((p) => p.title).filter((t) => t !== ''),
    urls: thread.pages.map((p) => p.url),
    because: thread.searches > 0 ? 'searched-and-followed' : 'followed-across-sites',
  }
}

/**
 * Every strand of work underway, strongest first.
 *
 * ── The loss this recovers is one line ───────────────────────────────────
 *
 * `findThreads` has always returned EVERY thread, disjoint — each page is
 * claimed by exactly one — and `detectWork` took `threads[0]` and dropped the
 * rest on the floor. A recorded afternoon had three strands: a
 * perturbation/robotics search, a DMD-vs-SPO search, and Kalman filters
 * followed through to an article. Only the last surfaced. The other two were
 * found and discarded, which is a worse failure than not finding them, because
 * nothing anywhere said they had been.
 *
 * ── The same bar, and no back door ───────────────────────────────────────
 *
 * Every strand returned clears the bar `detectWork` already applied — a thread,
 * plus enough reading or one search. The check is written once, here, so a
 * second strand cannot arrive on a screen under a bar the first would have
 * failed. A thread that fails it is SKIPPED rather than ending the scan: the
 * sort is by searches, breadth and dwell, not by this bar, so the strand after
 * a weak one can be perfectly strong.
 *
 * ── What that changes about `detectWork`, said rather than discovered ────
 *
 * `detectWork` is now `detectThreads(…, 1)[0]`, and that is not identical to
 * what it did. Before, a strongest thread that failed the bar meant NULL even
 * when a weaker thread cleared it; now the cleared one is returned. That is the
 * filter and the ranking applied in the honest order, and it can only ever
 * return a thread that passed the bar — so it widens what is offered by exactly
 * the set of afternoons where the top-ranked strand was skimmed and a real one
 * sat behind it. It is the cheap direction (ADR-0008: a missed detection costs
 * a suggestion nobody sees), and it is stated here because a silent widening in
 * this file is the thing this file's own header refuses.
 */
export function detectThreads(
  observations: readonly AmbientObservation[],
  now: number,
  limit: number = MAX_THREADS_SHOWN,
): WorkDetected[] {
  if (limit <= 0) return []

  const recent = inWindow(observations, now)
  if (recent.length === 0) return []

  const detected: WorkDetected[] = []

  for (const thread of findThreads(pagesOf(recent))) {
    if (detected.length >= limit) break

    // A thread is already several pages across several sites sharing a subject.
    // The remaining bar is that they actually read some of it, so a burst of
    // tabs opened and abandoned does not qualify.
    if (thread.engagedMs < ENGAGED_MS_FOR_WORK && thread.searches === 0) continue

    detected.push(detectedFrom(thread))
  }

  return detected
}

/**
 * Is coherent work underway? The strongest strand, or null.
 *
 * Defined in terms of `detectThreads` rather than beside it, so the two cannot
 * disagree about what a detection is. Every caller that wants one answer — the
 * poll's badge, the notification, `offerForThread`'s "is this still the thread"
 * check — reads this one.
 */
export function detectWork(
  observations: readonly AmbientObservation[],
  now: number,
): WorkDetected | null {
  return detectThreads(observations, now, 1)[0] ?? null
}

/**
 * The pages a detection was made of, rebuilt from the same buffer.
 *
 * `WorkDetected` carries counts and URLs because it is serialised into the poll
 * response, and a `ThreadPage` — a term set, per-page dwell, arrival counts —
 * is neither useful nor honest on a wire (a `Set` crosses JSON as `{}`). But
 * the stronger bar in `grounds.ts` measures exactly those per-page facts, so it
 * needs the pages rather than the summary.
 *
 * Rebuilding is cheap and, more to the point, it cannot disagree with what was
 * detected: the same function over the same observations, windowed the same
 * way, narrowed to the URLs the thread was actually made of. Passing everything
 * in the window instead would let a "3 origins" ground count sites the thread
 * never ran through — the exact mistake `WorkDetected.urls` exists to prevent.
 *
 * `now` is required rather than optional for the same reason `detectWork` takes
 * it. Without the window, a caller handing over an untrimmed buffer would build
 * spans and arrival counts out of browsing the detection had already discarded
 * — a `stayed-with-it` measured across yesterday's session, which is the sort of
 * disagreement between two views of one buffer that nobody would think to look
 * for.
 */
export function threadPagesOf(
  observations: readonly AmbientObservation[],
  detected: WorkDetected,
  now: number,
): ThreadPage[] {
  const wanted = new Set(detected.urls)
  return pagesOf(inWindow(observations, now)).filter((page) => wanted.has(page.url))
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
 *
 * ── Why an engagement report after `away` is not activity ────────────────
 *
 * `content.js` reports engagement every fifteen seconds for as long as a tab is
 * VISIBLE, and it subtracts hidden time but not idle time — a page left on
 * screen while somebody is at lunch is visible, and keeps reporting. Counting
 * those as activity puts the idle clock back to nearly zero every time one
 * lands, so `idleForMs` could never reach `PAUSE_MS` and the hand-off offer
 * could not fire however long anybody was gone.
 *
 * The page cannot know they left. `chrome.idle` can, and says so — that is what
 * an `away` observation IS. So the rule is: everything counts as activity,
 * except an engagement report that arrived after the most recent `away`. A
 * navigation after it counts, because coming back and clicking something is
 * exactly what "they are here again" looks like.
 *
 * The alternative — ignoring engagement reports outright — was worse, and worse
 * in the expensive direction: somebody six minutes into one long page has done
 * nothing but engage, so they would be offered a hand-off while they were still
 * reading it.
 */
export function detectPause(
  observations: readonly AmbientObservation[],
  now: number,
): PauseDetected | null {
  const recent = inWindow(observations, now)
  if (recent.length === 0) return null

  let wentAwayAt: number | null = null
  for (const o of recent) {
    if (o.kind === 'away' && (wentAwayAt === null || o.at > wentAwayAt)) wentAwayAt = o.at
  }

  // With no `away` on record, every engagement report still counts: nothing has
  // said the person left, and a page being read is a page being read.
  const away = wentAwayAt
  const activity = recent.filter(
    (o) => o.kind !== 'engagement' || away === null || o.at <= away,
  )
  if (activity.length === 0) return null

  const last = activity.reduce((latest, o) => (o.at > latest.at ? o : latest), activity[0]!)
  const idleForMs = now - last.at
  if (idleForMs < PAUSE_MS) return null

  const engagedMs = engagedTotal(recent)
  if (engagedMs < WORKED_MS_FOR_HANDOFF) return null

  return { idleForMs, workedMs: engagedMs, since: Math.min(...recent.map((o) => o.at)) }
}
