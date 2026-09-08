# ADR-0035 — What a person said they are waiting on, and the sixth word that becomes reachable

**Status:** accepted · 2026-09-07
**Depends on:** [ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) — the ledger that
makes the sixth member reachable at all · [ADR-0011](0011-intention-above-worksession.md) — the
Intention is human-ratified, and this adds a field to it under that rule unchanged
**Amends:** [ADR-0011](0011-intention-above-worksession.md) §2 — whose *"`waiting` is deliberately
absent… not an oversight to be tidied later"* rested on two facts, one of which
[ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) reverses and one of which was never
true. Its ruling is still correct **today**; what changes is that it stops being permanent. Its own
*Revisit when* trigger — *"`ExternalEvent` becomes real"* — is what fires here ·
[`CONTEXT.md`](../../CONTEXT.md)'s `IntentionState` entry — both the *Five members*
paragraph and, separately and more seriously, its *Displaces:* line, which retires
`waiting (as a member)` · [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)'s *The lifecycle word*
**Beside:** [ADR-0022](0022-the-fourth-verdict.md) — which lifted the same kind of strike on the
`DecisionNeeded` route into `needs-you`, on the day the row became answerable. This is that shape
again, one member over

## The reversal this is, said before the argument for it

`waiting` is not a member this union is missing. It is a member this union **displaced**:

> *Displaces:* IntentionStatus · status · lifecycle state (as a column) · state machine · stalled ·
> blocked · **waiting (as a member)**.

So this is a vocabulary reversal and not an addition, and [`AGENTS.md`](../../AGENTS.md) is explicit
about what that costs: *"Silently overriding a decision loses the argument that produced it."* The
strike is lifted in place rather than the line rewritten, on ADR-0022's precedent.

**What makes it lawful is that the original entry named its own trigger.** `CONTEXT.md` did not
refuse `waiting` on taste; it refused it on reachability, and said when it would come back:

> *"A member nothing can reach is a promise the interface would render and the data could never
> keep. **It arrives with event ingestion**."*

[ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md) is event ingestion. The clause fires
on the condition it was written with, which is the only way a threshold fixed in advance is worth
having.

## Context

`src/domain/intention/state.ts` carries a sentence that is a design admission rather than a
complaint:

> **"`sleeping` is the honest common case and will read like a bug."** With one sensor, no external
> events and one live session at a time, most Intentions compute to `sleeping` most of the time.
> That is the true answer. Making the screen more interesting than that means inferring, which is
> the one thing an Intention exists not to do.

Both halves hold. The way out is not to infer more; it is to let a person **say** the thing that
distinguishes *nothing is happening* from *nothing is happening yet, and here is what I am waiting
for*. That distinction is the whole of the direction document's flagship example — *"You told this
recruiter you would follow up this week"* — and it is available without a model reading anybody's
mail.

## Decision

**`Intention` gains one nullable field a person writes, `statedWait`, and `IntentionState` gains a
sixth member, `waiting`, reachable only when a `statedWait` is set and no `ExternalEvent` has
discharged it.**

- **Human-written, and by nothing else.** It is typed on the working-agreement screen beside the two
  sentences already there, edited there, and cleared there. No detector, no model boundary, no
  worker and no recovery sweep may write it. `tests/reachability.test.ts` pins the writer set at
  one, which is the mechanism [Principle 12](../PRODUCT_PRINCIPLES.md) already rests on for the rest
  of the row — and it is the same weaker guarantee that principle's own *Honest limit* names: one
  writer, not a type that makes a second impossible.
- **It is a `StatedWait`, following `StatedIntent`.** The words a person ratified, not a category
  the system inferred. `CONTEXT.md` gets the entry before the schema does.
- **Discharge is deterministic.** An `ExternalEvent{kind:'arrived'}` carrying this `intentionId`
  discharges the wait. A model never decides that two things are the same thing.
- **Precedence: after `done` and `needs-you`, before `sleeping`.** `done` first, because a computed
  word must not contradict a person on their own screen. `needs-you` next, because it is the only
  member that asks something **of** the person and `waiting` asks nothing. Then `waiting`, then
  `sleeping` as the default that claims least. The existing argument in `intentionState`'s docblock
  is unchanged; one row is inserted into it.

**Why the field is on `Intention` and not on `HandoffContract`.** A wait outlives the sitting that
declared it — that is the entire point — and `StatedIntent` is *"the sentence one contract commits
to"*. Putting it on the contract would make it die with the shift, which is the failure this ADR
exists to fix.

## What is deliberately not built

- **Nothing infers a wait.** Not from page text, not from a `SessionClaim`, not from a mail body.
  Reading prose for commitments is what [ADR-0006](0006-trust-boundary.md) §5 keeps out of the
  contract, and a commitment lifted from a page into a durable row is the same laundering one table
  over.
- **No reminder, no schedule, no notification of its own.** A `waiting` Intention is a word on a
  screen and a candidate in [ADR-0036](0036-ordering-candidates-without-a-score.md)'s ordering.
  [Principle 13](../PRODUCT_PRINCIPLES.md) forbids a notification with no decision attached, and
  *"you are still waiting"* is not a decision.
- **Nothing quiets a stale wait, and that is the sharpest hole in this decision.** A strand can
  leave the front door three ways — an origin snooze, a thread snooze, and reticence
  ([ADR-0020](0020-remembering-a-decline.md)). A wait has none of them: no decline, no snooze, no
  decay, and no bar it must re-clear. Its only exit is a discharge, and the cost section below
  concedes the discharge may never come. So two stale waits can hold two of `MAX_THREADS_SHOWN`'s
  three slots indefinitely, against work the person is actually doing. **The obvious answer is
  ADR-0020's mechanism, and it is deliberately not taken here** — reticence is keyed to a hashed
  thread signature and a wait has none, so reusing it is a design rather than a wiring change. What
  the build must not do is ship the wait without *something* in this position; the honest minimum is
  that a person can clear a wait from the same screen that renders it, which is one control and not
  a policy.
- **No second wait per Intention.** One nullable field, matching the one-Intention-per-Project
  deferral it sits inside.
- **The overdue case gets no row.** An undischarged wait plus elapsed time is arithmetic at read
  time. Writing *"this became overdue"* would be
  [ADR-0034](0034-somewhere-to-put-an-event-outside-a-sitting.md)'s refused deadline member arriving
  through a side door.

## Rejected alternatives

**Inferring the wait from the sitting's `SessionReading`.** The version that needs no typing, and
the direction document asks for exactly it — *"the user should not need to phrase every task
explicitly."* Refused because it is the one promotion this vocabulary forbids by name: *"a
SessionSubject becoming an Intention without a person accepting it — of everything in this
vocabulary, that is the one promotion no code path may make."* A wait is a field on that row and
inherits the rule.

**A `Blocker` or a `Dependency`.** The words the direction document uses.
[`docs/MVP.md`](../MVP.md) already refuses both as vocabulary, and the reason is not stylistic:
`DecisionNeeded`'s *Displaces:* line retires *blocker* and *escalation*, so introducing `Blocker`
would be a second reversal riding along inside this one, with no argument of its own.

**Making `waiting` a stored column.** Refused on the unanimous precedent `EnforcedPolicy`, `Shift`,
`ActionStatus` and `IntentionState` itself already sit on: *"two stores for one truth is exactly how
a UI comes to display something the gate cannot enforce."* The field a person writes is stored; the
lifecycle word stays computed.

**Letting a `waiting` Intention lower the offer bar.** Tempting and refused: it would be history
widening what Propositum may do, which is [Principle 15](../PRODUCT_PRINCIPLES.md)'s forbidden
direction. A wait may put a candidate in the ordering. It may not make one qualify that otherwise
would not.

## What this costs

- **A ratified field is not a written one.** `VISION.md` already says this about the Intention's two
  sentences and it is truer here: the field arrives empty, but a person who types one sentence in a
  screen full of them has committed less than the word *stated* implies. It is durable, editable and
  on screen, which bounds the damage and is not evidence that anybody meant it.
- **`waiting` can be stale in the one direction that reads worst.** A person whose wait was answered
  in a channel Propositum cannot see leaves an Intention reading *Waiting* forever. The discharge is
  a human act or a fixture, and there is no sensor to notice otherwise — so the honest failure is a
  screen that is behind, and the repair is the same screen.
- **The union grew, and every exhaustive switch over it grew with it.** That is the cheap half and
  it is caught by the compiler.
- **One more thing to type on a screen [ADR-0019](0019-disclosure-and-what-may-never-fold.md) cut to
  194 words.** The field is optional and empty by default. If it turns out to make the agreement
  screen worse, that ADR's *what may never fold* list is where the argument goes.

## What holds the line now

| | |
|---|---|
| `tests/reachability.test.ts` | Exactly one writer of `statedWait`, and it is the ratification path. A second author is the defect this pin exists for |
| `tests/intention-state.test.ts` | `waiting` is unreachable with no `statedWait`; reachable with one; gone once an `ExternalEvent` discharges it. Precedence against `done` and `needs-you` asserted directly |
| `tests/boundaries.test.ts` | No model-facing schema has a field that could carry a wait, on the same terms the rest of the Intention already has |
| `tests/canonical-terms.test.ts` | `StatedWait` is in `CONTEXT.md` before it is in the schema |
| `tests/architecture.test.ts` | `intentionState` stays pure, total and clockless with the sixth member in it |

## Revisit when

- **Anything proposes writing `statedWait` from inference.** That is ADR-0011's argument again and
  it needs ADR-0011 reopened, not extended.
- **A second wait per Intention is wanted.** It arrives with more than one Intention per Project and
  not before.
- **`waiting` becomes the honest common case**, the way `sleeping` is today. Then the interface is
  reporting a backlog rather than a state, and the question is what it should do about it.
- **A sensor lands that can discharge a wait without a person.** The discharge path is written for
  it and the permission argument is not.
