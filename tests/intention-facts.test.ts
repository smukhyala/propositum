/**
 * `intentions.factsForEveryProject()` — the reader the front door is built on.
 *
 * ── What is actually being defended here ─────────────────────────────────
 *
 * Two things, and neither is "the query returns rows".
 *
 * 1. **The undecided-outcome arithmetic is the repository's `UNSETTLED` and not
 *    a second copy of it.** That predicate has already been wrong once in the
 *    expensive direction: *"held, and no `OutcomeVerdict`"* is right for four of
 *    the five outcome kinds and permanently false for `document-changes`, which
 *    never receives an `OutcomeVerdict` at all. A second copy of the naive
 *    version would put *Needs you* on the front door forever, for work the
 *    person finished weeks ago — a status word that is always on is a status
 *    word nobody reads. Both directions are tested below with a real changeset,
 *    because that is the only way to tell the two predicates apart.
 *
 * 2. **The cost does not grow with the number of projects.** That is the whole
 *    reason this reader exists rather than four single-parent calls per row, so
 *    it is asserted by counting the queries one call makes with one project and
 *    with several. A test of the returned shape alone would stay green through
 *    exactly the regression the method was written to prevent.
 *
 * The lifecycle word itself is `src/domain/intention/state.ts`'s and is tested
 * in `tests/intention.test.ts` over facts written by hand. What is tested here
 * is the join: facts assembled from real rows, fed to the real function, coming
 * out as the word Home renders.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { IntentionStateFacts, Repositories } from '../src/persistence/repositories/index'
import { intentionState } from '../src/domain/intention/state'
import { workSoFar } from '../src/domain/intention/work-so-far'

let dir: string
let url: string
let db: Database
let repos: Repositories

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/**
 * The facts as Home converts them, minus the one decision Home owns.
 *
 * `sessionPhases` is deliberately empty here: which open sittings are actually
 * being captured is a question only the process holding the capture store can
 * answer, and this file has no capture store. Home's rule is argued in
 * `src/app/page.tsx`; what this proves is everything either side of it.
 */
function wordFor(facts: IntentionStateFacts): string {
  return intentionState(
    {
      completedAtEpochMs: facts.completedAt === null ? null : facts.completedAt.getTime(),
      sessionPhases: [],
      liveAcceptedContracts: facts.liveAcceptedContracts,
      unansweredConfirmationsAskedAtEpochMs: facts.unansweredConfirmationsAskedAt.map((at) =>
        at.getTime(),
      ),
      openDecisions: facts.openDecisions,
      undecidedHeldOutcomes: facts.undecidedHeldOutcomes,
    },
    NOW,
  )
}

/* ── fixtures ───────────────────────────────────────────────────────────── */

/** A project with an Intention, a sitting, and an accepted contract on it. */
async function shiftOn(name: string): Promise<{
  projectId: string
  intentionId: string
  sessionId: string
  contractId: string
  runId: string
  baseVersionId: string
}> {
  const project = await repos.projects.create(name)
  const intention = await repos.intentions.create({
    projectId: project.id,
    objective: `Get somewhere with ${name}`,
    definitionOfDone: 'There is something to show for it',
  })
  const session = await repos.sessions.start(project.id, intention.id)
  const reading = await db.prisma.sessionReading.create({
    data: { sessionId: session.id, throughSeq: 1 },
    select: { id: true },
  })
  const document = await repos.documents.create({
    projectId: project.id,
    title: name,
    content: `# ${name}\n`,
    contentHash: hash(`# ${name}\n`),
  })
  const contract = await repos.contracts.createDraft({
    sessionId: session.id,
    readingId: reading.id,
    intentionId: intention.id,
    objective: `Get somewhere with ${name}`,
    definitionOfDone: 'There is something to show for it',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['read-document'],
    baseVersionId: document.versionId,
    initiative: 'follow-closely',
    progress: 'current-step-only',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  })
  await repos.contracts.accept(contract.id, new Date(NOW - 3_600_000))
  const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

  return {
    projectId: project.id,
    intentionId: intention.id,
    sessionId: session.id,
    contractId: contract.id,
    runId: run.id,
    baseVersionId: document.versionId,
  }
}

async function factsFor(projectId: string): Promise<IntentionStateFacts> {
  const all = await repos.intentions.factsForEveryProject()
  const found = all.find((row) => row.projectId === projectId)
  if (found === undefined) throw new Error(`no facts for ${projectId}`)
  return found
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-intention-facts-'))
  url = `file:${join(dir, 'test.db')}`
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

describe('the quiet cases, which are most of them', () => {
  it('says sleeping for an Intention nothing is happening to', async () => {
    const project = await repos.projects.create('A quiet subject')
    await repos.intentions.create({
      projectId: project.id,
      objective: 'Read about turtles',
      definitionOfDone: 'I know more about turtles',
    })

    const facts = await factsFor(project.id)

    expect(facts.liveAcceptedContracts).toBe(0)
    expect(facts.openDecisions).toBe(0)
    expect(facts.undecidedHeldOutcomes).toBe(0)
    expect(facts.waitingContractId).toBeNull()
    expect(wordFor(facts)).toBe('sleeping')
  })

  it('returns nothing at all for a Project nobody stated an Intention for', async () => {
    // The ordinary case for every project recorded before ADR-0011, and for
    // every degraded acceptance since: no offer was composed, so no sentence
    // was on screen, so no row was written. Home renders the absence rather
    // than inventing a sixth state for it.
    const project = await repos.projects.create('Never stated')

    const all = await repos.intentions.factsForEveryProject()

    expect(all.map((row) => row.projectId)).not.toContain(project.id)
  })

  it('carries the open sittings and their phases without judging them', async () => {
    // The phase is reported, not interpreted. A row saying `observing` means a
    // human started a sitting and no human ended it — whether anything is being
    // captured is the app process's question, and this layer cannot see the
    // answer. See `IntentionStateFacts.openSessions`.
    const project = await repos.projects.create('Left open')
    const intention = await repos.intentions.create({
      projectId: project.id,
      objective: 'Something',
      definitionOfDone: 'Something else',
    })
    const open = await repos.sessions.start(project.id, intention.id)
    const closed = await repos.sessions.start(project.id, intention.id)
    await repos.sessions.end(closed.id, new Date(NOW))

    const facts = await factsFor(project.id)

    expect(facts.openSessions.map((sitting) => sitting.id)).toEqual([open.id])
    expect(facts.openSessions[0]?.phase).toBe('observing')
    // ...and Home vouching for none of them lands on the member that claims
    // least, rather than on `working`.
    expect(wordFor(facts)).toBe('sleeping')
  })
})

describe('a person is told when something is waiting on them', () => {
  it('counts a held outcome nobody has accepted or rejected', async () => {
    const shift = await shiftOn('An answer nobody read')
    await repos.outcomes.create({
      runId: shift.runId,
      outcomes: [
        {
          kind: 'answer',
          reversibility: 'held',
          headline: 'Northwind renew in March',
          reason: 'Two of the pages said so',
          citedActionIntentIds: [],
          detail: {},
        },
      ],
    })

    const facts = await factsFor(shift.projectId)

    expect(facts.undecidedHeldOutcomes).toBe(1)
    expect(wordFor(facts)).toBe('needs-you')
    expect(facts.waitingContractId).toBe(shift.contractId)
  })

  it('never counts a landed outcome, because there is no verdict to offer', async () => {
    // The effect is already outside Propositum. Putting an Accept/Reject pair
    // over something that has happened is a lie about what the buttons do.
    const shift = await shiftOn('Something that landed')
    await repos.outcomes.create({
      runId: shift.runId,
      outcomes: [
        {
          kind: 'external-effect',
          reversibility: 'landed',
          headline: 'Sent it',
          reason: 'It is out there',
          citedActionIntentIds: [],
          detail: {},
        },
      ],
    })
    // The shift is over, so nothing else is claiming this Intention: what is
    // being tested is that a landed outcome leaves it alone.
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW))

    const facts = await factsFor(shift.projectId)

    expect(facts.undecidedHeldOutcomes).toBe(0)
    expect(wordFor(facts)).toBe('sleeping')
  })

  /**
   * The decision a run declined to make, and why it cannot say *Needs you*.
   *
   * A `DecisionNeeded` has no answered, resolved or verdict column; nothing
   * deletes one; the contract carrying it never leaves `accepted`. So a count
   * of them can only go up, and `intentionState` ranks `openDecisions > 0`
   * above everything — which put *Needs you* on that Project's front door
   * permanently, for a question the person read weeks ago, with a link to a
   * note where nothing can be done about it.
   *
   * Both halves are asserted because the trade is the point: the count is zero,
   * AND the note is still the one a person would want if anything else brings
   * them back. What is lost is named in `IntentionStateFacts.openDecisions` and
   * is not small: a Shift that stopped to ask and produced nothing else now
   * reads `sleeping`.
   */
  it('does not sit on needs-you forever for a decision nothing can clear', async () => {
    const shift = await shiftOn('A question for you')
    await repos.reports.create({
      contractId: shift.contractId,
      narrative: null,
      decisions: [
        {
          question: 'Which tier should the proposal offer?',
          whyStopped: 'This commits us to a price',
          needs: 'Your call on the tier',
          ordinal: 1,
        },
      ],
    })
    // The shift is over, so nothing else is claiming this Intention: what is
    // under test is the decision alone.
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW))

    const facts = await factsFor(shift.projectId)

    expect(facts.openDecisions).toBe(0)
    expect(wordFor(facts)).toBe('sleeping')
    // It still decides WHICH note is worth opening, on the same terms an
    // expired confirmation does one field down.
    expect(facts.waitingContractId).toBe(shift.contractId)
  })

  it('counts an unanswered confirmation, and leaves expiry to the domain', async () => {
    // The repository reports WHEN it was asked and nothing more. Whether the
    // answer is still accepted is `confirmationHasExpired`'s, and having that
    // rule in two places is how a question the system will refuse to accept an
    // answer to pins *Needs you* on a project permanently.
    const shift = await shiftOn('A question mid-shift')
    const intent = await db.prisma.actionIntent.create({
      data: {
        runId: shift.runId,
        seq: 1,
        kind: 'click-element',
        reason: 'Press Send',
        params: {},
        authorized: false,
        refusedRule: 'confirmation_required',
      },
      select: { id: true },
    })
    await repos.confirmations.create({
      runId: shift.runId,
      intentId: intent.id,
      summary: 'Press Send on the message',
    })

    const facts = await factsFor(shift.projectId)

    expect(facts.unansweredConfirmationsAskedAt).toHaveLength(1)
    expect(wordFor(facts)).toBe('needs-you')
  })
})

/**
 * The predicate that has already been wrong once, in both directions.
 *
 * A `document-changes` outcome never receives an `OutcomeVerdict` — its
 * decidable units are the individual `ProposedChange`s, each carrying its own
 * `ChangeVerdict`. So "held with no `OutcomeVerdict`" matches it forever, and
 * the front door would say *Needs you* about every document Shift ever run.
 */
describe('document changes settle one change at a time', () => {
  async function documentShift(name: string, decide: boolean) {
    const shift = await shiftOn(name)
    const written = await repos.outcomes.create({
      runId: shift.runId,
      outcomes: [
        {
          kind: 'document-changes',
          reversibility: 'held',
          headline: 'Drafted the commercials section',
          reason: 'The agreement asked for it',
          citedActionIntentIds: [],
          detail: {},
        },
      ],
    })
    const outcomeId = written[0]!.id
    const changeset = await repos.changesets.create({
      contractId: shift.contractId,
      baseVersionId: shift.baseVersionId,
      baseHash: hash(`# ${name}\n`),
      outcomeId,
      changes: [
        {
          startOffset: 0,
          endOffset: 0,
          prefix: '',
          exact: '',
          suffix: '',
          replacement: 'Commercials: three tiers.',
          reason: 'It was missing',
        },
      ],
    })

    if (decide) {
      const stored = await repos.changesets.forOutcome(outcomeId)
      await repos.changesets.recordVerdict({ changeId: stored!.changes[0]!.id, verdict: 'accept' })
    }

    // The run produced its changes and stopped, which is what makes the word
    // under test the one the outcome decides rather than `delegated`.
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW))

    return { ...shift, changesetId: changeset.id }
  }

  it('is waiting while any proposed change is undecided', async () => {
    const shift = await documentShift('An undecided draft', false)

    const facts = await factsFor(shift.projectId)

    expect(facts.undecidedHeldOutcomes).toBe(1)
    expect(wordFor(facts)).toBe('needs-you')
  })

  it('is not waiting once every change has a verdict, even with no OutcomeVerdict', async () => {
    // The expensive direction. Getting this wrong is silent: the word is right
    // for a day and wrong forever after, and nothing on screen says which.
    const shift = await documentShift('A settled draft', true)

    const facts = await factsFor(shift.projectId)

    expect(facts.undecidedHeldOutcomes).toBe(0)
    expect(wordFor(facts)).toBe('sleeping')
  })
})

describe('a shift that is still going is delegated, not waiting', () => {
  it('counts an accepted contract whose run has not reached a terminal status', async () => {
    const shift = await shiftOn('Propositum has this')

    const facts = await factsFor(shift.projectId)

    // `enqueue` leaves the run `pending`, which is one of the three statuses
    // the re-entry screen also calls live.
    expect(facts.liveAcceptedContracts).toBe(1)
    expect(wordFor(facts)).toBe('delegated')
  })

  it('stops counting it once the run has ended', async () => {
    const shift = await shiftOn('Propositum finished')
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW))

    const facts = await factsFor(shift.projectId)

    expect(facts.liveAcceptedContracts).toBe(0)
    expect(wordFor(facts)).toBe('sleeping')
  })
})

describe('a human act outranks everything computed', () => {
  it('says done from completedAt, whatever the rows underneath are doing', async () => {
    const shift = await shiftOn('Finished with this')
    // No repository method writes this yet — completing an Intention is a human
    // act with no screen behind it, and `IntentionRepository` says why it
    // arrives with that screen rather than ahead of it. Written directly so the
    // precedence can be tested before the button exists.
    await db.prisma.intention.update({
      where: { projectId: shift.projectId },
      data: { completedAt: new Date(NOW - 60_000) },
    })

    const facts = await factsFor(shift.projectId)

    expect(facts.liveAcceptedContracts).toBe(1)
    expect(wordFor(facts)).toBe('done')
  })
})

describe('the front door does not get slower as Propositum identifies things', () => {
  it('issues the same number of queries for one project as for many', async () => {
    /**
     * The claim the reader exists for, measured rather than asserted in a
     * comment.
     *
     * Home lists every Project and `intentionState` needs five separate facts
     * per Intention. Composed out of the single-parent readers that is four
     * round trips per row — 4N on the most-hit route in the product, growing
     * every time Propositum identifies something. A shape test would stay green
     * through exactly that regression, so this counts the queries instead.
     *
     * A separate client, because query events need an emitter the app's
     * `createDatabase` deliberately does not offer: query text carries user
     * content, and useful logging that does not leak private content is the
     * standard. The guards are already installed on this file by the handle
     * above.
     */
    const logged = new PrismaClient({
      datasources: { db: { url } },
      log: [{ emit: 'event', level: 'query' }],
    })

    try {
      let queries = 0
      logged.$on('query', () => {
        queries += 1
      })
      const counting = createRepositories(logged)

      await counting.intentions.factsForEveryProject()
      const forWhatIsThere = queries

      // Ten more projects, each with an Intention of its own.
      for (let i = 0; i < 10; i += 1) {
        const project = await repos.projects.create(`Another subject ${i}`)
        await repos.intentions.create({
          projectId: project.id,
          objective: 'Something',
          definitionOfDone: 'Something else',
        })
      }

      queries = 0
      const facts = await counting.intentions.factsForEveryProject()
      const forTenMore = queries

      // Guards against the counter never firing, which would make the
      // comparison below 0 === 0 and the whole test vacuous.
      expect(forWhatIsThere, 'no queries were observed at all').toBeGreaterThan(0)
      expect(facts.length).toBeGreaterThan(10)
      expect(
        forTenMore,
        'the reader fans out per project — Home is back to 4N queries on its most-hit route',
      ).toBe(forWhatIsThere)
    } finally {
      await logged.$disconnect()
    }
  })
})

/**
 * `intentions.workSoFarFacts()` — the rows behind *Where you left off*.
 *
 * ── Why this is a second reader and not a widening of the first ──────────
 *
 * `factsForEveryProject` answers one question for N projects on the most-hit
 * route in the product, and its own docblock spends a paragraph on why it may
 * not fan out. This one answers a different question for ONE Intention, on two
 * screens a person reaches deliberately, and it reads rows the front door has no
 * business loading — every ProposedChange verdict under a season of work, for
 * instance. Folding it into the front door's reader would put that cost on Home.
 *
 * ── The one field where the two readers disagree, on purpose ─────────────
 *
 * `openQuestions` here is a real count; `IntentionStateFacts.openDecisions` is
 * always zero. Nothing in the schema can close a `DecisionNeeded`, so a non-zero
 * count there pins the lifecycle word `needs-you` onto a Project permanently —
 * a status word that is always on is a status word nobody reads. Here it is one
 * sentence in a paragraph read once before starting, and *a question was raised
 * and nothing has closed it* is simply true. The disagreement is the design and
 * is asserted below rather than left to look like a bug.
 */
describe('the rows behind where you left off', () => {
  it('says nothing about an Intention that does not exist', async () => {
    expect(await repos.intentions.workSoFarFacts('made-up')).toBeNull()
  })

  it('folds a season of work into sentences a person can check', async () => {
    const shift = await shiftOn('The Northwind renewal')
    const written = await repos.outcomes.create({
      runId: shift.runId,
      outcomes: [
        {
          kind: 'document-changes',
          reversibility: 'held',
          headline: 'Drafted the commercials section',
          reason: 'The agreement asked for it',
          citedActionIntentIds: [],
          detail: {},
        },
      ],
    })
    const outcomeId = written[0]!.id
    await repos.changesets.create({
      contractId: shift.contractId,
      baseVersionId: shift.baseVersionId,
      baseHash: hash('# The Northwind renewal\n'),
      outcomeId,
      changes: [
        {
          startOffset: 0,
          endOffset: 0,
          prefix: '',
          exact: '',
          suffix: '',
          replacement: 'Commercials: three tiers.',
          reason: 'It was missing',
        },
        {
          startOffset: 0,
          endOffset: 0,
          prefix: '',
          exact: '',
          suffix: '',
          replacement: 'Term: two years.',
          reason: 'It was missing too',
        },
      ],
    })
    const stored = await repos.changesets.forOutcome(outcomeId)
    await repos.changesets.recordVerdict({ changeId: stored!.changes[0]!.id, verdict: 'accept' })
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW - 2 * 24 * 60 * 60 * 1000))
    await repos.sessions.end(shift.sessionId, new Date(NOW - 2 * 24 * 60 * 60 * 1000))

    const rows = await repos.intentions.workSoFarFacts(shift.intentionId)
    if (rows === null) throw new Error('no facts')

    expect(rows.projectId).toBe(shift.projectId)
    expect(rows.sittingsEndedAt).toHaveLength(1)
    expect(rows.documents).toBe(1)
    expect(rows.produced).toEqual([
      { kind: 'document-changes', reversibility: 'held', verdict: null },
    ])
    expect(rows.changeVerdicts).toHaveLength(2)
    expect(rows.changeVerdicts.filter((v) => v === 'accept')).toHaveLength(1)
    expect(rows.changeVerdicts.filter((v) => v === null)).toHaveLength(1)
    expect(rows.lastStop).toEqual({ status: 'succeeded', terminalReason: null })

    // ...and the fold over them, which is what a person actually reads.
    const view = workSoFar(
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
      NOW,
    )

    expect(view.anythingToSay).toBe(true)
    expect(view.lines.join(' ')).toContain('One sitting so far. The last one ended 2 days ago.')
    expect(view.lines.join(' ')).toContain('Propositum has produced changes to your document.')
    expect(view.lines.join(' ')).toContain(
      'you accepted 1, rejected none and reworded none — 1 is still undecided',
    )
  })

  it('counts a question the front door has to report as zero', async () => {
    const shift = await shiftOn('A question that cannot be closed')
    await repos.reports.create({
      contractId: shift.contractId,
      narrative: null,
      decisions: [
        {
          question: 'Which tier should the proposal offer?',
          whyStopped: 'This commits us to a price',
          needs: 'Your call on the tier',
          ordinal: 1,
        },
      ],
    })
    await repos.runs.complete(shift.runId, 'succeeded', new Date(NOW))

    const rows = await repos.intentions.workSoFarFacts(shift.intentionId)

    expect(rows?.openQuestions).toBe(1)
    // The same rows, read by the front door, which must say zero. Both are
    // right; the difference is what each number is allowed to change.
    expect((await factsFor(shift.projectId)).openDecisions).toBe(0)
  })

  it('carries the Intention’s own words and when a person last wrote them', async () => {
    // The agreement screen owes a person the DATE those words were written, and
    // it cannot say it unless something carries it. Nothing model-written
    // travels with them: this is the row a person ratified.
    const shift = await shiftOn('Words with a date on them')

    const rows = await repos.intentions.workSoFarFacts(shift.intentionId)

    expect(rows?.objective).toBe('Get somewhere with Words with a date on them')
    expect(rows?.definitionOfDone).toBe('There is something to show for it')
    expect(rows?.wordsWrittenAt).toBeInstanceOf(Date)
  })
})
