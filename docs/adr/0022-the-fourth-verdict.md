# ADR-0022 — Answering a decision, and the status word that becomes reachable again

**Status:** accepted · 2026-08-26
**Amends:** [`CONTEXT.md`](../../CONTEXT.md) — the struck `DecisionNeeded` row in
`IntentionState.needs-you`, dated 2026-08-16, which says in its own text that the rule *"becomes
reachable the day the row can be answered"*. This is that day, and the strike is lifted rather than
rewritten ·
[`docs/PRODUCT_PRINCIPLES.md`](../PRODUCT_PRINCIPLES.md) §11, whose *"applies to this repo too"*
list names this hole
**Depends on:** [ADR-0007](0007-stop-conditions.md) — `decision-needed` as a stop rule, and the
Interruption dial that decides whether a raised question also halts ·
[ADR-0011](0011-intention-above-worksession.md) — that a missed `needs-you` is the expensive
direction, which is the cost this ADR stops paying ·
[ADR-0021](0021-a-thread-on-the-persons-phone.md) — the channel this verdict can be given from, and
the argument for why this one and no other

---

## What this costs

**A fourth verdict is a fourth thing a person is asked to do, and the vocabulary already warns that
three is enough to confuse.** `CONTEXT.md` spends a paragraph on the fact that *rejecting* and
*confirming* are different acts and that *"a UI that used one word for both would be asking somebody
to authorise an irreversible action with the same control they use to bin a paragraph."* Adding a
fourth verb to that set is not free, and this ADR has to say what makes it distinct before it says
what it buys.

It also spends the cheapest thing in the schema: **a table with no answer column is a table that
cannot be got wrong.** After this, `DecisionNeeded` has an answer, an answer can be stale, an answer
can be given to a question about a run that ended a week ago, and a person can wonder whether
answering did anything. None of those states existed this morning.

## Context

The worker declines a judgment call. `src/runtime/worker-loop.ts:767` pushes a `DecisionRaised`,
`src/server/execute-run.ts:1066` turns it into a `DecisionNeeded` row on the `ShiftReport`, and the
re-entry note renders it under *What I need from you* — a heading [ADR-0019](0019-disclosure-and-what-may-never-fold.md)
protects from ever being folded.

**And then nothing.** The row has `question`, `whyStopped`, `needs` and `ordinal`. There is no
answered column, no verdict, no deletion. `src/persistence/repositories/index.ts` already carries
the full autopsy, written when the count had to be zeroed:

> There is nothing to count. A `DecisionNeeded` has `question`, `whyStopped`, `needs` and `ordinal`
> and no answered, resolved or verdict column; nothing deletes one … The one affordance that looks
> like an answer — *settle* on the re-entry note — is client-only React state whose own copy says
> so: *"Propositum doesn't keep your answer — settling this only unlocks accepting the changes
> together."*

That is the product telling a person, in its own interface copy, that it is not listening. It is
also why `openDecisions` is hardcoded to zero and why a Shift that stopped to ask a question and
produced nothing else reads `sleeping` on the front door. The same docblock names the fix and
prices it:

> **What would undo this:** a durable human act on the note … or `DecisionNeeded` gaining the human
> answer this vocabulary has three of already. Both are a schema change plus a screen, which is a
> workstream and not a line.

This is that workstream.

## Decision

**`DecisionVerdict` — append-only, one row per `DecisionNeeded`, written only by a human, holding
prose.**

```
DecisionVerdict
  id                 String @id
  decisionNeededId   String @unique
  answer             String
  decidedAt          DateTime
  source             String        // 'screen' | 'thread'
```

### Why this one may be answered from a lock screen

[ADR-0021](0021-a-thread-on-the-persons-phone.md) refuses to let a `ConfirmationVerdict` be given by
reply, quoting the endpoint that was built to make it impossible: *"a channel that could carry the
approval would make that button one line of code away forever."* This ADR has to explain why it is
not doing the same thing one table over, and the answer is not *it feels smaller*.

**A confirmation is permission for something that has not happened and cannot be undone. An answer
to a decision is a fact the worker did not have.**

Concretely, and this is the operative list:

- It **grants nothing.** No `AuthorizedAction` is minted, no `ContractScope` widens, no
  `ActionKind` becomes allowed, no budget moves. `compilePolicy` cannot receive it — for the same
  structural reason it cannot receive a `StatedIntent`, and that is a compile error rather than a
  convention.
- It **unblocks nothing irreversible.** The run that raised the question has already ended. Nothing
  is holding a control token, driving a browser, or waiting on a deadline.
- It **is not permission at all.** A person who answers *"go with the annual tier"* has stated a
  preference. Whether anything is ever done about it goes through the gate, in a new Shift, with a
  ratified agreement, exactly as it would have if they had typed it into the guidance field.

That last point is the one that makes this safe rather than merely small. **An answer to a decision
enters the product on the same footing as `guidance` does** — human-typed prose, deliberately
unenforceable, that informs work and authorises none of it. `guidance` has been that since
`CONTEXT.md` was written, and nobody proposes that it needs a screen.

### Where the answer goes

**Nowhere, in this slice.** The row is written and rendered and read by no worker.

That is deliberate and it is the honest version. Feeding an answer into the next run's `StatedIntent`
is a second decision — it means model-adjacent prose from one Shift shaping the next one, and
[ADR-0006](0006-trust-boundary.md) §5's whole argument is that the human review of a handoff is the
only thing catching an objective that was rewritten underneath it. A `DecisionVerdict` that
auto-populated the next agreement would be a path from a worker's own question to the next
agreement's text with no human ratification in between, which is the shape the trust boundary
exists to refuse.

So: the person answers, the answer is durable, the note shows it, and carrying it forward is
`docs/ROADMAP.md` territory with its own ADR. **Saying that out loud is better than shipping a
half-connection and letting a reader assume the loop is closed.**

### What becomes reachable again

`intentionState`'s `needs-you` rule for `DecisionNeeded` was struck on 2026-08-16 with the note that
it *"stays in `intentionState` because it is the right rule for the row, and it becomes reachable the
day the row can be answered."*

`openDecisions` stops being hardcoded to zero and starts counting `DecisionNeeded` rows with **no**
`DecisionVerdict`. The count can now go down, so `needs-you` can now go off, so the rule stops being
a status word that is always on. The strike in `CONTEXT.md` is lifted and dated; the paragraph
explaining why it was struck stays, because what a reader believed until now is worth leaving on the
page beside what replaced it.

### The fifth verb

`CONTEXT.md`'s four verbs are: the gate **refuses** · the human **rejects** · the model **declines**
· the human **confirms**. This adds a fifth and it must not collide with any of them.

**The human answers.** Not *decides* — too close to the noun and it reads as authorisation. Not
*resolves* — that describes the question's state rather than the person's act, and it invites a
button that closes a question without saying anything. **Answering means writing prose in response
to a question, and the control is a text field, never a pair of buttons.** A `DecisionNeeded` with a
Yes and a No would be a confirmation with the safety filed off.

Consumer copy: **What I need from you** stays as the heading (ADR-0019 pins it). The control reads
*"Tell it"*, and once answered the note shows the answer back with the date.

## Rejected alternatives

**`ShiftReport.finishedAt` instead** — the other half of the option the docblock names. A timestamp
written when the person finished reviewing would clear `openDecisions` just as well, and it is
strictly less schema. It is rejected because it clears the count **without capturing the answer**:
the person read the question, closed the note, and the thing they decided is gone. That is the
current *settle* affordance with a database row behind it, and its own copy already admits what it
is. It is worth building anyway, for a different reason — it marks that a person has been to the
note at all — and it is not this.

**A structured decision type — an enum of decision classes, with typed answers.** `CONTEXT.md`
already refused the taxonomy half of this: *"'which partner tier to propose' is not plausibly
enumerable in advance, so the mechanism would never fire on real work."* A typed answer needs a
typed question. Refused for the reason the question was.

**Let the model read the answer immediately and continue the run.** The seductive version, and it is
the one that makes the feature feel finished. It is refused twice over: the run has already ended,
so *continuing* means starting a new one under the same contract, which `docs/adr/0007-stop-conditions.md`
lists under *Revisit when* as not-yet-designed; and a model reading a human answer and acting on it
without a new ratification is the trust-boundary hole above. **The version of this that ships later
starts a new Shift with a new agreement the person reads.**

**Buttons instead of a text field.** Cheaper on a phone and much better tap ergonomics. Refused: the
whole reason `DecisionNeeded` exists is that the worker met something it could not reduce to a
choice. Reducing it to a choice at the interface would be the model's failure to enumerate, papered
over by ours.

## What holds the line now

| | |
|---|---|
| `tests/append-only.test.ts` | `DecisionVerdict` refuses `UPDATE` and `DELETE`, like every other verdict table |
| `@unique` on `decisionNeededId` | One answer per question, enforced by the database rather than by a check |
| `tests/policy-gate.type-test.ts` | A `@ts-expect-error` proving `compilePolicy` cannot receive a `DecisionVerdict`, the same proof `StatedIntent` has |
| `tests/thread-scope.test.ts` | An answer reaches a row and never a model boundary — the containment template, applied to the one value that arrives from a phone |
| `tests/reachability.test.ts` | `answerDecision` asserted reached from both the shift report and the thread, in the same change that wires either |

**Where this could still go wrong.** The claim *"the answer is read by no worker"* is held by
absence today, and absence is the strongest thing available — but it is one import away from being
false, and unlike `LANDING_ACTION_KINDS` there is no transport that would refuse it. The reachability
assertion is what notices, and it notices only if somebody keeps it honest when they wire the
carry-forward.

## Revisit when

- **Somebody wants the answer to reach the next run.** That is the carry-forward, it is genuinely the
  point of the feature, and it needs an ADR that says how a human ratifies the text before a worker
  reads it.
- **A `DecisionNeeded` needs answering while the run is still going.** Today they only become rows at
  run end, so the question and the stop arrive together. A `stop-only-when-blocked` run that raised
  three questions over an hour tells the person about all three at the end, which is correct now and
  would not be if a run could be resumed.
- **Anyone proposes a Yes/No control on a decision**, for tap ergonomics or any other reason.
- **`openDecisions` starts reading as permanently non-zero again.** That means people are being
  asked questions they do not answer, which is a fact about the questions and not about the schema.
