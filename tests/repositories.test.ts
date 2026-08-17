/**
 * The persistence layer.
 *
 * The most important test in this file is the first one: that `createDatabase`
 * refuses to hand back a handle to an unguarded database. Until this slice,
 * `ensureAppendOnlyGuards` existed, was tested, and was called by nothing — the
 * guards were real and switched off.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { findMissingGuards } from '../src/persistence/append-only'
import { AppendOnlyViolationError, translateGuardError } from '../src/persistence/errors'
import { createHash } from 'node:crypto'

let dir: string
let db: Database
let repos: Repositories

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-repo-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('startup installs the guards', () => {
  it('leaves no guard missing after createDatabase', async () => {
    expect(await findMissingGuards(db.prisma)).toEqual([])
  })

  it('refuses to return a handle to an unguarded database', async () => {
    // Drop a guard behind its back, then confirm a fresh createDatabase
    // reinstalls rather than shrugging.
    await db.prisma.$executeRawUnsafe('DROP TRIGGER observation_event_no_update')
    expect(await findMissingGuards(db.prisma)).toContain('observation_event_no_update')

    const second = await createDatabase({ url: `file:${join(dir, 'test.db')}` })
    expect(await findMissingGuards(second.prisma)).toEqual([])
    await second.close()
  })
})

describe('Prisma error translation', () => {
  it('turns a P2003 on a guarded table into an honest message', () => {
    const prismaError = { code: 'P2003', message: 'Foreign key constraint violated on the foreign key' }

    expect(() => translateGuardError(prismaError, 'document_version', 'update')).toThrow(
      AppendOnlyViolationError,
    )
    expect(() => translateGuardError(prismaError, 'document_version', 'update')).toThrow(
      /append-only.*rejected by a database guard/is,
    )
  })

  it('says explicitly that there is no relation problem', () => {
    try {
      translateGuardError({ code: 'P2003', message: 'Foreign key constraint violated' }, 'handoff_contract', 'update')
    } catch (error) {
      expect((error as Error).message).toMatch(/no relation problem/i)
    }
  })

  it('passes through an error that is not a guard firing', () => {
    const other = { code: 'P2025', message: 'Record to update not found' }
    expect(() => translateGuardError(other, 'action_intent', 'update')).toThrow(/not found/)
  })

  it('translates the honest form too, so callers see one error type', () => {
    const raw = { message: 'observation_event is append-only: UPDATE forbidden' }
    expect(() => translateGuardError(raw, 'observation_event', 'update')).toThrow(
      AppendOnlyViolationError,
    )
  })
})

describe('projects and sessions', () => {
  it('round-trips a project and its approved sources', async () => {
    const project = await repos.projects.create('Northwind proposal')
    await repos.projects.approveSource({
      projectId: project.id,
      originPattern: 'https://northwind.example.com/*',
      label: 'Northwind',
    })

    expect(await repos.projects.byId(project.id)).toMatchObject({ name: 'Northwind proposal' })
    const sources = await repos.projects.approvedSources(project.id)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.grantState).toBe('granted')
  })

  it('treats re-approving a revoked source as a grant, not a duplicate', async () => {
    const project = await repos.projects.create('regrant')
    const pattern = 'https://example.com/*'
    await repos.projects.approveSource({ projectId: project.id, originPattern: pattern, label: 'x' })
    await repos.projects.approveSource({ projectId: project.id, originPattern: pattern, label: 'x' })

    expect(await repos.projects.approvedSources(project.id)).toHaveLength(1)
  })

  it('moves a session through its phases explicitly', async () => {
    const project = await repos.projects.create('phases')
    const session = await repos.sessions.start(project.id)
    expect(session.phase).toBe('observing')

    await repos.sessions.markAway(session.id)
    expect((await repos.sessions.byId(session.id))?.phase).toBe('away')

    await repos.sessions.end(session.id, new Date(0))
    const ended = await repos.sessions.byId(session.id)
    expect(ended?.phase).toBe('ended')
    expect(ended?.endedAt).not.toBeNull()
  })
})

describe('the contract freezes on accept', () => {
  async function makeContract() {
    const project = await repos.projects.create('contract')
    const session = await repos.sessions.start(project.id)
    const doc = await repos.documents.create({
      projectId: project.id,
      title: 'proposal',
      content: 'Base.',
      contentHash: hash('Base.'),
    })
    const reading = await repos.readings.create({
      sessionId: session.id,
      throughSeq: 0,
      claims: [],
    })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      objective: 'draft it',
      definitionOfDone: 'all sections',
      guidance: ['do not commit to a discount'],
      approvedSourceIds: [],
      allowedActionKinds: ['read-approved-source'],
      baseVersionId: doc.versionId,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    return { contract, doc, session }
  }

  it('round-trips the JSON columns as arrays', async () => {
    const { contract } = await makeContract()
    const loaded = await repos.contracts.byId(contract.id)

    expect(loaded?.guidance).toEqual(['do not commit to a discount'])
    expect(loaded?.allowedActionKinds).toEqual(['read-approved-source'])
  })

  it('allows editing a draft', async () => {
    const { contract } = await makeContract()
    await repos.contracts.editDraft(contract.id, { timeLimitMinutes: 45 })

    expect((await repos.contracts.byId(contract.id))?.timeLimitMinutes).toBe(45)
  })

  it('refuses to edit once accepted, with an honest error', async () => {
    const { contract } = await makeContract()
    await repos.contracts.accept(contract.id, new Date(0))

    // Prisma would call this a foreign key violation. It is not.
    await expect(
      repos.contracts.editDraft(contract.id, { timeLimitMinutes: 999 }),
    ).rejects.toThrow(AppendOnlyViolationError)

    expect((await repos.contracts.byId(contract.id))?.timeLimitMinutes).toBe(30)
  })
})

describe('the run queue', () => {
  async function makeRun() {
    const project = await repos.projects.create('queue')
    const session = await repos.sessions.start(project.id)
    const doc = await repos.documents.create({
      projectId: project.id, title: 'd', content: 'x', contentHash: hash('x'),
    })
    const reading = await repos.readings.create({ sessionId: session.id, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id, readingId: reading.id, objective: 'o', definitionOfDone: 'd',
      guidance: [], approvedSourceIds: [], allowedActionKinds: [], baseVersionId: doc.versionId,
      initiative: 'follow-closely', progress: 'current-step-only', output: 'draft-changes',
      interruption: 'stop-only-when-blocked', timeLimitMinutes: 30,
    })
    return repos.runs.enqueue({ contractId: contract.id, role: 'worker' })
  }

  it('claims exactly one run when two workers race', async () => {
    const run = await makeRun()

    const [a, b] = await Promise.all([
      repos.runs.claim({ leaseUntil: new Date(60_000), startedAt: new Date(0) }),
      repos.runs.claim({ leaseUntil: new Date(60_000), startedAt: new Date(0) }),
    ])

    const winners = [a, b].filter((r) => r?.id === run.id)
    expect(winners).toHaveLength(1)
  })

  it('sweeps an expired lease to interrupted', async () => {
    const run = await makeRun()
    await repos.runs.claim({ leaseUntil: new Date(1_000), startedAt: new Date(0) })

    const swept = await repos.runs.sweepExpiredLeases(new Date(10_000))
    expect(swept).toBeGreaterThanOrEqual(1)
    expect((await repos.runs.byId(run.id))?.status).toBe('interrupted')
  })

  it('mints a control token on claim and clears it at terminal', async () => {
    /**
     * ADR-0010 gives a run a `controlToken` so the browser control channel can
     * answer *is this the run the extension agreed to take instructions from?*
     * The column landed in wave 1 and nothing ever wrote it, which left the
     * dispatch route's status check as the only thing between an arbitrary
     * local caller and a channel that presses buttons in a signed-in browser.
     *
     * It is not an authorization — the gate still decides every action. It is
     * an identity, and its lifetime must be the claim's: a finished run holding
     * a valid credential is a standing key held by nothing and revoked by
     * nobody.
     */
    const run = await makeRun()
    await repos.runs.claim({
      leaseUntil: new Date(60_000),
      startedAt: new Date(0),
      controlToken: 'tok-abcdefghijklmnopqrstuvwxyz012345',
    })

    expect((await repos.runs.byId(run.id))?.controlToken).toBe(
      'tok-abcdefghijklmnopqrstuvwxyz012345',
    )

    await repos.runs.complete(run.id, 'succeeded', new Date(1_000))
    expect((await repos.runs.byId(run.id))?.controlToken).toBeNull()
  })

  it('clears the control token on an abandoned run, which is the half that matters', async () => {
    // These are the runs whose process is GONE — the Mac slept, the worker was
    // killed — so nothing is coming back to tidy up. A credential left on an
    // abandoned row is the one an attacker has time to use.
    const run = await makeRun()
    await repos.runs.claim({
      leaseUntil: new Date(1_000),
      startedAt: new Date(0),
      controlToken: 'tok-abcdefghijklmnopqrstuvwxyz012345',
    })
    expect((await repos.runs.byId(run.id))?.controlToken).toBeTruthy()

    await repos.runs.sweepExpiredLeases(new Date(10_000))

    expect((await repos.runs.byId(run.id))?.status).toBe('interrupted')
    expect((await repos.runs.byId(run.id))?.controlToken).toBeNull()
  })

  it('returns null when nothing is pending', async () => {
    // Drain whatever earlier tests left behind.
    while (await repos.runs.claim({ leaseUntil: new Date(60_000), startedAt: new Date(0) })) {
      /* drain */
    }
    expect(await repos.runs.claim({ leaseUntil: new Date(60_000), startedAt: new Date(0) })).toBeNull()
  })
})

describe('documents are insert-only', () => {
  it('adds versions with increasing ordinals and never mutates the base', async () => {
    const project = await repos.projects.create('versions')
    const doc = await repos.documents.create({
      projectId: project.id, title: 'd', content: 'One.', contentHash: hash('One.'),
    })

    const v2 = await repos.documents.addVersion({
      documentId: doc.id, content: 'One.\nTwo.', contentHash: hash('One.\nTwo.'), origin: 'accepted-changeset',
    })

    expect(v2.ordinal).toBe(2)
    expect((await repos.documents.version(doc.versionId))?.content).toBe('One.')
    expect((await repos.documents.latestVersion(doc.id))?.ordinal).toBe(2)
  })
})

describe('readings carry evidence, and edits are per claim', () => {
  it('marks only the edited claim as edited', async () => {
    const project = await repos.projects.create('claims')
    const session = await repos.sessions.start(project.id)
    const reading = await repos.readings.create({
      sessionId: session.id,
      throughSeq: 3,
      claims: [
        { kind: 'objective', text: 'Draft it.', confidence: 'high', ordinal: 0, evidence: [] },
        { kind: 'openThread', text: 'Commercials empty.', ordinal: 1, evidence: [] },
      ],
    })

    const loaded = await repos.readings.byId(reading.id)
    const objective = loaded?.claims.find((c) => c.kind === 'objective')
    expect(objective?.origin).toBe('inferred')

    await repos.readings.editClaim(objective!.id, 'Draft the Northwind proposal.')

    const after = await repos.readings.byId(reading.id)
    expect(after?.claims.find((c) => c.kind === 'objective')?.origin).toBe('edited')
    // The untouched claim stays inferred — revision-level authorship would
    // launder it into a human assertion.
    expect(after?.claims.find((c) => c.kind === 'openThread')?.origin).toBe('inferred')
  })
})

describe('an Intention is durable, mutable, and at most one per Project', () => {
  it('round-trips the sentence, and a sitting and a contract can point at it', async () => {
    const project = await repos.projects.create('Northwind renewal')
    const intention = await repos.intentions.create({
      projectId: project.id,
      objective: 'Win the Northwind renewal',
      definitionOfDone: 'A tier comparison they have read',
    })

    // Read back through `forProject`, which is the only reader there is: `byId`
    // was dropped for having no caller outside this line, which is the shape
    // the file at the top of `tests/reachability.test.ts` exists to remember.
    expect(await repos.intentions.forProject(project.id)).toMatchObject({
      id: intention.id,
      projectId: project.id,
      objective: 'Win the Northwind renewal',
      definitionOfDone: 'A tier comparison they have read',
      // Nobody has said it is finished, so `IntentionState` computes `sleeping`
      // rather than `done`. There is no status column to disagree with that.
      completedAt: null,
    })

    const session = await repos.sessions.start(project.id, intention.id)
    expect((await repos.sessions.byId(session.id))?.intentionId).toBe(intention.id)

    const reading = await repos.readings.create({ sessionId: session.id, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      intentionId: intention.id,
      objective: 'draft the comparison',
      definitionOfDone: 'all four tiers',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-approved-source'],
      baseVersionId: null,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })

    // Written at DRAFT time. `handoff_contract_frozen_once_accepted` permits an
    // UPDATE only while the row is a draft, so a value written any later could
    // not be written at all.
    await repos.contracts.accept(contract.id, new Date(0))
    expect((await repos.contracts.byId(contract.id))?.intentionId).toBe(intention.id)
  })

  it("finds the Project's one Intention, and refuses a second", async () => {
    const project = await repos.projects.create('one each')
    expect(await repos.intentions.forProject(project.id)).toBeNull()

    const first = await repos.intentions.create({
      projectId: project.id,
      objective: 'the one thing',
      definitionOfDone: 'it is done',
    })
    expect(await repos.intentions.forProject(project.id)).toMatchObject({ id: first.id })

    // At most one per Project (ADR-0011), held as a unique index rather than as
    // a convention — so the accept path finds the existing row instead of
    // minting a rival statement of purpose for the same work.
    await expect(
      repos.intentions.create({
        projectId: project.id,
        objective: 'a rival thing',
        definitionOfDone: 'also done',
      }),
    ).rejects.toThrow()
  })

  it('leaves a session and a contract with no Intention, because most have none', async () => {
    const project = await repos.projects.create('no intention')
    const session = await repos.sessions.start(project.id)

    expect((await repos.sessions.byId(session.id))?.intentionId).toBeNull()

    const reading = await repos.readings.create({ sessionId: session.id, throughSeq: 0, claims: [] })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      objective: 'draft it',
      definitionOfDone: 'all sections',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-approved-source'],
      baseVersionId: null,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })

    // Nothing backfills, and the omitted field is null rather than absent —
    // every fixture written before ADR-0011 keeps working unchanged.
    expect((await repos.contracts.byId(contract.id))?.intentionId).toBeNull()
  })

  it('a sitting moved to another Project does not keep the old Intention', async () => {
    /**
     * The one correction a person has for *this is not that work*, and the
     * defect it had: `refile` wrote `projectId` alone, so the sitting kept
     * pointing at the Intention filed under the project it just left — and
     * `draftContract` reads `session.intentionId` onto the contract, so the
     * rejected sentence would have arrived on a HandoffContract in the new
     * project with nothing on screen saying it had.
     *
     * `Intention.projectId` is `@unique`, so "the sitting's Intention" and "the
     * sitting's Project's Intention" are one question; this asserts the two
     * cannot disagree after a move.
     */
    const from = await repos.projects.create('where it started')
    const to = await repos.projects.create('where it belongs')
    const intention = await repos.intentions.create({
      projectId: from.id,
      objective: 'the sentence they rejected',
      definitionOfDone: 'never mind',
    })

    const session = await repos.sessions.start(from.id, intention.id)
    expect((await repos.sessions.byId(session.id))?.intentionId).toBe(intention.id)

    // The destination has no Intention, so null is the honest value — nobody
    // has stated one for this work.
    await repos.sessions.refile(session.id, to.id, null)

    expect(await repos.sessions.byId(session.id)).toMatchObject({
      projectId: to.id,
      intentionId: null,
    })

    // And the Intention itself is untouched: a move re-files a sitting, it does
    // not edit a sentence a person ratified.
    expect(await repos.intentions.forProject(from.id)).toMatchObject({ id: intention.id })
  })
})
