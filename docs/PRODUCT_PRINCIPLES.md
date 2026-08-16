# Product principles

~~Ten principles.~~ **Fifteen, as of 2026-08-16.** The header said ten while eleven were present:
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

**Honest limit:** the other half is enforced by nothing. The grounds threshold is a floor on *when*
Propositum may offer, not a ceiling on how often it may speak, and there is no metric anywhere that
would catch an offer rate creeping upward. Notifications are the obvious place this erodes first,
because a notification is the cheapest thing to add and the hardest to attribute.

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
