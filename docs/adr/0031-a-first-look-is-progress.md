# ADR-0031 — A first look is progress, and only a second look at the same thing is a circle

**Status:** accepted · 2026-09-02
**Amends:** [ADR-0007](0007-stop-conditions.md) — not the rule set, which is untouched, but what
`no-progress` counts. Its amendment of 2026-09-01 exempted the case where nothing permitted could
ever change an artifact; this is the case on the other side of that ·
`NO_PROGRESS_LIMIT`'s own comment in `src/domain/execution/stop-conditions.ts`, whose *"two can be
legitimate research before a draft"* is the assumption that failed
**Depends on:** [#160](https://github.com/smukhyala/propositum/issues/160), filed off the paid run
of 2026-09-02 · [#101](https://github.com/smukhyala/propositum/issues/101), which exempted the
neighbouring case and deliberately left this one

---

## What this costs

**A run can now read more before anything stops it.** Three consecutive reads of three different
things used to end a shift; they no longer do. A run that reads twenty pages and drafts nothing is
bounded by `action-limit` at forty turns and by the person's own time limit, both of which are
further out than `no-progress` was. So the cheapest brake on a lost-but-busy run got looser, and the
cost is paid in model calls and in the person's minutes.

That is accepted because the brake was catching the wrong runs. It is not a free change and the
number of things that bound a runaway run is now, in practice, two rather than three.

**It also adds per-run state to a loop whose whole design is that it holds none.** `runWorker`
rebuilds from the ledger and keeps nothing of its own between turns; this is a `Set` that lives for
one run and is deliberately not rebuilt. The reasoning is below, and it is a real exception.

## Context

`monitor-shortlist` — a `draft-changes` shift, permitted to write — ended `succeeded on no-progress`
with **zero proposed changes**, on 2026-08-27 and again on 2026-09-02. The second run was paid for to
explain the first, and the worksheet built for that purpose says what happened:

| # | Proposal | Outcome | counter |
|---|---|---|---|
| 1 | `read-document` | succeeded, changed nothing | 1 |
| 2 | `read-approved-source` | refused: `source_not_approved` | 2 |
| 3 | `read-approved-source` | succeeded, changed nothing | 3 → halt |

**Step 3 of a six-step plan whose first drafting step is step 5.** The run did not decline to draft
and did not have nothing to draft. It never arrived. The 2026-08-27 run reached the same halt by a
different route — three reads, no refusal — which is what makes this a limit rather than an incident.

`NO_PROGRESS_LIMIT` is 3 and its comment states the assumption: *"three, because two can be
legitimate research before a draft."* Both observed plans wanted more than two, and neither was
misbehaving. A rule that fires on the reasonable case is not bounding a lost run; it is bounding a
careful one.

**The distinction that was missing was already written down.** `changedSomething`'s docblock in
`src/runtime/worker-loop.ts` says exactly the right thing and the code did not implement it:

> `navigate` is not a mutating kind and does count here: opening a page gets somewhere, **where
> re-reading the same document three times does not.**

Every read reported `changedSomething: false`, so "the same document three times" and "three
different sources" were one value.

## Decision

**A read of something this run has not read is progress. A read of something it has is not.**

1. **`Performed` gains `readTarget`** — an opaque key, present on the two reading kinds and absent
   everywhere else. `read-approved-source` reports the **approved source id**, not the title or the
   URL: the id is what the person ratified and the only one of the three a page cannot influence.
   `read-document` reports the version id.

2. **The loop keeps a per-run set** and resets `consecutiveNoProgress` on a first look, exactly as it
   does on a real change. A repeat increments, so a run re-reading one thing still halts — one turn
   later than before, because the first look is no longer counted as one of the three.

3. **It is not a content hash.** Two reads of a source that changed underneath are the same look at
   the same thing to this rule. The rule catches a run going in circles, and a page that changed is
   the page's doing rather than the run's.

4. **The set is per-run and is deliberately NOT rebuilt from the ledger.** A continuation reading a
   source its predecessor read is doing the reasonable thing after a person answered a question, and
   a rebuilt set would make the second leg of a paused shift stricter than the first for a reason
   nobody could explain from the screen. The cost is that a run which pauses and resumes gets a fresh
   allowance; the bound that matters across a contract is `MAX_ACTIONS_PER_RUN`, which is counted off
   durable rows and is unaffected.

### What was considered and not done

**Counting only after the plan's first mutating step**, or **raising the limit while the plan holds
an unreached mutating step.** Both make the rule depend on the shape of a plan a model wrote, and
neither works for an off-plan run under `use-judgment`, which has no plan to read. A stop rule whose
threshold a model can move by writing a longer plan is a stop rule a model can widen.

**Exempting a non-pausing refusal from `no-progress` entirely**, leaving it to `refusal-loop`.
Raised by #160 and genuinely arguable: both limits are 3, so one event counting toward two of them
means either can fire for the other's reason, and the person reads *"I was going in circles"* about
a run that was refused something. It is not done here because it is a second decision with its own
cost — it would take a refused run's bound from three to three-of-each — and because this change
alone fixes both observed runs. Recorded so the next person finds an argument rather than a silence.

## What holds the line now

| Claim | What holds it |
|---|---|
| A run re-reading one thing still halts | `tests/worker.test.ts`, twelve reads of one document, still `no-progress` — at four actions rather than three, with the change dated in the test |
| A plan that reads several things reaches its drafting step | `tests/worker.test.ts`, three distinct reads then a draft, asserting `no-progress` did **not** fire and prose was produced. It fails on the previous commit |
| A question, a refusal and a failed action still count | Unchanged and still asserted — `progressIsPossible`'s three increments are untouched |
| The rule still bounds a research-only run | Unchanged: #101's exemption is a separate branch and this does not widen it |
| A lost run still ends | `action-limit` at `MAX_ACTIONS_PER_RUN`, and the person's time limit. Both further out than before, which is this ADR's stated cost |

## Revisit when

**A run reads twenty different things and drafts nothing.** That is the shape this loosening lets
through, and the answer if it happens is probably not a tighter counter but a bound on distinct
reads — which is a different rule with a different name, not a smaller number here.

**The refusal question comes back.** If a person is told they were going in circles about a run that
spent its three on gate refusals, the deferred half above is the change to make.

**Anything starts keying on `readTarget` other than this rule.** It is an opaque equality key with no
meaning outside the loop, and a second reader would make it a fact about the run that has to be
right rather than a bound that has to be roughly right.
