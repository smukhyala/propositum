# ADR-0017 — Continuing an Intention across sittings

**Status:** accepted · 2026-08-20
**Depends on:** [ADR-0011](0011-intention-above-worksession.md) — the Intention is durable and
human-ratified, and this ADR is built entirely inside that ruling rather than around it
**Amends:** [`docs/VISION.md`](../VISION.md) _Intention-preserving continuation_ — the **Later**
sentence _"still does not recognise that today's work continues last week's without being told"_ ·
[`docs/ROADMAP.md`](../ROADMAP.md) Stage 1 — _"The `Intention` outlives step 8. Nothing resumes it."_
· [`CONTEXT.md`](../../CONTEXT.md) — adds `WorkSoFar`
**Extends:** [ADR-0009](0009-composed-offers.md) — `carryOnCandidate` and `matchProject`, which
already carry the `Project`. This adds no second matcher and no second question
**Requested by:** [ADR-0016](0016-everyday-computing-direction.md), gap 2

---

## The requirement, in the direction document's own words

> If someone has spent three evenings planning a trip, Propositum should understand that there is a
> trip, what decisions have already been made, what constraints exist, what remains unresolved, and
> what information from previous sessions is relevant to the current one.

Read literally that is a durable, inferred, evolving representation of a person's working state —
which is the thing [ADR-0011](0011-intention-above-worksession.md) spent its length refusing to let
inference write. Two readings of the same paragraph are available and they end in different products.

## What already carries forward, so the gap is stated at its real size

Not nothing. `matchProject` files a new sitting under the `Project` it recognises, and with it the
approved sources and the document survive. `carryOnCandidate` renders a box saying so. Its docblock
is precise about the boundary, and it is quoted rather than paraphrased because the paraphrase always
comes out weaker:

> This is the first crack in that, and it is a narrow one on purpose: what carries forward is the
> PROJECT, and with it the sources already approved and the document already being written. **No
> objective, no reading, no claim.**

What that box shows a person on their second evening is `{sittings: 3, sources: 5, documents: 1,
overlap: 0.7}`. Four numbers. **The gap is not that nothing carries forward — it is that what carries
forward is counted rather than said.** A person who spent three evenings on a trip is not helped by
being told there were three evenings.

## Decision

**A computed view, `WorkSoFar`, folded deterministically from rows that already exist, scoped to one
`Intention`, rendered before anybody clicks anything.**

- **Computed, never stored.** No column, no table, no schema change. This follows unanimous
  precedent — `EnforcedPolicy`, `Shift`, `ActionStatus` and `IntentionState` are all computed views
  on the argument that **two stores for one truth is exactly how a UI comes to display something the
  gate cannot enforce**. Here the argument is sharper than usual: a stored version is the thing
  ADR-0011 forbids, so _computed_ is not a preference about where state lives, it is the property
  that makes this legal.
- **Deterministic, with no model call.** It lives in `src/domain/intention/`, which
  `tests/architecture.test.ts` already forbids from importing persistence, reaching the network, or
  reading the clock. Nothing about `WorkSoFar` is inferred, so there is nothing about it to
  hallucinate and nothing to attach `Evidence` to that is not already attached to the row it came
  from.
- **What it folds**, all of it durable and all of it either produced by a person or decided by one:
  sittings under this Intention and when the last one ended · sources already approved · documents in
  play · what previous `Shift`s produced, by `ShiftOutcomeKind` · how each decidable unit was decided
  (`ChangeVerdict`, `OutcomeVerdict`) · which `DecisionNeeded` are still open · where the last run
  stopped (`AgentRun.status` and `terminalReason`).
- **What it may never contain.** A model-written summary. An inferred objective. Anything from
  `SessionClaim`, which stays per-sitting, model-inferred and cold every time. A prediction about
  what comes next. If a future version wants prose, that is a model boundary writing durable state
  about a person, and it is a different decision needing ADR-0011 reopened.

## Why this does not reverse ADR-0011

`CONTEXT.md`'s ruling forbids three things in one sentence — _stale_, _inherited_, **quietly** — and
names its own reason: _"because nothing on screen would say it had been."_ ADR-0011 read that as an
objection to **invisibility rather than to duration**, and answered it by making the durable row
human-ratified so that nothing is inherited by inference at all.

`WorkSoFar` is answerable to the same three words and clears each one differently:

1. **Not inherited by inference**, because inference does not produce it. Every member is a fold over
   a row a person wrote, approved, accepted or rejected. There is no path from a model to this view;
   there is no field a model could write.
2. **Not quiet.** It renders on the accept screen, _before_ the click that starts the sitting, beside
   what `carryOnCandidate` already shows. A person sees what is being carried forward at the moment
   it would be carried, which is strictly more than they see today.
3. **Not stale in the way that matters.** It is recomputed from current rows at every read. A
   rejected change reads as rejected the moment the verdict lands. The failure mode ADR-0011 names
   for a durable _sentence_ — written in March, unread in August, and nothing detects the renewal
   closed in May — does not apply to a fold, because a fold has no memory of its own to go out of
   date. What can go stale is the Intention's `objective`, and that was already true before this ADR
   and is ADR-0011's weak link, not a new one.

**The strongest objection, stated rather than answered.** A person clicking through a screen has
checked less than a person who typed. `VISION.md` already says this about ratification itself —
_"Someone clicking accept on a plausible sentence has checked less than someone who typed"_ — and
`WorkSoFar` makes the accept screen longer, which makes clicking through it easier. This ADR does not
claim otherwise. What bounds the damage is the same thing that bounds it for the Intention: the fold
is derived from rows a person can go and look at, every one of which is reachable from the project
screen, and none of it can grant anything. It is a display, and a display that is skipped shows
nothing that a gate would have enforced.

## The cost this bought, recorded on the day it was bought

**A stale `Intention` can now pre-fill a `HandoffContract`.** `draftContract` takes its `objective`
and `definitionOfDone` from the Intention when `WorkSoFar` says there has been more than one sitting
under it, so the sentence somebody wrote in March is what a run in August is drafted from.

That is not a surprise and it is not new — it is
[ADR-0011](0011-intention-above-worksession.md)'s own predicted failure, arriving on the first
occasion something read the row:

> The person who types _"win the Northwind renewal by shipping the tier comparison"_ in March is not
> prompted again in August, and nothing in this design detects that the renewal closed in May.

ADR-0011 accepted that cost on the strength of one mitigation — _"on screen wherever it is used"_ —
and then named that same clause as its own weak link, _"an interface requirement, not a property of
the schema"_. This ADR is where the clause is either kept or quietly dropped, so: **it is kept, and
the mechanism is a date.** `ContractDrafted` carries a two-armed discriminant naming where the words
came from, and when they came from an Intention it carries `Intention.updatedAt`; the agreement
screen prints the month and year above the fields it accounts for. That closes the one thing
`CONTEXT.md`'s `IntentionState` entry still listed as owed.

**What a date does and does not buy.** It cannot tell anyone the sentence is wrong — nothing in this
system knows the renewal closed. What it does is stop the sentence from arriving _anonymous_: a
person reading _"you wrote this in March"_ above a pre-filled objective is being asked a question
they can answer, and one reading the objective alone is not being asked anything at all. That is the
whole of the mitigation and it should not be read as more.

**Where this could still go wrong, said plainly.** A person who clicks through the agreement screen
has checked less than one who typed, the screen is now longer, and the date is one line on it. If
somebody later proposes removing the date to reduce clutter, or pre-filling from an Intention with a
single sitting behind it, that is this paragraph being spent — and it is the paragraph, not the
field, that ADR-0011's weak link was resting on.

## The name

`WorkSoFar` — a **computed view**, consumer wording **"Where you left off"**.

Four names were unavailable and the reasons are worth keeping, because each is a collision somebody
would otherwise rediscover. `Continuation` is taken by `src/domain/execution/continuation.ts`, which
is about answering a confirmation. `SessionReading` is taken and, worse, is _model-inferred_ — an
`IntentionReading` sitting beside it would read as the same kind of object with a different scope,
and it is the opposite kind of object. Anything containing `Progress` collides with
[Principle 1](../PRODUCT_PRINCIPLES.md) — _activity is not progress_ — and with the _Progress
Reasoner_ layer name, which is about generating candidate actions and is not this. `SessionState` is
banned outright.

**Displaces:** "cross-session summary" · "memory" · "context carryover" · "the project's history".

## What is still not built after this

Said plainly, because the gap this closes is smaller than the sentence _"continuation works"_ would
suggest:

- **Nothing resumes an Intention without a person.** No scheduler, no notification, no second shift
  arriving on its own. Picking the work back up is still somebody opening their laptop. `MVP.md`
  already says this and it stays true.
- **The reading is still cold.** What Propositum _thinks_ you are doing is rebuilt from this
  sitting's events and nothing else, every time. That is deliberate and it is the half of
  `VISION.md`'s **Later** paragraph that does not move here.
- **Still at most one `Intention` per `Project`.** A trip and a monitor purchase under the same
  project would be one Intention, which is wrong, and the unique index is what makes it a shape
  rather than an argument. Stage 4.
- **`WorkSoFar` has no reader in the run.** It renders to a person and feeds the pre-filled
  `StatedIntent` on the agreement screen. It does not reach `compilePolicy`, it does not reach the
  gate, and it is not in a prompt. Same posture as a `BusyInterval` under
  [ADR-0014](0014-reading-free-busy.md): **it may inform a person; it may not inform a decision.**

## Revisit when

- **Somebody wants prose in it.** That is a model boundary writing durable state about a person and
  it reopens ADR-0011, not this one.
- **A second `Intention` per `Project` is needed.** `WorkSoFar` is scoped by Intention already, so it
  survives that change — but _which Intention does this sitting belong to_ becomes askable, and the
  unique index is currently what stops it being asked.
- **It reaches a prompt.** The moment `WorkSoFar` is interpolated into a boundary, it stops being a
  display and becomes context a model acts on, and every claim in _Why this does not reverse
  ADR-0011_ has to be re-argued against prompt injection reaching it through the rows it folds.
