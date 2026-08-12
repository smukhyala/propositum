/**
 * The offer, as a person reads it.
 *
 * ── The order on this screen IS the argument ─────────────────────────────
 *
 * Grounds first, then the model's sentence. Not because it looks better — it
 * arguably does not, since the model's line is the interesting one — but
 * because the person's own facts have to arrive before somebody's reading of
 * them. "You searched three different ways. You went back to the world-models
 * page after leaving it. You have been at this for 22 minutes." are things that
 * observably happened and that the reader can check against their own memory of
 * the last half hour. "Looks like you're working on world models" is an
 * inference drawn from page titles by a model, and it is the one sentence a
 * person is most likely to read and least likely to interrogate, because it
 * arrived unasked-for and looks like a summary rather than a proposal.
 *
 * Putting the checkable things above the unverifiable one is the only lever the
 * interface has on that, and ADR-0009 names it: *the offer screen must show the
 * outline and the will-not-do list, not just the title.*
 *
 * ── Why `excludes` lives here and nowhere else ───────────────────────────
 *
 * The will-not-do list is the model's own prose about its own intentions.
 * Nothing enforces it. It earns its place on this screen because it is the half
 * people read hardest and the half that makes an offer legible — an offer that
 * only says what it will do is asking to be read generously.
 *
 * It must never appear in the contract's "What I can change" panel. That panel
 * renders two deterministic groups compiled by `compilePolicy` from a scope and
 * a set of dials, and every line in it is enforced by the gate. A third group
 * of unenforced sentences sitting beside them, in the same visual register,
 * would read as the same kind of promise and would not be one. One panel where
 * some rules bind and others are prose is worse than two panels, and it is
 * worse in the specific way this product cannot afford: the screen the whole
 * trust model rests on would be lying by layout.
 *
 * ── The sites are individually untickable ────────────────────────────────
 *
 * Each one is a checkbox, ticked by default, because Propositum saw all of them
 * and the honest default is to say so. Unticking narrows: the server takes
 * `observed ∩ ticked`, so unticking removes a site and nothing anybody sends
 * can add one. The form deliberately submits the names of the KEPT sites rather
 * than the dropped ones — an unchecked checkbox submits nothing, so a dropped
 * site is an absence, and an absence cannot be forged into an approval.
 */

import type { ReactNode } from 'react'

export const OFFER_CSS = `
.of-grounds { list-style: none; margin: 0 0 1.75rem; padding: 0 0 0 1.1rem; border-left: 2px solid var(--rule); }
.of-grounds li { font-family: var(--serif); font-size: 1rem; line-height: 1.5; color: var(--muted); margin: 0 0 0.35rem; text-wrap: pretty; }
.of-grounds li:last-child { margin-bottom: 0; }

.of-lede { font-family: var(--serif); font-size: 1.0625rem; color: var(--muted); margin: 0 0 0.4rem; }
.of-title { font-family: var(--serif); font-size: clamp(1.35rem, 3.5vw, 1.75rem); font-weight: 400; line-height: 1.25; letter-spacing: -0.01em; margin: 0 0 0.85rem; text-wrap: pretty; }
.of-rationale { margin: 0 0 1.75rem; font-size: 0.9375rem; color: var(--muted); max-width: 38rem; }

.of-h3 { font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.7rem; }
.of-outline { list-style: none; margin: 0 0 1.75rem; padding: 0; counter-reset: of-step; }
.of-outline li { counter-increment: of-step; display: grid; grid-template-columns: 1.6rem 1fr; gap: 0.5rem; padding: 0.4rem 0; border-bottom: 1px solid var(--rule); font-size: 0.9375rem; align-items: baseline; }
.of-outline li:last-child { border-bottom: none; }
.of-outline li::before { content: counter(of-step); font-family: var(--mono); font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; }

.of-produces { margin: 0 0 1.75rem; padding: 0.85rem 0 0.85rem 1.1rem; border-left: 2px solid var(--accent); font-family: var(--serif); font-size: 1.0625rem; text-wrap: pretty; }

/* The will-not-do list is set apart, and set apart quietly. It is the model's
   own prose and must not borrow the visual authority of an enforced rule. */
.of-excludes { margin: 0 0 1.75rem; padding: 0.9rem 1rem; background: var(--raised); border: 1px dashed var(--rule); }
.of-excludes ul { list-style: none; margin: 0; padding: 0; }
.of-excludes li { font-size: 0.9375rem; color: var(--muted); padding: 0.25rem 0; }
.of-excludes li::before { content: "—"; color: var(--faint); margin-right: 0.5rem; }
.of-excludes-note { margin: 0.6rem 0 0; font-size: 0.8125rem; color: var(--faint); }

.of-sites { list-style: none; margin: 0 0 1.5rem; padding: 0; }
.of-site { display: grid; grid-template-columns: 1.1rem 1fr; gap: 0.6rem; padding: 0.5rem 0; border-bottom: 1px solid var(--rule); align-items: baseline; }
.of-site:last-child { border-bottom: none; }
.of-site input { margin: 0; accent-color: var(--accent); }
.of-site-host { font-family: var(--mono); font-size: 0.8125rem; }
.of-site-note { display: block; font-size: 0.8125rem; color: var(--attention); margin-top: 0.15rem; }
.of-site-off .of-site-host { color: var(--muted); }
`

/**
 * Why I'm asking — the detector's own sentences, rendered verbatim.
 *
 * Verbatim matters. These come out of `groundsFor`, which is arithmetic over
 * dwell, page counts and the order things happened in, and every one of them is
 * a fact two people watching the same screen would agree about. Rewording them
 * here would put this file between the person and the evidence, and there is no
 * version of that which does not eventually soften a fact into a claim.
 */
export function Grounds({ sentences }: { readonly sentences: readonly string[] }) {
  if (sentences.length === 0) return null

  return (
    <>
      <p className="of-h3">Why I&rsquo;m asking</p>
      <ul className="of-grounds">
        {sentences.map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
    </>
  )
}

export interface OfferBodyProps {
  /** "Looks like you're working on world models." The model's reading. */
  readonly sentence: string
  readonly title: string
  readonly rationale: string
  readonly outline: readonly string[]
  readonly produces: string
  readonly excludes: readonly string[]
}

/** The model's half: what it thinks this is, what it would do, and what it says
 *  it will not do. Everything here is prose and none of it is enforced. */
export function OfferBody({
  sentence,
  title,
  rationale,
  outline,
  produces,
  excludes,
}: OfferBodyProps) {
  return (
    <>
      <p className="of-lede">{sentence}</p>
      <p className="of-title">{title}</p>
      {rationale === '' ? null : <p className="of-rationale">{rationale}</p>}

      {outline.length === 0 ? null : (
        <>
          <p className="of-h3">How it would go</p>
          <ul className="of-outline">
            {outline.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </>
      )}

      {produces === '' ? null : <p className="of-produces">{produces}</p>}

      {excludes.length === 0 ? null : (
        <>
          <p className="of-h3">What it will not do</p>
          <div className="of-excludes">
            <ul>
              {excludes.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="of-excludes-note">
              Propositum&rsquo;s own words about its own intentions. What it is actually allowed to
              touch is set by the working agreement, on the next screen.
            </p>
          </div>
        </>
      )}
    </>
  )
}

export interface SiteChoice {
  readonly pattern: string
  readonly host: string
  readonly leftWithdrawn: boolean
}

/**
 * The sites, each one untickable.
 *
 * ── A withdrawn site is shown, and stays tickable ────────────────────────
 *
 * Hiding it would be tidier and would mean the person is told nothing about a
 * site Propositum is about to go on not seeing. So it is listed, with the
 * reason beside it.
 *
 * It is NOT disabled, and that took a second pass to get right. Disabling it
 * expressed a true thing about one of the two answers on this screen — a
 * revocation outranks a match, so carrying on with the old project leaves it
 * withdrawn — and a false thing about the other, because "no, this is new work"
 * opens a project that has never withdrawn anything and where the site can be
 * approved perfectly well. Worse, when EVERY observed site had been withdrawn
 * the screen became unescapable: nothing tickable, and a refusal that said
 * "leave at least one site ticked" next to a list where none could be.
 *
 * So the tick stays available and the note says what each answer will do with
 * it. The server is the thing that actually refuses — `startFromSuggestion`
 * skips a withdrawn pattern and counts it — which is where that decision
 * belongs, because it is the same decision whatever screen asked.
 */
export function SiteChoices({
  sites,
  name = 'site',
  joinedProject,
}: {
  readonly sites: readonly SiteChoice[]
  readonly name?: string
  /** The project this would join, when there is one. Named in the note, so
   *  "you switched this off" says where. */
  readonly joinedProject?: string | undefined
}) {
  return (
    <ul className="of-sites">
      {sites.map((site) => (
        <li className={`of-site${site.leftWithdrawn ? ' of-site-off' : ''}`} key={site.pattern}>
          <input
            type="checkbox"
            id={`site-${site.pattern}`}
            name={name}
            value={site.pattern}
            defaultChecked
          />
          <label htmlFor={`site-${site.pattern}`}>
            <span className="of-site-host">{site.host}</span>
            {site.leftWithdrawn ? (
              <span className="of-site-note">
                You switched this one off in {joinedProject ?? 'that project'}. Carrying on leaves
                it off; starting this as new work does not.
              </span>
            ) : null}
          </label>
        </li>
      ))}
    </ul>
  )
}

/** A heading for a group of things, in the house register. */
export function OfferHeading({ children }: { readonly children: ReactNode }) {
  return <p className="of-h3">{children}</p>
}
