/**
 * The front door.
 *
 * Projects, and — above them, breaking the column — whether a session is
 * running right now. That ordering is deliberate: a running session is the only
 * state in which Propositum is doing anything at all, and burying it under a
 * list is the same mistake re-entry finding 1 caught in the shift report.
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
 * ── Why the form is a plain server action ────────────────────────────────
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
import { acceptOffer, createProject, declineOffer } from '@/server/actions'
import { ambientStore, captureStore } from '@/server/capture-store'
import { describeWork, hostOf } from '@/server/ambient-store'
import { detectWork } from '@/domain/detection/detect'

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
.hm-meta { font-size: 0.8125rem; color: var(--faint); font-family: var(--mono); }

.hm-form { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px dashed var(--rule); }
.hm-field { display: grid; gap: 0.35rem; flex: 1 1 18rem; }
.hm-label { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.hm-input { font: inherit; font-size: 0.9375rem; padding: 0.45rem 0.65rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; width: 100%; }
.hm-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.hm-hint { margin: 0.5rem 0 0; font-size: 0.8125rem; color: var(--faint); flex-basis: 100%; }

.hm-submit { font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.45rem 0.9rem; border: 1px solid var(--accent); background: var(--accent); color: var(--ground); border-radius: 3px; cursor: pointer; }
.hm-submit:hover { filter: brightness(1.07); }
.hm-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.hm-go { display: inline-block; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--accent); background: var(--accent); color: var(--ground); border-radius: 3px; text-decoration: none; }
.hm-go:hover { filter: brightness(1.07); text-decoration: none; }
.hm-go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.hm-live { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
.hm-live p { margin: 0; max-width: 34rem; font-family: var(--serif); font-size: 1.125rem; line-height: 1.5; }

.hm-problem { margin: 0 0 2.25rem; padding: 0.75rem 1rem; border-left: 2px solid var(--attention); background: var(--raised); color: var(--attention); font-size: 0.9375rem; }

.hm-prose { margin: 0; color: var(--muted); max-width: 38rem; }
.hm-aside { display: flex; align-items: center; gap: 0.5rem; margin: 0.85rem 0 0; color: var(--faint); max-width: 38rem; font-size: 0.875rem; }
`

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

function clock(at: Date): string {
  return CLOCK.format(at).replace(/AM$/, 'am').replace(/PM$/, 'pm')
}

interface RunningSession {
  readonly projectId: string
  readonly projectName: string
  readonly startedAt: Date
  /** `away` means an agreement is live and Propositum holds the work. */
  readonly away: boolean
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
  const suggestion =
    detected && !ambient.isSnoozed(detected.origin, nowMs) ? describeWork(detected) : null

  async function acceptSuggestion(formData: FormData) {
    'use server'

    const result = await acceptOffer(
      String(formData.get('projectId') ?? ''),
      String(formData.get('origin') ?? ''),
      String(formData.get('label') ?? ''),
    )
    if (!result.ok) redirect(`/?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(`/projects/${result.value.projectId}`)
  }

  async function dismissSuggestion(formData: FormData) {
    'use server'

    await declineOffer(String(formData.get('origin') ?? ''))
    redirect('/')
  }

  async function create(formData: FormData) {
    'use server'

    const result = await createProject(String(formData.get('name') ?? ''))
    if (!result.ok) redirect(`/?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(`/projects/${result.value.id}`)
  }

  return (
    <Sheet>
      <style href="propositum-home" precedence="default">
        {CSS}
      </style>

      <Masthead
        kicker="Propositum"
        title="Your projects"
        subtitle="Propositum watches only the sites you approve, and only between the moment you start a session and the moment you end it."
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

      {suggestion === null || suggestion.kind !== 'start-session' ? null : (
        <Section title="Propositum noticed" tone="attention" index={2}>
          <p className="hm-lede">{suggestion.sentence}</p>
          <p className="hm-under">{suggestion.because}</p>
          <p className="hm-under">
            Nothing has been recorded. What Propositum saw is held in memory for half an hour
            and thrown away unless you say yes — and it never included the words on the page.
          </p>

          {projects.length === 0 ? (
            <p className="hm-under">
              Make a project below first, then this will offer to start a session in it.
            </p>
          ) : (
            <form className="hm-form" action={acceptSuggestion}>
              <input type="hidden" name="origin" value={suggestion.origin} />
              <input type="hidden" name="label" value={hostOf(suggestion.origin)} />
              <label className="hm-field">
                <span className="hm-label">Work on this in</span>
                <select className="hm-input" name="projectId" defaultValue={projects[0]?.id}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="hm-submit" type="submit">
                Start a session here
              </button>
            </form>
          )}

          <form action={dismissSuggestion}>
            <input type="hidden" name="origin" value={suggestion.origin} />
            <button className="hm-submit" type="submit">
              Not now
            </button>
          </form>
        </Section>
      )}

      <Section title="Projects" index={suggestion ? 3 : 2}>
        {projects.length === 0 ? (
          <Empty
            title="No projects yet."
            next="Make one for the piece of work you want Propositum to watch. A project holds the sites it may see, the sessions you start, and the document you are writing."
          />
        ) : (
          projects.map((project) => (
            <div className="hm-row" key={project.id}>
              <Link className="hm-name" href={`/projects/${project.id}`}>
                {project.name}
              </Link>
              <span className="hm-meta">
                {running?.projectId === project.id ? 'session running' : 'open'}
              </span>
            </div>
          ))
        )}

        <form className="hm-form" action={create}>
          <label className="hm-field">
            <span className="hm-label">New project</span>
            <input
              className="hm-input"
              name="name"
              type="text"
              required
              maxLength={120}
              autoComplete="off"
              placeholder="Northwind partnership"
            />
          </label>
          <button className="hm-submit" type="submit">
            Create project
          </button>
          {/* A project is a name and nothing else. There is deliberately no
              description field: a description Propositum reads is a goal in
              disguise, and it would pre-answer the one question the session is
              supposed to answer. */}
          <p className="hm-hint">
            Just a name. What you are working on is something Propositum works out from the session,
            not something you declare up front.
          </p>
        </form>
      </Section>

      <Section title="How this works" index={suggestion ? 4 : 3}>
        <p className="hm-prose">
          Approve the sites Propositum may see. Start a session when you sit down at the work. When
          you need to step away, hand it over inside a working agreement you write and accept
          &mdash; and when you come back, read what changed and decide.
        </p>
        <p className="hm-aside">
          <Handover size={14} title="Handed over" /> Nothing is recorded before you start a session,
          and only you can end one.
        </p>
      </Section>
    </Sheet>
  )
}
