# ADR-0016 — The everyday-computing direction, and the four refusals it does not move

**Status:** accepted · 2026-08-20
**Source:** [`docs/superpowers/specs/2026-08-20-everyday-intelligence-direction-source.md`](../superpowers/specs/2026-08-20-everyday-intelligence-direction-source.md),
archived verbatim the day it arrived, by the same rule that archived the 2026-08-16 one: a direction
document that exists only in somebody's message gets remembered as whatever the last reader thought
it said
**Supersedes, in part:** the 2026-08-16 direction document's §10 stage framing — the _first
workflows_ are no longer research-and-draft alone. **Its §8 do-not-build list is otherwise unchanged
and still binding**, and the four items below say so individually rather than by reference
**Amends:** [`docs/MVP.md`](../MVP.md) _Primary use case_ · [`docs/VISION.md`](../VISION.md) _The
problem_ · [`docs/ROADMAP.md`](../ROADMAP.md) Stage 1
**Depends on:** [ADR-0011](0011-intention-above-worksession.md) — the Intention is the durable
object, and it is human-ratified · [ADR-0008](0008-ambient-detection.md) — watching is continuous,
offering is deterministic, and starting is a human act

---

## What this direction actually asks for that the repository does not already do

The document is long and most of it describes something this repository has. Ambient observation,
deterministic detection, a composed offer, one-click acceptance, a gated run, a re-entry note and
per-unit verdicts are all built and all reachable. Reading the document against the code rather than
against the ambition, **four things are missing**, and they are the whole content of this decision:

1. **The first workflows are the wrong shape.** `MVP.md`'s primary use case is a partnership
   proposal — research-and-draft knowledge work, which is precisely the _"Silicon Valley version of
   knowledge work"_ the direction document says to design past. Worse than absent: shopping and
   comparison are currently named in `src/domain/detection/grounds.ts` as this design's **residual
   false positives**. The direction asks for them as targets.
2. **Nothing shows what previous sittings decided.** `carryOnCandidate` carries the `Project` — the
   approved sources and the document — and its own docblock says what it does not carry: _"No
   objective, no reading, no claim."_ The direction's flagship example is three evenings of trip
   planning that Propositum recognises as one thing. Today the second evening sees a project with a
   count of sittings on it.
3. **The acting path has no middle.** Both ends of ADR-0010's channel are built and
   `tests/reachability.test.ts` pins `createBrowserControl(` at zero callers. _"Browsing-to-action
   workflows"_ is one of the five first environments the direction names, and it is the one the
   repository can currently only describe.
4. **Nothing has a number.** `eval-scores.json` is the blank worksheet from 2026-08-07. The
   direction's central question — _can Propositum observe ordinary computer activity, correctly
   understand the task, and proactively offer something useful without requiring a prompt_ — is
   `MVP.md`'s H1 and H2 asked in other words, and neither has been scored.

**Slice 1 is those four and nothing else.** Everything below is what this ADR declines to take from a
document that asks for considerably more.

## The four refusals this direction does not move

Each is written out rather than pointed at, because a refusal held by a cross-reference is a refusal
the next reader has to go and look up, and the one who does not look it up is the one who overturns
it.

### 1. Observation does not leave Chrome yet, and screen capture is still refused outright

The direction asks for _"the active application, browser pages, selected text, files being viewed or
edited, application transitions, searches, downloads, clipboard events"_. That is a desktop sensor.
[`VISION.md`](../VISION.md) files _"Automatic access to every application"_ under **Not planned, at
any horizon**, and [ADR-0012](0012-screen-capture-refused.md) refused a rolling screenshot cache on
2026-08-17 with the argument that bullet had been carrying without.

**Nothing here reopens either.** The sequencing decision taken with this ADR is Chrome first, in the
product owner's own words on 2026-08-20: _fully functional in Chrome, then expand_. What "fully
functional" buys in slice 1 is **consuming everything the sensor already collects** and **letting a
run act through it** — not more surface.

ADR-0012's _Revisit when_ names its own trap and this document walks into none of it: _"A desktop
process is built for some other reason. Once a native helper exists, the marginal cost of a capture
loop looks small."_ No native helper is built here. When one is proposed, that ADR is the document to
reopen, and the frontmost-application question arrives **unbundled** from screen capture, exactly as
its last bullet asks.

### 2. Two free Chrome permissions are refused, and the refusal has a trigger rather than a horizon

This is the one refusal that is uncomfortable, so it gets the most argument.

[`docs/research/intent-signals.md`](../research/intent-signals.md) §3 ranks `chrome.tabs` events and
`query` at **row 1 of 16** — _"**nothing.** No permission, no warning, no manifest change"_ — and
`webNavigation`'s `transitionType` at row 4, also with no new warning. Row 1 buys the defect that
`content.js` and `visitsByUrl` both document and cannot fix. On a pure cost-benefit reading, taking
both is free money, and the honest reason for not taking them is not cost.

It is that **[`docs/MVP.md`](../MVP.md) assumption 1 already fixed the trigger**:

> Revisit if H1 scores badly and ablation implicates navigation intent.

**H1 has never been scored.** Taking these now would be firing a revisit clause before the evidence
that triggers it exists — which is how a threshold set in advance becomes a threshold negotiated
afterwards, the exact failure `MVP.md`'s _Why the bar is set to be failed_ section exists to prevent.
Slice 1's W3 produces that number. If H1 scores badly and ablation implicates navigation intent, the
clause fires and these two get their ADR on the evidence.

`chrome.tabs` carries a second cost the other does not. Under the `https://*/*` grant ADR-0008 took,
`chrome.tabs.query()` returns the URL and title of **every open https tab**, and what keeps that from
happening is `tests/extension-permissions.test.ts` — _our code declining, not the browser refusing_,
as `VISION.md` was corrected to say on 2026-08-17. Reversing a refusal our own test holds is an ADR
either way. It does not get to arrive as a side effect of a detection improvement.

### 3. Nothing learns a threshold, and nothing routes a worker

The direction asks for two things this repository has already ruled on:

> Over time, Propositum should learn the user's personal intervention threshold.

[Principle 15](../PRODUCT_PRINCIPLES.md) — _learned trust may recommend; it may never grant_ — and
§8's _learned trust/autonomy models_ both stand. **Nothing in slice 1 reads acceptance history.**
Worth naming precisely, because there is a version of this that Principle 15's own asymmetry would
permit: history may **narrow** on its own and may never **widen**, so a policy that can only raise
the bar for speaking is inside the rule. That version is a real design and it is **not built here**,
by scope decision on 2026-08-20. `OfferTally` keeps counting and nothing reads it to decide anything.

> Propositum should dynamically assemble the best execution environment for the objective.

That is the Worker Router. [ADR-0005](0005-model-boundary.md) closed on _"A second provider is
genuinely required. The interface allows it; nothing else should"_, §8 lists multi-provider routing
under do-not-build, and [`ARCHITECTURE.md`](../ARCHITECTURE.md) layer 6 says _"Nothing owns this
layer, and that is a decision rather than a gap."_ Unchanged. `ModelClient` over a `ModelBoundary`
with two implementations is the whole of what _"models should remain interchangeable"_ asks for, and
it is met.

### 4. The Intention stays human-ratified, and stays one per Project

The direction says _"Projects emerge without the user manually creating them"_ — already true, and
[ADR-0009](0009-composed-offers.md) decided it: a human never creates a `Project`. It also says
Propositum should understand _"what decisions have already been made"_ across evenings, which reads
as inference writing durable state.

[ADR-0017](0017-continuing-an-intention.md) takes that requirement and answers it **without** letting
inference near the row. The Intention remains what ADR-0011 made it. Multi-intention scheduling and
_"automatic multi-intention compute allocation"_ stay on §8's list and stay out of reach of the
schema: the unique index on `Intention.projectId` is the deferral held as a shape.

## What changes, in the documents

- `MVP.md`'s primary use case gains two everyday shapes beside the proposal — a product comparison
  and a planning thread — and gains them **as sealed eval scenarios**, which is the only way a use
  case in this repository means anything. They are not a second demo path.
- `ROADMAP.md`'s Stage 1 stops being complete-except-a-screen and becomes complete-except-resumption,
  which is what it always was; ADR-0017 is the thing that finishes it.
- `VISION.md`'s _Intention-preserving continuation_ has a **Later** half reading _"still does not
  recognise that today's work continues last week's without being told."_ Half of that moves.
- `ARCHITECTURE.md` layers 1, 3, 4, 7 and 9 get re-marked as the slice lands, by the wave that lands
  them, which is what that document asks for and did not get on its first pass.

## What was rejected, and why

- **Taking the whole document as a plan.** It names eleven systems — Observation Engine, Semantic
  Activity Engine, Cortex, Intent Engine, Frontier, Intervention Policy, Agent Orchestrator, Computer
  Runtime, Verification Layer, Permission Layer, Learning Layer. Nine of the eleven map onto layers
  `ARCHITECTURE.md` already names and marks, and naming a layer is not building one. Adding a second
  set of names for the same ten layers would give this repository two vocabularies for one
  architecture and no rule for which wins. **The layer names in the source document are not
  vocabulary and nothing is renamed after one**, on the same rule `ARCHITECTURE.md` states about its
  own.
- **Renaming anything to Cortex or Frontier.** They are the names of two other projects. The
  understanding layer here is `SessionReading` plus, now, `WorkSoFar`; the decision layer is
  `groundsFor` plus `composeOffer`. Both already have names that say what they do.
- **An intervention policy in this slice.** See refusal 3. It is the most interesting thing on the
  list and it is second in line behind knowing whether the offers are any good, which is H2.

## Revisit when

- **H1 has a number.** That is the trigger for refusal 2, and it is the only one of these four with a
  trigger rather than a boundary.
- **H2 fails.** `MVP.md` says what to do and it is not _tune the prompt_: the useful-progress window
  being empty is the outcome that stops the product rather than redirecting it. Widening domains
  before H2 has an answer is what this slice does; widening them again afterwards without one would
  be a different and worse decision.
- **A native helper is built for any reason.** ADR-0012 is the document to reopen, and this one is
  the record that its sequencing bullet was read rather than skipped.
- **Somebody proposes an intervention policy that only narrows.** It is inside Principle 15 and it is
  a real design. It needs its own ADR, and the reason it is not in this one is scope, not principle —
  so the next reader does not have to re-derive that it was allowed.
