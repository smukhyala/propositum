# ADR-0011 — Intention above WorkSession

**Status:** accepted · 2026-08-16
**Amends:** [ADR-0009](0009-composed-offers.md) (what a `Project` owns, and the one thing about a
Project a model still may not write)
**Overrides:** [`docs/FOUNDING_BRIEF.md`](../FOUNDING_BRIEF.md)'s *"Its core primitive is the
**persistent work session**"* · `CONTEXT.md`'s banned-words row for `Intention` · `StatedIntent`'s
*Displaces:* claim on "Intention (as a field)" · `CONTEXT.md`'s known-risk ruling that the objective
must not survive a session — **in part, and the surviving half is named below and enforced by
construction**
**Depends on:** [ADR-0008](0008-ambient-detection.md) — *"What detection produces | A suggestion.
Never a session, never an action."* That sentence is what makes this one safe, and it is not
reopened here.

## The property that stops being structural

Until today there was **no durable row anywhere in Propositum whose job was to say what the work was
for.** That was not a rule anyone followed. It was a shape: `Project` has no objective and no
free-text description by explicit decision, so the only place purpose lived was a
`SessionClaim{kind:'objective'}` on a reading of one sitting, produced from that sitting's events,
carrying provenance to them, and never consulted again after the sitting ended. A cold read cannot
be out of date, because it was computed a minute ago from things that happened this afternoon.

This ADR ends that, and the cost is stated before anything that makes it sound affordable. An
`Intention` is durable. A durable sentence about purpose is a sentence that **stops being re-read**.
The person who types *"win the Northwind renewal by shipping the tier comparison"* in March is not
prompted again in August, and nothing in this design detects that the renewal closed in May. The
handoff path reads it. `StatedIntent` restates it. A human ratifies the restatement, as they always
have — and that ratification is now the **only** thing between a sentence written months ago and a
run, where previously the sentence itself could not be older than the sitting.

What this ADR buys is that the sentence is **visible and the person's own**. What it does not buy is
that the sentence is **true**. Those are different properties, `CONTEXT.md`'s ruling below was about
the first one, and everything after this paragraph argues that the first one is what the ruling
actually protected. None of it argues that the second one is protected. It is not.

## What `CONTEXT.md` said, in its own words

Quoted rather than paraphrased, for [ADR-0010](0010-acting-in-the-browser.md)'s reason: the
paraphrase always comes out weaker than the original and the original was right.

> **There is no cross-session continuity.** The objective does not survive a session, and the
> brief's Project "goals" is deliberately unmodelled. A second session starts cold — which the
> product's own shift-change metaphor implies otherwise.
> *Partly addressed 2026-08-11.* `matchProject` joins a new sitting to the project it recognises,
> so the approved sources and the document survive a session. **The objective still does not, and
> must not**: a stale objective inherited quietly by the next sitting is worse than a cold read,
> because nothing on screen would say it had been. What carries forward is where the work lives,
> never what Propositum thinks it is for.

Read it for what it forbids rather than for its headline. The prohibition has three words in it —
*stale*, *inherited*, *quietly* — and the ruling names its own reason: **because nothing on screen
would say it had been.** That is an objection to **invisibility**. It is not an objection to
duration. A sentence that survives a session, that the person wrote, and that is on screen wherever
it is used does not meet the description — and the last clause says exactly which thing was being
protected: *never what Propositum thinks it is for.*

Two of those three are structural and are argued below. **The third — on screen wherever it is
used — is a requirement on the interface, not a property of the schema**, and it is therefore the
weak link in this answer. A handoff screen that pre-fills a `StatedIntent` from an Intention and does
not say where the words came from would reproduce the exact failure the ruling described, in a
product that had just written an ADR about not doing that.

**An Intention is not what Propositum thinks the work is for. It is what the person said it is
for.** Nothing is inherited quietly, because nothing is inherited by inference at all — there is no
detector, no model boundary and no code path that writes or edits one.

### Which half survives, and how it is held

The half that survives is the whole of the ruling's reason, and it is now enforced by shape rather
than by anyone remembering:

- **No model writes an Intention, ever.** Not `subject.ts`, not the handoff boundary, not the
  detector, not a recovery sweep. The creation path is a human act, exactly as `ChangeVerdict`,
  `OutcomeVerdict` and `ConfirmationVerdict` already are — *"Only a human writes one"* is a sentence
  this vocabulary has written three times, and this is the fourth.
- **`SessionClaim{kind:'objective'}` is untouched.** Still exactly one per revision, still
  `origin: inferred | human | edited` per claim, still evidence-bearing, still produced from one
  sitting's events and nothing else. The next sitting's reading is cold every time. Nothing about
  the reading path reads an Intention.
- **So "a second session starts cold" stays true of everything Propositum works out for itself**, and
  stops being true of a sentence the person ratified and can see, edit and delete. Those are two rows
  with different authorship, which is the distinction `SessionClaim.origin` was invented for one
  layer down. This ADR applies it one layer up.

The half that dies is the headline — *the objective does not survive a session* — and it dies only
for objectives with a human author. It is amended in place in `CONTEXT.md`, struck and dated, not
deleted, because a reader has to be able to see that the refusal was made, considered, and narrowed
rather than forgotten.

## Decision

**`Intention` becomes a legal type and table name. An Intention is created and edited only by a
person. A `WorkSession` and a `HandoffContract` may point at one. Nothing else changes.**

| | |
|---|---|
| **What an Intention is** | A durable, human-ratified statement of a desired outcome and what would count as success — **ratified, which is not the same as authored**; see the honest limits |
| **Who may create one** | A person. There is no other writer, and no field a boundary schema could put one in |
| **Who may edit one** | A person. Rows are **mutable**, because they hold no inference and carry no provenance |
| **How many** | **At most one per `Project`** for now — see below, this is a deferral, not a model |
| **What points at one** | `WorkSession.intentionId` and `HandoffContract.intentionId`, both **nullable**, so every existing row, fixture and test keeps working with no backfill |
| **What it does not touch** | `SessionClaim{kind:'objective'}` · document ownership · `ContractScope.baseVersionId` · the guarded-table set |
| **What state it has** | `IntentionState` — a **computed view** with five members. Never a stored column |

### 1. Human-ratified only is a shape, not a rule

The distinction matters because this repository has been burned by the other kind. A rule is a
sentence in a document that code is trusted to honour; `CONTEXT.md` §4 describes a claim fence that
*"has never existed"*, and `ReviewFinding` is *"explicitly non-authorizing"* by convention plus
vigilance. Those are rules.

This is a shape, in the sense ADR-0004 uses when it says a prohibition implemented as a missing
capability cannot be misconfigured:

- **No model-facing schema has a field for an Intention.** Not `subject.ts`, not `handoff.ts`, not
  `worker-action.ts`. A model that wanted to write one has nowhere to put it, in the same way a
  `WorkOffer` has no field that could carry a URL ([ADR-0009](0009-composed-offers.md) §1).
- **`compilePolicy` cannot receive one**, for the reason `StatedIntent` and `WorkOffer` already
  cannot: prose is typed like prose, and passing it is a compile error rather than a review note.
- **The detector does not read one.** `matchProject` joins on term overlap over subject words and
  gets no new input from this ADR. An Intention is not evidence and is not consulted by inference.

The `Project` no-description rule holds unchanged and is the precedent being followed rather than
bent: *a description that inference reads is a project goal in disguise*. An Intention does not
weaken it, because an Intention is **ratified by a person and never read by the detector**. The
thing the ban forbids is a free-text field that inference consumes. This is a free-text field that
inference cannot see, and the second half of that sentence is the half carrying the weight: even an
Intention whose words a model first drafted is invisible to `matchProject`.

### 2. `IntentionState` — five members, and the sixth is not declared

`working · delegated · needs-you · sleeping · done`. A **computed view**, never a stored column,
following `EnforcedPolicy`, `Shift` and `ActionStatus` and their shared argument: *two stores for one
truth is exactly how a UI comes to display something the gate cannot enforce.* Every fact the five
members derive from is already a durable row — the session's phase, the contract's `acceptedAt`, the
run's terminal status, an unanswered `ConfirmationRequest`, a `DecisionNeeded`.

Direction §1's lifecycle has six. **`waiting` is deliberately absent**, and this is not an oversight
to be tidied later. `waiting` means *progress depends on an external event or dependency*, and
nothing in this system can produce an external event: `ObservationEvent.sessionId` is required and
there is a single ledger writer, so **no event outside a sitting can be persisted at all**, and
`ExternalEvent` is on Direction §8's do-not-build list. An enum member nothing can reach is a
promise the interface would render and the data could never keep. It arrives when event ingestion
does, and it is written down in `docs/ARCHITECTURE.md` as an unimplemented layer rather than
declared in the union.

### 3. `StatedIntent` is a restatement, not a rival

`StatedIntent` already carries `objective`, `definitionOfDone` and `guidance`. It is the Intention's
per-handoff restatement, and saying so is **a move, not a build** — no field is added, removed or
retyped by this ADR.

The relationship in one line: an **Intention** is durable and belongs to the person; a
**`StatedIntent`** is the sentence one contract commits to, ratified for that contract only, and
re-ratified for the next. Everything that made `StatedIntent` safe stays exactly where it is —
`guidance` is human-typed only, an inferred `constraint` claim never pre-populates it, and
`compilePolicy` cannot receive it.

**What genuinely changes is the source of the pre-filled text**, and it is worth naming because it
is the mechanism the honest limit below runs through: where the drafting path previously started
from a reading of the sitting, it may now start from a sentence written before the sitting existed.
The human review that follows is unchanged in shape and is doing more work than it used to.

### 4. The `intent` collision, at full size

`intentId` appears **141 times across 21 files** in `src/` and `extension/`, and not one of them is
an Intention. Alongside it: `ActionIntent`, `StatedIntent`, `recordIntent`,
`AuthorizedAction.intentId`, `orphanedIntentIds`, `currentStep.intent`. **Every one of them stays
exactly as it is.**

The collision is not small and is not being talked down. `Intention` and `ActionIntent` are a prefix
apart and share nothing: an `ActionIntent` is a row deterministic code wrote about one click, before
the click; an `Intention` is a sentence a person typed about a season of work. They sit at opposite
ends of the system on the same stem. The `ActionIntent`/`StatedIntent` convention —
*the prefix names the level* — does not rescue this, because `Intention` has no prefix and is not on
that ladder. It is the first term in this vocabulary defended by *it is not the other one* rather
than by a naming rule, and anyone grepping `intent` will get both.

**Renaming `intentId` → `actionIntentId` was considered and refused, for two reasons that are about
the mechanism rather than about effort:**

1. **`intentId` is the browser channel's idempotency key**, in `src/act/channel.ts` and in
   `extension/src/service-worker.js`. The extension is installed separately from the app and can be
   older than the app it talks to. Renaming a field on that wire is a compatibility event, not a
   refactor, and the failure it produces is a dispatch that silently stops being idempotent.
2. **`action_intent` is append-only and trigger-guarded.** Renaming a column rebuilds the table, and
   `prisma db push` **silently drops append-only triggers on any table it rebuilds** — exit code 0,
   no warning, reinstalled only at the next `ensureAppendOnlyGuards()` call. A naming win that opens
   an invisible unguarded window on the ledger's hottest table is not a naming win.

So the collision is paid, once, forever, by every reader. That is the trade: one confusing stem
against a permanent translation layer between the documents and the schema, which is the rejected
option below.

### 5. `WorkingAgreement`: the name is reserved, the object is deferred

Direction §1 wants `WorkingAgreement` to mean a durable delegation policy spanning handoffs.
`CONTEXT.md` has already spent the word twice: once as a type name `HandoffContract` *displaces*,
and once as `HandoffContract`'s **consumer label**, rendered across six interface files, two model
prompts and the README.

**The name is reserved for the durable policy. The object is not built, and nothing in the interface
changes.** Standing agreements are inside Direction §8's do-not-build-yet shadow anyway, so building
the object here would be out of scope even if the name were free. `HandoffContract` keeps *"Working
agreement"* as its consumer label.

**The word has now been spent twice and must not be spent a third time.** This is the last claim on
it. The bill is named here rather than discovered: when the durable object is built, one of the two
existing uses has to be paid for — either the consumer label moves off *"Working agreement"* (a copy
change across six files, two prompts and the README), or the durable object takes a different name.
Whoever builds it inherits that choice, and it is cheaper to make deliberately than to notice.

**A reservation is not a design, and this one answers nothing about shape.** Whether a standing
agreement composes with a `HandoffContract` by intersection or by override is the question that
matters, and it is untouched here. A standing agreement that could **widen** a contract would invert
the ratification boundary the whole product rests on. Naming the word does not decide that; the ADR
that builds the object has to.

## Rejected: a distinct code name, with `Intention` kept for prose

The serious alternative was to honour the existing ban exactly as written — keep `Intention` for
prose in `VISION.md`, and give the type a name of its own: `Pursuit`, `Aim`, `Throughline`.

It buys one real thing, and it is the thing this ADR is paying for: **zero collision with
`intentId`**. Nothing above section 4 would have to be written.

It is rejected because it creates a **permanent translation layer between the documents and the
schema.** The founding brief's first line is *"Propositum is Latin for intention"*. `VISION.md`
argues in the word. The direction document is built on it. Under `Pursuit`, every one of those
sentences would need silent re-translation at the moment it touched code, forever, by everyone —
and the mechanism keeping the two words aligned would be a note in a glossary, which is the weakest
mechanism available and the one this vocabulary exists to avoid needing.

There is a sharper version of the objection. The banned-words table exists to stop **two words for
one concept**. `Pursuit` beside `Intention` would put two words for one concept **into the table
that bans them**, with the table's own authority behind the split.

**The argument is closer than it reads.** A rename is a mechanical diff, and done once it would also
be permanent. What tips it is that the rename is not one diff: it is a wire-protocol compatibility
event plus a rebuild of an append-only table whose guards `prisma db push` drops without saying so.
The collision costs attention. The rename costs a guarantee.

## What this ADR does not do

Named individually, because a list of what was not built is the thing a later reader most needs and
is least likely to reconstruct.

- **It does not add `ExternalEvent`.** Blocked structurally, not by policy:
  `ObservationEvent.sessionId` is required with a single ledger writer, so no event outside a
  sitting can be persisted at all.
- **It does not add `ProgressEvent`.** Nothing in the system can produce one.
- **It does not add `Blocker`.** Direction §1 lists it; adding it would be a vocabulary
  **reversal**, not an addition. `DecisionNeeded`'s *Displaces:* line already retires *blocker* and
  *escalation*, and un-retiring a displaced word needs its own argument that nobody has made. The
  direction document is unaware of a decision this corpus already took.
- **It does not add `Dependency`.** Nothing produces one, and with at most one Intention per Project
  there is nothing for one to be between.
- **It does not build a graph.** One flat table with a nullable `projectId`. *Intention Graph* is a
  layer name in `docs/ARCHITECTURE.md` marked **partial**, and what is behind the name is a table.
- **It does not make anything infer an Intention.** No detector, no boundary, no model, no recovery
  sweep, no field to write one into.
- **It does not declare `waiting`.** Five members. §2 above.
- **It does not create a second glossary.** Direction §9 names `UBIQUITOUS_LANGUAGE.md`. `CONTEXT.md`
  **is** that file, and `docs/agents/domain.md` routes every skill-driven agent session to it by
  path. A second one would split the single context the repo is built around and silently downgrade
  the first.
- **It does not touch document ownership or base-version pinning.** A `Document` still belongs to a
  `Project`; `ContractScope.baseVersionId` still pins one immutable `DocumentVersion` and still may
  be absent.
- **It does not add a guarded table.** `Intention` is mutable and gets **no** append-only triggers,
  **no** `REQUIRED_GUARDS` entry, **no** `triggers.sql` change and **no** row in
  `tests/append-only.test.ts`'s hand-maintained checklist. ADR-0003's guarded set is unchanged. The
  reasoning is `Project`'s, verbatim: it holds no inference and carries no provenance, so nothing
  about it is append-only.

## Honest limits

- **Human-*ratified* is not human-*written*, and the first draft of this ADR used the stronger
  word.** The sentence a person accepts at the offer screen was composed by a model from page titles
  and search terms. Clicking accept on a plausible sentence is a weaker act than typing one, and this
  design lets that sentence outlive the sitting that produced it —
  [`docs/VISION.md`](../VISION.md) states the gap in full under *Honest limits, today*, and that is
  the version to trust wherever this ADR reads stronger. What is unaffected is the structural claim,
  which should be read exactly as written: **no model writes the row.** That is authorship of the
  record, not authorship of the words in it, and only the first of the two is enforced by shape.
- **Human-ratified removes silence, not staleness.** The whole of the answer to `CONTEXT.md`'s
  ruling is that nothing is inherited *quietly*. Nothing here makes an Intention *right*. A person
  who wrote a sentence in March gets that sentence in August, on screen, with no prompt to revisit
  it, and Propositum has no way to know the work moved. This is the cost named in the first section
  and it does not get smaller further down the page.
- **The restatement step is now carrying more weight than it was designed for.** A stale Intention
  can pre-fill a `StatedIntent`, and the human ratification of the contract is the only thing
  between it and a run. That review was always non-optional; it was not previously the sole guard
  against a months-old sentence.
- **One third of the answer to `CONTEXT.md`'s ruling is a UI requirement, not a schema property.**
  *Human-authored* and *never model-written* are structural. *On screen wherever it is used* is a
  sentence someone has to keep true in `.tsx` files, and this ADR ships no test that would notice if
  it stopped being true. It is the softest part of the argument and it is where the original
  objection would come back.
- **At most one Intention per Project is a deferral wearing a constraint's clothes.** It is safe
  today precisely because the hard question — *which Intention does this sitting belong to?* — never
  gets asked. `matchProject` answers *which project* by term overlap and is already known to
  sometimes fold two subjects into one. The second Intention per Project is where that failure stops
  being untidy and starts being wrong about purpose.
- **`IntentionState` will be honest and unhelpful before it is helpful.** With one sensor, one live
  session enforced in the app layer rather than the schema, and no external events, most intentions
  most of the time compute to `sleeping`. That is the true answer. It is also not an interesting
  screen, and the temptation to make it interesting is the temptation to infer.
- **The word `intent` now means two unrelated things in this codebase.** Section 4. Restated here
  because someone reading only this section should still find it.

## Consequences

- **`CONTEXT.md` gains two terms** — `Intention` (table) and `IntentionState` (computed view) — and
  amends seven existing entries in place: `Project`, `WorkSession`, `HandoffContract`,
  `StatedIntent` (its body and its *Displaces:* line), `SessionSubject`'s banned-word check, the
  banned-words table, and the cross-session-continuity known risk. Plus the organisation note at the
  top of the file, the eleventh override entry, and the term count, which goes from 52 to 54.
  **Every amendment is dated, and every superseded sentence is struck rather than removed.**
- **`WorkingAgreement` gains a banned-words row** reserving the name against its own future use, and
  `definitionOfSuccess` gains one pointing at `definitionOfDone`, so the two lifecycle stages cannot
  drift into two names for one field.
- **The founding brief's core primitive changes** from the persistent work session to the Intention,
  recorded as the eleventh deliberate override in `CONTEXT.md` rather than by editing the brief. The
  brief declares itself historical and its own rule is that the later document wins and says so.
- **The schema change this ADR authorises is exactly one mutable table and two nullable foreign
  keys.** Until they are in `prisma/schema.prisma`, this ADR is a specification rather than a
  description — the reading `CONTEXT.md` §4 already asks for on `claimedBy`. Anything else found
  under the name `Intention` was not authorised here.
- **`intentionState()` is a pure function of rows plus `now`**, and `now` arrives as a parameter.
  `src/domain/**` may never call `Date.now()` or `new Date()`, and `tests/architecture.test.ts`
  enforces that by grepping source text.

## Revisit when

- **A second Intention per Project is wanted.** That is the deferral coming due, and the question it
  defers is which Intention a sitting belongs to. It is a modelling question, not a cardinality
  tweak.
- **Someone proposes that a detector or a boundary write or update an Intention** — even "only the
  state", even "only when it is obviously done". That is this ADR's single property being spent, and
  it needs its own ADR to spend it.
- **`ExternalEvent` becomes real.** Then `waiting` is a genuine gap rather than an honest absence,
  and the five-member union is wrong rather than complete.
- **A stale Intention pre-fills a contract that a person ratifies without reading.** That is the
  predicted failure. It is evidence about the restatement step, not about the person.
- **The durable `WorkingAgreement` object is built.** The label bill in §5 comes due at that moment,
  and the intersection-versus-override question has to be answered before anything is built.
- **Anyone proposes `Blocker` again.** The answer is not "no"; it is that reversing a displaced word
  requires the argument `DecisionNeeded` was given, made in the other direction.
