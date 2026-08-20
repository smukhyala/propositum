/**
 * `section-prose` productions become changes against an immutable base.
 *
 * ── This is a move, not a rewrite ────────────────────────────────────────
 *
 * `sectionsOf`, `replaceSection`, the `diff()` call and the `changesets.create`
 * write came out of `execute-run.ts` unchanged. That was deliberate and it is
 * worth saying so where the next person will look: the document path is the ONE
 * path that already worked, and the regression risk in generalising a spine is
 * that the generalisation quietly breaks the special case it grew out of. So the
 * logic was moved and the tests that cover it were left pointing at the same
 * behaviour.
 *
 * What is genuinely new is one row above the changeset — the `ShiftOutcome` that
 * says *this run produced changes to a document*, so that a consumer asking
 * "what did the shift produce" gets an answer of the same shape whether the
 * answer was a document or not.
 *
 * ── Why a missing base drops rather than throws ──────────────────────────
 *
 * A run can produce `section-prose` with nothing to apply it to: the gate
 * refuses `draft-section` when no base is pinned, but a base pinned at
 * ratification can be gone by the time the run ends, and a browser path that
 * learns to write prose will produce this shape without ever having had one.
 *
 * Throwing would lose the whole run's productions to one unapplicable
 * production. Inventing an empty base and diffing against it would present the
 * entire draft as an insertion into a document nobody has, which is worse than
 * losing it. So it is dropped and COUNTED, and the count is what makes the case
 * visible rather than silent.
 */

import { diff } from '../../domain/document/changeset'
import type { AppContext } from '../db'
import type { OutcomeProposal } from '../../runtime/worker-loop'
import type { OutcomeBody, Production } from './index'

type SectionProse = Extract<OutcomeProposal, { kind: 'section-prose' }>

export interface DocumentBase {
  readonly id: string
  readonly content: string
}

/**
 * Fold every drafted section into one proposed document, diff it against the
 * base, and hold the result as one outcome.
 *
 * One outcome for all of them, not one each: the decidable unit for a document
 * is a `ProposedChange` at character offsets, and `diff()` already produces
 * those. A `ShiftOutcome` per drafted section would put a second, coarser
 * decidable unit beside the one the review fold actually reads.
 */
export function documentChanges(
  productions: readonly SectionProse[],
  base: DocumentBase | null,
  documentTitle: string | undefined,
  contractId: string,
  citable: ReadonlySet<string>,
): Production | null {
  if (productions.length === 0) return null
  if (base === null) return null

  let proposed = base.content
  for (const production of productions) {
    proposed = withSection(proposed, production.section, production.prose)
  }

  const { baseHash, changes } = diff(base.content, proposed, 'Drafted while you were away.')

  // CONTEXT.md's rule, unchanged and now generalised: an empty changeset is no
  // row, and a run with no completed work writes no ShiftOutcome either. A
  // drafting run whose prose matched the base exactly produced nothing, and
  // saying otherwise would put an empty thing on the re-entry screen.
  if (changes.length === 0) return null

  const cited = productions.map((p) => p.intentId).filter((id) => citable.has(id))
  const where = documentTitle === undefined ? 'your document' : documentTitle

  const body: OutcomeBody = {
    headline: `${changes.length} ${changes.length === 1 ? 'change' : 'changes'} to ${where}`,
    reason: 'Drafted while you were away.',
    citedActionIntentIds: cited,
    detail: {
      sections: productions.map((p) => p.section),
      changeCount: changes.length,
    },
  }

  return {
    body,
    consumed: productions.length,
    // Written after the outcome row exists, because `Changeset.outcomeId` points
    // at it. `contractId` stays on the changeset — the review screen finds
    // changes by contract, and the settled-once foreign key from DocumentVersion
    // depends on nothing about this row moving.
    attach: async (ctx: AppContext, outcomeId: string) => {
      await ctx.repos.changesets.create({
        contractId,
        baseVersionId: base.id,
        baseHash,
        outcomeId,
        changes: changes.map((c) => ({
          startOffset: c.startOffset,
          endOffset: c.endOffset,
          prefix: c.prefix,
          exact: c.exact,
          suffix: c.suffix,
          replacement: c.replacement,
          reason: c.reason,
        })),
      })
    },
  }
}

/** Markdown `## ` headings, in order. */
export function sectionsOf(content: string): string[] {
  return content
    .split('\n')
    .filter((l) => /^#{2,3}\s/.test(l.trim()))
    .map((l) => l.replace(/^#+\s*/, '').trim())
}

/** The `## ` heading a change sits under, if the anchor happens to carry one. */
export function sectionTitleFor(exact: string): string | null {
  const heading = /^#{2,3}\s+(.+)$/m.exec(exact)
  return heading?.[1]?.trim() ?? null
}

/**
 * Replace a named section's body with new prose, leaving its heading. Appends
 * when the section does not exist — a worker drafting a section the document
 * lacks is a planning error the reviewer should see, not something to drop.
 *
 * **Exported, and there is exactly one other caller**: `src/eval/run.ts`, which
 * has to turn the same `section-prose` productions into the same proposed
 * document before it can diff them. A second implementation there would be a
 * second definition of what a drafted section does to a document, and the
 * harness would then be measuring a fold the product does not use.
 */
export function withSection(content: string, section: string, prose: string): string {
  const lines = content.split('\n')
  const start = lines.findIndex(
    (l) => /^#{2,3}\s/.test(l.trim()) && l.replace(/^#+\s*/, '').trim() === section,
  )

  if (start === -1) return `${content.trimEnd()}\n\n## ${section}\n\n${prose}\n`

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{2,3}\s/.test(lines[i]!.trim())) {
      end = i
      break
    }
  }

  return [...lines.slice(0, start + 1), '', prose, '', ...lines.slice(end)].join('\n')
}
