/**
 * The front door — a list of work nobody filed.
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
 * watches, notices a subject, offers, and the person answers one question. What
 * they see here afterwards is a record of what that produced — and every name on
 * it can be changed on the project's own screen.
 *
 * ── Why "running" is not read off the session row ────────────────────────
 *
 * A WorkSession whose phase is `observing` means a human started one and no
 * human has ended it. It does not mean anything is being captured: the live
 * token lives in memory in this process, so a restart leaves an open session
 * row that nothing is feeding. Saying "a session is running" in that state
 * would be a false statement about our own software, which §11 rules out. So
 * the banner is gated on the capture store, and the project screen says the
 * awkward thing out loud when the two disagree.
 *
 * That rule now reaches one layer further, into the status word beside every
 * row — and it is held in `src/server/front-door.ts` rather than here, along
 * with the rest of the derivation. See below.
 *
 * ── Why the status word is derived rather than written here ──────────────
 *
 * It used to be three strings in a ternary, off the most recent sitting's
 * `phase`, and the answer was wrong in the expensive direction: a project whose
 * shift ended with an unanswered question rendered `idle` — the same word as a
 * project nobody had touched in a month. The person had to open it to find out
 * that Propositum was waiting on them.
 *
 * `intentionState` is now the single place that answers "where is this?", and
 * ADR-0011 argues its precedence — `needs-you` outranks every activity word,
 * because a false one costs a look and a missed one costs the shift. The five
 * consumer labels come from `INTENTION_STATES` rather than from literals here,
 * so a state cannot arrive on screen wearing its enum member. `sleeping` will
 * be most rows most of the time; CONTEXT.md says so, says it will read like a
 * bug, and says that making it more interesting means inferring.
 *
 * ── And why the derivation is not in this file ───────────────────────────
 *
 * Because nothing can test it here. A review mutated the `intentionState` call
 * in this file so that every row rendered *Sleeping* and no row could ever
 * reach `needs-you`, and the full suite stayed green: the only guard was a grep
 * for the call, and a grep is satisfied by a call whose result is discarded.
 * `frontDoorRow` and `statusWordFor` are in `src/server/front-door.ts` so that
 * `tests/front-door.test.ts` can assert the word a person actually reads. What
 * is left here is markup and one call each.
 *
 * **`noticedStrands` and `strandBySignature` moved there for the same reason on
 * 2026-08-17**, when this screen started showing every strand of an afternoon
 * rather than the strongest. Three decisions came with that — the snooze
 * filters, the refusal of a duplicate signature, and which strand a button
 * belongs to — and each of them fails without anything on screen looking wrong.
 * The last is the worst of the three: a button that starts the wrong subject
 * approves the wrong sites, and the person finds out from a session that reads
 * slightly oddly.
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

import { Empty, Masthead, Section, Sheet } from '@/ui/primitives'
import { Away, Handover, Watching } from '@/ui/sprites'
import { carryOnCandidate, declineThreadOffer, startFromSuggestion } from '@/server/actions'
import type { CarriedProject } from '@/server/actions'
import { ambientStore, captureStore } from '@/server/capture-store'
import { describeWork, signatureOf } from '@/server/ambient-store'
import type { NamedThread } from '@/server/ambient-store'
import type { WorkDetected } from '@/domain/detection/detect'
import {
  frontDoorRow,
  noticedStrands,
  statusWordFor,
  strandBySignature,
} from '@/server/front-door'
import type { FrontDoorRow } from '@/server/front-door'
import type { IntentionStateFacts } from '@/persistence/repositories/index'

import { appContext } from '@/server/db'

// The capture store is in-memory and the database is a local file. Neither is
// cacheable, and a stale "a session is running" is exactly the lie §11 forbids.
export const dynamic = 'force-dynamic'

const CSS = `
.hm-row { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem 1.5rem; align-items: baseline; padding: 0.85rem 0; border-bottom: 1px solid var(--rule); }
.hm-row:last-of-type { border-bottom: none; }
.hm-name { font-family: var(--serif); font-size: 1.1875rem; color: var(--ink); text-decoration: none; }
.hm-name:hover { text-decoration: underline; text-underline-offset: 3px; }
.hm-name:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
.hm-under { margin: 0.25rem 0 0; font-size: 0.8125rem; color: var(--muted); }
.hm-state { display: flex; flex-direction: column; align-items: flex-end; gap: 0.35rem; }
.hm-meta { font-size: 0.8125rem; color: var(--faint); font-family: var(--mono); white-space: nowrap; }
.hm-meta[data-waiting="true"] { color: var(--attention); }
/* Not a button. It goes somewhere, so it keeps middle-click, the back button
   and the keyboard — the argument tk-go already makes on the session screen. */
.hm-waiting { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--attention); text-decoration: none; white-space: nowrap; }
.hm-waiting:hover { text-decoration: underline; text-underline-offset: 3px; }
.hm-waiting:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }

.hm-lede { font-family: var(--serif); font-size: 1.1875rem; line-height: 1.45; margin: 0; max-width: 36rem; text-wrap: pretty; }
.hm-note { margin: 0.6rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 36rem; }

.hm-acts { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 1.25rem; }
.hm-submit { font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.45rem 0.9rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; cursor: pointer; }
.hm-submit:hover { border-color: var(--accent); }
.hm-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.hm-submit-primary { border-color: var(--accent); background: var(--accent); color: var(--ground); }
.hm-submit-primary:hover { filter: brightness(1.07); }

.hm-go { display: inline-block; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--accent); background: var(--accent); color: var(--ground); border-radius: 3px; text-decoration: none; }
.hm-go:hover { filter: brightness(1.07); text-decoration: none; }
.hm-go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

/* One strand of an afternoon. A hairline between them rather than a card each:
   this is one thing Propositum is saying, in two or three parts, and boxing
   them would read as two or three separate demands. */
.hm-strand { padding: 1.5rem 0; border-bottom: 1px solid var(--attention); }
.hm-strand:first-of-type { padding-top: 0; }
.hm-strand:last-of-type { border-bottom: none; padding-bottom: 0.25rem; }
/* The sentence above the strands, which qualifies all of them. */
.hm-strands { margin: 0 0 1.5rem; }

/* The carry-on box. Indented under the offer, because it is a qualification of
   the offer rather than a second one. */
.hm-back-on { margin: 1.25rem 0 0; padding: 0.9rem 0 0.9rem 1.1rem; border-left: 2px solid var(--accent); }
.hm-back-on-name { font-family: var(--serif); font-size: 1.0625rem; margin: 0; }
.hm-back-on-meta { font-family: var(--mono); font-size: 0.75rem; color: var(--faint); margin: 0.3rem 0 0; }

.hm-live { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
.hm-live p { margin: 0; max-width: 34rem; font-family: var(--serif); font-size: 1.125rem; line-height: 1.5; }

.hm-problem { margin: 0 0 2.25rem; padding: 0.75rem 1rem; border-left: 2px solid var(--attention); background: var(--raised); color: var(--attention); font-size: 0.9375rem; }

.hm-prose { margin: 0; color: var(--muted); max-width: 38rem; }
.hm-aside { display: flex; align-items: center; gap: 0.5rem; margin: 0.85rem 0 0; color: var(--faint); max-width: 38rem; font-size: 0.875rem; }
`

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' })

function clock(at: Date): string {
  return CLOCK.format(at).replace(/AM$/, 'am').replace(/PM$/, 'pm')
}

/** "3:41pm today" for a sitting this morning, the weekday for anything older —
 *  the same day is the only case where a bare time is unambiguous. */
function when(at: Date, now: Date): string {
  const sameDay = at.toDateString() === now.toDateString()
  return sameDay ? `${clock(at)} today` : `${DAY.format(at)}, ${clock(at)}`
}

interface RunningSession {
  readonly projectId: string
  readonly projectName: string
  readonly startedAt: Date
  /** `away` means an agreement is live and Propositum holds the work. */
  readonly away: boolean
}

/** One line of the list: a subject Propositum identified, and where it got to.
 *  The three derived fields are `FrontDoorRow`'s and are documented there. */
interface IdentifiedWork extends FrontDoorRow {
  readonly id: string
  readonly name: string
  readonly sittings: number
  readonly lastSittingAt: Date | null
}

/**
 * The subject this work would be filed under, from whatever naming has managed
 * so far.
 *
 * Computed identically here and inside the accept action, so the carry-on box
 * cannot promise one thing and the acceptance do another. When no model has
 * named the thread yet — no key, or the call has not come back — the recurring
 * words stand in. They are a worse name and a true one.
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
  // The box above may not have been on screen at all — naming can land between
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

  const now = new Date()
  const nowMs = now.getTime()

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
   * When each subject was last worked on, and how far it got.
   *
   * One query per project, issued together rather than one after another. This
   * is the most-hit route and it used to cost nothing, so a serial walk would
   * make the front door slower every time Propositum identifies something —
   * the wrong direction for a screen whose whole content is that list. A local
   * SQLite file will not thank anyone for a join here.
   */
  const identified: IdentifiedWork[] = await Promise.all(
    projects.map(async (project) => {
      // Newest first, by the repository's own ordering.
      const sittings = await repos.sessions.forProject(project.id)
      const latest = sittings[0]
      const derived = frontDoorRow({
        facts: factsByProject.get(project.id) ?? null,
        sittings,
        liveSessionId: live?.sessionId ?? null,
        nowEpochMs: nowMs,
      })

      return {
        id: project.id,
        name: project.name,
        sittings: sittings.length,
        lastSittingAt: latest?.startedAt ?? null,
        ...derived,
      }
    }),
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
  const noticed = live ? [] : noticedStrands(ambient, ambient.since(nowMs), nowMs)

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

  return (
    <Sheet>
      <style href="propositum-home" precedence="default">
        {CSS}
      </style>

      <Masthead
        kicker="Propositum"
        title="What you have been working on"
        subtitle="Propositum works this out from what you read. You never file anything — when it gets a name wrong, open it and change it."
        mark={running ? <Watching size={20} delay={0.3} /> : <Away size={20} delay={0.3} />}
      />

      {problem ? (
        <p className="hm-problem" role="status">
          {problem}
        </p>
      ) : null}

      {running ? (
        <Section
          title={running.away ? 'Propositum is working while you are away' : 'A session is running'}
          tone="attention"
          index={1}
        >
          <div className="hm-live">
            <p>
              {running.away
                ? `You handed ${running.projectName} over. Propositum holds the work until it is finished or you take it back.`
                : `You started a session in ${running.projectName} at ${clock(running.startedAt)}. Everything you do on an approved source is going into its timeline.`}
            </p>
            <Link className="hm-go" href={`/projects/${running.projectId}`}>
              {running.away ? 'Take back control' : 'Open the session'}
            </Link>
          </div>
        </Section>
      ) : null}

      {/* ONE Section, however many strands are inside it. `Section` budgets a
          single `tone='attention'` per screen — two attentions is none — and
          three bands down the page would spend that budget three times over on
          what is, to the person, one thing Propositum has to say. */}
      {strands.length === 0 ? null : (
        <Section title="Propositum noticed" tone="attention" index={2}>
          {/* Said once, above all of them, because it is the fact that makes
              three buttons honest. Only one session runs at a time, so only one
              of these can be taken — and starting one stops the watching that
              was holding the others, so they end rather than wait. A screen
              offering three choices without saying that would be implying the
              other two keep. */}
          {strands.length > 1 ? (
            <p className="hm-note hm-strands">
              You have had more than one thing going. Propositum watches one at a time, so saying
              yes to one of these starts that one and lets the rest go &mdash; what it saw of the
              others is thrown away rather than kept waiting. Turning one down on its own leaves
              the others where they are.
            </p>
          ) : null}

          {strands.map((strand) => (
            <div className="hm-strand" key={strand.signature}>
              {/* The named sentence only when the model was sure. A confident
                  wrong name reads as Propositum knowing something it does not;
                  the deterministic sentence is vaguer and always true. */}
              <p className="hm-lede">
                {strand.named?.confident
                  ? `Looks like you are working on ${strand.named.subject}.`
                  : strand.sentence}
              </p>
              <p className="hm-note">{strand.because}</p>

              {strand.backOn === null ? (
                <div className="hm-acts">
                  <form action={carryOn}>
                    <input type="hidden" name="thread" value={strand.signature} />
                    <button className="hm-submit hm-submit-primary" type="submit">
                      {'Set this up for me'}
                    </button>
                  </form>
                  <form action={notNow}>
                    <input type="hidden" name="thread" value={strand.signature} />
                    <button className="hm-submit" type="submit">
                      Not now
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  {/* Filing is a decision Propositum made, so it is stated before
                      it is acted on — and the way out of it is beside it, not
                      buried on the screen you land on afterwards. */}
                  <div className="hm-back-on">
                    <p className="hm-note" style={{ marginTop: 0 }}>
                      Looks like you are back on
                    </p>
                    <p className="hm-back-on-name">{strand.backOn.name}</p>
                    <p className="hm-back-on-meta">
                      {strand.backOn.sittings}{' '}
                      {strand.backOn.sittings === 1 ? 'sitting' : 'sittings'} &middot;{' '}
                      {strand.backOn.sources} {strand.backOn.sources === 1 ? 'source' : 'sources'}{' '}
                      &middot; {strand.backOn.documents}{' '}
                      {strand.backOn.documents === 1 ? 'document' : 'documents'} &middot;{' '}
                      {strand.backOn.overlap} {strand.backOn.overlap === 1 ? 'word' : 'words'} in
                      common
                    </p>
                  </div>

                  <div className="hm-acts">
                    <form action={carryOn}>
                      <input type="hidden" name="thread" value={strand.signature} />
                      <button className="hm-submit hm-submit-primary" type="submit">
                        Carry on with it
                      </button>
                    </form>
                    <form action={asNewWork}>
                      <input type="hidden" name="thread" value={strand.signature} />
                      <button className="hm-submit" type="submit">
                        No &mdash; this is new work
                      </button>
                    </form>
                    <form action={notNow}>
                      <input type="hidden" name="thread" value={strand.signature} />
                      <button className="hm-submit" type="submit">
                        Not now
                      </button>
                    </form>
                  </div>
                </>
              )}
            </div>
          ))}

          {/* Once, at the foot, because it is true of every strand above it and
              repeating it three times would read as three separate promises. */}
          <p className="hm-note">
            Nothing has been recorded. What Propositum saw is held in memory for half an hour and
            thrown away unless you say yes &mdash; and it never included the words on the page.
          </p>
        </Section>
      )}

      <Section title="What Propositum has picked out" index={strands.length > 0 ? 3 : 2}>
        {identified.length === 0 ? (
          <Empty
            title="Nothing yet."
            next="There is nothing to set up. Go and read about something for a while — when the same subject turns up across a few sites, Propositum will say so and offer to pick it up."
          />
        ) : (
          identified.map((work) => (
            <div className="hm-row" key={work.id}>
              <div>
                <Link className="hm-name" href={`/projects/${work.id}`}>
                  {work.name}
                </Link>
                <p className="hm-under">
                  {work.lastSittingAt === null
                    ? 'No sitting yet'
                    : `${work.sittings} ${work.sittings === 1 ? 'sitting' : 'sittings'} · last ${when(work.lastSittingAt, now)}`}
                  {/* The capture fact, kept where it has always been said and
                      not folded into the word beside it. A sitting nobody ended
                      and nothing is feeding is a real state, and the status word
                      deliberately claims nothing about it. */}
                  {work.openUnwatched ? ' · open, not being watched' : ''}
                </p>
              </div>
              <div className="hm-state">
                <span
                  className="hm-meta"
                  data-waiting={work.state === 'needs-you' ? 'true' : 'false'}
                >
                  {statusWordFor(work.state)}
                </span>
                {/* The way to the note, from the only screen a person reliably
                    starts on. "While you were away" is that screen's masthead
                    and the label on every other link that reaches it, so this
                    one says it too — a second phrase for one destination is two
                    places to look for one thing. */}
                {work.state === 'needs-you' && work.waitingContractId !== null ? (
                  <Link className="hm-waiting" href={`/shifts/${work.waitingContractId}`}>
                    While you were away
                  </Link>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title="How this works" index={strands.length > 0 ? 4 : 3}>
        <p className="hm-prose">
          Propositum watches the sites you have let Chrome share with it and works out what you are
          reading about. When a subject holds up across a few sites, it offers to pick it up &mdash;
          and if you say yes it sets everything up itself. When you step away, hand it over inside a
          working agreement you write and accept; when you come back, read what changed and decide.
        </p>
        <p className="hm-aside">
          <Handover size={14} title="Handed over" /> Nothing is recorded until you accept an offer,
          and only you can end a session.
        </p>
      </Section>
    </Sheet>
  )
}
