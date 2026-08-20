/**
 * *Where you left off* — one box, on both screens that show it.
 *
 * ── Why it is a component and not markup in each page ────────────────────
 *
 * Because the two places it appears are the two places somebody would change
 * one and not the other. On the accept screen it sits beside what
 * `carryOnCandidate` already shows, BEFORE the click that starts the sitting;
 * on the project screen it is the account of everything under this Intention.
 * Same words, same order, same heading — and the heading is `CONTEXT.md`'s
 * consumer wording, imported rather than typed, so neither screen can quietly
 * rename it to *History* or *Summary*, both of which the term explicitly
 * displaces.
 *
 * ── Sentences, not a table of numbers ────────────────────────────────────
 *
 * Rendering these as a stat row is the thing ADR-0017 exists to stop. Its own
 * opening is that `carryOnCandidate` ALREADY carries the project forward and
 * shows `{sittings: 3, sources: 5, documents: 1, overlap: 0.7}` for it, and that
 * *"the gap is not that nothing carries forward — it is that what carries
 * forward is counted rather than said"*. So this renders `view.lines`, which the
 * fold wrote, and holds no opinion about them. A component that reached past
 * `lines` into the members to build its own phrasing would be a second author of
 * one paragraph, and the two would drift the first time either changed.
 *
 * ── It renders before the click, and that is load-bearing ────────────────
 *
 * `CONTEXT.md`'s ruling on cross-session continuity forbids three things in one
 * sentence — *stale*, *inherited*, **quietly** — and names its own reason:
 * *"because nothing on screen would say it had been."* This box is the answer to
 * the third word. A person sees what is being carried forward at the moment it
 * would be carried, which is strictly more than they saw before. Moving it to
 * after the click would leave the code correct and the argument gone.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not a control. Nothing here is clickable, nothing here grants anything, and
 * nothing about it changes what Propositum may do. It is a display, and ADR-0017
 * accepts the cost of that in as many words: a longer accept screen is an easier
 * one to click through, and what bounds the damage is that every sentence in it
 * is derived from rows a person can go and look at.
 */

import { WHERE_YOU_LEFT_OFF } from '../domain/intention/work-so-far'
import type { WorkSoFar } from '../domain/intention/work-so-far'

export const WORK_SO_FAR_CSS = `
.wsf { margin: 0 0 1.75rem; padding: 0.9rem 0 0.9rem 1.1rem; border-left: 2px solid var(--rule); }
.wsf-head { font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 0.6rem; }
.wsf-lines { list-style: none; margin: 0; padding: 0; }
.wsf-lines li { font-family: var(--serif); font-size: 1rem; line-height: 1.5; color: var(--muted); margin: 0 0 0.35rem; text-wrap: pretty; max-width: 40rem; }
.wsf-lines li:last-child { margin-bottom: 0; }
`

export interface WhereYouLeftOffProps {
  /** Null when this Project has no Intention, which is ordinary and gets no
   *  box at all. */
  readonly view: WorkSoFar | null
}

/**
 * Nothing at all when there is nothing to say.
 *
 * Not an empty state, not *"no earlier work"*. A person starting something new
 * is not helped by a heading announcing the absence of a past, and a box that is
 * always there is a box that stops being read on the day it matters.
 */
export function WhereYouLeftOff({ view }: WhereYouLeftOffProps) {
  if (view === null || !view.anythingToSay) return null

  return (
    <>
      <style href="propositum-work-so-far" precedence="default">
        {WORK_SO_FAR_CSS}
      </style>
      <div className="wsf">
        <p className="wsf-head">{WHERE_YOU_LEFT_OFF}</p>
        <ul className="wsf-lines">
          {view.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </>
  )
}
