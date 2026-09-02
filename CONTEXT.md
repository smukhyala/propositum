# CONTEXT.md — Propositum's ubiquitous language

This is the vocabulary. Every schema, prompt, table, ADR and UI string uses these words and
no others. Where this document contradicts `docs/FOUNDING_BRIEF.md`, this document wins —
the brief says so itself, and the specific overrides are listed at the end.

Organised by lifecycle, mirroring the pipeline:
**observation → inference → handoff → execution → documents & review → re-entry.**

**Amended 2026-08-16 ([ADR-0011](docs/adr/0011-intention-above-worksession.md)): two terms now sit
above that pipeline rather than inside it.** `Intention` and its computed `IntentionState` open §1
because an Intention precedes observation — a person may write one before Propositum has seen
anything — and there is no §0. The pipeline is otherwise unchanged.

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
- ~~Execution is reversible: versions only, and the base is immutable for the whole review.~~
  **Amended 2026-08-11 ([ADR-0010](docs/adr/0010-acting-in-the-browser.md)): execution is
  reversible by default; an irreversible capability may exist only as a landing `ActionKind`,
  which the gate refuses unless the human acknowledged it individually — not via a dial — and
  whose ShiftOutcome is reported rather than reviewed.**
- Agents are ephemeral. Sessions, contracts, documents and ledgers persist.
- **Bare `action` and bare `Objective` are banned.** Write `ActionKind` or `ActionIntent`;
  write "the reading's objective claim" or "the contract's stated objective".
- **A calendar recommends; it never grants** *(added 2026-08-18,
  [ADR-0014](docs/adr/0014-reading-free-busy.md))*. A `BusyInterval` may be OFFERED beside a dial a
  person then sets — it does not pre-fill it, and the dial reads the same as it would with no
  calendar until somebody presses the offer. It may not reach `compilePolicy`, `EnforcedPolicy` or the gate, may not raise or widen
  anything, and is never persisted. This is the first thing in the vocabulary that comes from neither
  our code nor the person, so the rule the first line of this list states about models is restated
  here about a third party rather than assumed to generalise. *(2026-09-01,
  [ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md): unchanged for the read. A
  `CalendarHold` is not the calendar granting — it is a write a ratified contract granted, going the
  other way, and the two never trade jobs.)*

### Why the reversibility rule was weakened, and what holds it up now

This is the largest concession in the vocabulary and it deserves the most argument, because the
sentence it replaces was doing more work than any other line in this file.

The original rule was **structural**: nothing Propositum could do was hard to undo, because the only
thing it could do was propose text against an immutable base. Reversibility was not enforced, it was
a property of the shape — there was no capability whose exercise left a mark anywhere but in a row a
person could reject. That is the strongest form available, and it is gone the moment a landing
`ActionKind` exists, because a sent message is sent. No ledger un-sends it.

**What is not being claimed.** That the pause is as good. It is not. `docs/adr/0010` opens by saying
so: an absence cannot be misconfigured and a pause can be clicked through. Anyone reading this rule
as "still reversible, with a confirmation step" has read it wrong.

**What is being claimed**, in four parts, each of which is checkable:

1. **Irreversibility is decided by the browser, not by a model and not by a page.** An action is
   irreversible when Chrome is about to send a non-`GET` request, or a request outside the
   contract's approved sources. The method is attested, so page text cannot forge it. The English
   lexicon over an element's accessible name is **escalation-only** — it can turn `ordinary` into
   `requires-confirmation` and never the reverse — so the page's own words can make Propositum more
   cautious and never less.
2. **A dial can never grant it.** `AutonomyControls` has no setting that pre-approves a landing
   action, and there is no free-text field that could be read as one. The acknowledgement is per
   action, in a `ConfirmationVerdict` written by a human, and the run that asked is already over.
3. **The absence of an acknowledgement is an ordinary refusal**, not a pending state.
   `ActionIntent.authorization` stays closed at `allowed | refused`. Expiry therefore produces no
   verdict row and no permission — there is no path from elapsed time to *yes*.
4. **A `landed` outcome is never offered a verdict.** The interface says *"This already happened,
   outside Propositum"*. It does not render a Reject button that cannot reject, because the one
   thing worse than an irreversible action is a screen that implies it was not.

**The cost, stated as a cost.** Two mechanisms now stand where a shape used to. Mechanisms are the
kind of thing that erode, and the erosion here would be silent: `tests/architecture.test.ts` still
asserts no `sendMessage` function exists, that assertion still passes, and it no longer means what
it was written to mean. A future reader who checks the test and stops has been misled by a green
tick. That is written down in ADR-0010's first paragraph and here, in both of the documents someone
would consult.

---

## 1. Observation

### Intention — *table*
~~**Specified 2026-08-16 by [ADR-0011](docs/adr/0011-intention-above-worksession.md), and not yet in
`prisma/schema.prisma`. This entry is a specification rather than a description**, and the first
sentence of it says so rather than the twenty-fifth. There is no `Intention` model and no
`intentionId` column today; the columns below are owed, and reading them as a report of the database
is the mistake §4's claim fence is already there to name.~~
**Amended 2026-08-16, later the same day: the schema landed, and this entry is now a description.**
`model Intention` is in `prisma/schema.prisma` with the seven columns below, and so are both nullable
foreign keys. The struck sentence is kept rather than deleted because the transition it marks is the
one ADR-0011 told a reader to check — *until they are in `prisma/schema.prisma`, this ADR is a
specification rather than a description* — and a reader has to be able to see which side of it they
are on.

One durable statement of what a person is trying to accomplish, written or ratified by that person:
`id`, `projectId` (nullable, and `@unique` — that index is how *at most one per Project* is actually
held), `objective`, `definitionOfDone`, `completedAt` (nullable), `createdAt`, `updatedAt`.

**Human-ratified only, and that is the whole of it.** A person creates one and a person edits one.
No detector writes one, no model boundary writes one, and **no model-facing schema has a field that
could carry one** — the same structural bar `WorkOffer` stands behind, for the same reason. It is
not evidence, it carries no provenance, and inference never reads it: `matchProject` gets no new
input from it and no SessionReading consults it.

**Ratified is not the same as written, and the gap is real.** The sentence a person accepts at the
offer screen was composed by a model from page titles and search terms; accepting a plausible
sentence is a weaker act than typing one. What is structural is that **no model writes the row** —
authorship of the record, not authorship of the words in it.
[`docs/VISION.md`](docs/VISION.md)'s *Honest limits, today* carries the rest, and is the version to
trust wherever this entry reads stronger.

**`definitionOfDone`, not `definitionOfSuccess`** — which is the direction document's phrase.
`StatedIntent` already owns the field name and an Intention is what a `StatedIntent` restates; two
words for one concept a lifecycle stage apart is exactly what the banned-words table exists to stop.

**Mutable, and it gets no append-only triggers.** `Project`'s reasoning verbatim: it holds no
inference and carries no provenance, so nothing about it is append-only. No `REQUIRED_GUARDS` entry,
no `triggers.sql` change, no row in `tests/append-only.test.ts`'s hand-maintained checklist.
Rewriting the sentence is the correction channel and there is no second one.

**At most one per Project** ([ADR-0011](docs/adr/0011-intention-above-worksession.md)) — a deferral,
not a model. It is safe only because the hard question — *which Intention does this sitting belong
to?* — never gets asked. The second Intention per Project is where that stops being true, and
`matchProject` is already known to sometimes fold two subjects into one. *Held as a unique index on
`projectId` (2026-08-16), so the writer that would mint a rival is refused by the database rather
than trusted not to.* The corollary the code now holds everywhere a sitting begins or moves: **a
`WorkSession` points at its Project's Intention, or at nothing** — which is why re-filing a sitting
sets `intentionId` alongside `projectId`, and why splitting one out sets it to null.

~~**The schema this entry authorises is exactly one mutable table and two nullable foreign keys**
(`WorkSession.intentionId`, `HandoffContract.intentionId`), by ADR-0011 and by nothing else. If more
ever exists under this name it was not authorised here. The *less exists* case is the one that holds
right now, and it is stated in this entry's first line rather than left to be discovered here.~~
**Amended 2026-08-16: what was authorised is what exists.** One mutable table and the two nullable
foreign keys, and nothing else under this name — no triggers, no `REQUIRED_GUARDS` entry, no status
column. The *less exists* case no longer holds; the claim to check is now equality rather than
shortfall.

**Delete has a limit, and it is in the storage layer rather than in a rule.**
`HandoffContract.intention` is declared `onDelete: Restrict`, so **an Intention that any
HandoffContract points at cannot be deleted at all** — deliberately, because the alternative
(Prisma's default `SetNull`) is an UPDATE, and on an accepted contract
`handoff_contract_frozen_once_accepted` aborts it with a P2003 that names a relation problem which
does not exist. See and edit are unrestricted; delete is not, and whoever writes
`IntentionRepository.delete` inherits that rather than discovers it.

Distinct from `ActionIntent` and `StatedIntent`, which are a prefix away and share nothing with it.
`intentId` in the runtime is an `ActionIntent`'s id in all 141 of its occurrences and never an
Intention's. **The collision is accepted, not fixed**, and ADR-0011 argues it at full size rather
than talking it down.
*Checked against the banned words:* not bare `Objective` — that ban stands, write "the Intention's
objective" — not `Task`, not `Goal`, not `ProjectGoal`, not `Draft`.
*Displaces:* Goal · Mission · ProjectGoal · OKR · north star · desired outcome (as a stored field) ·
persistent process · PersistentIntention · IntentionRecord · Objective (as a table).
**Consumer:** what you're working toward.

### IntentionState — *computed view*
`working | delegated | needs-you | sleeping | done`. Derived, never stored — `EnforcedPolicy`,
`Shift` and `ActionStatus` set the precedent and the argument is theirs: **two stores for one truth
is exactly how a UI comes to display something the gate cannot enforce.** Every fact it reads is
already a durable row.

| Member | Derived from |
|---|---|
| `working` | a live WorkSession on this Intention, phase `observing` |
| `delegated` | an accepted HandoffContract on it whose Shift has not ended |
| `needs-you` | an unanswered ConfirmationRequest, ~~a DecisionNeeded,~~ **a DecisionNeeded with no DecisionVerdict — un-struck 2026-08-26,** or a held ShiftOutcome with undecided proposals |
| `sleeping` | none of the above, and `completedAt` is null |
| `done` | `completedAt` is set — by a person, and only by a person |

**Five members. There is no `waiting`, and it is not an omission to tidy up later.** `waiting` means
*progress depends on an external event or dependency*, and nothing in this system can produce an
external event: `ObservationEvent.sessionId` is required with a single ledger writer, so **no event
outside a sitting can be persisted at all**, and `ExternalEvent` is on the do-not-build list. A
member nothing can reach is a promise the interface would render and the data could never keep. It
arrives with event ingestion, and `docs/ARCHITECTURE.md` records it there rather than in the union.

**`sleeping` is the honest common case and will read like a bug.** With one sensor, no external
events and one live session at a time, most Intentions compute to `sleeping` most of the time. That
is the true answer. Making the screen more interesting than that means inferring, which is the one
thing an Intention exists not to do.

`now` is a parameter, never read from the clock: `src/domain/**` may never call `Date.now()` or
`new Date()`, and `tests/architecture.test.ts` enforces it by grepping source text.

**The `DecisionNeeded` row is struck, dated 2026-08-16, in the wave that put the word on a screen.**
The rule was right and the fact is not available: a `DecisionNeeded` has no answered, resolved or
verdict column, nothing deletes one, and the contract carrying it never leaves `accepted` — so the
count can only ever go up, and `needs-you` outranks everything. One question raised by one Shift put
**Needs you** on that Project's front door permanently, linking to a note where nothing could be
done about it. `factsForEveryProject` therefore reports zero and argues it there; the rule stays in
`intentionState` because it is the right rule for the row, and it becomes reachable the day the row
can be answered. **What that costs is a missed `needs-you`** — a Shift that stopped to ask and
produced nothing else now reads `sleeping` — and ADR-0011 is explicit that a missed one is the
expensive direction. It is taken because the alternative was a word that is never right again after
the first question. The unblock is a durable human act on the note: `ShiftReport.finishedAt`, or the
fourth `*Verdict` this vocabulary already has three of.

**Amended 2026-08-26 — the second of those two, and the paragraph above is left whole because it is
the argument that earned it.** [ADR-0022](docs/adr/0022-the-fourth-verdict.md) adds `DecisionVerdict`,
so `openDecisions` counts DecisionNeeded rows with no verdict, the count can go **down**, and
`needs-you` stops being a word that is never right again after the first question. What the struck
version got right and this one keeps: the rule was always the right rule for the row. It was
unreachable, not wrong.

~~**Computed by `src/domain/intention/state.ts` as of 2026-08-16, and rendered by nothing yet.** The
function and the five consumer labels exist and are tested; no screen calls either, and
`tests/reachability.test.ts`'s *deferred, and asserted as deferred* block pins that absence so the
suite turns red the day one does. Until then the table below is a description of the function and a
specification of the interface, and ADR-0011's softest claim — *on screen wherever it is used* — is
owed rather than kept.~~ **Amended 2026-08-16, in the wave that landed the caller — which is what
the struck sentence's own tripwire asked for.** `src/app/page.tsx` renders the consumer label beside
every row on the front door and links to the re-entry note on `needs-you`; the derivation is
`frontDoorRow` in `src/server/front-door.ts`, and the reachability claim moved out of *deferred, and
asserted as deferred* into *the safety machinery is reachable from the product*, where it now names
`front-door.ts` for both needles. ~~**The softest claim is narrower rather than kept:** what is still
owed is the Intention-sourced pre-fill branch on the agreement screen, which must say *when* those
words were written and cannot until `ContractDrafted` can carry that.~~ **Amended 2026-08-20
([ADR-0017](docs/adr/0017-continuing-an-intention.md)): that branch landed, and the softest claim is
kept.** `ContractDrafted.words` is a two-armed `PrefilledWords` discriminant whose `'your-intention'`
arm carries `Intention.updatedAt` as `writtenAtEpochMs`; `draftContract` fills that arm when
`WorkSoFar` says this is not the first sitting under the Intention, and `WhereTheWordsCameFrom` in
`src/ui/agreement.tsx` prints the month above the two fields it accounts for. **What made this
worth striking rather than quietly updating** is that two documents were already pointing here:
ADR-0017 and `docs/ARCHITECTURE.md` §1 each say the debt closed and each name *this entry* as the
place it was recorded, so a reader following either cross-reference landed on the sentence
contradicting the document that sent them. A glossary is where the corpus keeps its one copy of a
claim, and nothing checks its prose. Note also what a grep cannot
see — a mutation that computed a state and discarded it kept the whole suite green, which is why
`tests/front-door.test.ts` asserts the consumer label rather than the presence of a call.
*Checked against the banned words:* not `status` (displaced), not `SessionState` (that is
`SessionReading`), not `phase` — `SessionPhase` is per sitting and is a different thing.
*Displaces:* IntentionStatus · status · lifecycle state (as a column) · state machine · stalled ·
blocked · waiting (as a member).
**Consumer:** Working · Propositum is on it · Needs you · Sleeping · Done.

### FirstRun — *computed view, like IntentionState*
The app's launch while setup is unfinished, and the surface that answers it: the page at
`/first-run`, rendered in the window the tray opens. Derived from five facts — the key, a paired
extension, an approved source, a composed offer, the phone — never a stored cursor; refreshing,
arriving by a link and coming back tomorrow all land in the same place, because there is no place
but the truth. Decided in the todo 09 design sitting, 2026-08-29, and built against
[ADR-0028](docs/adr/0028-a-capped-key-ships-in-the-bundle.md): when a tester build carries the
capped bundled key, the key fact is simply true and the person never reads about API keys at all.

**Displaces:** welcome · onboarding · wizard · setup flow · getting started. A wizard has a cursor;
this has facts. The consumer wording is the shipped one — *Finish setting up* — and the consent
verbs on its cards are the ones already ratified elsewhere: **Pair** (extension, phone),
**Connect** (calendar), and Chrome's own **Allow**, which only the person can click. Its three consent cards — the extension, the calendar, the phone — are **cards, not
sources**: `ApprovedSource` keeps that word, and the calendar is deliberately not an observation
source of any kind (`BusyInterval`). The shape
answers [ADR-0019](docs/adr/0019-disclosure-and-what-may-never-fold.md) (a decision needs a page)
and ADR-0023 prohibition 5 (the tray decides nothing): the tray opens a window, and everything in
the window is the app's own page deciding on the app's own facts.

### WorkSoFar — *computed view*
What has already happened under one Intention, folded from rows and shown to a person **before** they
start the next sitting. Sittings so far and when the last one ended · sources already approved ·
documents in play · what previous Shifts produced, by ShiftOutcomeKind · how each decidable unit was
decided · which DecisionNeeded are still open · where the last run stopped.

**Deterministic, and that is the property rather than an implementation note.** No model call, no
inference, no prose. Every member folds a row a person wrote, approved, accepted or rejected —
which is what lets a durable statement of prior work exist at all without reopening ADR-0011. A
stored or model-written version is a different object and needs that ADR reopened;
[ADR-0017](docs/adr/0017-continuing-an-intention.md) says so in its own *Revisit when*.

**Computed, never stored**, on the precedent `EnforcedPolicy`, `Shift`, `ActionStatus` and
`IntentionState` all set: two stores for one truth is how a UI comes to display something the gate
cannot enforce. There is no `WorkSoFar` column and no `WorkSoFar` table.

**It may inform a person; it may not inform a decision.** Same posture as `BusyInterval` under
[ADR-0014](docs/adr/0014-reading-free-busy.md), and stated here for the same reason: it does not
reach `compilePolicy`, the gate, or any prompt. It renders on the accept screen beside what
`carryOnCandidate` already shows, on the project screen, and it informs the words pre-filled into a
`StatedIntent` that a human then ratifies.

**What it is not.** Not `SessionReading` — that is one sitting, model-inferred, evidence-bearing and
cold every time, and it stays that way. Not the Intention itself, which is the human-ratified
sentence this folds work *underneath*. Not a prediction: nothing here says what comes next.

*Checked against the banned words:* not `SessionState` (that is `SessionReading`), not `Task`, and
deliberately not anything containing `Progress` — Principle 1 is *activity is not progress*, and a
fold over activity is exactly the thing that must not borrow the word.
*Displaces:* cross-session summary · memory · context carryover · the project's history · what you
were doing last time.
**Consumer:** Where you left off.

### Project — *table*
The single durable workspace (`id`, `name`, `createdAt`). Owns every ApprovedSource, Document and
WorkSession. No objective, no status, **no free-text description** — a description that inference
reads is a project goal in disguise and would silently pre-answer whether the human declares what
they are working on.

~~The user creates it explicitly.~~ **Amended 2026-08-11
([ADR-0009](docs/adr/0009-composed-offers.md)): a human never creates one.** The detector finds a
thread, a model names the subject, and accepting the offer creates the project under that name —
there is no form, and `createProject` is not a server action. The schema is unchanged; what went is
the human act of filing. The founding brief's exclusion of *automatic project recognition* is
reversed outright here, for ADR-0008's reason one step on: a person who must first create a
workspace has been asked to know in advance that what they are about to do is worth recording, and
that is the bet that already lost.

**Two corrections make that defensible, and are therefore part of the term rather than
decoration:** the name is editable, and a sitting can be moved to another project or split out into
its own. Rows are mutable for exactly this reason — a Project holds no inference and carries no
provenance, so nothing here is append-only.

**Filing is deterministic.** `matchProject` compares the subject's words to each existing
project's, and joins only on at least two shared words covering 0.6 of the smaller set — so a
subject picked up again on Thursday continues Tuesday's project rather than founding a duplicate. A
model naming the match would be a model deciding where someone's work is filed. The thresholds are
guesses set before real data, tuned toward splitting: a false split is one click, a false merge
silently inherits the wrong sources and the wrong document.

The no-description rule matters **more** after this change, not less: the offer boundary now runs
before any person has said anything at all, so the only thing auto-naming may write is `name`.

**A Project may own an Intention, and the no-description ban is untouched** *(added 2026-08-16,
[ADR-0011](docs/adr/0011-intention-above-worksession.md))*. At most one, and it lives on the
Intention rather than here: there is still **no objective, no status and no free-text description on
this row**. The ban survives because its reason survives — it forbids *a description that inference
reads*. An Intention is human-ratified and — the half that actually carries the ban — **never read
by the detector**; `matchProject` still compares subject words to `name` and gains no new input.
Auto-naming still writes `name` and nothing else, and ~~a Project with no Intention is the ordinary
case, because a Project is created by accepting an offer and an Intention is created by a person
typing or accepting one.~~ *amended 2026-08-16, when the writer landed:* **accepting a composed offer
creates both in the same click** — the Project from the subject the detector named, the Intention
from the two sentences that were on the screen — so a Project **with** an Intention is now the
ordinary case for work started that way. A Project **without** one stays perfectly legal and is what
every project created before that ADR has, what the degraded accept (nothing composed, so nothing was
on screen to ratify) produces, and what `splitIntoNewProject` produces. Null still means *nobody
stated an Intention for this*, and nothing backfills it.
*Displaces:* Workspace · Space · Folder · Board · Account · Client · ProjectGoal.
**Consumer:** Project.

### WorkSession — *table*
One explicitly started and explicitly ended stretch of desk time in one Project
(`id`, `projectId`, `intentionId?`, `phase`, `startedAt`, `endedAt?` — ~~`intentionId?` alone is
*specified 2026-08-16 by [ADR-0011](docs/adr/0011-intention-above-worksession.md) and not yet in
`prisma/schema.prisma`*; the other five are there today~~ *amended 2026-08-16: all six are in
`prisma/schema.prisma`*). ~~A **sitting, not a single
intention**: it may contain several strands and the reading names the dominant one.~~ **Amended
2026-08-16 ([ADR-0011](docs/adr/0011-intention-above-worksession.md)): still a sitting and not a
single intention — and the sentence is now literal rather than figurative.** It may still contain
several strands and the reading still names the dominant one. What changed is that *intention* is a
noun with a table behind it, so a sitting may point at **one** Intention, at none, and never at two.
`intentionId` is nullable and **nothing backfills it**: every session recorded before this ADR keeps
a null, which is the honest value, because nobody wrote an Intention for them. It survives handoffs,
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

**Amended 2026-08-17 ([ADR-0013](docs/adr/0013-authored-labels-and-exit-type.md)): exit type is not
a kind either, and the reason is the `bounced` reason applied honestly rather than waved through.**
ADR-0013 carries *how a page was left* on the ambient path — a small closed enum, ~~roughly
*moved on · closed · went back · switched away · unknown*~~ **exactly `hidden · left-cached ·
left-unloaded`, and there is deliberately no `unknown`** *(corrected 2026-08-17, the day the line
was written: the struck list named five members for a three-member set, split `left-unloaded` into
two values the code says it cannot separate, and invented the catch-all `EXIT_TYPES` exists to
refuse)*. It is tempting to read that as the
member this list has always been missing, sitting between `switchedAway` and `returnedTo`. It is
not, for two reasons and the second is the load-bearing one:

- **It is a value on a leaving, not a leaving.** The event is that a page was left; the exit type
  says *how*. Making it a kind would put a modifier where a noun goes, and `switchedAway` would
  then be both a kind and a value of the kind beside it.
- **One of its members has `bounced`'s defect exactly.** ~~*Went back*~~ **`left-cached`** is a fact
  about the **next** navigation, attributed backwards to the page that was left: it says only that
  Chrome kept the document, which is the precondition for an instant return and not the return
  itself — `content.js` says so about itself in as many words. On the ambient path that is fine —
  the buffer is in-memory, not append-only, and a later observation may refine an earlier one. In
  this table it is not: an `ObservationEvent` is immutable and gapless, and a row that has to be
  corrected by something that happens afterwards is the thing `bounced` was refused for. **The
  refusal stands and now has a second instance rather than an exception.**

So `ObservationKind` gains no member here. Whether an exit type survives the fold into the ledger
when a person accepts an offer is a schema question, and the answer this entry binds is only that
it cannot arrive as a kind.
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

**Amended 2026-08-17 ([ADR-0013](docs/adr/0013-authored-labels-and-exit-type.md)): the opening
sentence says *"any value a page could have authored"*, and that is now a description of the common
case rather than the boundary.** An `AuthoredLabel` — the name a person typed on their own tab
group — is not page-authored by any reading, and it lives under `untrusted` anyway. The rule in the
block quote is unchanged and is what makes that coherent: it is a statement about the **channel**,
not about the author. A value that arrives without a human reading it at the moment it arrives goes
under the key, whoever wrote it. Three specifics, because "typed by the person, therefore fine" is
the argument this will be attacked with:

- **A person can paste.** A label copied out of a page is a page's words wearing a person's
  authorship, and nothing downstream can tell them apart.
- **`guidance` is the precedent, and it points the strict way.** `guidance` is human-typed only and
  is still guarded harder than anything else here — its safety comes from being retyped and
  re-ratified per contract, not from having been typed once. A tab group label is a sentence
  somebody wrote weeks ago about something else and has not re-read.
- **Authorship is not consent to be followed.** The person named a group of tabs. They did not
  write an instruction to a worker, and the datamarking is what keeps a model from reading it as
  one.

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

**What this budget does not govern** *(added 2026-08-11,
[ADR-0010](docs/adr/0010-acting-in-the-browser.md))*. `EXCERPT_BUDGET_CHARS` is a promise about what
Propositum retains from a person's **own browsing**. An agent acting under a ratified contract reads
whole accessibility trees, which are ten to a hundred times larger, and keeps them as ActionEvidence
under a second published constant, `SNAPSHOT_BUDGET_CHARS = 60_000`. The two ledgers are disjoint —
nothing in ActionEvidence is read by inference, joined to an ObservationEvent, or rendered on a
session timeline, and it is swept within seven days. Without that distinction written down, the
published sentence above becomes false the day an agent ships, silently, in the documents whose
entire job is being true.

Both budgets live in `src/model/untrusted.ts` and are selected **by name** at the one `datamark()`
call site — `{ budget: 'excerpt' | 'snapshot' }`, never by a number. A numeric parameter would make
the budget a caller's decision, which is exactly what "a product constant, not an adapter tuning
knob" denies, and a third budget could then be invented at a call site with no doc change. One
construction site, one brand, two published promises.

*Displaces:* TrustTier · Trust · trustLevel · sanitized · safe · clean · page-derived (as a
stored value) · provenance (in the trust sense) · full-text capture · page scrape.
**Consumer:** **none — this concept has no good consumer word, and that is a finding, not a gap
to paper over.** The UI shows the source link and the attributed quote instead of a trust label.

### AuthoredLabel — *value object, not persisted until accepted*
*(Added 2026-08-17 — [ADR-0013](docs/adr/0013-authored-labels-and-exit-type.md).)*

A short name **a person typed for their own work**, read rather than inferred. One source in slice
0: the title on a Chrome tab group containing a page ambient capture is already watching. It rides
the ambient path beside the cleaned URL and the title, ~~under `untrusted`, and it is datamarked
before it can reach a model~~ **as a plain field on an `AmbientObservation`, and it reaches no model
at all**.

*(Struck and corrected 2026-08-17, the day it was written. There is no `untrusted` key on
`AmbientObservation` and no `datamark()` call on this value — the shipped containment is stronger
than the one described: the label is not an input to any model boundary, so there is no prompt for
it to reach marked or unmarked, and `tests/reachability.test.ts` forbids the identifiers appearing
in `name-thread.ts` or `compose-offer.ts` at all. It is **treated as** untrusted in the sense the
rule below means — it decides nothing, gates nothing, and instructs nothing — and `datamark()` is
the required door on the day a prompt wants it. Stating a control that does not exist is how a
reader wires the label into a prompt believing something already stands behind it.)*

**It earns an entry by holding two refusals**, which is the standard `IntentionState` was admitted
under and is the only standard that should admit anything else:

1. **It is untrusted although a person wrote it.** See `UntrustedContent`, amended the same day.
   Nothing about it may influence a policy decision, be treated as an instruction, or enter a
   prompt undatamarked. It reaches no `ContractScope`, no `AuthorizedAction`, and nothing
   `compilePolicy` can receive.
2. **It is not a SessionSubject and it is not an Intention, and the collision is the dangerous
   part.** All three are a short sentence naming what somebody is working on, and two of the three
   were typed by the person. The difference is what was agreed to. A SessionSubject is
   model-composed and nobody has agreed to it. An `Intention` is a durable row a person ratified,
   can see, and can edit. An AuthoredLabel is neither: **nobody agreed to anything by naming a
   group of tabs**, and the promotion this vocabulary already forbids most sharply — a
   SessionSubject becoming an Intention with no person accepting it — is forbidden here on the same
   terms and is more tempting, because the words are the person's own. A label may **replace** the
   words a SessionSubject shows ~~and may **raise** OfferGrounds confidence~~ **and may touch
   nothing else**. It may never become an Intention, and it may never gate detection: most people
   do not group their tabs, so a rule that needed one would fire for a minority and be silent for
   everyone else.

   *(The struck clause was wrong on the day it was written and is corrected the same day —
   2026-08-17. `OfferGrounds` is `{ kinds, sufficient, sentences }`; there is no confidence on it to
   raise, and "confidence" is a word this document bans from UI copy and displaces from the
   vocabulary further down. What shipped is stricter, and is asserted rather than described: a label
   may not touch `OfferGrounds.kinds`, `OfferGrounds.sentences` or `OfferGrounds.sufficient`, and
   `tests/detection.test.ts` compares grounds byte-for-byte with and without one over the same
   afternoon. Sanctioning the opposite here sanctioned the single thing the `tabGroups` permission
   was bought on the promise of never doing — `extension/manifest.json` says so in the same diff:
   "it cannot make an offer fire that would not have".)*

**Scope, stated in the vocabulary because it is easy to widen in code.** A label is read for a
group that already contains a watched page. It carries no information about the group's other tabs,
which the browser will not hand over through this API at all, and it is not read for groups no
watched page is in.
*Checked against the banned words:* not `Intention`, not `SessionSubject`, not `topic` (displaced),
not `Task`, not bare `Objective`, not `signal` (displaced by ObservationEvent).
*Displaces:* tabGroupTitle · groupTitle · groupName · tab group (as a stored thing) · label ·
userLabel · humanLabel · folder · folder name · workspace name · user-authored topic · self-reported
intent.
**Consumer:** the name you gave these tabs.

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
a title, dwell and scroll, ~~and nothing else~~ **— and, since 2026-08-17, an exit type and an
`AuthoredLabel`** *([ADR-0013](docs/adr/0013-authored-labels-and-exit-type.md))*. Both reasons above
survive that addition unchanged: an exit type is an enum produced by arithmetic over page lifecycle
events, and a label is a string read from the browser. **Neither is a model call and neither is page
text**, so the ban this paragraph exists to state is untouched. ~~The label is nonetheless
`untrusted` and datamarked before `boundaries/subject.ts` may see it, on the terms
`UntrustedContent` sets.~~ **`boundaries/subject.ts` never sees it at all** — `SubjectInput` takes
`titles` and `searches`, both `Datamarked`, and has no field for a label — which is a stronger
containment than the struck sentence claimed and the one that actually shipped. If a boundary ever
gains a field for it, `datamark()` is the door, on the terms `UntrustedContent` sets. *(Corrected
2026-08-17, the day the sentence was written.)*

The cost of keeping this rule is precise and worth naming: the offer can say **what was seen** and
not **what it means**. *"You have been reading northwind.example.com — mostly Tiers"*, never *"you
are comparing partner tiers"*. Naming the work needs a model, and a model on a timer is the thing
these two sentences exist to prevent.

### SessionSubject — *value object, not persisted*
`{ subject, confident }` — what a person appears to have been looking into, in the words a colleague
would use, plus the model's own admission that the pages did not agree on one. Composed once per
thread, keyed on the thread signature, from **titles and search terms only**; ambient capture holds
no page text, so there is none to send.

It names a subject and grants nothing. It reaches no policy decision, no scope, and no schema the
gate reads. `confident: false` is a real outcome the interface must render as vagueness rather than
suppress — a confident wrong name is worse than an honest mixed one.
*Checked against the banned words:* not `SessionState` (that is `SessionReading`), not bare
`Objective`, not `Intention`, not `Task`. *(2026-08-16: `Intention` stopped being a banned word and
this check got **stronger**, not weaker. A SessionSubject is model-composed and nobody has agreed to
it; an Intention is a durable row a person ratified and can edit or delete. The uncomfortable half,
written down in [`docs/VISION.md`](docs/VISION.md)'s honest limits rather than smoothed over here:
an Intention's words may well have **started** as text of exactly this kind. What may never happen
is a SessionSubject becoming an Intention without a person accepting it — of everything in this
vocabulary, that is the one promotion no code path may make.)*
*Displaces:* topic · theme · thread name · detected intent · inferred goal · Subject (bare) ·
NamedThread (as a vocabulary word — it stays the in-memory store's own field name).
**Consumer:** what you've been looking into.

### WorkOffer — *value object, not persisted until accepted*
What Propositum would do about a SessionSubject, in its own words:
`{ title, rationale, outline: OfferOutline, produces, willNotDo: string[], expects: ShiftOutcomeKind[] }`.
Composed by a model, only once OfferGrounds are sufficient. Replaces the closed two-member list
`OFFERABLE`, which was two use cases chosen before the product had been used.

**It has no field that could carry a URL, a host, an origin or a source id** — not "must not", *has
no field*, grep-enforced in `tests/architecture.test.ts`. Sources come from code, off the ambient
buffer keyed by thread signature. It names no `ActionKind` either: `expects` holds
ShiftOutcomeKinds, which describe the shape of a result and grant nothing.

**`WorkOffer`, never `Workflow*`.** §4's `ExecutionPlan` already displaces the word "workflow", and
reintroducing it one lifecycle stage earlier is how a displaced word comes back. Distinct from a
Suggestion, which says *what was seen*; a WorkOffer says *what Propositum would do about it*.
*Checked against the banned words:* not `Task`, not `Draft`, not bare `action`, not bare `Objective`.
*Displaces:* Workflow · WorkflowOffer · Proposal (bare) · Pitch · Plan (as the offer) · Offerable ·
capability offer · CTA.
**Consumer:** what I could do about it.

### OfferOutline — *value object on WorkOffer*
An ordered list of one-line steps naming what Propositum would do, in order. **It authorizes
nothing.** No gate reads it, it produces no PlanSteps, and no ActionIntent cites it. It exists so a
person can decline for the right reason rather than declining a title.

Named as an outline, not a plan, precisely so it cannot be mistaken for the ExecutionPlan the run
later reports — one is a sentence in a proposal, the other is a record of what happened.
*Checked against the banned words:* not `Task` list, not `Plan` (bare), not `checklist` (already
displaced by ExecutionPlan).
*Displaces:* plan (in the offer) · steps · agenda · checklist · roadmap · Task list.
**Consumer:** how I'd go about it.

### OfferGrounds — *computed view*
The deterministic arithmetic deciding whether there is enough evidence to offer to **do** work, as
opposed to merely naming a subject: `{ intent: GroundKind[], investment: GroundKind[] }` over the
ambient buffer. No model, ever.

> **`sufficient = at least one intent ground AND at least two investment grounds.`**

Two groups rather than ~~k-of-6~~ k-of-7, because the two axes fail differently and one counter cannot express
*one of these and two of those*. Intent separates **pursuing** from **receiving** — without it, a
long absorbing article qualifies, which is the false positive ADR-0008 names as the expensive
failure. Investment separates **worth an offer** from **a lucky click** — one strong signal is cheap
to produce by accident; two independent ones are not. The argument in full is in
[ADR-0009](docs/adr/0009-composed-offers.md) §2.

**Amended 2026-08-17: the investment group has four members, not three.** `read-around` joined it,
so the required two are now drawn from four rather than three — ~~three qualifying pairs became
six~~ **five, corrected later the same day** — which is a cheaper bar and is recorded as one rather
than left to be worked out. The intent group is unchanged and so is the sentence in the block quote
above: still one and two, never a single counter.

**Counted by axis, not by ground, corrected 2026-08-17.** `followed-across` and `read-around` are
breadth measured from its two ends, so they count **once between them** — the sixth pair was never a
pair. Both still fire and both still say their sentence; only the arithmetic folds. Counting them
separately made the pair sufficient with no duration evidence at all, which is why this is a rule
rather than a note.

**`OfferGrounds`, not `Evidence`.** `Evidence` means claim→event and is the most expensive collision
available here: two things called evidence, one carrying provenance for an inference and one gating
whether a person is interrupted, is the `ReviewDecision`/`ChangeVerdict` mistake with worse
consequences.
*Checked against the banned words:* not `Evidence`, not `EvidenceStrength`, not
`ConfidenceThreshold` — these are counts of deterministic facts, not a score.
*Displaces:* Evidence (in the detection sense) · signals · score · threshold · readiness ·
DetectionConfidence.
**Consumer:** internal — surfaced only as *why I'm asking now*.

### GroundKind — *value object*
Closed and code-owned, in two groups that are part of the type rather than a comment:

| Group | Members |
|---|---|
| intent | `searched-then-read` · `refined-the-search` · `came-back` |
| investment | `read-deeply` · `stayed-with-it` · `followed-across` · `read-around` · `compared-options` |

Adding a member is a schema change, never configuration. **No `other`.** Never model output, so the
enum is a genuine constraint rather than a prose hint. The thresholds behind each member are the
constants in ~~`src/domain/detection/detect.ts`~~ **`src/domain/detection/grounds.ts`** and are
guesses set before any real browsing existed — ADR-0008 says so and this does not improve on it.
*(The file was corrected 2026-08-17. ADR-0009 recorded the move on 2026-08-16 and this sentence did
not follow it, which is the glossary describing a file the constants had already left.)*

**Amended 2026-08-17: `read-around` is the seventh member and the fourth investment ground.** It
fires on three or more distinct pages of ONE origin, each of them held past `READ_AROUND_MS`, none of
them a search. It exists because breadth across sites was rewarded and depth on one site counted for
nothing: six arXiv abstracts on a subject earned no investment ground at all unless one page happened
to clear the deep-read threshold, while three glances at three sites earned `followed-across`
outright. What it admits — ~~one search~~ **any one intent ground, a reopened tab included**, leading
into three or more read pages of a single site, which is research and is equally shopping — is an
accepted cost, recorded in full in `src/domain/detection/grounds.ts` and in ADR-0009 §2. *(Both
corrections made the same day: it shipped counting as a ground beside `followed-across` rather than
folding into it, and with "engaged" meaning "visible for a nonzero time" rather than read.)*
**Amended 2026-08-20: `compared-options` is the eighth member and the fifth investment ground
([ADR-0018](docs/adr/0018-the-everyday-shapes.md)).** Several comparable pages on DIFFERENT origins,
each held and scrolled far enough to have been read, with at least one return that arrival says was
not same-origin. It exists because comparison shopping was, until this ADR, named in
`src/domain/detection/grounds.ts` as one of this design's **residual false positives** — the same
afternoon the direction document makes a flagship example. It sits on its own axis rather than on
`BREADTH_AXIS`, so a comparison cannot also pay as `followed-across` off one buffer.
**What it costs is stated where the cost is:** `INVESTMENT_REQUIRED` stays at 2 and there is now one
more way to reach it, which `grounds.ts` calls *"the closest thing available to lowering
`INVESTMENT_REQUIRED`"* about this exact kind of change. The guard is the standing fixture of an
ordinary afternoon of reading, which must still not qualify.

*Checked against the banned words:* not bare `action`, not `signal` (displaced by ObservationEvent).
*Displaces:* signal type · heuristic name · rule id (in detection) · trigger · other · misc.
**Consumer:** internal — rendered as a sentence, never as a name: *"you searched, then read three
pages, and came back to two of them"*.

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

### Evidence — *~~value object on a SessionClaim~~ table*
The link from one claim to one ObservationEvent, plus an optional verified quote.

**Corrected 2026-08-11.** This entry said *value object* and `prisma/schema.prisma` has had a
`model Evidence` with its own id since it was written. The schema is authoritative — it has rows and
an identity, which is what makes something a table — and ADR-0003's "20 tables" was already 21
before any of this work started. Recorded in [ADR-0009](docs/adr/0009-composed-offers.md) with the
other document-versus-code divergences.

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
(`id`, `sessionId`, `sessionReadingId`, `intentionId?`, `status: draft | accepted`, `acceptedAt`,
plus the three value objects below — ~~`intentionId?` alone is *specified 2026-08-16 by
[ADR-0011](docs/adr/0011-intention-above-worksession.md) and not yet in `prisma/schema.prisma`*~~
*amended 2026-08-16: `intentionId` is in `prisma/schema.prisma` with the rest*).

`intentionId` is nullable and ~~**specified rather than present**~~ ***present as of 2026-08-16***, by
[ADR-0011](docs/adr/0011-intention-above-worksession.md). It records **which Intention this contract
advances** — nothing more. It grants nothing, the gate does not read it, and `compilePolicy` cannot
receive it. Every contract written before that ADR keeps a null and none are backfilled.

**Written at draft time or never.** `handoff_contract_frozen_once_accepted` permits an UPDATE only
while `status = 'draft'`, so a value not set when the row is created is a value that can never be
set — which is also why the relation is declared `onDelete: Restrict` rather than left on Prisma's
`SetNull` default: nulling this column is an UPDATE, and on an accepted contract the trigger aborts
it. The consequence is stated in the `Intention` entry: an Intention any contract points at cannot
be deleted.

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

**It is one Intention's per-handoff restatement** *(added 2026-08-16,
[ADR-0011](docs/adr/0011-intention-above-worksession.md))*. It already carried `objective` and
`definitionOfDone`, which is the whole of what an Intention holds, so this is **a move, not a
build** — no field is added, removed or retyped. The relationship in one line: an **Intention** is
durable and belongs to the person; a **StatedIntent** is the sentence *one* contract commits to,
ratified for that contract and re-ratified for the next. `HandoffContract.intentionId` is nullable
and records which one; a contract with no Intention behind it is legal and ordinary.

What genuinely changes is the **source of the pre-filled text**: the drafting path may now start
from a sentence written before the sitting existed rather than only from a reading of it. Everything
that made this value object safe is unchanged — `guidance` stays human-typed only, an inferred
`constraint` claim still never pre-populates it, and `compilePolicy` still cannot receive any of it.
The human ratification that follows is doing more work than it was designed for, and that is
recorded under known risks rather than smoothed over.

*Displaces:* Objective (free-standing) · InferredObjective · CommittedObjective · AgreedObjective ·
Goal · Mission · Intent · ~~Intention (as a field)~~ · Instructions · outOfScope · SuccessCriteria.
**Amended 2026-08-16 ([ADR-0011](docs/adr/0011-intention-above-worksession.md)): `Intention` is a
table and is not displaced by this. It is restated by it.**
**Consumer:** "What I'll work on" · "Done means…" · "Guidance — not a hard limit".

### ContractScope — *value object*
`approvedSourceIds[]`, `allowedActionKinds[]`, `baseVersionId`, and — **built 2026-09-01, the first
of the fenced three to leave the fence** — an optional `purchaseAuthorization`
([ADR-0024](docs/adr/0024-purchases-within-a-ratified-authorisation.md)): its absence is the deny,
and only `acceptContract` may grant the kind it unlocks. **Two decided and still unbuilt:**
`approvedApplications[]`
([ADR-0025](docs/adr/0025-computer-use-beyond-the-browser.md)) and an optional `sendAuthorization`
([ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md)).
`grep -rn 'approvedApplications\|sendAuthorization' src/ prisma/` returns
nothing — those two are a
**specification rather than a description**, the same fence the `Intention` entry put around itself,
and they are written here first because the constraint is one sentence today and a migration later.

Deny-by-default; **no denylist**, because a second mechanism creates a precedence question with no
principled answer. The "I will not…" reassurance panel renders ~~two visually distinct groups: the
computed complement of `allowedActionKinds` (we chose not to allow this) and capabilities absent
from the enum entirely (this does not exist)~~ ~~**three, 2026-09-01**~~ **four, 2026-09-01 — two
splits decided apart and reconciled the same day.** The complement collapsed two different facts
under one heading that named a choice, and credited the person with switching off kinds their shift
never offered; and ADR-0024's `complete-purchase` fits none of the groups that leaves. The four:
**switched off** (inside `ActionKind`, this shift offered it, a dial removed it) · **not in this
agreement** (inside `ActionKind`, never offered, so there was nothing for a dial to remove) ·
**ratified-bound** (`complete-purchase` — inside `ActionKind`, on no dial, granted only by
ratifying a drafted `PurchaseAuthorization`, and shown as its own line with the amount rather than
in any list) · **does not exist** (absent from the enum entirely). The UI must never blur them.

`approvedSourceIds` defaults to the project sources actually observed this session, one tap to add
any other — least privilege, cheap to correct. A model may propose a **narrowing**, checked
deterministically as `proposed ⊆ granted` before the draft renders.

A model may **not** propose `allowedActionKinds` at all: no session-level action grant exists for a
subset check to compare against, and a vacuous check is worse than none. **Preserved verbatim
2026-08-11** through [ADR-0009](docs/adr/0009-composed-offers.md), which lets a model compose an
open-ended WorkOffer. The offer names outcome *kinds*, never ActionKinds, and this sentence is not
reopened by it. Recorded here so it is not relitigated by someone who reads the offer schema and
assumes the rule moved.

`baseVersionId` pins a **DocumentVersion**, not a Document, and it is explicitly the read-only base.

**`baseVersionId` is optional from 2026-08-11** ([ADR-0009](docs/adr/0009-composed-offers.md)).
`document-changes` is now one ShiftOutcomeKind among five, and a run that will produce a
`collection`, an `answer`, a `message-draft` or an `external-effect` has no document to pin — a
contract forced to name one would either invent a document nobody asked for or fail to be draftable
at all.

Nothing is loosened by the optionality, because the gate gains a rule rather than losing one:
`draft-section` (or any kind that addresses a BaseSpan) proposed under a contract with no
`baseVersionId` is refused with **`no_document_pinned`**. Deny-by-default already covers the case;
the named rule exists so the refusal reads as a fact about the agreement rather than as a missing
parameter. The immutable-base property is untouched wherever a base exists, and where none exists
there is nothing to address.
**`approvedApplications` is the desktop's `approvedSourceIds`**, added 2026-08-26 with
[ADR-0025](docs/adr/0025-computer-use-beyond-the-browser.md). Bundle identifiers, never window
titles — a title is authored by the application and belongs with every other page-authored value,
whereas a bundle id is the operating system's. It is checked against the **frontmost** application
before every mutating action rather than once per turn, because an application can come to the front
between perceiving and acting. Absent or unreadable escalates to a refusal, for the reason
`reversibility.ts` already gives: the cheapest attack on a check is to remove the thing it checks.

It replaces the bound ADR-0010 had — *one tab Propositum opened* — and it is weaker, because that one
was Chrome refusing and this one is our code remembering.

*Displaces:* Permissions · Capabilities · Grants · Allowlist · Denylist · ProhibitedActions ·
Guardrails · Sandbox · ACL · Scope (bare) · approved resources · workingCopyOf.
**Consumer:** "What I can look at" · "What I can change" · "Where I can work".

### PurchaseAuthorization — *value object*
~~`originPattern`, `whatFor`, `maxAmount`, `currency`, `maxCount`, `expiresAt`.~~ **Built 2026-09-01
with two field corrections the code decided:** `originPattern`, `whatFor`, `maxAmountMinor` (the
ceiling was always in minor units; the name now says so), `currency`, `maxCount`,
`expiresAtEpochMs` — and the expiry is **derived, never stored or drafted**:
`acceptedAt + timeLimitMinutes`, the same immutable pair the deadline derives from, so an
authorisation structurally cannot outlive its contract, which is ADR-0024's own *Revisit when*
tripwire answered by construction. Optional on `ContractScope`; **its absence is the deny.** Decided
2026-08-26, [ADR-0024](docs/adr/0024-purchases-within-a-ratified-authorisation.md).

~~**A specification rather than a description.** Nothing in `src/` or `prisma/` holds any of these
fields…~~ **The fence came off 2026-09-01: the fields exist** — `src/domain/handoff/policy.ts`
declares the object, `prisma/schema.prisma` holds five nullable `purchase*` columns on the contract,
and the gate refuses `complete-purchase` with `purchase_not_authorized`, `purchase_count_exceeded`
and `purchase_expired`. ~~**What has NOT moved: the transport.**~~ **The transport moved later the
same day: item 5 landed.** `LANDING_ACTION_KINDS` holds `complete-purchase`, and the extension
refuses any non-`GET` without a one-shot landing permit a ratified authorisation armed — releasing
exactly one covered request at or under the ceiling. *The landing permit is the extension-internal
mechanism of THIS term and deliberately gets no noun of its own in the glossary: it is a
not-persisted value in `chrome.storage.session`, armed per `complete-purchase` command from these
fields and dead on consumption, refusal, expiry, or the tab being given up — a projection of the
authorisation, never a second authority over it.* So **Propositum can buy exactly what a person
ratified, and still nothing else**; the agreement screen confines *"Buy anything"* to the
no-authorisation arm, and `tests/architecture.test.ts`'s updated guard couples the two arms the way
the old one coupled the absolutes. The live purchase has not been made —
[`docs/todo/06-buying-things.md`](docs/todo/06-buying-things.md) keeps its *Done when* open on it.

What a person ratified about spending, for one contract. A model **drafts** it from the instruction —
*"Buy 10 avocados from Amazon"* names a merchant, an item and a quantity, so there is something to
draft; *"Find me food for dinner"* names none, so there is not — and the person ratifies it on the
screen they already ratify. `compilePolicy` then receives it as constrained values, exactly as it
receives `approvedSourceIds`.

**This is why it is an object and not the instruction.** The objective is prose, prose is inside the
injection blast radius, and `compilePolicy` cannot receive `StatedIntent` — a compile error, per
[ADR-0006](docs/adr/0006-trust-boundary.md). If the objective authorised spending, an injection
would authorise spending. So the same asymmetry holds here as everywhere: a model may propose, only a
person may permit.

`whatFor` is prose and is **display-only**, read by the person and never by the gate, in the same way
an inferred `constraint` claim is.

`maxAmount` is a **ceiling nothing may relax**. A charge above it refuses and asks — the one
confirmation that survives ADR-0024, well-behaved because it is rare and therefore still read. A
control may switch purchasing off entirely; per [principle 6](docs/PRODUCT_PRINCIPLES.md) none may
switch the ceiling off, because that is a dial pre-approving an irreversible action.

*Displaces:* Budget (which is time — see AutonomyControls) · SpendLimit · PaymentMethod · Wallet ·
`alwaysAllow`.
**Consumer:** "What you said I could buy".

### SendAuthorization — *value object*
`recipients[]`, `whatFor`, `maxCount`, `expiresAt`. Optional on `ContractScope`; **its absence is
the deny.** Decided 2026-09-01,
[ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md).

**A specification rather than a description.** Nothing in `src/` or `prisma/` holds any of these
fields and `grep -rn 'gmail' src/` returns nothing — no mail code exists at all, so **Propositum
cannot send an email today**. `tests/architecture.test.ts` still asserts no send-shaped function
exists, stated with its known limit: since ADR-0010 that clause is about our function names, not
reachable effects. It is the guard that must be deliberately updated on the day this is built, and
[`docs/todo/10-the-mailbox.md`](docs/todo/10-the-mailbox.md) names it.

What a person ratified about sending, for one contract — `PurchaseAuthorization`'s pattern applied
to the send verb. A model drafts it **only** from an instruction that names its recipient (*"send
Priya the summary"* names someone, so there is something to draft; *"deal with my inbox"* names no
one, so the terminal is a `message-draft` held unsent in the drafts folder) and the person ratifies
it on the screen they already ratify. `recipients` are exact addresses, matched exactly and never by
domain; `whatFor` is display-only prose the gate never reads; `expiresAt` is never later than the
contract's own end, because an authorisation that outlives its contract is a
`WorkingAgreement` in everything but name, and that word stays reserved.

*Displaces:* MailPermission · SendGrant · `sendMessage` (as a capability name) · `alwaysAllow`.
**Consumer:** "Who you said I could write to".

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
breadth (may the worker act beyond what it said it would do), Progress governs depth (how far it may
get before coming back). ~~Both compile to set-membership tests over plan step ids~~ — **amended
2026-08-11 ([ADR-0010](docs/adr/0010-acting-in-the-browser.md))**: plan step ids no longer authorize
anything, so both compile to tests over **counters the ledger already supports**, never to prompt
wording. That is the property that mattered; the plan was only ever how it was computed.

**Progress, redefined.** A **step is the interval between two mutating actions.** So
`current-step-only` compiles to *make at most one change out there, then come back to me*, and
`remaining-plan` to *up to `MAX_MUTATING_ACTIONS_PER_RUN`*. Under the old definition a step was a
row; under an agent that observes and then decides, no row written before it looked can bound it.

**A model may not declare a step boundary.** "This is still the same step" is a **grant** — it would
let a model widen what it may do by describing its own work differently — and a grant is the one
thing a model may never make. ADR-0007's asymmetry is exact here: declining withholds, and this
permits.

**"Stop and ask me when…" takes no free text.** A typed sentence beginning with those words will be
read by every user as a hard stop and cannot be one — the same lie as unenforced guidance, at
higher stakes. A closed picker of extra compiling triggers is the growth path.

**Budget shows time only.** The working agreement promises a time ceiling, not a cost ceiling. Say
that plainly. Token limits are banned from consumer surfaces.

**Output is a real permission, not a presentation mode — decided.** `suggestions-only` removes
`draft-section` from `ContractScope.allowedActionKinds`; the worker may then produce an `answer`,
raise open questions, and name next steps, but **may not propose document text at all**.
`draft-changes` grants it.

*(Reworded 2026-08-11. This sentence said "findings", which now collides twice over — with
`ReviewFinding`, which is the reviewer's advisory output, and with the `answer` ShiftOutcomeKind,
which is what a `suggestions-only` run actually produces. The permission is unchanged.)*

**Widened 2026-08-12: `suggestions-only` removes every kind that can OPERATE a page, not only
the one that can write prose.** `click-element`, `type-text` and `press-key` go with
`draft-section` and every landing kind — the whole of `MUTATING_ACTION_KINDS`. `observe-page`,
`navigate` and `capture-screen` survive, so a research-only run can cross a site by following
links and read what it lands on, and cannot operate anything.

The capability lost is real: pagination, expanders, filters, "show full text". A research-only
browser run can now see the first page of everything and the second page of nothing, and that
should be expected to bite. It goes anyway, because the alternative made this the one dial in
the product where the safest-looking option was not the safest. Under the narrower rule, the
only thing between "research only" and an order being placed was `classifyReversibility` — a
lexicon over page-authored text, which a page defeats by renaming its own button. ADR-0010
already concedes once that a pause replaces an absence; conceding it a second time, inside the
setting whose entire promise is that nothing will be operated, is how a safety story stops
meaning anything. The pause guards `draft-changes`, where a person has consented to a worker
that acts. It does not also have to guard the setting that says it will not.

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

### BusyInterval — *value object, not persisted*
`{ start, end }` — one stretch of a person's own calendar during which they are busy, as two moments
and nothing else. Read from Google's `freebusy.query` under the single scope
`calendar.freebusy`, which returns *"List of time ranges during which this calendar should be
regarded as busy."* **There is no title on it, no attendee, no description, and no field that could
carry one** — the same shape of promise `WorkOffer` makes about URLs, and for the same reason: the
strongest form of *cannot* is *has nowhere to put it*.

Specified 2026-08-18 by [ADR-0014](docs/adr/0014-reading-free-busy.md). It exists because
`detectPause` can tell that somebody left and cannot tell **how long they will be gone**, which is the
one thing `AutonomyControls.timeLimitMinutes` is denominated in.

**What it is not, and this is the whole reason it has an entry.** Three refusals that would otherwise
live only in an ADR:

- **It is not an `ObservationEvent`.** It carries no `sessionId`, passes no ledger writer, and is
  never persisted in any form. Nothing about a calendar is stored on this machine.
- **It is not a `SessionClaim` and reaches no model.** No `ModelBoundary` has a field for one, and
  there is no model anywhere in the path that reads it.
- **It grants nothing.** A BusyInterval may be used to compute a **suggested** `timeLimitMinutes`
  which a person then sets on the working-agreement screen. It may never reach `compilePolicy`,
  `EnforcedPolicy` or the gate, and it may never raise, lower or widen a dial. **A calendar
  recommends; it may never grant** — principle 15's asymmetry, applied to a third party instead of to
  a model or to history.

*(2026-09-01, [ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md): the scope this
entry reads under is no longer the product's only Google scope on paper — a write path is decided,
and its object is `CalendarHold`, below. Nothing in this entry moves: the read is still
`calendar.freebusy`, still never persisted, still grants nothing, and a hold is not a BusyInterval
and never becomes one.)*

**The suggestion gets no term of its own, deliberately.** It is a candidate value of
`timeLimitMinutes` — offered beside the dial, applied only by a press, and *not* pre-filled into it;
weaker than `StatedIntent`'s fields, which do arrive pre-filled from a model. Giving the offered
number a noun would make it a thing, and a thing acquires a column, and a column beside
`timeLimitMinutes` is two stores for one truth, which is the mistake `EnforcedPolicy` below has a
whole paragraph about.

**Arithmetic over these takes `now` as a parameter.** Anything in `src/domain/**` that turns intervals
into a number of minutes is given the moment; it does not read a clock, and it does not fetch.
*Checked against the banned words:* not `signal` (displaced by ObservationEvent), not
`ObservationEvent` (it is not one and cannot become one), not `Task`, not bare `action`, not bare
`Objective`, not `telemetry`.
*Displaces:* FreeBusy · FreeBusySlot · Availability · AvailabilityWindow · CalendarEvent · Event (in
the calendar sense) · Meeting · AwayWindow · awayUntil · backAt · Busy (bare) · calendar block ·
focus block.
**Consumer:** when your calendar says you're busy. *(The interface never shows an interval. It shows
the time limit it would have shown anyway, one sentence saying what the calendar said, and a button
offering the number that fits. The sentence stays after the button is pressed, so a ratified limit
never sheds where the number came from.)*

### CalendarHold — *value object*
`{ start, end, label }` — one busy block Propositum wrote, on a calendar Propositum created. The
write-side counterpart of a `BusyInterval` and never the same object: one is evidence read from a
person's availability, the other an action a ratified contract granted. Decided 2026-09-01,
[ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md).

**A specification rather than a description.** `grep -rn 'CalendarHold\|calendar.app.created' src/`
returns nothing, and `src/server/calendar.ts` still names `calendar/v3/freeBusy` and no other
endpoint. The build's first job is a stop-the-line verification — a hold that does not make the
person read as busy reopens the decision rather than shipping anyway —
[`docs/todo/11-calendar-holds.md`](docs/todo/11-calendar-holds.md) leads with it.

Written under `calendar.app.created`, which can touch only calendars Propositum itself created —
the person's own calendars have no field this can reach and no call that can return their contents,
so ADR-0014's *has nowhere to put it* holds in both directions. The consumer wording still says
*your* calendar deliberately: the secondary calendar sits inside the person's account and moves the
person's availability, which is the sense a person means — the scope sense (never the calendars they
keep themselves) is the security fact, said where security is the subject. **The hold itself lives
on Google, not here** — locally there are only the ledger's rows about the action that placed it,
the same not-persisted posture as the read. Proof per hold: the event read back
by its id, and the interval reported busy by the ADR-0014 read — the product's oldest Google read
becomes the receipt for its first Google write. Removing a hold removes only what Propositum wrote.

The standing rule survives untouched: the calendar's *read* still recommends and never grants. A
hold grants nothing either — it is *granted*, by a contract, like any other mutating kind.

*Displaces:* TimeBlock · HoldEvent · the write sense of `calendar block` and `focus block` (whose
read sense stays displaced by `BusyInterval`).
**Consumer:** "Time held on your calendar".

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

**Plus pause credit, from 2026-08-11** ([ADR-0010](docs/adr/0010-acting-in-the-browser.md)): the
time a Shift spent waiting on a human is not the run's to spend, so the derivation becomes
`contract.acceptedAt + timeLimitMinutes + Σ(confirmation waits)`. The reasoning that banned the
field survives unchanged — the sum is over **immutable timestamps on durable rows**
(`ConfirmationRequest.createdAt` to its `ConfirmationVerdict.decidedAt`, and nothing else), so it
recomputes to the identical value after any number of restarts. A stored `deadlineAt` would still be
the wrong shape; a derived one over immutable pairs is the same shape it already was, summed.

A pause with no verdict credits nothing, which is the correct direction: an unanswered question must
not buy a run more time than an answered one.

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

**A confirmation pause is continuation under another name, and it is inside the line, not across it**
*(added 2026-08-11, [ADR-0010](docs/adr/0010-acting-in-the-browser.md))*. When a run halts for want
of a human acknowledgement and a new AgentRun continues after the answer, both runs are under **one
accepted contract** and inside **one Shift**. The cardinality rules are untouched: one Shift per
accepted contract, one budget, one ShiftReport, one *"While you were away"*.

What has genuinely changed is the **duration**: a Shift now spans a person's coffee break, because
the second run cannot start until they answer. The boundary the brief was protecting — no autonomous
action without an explicit handoff — is protected exactly as before, since the pause asks for *more*
human consent rather than less. "Keep going" and "Redirect" remain out of slice 0: both would mint a
new contract for work the person has not agreed to, and a confirmation grants one specific action
they were shown.

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

~~`status`: `queued · running · completed · halted · interrupted · failed`.~~
**Corrected 2026-09-01, and it was wrong in both directions.** Three of those six are never written
for an AgentRun — `queued` is `ActionDispatch`'s, and `completed` and `halted` are nobody's — and
three the code does write were missing. The seven, agreed between the code and
`prisma/schema.prisma`'s own AgentRun comment: `pending · claimed · running · succeeded · failed ·
interrupted · awaiting-confirmation`. `awaiting-confirmation` is now load-bearing outside the worker:
`confirmRequest` refuses a yes unless the run is still parked on the question, so a value this list
did not mention decides whether a person's answer is accepted. The divergence below already said this
entry disagrees with the schema; what changed is that it stopped being only a specification gap.
~~**The reasons table below still partitions by `completed` and `halted` and is left standing** — the
terminal reasons are a second divergence, and correcting one list by leaning on the other is how this
entry got here.~~ **Struck the same day.** Leaving it standing meant leaving a table keyed on two
statuses the sentence above had just established nobody writes, and the second divergence is closed
below off the writers rather than off the other list.
`terminalReason` is closed, **code-assigned**, and partitions strictly by status:

| Status | Reasons |
|---|---|
| ~~completed~~ | ~~`plan-exhausted`~~ |
| ~~halted~~ | ~~`stop-condition` · `human-recall` · `time-budget-exhausted` · `token-budget-exhausted` · `gate-refusal`~~ |
| ~~interrupted~~ | ~~`lease-expired`~~ |
| ~~failed~~ | ~~`boundary-failure`~~ |

**Struck 2026-09-01, and rewritten from the writers.** Two of the four statuses above are written for
no AgentRun, and five of the eight reasons are written nowhere: `plan-exhausted`, `human-recall`,
`time-budget-exhausted`, `token-budget-exhausted` and `gate-refusal`. Three of the five are renamings
— the two budgets are one `budget-exhausted`, and `human-recall` is `cancelled`. **The other two name
nothing**: a run that exhausts its plan and a run whose model declares itself done both end with **no
reason at all**, and a gate refusal on an irreversible kind parks the run on a question rather than
ending it. Every writer, and what it writes:

| Status | Reason | Written by |
|---|---|---|
| `succeeded` | `budget-exhausted` · `stop-condition` | `finish` in `src/runtime/worker-loop.ts`, off `STOP_RULES[…].terminalReason` in `src/domain/execution/stop-conditions.ts` |
| `succeeded` | *(none)* | the same `finish` when no rule fired — the plan ran out, or the model said it was done |
| `failed` | `boundary-failure` | the same `finish`; which boundary and how is `WorkerResult.boundaryFailure`, not a reason |
| `failed` | `error` | three places in `src/server/execute-run.ts` — `executeRun` when the run's contract will not load, `executeRun`'s catch-all for anything that threw and was not a claim fence, and `review` when the reviewer's model boundary came back not ok |
| `interrupted` | `lease-expired` | `runs.sweepExpiredLeases` in `src/persistence/repositories/index.ts` |
| `interrupted` | `cancelled` | the `cancel-requested` fence in `src/server/execute-run.ts` |
| `interrupted` | `answered-too-late` | `admitRun` in `src/server/confirmations.ts`, from `ANSWERED_TOO_LATE` in `src/domain/execution/continuation.ts` |
| `interrupted` | `confirmation-expired` | `expireConfirmations`, from `CONFIRMATION_EXPIRED` in the same file |
| `awaiting-confirmation` | *(none)* | nothing — the ConfirmationRequest is the explanation, and `runs.complete` documents the omission |

`pending`, `claimed` and `running` are not terminal and carry none. Note what the closed set costs:
five of the six rules in `STOP_RULES` collapse into `stop-condition`, so **which** rule stopped a run
is not recoverable from this column — the re-entry screen says so in its own voice rather than
guessing. ~~Note also a reason the renderers expect and no writer produces: both
`src/domain/intention/work-so-far.ts` and `src/app/shifts/[contractId]/page.tsx` carry a `case
'error'`, which is dead, and `boundary-failure` reaches their default branch instead.~~

**Struck 2026-09-01, hours after it was written, and the row above is the one the table was
missing.** `error` is written — three times, all in `src/server/execute-run.ts` — and both renderers
render it; `tests/work-so-far.test.ts` drives that arm. The reason with no arm anywhere is
`boundary-failure`: neither `src/domain/intention/work-so-far.ts` nor
`src/app/shifts/[contractId]/page.tsx` has a case for it, so the one worker failure this column can
name falls to the default branch kept for a value a later version might store, and the person is
told only that it stopped. Recorded and not fixed here —
[#145](https://github.com/smukhyala/propositum/issues/145) carries the behaviour half.

**A slept Mac yields `interrupted / lease-expired`, never ~~`time-budget-exhausted`~~
`budget-exhausted`** *(corrected 2026-09-01 — the longer spelling never existed)* — the startup
sweep fires on lease staleness before any deadline check runs, so the report never blames the clock
for a lid close. `interrupted` is a real, displayable outcome with a partial shift report, not an
error state; under the standing "leave your desk, not leave the building" constraint it is routine.

~~H3 is scored only on the judgment-family reasons, which keeps budget exhaustion out of the stopping
metric.~~ **Struck 2026-09-01: H3 does not read this column at all.** `scoreH3` in `src/eval/score.ts`
takes whether a question was raised and the `StopRuleId`s of structural origin, which `src/eval/run.ts`
reads off `WorkerResult.stoppedBy` — the rule ids, not the reason they map to. Nor is budget kept out:
`budget-exhausted` is a structural rule and lands in that list like any other. What keeps it out of a
score is a scenario sealing no expectation about it, which is a fact about the corpus and not about
this entry.

**The claim is a fence.** Every action boundary re-reads `status` and `claimedBy`; a Runner that no
longer holds the claim aborts without writing. Otherwise a machine that wakes after its run was
reaped appends actions to a terminal run inside a shift the human already closed.

~~**That fence has never existed** *(recorded 2026-08-11)*. `claimedBy` and `cancelRequested` are
described here and are absent from `prisma/schema.prisma`, and this entry's `status` values disagree
with the schema's. This vocabulary is authoritative and the columns are owed; until they exist the
paragraph above is a specification rather than a description, and reading it as a description is how
a guarantee comes to be believed in without ever having been built.~~
**It exists now** *(corrected 2026-09-01, and the note is kept because it was true for three
months)*. Both columns are on `model AgentRun` in `prisma/schema.prisma`, and the schema comment on
`cancelRequested` says in its own words why they arrived: a browser-driving run is the first run
where a stale claim can press a button on a live page. `src/runtime/worker-process.ts` compares
`row.claimedBy` against the worker id at every action boundary and `src/server/execute-run.ts` turns
a lost claim into a `ClaimFenced` that returns **without writing anything at all**. The `status`
values agree too, as of the correction at the top of this entry.
[ADR-0009](docs/adr/0009-composed-offers.md) records the divergence this closed.

**And one write got in front of it** *(found and closed 2026-09-02,
[#140](https://github.com/smukhyala/propositum/issues/140))*. The fence reads `status`, and `status`
is the only one of its three signals a lease sweep moves — the sweep touches neither `claimedBy` nor
`cancelRequested`. `runs.advanceProgress`, which the worker calls at the top of **every** turn, wrote
`status: 'running'` with no predicate. So a reaped run put itself back to live one step before its
own fence read the column, passed, and carried on driving. The paragraph above was true of the check
and false of the run. Both that write and `confirmations.raiseAndPark`'s are now scoped on the live
statuses, so those two cannot resurrect a reaped run.

**What is still unscoped, said here rather than left to be found:** `runs.complete` is a plain
`update` by id, and it is the terminal write of every run. A reaped run whose worker reaches the end
of its loop is completed `succeeded` and keeps `terminalReason: 'lease-expired'` — the same
uninterpretable row this correction is about, one function away in the same file. It is out of reach
of the fence for the same reason `advanceProgress` was, and it is not fixed here because `complete`
is on every run's path and narrowing it is a change with its own blast radius. `renewLease` is
unscoped too and is harmless: nothing reads the lease except the sweep, which is itself scoped to
the live statuses.

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

**Amended 2026-08-11 ([ADR-0010](docs/adr/0010-acting-in-the-browser.md)): the plan stops
authorizing and becomes reporting.** An agent that perceives a page and then decides cannot be bound
by a list written before it looked, so the plan is now **what the run said it intended**, rendered in
the ShiftReport and cited by nothing. No gate rule reads it.

Everything below about *shape* survives — an ordered list, not a graph, for all four of its original
reasons. What does not survive is the sentence that made it load-bearing, and its two jobs are
replaced explicitly rather than dropped: blast radius becomes `MAX_ACTIONS_PER_RUN = 40` and
`MAX_MUTATING_ACTIONS_PER_RUN = 8`, counted off the ledger; the Progress dial is redefined against
mutating actions rather than step ids. The honest cost stated below gets worse, not better — nobody
checks a bad plan before it spends the shift, **and now the plan is not even what the run follows**.

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

~~**One PlanStep authorizes exactly one action in slice 0.**~~ **Amended 2026-08-11
([ADR-0010](docs/adr/0010-acting-in-the-browser.md)): a PlanStep authorizes nothing.** It is one
line of what the run said it intended, and an ActionIntent may reference it for attribution or
reference none at all.

The original sentence bought four things, and each has to be paid for elsewhere now rather than
quietly lost. *"Finish the current step" is literally true* — replaced by the mutating-action
definition of a step, which is literal in a different and narrower way: at most one change out
there. *The authorized prefix is a real bound* — replaced by two ledger-counted caps.
*Steps and ledger rows line up 1:1* — **gone, and not replaced.** *Per-change attribution is exact
by construction* — now exact by citation instead, which is weaker: a ProposedChange still carries
`planStepId` and `citedActionIntentIds`, but the first is a claim about intent rather than a
structural fact.

The old cost — research steps chopped fine, no revising earlier work inside a run — is the thing
this amendment buys back, and it is why the amendment exists.

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
Closed and code-owned. The only alphabet `ContractScope.allowedActionKinds` draws from, and the only
key the gate matches on. Each carries a static `mutating` flag so the UI can distinguish "I only read
a source, nothing changed" from "your proposal may be partially drafted".

**Amended 2026-08-11 ([ADR-0010](docs/adr/0010-acting-in-the-browser.md)): the members stop naming
effects and start naming mechanisms**, and each now carries a second static flag, `landing`, marking
a kind *capable* of leaving a mark outside Propositum. `read-approved-source · read-document ·
draft-section` are joined by browser mechanisms — perceive a page, click an element, type into one —
whose final membership stays owned jointly with the policy-gate ticket.

`materialise-working-copy` is still **not** a member: the worker returns prose and materialisation is
a post-review human fold.

~~Capabilities the brief excludes — send a message, purchase, publish, delete a file — are absent
from the enum entirely rather than denied by a rule. The strongest form of prohibition is absence of
capability.~~ **This is the sentence ADR-0010 makes false in substance while leaving true in the
enum.** There is still no `sendMessage`; `tests/architecture.test.ts` still asserts no such function
exists; the assertion still passes and now covers much less, because `clickElement` can press
*Send*. Two things survive the reversal and are worth stating precisely, because the difference
between them is the whole remaining guarantee:

- **The `landing` flag is a real upper bound.** A kind without it — reading a tree, taking a
  screenshot, scrolling — can never leave a mark outside Propositum, whatever the page contains.
  Absence still does the coarse work.
- **Whether *this* dispatch lands is decided per action by the browser**, not by the kind: an action
  is irreversible when Chrome is about to send a non-`GET` request or a request outside the
  contract's approved sources. Attested, so page text cannot forge it.

What replaced absence at the fine grain is a confirmation pause, and **a pause is strictly weaker
than an absence** — it can be misconfigured and it can be clicked through. Said here as well as in
ADR-0010 because this entry is where someone will come looking.

Model-facing in worker proposals, so the enum reaches the API as a prose hint. If the model returns
a kind outside the set: Zod rejects → one repair turn quoting the exact issue → the gate
**default-denies** and writes a refused ActionIntent with rule `unknown_action_kind`. The safety
boundary is untouched, because deny-by-default already covers it. The only cost is a wasted turn.

**`draft-section` is removable by the Output control — decided.** `suggestions-only` omits it from
`allowedActionKinds`, so a worker proposing it is refused by the same deny-by-default path as any
unauthorized kind. The control is therefore enforced by the gate that already exists, at the cost
of one flag.

**Members decided and not built** *(2026-09-01,
[ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md); a specification rather than a
description)*: the mail verbs (read, search, label, archive, draft, the evidence-bound unsubscribe)
and the calendar-hold pair. Their exact member names are the build's to choose — mechanisms, not
effects, as everything since ADR-0010 — and none exists in the enum today; the fence comes off in
the commit that adds them.
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

### ActionDispatch — *not persisted*
The one concrete browser command an authorized action compiles to, and the only thing the extension
will execute: an element ref, an ActionKind, and code-built parameters. **A model never authors
one.** It names an element it can see in the accessibility tree and the kind of thing it wants to do;
deterministic code turns that into coordinates and an input event. There is no field anywhere that
carries a command string, and no `Runtime` domain to run one.

**`ActionDispatch`, not `BrowserCommand`.** `Command` is displaced by `ActionKind` and stays
displaced; a second word for "the thing that gets executed" is how a closed enum quietly acquires a
free-text sibling.
*Checked against the banned words:* not `Command`, not `Tool`/`ToolCall`, not bare `action`, not
`execution trace`.
*Displaces:* BrowserCommand · CDPCall · Command · ToolCall · instruction · script · keystroke batch.
**Consumer:** internal — a dispatch never appears in "what I did"; its ActionIntent does.

### ActionEvidence — *table, immutable but not undeletable*
What the agent perceived at one action boundary: the accessibility tree as text, bounded by
`SNAPSHOT_BUDGET_CHARS` (60,000 — thirty times the excerpt budget, and stated in
`docs/SECURITY_AND_PRIVACY.md` as its own published promise), and a screenshot only when the tree was
insufficient. Untrusted by construction — every accessible name in it is page-authored, so it goes
through the same `datamark()` and the same brand as an article excerpt; only the budget differs.

**It is not the observation ledger and never joins to it.** `EXCERPT_BUDGET_CHARS` governs what
Propositum retains about a person's **own browsing**; `ActionEvidence` is what the agent saw **while
acting under a ratified contract**. The two ledgers stay disjoint, which is a standing rule rather
than a new claim, and it is the reason the published 2,000-character promise stays true after an
agent starts reading whole page trees.

**Two guards, not three, and it is the only durable table with fewer than three.** *(Corrected
2026-08-11: this said "deliberately unguarded", and the schema shipped with all three triggers, so
the sentence was wrong in one direction and the code was wrong in the other. The reconciliation is
that these are two different properties. `no_update` and `no_replace` stay, because a
ConfirmationRequest points at the row a person was **shown** and a rewritable row is not a record of
what they were shown. `no_delete` goes, because ActionEvidence is **swept** and a no-`DELETE` trigger
and a sweep cannot both be true. Immutability is about rewriting history; retention is about how long
history is kept.)*

The sweep — `src/server/evidence-sweep.ts`, run by the worker process at startup and hourly —
deletes rows belonging to a run whose every ShiftOutcome is settled, and rows past
`ACTION_EVIDENCE_RETENTION_DAYS = 7` regardless. One exception, published rather than left to be
discovered: a row a ConfirmationRequest points at is kept as long as the question is, and counted.
Nothing in the ShiftReport renders from any of it, so nothing depends on it surviving.
*Checked against the banned words:* not `Evidence` (that is claim→event), not `execution trace`, not
`context window`, not `screen recording` — it is per-action, not continuous.
*Displaces:* Evidence (in the perception sense) · snapshot · observation (in the run) · trace ·
screenshot log · DOM dump · page state.
**Consumer:** "What I was looking at" — beside a question, never as a record of your browsing.

### ConfirmationRequest — *table*
One question a run asked before an action the browser attested as irreversible: the refused
ActionIntent it belongs to, the ActionEvidence it was looking at, an expiry, and a **code-generated**
question built from attested facts — the method, the host, and the element's accessible name rendered
as an **attributed quotation**, exactly as an inferred `constraint` claim is.

The question is never model-composed. A model that could write the words asking for its own
permission is a model that can argue for itself, and the page-authored half is quoted with
attribution rather than spoken in Propositum's voice.

**It is answerable only while the run is still parked on it** *(added 2026-09-01)*. A question whose
run ended some other way is **abandoned**: closed rather than live, the person told the work stopped
before their answer arrived, and no verdict written. `abandoned` is the word for that closed state
wherever it is carried — `AnswerResult.reason`, `ConfirmationView.abandoned`, and the `unanswered`
the settled screen renders.

It is **a distinct closed state, not a fourth thing expiry does**: a question can close this way one
minute after it was asked, and telling somebody who answered promptly that they were too slow is the
failure the two sentences are kept apart to prevent. **When a question is both expired and unparked —
the ordinary case, because the sweep that notices the expiry is what ends the run — the expiry
sentence wins**, in `confirmRequest` and on the screen alike, off one tie-break in
`unansweredReason`. Saying **no** is still accepted, on the standing rule that a rejection grants
nothing.

**Not `ActionDispatch`'s `abandoned`**, which is an instruction that was queued and never handed out.
One word, two closed sets, no overlap: this one is about a question a person was asked, that one
about a command the browser never received.
*Checked against the banned words:* not bare `action`, not `approval` (displaced by ChangeVerdict),
not `escalation` (displaced by DecisionNeeded).
*Displaces:* approval request · permission prompt · escalation · are-you-sure · gate prompt ·
pending action · DecisionNeeded (which is a judgment call, not a capability question).
**Consumer:** "I need you to say yes to this one thing."

### ConfirmationVerdict — *table, append-only*
`confirmed | rejected`, decided by a human, one row, never updated. **Only a human writes one.**

**There is no `expired` member and no third value.** A request that times out produces **no row**, so
the gate sees the same absence it saw before anyone was asked and refuses. Expiry therefore cannot
approve anything — there is no code path from elapsed time to permission, because there is no value
for elapsed time to write. A confirmation that times out into *yes* is the failure mode the whole
mechanism exists to prevent.

The absence of a row and a `rejected` row are identical to the gate and different in the report: one
says *"you said no"*, the other says *"I asked and you never saw it"*.
*Checked against the banned words:* not `ReviewDecision`, not `approval`, not `outcome` as a column.
Distinct from ChangeVerdict (a decision about proposed text) and from `ActionOutcome.scopeVerdict`
(code-written, about realised effect) — the noun is shared across levels and the prefix names the
level, the same shape `ActionIntent`/`StatedIntent` already defends.
*Displaces:* approval · consent · authorization (as a row) · yes/no · allow (as a verdict).
**Consumer:** Yes, do it · No, don't.

### ShiftOutcome — *table*
What a run produced, one row per producing run: `kind`, `reversibility`, a one-line headline, and the
join to whatever holds the substance. It replaces the sentence *"the run produced a Changeset"* —
which was true only while the sole capability was drafting prose.

An outcome of kind `document-changes` holds a Changeset of ProposedChanges; the other held kinds hold
OutcomeProposals; a `landed` outcome holds neither and carries a report of what happened. A run that
completed no work writes **no row**, exactly as an empty Changeset writes none.

**`ShiftOutcome`, not bare `Outcome`.** A prefix-only difference from `ActionOutcome` is the
`ReviewDecision`/`ChangeVerdict` collision this vocabulary calls the most expensive available: two
rows a paragraph apart, one per action and one per shift, told apart by a word that is easy to drop
in speech. The prefix naming the level is the pattern `ActionIntent`/`StatedIntent` already
established, and it is defended on exactly those grounds.
*Checked against the banned words:* **`outcome` as a bare column name stays banned** — this is a
table, and a foreign key to it is `shiftOutcomeId`. Not `ActionRecord`, not `Artifact`, not `Task`.
*Displaces:* Outcome (bare) · Result · Deliverable · Product · RunResult · Output (as a noun) ·
"the changeset" used to mean everything a run made.
**Consumer:** what I did — "I drafted 6 changes" / "I collected 11 rates" / "I sent it".

### ShiftOutcomeKind — *value object*
Closed and code-owned: `document-changes · collection · answer · message-draft · external-effect`.

**No `other`.** An `other` kind is a free-text field wearing an enum's clothes: every consumer would
need a fallback branch, and the fallback branch is where a landed effect gets rendered as a
reviewable proposal — the one rendering error in this design that lies to somebody.

**`answer`, not `finding`.** `ReviewFinding` owns "finding", and two things called a finding whose
authorship differs is the collision this document spends a paragraph on.

Adding a member is a schema change plus migration, never configuration. It should feel heavy; if a
sixth is reached for twice, the kinds are wrong rather than incomplete.
*Checked against the banned words:* not `Artifact`, not `Task`, not `Draft` (as a type — the
`message-draft` member is a hyphenated value, not a table).
*Displaces:* deliverable type · artifact kind · result type · other · custom · misc.
**Consumer:** phrasing only — "changes to your document" / "a list" / "an answer" / "a message,
unsent" / "something that happened".

### Reversibility — *value object on ShiftOutcome*
`held | landed`. **Code-assigned, never model-assigned and never a person's to set**, computed from
the ledger: `landed` when any completed ActionIntent in the run carried a landing ActionKind. A model
that could declare its own work reversible would be granting.

`held` means Propositum is holding it and the person decides. `landed` means it is out there.
**A `landed` outcome is offered no verdict at all** — not a disabled button, not a greyed control.
The interface reports *"This already happened, outside Propositum"* and the server refuses a verdict
deterministically, because a person who clicks Reject on a sent message and is told "rejected" has
been lied to by the one screen the trust model rests on.
*Checked against the banned words:* not `status` (displaced), not `verificationStatus` (banned), not
`RiskLevel` (displaced by AutonomyControls).
*Displaces:* reversible flag · isReversible · undoable · committed · finality · RiskLevel.
**Consumer:** "You decide" / "This already happened".

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

> **Review produces decisions, never documents.** ~~The reviewed text is a pure fold
> `materialise(base, changes, verdicts)`.~~ **Scoped 2026-08-11
> ([ADR-0009](docs/adr/0009-composed-offers.md)): for a `document-changes` ShiftOutcome, the reviewed
> text is a pure fold `materialise(base, changes, verdicts)`.**

The first sentence is unchanged and still governs everything: no review of anything, of any kind,
writes the thing it is reviewing. The second was always a statement about **documents**, and it is
now true of one ShiftOutcomeKind out of five — a `collection` has nothing to splice, an `answer` has
no base, a `message-draft` is held whole rather than addressed by span, and a `landed` outcome is not
reviewed at all. Scoping it rather than generalising it is deliberate: the fold's guarantees come
from the immutable base and the stable offsets, and a "generalised fold" over things with no base
would be the same word covering a weaker property.

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

### OutcomeProposal — *table*
One independently decidable unit of a **held** ShiftOutcome that is not a document change: one rate
in a `collection`, one paragraph of an `answer`, one `message-draft` held unsent. Carries its own
label, body, one-sentence reason, and `citedActionIntentIds` validated against its run's own
completed reads — the same provenance closure ProposedChange has.

**`ProposedChange` is not replaced.** It is the `document-changes` specialisation of this idea and
keeps its own table, because it carries a BaseSpan and a `before` verifier that an OutcomeProposal
has no field for. So an outcome holds ProposedChanges **or** OutcomeProposals, never both.

The cost of that, written down rather than discovered: two tables of nearly the same shape against
two different addressable units, and unifying them later is a migration rather than a rename. It is
accepted because the alternative — one table with a nullable BaseSpan — makes the immutable-base
guarantee conditional on a column being non-null, which is exactly the kind of guarantee that stops
being one.

A `landed` outcome has **no** OutcomeProposals. There is nothing to decide.
*Checked against the banned words:* not `Task`, not `suggestion` (displaced by Changeset/
ProposedChange), not `Artifact`, not `finding`.
*Displaces:* item · row · entry · result item · finding · suggestion · card · Task.
**Consumer:** the same word the kind uses — "this rate", "this paragraph", "this message".

### OutcomeVerdict — *table, append-only*
`accepted | rejected | edited` against one OutcomeProposal, with `editedText` iff edited. Never
updated, never deleted; the current verdict is the most recent row; no row means undecided.
**Only a human writes one.** ChangeVerdict's shape exactly, one level out, and `edited` is kept for
the same reason — collapsing edit into accept makes H2 unmeasurable.

**The server refuses a verdict against a `landed` outcome deterministically**, before it checks
anything else. That refusal is not a UI concern that happens to be enforced twice; it is the one
place where an interface bug could otherwise tell someone their sent message was rejected.
*Checked against the banned words:* not `ReviewDecision`, not `approval`, not `outcome` as a column
name — this is a table, and its foreign key is `outcomeProposalId`. Shares its noun with
ChangeVerdict, ConfirmationVerdict and `ActionOutcome.scopeVerdict`; in every case the prefix names
the level, which is the `ActionIntent`/`StatedIntent` pattern and not the `ReviewDecision` mistake.
*Displaces:* ReviewDecision · approval · acceptance · keep/discard · vote.
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
ChangeVerdict, and not an `openThread` claim (that is a pre-handoff strand). *(One class is
narrower since 2026-09-01, ADR-0024's build: a refused CHARGE — `amount-over-ceiling` or
`amount-unparseable` at the transport — raises a `DecisionNeeded` built by `chargeRefusedQuestion`
from the extension's attested account, and there the failed `ActionIntent`/`ActionOutcome` pair
exists first and the run ends with the question. What made `DecisionNeeded` the right shape anyway
is its load-bearing property, which is unchanged: the answer is prose and grants nothing — a
confirmation would need a yes-path, and a yes-path would need the ceiling relaxed in flight.)*

Naming it is not new abstraction: the brief already mandates "human decisions required" as a
ShiftReport field, and without a name the demo's headline output is unrepresentable.

A declared decision-class taxonomy is deliberately not built: "which partner tier to propose" is not
plausibly enumerable in advance, so the mechanism would never fire on real work. H3 therefore scores
model self-report here, and the results must say so.
*Displaces:* open question · unresolved question · RaisedQuestion · DecisionClass · ApprovalClass ·
requiresHumanDecision · blocker · escalation.
**Consumer:** What I need from you.

**Amended 2026-08-26 ([ADR-0022](docs/adr/0022-the-fourth-verdict.md)): it can be answered now.** The
entry above described a row nothing could act on, which was true for ten days and was the reason
`openDecisions` was hardcoded to zero.

### DecisionVerdict — *table, append-only*
One human answer to one DecisionNeeded: `decisionNeededId` (UNIQUE), `answer`, `decidedAt`, `source`.
**Only a human writes one**, and the answer is prose, because the question exists precisely because
the worker could not reduce it to a choice. A Yes/No control here would be a ConfirmationVerdict with
the safety filed off.

**It grants nothing.** No AuthorizedAction is minted, no ContractScope widens, no ActionKind becomes
allowed. `compilePolicy` cannot receive one, for the same structural reason it cannot receive a
StatedIntent. It enters the product on the footing `guidance` already has — human prose that informs
work and authorises none of it — which is why this is the one verdict that may be given from a phone
and a ConfirmationVerdict may not ([ADR-0021](docs/adr/0021-a-thread-on-the-persons-phone.md)).

**It is read by no worker in this slice**, and that is the design and not an omission. Carrying an
answer into the next Shift's StatedIntent is a path from a worker's own question to the next
agreement's text with no human ratification between, which is what ADR-0006 §5 exists to refuse.
*Displaces:* resolution · answer flag · decisionResolved · settled.
**Consumer:** Tell it · answered <date>.

### ThreadConnection — *table*
One paired message channel: `provider` (UNIQUE), the chat identifier, `pairedAt`. The UNIQUE on
`provider` is what makes this single-person structurally rather than by convention — the same device
CalendarConnection uses, for the same reason.

**The bot is the person's own.** They create it; there is no shared bot, no operator, and nothing of
ours in the path. A shared bot would be a server of ours wearing a different hat.
*Displaces:* messenger · notification channel · Notifier · push target · subscriber.
**Consumer:** Your phone · Paired.

### ThreadMessage — *value object*
One thing Propositum says on a paired channel. A **closed** union, rendered from durable rows by
`src/domain/conversation/messages.ts` the way STOP_RULES are — **no model composes one.** Where it
carries model prose (an offer's rationale, a shift headline) it quotes a stored row and does not
generate a phone-shaped variant of it.

**Every member carries a decision**, because Principle 13 forbids a notification with no decision
attached and names notifications as the place that rule erodes first. Five members: an offer · a
raised ConfirmationRequest (a link, and no verb) · a raised DecisionNeeded · a run reaching a terminal
status · a CaptureGap while away. A sixth is a diff to that list and to `tests/conversation.test.ts`.

**What it may never contain:** page-authored text, a quotation, an element's accessible name, a tab
title, typed text, a screenshot, or any URL but a loopback deep link. **Anything that has crossed
`Datamarked` may not leave the machine.**
*Displaces:* notification · alert · push · ping · digest.
**Consumer:** none — a ThreadMessage IS consumer copy.

### ShiftReport — *table*
The re-entry artifact for one Shift, written once **in the app process when the human returns** —
never by an AgentRun. A report producible only by a live Runner cannot exist on `interrupted`, the
outcome that most needs one.

One row per Shift holding a single model-authored narrative line. **Every other section is a
deterministic rendering of durable rows:**

| Section | Source |
|---|---|
| What I completed / didn't get to | the ledger and the run's plan steps — never a counter |
| What I produced | ShiftOutcome — a Changeset and its ProposedChanges for `document-changes`, OutcomeProposals for the other held kinds, and for a `landed` outcome a report with no verdict controls at all |
| What I need you to say yes to | an unanswered ConfirmationRequest, quoted with attribution |
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
| `Workflow`, `WorkflowStep`, `WorkflowOffer` | `WorkOffer` (what Propositum would do) · `OfferOutline` (how) · `ExecutionPlan` (what it reported doing) |
| `BrowserCommand`, `CDPCall` | `ActionDispatch` |
| bare `Outcome` | `ShiftOutcome` (per run) · `ActionOutcome` (per action) |
| `finding` for what a run produced | the `answer` ShiftOutcomeKind — `ReviewFinding` owns "finding" |
| `actor` | `observedBy` · `SessionClaim.origin` |
| ~~`Intention` as a field or type~~ | ~~prose only — allowed in VISION.md~~ **Unbanned 2026-08-16 ([ADR-0011](docs/adr/0011-intention-above-worksession.md)): `Intention` is a table.** `ActionIntent`, `StatedIntent`, `recordIntent` and all 141 occurrences of `intentId` are unchanged and unrelated — the collision is accepted, not fixed |
| `WorkingAgreement` as a type name | **Reserved 2026-08-16 (ADR-0011)** for the durable delegation policy, which is **not built**. Until it is: `HandoffContract` (the object) · "Working agreement" (its consumer label, unchanged). The word has now been spent twice; there is no third |
| `definitionOfSuccess` | `definitionOfDone` — one field name, shared by `Intention` and `StatedIntent` |
| `IntentionStatus`, a stored lifecycle column | `IntentionState` (a computed view) |
| copy, patch, hunk, diff chunk, changeset, anchor, offset, fold, materialise, base version, commit, merge | *(UI copy)* changes · this change · the version you left · Preview · Accept · Reject · Edit |
| ledger entry, agent run, job, orchestration, allowlist | *(UI copy)* what I did · Propositum · what Propositum can see |
| `take over` *(UI copy only — added 2026-08-26)* | **"hand over"**. The person is always the subject, as they are in every one of the five verbs below. Both spellings were live on adjacent screens pointing opposite ways: the project screen said *Hand this over*, the agreement's own button said *Take over*, and nothing on either said who was taking over what. The type name followed — `TakeOver` in `src/ui/reading.tsx` is now `HandOver` |
| `shift` *(UI copy only — added 2026-08-26)* | *"While you were away"*, which is this document's own consumer wording for a Shift; or make Propositum the subject and drop the noun, which is what the front door's count sentence does. The word is **correct** as a type, an identifier, a route and a docblock — the ban is on something a person reads |
| `claim`, `claims` *(UI copy only — added 2026-08-26)* | the sentences themselves, under their kind's heading — this document's own consumer wording for a SessionClaim is *internal* |
| `vault`, `wallet`, `password`, `passphrase`, `credential` *as a field, type or column — added 2026-08-26 ([ADR-0025](docs/adr/0025-computer-use-beyond-the-browser.md))* | **nothing.** There is no field for one and that is the design: Chrome holds the person's passwords and Propositum clicks the prompt, so it never sees, stores or transmits a credential of theirs. The words are banned because a name is how a field arrives — `fill-credential` was the shape an earlier draft proposed, and refusing the word refuses the shape. Correct in **prose**, in this table, and in ADR-0025 §5 where the vault is argued for and refused |
| `alwaysAllow`, `rememberThisAnswer`, `trustThisSite`, `dontAskAgain` *— added 2026-08-26* | **nothing.** `src/policy/tools.ts` already refuses this and the word is the last step before the code: *"a remembered yes is a confirmation that outlives the thing it was about, granted at a moment when the person was looking at something else."* What replaces it is [`PurchaseAuthorization`](docs/adr/0024-purchases-within-a-ratified-authorisation.md) — scoped, ratified once, and expiring — which is a *narrower* permission granted deliberately, not a remembered click |
| bare `Purchase`, `Payment`, `Order` as a type | `PurchaseAuthorization` (what the person ratified) · `ActionIntent` (the attempt) · `ActionOutcome` (what happened). None of the three bare words says which of those it means, and the ambiguity is worse here than anywhere else in this table |

**Three of those rows are executable, from 2026-08-26.** `tests/consumer-vocabulary.test.ts`
extracts what a person can read out of `src/ui`, `src/app` and `extension/src/panel.html` — JSX text
with its interpolations rewritten, the literals inside those interpolations, prose-carrying
attributes, and free-standing sentences — and fails on *take over*, *shift*, *claim* and *task*. It
was written because this table had never been run and four of its bans had leaked onto twelve
screens. What it cannot see is stated in its own docblock: a sentence assembled at runtime, and a
component that computes the right words and renders others.

**The `outcome` ban is on a column named `outcome`**, which is ambiguous between `disposition` (what
happened to one action) and `terminalReason` (why a run ended). It is **not** a ban on a foreign key
named for the table it points at: `outcomeId`, `shiftOutcomeId` and `outcomeProposalId` are correct
and say exactly what they hold. The rule is about a column whose name does not tell you which of two
things it contains, not about the letters.

~~**Four verbs that must not be confused:**~~ **Five, 2026-08-26:** the gate **refuses** · the human
**rejects** · the model **declines** · the human **confirms** · the human **answers**.

The fourth is new, and it is a different act from the third human verb: **rejecting** is a decision
about work already produced and held, and **confirming** is permission for something that has not
happened yet and cannot be undone once it has. A UI that used one word for both would be asking
someone to authorise an irreversible action with the same control they use to bin a paragraph.

**The fifth arrived 2026-08-26 ([ADR-0022](docs/adr/0022-the-fourth-verdict.md)), and it is the only
one of the five that grants nothing.** **Answering** is writing prose in reply to a DecisionNeeded —
a fact the worker did not have, not a permission. It is deliberately *not* **deciding** (too close to
the noun, and it reads as authorisation) and *not* **resolving** (which describes the question's state
rather than the person's act, and invites a button that closes a question without saying anything).
The control is a text field. It is never a pair of buttons, because the question exists precisely
because the worker could not reduce it to a choice.

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
   and more specific document. Deferred, not cancelled. *(Clarified 2026-08-11: a confirmation pause
   is continuation under another name and is **not** an exception to this. It stays inside one Shift
   and one accepted contract, and it asks for more human consent rather than less. What it changes
   is that a Shift can now span a person's coffee break.)*
7. **"Copy" is banned from the interface.** Three brief passages say "edit a copy". Nothing is
   copied — the Changeset is the copy, and review materialises a projection on demand.
8. **The page-text retention budget is a published product constant**, not an implementation
   detail: title, cleaned URL, deliberate selections verbatim, and at most 2,000 characters of
   readable article text per approved source. *(Joined 2026-08-11 by a second published constant,
   `SNAPSHOT_BUDGET_CHARS`, bounding what an acting agent retains. Two constants, two ledgers, and
   they stay disjoint.)*
9. **A human never creates a Project.** The brief excludes *automatic project recognition*;
   ADR-0008 overrode that exclusion for detection and [ADR-0009](docs/adr/0009-composed-offers.md)
   reverses it outright. Projects are auto-created, auto-named, matched by deterministic term
   overlap, and renameable. Recorded as an override rather than absorbed quietly, because it is the
   second time this exclusion has been walked back.
10. **An irreversible capability may exist.** The brief excludes sending, purchasing, publishing and
    deleting, and the vocabulary implemented that by absence. [ADR-0010](docs/adr/0010-acting-in-the-browser.md)
    replaces absence with a landing `ActionKind` behind a per-action human confirmation. This is the
    only override in this list that makes the product **less** safe, and the standing-rules section
    above gives it the argument it needs rather than the argument it would like.

    ~~The only one.~~ **Amended 2026-08-26 — there are now three, and this entry undersold what was
    coming.** [ADR-0024](docs/adr/0024-purchases-within-a-ratified-authorisation.md) spends the
    unconditional non-`GET` block in `extension/src/cdp.js`, so **Propositum will buy things** —
    within a `PurchaseAuthorization` a person ratified, bounded by an origin, a ceiling, a count and
    an expiry. [ADR-0025](docs/adr/0025-computer-use-beyond-the-browser.md) removes the bound to one
    Chrome tab, so the blast radius becomes the machine. Both make the product less safe and both say
    so at the top rather than here. ~~there are now three~~ **Corrected 2026-09-01: four —
    [ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md) overrides the brief's
    exclusion of *sending*, inside a `SendAuthorization` a person ratified naming its exact
    recipients. Decided and unbuilt: `grep -rn 'gmail' src/` finds nothing and
    `tests/architecture.test.ts` still asserts no send-shaped function.**

    ~~All three~~ **All four, since 2026-09-01,** **are decisions and none is built**, which this
    entry got wrong for about an hour on the
    day it was written. ~~`LANDING_ACTION_KINDS` … is no longer empty~~ — **it is still empty.**
    ~~`src/domain/handoff/policy.ts:168` reads `new Set<ActionKind>()`, `extension/src/cdp.js:529` still
    returns `blocked-request` for every non-`GET`, and `grep -rn 'PurchaseAuthorization' src/` finds
    nothing.~~ **Re-marked 2026-09-01, the day ADR-0024's build began:** the grep finds the object
    now — the type, the gate rules and the columns exist, and `complete-purchase` is in the enum,
    grantable only by ratification. ~~`LANDING_ACTION_KINDS` is still empty…~~ **Item 5 landed
    later the same day: the set holds `complete-purchase`, the extension's refusal is
    permit-conditional with absence meaning exactly what unconditional meant, and buying happens —
    once per ratified authorisation, at or under its ceiling, and in no other case.** What ADR-0024
    changed first was the **reason** the set was empty: it
    was *the transport cannot
    honour a member* and it is now *the transport has been decided against and nobody has written the
    code*. The correction is left visible rather than tidied because stating a decision in the present
    tense is the exact failure this override's own paragraph warns about, and it happened here, inside
    the pass meant to catch it.
11. **The core primitive is the Intention, not the persistent work session.** The brief says *"Its
    core primitive is the **persistent work session**. A work session can transfer control between
    Human → Propositum → Human → Propositum. The persistent object is the session, not the
    individual agent."* [ADR-0011](docs/adr/0011-intention-above-worksession.md) puts `Intention`
    above `WorkSession`: a sitting is an episode that may advance an Intention, and the durable
    statement of what the work is for belongs to the person rather than to the sitting. The brief is
    **not edited** — it declares itself historical and its own rule is that the later document wins
    and should say that it does. This entry is that mechanism.
    The override is narrower than it sounds and is worth bounding here rather than leaving to be
    inferred: a `WorkSession` is unchanged in every field but one nullable foreign key, the
    handoff → worker → reviewer → re-entry slice is untouched, and everything Propositum *infers* is
    still per-sitting and still cold. What moved above the session is one sentence a person typed.

12. **The handover verb is *hand over*, not *take over*.** `docs/FOUNDING_BRIEF.md` lists *Take
    over* among the words the interface may use. Two spellings for one act shipped anyway, on
    adjacent screens, with the direction reversed between them — *Hand this over* on the project
    screen, *Take over* on the agreement's own button. The brief's word loses because the person is
    the subject of every other consumer verb this document ratifies (they **reject**, they
    **confirm**, they **answer**), and a verb that alternates its subject is the one thing a
    first-timer cannot resolve from context. Recorded here rather than absorbed quietly, per the
    brief's own rule that the later document wins and should say that it does.
    *(2026-08-26. Enforced by `tests/consumer-vocabulary.test.ts`, not by discipline.)*

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
  so the approved sources and the document survive a session. ~~**The objective still does not, and
  must not**: a stale objective inherited quietly by the next sitting is worse than a cold read,
  because nothing on screen would say it had been.~~ What carries forward is where the work lives,
  never what Propositum thinks it is for.
  **Amended 2026-08-16 ([ADR-0011](docs/adr/0011-intention-above-worksession.md)): the ruling's
  objection was invisibility, not persistence, and it is answered by construction rather than
  deleted.** The operative word was *quietly*, and the ruling named its own reason — *because
  nothing on screen would say it had been*. An `Intention` is durable and survives every session,
  and it is **human-ratified only**: a person writes it, a person edits it, no detector and no model
  boundary can, and no model-facing schema has a field to put one in. Nothing is inherited quietly
  because nothing is inherited by inference at all.
  **The last clause above is unchanged and is now enforced rather than observed.** What Propositum
  thinks is still cold every time: `SessionClaim{kind:'objective'}` is untouched — one per revision,
  inferred, evidence-bearing, per-sitting — and no reading reads an Intention.
  **What the amendment does not buy is accuracy.** A sentence a person wrote in March is visible in
  August and can be flatly wrong, and nothing here detects that the work moved. Human-ratified
  removes silence, not staleness. The contract's human ratification is now the only thing standing
  between a months-old sentence and a run, and it was not designed to carry that.
  **And one third of the answer is a UI requirement rather than a schema property.**
  *Human-authored* and *never model-written* are structural. *On screen wherever it is used* is a
  sentence somebody has to keep true in `.tsx` files, with no test that would notice if it stopped
  being true. A handoff screen that pre-fills a StatedIntent from an Intention without saying where
  the words came from reproduces exactly the failure the struck sentence described.
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
- **`SessionPhase` has no honest value for a confirmation pause.** The person is at their desk being
  asked a question, under a screen headed *"While you were away"*. This document refused a `paused`
  phase with a good argument, made before a run could ask and wait. Keeping `away` is the smaller
  lie, and it is still a lie. Recorded rather than fixed, because a fifth phase for a state that
  ends in one click is a worse trade than one inaccurate heading.
- **A hostile page can force a confirmation storm.** Make every control post, and every action needs
  a human; the twentieth question gets answered without reading. Habituation is a real attack and
  there is no third option — failing open on repetition would let an attacker turn confirmation off
  by asking for it enough times. The mutating-action cap is what actually bounds it.
- **The injection surface grew by roughly two orders of magnitude**, from a 2,000-character excerpt
  read once to an accessibility tree read every turn, every accessible name of it page-authored.
  ADR-0006 says datamarking is depth, not a boundary, and depth scaled a hundredfold is still depth.
- **~~This is 38 terms.~~ ~~This is 52.~~ ~~This is 54.~~ ~~This is 55.~~ ~~This is 56.~~ This is
  57.** Fourteen
  were added on 2026-08-11 for composed offers and browser action, two on 2026-08-16 for persistent
  intentions — `Intention` and `IntentionState` — one on 2026-08-17 for authored labels:
  `AuthoredLabel` — one on 2026-08-18 for reading a calendar: `BusyInterval` — and one on 2026-08-20
  for continuing an Intention across sittings: `WorkSoFar`
  ([ADR-0017](docs/adr/0017-continuing-an-intention.md)).
  **The count here is not the authority and never was** — `README.md` carries it and
  `tests/counts.test.ts` checks that one against the glossary itself, which is the only version of
  this claim that has ever been able to stay true. This line is kept because the *history* in it is
  worth reading and a bare current number is not.
  Small against nine brief objects, seven model boundaries, an append-only
  ledger, a diff model, a policy gate and an acting agent. **Not small in absolute terms, and no
  longer arguably small at all.** The earlier note said roughly six earn their place only
  marginally; that is now closer to ten, and the first cut should start with the terms that exist to
  name one field on one row.
  **The two added on 2026-08-16 are held to that standard rather than exempted from it.**
  `Intention` is a table with rows and an identity, and it survives the cut on the same grounds
  every other table does. `IntentionState` is a computed view over five other tables, so it names no
  field on any row and is the weaker of the two. It earns its place by **holding a refusal**: a
  lifecycle word the interface says out loud, with no entry here, is exactly how `waiting` gets
  declared by someone who never learned it was refused. That is a thinner claim than the other 53
  make, and it is stated as the thinner claim it is.
  **`AuthoredLabel`, added 2026-08-17, is held to that standard too, and it fails the first half of
  it.** It names one field on one row on a path that is not even persisted — precisely what the
  sentence above says the first cut should start with. It is added anyway on the second half, for
  the same reason `IntentionState` was: it holds refusals that would otherwise be nowhere. Without
  an entry, the words `tabGroupTitle`, `groupName` and `userLabel` all arrive uncontested, and —
  worse — the label is a short human-typed sentence naming what somebody is working on, which is a
  `SessionSubject` and an `Intention` in shape and neither in provenance. The promotion this
  vocabulary forbids most sharply is exactly the one a person's own words invite. **If the cut ever
  comes, this is a candidate; what must survive it is the refusal, not the noun.**
  **`BusyInterval`, added 2026-08-18, fails the first half by the same test and passes the second by
  a wider margin than either.** It names two fields on a value object that is never persisted and
  never leaves the moment it was read in, which is exactly the shape the sentence above says to cut
  first. It is added because it is the first term in this vocabulary naming something that **came
  from outside the machine and from neither our code nor the person**, and because three prohibitions
  have to be somewhere a reader will hit them: it is not an observation, it reaches no model, and it
  authorises nothing. Left unnamed, the words `Availability`, `AwayWindow` and `CalendarEvent` all
  arrive uncontested, and the last of those would be a promise the scope cannot keep — Propositum
  never sees an event. **What must survive a cut is that a calendar recommends and never grants**;
  the noun is expendable, and the entry says so in its own body rather than only here.
