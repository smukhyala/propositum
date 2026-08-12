/**
 * "I need you to say yes to this one thing."
 *
 * ── What this screen is standing in for ──────────────────────────────────
 *
 * ADR-0004's strongest claim was that a prohibition implemented as a MISSING
 * CAPABILITY cannot be misconfigured and cannot be re-enabled by a policy bug.
 * There was no `sendMessage`, so nothing could be sent. ADR-0010 spends that:
 * `ActionKind` now enumerates mechanisms rather than effects, `click-element`
 * can press *Send*, and what stands in the way is this page.
 *
 * **A pause is strictly weaker than an absence.** An absence cannot be clicked
 * through and does not get tired at nine in the evening. So the only thing that
 * makes this screen worth anything is whether the review it asks for is REAL —
 * and every decision below is about that and nothing else.
 *
 * ── Why there is no Approve button on the notification ───────────────────
 *
 * There is one button on the notification and it says *Show me*. Approving from
 * a notification is approving without seeing what you are approving, and a
 * mechanism whose whole value is a human looking cannot have a path that skips
 * the looking. The precedent is already in the extension, in its own words:
 * *"the person lands on a page showing the four durable things about to be
 * created in their name, rather than a toast claiming it happened."*
 *
 * ── The attested half and the page-authored half are kept apart ──────────
 *
 * The origin, the method and the URL come from Chrome describing a request it
 * is holding. A page can put the word *Cancel* on a button that posts an order;
 * it cannot make Chrome report a `POST` as a `GET`. Those go in the first
 * panel, stated flatly.
 *
 * The element's accessible name is PAGE-AUTHORED, and it gets the treatment
 * every other page-authored value in this codebase gets: an attributed
 * quotation, in the source's voice, never in Propositum's. `src/ui/agreement.tsx`
 * makes the rule explicit — there is deliberately no path that writes page text
 * into anything the machine then acts on — and this screen does not invent one.
 * The quotation is rendered and nothing on this page reads it back.
 *
 * The text about to be typed is shown VERBATIM, in a monospaced block that
 * preserves whitespace. `ActionParams` keeps `inputText` separate from `text`
 * for exactly this: "type this into that box" is only a meaningful question if
 * the person can read the this.
 *
 * ── Two controls, and they say the two different things ──────────────────
 *
 * *Go ahead* and *Don't*. Not Approve — that word belongs to `ApprovedSource`
 * and means something else. Not Accept/Reject — those are the controls for
 * deciding about work already produced and held, and confirming is permission
 * for something that has not happened and cannot be undone once it has. A
 * screen that used one word for both would be teaching somebody to authorise an
 * irreversible act with the control they learned on a paragraph.
 */

import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { BackLink, Button, Masthead, Section, Sheet } from '@/ui/primitives'
import { Quotation } from '@/ui/reading'
import { appContext } from '@/server/db'
import { confirmationView } from '@/server/confirmations'
import { confirmOnePendingRequest, rejectOnePendingRequest } from '@/server/actions'

/** Read fresh every time. A cached copy of a question about something
 *  irreversible is the one page that must never be stale. */
export const dynamic = 'force-dynamic'

const CSS = `
.cf-lede { font-family: var(--serif); font-size: clamp(1.15rem, 3vw, 1.45rem); line-height: 1.35; margin: 0 0 1.5rem; text-wrap: pretty; }

.cf-h3 { font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 1.75rem 0 0.7rem; }

.cf-facts { list-style: none; margin: 0; padding: 0; }
.cf-facts li { display: grid; grid-template-columns: 8rem 1fr; gap: 0.85rem; padding: 0.45rem 0; border-bottom: 1px solid var(--rule); align-items: baseline; }
.cf-facts li:last-child { border-bottom: none; }
@media (max-width: 32rem) { .cf-facts li { grid-template-columns: 1fr; gap: 0.15rem; } }
.cf-key { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); }
.cf-val { margin: 0; font-size: 0.9375rem; overflow-wrap: anywhere; }
.cf-absent { color: var(--faint); font-style: italic; }

.cf-verbatim { margin: 0; padding: 0.8rem 0.9rem; background: var(--raised); border-left: 2px solid var(--accent); font-family: var(--mono); font-size: 0.875rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.cf-verbatim-note { margin: 0.5rem 0 0; font-size: 0.8125rem; color: var(--muted); }

.cf-shot { display: block; max-width: 100%; height: auto; border: 1px solid var(--rule); border-radius: 3px; }

.cf-warn { margin: 0 0 1.5rem; padding: 0.7rem 0.9rem; border-left: 2px solid var(--attention); color: var(--attention); font-size: 0.9375rem; }
.cf-note { margin: 1.5rem 0 0; font-size: 0.9375rem; color: var(--muted); max-width: 40rem; }

.cf-acts { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 2rem; }
.cf-settled { margin: 0 0 1rem; font-family: var(--serif); font-size: 1.0625rem; }
`

function Styles() {
  return (
    <style href="propositum-confirm" precedence="default">
      {CSS}
    </style>
  )
}

/** A fact Chrome asserted, or an honest blank. Never a guess: a screen whose
 *  entire job is being checkable cannot fill a gap with something plausible. */
function Fact({ label, value }: { readonly label: string; readonly value: string | null }) {
  return (
    <li>
      <span className="cf-key">{label}</span>
      {value === null ? (
        <p className="cf-val cf-absent">Propositum was not told</p>
      ) : (
        <p className="cf-val">{value}</p>
      )}
    </li>
  )
}

/**
 * The picture, inlined.
 *
 * A data URI rather than a route, because a screenshot of somebody's
 * authenticated session is the single most sensitive byte-string in this
 * product and an endpoint that serves it by id is a second door onto it. Inline
 * it renders under the same page load that already proved the person is here.
 *
 * `ActionEvidence` is swept — it belongs to the acting ledger, not to the
 * person's own browsing — so this is never long-lived.
 */
function Screenshot({ image }: { readonly image: Uint8Array }) {
  const base64 = Buffer.from(image).toString('base64')

  return (
    <img
      className="cf-shot"
      src={`data:image/png;base64,${base64}`}
      alt="What the page looked like when Propositum stopped to ask."
    />
  )
}

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ contractId: string; requestId: string }>
}) {
  const { contractId, requestId } = await params
  const ctx = await appContext()

  const view = await confirmationView(ctx, requestId, Date.now())
  if (!view) notFound()

  // The request belongs to another shift. A 404 rather than a redirect: a link
  // that names the wrong contract is a link somebody constructed, and quietly
  // correcting it would make the URL's contract id decorative.
  if (view.contractId !== contractId) notFound()

  const back = `/shifts/${contractId}`

  /**
   * Both answers are ordinary server actions on a form.
   *
   * No client-side confirm(), no double-tap, no hold-to-confirm. The friction
   * that matters is the screen above the buttons, and adding a second dialog
   * would train exactly the reflex — click through whatever is in the way —
   * that this whole mechanism is spent on preventing.
   */
  async function goAhead() {
    'use server'
    const result = await confirmOnePendingRequest(requestId)
    if (!result.ok) redirect(`${back}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(back)
  }

  async function dont() {
    'use server'
    const result = await rejectOnePendingRequest(requestId)
    if (!result.ok) redirect(`${back}?problem=${encodeURIComponent(result.problem.message)}`)
    redirect(back)
  }

  /**
   * Already answered, or too old to answer.
   *
   * Rendered as a dead end with no controls at all, deliberately. A screen that
   * still offered *Go ahead* on a question that can no longer be confirmed
   * would be offering a button that does nothing — and the person would
   * reasonably conclude their yes had been taken.
   */
  if (view.verdict !== null || view.expired) {
    return (
      <Sheet>
        <Styles />
        <BackLink href={back}>Back to the shift</BackLink>
        <Masthead kicker="One thing I could not undo" title={view.summary} />
        <Section title="Where this got to">
          <p className="cf-settled">
            {view.verdict === 'confirmed'
              ? 'You said go ahead.'
              : view.verdict === 'rejected'
                ? "You said don't."
                : 'This question went unanswered for a day, so Propositum stopped waiting. Nothing was done.'}
          </p>
          <p className="cf-note">
            Nothing on this page can be changed now. What happened next is on the shift.{' '}
            <Link href={back}>Go and look.</Link>
          </p>
        </Section>
      </Sheet>
    )
  }

  const image = await (async () => {
    if (!view.evidenceId || !view.hasImage) return null
    const row = await ctx.repos.evidence.byId(view.evidenceId)
    return row?.image ?? null
  })()

  return (
    <Sheet>
      <Styles />
      <BackLink href={back}>Back to the shift</BackLink>
      <Masthead
        kicker="I need you to say yes to this one thing"
        title={view.summary}
        subtitle="Propositum stopped here because this is not something it can take back."
      />

      <Section title="Before you answer">
        {/**
         * The two clocks, said out loud BEFORE the buttons.
         *
         * Expiry is a day; the time limit credits back at most four hours of
         * waiting. Those disagree on purpose, and the gap is a state somebody
         * can land in. Saying so here rather than after they press is the
         * difference between a decision and a surprise: they can still say go
         * ahead — their yes is recorded as a yes — and Propositum will stop
         * anyway, because the time they gave it is a bound they set.
         */}
        {view.pastDeadline ? (
          <p className="cf-warn">
            The time you gave this shift has already run out. You can still answer, and Propositum
            will record it &mdash; but it will not carry on afterwards. Hand the work over again if
            you want it finished.
          </p>
        ) : null}

        <p className="cf-lede">
          Propositum wants to do one thing it cannot undo, and it is waiting for you rather than
          guessing.
        </p>

        <p className="cf-h3">What the browser says</p>
        <ul className="cf-facts">
          <Fact label="On" value={view.attested.origin} />
          <Fact label="Page" value={view.attested.url} />
          {/* Attested at the network: Chrome describing a request it is
              holding, not a page describing itself. A page can put the word
              Cancel on a button that posts an order; it cannot make Chrome
              report a POST as a GET. */}
          <Fact label="Sends" value={view.attested.method} />
          <Fact label="Tab" value={view.attested.tabTitle} />
          <Fact label="Doing" value={view.attested.actionKind} />
        </ul>

        {view.typedText === null ? null : (
          <>
            <p className="cf-h3">The words it would type</p>
            {/* Verbatim, whitespace and all. Escaped by React, and shown in a
                block that cannot be mistaken for Propositum's own prose. */}
            <pre className="cf-verbatim">{view.typedText}</pre>
            <p className="cf-verbatim-note">
              Exactly these characters, nothing added and nothing trimmed.
            </p>
          </>
        )}

        {view.elementName === null ? null : (
          <>
            <p className="cf-h3">What the button says</p>
            {/**
             * Page-authored, so attributed. The site's words in the site's
             * voice, and it is worth knowing that a page is free to write
             * anything here — which is exactly why the method above comes from
             * Chrome and this does not.
             *
             * Nothing on this page reads this value back. It is rendered and
             * that is all; there is no control that puts it into anything the
             * machine then acts on, the same barrier `src/ui/agreement.tsx`
             * holds for constraints quoted out of pages.
             */}
            <Quotation text={view.elementName} said={view.attested.origin} />
          </>
        )}

        {image === null ? null : (
          <>
            <p className="cf-h3">What it was looking at</p>
            <Screenshot image={image} />
          </>
        )}

        <p className="cf-note">
          Saying go ahead permits <strong>this one thing</strong> and nothing else. Propositum picks
          the work up again afterwards and will stop and ask you the next time it reaches something
          it cannot take back.
        </p>

        <div className="cf-acts">
          <form action={goAhead}>
            <Button variant="primary" type="submit">
              Go ahead
            </Button>
          </form>
          <form action={dont}>
            <Button type="submit">Don&rsquo;t</Button>
          </form>
        </div>
      </Section>
    </Sheet>
  )
}
