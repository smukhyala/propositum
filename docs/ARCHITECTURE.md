# Architecture

The layers Propositum is organised into, each marked with what is actually built. Two words in the
layer names are already spoken for in this repository and must not be read the way they usually are:
**"worker"** here means a layer, not `AgentRun.role` (`worker | reviewer`) and not the `npm run
worker` process that drains the run table; and **"router"** in *Worker Router* has nothing to do with
Next.js routing — it means choosing which executor performs an action.

Every layer below carries **its own status marker**. There is no blanket caveat at the top, because a
blanket caveat is the thing a reader skips. Where a layer is unbuilt this document says **what would
have to exist first**, which is usually more informative than the layer's name.

Section references of the form **§8** point at the direction document these layer names come from,
archived verbatim at
[`docs/superpowers/specs/2026-08-16-direction-update-source.md`](./superpowers/specs/2026-08-16-direction-update-source.md).
§8 is its *do not build yet* list, and it is binding here — **less one entry, struck 2026-08-26 by
[ADR-0025](./adr/0025-computer-use-beyond-the-browser.md)**; see *Where computer use sits*.

**A second direction document arrived on 2026-08-20** and is archived beside it at
[`2026-08-20-everyday-intelligence-direction-source.md`](./superpowers/specs/2026-08-20-everyday-intelligence-direction-source.md).
It names eleven systems — Observation Engine, Semantic Activity Engine, Cortex, Intent Engine,
Frontier, Intervention Policy, Agent Orchestrator, Computer Runtime, Verification Layer, Permission
Layer, Learning Layer. **Nine of the eleven are the layers below under other names, and nothing is
renamed after one**, on the same rule the *Honest limits* section states about these ten:
organising words are not vocabulary. [ADR-0016](./adr/0016-everyday-computing-direction.md) records
which four of its requirements slice 1 takes and which it declines.

**Not one status cell below moved when those ADRs landed, and that is deliberate.** ADR-0016,
ADR-0017 and ADR-0018 are decisions; the code they authorise is not written as this paragraph is
added. The layer that gets built is re-marked **by the wave that builds it** — which is what the
*Self-correcting* note under Outcome / Learning asked for and did not get on its first pass. A
status cell moved in advance of the code is exactly the failure this column exists to prevent, and
it would be the easiest one to commit on the day three ADRs land at once.

**Three more landed on 2026-08-26 and not one cell moved for them either** — ADR-0024, ADR-0025 and
ADR-0026, re-marked here 2026-08-27. They decide that Propositum may buy inside a ratified
[`PurchaseAuthorization`](./adr/0024-purchases-within-a-ratified-authorisation.md), may
[drive macOS rather than one Chrome tab](./adr/0025-computer-use-beyond-the-browser.md), and may
[read a one-time code](./adr/0026-reading-a-one-time-code.md) out of `~/Library/Messages/chat.db`.
`grep -rn 'approvedApplications\|purchaseAuthorization' src/` returns nothing, so the column is
unchanged and correct. What was **not** correct is that four passages below stated the old bounds as
permanent rather than as current: **State Ingestion**, **Delegation / Policy**, **Execution Runtime**
and **Where computer use sits**. Each now carries the correction beside the claim. Read the ADRs for
what was decided and the code for what runs; where they disagree, the code is right.

---

## The thesis

**Propositum sits above models and agents.** Foundation models, browser agents, coding agents and
whatever comes next are workers beneath a control plane that owns intention state, delegation policy,
progress reasoning, provenance and human continuity. The bet in that sentence is directional: **better
foundation models should improve Propositum rather than replace it**, because none of what the control
plane owns is a capability a model can supply. A model cannot decide what you are permitted to
authorise, and it must not — that is [Principle 3](./PRODUCT_PRINCIPLES.md), and here it is enforced
as a compile error rather than a convention.

**The honest counterweight, first:** a control plane with one worker beneath it is a control plane in
name. Today Propositum has one sensor, one worker role, one reviewer role and one provider. The
architecture is shaped so a second of each is an addition rather than a rewrite. That is a claim about
seams, not about capability, and nothing below rounds it up.

---

## What these layers refine

The pipeline this repository was built as, which still describes what runs:

```
Observation → Session State → Handoff → Planning → Execution → Verification → Human Re-entry
```

That pipeline is **refined, not discarded**. It is one pass through the layers below, and it is the
only pass slice 0 makes:

| Pipeline stage | Layer it becomes |
|---|---|
| Observation | State Ingestion |
| Session State | State Reconciler (and, for one sitting, `SessionReading`) |
| Handoff | Delegation / Policy |
| Planning | Progress Reasoner |
| Execution | Execution Runtime |
| Verification | Verification |
| Human Re-entry | Re-entry |

Three layers have no stage above them — Intention Graph, Worker Router, Outcome / Learning — and that
is the actual shape of the change. **Intention Graph is the durable half of something the pipeline
only ever held for one sitting** — decided in ADR-0011 and, since 2026-08-16, a table, per §1 below. The other
two are new: one has data and no reader, and one is not being built.

---

## The ten layers

| Layer | Status | Owned today by |
|---|---|---|
| Intention Graph | **partial** — one flat table, no graph; ~~`intentionState()` computed and unrendered~~ *re-marked 2026-08-16:* the lifecycle word is on the front door; *re-marked 2026-08-20:* and what happened under an Intention is on two screens before the click | `Intention` in `prisma/schema.prisma`, `src/domain/intention/state.ts` ([ADR-0011](./adr/0011-intention-above-worksession.md)), `src/domain/intention/work-so-far.ts` ([ADR-0017](./adr/0017-continuing-an-intention.md)), `src/server/front-door.ts`, `src/server/work-so-far.ts`, `src/app/page.tsx` |
| State Ingestion | **partial** — one sensor, browser only | `ledger-writer.ts`, the MV3 extension |
| State Reconciler | **partial** — `matchProject` only | `src/domain/detection/match-project.ts` |
| Progress Reasoner | **partial** — offer grounds, no ranking | `src/domain/detection/grounds.ts` |
| Delegation / Policy | **built** | `compilePolicy` + the gate, ADR-0004/0006 |
| Worker Router | **unimplemented, and not being built** | — (§8 forbids; ADR-0005 agrees) |
| Execution Runtime | **built** | `runWorker`, ADR-0001/0010 |
| Verification | **built, and near-decorative** | `scopeVerdict` + reviewer |
| Outcome / Learning | ~~**data built, nothing reads it**~~ *re-marked 2026-08-16:* **read, and still learning nothing** | three verdict tables, append-only; `outcomes.trajectory()` + `scripts/eval.ts --report` |
| Re-entry | **built** | `ShiftReport`, ADR-0003 |

---

### 1. Intention Graph — **partial: one flat table, and *graph* is aspirational**

*For:* the persistent source of truth for what a person is trying to accomplish.

~~**Not built as this file lands, and here is the one-command check that says so:** `grep 'model
Intention' prisma/schema.prisma` returns nothing, which makes this layer a **decision and not yet a
table**.~~ **Re-marked 2026-08-16, in the commit that landed the schema, which is what the struck
sentence asked for.** The one-command check now reads the other way, and here is what it returns:
`grep 'model Intention' prisma/schema.prisma` → `model Intention {`, and
`grep -c intentionId prisma/schema.prisma` counts both foreign keys. So this layer is **a table, not
a graph, and not a screen**: the row exists, `intentionState()` exists in
`src/domain/intention/state.ts` and computes the five members from rows, and ~~**nothing renders
either** — `tests/reachability.test.ts`'s *deferred, and asserted as deferred* block pins that last
absence so it cannot be mistaken for wiring~~ **re-marked again 2026-08-16, in the wave that landed
the caller: it is a table, not a graph, and now also a screen.** `src/app/page.tsx` renders the
consumer label beside every row on the front door, derived by `frontDoorRow` in
`src/server/front-door.ts`, and the reachability claim moved out of *deferred, and asserted as
deferred* into *the safety machinery is reachable from the product* rather than being deleted. What
the pin cannot see is a state that is computed and then discarded — a mutation doing exactly that
kept the whole suite green — so `tests/front-door.test.ts` asserts the rendered word instead. The
check sits in the first line of the section rather
than below the claim it qualifies, because "the ADR says so", "the schema has it" and "a person can
see it" are three different things this document exists to keep apart, and a marker a reader meets
ten lines late has already done its damage.

**What [ADR-0011](./adr/0011-intention-above-worksession.md) authorises.** One mutable `Intention`
row: a desired outcome, a `definitionOfDone` shared with `StatedIntent` — `definitionOfSuccess` is
banned, one field name for one idea — and a lifecycle state that is computed rather than stored. It is
**human-ratified only** — created and edited by a person, never by the detector and never by a model
boundary. `SessionClaim{kind:'objective'}` is untouched by this: still per-sitting, still
model-inferred, still cold every time. Two nullable foreign keys attach work to it,
`WorkSession.intentionId` and `HandoffContract.intentionId`, so every existing row, fixture and test
keeps working with no backfill. **At most one Intention per Project**, for now. Scope for that slice
is [`MVP.md`](./MVP.md), which marks it *not yet built at the time of writing* in its own voice.

**Re-marked again 2026-08-20, in the wave that built `WorkSoFar`
([ADR-0017](./adr/0017-continuing-an-intention.md)) — which is what the *Self-correcting* note asks
for, and what the paragraph at the top of this file said the ADRs themselves had not earned.** What
landed is a **computed view and no schema at all**: `git diff --stat prisma/schema.prisma` is empty
for that change, deliberately, because a stored version of *what has already happened under this
Intention* is the thing ADR-0011 forbids and *computed* is therefore the property that makes it
legal rather than a preference about where state lives. `src/domain/intention/work-so-far.ts` folds
it from rows a person wrote, approved, accepted or rejected; `src/persistence/repositories/index.ts`
gathers the rows; `src/server/work-so-far.ts` converts them once for every reader; and it renders on
the accept screen **before the click that starts the sitting** and on the project screen. It also
chooses which words the agreement screen pre-fills, and `ContractDrafted` now carries **when those
words were written** — the one thing `CONTEXT.md`'s `IntentionState` entry still listed as owed.

**What that does NOT move the marker for.** There is still no graph and still one Intention per
Project, which are the two things *partial* names, so the cell above says *partial* still. This is
the layer's third re-marking and none of the three has been about the word that qualifies it.

**Not authorised either, and not on the way.** Subgoals, dependencies, artifacts, people and decisions
as nodes. More than one Intention per Project. Any edge that is not one of those two foreign keys.
`WorkSoFar` reaching `compilePolicy`, the gate, or a prompt — it **may inform a person and may not
inform a decision**, the same posture a `BusyInterval` has under
[ADR-0014](./adr/0014-reading-free-busy.md), and `tests/work-so-far-scope.test.ts` is the guard.

**The word *graph* is aspirational here and is kept only so this document and the direction it came
from can be read side by side.** Two nullable foreign keys pointing at one row are a table, which is
now literally what exists. Calling it a graph would be the single easiest inflation in this file to
commit and the hardest to notice — and calling it **built** now that the schema has it is the second
easiest, which is why the marker above says *partial* and names the two things still missing rather
than the one that landed.

*What would have to exist first:* a second Intention per Project, and something that can create an
edge between two of them. Neither exists, and direction §8 forbids the generalised graph
infrastructure that would motivate them.

---

### 2. State Ingestion — **partial: one sensor, browser only**

*For:* accepting observations, external events, user input and worker results.

**Built.** One sensor. The Chrome MV3 extension in [`extension/`](../extension/)
([ADR-0002](./adr/0002-observation-capture.md), permission model amended by
[ADR-0008](./adr/0008-ambient-detection.md)) posts raw signals; `src/server/capture-adapter.ts`
classifies them deterministically; `createLedgerWriter` in `src/persistence/ledger-writer.ts` appends
`ObservationEvent`s with a gapless ledger-assigned `seq`. Values Chrome or Propositum asserted travel
in `attested`; anything a page could have authored travels in `untrusted`, carried structurally rather
than by a per-field flag.

**Not built.** Email, calendar, Slack, GitHub, Notion, docs, local files, and every other event source
the direction document lists. ~~All of it is on §8's do-not-build list.~~ **Corrected 2026-08-27: all
of it but one file, and one pair of per-turn observations.**
[ADR-0026](./adr/0026-reading-a-one-time-code.md) admits a single read-only reader over
`~/Library/Messages/chat.db`, called only while a run is parked waiting for a code;
[ADR-0025](./adr/0025-computer-use-beyond-the-browser.md) adds a screenshot and an `AXUIElement` tree
as observations, both untrusted. **Neither is written** — `grep -rn 'chat\.db' src/ --include='*.ts'`
returns nothing — so *one sensor, browser only* is still the true status and the cell has not moved.
*(2026-09-01: [ADR-0029](./adr/0029-the-mailbox-and-a-calendar-of-our-own.md) does not move it
either — the mail it decides is verbs inside a ratified run, not a sensor: no watch, no event,
nothing persisted, and the unsubscribe sweep's header read carries the same never-persisted posture
a `BusyInterval` has. Also unbuilt.)*

*(2026-09-03: [ADR-0033](./adr/0033-a-late-tick-is-a-slept-machine.md) does not move it either.
The gap watch now reads the lateness of its own tick, which makes `machine_slept` writable — but it
observes nothing about the person or the machine and can only ever produce an absence of knowledge,
so it is a second **signal** and not a second sensor. Built, and the cell has not moved.)*

**The structural fact that makes this hard to change by accident.**
`ObservationEvent.sessionId` is **required** in `prisma/schema.prisma`, its relation to `WorkSession`
is non-nullable, and `createLedgerWriter` is the only thing in the repository that calls
`observationEvent.create`. So **no event outside a sitting can be persisted at all.** `ExternalEvent`
is not merely unbuilt — there is nowhere to put one. That is worth stating precisely because it means
event ingestion cannot arrive by accident, and it is also the reason `waiting` is absent from the
lifecycle union (below).

*What would have to exist first:* either a second ledger writer or a nullable `sessionId`. Both are
schema changes that need an argument attached, not an afternoon of wiring.

---

### 3. State Reconciler — **partial: `matchProject` only**

*For:* deciding which intentions changed, resolving conflicting evidence, preserving provenance.

**Built.** `matchProject` in `src/domain/detection/match-project.ts`, called from
`src/server/actions.ts`: term overlap against existing projects, at `SHARED_TERMS_FOR_MATCH = 2` and
`SHARED_SHARE_FOR_MATCH = 0.6`. Deterministic, no model call. It is what files a new sitting under a
`Project` that already exists.

**Not built.** Conflict resolution, because there is only one source of evidence to conflict. **A
reconciler with one input is a matcher**, and this one is named for what it will be rather than what
it does. Provenance is preserved, but by the append-only ledger and by `Evidence` rows, not by this
layer.

One trap for whoever builds the rest: `signatureOf(terms)` in `src/server/ambient-store.ts` is
documented flapping A→B→A across three polls while keying six things, including the durable
`WorkOffer.threadSignature`. An Intention's identity is derived independently of it.

*What would have to exist first:* a second sensor.

---

### 4. Progress Reasoner — **partial: offer grounds, no ranking**

*For:* deciding whether useful progress is possible, and generating candidate next actions.

**Built.** Direction §2's Opportunity-to-Help Detection, deterministically and with no model in the
decision. `groundsFor` in `src/domain/detection/grounds.ts` requires `INTENT_REQUIRED = 1` intent
ground and `INVESTMENT_REQUIRED = 2` investment grounds before Propositum may offer to *do* anything,
a strictly higher bar than `detectWork`'s bar for *saying* anything
([ADR-0009](./adr/0009-composed-offers.md)). §2's *do not invent work simply to remain active* clause
is what this bar enforces, and a regression fixture of an ordinary afternoon of reading must **not**
clear it. `src/server/compose-offer.ts` composes the offer off the request path, and a failure there
is a normal outcome rather than an error.

**Not built.** Ranking. There is no expected-progress estimate, no cost, no risk, no uncertainty, and
no dependency effects — the five things direction §3 asks this layer to represent. There is one
candidate action at a time, so nothing sorts.

*What would have to exist first:* more than one candidate.

---

### 5. Delegation / Policy — **built**

*For:* combining agreements, permissions, trust history, budgets, risk and stop conditions into
something that decides.

**Built.** `compilePolicy` in `src/domain/handoff/policy.ts` turns the four autonomy dials and a
`ContractScope` into an `EnforcedPolicy`; `authorize` in `src/policy/gate.ts` is the only construction
site for an `AuthorizedAction`, and `tests/architecture.test.ts` holds it to that by grepping the
source. Stop conditions are structural ([ADR-0007](./adr/0007-stop-conditions.md)) — **though the
worker no longer counts every completed action towards one: amended 2026-09-01, an action that
changed nothing does not count towards `no-progress` where the compiled policy permits nothing that
could have changed anything, because it was capping a research-only *document* run at three reads.
Questions, refusals and failures count either way, and the browser path was never affected.** The
trust boundary
is [ADR-0006](./adr/0006-trust-boundary.md); the gate is [ADR-0004](./adr/0004-policy-gate.md).

**"Models never authorize" is a compile error here, not a review note.** `compilePolicy`'s parameter
types are constructed so they cannot receive prose, and the `@ts-expect-error` directives in
`tests/policy-gate.type-test.ts` fail `npm run typecheck` the moment a line they guard becomes legal.
That file ends in `-test.ts` rather than `.test.ts`, so vitest never runs it — **`npm run typecheck`
is the assertion.** Neither command is a superset of the other.

**Not built: two fields decided 2026-08-26** *(a third, 2026-09-01)*. `ContractScope` gains
`purchaseAuthorization`
([ADR-0024](./adr/0024-purchases-within-a-ratified-authorisation.md)), `approvedApplications`
([ADR-0025](./adr/0025-computer-use-beyond-the-browser.md)) and `sendAuthorization`
([ADR-0029](./adr/0029-the-mailbox-and-a-calendar-of-our-own.md)). All are optional and **absence is
the deny**; none exists in `src/` or `prisma/`, and `CONTEXT.md` carries the entries behind its
*specification rather than a description* fence. The second replaces the bound ADR-0010 had, and it
is weaker — that one was Chrome refusing, this one is our code remembering. The third shares that
weakness and names it: a first-party API call has no paused request for Chrome to attest, so what
decides is our own typed call before and a read-after-write proof behind.

**Not built: the durable half.** Every policy today is per-handoff and dies with its
`HandoffContract`. `WorkingAgreement` — a standing agreement that outlives a handoff — is a
**reserved name with no object behind it**: reserved in `CONTEXT.md` so it is not spent a third time,
deferred because §8 puts standing agreements and learned trust models on the do-not-build list.
`HandoffContract` keeps *Working agreement* as its consumer label and **no UI copy changes**. Nothing
accumulates trust; nothing recommends autonomy.

*What would have to exist first:* a policy object with a lifetime longer than one contract, and an
argument for how a person sees and revokes it. The name is the easy part and is already spent twice.

---

### 6. Worker Router — **unimplemented, and not being built**

*For:* choosing a human, a model, a specialised agent, an API, a browser worker or a computer-use
worker for the next action.

**Nothing owns this layer, and that is a decision rather than a gap.** Two independent sources say so.
Direction §8 lists *multi-provider quality/cost routing beyond clean interfaces* under do-not-build.
And [ADR-0005](./adr/0005-model-boundary.md) closed, in its own *Revisit when* section, on:

> A second provider is genuinely required. The interface allows it; nothing else should.

**What exists instead, and it is all §8 asks for.** `ModelClient` in `src/model/client.ts` is a
one-method interface over a `ModelBoundary`; `src/model/anthropic.ts` and `src/model/fake.ts` are two
implementations of it. That is the *keep model/provider interfaces abstract and workers replaceable*
clause, met. It is not a router and must not be described as one.

*What would have to exist first:* a second provider somebody actually needs. Routing without one is a
switch statement with a single arm and a name that promises more than the code does.

Read **"router" as executor selection**, never as Next.js routing. The Next.js routes in `src/app/`
are unrelated to this layer.

---

### 7. Execution Runtime — **built**

*For:* performing bounded work through the highest-level tool available.

**Built.** `runWorker` in `src/runtime/worker-loop.ts`, drained by a separate process — `npm run
worker` → `scripts/worker.ts` → `src/runtime/worker-process.ts` — under a renewed lease, because Node
never kills its children and orphans are the default rather than the edge
([ADR-0001](./adr/0001-worker-runtime.md)). `src/server/execute-run.ts` turns a `WorkerResult` into
rows. One worker `AgentRun` and one reviewer `AgentRun` inside one `Shift`. Research is confined to
`ApprovedSource`s by `allowlisted()` in `src/policy/fetcher.ts`.

**Built, and reachable since 2026-08-20.** The browser-acting path from
[ADR-0010](./adr/0010-acting-in-the-browser.md) had both ends and no middle: the five `/api/act/*`
routes were live, `createBrowserControl` in `src/runtime/browser-control.ts` was the client, and no
run constructed one. `src/server/execute-run.ts` now does, for a run whose ratified contract grants a
kind that needs a live page under it and whose row holds a control token. The construction is
**conditional and must stay so** — handing every drafting run a debugger attachment it never uses is
a capability granted by tidiness, which is what `WorkerDeps.browser` being optional is for.

A contract can grant one because `grantableActionKinds` now decides by the one fact that separates the
two shifts: a shift that pins a document grants the document verbs, and a shift that does not grants
the browser six. The second branch used to grant `[]` — a ratified agreement permitting nothing, which
an accepted `WorkOffer` not expecting `document-changes` reached in production.

**`ConfirmationRequest` can now occur**, which is the half of ADR-0010 that had never run. The gate
refuses `confirmation_required` and stays two-armed; the loop reports which intent it was refused on;
`execute-run.ts` writes a **code-generated** question — `src/domain/execution/confirmation-question.ts`,
pure, no model prose — and parks the run `awaiting-confirmation`. **One pause per run**, because
`creditedDeadlineFor` sums `(requestedAt, decidedAt)` pairs and overlapping pauses would credit the
same wait twice.

~~**`LANDING_ACTION_KINDS` is still empty and still pinned**…~~ **Built 2026-09-01 — ADR-0024's
build landed and the set holds `complete-purchase`.** The transport is permit-conditional now:
`classifyPausedRequest` still fails every non-`GET` that arrives without a one-shot landing permit —
a ratified `PurchaseAuthorization` arms one per `complete-purchase` command, and it releases exactly
one covered request at or under the ceiling, in the ratified currency, at the exact origin —
**and, since 2026-09-03 (#147), only where Chrome reports the tab itself navigating, which is the
whole of the attribution `Fetch.requestPaused` can support.** One
`external-effect` outcome kind can occur, and only that one. What stays surprising and true: **a
confirmed click whose page posts still fails** — the permit is not a confirmation and a confirmation
is not a permit; the two mechanisms never traded jobs.

~~**That is still what runs, and it is no longer what was decided.** … **Nothing of it is built**~~
**The gap closed on 2026-09-01, by the alarm's own script:** the *"Buy anything"* guard and the
reachability pin both went red on the commit that moved the branch, and both were deliberately
updated in it — the guard now confines the promise to the no-authorisation arm and the refusal to
the no-permit arm. What has NOT happened is the live purchase:
[`docs/todo/06-buying-things.md`](./todo/06-buying-things.md) keeps its *Done when* open on a real
charge, made and refunded, with the owner's card and a low ceiling.

**Honest limit: every mutating browser action asks.** `RunContext.targetEvidence` has no supplier, so
the classifier escalates every `click-element`, `type-text` and `press-key`. That is the cautious
state by construction rather than by care, and the extraction that would quieten it is deliberately
not wired — it is the mechanism that *removes* confirmations, and it belongs to the unit that owns the
snapshot map.

---

### 8. Verification — **built, and near-decorative**

*For:* checking whether the intended state change occurred and scope was respected.

**Built: the deterministic half.** `ActionOutcome.scopeVerdict` — `within_scope | out_of_scope |
unverified` — is written from deterministic fields in `src/runtime/worker-loop.ts` and
`src/server/execute-run.ts`. The reviewer `AgentRun` runs after the worker reaches a terminal status,
via `reviewBoundary` in `src/model/boundaries/review.ts`, and its failure is swallowed so the
`ShiftReport` still renders.

**Honest limit: `ReviewFinding` currently has no effect.** It cannot block a change, fail a run, or
grant anything — [ADR-0004](./adr/0004-policy-gate.md) says the reviewer is close to decorative and
[`MVP.md`](./MVP.md) assumption 4 says the same and has not yet been answered. Its most plausible
check is the one it cannot make: `sourcesRead` is empty and stays empty until something retains
fetched page text, so it can judge internal support and vagueness and **cannot compare a draft against
the source it cites**.

~~**Honest limit: outcome-scoped findings are written and never shown.** A finding citing a whole
production is stored with `outcomeId` set and `changeId` null, and the only reader on the re-entry
screen joins through `changeId`. `findings.forRun` is pinned at zero callers in the deferred block.~~
**Struck 2026-08-27.** The shift page reads `findings.forRun`, and the outcome card renders what it
returns under the same *"A second pass flagged this"* heading the per-change block uses. The pin has
moved into the reachable section and now asserts the opposite.

**Honest limit: `unverified` is the routine value.** Under the "leave your desk, not the building"
constraint a local worker stops when the Mac sleeps, so an effect that landed with no check after it
is ordinary rather than exceptional. A browser-driving run adds a second routine source of it: every
channel failure is recorded `unverified`, and `not-reported` means the instruction reached a browser
and may have run.

**Honest limit: a paused run is not reviewed.** A run that stops for a confirmation records its
outcomes and skips the reviewer; the continuation reviews its own. Since `ReviewFinding` cannot block
a change, fail a run or grant anything, what is lost is advice on the outcomes that leg produced —
recorded in ADR-0010's amendment rather than left to be discovered.

**Newly verified rather than assumed: losing the browser is a stop.** `controlLost` reaches
`evaluateStructuralStops`, so a closed tab ends the run as `control-lost` — *"I lost the tab I was
working in."* Before this it kept proposing into a dead channel until three consecutive failures
tripped `no-progress` and the person read that it had been going in circles.

*What would have to exist first for this layer to be load-bearing:* a finding that can hold a change,
which is a permission question and not a prompt question, and re-fetching so the reviewer can read
what the worker read.

---

### 9. Outcome / Learning — ~~**data built, nothing reads it**~~ *re-marked 2026-08-20:* **read, and still learning nothing**

*For:* recording accepted, edited, rejected, blocked and reverted outcomes as a feedback trajectory.

**The re-mark this heading was owed on 2026-08-16, and got four days late.** The wave that gave this
layer a reader corrected the status cell above and the body below and stepped over the heading
sitting between them. The heading now carries what the cell carries, word for word, because a
ten-layer status document is read by scanning headings — this file says so at the top, *"a blanket
caveat is the thing a reader skips"* — and this was the only one of the ten whose heading disagreed
with its own cell. The reader is `scripts/eval.ts --report`, reachable as `npm run eval`:
`outcomes.trajectory()` reads every decidable unit and `contracts.barrenShifts()` reads the Shifts
that produced none. *Still learning nothing* is the part that did not move, and §8 forbids the thing
that would.

**Built: the recording.** Three verdict tables, all append-only with triggers listed in
`REQUIRED_GUARDS` in `src/persistence/append-only.ts` and reinstalled and verified at every startup —
`ChangeVerdict` (per proposed change), `OutcomeVerdict` (per held production), `ConfirmationVerdict`
(per irreversible action a person authorised). What a person accepted or rejected cannot be rewritten.

~~**Two of the three can be written today, not three.** `confirmations.create` is pinned at zero callers
in `tests/reachability.test.ts`, so no `ConfirmationRequest` is ever raised and therefore no
`ConfirmationVerdict` can exist. The deterministic rule that would raise one is written and no dial
can switch it off; nothing has yet asked it a question.~~ **Re-marked 2026-08-20, in the wave that
gave the gate a reason to stop: all three can be written.** `confirmations.create` has a caller, a
`ConfirmationRequest` is raised, and a `ConfirmationVerdict` can therefore exist — so the third
verdict table stops being a table nothing could fill.

**The unstruck sentence is the one that mattered, and it is still exactly right:** that is the pin's
exact purpose — a rule nothing raises is a rule that never fires, and it is invisible in a green
suite. It was pinned for that reason and the pin is what went red. Kept unstruck because the
argument outlives the fact it was attached to, which is the difference between a status marker and a
reason.

~~**Not built: any reader.** Two specific holes, both named rather than summarised:~~ **Both closed
2026-08-16, and re-marked here in the wave that closed them — which is what the *Self-correcting*
note below asked for and did not get on the first pass.**

- ~~`scoreH2` and `H2Tally` in `src/eval/score.ts` have **no production caller** — only
  `tests/eval.test.ts`. The MVP's own H2 acceptance metric is therefore not currently computable from
  the database, which is a sharper statement than "H2 is unscored".~~ `scripts/eval.ts --report` now
  computes it: `outcomes.trajectory()` reads every decidable unit, `contracts.barrenShifts()` reads
  the Shifts that produced none, and `tallyH2`/`reportH2`/`scoreH2` fold them. **What is still owed
  is not a reader but an answer:** the trajectory reports zero decidable units on this machine, so
  the metric is computable and has nothing yet to say.
- ~~`ModelCallRecord` has a table, all three append-only triggers, and appears **nowhere** in `src/` or
  `scripts/`. Every call's model, prompt version, tokens, latency, stop reason, repair turns and
  failure kind are computed and handed to `onCall` — an optional hook declared on
  `AnthropicModelClient` that nothing ever passes. The data is produced and dropped on the floor.~~
  `createModelClient` in `src/model/provider.ts` passes the hook, and three callers supply the sink:
  `src/server/actions.ts`, `src/app/api/session/current/route.ts` and `scripts/worker.ts`. **The
  weakness that replaced it, not rounded up:** a telemetry write that fails is lost silently and
  nothing counts the losses — `provider.ts` says so at the empty `.catch`, and there is still no
  reader of the table.

**Nothing here learns anything, and §8 forbids the thing that would.** Learned trust models are on the
do-not-build list; trust history can recommend a setting and can never create permission.

*Self-correcting:* `tests/reachability.test.ts` ~~pins `modelCallRecord.create` and `findings.forRun` at
zero callers~~ *(2026-08-16: `modelCalls.create` moved into the reachable section and its needle was
corrected there — the old one named a string only the repository's own Prisma delegate matched, so it
could never have gone red; ~~`findings.forRun` is still pinned~~ **2026-08-27: `findings.forRun` was
promoted too, so this sentence now names two symbols that are both reachable and pins neither**)*.
When a reader lands, that suite goes red **by design**, the claim is relocated into the reachable
section rather than deleted, and this section's status marker moves with it.

**The mechanism was exercised three times on 2026-08-27** and it worked the way this paragraph
promises: boundary 6, the gap sweeper and the outcome-scoped finding were all wired, this file went
red on each, and each claim moved up rather than being deleted. The status marker did **not** move —
*read, and still learning nothing* is unchanged, because rendering a finding is not learning from
one.

---

### 10. Re-entry — **built**

*For:* presenting the minimum a person needs to understand state and resume control.

**Built.** A `ShiftReport` written by the **app process** when the run ends, never by the `AgentRun`
itself — a report only a live runner could produce cannot exist on `interrupted`, and under the sleep
constraint `interrupted` is routine. Every section is a deterministic rendering of durable rows:
completed work from the ledger, productions from `ShiftOutcome`, refusals from refused
`ActionIntent`s, gaps from `captureGap` events, decisions from `DecisionNeeded`, and where it stopped
from `AgentRun.status` and `terminalReason`. Rendered by `src/ui/shift-report.tsx`. Review produces
**decisions, never documents**, and a document is a pure fold over the immutable base
([ADR-0003](./adr/0003-artifact-versioning-ledger.md)).

~~**Not built: the narrative.** `shiftReportBoundary` in `src/model/boundaries/shift-report.ts` is
unwired, and `ShiftReport.narrative` currently holds a stop-rule label — a consumer string sitting in
the field where model prose belongs. Pinned in the deferred block.~~

**Built 2026-08-27.** `src/server/shift-narrative.ts` gathers the facts from rows — the contract's
stated objective, `PlanStep`s joined to their outcomes, the counts, the stop rule's own label — and
`writeReport` tries the boundary first. **It still fails open**: a boundary failure falls back to
exactly what the field held before, so the cost of a refusal is the sentence and nothing else, which
is what the boundary's own header asks for.

Two things it deliberately does not narrate, both because the answer would be less trustworthy than
the silence: a **crashed** run, where the least reliable component would be explaining its own
outage, and a **cancelled** one, where *"You stopped me, so I put everything down where it was."* is
already exact.

**One shift per session.** Re-entry ends at accept or reject. No *keep going*, no *redirect*.

**The word `shift` is not on any of those screens, from 2026-08-26.** It is a layer-level and
schema-level term; `CONTEXT.md` fixes its consumer wording as *"While you were away"*, and it had
leaked into consumer copy in twelve places — including the front door's count sentence and the
agreement's permission panel. `tests/consumer-vocabulary.test.ts` is the guard, and it is the sixth
one: it extracts what a person can read out of `src/ui`, `src/app` and `extension/src/panel.html`
and fails on `take over`, `shift`, `claim` and `task`. It is worth knowing what it does **not** do —
it reads source text, so a sentence assembled at runtime and a component that computes the right
words while rendering others both pass.

**Two route boundaries landed the same day** — `src/app/loading.tsx` and `src/app/not-found.tsx`,
beside the existing `src/app/error.tsx`. Every page here is `force-dynamic` and awaits the database,
so before these a cold start painted nothing and a stale id got the framework's own 404.
`notFound()` already had three callers, so the second is reached by the product rather than only by
mistyped URLs. `tests/route-boundaries.test.ts` renders all three and asserts those callers still
exist.

---

## Where computer use sits

The preference ordering, highest first, which is what direction §4 gets right and what this repository
already honours:

1. Native APIs.
2. Structured integrations.
3. Browser DOM tools — the accessibility tree, which is the browser's own semantic description of the
   page.
4. Visual computer use — a screenshot, requested only when the tree is not enough.

~~**Computer use is the fallback tier under structured APIs, not the goal.**~~ **Reversed 2026-08-26
by [ADR-0025](./adr/0025-computer-use-beyond-the-browser.md), and re-marked here 2026-08-27.** The
ordering above still holds — a native API is still preferred to a screenshot — but computer use is now
**the product** rather than the tier of last resort, and the blast radius stops being a browser tab
and becomes the machine. *Unrestricted* computer use remains forbidden, and the restrictions are
ADR-0025 §3 rather than §8: no shell, no `osascript`, no AppleScript, no filesystem read outside
ADR-0026's one reader, no keychain, no enumeration of what is running, and every mutating action
checked against an application allowlist the person ratified. It is the only entry ever removed from
§8's list, and it is struck there rather than deleted.

What is unchanged, and is the reason the tier ordering survives its own reversal: computer use is the
least inspectable and least reversible way to act, both properties are load-bearing, and **Propositum
never runs its own JavaScript inside a page you are signed into.** ADR-0025 §3 carries that last
sentence to the desktop unspent.

**None of it is built.** `grep -rn 'approvedApplications' src/` returns nothing, there is no
`tests/desktop-scope.test.ts`, and ~~there is no native binary to hold a TCC permission~~ — which is
[`docs/todo/07-off-the-browser.md`](./todo/07-off-the-browser.md), the largest single piece of work
in the project. **Corrected 2026-08-27: the native binary exists (`src-tauri/`, ADR-0023 stage 1) and
holds no TCC permission — `tests/tray-permissions.test.ts` pins its config to none, and going red
there is how a grant enters knowingly.** *(Re-marked 2026-08-28: still no TCC permission — but the
guard has since gone red once, for stage 2's hardened-runtime JIT carve-outs
([ADR-0027](./adr/0027-a-sealed-bundle-and-where-the-state-moves.md)), which are not grants; it now
pins TCC vocabulary to none and the entitlements file to exactly those two keys, so the seam this
sentence promises is intact and tested.)*

**The tension with the direction document, stated rather than resolved.** Direction §4 files Computer
Use under *Later — fallback when structured APIs/integrations are unavailable*. This repository shipped
it as **Now** on 2026-08-11 ([ADR-0010](./adr/0010-acting-in-the-browser.md)), and
[`VISION.md`](./VISION.md) records the reversal under *The honest cost of moving this line*. Applying
§4 literally would write a **false modesty** claim backwards into a document that already carries a
struck-through `~~Now. None.~~`, which is [Principle 11](./PRODUCT_PRINCIPLES.md) — *say the true
thing, including when it is unimpressive* — violated in its rare inverted form, where the untrue thing
is the modest one. On this line the direction document is behind the repository, not ahead of it. The
ordering above is the part of §4 that stands.

ADR-0010's own opening is the reason this section is not comfortable: `ActionKind` now enumerates
mechanisms rather than effects, a confirmation pause replaced an absent capability, and **a pause is
strictly weaker than an absence**.

---

## The lifecycle word

`IntentionState` is a **computed view with five members**: `working`, `delegated`, `needs-you`,
`sleeping`, `done`.

~~**It is not a type you can import as this file lands.** `IntentionState` appears nowhere in `src/`,
for the same reason `model Intention` appears nowhere in `prisma/schema.prisma` — §1's check covers
both.~~ **Amended 2026-08-16, with §1:** it is a type you can import.
`src/domain/intention/state.ts` exports `IntentionStateId`, `IntentionStateRule`, `IntentionFacts`
and `INTENTION_STATES`, and `intentionState(facts, now)` computes a member from rows. ~~**What is still
true is the half that mattered: nothing calls it.** No screen renders a state, the consumer labels
below are rendered by nothing, and `tests/reachability.test.ts` asserts that absence deliberately so
a green suite cannot be read as a wired one.~~ **Amended 2026-08-16, in the wave that landed the
caller: something calls it, and the five consumer labels below are on the front door.**
`src/server/front-door.ts` derives each row and `src/app/page.tsx` renders the label, with the
re-entry link on `needs-you`; the reachability claim moved into the reachable section and now names
`front-door.ts`. ~~**One of the three routes into `needs-you` is unreachable from production data:**
nothing supplies a non-zero `openDecisions`, because a `DecisionNeeded` cannot be cleared and a count
that can only go up would pin the word on permanently — see `CONTEXT.md`'s `IntentionState` entry,
where the cost of that decision is written down rather than talked down.~~
**Struck 2026-08-26 by [ADR-0022](./adr/0022-the-fourth-verdict.md), which is the day that entry
predicted in its own text.** `CONTEXT.md`'s struck `DecisionNeeded` row said the rule *"becomes
reachable the day the row can be answered"*; a `DecisionVerdict` is that answer, the shift report
carries a field to type it into, and `factsForEveryProject` now counts only questions with no answer
— so **answering the last one takes *Needs you* back off, and the third route is reachable.** It was
unreachable for ten days, during which a person could enter that state and never leave it beside a
button whose own copy said *"Propositum doesn't keep your answer."*

The argument for five members below is unchanged, and it was written down before the union was rather
than after somebody had already typed six.

**Two docblocks in `src/` still carry the struck claim** and are not corrected here because this is
not their file: `src/persistence/repositories/index.ts` (*"`IntentionStateFacts.openDecisions` is
always zero"*, on the `openQuestions` reader) and `src/domain/intention/work-so-far.ts` (*"reports
zero"*). Both describe the reader they sit on rather than the schema, and both read as stronger than
they are now. Fix them in the next change that touches those files.

Computed, not stored, following unanimous precedent — `EnforcedPolicy`, `Shift` and `ActionStatus` are
all computed views on the argument that **two stores for one truth is exactly how a UI comes to
display something the gate cannot enforce.** Every fact these five derive from already exists as a
durable row.

**`waiting` is deliberately absent from the union.** Direction §1's lifecycle has six states and
`waiting` means *progress depends on an external event or dependency*. Nothing in this system can
produce an external event: `ExternalEvent` is on §8's do-not-build list, and — the structural half —
`ObservationEvent.sessionId` is required with a single ledger writer, so no event outside a sitting
can be persisted at all. `waiting` is the state that arrives with event ingestion. Until then it is a
member nothing can reach, and **a member nothing can reach is a claim**; this repository writes claims
down instead of shipping them.

**One live session at a time is enforced in the app layer, not the schema.** A surface listing several
`working` intentions would look correct and be unable to start the second one. Worth knowing before
anyone builds that surface.

---

## Honest limits of this document

- **Propositum is one sensor, one worker, one reviewer, and — once the slice lands — one flat table
  and a lifecycle word computed from rows that already existed.** ~~As this document lands the table is
  not in `prisma/schema.prisma` and the lifecycle word is not in `src/`, so that clause is a
  description of the state after the slice and not of the state now. Six of the ten layers above are
  partial or absent.~~ **Re-marked 2026-08-20: the slice landed, so *once the slice lands* in the
  sentence above now describes the present rather than a plan.** The table is `model Intention` in
  `prisma/schema.prisma` and the lifecycle word is `IntentionStateId` and `INTENTION_STATES` in
  `src/domain/intention/state.ts`, imported by `src/server/front-door.ts`. §1 and *The lifecycle
  word* in this same file both struck the identical sentence on 2026-08-16; this bullet kept its
  copy, in the section offered as this file's ground truth. **Five** of the ten layers above are
  partial or absent — the number `tests/counts.test.ts` reads off the table, and the number the
  README was corrected to on 2026-08-19 while this bullet went on quoting the one the README had
  retired. The four that are built are the four that had to be built before anything could be safe.
  That is nine; the tenth is Outcome / Learning, which is read and learns nothing and belongs in
  neither list. The arithmetic is spelled out rather than rounded, because rounding it is how this
  bullet came to say *six*.
- **Naming a layer is not building one.** This document names ten because the direction document names
  ten and the two should be readable side by side. The status column is the load-bearing part; the
  layer names are the part most likely to be quoted out of context.
- **Nothing checks the status column.** ~~No test reads this file.~~ **Re-marked 2026-08-20:
  `tests/counts.test.ts` reads this file.** It counts the rows of the table above and the ones whose
  Status cell matches *partial* or *unimplemented*, and holds the README's stated numbers to them. It
  reads no other line, and it has no opinion about whether any Status cell is true — so the heading
  of this bullet stands exactly as written, and the sentence under it did not. §1 carries a command
  a reader can run against the schema, and **nothing runs it for them**. A layer that gets built and
  is not re-marked here will read as unbuilt, and a layer that gets deleted will read as built. The
  reachability pins named in layers 7 to 10 are the only mechanism in the repository that goes red on
  its own when one of these claims stops being true — and ~~they cover six named symbols~~ **that
  number is deleted rather than corrected, 2026-08-20** — not this document. It was exact on
  2026-08-16, when layers 7 to 10 named `createBrowserControl`, `LANDING_ACTION_KINDS`,
  `findings.forRun`, `confirmations.create`, `modelCallRecord.create` and `shiftReportBoundary`.
  Three of those have since been promoted into the reachable half and struck above, and one pin
  still in the block — the gap sweeper — is named nowhere in this file, so the number is wrong under
  every reading and nothing here could have caught it. The *deferred, and asserted as deferred*
  block is the only honest way to size that net. Overstating the one safeguard this column has, in
  the bullet written to admit how thin it is, is what this correction is for.
- **These layer names are not vocabulary.** *Progress Reasoner*, *State Reconciler* and the rest are
  organising words for this file and for reading the direction document beside it. They are not
  `CONTEXT.md` terms, and nothing should be named after one in code, schema, prompts or UI. The
  glossary is the authority on what things are called; this file is the authority on nothing except
  what is built.
- **`GUARDED_TABLES` in `src/persistence/errors.ts` names 7 tables while 13 are guarded**, so a
  trigger firing on six of them still surfaces as Prisma's P2003 "Foreign key constraint violated"
  lie. Not this document's job to fix; recorded so the next person to read an implausible error
  message finds the explanation.

Vocabulary is [`CONTEXT.md`](../CONTEXT.md), which is this repository's single glossary. Scope and the
numbers that decide whether slice 0 worked are [`MVP.md`](./MVP.md). Stages beyond it are
[`ROADMAP.md`](./ROADMAP.md).
