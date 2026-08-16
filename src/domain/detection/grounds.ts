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
 * ── Why one-intent-and-two-investment, and not three-of-six ──────────────
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
 * ground is cheap to produce by accident. Depth on one page, span across the
 * thread, and breadth across sites are three different accidents, and needing
 * two of them is not much to ask of real work.
 *
 * Three-of-six would admit both failures directly. It passes `read-deeply` +
 * `stayed-with-it` + `followed-across` with no intent at all — the newsletter
 * afternoon. And it passes all three intent grounds with no investment —
 * somebody who searched, refined and came back inside a minute having read
 * nothing, which is what a search going badly looks like, and the worst
 * possible moment to interrupt. Both are ordinary browsing.
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
 *     anything, and nothing below would now let it through.
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
 * offered work. At fifteen it fires two of the three and is refused, which is
 * the answer `INVESTMENT_REQUIRED` argues for at length and had stopped
 * getting. Span is the cheapest of the three investment grounds to produce by
 * accident, because it costs a person nothing but time passing; lowering it is
 * therefore the closest thing available to lowering `INVESTMENT_REQUIRED`
 * itself, which the file next door refuses in as many words.
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
 * Depth, span and breadth. Three different accidents, so two of them together
 * are unlikely to be one.
 */
export const INVESTMENT_GROUNDS = ['read-deeply', 'stayed-with-it', 'followed-across'] as const

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

  const intent = kinds.filter((kind) => (INTENT_GROUNDS as readonly GroundKind[]).includes(kind))
  const investment = kinds.filter((kind) =>
    (INVESTMENT_GROUNDS as readonly GroundKind[]).includes(kind),
  )

  const last = sentences.length - 1
  if (last >= 0 && UNDER_TEST !== '') sentences[last] = `${sentences[last] ?? ''}${UNDER_TEST}`

  return {
    kinds,
    sufficient: intent.length >= INTENT_REQUIRED && investment.length >= INVESTMENT_REQUIRED,
    sentences,
  }
}
