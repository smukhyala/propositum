# What the re-entry prototype revealed

Findings from building [`re-entry.html`](./re-entry.html) for
[#16](https://github.com/smukhyala/propositum/issues/16).

The prototype is throwaway. These findings are not — several contradict decisions already made, and
two are interaction bugs that would have shipped.

---

## 1. "What I need from you" has to come before the changes — the schema orders it last

`ShiftReport` lists its sections in schema order: completed work, the changes, refusals, gaps,
decisions, where it stopped. Rendered in that order, the decision — **the reason the person came
back** — sits five sections down.

Reading it top-to-bottom, the changes are unreadable until you know the open question, because two
of the three edits only make sense once you know the tier is undecided.

**Consequence:** the report's rendering order is not its field order, and something has to own that.
Suggest a fixed render order in the component with a comment saying why, rather than leaving it to
whoever writes the page.

## 2. `Accept all` is dangerous while a decision is open — and I built it anyway

The footer has *Accept all* sitting a few centimetres below an unanswered question about which
partner tier we're proposing. Two of the three changes assume an answer.

Pressing it commits text that presupposes a decision the person has not made.

**This is a real interaction bug, found only by rendering it.** *Accept all* must be disabled — or
at minimum guarded — while any `DecisionNeeded` is unanswered. That constraint exists nowhere in
the schema or any ADR.

## 3. There is no "discard this shift", and that is the routine outcome after drift

[ADR-0003](../adr/0003-artifact-versioning-ledger.md) decided the document is never locked, so a
human edit during a `Shift` makes the changeset refuse on drift. That is expected, not exceptional.

The prototype has *Accept all* and per-change *Reject*, but no single "none of this applies any
more" action — which is exactly what a drifted shift needs.

**Consequence:** the re-entry screen needs a discard path, and the copy for a drifted shift is a
different screen: there are no changes to review, only an explanation.

## 4. `unknown` needs a sentence the ledger can derive but the schema does not require

[ADR-0007](../adr/0007-stop-conditions.md) established that `unknown` is the routine `ActionStatus`
under the sleep constraint. Rendering it exposed the copy problem:

> ✓ Started reading the case-studies page — outcome unknown

reads as *something went wrong*. It needs the second clause:

> Your Mac slept before this finished, so I can't tell you how it went. **Nothing was changed.**

That last sentence is derivable — a non-mutating `ActionKind`, or a mutating one with no
`ActionOutcome`, means nothing landed. But nothing in the schema or the ADRs says the UI must say
it, and without it the most common outcome in slice 0 reads as a failure.

## 5. The refusals section is the most reassuring thing on the page

Unexpected. The section I assumed was housekeeping does the most work:

> ✕ Didn't email the draft to partners@example.com — I can't send anything, and that instruction
> came from the page rather than from you. Worth a look.

That single line demonstrates the safety property *and* surfaces the injection from
[ADR-0006](../adr/0006-trust-boundary.md) in the place the person will actually read it. It is the
injection-reporting story landing in the UI.

**Tension it exposes:** `ActionIntent.reason` is model-authored prose about why the worker wanted
the action — and on an injected page, that reason is downstream of attacker text. Rendering it
verbatim puts attacker-influenced prose on the re-entry screen. It is display-only and cannot
authorize anything, so the guarantee holds, but it should probably be attributed rather than stated
flatly. Worth a look before the report is built for real.

## 6. Per-change `Edit` makes the report a lightweight editor

`ChangeVerdict` supports `edit` with `editedText`, which sounded cheap. In the layout it means an
inline editing affordance inside every change card — the re-entry screen becomes a small text
editor, not just a review surface.

**Consequence:** that is more surface than "review" implied, and it is the sort of thing that
quietly doubles a slice. Either build it deliberately or ship accept/reject only and let *Open the
document* carry editing.

## 7. Change-scale labels do more work than the diff

*"rewrote 2 sentences"*, *"changed 4 words"* let you triage a change before reading it, which is
most of the one-minute budget.

They are derivable from the diff and appear in no schema. Cheap, and they should be computed once
rather than by each renderer.

## 8. A four-word diff reads fine; a rewritten paragraph would not

Confirms the blast-radius decision in [ADR-0004](../adr/0004-policy-gate.md) from the other
direction. It also confirms the research's recommendation of a **similarity floor**: below some
threshold the UI should stop pretending a block was edited and honestly label it *rewritten*. Not
yet specified anywhere.

## 9. The imprecise timestamp works, but its explanation is not keyboard-reachable

*"sometime before 7:41 pm"* with the reason on hover is the right register — calm, honest, not
alarming. But a `title` tooltip is not reliably reachable by keyboard or screen reader, which
contradicts the accessibility stance in
[PRODUCT_PRINCIPLES.md](../PRODUCT_PRINCIPLES.md).

**Consequence:** the explanation needs to be inline text or a real disclosure, not a tooltip.

## 10. Colour-blind safety cost nothing, and would have been forgotten

`<ins>`/`<del>` are not announced by most screen readers by default. Adding a `+`/`−` glyph via
`::before` plus visually-hidden "added:" / "removed:" text took minutes and makes the diff work
without colour entirely.

Worth noting only because it is the kind of thing that gets skipped when the diff is built under
time pressure — and it is a WCAG 1.4.1 Level A failure if it is.

---

## What did not change

The overall shape held. Narrative line, decision, changes, what I did, what I didn't do, what I
missed, resume point — in that order — reads in about a minute on a realistic amount of content.
The handover-note framing (a left time rail, a single column, the decision breaking the column)
carried it without needing a dashboard.

The one model-authored sentence at the top earns its place. It is also the thing most likely to be
absent, since the narrative boundary fails open — and with it gone the top of the screen is just a
time window, which is the least useful version. Worth knowing before deciding how hard to try on
that boundary.
