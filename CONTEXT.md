# CONTEXT.md — Propositum's ubiquitous language

This is the vocabulary. Every schema, prompt, table, ADR and UI string uses these words and
no others. Where this document contradicts `docs/FOUNDING_BRIEF.md`, this document wins —
the brief says so itself, and the specific overrides are listed at the end.

Organised by lifecycle, mirroring the pipeline:
**observation → inference → handoff → execution → documents & review → re-entry.**

Each term says what it is, what words it displaces, whether it is a **table**, a
**computed view**, a **value object** (fields on another row) or **not persisted**, and its
consumer wording. A term that does not appear in slice 0 does not belong here.

All four open product decisions were closed on 2026-08-06 and are recorded at the end. Nothing in
this document is provisional; where a term's shape depends on a later ticket, it says which one.

---

## Standing rules this vocabulary encodes

- Models propose; deterministic code authorizes. Never the reverse.
- Observation never executes actions. The two ledgers are disjoint.
- Every inference carries provenance to its events. Every action carries a reason and a
  record, append-only.
- Execution is reversible: versions only, and the base is immutable for the whole review.
- Agents are ephemeral. Sessions, contracts, documents and ledgers persist.
- **Bare `action` and bare `Objective` are banned.** Write `ActionKind` or `ActionIntent`;
  write "the reading's objective claim" or "the contract's stated objective".

---

## 1. Observation

### Project — *table*
The single durable workspace (`id`, `name`, `createdAt`). Owns
every ApprovedSource, Document and WorkSession. No objective, no status, **no free-text
description** — a description that inference reads is a project goal in disguise and would
silently pre-answer whether the human declares what they are working on.

~~The user creates it explicitly.~~ **Amended 2026-08-11: nobody creates a project.** The
detector finds a thread, a model names the subject, and accepting the offer creates the project
under that name — there is no form, and `createProject` is not a server action. The schema is
unchanged; what went is the human act of filing. Two corrections make that defensible and are
therefore part of the term, not decoration: the name is editable, and a sitting can be moved to
another project or split out into its own. Rows are mutable for exactly this reason — a Project
holds no inference and carries no provenance, so nothing here is append-only.

**Filing is deterministic.** `matchProject` compares the subject's words to each existing
project's, and joins only on at least two shared words covering 0.6 of the smaller set. A model
naming the match would be a model deciding where someone's work is filed. The thresholds are
guesses set before real data, tuned toward splitting: a false split is one click, a false merge
silently inherits the wrong sources and the wrong document.
*Displaces:* Workspace · Space · Folder · Board · Account · Client · ProjectGoal.
**Consumer:** Project.

### WorkSession — *table*
One explicitly started and explicitly ended stretch of desk time in one Project
(`id`, `projectId`, `phase`, `startedAt`, `endedAt?`). A **sitting, not a single intention**:
it may contain several strands and the reading names the dominant one. It survives handoffs,
idle, lid close, sleep, service-worker death and permission revocation. Only a human act ends it.
*Displaces:* Session (bare) · Sitting · Episode · FocusSession · Task · Job · Run ·
Shift-as-a-session · CaptureSession.
**Consumer:** Session — "Start session", "End session".

### SessionPhase — *value object on WorkSession*
`observing | away | ended`.
- `observing` — the human holds the work and capture is live. This **includes** drafting the
  handoff and reading the shift report; both are desk work.
- `away` — an accepted HandoffContract has a live run. Capture is off, so "While you were
  away" describes a stable interval.
- `ended` — terminal, by human act only.

Transitions: `observing → away` at contract acceptance; `away → observing` when the last run
under that contract reaches a terminal status — written by deterministic code, never by the
human's click, because cancellation is not instant and the UI must honestly show "stopping…";
`→ ended` by a human act.

No `paused`. A privacy pause, a dead service worker, a slept machine and a revoked permission
are one shape: a CaptureGap. No transition table either — each transition is already recorded
by an immutable fact (`contract.acceptedAt`, the last run's terminal row, `session.endedAt`).
**A late-arriving buffered ObservationEvent is admitted iff its `observedAt` precedes
`contract.acceptedAt`** — a test against an immutable timestamp, not against the current phase.
*Displaces:* SessionStatus · SessionState · state · mode · isPaused · handing_off ·
awaiting_reentry · ControlHolder · ControlTransfer.
**Consumer:** internal — surfaced as "Observing" / "Working while you're away" / "Ended".

### ApprovedSource — *table*
An origin pattern the human approved for this Project (`id`, `projectId`, `originPattern`,
`label`, `grantState: granted | revoked`, `grantCheckedAt`), mirroring a Chrome host-permission
grant. Every browser event and every ContractScope references it **by id, never by URL** — so an
event from an unlisted origin is a schema violation the ledger writer rejects, which is how
"deterministic code authorizes" is satisfied at the write boundary.

Project-scoped, not session-scoped: the brief puts permissions on Project, and the Chrome grant
already persists across browser sessions, so per-session re-granting would be friction Propositum
invents on top of a grant Chrome already holds. `grantState` is a cached mirror; Chrome is
authoritative. A stale `granted` leaks nothing, because the extension is structurally incapable
of reading a revoked origin — the symptom is a CaptureGap with reason `permission_revoked`.

**Approval grants access, never trust.** An approved source is content the user chose to
retrieve but did not author. No page-derived value from one may influence a policy decision.
*Displaces:* AllowedSite · allowlist entry · whitelist · ApprovedResource · PermittedURL ·
Source (bare) · watched tab · `never_requested`.
**Consumer:** Approved source, under "What Propositum can see".

### CaptureAdapter — *not persisted*
The port producing ObservationEvents for one session. Two implementations in slice 0: `fixture`
and `chrome-extension`. Surface: `capabilities()`, `start()`, `stop()`, `subscribe()`.
Renamed off "ObservationSource" because `event.source` already means an ApprovedSourceId.

**It has no method that summarises, classifies or interprets.** If one appears, observation has
started inferring and the layering has collapsed.
*Displaces:* ObservationSource · collector · recorder · tracker · monitor · watcher · observer.
**Consumer:** internal — "Propositum is watching your approved sources".

### ObservationEvent — *table, append-only*
One deterministic, timestamped, immutable record of a single thing that happened, written by the
**single ledger writer** and **never minted by a model**. If a model emitted events, the
inference would cite the event and the event would *be* the inference — circular provenance, and
H1 unmeasurable.

Fields: `id`, `sessionId`, `seq` (ledger-assigned, gapless by construction), `sourceSeq`
(adapter-assigned; a **skip or a regression** is a gap signal, never an ordering key),
`observedAt`, `elapsedMs` (source-supplied, so a 40-minute fixture replays in 400 ms with no
behaviour change — never call `Date.now()` internally), `kind`, `approvedSourceId` (nullable,
enumerated per kind), `documentId` (nullable), `attested`, `untrusted`.

Both the extension and the in-app editor POST to the one writer; there is no bypass path.
*Displaces:* signal · raw signal · telemetry · activity log entry · interaction · trace ·
execution trace · SessionEvent · UserAction · SessionNote.
**Consumer:** Session timeline. Rows render as plain sentences — "Opened Northwind's partnership
page". The noun is never shown.

### ObservationKind — *value object*
Closed and code-owned:
`visited · queried · excerpted · engaged · returnedTo · switchedAway · documentEdited · note ·
sourceApproved · captureGap`.

`approvedSourceId` is non-null for `visited`, `queried`, `excerpted`, `engaged`, `returnedTo`,
`sourceApproved`; null for `switchedAway`, `documentEdited`, `note`, `captureGap`. Enumerated
per kind, not summarised as "browser kinds" — `switchedAway` is by construction not attributable
to an approved source.

Adding a member is a schema change plus migration, never configuration. There is **no `other`**.
The Anthropic SDK enum caveat does not touch this: these are never model output, so the enum is
a genuine constraint enforced by deterministic code, not a prose hint.

`bounced` and `refinedQuery` are **not** kinds — `bounced` requires knowledge of the future and
an append-only event cannot depend on something that has not happened. Both are re-computable
projections over the stored stream, if anything ever needs them.
*Displaces:* eventType · signal type · semantic label · other · custom · misc.

### CaptureGap — *value object (payload of a `captureGap` event)*
An interval Propositum knows it was not watching:
`{ reason: service_worker_terminated | machine_slept | transport_disconnected | permission_revoked,
startedAtElapsedMs, endedAtElapsedMs }`.

**Gaps are events, not absences.** A hole indistinguishable from inactivity makes inference
confidently report a lull that never happened — corrupting H1 in the way hardest to notice.

A gap is an *absence of knowledge*. A deliberate pause or an alt-tab is a *fact* and gets its own
kind. A malformed event the ledger rejects is a ledger-writer fact, not a gap — rendering it as
"I stopped seeing your work" would be a false statement to the user about our own software.
*Displaces:* missing data · downtime · blind spot · dead time · data loss · SessionPause ·
CaptureWindow · ObservationCoverage.
**Consumer:** "What I missed" — *"I stopped seeing your work from 2:10 to 2:41 (your Mac slept)."*

### UntrustedContent — *value object*
Any value a page could have authored — extracted text, DOM-read titles, selections. Carried
**structurally**, not as a per-field flag: every such value lives under an event's `untrusted`
key, or is quoted with attribution inside StatedIntent.

One rule, mechanically checkable:
> Nothing under `untrusted` may influence a policy decision, be treated as an instruction, or
> enter a prompt without datamarking.

There is no ordered trust enum: browser-attested and user-asserted are incomparable, so a "floor"
over them has no meaning, and the work `user-asserted` was doing belongs to `SessionClaim.origin`.

**Retention budget — decided, and deliberately a published number.**
Propositum keeps, per approved source: the page title, a cleaned URL, any text the human
**deliberately selected or copied** (verbatim), and **at most the first 2,000 characters of
readable article text**. Nothing else. Full page text is never stored.

The 2,000 is a **product constant declared in `docs/SECURITY_AND_PRIVACY.md`**, not an adapter
tuning knob — the promise is the artifact, and the number is downstream of the promise sentence.
It sets three things at once: the privacy commitment, the ceiling on how well a session can be
read, and the size of the surface hostile page text can occupy.

Changing it later is expensive rather than merely awkward. Events are append-only, so raising or
lowering the budget invalidates every fixture already captured and forces the corpus to be
recorded again. Treat it as settled unless H1 ablation specifically implicates it.

*Displaces:* TrustTier · Trust · trustLevel · sanitized · safe · clean · page-derived (as a
stored value) · provenance (in the trust sense) · full-text capture · page scrape.
**Consumer:** **none — this concept has no good consumer word, and that is a finding, not a gap
to paper over.** The UI shows the source link and the attributed quote instead of a trust label.

---

## 2. Inference

Interpretation happens **once**, when the human asks to hand over — never on a timer. Periodic
summarisation would feed hostile page text to a model while no human is watching, during the
phase whose whole purpose is passive observation, and would make the event stream
non-reproducible so the harness could not re-score a fixture.

**Both reasons still hold, and detection does not breach them** *(added 2026-08-11,
[ADR-0008](docs/adr/0008-ambient-detection.md))*. Propositum now watches continuously and can
notice that work is underway without being told — but that detector is **arithmetic over metadata**
and calls no model. No page text reaches it; the ambient observations it reads carry a cleaned URL,
a title, dwell and scroll, and nothing else.

The cost of keeping this rule is precise and worth naming: the offer can say **what was seen** and
not **what it means**. *"You have been reading northwind.example.com — mostly Tiers"*, never *"you
are comparing partner tiers"*. Naming the work needs a model, and a model on a timer is the thing
these two sentences exist to prevent.

### SessionReading — *table*
One immutable, versioned interpretation of a WorkSession (`id`, `sessionId`, `revision`,
`createdAt`, `modelCallId` when any claim is inferred). Its content is its SessionClaims.

Nothing ever UPDATEs a reading. A human edit writes a complete new revision, and "the current
reading" is `max(revision)`, not a column — which is the only shape satisfying both the brief's
*editable summary* and the map's *append-only*.

**Exactly one reading is produced per session in slice 0.** There is no re-read button: editing
is the correction channel, and a re-runnable reading turns H1 from *"did Propositum read a cold
session correctly"* into *"did we converge after three tries"* — a materially weaker claim that
cannot be compared against a reference written blind.

The H1 answer key is reading-shaped and **must never be stored as a revision** — it belongs to
the eval harness (#17), or it poisons the head query.
*Displaces:* SessionState · session summary · understanding · context · digest · brief ·
working memory.
**Consumer:** What I think you're working on.

### SessionClaim — *table*
One atomic, evidence-bearing element of a reading:
`{ id, sessionReadingId, kind, origin, ordinal, text, evidence[] }`.

`kind: objective | completedWork | openThread | constraint | nextStep` — all five, because the
evaluation requirements score exactly these. Exactly one `objective` claim per revision, and it
alone carries an ObjectiveConfidence.

`origin: inferred | human | edited`, **per claim, never per reading.** Revision-level authorship
would launder every unedited inferred claim into a human assertion the moment the human fixes one
word — the same category error the observation layer forbids, arriving one layer up where nobody
is watching — and it would make handoff-correction-rate uncomputable.

The model emits no ids and no cross-references: the grammar cannot enforce referential integrity,
so we do not ask for it. Flat object with a `kind` string, **not a discriminated union** — `const`
is **verified not to survive** schema transformation ([#3](https://github.com/smukhyala/propositum/issues/3)),
so a bad discriminator makes the whole union unresolvable and the repair message useless, whereas a
flat shape fails on one named field.

**A `constraint` claim is display-only — decided.** It may be inferred, stored, and scored (the
eval requires a constraint measure), and it renders on the pre-handoff screen as an **attributed
quotation** — *northwind.com/partners says: "proposals must not exceed two pages"* — carrying its
source link. It is **structurally barred from reaching StatedIntent**. Anything the human wants
honoured, the human types into the working agreement themselves.

The attribution is a hard requirement, not a nicety. Without it, a quoted constraint is a
pre-filled one with an extra click, and the human's retyping becomes a laundering step rather than
an informed act.

*Displaces:* fact · insight · finding · interpretation · inference (as a noun) · belief ·
conclusion · bullet · UnresolvedQuestion · NextStep (as a type) · ArtifactsInvolved ·
inferred constraint (as something the contract holds).
**Consumer:** internal — claims render as sentences under their kind's heading.

### ObjectiveConfidence — *value object on the objective claim*
`high | medium | low`. Never a number, never compared against a tunable threshold, and the word
"confidence" never appears in UI copy. A model's self-reported 0.83 is uncalibrated, and inviting
a numeric threshold into the interface is the banned move.

**Not a control-flow input.** Take Over is gated on *an objective existing and the human having
seen it*, not on the band — which keeps a model-authored value out of the authorization path and
is closer to "deterministic code authorizes" than any band-based rule.

Model-facing, so the enum reaches the API as a prose hint: an out-of-band value fails Zod, gets
one repair turn quoting the exact issue, then the boundary fails closed. Never coerced.
*Displaces:* confidence score · confidence threshold · certainty · probability · likelihood ·
EvidenceStrength.
**Consumer:** phrasing only —
high: *"You're writing the Q3 partnership proposal for Northwind."*
medium: *"It looks like you're writing the Q3 partnership proposal — is that right?"*
low: *"I couldn't work out what you're aiming for. Tell me in a sentence."*

### Evidence — *value object on a SessionClaim*
The link from one claim to one ObservationEvent, plus an optional verified quote.

Model-facing wire form `{ ref, quote? }` where `ref` is a short handle (`E1…En`) from the numbered
event list in the prompt, resolved against that exact handle set by a Zod refinement — the one
failure class where re-asking is rational. Stored form `{ eventId, quote? }`.

A quote is kept only if it matches a **canonical normalised form** of the cited event's stored
text (datamarking reversed, whitespace collapsed, case-folded). Raw substring matching would
discard essentially every quote, because the mandated injection defence guarantees the model never
saw the raw string. Discarded quotes are **counted**, not merely logged: fabricated support is an
H1 datum.

A claim whose every cited id fails to resolve **fails validation**. An inference with no
provenance violates a binding constraint, and "losing the objective is worse" is a preference,
not evidence.
*Displaces:* provenance (as a type) · citation · support · backing · grounding · receipt ·
reference.
**Consumer:** Why I think that.

---

## 3. Handoff

### HandoffContract — *table*
The persisted, human-ratified agreement governing exactly one autonomous continuation
(`id`, `sessionId`, `sessionReadingId`, `status: draft | accepted`, `acceptedAt`, plus the three
value objects below).

Status has **two** values only. Supersession, if continuation ever ships, is derived from a
successor's `supersedesId` — which means the immutability trigger has a single job (permit UPDATE
only where `OLD.status = 'draft'`) and no lifecycle transition has to defeat it.

`acceptedAt` is the shift start **and** the origin of the deadline, so a crash-restart cannot
silently reset the budget.

No run may start from a contract that is not accepted, and **nothing in the controls can switch
off human ratification.** There is no auto-accept and no auto-handoff.
*Displaces:* Handoff (as an object) · HandoffSpec · HandoffDraft · TaskBrief · Mandate ·
Assignment · JobSpec · WorkOrder · AgentInstructions · WorkingAgreement (as a type name).
**Consumer:** Working agreement.

### StatedIntent — *value object*
`objective`, `definitionOfDone`, `guidance: string[]`.

Human-ratified but still prose, because spans of it originate in page-derived text. Each field
carries **evidence refs** to the events and attributed excerpts that produced it — without them,
the human review the entire safety story rests on is performed blindfolded.

`compilePolicy`'s parameter types are constructed so they **cannot receive StatedIntent**, which
turns "no prose influences a policy decision" from a review note into a compile error. The
reviewer reads it; the reviewer's verdict is explicitly non-authorizing.

`guidance` is deliberately unenforceable and must be labelled as such in the UI — the demo's real
constraints ("don't commit to a discount", "don't name the second vendor") are semantic and
inexpressible as ActionKinds, so dropping the field loses expressiveness the user wants. A
guidance violation scores as bad work (H2), never as a bad stop (H3).

**`guidance` is human-typed only — decided.** An inferred `constraint` claim never pre-populates
it. Constraints found in page text surface beside the agreement as attributed quotations, and the
human retypes anything they want honoured. This is the one place where page prose could otherwise
become something the worker follows, so the barrier is structural: the handoff-generation boundary
has no path that writes a claim into `guidance`.

*Displaces:* Objective (free-standing) · InferredObjective · CommittedObjective · AgreedObjective ·
Goal · Mission · Intent · Intention (as a field) · Instructions · outOfScope · SuccessCriteria.
**Consumer:** "What I'll work on" · "Done means…" · "Guidance — not a hard limit".

### ContractScope — *value object*
`approvedSourceIds[]`, `allowedActionKinds[]`, `baseVersionId`.

Deny-by-default; **no denylist**, because a second mechanism creates a precedence question with no
principled answer. The "I will not…" reassurance panel renders two visually distinct groups: the
computed complement of `allowedActionKinds` (we chose not to allow this) and capabilities absent
from the enum entirely (this does not exist). The UI must never blur them.

`approvedSourceIds` defaults to the project sources actually observed this session, one tap to add
any other — least privilege, cheap to correct. A model may propose a **narrowing**, checked
deterministically as `proposed ⊆ granted` before the draft renders.

A model may **not** propose `allowedActionKinds` at all: no session-level action grant exists for a
subset check to compare against, and a vacuous check is worse than none.

`baseVersionId` pins a **DocumentVersion**, not a Document, and it is explicitly the read-only base.
*Displaces:* Permissions · Capabilities · Grants · Allowlist · Denylist · ProhibitedActions ·
Guardrails · Sandbox · ACL · Scope (bare) · approved resources · workingCopyOf.
**Consumer:** "What I can look at" · "What I can change".

### AutonomyControls — *value object*
The human-set dials. Absent from every model-facing schema; defaults are static product constants,
never model-proposed — a model that could pre-set *Use judgment / Stop only when blocked* would be
the autonomy dial itself hijacked.

| Control | Values |
|---|---|
| Initiative | `follow-closely` · `use-judgment` |
| Progress | `current-step-only` · `remaining-plan` |
| Interruption | `stop-when-uncertain` · `stop-only-when-blocked` |
| Budget | `{ timeLimitMinutes }` |
| Output | `suggestions-only` · `draft-changes` |

Initiative and Progress are orthogonal and must not collapse into one dial: Initiative governs
breadth (may the worker act outside the plan), Progress governs depth (may it go past the step in
flight). Both compile to set-membership tests over plan step ids, never to prompt wording.

**"Stop and ask me when…" takes no free text.** A typed sentence beginning with those words will be
read by every user as a hard stop and cannot be one — the same lie as unenforced guidance, at
higher stakes. A closed picker of extra compiling triggers is the growth path.

**Budget shows time only.** The working agreement promises a time ceiling, not a cost ceiling. Say
that plainly. Token limits are banned from consumer surfaces.

**Output is a real permission, not a presentation mode — decided.** `suggestions-only` removes
`draft-section` from `ContractScope.allowedActionKinds`; the worker may then produce findings, open
questions, and next steps, but **may not propose document text at all**. `draft-changes` grants it.

This is the only reading under which the setting enforces something. Because review already
produces decisions rather than documents, a presentational reading would yield the identical
artifact either way — and a user who selects the safest-looking option and receives a drafted
document has been lied to by a panel they read as a permission panel.

Two consequences follow. The word **"copy" leaves the interface entirely**, because nothing is
copied. And a run that produces **zero proposed changes becomes a normal, designed-for outcome**
rather than a failure to explain away.
*Displaces:* AutonomyLevel · Autonomy (as a scalar) · Settings · Preferences · Knobs · RiskLevel ·
TrustLevel · ConfidenceThreshold · TokenLimit · StopConditions (as a contract field) ·
"Edit a copy" · "Suggestions only" (as a display mode).
**Consumer:** "How far should I go?" · "What can I change?" · "Stop and ask me when…" · "Time limit".
Output renders as **"Research only — don't write"** / **"Draft the changes"**.

### EnforcedPolicy — *computed view*
The deterministic rule set the gate evaluates, produced by the pure total function
`compilePolicy(scope, controls)` over module-level constants:
`sourceAllowlist`, `actionKindAllowlist`, `stepScope`, `offPlanActions`,
`haltOnWorkerReportedUncertainty`, `tokenCeiling`.

The brief's own words: *"Translate consumer settings into a structured internal policy."* Two
names, not one — the contract is the agreement, the policy is the rule set.

**No table.** Two stores for one truth is exactly how a UI comes to display something the gate
cannot enforce.

**No `deadlineAt` field.** A deadline is not a function of scope and controls, and recomputing one
on restart resets the budget on every crash loop. It is derived from
`contract.acceptedAt + timeLimitMinutes` — an immutable pair.

The domain is finite (2×2×2 control combinations × the ActionKind set), so an exhaustive
table-driven test is writable.
*Displaces:* Policy (bare) · CompiledPolicy · RunPolicy · PolicySnapshot · PolicyVersion ·
PermissionSet · Constraints · StopCondition · RunAuthorization.
**Consumer:** internal only.

### Shift — *computed view*
The bounded period during which Propositum holds the work: from `contract.acceptedAt` until the
last AgentRun under it reaches a terminal status. **Exactly one per accepted contract** — if
continuation ships, "Keep going" mints a new contract rather than extending one, because the brief
bars autonomous action without an explicit handoff.

Computed, not stored: both boundaries are already immutable facts. One ShiftReport per Shift, one
budget per Shift, one "While you were away" per Shift.

**Slice 0 ships exactly one Shift per WorkSession — decided.** Re-entry ends at accept / reject.
"Keep going" and "Redirect" are **not** in slice 0, which is an explicit override of the founding
brief's MVP boundary rather than a quiet disagreement between two documents.

The cardinality was never in question — every away period needs its own agreement, so continuation
could only ever mint a new contract. What it would cost is replanning against a document that moved
between shifts, and shipping that unsolved means the second shift confidently re-proposes work the
first shift already did, on the demo path.

*Displaces:* away period · AwayPeriod · handoff run · autonomous session · takeover · episode ·
stint · "the handoff" used to mean the period · Shift.ordinal.
**Consumer:** While you were away.

---

## 4. Execution

### AgentRun — *table (mutable by design — the ledger is append-only, this row is not)*
One ephemeral worker-or-reviewer execution inside a Shift. Queue entry and domain record in **one
row**: the queue is a status column and one guarded `UPDATE … RETURNING`, not new infrastructure.

`id`, `contractId`, `role: worker | reviewer`, `status`, `claimedBy`, `claimedAt`, `heartbeatAt`,
`leaseExpiresAt`, `cancelRequested`, `lastCompletedStepOrdinal`, `startedAt`, `endedAt`,
`terminalReason`.

`status`: `queued · running · completed · halted · interrupted · failed`.
`terminalReason` is closed, **code-assigned**, and partitions strictly by status:

| Status | Reasons |
|---|---|
| completed | `plan-exhausted` |
| halted | `stop-condition` · `human-recall` · `time-budget-exhausted` · `token-budget-exhausted` · `gate-refusal` |
| interrupted | `lease-expired` |
| failed | `boundary-failure` |

**A slept Mac yields `interrupted / lease-expired`, never `time-budget-exhausted`** — the startup
sweep fires on lease staleness before any deadline check runs, so the report never blames the clock
for a lid close. `interrupted` is a real, displayable outcome with a partial shift report, not an
error state; under the standing "leave your desk, not leave the building" constraint it is routine.

H3 is scored only on the judgment-family reasons, which keeps budget exhaustion out of the stopping
metric.

**The claim is a fence.** Every action boundary re-reads `status` and `claimedBy`; a Runner that no
longer holds the claim aborts without writing. Otherwise a machine that wakes after its run was
reaped appends actions to a terminal run inside a shift the human already closed.

One handoff produces **two** runs: a worker, then a reviewer whenever the worker completed at least
one action. The reviewer is **enqueued, not invoked inline** — failure isolation was the reason to
split them, and inlining recouples them. Two runs rather than two phases also means each run's
capability set is fixed for its whole lifetime, so the reviewer gets a genuinely read-only
capability instead of a gate someone can forget to close.

No retries at the run level in slice 0.
*Displaces:* Run (bare) · RunQueueEntry · QueueEntry · Job · Task · Execution · Invocation ·
AgentSession · WorkerRun/ReviewerRun as separate types · agent (as a persisted noun) · Reaper.
**Consumer:** internal — copy says "Propositum", and for the reviewer pass, "checked against your
instructions". Never "agent run", never "job".

### Runner — *not persisted*
The single long-lived OS process that claims and executes AgentRuns — the second npm script beside
the dev server. Id `${pid}-${uuid}`, recorded on every run it claims. At most one AgentRun at a time.

Pure collision control, and not optional: "worker" is already taken twice (the brief's worker agent,
and `role='worker'`). Rename `dev:worker → dev:runner` and `worker.ts → runner.ts` the day this
lands — filenames teach words.
*Displaces:* worker process · WorkerProcess · daemon · executor · agent host · runtime ·
queue consumer · orchestrator · scheduler.
**Consumer:** internal — its one visible fact is its absence: "Propositum isn't running".

### ExecutionPlan — *computed view*
The ordered PlanSteps of one worker AgentRun.

**The brief's "bounded graph" is refuted.** Dated deviation, four reasons: one Runner executes one
action at a time, so no edge has anything to express; an early stop is a prefix truncation, not a
branch; the Progress control is only coherent as an authorized prefix length over an ordered list;
and recursive schemas are unsupported by the API grammar, so edges would arrive as an unvalidated
adjacency list with its own repair path.

Produced once, as the worker run's first act, **after the human has left**. The Product-controls
table is the complete pre-departure surface and the numbered workflow runs contract → controls →
worker with no plan review between; adding one would be a second editable object beside the
contract. Honest cost: nobody checks a bad plan before it spends the shift. Mitigation: the shift
report opens with what I set out to do / got to / didn't get to.

No table — once summary, authorizedStepCount and boundary-provenance are stripped, the row is two
foreign keys and a timestamp.
*Displaces:* Plan (bare) · plan graph · DAG · dependency graph · workflow · Pipeline ·
Orchestration · task list · checklist · playbook · job graph.
**Consumer:** internal.

### PlanStep — *table*
`id`, `agentRunId`, `ordinal`, `description` (imperative, one line), `target` (a BaseSpan for a
drafting step, null for a read). Immutable, strictly ordinal, no skipping.

**One PlanStep authorizes exactly one action in slice 0.** This is the only reading under which
"Finish the current step" is literally true, the authorized prefix is a real bound computed by
deterministic code, steps and ledger rows line up 1:1, and per-change attribution is exact by
construction. The cost is stated plainly: research steps get chopped fine and the worker cannot
revise its own earlier work inside a run.

Progress is `AgentRun.lastCompletedStepOrdinal`, advanced **only in the same transaction as the
durable append of that step's outcome** — never on the heartbeat, or "What I completed" lists a step
that never ran. "What I completed" renders from the ledger, never from the counter.
*Displaces:* Task · Subtask · Node · WorkItem · Todo · action item · Stage · Milestone ·
Step (as a model name) · StepStatus · declaredEffect · expectedSources.
**Consumer:** step.

### BaseSpan — *value object*
A `[start, end)` character range over one BaseVersion, `end` exclusive, in **UTF-16 code units** —
stated here in the same breath as the splice so it cannot be re-derived wrongly.

One type, two uses: the section a PlanStep is authorized to touch, **resolved once by deterministic
code at authorization time** from a human-readable heading and never re-resolved (so a worker
renaming its own heading cannot move its own target), and the address of a ProposedChange.

Heading paths are never a resolution key: they cannot address two changes in one section and they
break exactly when the worker does the thing it was asked to do.
*Displaces:* Anchor · ChangeAnchor · AuthorizedSpan · selector · range · locator · offset pair ·
TextQuoteSelector · section id · prefix/suffix quote anchors.

### ActionKind — *value object*
Closed and code-owned: `read-approved-source · read-document · draft-section`. The only alphabet
`ContractScope.allowedActionKinds` draws from, and the only key the gate matches on. Each carries a
static `mutating` flag so the UI can distinguish "I only read a source, nothing changed" from "your
proposal may be partially drafted".

`materialise-working-copy` is **not** a member: the worker returns prose and materialisation is a
post-review human fold. Capabilities the brief excludes — send a message, purchase, publish, delete
a file — are **absent from the enum entirely** rather than denied by a rule. The strongest form of
prohibition is absence of capability.

Final membership is owned jointly with the policy-gate ticket.

Model-facing in worker proposals, so the enum reaches the API as a prose hint. If the model returns
a kind outside the set: Zod rejects → one repair turn quoting the exact issue → the gate
**default-denies** and writes a refused ActionIntent with rule `unknown_action_kind`. The safety
boundary is untouched, because deny-by-default already covers it. The only cost is a wasted turn.

**`draft-section` is removable by the Output control — decided.** `suggestions-only` omits it from
`allowedActionKinds`, so a worker proposing it is refused by the same deny-by-default path as any
unauthorized kind. The control is therefore enforced by the gate that already exists, at the cost
of one flag.
*Displaces:* Tool · ToolCall · tool call · Capability · Operation · Verb · Command · Skill ·
ActionType · allowed actions (as free strings).
**Consumer:** "What I'm allowed to do" — "Read approved sources" / "Draft a section".

### ActionIntent — *table, append-only*
One row per gate evaluation of one concrete action, written and **committed before any effect is
attempted**. Committing intent first bounds the set of possible unrecorded side effects to zero.

`id`, `seq`, `runId`, `planStepId`, `kind`, `authorization: allowed | refused` (code-written),
`refusalRule` (nullable, closed, members owned by the gate ticket), `refusalDetail`
(code-generated), `proposedReason` (**model prose, display-only, never re-fed as instruction**),
`modelCallId`, `occurredAt`, `prevHash`, `hash`, `payload` (canonical JSON **string** — references
and one summary line, never document bodies).

The forcing case for the split is the **network read**, not the document edit: a fetch reaches the
world irreversibly, spends budget, and its redirect target is observable only in flight. A future
"simplification" back to one row must be argued against that, not against filesystem rollback.

A refusal produces exactly one row and **no ActionOutcome** — its outcome is fully determined the
moment the gate decides, and a second row would create a window in which a crash makes a refused
action indistinguishable from "your document may have changed".

Whether a refusal halts the run is the gate ticket's rule, not vocabulary. There is no retry
vocabulary in slice 0.
*Displaces:* ActionRecord · ProposedAction · ActionRequest · ActionProposal · ToolCall ·
WorkerStep · LedgerEntry · audit log entry · execution trace.
**Consumer:** internal — refused rows surface under "What I didn't do, and why".

### ActionOutcome — *table, append-only*
**At most one row per authorized intent** (UNIQUE on `actionIntentId`), committed after the effect,
never written for a refusal. "Latest wins" is an UPDATE with extra steps; the unique index costs
nothing and converts the integrity claim from a convention into a constraint.

`id`, `seq`, `actionIntentId`, `runId`, `disposition: completed | failed`,
`scopeVerdict: within_scope | out_of_scope | unverified`, `draftText` (for a `draft-section`
action, the proposed replacement for its BaseSpan), `artifactVersionId` (**typed, not payload** —
it is the join the provenance walk needs), `observedBy` (nullable; NULL = the authorising run,
`recovery` = a bounded startup sweep that may only record what it can prove by hash and may never
infer), `errorMessage`, `occurredAt`, chain fields, `payload`.

`scopeVerdict` is set **only by deterministic code**, comparing the *realised* effect (final URL
after redirects, spans actually touched) to the contract. `unverified` covers both "nothing happened
so nothing to check" and "an effect landed and no check ran" — the latter is exactly what a recovery
outcome produces, and without the value the report would render an unverified real change as
reassuring. **"verificationStatus" is banned as ambiguous.**

One short transaction per ledger write, committed before the next effect. Never one transaction per
run — the filesystem does not roll back and Prisma aborts interactive transactions at 5 s anyway.
*Displaces:* ActionResult · ExecutionResult · ActionCompletion · status column · verificationStatus.
**Consumer:** internal.

### ActionStatus — *not persisted*
The derived four-case discriminant:

| Case | Meaning |
|---|---|
| `refused` | never ran, no effect possible |
| `completed` | latest outcome completed |
| `failed` | attempted, errored |
| `unknown` | authorized, zero outcomes — the run died between authorization and the outcome write |

The fourth shape is the whole point of the split. Under the standing "a local worker stops when the
Mac sleeps" constraint it is a **routine** ending, not an exotic crash, so the UI must be honest
about what it costs — which is why ActionKind carries `mutating`.

The brief's four-part ActionRecord is **true as this derivation and false as a row.**
*Displaces:* ActionRecord (as a table or a view) · ActionState · phase · pending · in-progress.
**Consumer:** "Done" · "Couldn't finish" · "Not allowed by your settings" · "Started — I don't know
how this ended".

### ModelCallRecord — *table, append-only*
One row per model call. Its field set is owned by the model-client ticket; this vocabulary fixes
only the boundary:

> **A model call is not an action.** It lives in its own table and it never appears in "What I did".

Gating a model call would put asking-what-to-do through the same gate as doing-something. Sharing a
table with the action ledger would make the consumer ledger depend on a filter someone eventually
forgets; separate tables make the leak structurally impossible.

It is written **once, after the call**, so a run that dies mid-call loses it entirely. Therefore
budget is enforced by a **pre-call reservation** on the mutable AgentRun row, reconciled by the
record afterwards, with the residual loss written down rather than left invisible.
*Displaces:* LLM log · trace · span · inference record · token log · context window · BoundaryCall.
**Consumer:** internal — only two derived facts reach the user: budget consumed, and a model
declining, surfaced as a stop reason. (The gate **refuses**; the human **rejects**; the model
**declines**.)

---

## 5. Documents and review

The core invariant, from which everything here follows:

> **Review produces decisions, never documents.** The reviewed text is a pure fold
> `materialise(base, changes, verdicts)`.

### Document — *table*
A named unit of prose work in a Project, always Markdown in slice 0:
`id`, `projectId`, `title`, `workingText`, `createdAt`.

`workingText` is the live, mutable, unversioned text the human types. It is **named explicitly** so
the ban on Draft/WorkingCopy tables has a replacement noun and does not cause the drift it exists to
prevent.

**Not modelled in slice 0** *(recorded 2026-08-10)*. There is no `workingText` column. Saving an
edit writes a new `DocumentVersion`, so the latest version *is* the working text and there is no
unversioned state to hold. The noun stays in this vocabulary because the ban it anchors is still in
force; add the column when an editor needs to keep text the person has not saved.

**The document is never locked.** ~~Locked read-only for the duration of a Shift, with "Take back
control" as the unlock.~~ *Corrected 2026-08-10 in favour of [ADR-0003](docs/adr/0003-artifact-versioning-ledger.md)
§4, which this paragraph contradicted from the day both were written. The code had always followed
the ADR — `checkDrift` is called on the shift screen and the `DriftedShift` component is fully
built — so the lock existed only in this sentence.*

The base is genuinely immutable **because a `DocumentVersion` is insert-only and trigger-guarded**,
not because anything is held shut. A human edit mid-Shift writes a new version; the old one's bytes
are untouched; the changeset still addresses coordinates that never move; and the fold refuses on
drift, so the person's edit wins. Refuse-on-drift is therefore a real path the interface has to
render, not a guard that never fires — which is what `DriftedShift` is for.

The lock was the more expensive option, not the cheaper one: it needed "Take back control" designed
*and* a release path for a sleep-killed run holding it for hours, with no live holder to ask. Stated
cost of not locking: a person who edits at 6 pm can discard a shift's work by accident, and is told
that is what happened rather than being told no in advance.

Propositum's store is authoritative. No filesystem path, no file watcher — a watcher reads a file
the user did not consciously hand over and is scoped by an `if` statement, which is the reasoning
that already rejected Playwright. Paste-in on creation and copy-out on any version, so the demo can
start from a document the user actually had.

No `kind` discriminator, no `currentVersionId` — the current version is the greatest
`versionNumber`. ~~Bytes are stored exactly as written.~~

**Amended 2026-08-10: bytes are stored normalised — one sentence per line — and no words are ever
changed.** `ProposedChange.startOffset` addresses the *normalised* base, because `diff()` and
`checkDrift()` both normalise before they hash or index. Storing raw bytes while hashing the
normalised form typechecks, reads fine, and fails much later as a drift refusal against a document
nobody touched. The promise that matters is intact and is the stronger half of the original
sentence: **Propositum never rewords prose the user authored.** Line layout is not wording; the
schema's own docstring already said so.
*Displaces:* Artifact · ArtifactKind · mimeType · File · Deliverable · WorkingCopy ·
DocumentCopy · Draft (as a table) · ArtifactStore. **Not** "note" — session notes are a real,
separate slice-0 concept.
**Consumer:** document — in the demo, "your proposal".

### DocumentVersion — *table, insert-only*
`id` (opaque cuid — **the identity**, because a revert produces bytes identical to an earlier
version so a hash is not unique and timestamps tie), `documentId`, `versionNumber`, `content` (full
snapshot, not a delta), `contentHash` (the fold's enforced precondition, never the identity),
`committedFromChangesetId` (nullable), `createdAt`.

A version comes into existence **only from a human act**: creating or pasting in a document, the
snapshot taken when a handoff is accepted, or a committed review. The worker's proposed text is
never a version — it is `materialise(base, changes, all-accepted)`, and storing it would create a
version that is never current and could be mistaken for the document's state.

It does **not** point at an AgentRun. The human's verdicts authored these bytes; the run is one hop
away via the changeset. A direct run FK would let a version be attributed to a run whose every
change was rejected.

No `parentVersionId` — no branching, so parent is `versionNumber − 1`.
*Displaces:* ArtifactVersion · Revision · Snapshot · Commit · Checkpoint · Copy.
**Consumer:** version — "Version 3", "the version you left".

### BaseVersion — *not persisted (a role)*
The single DocumentVersion every ProposedChange in one Changeset is addressed against and whose
bytes the fold splices. Denoted by `ContractScope.baseVersionId` and `Changeset.baseVersionId`.

It exists as a word because the invariant is load-bearing: intra-review offset shift **dissolves
completely** if the document is never mutated during review, which only holds if one immutable
version is the addressing target for the entire review. Without the word, a later session
re-derives it wrongly.

Never an entity. "Base" means addressing target; "parent" means lineage.
*Displaces:* original · the before document · source version · pre-edit version · parent (when
addressing is meant).
**Consumer:** "the version you left" (UI: "Before").

### Changeset — *table, insert-only*
`id`, `runId`, `baseVersionId`, `baseContentHash`, `headline` (one line, model-authored),
`createdAt`.

Computed **once by deterministic code at run end** from the run's completed `draft-section`
outcomes. The model proposes prose; deterministic code computes the changeset. Non-overlap is
**free by construction**, because each PlanStep targets a distinct BaseSpan resolved at
authorization time — not checked, and never merged.

Zero or one per run; a run that drafted nothing produces **no row**, and the shift report says so.
An empty changeset would carry a base and a hash addressing nothing.

**Open until a DocumentVersion cites it, then settled.** No verdict may be written against a settled
changeset's changes. That rule — not a ReviewSession entity — is what makes "re-running the fold
reproduces the committed bytes" an enforceable invariant rather than a slogan.

On base-hash mismatch: **refuse and tell the user the document moved.** Fuzzy re-anchoring is
explicit opt-in only and is not in slice 0. Silent misapplication is the worst failure mode
available — no error, wrong document.
*Displaces:* diff · Diff (as a type) · patch · patchset · edit set · proposal · suggestion batch ·
PR · ReviewSession.
**Consumer:** "the changes" — "6 changes · 3 sections". Never "changeset" in UI copy.

### ProposedChange — *table*
One independently reviewable replacement of one BaseSpan:
`id`, `changesetId`, `start`, `end`, `before` (exact base bytes — the single redundant verifier),
`after`, `label` (one line, imperative), `reason` (one sentence, why), `planStepId`,
`citedActionIntentIds`.

`reason` is denormalised on purpose: the one-minute re-entry list must render without touching the
ledger, and the reason must **survive rejection** — which it does automatically, because the row is
immutable and the verdict is a separate row. That is what H3 needs to be scorable.

`citedActionIntentIds` are validated against **this run's own completed read actions**; an id that
is not among them is dropped. That closes the provenance chain — sentence → change → plan step →
cited reads → ApprovedSource → ObservationEvent — as a join rather than as a free-text claim.

Dropped as derivable or constant: `kind`, `ordinal` (order by `start`), `significance`,
`headingPath`. Dropping `significance` removes the only model-facing enum in the document model.

No `move`: it needs two anchors, which breaks the single-address splice, and its similarity
threshold is an admitted guess. A move renders as a delete plus an insert.
*Displaces:* suggestion · edit · hunk · diff chunk · patch · redline · markup · comment ·
MoveChange · RewrittenBlock · ChangeGroup · Annotation.
**Consumer:** change.

### ChangeVerdict — *table, append-only*
`id`, `changeId`, `verdict: accepted | rejected | edited`, `editedText` (iff edited), `decidedAt`.

Never updated, never deleted. The current verdict is the most recent row; a change with **no row is
undecided** and is not applied by the fold. Accept order is commutative and undo is a verdict flip,
not an inverse patch.

**Only a human writes one.** No model, worker run or reviewer run may.

`edited` is not decoration: H2 scores generated work as accepted / edited / rejected, so collapsing
edit into accept makes the hypothesis unmeasurable.

No `decidedBy`: slice 0 has one local user and no authentication, and "a verdict is human-authored
by definition" is a stronger invariant than a column that could be filled with an agent id.

Renamed off "ReviewDecision" because **"review" and "reviewer" belong to the model pass.** Two
things named review whose defining property is opposite authorship is the most expensive collision
available here.
*Displaces:* ReviewDecision · approval · acceptance · resolution · vote · accepted flag.
**Consumer:** Accept / Reject / Edit.

### ReviewFinding — *table*
The reviewer AgentRun's advisory output: `id`, `runId`, `changesetId`, `changeId` (nullable),
`verdict: within-agreement | outside-agreement | unclear`, `note`.

**Explicitly non-authorizing.** It never applies, never blocks, never sets a default, and never
feeds the gate — a model reading page-derived prose must not regain influence through the back door.
The moment a reviewer verdict gates presentation or an acceptance default, "a successful injection
can change what the worker attempts, never what it can touch" stops being true.

It exists because the brief mandates a reviewer pass and without it that pass has nowhere to speak.
Scope adherence is scored from deterministic fields, not from this.
*Displaces:* ReviewVerdict · ReviewScore · verificationStatus · compliance · ReviewThread.
**Consumer:** "A second pass flagged this" — beside the change, never as a decision.

---

## 6. Re-entry

### DecisionNeeded — *table*
One thing the worker judged it could not safely decide:
`id`, `runId`, `planStepId`, `question`, `whyItMatters`, `citedActionIntentIds`, optional BaseSpan.

The centrepiece of the initial supported scenario — Propositum completes the draft **and** identifies
one strategic decision — which is only consistent with the run continuing. So this is **not a halt
and not a gate refusal.** It is not an ActionIntent (nothing was proposed and refused), not a
ChangeVerdict, and not an `openThread` claim (that is a pre-handoff strand).

Naming it is not new abstraction: the brief already mandates "human decisions required" as a
ShiftReport field, and without a name the demo's headline output is unrepresentable.

A declared decision-class taxonomy is deliberately not built: "which partner tier to propose" is not
plausibly enumerable in advance, so the mechanism would never fire on real work. H3 therefore scores
model self-report here, and the results must say so.
*Displaces:* open question · unresolved question · RaisedQuestion · DecisionClass · ApprovalClass ·
requiresHumanDecision · blocker · escalation.
**Consumer:** What I need from you.

### ShiftReport — *table*
The re-entry artifact for one Shift, written once **in the app process when the human returns** —
never by an AgentRun. A report producible only by a live Runner cannot exist on `interrupted`, the
outcome that most needs one.

One row per Shift holding a single model-authored narrative line. **Every other section is a
deterministic rendering of durable rows:**

| Section | Source |
|---|---|
| What I completed / didn't get to | the ledger and the run's plan steps — never a counter |
| The changes | Changeset + ProposedChanges |
| What I didn't do, and why | refused ActionIntents |
| What I missed | CaptureGaps |
| What I need from you | DecisionNeeded |
| Where I stopped | AgentRun.status + terminalReason |

If the narrative boundary fails, the report renders without it. The narrative is a summary; the
ledger underneath is the receipt. A model summarising its own ledger can soften or omit, and the
brief forbids anthropomorphic fluff concealing uncertainty.

The re-entry screen must render **without** a review, because on `interrupted` there may not be one.
*Displaces:* re-entry screen (as an object) · summary · digest · ShiftSummary · standup.
**Consumer:** While you were away.

---

## Banned words

**From the brief, in all consumer copy:** spawn agent · orchestration graph · inference confidence
threshold · context window · tool call · execution trace.

**Added here, in code, schema, prompts, ADRs and UI unless noted:**

| Banned | Write instead |
|---|---|
| `Task` | PlanStep · ActionIntent · AgentRun |
| bare `action` | ActionKind (a type) or ActionIntent (an instance) |
| bare `Objective` | the reading's objective claim · the contract's stated objective |
| `ActionRecord` | ActionIntent · ActionOutcome · ActionStatus |
| `SessionState` | SessionReading |
| `Artifact`, `ArtifactVersion` | Document, DocumentVersion |
| `verificationStatus` | `ActionOutcome.scopeVerdict` |
| `WorkingCopy`, `Draft`, `DocumentCopy` | `Document.workingText` (a field) |
| `ReviewDecision` | ChangeVerdict (human) · ReviewFinding (reviewer) |
| `outcome` as a column name | `disposition` · `terminalReason` |
| `actor` | `observedBy` · `SessionClaim.origin` |
| `Intention` as a field or type | prose only — allowed in VISION.md |
| copy, patch, hunk, diff chunk, changeset, anchor, offset, fold, materialise, base version, commit, merge | *(UI copy)* changes · this change · the version you left · Preview · Accept · Reject · Edit |
| ledger entry, agent run, job, orchestration, allowlist | *(UI copy)* what I did · Propositum · what Propositum can see |

**Three verbs that must not be confused:** the gate **refuses** · the human **rejects** · the model
**declines**.

---

## Deliberate overrides of the founding brief

Each of these contradicts the brief. The brief's own rule is that the later document wins and should
say that it does.

1. **`ActionRecord` is retired**, not renamed. Its four parts split into ActionIntent (before) and
   ActionOutcome (after), with ActionStatus as the derivation. One row holding a reason and a result
   forces an UPDATE, which append-only forbids.
2. **`SessionState` is renamed `SessionReading`**, to stop two terms both reading as "the session's
   state" from colliding in the authorization path.
3. **`Artifact` / `ArtifactVersion` become `Document` / `DocumentVersion`.** Slice 0 has one content
   type; a supertype with one subtype is speculative generality.
4. **`ExecutionPlan` is an ordered list, not a bounded graph**, and it is a computed view, not a
   table.
5. **The Output control is a permission, not a presentation mode.** The brief's "Suggestions only /
   Edit a copy" becomes `suggestions-only` / `draft-changes`, gating whether `draft-section` is in
   `allowedActionKinds` at all. Five controls survive; one of them now enforces something.
6. **Continuation and redirection are out of slice 0.** The brief's MVP boundary lists redirection
   and continuation; the map's destination sentence stops at accept/reject, and the map is the newer
   and more specific document. Deferred, not cancelled.
7. **"Copy" is banned from the interface.** Three brief passages say "edit a copy". Nothing is
   copied — the Changeset is the copy, and review materialises a projection on demand.
8. **The page-text retention budget is a published product constant**, not an implementation
   detail: title, cleaned URL, deliberate selections verbatim, and at most 2,000 characters of
   readable article text per approved source.

---

## Decisions taken

Closed 2026-08-06 on [#2](https://github.com/smukhyala/propositum/issues/2), after a
propose-critique-synthesise pass over six domain-overlap clusters.

| Decision | Resolution | Where it binds |
|---|---|---|
| **Page text** | Selections verbatim + a bounded 2,000-character excerpt per approved source. The number is declared in `docs/SECURITY_AND_PRIVACY.md`. | `UntrustedContent`, `ObservationEvent`, the fixture corpus |
| **Inferred constraints** | Display-only, as attributed quotations beside the agreement. Structurally barred from `StatedIntent`. The human retypes anything they want honoured. | `SessionClaim`, `StatedIntent`, the injection boundary |
| **Output control** | A real permission: `suggestions-only` removes `draft-section` from `allowedActionKinds`. | `AutonomyControls`, `ActionKind`, `ContractScope` |
| **Continuation** | Slice 0 ships one Shift per session; re-entry ends at accept / reject. | `Shift`, `ShiftReport` |

**Why the page-text decision is the expensive one to revisit.** Events are append-only, so changing
the budget invalidates every fixture already captured and forces the corpus to be recorded again.
The other three are edits to a gate, a schema barrier, and a scope line.

---

## Known risks this vocabulary does not remove

Recorded so they are found deliberately rather than discovered.

- **`unknown` is the routine ActionStatus, not the exception.** Under "a local worker stops when the
  Mac sleeps", most slice-0 shift reports will carry a trailing action Propositum cannot adjudicate.
  The vocabulary makes this honest; it does not make it reassuring.
- **`ReviewFinding` has no effect.** Scope adherence is scored from deterministic fields, so the
  reviewer agent is close to decorative in slice 0. The brief mandates it anyway. Say so plainly
  rather than implying the second pass is load-bearing.
- **There is no cross-session continuity.** The objective does not survive a session, and the
  brief's Project "goals" is deliberately unmodelled. A second session starts cold — which the
  product's own shift-change metaphor implies otherwise.
  *Partly addressed 2026-08-11.* `matchProject` joins a new sitting to the project it recognises,
  so the approved sources and the document survive a session. **The objective still does not, and
  must not**: a stale objective inherited quietly by the next sitting is worse than a cold read,
  because nothing on screen would say it had been. What carries forward is where the work lives,
  never what Propositum thinks it is for.
- **Locking the document for the duration of a Shift is an untested product cost.** It buys a
  genuinely immutable base, and it tells the user who opens their laptop at 6pm to fix a typo *no*.
- **`guidance` is unenforceable prose beside enforced fields**, held honest only by a UI label.
  Labels erode. The eval must score a guidance violation as bad work (H2), never as a bad stop (H3).
- **One PlanStep is one action, and the plan is never revised mid-run.** The first fixture where the
  worker learns something in step 2 that invalidates step 1 will expose this.
- **~~The SDK enum finding is unverified~~ — VERIFIED 2026-08-06** ([#3](https://github.com/smukhyala/propositum/issues/3)).
  `enum`, `const`, `default`, `minLength`, `maxLength` and `pattern` are all dropped and folded into
  `description` as prose; `z.record()` collapses so the empty object is the only legal value. The
  grammar enforces **shape only**. Locked in by `tests/schema-transformation.test.ts`, which will
  fail if an SDK or Zod upgrade changes it. Original risk text follows, now settled:
  Three model-facing enums remain — `SessionClaim.kind`, the objective confidence band, and
  `ActionKind` in worker proposals. All fail closed, so nothing unsafe reaches persistence either
  way; if the finding is wrong we are paying repair turns we did not need.
- **Budget promises time, not money.** The most common stop in a real overnight run — "I ran out of
  time" — is the one the user can least interpret.
- **This is 38 terms.** Small against nine brief objects, six model boundaries, an append-only
  ledger, a diff model and a policy gate. Not small in absolute terms. Roughly six earn their place
  only marginally, and should be the first cut if the vocabulary starts to feel heavy.
