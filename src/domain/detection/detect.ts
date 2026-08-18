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
 *     cleaned URL, a title, dwell, scroll, how the page was left, how it was
 *     arrived at, and — where the person made one — the title of the tab group
 *     the page sits in. Nothing else. The 2,000-character excerpt begins only
 *     after a session starts.
 *
 *     *"how it was arrived at" was added 2026-08-18, and the word doing the
 *     work is "how".* It is one of five words — see `Arrival` — and it is
 *     **not** the referrer URL those words are computed from. The session path
 *     carries that URL and this one deliberately does not. ~~the computation
 *     happens inside the content script so the URL never crosses a process
 *     boundary.~~ **Corrected 2026-08-18, the same day.** It crosses one: the
 *     content script sends the referrer on every navigation because it must not
 *     be able to tell whether a session is running, and the extension's service
 *     worker deletes it on the no-session branch, in the same destructure that
 *     deletes page text. Nothing buffers it and nothing sends it here. The
 *     claim this line may make is *"no referrer reaches this app on the ambient
 *     path"*, which is what the list above is about. A list that said "the page
 *     they came from" would be describing a different product; a list that
 *     claimed the URL was never handled at all was describing a nicer version
 *     of this one.
 *
 *     *"and scroll" was aspirational until 2026-08-17, and this line should not
 *     have said it. Corrected twice that day, because the first correction
 *     overshot; corrected a third time when the producer landed.* ~~`content.js`
 *     has computed a scroll fraction on every engagement report since the report
 *     existed, and the ambient path drops it — first in `flushAmbient`, which
 *     hand-builds the wire shape and omits the field, and then, until
 *     2026-08-17, in a schema that had nowhere to put it. The schema half is
 *     fixed and `AmbientObservation.scrollFraction` below is real. **The
 *     extension half is not**, so an ambient observation with a scroll fraction
 *     on it comes from a test or a `curl` and from nothing a browser does.~~
 *
 *     **ADR-0013 closed the extension half.** `flushAmbient` copies the scroll
 *     fraction, and carries two new fields beside it: `exitType` and
 *     `groupTitle`. So all four now arrive from a real browser. **Nothing reads
 *     scroll or exit type, deliberately** — landing a signal and consulting it
 *     are two decisions, and only the first has been taken for either. See the
 *     note on `WINDOW_MS`, and `tests/reachability.test.ts`'s deferred block,
 *     which is where both claims are enforced rather than merely written down.
 *
 *     **`arrival` joined them on 2026-08-18, and makes three unread signals.**
 *     Same shape as the other two — the value was already being computed and
 *     transmitted on the session path, and the ambient projection dropped it —
 *     and the same deferral, for reasons argued on the field itself. Three is
 *     worth saying out loud rather than adding quietly: at one it was a lag
 *     between landing and consuming, at three it is a habit, and a product that
 *     defends narrow watching cannot also collect indefinitely against a use
 *     nobody has argued. The deferred block carries the expiry that makes it a
 *     decision — measure the offer rate and judge all three, or take them out.
 *
 *     The group title is the one exception and its limits are exact: it reaches
 *     the NAME and nothing else. It never enters `ThreadPage.terms`, so it
 *     cannot form or join a thread; `grounds.ts` never sees it, so it cannot
 *     fire a ground or move sufficiency. That is pinned by a byte-equality test
 *     rather than by this paragraph.
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
 * How a page was left, as a closed set. ADR-0013.
 *
 * Closed and code-owned, in the same way `ObservationKind` and `GroundKind`
 * are, and for the same reason: the capture layer's vocabulary must have one
 * author. It is written three times — here, as a `z.enum` at
 * `src/app/api/capture/ambient/route.ts`, and as `EXIT_TYPES` in
 * `extension/src/content.js` — and the three are the same three strings. There
 * is no `other`, no `unknown`, and no fall-through; an exit nothing recognises
 * is absent, which every layer already handles.
 *
 * The values are argued at their source. What belongs HERE, because this is the
 * type a future consumer will read and the citation it will reach for is
 * stronger than the field deserves:
 *
 *   - `'hidden'` — the tab stopped being on screen and the document is alive.
 *   - `'left-cached'` — the person navigated away and Chrome kept the document,
 *     so a return runs no script. Chrome's `PageTransitionEvent.persisted`
 *     attests this; it is not inferred.
 *   - `'left-unloaded'` — the document was destroyed. **This one means four
 *     things** — navigated onward, tab closed, browser quit, page reloaded —
 *     and a content script cannot separate them without `tabs`,
 *     `webNavigation` or `history`, none of which this product holds.
 *
 * That last bullet is the reason this is a fact rather than a reading, and also
 * the reason it is not yet consulted: Fox et al.'s decision-tree nodes turn on
 * *"did not go back to the results list"*, a distinction that lives INSIDE
 * `'left-unloaded'`. The evidence for exit type is not automatically evidence
 * for this exit type.
 */
export type ExitType = 'hidden' | 'left-cached' | 'left-unloaded'

/**
 * How a page was ARRIVED at, as a closed set. Added 2026-08-18.
 *
 * Closed and code-owned on the same terms as `ExitType` above. Written three
 * times — here, as a `z.enum` at `src/app/api/capture/ambient/route.ts`, and as
 * `ARRIVALS` in `extension/src/content.js` — and the three are the same five
 * strings. No `other`, no `unknown`, no fall-through.
 *
 * ── What this is a substitute FOR, and what it is not ────────────────────
 *
 * `webNavigation.transitionType` is the browser's own answer to *"did they type
 * this or follow it"*, and `extension/manifest.json` refuses the permission on
 * capability grounds: it is *"the most semantically loaded signal there is"*,
 * and `tests/extension-permissions.test.ts` forbids it. What the content script
 * can see instead is `document.referrer` and Navigation Timing, which the
 * manifest already names as *"partial substitutes"*. This type is those two,
 * classified where they are observed.
 *
 * It is genuinely partial. `transitionType` separates `typed` from `auto_bookmark`
 * from `link` from `form_submit`; this separates a referrer's presence and its
 * origin. The overlap is the one distinction `grounds.ts` is built on.
 *
 *   - `'no-referrer'` — the browser named no referring page. Typed, bookmarked,
 *     or opened in a fresh tab. **It also covers a followed link whose page
 *     suppressed its referrer** (`rel="noreferrer"`, `Referrer-Policy:
 *     no-referrer`), which is chosen-looking evidence for an act nobody chose.
 *   - `'same-origin'` — followed something inside one site.
 *   - `'cross-origin'` — arrived from a different origin. A mail client's link
 *     redirector produces one of these, naming the redirector.
 *   - `'reloaded'` — the navigation type was `reload`. Not necessarily a person:
 *     a page can reload itself.
 *   - `'back-or-forward'` — Back **or** Forward, and it is named for both
 *     because a content script cannot tell them apart. `'went-back'` would be
 *     the same mistake `ExitType` refuses to make with `'left-unloaded'`.
 *
 * ── Why the ambient path carries this and not the referrer ───────────────
 *
 * A referrer is a URL for a page the person came from, which may be somewhere
 * no other part of this product observes. The session path may hold one — a
 * session is consented, scoped and auditable — and `src/capture/semantics.ts`
 * does. The ambient buffer is what was seen while nobody asked, so it holds the
 * classification and never the URL.
 *
 * ~~and the classification is computed in the content script so the URL never
 * crosses a process boundary at all.~~ **Corrected 2026-08-18, after review.**
 * It does cross one. The content script sends `referrer` on every navigation
 * because the session path needs it and the script must not be able to tell
 * whether a session is running; the extension's service worker then deletes it
 * on the no-session branch, in the same destructure that deletes page text, so
 * nothing buffers it and `flushAmbient` has nothing to leave behind. The claim
 * this layer can make is the one that matters here and it is unchanged: **no
 * referrer reaches this app on the ambient path.** There is no field for one,
 * and the extension stops sending one two gates earlier.
 */
export type Arrival =
  | 'no-referrer'
  | 'same-origin'
  | 'cross-origin'
  | 'reloaded'
  | 'back-or-forward'

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
   *
   * **Producer landed 2026-08-17 (ADR-0013).** The paragraph above described a
   * field a browser could not fill: `flushAmbient` hand-built the wire shape and
   * omitted it. It copies it now, so a real Chrome finally sends one. Nothing
   * here consults it and the deferral above is unchanged — the two halves were
   * always separate decisions and only the transport one has been taken.
   */
  readonly scrollFraction?: number | undefined
  /**
   * Engagement only. How the page was left. See `ExitType`.
   *
   * ── Collected, and deliberately consulted by nothing ─────────────────────
   *
   * **The single best-evidenced signal this product did not have.** Fox et al.
   * (TOIS 2005), via `docs/research/intent-suggestion-quality.md` §2.1 and
   * §10.1: dwell plus exit type predicts satisfaction 66% of the time against
   * 70% for the full nineteen-signal model, and every decision-tree node quoted
   * from that paper conditions on exit type rather than on dwell alone. §9's
   * table calls it *"the single best-evidenced addition"*.
   *
   * ── Why it is not read, which is a decision and not a to-do ──────────────
   *
   * Three reasons, in the order they bind:
   *
   *  1. **The distinction the evidence rests on is inside the value we cannot
   *     split.** Fox's satisfaction node is *"spent more than 58 s… and did not
   *     go back to the results list"*; the dissatisfaction node is *"very
   *     little time… and they did go back"*. Both turn on separating a return
   *     from an onward navigation. Our `'left-unloaded'` contains both, and
   *     separating them needs `tabs` or `webNavigation`, which ADR-0002 and the
   *     manifest refuse. Consuming this today would be borrowing the citation,
   *     not applying it.
   *  2. **Consuming it moves the offer bar.** Every candidate use — a
   *     conjunction in `readAround`, a qualifier on `deepestRead` — changes
   *     which afternoons clear it. ADR-0008 names the false positive as the
   *     expensive failure, and the standing decision recorded beside
   *     `WINDOW_MS` and on `scrollFraction` is to land the research without
   *     retuning. A third threshold moving as a side effect of a plumbing
   *     change is exactly the silent widening this file's header refuses.
   *  3. **Nothing measures the offer rate.** §10.5 of the same research says so.
   *     Without it there is no before-and-after to judge a threshold move by,
   *     which is the difference between tuning and guessing.
   *
   * What would justify wiring it: an offer-rate measurement, plus either a way
   * to tell an onward navigation from a close — which would have to be argued
   * as an observation rather than an inference — or a use that needs only the
   * `'hidden'`/`'left-*'` split, which is honestly available today. The
   * deferral is asserted in `tests/reachability.test.ts` beside
   * `scrollFraction`'s, so wiring it turns that file red on purpose.
   */
  readonly exitType?: ExitType | undefined
  /**
   * Navigation and query only. How the page was arrived at. See `Arrival`.
   *
   * ── The third signal collected and consulted by nothing ──────────────────
   *
   * **That count is the important part of this docblock**, and it is written
   * before the case for the field rather than after it. `scrollFraction` and
   * `exitType` are already here, landed and unread. A third is the point at
   * which "collect now, decide later" stops being a step and becomes a policy,
   * and a policy of collecting signals nothing reads is not a neutral one in a
   * product whose whole argument is that it watches narrowly. The deferral is
   * therefore given an expiry in `tests/reachability.test.ts`: either the
   * offer-rate measurement `docs/research/intent-suggestion-quality.md` §10.5
   * says does not exist gets built, and these three get judged against it, or
   * the honest move is to delete the fields rather than keep filling them.
   *
   * ── Why it is worth having anyway ────────────────────────────────────────
   *
   * `grounds.ts` is built on a distinction it currently approximates: *did they
   * pursue this, or receive it?* — `INTENT_GROUNDS` against
   * `INVESTMENT_GROUNDS`. Its header argues that *"somebody who read four pages
   * of a site they arrived at from a newsletter chose nothing — the subject was
   * handed to them"*. Today the only evidence of pursuit in that file is a
   * search. An arrival classification is direct evidence of the same thing, and
   * it is the closest thing available to `webNavigation.transitionType`, which
   * this product refuses on capability grounds and will keep refusing.
   *
   * ── Why it is not read, which is a decision and not a to-do ──────────────
   *
   * Three reasons, in the order they bind. The first is specific to this field
   * and is the one that would bite:
   *
   *  1. **It is weakest exactly where `grounds.ts` most needs it.** The
   *     newsletter afternoon is the false positive that file spends its length
   *     refusing, and a newsletter is among the things that strip referrers —
   *     `rel="noreferrer"`, `Referrer-Policy: no-referrer`. Such a link arrives
   *     as `'no-referrer'`, which is the value that reads as *the person chose
   *     this*. Wiring it as an intent ground would hand the strongest available
   *     evidence of pursuit to the exact session that pursued nothing. And the
   *     value fires constantly in ordinary browsing besides: an omnibox search
   *     reaches the results page unreferred, so almost every session that
   *     contains a search also contains a `'no-referrer'` arrival.
   *  2. **Consuming it moves the offer bar**, and ADR-0008 names the false
   *     positive as the expensive failure. The standing decision recorded
   *     beside `WINDOW_MS`, on `scrollFraction` and on `exitType` is to land
   *     research without retuning.
   *  3. **Nothing measures the offer rate** (§10.5), so there is no
   *     before-and-after to judge a bar move by.
   *
   * What it would feed, so the next person meets a choice rather than a blank:
   * `returnedTo` in `grounds.ts`, whose own docblock already names the exact
   * narrowing — *"count a return only when the person went to a DIFFERENT
   * origin in between"* — as the thing Adar, Teevan & Dumais's 612,000-user
   * revisit study points at, and records that the product owner chose not to
   * make it. A `'cross-origin'` arrival on a page already seen IS that
   * narrowing, observed rather than inferred. Doing it would need `arrival`
   * carried onto `ThreadPage`, which nothing does.
   *
   * **Bounded at the door, not here.** `ambientSchema` is a `z.enum` over the
   * same five strings, so this layer cannot be handed a sixth. The domain reads
   * no clock and validates nothing.
   */
  readonly arrival?: Arrival | undefined
  /**
   * The title a person typed for the tab group this page sits in, if any.
   *
   * ── The only thing here the PERSON wrote ─────────────────────────────────
   *
   * Every other field on this interface is a URL, a page's own title, or a
   * number. This is a label a human authored about their own work, and
   * `docs/research/intent-signals.md` found that pattern to be the top of its
   * ranking four separate times: *"the best intent signals are the ones a
   * person authored… each of which IS the sentence `topics.ts` and
   * `boundaries/subject.ts` spend their length reconstructing, typed by the
   * person, for free."*
   *
   * ── Naming only. This is a rule, not a habit ─────────────────────────────
   *
   * It reaches exactly one place: `Thread.authoredLabel` →
   * `WorkDetected.authoredLabel` → the sentence `describeWork` renders. It is
   * **not** in `ThreadPage.terms`, so it cannot seed a thread, join a page to
   * one, or change a signature; it is not read by `grounds.ts`, so it cannot
   * fire a ground or change sufficiency; and it is not in any model boundary's
   * input, so it cannot reach a prompt. `tests/detection.test.ts` pins the
   * grounds half byte-for-byte and `tests/reachability.test.ts` pins the
   * containment, because a rule nothing enforces is a habit.
   *
   * The reason for the rule is the shape of the signal rather than distrust of
   * the person: §4.3 of the same research says it is *"excellent when present
   * and absent most of the time"*, which is the right shape for improving a
   * name and the wrong shape for anything that decides. And it is untrusted
   * text — bounded at 120 characters at both ends, never in a prompt without
   * `datamark`, never past a gate.
   *
   * ── Where it is weak, named rather than discovered ───────────────────────
   *
   * People label groups "misc", "temp", "stuff" and "Group 3". Nothing here can
   * tell one of those from "world models", and no rule short of a dictionary
   * could. That is precisely why it may not outrank a confident model name and
   * may not touch the grounds: the worst it can do is make one deterministic
   * sentence vaguer than the term list it displaced, which is the same cost as
   * the term list being wrong, and recoverable by reading the next line.
   */
  readonly groupTitle?: string | undefined
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
  /**
   * The name the person gave this thread themselves, if they gave one.
   *
   * The tab group title carried by most of the thread's pages — see
   * `authoredLabelOf` in `topics.ts` for the tie-break and why it is
   * deterministic. Absent when no page in the thread is in a titled group,
   * which is most of the time.
   *
   * **Optional rather than `string | null`, and that is not laziness.** Every
   * other field here is required, and a fixture that builds a `WorkDetected` by
   * hand — `tests/grounds.test.ts` does, on purpose, so that a shape change is
   * noticed — would otherwise have to invent a value for a field it has no
   * opinion about. Absent means "the person named nothing", which is exactly
   * what a fixture that says nothing means.
   *
   * Read by one thing: `describeWork` in `src/server/ambient-store.ts`. It is
   * NOT in any model boundary's input, NOT read by `grounds.ts`, and NOT part
   * of `signatureOf`, which is computed from `terms`. Adding a reader is a
   * decision about untrusted person-authored text reaching a new place, and
   * `tests/reachability.test.ts` is where it has to be argued.
   */
  readonly authoredLabel?: string | undefined
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
      /**
       * The most recent group title seen for this page, if any.
       *
       * Later non-empty wins, which is the same rule the title one line up
       * follows and it is the same argument: a person can drag a tab into a
       * group, or rename the group, at any time, and the current label is the
       * one that describes what they are doing now. `??` rather than `||`
       * because absent already means absent — the door strips a whitespace-only
       * title, so there is no empty string to fall back past.
       *
       * Note what this does NOT do: it does not touch `terms`. A group title
       * cannot seed a thread, cannot join a page to one, and cannot appear in a
       * signature. See `AmbientObservation.groupTitle`.
       */
      ...(o.groupTitle === undefined && existing?.groupTitle === undefined
        ? {}
        : { groupTitle: o.groupTitle ?? existing?.groupTitle }),
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
    // Carried, never computed here. `findThreads` decides it from the members,
    // which is where the tie-break has to live so that two callers holding the
    // same thread cannot disagree about what the person called it.
    ...(thread.authoredLabel === undefined ? {} : { authoredLabel: thread.authoredLabel }),
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
