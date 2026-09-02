/**
 * The sentence a person reads first when they come back to a finished shift.
 *
 * ── Why this file did not exist until 2026-09-02 ─────────────────────────
 *
 * `whereItStopped` was module-private in `src/app/shifts/[contractId]/page.tsx`,
 * and a `.tsx` server component is — `tests/confirmation-pause.test.ts`'s own
 * words — *"the one thing in this repository nothing can assert against"*. So
 * the heading sentence for every ending of every shift was unpinned, and
 * [#145](https://github.com/smukhyala/propositum/issues/145) is a defect in
 * exactly those sentences that had to be found by reading rather than by a red
 * test. Moving the function to `src/domain/intention/` is what made this file
 * possible; the arms it gained are what it is for.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * The page. Nothing here proves `page.tsx` still calls this, still passes the
 * right `reached`/`planned`, or renders what comes back — `tests/route-boundaries.test.ts`
 * checks route shape and no test renders that component. What is pinned is the
 * derivation, which is the half that was carrying the bug.
 */

import { describe, it, expect } from 'vitest'
import { whereItStopped } from '../src/domain/intention/where-it-stopped'
import type { StoppedWhere } from '../src/domain/intention/where-it-stopped'

const ENDED: StoppedWhere = {
  live: false,
  status: 'succeeded',
  terminalReason: null,
  reached: 2,
  planned: 4,
  hasDecision: false,
}

const said = (over: Partial<StoppedWhere> = {}) => whereItStopped({ ...ENDED, ...over })

/**
 * Every reason a writer in this repository puts in the column, off CONTEXT.md's
 * `AgentRun` entry — which tabulates them one by one and is the closed set these
 * sentences read.
 */
const WRITTEN_REASONS = [
  'budget-exhausted',
  'stop-condition',
  'boundary-failure',
  'error',
  'lease-expired',
  'cancelled',
  'answered-too-late',
  'confirmation-expired',
] as const

describe('a stored reason gets a sentence of its own, or the default is lying', () => {
  /**
   * The failure this file was written for.
   *
   * The default branch is kept for *"a reason written by a version this one has
   * never met"*. Three reasons this version writes itself were reaching it —
   * `boundary-failure`, `answered-too-late` and `confirmation-expired` — so the
   * report could not distinguish **we know what happened** from **we have never
   * heard of this**, and reserved the more specific sentence for the internal
   * case a person can do nothing about.
   */
  it('never answers for a written reason with the sentence kept for unknown ones', () => {
    const unknown = said({ status: 'failed', terminalReason: 'sunspots' })
    expect(unknown.sentence).toBe("I couldn't finish, and stopped.")

    for (const reason of WRITTEN_REASONS) {
      const { sentence } = said({ status: 'failed', terminalReason: reason })
      expect(sentence, `${reason} falls to the default branch`).not.toBe(unknown.sentence)
      expect(sentence, `${reason} reached a screen as a machine word`).not.toContain(reason)
    }
  })

  it('gives every written reason a distinct sentence', () => {
    const sentences = WRITTEN_REASONS.map(
      (reason) => said({ status: 'failed', terminalReason: reason }).sentence,
    )
    // `stop-condition` is the one reason whose sentence depends on a second
    // field, and this drives it with `hasDecision: false`. Both of its arms are
    // covered below.
    expect(new Set(sentences).size).toBe(WRITTEN_REASONS.length)
  })
})

describe('a boundary failure says what it can and no more', () => {
  it('names the class of failure', () => {
    const { sentence } = said({ status: 'failed', terminalReason: 'boundary-failure' })
    expect(sentence).toContain("couldn't reach something I needed")
  })

  it('does not pretend to know which boundary, because the row does not carry it', () => {
    const { sentence, detail } = said({ status: 'failed', terminalReason: 'boundary-failure' })
    const both = `${sentence} ${detail ?? ''}`

    // `WorkerResult.boundaryFailure` holds which boundary and what it said. It
    // is in-memory only and never reaches this column, so a sentence naming one
    // would be inventing a detail the report cannot support.
    expect(both).not.toMatch(/model|browser|Chrome|Anthropic|API/i)
  })

  /**
   * It may not say what was already done, and this is the case that nearly
   * shipped saying it.
   *
   * The detail read *"Nothing was left half-done. Handing the work over again
   * is safe."* Both halves are outside what one status and one reason can
   * support: `failedAt` fires from inside the turn loop as well as before it,
   * and the turns already taken can include `complete-purchase`, which is
   * authorised inline with no pause. So the sentence recommended the one act
   * that spends a ratified purchase count twice — `chargesSpent` is per
   * contract, and handing over again ratifies a fresh authorisation.
   */
  it('claims nothing about what the run had already done', () => {
    const { sentence, detail } = said({ status: 'failed', terminalReason: 'boundary-failure' })
    const both = `${sentence} ${detail ?? ''}`

    expect(both).not.toMatch(/nothing was left|half-done|is safe|safe to/i)
    // The step count is what it may say, because the row does carry it.
    expect(detail).toBe('I got through 2 of 4 steps.')
  })
})

describe('the two confirmation endings are told apart', () => {
  /**
   * "Nothing" needs its antecedent, or it becomes a claim about the shift.
   *
   * Both arms nearly shipped with a bare *"Nothing was done."* in the detail,
   * rendered directly under *"I got through 3 of 5 steps."* — which is the
   * default combination here, not an edge, because the page reads the reason
   * off the last run and the plan off the first.
   */
  it('scopes what was not done to the thing it asked about', () => {
    for (const reason of ['answered-too-late', 'confirmation-expired']) {
      const { detail } = said({ status: 'interrupted', terminalReason: reason, reached: 3, planned: 5 })
      expect(detail, reason).toContain('I got through 3 of 5 steps.')
      // Scoped — never a bare claim that the whole shift did nothing, on top of
      // a sentence saying how much of it happened.
      expect(detail, reason).toMatch(/thing I asked about|That one thing/)
      expect(detail, reason).not.toMatch(/(^|\s)Nothing was done\./)
    }
  })

  it('does not tell somebody who answered late that nobody answered', () => {
    const late = said({ status: 'interrupted', terminalReason: 'answered-too-late' })
    const never = said({ status: 'interrupted', terminalReason: 'confirmation-expired' })

    expect(late.sentence).toContain('after the time limit')
    expect(never.sentence).toContain('waiting a day')
    expect(late.sentence).not.toBe(never.sentence)
  })

  it('blames neither of them on the person', () => {
    for (const reason of ['answered-too-late', 'confirmation-expired']) {
      const { sentence } = said({ status: 'interrupted', terminalReason: reason })
      expect(sentence).not.toMatch(/too slow|you forgot|you failed/i)
    }
  })
})

describe('the endings that already worked still work', () => {
  it('is still live before it stops', () => {
    const { sentence } = said({ live: true })
    expect(sentence).toContain('still working')
  })

  it('says the plan ran out when it did', () => {
    expect(said().sentence).toBe('I worked through the plan and stopped there.')
  })

  it('separates a stop rule from a decision only the person can make', () => {
    const rule = said({ terminalReason: 'stop-condition', hasDecision: false })
    const decision = said({ terminalReason: 'stop-condition', hasDecision: true })

    expect(rule.sentence).toContain('stopped myself')
    expect(decision.sentence).toContain('a decision only you can make')
  })

  it('counts through the plan, and never past it', () => {
    // `reached` can exceed `planned` on an off-plan run, and "3 of 2 steps"
    // reads as a bug in the counter rather than as a run that went further.
    expect(said({ reached: 9, planned: 2 }).detail).toContain('2 of 2 steps')
    expect(said({ planned: 0 }).detail).toBeNull()
  })
})
