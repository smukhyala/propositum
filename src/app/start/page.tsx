/**
 * Saying yes to an offer, and landing somewhere that shows what that meant.
 *
 * ── Why this is a page and not a silent action ───────────────────────────
 *
 * The extension could have posted the answer and shown a toast. It does not,
 * because accepting creates a project, approves sources, makes a document and
 * starts a session — four durable things — and a person is entitled to see the
 * four things that happened in their name.
 *
 * ── The URL carries one thing, and it is not a decision ──────────────────
 *
 * `/start?thread=<signature>` and nothing else. No subject, no origins, no
 * intent.
 *
 * That is a security property before it is a tidiness one. This page used to
 * read its list of sites off the query string and hand it to the accept path,
 * so `?origins=https://attacker.example` wrote an `ApprovedSource` for a site
 * nobody had visited and started a session watching it, behind one click, under
 * a heading whose words the same link chose. Wave one closed that by
 * intersecting the requested list against what the ambient buffer actually
 * held. This closes it a second way, structurally: there is no parameter left
 * to intersect. The subject, the grounds, the offer and the sites are all read
 * back off the server-side buffer against the signature, by `offerForThread`.
 *
 * Both guards are kept, deliberately, and `acceptWorkOffer` says why at length:
 * one answers *can a link ask for a site*, the other answers *can anything that
 * reaches the accept path approve a site the buffer does not hold*. They are
 * not the same question and neither answer covers the other.
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
 * question is asked first — `carryOnCandidate`, via `offerForThread` — and the
 * page says which of the two things is about to happen, with a control for each.
 *
 * The same rule is why a withdrawn site is shown greyed out rather than
 * dropped: wave one noted this page listed every requested site as approved,
 * including ones the accept path was about to leave alone.
 *
 * ── It degrades, it never dead-ends ──────────────────────────────────────
 *
 * A composed offer takes about fifteen seconds to arrive, and never arrives at
 * all if there is no `ANTHROPIC_API_KEY`. Before, the extension's link pointed
 * at `?subject=` and rendered "that link has gone stale" for the first half
 * minute of every offer and permanently on a machine with no key. Now the same
 * link works throughout: with an offer this shows the offer, and without one it
 * shows the deterministic sentence and a button that starts watching. Same URL,
 * same button, less to read.
 *
 * ── What this deliberately does NOT do ───────────────────────────────────
 *
 * It does not start a run. It sets the work up and stops at the agreement,
 * where the objective is filled in from what they were doing and nothing
 * happens until they ratify it. Removing setup friction is not the same as
 * removing consent.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { Sheet, Masthead, Section, Button } from '@/ui/primitives'
import { Grounds, OfferBody, OFFER_CSS, SiteChoices } from '@/ui/offer'
import { acceptWorkOffer, offerForThread } from '@/server/actions'
import { captureStore } from '@/server/capture-store'

export const dynamic = 'force-dynamic'

const CSS =
  OFFER_CSS +
  `
.st-under { margin: 0 0 1.5rem; color: var(--muted); font-size: 0.9375rem; max-width: 38rem; }
.st-list { list-style: none; margin: 0 0 1.75rem; padding: 0; }
.st-list li { padding: 0.4rem 0; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; }
.st-list li:last-child { border-bottom: none; }

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

  /**
   * The only two things read off the URL, and neither is a decision.
   *
   * `thread` is a lookup key into a server-side buffer — it can name a thread
   * that exists or one that does not, and naming one that does not gets you the
   * stale-link screen. `problem` is a sentence this page itself wrote on the
   * way round a failed submit.
   *
   * Anything else in the query string is ignored, including `origins`. Not
   * filtered — read by nothing.
   */
  const thread = one(params['thread'])
  const problem = one(params['problem'])

  const found = await offerForThread(thread)
  const screen = found.ok ? found.value : null

  async function go(formData: FormData) {
    'use server'

    // The person may have said this is not the old subject after all. That
    // answer has to reach the acceptance path itself: undoing a merge is cheap,
    // but never making it is cheaper, and the question was already on screen.
    const treatAsNewWork = formData.get('newWork') === '1'

    // The sites still ticked. This can only ever narrow what gets approved —
    // the server intersects it with what the buffer holds, so an entry that was
    // never observed contributes nothing. See `acceptWorkOffer`.
    const ticked = formData.getAll('site').filter((v): v is string => typeof v === 'string')

    const result = await acceptWorkOffer(thread, ticked, treatAsNewWork)
    if (!result.ok) {
      const back = new URLSearchParams({ thread, problem: result.problem.message })
      redirect(`/start?${back.toString()}`)
    }

    // The session screen is where the reading and the agreement live. It also
    // states the filing decision when there was one, which is why the project's
    // name travels with the redirect.
    redirect(
      result.value.joinedExisting
        ? `/sessions/${result.value.sessionId}?filed=${encodeURIComponent(result.value.projectName)}`
        : `/sessions/${result.value.sessionId}`,
    )
  }

  if (screen === null) {
    /**
     * Two very different reasons land here, and saying the wrong one is worse
     * than saying nothing.
     *
     * `startFromSuggestion` documents at length why it answers "a session is
     * already running" before it looks at the sites — a second click on the
     * same notification would otherwise be told "Propositum has not been
     * watching any of those sites", which is true of the buffer and useless to
     * the person. That care was being thrown away one layer up: starting a
     * session calls `clear()`, so `offerForThread` finds nothing and the screen
     * said the link had gone stale. It had not. It had worked.
     */
    const live = captureStore().current()

    return (
      <Sheet>
        <style href="propositum-start" precedence="default">
          {CSS}
        </style>
        <Masthead
          kicker="Propositum"
          title={live ? 'That already happened' : 'Nothing to start'}
        />
        {live ? (
          <Section title="A session is already running" index={1}>
            <p className="st-under">
              You said yes to this once already, and Propositum is watching. End that session
              before starting another one.
            </p>
            <p className="st-under">
              <Link href={`/sessions/${live.sessionId}`}>Open the session</Link>
            </p>
          </Section>
        ) : (
          <Section title="That link has gone stale" index={1}>
            <p className="st-under">
              Propositum could not tell what this was meant to be about. What it saw is held in
              memory for half an hour and then thrown away, so a link left until tomorrow has
              nothing behind it. Browse for a while and it will offer again.
            </p>
          </Section>
        )}
      </Sheet>
    )
  }

  const { backOn, offer, origins, subject } = screen


  return (
    <Sheet>
      <style href="propositum-start" precedence="default">
        {CSS}
      </style>
      <Masthead kicker="Propositum noticed" title={subject} />

      <Section title="Before Propositum starts" tone="attention" index={1}>
        {problem === '' ? null : <p className="st-under">{problem}</p>}

        {/* The person's own facts, first. Then somebody's reading of them. */}
        <Grounds sentences={screen.grounds} />

        {offer === null ? (
          <>
            <p className="of-lede">{screen.sentence}</p>
            <p className="of-title">Propositum can start watching this.</p>
            <p className="st-under">
              {screen.because} It has not worked out what to do about it yet &mdash; that needs a
              model, and either it is still thinking or it has no way to reach one. Starting the
              session loses nothing: what it has already seen comes with you.
            </p>
          </>
        ) : (
          <OfferBody
            sentence={screen.sentence}
            title={offer.title}
            rationale={offer.rationale}
            outline={offer.outline}
            produces={offer.produces}
            excludes={offer.excludes}
          />
        )}

        {backOn === null ? null : (
          <>
            {/* Filing is a decision Propositum is about to make. It is stated
                before it happens, with the way out beside it — the list below
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
          </>
        )}

        <form action={go}>
          <p className="of-h3">What Propositum would watch</p>
          <p className="st-under">
            {origins.length === 1
              ? 'This is the site it saw this on. Untick it and it watches nothing.'
              : `These are the ${origins.length} sites it saw this on. Untick any it should leave alone.`}
          </p>

          <SiteChoices sites={origins} {...(backOn ? { joinedProject: backOn.name } : {})} />

          <p className="of-h3">{backOn === null ? 'And it sets up' : 'And it carries on'}</p>
          <ul className="st-list">
            {backOn === null ? (
              <>
                <li>
                  A project called <strong>{subject}</strong>
                </li>
                <li>
                  A document to work in, called <strong>{subject}</strong>
                </li>
              </>
            ) : (
              <>
                <li>
                  This sitting goes under <strong>{backOn.name}</strong>
                </li>
                <li>
                  {backOn.documents === 0
                    ? 'A document to work in, since that project has none yet'
                    : 'The document already there is what Propositum works on'}
                </li>
              </>
            )}
            {/* Deliberately no number. The count depends on which sites are
                left ticked, and the ticks change after this renders — a screen
                whose thesis is that every sentence on it is checkable cannot
                promise "6 pages" and then carry three. */}
            <li>A session, with what you have already read on those sites carried into it</li>
          </ul>

          <p className="st-under">
            <strong>Nothing runs yet.</strong> You will land on the working agreement with the
            objective filled in, and Propositum does nothing at all until you accept it.
          </p>

          <div className="st-acts">
            <Button variant="primary" type="submit">
              {backOn === null ? 'Set it up' : 'Carry on with it'}
            </Button>

            {backOn === null ? null : (
              <Button type="submit" name="newWork" value="1">
                No &mdash; this is new work
              </Button>
            )}
          </div>
        </form>
      </Section>
    </Sheet>
  )
}
