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
   written `interrupted` with `terminalReason: 'cancelled'`. It reuses the cancel fence's own reason
   rather than minting a new one — the person called it back, and that is what happened, whether the
   run was mid-action or waiting on them.

   **It happens only when a person did it, and the default is that nobody did.** `haltRun` takes an
   explicit `byAPerson`, and one caller passes it: `takeBackControl`, the control on the shift
   screen. `POST /api/act/halt` does not, and the reason is not caution. The extension reaches that
   route from `letGoIfIdle` after two minutes on a tab nothing has asked anything of, and **a run
   parked on a question is idle by construction** — it hands out no commands, so the timer fires on
   every parked run, always. Without the flag this ADR would have given every confirmation in the
   product a two-minute life and told the person *"You called me back, so I stopped"* about a
   service worker's alarm, with `CONFIRMATION_EXPIRY_HOURS` — a day, chosen so somebody can think —
   dead on arrival.

   The extension knows the difference and cannot say it: `stopActing` takes `canceled_by_user` at
   the chip and the side panel and `control-lost` from the idle path, but `postHalt` sends only a
   prose `reason`, and a permission decided by parsing prose is not one. Widening that envelope so
   the person's two other switches can close a question is real work and is not this change.

   **The write is scoped twice more.** It refuses a run some other path already ended, which is the
   defect #140 fixed one layer down. And it refuses a parked run whose question has already been
   ANSWERED: that row stays `awaiting-confirmation` for ever — the verdict enqueues a NEW run and
   leaves this one where it is — so without the check a halt would report success for a spent run
   while the continuation about to claim a browser credential carried on untouched. A stop that lies
   is worse than one that says nothing happened.

2. **Nothing else changes, and that is the argument for this option over the other two.** The
   machinery that makes the closure mean something is already built and already tested:
   `confirmRequest` refuses a question whose run is no longer `awaiting-confirmation`, and
   `confirmationView.abandoned` is derived off the same column, so the confirm screen renders the
   closed state rather than offering a button the answer path would turn down. Both landed with
   [#132](https://github.com/smukhyala/propositum/issues/132) for a different population — a run
   reaped before it got as far as parking — and a halted run joins that population by the front door.

3. **The stop keeps working when nothing else does — and step 0 is not the part that does.**
   ADR-0010's ordering is untouched: the extension detaches the debugger *before* telling the app,
   and that is what works with the app closed, the dev server restarting, or the machine offline.
   Step 0 is a database write and works none of those times. What survives an offline stop is the
   detach and the flag; closing a question needs the app, which is acceptable because closing a
   question is not what makes a stop urgent — removing the capability is, and that is unchanged.

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
| A halted parked run cannot be answered | `confirmRequest`'s `abandoned` refusal, reading `AgentRun.status` — the same column, the same test as a reaped run. **Not a transaction:** it reads the status and then writes the verdict and enqueues, so a halt landing between the two produces the yes this ADR says it prevents. Sub-millisecond, pre-existing (the lease sweep and `expireConfirmations` race it identically), and named here because this ADR is about two decisions arriving in an order nobody reconciled |
| A timer never closes a question | `byAPerson`, defaulted off, passed by one caller. Nothing else in the codebase can reach step 0, and `tests/confirmation-pause.test.ts` drives the extension's own idle call and asserts the run is still parked |
| A stop reports what it stopped | The verdict predicate on step 0, and `tests/confirmation-pause.test.ts` asserting `stopped: false` on a parked run whose question was answered |
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

**The person's other two switches still cannot close a question.** The chip and the side panel are a
person, and they reach the route that may not pass `byAPerson`. Closing that gap means the halt
envelope carrying who acted rather than prose about why — which is a change to a boundary the
extension shares with every page in the browser, and deserves its own argument about what a
caller-chosen field may decide.

**`cancelled` stops being the honest reason.** It is reused here rather than joined by a
`halted-while-parked`, on the grounds that the person called the run back and the run's own posture at
that moment is not their concern. If a report ever needs to tell the two apart, that is a new row in
CONTEXT.md's writers table and a new arm in both renderers, not a quiet widening of this one.
