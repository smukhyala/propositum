/**
 * Which stated steps came to something.
 *
 * This is the arithmetic under boundary 6's `completed` and `notDone` lists.
 * It is pure and it is here rather than folded into the narrator's tests
 * because the one case that matters — an authorised intent with NO outcome —
 * is invisible from the outside: it reads as a step that happened, right up
 * until the report says a run did something the ledger cannot show.
 */

import { describe, it, expect } from 'vitest'
import { splitSteps } from '../src/domain/outcome/plan-progress'

const step = (
  ordinal: number,
  intent: string,
  intents: Array<{ authorized: boolean; result: string | null }>,
) => ({ ordinal, intent, intents })

describe('a step is done when one of its actions was authorised and succeeded', () => {
  it('splits on that rule and keeps the step words', () => {
    const { completed, notDone } = splitSteps([
      step(0, 'Draft Commercials.', [{ authorized: true, result: 'succeeded' }]),
      step(1, 'Check the tier.', [{ authorized: true, result: 'failed' }]),
    ])

    expect(completed).toEqual(['Draft Commercials.'])
    expect(notDone).toEqual(['Check the tier.'])
  })

  it('counts a step done if ANY of its actions succeeded', () => {
    const { completed } = splitSteps([
      step(0, 'Read the partner pages.', [
        { authorized: true, result: 'failed' },
        { authorized: true, result: 'succeeded' },
      ]),
    ])

    expect(completed).toEqual(['Read the partner pages.'])
  })

  it('puts a refused step under not done, however it went afterwards', () => {
    // `authorized: false` is the gate refusing. A refused intent has no outcome
    // to succeed, and a `succeeded` beside a refusal would be a row that cannot
    // exist — asserted so the rule is about BOTH fields rather than the second.
    const { completed, notDone } = splitSteps([
      step(0, 'Open the pricing sheet.', [{ authorized: false, result: 'succeeded' }]),
    ])

    expect(completed).toEqual([])
    expect(notDone).toEqual(['Open the pricing sheet.'])
  })

  it('puts an authorised action with no outcome under NOT done', () => {
    /**
     * The case this file exists for.
     *
     * An intent with no outcome row is `unknown` — the run died between the
     * effect and the record of it. The schema's `observedBy` comment says so in
     * its own voice. Reading that as done would put a claim in the handover
     * note that the ledger underneath it cannot support, which is the one thing
     * the deterministic/model split above boundary 6 exists to prevent.
     */
    const { completed, notDone } = splitSteps([
      step(0, 'Send the summary.', [{ authorized: true, result: null }]),
    ])

    expect(completed).toEqual([])
    expect(notDone).toEqual(['Send the summary.'])
  })

  it('puts a step with no actions at all under not done', () => {
    const { completed, notDone } = splitSteps([step(0, 'Think about it.', [])])

    expect(completed).toEqual([])
    expect(notDone).toEqual(['Think about it.'])
  })

  it('reports plan order however the rows arrive', () => {
    const { completed } = splitSteps([
      step(2, 'Third.', [{ authorized: true, result: 'succeeded' }]),
      step(0, 'First.', [{ authorized: true, result: 'succeeded' }]),
      step(1, 'Second.', [{ authorized: true, result: 'succeeded' }]),
    ])

    expect(completed).toEqual(['First.', 'Second.', 'Third.'])
  })

  it('returns two empty lists for a run that planned nothing', () => {
    expect(splitSteps([])).toEqual({ completed: [], notDone: [] })
  })
})
