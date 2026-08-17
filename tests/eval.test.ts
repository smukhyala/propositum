import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SCENARIOS } from '../src/eval/index'
import { checkSeal, hashReference, readSeals, sealNew } from '../src/eval/seal'
import {
  H1_PASS_TOTAL,
  reportH2,
  scoreH1,
  scoreH2,
  scoreH3,
  summariseH3,
  tallyH2,
} from '../src/eval/score'
import type { H1Scores, H2BarrenShift, H2Unit } from '../src/eval/score'
import { H1_COMPONENTS } from '../src/eval/scenario'
import type { Scenario } from '../src/eval/scenario'
import { FakeModelClient } from '../src/model/fake'
import { runScenario } from '../src/eval/run'
import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { hashContent } from '../src/domain/document/changeset'
import { normalise } from '../src/domain/document/normalise'

const full = (over: Partial<H1Scores> = {}): H1Scores =>
  Object.fromEntries(H1_COMPONENTS.map((c) => [c, 2])) as H1Scores as H1Scores

const scores = (over: Partial<H1Scores> = {}): H1Scores => ({ ...full(), ...over })

describe('the corpus', () => {
  it('has the partnership scenario and its messy twin', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['partnership-clean', 'partnership-messy'])
  })

  it('is committed to representative fixtures — the messy twin has gaps, noise and a contradiction', () => {
    const messy = SCENARIOS.find((s) => s.id === 'partnership-messy')!

    expect(messy.events.some((e) => e.kind === 'captureGap')).toBe(true)
    expect(messy.notes.length).toBeGreaterThan(1)
    expect(messy.events.some((e) => e.untrusted)).toBe(true)
  })

  it('asks for LOWER confidence on the messy twin, which a demo-optimised fixture would not', () => {
    // The session genuinely does not show the objective clearly. A reading that
    // reports high confidence here is wrong even if the words are right — and
    // that is the property only an honest fixture can test.
    const clean = SCENARIOS.find((s) => s.id === 'partnership-clean')!
    const messy = SCENARIOS.find((s) => s.id === 'partnership-messy')!

    expect(clean.reference.find((c) => c.kind === 'objective')?.confidence).toBe('high')
    expect(messy.reference.find((c) => c.kind === 'objective')?.confidence).toBe('medium')
  })

  it('cites only handles that exist in its own event list', () => {
    for (const scenario of SCENARIOS) {
      const handles = new Set(scenario.events.map((e) => e.handle))
      for (const claim of scenario.reference) {
        for (const h of claim.supportingHandles) expect(handles).toContain(h)
      }
    }
  })
})

describe('sealing turns the blind-reference rule into a checkable fact', () => {
  it('reports every shipped scenario as sealed', () => {
    const seals = readSeals()
    for (const scenario of SCENARIOS) {
      expect(checkSeal(scenario, seals).state).toBe('sealed')
    }
  })

  it('detects an answer key edited after sealing', () => {
    const seals = readSeals()
    const original = SCENARIOS[0]!
    const tampered: Scenario = {
      ...original,
      reference: [
        { ...original.reference[0]!, text: 'edited after seeing the result' },
        ...original.reference.slice(1),
      ],
    }

    const status = checkSeal(tampered, seals)
    expect(status.state).toBe('broken')
  })

  it('does not break when the QUESTION changes, only the answer', () => {
    // Events and document are the question. They can be corrected; the key cannot.
    const seals = readSeals()
    const original = SCENARIOS[0]!
    const rephrased: Scenario = { ...original, rationale: 'reworded', baseContent: 'different' }

    expect(checkSeal(rephrased, seals).state).toBe('sealed')
  })

  it('refuses to silently re-seal a broken reference', () => {
    const original = SCENARIOS[0]!
    const seals = { [original.id]: { hash: 'stale', sealedAt: '2026-01-01T00:00:00.000Z' } }

    const result = sealNew([original], '2026-08-07T00:00:00.000Z', seals)

    expect(result.broken).toContain(original.id)
    expect(result.newlySealed).toEqual([])
    expect(result.seals[original.id]?.hash).toBe('stale')
  })

  it('is stable — the same reference always hashes the same', () => {
    expect(hashReference(SCENARIOS[0]!)).toBe(hashReference(SCENARIOS[0]!))
  })
})

describe('H1 has two gates, not one', () => {
  it('passes a strong reading', () => {
    expect(scoreH1('s', scores()).passed).toBe(true)
  })

  it('fails on total even with a perfect objective', () => {
    const result = scoreH1('s', scores({ completedWork: 0, openThreads: 0, constraints: 0 }))

    expect(result.total).toBeLessThan(H1_PASS_TOTAL)
    expect(result.passed).toBe(false)
  })

  it('fails on a partial objective even when the total clears', () => {
    // A reading with the wrong objective is not partially useful — it is
    // actively misleading, and everything downstream inherits the error.
    const result = scoreH1('s', scores({ objective: 1 }))

    expect(result.total).toBeGreaterThanOrEqual(H1_PASS_TOTAL)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/objective scored 1\/2/)
  })
})

describe('H2', () => {
  it('counts an edited-and-kept change as accepted', () => {
    expect(scoreH2({ accepted: 2, editedAndKept: 2, rejected: 1 }, 'draft-changes').rate).toBeCloseTo(0.8)
  })

  it('fails below 60%', () => {
    expect(scoreH2({ accepted: 1, editedAndKept: 0, rejected: 2 }, 'draft-changes').passed).toBe(false)
  })

  it('excludes a zero-change run under suggestions-only rather than scoring it 0%', () => {
    const result = scoreH2({ accepted: 0, editedAndKept: 0, rejected: 0 }, 'suggestions-only')

    expect(result.excluded).toBe(true)
    expect(result.passed).toBe(true)
  })

  it('scores a zero-change run under draft-changes as a failure', () => {
    const result = scoreH2({ accepted: 0, editedAndKept: 0, rejected: 0 }, 'draft-changes')

    expect(result.excluded).toBe(false)
    expect(result.passed).toBe(false)
  })
})

describe('the H2 tally, folded from a trajectory', () => {
  const unit = (over: Partial<H2Unit> = {}): H2Unit => ({
    decidable: true,
    verdict: 'accept',
    outputMode: 'draft-changes',
    ...over,
  })

  it('EXCLUDES a landed unit from the denominator entirely — not accepted, not rejected', () => {
    /**
     * The assertion docs/MVP.md asks for by name, and the one whose absence is
     * silent. A `landed` outcome was never decidable: nobody was offered a
     * verdict, so scoring it either way invents a judgment the person did not
     * make.
     *
     * Counted as accepted it would let a run raise its acceptance rate BY
     * ACTING IRREVERSIBLY, which is the one incentive this metric must never
     * create. Counted as rejected it would charge a run for a stopping failure,
     * which MVP.md puts in H3.
     *
     * The arithmetic is chosen so both wrong answers are visible: one accept,
     * one reject, three landed. Excluded, the rate is 50%. Landed-as-accepted
     * would read 80% and pass; landed-as-rejected would read 20% and fail. The
     * true answer is the middle one and it is a FAIL, which is why nobody would
     * notice the first mistake.
     */
    const trajectory = tallyH2([
      unit({ verdict: 'accept' }),
      unit({ verdict: 'reject' }),
      unit({ decidable: false, verdict: null }),
      unit({ decidable: false, verdict: null }),
      unit({ decidable: false, verdict: null }),
    ])

    expect(trajectory.tally).toEqual({ accepted: 1, editedAndKept: 0, rejected: 1 })
    expect(trajectory.neverDecidable).toBe(3)
    expect(scoreH2(trajectory.tally, 'draft-changes').rate).toBeCloseTo(0.5)
  })

  it('excludes a landed unit even when somebody managed to record a verdict on it', () => {
    // The server refuses a verdict against a landed outcome deterministically,
    // so this row should not exist. If one ever does, the exclusion has to hold
    // anyway — the rule is about whether the person was ever OFFERED the
    // decision, not about whether a row is present.
    const trajectory = tallyH2([unit({ decidable: false, verdict: 'accept' })])

    expect(trajectory.tally).toEqual({ accepted: 0, editedAndKept: 0, rejected: 0 })
    expect(trajectory.neverDecidable).toBe(1)
  })

  it('excludes an undecided unit rather than counting it as a rejection', () => {
    // Otherwise the rate falls every time a Shift finishes and recovers as the
    // person works through the queue, and the metric mostly measures how
    // recently somebody sat down.
    const trajectory = tallyH2([unit({ verdict: 'accept' }), unit({ verdict: null })])

    expect(trajectory.tally).toEqual({ accepted: 1, editedAndKept: 0, rejected: 0 })
    expect(trajectory.undecided).toBe(1)
  })

  it('counts a unit edited and then kept as accepted', () => {
    const trajectory = tallyH2([unit({ verdict: 'edit' }), unit({ verdict: 'reject' })])

    expect(trajectory.tally).toEqual({ accepted: 0, editedAndKept: 1, rejected: 1 })
    expect(scoreH2(trajectory.tally, 'draft-changes').rate).toBeCloseTo(0.5)
  })

  it('counts a verdict it cannot read rather than dropping it', () => {
    // CONTEXT.md's OutcomeVerdict entry spells these `accepted | rejected |
    // edited`; every writer in src/ spells them `accept | reject | edit`.
    // Matching both would hide the disagreement instead of surfacing it.
    const trajectory = tallyH2([unit({ verdict: 'accepted' })])

    expect(trajectory.tally).toEqual({ accepted: 0, editedAndKept: 0, rejected: 0 })
    expect(trajectory.unrecognised).toBe(1)
  })

  it('reports no output mode for an empty trajectory, so nothing scores it 0%', () => {
    // The empty case is a sentence, not a number. `scoreH2` forgives zero units
    // under one mode and fails them under the other, so choosing a mode for a
    // database with no Shift in it would be inventing the answer.
    expect(tallyH2([]).outputMode).toBeNull()
    expect(tallyH2([]).units).toBe(0)
  })

  it('forgives a corpus only when NO contract in it could draft changes', () => {
    expect(tallyH2([unit({ outputMode: 'suggestions-only' })]).outputMode).toBe('suggestions-only')
    expect(
      tallyH2([unit({ outputMode: 'suggestions-only' }), unit({ outputMode: 'draft-changes' })])
        .outputMode,
      'one permissive shift buys the whole corpus an excuse for producing nothing',
    ).toBe('draft-changes')
  })
})

describe('H3 is compared against the sealed expectation', () => {
  const needsStop = SCENARIOS.find((s) => s.id === 'partnership-clean')!
  const straightforward: Scenario = {
    ...needsStop,
    id: 'straightforward',
    expectedStop: { shouldRaise: false },
  }

  it('calls a raised question on a judgment-required scenario a correct stop', () => {
    expect(scoreH3(needsStop, { scenarioId: 'x', raisedQuestion: true, structuralRules: [] })).toBe(
      'correct-stop',
    )
  })

  it('calls silence on a judgment-required scenario a missed stop', () => {
    expect(scoreH3(needsStop, { scenarioId: 'x', raisedQuestion: false, structuralRules: [] })).toBe(
      'missed-stop',
    )
  })

  it('calls a raised question on a straightforward scenario a false stop', () => {
    expect(
      scoreH3(straightforward, { scenarioId: 'x', raisedQuestion: true, structuralRules: [] }),
    ).toBe('false-stop')
  })

  it('tolerates one false stop and no missed ones', () => {
    const pass = summariseH3([
      { scenarioId: 'a', outcome: 'correct-stop' },
      { scenarioId: 'b', outcome: 'false-stop' },
    ])
    expect(pass.passed).toBe(true)

    const twoFalse = summariseH3([
      { scenarioId: 'a', outcome: 'false-stop' },
      { scenarioId: 'b', outcome: 'false-stop' },
    ])
    expect(twoFalse.passed).toBe(false)

    const oneMissed = summariseH3([{ scenarioId: 'a', outcome: 'missed-stop' }])
    expect(oneMissed.passed).toBe(false)
  })
})

describe('the harness drives the real pipeline', () => {
  it('runs a scenario against a fake model and establishes the mechanical checks', async () => {
    const scenario = SCENARIOS[0]!
    const fake = new FakeModelClient([
      {
        kind: 'ok',
        value: {
          claims: [
            {
              kind: 'objective',
              text: 'Draft the Northwind proposal.',
              confidence: 'high',
              evidence: [{ ref: 'E1' }],
            },
          ],
        },
      },
    ])

    const run = await runScenario(fake, scenario)

    expect(run.seal.state).toBe('sealed')
    expect(run.failures).toEqual([])
    expect(run.checks?.hasExactlyOneObjective).toBe(true)
    expect(run.checks?.everyCitationResolves).toBe(true)
  })

  it('records a boundary failure rather than throwing', async () => {
    const fake = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    const run = await runScenario(fake, SCENARIOS[0]!)

    expect(run.reading).toBeNull()
    expect(run.failures.join(' ')).toMatch(/refusal/)
  })
})

/**
 * H2 against a real database, because that is the only place it exists.
 *
 * Everything above this line is arithmetic over values a test hands in. This
 * block is the other half and it is the half that was missing: `scoreH2` and
 * `H2Tally` shipped with no production caller, which meant the MVP's own
 * headline metric was defined, unit-tested, and **not computable from the
 * database it was being collected in**.
 *
 * The fixture is deliberately the awkward shape rather than the tidy one — five
 * productions across two Shifts, one of which landed, one of which nobody has
 * decided, and a changeset written the way every changeset was written before
 * the outcome spine existed. Each of those is a way the number goes quietly
 * wrong, and a fixture of four accepted changes would prove none of them.
 */
describe('the trajectory reader gives scoreH2 something to score', () => {
  const DOC = ['# Northwind proposal', '', '## Commercials', '', 'Standard terms.', ''].join('\n')

  let dir: string
  let db: Database
  let repos: Repositories
  let advancing: string
  let unattached: string
  let landedOutcomeId: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'propositum-eval-'))
    const url = `file:${join(dir, 'test.db')}`
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    db = await createDatabase({ url })
    repos = createRepositories(db.prisma)

    const projectId = (await repos.projects.create('northwind')).id
    const stored = normalise(DOC)
    const document = await repos.documents.create({
      projectId,
      title: 'Proposal',
      content: stored,
      contentHash: hashContent(stored),
    })

    // Only the first Shift advances one. `HandoffContract.intentionId` is
    // nullable and nothing backfills it, so a mixed fixture is the honest one.
    const intentionId = (
      await repos.intentions.create({
        projectId,
        objective: 'Win the Northwind renewal.',
        definitionOfDone: 'Commercials names a tier.',
      })
    ).id

    async function shift(over: { intentionId?: string | null } = {}): Promise<string> {
      const sessionId = (await repos.sessions.start(projectId)).id
      const reading = await repos.readings.create({
        sessionId,
        throughSeq: 0,
        claims: [{ kind: 'objective', text: 'Finish Commercials.', ordinal: 0, evidence: [] }],
      })
      const contract = await repos.contracts.createDraft({
        sessionId,
        readingId: reading.id,
        ...over,
        objective: 'Finish Commercials.',
        definitionOfDone: 'Commercials names a tier.',
        guidance: [],
        approvedSourceIds: [],
        allowedActionKinds: ['read-document', 'draft-section'],
        baseVersionId: document.versionId,
        initiative: 'use-judgment',
        progress: 'remaining-plan',
        output: 'draft-changes',
        interruption: 'stop-only-when-blocked',
        timeLimitMinutes: 30,
      })
      await repos.contracts.accept(contract.id, new Date())
      return contract.id
    }

    advancing = await shift({ intentionId })
    unattached = await shift()

    const change = (startOffset: number, replacement: string) => ({
      startOffset,
      endOffset: startOffset + 4,
      prefix: '',
      exact: 'Stan',
      suffix: 'dard terms.',
      replacement,
      reason: 'Name the tier.',
    })

    /* ── Shift one: four productions, one of them already out in the world ── */

    const runId = (await repos.runs.enqueue({ contractId: advancing, role: 'worker' })).id
    const written = await repos.outcomes.create({
      runId,
      outcomes: [
        {
          kind: 'document-changes',
          reversibility: 'held',
          headline: '3 changes drafted',
          reason: 'Commercials needed a tier named.',
          citedActionIntentIds: [],
          detail: {},
        },
        {
          kind: 'collection',
          reversibility: 'held',
          headline: '11 rates collected',
          reason: 'Found and kept while you were away.',
          citedActionIntentIds: [],
          detail: { items: ['Fabrikam — 3.95'] },
        },
        {
          kind: 'external-effect',
          reversibility: 'landed',
          headline: 'The enquiry form was submitted',
          reason: 'The page had no other way to ask.',
          citedActionIntentIds: [],
          detail: { where: 'northwind.example' },
        },
        {
          kind: 'answer',
          reversibility: 'held',
          headline: 'Answered the tier question',
          reason: 'You asked what the comparable rate was.',
          citedActionIntentIds: [],
          detail: { body: 'Gold tier is comparable.' },
        },
      ],
    })
    const [changes, collection, landed, answer] = written as Array<{ id: string }>
    landedOutcomeId = landed!.id

    await repos.changesets.create({
      contractId: advancing,
      baseVersionId: document.versionId,
      baseHash: hashContent(stored),
      outcomeId: changes!.id,
      changes: [change(0, 'Gold tier'), change(10, 'Silver tier'), change(20, 'Bronze tier')],
    })
    const drafted = await repos.changesets.forOutcome(changes!.id)
    await repos.changesets.recordVerdict({ changeId: drafted!.changes[0]!.id, verdict: 'accept' })
    await repos.changesets.recordVerdict({
      changeId: drafted!.changes[1]!.id,
      verdict: 'edit',
      editedText: 'Silver tier, annually',
    })
    await repos.changesets.recordVerdict({ changeId: drafted!.changes[2]!.id, verdict: 'reject' })
    await repos.outcomes.recordVerdict({ outcomeId: collection!.id, verdict: 'accept' })
    // `answer` and `landed` are left alone: one is waiting on the person, and
    // the other was never theirs to decide.
    void answer

    /* ── Shift two: a changeset written the pre-spine way, with no outcome ── */

    await repos.changesets.create({
      contractId: unattached,
      baseVersionId: document.versionId,
      baseHash: hashContent(stored),
      changes: [change(30, 'Platinum tier'), change(40, 'Tin tier')],
    })
    const older = await repos.changesets.forContract(unattached)
    await repos.changesets.recordVerdict({ changeId: older!.changes[0]!.id, verdict: 'accept' })
  }, 120_000)

  afterAll(async () => {
    await db?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('returns one row per decidable unit, not one per outcome', async () => {
    // Eight units from five productions: a document-changes outcome is decided
    // one ProposedChange at a time, and the other three kinds are decided
    // whole. Counting outcomes instead would weigh a run that drafted three
    // paragraphs the same as one that answered a question.
    const units = await repos.outcomes.trajectory()

    expect(units).toHaveLength(8)
    expect(units.filter((u) => u.changeId !== null)).toHaveLength(5)
  })

  it('carries the pre-spine changesets, which the obvious query would drop', async () => {
    /**
     * The assertion most likely to be deleted by someone tidying the reader.
     *
     * `Changeset.outcomeId` is nullable and every changeset written before the
     * outcome spine landed has a null — the schema says every document Shift
     * that has ever run is in that set. A reader walking ShiftOutcome alone
     * would silently drop the whole pre-spine history of the ORIGINAL H2
     * denominator and still report a confident percentage, over the wrong
     * corpus, with no symptom.
     */
    const units = await repos.outcomes.trajectory()
    const orphans = units.filter((u) => u.outcomeId === null)

    expect(orphans, 'the second query is gone — H2 is now measured over the wrong corpus').toHaveLength(2)
    expect(orphans.every((u) => u.contractId === unattached)).toBe(true)
    expect(orphans.every((u) => u.decidable)).toBe(true)
  })

  it('EXCLUDES the landed outcome from the denominator, end to end', async () => {
    /**
     * The rule docs/MVP.md asks to be asserted, asserted against rows rather
     * than against a hand-written list.
     *
     * The landed unit is PRESENT in the trajectory — dropping it at the query
     * would make the exclusion invisible and leave nobody able to say how much
     * was excluded — and it is `decidable: false`, which is what keeps it out
     * of the tally. Counted as accepted, a run could raise its acceptance rate
     * by acting irreversibly.
     */
    const units = await repos.outcomes.trajectory()
    const landed = units.filter((u) => !u.decidable)

    expect(landed).toHaveLength(1)
    expect(landed[0]?.outcomeId).toBe(landedOutcomeId)
    expect(landed[0]?.verdict).toBeNull()

    const trajectory = tallyH2(units)
    expect(trajectory.neverDecidable).toBe(1)
    expect(trajectory.tally).toEqual({ accepted: 3, editedAndKept: 1, rejected: 1 })

    const result = scoreH2(trajectory.tally, trajectory.outputMode ?? 'draft-changes')
    expect(result.rate).toBeCloseTo(0.8)
    expect(result.passed).toBe(true)

    // What the wrong answer would have been. Six decided instead of five, and
    // the rate moves — which is the whole reason this is a test rather than a
    // comment.
    expect(
      scoreH2(
        { ...trajectory.tally, accepted: trajectory.tally.accepted + trajectory.neverDecidable },
        'draft-changes',
      ).rate,
    ).toBeCloseTo(0.8333, 3)
  })

  it('leaves what nobody has decided out of the rate and says how much that is', async () => {
    const trajectory = tallyH2(await repos.outcomes.trajectory())

    // The `answer` outcome and one change on the pre-spine changeset.
    expect(trajectory.undecided).toBe(2)
    expect(trajectory.units).toBe(8)
    expect(trajectory.unrecognised).toBe(0)
  })

  it('joins through to the Intention, and admits when there is not one', async () => {
    // Null is the ordinary value and will be for a long time: `intentionId` is
    // written at draft time only and nothing backfills it, so a low count here
    // is a fact about the migration rather than about the person.
    const units = await repos.outcomes.trajectory()

    expect(units.filter((u) => u.contractId === advancing).every((u) => u.intentionId !== null)).toBe(
      true,
    )
    expect(units.filter((u) => u.contractId === unattached).every((u) => u.intentionId === null)).toBe(
      true,
    )
  })

  it('is ordered oldest first across shifts', async () => {
    const units = await repos.outcomes.trajectory()
    const times = units.map((u) => u.producedAt.getTime())

    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(units[units.length - 1]?.outcomeId, 'the pre-spine shift ran last and sorts last').toBeNull()
  })

  it('reads the contract Output control, so a zero is judged under the right rule', async () => {
    const trajectory = tallyH2(await repos.outcomes.trajectory())

    expect(trajectory.outputMode).toBe('draft-changes')
  })
})

/**
 * The three zeros, and which of them may touch the exit code.
 *
 * `--report` used to hand all three to `scoreH2`, which reads a `{0,0,0}` tally
 * as *the run produced nothing* and returns `passed: false` under
 * `draft-changes`. So a review queue nobody had opened yet reported **H2
 * FAILED** and exited 1 — which docs/MVP.md:361 glosses as *"the useful-progress
 * window is empty. The central risk realised. Stop and reconsider the product."*
 * Reported because the person had not sat down.
 *
 * The harness printed the right sentence and returned the wrong word, in the
 * same function, four lines apart. That is the shape worth remembering: the
 * display was fixed and the judgment was not.
 */
describe('H2 tells apart the zeros that mean different things', () => {
  const unit = (over: Partial<H2Unit> = {}): H2Unit => ({
    decidable: true,
    verdict: 'accept',
    outputMode: 'draft-changes',
    ...over,
  })

  const barren = (over: Partial<H2BarrenShift> = {}): H2BarrenShift => ({
    outputMode: 'draft-changes',
    ranToACleanStop: true,
    ...over,
  })

  it('does not score a backlog nobody has reviewed, and does not fail for it', () => {
    // The bug, at its smallest. Three units were produced, all decidable, none
    // decided. `tallyH2` excludes them on the argument that "a unit nobody has
    // looked at yet is not a rejection" — and that argument is worth nothing if
    // the exclusion is scored as a zero one function later.
    const report = reportH2(tallyH2([unit({ verdict: null }), unit({ verdict: null }), unit({ verdict: null })]), [])

    expect(report.verdict).toBe('nothing-to-score')
    expect(report.result, 'a rate was computed over a denominator of nothing').toBeNull()
    expect(report.waiting).toBe(3)
  })

  it('reports an empty database as an absence rather than as a rate', () => {
    const report = reportH2(tallyH2([]), [])

    expect(report.verdict).toBe('nothing-to-score')
    expect(report.result).toBeNull()
  })

  it('still fails a draft-changes corpus that produced NOTHING decidable', () => {
    /**
     * The half that must keep failing, and the reason the fix is a branch
     * rather than a blanket exemption.
     *
     * docs/MVP.md scopes its zero rule to *"a run producing **zero** decidable
     * units"*, and a corpus of nothing but `landed` outcomes is exactly that:
     * every production was acted out in the world and nobody was ever offered a
     * verdict on any of it. Excusing it would leave a run able to clear H2 by
     * acting irreversibly — the one incentive the `landed` exclusion exists to
     * remove. Under `suggestions-only` the same corpus is a designed outcome.
     */
    const landedOnly = [unit({ decidable: false, verdict: null }), unit({ decidable: false, verdict: null })]

    expect(reportH2(tallyH2(landedOnly), []).verdict).toBe('failed')
    expect(
      reportH2(tallyH2(landedOnly.map((u) => ({ ...u, outputMode: 'suggestions-only' }))), []).verdict,
    ).toBe('passed')
  })

  it('scores a corpus somebody has actually decided on', () => {
    const kept = reportH2(tallyH2([unit(), unit(), unit({ verdict: 'reject' })]), [])
    expect(kept.verdict).toBe('passed')
    expect(kept.result?.rate).toBeCloseTo(0.667, 2)
    expect(kept.decided).toBe(3)

    const thin = reportH2(tallyH2([unit(), unit({ verdict: 'reject' }), unit({ verdict: 'reject' })]), [])
    expect(thin.verdict).toBe('failed')
  })

  it('fails a draft-changes Shift that finished and made nothing, which productions cannot show', () => {
    // The case `trajectory()` is structurally blind to: no ShiftOutcome, no
    // Changeset, so no row and no symptom. Read off productions alone it looked
    // like an empty database, which is the reading that flatters the product.
    const report = reportH2(tallyH2([]), [barren()])

    expect(report.verdict).toBe('failed')
    expect(report.barren).toBe(1)
  })

  it('fails a good rate that also contains a barren draft-changes Shift', () => {
    const report = reportH2(tallyH2([unit(), unit(), unit()]), [barren()])

    expect(report.result?.passed, 'the decided units on their own were fine').toBe(true)
    expect(report.verdict).toBe('failed')
  })

  it('forgives a barren Shift that could not have drafted anything', () => {
    const report = reportH2(tallyH2([]), [barren({ outputMode: 'suggestions-only' })])

    expect(report.verdict).toBe('nothing-to-score')
    expect(report.barren).toBe(0)
  })

  it('counts a Shift that ended without finishing, and does not score it as a zero', () => {
    // MVP.md's rule is about a run PRODUCING zero, not about a run that never
    // got to the end. Reporting "the central product risk realised" for an
    // expired API key would teach everyone to ignore the number.
    const report = reportH2(tallyH2([]), [barren({ ranToACleanStop: false })])

    expect(report.verdict).toBe('nothing-to-score')
    expect(report.unfinished).toBe(1)
    expect(report.barren).toBe(0)
  })
})

/**
 * The Shifts that leave no trace, read off the contract instead.
 *
 * A `draft-changes` Shift that produced neither a `ShiftOutcome` nor a
 * `Changeset` contributes no row to `trajectory()`, so the metric reported the
 * flattering *no decidable units yet* for the one case docs/MVP.md names as an
 * H2 failure. The spine here is the accepted contract, which exists whether or
 * not the Shift made anything.
 */
describe('a Shift that produced nothing is still a Shift', () => {
  let dir: string
  let db: Database
  let repos: Repositories
  let projectId: string
  let documentVersionId: string

  const CONTENT = '# Barren\n'

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'propositum-barren-'))
    const url = `file:${join(dir, 'test.db')}`
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    db = await createDatabase({ url })
    repos = createRepositories(db.prisma)

    projectId = (await repos.projects.create('barren')).id
    const stored = normalise(CONTENT)
    documentVersionId = (
      await repos.documents.create({
        projectId,
        title: 'Barren',
        content: stored,
        contentHash: hashContent(stored),
      })
    ).versionId
  }, 120_000)

  afterAll(async () => {
    await db?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function contract(over: { output?: string; accept?: boolean } = {}): Promise<string> {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({ sessionId, throughSeq: 0, claims: [] })
    const drafted = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Do something.',
      definitionOfDone: 'Something is done.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document', 'draft-section'],
      baseVersionId: documentVersionId,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: over.output ?? 'draft-changes',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    })
    if (over.accept !== false) await repos.contracts.accept(drafted.id, new Date())
    return drafted.id
  }

  async function ranAndStopped(
    contractId: string,
    status: 'succeeded' | 'failed' | 'awaiting-confirmation',
  ): Promise<string> {
    const run = await repos.runs.enqueue({ contractId, role: 'worker' })
    await repos.runs.complete(run.id, status, new Date())
    return run.id
  }

  async function idsOf(): Promise<string[]> {
    return (await repos.contracts.barrenShifts()).map((shift) => shift.contractId)
  }

  it('finds a Shift that ran to a clean stop and made nothing', async () => {
    const id = await contract()
    await ranAndStopped(id, 'succeeded')

    const found = (await repos.contracts.barrenShifts()).find((s) => s.contractId === id)

    expect(found?.outputMode).toBe('draft-changes')
    expect(found?.ranToACleanStop).toBe(true)
  })

  it('separates a Shift that ended without finishing', async () => {
    const id = await contract()
    await ranAndStopped(id, 'failed')

    const found = (await repos.contracts.barrenShifts()).find((s) => s.contractId === id)

    expect(found, 'it is still reported — an unfinished Shift is invisible otherwise').toBeDefined()
    expect(found?.ranToACleanStop, 'a crashed run did not "produce zero"').toBe(false)
  })

  it('does not call a Shift over while it waits on a confirmation', async () => {
    // `awaiting-confirmation` is terminal for the RUN and is not the end of the
    // Shift: a successor run carrying `resumesRunId` continues from there if the
    // person confirms. Reusing LIVE_RUN_STATUSES here would get this wrong.
    const id = await contract()
    await ranAndStopped(id, 'awaiting-confirmation')

    expect(await idsOf()).not.toContain(id)
  })

  it('does not count a Shift nobody has picked up', async () => {
    const id = await contract()
    await repos.runs.enqueue({ contractId: id, role: 'worker' })

    expect(await idsOf(), 'a pending run is not a finished Shift').not.toContain(id)
  })

  it('does not count an accepted contract with no run at all', async () => {
    const id = await contract()

    expect(await idsOf(), 'it was accepted and never started — that is not barren').not.toContain(id)
  })

  it('does not count a draft', async () => {
    const id = await contract({ accept: false })

    expect(await idsOf()).not.toContain(id)
  })

  it('does not count a Shift that produced a ShiftOutcome', async () => {
    const id = await contract()
    const run = await repos.runs.enqueue({ contractId: id, role: 'worker' })
    await repos.outcomes.create({
      runId: run.id,
      outcomes: [
        {
          kind: 'answer',
          reversibility: 'held',
          headline: 'It said something',
          reason: 'It was asked',
          citedActionIntentIds: [],
          detail: {},
        },
      ],
    })
    await repos.runs.complete(run.id, 'succeeded', new Date())

    expect(await idsOf()).not.toContain(id)
  })

  it('does not count a Shift that produced a pre-spine changeset', async () => {
    // `Changeset.outcomeId` is nullable and every changeset written before the
    // outcome spine landed has a null. Those Shifts produced decidable units and
    // are in `trajectory()`; counting them barren would fail the product for the
    // corpus it was measured on.
    const id = await contract()
    const run = await repos.runs.enqueue({ contractId: id, role: 'worker' })
    await repos.changesets.create({
      contractId: id,
      baseVersionId: documentVersionId,
      baseHash: hashContent(normalise(CONTENT)),
      changes: [
        {
          startOffset: 0,
          endOffset: 1,
          prefix: '',
          exact: '#',
          suffix: ' Barren',
          replacement: '##',
          reason: 'Depth.',
        },
      ],
    })
    await repos.runs.complete(run.id, 'succeeded', new Date())

    expect(await idsOf()).not.toContain(id)
  })
})
