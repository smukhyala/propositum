/**
 * Every capability the worker has. This file is the complete list.
 *
 * ── The invariant this file exists to hold ───────────────────────────────
 *
 * EVERY exported tool takes an `AuthorizedAction` as its first parameter. That
 * token can only come from `authorize()`, so there is no way to reach a tool
 * without passing the gate — not by carelessness, not by a refactor, not by a
 * future contributor who has not read the ADR.
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
 * ── Dependencies are passed, not imported ────────────────────────────────
 *
 * Each tool takes its collaborators as an explicit second argument. A tool that
 * reached for a module-level fetcher or database would be a tool that could be
 * called anywhere, and the whole point is that it can only be called from a
 * gated worker loop holding real dependencies.
 */

import type { AuthorizedAction } from './gate'
import type { SourceFetcher } from './fetcher'

export interface SourceText {
  readonly approvedSourceId: string
  readonly title: string
  /** Cleaned. Never the raw href. */
  readonly url: string
  /**
   * RAW page text, bounded by the fetcher.
   *
   * Deliberately NOT datamarked here. The ledger writer is the one door that
   * sanitises (#35), and marking it twice would either double-fence it or
   * tempt a caller into treating this as already safe. It is not safe: it is
   * page-authored, and the type name says so.
   */
  readonly untrustedText: string
}

export interface DocumentText {
  readonly documentId: string
  readonly versionId: string
  /** Normalised to one sentence per line. */
  readonly content: string
  readonly contentHash: string
}

/** What the worker returns for a drafting step: PROSE, not a patch.
 *  Deterministic code diffs it against the base, so the model never asserts
 *  what changed — only what the text should say. */
export interface DraftedSection {
  readonly sectionPath: string
  readonly prose: string
}

/* ── collaborators ─────────────────────────────────────────────────────── */

export interface SourceLookup {
  /** Resolve an approved source id to the URL it stands for. */
  urlFor(approvedSourceId: string): Promise<string | null>
}

export interface VersionLookup {
  /** Read a pinned version. Never "the current document" — the base is fixed
   *  for the whole shift, and reading live content would let a mid-run human
   *  edit silently change what the worker is drafting against. */
  byId(versionId: string): Promise<{ id: string; documentId: string; content: string; contentHash: string } | null>
}

export interface ReadSourceDeps {
  readonly fetcher: SourceFetcher
  readonly sources: SourceLookup
}

export interface ReadDocumentDeps {
  readonly versions: VersionLookup
  /** The version pinned by `ContractScope.baseVersionId`. Passed in rather than
   *  looked up from the action, so a tool cannot be pointed at another version. */
  readonly baseVersionId: string
}

/* ── the three ─────────────────────────────────────────────────────────── */

export async function readApprovedSource(
  action: AuthorizedAction<'read-approved-source'>,
  deps: ReadSourceDeps,
): Promise<SourceText> {
  const id = action.params.approvedSourceId
  if (!id) throw new Error(`authorized read-approved-source with no source id (${action.intentId})`)

  const url = await deps.sources.urlFor(id)
  if (!url) throw new Error(`approved source ${id} has no URL`)

  // The fetcher re-checks the allowlist against the URL actually being
  // requested, closing the gap between "we authorised source X" and
  // "we fetched X".
  const page = await deps.fetcher.fetch(url)

  return {
    approvedSourceId: id,
    title: page.title,
    url: page.url,
    untrustedText: page.text,
  }
}

export async function readDocument(
  action: AuthorizedAction<'read-document'>,
  deps: ReadDocumentDeps,
): Promise<DocumentText> {
  // The action's documentId is checked against the pinned base rather than
  // trusted: the gate authorised reading *the document*, and the base version
  // is what that means for the duration of this shift.
  const version = await deps.versions.byId(deps.baseVersionId)
  if (!version) throw new Error(`base version ${deps.baseVersionId} not found`)

  const requested = action.params.documentId
  if (requested && requested !== version.documentId) {
    throw new Error(
      `authorized read-document for ${requested}, but this shift is pinned to ${version.documentId}`,
    )
  }

  return {
    documentId: version.documentId,
    versionId: version.id,
    content: version.content,
    contentHash: version.contentHash,
  }
}

export function draftSection(action: AuthorizedAction<'draft-section'>): DraftedSection {
  const sectionPath = action.params.sectionPath
  const prose = action.params.text

  if (!sectionPath) throw new Error(`authorized draft-section with no section (${action.intentId})`)
  if (prose === undefined) throw new Error(`authorized draft-section with no prose (${action.intentId})`)

  // Nothing is written here. The worker returns prose; deterministic code
  // computes the changeset and the human decides. "Drafting" is a proposal.
  return { sectionPath, prose }
}
