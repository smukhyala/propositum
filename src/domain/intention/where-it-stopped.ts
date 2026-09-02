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
     * The detail says what a person can DO, because that is the difference
     * between this and `error`: an outside thing was unreachable, and trying
     * again is a reasonable next move. It does not name the model or the
     * browser, because which one is in `WorkerResult.boundaryFailure` and that
     * never reaches this column.
     */
    case 'boundary-failure':
      return {
        sentence: "I couldn't reach something I needed, and stopped rather than guess.",
        detail: [through, 'Nothing was left half-done. Handing the work over again is safe.']
          .filter(Boolean)
          .join(' '),
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
     */
    case 'answered-too-late':
      return {
        sentence: 'Your answer arrived after the time limit, so I did not go on.',
        detail: [through, 'Nothing was done.'].filter(Boolean).join(' '),
      }
    case 'confirmation-expired':
      return {
        sentence: 'I asked you about one thing I could not undo, and stopped after waiting a day.',
        detail: [through, 'Nothing was done.'].filter(Boolean).join(' '),
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
