# ADR-0030 — A halt closes the question, and the stop finally has both its doors

**Status:** accepted · 2026-09-02
**Amends:** [ADR-0007](0007-stop-conditions.md) — not the stop rules, which are untouched, but the
sentence about where a halt lands. A halt now also ends a run that is *parked* rather than acting,
and that run is at no action boundary at all ·
[`CONTEXT.md`](../../CONTEXT.md) — the `AgentRun` writers table gains a caller for
`interrupted` / `cancelled`
**Depends on:** [ADR-0010](0010-acting-in-the-browser.md) — the three kill switches, and the rule
that a stop must work when nothing else does ·
[ADR-0022](0022-the-fourth-verdict.md) — that a question can be answered at all, which is what makes
this a race rather than a curiosity ·
[ADR-0024](0024-purchases-within-a-ratified-authorisation.md) — the population this matters most for:
a parked question about something irreversible

---

## What this costs

**A person loses the ability to answer a question they may still have wanted to answer.** That is the
whole price and it is not small. Somebody who presses Stop because a run is taking too long, and who
five minutes later reads the question it was parked on and thinks *actually, yes, do that* — has no
way back to it. They must hand the work over again, and the new run will ask again if it still needs
to.

It also spends a distinction the product had for free. Until now *stop* and *answer* were
independent: the yes was recorded whatever else had happened, and a person could always say what they
wanted even about work that was over. After this, a stop forecloses an answer, and the record of what
they would have said is not kept.

Both are accepted for one reason, argued below: the alternative is a stop with an exception nobody is
told about, and the exception is the path that starts a new run driving a browser.

## Context

*"Take back control"* on the shift screen, and `POST /api/act/halt` behind the tab overlay chip and
the side panel Stop, are the product's three ways of stopping a run. On a run parked in
`awaiting-confirmation`, **all three changed nothing.**

`haltRun` does three things and on a parked run each was a no-op. `requestCancel` is scoped to
`pending`, `claimed` and `running`, so a parked run matched none and `stopped` came back false.
`clearControlToken` had nothing to clear — the park revoked the token already, deliberately, in the
same transaction that wrote the status. `settleAbandonedIntents` had nothing to settle, because the
parked run's one unfinished intent is the refused one, which is not authorised and has no outcome.

So the person pressed Stop, was told nothing had happened, and **the question stayed live and
answerable.** Answering yes afterwards still wrote a `ConfirmationVerdict` and still enqueued a
continuation, which claims a run and mints a fresh control token — on a shift the person stopped.

This is not a permission failure and it is important to say why. The yes is real and the person gave
it. What went wrong is that *stop* and *yes* are two decisions by the same person about the same
work, arriving in an order nobody reconciled, and the later one silently won.

**Two things were found next to it and are part of the same repair**, because neither could be left
while deciding what a button does:

- **`takeBackControl` had no caller at all.** `src/server/actions.ts` was the only file in the
  repository naming it. The shift screen rendered no such control, so the first of the three doors
  above did not exist — three docblocks described a button nobody could press.
- **`POST /api/act/halt` never called `haltRun`.** It called `requestCancel` directly and skipped the
  other two steps, so `haltRun`'s own *"ONE implementation, two doors"* was false in both directions:
  the route did less than the docblock (no token revocation, no settlement) and more (it settles the
  browser socket and abandons dispatches, which `haltRun` knows nothing about).

## Decision

**A halt ends a run parked on a question, and the question closes with it.**

1. **`haltRun` gains a fourth step, and it is the first one.** A run in `awaiting-confirmation` is
   written `interrupted` with `terminalReason: 'cancelled'`, scoped on the status so nothing else is
   touched. It reuses the cancel fence's own reason rather than minting a new one — the person
   called it back, and that is what happened, whether the run was mid-action or waiting on them.

2. **Nothing else changes, and that is the argument for this option over the other two.** The
   machinery that makes the closure mean something is already built and already tested:
   `confirmRequest` refuses a question whose run is no longer `awaiting-confirmation`, and
   `confirmationView.abandoned` is derived off the same column, so the confirm screen renders the
   closed state rather than offering a button the answer path would turn down. Both landed with
   [#132](https://github.com/smukhyala/propositum/issues/132) for a different population — a run
   reaped before it got as far as parking — and a halted run joins that population by the front door.

3. **The stop keeps working when nothing else does.** ADR-0010's ordering is untouched: the extension
   detaches the debugger *before* telling the app. This step is app-side and runs after that, so a
   halt still takes effect on a machine that never reaches a server.

4. **Both doors reach one implementation.** `takeBackControl` is wired to the shift screen, and
   `POST /api/act/halt` calls `haltRun` rather than reaching past it — keeping the two steps that are
   genuinely the route's own, because they are about a socket rather than about a row.

### Why this and not the other two

**"A halt leaves the question and refuses the continuation."** The verdict stays recordable as a
record of what the person wanted, and the yes grants nothing. Rejected because it buys a record
nobody reads at the price of a screen that has to explain a yes that was accepted and did nothing —
and because the record it preserves is of a decision the person made *about work they had already
stopped*. Keeping it invites the reading that it might still count.

**"A halt does nothing, stated."** Today's behaviour, made honest — the screen would say the run has
already stopped and the question is what is left of it. Rejected because it is the sentence *"stop
does not stop this one"*, and a stop with a stated exception is still a stop with an exception. The
exception is also the worst available one: a live question whose yes starts a new run driving a
browser is precisely the thing the kill switches exist for.

## What holds the line now

| Claim | What holds it |
|---|---|
| A halted parked run cannot be answered | `confirmRequest`'s `abandoned` refusal, reading `AgentRun.status` — the same column, the same test as a reaped run |
| The screen says so rather than offering a button | `confirmationView.abandoned`, derived off that column so screen and answer path cannot disagree about a row |
| A halt reaches the run whichever door was used | `tests/confirmation-pause.test.ts` drives the halt and then the confirm, and `tests/reachability.test.ts` asserts both doors reach `haltRun` |
| The person is told what happened | `SettledConfirmation`'s `abandoned` sentence, and — since [#139](https://github.com/smukhyala/propositum/issues/139) — the handover beside it |
| A stop still works with the app closed | Unchanged and unheld by any test: the extension detaches first, and nothing here is reachable to assert that |

## Revisit when

**Somebody stops a run and then wants the question back.** That is the cost this ADR accepts, and it
is the one that would show up as a complaint rather than as a bug. The fix if it does is not to
reverse this — it is to make handing over again cheap enough that losing the question does not
matter, which is what #139 started.

**A halt needs to distinguish *stop this now* from *stop when you get to a boundary*.** Today they
are one act. If a second kind of stop arrives, this decision is about the first kind and the second
one needs its own argument.

**`cancelled` stops being the honest reason.** It is reused here rather than joined by a
`halted-while-parked`, on the grounds that the person called the run back and the run's own posture at
that moment is not their concern. If a report ever needs to tell the two apart, that is a new row in
CONTEXT.md's writers table and a new arm in both renderers, not a quiet widening of this one.
