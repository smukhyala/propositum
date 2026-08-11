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
 * ── What this deliberately does NOT do ───────────────────────────────────
 *
 * It does not start a run. It sets the work up and stops at the agreement,
 * where the objective is filled in from what they were doing and nothing
 * happens until they ratify it. Removing setup friction is not the same as
 * removing consent.
 */

import { redirect } from 'next/navigation'

import { Sheet, Masthead, Section, Button } from '@/ui/primitives'
import { startFromSuggestion } from '@/server/actions'

export const dynamic = 'force-dynamic'

const CSS = `
.st-lede { font-family: var(--serif); font-size: 1.25rem; line-height: 1.45; margin: 0 0 0.75rem; max-width: 34rem; text-wrap: pretty; }
.st-under { margin: 0 0 1.5rem; color: var(--muted); font-size: 0.9375rem; max-width: 38rem; }
.st-list { list-style: none; margin: 0 0 1.75rem; padding: 0; }
.st-list li { padding: 0.4rem 0; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; }
.st-list li:last-child { border-bottom: none; }
.st-site { font-family: var(--mono); font-size: 0.8125rem; color: var(--muted); }
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
  const problem = one(params['problem'])

  async function go() {
    'use server'

    const result = await startFromSuggestion(subject, origins, intent)
    if (!result.ok) {
      const back = new URLSearchParams({
        subject,
        origins: origins.join(','),
        intent,
        problem: result.problem.message,
      })
      redirect(`/start?${back.toString()}`)
    }
    // The session screen is where the reading and the agreement live.
    redirect(`/sessions/${result.value.sessionId}`)
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

        <p className="st-under">
          <strong>Nothing runs yet.</strong> You will land on the working agreement with the
          objective filled in, and Propositum does nothing at all until you accept it.
        </p>

        <form action={go}>
          <Button variant="primary" type="submit">
            Set it up
          </Button>
        </form>
      </Section>
    </Sheet>
  )
}
