# Product principles

Ten principles. Each states what it **forbids concretely**, because a principle that rules nothing
out is decoration.

Where a principle is already enforced by a type, a schema, or a test, that enforcement is named.
Where it currently rests on discipline alone, that is said plainly — those are the ones that erode.

---

## 1. Preserve intention, not activity

A replay of what someone clicked is worthless. What matters is where they were going.

**Forbids:** storing raw interaction streams for their own sake · a `ShiftReport` that recounts
steps instead of stating outcomes · a `SessionReading` that summarises the timeline rather than
interpreting it.

**Test:** if a `SessionReading` reads like a narrated log, it has failed even when every fact in it
is correct.

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
