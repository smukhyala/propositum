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
 *   - **Metadata only.** A cleaned URL, a title, dwell, scroll, how the page was
 *     left, how it was arrived at, and — where the person made one — the title
 *     of the tab group the page sits in. There is no field for page text, and
 *     the 2,000-character excerpt begins only after a session starts. A test
 *     asserts the shape so this cannot drift.
 *
 *     **"how it was arrived at" added 2026-08-18, and it is one word, not a
 *     URL.** `arrival` is one of five closed values — `no-referrer`,
 *     `same-origin`, `cross-origin`, `reloaded`, `back-or-forward` — computed
 *     inside the content script from `document.referrer` and Navigation Timing.
 *     The referrer URL itself is **not** on this path and is not held here. It
 *     is on the session path, where `src/capture/semantics.ts` stores it,
 *     because a session is consented and scoped and its rows are auditable. The
 *     asymmetry is the point: a referrer names a page the person came FROM,
 *     which may be somewhere this buffer never otherwise observes, and this
 *     buffer is the part of the product that watches without being asked.
 *
 *     *(One correction worth carrying here even though it is about the
 *     extension, 2026-08-18. The sentence above is about THIS store and was
 *     always true — `flushAmbient` builds the wire shape by hand and never
 *     copied a referrer. Four other places said the stronger thing, that the
 *     URL never left the page at all, and that was false: the content script
 *     cannot know whether a session is running, so it sends the referrer every
 *     time, and the extension's service worker was buffering it in
 *     `chrome.storage.session` on the no-session branch. It now deletes it
 *     there, beside page text. The claim this file makes did not have to
 *     change; the ones that overstated it did.)*
 *
 *     *"and scroll" was corrected twice on 2026-08-17 and then overtaken by the
 *     change it was describing.* ~~The field exists now and `record` carries it
 *     unchanged, which `tests/ambient-store.test.ts` proves. **What does not
 *     exist is a sender.** `flushAmbient` in `extension/src/service-worker.js`
 *     builds the ambient wire shape field by field and does not copy
 *     `scrollFraction`, so the only way a value reaches this store is a direct
 *     POST — `curl`, or a test.~~
 *
 *     **ADR-0013 added the sender**, along with `exitType` and `groupTitle`. So
 *     all four now arrive from a browser rather than from a `curl`, and the
 *     sentence above is true of what is held for the first time.
 *
 *     ~~**Nothing reads scroll, exit type or arrival to decide anything**, and
 *     `tests/reachability.test.ts` holds all three as deferred assertions so
 *     wiring one cannot happen quietly.~~
 *
 *     **Re-marked 2026-08-20
 *     ([ADR-0018](../../docs/adr/0018-the-everyday-shapes.md)): both halves of
 *     that sentence are false.** All three are read. `detect.ts` folds them onto
 *     `ThreadPage` and `grounds.ts` decides on them — `heldOpenUnread` is
 *     `scrollFraction === 0 && exitType === 'hidden'`, `cameFromElsewhere` reads
 *     `returnArrivals`, and `comparedOptions` reads scroll and arrival together
 *     — and those grounds move the offer bar in both directions, which is
 *     exactly what the struck sentence promised they could not do. The three
 *     deferred assertions went red in the same wave and were replaced by *the
 *     three landed signals are consulted, and each by something named*. This
 *     note is re-marked rather than edited because it made a promise about a
 *     guard: somebody wiring a fourth consumer on the strength of it would have
 *     got a green suite and no warning, which is the failure `detect.ts` was
 *     corrected for on the day and this file was not.
 *
 *     *(Widened 2026-08-18, after review, and the correction is worth reading
 *     because the sentence above was ahead of what the guard did. Each deferral
 *     scanned only files under `src/domain/detection`, and `AmbientObservation`
 *     is consumed in four files outside it — including `src/server/front-door.ts`,
 *     which is the offer bar. A planted line there suppressing every strand
 *     whenever any observation was `'no-referrer'` passed all 1,496 tests and
 *     the typecheck. ~~The guards now cover every file under `src` and `scripts`,
 *     with an explicit allowance naming each transport site and its exact
 *     count.~~ **Re-marked 2026-08-20: that mechanism is gone.** An exact-count
 *     budget cannot survive the promotion above, and ~~`unallowedMentions` in
 *     `tests/reachability.test.ts` now has no caller at all~~ **— corrected
 *     2026-08-20: `unallowedMentions` is not uncalled, it is DELETED, and this
 *     sentence pointed a reader at a helper they could have handed a caller back
 *     to. It kept its declaration for one merge after its last caller went and
 *     was removed then; `tests/reachability.test.ts` records why it was not
 *     handed a fresh one instead.** What replaced it is
 *     the weaker positive claim that a named reader exists in a named file —
 *     which cannot catch a mention appearing somewhere nobody thought to name,
 *     and that loss is recorded in the test file rather than hidden. The
 *     planted-line story above is worth keeping precisely because the guard that
 *     would have caught it no longer runs.)*
 *
 *     The group title has exactly one reader
 *     and it is in this file: `describeWork` puts it in a sentence. It reaches
 *     no ground, no gate and no prompt, which is asserted rather than intended.
 *
 *     ~~Three unread signals is a number worth writing down rather than letting
 *     accumulate. The deferred block carries what would end it, and what should
 *     happen if that never arrives.~~ **Re-marked 2026-08-20: none of them is
 *     unread, so there is no number to write down.** The expiry the `arrival`
 *     deferral carried — judge all three against an offer-rate measurement, or
 *     take the fields out rather than keep filling them — was discharged by
 *     consuming them. What is left over from it is a different debt, and it is
 *     ADR-0018's *Revisit when*: `npm run eval -- --report` prints
 *     offers-per-observed-hour and still has nobody's real afternoons behind it.
 *
 *     One thing worth naming while the list is being rewritten: a group title
 *     is the first thing this buffer holds that the PERSON wrote, rather than a
 *     page. Same window, same row cap, same discard on decline — but it is a
 *     different category from a URL and a page's own title, and filing it
 *     silently under "metadata" would be the kind of rounding-up this header
 *     exists to refuse.
 *   - **Bounded twice** — by a rolling time window and by a hard row cap, so a
 *     day of browsing cannot accumulate into a profile.
 *   - **Discarded by default.** Declining an offer clears it. Accepting one
 *     folds it into the new session, where it becomes a normal, auditable
 *     ObservationEvent with the ordinary rules applying.
 *
 * ── One durable thing sits beside this now, and it holds no subject ──────
 *
 * *(Added 2026-08-18.)* Three markers at the bottom of this interface —
 * `newlyShown`, `newlySuppressed`, `newlyObservedMinute` — let a caller count
 * an offer, a suppression or a minute of watching exactly once. The counts
 * themselves are written to `offer_tally`, which IS durable, and the reason
 * that does not contradict the four bullets above is worth stating here rather
 * than only where the table is declared:
 *
 * **A bare tally is not a profile, and that distinction is the whole design.**
 * *"Four offers were shown in the last hour of observed browsing"* says nothing
 * about what they were about. *"Offer for 'perturbation robotics' declined at
 * 14:32"* is exactly the row `WorkOffer`'s docblock below refuses. The table has
 * four integer columns and a date, and no column a term, a signature, an origin,
 * a title or a URL could be written in — so the refused row is refused
 * structurally rather than by anybody remembering.
 *
 * What crosses out of this object is therefore a boolean, never a signature. The
 * signatures the markers hold to deduplicate stay in here, bounded by the same
 * buffer life and erased by the same `clear()`.
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
import type { OfferGrounds } from '../domain/detection/grounds'
import type { ShiftOutcomeKind } from '../domain/outcome/shift-outcome'

/**
 * A hard ceiling independent of the window.
 *
 * The window alone is not a bound: a busy hour could hold thousands of rows and
 * still be "the last 30 minutes". This makes the worst case a number someone
 * can reason about.
 */
export const MAX_OBSERVATIONS = 500

/** Once declined, stay quiet about the same thing for this long. One number for
 *  both units — an origin, from the extension's decline endpoint, and a thread
 *  signature, from the front door's per-strand "Not now". `service-worker.js`
 *  mirrors it rather than reading it, and says so. */
export const SNOOZE_MS = 60 * 60_000

/** A thread that has been named, keyed by the terms that defined it. */
export interface NamedThread {
  readonly signature: string
  readonly subject: string
  readonly confident: boolean
}

/**
 * What Propositum would do about a named thread, before anybody has said yes.
 *
 * ── In memory, and durable only on acceptance ────────────────────────────
 *
 * This never touches SQLite until a person accepts it, which is the same rule
 * the header above applies to ambient observations and it is there for the same
 * reason: a durable row saying "Propositum thought you were job-hunting" about
 * an offer NOBODY ACCEPTED is exactly the profile this buffer refuses to
 * become. Declining has to cost nothing and leave nothing behind, or the honest
 * thing to do with the feature is turn it off.
 *
 * ── It grants nothing ────────────────────────────────────────────────────
 *
 * Every field except `grounds` and `expects` is prose a model wrote, and
 * nothing reads any of it to decide anything. There is no field for a URL, a
 * host, an origin or a source id — the sites come from the buffer, keyed by
 * this thread's signature, on the accept path. See `boundaries/offer.ts`.
 */
export interface WorkOffer {
  readonly signature: string
  /** Recorded so an accepted offer can say which prompt composed it. */
  readonly promptVersion: string
  readonly title: string
  readonly rationale: string
  /** OfferOutline — ordered one-line intentions. Display only: these never
   *  become PlanSteps, and no gate reads them. */
  readonly outline: readonly string[]
  readonly produces: string
  /** What the offer says it will NOT do. `excludes` rather than CONTEXT.md's
   *  `willNotDo`, because the column that stores it on acceptance is already
   *  called `excludes` — one word for one concept, and the schema is the side
   *  that is harder to change. */
  readonly excludes: readonly string[]
  /** ShiftOutcomeKinds, already coerced against the closed set. A statement
   *  about the shape of a result, never about what may be done. */
  readonly expects: readonly ShiftOutcomeKind[]
  /** What the deterministic bar saw, frozen here because the buffer it was
   *  computed from is bounded by a window and a cap and will not hold the
   *  answer an hour later. */
  readonly grounds: OfferGrounds
  /** False when the reading did not add up to one thing worth doing. The
   *  interface must render that as vagueness rather than suppress it. */
  readonly confident: boolean
}

export interface AmbientStore {
  /** The name for this thread, if one has been produced. */
  nameFor(signature: string): NamedThread | null
  /** Record a name. Dropped if `clear()` ran while the call was in flight —
   *  see the implementation, and `startNaming` must precede it. */
  remember(named: NamedThread): void
  /** True while a naming call is actually in flight. For an interface that
   *  wants to say "working it out" rather than showing nothing. */
  isNaming(signature: string): boolean
  /**
   * True once naming has been ATTEMPTED at all — in flight, finished with a
   * name, or finished with nothing.
   *
   * This is the question the caller has to ask, and asking the other one is the
   * defect it replaced: `nameFor() || isNaming()` was false again the moment a
   * failed call cleared its marker, so a model that kept failing was re-called
   * on every 30-second poll, forever. Measured at about sixty retries.
   */
  attemptedNaming(signature: string): boolean
  startNaming(signature: string): void
  /** The attempt concluded with no name. Clears the in-flight marker and leaves
   *  the attempt recorded, so it is never made again for this thread. */
  finishNaming(signature: string): void

  /** The offer for this thread, if one has been composed. */
  offerFor(signature: string): WorkOffer | null
  /** Record an offer. Dropped if `clear()` ran while the call was in flight. */
  rememberOffer(signature: string, offer: WorkOffer): void
  /** True while a composing call is in flight. */
  isComposing(signature: string): boolean
  /** True once composing has been attempted at all. Same shape and same reason
   *  as `attemptedNaming` — a failure is a settled outcome, not a reason to
   *  ask the same model the same thing again in thirty seconds. */
  attemptedOffer(signature: string): boolean
  startComposing(signature: string): void
  /** The attempt concluded with no offer. */
  finishComposing(signature: string): void
  /** The pages that formed a thread, kept so accepting carries the THREAD
   *  rather than everything from the same sites. */
  rememberThread(signature: string, urls: readonly string[]): void
  pagesOfThread(signature: string): readonly string[]
  /** Observations for an explicit set of pages. */
  forUrls(urls: readonly string[], nowMs: number): readonly AmbientObservation[]
  /**
   * Record one ambient observation. Trims by window and cap on the way in.
   *
   * A titleless ENGAGEMENT inherits the most recent title still held IN THE
   * WINDOW for the same URL, from a navigation or a query — the extension sends
   * a title on those and not on an engagement, and a page whose navigation has
   * aged out would otherwise keep reporting minutes of reading under an empty
   * name. Nothing outside the window is consulted, and a copy is never itself
   * copied, so a title is at most just under two windows old — once for the
   * navigation's own life, once for the copy's. See the implementation for the
   * whole argument, including what it deliberately does not build.
   */
  record(observation: AmbientObservation, nowMs: number): void
  /** Everything still inside the window, oldest first. */
  since(nowMs: number): readonly AmbientObservation[]
  /**
   * Which buffer this is. A counter, changed once by every `clear()`.
   *
   * The question `isComposing` cannot answer. That one says whether a call is
   * running under some signature; this one says whether the buffer the caller
   * read its inputs out of still exists. They come apart precisely when it
   * matters: a `clear()` empties the in-flight markers AND the attempt memory,
   * so the very next poll can start a second call under the same signature —
   * at which point `isComposing` is true again and is true about somebody
   * else's work.
   *
   * `composeOffer`'s retry is the only caller and the only reason this exists.
   * It holds a prompt built out of a person's page titles and typed searches
   * across an await, and a marker that can come back true is not a safe thing
   * to ask before spending money on sending it.
   */
  generation(): number
  /** Forget everything. Called on decline, on session start, and on stop. */
  clear(): void
  /** Stop offering for this origin until the snooze expires. */
  decline(origin: string, nowMs: number): void
  isSnoozed(origin: string, nowMs: number): boolean
  /**
   * The person turned down ONE strand. Forget its pages; leave the others.
   *
   * ── Why this is not `decline` with a different argument ──────────────
   *
   * `decline` drops every observation on an ORIGIN, which was right while one
   * afternoon produced one offer. It is wrong the moment `detectThreads`
   * returns three, because strands share sites — an afternoon that begins with
   * three google searches puts `https://www.google.com` at the head of all
   * three, so "not now" to Kalman filters would drop the searches that seeded
   * the robotics strand and the DMD-vs-SPO strand as well. The two other
   * strands would vanish from the screen with nothing saying why, which is the
   * silent kind of wrong.
   *
   * So the unit here is the THREAD: its own pages go, keyed by the URLs it was
   * made of, and a page another strand also holds cannot be one of them —
   * `findThreads` claims each page exclusively, so the URL sets are disjoint by
   * construction.
   *
   * ── And the signature is snoozed, not the site ───────────────────────
   *
   * Dropping the pages is not enough on its own: the person is probably still
   * reading, and the same subject would re-form and be offered again within a
   * poll or two. `SNOOZE_MS` against the signature is what makes "not now" mean
   * an hour, exactly as it does for an origin.
   *
   * ── What is still coarse, named rather than discovered ───────────────
   *
   * `decline(origin)` remains, because `/api/capture/ambient/decline` takes an
   * origin from the extension and the extension is not being changed here. A
   * decline through that path is still origin-wide and can still take a second
   * strand's pages with it. That path only ever names the strongest strand — the
   * notification does — so the person is turning down the one thing they were
   * shown, and the collateral is invisible to them. It is a real gap and it
   * closes when the extension can send a signature.
   */
  declineThread(signature: string, urls: readonly string[], nowMs: number): void
  isThreadSnoozed(signature: string, nowMs: number): boolean
  /** Observations for one origin, for folding into a session on accept. */
  forOrigin(origin: string, nowMs: number): readonly AmbientObservation[]
  size(): number

  /* ── three markers, so a count can be taken once ──────────────────────── */

  /**
   * True the FIRST time this strand is put in front of the person, and false
   * afterwards. Marks it on the way through.
   *
   * ── Why this is here and the count is not ────────────────────────────
   *
   * These three answer *is this new?* and nothing else. They hold no totals,
   * and a total in this object would answer nothing worth asking: the buffer
   * dies with the process, so a tally inside it could never say what happened
   * across a day, which is the only timescale on which an offer rate creeping
   * upward is visible at all. The counts live in `offer_tally`, one row per
   * day, four integers and no subject — see `src/server/offer-tally.ts` and the
   * schema's docblock, which argues that table against ADR-0008's refused row
   * directly.
   *
   * What is here is the deduplication, and it has to be here: the poll runs
   * every 30 seconds and Home re-renders on every visit, so counting a
   * detection each time it is *computed* would report an afternoon's one strand
   * as a hundred offers. A strand is counted once per buffer.
   *
   * ── The two sets are signatures, so `clear()` takes them ─────────────
   *
   * A signature IS the subject — it is the thread's terms joined — so these
   * cannot survive a decline or a session start when nothing else keyed that
   * way does. They are erased with the names, the offers and the pinned pages,
   * and they are no new category of held value: the same keys already sit in
   * three maps above.
   *
   * The cost is an over-count. A strand shown, declined, and detected again an
   * hour later is counted twice, because after `clear()` this object cannot
   * know it is the same strand and must not be able to. That error is in the
   * direction that raises an alarm rather than quiets one, which is the only
   * direction a measurement of one's own loudness may round.
   */
  newlyShown(signature: string): boolean
  /** True the first time this strand is found and NOT shown. Same marking, same
   *  erasure, same over-count, same direction. */
  newlySuppressed(signature: string): boolean
  /**
   * True the first time a report arrives in this minute of wall clock.
   *
   * The denominator's unit. One integer — the minute last counted — and never a
   * set, so this holds no history of when anybody browsed; it can answer *have
   * I already counted this minute* and no other question.
   *
   * **It deliberately survives `clear()`, and that is the one exception in this
   * object.** `clear()` forgets what was SEEN; a minute number names no page,
   * no site and no subject, and resetting it would let the same minute be
   * counted twice — inflating the denominator, which lowers the offer rate.
   * That is the direction this measurement may not round in. `generation` is
   * the precedent: it survives a clear too, because something has to.
   */
  newlyObservedMinute(nowMs: number): boolean
}

export function createAmbientStore(): AmbientStore {
  let observations: AmbientObservation[] = []
  const declined = new Map<string, number>()
  /** Separate from `declined` rather than sharing it, because the two are keyed
   *  by different things and one map holding origins and signatures at once is
   *  a lookup that can only be read correctly by knowing which it meant. */
  const declinedThreads = new Map<string, number>()
  const names = new Map<string, NamedThread>()
  const naming = new Set<string>()
  const offers = new Map<string, WorkOffer>()
  const composing = new Set<string>()
  const threads = new Map<string, readonly string[]>()

  /**
   * Every thread a model has been asked about, whatever came back.
   *
   * Separate from the in-flight sets on purpose. "Is a call running" and "has a
   * call ever been made" are different questions, and conflating them is the
   * whole of the retry defect: the second one is what decides whether to spend
   * money, and it has to stay true after a failure clears the first.
   */
  const attemptedNames = new Set<string>()
  const attemptedOffers = new Set<string>()

  /**
   * Which strands have already been counted, so a poll cannot count one twice.
   *
   * Signatures, therefore erased by `clear()` with everything else keyed that
   * way. See the interface docs on `newlyShown` for what that costs and why the
   * cost is in the acceptable direction.
   */
  const countedShown = new Set<string>()
  const countedSuppressed = new Set<string>()

  /**
   * The last minute of wall clock counted, as `floor(ms / 60000)`.
   *
   * A single number, never a list. Not erased by `clear()` — see `newlyObservedMinute`.
   */
  let countedMinute: number | null = null

  /**
   * How many buffers ago this is. Counts `clear()`s and nothing else.
   *
   * A number rather than a boolean because "has it been cleared" is not the
   * question — a caller that started under buffer 3 needs to know it is still
   * buffer 3, and a clear-then-refill would answer a boolean wrongly. It never
   * resets, which is what makes "still mine" decidable by equality.
   */
  let generation = 0

  const trim = (nowMs: number) => {
    observations = observations.filter((o) => nowMs - o.at <= WINDOW_MS)
    if (observations.length > MAX_OBSERVATIONS) {
      // Drop the oldest. Recent activity is what a detection is about.
      observations = observations.slice(observations.length - MAX_OBSERVATIONS)
    }
  }

  /**
   * The same page's title, when this report arrived without one.
   *
   * ── The signal this recovers ─────────────────────────────────────────
   *
   * `content.js` sends `title` on a navigation and NOT on an engagement, which
   * sends url, dwell, scroll and whether anyone interacted. Inside the window
   * that costs nothing — `pagesOf` already keeps the most informative title per
   * URL, so the navigation's title covers its own engagements. It starts
   * costing the moment the NAVIGATION ages out and the engagements do not: the
   * page is still open, still being read, still reporting every fifteen
   * seconds, and every one of those reports now has an empty title, so
   * `termsOf('', url)` falls back to the URL alone.
   *
   * Observed exactly that way: `robot-colosseum.github.io` held three engaged
   * minutes — the most of anything in the buffer — with an empty title, and
   * contributed almost nothing to thread formation. The page read hardest was
   * the page that counted least.
   *
   * ── Why here and not in the extension ────────────────────────────────
   *
   * The extension has no build step, so shipping a fix through it means asking
   * a person to reload an unpacked extension by hand — a manual step nobody
   * else can take for them, on the one component whose whole point is that it
   * runs unattended. The buffer already holds the title, keyed by URL. Fixing
   * it on the side that redeploys itself is the smaller change.
   *
   * ── What this deliberately is NOT ────────────────────────────────────
   *
   * Not a title map, not a cache, not an index — no structure of any kind that
   * outlives the window or survives `clear()`. ADR-0008's argument is that this
   * buffer is non-durable and bounded twice, and a lookup table of "titles we
   * have seen for URLs" would be a NEW RETENTION SURFACE introduced as a bug
   * fix, which is the worst way for one to arrive. So this reads the same array
   * everything else reads, after the same trim, and when a page's navigation
   * has already aged out there is nothing to carry forward and the title stays
   * empty. That is the correct outcome, not a gap to be plugged.
   *
   * ── One hop, and why it had to be exactly one ────────────────────────
   *
   * ~~A title CAN outlive the observation it came from. Engagement at 10:00
   * copies the title from a 09:35 navigation; at 10:30 that navigation is gone
   * but the 10:00 engagement is still here carrying the copy, and the 10:30
   * engagement copies it again. Chained far enough, a title from an hour ago
   * survives on a page still being read now. That is more than "the last thirty
   * minutes of titles", and it is worth saying rather than discovering. It is
   * not a retention surface: every copy lives on an ordinary row, inside the
   * window, counted against `MAX_OBSERVATIONS`, dropped by `decline`, and
   * erased by `clear` along with everything else. But it is a longer life than
   * the row it was copied from had, and that is a real widening rather than a
   * neutral one.~~
   *
   * **Amended 2026-08-16 — "worth saying" was not enough, and the chain is
   * closed.** Said out loud it still sounded bounded. Measured, it is not: one
   * navigation titled at 10:00 and a titleless engagement every ten minutes
   * afterwards kept that title alive for three hours, six times the window, and
   * would have kept it alive for as long as the tab stayed open. ADR-0008's
   * decision table says the buffer is bounded by a 30-minute window AND a
   * 500-row cap, and names the title as one of the four things it holds. A
   * title with no upper bound on its age is that row of the ADR being false,
   * and a comment conceding it does not make it true.
   *
   * So a copy is made under two conditions, and together they bound the chain
   * at exactly one hop:
   *
   *   - **Only a row the extension itself titled may be the SOURCE.** A
   *     navigation and a query arrive from `content.js` with the document's own
   *     title; an engagement never does.
   *   - **Only an engagement may RECEIVE one.** This is the half that does the
   *     proving. Without it a titleless navigation could take a copy and then
   *     be a source for the next one, and the chain would be back by a longer
   *     road.
   *
   * A source's title is therefore always one the extension sent, and the bound
   * that gives is a number rather than a hope — but it is not thirty minutes,
   * and rounding it to thirty would be the same kind of wrong this replaces.
   * The worst case is a navigation at 10:00 and an engagement at 10:29 that
   * copies from it one minute before it expires: that copy is dropped at 10:59,
   * so a title can be **just under two windows old**, and never more, because
   * nothing may copy it again. Twice a stated bound is a real widening; an
   * unbounded one was a different thing entirely. ADR-0008's decision table
   * carries the same sentence, so the two do not disagree.
   *
   * What that gives up, stated: a titleless NAVIGATION for a page already in
   * the buffer keeps its empty title. `content.js` sends the document title on
   * a navigation, so a titleless one is a page that genuinely had no title at
   * that moment, and inventing its old one back is a guess. The defect this
   * whole function exists for was engagements, and engagements are what it
   * still fixes.
   */
  const withCarriedTitle = (observation: AmbientObservation): AmbientObservation => {
    if (observation.title !== '') return observation
    if (observation.kind !== 'engagement') return observation

    // Backwards: the most recent title for this URL is the one that describes
    // it now. A single-page app rewrites its title without navigating.
    for (let i = observations.length - 1; i >= 0; i -= 1) {
      const earlier = observations[i]
      if (earlier === undefined) continue
      if (earlier.url !== observation.url) continue
      if (earlier.kind !== 'navigation' && earlier.kind !== 'query') continue
      if (earlier.title === '') continue
      // Spread, not a field list, and that is load-bearing rather than
      // idiomatic: the ONLY thing being replaced here is the title, and an
      // engagement is the one kind that carries `scrollFraction` and `exitType`.
      // Rewriting this as an explicit `{ at, origin, url, title, kind,
      // engagedMs }` would drop both from precisely the observations that have
      // them, and would do it silently — nothing reads either field yet, so no
      // test outside `tests/ambient-store.test.ts` would notice.
      //
      // `groupTitle` is on every kind rather than only engagements, and is the
      // same argument one step stronger: it is the only person-authored value
      // in the buffer, and losing it here would show up as a thread quietly
      // reverting to its stemmed-word name with nothing saying why.
      return { ...observation, title: earlier.title }
    }

    return observation
  }

  return {
    /**
     * Trimmed on the way IN as well as after, and the first trim is the
     * load-bearing one.
     *
     * `withCarriedTitle` reads whatever is in the array, so what is in the
     * array when it reads has to be what is inside the window. Without the
     * first call, a buffer that had gone forty minutes without a report would
     * still be holding rows the window has expired, and a title could be
     * carried forward off one of them — quietly making the carry-forward the
     * one thing here that is not bounded by the window. The second call is the
     * original bound, unchanged, and it is still needed because a push can put
     * the array one over `MAX_OBSERVATIONS`.
     */
    record(observation, nowMs) {
      trim(nowMs)
      observations.push(withCarriedTitle(observation))
      trim(nowMs)
    },

    since(nowMs) {
      trim(nowMs)
      return observations
    },

    generation: () => generation,

    /**
     * Forget everything, and mean everything.
     *
     * This used to drop the observations and keep the names — so a subject
     * Propositum had worked out about somebody survived the session start that
     * was supposed to fold it in, and would have survived a decline. With a
     * composed offer in here too, that gap stops being untidy: an offer is a
     * paragraph about what somebody appeared to be doing, and one that outlives
     * "no thanks" is the profile this whole object refuses to become.
     *
     * The attempt memory goes with it, and that is right rather than a
     * loophole. It exists to stop the SAME still-detected thread being asked
     * about on every poll; a clear only happens when a person has started a
     * session or turned an offer down, and whatever browsing comes afterwards
     * is genuinely new.
     *
     * `generation` is the one thing here that goes UP rather than away, and it
     * is what lets a call already in flight find out that this happened. See
     * the interface doc: dropping the markers is what makes them unsafe to ask
     * about afterwards, so something has to survive to say so.
     */
    clear() {
      generation += 1
      observations = []
      names.clear()
      naming.clear()
      offers.clear()
      composing.clear()
      attemptedNames.clear()
      attemptedOffers.clear()
      threads.clear()
      // Signatures, so they go with the rest of the signatures. `countedMinute`
      // is not one and stays — the argument is on `newlyObservedMinute`.
      countedShown.clear()
      countedSuppressed.clear()
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

    /**
     * One strand turned down. Its pages go; every other strand is untouched.
     *
     * The name cache, the offer cache and the remembered pages are left alone
     * on purpose, and this is the one place that decision is visible. `clear()`
     * empties all of them because a clear means the whole buffer is forgotten;
     * this is narrower by design, and emptying a map that is keyed by signature
     * for a signature nobody asked about would be reaching past the strand the
     * person actually answered. The declined signature's own entries are
     * unreachable afterwards anyway — its pages are gone, so it cannot be
     * detected again, and `isThreadSnoozed` refuses it for an hour regardless.
     */
    declineThread(signature, urls, nowMs) {
      declinedThreads.set(signature, nowMs)
      const dropped = new Set(urls)
      observations = observations.filter((o) => !dropped.has(o.url))
    },

    isThreadSnoozed(signature, nowMs) {
      const at = declinedThreads.get(signature)
      return at !== undefined && nowMs - at < SNOOZE_MS
    },

    forOrigin(origin, nowMs) {
      trim(nowMs)
      return observations.filter((o) => o.origin === origin)
    },

    rememberThread(signature, urls) {
      threads.set(signature, [...urls])
    },
    pagesOfThread: (signature) => threads.get(signature) ?? [],
    forUrls(urls, nowMs) {
      trim(nowMs)
      const wanted = new Set(urls)
      return observations.filter((o) => wanted.has(o.url))
    },

    nameFor: (signature) => names.get(signature) ?? null,
    /**
     * Record a name, unless the buffer was forgotten while the call was in
     * flight.
     *
     * A model call takes about fifteen seconds and a person can decline or
     * start a session inside that. `clear()` empties the in-flight marker along
     * with everything else, so its absence here means exactly one thing: this
     * result is about a buffer that no longer exists, and writing it would put
     * a subject back that somebody has just been promised was thrown away.
     */
    remember(named) {
      if (!naming.has(named.signature)) return
      names.set(named.signature, named)
      naming.delete(named.signature)
      attemptedNames.add(named.signature)
    },
    isNaming: (signature) => naming.has(signature),
    attemptedNaming: (signature) => attemptedNames.has(signature),
    startNaming(signature) {
      naming.add(signature)
      attemptedNames.add(signature)
    },
    /**
     * Guarded on `naming.has`, for the same reason `remember` is.
     *
     * A call that lands after `clear()` is a call about a buffer nobody holds
     * any more — the person accepted an offer, or declined one, and everything
     * that was in flight is about work that has already been resolved. `remember`
     * already drops such a result rather than writing it back. This path used
     * to `attemptedNames.add` unconditionally, which meant a FAILED call landing
     * after a clear re-poisoned the signature: the thread was then permanently
     * unnameable for the lifetime of the process, and nothing said why.
     *
     * The failure was invisible in the ordinary way — a thread that simply never
     * got a name reads as a thread the model was not confident about.
     */
    finishNaming(signature) {
      if (!naming.has(signature)) return
      naming.delete(signature)
      attemptedNames.add(signature)
    },

    offerFor: (signature) => offers.get(signature) ?? null,
    /** Dropped when the buffer was forgotten mid-call, for the reason given on
     *  `remember` — and it matters more here, because an offer says more about
     *  a person than a name does. */
    rememberOffer(signature, offer) {
      if (!composing.has(signature)) return
      offers.set(signature, offer)
      composing.delete(signature)
      attemptedOffers.add(signature)
    },
    isComposing: (signature) => composing.has(signature),
    attemptedOffer: (signature) => attemptedOffers.has(signature),
    startComposing(signature) {
      composing.add(signature)
      attemptedOffers.add(signature)
    },
    /** Guarded on `composing.has`, exactly as `finishNaming` is, and it matters
     *  more here for the reason `rememberOffer` gives: an offer says more about
     *  a person than a name does, so a result about a buffer nobody holds any
     *  more must leave no trace at all. */
    finishComposing(signature) {
      if (!composing.has(signature)) return
      composing.delete(signature)
      attemptedOffers.add(signature)
    },

    size: () => observations.length,

    newlyShown(signature) {
      if (countedShown.has(signature)) return false
      countedShown.add(signature)
      return true
    },

    /**
     * Marked in its own set rather than sharing `countedShown`.
     *
     * A strand can be suppressed on one render and shown on the next — the
     * bound is applied after the snooze filters, so declining the leader
     * promotes the fourth strand onto the screen. One set would make that
     * strand's promotion invisible, which is the specific silence ADR-0008
     * says the multi-strand change existed to remove. Two sets count it as one
     * suppression and one showing, which is what happened.
     */
    newlySuppressed(signature) {
      if (countedSuppressed.has(signature)) return false
      countedSuppressed.add(signature)
      return true
    },

    /**
     * `<=` rather than `!==`, which costs nothing and closes one direction.
     *
     * Equality would count minute 100 a second time if the clock ever went
     * backwards over a minute boundary — an NTP correction, a laptop waking —
     * and a double-counted minute inflates the denominator and lowers the
     * reported offer rate. Refusing anything at or before the last counted
     * minute means the worst a backwards clock can do is lose minutes, which
     * is the direction that reports MORE offers per hour than really happened.
     */
    newlyObservedMinute(nowMs) {
      const minute = Math.floor(nowMs / 60_000)
      if (countedMinute !== null && minute <= countedMinute) return false
      countedMinute = minute
      return true
    },
  }
}

/** The identity of a thread, for caching a name against it. Terms are already
 *  ordered by how often they recur, so the same subject followed longer keeps
 *  the same signature until its shape genuinely changes. */
export function signatureOf(terms: readonly string[]): string {
  return terms.slice(0, 4).join('+')
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
      /** The primary site, for the source that gets approved on accept. */
      readonly origin: string
      /** Every site the thread runs through. */
      readonly origins: readonly string[]
      /** The recurring subject words. */
      readonly terms: readonly string[]
      /** The thread's signature. The only identifier a link may carry, and the
       *  key the accept path reads everything else off the buffer with. */
      readonly thread: string
      /** Present once the subject boundary has named the thread. Absent for the
       *  first poll or two, and absent for good when there is no API key. */
      readonly subject?: string | undefined
      /** Rendered verbatim. Says what was seen, never what it means. */
      readonly sentence: string
      readonly because: string
      readonly detected: WorkDetected
    }
  /**
   * The full offer: what Propositum would DO about what it saw, in its own
   * words, above the deterministic grounds that permitted it to ask.
   *
   * `start-session` above is the DEGRADED FORM of this, not a different
   * feature. When the grounds bar is not met, or no offer has been composed —
   * because composing takes about fifteen seconds, or because there is no API
   * key at all — the person still gets "you have been looking into X, across
   * three sites" and a button that starts watching. The feature degrades to
   * yesterday's behaviour rather than vanishing, which matters because a poll
   * that answers `null` is indistinguishable to the extension from detection
   * having failed.
   */
  | {
      readonly kind: 'work-offer'
      /** The signature — the ONLY thing a URL may carry. Everything else here
       *  is read back off the server-side buffer at acceptance. */
      readonly thread: string
      readonly subject: string
      readonly title: string
      readonly rationale: string
      readonly outline: readonly string[]
      readonly produces: string
      /** What it says it will NOT do. Shown on the offer screen and nowhere
       *  else — see `src/ui/offer.tsx` for why it must never appear beside the
       *  contract's enforced permissions. */
      readonly excludes: readonly string[]
      /** The deterministic grounds, rendered VERBATIM and ABOVE the model's
       *  sentence. The person's own facts first, the model's reading second. */
      readonly grounds: readonly string[]
      /** Shown, each individually untickable. Code-derived from the pages the
       *  thread ran through — never model-authored, never link-supplied. */
      readonly origins: readonly string[]
      readonly sentence: string
      readonly because: string
    }
  | {
      readonly kind: 'hand-off'
      readonly sentence: string
      readonly because: string
      readonly detected: PauseDetected
    }

/** Said out loud, because a suggestion produced under shortened test thresholds
 *  must not read like one produced by real work. */
const UNDER_TEST = FAST_DETECT
  ? ' (fast-detect is on — thresholds are 20× shorter than normal.)'
  : ''

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The offer, in the words the pages themselves used.
 *
 * This says WHAT RECURRED, not what it means: "General Intuition, across 3
 * sites", never "you are researching frontier world-model labs". Naming the
 * subject in a sentence a person would recognise needs a model, and that is a
 * separate decision — see ADR-0008.
 *
 * ── One exception, added 2026-08-17: a name the person typed themselves ──
 *
 * `detected.authoredLabel` is the title of the tab group the thread's pages sit
 * in. It is not a reading and it is not a model's: `docs/research/intent-signals.md`
 * §4.3 argues that a group titled *"world models"* IS the sentence this file
 * otherwise approximates with a bag of stemmed words, *"typed by the person,
 * for free"*. So where one exists, it replaces `words` in the middle branch.
 *
 * **This is the only thing that consumes the field, and it consumes it into a
 * SENTENCE and nowhere else.** It cannot make an offer fire — `groundsFor`
 * never sees it, and `tests/detection.test.ts` pins that grounds and
 * sufficiency are byte-identical with and without a group title in the buffer.
 * All it can do is change what a person reads about their own afternoon.
 *
 * ── Why it does not outrank a confident model name, which is arguable ────
 *
 * The research points the other way and it is worth saying so rather than
 * pretending the ordering is obvious: §4.3's case is that an authored label has
 * *"no confidence flag, and no possibility of a confidently-wrong name"*, which
 * is an argument for putting it first. It is second anyway, for two reasons:
 *
 *   - The model's subject is composed from the thread's titles and searches —
 *     more evidence than one label, and evidence about all of the pages. A tab
 *     group title is a label somebody typed once, possibly before the work
 *     turned into what it is now.
 *   - People label groups "misc", "temp" and "Group 3". Nothing here can tell
 *     those from a subject, and letting one displace *"Looks like you're
 *     working on the Q3 partner review"* would be a downgrade at exactly the
 *     moment the product had its best sentence available.
 *
 * What it DOES displace is the term list, and against that it wins on every
 * reading: the term list is at best three stemmed words with no grammar. If the
 * ordering is ever revisited, the thing to measure is how often a group title
 * is a real subject rather than a filing word — which nothing measures today,
 * and which is why this is a judgement rather than a finding.
 */
export function describeWork(
  detected: WorkDetected,
  threadSignature: string,
  named?: NamedThread | null,
): Suggestion {
  // `labels`, not `terms`: the spelling a person saw, not the matching key.
  const words = detected.labels.slice(0, 3).join(' ')
  const sites = detected.origins.length
  const where = sites === 1 ? hostOf(detected.origins[0] ?? '') : `${sites} sites`

  // Trimmed at both doors already; guarded here anyway, because this is the one
  // line that puts it in front of a person and an empty label rendered as a
  // name would read as the product losing its place mid-sentence.
  const authored = detected.authoredLabel?.trim()

  const sentence =
    named && named.confident
      ? // Only when the model was sure. A confident wrong name is worse than an
        // honest vague one, and the vague one is still true.
        `Looks like you're working on ${named.subject}.`
      : authored
        ? // What they called it. Same frame as the term list below rather than
          // the confident one above: "You have been looking into X" is a
          // statement about what was observed, and a group title is observed
          // rather than concluded. Promoting it to "Looks like you're working
          // on X" would claim a reading nobody made.
          `You have been looking into ${authored}.`
        : words
          ? // No site count here, though it used to carry one. This sentence is
            // never shown alone: Home sets `because` directly beneath it and the
            // extension badge concatenates the two, so "— across 4 sites." landed
            // one line above "read 4 pages across 4 sites." and said the same
            // thing twice in a row. The naming half says what it is about; the
            // grounds half says what was seen. One job each.
            `You have been looking into ${words}.`
          : // Nothing to name, so this one keeps the count — without it the
            // sentence would say nothing at all.
            `You have been reading across ${where}.`

  return {
    kind: 'start-session',
    /**
     * The FIRST site of the thread in scan order — not the most-visited one.
     *
     * This comment used to claim it was "the site the thread ran through most",
     * which it has never been: `Thread.origins` is
     * `[...new Set(members.map(p => p.origin))]` in `topics.ts`, so the order is
     * the order pages were scanned, and nothing ranks them.
     *
     * Worth being exact about, because this value is not decorative — it is what
     * the decline path snoozes, and what the snooze check then reads. Somebody
     * pressing "Not now" silences whichever site happened to be seen first, and
     * a reader who believed the old comment would think they had silenced the
     * dominant one. Ranking these is a real improvement and a separate change;
     * the comment must not describe it before it exists.
     */
    origin: detected.origins[0] ?? '',
    origins: detected.origins,
    terms: detected.terms,
    thread: threadSignature,
    ...(named ? { subject: named.subject } : {}),
    sentence,
    because:
      detected.because === 'searched-and-followed'
        ? `You searched for it, then read ${detected.pages} pages across ${where}.${UNDER_TEST}`
        : `${detected.pages} pages across ${where}, ${minutes(detected.engagedMs)} of reading.${UNDER_TEST}`,
    detected,
  }
}

/**
 * The offer, as the person will read it.
 *
 * The ordering of the fields here is the argument the screen makes. `grounds`
 * comes off the deterministic detector and is rendered above everything the
 * model wrote; `title` and `rationale` are the model's reading of those facts;
 * `excludes` is the half people read hardest and is the reason the model is
 * allowed to write prose at all.
 *
 * `origins` is code-derived from the pages the thread ran through. It is in the
 * suggestion so the screen can list what it is about to approve — NOT so a
 * caller can send it back. The accept path re-derives the same set from the
 * buffer and never takes one from its caller; see `observedOriginPatterns`.
 */
export function describeOffer(
  detected: WorkDetected,
  threadSignature: string,
  subject: string,
  offer: WorkOffer,
): Suggestion {
  const sites = detected.origins.length
  const where = sites === 1 ? hostOf(detected.origins[0] ?? '') : `${sites} sites`

  return {
    kind: 'work-offer',
    thread: threadSignature,
    subject,
    title: offer.title,
    rationale: offer.rationale,
    outline: offer.outline,
    produces: offer.produces,
    excludes: offer.excludes,
    grounds: offer.grounds.sentences,
    origins: detected.origins,
    sentence: `Looks like you're working on ${subject}.`,
    because: `${detected.pages} pages across ${where}, ${minutes(detected.engagedMs)} of reading.${UNDER_TEST}`,
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
