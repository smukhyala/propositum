/**
 * Diff, materialise, and refuse on drift.
 *
 * ── The property everything here rests on ────────────────────────────────
 *
 * Review produces DECISIONS, NEVER DOCUMENTS. The base is immutable and a
 * reviewed document is `materialise(base, changes, decisions)` — a pure
 * right-to-left fold.
 *
 * That is what makes plain character offsets into the base safe. Accepting
 * change 3 would shift changes 4..n *if* review mutated a document, but it does
 * not, so every change addresses coordinates that never move. Per-change
 * accept/reject needs no anchoring scheme at all.
 *
 * Heading-path addressing was rejected in ADR-0003: it cannot distinguish two
 * changes inside one section, and renaming a heading is a likely edit in a
 * proposal — so the anchor breaks precisely when the worker does its job well.
 *
 * ── The worker returns prose, not patches ────────────────────────────────
 *
 * `diff()` takes the base and the worker's rewritten prose and computes the
 * changeset itself. The model never asserts what changed, only what the text
 * should say — "models propose, deterministic code authorizes" applied to
 * editing.
 */

import { createHash } from 'node:crypto'
import { linesOf, normalise } from './normalise'

export interface ProposedChange {
  readonly startOffset: number
  readonly endOffset: number
  /** W3C-style quote anchor. Belt-and-braces under refuse-on-drift — if the
   *  base hash matches, the bytes are identical — but it makes a corrupted
   *  changeset detectable rather than silently misapplied. */
  readonly prefix: string
  readonly exact: string
  readonly suffix: string
  readonly replacement: string
  readonly reason: string
  /** Derived once here rather than by each renderer. From the prototype
   *  findings: scale labels carry most of the one-minute triage budget. */
  readonly scale: ChangeScale
}

export interface ChangeScale {
  readonly kind: 'added' | 'removed' | 'edited' | 'rewritten'
  /** "changed 4 words", "rewrote 2 sentences", "added 1 sentence". */
  readonly label: string
  /** 0..1. Below SIMILARITY_FLOOR we stop pretending a block was edited. */
  readonly similarity: number
}

/**
 * Below this, an "edit" is a rewrite and the UI should say so.
 *
 * No differ rescues a wholesale rewrite — showing one as a word-level diff
 * produces the wall of red that fails re-entry. Bounding how much a run may
 * touch is the gate's job (ADR-0004); this is the honest rendering of whatever
 * gets through.
 */
export const SIMILARITY_FLOOR = 0.35

const ANCHOR_CHARS = 32

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/* ── similarity ────────────────────────────────────────────────────────── */

function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
}

/** Dice coefficient over word bigrams. Cheap, and it behaves sensibly on prose
 *  where edit distance over-penalises reordering. */
function similarity(a: string, b: string): number {
  if (a === b) return 1
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 && wb.length === 0) return 1
  if (wa.length === 0 || wb.length === 0) return 0
  if (wa.length === 1 || wb.length === 1) {
    const shared = wa.filter((w) => wb.includes(w)).length
    return (2 * shared) / (wa.length + wb.length)
  }

  const bigrams = (w: string[]) => w.slice(0, -1).map((x, i) => `${x} ${w[i + 1]}`)
  const ba = bigrams(wa)
  const bb = new Map<string, number>()
  for (const g of bigrams(wb)) bb.set(g, (bb.get(g) ?? 0) + 1)

  let shared = 0
  for (const g of ba) {
    const count = bb.get(g) ?? 0
    if (count > 0) {
      shared += 1
      bb.set(g, count - 1)
    }
  }
  return (2 * shared) / (ba.length + bigrams(wb).length)
}

function countWords(text: string): number {
  return words(text).length
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`
}

function scaleOf(removed: string, added: string): ChangeScale {
  const sim = similarity(removed, added)

  if (removed.trim() === '') {
    const sentences = added.split('\n').filter((l) => l.trim()).length
    return { kind: 'added', label: `added ${plural(sentences, 'sentence')}`, similarity: 0 }
  }
  if (added.trim() === '') {
    const sentences = removed.split('\n').filter((l) => l.trim()).length
    return { kind: 'removed', label: `removed ${plural(sentences, 'sentence')}`, similarity: 0 }
  }
  if (sim < SIMILARITY_FLOOR) {
    const sentences = added.split('\n').filter((l) => l.trim()).length
    return { kind: 'rewritten', label: `rewrote ${plural(sentences, 'sentence')}`, similarity: sim }
  }

  // Close enough to show as an edit — count the words that actually moved.
  const before = words(removed)
  const after = words(added)
  const changed = Math.max(Math.abs(after.length - before.length), countDiffering(before, after))
  return { kind: 'edited', label: `changed ${plural(changed, 'word')}`, similarity: sim }
}

function countDiffering(a: readonly string[], b: readonly string[]): number {
  const remaining = new Map<string, number>()
  for (const w of a) remaining.set(w, (remaining.get(w) ?? 0) + 1)
  let unmatched = 0
  for (const w of b) {
    const count = remaining.get(w) ?? 0
    if (count > 0) remaining.set(w, count - 1)
    else unmatched += 1
  }
  return unmatched
}

/* ── diff ──────────────────────────────────────────────────────────────── */

/** Longest common subsequence over lines. Prose normalised to one sentence per
 *  line makes lines the right unit — the alternative, character-level diff over
 *  a whole document, produces changes nobody can review individually. */
function lcsMatrix(a: readonly string[], b: readonly string[]): number[][] {
  const m: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      m[i]![j] = a[i] === b[j] ? m[i + 1]![j + 1]! + 1 : Math.max(m[i + 1]![j]!, m[i]![j + 1]!)
    }
  }
  return m
}

interface Block {
  readonly aStart: number
  readonly aEnd: number
  readonly bStart: number
  readonly bEnd: number
}

/** Contiguous runs where the two line sequences disagree. */
function changedBlocks(a: readonly string[], b: readonly string[]): Block[] {
  const m = lcsMatrix(a, b)
  const blocks: Block[] = []
  let i = 0
  let j = 0
  let open: { aStart: number; bStart: number } | null = null

  const close = () => {
    if (open) {
      blocks.push({ aStart: open.aStart, aEnd: i, bStart: open.bStart, bEnd: j })
      open = null
    }
  }

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      close()
      i += 1
      j += 1
    } else {
      open ??= { aStart: i, bStart: j }
      if (m[i + 1]![j]! >= m[i]![j + 1]!) i += 1
      else j += 1
    }
  }
  if (i < a.length || j < b.length) open ??= { aStart: i, bStart: j }
  i = a.length
  j = b.length
  close()

  return blocks
}

export interface DiffResult {
  readonly baseHash: string
  readonly changes: readonly ProposedChange[]
}

/**
 * Compute a changeset from the base and the worker's prose.
 *
 * Both sides are normalised first, so a difference in wrapping is never
 * mistaken for a difference in content.
 */
export function diff(baseContent: string, proposedProse: string, reason: string): DiffResult {
  const base = normalise(baseContent)
  const proposed = normalise(proposedProse)

  const baseLines = linesOf(base)
  const aTexts = baseLines.map((l) => l.text)
  const bTexts = proposed.split('\n')

  const changes: ProposedChange[] = []

  for (const block of changedBlocks(aTexts, bTexts)) {
    const removedLines = aTexts.slice(block.aStart, block.aEnd)
    const addedLines = bTexts.slice(block.bStart, block.bEnd)

    // An insertion between lines has zero width at the boundary.
    const startOffset =
      block.aStart < baseLines.length
        ? baseLines[block.aStart]!.start
        : (baseLines.at(-1)?.end ?? 0)
    const endOffset =
      block.aEnd > block.aStart ? baseLines[block.aEnd - 1]!.end : startOffset

    const exact = removedLines.join('\n')
    const replacement = addedLines.join('\n')
    if (exact === replacement) continue

    changes.push({
      startOffset,
      endOffset,
      prefix: base.slice(Math.max(0, startOffset - ANCHOR_CHARS), startOffset),
      exact,
      suffix: base.slice(endOffset, endOffset + ANCHOR_CHARS),
      replacement,
      reason,
      scale: scaleOf(exact, replacement),
    })
  }

  return { baseHash: hashContent(base), changes }
}

/* ── materialise ───────────────────────────────────────────────────────── */

export type Verdict = 'accept' | 'reject' | 'edit'

export interface Decision {
  readonly changeIndex: number
  readonly verdict: Verdict
  /** Only meaningful when verdict is `edit`. */
  readonly editedText?: string | undefined
}

/**
 * Apply decisions to the base. Pure — the base is never mutated, and calling
 * this twice with the same arguments gives the same answer.
 *
 * Right-to-left so earlier offsets stay valid as later ones are spliced. That
 * is the whole trick, and it is why accepting change 1 then 3 gives exactly the
 * same document as accepting 3 then 1.
 */
export function materialise(
  baseContent: string,
  changes: readonly ProposedChange[],
  decisions: readonly Decision[],
): string {
  const byIndex = new Map(decisions.map((d) => [d.changeIndex, d]))
  const base = normalise(baseContent)

  const applied = changes
    .map((change, index) => ({ change, index, decision: byIndex.get(index) }))
    .filter((x) => x.decision && x.decision.verdict !== 'reject')
    .sort((a, b) => b.change.startOffset - a.change.startOffset)

  let out = base
  for (const { change, decision } of applied) {
    const text =
      decision!.verdict === 'edit' ? (decision!.editedText ?? change.replacement) : change.replacement
    out = out.slice(0, change.startOffset) + text + out.slice(change.endOffset)
  }
  return out
}

/* ── refuse on drift ───────────────────────────────────────────────────── */

export type DriftCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'base-moved'; readonly expected: string; readonly actual: string }

/**
 * The human is never locked out of their own document (ADR-0003), so the base
 * genuinely can move under a live shift. When it has, the whole changeset is
 * refused rather than merged: **the human's own edit always wins.**
 *
 * Refusing wholesale rather than per-change is deliberate. A partially-valid
 * changeset would need the person to reason about which offsets still mean what
 * they did — exactly the work the one-minute target exists to avoid.
 */
export function checkDrift(currentContent: string, changesetBaseHash: string): DriftCheck {
  const actual = hashContent(normalise(currentContent))
  if (actual === changesetBaseHash) return { ok: true }
  return { ok: false, reason: 'base-moved', expected: changesetBaseHash, actual }
}
