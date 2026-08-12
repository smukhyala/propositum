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
import { carryOnCandidate, declineOffer, startFromSuggestion } from '@/server/actions'
import type { CarriedProject } from '@/server/actions'
import { ambientStore, captureStore } from '@/server/capture-store'
import { describeWork, signatureOf } from '@/server/ambient-store'
import type { NamedThread } from '@/server/ambient-store'
import { detectWork } from '@/domain/detection/detect'
import { offerableOf } from '@/model/boundaries/subject'
import type { WorkDetected } from '@/domain/detection/detect'

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
.hm-meta { font-size: 0.8125rem; color: var(--faint); font-family: var(--mono); white-space: nowrap; }
.hm-meta[data-live="true"] { color: var(--attention); }

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

/** One line of the list: a subject Propositum identified, and where it got to. */
interface IdentifiedWork {
  readonly id: string
  readonly name: string
  readonly sittings: number
  readonly lastSittingAt: Date | null
  /** SessionPhase of the most recent sitting, or null if it has none. */
  readonly phase: string | null
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
  const terms = detected.terms.slice(0, 3).join(' ')
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
 * ── Why it lives out here and not inside the component ───────────────────
 *
 * The two `'use server'` closures below call it, and anything an inline server
 * action closes over is serialised across the boundary. A function is not
 * serialisable, so declaring this beside them throws at render — found by
 * loading the page, not by the typechecker.
 */
async function accept(treatAsNewWork: boolean): Promise<never> {
  const store = ambientStore()
  const at = Date.now()
  const fresh = detectWork(store.since(at), at)
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
    // The store keeps what the model said as a plain string; the closed list is
    // applied here rather than trusted from memory.
    name ? offerableOf(name.offer) : 'deep-research',
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
      return {
        id: project.id,
        name: project.name,
        sittings: sittings.length,
        lastSittingAt: latest?.startedAt ?? null,
        phase: latest?.phase ?? null,
      }
    }),
  )

  /**
   * Has Propositum noticed work nobody told it about?
   *
   * Rendered only when no session is running, because during one the timeline
   * already shows what is being seen — an offer to start something that has
   * started would be nonsense.
   */
  const ambient = ambientStore()
  const nowMs = Date.now()
  const detected = live ? null : detectWork(ambient.since(nowMs), nowMs)
  const named = detected ? ambient.nameFor(signatureOf(detected.terms)) : null
  const offer =
    detected && !ambient.isSnoozed(detected.origins[0] ?? '', nowMs)
      ? describeWork(detected, signatureOf(detected.terms), named)
      : null

  const subject = detected ? subjectOf(detected, named) : ''

  // Only asked when there is something to ask about, so the ordinary quiet
  // screen does not walk every project for nothing.
  let backOn: CarriedProject | null = null
  if (offer !== null && offer.kind === 'start-session') {
    const candidate = await carryOnCandidate(subject)
    if (candidate.ok) backOn = candidate.value
  }

  async function carryOn() {
    'use server'

    await accept(false)
  }

  async function asNewWork() {
    'use server'

    await accept(true)
  }

  async function notNow(formData: FormData) {
    'use server'

    await declineOffer(String(formData.get('origin') ?? ''))
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

      {offer === null || offer.kind !== 'start-session' ? null : (
        <Section title="Propositum noticed" tone="attention" index={2}>
          {/* The named sentence only when the model was sure. A confident wrong
              name reads as Propositum knowing something it does not; the
              deterministic sentence is vaguer and always true. */}
          <p className="hm-lede">
            {named?.confident ? `Looks like you are working on ${named.subject}.` : offer.sentence}
          </p>
          <p className="hm-note">{offer.because}</p>
          <p className="hm-note">
            Nothing has been recorded. What Propositum saw is held in memory for half an hour and
            thrown away unless you say yes &mdash; and it never included the words on the page.
          </p>

          {backOn === null ? (
            <div className="hm-acts">
              <form action={carryOn}>
                <button className="hm-submit hm-submit-primary" type="submit">
                  {named?.confident ? named.offerLabel : 'Set this up for me'}
                </button>
              </form>
              <form action={notNow}>
                <input type="hidden" name="origin" value={offer.origin} />
                <button className="hm-submit" type="submit">
                  Not now
                </button>
              </form>
            </div>
          ) : (
            <>
              {/* Filing is a decision Propositum made, so it is stated before it
                  is acted on — and the way out of it is beside it, not buried
                  on the screen you land on afterwards. */}
              <div className="hm-back-on">
                <p className="hm-note" style={{ marginTop: 0 }}>
                  Looks like you are back on
                </p>
                <p className="hm-back-on-name">{backOn.name}</p>
                <p className="hm-back-on-meta">
                  {backOn.sittings} {backOn.sittings === 1 ? 'sitting' : 'sittings'} &middot;{' '}
                  {backOn.sources} {backOn.sources === 1 ? 'source' : 'sources'} &middot;{' '}
                  {backOn.documents} {backOn.documents === 1 ? 'document' : 'documents'} &middot;{' '}
                  {backOn.overlap} {backOn.overlap === 1 ? 'word' : 'words'} in common
                </p>
              </div>

              <div className="hm-acts">
                <form action={carryOn}>
                  <button className="hm-submit hm-submit-primary" type="submit">
                    Carry on with it
                  </button>
                </form>
                <form action={asNewWork}>
                  <button className="hm-submit" type="submit">
                    No &mdash; this is new work
                  </button>
                </form>
                <form action={notNow}>
                  <input type="hidden" name="origin" value={offer.origin} />
                  <button className="hm-submit" type="submit">
                    Not now
                  </button>
                </form>
              </div>
            </>
          )}
        </Section>
      )}

      <Section title="What Propositum has picked out" index={offer ? 3 : 2}>
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
                </p>
              </div>
              <span className="hm-meta" data-live={running?.projectId === work.id ? 'true' : 'false'}>
                {running?.projectId === work.id
                  ? running.away
                    ? 'working while you are away'
                    : 'watching now'
                  : work.phase === 'ended' || work.phase === null
                    ? 'idle'
                    : 'open, not being watched'}
              </span>
            </div>
          ))
        )}
      </Section>

      <Section title="How this works" index={offer ? 4 : 3}>
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
