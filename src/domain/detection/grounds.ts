/**
 * Why Propositum is willing to offer to DO something, not merely to name it.
 *
 * ── Two bars, and this is the higher one ─────────────────────────────────
 *
 * `detectWork` decides whether Propositum may SAY something: a thread, plus
 * either eight minutes of reading or one search. ADR-0008 pins that bar and
 * this file does not touch it. It is deliberately low, because the cost of a
 * wrong subject line is a sentence nobody agrees with, and a person who
 * disagrees scrolls past it.
 *
 * Offering to do WORK is a different ask. It spends a person's attention on
 * reading and ratifying an offer, and then — if they accept — their sources,
 * their Chrome and their time on running it. So there is a second bar above the
 * first, it is arithmetic, and it lives here.
 *
 * ── Why one-intent-and-two-investment, and not ~~three-of-six~~ k-of-n ────
 *
 * Because the two groups measure different things and a single counter cannot
 * say *one of these AND two of those*. Both halves are necessary, and each
 * excludes a failure the other admits.
 *
 * **Intent separates pursuing from receiving.** Somebody who searched and then
 * read chose the subject. Somebody who read four pages of a site they arrived
 * at from a newsletter chose nothing — the subject was handed to them. Nobody
 * refines a search, or navigates back to a page they left, for something they
 * were idly served. Without an intent ground, absorption alone qualifies: a
 * long feature article, a forum argument, a recipe. That is exactly the false
 * positive ADR-0008 names as the expensive failure, because it interrupts
 * someone reading the news and teaches them the feature is noise.
 *
 * **Investment separates "worth an offer" from "a lucky click".** One strong
 * ground is cheap to produce by accident. ~~Depth on one page, span across the
 * thread, and breadth across sites are three different accidents, and needing
 * two of them is not much to ask of real work.~~ ~~**Four accidents as of
 * 2026-08-17** — depth on one PAGE, span across the thread, breadth across
 * SITES, and depth on one SITE — and needing two of them is still not much to
 * ask of real work.~~ **Four grounds, three accidents, corrected later the same
 * day.** Breadth across SITES and depth on one SITE are one accident measured at
 * its two ends, not two, and the version that shipped first counted them
 * separately — so an afternoon of clicking satisfied both halves of a rule whose
 * entire basis is that its two halves are independent. `BREADTH_AXIS` is where
 * that is fixed and where the sessions it admitted are written down. The fourth
 * ground is `read-around` and it has its own section below, because it is the
 * one addition here that made the bar cheaper.
 *
 * ~~Three-of-six~~ **Three-of-seven** would admit both failures directly. It
 * passes `read-deeply` + `stayed-with-it` + `followed-across` with no intent at
 * all — the newsletter afternoon. And it passes all three intent grounds with
 * no investment — somebody who searched, refined and came back inside a minute
 * having read nothing, which is what a search going badly looks like, and the
 * worst possible moment to interrupt. Both are ordinary browsing.
 *
 * The arithmetic moved on 2026-08-17 and the argument came through it stronger
 * rather than weaker. A flat counter now has FOUR all-investment triples to the
 * old one, because there are four investment grounds to choose three from, so
 * there are four different newsletter afternoons it would offer work to. The
 * two-group rule refuses all four for the reason it refused the first: they
 * contain no act of navigation anybody chose.
 *
 * And a flat counter cannot express the other thing this rule learned that day.
 * `BREADTH_AXIS` folds two of the seven grounds into one number because they
 * measure one axis from both ends; a counter over kinds has nowhere to say that,
 * and would count the same afternoon of clicking twice however high it was set.
 *
 * ── What two real sessions changed, and what they did not ────────────────
 *
 * This bar refused two sessions of genuine research on 2026-08-16, and ONE
 * duration below moved because of it. What did NOT move is the shape of the
 * rule, and keeping those two apart is the point of recording this here.
 * `SUSTAINED_MS` moved too, in the same diff, and came back the same day — it
 * had no session behind it and it admitted the false positive this file spends
 * its length refusing. Its own comment records that in full.
 *
 *   - **Run 1** — one search ("robot navigation through crowds"), three arXiv
 *     abstracts across two origins, 17.5 seconds engaged in total. No ground
 *     fired, and that is the right answer. Seventeen seconds is a glance at
 *     three abstracts; nothing below argues it should have been offered
 *     anything, and nothing below would now let it through. *(That last clause
 *     was false for part of 2026-08-17. `read-around` shipped without an
 *     engagement floor, and three abstracts at six seconds each fired it and
 *     produced the sentence "You read 3 pages on arxiv.org." `READ_AROUND_MS`
 *     is the floor, and the clause is true again.)*
 *   - **Run 2** — four queries on one subject ("what is perturbation in
 *     robotics" and three variants), an arXiv paper, a Science Robotics article
 *     and a GitHub project across four origins over about eleven minutes, with
 *     sixty seconds on the deepest page. It fired `searched-then-read`,
 *     `refined-the-search`, `came-back` and `followed-across` — three intent
 *     grounds and ONE investment ground — so `sufficient` stayed false and
 *     nothing was offered.
 *
 * Run 2 is the diagnostic one. Intent was overwhelming, investment was the
 * blocker, and the single thing standing in the way was `DEEP_READ_MS` at
 * ninety seconds against a sixty-second read. A DURATION was miscalibrated. The
 * rule requiring two investment grounds was not.
 *
 * **So `INTENT_REQUIRED` and `INVESTMENT_REQUIRED` stay where they are, and
 * this is the paragraph to read before lowering them.** Dropping
 * `INVESTMENT_REQUIRED` to 1 would also have unblocked run 2, so the evidence
 * cannot tell the two fixes apart — but it would additionally admit the
 * newsletter afternoon the moment any single intent ground fired, and
 * `came-back` fires on one return to one site. That false positive is the exact
 * thing the two-of-three requirement exists to exclude, and nothing in these
 * two sessions is an argument for accepting it. Lowering the counts is the
 * change a future reader will be most tempted to make next; the evidence does
 * not support it.
 *
 * Two sessions are not a calibration set. They are two observations that
 * disagreed with a guess. The numbers below are still guesses — better-argued
 * ones now, with a reason and a date attached.
 *
 * ── The fourth investment ground, and what it costs, 2026-08-17 ──────────
 *
 * Breadth across sites was rewarded and depth on one site counted for nothing.
 * Somebody who read six arXiv abstracts on one subject earned no investment
 * ground at all unless one of those pages happened to hold them past
 * `DEEP_READ_MS`; somebody who glanced at three sites earned `followed-across`
 * outright. That asymmetry was never a judgement anybody made — it is an
 * accident of which facts were easy to count. The product owner's words:
 *
 * > "In the event something is done on the same site for multiple subpages, you
 * > shouldn't need a third site. That doesn't really make sense logistically."
 *
 * So `read-around` is the fourth investment ground, and `PAGES_ON_ONE_ORIGIN`
 * is its threshold. Two cheaper-looking fixes were considered first and both
 * are refused where the constants are, rather than here: `ORIGINS_FOR_OFFER`
 * 3->2 would report the thread's own entry condition back as evidence for the
 * thread, and `ORIGINS_FOR_THREAD` 2->1 is the structural reason a video call, a
 * shopping session and a rent portal produce nothing at all, which `topics.ts`
 * argues only a blocklist could replace and then refuses one.
 *
 * **The cost, accepted knowingly rather than discovered afterwards — and stated
 * WRONG the first time, corrected 2026-08-17.** ~~This admits a shape that could
 * not qualify before: one search leading into heavy browsing on ONE site.~~ Two
 * things about that sentence were narrower than the code:
 *
 *   - **A search is not required.** Any intent ground will do, and `came-back`
 *     is one — a tab reopened, a link followed home. So the admitted shape is
 *     *any act of navigation somebody chose*, then depth on one site. There is a
 *     no-search version of every session named below.
 *   - **"Heavy" is three pages.** Not eighteen. Three pages held for
 *     `READ_AROUND_MS` and one page held past `DEEP_READ_MS` is the whole price,
 *     and it is payable in about four minutes. The eighteen-page shopping buffer
 *     is a real recording, not the minimum, and quoting the recording as if it
 *     were the bar made the door sound five times narrower than it is.
 *
 * With that said properly: this admits google -> arXiv -> three abstracts with
 * one of them read, which is real research and is the whole point. It equally
 * admits google -> Amazon -> three product pages with one looked at, and
 * google -> a bank portal -> three statement pages with one read. Nothing in
 * this file can tell those apart, because telling them apart is what a model
 * would be for and no model runs here.
 *
 * **Why it is bounded, and both bounds are weaker than they read.** A thread
 * still needs `ORIGINS_FOR_THREAD` origins to exist, so eighteen Amazon pages on
 * their own form no thread, `groundsFor` is never called on them, and nothing is
 * offered. That bound is real. It is also cheap to clear: **one search supplies
 * the second origin**, so the video call, the shopping session and the rent
 * portal this ground's neighbours name as structurally excluded are excluded
 * only while nobody googles their way into them, which is not how anybody
 * reaches a rent portal. What this ground admits is depth on one site after a
 * person has been somewhere else about the same subject — that sentence is true
 * as written, and "somewhere else" is a lower bar than it sounds.
 *
 * **And it buys only one of the two grounds required.** A search plus subpages
 * of one site still needs a real read, a quarter of an hour, or a third site
 * beside it before anything is offered. ~~a third site~~ — **not that, as of the
 * fix below**: `BREADTH_AXIS` folds a third site and depth on one site into one
 * number, so the second ground has to be a real read or a quarter of an hour,
 * and breadth cannot buy it. `INVESTMENT_REQUIRED` is doing exactly the work it
 * was already doing; it is doing it over a group that is one member larger,
 * which is a cheaper bar, and `INVESTMENT_GROUNDS` says so in as many words
 * rather than leaving it to be noticed.
 *
 * ── No model runs here, ever ─────────────────────────────────────────────
 *
 * Same discipline as `ObservationKind`: `GroundKind` is closed and code-owned.
 * Adding a member is a change to this file, never configuration and never model
 * output. A model composes the offer AFTER this says there is enough to offer
 * — it never gets a say in whether there is.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *
 * `CONTEXT.md` sketches this as `{ intent: GroundKind[], investment:
 * GroundKind[] }`. It ships as one ordered `kinds` list plus the two `as const`
 * groups a caller can partition by, because the consumer copy is a single block
 * in a fixed order and two arrays would have to be re-merged to render it. The
 * grouping is still part of the type rather than a comment — it is what
 * `INTENT_GROUNDS` and `INVESTMENT_GROUNDS` are.
 */

import { FAST_DETECT } from './detect'
import type { WorkDetected } from './detect'
import { searchQueryOf } from './topics'
import type { ThreadPage } from './topics'

/**
 * Thresholds, on exactly the terms `detect.ts` sets out for its own.
 *
 * Divided by the same `SPEED`, from the same environment variable, read once at
 * module load. Durations shorten under fast-detect; COUNTS do not, because
 * dropping a count would stop testing the rule the count exists to state — that
 * one page is reading, one search is a whim, and one site is not following
 * anything across.
 *
 * ~~These numbers are guesses, set before any real browsing existed, and
 * nothing has yet told us which of them is wrong.~~
 *
 * **Amended 2026-08-16: two real sessions told us, and both durations moved.**
 * The header records what they were. They are still guesses; they are no longer
 * unexamined ones. They live together in one block so that tuning them is a
 * diff rather than an excavation, and that is what just happened.
 */
const SPEED = FAST_DETECT ? 20 : 1

/**
 * One page held their attention this long. A minute on one page is a read, not
 * a page skimmed for the one line it was opened for.
 *
 * ~~Ninety seconds.~~ **Sixty, as of 2026-08-16.** This constant, on its own,
 * refused run 2: sixty seconds on an arXiv paper was the deepest read in eleven
 * minutes of real research, and ninety was the only thing between that session
 * and an offer. Ninety was a guess about what a read costs. `engagedMs` is
 * engaged time — dwell plus evidence a person was present, never tab-open time
 * — so a minute of it is a minute of somebody actually there, which is already
 * past anything a skim produces.
 */
export const DEEP_READ_MS = (60 * 1000) / SPEED

/**
 * The thread's own span, first page to last. Fifteen minutes of returning to
 * the same subject is a different fact from fifteen minutes of one tab open.
 *
 * ~~Fifteen minutes.~~ ~~**Eight, as of 2026-08-16.** Fifteen was half of
 * `WINDOW_MS`: the buffer holds thirty minutes and drops everything older, so
 * the rule demanded that a thread span half the entire life of the buffer it is
 * measured inside before it counted as sustained. That is not a bar on a
 * person's browsing, it is an artefact of the window — and it went unnoticed
 * because the two constants live in different files and neither comment
 * mentioned the other. Eight is under a third of the window, which leaves a
 * thread room to be sustained and still be seen whole.~~
 *
 * **Put back to fifteen the same day, 2026-08-16, and this is the one to read
 * before lowering it again.** Two things were wrong with the change, and the
 * artefact argument was not one of them — it is a real observation and it is
 * kept below.
 *
 * **It bought nothing.** Run 2 was the whole evidential case, and `DEEP_READ_MS`
 * ninety-to-sixty released run 2 on its own: four origins fired
 * `followed-across`, sixty seconds fired `read-deeply`, and that is the two
 * investment grounds. Run 2 spanned about eleven minutes, so it never reached
 * even eight, and this constant played no part in refusing it or in letting it
 * through. A number moved with no session behind it.
 *
 * **It admitted the false positive the same diff was refusing.** Fired as a
 * fixture: no search at all, nothing held for a minute, twelve links across
 * three sites at forty-five seconds each, one page returned to. At eight
 * minutes that afternoon fires `came-back`, `stayed-with-it` and
 * `followed-across` — one intent ground and two investment grounds — and is
 * offered work. At fifteen it fires ~~two of the three~~ **`came-back` and
 * `followed-across`, plus `read-around` since 2026-08-17 — four pages of one of
 * those three sites, which twelve links across three sites cannot avoid** — and
 * is refused, which is the answer `INVESTMENT_REQUIRED` argues for at length and
 * had stopped getting. Span is the cheapest of the four investment grounds to
 * produce by accident, because it costs a person nothing but time passing;
 * lowering it is therefore the closest thing available to lowering
 * `INVESTMENT_REQUIRED` itself, which the file next door refuses in as many
 * words.
 *
 * **That refusal stopped being true for part of 2026-08-17 and is true again.**
 * `read-around` shipped counting as a ground of its own beside `followed-across`,
 * and this afternoon then fired one intent ground and TWO investment grounds at
 * fifteen minutes and was offered work — `read-around` doing for it precisely
 * what lowering `SUSTAINED_MS` did, which is what the paragraph above calls the
 * closest thing available to lowering `INVESTMENT_REQUIRED`. It went unnoticed
 * because the pinned fixture had been written at three pages, one per site,
 * while its own docstring recorded the session as twelve across three — and
 * twelve pages over three sites put four on some site by pigeonhole. The fixture
 * is at twelve now. `BREADTH_AXIS` is the fix; this paragraph is here because
 * "the fixture was smaller than the session it recorded" is the failure mode,
 * not the ground.
 *
 * **What survives, and is still owed.** Fifteen minutes IS half of `WINDOW_MS`,
 * and a rule that asks a thread to span half the life of the buffer it is
 * measured inside is measuring the window as much as the person. That remains
 * true and remains unfixed. The fix is not a smaller number underneath the same
 * window — it is either a longer window or a ground that does not depend on
 * one, and both are changes with an ADR-shaped argument rather than a constant.
 * `SUSTAINED_MS * 2 === WINDOW_MS` is pinned in `grounds.test.ts` so this stays
 * a known relationship rather than a rediscovered one.
 */
export const SUSTAINED_MS = (15 * 60_000) / SPEED

/**
 * Distinct origins before following a subject counts as following it ACROSS.
 * Two is the bar a thread already had to clear to exist — see
 * `ORIGINS_FOR_THREAD` — so two here would be no additional evidence at all.
 *
 * **Unchanged on 2026-08-16, deliberately.** Run 2 ran across four origins and
 * `followed-across` was the one investment ground that did fire, so nothing in
 * that session touches this number. The argument above is not about
 * calibration; it is about double-counting, and lowering it to two would report
 * the thread's own entry condition back as evidence for the thread.
 */
export const ORIGINS_FOR_OFFER = 3

/**
 * Distinct pages on ONE origin, each of them engaged with, before depth on a
 * single site counts as investment. The other end of the axis above.
 *
 * **A COUNT, so it is not divided by `SPEED`.** The block at the top of these
 * constants says why: dropping a count would stop testing the rule the count
 * exists to state. Three pages must stay three pages under fast-detect, or this
 * ground becomes "two pages on a site", which is arriving and clicking once.
 *
 * **Why three.** Two is a landing page and the thing you came for, which every
 * link in every newsletter produces. Three is the smallest number that is a
 * pattern rather than a click. It is the same number as `PAGES_FOR_THREAD`, and
 * deliberately not imported from it — that one counts a thread's pages
 * anywhere, this one counts them on one host, and two judgements that happen to
 * agree are not one judgement wearing two names. If either moves, the other has
 * no reason to follow.
 *
 * ~~**Engaged, and that half is load-bearing.** `pursuitOf` already excludes
 * unengaged pages, because "a burst of tabs opened from a result page and
 * closed unread is the exact accident this group exists to keep out of an offer
 * — and because a sentence saying somebody READ four pages had better be true".
 * Same reasoning and the same file. The sentence this ground produces makes
 * precisely that claim, about precisely that many pages, and names the site it
 * makes the claim about.~~
 *
 * **The quotation was borrowed and the filter it describes did not exist here,
 * 2026-08-17.** `pursuitOf` tests `engagedMs > 0`, and on the ambient path that
 * means "was visible for a nonzero number of milliseconds", not "was read".
 * Nothing upstream applies a dwell floor: `ENGAGEMENT_DWELL_MS` gates the LEDGER
 * path, the ambient route accepts `engagedMs: z.number().int().nonnegative()`
 * unfiltered, and `extension/src/content.js` says so in its own words — *"that
 * lands in the ambient path, which has no engagement threshold of its own"*. So
 * a burst of four tabs closed after three seconds each produced the sentence
 * *"You read 3 pages on arxiv.org"*, which is the exact claim the paragraph
 * above says had better be true. Recorded run 1 — three abstracts, seventeen and
 * a half seconds between them — fired it too, and the header says of that
 * session that nothing here would let it through.
 *
 * That mattered less for `pursuitOf`, which gates an intent ground that already
 * required a search in front of it. It matters here, in the group whose whole
 * purpose is evidence that enough was SPENT. So the floor is real and named:
 * `READ_AROUND_MS`.
 *
 * **Searches do not count toward it.** Three result pages on google.com are not
 * reading around a site; they are the refinement `refined-the-search` already
 * notices, and counting them here would turn one act of intent into an
 * investment ground wearing a different name. That is the double-counting
 * `ORIGINS_FOR_OFFER` refuses in the block above, and it would also produce the
 * sentence *"You read 3 pages on www.google.com"*, which is not what happened.
 */
export const PAGES_ON_ONE_ORIGIN = 3

/**
 * How long one of those pages must have held somebody before it counts as one
 * of them. A DURATION, so it is divided by `SPEED`.
 *
 * **Added 2026-08-17, because the ground shipped without one and its own comment
 * claimed otherwise.** The block above records what the missing floor admitted.
 *
 * **Twenty seconds, and the number is `ENGAGEMENT_DWELL_MS`'s number.** That
 * constant is the product's existing sentence about where a glance stops and
 * engagement starts, and disagreeing with it here would be this file inventing a
 * second definition of the same word. It is deliberately NOT imported, for the
 * reason `PAGES_ON_ONE_ORIGIN` is not imported from `PAGES_FOR_THREAD`: that one
 * decides what the CAPTURE layer writes down about a page, this one decides what
 * an OFFER may claim about it, and two judgements that happen to agree are not
 * one judgement wearing two names. It also lives in `src/capture`, and the
 * domain reaching across that seam for a number is how a layer boundary becomes
 * incidental rather than structural.
 *
 * **What it does not fix, said before somebody finds it.** Twenty seconds is a
 * floor on a glance, not a bar on skimming. Twelve newsletter links at
 * forty-five seconds each clear it comfortably, and the thing that refuses that
 * afternoon is `BREADTH_AXIS` below, not this.
 */
export const READ_AROUND_MS = 20_000 / SPEED

/** Distinct queries on the subject before it counts as refining rather than
 *  asking. The second query is the evidence: it says the first answer was read
 *  and found wanting. */
export const QUERIES_FOR_REFINEMENT = 2

/** Pages of the thread read AFTER a query, before the query counts as followed.
 *  This is the rule `PAGES_AFTER_QUERY` named in `detect.ts` and nothing
 *  enforced; it applies here, at the bar where offering to act is decided,
 *  rather than at the naming bar ADR-0008 pins. */
export const PAGES_AFTER_QUERY_FOR_OFFER = 2

/**
 * Evidence they were PURSUING this, rather than receiving it.
 *
 * Every member is an act of navigation a person had to choose. None of them can
 * be produced by sitting still, which is the property that makes the group
 * worth requiring.
 */
export const INTENT_GROUNDS = ['searched-then-read', 'refined-the-search', 'came-back'] as const

/**
 * Evidence enough was spent that carrying on is worth offering.
 *
 * ~~Depth, span and breadth. Three different accidents, so two of them together
 * are unlikely to be one.~~
 *
 * **Four as of 2026-08-17, and that sentence needed rewriting rather than a
 * numeral swapped in.** Depth on one PAGE, span across the thread, breadth
 * across SITES, and depth on one SITE. The new member is not a fourth accident
 * of the same kind as the first three — it is the far end of the axis
 * `followed-across` measures, so the two of them now state "they went to
 * several places" and "they went several pages deep in one place" as separate
 * facts, where before only the first was sayable and the second was silently
 * worth nothing.
 *
 * **Two of four is a cheaper bar than two of three, and pretending otherwise
 * would be arithmetic denial.** ~~Three qualifying pairs became six.~~ **Five,
 * corrected 2026-08-17**, because the sixth pair was the two ends of the one
 * axis and `BREADTH_AXIS` below now counts it once. What keeps the rest
 * affordable is not this list: it is that `read-around` is expensive on its own
 * — three separate pages on one host, every one of them held for
 * `READ_AROUND_MS`, none of them a search — and that clearing it still buys only
 * ONE of the two grounds required. What it admits that could not qualify before
 * is written out in the header, with the real shopping buffer named rather than
 * left to be found.
 */
export const INVESTMENT_GROUNDS = [
  'read-deeply',
  'stayed-with-it',
  'followed-across',
  'read-around',
] as const

/**
 * The two ends of ONE axis, and they count once between them.
 *
 * **Added 2026-08-17, the same day `read-around` was, and it should have been
 * the same commit.** The paragraph above calls `followed-across` and
 * `read-around` "the far end of the axis `followed-across` measures" and then
 * let the sufficiency rule count both. That is not two accidents, it is one fact
 * asked twice, and past a certain size it is not even a fact that CAN fail
 * twice: a thread of seven pages across three origins puts three of them on some
 * origin by pigeonhole, so `followed-across` firing GUARANTEES `read-around`.
 *
 * Measured, not reasoned. Before this, one search plus four tabs closed after
 * three seconds each — twelve seconds of attention across a hundred-second span
 * — fired `searched-then-read`, `followed-across` and `read-around` and was
 * offered work, with no duration evidence of any kind behind it: no page held,
 * no span. So did the twelve-link newsletter afternoon `SUSTAINED_MS` was put
 * back to fifteen minutes to refuse. `grounds.test.ts` carries both.
 *
 * **This is also exactly the product owner's ask, stated tightly rather than
 * generously.** The ask was *"in the event something is done on the same site
 * for multiple subpages, you shouldn't need a third site"* — depth on one site
 * standing IN PLACE OF breadth. Somebody who has the third site already has
 * `followed-across` and was never the person being argued about.
 *
 * **The ground still fires and the sentence is still said.** Only the ARITHMETIC
 * folds. It is true that they read four pages of one of those sites, a person
 * reading the block is owed it, and suppressing a true sentence to make a
 * counter come out right would be the wrong half to give up.
 */
export const BREADTH_AXIS = ['followed-across', 'read-around'] as const

/**
 * Closed, code-owned, never model output — the same discipline as
 * `ObservationKind`. There is no `other`.
 */
export type GroundKind = (typeof INTENT_GROUNDS)[number] | (typeof INVESTMENT_GROUNDS)[number]

export interface OfferGrounds {
  readonly kinds: readonly GroundKind[]
  readonly sufficient: boolean
  /** One consumer sentence per fired ground, in the order shown. */
  readonly sentences: readonly string[]
}

/**
 * How many intent grounds must fire.
 *
 * **Unchanged on 2026-08-16.** One is already the floor — zero is the
 * newsletter afternoon, which is the failure this half exists to name.
 */
export const INTENT_REQUIRED = 1

/**
 * How many investment grounds must fire.
 *
 * **Unchanged on 2026-08-16, and this is the deliberate one.** Run 2 was
 * refused with three intent grounds and one investment ground, and lowering
 * this to 1 would have released it. So would fixing `DEEP_READ_MS`, which is
 * what was actually wrong — the session had a real sixty-second read that a
 * ninety-second threshold called a skim. Two changes, one unblocked session,
 * and no way to choose between them from the session alone.
 *
 * They are chosen on what else each admits. `INVESTMENT_REQUIRED = 1` lets an
 * afternoon of newsletter reading through on `came-back` plus `followed-across`
 * — one return to one site, and three sites, both of which ordinary browsing
 * produces without anybody pursuing anything. The threshold fix admits only
 * reads between sixty and ninety seconds. The narrower fix was the right one,
 * and this constant records that the wider one was considered and refused
 * rather than never thought of.
 *
 * ── What two still admits, said plainly ──────────────────────────────────
 *
 * The count is not a wall, it is a price, and the price is payable by time. A
 * newsletter afternoon that runs past `SUSTAINED_MS` on three sites with one
 * return fires `came-back`, `stayed-with-it` and `followed-across`, and this
 * bar offers it work. Nothing above prevents that; `SUSTAINED_MS` only sets how
 * long the afternoon has to be, which is why lowering that constant was the
 * same change as lowering this one wearing a different name, and why it was put
 * back. Somebody who reads across three sites for a quarter of an hour and
 * clicks back to one of them will be asked whether they want help with it.
 *
 * That is the residual false positive of this design, it has not been measured
 * in real use, and the honest reason it is tolerated is that the next thing to
 * do about it is not a bigger count — three of three would refuse most real
 * research — but a ground that separates "still here" from "came back to it",
 * which does not exist yet.
 *
 * **A second one, since 2026-08-17, and it is faster than the first.**
 * `read-around` opened a shape that costs four minutes rather than a quarter of
 * an hour: any one intent ground, three pages of one site each held past
 * `READ_AROUND_MS`, and one of them held past `DEEP_READ_MS`. That is google ->
 * three arXiv abstracts with one read, which is the point; it is also google ->
 * three product pages with one read, and a return to a rent portal with three of
 * its pages read, and this file cannot tell any of them apart. `BREADTH_AXIS`
 * does not touch this one — there is no double count in it, just a cheap pair —
 * and neither does `READ_AROUND_MS`, because a person really did spend twenty
 * seconds on each of those pages. It is a real cost of a change the product
 * owner asked for, in the direction ADR-0009's revisit list already names, and
 * it is pinned in `grounds.test.ts` rather than left to be met in use.
 */
export const INVESTMENT_REQUIRED = 2

/**
 * Said out loud, exactly as `describeWork` says it.
 *
 * An offer produced under 20× thresholds must not read like one produced by
 * real work. Twenty-four seconds of browsing clears `SUSTAINED_MS` under
 * fast-detect and fires `stayed-with-it` — a ground that means eight real
 * minutes of staying with a subject — and three seconds on a page fires
 * `read-deeply`, which means a minute. The sentences quote the true durations,
 * so the numbers in them are not the lie; the grounds having fired at all is.
 * Anyone shown that without the note is being told something false about their
 * own afternoon.
 *
 * It rides on the LAST sentence rather than arriving as an extra one, so the
 * "one sentence per fired ground" contract survives and a caller rendering the
 * list as rows does not grow a row that names no ground.
 */
const UNDER_TEST = FAST_DETECT
  ? ' (fast-detect is on — thresholds are 20× shorter than normal.)'
  : ''

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The queries in this thread that were actually about this thread.
 *
 * A search is only ever recognised by `searchQueryOf`, never by `ThreadPage.
 * searched` — that field needs the extension to have labelled the navigation a
 * query, and the extension labels any URL with a `?` a query. This half of the
 * sufficiency rule must not be satisfiable by a question mark, so the domain
 * decides for itself and the extension's opinion is not consulted.
 *
 * The search must also be ABOUT the thread. Somebody who looked up a lunch
 * place in the middle of an afternoon of research did not refine anything; that
 * page joined the thread on some incidental word.
 *
 * That test is `page.terms` against the thread's terms, and not a fresh
 * tokenisation of the query.
 *
 * ~~The reason was that `termsOf` strips trailing site branding from whatever
 * string it is given, and a bare query is not a title: `termsOf('gpt-4 vs
 * claude', '')` returned `{gpt}` — the hyphen read as a branding separator —
 * and `termsOf('e-processes sequential testing', '')` returned nothing at all.
 * Every hyphenated search failed this test silently.~~
 *
 * **Amended 2026-08-16: that bug is fixed at its source.** `BRANDING` now
 * requires whitespace before the separator, so a hyphen inside a word is part
 * of the word; those two calls return `{gpt, claude}` and `{process,
 * sequential, testing}`. This comment described a workaround for a defect
 * nobody had gone and fixed, which is how a routing-around outlives the thing
 * it routed around.
 *
 * The conclusion survives its own justification, on a narrower argument:
 * `page.terms` is built from the URL as well as the title, so a query that
 * reaches the page through the path branch is matched on words the title may
 * never have carried. Re-tokenising the query alone would see less.
 */
function pursuitOf(
  detected: WorkDetected,
  pages: readonly ThreadPage[],
): { readonly queries: readonly string[]; readonly readAfterQuery: number } {
  const subject = new Set(detected.terms)
  const queries: string[] = []
  let firstAt: number | null = null

  for (const page of pages) {
    const query = searchQueryOf(page.url)
    if (query === null) continue

    let onSubject = false
    for (const word of page.terms) {
      if (subject.has(word)) onSubject = true
    }
    if (!onSubject) continue

    if (!queries.includes(query)) queries.push(query)
    firstAt = firstAt === null ? page.at : Math.min(firstAt, page.at)
  }

  /**
   * Pages of the thread READ after that first query.
   *
   * Three things are excluded and each is deliberate. The searches themselves,
   * because a second query is a refinement and the ground below already
   * notices it. Pages first seen before the query, because nothing that
   * happened earlier was returned by it. And pages with no engagement at all,
   * because a burst of tabs opened from a result page and closed unread is the
   * exact accident this group exists to keep out of an offer — and because a
   * sentence saying somebody READ four pages had better be true.
   */
  const after = firstAt
  const readAfterQuery =
    after === null
      ? 0
      : pages.filter(
          (page) =>
            searchQueryOf(page.url) === null && page.at > after && page.engagedMs > 0,
        ).length

  return { queries, readAfterQuery }
}

/** The page they came back to, if any — the most-returned-to one, so the
 *  sentence names the page that best supports it. */
function returnedTo(pages: readonly ThreadPage[]): ThreadPage | null {
  const returns = [...pages].filter((page) => page.visits >= 2).sort((a, b) => b.visits - a.visits)
  return returns[0] ?? null
}

/**
 * The origin they read around most, and how many pages of it. Null if nothing
 * on any one site was read at all.
 *
 * Distinct URLs rather than rows. `pagesOf` already collapses a buffer to one
 * page per URL, but `groundsFor` is exported and counts whatever it is handed,
 * and a sentence claiming somebody read three pages must not be satisfiable by
 * one page reported three times.
 *
 * Both exclusions are argued at `PAGES_ON_ONE_ORIGIN`: pages that did not hold
 * somebody for `READ_AROUND_MS`, and searches because counting them would make
 * an intent act pay twice.
 *
 * ~~`page.engagedMs <= 0`.~~ **A real floor as of 2026-08-17.** Nonzero was
 * borrowed from `pursuitOf` and, on a path with no upstream dwell threshold, it
 * meant "was visible", not "was read" — three seconds a tab cleared it.
 */
function readAround(pages: readonly ThreadPage[]): { origin: string; pages: number } | null {
  const byOrigin = new Map<string, Set<string>>()

  for (const page of pages) {
    if (page.engagedMs < READ_AROUND_MS) continue
    if (searchQueryOf(page.url) !== null) continue
    const urls = byOrigin.get(page.origin) ?? new Set<string>()
    urls.add(page.url)
    byOrigin.set(page.origin, urls)
  }

  let best: string | null = null
  let bestPages = 0
  // Sorted, then strictly greater, so a tie between two sites resolves to the
  // same host every time the same buffer is asked. The sentence NAMES a site,
  // and one that named a different site on the next poll of an unchanged buffer
  // would read as a system making things up — the same reason `commonest` in
  // `topics.ts` breaks its ties lexicographically.
  for (const origin of [...byOrigin.keys()].sort()) {
    const count = byOrigin.get(origin)?.size ?? 0
    if (count > bestPages) {
      best = origin
      bestPages = count
    }
  }

  return best === null ? null : { origin: best, pages: bestPages }
}

/** Longest single page read in the thread. */
function deepestRead(pages: readonly ThreadPage[]): number {
  let deepest = 0
  for (const page of pages) deepest = Math.max(deepest, page.engagedMs)
  return deepest
}

/**
 * First page to last.
 *
 * Deliberately conservative: `at` is when a page was FIRST seen, so the time
 * spent on the last page of the thread is not counted. A span measured from the
 * last page's dwell would be a guess about when they stopped, and this rule is
 * about how long they have been at it, which the first sightings already say.
 */
function spanOf(pages: readonly ThreadPage[]): number {
  if (pages.length === 0) return 0
  const times = pages.map((page) => page.at)
  return Math.max(...times) - Math.min(...times)
}

/**
 * Is there enough here to offer to do something about it?
 *
 * Pure arithmetic over what was already detected. No clock — every time this
 * needs is already on a page — so the same buffer produces the same grounds
 * whenever it is asked, which is what makes an offer explainable afterwards.
 */
export function groundsFor(detected: WorkDetected, pages: readonly ThreadPage[]): OfferGrounds {
  const { queries, readAfterQuery } = pursuitOf(detected, pages)
  const back = returnedTo(pages)
  const deepest = deepestRead(pages)
  const span = spanOf(pages)
  const origins = new Set(pages.map((page) => page.origin)).size
  const around = readAround(pages)

  const kinds: GroundKind[] = []
  const sentences: string[] = []

  const fired = (kind: GroundKind, sentence: string) => {
    kinds.push(kind)
    sentences.push(sentence)
  }

  // Intent first, then investment. The order is the order of the two `as const`
  // groups, so the block a person reads opens with why Propositum thinks they
  // chose this — which is the part they are most likely to disagree with.
  if (queries.length > 0 && readAfterQuery >= PAGES_AFTER_QUERY_FOR_OFFER) {
    fired('searched-then-read', `You searched, then read ${readAfterQuery} more pages.`)
  }

  if (queries.length >= QUERIES_FOR_REFINEMENT) {
    fired('refined-the-search', `You searched ${queries.length} different ways.`)
  }

  if (back !== null) {
    fired('came-back', `You went back to ${hostOf(back.origin)} after leaving it.`)
  }

  if (deepest >= DEEP_READ_MS) {
    fired('read-deeply', `You spent ${minutes(deepest)} on a single page.`)
  }

  if (span >= SUSTAINED_MS) {
    fired('stayed-with-it', `You have been at this for ${minutes(span)}.`)
  }

  if (origins >= ORIGINS_FOR_OFFER) {
    fired('followed-across', `You followed it across ${origins} sites.`)
  }

  // Last, and after `followed-across` deliberately: the two are the ends of one
  // axis, and a person reading the block should meet breadth before depth on a
  // single site, which is the narrower claim of the pair.
  if (around !== null && around.pages >= PAGES_ON_ONE_ORIGIN) {
    fired('read-around', `You read ${around.pages} pages on ${hostOf(around.origin)}.`)
  }

  const intent = kinds.filter((kind) => (INTENT_GROUNDS as readonly GroundKind[]).includes(kind))
  const investment = kinds.filter((kind) =>
    (INVESTMENT_GROUNDS as readonly GroundKind[]).includes(kind),
  )

  // Counted by AXIS, not by ground. `followed-across` and `read-around` are the
  // two ends of one axis and count once between them — `BREADTH_AXIS` argues it
  // and names what counting them twice admitted. Both stay in `kinds` and both
  // still say their sentence; only this number folds.
  const bothEnds = BREADTH_AXIS.every((kind) => kinds.includes(kind))
  const axes = investment.length - (bothEnds ? BREADTH_AXIS.length - 1 : 0)

  const last = sentences.length - 1
  if (last >= 0 && UNDER_TEST !== '') sentences[last] = `${sentences[last] ?? ''}${UNDER_TEST}`

  return {
    kinds,
    sufficient: intent.length >= INTENT_REQUIRED && axes >= INVESTMENT_REQUIRED,
    sentences,
  }
}
