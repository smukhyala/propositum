# Product principles

~~Ten principles.~~ **Fifteen principles, as of 2026-08-16.** The header said ten while eleven were present:
principle 11 arrived and the count did not follow it. That is a small error in the one document that
tells every other document to say the true thing, and it is corrected here rather than quietly
overwritten. Four more principles arrive below from the 2026-08-16 direction update
([ADR-0011](./adr/0011-intention-above-worksession.md)).

Each states what it **forbids concretely**, because a principle that rules nothing out is decoration.

Where a principle is already enforced by a type, a schema, or a test, that enforcement is named.
Where it currently rests on discipline alone, that is said plainly — those are the ones that erode.

**The numbers are load-bearing.** Source comments in `src/` cite §6, §8, §9, §10 and §11 by number,
so principles are **appended, never inserted or renumbered**. A principle that turns out to be wrong
gets struck and dated in place, keeping its number.

---

## 1. Preserve intention, not activity

A replay of what someone clicked is worthless. What matters is where they were going.

**Forbids:** storing raw interaction streams for their own sake · a `ShiftReport` that recounts
steps instead of stating outcomes · a `SessionReading` that summarises the timeline rather than
interpreting it.

**Test:** if a `SessionReading` reads like a narrated log, it has failed even when every fact in it
is correct.

**Extended 2026-08-16** ([ADR-0011](./adr/0011-intention-above-worksession.md)). The direction update
asked for a principle called *activity is not progress*. **This is that principle**, written earlier
and named better, so no separate entry was added — two rules saying one thing in different words is
how a list of constraints becomes a list of slogans, and the second one is always the one that gets
cited because it is easier to satisfy. What the update genuinely adds is a second place the rule has
to hold: an `Intention` has moved when its stated outcome is closer, not when something happened to
it. A sitting that produced forty `ObservationEvent`s and left the desired outcome exactly as far
away made no progress.

**Forbids, extended:** an `IntentionState` that changes because activity occurred rather than
because a stated condition was met · any progress indicator derived from event volume, action
count, or elapsed time.

---

## 2. Context before prompting

Propositum begins with a `WorkSession`, not a text box. The person should never have to re-explain
work Propositum watched them do.

**Forbids:** any flow whose first step is "describe what you want" · a `HandoffContract` the human
must fill from scratch rather than correct.

**Measured:** handoff correction rate. Heavy editing of every draft contract means this principle
is not being met, whatever the H1 score says.

---

## 3. Models propose, deterministic code authorizes

The load-bearing safety principle. An LLM may suggest an action; it may never authorize one.

**Forbids:** any model output reaching a permission check, an allowlist, a budget check, or a stop
condition · a gate that consults a model · a `ReviewFinding` that grants anything.

**Enforced structurally:** `compilePolicy`'s parameter types are constructed so they *cannot
receive* `StatedIntent`. Passing prose into a policy decision is a compile error, not a review
note. Extend that pattern rather than relying on care.

---

## 4. Observation never acts

The capture layer produces `ObservationEvent`s. It holds no tools and changes nothing.

**Forbids:** a `CaptureAdapter` with a method that summarises, classifies, or interprets · an
extension that can write to the `Document` · inference running inside the capture path.

**Test:** if `CaptureAdapter` grows a method returning anything other than events, the layering has
collapsed.

---

## 5. Draft before acting

Work is **held** and you decide. For a `document-changes` `ShiftOutcome` that means `ProposedChange`s
against an immutable `BaseVersion`, folded by `materialise(base, changes, decisions)`; for a
`collection`, an `answer` or a `message-draft` it means `OutcomeProposal`s decided one at a time.
Review produces **decisions, never documents**, whatever the kind.

**Forbids:** a worker that mutates a `DocumentVersion` · a `Changeset` applied without a
`ChangeVerdict` · any `DocumentVersion` that exists without a human having authorized it · a message
that is sent by the act of drafting it.

**Honest limit, from 2026-08-11:** one `ShiftOutcomeKind` — `external-effect` — is not held, because
it already happened. That outcome is **reported and never reviewed**, and the interface must not
render a verdict control beside it. See principle 9.

---

## 6. Autonomy is the person's to set, and every dial must bite

Four dials: Initiative, Progress, Output, Budget. Each compiles to something the gate evaluates.

**Forbids:** a control that changes only prompt wording · a free-text "stop and ask me when…" field
(users read typed sentences as hard limits, and it cannot be one) · exposing recursion depth, agent
counts, temperatures, or token limits · a cost dial the product cannot honour.

**The test for any new control:** name the deterministic check it compiles to. If there isn't one,
it is theatre — the reason "Suggestions only" became a real permission rather than a display mode.

**Progress, redefined 2026-08-11** ([ADR-0010](./adr/0010-acting-in-the-browser.md)): a **step is the
interval between two mutating actions**, because an agent that perceives a page and then decides
cannot be bound by a list written before it looked. `current-step-only` now means *make at most one
change out there, then come back to me*. The dial still bites — it compiles to a count off the
ledger rather than to a set of step ids.

**And one thing no dial may ever do:** pre-approve an irreversible action. There is no setting that
grants one in advance, and there is no free-text field that could be read as one. A model saying
"this is still the same step" is likewise forbidden, because that is a grant wearing a description's
clothes.

---

## 7. Stop rather than guess

When the next step needs judgment the person has not delegated, stop and ask.

**Forbids:** proceeding on a low-confidence reading · treating an LLM's self-reported confidence as
a gate input · a `DecisionNeeded` rendered as an error rather than a decision.

**Honest limit:** stop conditions are *structural* — outside the allowlist, outside approved
sources, over budget, no artifact progress. Model-reported uncertainty is an additional trigger,
never the only one, because self-reported confidence is uncalibrated.

---

## 8. Every action is inspectable, and the ledger is the receipt

`ActionIntent` before, `ActionOutcome` after, both append-only. Refusals are recorded too — a
refused action is evidence about H3.

**Forbids:** an action with no recorded reason · a mutable ledger row · a `ShiftReport` section
that is model-authored rather than rendered from durable rows.

**Enforced:** three SQLite triggers per append-only table — no-`UPDATE`, no-`DELETE`, and a
no-replace `BEFORE INSERT` guard, because `INSERT OR REPLACE` walks through the first two. Prisma's
SQLite migrations silently drop triggers on any table rebuild, so they are reinstalled **and
verified at every startup**. The guard is a runtime invariant, not a migration artifact.

**Honest limit:** exactly one section of the `ShiftReport` is model-authored — the narrative line.
Everything else renders deterministically. If the narrative boundary fails, the report renders
without it.

---

## 9. Every change is reversible **by default**

*(Amended 2026-08-11 — [ADR-0010](./adr/0010-acting-in-the-browser.md). This principle previously
read "Every change is reversible" and rested on absence of capability. It is the one principle in
this list that got weaker, and the weakening is stated here rather than in a footnote.)*

The base is immutable for the whole review. An **irreversible** capability may exist only as a
landing `ActionKind`, which the gate refuses unless the human acknowledged **that action
individually** — not via a dial — and whose outcome is **reported rather than reviewed**.

**Forbids:** in-place edits · deleting anything the person created · any action outside the
`ActionKind` enum · **a dial, a default, a timeout, or a model that can approve an irreversible
action** · a verdict control rendered beside something that already happened.

**Enforced:** irreversibility is decided by what Chrome is about to send, not by a model and not by
the page; the word list over a button's own label can only escalate; a `ConfirmationVerdict` has no
`expired` member, so a question that times out produces no permission; the server refuses a verdict
against a `landed` outcome before it checks anything else.

**Honest limit:** absence of capability was the strongest prohibition available, and a confirmation
is weaker than an absence — it can be misconfigured, and it can be clicked through. `ActionKind` now
enumerates mechanisms rather than effects, so `tests/architecture.test.ts` still asserts no
`sendMessage` function exists, still passes, and no longer means what it was written to mean. This
is a principle held up by mechanisms now, and mechanisms erode.

---

## 10. Re-entry is part of execution

If the person cannot understand what changed and resume in about a minute, the run failed —
regardless of output quality.

**Forbids:** an all-red rewrite diff (a *policy* failure, bounded by blast radius in the gate, not
a rendering problem) · a report that buries *what I need from you* · colour-only diffs, which fail
WCAG 1.4.1 at Level A and are not announced by most screen readers even with `<ins>`/`<del>`.

**Structural:** the `ShiftReport` is written by the app when the person returns, never by an
`AgentRun` — a report only a live runner could produce cannot exist on `interrupted`, which is the
outcome that most needs one.

---

## 11. Say the true thing, including when it is unimpressive

Not in the original list. Earned during charting, when the research kept surfacing findings that
were inconvenient.

Human-feeling means calibrated confidence, respectful interruption, and understandable decisions —
not warmth papering over uncertainty.

**Forbids:** anthropomorphic fluff concealing what Propositum does not know · a `CaptureGap`
rendered as anything other than "I stopped seeing your work" · implying work continues after the
Mac sleeps · a confidence band dressed up as certainty · reporting an H1 score without the
protocol that produced it.

**Applies to this repo too.** `ReviewFinding` currently has no effect. `unknown` will be the
routine `ActionStatus` rather than the exception. A person answering a confirmation is sitting at
their desk under a screen headed *"While you were away"*, because `SessionPhase` has no honest value
for that moment and keeping `away` is the smaller lie — **and it is still a lie**. The fence
`CONTEXT.md` describes around a claimed run has never existed in the schema. All four are written
down instead of smoothed over.

---

## 12. Intentions outlive sessions

*(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md).)*

A sitting is an episode. What the person is trying to achieve is not. The `Intention` is the durable
row; the `WorkSession` is one attempt at it.

**Forbids:** an `Intention` created or edited by anything other than a person · a carried-forward
outcome that is not on screen where the person can read and change it · any inference path writing
to the `Intention` row — not the detector, not a model boundary, not a future reconciler · treating
`SessionClaim{kind:'objective'}` as a source for one.

**Enforced by nothing yet — the row does not exist.** `prisma/schema.prisma` has no `Intention`
model and `grep -rn Intention src/` finds one doc comment. When
[ADR-0011](./adr/0011-intention-above-worksession.md)'s table lands, the single writer is to be the
**contract-ratification path** — `acceptContract`, not `acceptWorkOffer`, because ratifying the
`StatedIntent` is the first point at which a `definitionOfDone` exists to write down. Until then
this principle is a constraint on the slice, not a property of the code.
`SessionClaim{kind:'objective'}` is deliberately left alone by this principle and must stay that way
— per-sitting, model-inferred, evidence-bearing, cold every time. Two lifetimes, two rows, and no
code path from the inferred one to the durable one.

**Honest limit:** even once it lands, "inference never writes the row" is held up by there being
exactly one writer, not by a type that makes a second writer impossible. Compare principle 3, where
the equivalent guarantee is a **compile error**. This one is weaker, and the correct moment to
strengthen it is the first time somebody proposes a second writer, not after.

**Second honest limit:** the objection this principle answers was invisibility, not persistence —
[`CONTEXT.md`](../CONTEXT.md) argued that a quietly inherited objective is worse than a cold read.
Nothing here makes a person *read* what carries forward. It only guarantees there is nothing to
inherit that they did not put there.

---

## 13. The system should be comfortable doing nothing

*(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md).)*

Silence is a correct output. A product that has to be seen working will find work to be seen doing.

**Forbids:** manufacturing work in order to stay active · a notification with no decision attached
to it · treating an empty offer as a failure to be tuned away · rendering a `sleeping` intention as
a problem, a warning, or an empty state that asks to be filled.

**Half-enforced, and the enforced half is the useful one:** `src/domain/detection/grounds.ts` will
not let Propositum offer until **one** intent ground and **two** investment grounds have fired, and
`tests/grounds.test.ts` carries the case that matters most as a standing fixture — *an afternoon of
ordinary reading*, which must **not** qualify. A change that makes that fixture start qualifying has
broken this principle whatever else it improved. [ADR-0008](./adr/0008-ambient-detection.md) already
names the asymmetry: a missed offer costs a suggestion nobody sees, a false one asks somebody to read
and ratify a proposal about work they were not doing.

**The enforced half failed once, on 2026-08-17, and the way it failed is worth keeping.** The
standing fixture had been written at three pages while its own docstring recorded the session it
stood for as *twelve links across three sites*. A new investment ground then admitted the real
afternoon and not the fixture — twelve pages over three sites put four on some site by pigeonhole,
three put one — so the suite stayed green through exactly the regression it exists to catch. The
fixture is at twelve now. A fixture smaller than the session it records is not a smaller test, it is
a different one, and this principle is only as enforced as its fixture is honest.

~~**Honest limit:** the other half is enforced by nothing. The grounds threshold is a floor on *when*
Propositum may offer, not a ceiling on how often it may speak, and there is no metric anywhere that
would catch an offer rate creeping upward.~~ Notifications are the obvious place this erodes first,
because a notification is the cheapest thing to add and the hardest to attribute.

**Amended 2026-08-18 — the second sentence is still true and the third is not.** There is a metric
now, and it is three numbers rather than one, per
[`docs/research/intent-suggestion-quality.md`](./research/intent-suggestion-quality.md) §10.5:

| | |
|---|---|
| **Offers shown per hour of observed browsing** | GitHub's *completion-shown rate*, the thing they track beside acceptance. The denominator is counted at the ambient endpoint — minutes in which the extension had something to report while no session was running |
| **Decline rate** | Both "Not now" paths, the front door's per-strand one and the extension's per-origin one |
| **Strands detected but not shown** | What `MAX_THREADS_SHOWN` cut. [ADR-0008](./adr/0008-ambient-detection.md)'s own argument is that a strand found and discarded in silence is the failure the multi-strand change existed to remove, and the display bound was still doing exactly that |

`npm run eval -- --report` prints all three, with a per-day column beneath the totals — because a
creep is a change over time and a single total cannot show one. See [`EVALUATION.md`](./EVALUATION.md).

**What this does NOT do, said here rather than in a footnote, because a metric oversold is worse
than one missing.** It says how OFTEN Propositum spoke and nothing at all about whether it was right
to. There is no pass mark and it cannot fail a build: the only published calibration is per *session*
and this is per *hour*, and a threshold invented to bridge that would be a number nobody could
defend. It is zero until somebody actually uses the product. And the decline rate is an acceptance
rate turned around, which is the metric the research warns hardest against optimising — GitHub, in
their own words: *"being hyper-focused on a metric like acceptance rate can lead to experiences that
look good on paper, but do not result in happy developers."* Somebody reading the per-day column and
asking whether it is going up is the whole enforcement mechanism. That is weaker than a test, and it
is more than nothing, which is what the struck sentence describes.

**And it holds no subject, which is the design rather than a detail.** `offer_tally` is four integers
and a date. ADR-0008 refuses one specific durable row — *"a durable row saying 'Propositum thought
you were job-hunting' about an offer NOBODY ACCEPTED is exactly the profile this buffer refuses to
become"* — and every word of that refusal is about a subject. *"Four offers were shown in forty
observed minutes"* names nothing. There is no column a term, a signature, an origin, a title or a URL
could go in, and `tests/eval.test.ts` asserts the column list rather than trusting the intention.

*(The column-list assertion had to earn that sentence, 2026-08-18. It was titled *"exactly the five
columns"* and listed **six** — the sixth being an `updatedAt` instant that named when this person
last browsed. A test whose name says five and whose body blesses six reads, in a diff, as the guard
having been consulted. The field is gone, the assertion says five, and there is now a second one
saying the model holds no `DateTime` at all. The decision this table belongs to is
[ADR-0015](./adr/0015-measuring-loudness-and-saving-an-afternoon.md), which also records what has no
answer yet: nothing in the product deletes this table.)*

**It eroded there on 2026-08-17, exactly as predicted, and the path is worth naming.** Showing three
strands on the front door was a screen change and interrupted nobody; composing an offer for all
three, which arrived with it, was not — a composed offer is what the poll returns as
`kind: 'work-offer'` and what the extension turns into a `requireInteraction` notification, so a
strand that had never been advertised was arriving ready to interrupt. Nothing failed. No test went
red, no rate was measured, and the sentence estimating the cost said *usually no offer* while two of
three strands cleared the bar. Composing is gated on leadership now
([ADR-0008](./adr/0008-ambient-detection.md)), and what caught it was somebody reading the estimate
against the fixture — ~~which is the whole of the enforcement on this half.~~

*(That last clause is what the 2026-08-18 amendment above replaces. Would the offer rate have caught
this one? **Partly, and slowly.** The extra notifications were about strands that had never been
advertised, so each would have counted as an offer shown and the per-hour number would have gone up
on the day it landed. What the number would not have said is WHY — it names no subject and points at
no commit, so it is a smoke alarm rather than a diagnosis. Somebody reading the estimate against the
fixture is still how the cause gets found; the difference is that now something notices the smoke.)*

---

## 14. Models are workers, not the product

*(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md).)*

[`VISION.md`](./VISION.md) states this better than the request that prompted it: *"Most AI products
make the assistant the persistent thing and the conversation disposable. Propositum makes the work
persistent and the assistant disposable."* This principle is that sentence with edges on it.

**Forbids:** a named or persistent assistant · a personality, a voice, or any identity continuing
across runs · provider-specific vocabulary anywhere a person can read it — no model names, no
version numbers, no *agent* · an interface that could not swap the executor without a consumer-facing
change · defining what Propositum is worth by what the model underneath it can do.

**Enforced in part:** all eight model-calling places go through one `ModelClient`, so provider calls
never appear in UI or domain code; an `AgentRun` carries a `role` — *worker* or *reviewer* — and no
name; and the table below rules *spawn agent*, *orchestration* and *worker* out of consumer copy.

**Honest limit:** as of 2026-08-16 there is exactly one real implementation of that interface and one
fake. *Replaceable* is therefore proved by a test double, not by a second provider — which is a
weaker claim than it sounds, because a fake is written to fit the interface it is testing. This is
also the boundary of what may be built here: **a clean interface is permitted, a router is not.**
Choosing between providers by quality, cost or latency is out of scope and stays out.

**And it forbids one thing in the other direction:** treating stronger foundation models as a threat.
If a better model makes the worker better, this principle is working. What must not happen is a model
becoming the thing a person has a relationship with.

---

## 15. Learned trust may recommend; it may never grant

*(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md).)*

History is evidence about a person. It is not permission from them.

**Forbids:** acceptance history widening a permission · a dial that moves itself · an autonomy level
that drifts upward without a human act · a default computed from past behaviour and applied without
being shown · a recommendation rendered so that accepting it is indistinguishable from not reading it.

**The asymmetry is not new.** It is [ADR-0007](./adr/0007-stop-conditions.md)'s rule for models,
applied unchanged to history:

> A model may **never** widen what is permitted — it could grant.
> A model may **always** decline to proceed — it can only withhold.

Read *history* for *model* and nothing else has to change. Trust history may narrow autonomy on its
own; widening always needs a person. A false narrowing is annoying and a false widening is dangerous,
so the bias belongs on that side, exactly as it does for stop conditions.

**Enforced by nothing, because nothing learns yet.** No component reads acceptance history: the
verdict tables are append-only and have no reader, and `scoreH2` has no production caller. This
principle is being written *before* the first thing that learns, which is the only point at which a
rule like this is cheap — after, it is a migration. Until then it rests on discipline alone, and
discipline is what this file says erodes.

[`VISION.md`](./VISION.md)'s *Adaptive autonomy* **Later** section got here first and says it more
strongly: the widening must be "a visible, revocable, human act". That is the version to build
against, and this entry is a promotion of it rather than an invention.

---

## Consumer language

The interface says what a person would say.

| Never | Instead |
|---|---|
| spawn agent, orchestration, worker | Propositum |
| tool call, execution trace | what I did |
| context window, token limit | *(never surfaced)* |
| inference confidence threshold | *"It looks like…"* / *"I couldn't work out…"* |
| session state | what I think you're working on |
| copy, working copy | *(nothing is copied — the `Changeset` is the copy)* |
| task | *(banned outright)* |
| approve / authorise (for an irreversible action) | *"Yes, do it"* — the human **confirms** |

**Four verbs, never interchangeable:** the gate **refuses** · the human **rejects** · the model
**declines** · the human **confirms**. Rejecting is a decision about work already held; confirming is
permission for something that has not happened and cannot be undone once it has.

Full list in [`CONTEXT.md`](../CONTEXT.md).
