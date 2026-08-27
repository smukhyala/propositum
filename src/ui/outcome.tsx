/**
 * "What I made" — one thing a Shift produced, rendered so it can be decided.
 *
 * ── Two shapes, and the difference between them is the whole file ────────
 *
 * A **held** outcome is still Propositum's to hold: the person's Accept, Reject
 * or Edit decides what happens to it, and nothing has left the building. A
 * **landed** outcome is already out there — a form submitted, a message sent —
 * and there is nothing left to decide.
 *
 * So a landed outcome gets **no verdict controls at all**. Not a disabled
 * button, not a greyed-out row, not a confirmation dialog explaining why the
 * button will not work. ADR-0009 says why, and it is worth repeating where the
 * markup is: a person who clicks Reject on a sent message and is told
 * "rejected" has been lied to by the one screen the entire trust model rests
 * on. A disabled control still says *there is a decision here that you have
 * missed*, and there is not.
 *
 * The server refuses the same thing independently (`recordOutcomeVerdict`
 * checks `reversibility` before it checks anything else). Two mechanisms for
 * one truth is usually a smell; here it is deliberate, because the failure
 * being prevented is an interface that DRIFTS into offering a control that
 * lies, over some future refactor by somebody who never read this paragraph.
 *
 * ── Why `document-changes` has no card controls either ───────────────────
 *
 * Its decidable units are the individual changes, which have their own cards
 * further down the note, addressed by offsets into an immutable base. Offering
 * a whole-outcome verdict beside them would be two decision surfaces over one
 * thing, and the two verdict tables exist precisely so that neither has to
 * pretend to be the other. The card says what was made and points at the
 * review.
 *
 * ── Accept / Reject / Edit, verbatim ─────────────────────────────────────
 *
 * The same three words the change cards use, so the two verdict tables read as
 * one interface to the person who has no idea there are two. Edit is a real
 * member and not decoration — generated work is scored accepted / edited /
 * rejected, and folding an edit into an accept makes that unmeasurable.
 *
 * Unlike a change, an outcome has no document to open instead, so the editor is
 * here: one box, over the whole thing, which is the same granularity as the
 * verdict.
 */

'use client'

import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'

import { Button, Section } from './primitives'
import { Away, Wrote } from './sprites'
import type { ShiftOutcomeKind } from '../domain/outcome/shift-outcome'

/* ── the one stylesheet ─────────────────────────────────────────────────── */

const CSS = `
.po-outcome { border: 1px solid var(--rule); background: var(--raised); margin-bottom: 1rem; }
.po-outcome[data-verdict="accept"] { border-color: var(--accent); }
.po-outcome[data-verdict="reject"] { opacity: 0.6; }
.po-outcome[data-landed="true"] { border-color: var(--attention); }

.po-head { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; align-items: baseline; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--rule); }
.po-kind { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.po-mark { color: var(--accent); }
.po-scale { font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; }

.po-body { padding: 0.875rem 1rem; font-size: 0.9375rem; }
.po-headline { font-family: var(--serif); font-size: 1.0625rem; line-height: 1.45; margin: 0; text-wrap: pretty; }
.po-text { margin: 0.7rem 0 0; white-space: pre-wrap; }
.po-to { margin: 0.55rem 0 0; font-size: 0.8125rem; color: var(--muted); }
.po-items { margin: 0.7rem 0 0; padding-left: 1.1rem; }
.po-items li + li { margin-top: 0.3rem; }
.po-more { margin: 0.5rem 0 0; font-size: 0.8125rem; color: var(--faint); }

.po-landed { margin: 0 0 0.6rem; font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--attention); }
.po-can-do { margin: 0.8rem 0 0; padding: 0.7rem 0.85rem; border-left: 2px solid var(--attention); font-size: 0.9375rem; }

.po-findings { margin: 0.9rem 0 0; padding: 0.6rem 0 0.6rem 0.85rem; border-left: 2px solid var(--rule); }
.po-findings-head { margin: 0 0 0.35rem; font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.po-findings ul { margin: 0; padding-left: 1.1rem; }
.po-findings li { font-size: 0.875rem; color: var(--muted); max-width: 42rem; }
.po-findings li + li { margin-top: 0.3rem; }

.po-reason { margin: 0; padding: 0.625rem 1rem; border-top: 1px dashed var(--rule); font-size: 0.8125rem; color: var(--muted); }
.po-verdicts { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; padding: 0.75rem 1rem; border-top: 1px solid var(--rule); }
.po-aside { font-size: 0.8125rem; color: var(--faint); margin: 0; max-width: 34rem; }
.po-decided { font-size: 0.8125rem; color: var(--muted); margin: 0; }

.po-editor { padding: 0.75rem 1rem; border-top: 1px solid var(--rule); }
.po-field { font: inherit; font-family: var(--serif); font-size: 1rem; width: 100%; padding: 0.6rem 0.7rem; background: var(--ground); color: var(--ink); border: 1px solid var(--rule); border-radius: 3px; resize: vertical; }
.po-field:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
.po-editor-row { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.6rem; }
`

function Styles() {
  return (
    <style href="propositum-outcome" precedence="default">
      {CSS}
    </style>
  )
}

/* ── what a card is handed ──────────────────────────────────────────────── */

export type OutcomeVerdict = 'accept' | 'reject' | 'edit'

export interface OutcomeView {
  readonly id: string
  /** `null` when the stored kind is outside the closed set. The card then uses
   *  generic wording and keeps its controls — see the domain reader's header
   *  for why that fail direction, and not the other one. */
  readonly kind: ShiftOutcomeKind | null
  /** Already out there. No verdict is offered, by construction. */
  readonly landed: boolean
  /** One line, what this is. Model-authored, display-only. */
  readonly headline: string
  /** Why it was produced. Denormalised on the row on purpose, so it survives
   *  rejection — after a person rejects something, "what was it trying to do"
   *  is the only question left worth answering. */
  readonly reason: string
  readonly items: readonly string[]
  readonly body: string | null
  readonly addressedTo: string | null
  readonly where: string | null
  readonly whatYouCanDo: string | null
  readonly verdict: OutcomeVerdict | null
  /** How many changes are waiting below. `document-changes` only. */
  readonly changeCount: number | null
  /**
   * What the second pass said about this whole production, rather than about
   * one change inside it.
   *
   * Display-only, exactly like the per-change findings in `diff.tsx`. These
   * rows have been written since `review@2` gained outcome handles and were
   * rendered by nothing: the only reader was `findings.forChangeset`, which
   * joins through `changeId` and therefore cannot see a finding that cites
   * `O1`. So the reviewer said something true about a collection or a draft and
   * the person never read it.
   *
   * Empty is the normal case and renders nothing — the reviewer not running is
   * a supported outcome, not a degraded one.
   */
  readonly findings: readonly { readonly kind: string; readonly detail: string }[]
}

/* ── the words for each kind ────────────────────────────────────────────── */

/**
 * The kind, said the way a person would say it.
 *
 * CONTEXT.md fixes these — "changes to your document" / "a list" / "an answer"
 * / "a message, unsent" / "something that happened". They are the only place
 * the kind is visible at all; the enum member itself is never rendered.
 */
const KIND_LABEL: Readonly<Record<ShiftOutcomeKind, string>> = {
  'document-changes': 'Changes to your document',
  collection: 'A list',
  answer: 'An answer',
  'message-draft': 'A message, unsent',
  'external-effect': 'Something that happened',
}

const DECIDED: Readonly<Record<OutcomeVerdict, string>> = {
  accept: 'You accepted this.',
  reject: 'You rejected this.',
  edit: 'You reworded this.',
}

/** Above this many items the list is trimmed and the remainder is counted. A
 *  re-entry note a person reads in a minute cannot be forty rates long, and a
 *  count is a truer summary than a scroll. */
const ITEM_LIMIT = 12

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/* ── one outcome ────────────────────────────────────────────────────────── */

export interface OutcomeCardProps {
  readonly outcome: OutcomeView
  readonly index?: number | undefined
  /** A decision is in flight; the controls go quiet rather than double-fire. */
  readonly busy?: boolean | undefined
  readonly onDecide: (id: string, verdict: OutcomeVerdict, editedText?: string) => void
}

const EASE = [0.16, 1, 0.3, 1] as const

export function OutcomeCard({ outcome, index, busy = false, onDecide }: OutcomeCardProps) {
  const still = useReducedMotion()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(outcome.body ?? '')

  const rise = {
    initial: still ? false : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: still
      ? { duration: 0 }
      : { duration: 0.4, delay: Math.min(index ?? 0, 10) * 0.05, ease: EASE },
  }

  const label = outcome.kind === null ? 'Something I made' : KIND_LABEL[outcome.kind]
  // A whole-outcome decision belongs to everything except the document path,
  // whose decidable units are the changes below, and except anything that has
  // already landed, which is not a decision at all.
  const decidable = !outcome.landed && outcome.kind !== 'document-changes'

  return (
    <>
      <Styles />
      <motion.article
        className="po-outcome"
        data-verdict={outcome.verdict ?? ''}
        data-landed={outcome.landed ? 'true' : 'false'}
        aria-label={`${label} — ${outcome.headline}`}
        {...rise}
      >
        <div className="po-head">
          <span className="po-kind">
            <span className="po-mark">
              {outcome.landed ? (
                <Away size={14} title="Already happened" />
              ) : (
                <Wrote size={14} title="Made" />
              )}
            </span>{' '}
            {label}
          </span>
          {outcome.changeCount === null ? null : (
            <span className="po-scale">{count(outcome.changeCount, 'change')} below</span>
          )}
        </div>

        <div className="po-body">
          {outcome.landed ? (
            <p className="po-landed">This already happened, outside Propositum</p>
          ) : null}

          <p className="po-headline">{outcome.headline}</p>

          {outcome.where === null ? null : <p className="po-to">Where: {outcome.where}</p>}
          {outcome.addressedTo === null ? null : (
            <p className="po-to">Written for {outcome.addressedTo}</p>
          )}

          {outcome.items.length === 0 ? null : (
            <>
              <ul className="po-items">
                {outcome.items.slice(0, ITEM_LIMIT).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              {outcome.items.length > ITEM_LIMIT ? (
                <p className="po-more">
                  and {outcome.items.length - ITEM_LIMIT} more, kept with the rest.
                </p>
              ) : null}
            </>
          )}

          {outcome.body === null ? null : <p className="po-text">{outcome.body}</p>}

          {outcome.landed && outcome.whatYouCanDo !== null ? (
            <p className="po-can-do">
              <strong>What you can do about it:</strong> {outcome.whatYouCanDo}
            </p>
          ) : null}

          {outcome.landed && outcome.whatYouCanDo === null ? (
            <p className="po-can-do">
              Propositum cannot undo this, and there is nothing here that would. Whatever happens
              next happens where it happened.
            </p>
          ) : null}

          {/* Deliberately the same words and the same treatment as the
              per-change block in `diff.tsx`. A person reading down the page
              should not have to work out that "a second pass" means the same
              thing in two places — it does, and it is the same reviewer run. */}
          {outcome.findings.length > 0 ? (
            <div className="po-findings">
              <p className="po-findings-head">A second pass flagged this</p>
              <ul>
                {outcome.findings.map((finding, i) => (
                  <li key={`${finding.kind}-${i}`}>{finding.detail}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <p className="po-reason">{outcome.reason}</p>

        {/* The absence below is load-bearing. A landed outcome renders no
            verdict row at all — not a disabled one. See this file's header. */}
        {decidable ? (
          <>
            <div className="po-verdicts">
              {outcome.verdict !== null ? (
                <p className="po-decided">{DECIDED[outcome.verdict]}</p>
              ) : editing ? (
                <p className="po-aside">Write what it should say instead, then save it.</p>
              ) : (
                <>
                  <Button onClick={() => onDecide(outcome.id, 'accept')} disabled={busy}>
                    Accept
                  </Button>
                  <Button onClick={() => onDecide(outcome.id, 'reject')} disabled={busy}>
                    Reject
                  </Button>
                  <Button
                    onClick={() => {
                      setDraft(outcome.body ?? '')
                      setEditing(true)
                    }}
                    disabled={busy}
                  >
                    Edit
                  </Button>
                </>
              )}
            </div>

            {editing && outcome.verdict === null ? (
              <div className="po-editor">
                <label>
                  <span className="po-aside">Your wording</span>
                  <textarea
                    className="po-field"
                    rows={5}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                </label>
                <div className="po-editor-row">
                  <Button
                    variant="primary"
                    disabled={busy || draft.trim() === ''}
                    onClick={() => onDecide(outcome.id, 'edit', draft)}
                    {...(draft.trim() === ''
                      ? {
                          title:
                            'Write what it should say instead — an empty box cannot stand in for it.',
                        }
                      : {})}
                  >
                    Save your wording
                  </Button>
                  <Button disabled={busy} onClick={() => setEditing(false)}>
                    Never mind
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </motion.article>
    </>
  )
}

/* ── the section ────────────────────────────────────────────────────────── */

export interface WhatIMadeProps {
  readonly outcomes: readonly OutcomeView[]
  readonly busy?: boolean | undefined
  readonly onDecide: (id: string, verdict: OutcomeVerdict, editedText?: string) => void
}

/**
 * The one-minute list.
 *
 * Every line of it is read off `ShiftOutcome` rows — the headline and the
 * reason are columns, not prose assembled here and not a model summarising its
 * own ledger on the way past. That is why the reason is denormalised onto the
 * row: this list must render without touching the ledger, and it must go on
 * reading the same after the person has rejected everything in it.
 *
 * Renders nothing when a run produced nothing. A run that completed no work
 * writes no row, and a heading over an empty box would be the interface
 * inventing an absence to report.
 */
export function WhatIMade({ outcomes, busy, onDecide }: WhatIMadeProps) {
  if (outcomes.length === 0) return null

  const landed = outcomes.filter((outcome) => outcome.landed).length

  return (
    <Section
      title={
        landed === 0 ? 'What I made' : `What I made — ${count(landed, 'thing')} already out there`
      }
    >
      {outcomes.map((outcome, i) => (
        <OutcomeCard
          key={outcome.id}
          outcome={outcome}
          index={i}
          {...(busy === undefined ? {} : { busy })}
          onDecide={onDecide}
        />
      ))}
    </Section>
  )
}
