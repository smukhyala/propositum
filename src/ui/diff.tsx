/**
 * One proposed change, rendered so a person can decide on it in seconds.
 *
 * ── Colour is never the only carrier ─────────────────────────────────────
 *
 * `<ins>` and `<del>` are not announced by most screen readers, and a diff that
 * reads only in colour fails WCAG 1.4.1 at Level A (re-entry finding 10,
 * PRODUCT_PRINCIPLES §10). So every added or removed run carries three signals:
 * a `+`/`−` glyph, a strike-through or an underline, and visually-hidden
 * "added:" / "removed:" text inside the accessible name. Take the colour away
 * and the diff still reads.
 *
 * The palette is the one in globals.css and nothing else. There is no
 * `--added` / `--removed` pair there yet, so added text is the accent and
 * removed text is muted-and-struck rather than green and red. That is a
 * deliberate restraint, not an oversight — see the report.
 *
 * ── A rewrite is not an edit, and we stop pretending ─────────────────────
 *
 * Below `SIMILARITY_FLOOR` the changeset labels a block `rewritten`
 * (src/domain/document/changeset.ts). A word-level diff of a rewrite is the
 * wall of red that fails re-entry, so at that scale this stops interleaving and
 * shows the new text plainly, with the old text behind a real disclosure —
 * a `<details>`, keyboard-reachable, because re-entry finding 9 rules out
 * hover-only explanations.
 *
 * ── Scale labels are read, never computed ────────────────────────────────
 *
 * "changed 4 words" / "rewrote 2 sentences" carry most of the one-minute triage
 * budget, and they are already derived once, deterministically, on the change.
 * Nothing here recomputes them.
 *
 * ── There is no per-change Edit ──────────────────────────────────────────
 *
 * `ChangeVerdict` supports `edited`, and re-entry finding 6 is that building it
 * turns the report into a small text editor. Accept and reject only; rewording
 * belongs in the document. Said out loud in the interface rather than left as
 * an absence.
 */

'use client'

import { motion, useReducedMotion } from 'motion/react'
import { Button, VisuallyHidden } from './primitives'

/* ── the one stylesheet ─────────────────────────────────────────────────── */

const CSS = `
.pd-change { border: 1px solid var(--rule); background: var(--raised); margin-bottom: 1rem; }
.pd-change[data-verdict="accept"] { border-color: var(--accent); }
.pd-change[data-verdict="reject"] { opacity: 0.6; }

.pd-head { display: flex; flex-wrap: wrap; gap: 0.4rem 1rem; align-items: baseline; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid var(--rule); }
.pd-where { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.pd-scale { font-size: 0.75rem; color: var(--faint); font-variant-numeric: tabular-nums; }

.pd-body { padding: 0.875rem 1rem; font-size: 0.9375rem; overflow-x: auto; }
.pd-text { margin: 0; white-space: pre-wrap; }

.pd-del, .pd-ins { text-decoration: none; padding: 0.05em 0.2em; border-radius: 2px; }
.pd-del { background: var(--ground); color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; }
.pd-ins { background: var(--accent-soft); color: var(--ink); box-shadow: inset 0 -1px 0 var(--accent); }
.pd-del::before, .pd-ins::before { font-family: var(--mono); font-size: 0.75em; font-weight: 700; margin-right: 0.2em; }
.pd-del::before { content: "\\2212"; }
.pd-ins::before { content: "+"; }

.pd-flag { margin: 0 0 0.55rem; font-family: var(--sans); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--attention); }
.pd-prev { margin: 0.75rem 0 0; }
.pd-prev summary { cursor: pointer; font-size: 0.8125rem; color: var(--muted); }
.pd-prev summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 2px; }
.pd-prev-text { margin: 0.5rem 0 0; color: var(--muted); text-decoration: line-through; text-decoration-thickness: 1px; white-space: pre-wrap; }

.pd-reason { margin: 0; padding: 0.625rem 1rem; border-top: 1px dashed var(--rule); font-size: 0.8125rem; color: var(--muted); }
.pd-verdicts { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; padding: 0.75rem 1rem; border-top: 1px solid var(--rule); }
.pd-aside { font-size: 0.8125rem; color: var(--faint); margin: 0; }
.pd-decided { font-size: 0.8125rem; color: var(--muted); margin: 0; }
`

function Styles() {
  return (
    <style href="propositum-diff" precedence="default">
      {CSS}
    </style>
  )
}

/* ── the word diff ──────────────────────────────────────────────────────── */

/**
 * A word and the whitespace after it, as one token.
 *
 * Not word and space separately: the spaces then match each other across an
 * otherwise total rewrite, and the diff comes out as alternating one-word
 * fragments — "−the +Q3 −first +2026" — which is unreadable and wrong about
 * what happened. Keeping the space attached makes a replaced phrase come out
 * as one removal and one addition, and unchanged prose still rejoins byte for
 * byte, because Propositum never reformats what the person wrote.
 */
function tokenise(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? []
}

type Piece = { readonly kind: 'same' | 'added' | 'removed'; readonly text: string }

/**
 * Above this many tokens on either side, the word diff is abandoned and the two
 * texts are shown whole. The matrix is O(n·m); the gate bounds blast radius
 * (ADR-0004) so this should never fire, and if it does, a slow page is the
 * wrong way to find out.
 */
const WORD_DIFF_LIMIT = 600

function wordDiff(before: string, after: string): Piece[] {
  const a = tokenise(before)
  const b = tokenise(after)

  if (a.length > WORD_DIFF_LIMIT || b.length > WORD_DIFF_LIMIT) {
    return merge([
      { kind: 'removed', text: before },
      { kind: 'added', text: after },
    ])
  }

  // Longest common subsequence, walked forwards from the top-left.
  const m: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      m[i]![j] = a[i] === b[j] ? m[i + 1]![j + 1]! + 1 : Math.max(m[i + 1]![j]!, m[i]![j + 1]!)
    }
  }

  const pieces: Piece[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pieces.push({ kind: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (m[i + 1]![j]! >= m[i]![j + 1]!) {
      pieces.push({ kind: 'removed', text: a[i]! })
      i += 1
    } else {
      pieces.push({ kind: 'added', text: b[j]! })
      j += 1
    }
  }
  while (i < a.length) {
    pieces.push({ kind: 'removed', text: a[i]! })
    i += 1
  }
  while (j < b.length) {
    pieces.push({ kind: 'added', text: b[j]! })
    j += 1
  }

  return merge(pieces)
}

/** Adjacent pieces of one kind become one, so "+ the + first + quarter" reads
 *  as one added phrase rather than three glyphs in a row. */
function merge(pieces: readonly Piece[]): Piece[] {
  const out: Piece[] = []
  for (const piece of pieces) {
    const last = out[out.length - 1]
    if (last && last.kind === piece.kind) out[out.length - 1] = { kind: last.kind, text: last.text + piece.text }
    else out.push(piece)
  }
  // Whitespace-only runs marked added or removed are noise; fold them into the
  // surrounding text so a changed line break does not read as a changed word.
  return out.filter((p) => p.kind === 'same' || p.text.trim() !== '')
}

/* ── the pieces, rendered ───────────────────────────────────────────────── */

export interface InlineDiffProps {
  readonly before: string
  readonly after: string
}

/** Word-level, three-signal. Exported because the drifted-shift screen may one
 *  day want to show what was proposed without offering a decision on it. */
export function InlineDiff({ before, after }: InlineDiffProps) {
  return (
    <>
      <Styles />
      <p className="pd-text">
        {wordDiff(before, after).map((piece, index) => {
          if (piece.kind === 'same') return <span key={index}>{piece.text}</span>
          if (piece.kind === 'added') {
            return (
              <ins className="pd-ins" key={index}>
                <VisuallyHidden>added: </VisuallyHidden>
                {piece.text}
              </ins>
            )
          }
          return (
            <del className="pd-del" key={index}>
              <VisuallyHidden>removed: </VisuallyHidden>
              {piece.text}
            </del>
          )
        })}
      </p>
    </>
  )
}

/* ── one change ─────────────────────────────────────────────────────────── */

export type ChangeVerdict = 'accept' | 'reject' | 'edit'

export interface ChangeView {
  readonly id: string
  /**
   * The nearest heading above this change in the version you left. Derived at
   * render time from the base text — it is orientation, never an address. The
   * address is the offset pair, which is why renaming a heading cannot move a
   * change.
   */
  readonly where: string | null
  /** "changed 4 words". Computed once on the change; never recomputed here. */
  readonly scaleLabel: string
  readonly scaleKind: 'added' | 'removed' | 'edited' | 'rewritten'
  /** Exact bytes from the version you left. */
  readonly before: string
  readonly after: string
  /** One sentence, why. Survives rejection, because the row is immutable and
   *  the verdict is a separate row. */
  readonly reason: string
  /** The decision already recorded, if there is one. */
  readonly verdict: ChangeVerdict | null
}

export interface ChangeCardProps {
  readonly change: ChangeView
  readonly index?: number | undefined
  /** A decision is in flight; both controls go quiet rather than double-fire. */
  readonly busy?: boolean | undefined
  readonly onDecide: (id: string, verdict: 'accept' | 'reject') => void
}

const EASE = [0.16, 1, 0.3, 1] as const

const DECIDED: Record<ChangeVerdict, string> = {
  accept: 'You accepted this.',
  reject: 'You rejected this.',
  edit: 'You reworded this.',
}

export function ChangeCard({ change, index, busy = false, onDecide }: ChangeCardProps) {
  const still = useReducedMotion()
  const rise = {
    initial: still ? false : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: still
      ? { duration: 0 }
      : { duration: 0.4, delay: Math.min(index ?? 0, 10) * 0.05, ease: EASE },
  }

  const decided = change.verdict !== null

  return (
    <>
      <Styles />
      <motion.article
        className="pd-change"
        data-verdict={change.verdict ?? ''}
        aria-label={`${change.where ?? 'The document'} — ${change.scaleLabel}`}
        {...rise}
      >
        <div className="pd-head">
          <span className="pd-where">{change.where ?? 'Before the first heading'}</span>
          <span className="pd-scale">{change.scaleLabel}</span>
        </div>

        <div className="pd-body">
          <Body change={change} />
        </div>

        <p className="pd-reason">{change.reason}</p>

        <div className="pd-verdicts">
          {decided ? (
            <p className="pd-decided">{DECIDED[change.verdict!]}</p>
          ) : (
            <>
              <Button
                onClick={() => onDecide(change.id, 'accept')}
                disabled={busy}
                {...(busy ? { title: 'Just a moment — the last decision is still being recorded.' } : {})}
              >
                Accept
              </Button>
              <Button
                onClick={() => onDecide(change.id, 'reject')}
                disabled={busy}
                {...(busy ? { title: 'Just a moment — the last decision is still being recorded.' } : {})}
              >
                Reject
              </Button>
              <p className="pd-aside">To reword it, open the document.</p>
            </>
          )}
        </div>
      </motion.article>
    </>
  )
}

/**
 * Four shapes, because pretending they are one shape is what produces the
 * unreadable diff. An insertion has no "before" to strike through; a rewrite
 * has nothing useful to interleave.
 */
function Body({ change }: { readonly change: ChangeView }) {
  if (change.scaleKind === 'rewritten') {
    return (
      <>
        <p className="pd-flag">Rewritten — new text, not an edit</p>
        <p className="pd-text">{change.after}</p>
        <details className="pd-prev">
          <summary>What was there before</summary>
          <p className="pd-prev-text">
            <VisuallyHidden>removed: </VisuallyHidden>
            {change.before}
          </p>
        </details>
      </>
    )
  }

  if (change.scaleKind === 'added' || change.before.trim() === '') {
    return (
      <p className="pd-text">
        <ins className="pd-ins">
          <VisuallyHidden>added: </VisuallyHidden>
          {change.after}
        </ins>
      </p>
    )
  }

  if (change.scaleKind === 'removed' || change.after.trim() === '') {
    return (
      <p className="pd-text">
        <del className="pd-del">
          <VisuallyHidden>removed: </VisuallyHidden>
          {change.before}
        </del>
      </p>
    )
  }

  return <InlineDiff before={change.before} after={change.after} />
}
