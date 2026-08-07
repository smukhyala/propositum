import { describe, it, expect } from 'vitest'
import { SCENARIOS } from '../src/eval/index.js'
import { checkSeal, hashReference, readSeals, sealNew } from '../src/eval/seal.js'
import {
  H1_PASS_TOTAL,
  scoreH1,
  scoreH2,
  scoreH3,
  summariseH3,
} from '../src/eval/score.js'
import type { H1Scores } from '../src/eval/score.js'
import { H1_COMPONENTS } from '../src/eval/scenario.js'
import type { Scenario } from '../src/eval/scenario.js'
import { FakeModelClient } from '../src/model/fake.js'
import { runScenario } from '../src/eval/run.js'

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
