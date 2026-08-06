/**
 * Every capability the worker has. This file is the complete list.
 *
 * ── The invariant this file exists to hold ───────────────────────────────
 *
 * EVERY exported function here takes an `AuthorizedAction` as its first
 * parameter. That token can only come from `authorize()`, so there is no way to
 * reach a tool without passing the gate — not by carelessness, not by a
 * refactor, not by a future contributor who has not read the ADR.
 *
 * `tests/architecture.test.ts` parses this file and fails if an exported
 * function is added without that parameter. The rule is checkable rather than
 * remembered, which is the only kind of rule that survives.
 *
 * ── What is absent, and why absence is the point ─────────────────────────
 *
 * There is no `sendMessage`, no `purchase`, no `publish`, no `deleteFile`, and
 * no `materialiseWorkingCopy`. These are not denied by a rule — they do not
 * exist. A prohibition implemented as a missing capability cannot be
 * misconfigured, and cannot be re-enabled by a policy bug.
 *
 * Implementations are stubs. The gate contract is what #13 owed; wiring these
 * to a fetcher and a document store belongs to the build slices.
 */

import type { AuthorizedAction } from './gate.js'

export interface SourceText {
  readonly approvedSourceId: string
  readonly title: string
  /** Cleaned. Never the raw href. */
  readonly url: string
  /**
   * UNTRUSTED. A page authored this. It may not influence a policy decision,
   * be treated as an instruction, or enter a prompt without datamarking.
   * Bounded to 2,000 characters — a published product constant, not a knob.
   */
  readonly untrustedExcerpt: string
}

export interface DocumentText {
  readonly documentId: string
  readonly versionId: string
  /** Normalised to one sentence per line. */
  readonly content: string
  readonly contentHash: string
}

/** What the worker returns for a drafting step: PROSE, not a patch.
 *  Deterministic code diffs it against the base to produce the changeset, so
 *  the model never asserts what changed — only what the text should say. */
export interface DraftedSection {
  readonly sectionPath: string
  readonly prose: string
}

export function readApprovedSource(
  action: AuthorizedAction<'read-approved-source'>,
): Promise<SourceText> {
  throw new Error(`not implemented: readApprovedSource (intent ${action.intentId})`)
}

export function readDocument(action: AuthorizedAction<'read-document'>): Promise<DocumentText> {
  throw new Error(`not implemented: readDocument (intent ${action.intentId})`)
}

export function draftSection(action: AuthorizedAction<'draft-section'>): Promise<DraftedSection> {
  throw new Error(`not implemented: draftSection (intent ${action.intentId})`)
}
