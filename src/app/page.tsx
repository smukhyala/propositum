/**
 * The front door — one question, and the two ways to answer it.
 *
 * ── What this screen is now, and what it stopped being ───────────────────
 *
 * It was a dashboard: a masthead, an attention band, a list of every subject
 * Propositum had picked out, and a "How this works" essay under that. The
 * owner's brief cut all of it:
 *
 * "Do the UI so it's extremely bare bones and simple. I literally just wanted
 * this to show the current proposed [work] and whether to do it or not, and
 * then the name of the tool, etc. That's very basic, black and white, bare
 * bones, but they should be friendly. Maybe add a sprite or something."
 *
 * So there are three things on it. The wordmark, small and mono, because it is
 * a signature rather than a heading. The proposal, set large in the serif, with
 * the deterministic `because` line under it in mono. And yes or no.
 *
 * The one exception below the offer is the re-entry line: when a shift is
 * waiting on the person, one plain line names the project and says *While you
 * were away*. It is the only route to a finished shift from the screen people
 * actually land on, so it survived the cut — `tests/reachability.test.ts` holds
 * that route open, and this file calls `frontDoorRow` because the whole of what
 * decides whether a row appears at all is `state === 'needs-you'`.
 *
 * It no longer calls `statusWordFor`. The rows are already filtered to that one
 * state, so the word could only ever come out *Needs you* beside a link that
 * says the same thing; the note beside the row markup carries the argument, and
 * the reachability assertion moved with it.
 *
 * ── Why there is no colour on this screen ────────────────────────────────
 *
 * `--ink` on `--ground`, `--rule` for hairlines, `--muted` for the evidence
 * line. No `--accent` and no `--attention`. Yes and no differ by weight and
 * fill rather than by hue: the accept is solid ink with ground-coloured text,
 * the decline is text behind a hairline. The tokens are untouched — every other
 * screen still spends the accent — this one just declines to.
 *
 * That leaves the friendliness to be carried by the sprite, the spacing and the
 * voice, which is the constraint rather than a shortfall of it.
 *
 * ── Why `Section` and `Masthead` are not used here ───────────────────────
 *
 * Both are correct and both are coloured: `Masthead` puts the kicker in the
 * accent, and `Section tone='attention'` breaks the column with attention-
 * coloured rules and a raised ground. Nothing about them is wrong — they are
 * how the rest of the product looks — and this screen simply is not that shape
 * any more. It keeps `Sheet`, so the page's column and entrance stay shared,
 * and sets its own narrower measure inside it.
 *
 * ── What is deliberately not here any more ───────────────────────────────
 *
 * There used to be a form on this page whose only field was a project name, and
 * a second one asking which project a detected piece of work should be filed
 * into. Both are gone.
 *
 * "I don't want the user to define the projects themselves. The tools should
 * identify them for them, and then the user can edit after. Initially, they
 * shouldn't have to create it."
 *
 * Naming a project is the first thing a person cannot do well: at the moment
 * they would have to type it, they are twenty minutes into reading and have not
 * decided the reading is a project. So this screen never asks. Propositum
 * watches, notices a subject, offers, and the person answers one question.
 *
 * ── Why "running" is not read off the session row ────────────────────────
 *
 * A WorkSession whose phase is `observing` means a human started one and no
 * human has ended it. It does not mean anything is being captured: the live
 * token lives in memory in this process, so a restart leaves an open session
 * row that nothing is feeding. Saying "a session is running" in that state
 * would be a false statement about our own software, which §11 rules out. So
 * the line is gated on the capture store, and the project screen says the
 * awkward thing out loud when the two disagree.
 *
 * ── Why which rows appear is derived rather than decided here ────────────
 *
 * A status word used to be three strings in a ternary, off the most recent
 * sitting's `phase`, and the answer was wrong in the expensive direction: a
 * project whose shift ended with an unanswered question rendered `idle` — the
 * same word as a project nobody had touched in a month. The person had to open
 * it to find out that Propositum was waiting on them. The word is gone from
 * this screen; the question it was answering is not, because it is now what
 * decides whether the row exists.
 *
 * `intentionState` is now the single place that answers "where is this?", and
 * ADR-0011 argues its precedence — `needs-you` outranks every activity word,
 * because a false one costs a look and a missed one costs the shift.
 *
 * ── And why the derivation is not in this file ───────────────────────────
 *
 * Because nothing can test it here. A review mutated the `intentionState` call
 * in this file so that every row rendered *Sleeping* and no row could ever
 * reach `needs-you`, and the full suite stayed green: the only guard was a grep
 * for the call, and a grep is satisfied by a call whose result is discarded.
 * `frontDoorRow`, `statusWordFor`, `noticedStrands` and `strandBySignature` are
 * in `src/server/front-door.ts` so that `tests/front-door.test.ts` can assert
 * the state a row is filtered on, and so that the three silent decisions
 * behind the strands — the snooze filters, the refusal of a duplicate
 * signature, and which strand a button belongs to — sit where a test can hold
 * them. The last is the worst of the three: a button that starts the wrong
 * subject approves the wrong sites, and the person finds out from a session
 * that reads slightly oddly. What is left here is markup and one call each.
 *
 * ── Why the forms are plain server actions ───────────────────────────────
 *
 * No client state, so no client component: the form posts, the action returns a
 * result, and a failure comes back as a sentence in the URL. That keeps the
 * whole screen renderable on the server and means the error survives a reload,
 * which a `useState` banner does not.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Sheet } from '@/ui/primitives'
import { Away, Handover, Watching } from '@/ui/sprites'
import {
  carryOnCandidate,
  declineThreadOffer,
  forgetCalendar,
  startFromSuggestion,
} from '@/server/actions'
import type { CarriedProject } from '@/server/actions'
import { calendarRow } from '@/server/calendar'
import { ambientStore, captureStore } from '@/server/capture-store'
import { describeWork, signatureOf } from '@/server/ambient-store'
import type { NamedThread } from '@/server/ambient-store'
import type { WorkDetected } from '@/domain/detection/detect'
import { frontDoorRow, noticedAfternoon, strandBySignature } from '@/server/front-door'
import { countQuietly } from '@/server/offer-tally'
import type { FrontDoorRow } from '@/server/front-door'
import type { IntentionStateFacts } from '@/persistence/repositories/index'

import { appContext } from '@/server/db'

// The capture store is in-memory and the database is a local file. Neither is
// cacheable, and a stale "a session is running" is exactly the lie §11 forbids.
export const dynamic = 'force-dynamic'

/**
 * The whole of the screen's look, in three type roles and two shades of one
 * colour.
 *
 * `--serif` says the sentence and every sentence answering it, `--mono` signs
 * the page, states the evidence and labels the buttons, `--ink` and `--muted`
 * are the only colours, `--rule` is every line. The measure is 34rem rather
 * than the sheet's 54: one short sentence and two buttons in a 54rem column
 * reads as a fragment of a page that failed to load.
 *
 * ── Three roles, counted honestly, after two of them turned out to be five ──
 *
 * `.hm-btn` was `font: inherit`, which on this screen means `--sans` off
 * `body` — a family that appears NOWHERE else here, on the two controls that
 * matter most, so yes and no read as browser chrome dropped into a serif page.
 * They are mono now, at the size of the evidence line they answer.
 *
 * And there was a `.hm-fine` at 0.6875rem beside `.hm-because` at 0.75rem:
 * same family, same colour, 1.09x apart, which is not two roles but one role
 * rendered inconsistently. `.hm-fine` is gone. What actually needed separating
 * was the FILING sentence — the project a strand would be absorbed into was set
 * in the same mono grey as the throwaway line above it — so that has a serif
 * role of its own, and the name inside it is the one italic on the screen.
 *
 * ── And why `.hm-problem` is not the quietest thing here any more ────────
 *
 * It is the only text on this screen a person did not ask to see, and it was
 * 0.75rem mono — smaller than the sentence it interrupts by a factor of nearly
 * three, stacked above a large mark and a large serif headline both shouting
 * about a state that did not change. Dropping `--attention` from this screen
 * was a decision about HUE. It was not a decision to make a failure whisper, so
 * the weight comes back in greyscale: serif, ink, and the one 2px rule here.
 */
const CSS = `
/* One column, and tall enough that a short answer sits in the middle of the
   screen rather than clinging to the top of it. The auto margins below do the
   centring while there is room and collapse to nothing when there is not, so
   three strands push the page down the way a list should. */
.hm-col { max-width: 34rem; margin: 0 auto; min-height: calc(100vh - 12rem); display: flex; flex-direction: column; }

/* The name of the tool. A signature at the top, not a heading. */
.hm-wordmark { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.3em; text-transform: uppercase; color: var(--ink); margin: 0; }

.hm-body { margin: auto 0; padding-top: 3.5rem; }

/* The one warm thing on the page. Always directly above the sentence that
   names what it means, and its accessible label always says what that sentence
   says — a sprite is never the only carrier of anything, and a mark whose label
   names something the adjacent text does not is worse than no mark.

   Drawn at MARK_PEN CSS px, which is the width of every rule, border and
   underline on this screen. See SpriteProps.pen: at MARK_SIZE the default grid
   stroke would have come out near 3px, four times the hairline it sits beside,
   so the page's one decorative element was also its loudest. */
.hm-mark { display: block; color: var(--ink); margin: 0 0 1.75rem; }

.hm-say { font-family: var(--serif); font-weight: 400; font-size: clamp(1.5rem, 5.2vw, 2.0625rem); line-height: 1.24; letter-spacing: -0.015em; color: var(--ink); margin: 0; text-wrap: pretty; }
.hm-then { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.55; color: var(--muted); margin: 1.15rem 0 0; text-wrap: balance; }
.hm-because { font-family: var(--mono); font-size: 0.75rem; line-height: 1.65; color: var(--muted); margin: 1.15rem 0 0; }

/* The filing decision. Serif and ink, because the project a strand is about to
   be absorbed into is the one word in this block a person has to read. */
.hm-filed { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.5; color: var(--ink); margin: 1.5rem 0 0; }
.hm-filed-name { font-style: italic; }
.hm-filed + .hm-because { margin-top: 0.45rem; }

/* A failure, said plainly, and not quietly. It gets the one 2px rule on the
   screen because it is the only thing here a person did not ask to see. */
.hm-problem { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.5; color: var(--ink); border-left: 2px solid var(--ink); padding-left: 1.05rem; margin: 0 0 3.25rem; }

/* Three strands are one list, so each proposal is set smaller than the one
   sentence naming the state above them — the same treatment as each other,
   which is what stops the page reading as three demands shouted in turn. */
.hm-offer-many .hm-strand .hm-say { font-size: clamp(1.25rem, 3.6vw, 1.5rem); }
.hm-note { margin: 1.15rem 0 3.5rem; }
.hm-foot { margin-top: 2.75rem; }

/* Yes and no, told apart by weight and fill. There is no hue here to spend.

   Hover THICKENS, the way the re-entry underline below does, and never moves
   toward the ground. The accept used to go from --ink to --muted on hover —
   about three quarters of its contrast, in both themes, at the moment of
   commitment — which is the conventional signal for "disabled". So the ink
   grows instead: 2px more of it outside the edge, and a hairline of ground
   just inside, which is the same "the line got heavier" move made legible on a
   control that is already solid. Both are token colours, so it reads the same
   way in dark, where the two swap roles. */
.hm-acts { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 2.25rem 0 0; }
.hm-btn { font-family: var(--mono); font-size: 0.75rem; line-height: 1.4; padding: 0.6rem 1.05rem; border: 1px solid var(--muted); background: transparent; color: var(--ink); border-radius: 2px; cursor: pointer; }
.hm-btn:hover { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.hm-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.hm-btn-yes { background: var(--ink); border-color: var(--ink); color: var(--ground); }
.hm-btn-yes:hover { background: var(--ink); border-color: var(--ink); box-shadow: 0 0 0 2px var(--ink), inset 0 0 0 1px var(--ground); }

/* Two strands of one afternoon are one thing Propositum is saying in two
   parts. Whitespace and a hairline, never a card each. */
.hm-strand + .hm-strand { margin-top: 3.5rem; padding-top: 3.5rem; border-top: 1px solid var(--rule); }

/* The only thing that survives below the offer. */
.hm-waits { margin-top: 5.5rem; border-top: 1px solid var(--rule); }
.hm-wait { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1.25rem; padding: 0.9rem 0; font-family: var(--mono); font-size: 0.75rem; color: var(--ink); text-decoration: none; }
.hm-wait + .hm-wait { border-top: 1px solid var(--rule); }
.hm-wait-go { text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.hm-wait:hover .hm-wait-go { text-decoration-thickness: 2px; }
.hm-wait:focus-visible { outline: 2px solid var(--ink); outline-offset: 4px; border-radius: 2px; }

/* The calendar row, ADR-0014. Deliberately the quietest thing on the screen and
   deliberately the last: it is about a credential rather than about the
   person's work, and every other row here is about their work. It borrows the
   hm-wait treatment because it is the same kind of object — one mono line with
   something to press on the right — rather than inventing a fourth. */
.hm-cal { margin-top: 2.25rem; border-top: 1px solid var(--rule); display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0.25rem 1.25rem; padding: 0.9rem 0; font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.hm-cal-said { max-width: 26rem; }
/* Two controls at most, and usually one: a rejected credential can be replaced
   or removed, and both belong on the same line as each other rather than one of
   them wrapping to a row of its own. */
.hm-cal-acts { display: flex; align-items: baseline; gap: 1.25rem; }
.hm-cal-go { font: inherit; color: var(--ink); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.hm-cal-go:hover { text-decoration-thickness: 2px; }
.hm-cal-go:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }

/* One exception to "quietest": a rejected credential is the only thing here a
   person did not ask to see and CAN fix, so it takes the ink the sentence above
   it does not. Still not the hm-problem 2px rule — that belongs to a failure of
   something they just did, and this is a failure of something they set up weeks
   ago. */
.hm-cal-stale .hm-cal-said { color: var(--ink); }

.hm-link { color: var(--ink); text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.hm-link:hover { text-decoration-thickness: 2px; }
.hm-link:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; border-radius: 2px; }
`

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

function clock(at: Date): string {
  return CLOCK.format(at).replace(/AM$/, 'am').replace(/PM$/, 'pm')
}

/** How big the one mark on the screen is drawn, and with what pen. The pen is
 *  in CSS pixels and matches every hairline here; see `SpriteProps.pen`. */
const MARK_SIZE = 48
const MARK_PEN = 1

/**
 * A small count, in words.
 *
 * Prose, not a table: *Two shifts finished while you were away* is a sentence
 * and *2 shifts finished* is a readout. Past nine it gives up and uses the
 * digits, because spelling out fourteen is worse than either.
 */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n)
}

/** The same word, starting a sentence. */
function countWordCapped(n: number): string {
  const word = countWord(n)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

interface RunningSession {
  readonly projectId: string
  readonly projectName: string
  readonly startedAt: Date
  /** `away` means an agreement is live and Propositum holds the work. */
  readonly away: boolean
}

/** One subject Propositum identified, and where it got to. The three derived
 *  fields are `FrontDoorRow`'s and are documented there. */
interface IdentifiedWork extends FrontDoorRow {
  readonly id: string
  readonly name: string
}

/**
 * The subject this work would be filed under, from whatever naming has managed
 * so far.
 *
 * Computed identically here and inside the accept action, so what the screen
 * says cannot promise one thing and the acceptance do another. When no model
 * has named the thread yet — no key, or the call has not come back — the
 * recurring words stand in. They are a worse name and a true one.
 *
 * An UNCONFIDENT name is discarded rather than used, and that is a deliberate
 * trade: the offer above it already refuses to show an unsure name as a
 * sentence, so filing the work under one anyway would mean the screen and the
 * project it creates disagree about what this is. The cost is a project called
 * "world models genie" where a better name was available and merely unsure.
 * Renaming it is one field on its own screen.
 */
function subjectOf(detected: WorkDetected, named: NamedThread | null): string {
  // `labels`, not `terms`. This string becomes a Project's name when the model
  // was not sure, so a stem here would be filed under a word nobody wrote.
  const terms = detected.labels.slice(0, 3).join(' ')
  return named?.confident ? named.subject : terms
}

/**
 * Yes.
 *
 * ── Why detection is recomputed instead of read off the form ─────────────
 *
 * The buffer moves while the page sits open. A hidden field would carry a
 * subject that was true a minute ago into a session record claiming it is true
 * now, and the pages pinned as "the thread" are exactly what gets folded into
 * the ledger — so they have to be the current ones.
 *
 * ── What the form DOES carry, and why that is not the same concession ────
 *
 * The signature, and nothing else. `strandBySignature` in `front-door.ts` holds
 * the whole of that argument and is where it can be tested; the short version is
 * that the signature SELECTS among strands detected a moment ago and supplies
 * nothing of its own, so accepting the second strand carries the second strand's
 * pages, freshly computed.
 *
 * ── Why it lives out here and not inside the component ───────────────────
 *
 * The two `'use server'` closures below call it, and anything an inline server
 * action closes over is serialised across the boundary. A function is not
 * serialisable, so declaring this beside them throws at render — found by
 * loading the page, not by the typechecker.
 */
async function accept(threadSignature: string, treatAsNewWork: boolean): Promise<never> {
  const store = ambientStore()
  const at = Date.now()
  const fresh = strandBySignature(store.since(at), at, threadSignature)
  if (!fresh) {
    redirect(
      `/?problem=${encodeURIComponent('That has gone quiet. Propositum will offer again when it sees a subject come back.')}`,
    )
  }

  const signature = signatureOf(fresh.terms)
  // Pin which pages this thread was made of, so what gets carried into the
  // session is the thread and not everything that shared a site with it.
  store.rememberThread(signature, fresh.urls)

  const name = store.nameFor(signature)
  const result = await startFromSuggestion(
    subjectOf(fresh, name),
    fresh.origins,
    // ADR-0009 deleted the two-member list this argument came from. Until the
    // accept path takes the composed WorkOffer instead, the session starts in
    // the form that assumes nothing about what the work is: reading, not
    // drafting. Nothing here reads the model's proposal.
    'deep-research',
    signature,
    treatAsNewWork,
  )

  if (!result.ok) redirect(`/?problem=${encodeURIComponent(result.problem.message)}`)

  // The session screen is where the reading and the agreement live. When this
  // JOINED a project rather than opening one, the subject goes with it: that
  // screen states the filing decision and offers to undo it, and a merge the
  // person is never told about is the failure the matcher calls expensive.
  // The line above may not have been on screen at all — naming can land between
  // the render and the click — so the landing screen is the one place that
  // covers every path.
  const subject = subjectOf(fresh, name)
  redirect(
    result.value.joinedExisting
      ? `/sessions/${result.value.sessionId}?filed=${encodeURIComponent(subject)}`
      : `/sessions/${result.value.sessionId}`,
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const raw = params['problem']
  const problem = typeof raw === 'string' ? raw : null

  const { repos } = await appContext()
  const projects = await repos.projects.list()

  const live = captureStore().current()
  let running: RunningSession | null = null

  if (live) {
    const session = await repos.sessions.byId(live.sessionId)
    if (session && session.phase !== 'ended') {
      const project = await repos.projects.byId(session.projectId)
      if (project) {
        running = {
          projectId: project.id,
          projectName: project.name,
          startedAt: new Date(live.startedAtMs),
          away: session.phase === 'away',
        }
      }
    }
  }

  const nowMs = Date.now()

  /**
   * What the calendar connection is doing, if there is one to have — ADR-0014.
   *
   * Null when no `GOOGLE_OAUTH_CLIENT_ID` is configured AND no connection is
   * stored — which is the state of a fresh checkout and of the whole test suite.
   * Null renders nothing at all: there is no greyed-out control, no "connect a
   * calendar" invitation, and no trace of the feature on the screen. Configuring
   * a client id is the opt-in, and this row is what that opt-in buys.
   *
   * A STORED connection renders either way, including with the client id blanked
   * back out. That is the 2026-08-18 amendment and it is about a secret rather
   * than about a screen: the row is the only place in the product that can
   * delete the refresh token, so the row cannot be hidden by a setting while the
   * token is still on disk.
   *
   * Read here rather than derived here — `calendarRow` owns the states and the
   * argument for each, on the same rule `frontDoorRow` established: a decision
   * that fails silently does not live in a `.tsx` file. It cannot throw; a
   * calendar that cannot be read is a row that is not drawn, never a screen that
   * is not drawn.
   */
  const calendar = await calendarRow()

  /**
   * Where every Intention is, in one read.
   *
   * Not four reads per project. `factsForEveryProject` exists precisely so this
   * screen does not fan out — its docblock carries the argument, and the short
   * version is that composing this out of the single-parent readers is 4N
   * queries on the most-hit route in the product.
   */
  const factsByProject = new Map<string, IntentionStateFacts>()
  for (const facts of await repos.intentions.factsForEveryProject()) {
    factsByProject.set(facts.projectId, facts)
  }

  /**
   * Which subjects are waiting on the person — which is now the only question
   * this screen asks of the database's older half.
   *
   * The list of everything Propositum has picked out is gone from the screen,
   * and the derivation is not: `frontDoorRow` is what separates a project that
   * is merely quiet from one holding an unanswered question, and getting that
   * wrong in the cheap direction hides a finished shift behind a screen nobody
   * has a reason to open. One query per project, issued together rather than
   * one after another, because this is the most-hit route in the product.
   */
  const identified: IdentifiedWork[] = await Promise.all(
    projects.map(async (project) => {
      // Newest first, by the repository's own ordering.
      const sittings = await repos.sessions.forProject(project.id)
      const derived = frontDoorRow({
        facts: factsByProject.get(project.id) ?? null,
        sittings,
        liveSessionId: live?.sessionId ?? null,
        nowEpochMs: nowMs,
      })

      return { id: project.id, name: project.name, ...derived }
    }),
  )

  const waiting = identified.filter(
    (work) => work.state === 'needs-you' && work.waitingContractId !== null,
  )

  /**
   * Has Propositum noticed work nobody told it about — and how much of it?
   *
   * Rendered only when no session is running, because during one the timeline
   * already shows what is being seen — an offer to start something that has
   * started would be nonsense.
   *
   * ── Every strand, and why that is not the same decision as notifying ─────
   *
   * `detectThreads` returns each disjoint strand of the afternoon, strongest
   * first, bounded by `MAX_THREADS_SHOWN`. All of them are shown HERE and only
   * the strongest reaches the extension's badge and notification. The asymmetry
   * is the whole point: ADR-0008 names interruption as the expensive failure and
   * PRODUCT_PRINCIPLES §13 wants notifications sparse, but this is a screen a
   * person chose to open, and more information on it interrupts nobody.
   *
   * ── And the derivation is not in this file, for the reason it never is ──
   *
   * `noticedStrands` filters the snoozed, refuses a duplicate signature, and
   * keeps the bound — three decisions that all fail silently, in a `.tsx` server
   * component nothing in this suite can assert against. `front-door.ts` opens
   * with that argument and this is the second thing to move for it. What stays
   * here is markup and one call.
   */
  const ambient = ambientStore()
  // `nowMs` is the instant the lifecycle words above were computed from, rather
  // than a second reading of the clock. Two "now"s on one render is two answers
  // to one question, and this screen puts both answers on the same page.
  const afternoon = live
    ? { shown: [], suppressed: [] }
    : noticedAfternoon(ambient, ambient.since(nowMs), nowMs)
  const noticed = afternoon.shown

  /**
   * What this screen showed, and what it found and cut, counted once each.
   *
   * ── Why the count is taken here rather than inside the derivation ────────
   *
   * `noticedAfternoon` is a pure function of a buffer and a clock reading, and
   * it stays one. This is the moment a strand is actually put in front of
   * somebody, which is the event `docs/research/intent-suggestion-quality.md`
   * §10.5 asks to be counted — GitHub's *completion-shown rate*, the metric they
   * track beside acceptance and warn about optimising.
   *
   * `newlyShown` and `newlySuppressed` are markers on the buffer, so a person
   * who reloads Home four times is one offer rather than four, and a strand
   * badged by the poll and rendered here is one rather than two.
   *
   * ── The suppressed count is the one nothing had ─────────────────────────
   *
   * `MAX_THREADS_SHOWN` cuts the fourth strand and records nothing about it.
   * ADR-0008's own argument is that a strand found and discarded in silence is
   * the failure the multi-strand change existed to remove, and the display bound
   * does exactly that. Now it is a number — per day, with nothing attached
   * saying what was cut.
   *
   * Nothing about the SUBJECT crosses: `countQuietly` takes integers, and the
   * signatures stay in the buffer that dies with the process.
   */
  for (const strand of afternoon.shown) {
    if (ambient.newlyShown(strand.signature)) countQuietly({ offersShown: 1 }, nowMs)
  }
  for (const strand of afternoon.suppressed) {
    if (ambient.newlySuppressed(strand.signature)) countQuietly({ strandsSuppressed: 1 }, nowMs)
  }

  /**
   * Each strand as the screen renders it, including which project it would join.
   *
   * The carry-on question is asked per strand, because it is a per-strand answer
   * — two subjects in one afternoon can belong to two different projects, and
   * one of them can be new work. Issued together rather than in series, and
   * bounded by `MAX_THREADS_SHOWN`, so the worst case on the most-hit route is
   * three of these rather than an unbounded walk. Nothing is asked at all on the
   * ordinary quiet screen, where `noticed` is empty.
   */
  const strands = await Promise.all(
    noticed.map(async (thread) => {
      const named = ambient.nameFor(thread.signature)
      const subject = subjectOf(thread.detected, named)
      const described = describeWork(thread.detected, thread.signature, named)
      const candidate = await carryOnCandidate(subject)

      return {
        signature: thread.signature,
        named,
        sentence: described.sentence,
        because: described.because,
        backOn: candidate.ok ? candidate.value : (null as CarriedProject | null),
      }
    }),
  )

  /**
   * One set of actions for every strand, told apart by a hidden field.
   *
   * Not a closure per strand. An inline `'use server'` function declared inside
   * the render closes over whatever is in scope and that gets serialised across
   * the boundary — the note on `accept` records what happens when something
   * unserialisable is in there. A hidden input avoids the question entirely, and
   * it is the shape the "Not now" form already had.
   */
  async function carryOn(formData: FormData) {
    'use server'

    await accept(String(formData.get('thread') ?? ''), false)
  }

  async function asNewWork(formData: FormData) {
    'use server'

    await accept(String(formData.get('thread') ?? ''), true)
  }

  async function notNow(formData: FormData) {
    'use server'

    await declineThreadOffer(String(formData.get('thread') ?? ''))
    redirect('/')
  }

  /**
   * Which heading level a proposal is.
   *
   * With one strand the proposal is what the page is about, so it is the `h1`.
   * With several, the sentence that says how many were noticed is what the page
   * is about and each proposal sits under it — one `h1` per document either
   * way, and never zero, which is what this screen had after `Masthead` went.
   */
  const Say: 'h1' | 'h2' = strands.length > 1 ? 'h2' : 'h1'

  return (
    <Sheet>
      <style href="propositum-home" precedence="default">
        {CSS}
      </style>

      <div className="hm-col">
        <p className="hm-wordmark">Propositum</p>

        <div className="hm-body">
          {problem ? (
            <p className="hm-problem" role="status">
              {problem}
            </p>
          ) : null}

          {/* A session is live. One line, and the way into it. The offer cannot
              appear beside this — `noticed` is empty while anything is being
              captured — so the two are alternatives rather than a stack. */}
          {running ? (
            <>
              <span className="hm-mark">
                {running.away ? (
                  <Away size={MARK_SIZE} pen={MARK_PEN} title="Away" />
                ) : (
                  <Watching size={MARK_SIZE} pen={MARK_PEN} title="Watching" />
                )}
              </span>
              <h1 className="hm-say">
                {running.away
                  ? `Propositum is working on ${running.projectName} while you are away.`
                  : `You started on ${running.projectName} at ${clock(running.startedAt)}, and Propositum is watching.`}
              </h1>
              <p className="hm-because">
                <Link className="hm-link" href={`/projects/${running.projectId}`}>
                  {running.away ? 'Take back control' : 'Open the session'}
                </Link>
              </p>
            </>
          ) : null}

          {/* Nothing running, nothing noticed, and nothing waiting — the screen
              most days. An empty screen has to say what is true and what will
              happen, or it reads as something that failed to load. */}
          {!running && strands.length === 0 && waiting.length === 0 ? (
            <>
              <span className="hm-mark">
                <Watching size={MARK_SIZE} pen={MARK_PEN} title="Watching" />
              </span>
              <h1 className="hm-say">Nothing yet.</h1>
              <p className="hm-then">
                Go and read about something for a while. When the same subject turns up across a few
                sites, Propositum will say so here and offer to pick it up.
              </p>
            </>
          ) : null}

          {/* Nothing noticed, but shifts finished — and this is a DIFFERENT
              screen, which is the whole reason it is a separate branch.

              The empty box used to be gated on `strands.length === 0` alone, so
              "Nothing yet. / Go and read about something for a while." rendered
              directly above a list of finished shifts that were waiting on the
              person. Both halves were wrong at once: a false statement about
              our own state, and the wrong instruction at the exact moment
              Propositum is blocked on them rather than the other way round. */}
          {!running && strands.length === 0 && waiting.length > 0 ? (
            <>
              <span className="hm-mark">
                <Away size={MARK_SIZE} pen={MARK_PEN} title="While you were away" />
              </span>
              <h1 className="hm-say">Nothing new.</h1>
              <p className="hm-then">
                {countWordCapped(waiting.length)}{' '}
                {waiting.length === 1 ? 'shift' : 'shifts'} finished while you were away, just
                below. Propositum will offer again when the same subject turns up across a few
                sites.
              </p>
            </>
          ) : null}

          {strands.length > 0 ? (
            <div className={strands.length > 1 ? 'hm-offer hm-offer-many' : 'hm-offer'}>
              {/* One mark, and it belongs to whichever sentence leads.

                  With one strand that is the proposal, so the mark is the
                  handover arrow and it sits immediately above it. With several,
                  the leading sentence is the COUNT — and the mark for noticing
                  is the eye, above the sentence that says what was noticed.

                  It used to be the arrow in both cases, sitting above the
                  one-at-a-time caveat with three proposals a hundred pixels
                  below, so a mark labelled "Propositum can take this on" named
                  nothing on the screen and the first thing after the wordmark
                  was a caveat about a decision the reader had not been shown. */}
              {strands.length > 1 ? (
                <>
                  <span className="hm-mark">
                    <Watching
                      size={MARK_SIZE}
                      pen={MARK_PEN}
                      title={`Propositum noticed ${countWord(strands.length)} subjects`}
                    />
                  </span>
                  <h1 className="hm-say">
                    Propositum noticed {countWord(strands.length)} subjects while you were reading.
                  </h1>
                  {/* The fact that makes several buttons honest: only one
                      session runs at a time, so saying yes to one lets the rest
                      go. Said once, and said before any of them. */}
                  <p className="hm-then hm-note">
                    It watches one thing at a time, so saying yes to one of these lets the others
                    go. Turning one down leaves the rest where they are.
                  </p>
                </>
              ) : (
                <span className="hm-mark">
                  <Handover
                    size={MARK_SIZE}
                    pen={MARK_PEN}
                    title="Propositum can take this on"
                  />
                </span>
              )}

              {strands.map((strand) => (
                <div className="hm-strand" key={strand.signature}>
                  {/* The named sentence only when the model was sure. A
                      confident wrong name reads as Propositum knowing something
                      it does not; the deterministic sentence is vaguer and
                      always true.

                      `h1` when this proposal IS the page and `h2` when the
                      count above it is — the screen had no heading of any level
                      at all after `Masthead` was dropped, which left the
                      product's landing page with no document outline while
                      every other screen still had one. */}
                  <Say className="hm-say">
                    {strand.named?.confident
                      ? `Looks like you're working on ${strand.named.subject}.`
                      : strand.sentence}
                  </Say>
                  <p className="hm-because">{strand.because}</p>

                  {strand.backOn === null ? (
                    <div className="hm-acts">
                      <form action={carryOn}>
                        <input type="hidden" name="thread" value={strand.signature} />
                        <button className="hm-btn hm-btn-yes" type="submit">
                          {'Set this up for me'}
                        </button>
                      </form>
                      <form action={notNow}>
                        <input type="hidden" name="thread" value={strand.signature} />
                        <button className="hm-btn" type="submit">
                          Not now
                        </button>
                      </form>
                    </div>
                  ) : (
                    <>
                      {/* Filing is a decision Propositum made, so it is stated
                          before it is acted on — and the way out of it is the
                          button beside it, not something buried on the screen
                          you land on afterwards.

                          Which is why the project's name is not in the same
                          mono grey as the evidence line above it any more. It
                          was, and that made the one thing a person has to read
                          before pressing "Carry on with it" — WHICH EXISTING
                          PROJECT their afternoon is about to be merged into —
                          the quietest text in its own offer. The counts stay
                          mono, because counts are evidence. */}
                      <p className="hm-filed">
                        Looks like you&apos;re back on{' '}
                        <span className="hm-filed-name">{strand.backOn.name}</span>.
                      </p>
                      <p className="hm-because">
                        {strand.backOn.sittings}{' '}
                        {strand.backOn.sittings === 1 ? 'sitting' : 'sittings'} so far,{' '}
                        {strand.backOn.overlap}{' '}
                        {strand.backOn.overlap === 1 ? 'word' : 'words'} in common.
                      </p>

                      <div className="hm-acts">
                        <form action={carryOn}>
                          <input type="hidden" name="thread" value={strand.signature} />
                          <button className="hm-btn hm-btn-yes" type="submit">
                            Carry on with it
                          </button>
                        </form>
                        <form action={asNewWork}>
                          <input type="hidden" name="thread" value={strand.signature} />
                          <button className="hm-btn" type="submit">
                            No &mdash; this is new work
                          </button>
                        </form>
                        <form action={notNow}>
                          <input type="hidden" name="thread" value={strand.signature} />
                          <button className="hm-btn" type="submit">
                            Not now
                          </button>
                        </form>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {/* The last line of the offer, not a section under it. Nothing is
                  recorded until the person says yes, and the moment they are
                  deciding is the moment that is worth saying. */}
              <p className="hm-because hm-foot">
                Nothing has been recorded. Propositum holds what it saw for half an hour and throws
                it away unless you say yes.
              </p>
            </div>
          ) : null}

          {/* The only thing below the offer, and only when something is
              actually waiting. "While you were away" is the masthead of the
              screen it opens and the wording of every other link that reaches
              it — a second phrase for one destination is two places to look for
              one thing.

              ── Why there is no status word on this row any more ────────────

              There was: `<name> · Needs you   While you were away`. `waiting`
              is filtered to `state === 'needs-you'` three lines up, so the word
              could only ever be *Needs you* — the four other lifecycle words
              were unreachable from here — and the row already said the same
              thing twice over on its right-hand side. A call whose result the
              caller has constant-folded is not a rendering of a derivation; it
              is decoration that a reachability grep cannot tell from one.

              The obvious alternative is worse and is worth naming so nobody
              tries it: dropping the `needs-you` half of the filter and letting
              the word distinguish the rows would list projects where NOTHING is
              waiting, because `factsForEveryProject` falls back to
              `contracts[0].id` — `waitingContractId` is non-null for any
              Intention with an accepted contract. Every one of those rows would
              be labelled "While you were away" and open a note with nothing in
              it for the person to do. */}
          {waiting.length > 0 ? (
            <div className="hm-waits">
              {waiting.map((work) => (
                <Link
                  className="hm-wait"
                  key={work.id}
                  href={`/shifts/${work.waitingContractId}`}
                >
                  <span>{work.name}</span>
                  <span className="hm-wait-go">While you were away</span>
                </Link>
              ))}
            </div>
          ) : null}

          {/* ── The calendar, last and quietest ────────────────────────────

              Why it is HERE and not on the handoff screen, which is the screen
              that actually uses the calendar: an expired credential is the one
              calendar failure a person can fix, and the worst place to tell
              them is where a suggestion would have been. That is a screen they
              are trying to LEAVE from, at the one moment this feature exists to
              smooth. This is a screen they chose to open — the same argument
              this file already makes for showing every detected strand here
              while sending only the strongest to the extension's badge.

              ADR-0014 puts it more precisely than "somewhere else": the
              connection's state is legible *where a person went looking for
              it* — the surface that offers connecting and disconnecting — and
              nowhere else. This product has no settings screen, so that
              surface is this row, and the sentence and the control are the same
              object rather than two.

              Every other calendar failure says nothing anywhere. A dead
              network, a 500, a body that did not parse, an empty afternoon:
              the suggestion is absent, and nothing on any screen mentions it.

              Three states and no fourth. `not-configured` is not a state here
              — it is null, and null draws nothing.

              Amended 2026-08-18: **every stored credential gets a Disconnect,
              including a rejected one.** `reauthorise` used to offer only
              "Connect it again", so the one row that says *this credential is
              dead* was also the one row that could not delete it. And the
              connect link is gated on `canReconnect`, because with no client id
              the flow it starts cannot start — a stored connection still shows,
              and still deletes, with no link beside it. */}
          {calendar === null ? null : (
            <div className={calendar.state === 'reauthorise' ? 'hm-cal hm-cal-stale' : 'hm-cal'}>
              <span className="hm-cal-said">
                {calendar.state === 'connected'
                  ? calendar.canReconnect
                    ? 'Propositum can see when your calendar says you are busy. Times only — never what anything is called.'
                    : 'Your calendar permission is still stored on this machine, though this copy of Propositum is no longer set up to use it.'
                  : calendar.state === 'reauthorise'
                    ? 'Google stopped accepting Propositum’s calendar permission, so it is no longer reading it.'
                    : 'Propositum can read when your calendar says you are busy, and use it to suggest how long to work for.'}
              </span>

              <span className="hm-cal-acts">
                {calendar.state === 'not-connected' ? null : (
                  <form action={forgetCalendar}>
                    <button className="hm-cal-go" type="submit">
                      Disconnect
                    </button>
                  </form>
                )}

                {calendar.state !== 'connected' && calendar.canReconnect ? (
                  <Link className="hm-cal-go" href="/api/calendar/connect" prefetch={false}>
                    {calendar.state === 'reauthorise' ? 'Connect it again' : 'Connect a calendar'}
                  </Link>
                ) : null}
              </span>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
