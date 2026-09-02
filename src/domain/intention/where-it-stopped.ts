/**
 * How a shift ended, in the first person, for the note the person comes back to.
 *
 * ── Why this is a module and not a function in the page ──────────────────
 *
 * It was module-private in `src/app/shifts/[contractId]/page.tsx` until
 * 2026-09-02, and `tests/confirmation-pause.test.ts` names why that mattered in
 * its own words: a `.tsx` server component is *"the one thing in this
 * repository nothing can assert against"*. So half of the sentences a person
 * reads about a failed run had no test, and [#145](https://github.com/smukhyala/propositum/issues/145)
 * is a defect in exactly those sentences — found by reading the code, because
 * nothing could have failed.
 *
 * `src/server/welcome.ts` is the precedent and the argument is the same one:
 * the derivation moves somewhere a test can reach it and the component renders
 * what it returns. Nothing about the wording changed in the move; the arms
 * below did, and they are the change.
 *
 * ── Why this is NOT merged with `stoppedLine` ────────────────────────────
 *
 * `work-so-far.ts` argues that at length and the argument stands. That one is
 * third person, about a stretch of work that is over, read BEFORE the next
 * sitting, with no live case and no plan to count through. This one is first
 * person, about the shift on screen, and carries how far the plan got. A shared
 * function would take a voice parameter, a `live` flag and a step count, at
 * which point it is two functions sharing a body.
 *
 * What the two genuinely share is the closed set of stored reasons, and the two
 * of them are now the only readers of that set outside the writers themselves.
 * CONTEXT.md's `AgentRun` entry tabulates every writer; when a row is added
 * there, both of these want an arm.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It does not read the clock, open anything, or know which boundary failed.
 * `WorkerResult.boundaryFailure` carries that and is in-memory only — it never
 * reaches `AgentRun.terminalReason`, so no sentence here may pretend to it.
 *
 * It also does not know **what the run already did**. Every sentence below is
 * derived from one status and one reason, and neither says whether an action
 * completed before the ending. The report's *what I did* list is built from the
 * ledger and does know; a sentence here that made a claim about it — *"nothing
 * was left half-done"*, say — would be this module answering a question it has
 * no field for. One did, on the way to review, and the `boundary-failure` arm
 * carries the argument.
 *
 * ── And the move cost a guard, which is worth stating ────────────────────
 *
 * `tests/consumer-vocabulary.test.ts` walks `src/ui` and `src/app` for `.tsx`
 * files only. These sentences were inside a `.tsx` before 2026-09-02 and are
 * not now, so the banned-word check no longer reads them — eleven that it used
 * to see, plus the five added here. `work-so-far.ts` has always sat outside
 * that walk for the same reason, so this is a widening of an existing hole
 * rather than a new one, and it is a real cost of making the derivation
 * testable. Both were weighed; a guard whose limit is unstated reads as a
 * stronger promise than it is.
 */

/** Local rather than imported: a pluraliser is not worth a dependency from
 *  `src/domain` on anything above it. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

export interface StoppedWhere {
  readonly live: boolean
  readonly status: string
  readonly terminalReason: string | null
  readonly reached: number
  readonly planned: number
  readonly hasDecision: boolean
}

export function whereItStopped(input: StoppedWhere): {
  readonly sentence: string
  readonly detail: string | null
} {
  const through =
    input.planned > 0
      ? `I got through ${Math.min(input.reached, input.planned)} of ${count(input.planned, 'step')}.`
      : null

  if (input.live) {
    return {
      sentence: 'Propositum is still working — this note fills in when it stops.',
      detail: through,
    }
  }

  switch (input.terminalReason) {
    case 'lease-expired':
      return {
        sentence: 'I stopped when your Mac slept.',
        detail: [
          through,
          'I only noticed on wake, so the end time above is when I noticed rather than when I stopped.',
        ]
          .filter(Boolean)
          .join(' '),
      }
    case 'budget-exhausted':
      return { sentence: 'I ran out of the time you gave me.', detail: through }
    case 'cancelled':
      return { sentence: 'You called me back, so I stopped.', detail: through }
    case 'error':
      return {
        sentence: "I hit something I couldn't get past, and stopped rather than carry on.",
        detail: through,
      }
    /**
     * A class of failure, and never the instance — the reason this arm is worth
     * writing rather than leaving to the default below.
     *
     * `finish` in `src/runtime/worker-loop.ts` writes `boundary-failure` for
     * every `failed` worker result, so it is the ONE worker failure this column
     * can name. Until now it fell through to `"I couldn't finish, and stopped."`
     * — the sentence kept for a value we have never heard of — which meant the
     * report could not distinguish knowing what happened from not recognising
     * the row at all.
     *
     * ── The detail claims NOTHING about what was already done ───────────
     *
     * ~~It said *"Nothing was left half-done. Handing the work over again is
     * safe."*~~ **Struck before it shipped, on review.** Both halves were
     * false and the second was dangerous. `failedAt` has two call sites in
     * `src/runtime/worker-loop.ts`: one before the loop, where nothing has
     * happened, and one INSIDE it, where turns 0..N-1 have already run — and
     * those turns include `complete-purchase`, which sits outside
     * `CONFIRMABLE_ACTION_KINDS` and is authorised inline with no pause. This
     * column cannot tell the two call sites apart.
     *
     * So a run can buy something at turn 3 and fail at turn 5, and the struck
     * sentence would have told the person that handing over again was safe —
     * which is the one action that spends the ratified count twice, because
     * `chargesSpent` is counted per contract and a fresh handover ratifies a
     * fresh `PurchaseAuthorization`. A note may not recommend an act it cannot
     * know the cost of.
     *
     * What is left is the step count and the report's own *what I did* list,
     * which is built from the ledger and does know.
     */
    case 'boundary-failure':
      return {
        sentence: "I couldn't reach something I needed, and stopped rather than guess.",
        detail: through,
      }
    /**
     * The two endings that are about the question rather than about the work.
     *
     * Both already have consumer copy in
     * `src/domain/execution/continuation.ts`, which is what the shift report's
     * body says; these are the note's own heading sentence for the same fact,
     * and they stay apart because whose clock ran out is the whole difference.
     * Neither blames the person for being slow — they were reading a question
     * about something irreversible, which is what we asked them to do.
     *
     * ── "Nothing" has to keep its antecedent ─────────────────────────────
     *
     * ~~`detail: [through, 'Nothing was done.']`~~ **Struck before it shipped,
     * on review.** In `CONFIRMATION_EXPIRED_REPORT` that word is anaphoric —
     * it refers back to *"one thing I could not undo"* in the same sentence.
     * Split across `sentence` and `detail` with the step count wedged between,
     * it stops referring to anything and becomes a claim about the whole
     * shift, rendered directly on top of *"I got through 3 of 5 steps."*
     *
     * That combination is the DEFAULT here rather than an edge: the page reads
     * `terminalReason` off the last run and the plan off the first, and a
     * continuation is enqueued as another `worker`, so `through` is non-null
     * by construction on exactly these two endings.
     *
     * The antecedent is restored rather than the clause deleted, because what
     * it says is worth saying: expiry never approves, and a late answer is not
     * converted into a yes, so the ONE thing that was asked about did not
     * happen. That is true, narrow, and the fact the person came for.
     */
    case 'answered-too-late':
      return {
        sentence: 'Your answer arrived after the time limit, so I did not go on.',
        detail: [through, 'The thing I asked about was not done.'].filter(Boolean).join(' '),
      }
    case 'confirmation-expired':
      return {
        sentence: 'I asked you about one thing I could not undo, and stopped after waiting a day.',
        detail: [through, 'That one thing was not done.'].filter(Boolean).join(' '),
      }
    case 'stop-condition':
      return {
        sentence: input.hasDecision
          ? 'I stopped because this needs a decision only you can make.'
          : 'I stopped myself rather than keep going.',
        detail: input.hasDecision
          ? through
          : [
              through,
              "The record doesn't keep which of my stop rules fired — what I didn't do, and why, is above.",
            ]
              .filter(Boolean)
              .join(' '),
      }
    default:
      // A reason written by a version this one has never met. Saying the stored
      // value would put a machine word on a screen and guessing would be worse,
      // so the sentence claims exactly what the row supports. Every reason this
      // version writes has an arm above; that is what makes this branch mean
      // what it says.
      if (input.status === 'failed') {
        return { sentence: "I couldn't finish, and stopped.", detail: through }
      }
      return { sentence: 'I worked through the plan and stopped there.', detail: through }
  }
}
