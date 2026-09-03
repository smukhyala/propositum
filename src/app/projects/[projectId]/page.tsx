/**
 * One project: what Propositum can see, the session boundary, and the timeline.
 *
 * ── Nobody made this project, so this is where it gets corrected ─────────
 *
 * A person never types a project into existence any more. Propositum notices a
 * subject, names it, and files the sitting under it — which means every name on
 * this screen is a guess, and two of the guesses can be wrong in ways only the
 * person can see. The name can be off. The filing can be off: a thread that
 * shared two words with something from last week is not necessarily last week's
 * work.
 *
 * So both corrections live here, plainly, and neither of them is buried behind
 * a settings screen. Automatic filing is only defensible if it is correctable,
 * and a correction nobody can find is not one. The wording says what Propositum
 * did rather than asking the person to configure anything — "Propositum called
 * this", not "Project name".
 *
 * ── The session boundary is the loudest thing on the page ────────────────
 *
 * Start and End are the two acts the whole product rests on. Before Start,
 * nothing is recorded; after End, nothing is recorded; only a human act does
 * either. So the control breaks the column — it is the one `attention` band on
 * this screen, and everything else is an ordinary section — and the wording
 * says what the act means rather than labelling a button.
 *
 * ── When the row and the reality disagree, say so ────────────────────────
 *
 * `WorkSession.phase = observing` means a person started a session and no
 * person ended it. The live capture token, though, lives in memory in this
 * process. Restart the app and you have an open session row that nothing is
 * feeding — the extension is holding a token this process has never heard of,
 * and every event it posts is refused.
 *
 * That state is real, it is reachable by pressing Save in an editor, and there
 * is no honest way to render it as "Propositum is watching". So the band says
 * the awkward thing out loud, and the timeline is told it is not live.
 *
 * ── Forms, not client state ──────────────────────────────────────────────
 *
 * Every control here is a form posting to a server action. Failures come back
 * as a sentence in the URL, which survives a reload; the alternative is a
 * client component holding a banner in `useState` that a refresh silently eats.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { BackLink, Button, Disclosure, Empty, Masthead, Section, Sheet } from '@/ui/primitives'
import { Away, Handover, Watching } from '@/ui/sprites'
import { Timeline } from '@/ui/timeline'
import type { TimelineEvent } from '@/ui/timeline'
import {
  approveSource,
  bringInPage,
  createDocument,
  endSession,
  refileSession,
  renameProject,
  saveDocument,
  splitIntoNewProject,
  startSession,
} from '@/server/actions'
import { captureStore } from '@/server/capture-store'
import { frontDoorRow, statusWordFor } from '@/server/front-door'
import { whereYouLeftOffIn } from '@/server/work-so-far'
import { WhereYouLeftOff } from '@/ui/work-so-far'
import { DocumentDraft, DocumentWorkbench } from '@/ui/document'
import { appContext } from '@/server/db'

// In-memory capture state and a local database file. Nothing here is cacheable,
// and a cached "Propositum is watching" would be a lie about our own software.
export const dynamic = 'force-dynamic'

const CSS = `
.pj-problem { margin: 0 0 2.25rem; padding: 0.75rem 1rem; border-left: 2px solid var(--attention); background: var(--raised); color: var(--attention); font-size: 0.9375rem; }

.pj-session { display: flex; flex-wrap: wrap; gap: 1.25rem; align-items: center; justify-content: space-between; }
.pj-lede { font-family: var(--serif); font-size: 1.1875rem; line-height: 1.45; margin: 0; max-width: 36rem; text-wrap: pretty; }
.pj-under { margin: 0.6rem 0 0; font-size: 0.875rem; color: var(--muted); max-width: 36rem; }
.pj-acts { display: flex; gap: 0.5rem; flex-wrap: wrap; }

.pj-row { display: grid; grid-template-columns: 1fr auto; gap: 0.4rem 1.5rem; align-items: baseline; padding: 0.8rem 0; border-bottom: 1px solid var(--rule); }
.pj-row:last-of-type { border-bottom: none; }
.pj-name { margin: 0; }
.pj-origin { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); margin: 0.2rem 0 0; word-break: break-all; }
.pj-state { font-size: 0.75rem; color: var(--faint); white-space: nowrap; }
.pj-state[data-revoked="true"] { color: var(--attention); }
.pj-revoked { margin: 0.35rem 0 0; font-size: 0.8125rem; color: var(--attention); }

.pj-form { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-end; margin-top: 1.75rem; padding-top: 1.5rem; border-top: 1px dashed var(--rule); }
.pj-field { display: grid; gap: 0.35rem; flex: 1 1 15rem; }
.pj-label { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.pj-input { font: inherit; font-size: 0.9375rem; padding: 0.45rem 0.65rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; width: 100%; }
.pj-input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.pj-field-wide { flex: 1 1 100%; }
.pj-submit { font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.45rem 0.9rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; cursor: pointer; }
.pj-submit:hover { border-color: var(--accent); }
.pj-submit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pj-hint { flex-basis: 100%; margin: 0.6rem 0 0; font-size: 0.8125rem; color: var(--faint); max-width: 42rem; }
.pj-hint code { font-family: var(--mono); font-size: 0.9em; color: var(--muted); word-break: break-all; }

/* Anchors that carry a control's weight. They navigate, so they stay <a>: a
   button that goes somewhere breaks the back button and the keyboard. */
.pj-go, .pj-quiet { display: inline-block; font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border-radius: 3px; text-decoration: none; }
.pj-go { border: 1px solid var(--accent); background: var(--accent); color: var(--ground); }
.pj-go:hover { filter: brightness(1.07); }
.pj-quiet { border: 1px solid var(--rule); background: var(--ground); color: var(--ink); }
.pj-quiet:hover { border-color: var(--accent); }
.pj-go:focus-visible, .pj-quiet:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.pj-earlier { list-style: none; margin: 0.9rem 0 0; padding: 0; }
.pj-earlier li { padding: 0.5rem 0; border-bottom: 1px solid var(--rule); }
.pj-earlier li:last-child { border-bottom: none; }
.pj-earlier a { font-family: var(--mono); font-size: 0.8125rem; color: var(--muted); text-decoration: none; }
.pj-earlier a:hover { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
.pj-earlier a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
`

const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long' })

function clock(at: Date): string {
  return CLOCK.format(at).replace(/AM$/, 'am').replace(/PM$/, 'pm')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { projectId } = await params
  const query = await searchParams
  const rawProblem = query['problem']
  const problem = typeof rawProblem === 'string' ? rawProblem : null

  const { repos } = await appContext()

  const project = await repos.projects.byId(projectId)
  if (!project) notFound()

  const sources = await repos.projects.approvedSources(projectId)
  const granted = sources.filter((source) => source.grantState === 'granted')

  // One document per project in slice 0, so `[0]` is the document rather than a
  // choice nobody made. `createDocument` refuses a second one.
  const documents = await repos.documents.forProject(projectId)
  const document = documents[0] ?? null
  const base = document ? await repos.documents.latestVersion(document.id) : null

  const sessions = await repos.sessions.forProject(projectId)
  const openSession = sessions.find((session) => session.phase !== 'ended') ?? null
  const shownSession = openSession ?? sessions[0] ?? null
  const earlier = sessions.filter((session) => session.id !== shownSession?.id)

  // Somewhere else this sitting could belong. Only ever a correction: the list
  // exists so a sitting Propositum filed wrongly can be moved, never so that
  // starting work begins with choosing where to put it.
  const elsewhere = (await repos.projects.list()).filter((other) => other.id !== projectId)

  // The two questions that look like one and are not: is a session open, and is
  // anything actually being captured into it.
  const liveCapture = captureStore().current()
  const watching =
    openSession !== null &&
    openSession.phase === 'observing' &&
    liveCapture !== null &&
    liveCapture.sessionId === openSession.id

  const events = shownSession ? await repos.events.bySession(shownSession.id) : []
  const labelById = new Map(sources.map((source) => [source.id, source.label]))

  // The way back to "While you were away". Without this the shift report is
  // reachable only by typing a contract id into the URL bar, which is not a
  // route — and re-entry is the half of the product a person arrives at cold.
  const shift = shownSession ? await repos.contracts.acceptedForSession(shownSession.id) : null

  const rows: TimelineEvent[] = events.map((event) => {
    const untrusted = asRecord(event.untrusted)
    const stored = untrusted['text']

    return {
      id: event.id,
      kind: event.kind,
      observedAtIso: event.observedAt.toISOString(),
      attested: asRecord(event.attested),
      untrustedText: typeof stored === 'string' && stored.trim().length > 0 ? stored : null,
      adversarial: untrusted['adversarial'] === true,
      sourceLabel:
        event.approvedSourceId === null ? null : (labelById.get(event.approvedSourceId) ?? null),
    }
  })

  /* ── the acts ───────────────────────────────────────────────────────── */

  const here = `/projects/${projectId}`

  async function addSource(formData: FormData) {
    'use server'

    const result = await approveSource(
      projectId,
      String(formData.get('origin') ?? ''),
      String(formData.get('label') ?? ''),
    )
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(here)
  }

  async function pasteDocument(formData: FormData) {
    'use server'

    const result = await createDocument(
      projectId,
      String(formData.get('title') ?? ''),
      String(formData.get('content') ?? ''),
    )
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(here)
  }

  /**
   * A page from a source this project already approved — ADR-0032.
   *
   * The only server action on this screen that RETURNS rather than redirects,
   * and the reason is what it is for: the text has to land in the box the
   * person is looking at, unsaved, so they read it before Propositum stores
   * anything. A redirect would mean it had been stored, which is the thing the
   * ADR refuses.
   *
   * The project id is bound here and is never a parameter the client sends.
   * Which sources are approved is a fact about this project, and a screen that
   * could name a different one would be a screen that could borrow somebody
   * else's allowlist.
   */
  async function bringIn(address: string) {
    'use server'

    return bringInPage(projectId, address)
  }

  async function editDocument(formData: FormData) {
    'use server'

    const result = await saveDocument(
      String(formData.get('documentId') ?? ''),
      String(formData.get('content') ?? ''),
    )
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(here)
  }

  async function rename(formData: FormData) {
    'use server'

    const result = await renameProject(projectId, String(formData.get('name') ?? ''))

    // The field is prefilled with the current name, so pressing Save without
    // editing is the likeliest thing anyone does with it. Showing a red banner
    // for that would be Propositum complaining about a no-op it invited.
    if (!result.ok && result.problem.code !== 'already-done') {
      redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    }
    redirect(here)
  }

  /**
   * "No — this is new work."
   *
   * The undo for a filing decision Propositum made on its own. It lands on the
   * new project rather than staying here, because the sitting has gone with it
   * and a screen that stayed put would be showing the place the work is no
   * longer.
   */
  async function splitOut(formData: FormData) {
    'use server'

    const result = await splitIntoNewProject(
      String(formData.get('sessionId') ?? ''),
      String(formData.get('name') ?? ''),
    )
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(`/projects/${result.value.projectId}`)
  }

  async function moveElsewhere(formData: FormData) {
    'use server'

    const result = await refileSession(
      String(formData.get('sessionId') ?? ''),
      String(formData.get('projectId') ?? ''),
    )
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(`/projects/${result.value.projectId}`)
  }

  async function begin() {
    'use server'

    const result = await startSession(projectId)
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(here)
  }

  async function finish(formData: FormData) {
    'use server'

    const result = await endSession(String(formData.get('sessionId') ?? ''))
    if (!result.ok) redirect(`${here}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(here)
  }

  /* ── what the band says ─────────────────────────────────────────────── */

  const away = openSession?.phase === 'away'
  const stranded = openSession !== null && openSession.phase === 'observing' && !watching

  /**
   * Where this work is, in the words CONTEXT.md gives it.
   *
   * The same derivation Home uses, from the same function, because a second one
   * is how two screens come to disagree about a single Intention — the argument
   * `front-door.ts` opens with. Home filters its rows to `needs-you` and prints
   * one word; this screen prints whichever of the five is true, which is why
   * `statusWordFor` had no caller between the bare-Home rewrite and now.
   *
   * `frontDoorRow` takes the live session id, and `phasesWeCanVouchFor` counts
   * only a sitting the capture store is actually feeding. So the `stranded`
   * case above — an open row nothing is reaching — contributes no phase and
   * lands on *Sleeping* rather than claiming *Working*. The honesty rule this
   * screen already holds is not restated here; it is inherited.
   *
   * `sleeping` will be the common answer, and CONTEXT.md says it will read like
   * a bug. It is not dressed up.
   */
  const lifecycle = frontDoorRow({
    facts: await repos.intentions.factsForProject(projectId),
    sittings: sessions,
    liveSessionId: liveCapture?.sessionId ?? null,
    nowEpochMs: Date.now(),
  })

  /**
   * What has already happened under this project's Intention — ADR-0017.
   *
   * The same derivation the accept screen reads, from the same function, for the
   * reason `front-door.ts` opens with: two screens each assembling one paragraph
   * is two accounts of one season of work, and they would disagree the first
   * time either changed. Null when nobody has stated an Intention here, which is
   * every project created before ADR-0011 and every degraded acceptance since —
   * the box is absent rather than empty.
   *
   * It informs nothing on this page. `compilePolicy` cannot receive it, the gate
   * never sees it, and no prompt is built from it: it is read after every
   * decision this screen makes and is rendered.
   */
  const leftOff = await whereYouLeftOffIn(projectId, Date.now())

  const bandTitle =
    openSession === null
      ? 'Start a session'
      : away
        ? 'Propositum is working while you are away'
        : stranded
          ? 'This session is open, but nothing is being recorded'
          : 'This session'

  return (
    <Sheet>
      <style href="propositum-project" precedence="default">
        {CSS}
      </style>

      <BackLink href="/">&larr; All projects</BackLink>

      <Masthead
        kicker={`Project · ${statusWordFor(lifecycle.state)}`}
        title={project.name}
        mark={watching ? <Watching size={20} delay={0.3} /> : <Away size={20} delay={0.3} />}
        subtitle={
          openSession
            ? `Session started ${clock(openSession.startedAt)} on ${DAY.format(openSession.startedAt)} · ${granted.length} approved ${granted.length === 1 ? 'source' : 'sources'}`
            : `${granted.length} approved ${granted.length === 1 ? 'source' : 'sources'} · nothing is being recorded`
        }
      />

      {problem ? (
        <p className="pj-problem" role="status">
          {problem}
        </p>
      ) : null}

      {/* The one thing on this screen that breaks the column. */}
      <Section title={bandTitle} tone="attention" index={1}>
        <div className="pj-session">
          <div>
            {openSession === null ? (
              <>
                <p className="pj-lede">
                  Propositum records nothing until you start a session, and only you can end one.
                </p>
                <p className="pj-under">
                  {granted.length === 0
                    ? 'You have not approved anything yet, so it will see nothing until you do. You can approve sources while a session is running.'
                    : `While it runs, Propositum sees what you do on your ${granted.length} approved ${granted.length === 1 ? 'source' : 'sources'} and nothing else.`}
                </p>
              </>
            ) : away ? (
              <>
                <p className="pj-lede">
                  Propositum is working on this under the agreement you accepted.
                </p>
                <p className="pj-under">
                  It is not watching your screen &mdash; capture is off for the whole time it holds
                  the work, which is what makes &ldquo;while you were away&rdquo; a straight answer.
                </p>
              </>
            ) : stranded ? (
              <>
                <p className="pj-lede">
                  This session is still open, but Propositum stopped watching when the app
                  restarted.
                </p>
                <p className="pj-under">
                  Nothing new is reaching the timeline, and anything the extension has tried to send
                  since then was turned away. End this session and start another to pick capture
                  back up.
                </p>
              </>
            ) : (
              <>
                <p className="pj-lede">
                  Propositum is watching your {granted.length} approved{' '}
                  {granted.length === 1 ? 'source' : 'sources'}.
                </p>
                <p className="pj-under">
                  It stops the moment you end the session, and not before. Ending is a human act; no
                  timer and no setting does it for you.
                </p>
              </>
            )}
          </div>

          <div className="pj-acts">
            {openSession === null ? (
              <form action={begin}>
                <Button type="submit" variant="primary">
                  Start session
                </Button>
              </form>
            ) : away ? (
              <>
                {/* The only way back to the note, and the reason the person
                    opened the app at all. It leads, even while the run is
                    still going — the report says so itself in that case. */}
                {shift ? (
                  <Link className="pj-go" href={`/shifts/${shift.id}`}>
                    While you were away
                  </Link>
                ) : null}
                <Button type="button" disabled>
                  End session
                </Button>
                {/* The reason this control is inert, on the page rather than in
                    a `title`. It is the one tooltip on this screen that said
                    something nothing else said, so it is the one that had to
                    become text instead of being deleted: a control that is
                    merely grey tells the person it is broken rather than that
                    it is waiting. */}
                <p className="pj-hint">
                  Propositum is working under the agreement you accepted. Read what it did to take
                  the work back.
                </p>
              </>
            ) : (
              <>
                {/* Where handing over begins: read what Propositum understood,
                    then settle the agreement. Not shown while the session is
                    stranded — nothing has been reaching the timeline, so there
                    is nothing honest for it to have read. */}
                {stranded ? null : (
                  <Link className="pj-go" href={`/sessions/${openSession.id}`}>
                    Hand this over
                  </Link>
                )}
                <form action={finish}>
                  <input type="hidden" name="sessionId" value={openSession.id} />
                  <Button type="submit" variant={stranded ? 'primary' : 'default'}>
                    End session
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      </Section>

      <Section title="What Propositum called this" index={2}>
        {/* Before the name and the corrections, because a person deciding
            whether this filing is right is helped more by what was decided here
            than by how many sittings there were. The counts stay in the
            sentence below; this is the half that was missing. */}
        <WhereYouLeftOff view={leftOff?.view ?? null} />

        <p className="pj-under" style={{ marginTop: 0 }}>
          {sessions.length > 1
            ? `Propositum named this from what you were reading, and has filed ${sessions.length} sittings under it. Change either if it got them wrong.`
            : 'Propositum named this from what you were reading. You did not have to make it, and you can change what it is called.'}
        </p>

        {/*
          Three corrections behind one disclosure.

          Renaming, splitting a sitting out, and refiling it elsewhere are three
          answers to the same question — "this got filed wrong" — and the screen
          asked it three times, in three forms, with two text inputs and a
          select, to a person who had not said anything was wrong. The default
          case is that the filing is right, and this section now reads as that
          case with a way out of it rather than as an interrogation.

          `WhereYouLeftOff` and the sentence under it stay OUTSIDE this. What
          was decided in earlier sittings is the thing a person is here to see,
          and ADR-0017 is explicit that it renders "before anybody clicks
          anything" — folding it would be the quietness the ADR exists to
          refuse. Only the corrections fold.
        */}
        <Disclosure summary="Filed wrong? Rename it, or move this sitting">
          <form className="pj-form" action={rename}>
            <label className="pj-field">
              <span className="pj-label">Call it</span>
              <input
                className="pj-input"
                name="name"
                type="text"
                required
                maxLength={120}
                autoComplete="off"
                defaultValue={project.name}
              />
            </label>
            <button className="pj-submit" type="submit">
              Save the name
            </button>
          </form>

          {/* The way out of a filing decision nobody made deliberately. Shown
            only when there is something to leave: a project holding one sitting
            already belongs to it alone, and offering to split it would be
            offering to do nothing. */}
          {shownSession !== null && sessions.length > 1 ? (
            <form className="pj-form" action={splitOut}>
              <input type="hidden" name="sessionId" value={shownSession.id} />
              <label className="pj-field">
                <span className="pj-label">This sitting is about something else</span>
                <input
                  className="pj-input"
                  name="name"
                  type="text"
                  required
                  maxLength={120}
                  autoComplete="off"
                  placeholder="What it is actually about"
                />
              </label>
              <button className="pj-submit" type="submit">
                No &mdash; this is new work
              </button>
              <p className="pj-hint">
                The sitting on {DAY.format(shownSession.startedAt)} moves out on its own. The sites
                it was recorded against are approved there too, so Propositum can still see them,
                and they stay approved here. Nothing already in its timeline changes, and this
                project keeps its document.
              </p>
            </form>
          ) : null}

          {shownSession !== null && elsewhere.length > 0 ? (
            <form className="pj-form" action={moveElsewhere}>
              <input type="hidden" name="sessionId" value={shownSession.id} />
              <label className="pj-field">
                <span className="pj-label">Or it belongs with</span>
                <select className="pj-input" name="projectId" defaultValue={elsewhere[0]?.id}>
                  {elsewhere.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="pj-submit" type="submit">
                Carry on with that
              </button>
            </form>
          ) : null}
        </Disclosure>
      </Section>

      <Section title="What Propositum can see" index={3}>
        {sources.length === 0 ? (
          <Empty
            title="Propositum cannot see anything in this project."
            next="Add a site below. It is the only thing Propositum will ever be allowed to look at here, and you can withdraw it in Chrome at any time."
          />
        ) : (
          sources.map((source) => {
            const revoked = source.grantState !== 'granted'

            return (
              <div className="pj-row" key={source.id}>
                <div>
                  <p className="pj-name">{source.label}</p>
                  <p className="pj-origin">{source.originPattern}</p>
                  {revoked ? (
                    <p className="pj-revoked">
                      Access was withdrawn in Chrome. Propositum cannot see this any more, and it
                      will not ask again unless you add it back.
                    </p>
                  ) : null}
                </div>
                <span className="pj-state" data-revoked={revoked ? 'true' : 'false'}>
                  {revoked ? 'withdrawn' : 'approved'}
                </span>
              </div>
            )
          })
        )}

        <form className="pj-form" action={addSource}>
          <label className="pj-field">
            <span className="pj-label">Site</span>
            <input
              className="pj-input"
              name="origin"
              type="text"
              required
              autoComplete="off"
              placeholder="northwind.example.com"
            />
          </label>
          <label className="pj-field">
            <span className="pj-label">What to call it</span>
            <input
              className="pj-input"
              name="label"
              type="text"
              autoComplete="off"
              placeholder="Northwind partners"
            />
          </label>
          <button className="pj-submit" type="submit">
            Approve
          </button>
          <p className="pj-hint">
            {/* The trailing star is an entity rather than the two characters,
                and that is not fussiness. `/` followed by `*` in JSX text opens
                a block comment as far as every comment stripper in this
                repository is concerned, and `tests/reachability.test.ts` reads
                this file through one — it lost the twenty-five lines after this
                one, including a whole component render, and every reachability
                check over them silently passed. Rendered output is unchanged. */}
            Stored as an origin like <code>https://northwind.example.com/&#42;</code> &mdash; the whole
            site, every page on it, and nothing off it. Approving a site grants access, not trust:
            what a page says is evidence about what you read, never an instruction to Propositum.
          </p>
        </form>
      </Section>

      <Section title="Your document" index={4}>
        {document === null ? (
          <>
            <Empty
              title="There is no document in this project."
              next="Paste in what you are working on, or open a Markdown or text file. Propositum works on your words — it never starts from a blank page, and it never reads a file you did not hand it."
            />
            <DocumentDraft action={pasteDocument} bringIn={bringIn} />
          </>
        ) : (
          <>
            <div className="pj-row">
              <div>
                <p className="pj-name">{document.title}</p>
                {/* The version and the word count moved onto the editor
                    itself on 2026-08-26, because only the editor can say
                    whether the words on screen are the saved ones. Two lines
                    both naming a version, one of which could not tell, is the
                    pair that drifts. */}
                <p className="pj-origin">
                  {base === null ? 'No text saved yet.' : 'Yours, and never locked.'}
                </p>
              </div>
              <span className="pj-state" data-revoked="false">
                {base === null ? 'empty' : 'yours'}
              </span>
            </div>

            {/* Keyed on the version so a save remounts it. Without the key the
                box would keep the words that were in it before the redirect,
                and the "changes you have not saved" line would go on saying so
                about a version that is now the saved one. */}
            <DocumentWorkbench
              key={base?.id ?? 'empty'}
              documentId={document.id}
              title={document.title}
              saved={base?.content ?? ''}
              ordinal={base?.ordinal ?? 0}
              action={editDocument}
              bringIn={bringIn}
            />
          </>
        )}
      </Section>

      <Section title={openSession ? 'Session timeline' : 'The last session'} index={5}>
        {shownSession === null ? (
          <Empty
            title="No session has been started in this project."
            next="Start one above when you sit down at the work. Everything you do on an approved source lands here, in order, as plain sentences."
          />
        ) : (
          <>
            <Timeline events={rows} live={watching} approvedSourceCount={granted.length} />

            {/* The foot of the timeline is where a person stops reading, so it
                is where the two screens that follow from it belong. For an
                ended session this is the ONLY route to either — the band
                above has no controls once nothing is open. */}
            <div className="pj-acts" style={{ marginTop: '1.5rem' }}>
              <Link className="pj-quiet" href={`/sessions/${shownSession.id}`}>
                What Propositum thinks you&rsquo;re working on
              </Link>
              {/* ...but not when the band above is already showing it. While
                  the session is `away` both rendered, so one screen offered the
                  same destination under the same words twice, a few centimetres
                  apart — which reads as two different places until you have
                  been to both. Everywhere else this is still the only route,
                  which is what the note above is about. */}
              {shift && !away ? (
                <Link className="pj-quiet" href={`/shifts/${shift.id}`}>
                  While you were away
                </Link>
              ) : null}
            </div>
          </>
        )}
      </Section>

      {earlier.length > 0 ? (
        <Section title="Before this" index={6}>
          <p className="pj-under" style={{ margin: 0 }}>
            <Handover size={14} title="Earlier" /> {earlier.length} earlier{' '}
            {earlier.length === 1 ? 'session' : 'sessions'} in this project. Each one starts cold:
            what Propositum worked out last time does not carry over.
          </p>
          {/* A count that links nowhere is a count. These are the sessions
              themselves, so an earlier reading can still be opened. */}
          <ul className="pj-earlier">
            {earlier.map((session) => (
              <li key={session.id}>
                <Link href={`/sessions/${session.id}`}>
                  {DAY.format(session.startedAt)} · {clock(session.startedAt)}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Sheet>
  )
}
