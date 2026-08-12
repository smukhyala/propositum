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
  /**
   * The version pinned by `ContractScope.baseVersionId`. Passed in rather than
   * looked up from the action, so a tool cannot be pointed at another version.
   *
   * OPTIONAL, because a Shift can pin no document at all. That case never
   * reaches here — the gate refuses `read-document` with `no_document_pinned`
   * before any tool runs — so the guard below is the second fence, and it names
   * the condition rather than failing on a lookup for an empty id. A sentinel
   * empty string would have kept the type simple and made the eventual error
   * read as "version '' not found", which describes a corrupted pin rather than
   * an absent one.
   */
  readonly baseVersionId?: string | undefined
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

/**
 * Read the document, meaning the version this shift is pinned to.
 *
 * ── Why `action.params.documentId` is not consulted at all ───────────────
 *
 * It used to be. This compared the param against `version.documentId` and threw
 * when they differed, and the mismatch was described as the safeguard that kept
 * a shift from being pointed at another document.
 *
 * It was not a safeguard, and it never once let a read through. The only caller
 * put `ContractScope.baseVersionId` in that param — a `DocumentVersion` id being
 * compared against a `Document` id, two different rows that can never be equal.
 * So every planned document read passed the gate, committed an `ActionIntent`,
 * threw, and was recorded as a failed `ActionOutcome` with an `unverified`
 * scope verdict. A capability that had never succeeded looked, in the ledger,
 * exactly like a capability that kept going wrong.
 *
 * Deleting the check rather than fixing the id it was fed is the stronger
 * choice, because the check could not add anything even when correct. What is
 * read is `deps.baseVersionId`, which comes from the ratified contract and is
 * passed in for precisely this reason: there is no argument to this function
 * that can move it. A param that cannot change the outcome can only ever
 * disagree with it, and disagreeing was the whole failure.
 *
 * The gate still requires `documentId` on a `read-document` proposal, and that
 * requirement now bites for real — `src/runtime/worker-loop.ts` passes the
 * shift's actual `Document` id, so `document_missing` refuses a run that has no
 * document instead of being unreachable.
 */
export async function readDocument(
  _action: AuthorizedAction<'read-document'>,
  deps: ReadDocumentDeps,
): Promise<DocumentText> {
  const base = deps.baseVersionId
  if (base === undefined || base === '') {
    throw new Error(`authorized read-document on a shift that pins no document (${_action.intentId})`)
  }

  const version = await deps.versions.byId(base)
  if (!version) throw new Error(`base version ${base} not found`)

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
