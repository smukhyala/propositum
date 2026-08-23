/**
 * The shared surface every screen is built from.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * It is a handover note, not a dashboard. One column, roughly 54rem, a left
 * time rail where things happened at a time, serif for prose a person reads as
 * prose, grotesque for anything they scan, mono for times and identifiers.
 * There is no card grid here and there is deliberately no generic `Card`.
 *
 * Every colour comes from a token in src/app/globals.css. Nothing here invents
 * one, so light and dark are handled once, in the place that already handles
 * them.
 *
 * ── Why the CSS is a stylesheet and not inline styles ────────────────────
 *
 * A visible focus ring, a disabled state, `:last-child` on a rail row and a
 * responsive gutter are all pseudo-selectors, and an inline `style` object
 * cannot express any of them. The alternative — dropping the focus ring — is a
 * WCAG failure, and PRODUCT_PRINCIPLES §10 rules that out.
 *
 * So there is exactly one stylesheet, hoisted and de-duplicated by React 19 via
 * `href` + `precedence`. Every primitive renders it, so any one of them works
 * standing alone, and React collapses them to a single tag in the head.
 *
 * ── The entrance is an `index`, not a context ────────────────────────────
 *
 * Motion's variant propagation stops at the first non-motion element, and the
 * screens above this file will nest ordinary markup freely. A stagger built on
 * propagation would therefore work in the component that was tested and quietly
 * stop working in the one that was not. So the delay is an explicit `index`
 * prop: boring, visible in the call site, and impossible to break by accident.
 *
 * Every entrance is skipped entirely under `useReducedMotion`.
 */

'use client'

import { motion, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { useId } from 'react'
import type { ReactNode } from 'react'

/* ── the one stylesheet ─────────────────────────────────────────────────── */

const CSS = `
.pp-sheet { max-width: 54rem; margin: 0 auto; padding: 3.5rem 1.5rem 6rem; }
@media (min-width: 40rem) { .pp-sheet { padding: 4.5rem 2.5rem 7rem; } }

.pp-masthead { margin: 0 0 3rem; }
.pp-kicker-row { display: flex; align-items: center; gap: 0.55rem; color: var(--accent); margin: 0 0 0.85rem; }
.pp-kicker { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin: 0; }
.pp-title { font-family: var(--serif); font-size: clamp(2rem, 5vw, 2.75rem); font-weight: 400; letter-spacing: -0.015em; line-height: 1.1; text-wrap: balance; margin: 0; }
.pp-sub { margin: 0.9rem 0 0; color: var(--muted); font-size: 0.9375rem; max-width: 40rem; }

.pp-section { margin-top: 3.25rem; }
.pp-section:first-child { margin-top: 0; }
.pp-h2 { font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin: 0 0 1.25rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--rule); }

/* Attention breaks the column on purpose. Re-entry finding 1: the thing the
   person came back for cannot read as one more section in the stack. */
.pp-band { margin-left: -1.5rem; margin-right: -1.5rem; padding: 2rem 1.5rem; background: var(--raised); border-top: 1px solid var(--attention); border-bottom: 1px solid var(--attention); }
@media (min-width: 40rem) { .pp-band { margin-left: -2.5rem; margin-right: -2.5rem; padding: 2.25rem 2.5rem; } }
.pp-band > .pp-h2 { color: var(--attention); border-bottom-color: var(--attention); }

.pp-entry { display: grid; grid-template-columns: 5.5rem 1.4rem 1fr; gap: 0.85rem; padding: 0.75rem 0; border-bottom: 1px solid var(--rule); align-items: baseline; }
.pp-entry:last-child { border-bottom: none; }
@media (max-width: 30rem) { .pp-entry { grid-template-columns: 4.25rem 1.4rem 1fr; gap: 0.6rem; } }
.pp-at { font-family: var(--mono); font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pp-mark { color: var(--accent); position: relative; top: 0.22rem; }
.pp-what { margin: 0; }
.pp-why { margin: 0.25rem 0 0; font-size: 0.875rem; color: var(--muted); }

.pp-narrative { font-family: var(--serif); font-size: 1.3125rem; line-height: 1.5; letter-spacing: -0.005em; margin: 0; padding-left: 1.25rem; border-left: 2px solid var(--accent); text-wrap: pretty; }

.pp-btn { font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--rule); background: var(--ground); color: var(--ink); border-radius: 3px; cursor: pointer; }
.pp-btn:hover:not(:disabled) { border-color: var(--accent); }
.pp-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pp-btn-primary { background: var(--accent); border-color: var(--accent); color: var(--ground); }
.pp-btn-primary:hover:not(:disabled) { border-color: var(--accent); filter: brightness(1.07); }
.pp-btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--ground); }
.pp-btn:disabled { cursor: not-allowed; opacity: 0.45; filter: none; background: var(--raised); border-color: var(--rule); color: var(--muted); }

.pp-empty { border: 1px dashed var(--rule); background: var(--raised); padding: 1.75rem 1.5rem; }
.pp-empty-title { font-family: var(--serif); font-size: 1.125rem; font-weight: 400; margin: 0 0 0.4rem; }
.pp-empty-next { margin: 0; color: var(--muted); font-size: 0.9375rem; max-width: 34rem; }
.pp-empty-action { margin: 1.1rem 0 0; display: flex; gap: 0.5rem; flex-wrap: wrap; }

.pp-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

.pp-back { display: inline-block; font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); text-decoration: none; margin-bottom: 1.5rem; }
.pp-back:hover { color: var(--accent); }
.pp-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }

/* The one way anything is revealed. Generalised from the per-claim evidence
   disclosure in reading.tsx, which had this shape first and proved it. */
.pp-more { margin: 0.5rem 0 0; }
.pp-more > summary { font-family: var(--mono); font-size: 0.6875rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); cursor: pointer; padding: 0.15rem 0; list-style: none; }
.pp-more > summary::-webkit-details-marker { display: none; }
.pp-more > summary::before { content: "▸ "; color: var(--faint); }
.pp-more[open] > summary::before { content: "▾ "; }
.pp-more > summary:hover { color: var(--accent); }
.pp-more > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pp-more-body { margin: 0.75rem 0 0; padding: 0 0 0 1rem; border-left: 1px solid var(--rule); }
`

/** Hoisted and de-duplicated by React on `href`. Rendered by every primitive so
 *  none of them depends on being inside a `Sheet`. */
function Styles() {
  return (
    <style href="propositum-primitives" precedence="default">
      {CSS}
    </style>
  )
}

/* ── the entrance ───────────────────────────────────────────────────────── */

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * A short rise, delayed by position.
 *
 * Under reduced motion this suppresses `initial` and keeps `animate`, rather
 * than dropping the motion props altogether. Dropping them looks equivalent and
 * is not: `useReducedMotion()` is null during the server render, so the server
 * emits `opacity: 0` inline, and a client that then renders with no `animate`
 * has nothing to take it back off. The element would simply never appear — for
 * exactly the readers who asked for less movement.
 */
function useRise(index: number | undefined) {
  const still = useReducedMotion()

  return {
    initial: still ? false : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: still
      ? { duration: 0 }
      : {
          duration: 0.45,
          // Capped: a twentieth row should not wait a second and a half.
          delay: Math.min(index ?? 0, 10) * 0.06,
          ease: EASE,
        },
  }
}

/* ── Sheet ──────────────────────────────────────────────────────────────── */

export interface SheetProps {
  readonly children: ReactNode
  /** Defaults to `main`. Pass `div` when the page already has a `main`. */
  readonly as?: 'main' | 'div' | undefined
}

/** The page. One column, ~54rem, generous margins. Everything lives inside one. */
export function Sheet({ children, as = 'main' }: SheetProps) {
  const rise = useRise(0)

  return (
    <>
      <Styles />
      {as === 'main' ? (
        <motion.main className="pp-sheet" {...rise}>
          {children}
        </motion.main>
      ) : (
        <motion.div className="pp-sheet" {...rise}>
          {children}
        </motion.div>
      )}
    </>
  )
}

/* ── Masthead ───────────────────────────────────────────────────────────── */

export interface MastheadProps {
  /** Mono, uppercase, accent. The project or document this note is about. */
  readonly kicker: string
  /** Serif. The sentence the screen is. */
  readonly title: string
  /** A time window, a count, a line of orientation. Optional. */
  readonly subtitle?: ReactNode
  /** A sprite from src/ui/sprites.tsx, beside the kicker. */
  readonly mark?: ReactNode | undefined
  readonly index?: number | undefined
}

export function Masthead({ kicker, title, subtitle, mark, index }: MastheadProps) {
  const rise = useRise(index)

  return (
    <>
      <Styles />
      <motion.header className="pp-masthead" {...rise}>
        <div className="pp-kicker-row">
          {mark}
          <p className="pp-kicker">{kicker}</p>
        </div>
        <h1 className="pp-title">{title}</h1>
        {subtitle === undefined ? null : <div className="pp-sub">{subtitle}</div>}
      </motion.header>
    </>
  )
}

/* ── Section ────────────────────────────────────────────────────────────── */

export interface SectionProps {
  /** Rendered as a small uppercase label above a hairline rule. */
  readonly title: string
  readonly children: ReactNode
  /**
   * `attention` breaks the column: full-bleed to the sheet's padding, its own
   * rules, the label in the attention colour. Use it for exactly one thing on a
   * screen — "What I need from you". Two attentions is none.
   */
  readonly tone?: 'default' | 'attention' | undefined
  readonly index?: number | undefined
}

export function Section({ title, children, tone = 'default', index }: SectionProps) {
  const rise = useRise(index)
  const headingId = useId()

  return (
    <>
      <Styles />
      <motion.section
        className={tone === 'attention' ? 'pp-section pp-band' : 'pp-section'}
        aria-labelledby={headingId}
        {...rise}
      >
        <h2 className="pp-h2" id={headingId}>
          {title}
        </h2>
        {children}
      </motion.section>
    </>
  )
}

/* ── LogEntry ───────────────────────────────────────────────────────────── */

export interface LogEntryProps {
  /**
   * Mono, in the left gutter. A clock time, or a range — the caller formats it,
   * because "3:41–3:52 pm" and "sometime before 7:41 pm" are both correct and
   * only the caller knows which is true.
   *
   * Omit it and the gutter stays empty, so rows without a time still line up
   * with rows that have one.
   */
  readonly time?: string | undefined
  /** A sprite. It carries its own accessible name, so no text is duplicated. */
  readonly mark?: ReactNode | undefined
  /** The sentence. Plain prose — "Read Northwind's partner programme page". */
  readonly children: ReactNode
  /**
   * The second clause. Re-entry finding 4: an outcome nobody can adjudicate
   * reads as a failure without one — "Your Mac slept before this finished, so I
   * can't tell you how it went. Nothing was changed."
   */
  readonly detail?: ReactNode | undefined
  readonly index?: number | undefined
}

/**
 * One row on the time rail. The signature element: a fixed mono gutter, a mark
 * slot, then the content. The gutter is fixed so times form a column a person
 * can read down, which is the whole reason the rail exists.
 */
export function LogEntry({ time, mark, children, detail, index }: LogEntryProps) {
  const still = useReducedMotion()
  const slide = {
    initial: still ? false : { opacity: 0, x: -4 },
    animate: { opacity: 1, x: 0 },
    transition: still
      ? { duration: 0 }
      : { duration: 0.35, delay: Math.min(index ?? 0, 10) * 0.05, ease: EASE },
  }

  return (
    <>
      <Styles />
      <motion.div className="pp-entry" {...slide}>
        <span className="pp-at">{time ?? ''}</span>
        <span className="pp-mark">{mark}</span>
        <div>
          <p className="pp-what">{children}</p>
          {detail === undefined ? null : <p className="pp-why">{detail}</p>}
        </div>
      </motion.div>
    </>
  )
}

/* ── Button ─────────────────────────────────────────────────────────────── */

export interface ButtonProps {
  readonly children: ReactNode
  readonly variant?: 'primary' | 'default' | undefined
  readonly disabled?: boolean | undefined
  /** `submit` for a form bound to a server action; `button` otherwise. */
  readonly type?: 'button' | 'submit' | undefined
  readonly onClick?: (() => void) | undefined
  /** For toggle groups — the verdict row on a change, for instance. */
  readonly pressed?: boolean | undefined
  /**
   * Why the button is disabled, announced and shown on hover. A disabled
   * control with no explanation is the interaction bug in re-entry finding 2:
   * the person cannot tell whether it is broken or forbidden.
   */
  readonly title?: string | undefined
  readonly name?: string | undefined
  readonly value?: string | undefined
}

export function Button({
  children,
  variant = 'default',
  disabled = false,
  type = 'button',
  onClick,
  pressed,
  title,
  name,
  value,
}: ButtonProps) {
  return (
    <>
      <Styles />
      <button
        className={variant === 'primary' ? 'pp-btn pp-btn-primary' : 'pp-btn'}
        type={type}
        disabled={disabled}
        {...(onClick ? { onClick } : {})}
        {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
        {...(title === undefined ? {} : { title })}
        {...(name === undefined ? {} : { name })}
        {...(value === undefined ? {} : { value })}
      >
        {children}
      </button>
    </>
  )
}

/* ── Narrative ──────────────────────────────────────────────────────────── */

export interface NarrativeProps {
  /** The one model-authored line. Never more than a sentence or three. */
  readonly children: ReactNode
  readonly index?: number | undefined
}

/**
 * The single sentence a model wrote, set apart so it is legible as such.
 *
 * It is nullable everywhere it appears — the narrative boundary fails open and
 * the report renders without it — so callers render nothing rather than an
 * empty rule.
 */
export function Narrative({ children, index }: NarrativeProps) {
  const rise = useRise(index)

  return (
    <>
      <Styles />
      <motion.p className="pp-narrative" {...rise}>
        {children}
      </motion.p>
    </>
  )
}

/* ── Disclosure ─────────────────────────────────────────────────────────── */

export interface DisclosureProps {
  /** What is behind it, said so a person can decide whether to open it.
   *  "Why I think that — 3 things you did", "Adjust", "What was there before". */
  readonly summary: string
  readonly children: ReactNode
}

/**
 * The one way anything on a screen is revealed.
 *
 * ── Why `<details>` and not client state ─────────────────────────────────
 *
 * Every screen in this product is a Server Component by default, and a reveal
 * implemented with `useState` makes the thing it hides unreachable until React
 * has hydrated. `<details>` costs no JavaScript, works before hydration and
 * with it broken, is keyboard-operable and announced as an expandable by every
 * screen reader — and the browser owns the open state, so nothing here has to.
 *
 * ── Why this exists rather than another `title` ──────────────────────────
 *
 * Re-entry finding 9 measured the alternative: "a `title` tooltip is not
 * reliably reachable by keyboard or screen reader… the explanation needs to be
 * inline text or a real disclosure, not a tooltip." Text that only exists in a
 * `title` is text that some people simply never receive, which makes it a worse
 * answer than deleting it — a tooltip reads as thorough while being absent.
 *
 * So: text worth keeping goes in here or on the page. Text not worth that is
 * cut. There is no third option, and `title` is not one.
 *
 * ── What does NOT belong behind one ──────────────────────────────────────
 *
 * Anything a person needs in order to make the decision the screen is asking
 * for. A disclosure is for evidence and detail underneath a decision, never for
 * the terms of the decision itself: the objective on the agreement screen is
 * the prompt-injection catch (ADR-0006 §5) and stays on the page, and an
 * offer's *will not do* list is required to be visible by ADR-0009.
 */
export function Disclosure({ summary, children }: DisclosureProps) {
  return (
    <>
      <Styles />
      <details className="pp-more">
        <summary>{summary}</summary>
        <div className="pp-more-body">{children}</div>
      </details>
    </>
  )
}

/* ── Empty ──────────────────────────────────────────────────────────────── */

export interface EmptyProps {
  /** What is true right now. "No session has been started in this project." */
  readonly title: string
  /**
   * What to do next. REQUIRED — an empty state that only says a thing is empty
   * has told the person nothing they could not already see.
   */
  readonly next: string
  /** The control that does the thing `next` describes. */
  readonly action?: ReactNode | undefined
  readonly index?: number | undefined
}

export function Empty({ title, next, action, index }: EmptyProps) {
  const rise = useRise(index)

  return (
    <>
      <Styles />
      <motion.div className="pp-empty" {...rise}>
        <p className="pp-empty-title">{title}</p>
        <p className="pp-empty-next">{next}</p>
        {action === undefined ? null : <div className="pp-empty-action">{action}</div>}
      </motion.div>
    </>
  )
}

/* ── BackLink ───────────────────────────────────────────────────────────── */

/**
 * The way back up, at the top of a screen.
 *
 * A primitive rather than a class in each page's local stylesheet because every
 * screen below the front door needs one, and three near-identical copies of a
 * link style is how the fourth screen ends up without a way back at all.
 *
 * It stays an `<a>` (via `next/link`, passed in as `children` is not enough —
 * the href is here) so the browser's own affordances work: middle-click, the
 * back button, and the keyboard.
 */
export function BackLink({
  href,
  children,
}: {
  readonly href: string
  readonly children: ReactNode
}) {
  return (
    <>
      <Styles />
      <Link className="pp-back" href={href}>
        {children}
      </Link>
    </>
  )
}

/* ── VisuallyHidden ─────────────────────────────────────────────────────── */

/**
 * Text for a screen reader only.
 *
 * Here because re-entry finding 10 is a WCAG 1.4.1 Level A failure waiting to
 * happen: `<ins>`/`<del>` are not announced by most screen readers, so a diff
 * needs "added:" / "removed:" in the accessible name. Cheap, and the kind of
 * thing that gets skipped when there is no primitive for it.
 */
export function VisuallyHidden({ children }: { readonly children: ReactNode }) {
  return (
    <>
      <Styles />
      <span className="pp-hidden">{children}</span>
    </>
  )
}
