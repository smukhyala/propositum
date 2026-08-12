/**
 * Can a person decide on what a Shift made, and can they be lied to about it?
 *
 * ── Two properties, one of which is the whole reason this file exists ────
 *
 * **The document path survives generalisation.** `finishReview` became
 * `finishShift`, and the fold underneath it did not change: the base is
 * immutable for the whole review, `committedFromChangesetId` is unique and IS
 * the already-reviewed flag, and accepting is commutative. A Shift that
 * produced a changeset and nothing else must take exactly the path it took
 * before, and the first block below pins that rather than trusting it.
 *
 * **A landed outcome is never given a verdict.** Not by the interface, which
 * renders no control, and not by the server, which refuses before it looks at
 * anything else. The refusal is tested here because it is the one that matters
 * most: a person who clicks Reject on a sent message and is told "rejected" has
 * been lied to by the one screen the entire trust model rests on. A test that
 * only checked the interface would go green against a server that wrote the row
 * anyway, and the interface is the half that drifts.
 *
 * These run against a real SQLite file with the append-only triggers installed,
 * because two of the properties under test — insert-only versions and one
 * verdict per outcome — are enforced by the database rather than by the code
 * above it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { diff, hashContent } from '../src/domain/document/changeset'
import { normalise } from '../src/domain/document/normalise'
import { asShiftOutcomeKind, isDecidable, readOutcomeDetail } from '../src/domain/outcome/shift-outcome'

// `revalidatePath` needs a request store that does not exist in a test process.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

type Actions = typeof import('../src/server/actions')
type Db = typeof import('../src/server/db')

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
let actions: Actions
let db: Db

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-outcomes-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  // Set before the modules load: `appContext()` builds its client from the
  // environment the first time an action asks for it.
  process.env['DATABASE_URL'] = url

  actions = await import('../src/server/actions')
  db = await import('../src/server/db')
}, 120_000)

afterAll(async () => {
  const ctx = await db?.appContext()
  await ctx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/* ── seeding ────────────────────────────────────────────────────────────── */

/**
 * A Shift that has run, with a run to hang outcomes off.
 *
 * `withDocument: false` is the case that could not exist before this work: a
 * contract pinning no base version, because the run was never going to touch a
 * document.
 */
async function shift(options: { withDocument: boolean; proposed?: string }) {
  const { repos } = await db.appContext()

  const project = await repos.projects.create(`northwind-${Math.random().toString(36).slice(2)}`)

  const stored = normalise(DOC)
  const document = options.withDocument
    ? await repos.documents.create({
        projectId: project.id,
        title: 'Proposal',
        content: stored,
        contentHash: hashContent(stored),
      })
    : null

  const sessionId = (await repos.sessions.start(project.id)).id
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
    // Null when this Shift pins no document — the case that could not exist
    // until a run could produce something other than document changes.
    baseVersionId: document?.versionId ?? null,
    initiative: 'use-judgment',
    progress: 'keep-going',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date())
  const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

  let changesetId: string | null = null
  if (document !== null && options.proposed !== undefined) {
    const { changes, baseHash } = diff(stored, options.proposed, 'because the tier was missing')
    changesetId = (
      await repos.changesets.create({
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
    ).id
  }

  return {
    projectId: project.id,
    documentId: document?.id ?? null,
    baseVersionId: document?.versionId ?? null,
    contractId: contract.id,
    runId: run.id,
    changesetId,
    stored,
  }
}

/** One ShiftOutcome, written the way the run path will write them. */
async function outcome(
  runId: string,
  input: {
    kind: string
    reversibility: string
    headline: string
    reason?: string
    detail?: Record<string, unknown>
  },
): Promise<string> {
  const { repos } = await db.appContext()
  const written = await repos.outcomes.create({
    runId,
    outcomes: [
      {
        kind: input.kind,
        reversibility: input.reversibility,
        headline: input.headline,
        reason: input.reason ?? 'Because you asked for it.',
        citedActionIntentIds: [],
        detail: input.detail ?? {},
      },
    ],
  })
  const first = written[0]
  if (!first) throw new Error('no outcome written')
  return first.id
}

/* ── the document path, unchanged ───────────────────────────────────────── */

describe('a document Shift folds exactly as it did before', () => {
  it('accepts some, rejects others, and writes a version citing the changeset', async () => {
    const { repos } = await db.appContext()
    const seeded = await shift({
      withDocument: true,
      proposed: DOC.replace('standard terms', 'Gold tier terms').replace('first quarter', 'Q3'),
    })
    await outcome(seeded.runId, {
      kind: 'document-changes',
      reversibility: 'held',
      headline: 'I drafted two changes to your proposal.',
    })

    const changeset = await repos.changesets.forContract(seeded.contractId)
    expect(changeset?.changes.length).toBe(2)
    if (!changeset) throw new Error('no changeset')

    const [first, second] = changeset.changes
    if (!first || !second) throw new Error('expected two changes')

    // Undecided: the fold must refuse, and the copy must still be about changes
    // because changes are all that is waiting.
    const early = await actions.finishShift(seeded.contractId)
    expect(early.ok).toBe(false)
    if (!early.ok) expect(early.problem.message).toContain('2 changes still waiting')

    expect((await actions.recordVerdict(first.id, 'accept')).ok).toBe(true)
    expect((await actions.recordVerdict(second.id, 'reject')).ok).toBe(true)

    const finished = await actions.finishShift(seeded.contractId)
    expect(finished.ok).toBe(true)
    if (!finished.ok) return

    expect(finished.value.document).not.toBeNull()
    expect(finished.value.document?.kept).toBe(1)
    expect(finished.value.document?.discarded).toBe(1)

    const version = await repos.documents.version(finished.value.document?.versionId ?? '')
    expect(version?.ordinal).toBe(2)

    // The unique foreign key IS the already-reviewed flag. Reading it back off
    // the row rather than off the return value, because the return value would
    // be just as green against a fold that never set it.
    const row = await (
      await db.appContext()
    ).db.prisma.documentVersion.findUnique({
      where: { id: finished.value.document?.versionId ?? '' },
      select: { committedFromChangesetId: true, origin: true },
    })
    expect(row?.committedFromChangesetId).toBe(changeset.id)
    expect(row?.origin).toBe('accepted-changeset')

    // The base did not move.
    const base = await repos.documents.version(seeded.baseVersionId ?? '')
    expect(base?.content).toBe(seeded.stored)

    // And a second finish is refused rather than folded twice.
    const again = await actions.finishShift(seeded.contractId)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.problem.code).toBe('already-done')
  })

  it('refuses an outcome-level verdict on the document outcome', async () => {
    const seeded = await shift({
      withDocument: true,
      proposed: DOC.replace('standard terms', 'Gold tier terms'),
    })
    const id = await outcome(seeded.runId, {
      kind: 'document-changes',
      reversibility: 'held',
      headline: 'I drafted one change.',
    })

    // Its decidable units are the changes. A whole-outcome verdict beside them
    // would be a second decision surface the fold cannot read.
    const result = await actions.recordOutcomeVerdict(id, 'accept')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.message).toContain('each one where it appears')
  })
})

/* ── the kinds that are not a document ──────────────────────────────────── */

describe('a Shift that produced no document still has to be finished', () => {
  it('refuses while a collection or an answer is undecided, then succeeds', async () => {
    const seeded = await shift({ withDocument: false })

    const collection = await outcome(seeded.runId, {
      kind: 'collection',
      reversibility: 'held',
      headline: 'I collected 11 published rates.',
      detail: { items: ['Northwind — £4.20 / kg', { label: 'Fabrikam', body: '£3.95 / kg' }] },
    })
    const answer = await outcome(seeded.runId, {
      kind: 'answer',
      reversibility: 'held',
      headline: 'Fabrikam is cheapest under 5kg.',
      detail: { body: 'Under 5kg Fabrikam is cheaper on every route you looked at.' },
    })

    const both = await actions.finishShift(seeded.contractId)
    expect(both.ok).toBe(false)
    if (!both.ok) {
      expect(both.problem.code).toBe('blocked')
      expect(both.problem.message).toContain('2 things still waiting')
    }

    expect((await actions.recordOutcomeVerdict(collection, 'accept')).ok).toBe(true)

    const one = await actions.finishShift(seeded.contractId)
    expect(one.ok).toBe(false)
    if (!one.ok) expect(one.problem.message).toContain('one thing still waiting')

    expect(
      (await actions.recordOutcomeVerdict(answer, 'edit', 'Fabrikam wins under 5kg.')).ok,
    ).toBe(true)

    const finished = await actions.finishShift(seeded.contractId)
    expect(finished.ok).toBe(true)
    if (finished.ok) {
      // Nothing is written. The verdicts are already the record, and there is
      // no version chain for a Shift that touched no document.
      expect(finished.value.document).toBeNull()
      expect(finished.value.decided).toBe(2)
    }
  })

  it('records one verdict per outcome and says so on the second', async () => {
    const seeded = await shift({ withDocument: false })
    const id = await outcome(seeded.runId, {
      kind: 'message-draft',
      reversibility: 'held',
      headline: 'I wrote a reply to Northwind, unsent.',
      detail: { body: 'Thanks — could you confirm the tier?', addressedTo: 'Northwind' },
    })

    expect((await actions.recordOutcomeVerdict(id, 'accept')).ok).toBe(true)

    const again = await actions.recordOutcomeVerdict(id, 'reject')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.problem.code).toBe('already-done')
  })

  it('refuses an edit with no wording, and wording with no edit', async () => {
    const seeded = await shift({ withDocument: false })
    const id = await outcome(seeded.runId, {
      kind: 'answer',
      reversibility: 'held',
      headline: 'An answer.',
    })

    const empty = await actions.recordOutcomeVerdict(id, 'edit', '   ')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.problem.code).toBe('invalid-input')

    const stray = await actions.recordOutcomeVerdict(id, 'accept', 'something')
    expect(stray.ok).toBe(false)
    if (!stray.ok) expect(stray.problem.code).toBe('invalid-input')
  })

  it('refuses to finish a contract that made nothing at all', async () => {
    const seeded = await shift({ withDocument: false })

    const result = await actions.finishShift(seeded.contractId)
    expect(result.ok).toBe(false)
    // Not "there are no changes to put into your document" — that reads as a
    // document problem, and this Shift never had one.
    if (!result.ok) expect(result.problem.message).toBe('There is nothing waiting on you.')
  })
})

/* ── the refusal that the whole trust model rests on ────────────────────── */

describe('a landed outcome is reported, never reviewed', () => {
  it('refuses a verdict, and writes no verdict row', async () => {
    const { repos } = await db.appContext()
    const seeded = await shift({ withDocument: false })
    const id = await outcome(seeded.runId, {
      kind: 'external-effect',
      reversibility: 'landed',
      headline: 'I submitted the partner enquiry form.',
      detail: {
        where: 'northwind.example.com',
        whatYouCanDo: 'Reply to their confirmation email if any of it was wrong.',
      },
    })

    for (const verdict of ['accept', 'reject', 'edit'] as const) {
      const result = await actions.recordOutcomeVerdict(
        id,
        verdict,
        verdict === 'edit' ? 'undo it' : undefined,
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.problem.code).toBe('blocked')
        expect(result.problem.message).toContain('This already happened, outside Propositum')
      }
    }

    // The row is the assertion that matters. A refusal that wrote first would
    // return exactly the same value.
    const stored = await repos.outcomes.byId(id)
    expect(stored?.verdict).toBeNull()
  })

  it('does not hold up finishing, because there is nothing waiting on it', async () => {
    const seeded = await shift({ withDocument: false })
    await outcome(seeded.runId, {
      kind: 'external-effect',
      reversibility: 'landed',
      headline: 'I sent the enquiry.',
    })

    const finished = await actions.finishShift(seeded.contractId)
    expect(finished.ok).toBe(true)
    if (finished.ok) expect(finished.value.decided).toBe(0)
  })

  it('refuses a verdict on a reversibility nobody recognises', async () => {
    // Deny by default, in the one place where the default matters most. A row
    // whose reversibility is a value this code has never seen is a row we know
    // nothing about, and the honest thing to do with it is to report it.
    const seeded = await shift({ withDocument: false })
    const id = await outcome(seeded.runId, {
      kind: 'answer',
      reversibility: 'partly-landed-ish',
      headline: 'Something happened, or did not.',
    })

    const result = await actions.recordOutcomeVerdict(id, 'accept')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.problem.code).toBe('blocked')
  })
})

/* ── everything the screen reads off a row ──────────────────────────────── */

describe('the five kinds, and the reading that renders them', () => {
  it('carries every kind through the repository unchanged', async () => {
    const { repos } = await db.appContext()
    const seeded = await shift({
      withDocument: true,
      proposed: DOC.replace('standard terms', 'Gold tier terms'),
    })

    await repos.outcomes.create({
      runId: seeded.runId,
      outcomes: [
        {
          kind: 'document-changes',
          reversibility: 'held',
          headline: 'Changes.',
          reason: 'r',
          citedActionIntentIds: [],
          detail: {},
        },
        {
          kind: 'collection',
          reversibility: 'held',
          headline: 'A list.',
          reason: 'r',
          citedActionIntentIds: [],
          detail: { items: ['one', 'two'] },
        },
        {
          kind: 'answer',
          reversibility: 'held',
          headline: 'An answer.',
          reason: 'r',
          citedActionIntentIds: [],
          detail: { body: 'Yes.' },
        },
        {
          kind: 'message-draft',
          reversibility: 'held',
          headline: 'A message.',
          reason: 'r',
          citedActionIntentIds: [],
          detail: { body: 'Hello.', to: 'Northwind' },
        },
        {
          kind: 'external-effect',
          reversibility: 'landed',
          headline: 'It happened.',
          reason: 'r',
          citedActionIntentIds: [],
          detail: { where: 'northwind.example.com', whatYouCanDo: 'Email them.' },
        },
      ],
    })

    const all = await repos.outcomes.forContract(seeded.contractId)
    expect(all.map((o) => o.kind)).toEqual([
      'document-changes',
      'collection',
      'answer',
      'message-draft',
      'external-effect',
    ])
    expect(all.map((o) => o.ordinal)).toEqual([1, 2, 3, 4, 5])

    // Exactly what the screen does with each row, so a kind that renders as
    // `null` here is a kind whose card would be generic.
    for (const row of all) {
      expect(asShiftOutcomeKind(row.kind)).not.toBeNull()
      expect(readOutcomeDetail(row.detail)).toBeDefined()
    }

    const landed = all.filter((row) => !isDecidable(row.reversibility))
    expect(landed.length).toBe(1)
    expect(readOutcomeDetail(landed[0]?.detail).whatYouCanDo).toBe('Email them.')
  })

  it('reads a detail nobody wrote without falling over', () => {
    // The re-entry note is what a person comes back to when a run went badly.
    // A reader that threw on an unexpected payload would take that screen down
    // over a column nobody can see.
    expect(readOutcomeDetail(null).items).toEqual([])
    expect(readOutcomeDetail('nonsense').body).toBeNull()
    expect(readOutcomeDetail({ items: 'not a list' }).items).toEqual([])
    expect(readOutcomeDetail({ items: [null, {}, '  '] }).items).toEqual([])
    expect(readOutcomeDetail({ items: [{ label: 'A', body: 'B' }] }).items).toEqual(['A — B'])
    expect(readOutcomeDetail({ to: 'Northwind' }).addressedTo).toBe('Northwind')
  })

  it('keeps a collected number instead of dropping it', () => {
    // A rate is as likely to arrive as a number as it is as a sentence, and a
    // list that quietly lost its prices would say "it collected nothing" —
    // which is a different sentence, and a much worse one.
    expect(readOutcomeDetail({ items: [3.95, 4.2] }).items).toEqual(['3.95', '4.2'])
    expect(readOutcomeDetail({ items: [{ label: 'Fabrikam', value: 3.95 }] }).items).toEqual([
      'Fabrikam — 3.95',
    ])
    expect(readOutcomeDetail({ items: [Number.NaN, Number.POSITIVE_INFINITY] }).items).toEqual([])
  })

  it('leaves an unrecognised kind decidable rather than stranding it', async () => {
    // The opposite fail direction from reversibility, and deliberately so: kind
    // chooses the words, not whether a person may decide. If an unknown kind
    // lost its controls, a held outcome would sit undecidable forever and
    // `finishShift` would never let the person finish.
    const seeded = await shift({ withDocument: false })
    const id = await outcome(seeded.runId, {
      kind: 'something-nobody-shipped',
      reversibility: 'held',
      headline: 'Something.',
    })

    expect(asShiftOutcomeKind('something-nobody-shipped')).toBeNull()

    const blocked = await actions.finishShift(seeded.contractId)
    expect(blocked.ok).toBe(false)

    expect((await actions.recordOutcomeVerdict(id, 'reject')).ok).toBe(true)
    expect((await actions.finishShift(seeded.contractId)).ok).toBe(true)
  })
})
