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

Work lands as `ProposedChange`s against an immutable `BaseVersion`. Review produces **decisions,
never documents** — `materialise(base, changes, decisions)` is a pure fold, so nothing is committed
by the act of reviewing it.

**Forbids:** a worker that mutates a `DocumentVersion` · a `Changeset` applied without a
`ChangeVerdict` · any `DocumentVersion` that exists without a human having authorized it.

---

## 6. Autonomy is the person's to set, and every dial must bite

Four dials: Initiative, Progress, Output, Budget. Each compiles to something the gate evaluates.

**Forbids:** a control that changes only prompt wording · a free-text "stop and ask me when…" field
(users read typed sentences as hard limits, and it cannot be one) · exposing recursion depth, agent
counts, temperatures, or token limits · a cost dial the product cannot honour.

**The test for any new control:** name the deterministic check it compiles to. If there isn't one,
it is theatre — the reason "Suggestions only" became a real permission rather than a display mode.

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

## 9. Every change is reversible

The base is immutable for the whole review. Nothing Propositum does is hard to undo.

**Forbids:** in-place edits · deleting anything the person created · any action outside the
`ActionKind` enum — capabilities the brief excludes are **absent from the enum entirely** rather
than denied by a rule. Absence of capability is the strongest prohibition available.

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
routine `ActionStatus` rather than the exception. Both are written down instead of smoothed over.

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

Full list in [`CONTEXT.md`](../CONTEXT.md).
