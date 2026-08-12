/**
 * "I need you to say yes to this one thing."
 *
 * ── What this screen is standing in for ──────────────────────────────────
 *
 * ADR-0004's strongest claim was that a prohibition implemented as a MISSING
 * CAPABILITY cannot be misconfigured and cannot be re-enabled by a policy bug.
 * There was no `sendMessage`, so nothing could be sent. ADR-0010 spends that:
 * `ActionKind` now enumerates mechanisms rather than effects, `click-element`
 * can press *Send*, and what stands in the way is this screen.
 *
 * **A pause is strictly weaker than an absence.** An absence cannot be clicked
 * through and does not get tired at nine in the evening. So the only thing that
 * makes this worth anything is whether the review it asks for is REAL — and
 * every decision below is about that and nothing else.
 *
 * ── Why there is no Approve button on the notification ───────────────────
 *
 * There is one button on the notification and it says *Show me*. Approving from
 * a notification is approving without seeing what you are approving, and a
 * mechanism whose whole value is a human looking cannot have a path that skips
 * the looking. The precedent is already in the extension, in its own words:
 * *"the person lands on a page showing the durable things about to be created
 * in their name, rather than a toast claiming it happened."*
 *
 * ── The attested half and the page-authored half are kept apart ──────────
 *
 * The origin, the URL and the method come from Chrome describing a request it
 * is holding. A page can put the word *Cancel* on a button that posts an order;
 * it cannot make Chrome report a `POST` as a `GET`. Those go in the first
 * panel, stated flatly.
 *
 * The element's accessible name is PAGE-AUTHORED, and it gets the treatment
 * every other page-authored value in this codebase gets: an attributed
 * quotation, in the source's voice, never in Propositum's. `./agreement`
 * makes the rule explicit — there is deliberately **no path that writes page
 * text into anything the machine then acts on** — and this screen does not
 * invent one. The quotation is rendered and nothing here reads it back: it
 * reaches no field, no form value, and no control that would carry it onward.
 *
 * The text about to be typed is shown VERBATIM, in a monospaced block that
 * preserves whitespace. `ActionParams` keeps `inputText` separate from `text`
 * for exactly this reason: "type this into that box" is only a meaningful
 * question if the person can read the this.
 *
 * ── Two controls, and they say the two different things ──────────────────
 *
 * *Go ahead* and *Don't*. Not Approve — that word belongs to `ApprovedSource`
 * and means something else. Not Accept/Reject — those decide about work already
 * produced and HELD, and confirming is permission for something that has not
 * happened and cannot be undone once it has. A screen that used one word for
 * both would be teaching somebody to authorise an irreversible act with the
 * control they learned on a paragraph.
 *
 * There is no second dialog, no hold-to-confirm and no typed phrase. The
 * friction that matters is everything above the buttons; a second gate would
 * train exactly the reflex — get past whatever is in the way — that this whole
 * mechanism is spent on preventing.
 */

'use client'

import type { ReactNode } from 'react'

import { Button, Masthead, Section } from './primitives'
import { Quotation } from './reading'

export const CONFIRM_CSS = `
.cf-lede { font-family: var(--serif); font-size: clamp(1.05rem, 2.6vw, 1.25rem); line-height: 1.4; margin: 0 0 1.5rem; text-wrap: pretty; max-width: 40rem; }

.cf-h3 { font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 1.75rem 0 0.7rem; }

.cf-facts { list-style: none; margin: 0; padding: 0; }
.cf-facts li { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.85rem; padding: 0.45rem 0; border-bottom: 1px solid var(--rule); align-items: baseline; }
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
      {CONFIRM_CSS}
    </style>
  )
}

/**
 * What the person is answering, as this screen needs it.
 *
 * Declared here rather than imported from the server module, so the rendering
 * has no dependency on the database and can be exercised over a plain object.
 * The shape is structural — `ConfirmationView` satisfies it.
 */
export interface ConfirmationDetail {
  /** CODE-GENERATED from attested facts. Never model prose, and never the
   *  page's words: a model that could write the sentence asking for its own
   *  permission is a model that can argue for itself. */
  readonly summary: string
  /** Past its shift's credited deadline. Their yes will still be recorded as a
   *  yes; the work will still not carry on. Said BEFORE they press. */
  readonly pastDeadline: boolean
  readonly attested: {
    readonly origin: string | null
    readonly url: string | null
    /** Browser-attested at the network. Absent until the request-pausing path
     *  supplies it, and absent renders as absent rather than as a guess. */
    readonly method: string | null
    readonly tabTitle: string | null
    readonly actionKind: string
  }
  /** Verbatim. Escaped by React and shown in a block that cannot be mistaken
   *  for Propositum's own prose. */
  readonly typedText: string | null
  /** PAGE-AUTHORED. Rendered as an attributed quotation and read back by
   *  nothing. */
  readonly elementName: string | null
  /** A `data:` URI, or null. Inlined rather than served by id, because a
   *  screenshot of somebody's authenticated session is the most sensitive
   *  byte-string in this product and an endpoint for it is a second door. */
  readonly imageSrc: string | null
}

/** A fact Chrome asserted, or an honest blank. Never a guess: a screen whose
 *  entire job is being checkable cannot fill a gap with something plausible. */
function Fact({ label, value }: { readonly label: string; readonly value: string | null }): ReactNode {
  return (
    <li>
      <span className="cf-key">{label}</span>
      {value === null || value.trim() === '' ? (
        <p className="cf-val cf-absent">Propositum was not told</p>
      ) : (
        <p className="cf-val">{value}</p>
      )}
    </li>
  )
}

export interface ConfirmationScreenProps {
  readonly detail: ConfirmationDetail
  /** The person says yes to this one thing. */
  readonly goAhead: () => void | Promise<void>
  /** The person says no. Recorded, because "you said no" and "you never saw
   *  it" are different sentences in the report. */
  readonly dont: () => void | Promise<void>
}

export function ConfirmationScreen({ detail, goAhead, dont }: ConfirmationScreenProps): ReactNode {
  return (
    <>
      <Styles />
      <Masthead
        kicker="I need you to say yes to this one thing"
        title={detail.summary}
        subtitle="Propositum stopped here because this is not something it can take back."
      />

      <Section title="Before you answer">
        {/*
          The two clocks, said out loud BEFORE the buttons.

          A question stays answerable for a day; a shift credits back at most
          four hours of waiting. Those disagree on purpose, and the gap is a
          real state somebody can land in. Saying so here rather than after
          they press is the difference between a decision and a surprise: they
          can still answer, it is still recorded, and Propositum will stop
          anyway — because the time they gave it is a bound they set.
        */}
        {detail.pastDeadline ? (
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
          <Fact label="On" value={detail.attested.origin} />
          <Fact label="Page" value={detail.attested.url} />
          {/* Attested at the network: Chrome describing a request it is
              holding, not a page describing itself. A page can put the word
              Cancel on a button that posts an order; it cannot make Chrome
              report a POST as a GET. */}
          <Fact label="Sends" value={detail.attested.method} />
          <Fact label="Tab" value={detail.attested.tabTitle} />
          <Fact label="Doing" value={detail.attested.actionKind} />
        </ul>

        {detail.typedText === null ? null : (
          <>
            <p className="cf-h3">The words it would type</p>
            <pre className="cf-verbatim">{detail.typedText}</pre>
            <p className="cf-verbatim-note">
              Exactly these characters, nothing added and nothing trimmed.
            </p>
          </>
        )}

        {detail.elementName === null ? null : (
          <>
            <p className="cf-h3">What the button says</p>
            {/*
              Page-authored, so attributed. The site's words in the site's
              voice — and it is worth the person knowing a page is free to
              write anything here, which is exactly why the method above comes
              from Chrome and this does not.
            */}
            <Quotation text={detail.elementName} said={detail.attested.origin} />
          </>
        )}

        {detail.imageSrc === null ? null : (
          <>
            <p className="cf-h3">What it was looking at</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="cf-shot"
              src={detail.imageSrc}
              alt="What the page looked like when Propositum stopped to ask."
            />
          </>
        )}

        <p className="cf-note">
          Saying go ahead permits <strong>this one thing</strong> and nothing else. Propositum picks
          the work up again afterwards, and it will stop and ask you the next time it reaches
          something it cannot take back.
        </p>

        {/* Exactly two controls. Every other route off this screen is a link. */}
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
    </>
  )
}

/**
 * Answered, or too old to answer.
 *
 * A dead end with NO controls at all, deliberately. A screen that still offered
 * *Go ahead* on a question that can no longer be confirmed would be offering a
 * button that does nothing — and the person would reasonably conclude their yes
 * had been taken.
 */
export function SettledConfirmation({
  summary,
  verdict,
  children,
}: {
  readonly summary: string
  /** `confirmed` · `rejected` · `null` when it simply ran out of time. */
  readonly verdict: string | null
  readonly children?: ReactNode | undefined
}): ReactNode {
  return (
    <>
      <Styles />
      <Masthead kicker="One thing I could not undo" title={summary} />
      <Section title="Where this got to">
        <p className="cf-settled">
          {verdict === 'confirmed'
            ? 'You said go ahead.'
            : verdict === 'rejected'
              ? "You said don't."
              : 'This question went unanswered for a day, so Propositum stopped waiting. Nothing was done.'}
        </p>
        <p className="cf-note">{children}</p>
      </Section>
    </>
  )
}
