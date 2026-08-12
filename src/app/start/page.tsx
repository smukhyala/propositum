/**
 * Saying yes to a suggestion, and landing somewhere that shows what that meant.
 *
 * ── Why this is a page and not a silent action ───────────────────────────
 *
 * The extension could have posted the answer and shown a toast. It does not,
 * because accepting creates a project, approves sources, makes a document and
 * starts a session — four durable things — and a person is entitled to see the
 * four things that happened in their name.
 *
 * ── The list has to be TRUE, which means it depends on the answer ────────
 *
 * This page used to promise "a project called X" and "a document to work in,
 * called X" unconditionally. Once Propositum began recognising work it had seen
 * before, that stopped being reliably true: a subject sharing enough words with
 * an existing project joins it, and then no project is created, no document is
 * created, and the old one is what gets worked on.
 *
 * A screen that lists four things and does two of them is worse than one that
 * lists two, because the person read the list as the reason to click. So the
 * question is asked first — `carryOnCandidate` — and the page says which of the
 * two things is about to happen, with a control for each.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 *
 * It does not start a run. It sets the work up and stops at the agreement,
 * where the objective is filled in from what they were doing and nothing
 * happens until they ratify it. Removing setup friction is not the same as
 * removing consent.
 */

import { redirect } from 'next/navigation'

import { Sheet, Masthead, Section, Button } from '@/ui/primitives'
import { carryOnCandidate, startFromSuggestion } from '@/server/actions'
import type { CarriedProject } from '@/server/actions'

export const dynamic = 'force-dynamic'

const CSS = `
.st-lede { font-family: var(--serif); font-size: 1.25rem; line-height: 1.45; margin: 0 0 0.75rem; max-width: 34rem; text-wrap: pretty; }
.st-under { margin: 0 0 1.5rem; color: var(--muted); font-size: 0.9375rem; max-width: 38rem; }
.st-list { list-style: none; margin: 0 0 1.75rem; padding: 0; }
.st-list li { padding: 0.4rem 0; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; }
.st-list li:last-child { border-bottom: none; }
.st-site { font-family: var(--mono); font-size: 0.8125rem; color: var(--muted); }

/* The carry-on box, in the same register the front door uses for it. */
.st-back-on { margin: 0 0 1.5rem; padding: 0.9rem 0 0.9rem 1.1rem; border-left: 2px solid var(--accent); }
.st-back-on-name { font-family: var(--serif); font-size: 1.0625rem; margin: 0; }
.st-back-on-meta { font-family: var(--mono); font-size: 0.75rem; color: var(--faint); margin: 0.3rem 0 0; }
.st-acts { display: flex; gap: 0.5rem; flex-wrap: wrap; }
`

function one(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : ''
}

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const subject = one(params['subject']).trim()
  const origins = one(params['origins']).split(',').filter((o) => o !== '')
  const intent = one(params['intent']) === 'draft-document' ? 'draft-document' : 'deep-research'
  const thread = one(params['thread'])
  const problem = one(params['problem'])

  /**
   * Would this join something rather than open something?
   *
   * Asked with the same subject the acceptance path will use, so the list below
   * describes what is actually about to happen. `null` is the ordinary answer.
   */
  let backOn: CarriedProject | null = null
  if (subject !== '') {
    const candidate = await carryOnCandidate(subject)
    if (candidate.ok) backOn = candidate.value
  }

  async function go(formData: FormData) {
    'use server'

    // The person may have said this is not the old subject after all. That
    // answer has to reach the acceptance path itself: undoing a merge is cheap,
    // but never making it is cheaper, and the question was already on screen.
    const treatAsNewWork = formData.get('newWork') === '1'

    const result = await startFromSuggestion(subject, origins, intent, thread, treatAsNewWork)
    if (!result.ok) {
      const back = new URLSearchParams({
        subject,
        origins: origins.join(','),
        intent,
        thread,
        problem: result.problem.message,
      })
      redirect(`/start?${back.toString()}`)
    }

    // The session screen is where the reading and the agreement live. It also
    // states the filing decision when there was one, which is why the subject
    // travels with the redirect.
    redirect(
      result.value.joinedExisting
        ? `/sessions/${result.value.sessionId}?filed=${encodeURIComponent(subject)}`
        : `/sessions/${result.value.sessionId}`,
    )
  }

  if (subject === '' || origins.length === 0) {
    return (
      <Sheet>
        <style href="propositum-start" precedence="default">
          {CSS}
        </style>
        <Masthead kicker="Propositum" title="Nothing to start" />
        <Section title="That link has gone stale" index={1}>
          <p className="st-under">
            Propositum could not tell what this was meant to be about. Browse for a while and it
            will offer again.
          </p>
        </Section>
      </Sheet>
    )
  }

  return (
    <Sheet>
      <style href="propositum-start" precedence="default">
        {CSS}
      </style>
      <Masthead kicker="Propositum noticed" title={subject} />

      <Section title="Before Propositum starts" tone="attention" index={1}>
        {problem === '' ? null : <p className="st-under">{problem}</p>}

        <p className="st-lede">
          {intent === 'draft-document'
            ? `Propositum will draft a document about ${subject}.`
            : `Propositum will read up on ${subject} and write down what it finds.`}
        </p>

        {backOn === null ? (
          <>
            <p className="st-under">Saying yes creates all of this, so you do not have to:</p>

            <ul className="st-list">
              <li>
                A project called <strong>{subject}</strong>
              </li>
              <li>
                A document to work in, called <strong>{subject}</strong>
              </li>
              <li>
                {origins.length === 1 ? 'This site, approved' : `${origins.length} sites, approved`}
                {origins.map((origin) => (
                  <div className="st-site" key={origin}>
                    {origin.replace(/^https?:\/\//, '')}
                  </div>
                ))}
              </li>
              <li>A session, with what you have already read carried into it</li>
            </ul>
          </>
        ) : (
          <>
            {/* Filing is a decision Propositum is about to make. It is stated
                before it happens, with the way out beside it — the list above
                would otherwise be promising a project and a document that this
                answer does not create. */}
            <div className="st-back-on">
              <p className="st-under" style={{ margin: 0 }}>
                Looks like you are back on
              </p>
              <p className="st-back-on-name">{backOn.name}</p>
              <p className="st-back-on-meta">
                {backOn.sittings} {backOn.sittings === 1 ? 'sitting' : 'sittings'} &middot;{' '}
                {backOn.sources} {backOn.sources === 1 ? 'source' : 'sources'} &middot;{' '}
                {backOn.documents} {backOn.documents === 1 ? 'document' : 'documents'} &middot;{' '}
                {backOn.overlap} {backOn.overlap === 1 ? 'word' : 'words'} in common
              </p>
            </div>

            <p className="st-under">Saying yes carries on with it, so nothing new is made:</p>

            <ul className="st-list">
              <li>
                This sitting goes under <strong>{backOn.name}</strong>
              </li>
              <li>
                {backOn.documents === 0
                  ? 'A document to work in, since that project has none yet'
                  : 'The document already there is what Propositum works on'}
              </li>
              <li>
                {origins.length === 1 ? 'This site, approved' : `${origins.length} sites, approved`}
                {origins.map((origin) => (
                  <div className="st-site" key={origin}>
                    {origin.replace(/^https?:\/\//, '')}
                  </div>
                ))}
              </li>
              <li>A session, with what you have already read carried into it</li>
            </ul>
          </>
        )}

        <p className="st-under">
          <strong>Nothing runs yet.</strong> You will land on the working agreement with the
          objective filled in, and Propositum does nothing at all until you accept it.
        </p>

        <div className="st-acts">
          <form action={go}>
            <Button variant="primary" type="submit">
              {backOn === null ? 'Set it up' : 'Carry on with it'}
            </Button>
          </form>

          {backOn === null ? null : (
            <form action={go}>
              <input type="hidden" name="newWork" value="1" />
              <Button type="submit">No &mdash; this is new work</Button>
            </form>
          )}
        </div>
      </Section>
    </Sheet>
  )
}
