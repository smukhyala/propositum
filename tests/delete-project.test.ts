/**
 * Deleting a project takes everything filed under it — ADR-0038.
 *
 * ── What this file is actually for ───────────────────────────────────────
 *
 * The cascade in `projectRepository.deleteWithEverything` is thirty-one
 * statements in a hand-written order, and the two ways it can be wrong are both
 * silent:
 *
 *   - **An under-delete.** A table nobody remembered leaves rows behind whose
 *     parent is gone. Nothing complains, no screen renders them, and the person
 *     believes their job search is off the machine when part of it is not. This
 *     is the one that matters, and it is why the sweep below counts rows in
 *     EVERY table rather than in the ones the author thought of — a new table
 *     added to the schema and forgotten in the cascade fails here.
 *   - **An over-delete.** A relation filter that walks one hop too far takes a
 *     second project's rows with it. `survives an unrelated project untouched`
 *     is the whole of that.
 *
 * A failed delete leaving everything is the third, and it is the one a person
 * meets rather than reads about: a half-deleted project leaves an Intention
 * with no Project, which already exists once in the author's own database,
 * renders on no screen, and cannot be removed.
 *
 * ── What it does not cover ───────────────────────────────────────────────
 *
 * That the file on disk gets smaller. SQLite reuses freed pages and does not
 * return them to the filesystem without a VACUUM, so a shrinking file is not a
 * thing to assert here — `docs/todo/13-deleting-a-project.md` names checking it
 * by hand as the part nothing can assert, and it is still true.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureAppendOnlyGuards } from '../src/persistence/append-only'
import { createRepositories } from '../src/persistence/repositories'

let dir: string
let prisma: PrismaClient

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-delete-'))
  const url = `file:${join(dir, 'test.db')}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  prisma = new PrismaClient({ datasources: { db: { url } } })
  // The guards have to be installed, not assumed: this test is meaningless
  // against a database where the delete would have succeeded anyway.
  await ensureAppendOnlyGuards(prisma)
  nextExternalSeq = 1
})

afterEach(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * A project with one of everything the cascade has to reach.
 *
 * Not a realistic session — a realistic session would exercise fewer tables.
 * The point is breadth: one row in each branch, so a missing statement in the
 * cascade shows up as a row left behind rather than as nothing at all.
 */
/** `ExternalEvent.seq` is globally unique, not per-project. */
let nextExternalSeq = 1

async function buildProject(name: string) {
  const project = await prisma.project.create({ data: { name } })

  const intention = await prisma.intention.create({
    data: {
      projectId: project.id,
      objective: `finish ${name}`,
      definitionOfDone: 'it is done',
      updatedAt: new Date(0),
    },
  })

  // The second ledger. Hangs off the Intention rather than the Project, which
  // is the thing ADR-0034 could not answer on its own.
  await prisma.externalEvent.create({
    data: {
      seq: nextExternalSeq++,
      statedBy: 'declared',
      occurredAt: new Date(0),
      elapsedMs: 0,
      kind: 'arrived',
      intentionId: intention.id,
    },
  })

  const source = await prisma.approvedSource.create({
    data: { projectId: project.id, originPattern: 'https://example.com/*', label: 'Example' },
  })

  const session = await prisma.workSession.create({
    data: { projectId: project.id, intentionId: intention.id },
  })

  const event = await prisma.observationEvent.create({
    data: {
      sessionId: session.id,
      seq: 1,
      observedAt: new Date(0),
      elapsedMs: 0,
      kind: 'visited',
      attested: { title: 'a page' },
      approvedSourceId: source.id,
    },
  })

  const reading = await prisma.sessionReading.create({
    data: { sessionId: session.id, throughSeq: 1 },
  })
  const claim = await prisma.sessionClaim.create({
    data: { readingId: reading.id, kind: 'objective', text: 'they were doing a thing', ordinal: 0 },
  })
  await prisma.evidence.create({ data: { claimId: claim.id, eventId: event.id } })

  await prisma.workOffer.create({
    data: {
      sessionId: session.id,
      threadSignature: `sig-${name}`,
      promptVersion: 'offer@1',
      title: 'An offer',
      rationale: 'because',
      outline: ['one'],
      produces: 'an answer',
      excludes: [],
      originPatterns: ['https://example.com/*'],
      expectedKinds: ['answer'],
      grounds: { pages: 3 },
    },
  })

  const document = await prisma.document.create({
    data: { projectId: project.id, title: `${name} notes` },
  })
  const version = await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      ordinal: 0,
      contentHash: 'hash',
      content: '# notes',
      origin: 'human',
    },
  })

  const contract = await prisma.handoffContract.create({
    data: {
      sessionId: session.id,
      readingId: reading.id,
      intentionId: intention.id,
      baseVersionId: version.id,
      objective: 'do the thing',
      definitionOfDone: 'the thing is done',
      guidance: [],
      approvedSourceIds: [source.id],
      allowedActionKinds: ['draft-section'],
      initiative: 'follow-closely',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    },
  })

  const run = await prisma.agentRun.create({ data: { contractId: contract.id, role: 'worker' } })
  const step = await prisma.planStep.create({
    data: { runId: run.id, ordinal: 0, intent: 'draft' },
  })
  const intent = await prisma.actionIntent.create({
    data: {
      runId: run.id,
      stepId: step.id,
      seq: 1,
      kind: 'draft-section',
      reason: 'the plan said so',
      params: {},
      authorized: true,
    },
  })
  await prisma.actionOutcome.create({
    data: { intentId: intent.id, result: 'ok', scopeVerdict: 'in-scope' },
  })
  await prisma.modelCallRecord.create({
    data: {
      runId: run.id,
      boundary: 'worker-action',
      promptVersion: 'worker-action@3',
      model: 'claude-opus-5',
      latencyMs: 10,
      inputTokens: 1,
      outputTokens: 1,
    },
  })

  /* ── the rest of the run's products ────────────────────────────────────
   *
   * Everything below exists so the row sweep is a statement about the CASCADE
   * rather than about this fixture. The first version of this file stopped at
   * the ActionIntent, and `leaves not one row behind` passed with thirteen
   * tables empty — which would have gone green for a cascade that never
   * mentioned them. Each of these is one row in a branch the cascade has to
   * reach; add a table to the schema and forget it here and the sweep goes
   * quiet again, which is the standing weakness of that test and is why it
   * asserts a lower bound on populated tables. */
  const evidence = await prisma.actionEvidence.create({
    data: { runId: run.id, intentId: intent.id, kind: 'page', url: 'https://example.com/1' },
  })
  const request = await prisma.confirmationRequest.create({
    data: {
      runId: run.id,
      intentId: intent.id,
      evidenceId: evidence.id,
      summary: 'May I send this?',
    },
  })
  await prisma.confirmationVerdict.create({ data: { requestId: request.id, verdict: 'confirmed' } })
  await prisma.actionDispatch.create({
    data: { runId: run.id, intentId: intent.id, kind: 'draft-section', params: {} },
  })

  const outcome = await prisma.shiftOutcome.create({
    data: {
      runId: run.id,
      ordinal: 0,
      kind: 'changed',
      reversibility: 'reversible',
      headline: 'Wrote a section',
      reason: 'the plan said so',
      citedActionIntentIds: [intent.id],
      detail: {},
    },
  })
  await prisma.outcomeVerdict.create({ data: { outcomeId: outcome.id, verdict: 'kept' } })

  const changeset = await prisma.changeset.create({
    data: { contractId: contract.id, baseVersionId: version.id, baseHash: 'hash', outcomeId: outcome.id },
  })
  const change = await prisma.proposedChange.create({
    data: {
      changesetId: changeset.id,
      startOffset: 0,
      endOffset: 7,
      prefix: '',
      exact: '# notes',
      suffix: '',
      replacement: '# notes\n\nmore',
      reason: 'the section was empty',
    },
  })
  await prisma.changeVerdict.create({ data: { changeId: change.id, verdict: 'kept' } })
  await prisma.reviewFinding.create({
    data: {
      runId: run.id,
      changeId: change.id,
      outcomeId: outcome.id,
      kind: 'unsupported',
      detail: 'a claim with no source',
    },
  })

  /**
   * The settled version — a document review that FINISHED.
   *
   * `finishReview` writes `committedFromChangesetId`, so this is the ordinary
   * terminal state of the product's flagship outcome, not an exotic one. It is
   * also the pair that makes the document cluster a cycle:
   * `Changeset.base -> DocumentVersion` is `Restrict` (changeset first) while
   * `DocumentVersion.committedFrom -> Changeset` is `SetNull` (version first,
   * or the nullification is an UPDATE the guard aborts).
   *
   * Without this row every delete test passes against a cascade that cannot
   * delete a project anybody has actually used.
   */
  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      ordinal: 1,
      contentHash: 'hash-2',
      content: '# notes\n\nmore',
      origin: 'agent',
      committedFromChangesetId: changeset.id,
    },
  })

  const report = await prisma.shiftReport.create({ data: { contractId: contract.id } })
  const decision = await prisma.decisionNeeded.create({
    data: {
      reportId: report.id,
      question: 'Which tier?',
      whyStopped: 'both were read and neither chosen',
      needs: 'a decision',
      ordinal: 0,
    },
  })
  await prisma.decisionVerdict.create({
    data: { decisionNeededId: decision.id, answer: 'the strategic one', source: 'screen' },
  })

  return { project, intention, session, document }
}

/** Every table with a row in it, so a forgotten one cannot hide. */
async function rowCounts(): Promise<Record<string, number>> {
  const tables = (await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma%' AND name NOT LIKE 'sqlite_%'`,
  )) as Array<{ name: string }>

  const counts: Record<string, number> = {}
  for (const { name } of tables) {
    const [row] = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM "${name}"`,
    )) as Array<{ n: bigint | number }>
    counts[name] = Number(row?.n ?? 0)
  }
  return counts
}

describe('deleting a project', () => {
  it('leaves not one row behind, in any table', async () => {
    const { project } = await buildProject('alpha')
    const repos = createRepositories(prisma)

    const before = await rowCounts()

    /**
     * The fixture has to have reached the far leaves, or the sweep below is a
     * statement about an empty database.
     *
     * **Named rather than counted**, per `AGENTS.md` — *"never add a count you
     * have to maintain by hand"*. An earlier version asserted a number here and
     * it was satisfied with thirteen of these tables empty, which would have
     * passed for a cascade that never mentioned them. These are the ones
     * furthest from the Project and therefore the easiest to forget.
     */
    const mustBePopulated = [
      'evidence',
      'change_verdict',
      'decision_verdict',
      'confirmation_verdict',
      'outcome_verdict',
      'action_outcome',
      'action_dispatch',
      'review_finding',
      'action_evidence',
      'external_event',
      'document_version',
      'plan_step',
    ]
    expect(mustBePopulated.filter((t) => (before[t] ?? 0) === 0)).toEqual([])

    await repos.projects.deleteWithEverything(project.id)

    const after = await rowCounts()
    const leftBehind = Object.entries(after).filter(([, n]) => n > 0)

    // Named rather than counted, so a failure says WHICH table was forgotten.
    expect(leftBehind).toEqual([])
  })

  it('takes the Intention and its ExternalEvents, which belong to no session', async () => {
    const { project, intention } = await buildProject('beta')
    const repos = createRepositories(prisma)

    await repos.projects.deleteWithEverything(project.id)

    expect(await prisma.intention.findUnique({ where: { id: intention.id } })).toBeNull()
    expect(await prisma.externalEvent.count()).toBe(0)
  })

  it('survives an unrelated project untouched', async () => {
    const alpha = await buildProject('alpha')
    const beta = await buildProject('beta')
    const repos = createRepositories(prisma)

    const before = await rowCounts()
    await repos.projects.deleteWithEverything(alpha.project.id)
    const after = await rowCounts()

    // Two identical projects, so every table should hold exactly half as much.
    for (const [table, n] of Object.entries(before)) {
      expect({ table, n: after[table] }).toEqual({ table, n: n / 2 })
    }

    expect(await prisma.project.findUnique({ where: { id: beta.project.id } })).not.toBeNull()
  })

  /**
   * The premise of this test was wrong when it was written, and the truth is
   * the reason the guard in `deleteWithEverything` exists.
   *
   * It asserted that a foreign key would abort the transaction. It does not:
   * `PRAGMA foreign_keys` is on, but `WorkSession.intentionId` is OPTIONAL, so
   * Prisma's default is `SetNull` and Prisma nullifies the child itself.
   * Measured — deleting the Intention left the other project's sitting in place
   * with `intentionId: null` and raised nothing at all.
   *
   * Which is one project's delete silently editing another project's work. So
   * the repository refuses before the transaction opens, and this pins the
   * refusal rather than the FK that was never going to fire.
   */
  it('refuses outright when another project names this project’s Intention', async () => {
    const { project } = await buildProject('gamma')
    const repos = createRepositories(prisma)

    const other = await prisma.project.create({ data: { name: 'holder' } })
    const held = await prisma.intention.findFirstOrThrow({ where: { projectId: project.id } })
    const stranger = await prisma.workSession.create({
      data: { projectId: other.id, intentionId: held.id },
    })

    const before = await rowCounts()

    await expect(repos.projects.deleteWithEverything(project.id)).rejects.toThrow(
      /work in another project names its Intention/i,
    )

    // Nothing moved, in either project.
    expect(await rowCounts()).toEqual(before)
    expect(await prisma.project.findUnique({ where: { id: project.id } })).not.toBeNull()
    // And the sitting that would have been silently detached still names it.
    const after = await prisma.workSession.findUniqueOrThrow({ where: { id: stranger.id } })
    expect(after.intentionId).toBe(held.id)
  })

  /**
   * The same state one hop over, and it was missed the first time.
   *
   * `HandoffContract.intentionId` carries the same key as `WorkSession`'s with a
   * different referential action — `Restrict` rather than `SetNull` — so it
   * aborts at the last statement as an opaque P2003 instead of nullifying
   * silently. Different failure, same cause, and the first version of the guard
   * checked only sittings.
   */
  it('refuses when another project’s agreement names this project’s Intention', async () => {
    const { project } = await buildProject('theta')
    const other = await buildProject('holder')
    const repos = createRepositories(prisma)

    const held = await prisma.intention.findFirstOrThrow({ where: { projectId: project.id } })
    const strangerContract = await prisma.handoffContract.findFirstOrThrow({
      where: { session: { projectId: other.project.id } },
    })
    await prisma.handoffContract.update({
      where: { id: strangerContract.id },
      data: { intentionId: held.id },
    })

    const before = await rowCounts()

    await expect(repos.projects.deleteWithEverything(project.id)).rejects.toThrow(
      /work in another project names its Intention/i,
    )

    expect(await rowCounts()).toEqual(before)
  })

  /**
   * The constraint that forces the order, pinned where a reorder would meet it.
   *
   * `ObservationEvent.approvedSourceId` is optional, so deleting an
   * `ApprovedSource` makes Prisma write NULL into every event citing it — and
   * on this table that is an UPDATE, which the no-UPDATE guard aborts. It is
   * the one guard ADR-0038 did not remove doing the work here. Move
   * `approvedSource.deleteMany` above `observationEvent.deleteMany` in the
   * cascade and this is the failure you get.
   */
  it('cannot drop an approved source while an event still cites it', async () => {
    const { project } = await buildProject('eta')
    const source = await prisma.approvedSource.findFirstOrThrow({
      where: { projectId: project.id },
    })

    await expect(
      prisma.approvedSource.delete({ where: { id: source.id } }),
    ).rejects.toThrow()
  })

  it('leaves a model call that belongs to no run, because it belongs to no project', async () => {
    const { project } = await buildProject('zeta')
    const repos = createRepositories(prisma)

    // `ModelCallRecord.runId` is optional. A record written outside a run is
    // owned by nothing, and the cascade scopes on the run rather than deleting
    // the table — this is the assertion that it does not reach past what it
    // owns. The row holds a boundary name, a model, a duration and token
    // counts: no page text and no objective.
    const orphanByDesign = await prisma.modelCallRecord.create({
      data: {
        boundary: 'subject',
        promptVersion: 'subject@2',
        model: 'claude-opus-5',
        latencyMs: 5,
      },
    })

    await repos.projects.deleteWithEverything(project.id)

    expect(
      await prisma.modelCallRecord.findUnique({ where: { id: orphanByDesign.id } }),
    ).not.toBeNull()
    // And the one that DID belong to the run is gone.
    expect(await prisma.modelCallRecord.count()).toBe(1)
  })

  it('still refuses an UPDATE — the guard that did not go', async () => {
    const { session } = await buildProject('delta')

    const event = await prisma.observationEvent.findFirstOrThrow({
      where: { sessionId: session.id },
    })

    await expect(
      prisma.observationEvent.update({ where: { id: event.id }, data: { kind: 'queried' } }),
    ).rejects.toThrow()
  })
})

describe('what the confirmation is allowed to say', () => {
  it('counts sittings, documents and recorded actions', async () => {
    const { project } = await buildProject('epsilon')
    const repos = createRepositories(prisma)

    expect(await repos.projects.deletionScope(project.id)).toEqual({
      sittings: 1,
      documents: 1,
      recordedActions: 1,
    })
  })

  it('answers null for a project that is not there, rather than three zeroes', async () => {
    const repos = createRepositories(prisma)

    // Zeroes would render as "this will delete nothing", which is a sentence
    // about an empty project and not about a missing one.
    expect(await repos.projects.deletionScope('no-such-project')).toBeNull()
  })
})
