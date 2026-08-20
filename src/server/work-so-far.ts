/**
 * *Where you left off*, assembled once for every screen that shows it.
 *
 * ── Why this is a file and not four lines in each caller ─────────────────
 *
 * The same argument `front-door.ts` opens with, and it applies harder here
 * because there are three callers rather than two: the accept screen, the
 * project screen, and the drafting path that decides which words a person is
 * asked to ratify. Four lines of epoch conversion repeated three times is three
 * chances for one of them to convert a different set of rows — and the failure
 * would be a screen quietly showing a different account of the same work from
 * the one the pre-fill was chosen against.
 *
 * ── The conversion is the app layer's job, and that is deliberate ────────
 *
 * `workSoFar` is a pure function of counts and epoch milliseconds because
 * `src/domain/**` may never read the clock and may never learn that Prisma
 * exists. So `Date` → number happens here, at the boundary, exactly as
 * `frontDoorRow` does it for `intentionState`. The domain names no table; this
 * file names no component.
 *
 * ── What this may not become ─────────────────────────────────────────────
 *
 * A reader in the run. `WorkSoFar` **may inform a person; it may not inform a
 * decision** — the same posture a `BusyInterval` has under ADR-0014. It does not
 * reach `compilePolicy`, it does not reach `src/policy/gate.ts`, and it is not
 * interpolated into any prompt in `src/model/boundaries/`. The moment it is, it
 * stops being a display and becomes context a model acts on, and ADR-0017's
 * whole argument for why this does not reverse ADR-0011 has to be re-made
 * against prompt injection reaching it through the rows it folds.
 */

import { workSoFar } from '../domain/intention/work-so-far'
import type { WorkSoFar } from '../domain/intention/work-so-far'
import type { WorkSoFarRows } from '../persistence/repositories/index'
import { appContext } from './db'

/** The Intention's own words, and when a person last wrote them. Carried beside
 *  the fold because the two callers that want one usually want both, and going
 *  back for the second is a second read of the same row. */
export interface WhereYouLeftOff {
  readonly intentionId: string
  readonly objective: string
  readonly definitionOfDone: string
  readonly wordsWrittenAtEpochMs: number
  readonly view: WorkSoFar
}

/**
 * The rows, converted at this boundary and nowhere else.
 *
 * Exported separately from the two lookups below so a test can hand it rows
 * without a database — the same split `frontDoorRow` has, and for the same
 * reason: the arithmetic is the part worth holding, and it is unreachable
 * through a function that opens a connection first.
 */
export function whereYouLeftOff(rows: WorkSoFarRows, nowEpochMs: number): WhereYouLeftOff {
  return {
    intentionId: rows.intentionId,
    objective: rows.objective,
    definitionOfDone: rows.definitionOfDone,
    wordsWrittenAtEpochMs: rows.wordsWrittenAt.getTime(),
    view: workSoFar(
      {
        sittingsEndedAtEpochMs: rows.sittingsEndedAt.map((at) =>
          at === null ? null : at.getTime(),
        ),
        approvedSources: rows.approvedSources,
        documents: rows.documents,
        produced: rows.produced,
        changeVerdicts: rows.changeVerdicts,
        openQuestions: rows.openQuestions,
        lastStop: rows.lastStop,
      },
      nowEpochMs,
    ),
  }
}

/**
 * For one Intention, by id. What the drafting path holds.
 *
 * Null when there is no such Intention, which is ordinary: `WorkSession.
 * intentionId` is nullable and nothing backfills it, so every sitting recorded
 * before ADR-0011 and every degraded acceptance since has none.
 */
export async function whereYouLeftOffOn(
  intentionId: string | null,
  nowEpochMs: number,
): Promise<WhereYouLeftOff | null> {
  if (intentionId === null) return null

  const { repos } = await appContext()
  const rows = await repos.intentions.workSoFarFacts(intentionId)
  return rows === null ? null : whereYouLeftOff(rows, nowEpochMs)
}

/**
 * For one Project. What both screens hold.
 *
 * Two reads rather than one, and the join is `intentions.forProject` rather than
 * a `projectId` parameter on the query itself. That is ADR-0017's scoping
 * followed literally: `WorkSoFar` is scoped by Intention, which is the same set
 * as *by Project* only while `Intention.projectId` is `@unique`. A reader that
 * took a projectId would answer the wrong question silently on the day a second
 * Intention per Project lands, and *which Intention does this sitting belong to*
 * is the question that deferral exists to avoid asking.
 */
export async function whereYouLeftOffIn(
  projectId: string,
  nowEpochMs: number,
): Promise<WhereYouLeftOff | null> {
  const { repos } = await appContext()
  const intention = await repos.intentions.forProject(projectId)
  if (intention === null) return null

  const rows = await repos.intentions.workSoFarFacts(intention.id)
  return rows === null ? null : whereYouLeftOff(rows, nowEpochMs)
}
