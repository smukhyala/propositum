/**
 * What a ratified contract gives a run to work with — resolved once, in one
 * place, before the worker starts.
 *
 * ── Why this is not inline in `execute-run` any more ─────────────────────
 *
 * It used to be four statements at the top of `executeRun`: look up the version,
 * look up the document, list the sources, split the content on headings. Read in
 * order they said, plainly, *a run works on a document* — and everything below
 * them inherited that. The changeset branch could assume a base existed because
 * the lookup above had insisted on one.
 *
 * Pulling it out is not tidying. It puts the document-shaped knowledge behind a
 * function whose return type says *maybe*, so the caller has to hold both cases,
 * and it keeps the Markdown out of the file that must not know about Markdown.
 *
 * ── `base` may be null, and that is a state rather than a failure ────────
 *
 * `HandoffContract.baseVersionId` is nullable, so there are two distinct absent
 * cases and they are not the same:
 *
 *   - **nothing was pinned.** A browser handoff, an answer, a collection. There
 *     is no document, nobody expected one, and the gate refuses `read-document`
 *     and `draft-section` with `no_document_pinned`.
 *   - **something was pinned and has gone.** The version row is missing. The
 *     gate refuses with `document_missing` instead, which is a different
 *     sentence to a person and should stay one.
 *
 * Both arrive here as `base: null`, and the difference survives in `documentId`:
 * absent in the first case because nothing was ever pinned, absent in the second
 * because the pin no longer resolves. The gate reads `documentBasePinned` off
 * the scope, which still carries the id, so it can tell the two apart. This
 * function does not need to.
 */

import type { AppContext } from '../db'
import type { ShiftOutcomeKind } from '../../domain/execution/shift-outcome'
import { sectionsOf } from './document-changes'

export interface WorkspaceSource {
  readonly id: string
  readonly label: string
  readonly originPattern: string
}

export interface Workspace {
  readonly sources: readonly WorkspaceSource[]
  /** The immutable base this Shift may change, if it pins one. */
  readonly base: { id: string; documentId: string; content: string } | null
  /** The real `Document.id` behind `base`. Rides separately because the worker
   *  needs it for the gate's document rules and must never be handed a version
   *  id under a key that means a document — the defect wave 1 fixed. */
  readonly documentId: string | undefined
  /** Shown to a PERSON, in an outcome headline — never to the worker, which
   *  reads `context` instead and cannot tell a title from any other fact. */
  readonly documentTitle: string | undefined
  /** One-line facts, in the words the app process chose. See `WorkerJob.context`
   *  for why this is prose rather than structure. */
  readonly context: readonly string[]
  /** Derived from the contract, never asked of a model. */
  readonly expects: readonly ShiftOutcomeKind[]
}

interface ContractFacts {
  readonly approvedSourceIds: readonly string[]
  readonly baseVersionId: string | null
}

export async function loadWorkspace(ctx: AppContext, contract: ContractFacts): Promise<Workspace> {
  const base =
    contract.baseVersionId === null ? null : await ctx.repos.documents.version(contract.baseVersionId)
  const holder = base ? await ctx.repos.documents.byId(base.documentId) : null

  const sources = await ctx.db.prisma.approvedSource.findMany({
    where: { id: { in: [...contract.approvedSourceIds] } },
    select: { id: true, label: true, originPattern: true },
  })

  return {
    sources,
    base: base ? { id: base.id, documentId: base.documentId, content: base.content } : null,
    documentId: holder?.id,
    documentTitle: holder?.title,
    context: contextFor(holder?.title, base?.content),
    expects: expectedKindsOf(contract),
  }
}

/**
 * The facts, as sentences.
 *
 * A shift with nothing pinned gets an EMPTY list rather than a placeholder. The
 * old code sent `documentTitle: document?.title ?? 'the document'`, which meant
 * a run with no document was told it had one called "the document" — a sentence
 * about a thing that did not exist, in the one prompt whose job is to plan
 * against what does.
 */
function contextFor(title: string | undefined, content: string | undefined): string[] {
  if (title === undefined || content === undefined) return []

  const sections = sectionsOf(content)
  return [
    `Document: ${title}`,
    `Sections: ${sections.length ? sections.join(', ') : '(none yet)'}`,
  ]
}

/**
 * What shape of result this contract is after.
 *
 * ── Derived from the capability, not from a wish ─────────────────────────
 *
 * A pinned base version IS the document capability: the gate grants
 * `read-document` and `draft-section` if and only if one exists, so
 * `document-changes` is expected exactly when one is pinned. That is a fact
 * about what the run can do, read off the same field the gate reads, rather than
 * a second stored intention that could disagree with it.
 *
 * ── And `answer` when nothing is pinned, which is a guess ────────────────
 *
 * Said plainly because it deserves to be doubted. A shift that pins no document
 * could honestly be after a collection, a message draft, or an effect out in the
 * world, and nothing on `HandoffContract` distinguishes them — the column that
 * would, `WorkOffer.expectedKinds`, belongs to an offer that no code writes yet.
 *
 * `answer` is chosen as the default because it is the only one of the four that
 * is true of ALL of them: a run that collected rates has also answered a
 * question, and a run that drafted a message has too. Guessing `collection`
 * would tell a planner to build a table when it was asked for a sentence. This
 * costs a slightly vague instruction; the alternative costs a confidently wrong
 * one.
 *
 * When the accept path starts writing offers, this should read `expectedKinds`
 * off the offer for the session and fall back to here.
 */
export function expectedKindsOf(contract: ContractFacts): readonly ShiftOutcomeKind[] {
  return contract.baseVersionId === null ? ['answer'] : ['document-changes']
}
