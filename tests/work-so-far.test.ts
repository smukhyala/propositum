/**
 * `WorkSoFar` — the fold, and the sentences it produces.
 *
 * ── What is actually being defended here ─────────────────────────────────
 *
 * Not "the function returns an object". Three things, and each of them is a
 * property [ADR-0017](../docs/adr/0017-continuing-an-intention.md) rests its
 * whole argument on:
 *
 * 1. **It says rather than counts.** The gap ADR-0017 opens by naming is that
 *    `carryOnCandidate` already carries a project forward and shows four
 *    numbers for it — *"a person who spent three evenings on a trip is not
 *    helped by being told there were three evenings"*. So the assertions below
 *    are on the SENTENCES, not on the members behind them. A fold that computed
 *    every number correctly and rendered nothing would satisfy a shape test and
 *    close none of the gap.
 * 2. **It is total and it claims least when it knows least.** Every unknown
 *    value — a verdict nobody wrote code for, a stop reason from a later
 *    version — has to land somewhere that asserts nothing.
 * 3. **`document-changes` is not counted twice.** That outcome kind is settled
 *    one `ProposedChange` at a time and never receives an `OutcomeVerdict`; the
 *    repository's `UNSETTLED` predicate has already been wrong in exactly that
 *    direction once, and a fold that counted the outcome AND its changes would
 *    tell a person there is one more thing waiting than there is.
 *
 * What is NOT tested here is the query. `tests/intention-facts.test.ts` is the
 * file for facts assembled from real rows; this one hands the fold facts written
 * by hand, which is the same division `tests/intention.test.ts` and
 * `tests/front-door.test.ts` already keep.
 */

import { describe, it, expect } from 'vitest'

import { WHERE_YOU_LEFT_OFF, workSoFar } from '../src/domain/intention/work-so-far'
import type { WorkSoFarFacts } from '../src/domain/intention/work-so-far'

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0)
const DAY = 24 * 60 * 60 * 1000

/** An Intention nothing has happened under. Every case below is this plus one
 *  difference, so the difference is what the case is about. */
function nothing(over: Partial<WorkSoFarFacts> = {}): WorkSoFarFacts {
  return {
    sittingsEndedAtEpochMs: [],
    approvedSources: 0,
    documents: 0,
    produced: [],
    changeVerdicts: [],
    openQuestions: 0,
    lastStop: null,
    ...over,
  }
}

const fold = (over: Partial<WorkSoFarFacts> = {}) => workSoFar(nothing(over), NOW)

/** Every sentence, joined, so a case can ask what the person reads. */
const said = (over: Partial<WorkSoFarFacts> = {}) => fold(over).lines.join(' ')

describe('an Intention with nothing under it says nothing', () => {
  it('has no sentences at all, rather than a sentence saying there are none', () => {
    const view = fold()

    expect(view.anythingToSay).toBe(false)
    expect(view.lines).toEqual([])
  })

  it('still names itself in the words CONTEXT.md fixes', () => {
    // The heading is the consumer wording and lives with the fold so the two
    // screens that render it cannot each invent their own.
    expect(WHERE_YOU_LEFT_OFF).toBe('Where you left off')
  })
})

describe('sittings, and when the last one ended', () => {
  it('counts them and says how long ago the last one ended', () => {
    expect(
      said({ sittingsEndedAtEpochMs: [NOW - 9 * DAY, NOW - 3 * DAY, NOW - 12 * DAY] }),
    ).toContain('3 sittings so far. The last one ended 3 days ago.')
  })

  it('says a day rather than 1 days', () => {
    expect(said({ sittingsEndedAtEpochMs: [NOW - DAY] })).toContain('ended a day ago')
  })

  it('says less than a day rather than 0 days', () => {
    expect(said({ sittingsEndedAtEpochMs: [NOW - 60 * 1000] })).toContain(
      'ended less than a day ago',
    )
  })

  it('says a sitting is still open rather than inventing an end for it', () => {
    // `endedAt` is null until a human act. Rounding that to "ended today" would
    // be the screen claiming a person did something they have not done.
    expect(said({ sittingsEndedAtEpochMs: [NOW - 4 * DAY, null] })).toContain(
      '2 sittings so far, and the latest is still open.',
    )
    expect(said({ sittingsEndedAtEpochMs: [null] })).toContain(
      'One sitting so far, and it is still open.',
    )
  })

  it('reads the newest end, not the first one it was handed', () => {
    expect(
      fold({ sittingsEndedAtEpochMs: [NOW - 40 * DAY, NOW - 2 * DAY] }).daysSinceLastSitting,
    ).toBe(2)
  })

  it('never reports a negative age, however the clocks disagree', () => {
    expect(fold({ sittingsEndedAtEpochMs: [NOW + 5 * DAY] }).daysSinceLastSitting).toBe(0)
  })
})

describe('what is already approved, and what is being written', () => {
  it('says both in one sentence', () => {
    expect(said({ approvedSources: 5, documents: 1 })).toContain(
      '5 sites are already approved here, and there is a document to work in.',
    )
  })

  it('says there is no document rather than going quiet about it', () => {
    expect(said({ approvedSources: 1 })).toContain(
      'One site is already approved here, and there is no document yet.',
    )
  })

  it('does not raise the subject at all when there is nothing on either side', () => {
    expect(said({ openQuestions: 1 })).not.toContain('approved here')
  })
})

describe('what previous Shifts produced', () => {
  it('names the kinds in the words CONTEXT.md fixes, never the enum member', () => {
    const sentence = said({
      produced: [
        { kind: 'document-changes', reversibility: 'held', verdict: null },
        { kind: 'answer', reversibility: 'held', verdict: 'accept' },
      ],
    })

    expect(sentence).toContain('changes to your document')
    expect(sentence).toContain('an answer')
    expect(sentence).not.toContain('document-changes')
  })

  it('counts repeats without making the noun ungrammatical', () => {
    expect(
      said({
        produced: [
          { kind: 'answer', reversibility: 'held', verdict: null },
          { kind: 'answer', reversibility: 'held', verdict: null },
          { kind: 'message-draft', reversibility: 'held', verdict: null },
        ],
      }),
    ).toContain('2 answers and a message, unsent')
  })

  it('reports a kind it does not recognise rather than dropping it', () => {
    // A sixth kind is a schema change, so a row holding one came from a later
    // version of this product. Silently omitting it would make the sentence
    // false in the direction that under-reports what Propositum has done.
    const view = fold({ produced: [{ kind: 'telepathy', reversibility: 'held', verdict: null }] })

    expect(view.unrecognisedKinds).toBe(1)
    expect(view.lines.join(' ')).toContain('one thing this version does not have a word for')
  })
})

describe('how each decidable unit was decided', () => {
  it('reads a ChangeVerdict per change and says what the person did', () => {
    expect(
      said({
        changeVerdicts: ['accept', 'accept', 'reject', 'edit', null, null],
      }),
    ).toContain('you accepted 2, rejected 1 and reworded 1')
  })

  it('says what is still waiting', () => {
    expect(said({ changeVerdicts: ['accept', null, null] })).toContain('2 are still undecided')
  })

  it('counts a held outcome that is not document-changes as its own unit', () => {
    const view = fold({
      produced: [
        { kind: 'answer', reversibility: 'held', verdict: 'accept' },
        { kind: 'collection', reversibility: 'held', verdict: null },
      ],
    })

    expect(view.decided).toEqual({ accepted: 1, rejected: 0, edited: 0, undecided: 1 })
  })

  it('does not count a document-changes outcome as a unit of its own', () => {
    /**
     * The expensive direction, and the one the repository's `UNSETTLED`
     * predicate has already been wrong about once. A `document-changes` outcome
     * never receives an `OutcomeVerdict` — its changes carry the verdicts — so
     * counting the outcome as well would report one more thing waiting than
     * exists, forever, on every project that has ever had a drafting shift.
     */
    const view = fold({
      produced: [{ kind: 'document-changes', reversibility: 'held', verdict: null }],
      changeVerdicts: ['accept', 'reject'],
    })

    // Two changes, two verdicts, and nothing undecided — the outcome above them
    // contributes no fourth unit waiting on anybody.
    expect(view.decided).toEqual({ accepted: 1, rejected: 1, edited: 0, undecided: 0 })
  })

  it('offers no verdict count for a landed outcome, because there was never one to give', () => {
    const view = fold({
      produced: [{ kind: 'external-effect', reversibility: 'landed', verdict: null }],
    })

    expect(view.decided).toEqual({ accepted: 0, rejected: 0, edited: 0, undecided: 0 })
    expect(view.lines.join(' ')).not.toContain('undecided')
  })

  it('treats a reversibility it does not recognise as landed, exactly as the rest of the code does', () => {
    // `isDecidable` is `=== 'held'` deny-by-default, and this fold asks that one
    // question rather than inventing a second answer to it.
    const view = fold({
      produced: [{ kind: 'answer', reversibility: 'quantum', verdict: null }],
    })

    expect(view.decided.undecided).toBe(0)
  })

  it('puts a verdict value it does not recognise in no bucket at all', () => {
    // A row exists, so it is not undecided; the word is not one this version
    // wrote, so it is not evidence of accepting, rejecting or rewording either.
    const view = fold({ changeVerdicts: ['deferred'] })

    expect(view.decided).toEqual({ accepted: 0, rejected: 0, edited: 0, undecided: 0 })
  })
})

describe('questions still waiting on the person', () => {
  it('says one, singular', () => {
    expect(said({ openQuestions: 1 })).toContain('One question is still waiting on you.')
  })

  it('says several, plural', () => {
    expect(said({ openQuestions: 3 })).toContain('3 questions are still waiting on you.')
  })
})

describe('where the last one stopped', () => {
  it('names the reason in the person’s words, not the stored value', () => {
    const sentence = said({ lastStop: { status: 'failed', terminalReason: 'budget-exhausted' } })

    expect(sentence).toContain('ran out of the time you gave it')
    expect(sentence).not.toContain('budget-exhausted')
  })

  it('says a run that finished finished', () => {
    expect(said({ lastStop: { status: 'succeeded', terminalReason: null } })).toContain(
      'worked through the plan and stopped there',
    )
  })

  it('claims nothing about a reason it does not recognise', () => {
    const sentence = said({ lastStop: { status: 'failed', terminalReason: 'sunspots' } })

    expect(sentence).toContain('stopped before finishing')
    expect(sentence).not.toContain('sunspots')
  })

  it('says nothing at all when Propositum has never held this work', () => {
    expect(said({ sittingsEndedAtEpochMs: [null] })).not.toContain('Last time')
  })
})

describe('the whole thing, on an Intention with a season of work under it', () => {
  it('reads as sentences a person can check, in a fixed order', () => {
    const view = workSoFar(
      {
        sittingsEndedAtEpochMs: [NOW - 11 * DAY, NOW - 4 * DAY, NOW - 2 * DAY],
        approvedSources: 4,
        documents: 1,
        produced: [
          { kind: 'document-changes', reversibility: 'held', verdict: null },
          { kind: 'answer', reversibility: 'held', verdict: 'accept' },
        ],
        changeVerdicts: ['accept', 'accept', 'reject', null],
        openQuestions: 1,
        lastStop: { status: 'succeeded', terminalReason: null },
      },
      NOW,
    )

    expect(view.anythingToSay).toBe(true)
    expect(view.lines).toEqual([
      '3 sittings so far. The last one ended 2 days ago.',
      '4 sites are already approved here, and there is a document to work in.',
      'Propositum has produced changes to your document and an answer.',
      'Of those, you accepted 3, rejected 1 and reworded none — 1 is still undecided.',
      'One question is still waiting on you.',
      'Last time, Propositum worked through the plan and stopped there.',
    ])
  })

  it('never uses a word the interface has banned', () => {
    const sentence = said({
      sittingsEndedAtEpochMs: [NOW - DAY],
      approvedSources: 2,
      documents: 1,
      produced: [
        { kind: 'document-changes', reversibility: 'held', verdict: null },
        { kind: 'external-effect', reversibility: 'landed', verdict: null },
      ],
      changeVerdicts: ['accept', null],
      openQuestions: 2,
      lastStop: { status: 'failed', terminalReason: 'error' },
    })

    // CONTEXT.md's banned table, the rows that could plausibly appear in a
    // sentence about work already done. `progress` is here for Principle 1 —
    // activity is not progress, and a fold over activity must not borrow the
    // word.
    for (const banned of [
      'Task',
      'task',
      'progress',
      'changeset',
      'diff',
      'patch',
      'copy',
      'commit',
      'merge',
      'agent run',
      'ledger',
      'session state',
      'memory',
      'summary',
      'history',
    ]) {
      expect(sentence.toLowerCase()).not.toContain(banned.toLowerCase())
    }
  })
})
