/**
 * Does finishing a review actually produce a document?
 *
 * Until this existed the loop recorded verdicts and stopped. `materialise` was
 * called in exactly one place — inside the shift page's scale-label recovery —
 * and no code path ever wrote a version with `origin: 'accepted-changeset'`.
 * The interface said so in its own copy: "yours to fold into the document."
 *
 * These run against a real SQLite file with the append-only triggers installed,
 * because two of the properties under test — insert-only versions, and a
 * changeset settling exactly once — are enforced by the database rather than by
 * the code above it.
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
import { checkDrift, diff, hashContent, materialise } from '../src/domain/document/changeset'
import { normalise } from '../src/domain/document/normalise'

const DOC = [
  '# Northwind partnership proposal',
  '',
  '## Scope',
  '',
  'Integration work is scoped to the first quarter.',
  '',
  '## Commercials',
  '',
  'We propose a partnership on standard terms.',
  '',
].join('\n')

let dir: string
let db: Database
let repos: Repositories
let projectId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-finish-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  projectId = (await repos.projects.create('northwind')).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** A document, a shift against it, and a changeset — the state a review starts from. */
async function shiftAgainst(proposed: string) {
  const stored = normalise(DOC)
  const document = await repos.documents.create({
    projectId,
    title: 'Proposal',
    content: stored,
    contentHash: hashContent(stored),
  })

  const sessionId = (await repos.sessions.start(projectId)).id
  const reading = await repos.readings.create({
    sessionId,
    throughSeq: 0,
    claims: [{ kind: 'objective', text: 'Finish Commercials.', ordinal: 0, evidence: [] }],
  })
  const contract = await repos.contracts.createDraft({
    sessionId,
    readingId: reading.id,
    objective: 'Finish Commercials.',
    definitionOfDone: 'Commercials names a tier.',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['draft-section'],
    baseVersionId: document.versionId,
    initiative: 'use-judgment',
    progress: 'keep-going',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date())

  const { changes, baseHash } = diff(stored, proposed, 'because')
  const changeset = await repos.changesets.create({
    contractId: contract.id,
    baseVersionId: document.versionId,
    baseHash,
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

  return { documentId: document.id, baseVersionId: document.versionId, contractId: contract.id, changeset, stored }
}

describe('the fold produces a version, and it is reproducible', () => {
  it('re-running the fold reproduces the committed bytes exactly', async () => {
    const proposed = DOC.replace('standard terms', 'Gold tier terms')
    const shift = await shiftAgainst(proposed)

    const loaded = await repos.changesets.forContract(shift.contractId)
    expect(loaded).not.toBeNull()
    if (!loaded) return

    const decisions = loaded.changes.map((_, changeIndex) => ({
      changeIndex,
      verdict: 'accept' as const,
    }))
    const folded = materialise(shift.stored, loaded.changes, decisions)

    const version = await repos.documents.addVersion({
      documentId: shift.documentId,
      content: folded,
      contentHash: hashContent(folded),
      origin: 'accepted-changeset',
      committedFromChangesetId: loaded.id,
    })

    // CONTEXT.md: re-running the fold reproduces the committed bytes.
    const again = materialise(shift.stored, loaded.changes, decisions)
    const stored = await repos.documents.version(version.id)

    expect(again).toBe(folded)
    expect(stored?.content).toBe(folded)
    expect(stored?.content).toContain('Gold tier terms')
    expect(version.ordinal).toBe(2)
  })

  it('leaves the base version byte-identical — acceptance bullet 7', async () => {
    const shift = await shiftAgainst(DOC.replace('first quarter', 'Q3'))
    const before = await repos.documents.version(shift.baseVersionId)

    const loaded = await repos.changesets.forContract(shift.contractId)
    if (!loaded) throw new Error('no changeset')

    const folded = materialise(
      shift.stored,
      loaded.changes,
      loaded.changes.map((_, changeIndex) => ({ changeIndex, verdict: 'accept' as const })),
    )
    await repos.documents.addVersion({
      documentId: shift.documentId,
      content: folded,
      contentHash: hashContent(folded),
      origin: 'accepted-changeset',
      committedFromChangesetId: loaded.id,
    })

    const after = await repos.documents.version(shift.baseVersionId)

    expect(after?.content).toBe(before?.content)
    expect(after?.contentHash).toBe(before?.contentHash)
  })

  it('rejecting everything still settles, and the bytes equal the base', async () => {
    const shift = await shiftAgainst(DOC.replace('standard terms', 'Gold tier terms'))
    const loaded = await repos.changesets.forContract(shift.contractId)
    if (!loaded) throw new Error('no changeset')

    const folded = materialise(
      shift.stored,
      loaded.changes,
      loaded.changes.map((_, changeIndex) => ({ changeIndex, verdict: 'reject' as const })),
    )

    // Identical bytes are permitted — CONTEXT.md says so explicitly, because a
    // revert produces them too. Settlement stays uniform and enforceable by the
    // foreign key rather than by a second nullable flag.
    expect(folded).toBe(shift.stored)

    const version = await repos.documents.addVersion({
      documentId: shift.documentId,
      content: folded,
      contentHash: hashContent(folded),
      origin: 'accepted-changeset',
      committedFromChangesetId: loaded.id,
    })

    expect(version.ordinal).toBe(2)
  })
})

describe('a changeset settles exactly once', () => {
  it('the database refuses a second version citing the same changeset', async () => {
    const shift = await shiftAgainst(DOC.replace('standard terms', 'Gold tier terms'))
    const loaded = await repos.changesets.forContract(shift.contractId)
    if (!loaded) throw new Error('no changeset')

    const write = () =>
      repos.documents.addVersion({
        documentId: shift.documentId,
        content: `${shift.stored}\nx`,
        contentHash: hashContent(`${shift.stored}\nx`),
        origin: 'accepted-changeset',
        committedFromChangesetId: loaded.id,
      })

    await write()
    // The unique index IS the "already reviewed" flag. A second boolean column
    // could disagree with the foreign key; this cannot.
    await expect(write()).rejects.toThrow()
  })

  it('reports itself as settled once a version cites it', async () => {
    const shift = await shiftAgainst(DOC.replace('first quarter', 'Q3'))
    const before = await repos.changesets.forContract(shift.contractId)
    expect(before?.settledAsVersionId).toBeNull()

    const loaded = before
    if (!loaded) throw new Error('no changeset')
    const version = await repos.documents.addVersion({
      documentId: shift.documentId,
      content: shift.stored,
      contentHash: hashContent(shift.stored),
      origin: 'accepted-changeset',
      committedFromChangesetId: loaded.id,
    })

    const after = await repos.changesets.forContract(shift.contractId)
    expect(after?.settledAsVersionId).toBe(version.id)

    const change = loaded.changes[0]
    expect(change).toBeDefined()
    if (change) expect(await repos.changesets.settledFor(change.id)).toBe(true)
  })
})

describe('the human edit wins', () => {
  it('a save during the shift makes the base drift, and the fold must refuse', async () => {
    const shift = await shiftAgainst(DOC.replace('standard terms', 'Gold tier terms'))

    // ADR-0003 §4: the document is never locked, so this is a routine path.
    const edited = normalise(DOC.replace('## Commercials', '## Commercials and terms'))
    await repos.documents.addVersion({
      documentId: shift.documentId,
      content: edited,
      contentHash: hashContent(edited),
      origin: 'human',
    })

    const loaded = await repos.changesets.forContract(shift.contractId)
    const latest = await repos.documents.latestVersion(shift.documentId)
    if (!loaded || !latest) throw new Error('missing')

    const drift = checkDrift(latest.content, loaded.baseHash)

    expect(drift.ok).toBe(false)
    if (!drift.ok) expect(drift.reason).toBe('base-moved')

    // Nothing was overwritten, and the changeset is still unsettled — the
    // decisions stay on the record even though they cannot be applied.
    expect(loaded.settledAsVersionId).toBeNull()
    expect(latest.content).toBe(edited)
  })
})
