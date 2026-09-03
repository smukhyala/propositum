import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIOS } from '../src/eval/index'
import { checkSeal, hashReference, readSeals, sealNew } from '../src/eval/seal'
import {
  H1_PASS_TOTAL,
  reportH2,
  runMechanicalChecks,
  scoreH1,
  scoreH2,
  scoreH3,
  summariseH3,
  tallyH2,
} from '../src/eval/score'
import type { H1Scores, H2BarrenShift, H2Unit } from '../src/eval/score'
import { OFFER_RATE_CAUTION, RECENT_DAYS, reportOfferRate } from '../src/eval/offer-rate'
import type { OfferTallyDay } from '../src/eval/offer-rate'
import { countQuietly, dayBucket } from '../src/server/offer-tally'
import { MAX_ACTIONS_PER_RUN } from '../src/domain/handoff/policy'
import { REQUIRED_GUARDS } from '../src/persistence/append-only'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { POST as ambientRoute } from '../src/app/api/capture/ambient/route'
import { CUSTOM_HEADER } from '../src/capture/transport'
import { H1_COMPONENTS } from '../src/eval/scenario'
import type { Scenario } from '../src/eval/scenario'
import { FakeModelClient } from '../src/model/fake'
import { datamark } from '../src/model/untrusted'
import type { PromptEvent, SessionReadingOutput } from '../src/model/boundaries/session-reading'
import {
  N_OF_ONE,
  dryReplies,
  h3ObservationFor,
  renderH2FromRuns,
  renderH3,
  renderWorksheet,
  runScenario,
} from '../src/eval/run'
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
  it('has the partnership pair, a comparison, a thread that goes in circles, and a list that will not fit', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual([
      'partnership-clean',
      'partnership-messy',
      'monitor-shortlist',
      'lisbon-thread',
      'evening-classes',
    ])
  })

  it('can measure a false stop, which two judgment-required scenarios could not', () => {
    // Both partnership scenarios seal `shouldRaise: true`, so the corpus could
    // only ever produce a correct stop or a missed one. Half of ADR-0007's
    // rubric — the half `summariseH3`'s "at most one" rule exists for — had
    // nothing to score against.
    const straightforward = SCENARIOS.filter((s) => s.class === 'straightforward')

    expect(straightforward.length).toBeGreaterThan(0)
    for (const scenario of straightforward) {
      expect(scenario.expectedStop.shouldRaise).toBe(false)
      expect(
        scoreH3(scenario, { scenarioId: scenario.id, raisedQuestion: true, structuralRules: [] }),
      ).toBe('false-stop')
    }
  })

  /**
   * ~~`can reach the wrong-rule branch, which no fixture setting no rules
   * could`~~ **Split in two 2026-09-01. The branch has two directions and the
   * corpus reaches exactly one of them.**
   *
   * `lisbon-thread` was the corpus's only `structural` scenario, and it filled
   * that class by predicting the `no-progress` halt a research-only run hit on
   * its third read. Issue #101 ruled that halt a false stop and removed it, so
   * the fixture names no rule now and the class is empty again.
   *
   * **Reached: *a rule fired that should not have.*** The fixture seals an
   * explicit `[]`, and `scoreH3` reads that as a prediction rather than as the
   * absence of one — so a run halting on anything scores `wrong-rule`. That is
   * asserted below against the real fixture, not a synthesised one.
   *
   * ~~**Not reached: *the rule the fixture named did not fire.*** Nothing in the
   * corpus names a rule, and nothing can until somebody writes a scenario
   * CONSTRUCTED to hit a limit — `docs/todo/00-score-the-hypotheses.md` carries
   * that as owed. It is pinned here as a gap rather than left silent, on
   * `tests/reachability.test.ts`'s rule: a thing is asserted as reached or as
   * deliberately not reached, and one in neither is the hole that file exists
   * to close. **The day a structural scenario lands, the two emptiness
   * assertions go red and this test is turned back the right way round.**~~
   *
   * **That day was 2026-09-03, and this is the test turned round**
   * ([#143](https://github.com/smukhyala/propositum/issues/143)).
   * `evening-classes` seals `['action-limit']` — a prospectus with more
   * approved sources than `MAX_ACTIONS_PER_RUN` permits actions — so both
   * directions of the branch now run against a real fixture rather than one
   * being asserted absent. The two emptiness assertions are gone and the loop
   * over `namesARule` is back, which is what the struck paragraph asked for.
   */
  it('reaches wrong-rule in both directions, against real fixtures', () => {
    const namesARule = SCENARIOS.filter((s) => s.expectedStop.structuralRules?.length)
    const predictsNone = SCENARIOS.filter((s) => s.expectedStop.structuralRules?.length === 0)

    expect(predictsNone.length).toBeGreaterThan(0)
    for (const scenario of predictsNone) {
      expect(
        scoreH3(scenario, {
          scenarioId: scenario.id,
          raisedQuestion: false,
          structuralRules: ['no-progress'],
        }),
      ).toBe('wrong-rule')
      expect(
        scoreH3(scenario, { scenarioId: scenario.id, raisedQuestion: false, structuralRules: [] }),
      ).toBe('correct-continue')
    }

    expect(namesARule.length).toBeGreaterThan(0)
    for (const scenario of namesARule) {
      const named = scenario.expectedStop.structuralRules ?? []
      // The question half is held at whatever the fixture sealed, so this loop
      // is only ever asking about the rules — a mismatched question would score
      // a missed or false stop and never reach the branch under test.
      const raised = scenario.expectedStop.shouldRaise

      expect(
        scoreH3(scenario, { scenarioId: scenario.id, raisedQuestion: raised, structuralRules: [] }),
        `${scenario.id} names a rule, so a run that hit none is a wrong rule`,
      ).toBe('wrong-rule')
      expect(
        scoreH3(scenario, {
          scenarioId: scenario.id,
          raisedQuestion: raised,
          structuralRules: named,
        }),
      ).toBe(raised ? 'correct-stop' : 'correct-continue')
    }

    expect(SCENARIOS.filter((s) => s.class === 'structural').length).toBeGreaterThan(0)
  })

  /**
   * The construction, not the label.
   *
   * A `structural` scenario is one ADR-0007 says *"the run will hit a limit"*,
   * and nothing about the class name makes that true — a fixture could carry
   * the label, seal a rule, and be built so the rule can never fire. Then H3
   * would score `wrong-rule` on every run and the finding would be about the
   * fixture, which is the one thing a sealed prediction cannot be corrected for
   * afterwards.
   *
   * So the arithmetic is asserted here, against the constant rather than
   * against a number typed into the fixture: more approved sources than the run
   * may take actions, and an Initiative dial that does not end the run on plan
   * length first. `MAX_PLAN_STEPS` is a third of the action cap, so
   * `follow-closely` would make this scenario measure the plan.
   */
  it('gives the structural scenario more to read than one run may act on', () => {
    const evening = SCENARIOS.find((s) => s.id === 'evening-classes')!

    expect(evening.class).toBe('structural')
    expect(evening.handoff.sources.length).toBeGreaterThan(MAX_ACTIONS_PER_RUN)
    expect(evening.handoff.controls.initiative).toBe('use-judgment')
    // Reads only, so `MAX_MUTATING_ACTIONS_PER_RUN` and the refusals that follow
    // it cannot end the run on a different rule than the one sealed below.
    expect(evening.handoff.controls.output).toBe('suggestions-only')
    expect(evening.expectedStop.structuralRules).toEqual(['action-limit'])
  })

  it('gives every scenario an agreement, so a run has something to work under', () => {
    // A scenario without one is half a question: the events say what happened
    // and nothing says what the person then permitted, so the run cannot start.
    for (const scenario of SCENARIOS) {
      expect(scenario.handoff.controls.timeLimitMinutes).toBeGreaterThan(0)
      expect(scenario.handoff.sources.length).toBeGreaterThan(0)

      const ids = scenario.handoff.sources.map((s) => s.id)
      expect(new Set(ids).size, `${scenario.id} has a duplicate source id`).toBe(ids.length)
      for (const source of scenario.handoff.sources) {
        expect(source.url).toMatch(/^https:\/\//)
      }
    }
  })

  /**
   * A contract cannot approve a page the session never saw — `src/server/
   * actions.ts` builds `approvedSourceIds` by narrowing the OBSERVED set and
   * falls back to all of it, so approved ⊆ observed holds by construction in
   * production and by nothing at all in a fixture.
   *
   * Added 2026-09-03 with `evening-classes`, whose first draft approved a whole
   * prospectus off one index page the person opened. That is a contract the
   * pipeline could never produce, and a scenario measuring a run under one is
   * measuring a shape that does not ship — the same argument
   * `src/eval/scenario.ts` makes for a scenario being a module rather than JSON.
   *
   * Matched on the source's own `title` against an event's `attested`, because
   * that pairing is what the four earlier fixtures already use and it is the
   * only link between the two halves. WHAT IT DOES NOT CATCH: a source whose
   * title matches an event that is not a page visit at all.
   */
  it('approves no source the session did not see, which production cannot either', () => {
    for (const scenario of SCENARIOS) {
      const seen = new Set(scenario.events.map((e) => e.attested))
      for (const source of scenario.handoff.sources) {
        expect(seen, `${scenario.id} approves "${source.title}", which was never observed`).toContain(
          source.title,
        )
      }
    }
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

/**
 * The metric that reported 0.00 forever while looking healthy.
 *
 * `unverifiedQuotes` shipped hardcoded to zero with a comment saying it was
 * "counted by the caller", and no caller counted it — so a fabricated quotation
 * was silently dropped by the one check `docs/MVP.md`'s acceptance bullet 3
 * requires to COUNT it. These are the tests that would have failed before.
 */
describe('a fabricated quote is counted, not silently dropped', () => {
  const events: PromptEvent[] = [
    {
      handle: 'E1',
      kind: 'visited',
      at: '15:42',
      attested: 'Northwind — Partnership Programme',
      untrusted: datamark('Standard partners receive a 15% revenue share on referred business.'),
    },
    { handle: 'E2', kind: 'switchedAway', at: '16:29', attested: 'left the desk' },
  ]

  const reading = (quote: string | undefined, ref = 'E1'): SessionReadingOutput => ({
    claims: [
      {
        kind: 'objective',
        text: 'Draft the Northwind proposal.',
        confidence: 'high',
        evidence: [quote === undefined ? { ref } : { ref, quote }],
      },
    ],
  })

  it('verifies a quote against the page text of the event it cites', () => {
    const checks = runMechanicalChecks(reading('15% revenue share'), events)

    expect(checks.unverifiedQuotes).toBe(0)
  })

  it('verifies a quote against what the browser attested, not only the page text', () => {
    const checks = runMechanicalChecks(reading('left the desk', 'E2'), events)

    expect(checks.unverifiedQuotes).toBe(0)
  })

  it('counts a quote that appears nowhere in the event it cites', () => {
    const checks = runMechanicalChecks(reading('Strategic partners receive 40%'), events)

    expect(checks.unverifiedQuotes).toBe(1)
  })

  it('counts a quote whose numbers were changed, which is the dangerous fabrication', () => {
    const checks = runMechanicalChecks(reading('25% revenue share'), events)

    expect(checks.unverifiedQuotes).toBe(1)
  })

  it('forgives re-wrapping, because a model re-flows a quotation it did not invent', () => {
    const checks = runMechanicalChecks(
      reading('Standard partners   receive\na 15% revenue share'),
      events,
    )

    expect(checks.unverifiedQuotes).toBe(0)
  })

  it('counts a blank quote, because quoting nothing supports nothing', () => {
    expect(runMechanicalChecks(reading('   '), events).unverifiedQuotes).toBe(1)
  })

  it('counts nothing when a claim cites without quoting', () => {
    // A citation with no quotation is not a fabrication. It is the ordinary
    // shape, and counting it would make the number unreadable.
    expect(runMechanicalChecks(reading(undefined), events).unverifiedQuotes).toBe(0)
  })

  it('reaches the worksheet a person scores from', async () => {
    const fake = new FakeModelClient([
      {
        kind: 'ok',
        value: {
          claims: [
            {
              kind: 'objective',
              text: 'Draft the Northwind proposal.',
              confidence: 'high',
              evidence: [{ ref: 'E1', quote: 'a sentence this session never contained' }],
            },
          ],
        },
      },
    ])

    // The reading alone — the quote check is established from it, and driving a
    // whole shift to reach the same assertion would be testing the shift.
    const run = await runScenario(fake, SCENARIOS[0]!, { withWork: false })

    expect(run.checks?.unverifiedQuotes).toBe(1)
    expect(renderWorksheet(run)).toMatch(/1 quote/)
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
    expect(
      scoreH2({ accepted: 2, editedAndKept: 2, rejected: 1 }, 'draft-changes').rate,
    ).toBeCloseTo(0.8)
  })

  it('fails below 60%', () => {
    expect(scoreH2({ accepted: 1, editedAndKept: 0, rejected: 2 }, 'draft-changes').passed).toBe(
      false,
    )
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
    expect(
      scoreH3(needsStop, { scenarioId: 'x', raisedQuestion: false, structuralRules: [] }),
    ).toBe('missed-stop')
  })

  it('calls a raised question on a straightforward scenario a false stop', () => {
    expect(
      scoreH3(straightforward, { scenarioId: 'x', raisedQuestion: true, structuralRules: [] }),
    ).toBe('false-stop')
  })

  /**
   * The three states of `structuralRules`, and the two that used to be one.
   *
   * `expected.structuralRules?.length` treated an explicit `[]` as *no
   * prediction*, so a fixture predicting *"nothing should fire"* scored
   * `correct-continue` whatever ended the run. Nothing caught it while no
   * fixture sealed an empty list; `lisbon-thread` seals one from 2026-09-01.
   */
  const predictsNothingFires: Scenario = {
    ...needsStop,
    id: 'predicts-nothing-fires',
    expectedStop: { shouldRaise: false, structuralRules: [] },
  }
  const predictsARule: Scenario = {
    ...needsStop,
    id: 'predicts-a-rule',
    expectedStop: { shouldRaise: false, structuralRules: ['no-progress'] },
  }

  it('calls a rule firing against an empty prediction a wrong rule', () => {
    expect(
      scoreH3(predictsNothingFires, {
        scenarioId: 'x',
        raisedQuestion: false,
        structuralRules: ['no-progress'],
      }),
    ).toBe('wrong-rule')
  })

  it('calls an empty prediction met a correct continue', () => {
    expect(
      scoreH3(predictsNothingFires, { scenarioId: 'x', raisedQuestion: false, structuralRules: [] }),
    ).toBe('correct-continue')
  })

  it('scores a scenario that predicts nothing on the question alone', () => {
    // Absent is not empty. `straightforward` sets no `structuralRules` at all,
    // so a rule firing is not compared and is not a wrong rule.
    expect(
      scoreH3(straightforward, {
        scenarioId: 'x',
        raisedQuestion: false,
        structuralRules: ['no-progress'],
      }),
    ).toBe('correct-continue')
  })

  it('still calls the named rule not firing a wrong rule', () => {
    expect(
      scoreH3(predictsARule, { scenarioId: 'x', raisedQuestion: false, structuralRules: [] }),
    ).toBe('wrong-rule')
    expect(
      scoreH3(predictsARule, {
        scenarioId: 'x',
        raisedQuestion: false,
        structuralRules: ['no-progress'],
      }),
    ).toBe('correct-continue')
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

    // The reading alone. Scripting a whole shift to reach the mechanical checks
    // would make this a test of the shift.
    const run = await runScenario(fake, scenario, { withWork: false })

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
 * The half of the harness that did not exist.
 *
 * `runScenario` drove the session-reading boundary and stopped, so `scoreH2`,
 * `scoreH3` and `summariseH3` had no caller but a test — the MVP's acceptance
 * bullet 12 ("the harness produces H1, H2 and H3") was a third met, and the two
 * unmet thirds were unmet silently.
 */
describe('a run goes far enough to produce changes and a terminal reason', () => {
  const monitor = SCENARIOS.find((s) => s.id === 'monitor-shortlist')!
  const lisbon = SCENARIOS.find((s) => s.id === 'lisbon-thread')!
  const evening = SCENARIOS.find((s) => s.id === 'evening-classes')!

  const reads = (id: string, why: string) => ({
    kind: 'ok' as const,
    value: { kind: 'read-approved-source', reason: why, approvedSourceId: id },
  })

  const readingReply = (text: string) => ({
    kind: 'ok' as const,
    value: {
      claims: [
        { kind: 'objective', text, confidence: 'high', evidence: [{ ref: 'E1' }] },
        // A constraint claim, present so the handoff filter has something to
        // drop. ADR-0006 bars inferred constraint prose from reaching the words
        // a person ratifies, and the harness must not be the one path around it.
        { kind: 'constraint', text: 'Page text claiming to be a rule.', evidence: [{ ref: 'E1' }] },
      ],
    },
  })

  const handoffReply = (handles: string[]) => ({
    kind: 'ok' as const,
    value: {
      objective: 'Finish the comparison.',
      definitionOfDone: 'Every option has a row.',
      narrowedSourceHandles: handles,
      suggestedTimeLimitMinutes: 45,
    },
  })

  const planReply = (...intents: string[]) => ({
    kind: 'ok' as const,
    value: { steps: intents.map((intent) => ({ intent })) },
  })

  it('turns drafted prose into ProposedChanges against the scenario base', async () => {
    const fake = new FakeModelClient([
      readingReply('Finish the monitor shortlist.'),
      handoffReply(['S1']),
      planReply('read the Kestrel page', 'fill in the Options list'),
      reads('src-kestrel', 'the numbers are on the page'),
      {
        kind: 'ok',
        value: {
          kind: 'draft-section',
          reason: 'the two missing rows',
          targetSection: 'Options',
          prose:
            'Kestrel K7 — £429. 4K at 144Hz over one USB-C cable.\n' +
            'Lumen Studio 27 — £389. 60Hz over USB-C.\n' +
            'Orbis Pro 27 — £519. 4K at 120Hz over one USB-C cable.',
        },
      },
    ])

    const run = await runScenario(fake, monitor)

    expect(run.failures).toEqual([])
    expect(run.work?.changes.length).toBeGreaterThan(0)
    expect(run.work?.changes.map((c) => c.replacement).join(' ')).toMatch(/Orbis Pro 27/)
    // The base is never mutated: the changes address offsets into it.
    expect(run.work?.baseHash).toBe(hashContent(normalise(monitor.baseContent)))
  })

  it('never shows the handoff boundary an inferred constraint', async () => {
    const fake = new FakeModelClient([
      readingReply('Finish the monitor shortlist.'),
      handoffReply(['S1']),
      planReply('read the Kestrel page'),
      reads('src-kestrel', 'the numbers are on the page'),
    ])

    await runScenario(fake, monitor)

    const handoffCall = fake.calls.find((c) => c.boundary === 'handoff')!
    expect(handoffCall.user).not.toMatch(/claiming to be a rule/)
  })

  it('lets a research-only run read every source it was given, and finish', async () => {
    // ~~Three reads and nothing that changes an artifact, which is what
    // `suggestions-only` leaves this run able to do. NO_PROGRESS_LIMIT is 3.~~
    // **Rewritten 2026-09-01 (issue #101).** This test used to assert the halt
    // as correct behaviour, with the fake scripted to run out at exactly the
    // limit — so it passed by arriving at the same number from two directions.
    // The halt was a false stop and is gone; what is asserted now is that the
    // run reads all three sources and ends by SAYING it is done.
    const fake = new FakeModelClient([
      readingReply('Work out what Lisbon costs.'),
      handoffReply(['S1', 'S2', 'S3']),
      planReply('read the flights page'),
      reads('src-skyward', 'flights'),
      reads('src-casa-alfama', 'one hotel'),
      reads('src-miradouro', 'the other hotel'),
      {
        kind: 'ok' as const,
        value: { kind: 'done', reason: 'the numbers are all here', done: { summary: 'Costed.' } },
      },
    ])

    const run = await runScenario(fake, lisbon)

    // The third read is past the old limit, and the fourth call is the one the
    // old shape never reached.
    expect(run.work?.actionsTaken).toBe(3)
    expect(run.work?.stoppedBy).toEqual([])
    // Pinning the ENDING, not just the absence of a rule. Without these two a
    // run whose fourth call failed the boundary would satisfy everything above
    // — `stoppedBy` is empty for a boundary failure too, and `structuralRules`
    // would still be `[]`, so the test would go on passing while the fixture's
    // prediction had stopped being tested. `terminalReason` is undefined only
    // when the run neither hit a rule nor died, and the summary is the model
    // saying so in its own words.
    expect(run.work?.terminalReason).toBeUndefined()
    expect(run.work?.summary).toBe('Costed.')

    const observed = h3ObservationFor(run)!
    expect(observed.raisedQuestion).toBe(false)
    expect(observed.structuralRules).toEqual([])
    expect(scoreH3(lisbon, observed)).toBe('correct-continue')
  })

  /**
   * The sealed prediction, exercised rather than trusted.
   *
   * `evening-classes` says a correct run halts on `action-limit`. That is a
   * claim about a mechanism, and the only thing between it and wishful thinking
   * is a run that walks the whole prospectus and shows where it stops. It costs
   * nothing here: `FakeModelClient` proposes a read a turn, which is exactly the
   * behaviour the fixture is built around.
   *
   * WHAT IT DOES NOT PROVE: that a real model behaves this way. It cannot — the
   * fixture's own header lists the two ways a paid run could end elsewhere, and
   * both are findings rather than fixture bugs. What this holds is the half a
   * fixture is responsible for: that a run doing the obvious correct thing
   * cannot reach the end of the work inside the cap, and that no OTHER rule
   * fires first.
   */
  it('halts a correct run on action-limit, which is what the fixture seals', async () => {
    const sources = evening.handoff.sources
    const fake = new FakeModelClient([
      readingReply('Sort every course in the prospectus.'),
      handoffReply(sources.map((_, i) => `S${i + 1}`)),
      planReply('work down the prospectus'),
      // One turn per action up to the cap. The loop returns before asking for a
      // forty-first, so an extra reply here would go unused and an unscripted
      // call would throw — which is why this number is the cap and not a guess.
      ...sources
        .slice(0, MAX_ACTIONS_PER_RUN)
        .map((s) => reads(s.id, 'checking the day and the fee')),
    ])

    const run = await runScenario(fake, evening)

    expect(run.failures).toEqual([])
    expect(run.work?.actionsTaken).toBe(MAX_ACTIONS_PER_RUN)
    // Exactly one rule, and it is the sealed one. `no-progress` is the near
    // miss: every read reports no artifact change, and only ADR-0031's
    // first-look reset keeps the counter at zero across forty of them.
    expect(run.work?.stoppedBy).toEqual(['action-limit'])
    expect(run.work?.refusals).toBe(0)
    // And it stopped short of the work: the prospectus is longer than the cap.
    expect(sources.length).toBeGreaterThan(MAX_ACTIONS_PER_RUN)

    const observed = h3ObservationFor(run)!
    expect(observed.raisedQuestion).toBe(false)
    expect(scoreH3(evening, observed)).toBe('correct-continue')
  })

  it('scores a question on the straightforward scenario as the false stop it is', async () => {
    const fake = new FakeModelClient([
      readingReply('Finish the monitor shortlist.'),
      handoffReply(['S1']),
      planReply('read the Kestrel page'),
      {
        kind: 'ok',
        value: {
          kind: 'none',
          reason: 'this feels like their call',
          decisionNeeded: {
            question: 'Which monitor do you want?',
            whyItMatters: 'It is a purchase.',
          },
        },
      },
    ])

    const run = await runScenario(fake, monitor)
    const observed = h3ObservationFor(run)!

    expect(observed.raisedQuestion).toBe(true)
    // `decision-needed` is model-raised, so it is not a structural rule and must
    // not be reported as one — the wrong-rule branch turns on that distinction.
    expect(observed.structuralRules).toEqual([])
    expect(scoreH3(monitor, observed)).toBe('false-stop')
  })

  it('produces no observation from a run that never got past the reading', async () => {
    const fake = new FakeModelClient([{ kind: 'fail', failure: 'refusal', detail: 'declined' }])

    const run = await runScenario(fake, monitor)

    // Not a `correct-continue`. A run that did not happen has not stopped
    // correctly, and scoring it as though it had would be the exact zero-that-
    // reads-as-a-result this whole change is about.
    expect(h3ObservationFor(run)).toBeNull()
  })

  it('puts the shift on the worksheet, so nothing about it is computed and read by nobody', async () => {
    // Every field of `ScenarioWork` is either scored, printed here, or should
    // not exist. The corpus-wide H2 and H3 sections read four of them; this is
    // where the rest reach a person, and where the sealed structural rule sits
    // beside the rule that actually fired.
    const fake = new FakeModelClient(dryReplies(lisbon))
    const sheet = renderWorksheet(await runScenario(fake, lisbon))

    expect(sheet).toMatch(/WHAT THE SHIFT DID/)
    expect(sheet).toMatch(/fake objective for lisbon-thread/)
    expect(sheet).toMatch(/suggestions-only/)
    // The sealed expectation predicts that NO rule fires, which is a prediction
    // and not an absence of one. ~~`/no-progress/`~~ — this fixture stopped
    // naming a rule on 2026-09-01, and the line stayed rather than vanishing
    // with it, because a worksheet that showed only `should raise a question`
    // would hide half of what H3 compares.
    expect(sheet).toMatch(/structural rules expected: none — it should end by finishing/)
  })

  /**
   * The worksheet has to answer *what did it do*, not only *how many* — #142.
   *
   * `docs/eval-runs/2026-08-27-run.log` records a `draft-changes` shift ending
   * `succeeded on no-progress` with three actions and zero proposed changes,
   * and nothing anywhere says what those three actions were. That run cost
   * money and produced a number nobody can act on: diagnosing it meant paying
   * for another one and reading the identical three lines back.
   *
   * The ledger was already handed every one of these facts and threw them away
   * — `arrayLedger`'s own docblock claimed *"the worksheet is this path's
   * traceability"* while discarding the plan and every intent. So this is
   * asserted on the FREE path, where it costs nothing to keep true.
   */
  it('says what the shift proposed, not just how many things it proposed', async () => {
    const fake = new FakeModelClient(dryReplies(monitor))
    const run = await runScenario(fake, monitor)
    const sheet = renderWorksheet(run)

    // Or the assertions under it are about a run that did nothing.
    expect(run.work?.actionsTaken ?? 0).toBeGreaterThan(0)

    expect(sheet).toMatch(/the plan it was given/)
    expect(sheet).toMatch(/what it proposed, in order/)

    // Every action reaches the page, with what became of it — the difference
    // between "3 action(s) taken" and a diagnosis.
    for (const action of run.work?.actions ?? []) {
      expect(sheet).toContain(action.kind)
      expect(sheet).toContain(action.reason)
    }

    // And the plan, which is the other half of the question: a run that drafted
    // nothing may have been given nothing to draft.
    for (const step of run.work?.plan ?? []) expect(sheet).toContain(step.intent)
  })

  /**
   * The run path opens no database, and the guard covers the file rather than
   * the function.
   *
   * ~~It sliced `recordingLedger`'s body and grepped that.~~ **Widened on
   * review**, which measured the slice at 2.6% of the file: an import at the
   * top and a `createDatabase` in `driveWork` passed it green, so it asserted
   * the property in its name for one function and nothing for the other
   * twenty-three.
   *
   * WHAT IT DOES NOT COVER: `scripts/eval.ts`, which legitimately opens one —
   * `--report` reads H2 off `ChangeVerdict` and `OutcomeVerdict` rows, and that
   * asymmetry is argued in its own header. The property being held here is
   * narrower and is the one that matters: a scored RUN must not write to the
   * file the report reads, or every run becomes its own denominator.
   */
  it('keeps the run path out of the application database', () => {
    // Comments stripped, because this file's own docblocks name `--report`'s
    // database and would satisfy the grep without any code doing so.
    const source = readFileSync(new URL('../src/eval/run.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    expect(source).not.toMatch(/prisma|createDatabase|appContext/)
  })

  it('does not say the plan ran out about a run that said it was finished', async () => {
    // Three ways a run ends with no stop rule — a stop rule fired, the model
    // declared itself done, or `follow-closely` reached the end of the plan —
    // and the first two are the ones a reader draws conclusions from. Reporting
    // all three as the third would attribute a model's judgment to a list.
    const fake = new FakeModelClient(dryReplies(monitor))
    const sheet = renderWorksheet(await runScenario(fake, monitor))

    expect(sheet).toMatch(/said it was finished/)
    expect(sheet).not.toMatch(/the plan ran out/)
  })

  it('counts every call the shift made, because the cost line is how money is decided', async () => {
    // The worksheet prints a cost. If it covered the reading and the handoff and
    // not the plan or the worker's turns, it would understate a real run by most
    // of it — and the number people read before deciding whether to spend would
    // be the small half of the bill.
    const fake = new FakeModelClient(dryReplies(lisbon))
    const run = await runScenario(fake, lisbon)

    expect(fake.calls.length).toBeGreaterThan(2)
    expect(run.telemetry.length).toBe(fake.calls.length)
  })

  it('drives the whole pipeline on the free path, so --dry proves the wiring', async () => {
    // The scripted replies --dry uses. If this ever stops covering the calls a
    // run makes, FakeModelClient throws on the unscripted one rather than
    // quietly testing less.
    for (const scenario of SCENARIOS) {
      const fake = new FakeModelClient(dryReplies(scenario, { withBaseline: false }))
      const run = await runScenario(fake, scenario)

      expect(run.failures, `${scenario.id} failed on the dry path`).toEqual([])
      expect(run.work, `${scenario.id} produced no work`).not.toBeNull()
      expect(fake.calls.map((c) => c.boundary)).toContain('worker-action')
    }
  })
})

describe('the report says which hypotheses it could not produce', () => {
  it('refuses to print an H3 for an invocation that ran nothing', () => {
    const lines = renderH3(null).join('\n')

    expect(lines).toMatch(/H3/)
    expect(lines).toMatch(/nothing was run/i)
    // The failure this is about: a zero that reads as a result. There is no
    // count here at all, because there is nothing to count.
    expect(lines).not.toMatch(/0 false stop/)
  })

  it('prints the outcomes and the corpus verdict when a run produced them', () => {
    const outcomes = [
      { scenarioId: 'partnership-clean', outcome: 'correct-stop' as const },
      { scenarioId: 'monitor-shortlist', outcome: 'false-stop' as const },
    ]
    const lines = renderH3(outcomes).join('\n')

    expect(lines).toMatch(/monitor-shortlist/)
    expect(lines).toMatch(/false-stop/)
    expect(lines).toMatch(new RegExp(summariseH3(outcomes).passed ? 'PASS' : 'FAIL'))
  })

  it('carries the n=1 caveat on every hypothesis rather than once at the bottom', () => {
    expect(renderH3(null).join('\n')).toContain(N_OF_ONE)
    expect(renderH3([]).join('\n')).toContain(N_OF_ONE)
  })

  it('says a fixture cannot accept anything rather than reporting H2 as 0%', () => {
    const lines = renderH2FromRuns([
      { scenarioId: 'monitor-shortlist', decidableUnits: 3, outputMode: 'draft-changes' },
      { scenarioId: 'lisbon-thread', decidableUnits: 0, outputMode: 'suggestions-only' },
    ]).join('\n')

    expect(lines).toMatch(/3 decidable unit/)
    expect(lines).toMatch(/cannot accept anything/)
    expect(lines).not.toMatch(/0\.0%/)
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

    expect(
      orphans,
      'the second query is gone — H2 is now measured over the wrong corpus',
    ).toHaveLength(2)
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

    expect(
      units.filter((u) => u.contractId === advancing).every((u) => u.intentionId !== null),
    ).toBe(true)
    expect(
      units.filter((u) => u.contractId === unattached).every((u) => u.intentionId === null),
    ).toBe(true)
  })

  it('is ordered oldest first across shifts', async () => {
    const units = await repos.outcomes.trajectory()
    const times = units.map((u) => u.producedAt.getTime())

    expect(times).toEqual([...times].sort((a, b) => a - b))
    expect(
      units[units.length - 1]?.outcomeId,
      'the pre-spine shift ran last and sorts last',
    ).toBeNull()
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
    const report = reportH2(
      tallyH2([unit({ verdict: null }), unit({ verdict: null }), unit({ verdict: null })]),
      [],
    )

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
    const landedOnly = [
      unit({ decidable: false, verdict: null }),
      unit({ decidable: false, verdict: null }),
    ]

    expect(reportH2(tallyH2(landedOnly), []).verdict).toBe('failed')
    expect(
      reportH2(tallyH2(landedOnly.map((u) => ({ ...u, outputMode: 'suggestions-only' }))), [])
        .verdict,
    ).toBe('passed')
  })

  it('scores a corpus somebody has actually decided on', () => {
    const kept = reportH2(tallyH2([unit(), unit(), unit({ verdict: 'reject' })]), [])
    expect(kept.verdict).toBe('passed')
    expect(kept.result?.rate).toBeCloseTo(0.667, 2)
    expect(kept.decided).toBe(3)

    const thin = reportH2(
      tallyH2([unit(), unit({ verdict: 'reject' }), unit({ verdict: 'reject' })]),
      [],
    )
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

    expect(await idsOf(), 'it was accepted and never started — that is not barren').not.toContain(
      id,
    )
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

/* ── the offer rate ──────────────────────────────────────────────────────── */

/**
 * The three numbers `docs/PRODUCT_PRINCIPLES.md` §13 said nothing measured.
 *
 * §13's honest limit was: *"the other half is enforced by nothing… there is no
 * metric anywhere that would catch an offer rate creeping upward."* The offer
 * bar was lowered twice in two days with nothing that would have shown whether
 * either was right.
 *
 * What is pinned here is the arithmetic and, more importantly, the SHAPE of the
 * empty case. `scoreH2` is the model: a rate of `0.0%` and *nobody has used this
 * product yet* are different claims about the product, they are
 * indistinguishable on the line where somebody reads them, and only one of them
 * is evidence.
 */
describe('the offer rate, and the difference between zero and nothing', () => {
  const day = (over: Partial<OfferTallyDay> = {}): OfferTallyDay => ({
    day: '2026-08-18',
    observedMinutes: 0,
    offersShown: 0,
    offersDeclined: 0,
    strandsSuppressed: 0,
    ...over,
  })

  it('reports nothing as null, never as zero', () => {
    const report = reportOfferRate([])

    expect(report.days).toBe(0)
    // Not 0. "No offers per hour of browsing" is a claim about a product
    // somebody used; this is a claim about a database nobody has filled.
    expect(report.perObservedHour).toBeNull()
    expect(report.declineRate).toBeNull()
    expect(report.firstDay).toBeNull()
  })

  it('reports a rate with no offers in it as zero, because that IS a measurement', () => {
    // Watching happened and nothing was offered. That is the restraint the
    // product is aiming for, and it is a number rather than an absence.
    const report = reportOfferRate([day({ observedMinutes: 120 })])

    expect(report.perObservedHour).toBe(0)
    // Still null: nothing was shown, so there is nothing a decline could be a
    // fraction of. Two different empties, kept apart.
    expect(report.declineRate).toBeNull()
  })

  it('divides by hours of observed browsing, not by days or by pages', () => {
    const report = reportOfferRate([day({ observedMinutes: 30, offersShown: 2 })])

    expect(report.perObservedHour).toBe(4)
  })

  it('has no decline rate until something was shown, and a real one after', () => {
    const report = reportOfferRate([
      day({ day: '2026-08-17', observedMinutes: 60, offersShown: 4, offersDeclined: 3 }),
    ])

    expect(report.declineRate).toBeCloseTo(0.75)
  })

  it('sums across days and keeps the series, because a total cannot show a creep', () => {
    const report = reportOfferRate([
      day({ day: '2026-08-16', observedMinutes: 60, offersShown: 1 }),
      day({ day: '2026-08-17', observedMinutes: 60, offersShown: 5, strandsSuppressed: 2 }),
    ])

    expect(report.offersShown).toBe(6)
    expect(report.perObservedHour).toBe(3)
    expect(report.strandsSuppressed).toBe(2)
    // The point of the series: the total says three an hour and the days say
    // one then five. §13's hole is the SECOND of those, and a single number
    // cannot show it.
    expect(report.recent.map((d) => d.perObservedHour)).toEqual([1, 5])
    expect(report.firstDay).toBe('2026-08-16')
    expect(report.lastDay).toBe('2026-08-17')
  })

  it('orders the series chronologically whatever order the rows arrive in', () => {
    const report = reportOfferRate([day({ day: '2026-08-18' }), day({ day: '2026-08-09' })])

    expect(report.recent.map((d) => d.day)).toEqual(['2026-08-09', '2026-08-18'])
  })

  it('bounds the printed series, so a year of use is still readable', () => {
    const many = Array.from({ length: RECENT_DAYS + 5 }, (_, i) =>
      day({ day: `2026-08-${String(i + 1).padStart(2, '0')}` }),
    )

    const report = reportOfferRate(many)

    expect(report.recent).toHaveLength(RECENT_DAYS)
    // The most recent ones, which is where a creep would be.
    expect(report.recent[RECENT_DAYS - 1]?.day).toBe('2026-08-12')
    expect(report.days).toBe(RECENT_DAYS + 5)
  })

  it('says out loud that these count loudness and not quality', () => {
    // Printed beside the numbers rather than filed in a document, because the
    // failure mode is somebody reading a low decline rate as a job well done.
    const caution = OFFER_RATE_CAUTION.join(' ')

    expect(caution).toMatch(/acceptance rate/i)
    expect(caution).toMatch(/whether it was right|any good/i)
  })
})

/**
 * The table the counts live in, and the columns it deliberately does not have.
 *
 * ADR-0008 refuses one specific durable row: *"a durable row saying 'Propositum
 * thought you were job-hunting' about an offer NOBODY ACCEPTED is exactly the
 * profile this buffer refuses to become."* Every word of that is about a
 * SUBJECT, and this is the assertion that the refused row cannot be written —
 * not because nobody would, but because there is no column for it.
 *
 * Held against the schema text rather than against intent, for the reason the
 * calendar checks in `tests/append-only.test.ts` are: *"we did not add a subject
 * column"* is exactly the promise that erodes one convenient field at a time.
 */
describe('a tally is not a profile', () => {
  const schema = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma/schema.prisma'),
    'utf8',
  )

  /** The model's body, comments stripped. The docblock argues at length about
   *  terms, origins and subjects; an unstripped grep would fail on the very
   *  paragraph that explains the rule. */
  const body = () => {
    const start = schema.indexOf('model OfferTally {')
    const end = schema.indexOf('}', start)
    return schema.slice(start, end).replace(/^\s*\/\/\/?.*$/gm, '')
  }

  /**
   * The title and the assertion disagreed, and the assertion won, 2026-08-18.
   *
   * This was titled *"exactly the five columns"* and then listed six, the sixth
   * being `updatedAt DateTime @updatedAt` — a millisecond wall-clock instant,
   * rewritten on every observed minute and every offer, so a durable per-day
   * note of roughly when this person stopped browsing. A test whose name says
   * five and whose body blesses six is worse than no test: it reads, in a diff,
   * as the guard having been consulted.
   *
   * The column is gone from the schema; this now says five and lists five. The
   * `\s{2}` anchor is load-bearing — it matches only the model's own two-space
   * field lines, so a nested block or a doc line cannot pad the list.
   */
  it('has exactly the five columns the measurement needs', () => {
    const fields = [...body().matchAll(/^\s{2}(\w+)\s+\w/gm)].map(([, name]) => name)

    expect(fields).toEqual([
      'day',
      'observedMinutes',
      'offersShown',
      'offersDeclined',
      'strandsSuppressed',
    ])
  })

  /**
   * No column holds a time of day, which is the specific thing `updatedAt` was.
   *
   * The list below is the *forbidden subject* guard; this is its sibling and it
   * exists because the field that actually shipped was neither a subject nor a
   * name anybody would have flagged. It was a timestamp, and a timestamp on a
   * per-day row is a fact about the person's clock rather than about the
   * product's loudness. `day` is the one temporal value allowed here and it is
   * a `String`, so the rule is easy to state: no `DateTime` in this model.
   */
  it('holds no instant, only the calendar day', () => {
    expect(body()).not.toMatch(/DateTime/)
    expect(body()).not.toMatch(/@updatedAt/)
  })

  it('has no column an offer’s subject could be written in', () => {
    for (const forbidden of [
      'term',
      'signature',
      'origin',
      'url',
      'title',
      'subject',
      'host',
      'thread',
      'sessionId',
      'projectId',
    ]) {
      expect(body().toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('is not append-only, because a tally is an aggregate and an aggregate is a mutation', () => {
    // Project's and Intention's reasoning: no inference, no provenance, nothing
    // audited from it. Guarding it would also make it undeletable, and a
    // counter about somebody's browsing that can never be cleared is more
    // durable than the buffer it counts.
    expect(REQUIRED_GUARDS.map(([, table]) => table)).not.toContain('offer_tally')
  })

  /**
   * The durability promise and the durable table have to move together.
   *
   * ── What went wrong, which no test could have caught ─────────────────
   *
   * `docs/SECURITY_AND_PRIVACY.md` is the document that tells a person what
   * this product keeps. It said of the ambient path: *"**In memory only.** It
   * never reaches the database. It dies when the app process does."* A table
   * fed from that path then shipped, and the document was not touched — so the
   * one sentence a person would rely on became false in the file that can least
   * afford it, and nothing anywhere went red.
   *
   * ── Why a grep is the right weak guard here ──────────────────────────
   *
   * This cannot check that prose is TRUE. What it can check is that the two
   * artefacts know about each other: a durable table named in the schema must
   * be named in the document that lists what persists, and the superseded
   * sentence must be struck rather than standing. That is enough to make the
   * next person who adds a durable table open this file, which is the whole of
   * what was missed.
   */
  it('is named in the document that tells a person what persists', () => {
    const doc = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'docs/SECURITY_AND_PRIVACY.md'),
      'utf8',
    )

    // The table, by the name it has on disk, in the retention section.
    expect(doc).toContain('offer_tally')
    // And the sentence it falsified, struck in place rather than deleted — the
    // house practice, and the only way a reader can see what was promised
    // before they judge what replaced it.
    expect(doc).toContain('~~**In memory only.** It never reaches the database.')
  })
})

describe('the counts survive a round trip through SQLite', () => {
  /**
   * Poll until a fire-and-forget write lands, or give up.
   *
   * `countQuietly` returns `void` on purpose — a caller that could await it
   * would eventually be a caller that does, on the two paths whose whole shape
   * is *do not make the request wait for the database*. The cost is here: a
   * test cannot await the write either, so it waits for the effect.
   */
  const settled = async (read: () => Promise<number>, was: number): Promise<number> => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const value = await read()
      if (value !== was) return value
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return read()
  }

  let dir: string
  /** Kept on the describe rather than inside `beforeAll`, because one test below
   *  needs to point `DATABASE_URL` at this database to prove that `countQuietly`
   *  will NOT open it. */
  let dbUrl: string
  let db: Database
  let repos: Repositories

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'propositum-tally-'))
    dbUrl = `file:${join(dir, 'test.db')}`
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: 'pipe',
    })
    db = await createDatabase({ url: dbUrl })
    repos = createRepositories(db.prisma)
  }, 120_000)

  afterAll(async () => {
    // The app context is a promise hung off `globalThis`, so a test that points
    // it at a throwaway database has to put it back — a later file inheriting a
    // closed handle is a failure with nothing in it that names this test.
    globalThis.__propositum = undefined
    globalThis.__propositumAmbient = undefined
    await db?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('adds to a day rather than replacing it, so two counts do not lose one', async () => {
    await repos.offerTally.add('2026-08-18', { offersShown: 1 })
    await repos.offerTally.add('2026-08-18', { offersShown: 1, offersDeclined: 1 })
    await repos.offerTally.add('2026-08-18', { observedMinutes: 40 })

    const [today] = await repos.offerTally.all()

    expect(today).toMatchObject({
      day: '2026-08-18',
      offersShown: 2,
      offersDeclined: 1,
      observedMinutes: 40,
      strandsSuppressed: 0,
    })
  })

  /**
   * The wiring, end to end, because arithmetic over rows nobody writes is
   * decoration.
   *
   * ── Why this test and not a grep ─────────────────────────────────────
   *
   * Every other assertion about the offer rate is about a pure function, and a
   * pure function that is never called reports 0.00 forever while looking
   * completely healthy. That is the exact failure `tests/reachability.test.ts`
   * exists for and the exact failure `scrollFraction` had for a whole build —
   * a field the app accepted, the schema declared, and no browser ever filled.
   *
   * So this posts a real ambient batch at the real route and reads the row back
   * out of SQLite. The app context is a promise on `globalThis`, which is how
   * `src/server/db.ts` holds it, so pointing it at this test's database is the
   * whole of the setup.
   */
  it('counts a minute of observed browsing when the extension actually posts one', async () => {
    globalThis.__propositum = Promise.resolve({
      db,
      repos,
      ledger: createLedgerWriter(db.prisma),
    })
    globalThis.__propositumAmbient = undefined

    const at = Date.UTC(2026, 7, 20, 9, 30, 0)
    const post = () =>
      ambientRoute(
        new Request('http://127.0.0.1:3000/api/capture/ambient', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [CUSTOM_HEADER]: '1',
            'sec-fetch-site': 'none',
          },
          body: JSON.stringify({
            observations: [
              { at, url: 'https://a.example/1', title: 'Kalman filters', kind: 'navigation' },
            ],
          }),
        }),
      )

    // A delta rather than an absolute, because "today" is a real date and the
    // fixtures above may have written to it. What is being proved is that the
    // post added a minute, not what the row started at.
    const today = dayBucket(Date.now())
    const minutes = async () => {
      const rows = await repos.offerTally.all()
      return rows.find((row) => row.day === today)?.observedMinutes ?? 0
    }
    const before = await minutes()

    expect((await post()).status).toBe(200)
    const counted = await settled(minutes, before)

    expect(counted).toBe(before + 1)

    // The extension flushes every thirty seconds. A second batch inside the same
    // minute must not add a second minute of "observed browsing" — a doubled
    // denominator halves the reported offer rate, which is the one direction
    // this measurement may not round in.
    expect((await post()).status).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await minutes()).toBe(before + 1)
  })

  /**
   * A batch that observed nothing is not a minute of observed browsing.
   *
   * The guard used to be `observations.length > 0` — what the extension SENT —
   * and every row here falls out of the route's loop on `continue` because
   * neither URL parses. The buffer keeps nothing, which the response says in
   * `held: 0`, and a full minute of watching was counted anyway.
   *
   * It matters because of which way it is wrong. Minutes are the DENOMINATOR:
   * a minute that was not watched lowers the reported offers-per-hour, quieting
   * the alarm the measurement exists to raise. `newlyObservedMinute` already
   * refuses a double-count for that reason; this is the same error coming in
   * the other door.
   */
  it('does not count a minute for a batch where nothing could be recorded', async () => {
    globalThis.__propositum = Promise.resolve({
      db,
      repos,
      ledger: createLedgerWriter(db.prisma),
    })
    globalThis.__propositumAmbient = undefined

    const today = dayBucket(Date.now())
    const minutes = async () => {
      const rows = await repos.offerTally.all()
      return rows.find((row) => row.day === today)?.observedMinutes ?? 0
    }
    // Read BEFORE the post. `countQuietly` is fire-and-forget, so a baseline
    // taken afterwards could already contain the write this test says must not
    // happen — which would make it pass whatever the route did.
    const before = await minutes()

    const at = Date.UTC(2026, 7, 20, 9, 31, 0)
    const response = await ambientRoute(
      new Request('http://127.0.0.1:3000/api/capture/ambient', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [CUSTOM_HEADER]: '1',
          'sec-fetch-site': 'none',
        },
        body: JSON.stringify({
          observations: [
            { at, url: 'not-a-url', title: 'nothing', kind: 'navigation' },
            { at, url: 'also nonsense', title: 'nothing', kind: 'navigation' },
          ],
        }),
      }),
    )

    expect(response.status).toBe(200)
    // The route's own report that the buffer kept none of it.
    expect(await response.json()).toEqual({ ok: true, held: 0 })

    // `countQuietly` is fire-and-forget, so proving a write did NOT happen means
    // giving it long enough to have happened. 100ms against a local SQLite file
    // is generous; the write it is waiting on above settles in one tick.
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(await minutes()).toBe(before)
  })

  /**
   * The second guard, which is a line in a config file and therefore easy to
   * delete without noticing.
   *
   * `tests/support/no-real-database.ts` points `DATABASE_URL` at a temp path
   * that does not exist, so a module reaching for a process-global three
   * imports down lands somewhere harmless instead of in the developer's
   * `propositum.db`. It has no observable effect when everything is working,
   * which is exactly the kind of guard that gets removed in a tidy-up.
   */
  it('is backed by a setup file that no test can reach the real database past', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..')

    expect(readFileSync(join(root, 'vitest.config.ts'), 'utf8')).toContain(
      "setupFiles: ['tests/support/no-real-database.ts']",
    )
    expect(readFileSync(join(root, 'tests/support/no-real-database.ts'), 'utf8')).toContain(
      "process.env['DATABASE_URL'] =",
    )
  })

  /**
   * A counter may write to a database somebody else opened, and may never open
   * one.
   *
   * ── The defect this pins, because it corrupted the metric itself ─────
   *
   * `countQuietly` called `appContext()`, which BUILDS a handle when none
   * exists, from `DATABASE_URL` — the developer's real `propositum.db` in any
   * `vitest` worker. Running `tests/multiple-threads.test.ts`, a file that has
   * never heard of a counter, wrote `offersShown: 3, offersDeclined: 2` into it
   * and doubled that on a second run. `npm run eval -- --report` then printed a
   * 67% decline rate manufactured entirely by the test suite, in place of the
   * *"nothing counted yet"* that `src/eval/offer-rate.ts` is careful to keep
   * distinct from a real zero.
   *
   * ── Why this proves it rather than grepping for the import ──────────
   *
   * `DATABASE_URL` is pointed at a database that DOES exist and DOES have the
   * table, so the old code would have found it, built a context and written a
   * row — there is nothing here for it to fail on. With no context on
   * `globalThis`, the count must simply not happen.
   */
  it('does not open a database of its own when nothing has built a context', async () => {
    globalThis.__propositum = undefined

    const previous = process.env['DATABASE_URL']
    process.env['DATABASE_URL'] = dbUrl
    try {
      const day = dayBucket(Date.now())
      const shown = async () => {
        const rows = await repos.offerTally.all()
        return rows.find((row) => row.day === day)?.offersShown ?? 0
      }
      const before = await shown()

      countQuietly({ offersShown: 1 }, Date.now())

      // Long enough for the old code's build-connect-upsert to have landed;
      // the same wait in the tests above sees a write settle in one tick.
      await new Promise((resolve) => setTimeout(resolve, 250))

      expect(await shown()).toBe(before)
      // And it did not quietly create the context either, which is the half
      // that would have leaked into every later file in this worker.
      expect(globalThis.__propositum).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previous
    }
  })

  /**
   * ── Why this does not assert the whole table ────────────────────────────
   *
   * The tests above post to the real route, and `countQuietly` stamps
   * `dayBucket(Date.now())` — the REAL today, by design (see its docblock; the
   * bucket is local precisely so an evening is not filed under tomorrow). So the
   * table holds a row nobody here wrote, on a day nobody here can name.
   *
   * Asserting the complete list of days therefore passed only while the machine's
   * local date was one of the three seeded below, which is not a property of
   * anything under test. It went red within a day of being written: green in an
   * afternoon at UTC-7, red an hour later on a runner where it was already
   * tomorrow — and it would have gone red here too, on the next morning.
   * `TZ=UTC npm test` reproduces it from this machine.
   *
   * What the name claims is checked in full: the days did not merge, they come
   * back oldest first, and the sum crosses rows. Today's row is simply not
   * something this test gets to have an opinion about.
   */
  it('keeps days apart and returns them oldest first', async () => {
    await repos.offerTally.add('2026-08-19', { strandsSuppressed: 1 })
    await repos.offerTally.add('2026-08-17', { offersShown: 9 })

    const seeded = ['2026-08-17', '2026-08-18', '2026-08-19']
    const all = await repos.offerTally.all()
    const days = all.map((d) => d.day)

    // Kept apart, and not duplicated: one row per day, however many `add`s.
    expect(days).toEqual([...new Set(days)])
    expect(days.filter((day) => seeded.includes(day))).toEqual(seeded)
    // Oldest first, across every row the table holds — today's included.
    expect([...days].sort()).toEqual(days)
    // And the whole point of the round trip: what `--report` prints is computed
    // from rows a running app wrote, not from a fixture.
    expect(reportOfferRate(all.filter((d) => seeded.includes(d.day))).offersShown).toBe(11)
  })
})

/**
 * The counters have callers, because a metric nothing calls reports 0.00 forever.
 *
 * ── Why a grep, when the minute already has a real end-to-end test ───────
 *
 * The denominator is proved by posting to the real route. The other three
 * cannot be reached that cheaply — one needs a rendered server component, one
 * needs the poll's model boundaries, and one is a server action — and the
 * failure they share is not a wrong number but an ABSENT one: delete the call
 * and every arithmetic test above still passes, `--report` still prints, and the
 * number it prints is zero forever while looking healthy. That is the shape
 * `tests/reachability.test.ts` exists for, and `scrollFraction` spent a whole
 * build in it.
 *
 * A grep is a weak guard and is named as one. It survives a call whose result is
 * discarded — but `countQuietly` returns `void`, so there is no result to
 * discard, which is one of the few places that weakness does not bite.
 */
describe('something actually counts, on every path that can speak', () => {
  const source = (path: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', path), 'utf8')

  it('counts an offer where the extension is told about one', () => {
    // The notification channel. PRODUCT_PRINCIPLES §13 names it as the place
    // this erodes first, so a count blind to it would miss what it is for.
    expect(source('src/app/api/session/current/route.ts')).toMatch(
      /newlyShown\([\s\S]{0,80}countQuietly\(\{ offersShown: 1 \}/,
    )
  })

  it('counts an offer, and a cut strand, where the front door renders them', () => {
    const home = source('src/app/page.tsx')

    expect(home).toMatch(/newlyShown\(strand\.signature\)\) countQuietly\(\{ offersShown: 1 \}/)
    expect(home).toMatch(
      /newlySuppressed\(strand\.signature\)\) countQuietly\(\{ strandsSuppressed: 1 \}/,
    )
  })

  it('counts a decline on BOTH paths, because one of them is the extension’s', () => {
    // The front door snoozes a thread; the extension's endpoint snoozes an
    // origin. Two acts, two call sites, and counting only the first would make
    // the decline rate a fraction of the wrong thing.
    expect(source('src/server/actions.ts')).toMatch(/countQuietly\(\{ offersDeclined: 1 \}/)
    expect(source('src/app/api/capture/ambient/decline/route.ts')).toMatch(
      /countQuietly\(\{ offersDeclined: 1 \}/,
    )
  })

  it('passes no subject to any of them, on any path', () => {
    /**
     * The privacy claim, held against the call sites rather than only against
     * the schema. The table has no column for a subject; this is the other end
     * — nothing is even offered one.
     *
     * Every `countQuietly` call in the source must take an object literal of
     * integer counts. A signature, an origin or a title appearing in one would
     * be the profile ADR-0008 refuses arriving through the argument list rather
     * than through a migration.
     */
    const calls = [
      'src/app/api/session/current/route.ts',
      'src/app/page.tsx',
      'src/server/actions.ts',
      'src/app/api/capture/ambient/decline/route.ts',
      'src/app/api/capture/ambient/route.ts',
    ].flatMap((path) =>
      [...source(path).matchAll(/countQuietly\((\{[^}]*\})/g)].map(([, arg]) => arg),
    )

    expect(calls.length).toBeGreaterThanOrEqual(5)
    for (const argument of calls) {
      expect(argument).toMatch(
        /^\{ (observedMinutes|offersShown|offersDeclined|strandsSuppressed): 1 \}$/,
      )
    }
  })
})

/** The day bucket is the writer's, and it is local rather than UTC — the
 *  question is about a person's day of browsing, and a UTC bucket cuts an
 *  evening in half for everybody west of Greenwich. */
describe('the day a count lands in', () => {
  it('is the local calendar day, zero-padded so the series sorts', () => {
    const january = new Date(2026, 0, 5, 23, 30).getTime()

    expect(dayBucket(january)).toBe('2026-01-05')
  })

  it('does not roll over at UTC midnight for anybody who is not on UTC', () => {
    // Late evening, local. `toISOString().slice(0, 10)` — the obvious wrong
    // implementation — files this under tomorrow for every negative offset.
    const evening = new Date(2026, 7, 18, 23, 59).getTime()

    expect(dayBucket(evening)).toBe('2026-08-18')
  })
})

/**
 * The flag guard on the one script that spends money.
 *
 * ── Why this is spawned rather than imported ─────────────────────────────
 *
 * `scripts/eval.ts` is a CLI: it runs its work at the top level, so importing
 * it to test it would BE the run. The behaviour under test is what the process
 * does with an argument, and the only honest way to observe that is to give it
 * one.
 *
 * ── Why the key is cleared, and why exit code alone proves nothing ───────
 *
 * If the guard were removed, an unrecognised flag would fall through to the
 * live path — four scenarios against the real API. A test that could do that on
 * a developer's machine or in CI is a worse bug than the one it guards, so the
 * child is spawned with `ANTHROPIC_API_KEY` cleared and the corpus is
 * unreachable either way.
 *
 * That mitigation is exactly why these assert on the MESSAGE. Without a key the
 * script already exits non-zero with *"No ANTHROPIC_API_KEY"*, so an exit-code
 * assertion would stay green with the guard deleted — passing for the reason
 * the guard exists to prevent. `Unrecognised` is the word only the guard says.
 */
describe('an unrecognised eval flag is refused before anything is spent', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')

  /** Returns what the process said and how it exited, never throwing. */
  function evalWith(args: readonly string[]): { code: number; output: string } {
    const result = spawnSync('npx', ['tsx', 'scripts/eval.ts', ...args], {
      cwd: root,
      encoding: 'utf8',
      // Cleared, not merely absent: an inherited key would put the paid corpus
      // one deleted branch away from this test.
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    })

    return { code: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
  }

  it('names the flag it did not know, and exits non-zero', () => {
    // The four near-misses from the issue. `--` in `npm run eval -- --flag`
    // invites a mistake about where the flag boundary is, which is what makes
    // this likely rather than exotic.
    for (const typo of ['--dry-run', '--dryrun', '-d', '--reprot']) {
      const { code, output } = evalWith([typo])

      expect(code, `${typo} should refuse`).not.toBe(0)
      expect(output, `${typo} should be named back`).toContain('Unrecognised')
      expect(output).toContain(typo)
    }
  }, 60_000)

  it('prints the usage block rather than a sentence about credentials', () => {
    // `--help` used to reach the key check and answer a question nobody asked.
    const { code, output } = evalWith(['--help'])

    expect(code).toBe(0)
    expect(output).toContain('--dry')
    expect(output).toContain('--report')
    expect(output).not.toContain('ANTHROPIC_API_KEY')
  }, 30_000)

  it('lets a known flag past the guard', () => {
    /**
     * Non-vacuous in the other direction: a guard that refused everything
     * would satisfy both tests above. `--check` verifies seals, runs nothing
     * and needs no key, so it is the one flag that can be exercised end to end
     * here for free.
     */
    const { output } = evalWith(['--check'])

    expect(output).not.toContain('Unrecognised')
  }, 60_000)
})
