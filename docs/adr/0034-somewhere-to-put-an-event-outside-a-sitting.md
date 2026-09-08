# ADR-0034 — Somewhere to put an event that did not happen inside a sitting

**Status:** accepted · 2026-09-07
**Source:** [`docs/superpowers/specs/2026-09-07-longitudinal-context-direction-source.md`](../superpowers/specs/2026-09-07-longitudinal-context-direction-source.md),
archived verbatim the day it arrived, by the rule that archived the two before it
**Amends:** [`docs/MVP.md`](../MVP.md)'s *Out of scope* row for `ExternalEvent` — which is moved
from **blocked by structure** to **blocked by scope**, a smaller refusal, and not deleted ·
[`docs/ROADMAP.md`](../ROADMAP.md) Stage 2's *what would have to exist first* ·
[`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) State Ingestion
**Depends on:** [ADR-0002](0002-observation-capture.md) — the single ledger writer this sits beside ·
[ADR-0011](0011-intention-above-worksession.md) — the Intention is human-ratified, and nothing here
reaches it · [ADR-0008](0008-ambient-detection.md) — watching is continuous, offering is
deterministic, starting is a human act
**Answers:** [ADR-0033](0033-a-late-tick-is-a-slept-machine.md)'s closing sentence — *"the next
proposal in that direction will find the argument half made."* This is that proposal, and the half
it inherited is named and not leaned on

## The sentence that stops being true

> **No event outside a sitting can be persisted at all.**

That sentence is in [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) §2, in
[`docs/ROADMAP.md`](../ROADMAP.md) Stage 2, in [`docs/MVP.md`](../MVP.md)'s out-of-scope table and in
`src/domain/intention/state.ts`'s own docblock. It is the strongest structural statement this
repository makes about what Propositum **cannot** know, and it is stronger than a rule because it is
a shape: `ObservationEvent.sessionId` is required, and `createLedgerWriter` is the only caller of
`observationEvent.create`.

**After this, there is a place.** The sentence becomes *no event outside a sitting can be persisted
in the observation ledger*, which is narrower and is not the same promise. What replaces the missing
half is not another shape of the same strength — it is a closed two-member `source` set, neither
member of which is a sensor, and a test that says so. That is weaker, and this document is not going
to round it up.

## Context

Three things in this repository are blocked by one fact, and they have been for a month.

- **`ROADMAP.md` Stage 2 has never started.** Its *what would have to exist first* is this and
  nothing else: *"somewhere to put an event that did not happen inside a sitting… today there is no
  such place at all."*
- **`IntentionState` ships five members instead of six.** `waiting` means *progress depends on an
  external event*, and `src/domain/intention/state.ts` refuses to declare it for exactly this
  reason: *"a member nothing can reach is a promise the interface would render and the data could
  never keep."*
- **`VISION.md` names the capability it cannot have, and says the reason is structural**: *"An
  intention ought to move when the world moves — a reply arrives, a build goes red, a deadline
  passes. None of that can reach this system, and the reason is structural rather than unfinished."*

**The sequencing this takes is the repository's own.** `MVP.md` wrote it while refusing the
integrations, in a sentence that reads as an instruction to whoever came next:

> *"An external sensor needs **a second ledger before it needs an integration**."*

This is the ledger. It takes no integration, and the *Rejected alternatives* section is mostly about
the ones it declines.

**What makes this affordable is that nothing feeds it but a person and a fixture.** The direction
document asks for Gmail, Slack, calendar, GitHub, Notion, filesystem and git. None is taken. What is
taken is the room those would need, built and proved without them, so that the ADR which one day
argues for a real sensor argues about **the sensor** rather than about the schema.

## Decision

**A second append-only table, `ExternalEvent`, with its own single writer, holding what happened
while nobody was sitting down. Its `source` is a closed set with two members — `declared` and
`replay` — and neither is a sensor.**

```prisma
model ExternalEvent {
  id          String   @id @default(cuid())
  /// Ledger-assigned and gapless, like ObservationEvent.seq but global: there is
  /// no session to be gapless within.
  seq         Int      @unique
  /// ExternalEventSource. Closed, code-owned, no `other`.
  source      String
  occurredAt  DateTime
  /// Source-supplied, never Date.now(): a week-long fixture replays in a second.
  elapsedMs   Int
  /// ExternalEventKind. Closed, code-owned, no `other`.
  kind        String
  /// Which Intention this bears on, or null. Written by the person or the
  /// fixture that stated the event. No detector and no model boundary may set it.
  intentionId String?
  /// Only what Propositum itself recorded: which member stated the row, and when
  /// it was written. NOT the browser-attested sense the observation ledger uses —
  /// nothing attests either source here. There is deliberately no `untrusted`
  /// column; see property 6.
  attested    Json

  intention Intention? @relation(fields: [intentionId], references: [id], onDelete: Restrict)

  @@map("external_event")
}
```

**Seven properties, each of which was a way to get this wrong.**

1. **Two tables, not a nullable `sessionId`.** `ARCHITECTURE.md` offers both as the prerequisite —
   *"either a second ledger writer or a nullable `sessionId`"* — and they are not equivalent. A
   nullable column puts session-bound and session-free rows in one table, which means every existing
   reader of `ObservationEvent` silently acquires rows it was written before there were any, and the
   guarantee that made the old shape strong becomes a `WHERE` clause. Two tables keep both writers
   sole writers of their own table, and a reader that wants the new rows has to say so.
2. **Never minted by a model.** The rule is `ObservationEvent`'s, carried over unchanged and for the
   same reason: *"if a model emitted events, the inference would cite the event and the event would
   be the inference — circular provenance."* A `declared` row is a person's assertion; a `replay`
   row is a fixture's. There is no third way in.
3. **It cannot write an `Intention`.** The foreign key points *at* one; nothing here creates or
   edits the row it points at. [ADR-0011](0011-intention-above-worksession.md) and
   [Principle 12](../PRODUCT_PRINCIPLES.md) are untouched, and `intentionId` is set by the same hand
   that stated the event.
4. **`elapsedMs` is source-supplied.** The property `ObservationEvent` already has, and the reason
   is the same one written in `CONTEXT.md`: *"a 40-minute fixture replays in 400 ms with no
   behaviour change — never call `Date.now()` internally."* A week of external events has to replay
   in a second or the harness in [ADR-0037](0037-was-the-offer-any-good.md) is unusable.
5. **Append-only, by the same three triggers.** Registered in `REQUIRED_GUARDS`
   (`src/persistence/append-only.ts`) and in `GUARDED_TABLES` (`src/persistence/errors.ts`) — the
   second of which already names fewer tables than the first, so a trigger firing on this one would
   otherwise surface as Prisma's P2003 *"Foreign key constraint violated"* lie. That is repaired in
   the same change, because this is the table that would have been the next to hit it.

6. **No `untrusted` column, and that is absence rather than a rule.** The first draft of this block
   copied `ObservationEvent`'s `attested`/`untrusted` pair. It should not have. `UntrustedContent`
   means *anything a page could have authored*, carried structurally so that *"nothing here may
   influence a policy decision, be treated as an instruction, or enter a prompt without
   datamarking"* — and the door that datamarks is `createLedgerWriter`, which is why
   `tests/reachability.test.ts` pins it at one caller: *"a second caller would be a second path by
   which raw text could reach SQLite."* A second writer carrying the same column would be exactly
   that second path. Neither permitted source can legitimately fill it — a person typed the words, a
   fixture supplied them — so the column does not exist. That matters because
   [ADR-0037](0037-was-the-offer-any-good.md) routes these rows into a prompt: with no `untrusted`
   column there is nothing on this table for the datamark rule to be silent about. **A source that
   genuinely carries page-authored text is a third `ExternalEventStatedBy` member, and it arrives
   with the door rather than before it.**
7. **`onDelete: Restrict`, and the first draft had this wrong too.** It proposed Prisma's default for
   an optional relation, `SetNull` — which on this table is an **UPDATE against an append-only row**.
   The no-`UPDATE` trigger aborts it, and SQLite's `SQLITE_CONSTRAINT_TRIGGER` returns through Prisma
   as the same P2003 *"Foreign key constraint violated"* lie property 5 exists to repair.
   `HandoffContract` decided this identical question already and carries the whole argument on the
   column; `Restrict` refuses the delete outright and its P2003 is then **true**. The honest limit is
   that entry's, inherited in a harder form because every row here is frozen rather than only the
   accepted ones: **an Intention that any `ExternalEvent` points at cannot be deleted at all**, and
   the eventual delete path is written against that rather than against a capability the storage
   layer does not have.

**`ExternalEventKind` is closed and has one member, `arrived`** — the thing a person said they were
waiting on has happened. One member is not a placeholder for a richer set; it is the honest size of
what two non-sensor sources can state. A second member is a schema change with an argument attached,
exactly as `THREAD_PROVIDERS` holds one provider and says so.

**A deadline passing is deliberately not a member.** It needs no row: it is a stated date and a
clock, derivable at read time. Writing it would be Propositum recording its own arithmetic as an
observation, which is precisely the direction [ADR-0033](0033-a-late-tick-is-a-slept-machine.md)
warned about below.

## The half-made argument, named rather than inherited

[ADR-0033](0033-a-late-tick-is-a-slept-machine.md) ends by predicting this document:

> *"It is the first thing in the ledger that comes from Propositum watching itself rather than
> watching a browser, and **the next proposal in that direction will find the argument half made.**"*

The half it left is *the ledger may contain something that was not observed through the browser*.
This ADR uses that and must not pretend it invented it. Two things are said in return.

**It does not extend the precedent.** ADR-0033's row is Propositum's inference about its own
liveness. Every row here is an assertion by a person or a fixture. Neither is a sensor, and the
category that would be — a process that watches something and writes rows on its own schedule — is
what the two-member `source` set exists to keep out.

**The trap is live and the trap is named.** [ADR-0012](0012-screen-capture-refused.md)'s
*Revisit when* says *"a desktop process is built for some other reason. Once a native helper exists,
the marginal cost of a capture loop looks small."* `src-tauri/` now exists. A table with a `source`
column and room for a third member is the same shape of temptation one layer down: **once a ledger
exists, the marginal cost of a sensor looks small.** It is not small. It is the whole of the next
decision, and this one buys none of it.

## Rejected alternatives

**A nullable `sessionId` on `ObservationEvent`.** The smaller diff, and the one `ARCHITECTURE.md`
lists first. Refused on property 1 above, and on a second thing that is easy to miss: the ledger's
`seq` is gapless *per session*, and a row with no session has nothing to be gapless within. The
column would need a second meaning, or a sentinel, and both are how a guarantee becomes a
convention.

**Taking a real sensor with it — Gmail, GitHub, a calendar, a file watcher.** Each would make the
demo better immediately and each is refused, on the same three grounds and one extra.
[ADR-0029](0029-the-mailbox-and-a-calendar-of-our-own.md) drew this exact line eleven days ago and
its wording is the one to keep: *"ingestion is a standing sensor; this is a verb."* Its mail scopes
are verbs inside a ratified sitting and persist nothing. A sensor is the other thing, it is on §8's
do-not-build list — and here an earlier draft of this ADR contradicted itself, so the correction is
made in the open rather than left to a reader. **`MVP.md` has one row**, titled *"Automatic Gmail /
Slack / Calendar / GitHub / Notion ingestion, and `ExternalEvent` with it"*, and its entire body is
the structural argument. The reason therefore cannot be downgraded for half of it: after this ADR
**the ingestion refusal is held by scope alone**, which is a smaller refusal than it was this
morning. Claiming otherwise in the same document that satisfies the row's own stated prerequisite
would be selling. The row itself stands and is re-marked in place rather than removed, on
[ADR-0025](0025-computer-use-beyond-the-browser.md)'s precedent — *"struck rather than deleted so
that the next removal has to argue against something."* The extra ground is evidence: the hypotheses were scored on 2026-08-27 and H1 passed one
scenario of four with the raw-log baseline at least as good on all four, and
[`docs/todo/README.md`](../todo/) says what follows — *"what 06, 07 and 08 would buy with their
guarantees has a number, and the number is not yet worth the price."* A sensor is in that class.

**Persisting the ambient buffer instead.** The nearest thing to free: `src/server/ambient-store.ts`
already holds observations while no session runs, and making them durable would produce
between-sittings rows with no new source at all. Refused because that file carries a written refusal
this ADR is not entitled to spend: *"a durable row saying 'Propositum thought you were job-hunting'
about an offer **NOBODY ACCEPTED** is exactly the profile this buffer refuses to become."*
[ADR-0020](0020-remembering-a-decline.md) spent part of it already, for a salted hash with no
subject column, and paid for it in the open. A full ambient ledger is a subject on every row, which
is a much larger transaction and a different ADR.

**One generic `Event` table, with `sessionId` nullable and a `source` discriminator covering both.**
The design the direction document sketches, and the one a reader arriving from it will expect. It
unifies two ledgers whose whole value is that they are disjoint — `ActionEvidence` and
`ObservationEvent` are already kept apart on the same argument
([ADR-0010](0010-acting-in-the-browser.md)) — and it would put the observation ledger's append-only
guarantees and the new table's much weaker provenance behind one name.

**Waiting until a real sensor needs it.** The conservative option, and the status quo. Refused
because it is the order `MVP.md` explicitly warns against: the ledger is the argument nobody wants
to be having at the same time as the permission argument. Building it now, with sources that cost
nothing, is what lets the sensor ADR be about the sensor.

## What this costs

- **The strongest structural statement in the corpus is now narrower.** Said at the top, repeated
  here because it is the cost: *"no event outside a sitting can be persisted at all"* was
  checkable in one grep and is now three words longer and true of one table rather than of the
  database.
- **A second append-only table is a second thing that must stay append-only.** `prisma db push`
  silently drops triggers on any table it rebuilds; the reinstall-and-verify at startup is what
  catches it, and this table joins the list that depends on that working.
- **`declared` is close to circular, and the demo is thinner than it looks.** A person types what
  they are waiting on and later says it arrived. Nothing outside the person feeds the ledger, so on
  the `declared` source alone this is a to-do list with provenance. What is not circular is
  `replay`, which drives the same code path from a stream nobody typed — that is what proves the
  mechanism will hold for a sensor, and it is the only honest claim available until one exists.
- **It is durable, it holds a subject, and nothing deletes it.**
  `docs/SECURITY_AND_PRIVACY.md` promises that *"deleting a `Project` deletes its sessions, events,
  documents, and ledger"*, and an `ExternalEvent` belongs to no Project — its only relation is to an
  `Intention`, whose own `projectId` is nullable. That sentence becomes false for a class of row.
  This is `offer_tally`'s situation, and `offer_tally` survives it on an argument **this table cannot
  borrow**: *"four numbers and a date, no subject, nothing that says what any suggestion was about."*
  An `ExternalEvent` has a subject — it says a person was waiting on something and that it arrived,
  against a named Intention. **The retention answer is owed with the build**, it is named in
  `docs/todo/12-between-sittings.md`, and this ADR does not pretend the question is closed.
- **Room invites occupancy.** Stated as a cost rather than managed away: the next person to want a
  sensor will find the expensive half built and the argument for the cheap half already written.

## What would hold the line

**Present tense would be a lie here, and a guard table is the easiest place in this series to commit
one.** Nothing below exists yet: this is a decided-and-unbuilt ADR,
`tests/external-ledger.test.ts` has not been written, and the `tests/append-only.test.ts` row has to
be added by hand — that suite's coverage check is a **literal list of tables rather than a read of
the schema**, so a new guarded table missing from it is not caught by the test whose name says it
would be. These are the guards the build owes, in the shape `CONTEXT.md`'s fence uses for the
vocabulary.

| | |
|---|---|
| `tests/append-only.test.ts` | `external_event` takes no `UPDATE` and no `DELETE`, and `INSERT OR REPLACE` does not walk through |
| `tests/reachability.test.ts` | `createExternalWriter` is the **only** caller of `externalEvent.create`, and `createLedgerWriter` is still the only caller of `observationEvent.create`. Two writers, two tables, neither reaching the other's |
| `tests/external-ledger.test.ts` | `ExternalEventSource` has exactly two members and neither is a sensor; `ExternalEventKind` has exactly one. A third source is a diff to this test |
| `tests/architecture.test.ts` | Nothing under `src/domain/` reads a clock, so a replayed week and a lived one are the same input |
| `prisma/schema.prisma` | `ObservationEvent.sessionId` is unchanged and still required. The old guarantee is intact where it always was |

**Where this could still go wrong.** Nothing tests that a person's `declared` assertion is true, and
nothing can — it is an assertion. The row records that somebody said so and when, which is what a
ledger is for and is not the same as the thing having happened.

## Revisit when

- **Anybody proposes a third `ExternalEventSource`.** That is the sensor decision and it needs its
  own ADR, its own permission argument and its own price. The two-member set is the guard, and it is
  the only one.
- **`ExternalEventKind` gains a member.** Same shape, smaller stakes; still a schema change.
- **Somebody proposes writing a deadline as a row.** It is arithmetic, and recording arithmetic as
  observation is the direction ADR-0033 named.
- **The `replay` source turns out to be the only one anybody uses.** Then the `declared` half is not
  earning its place, and the honest response is to say so rather than to add a sensor to rescue it.
- **[ADR-0037](0037-was-the-offer-any-good.md)'s longitudinal arm does not beat reading alone.** The
  table is then room built for a thesis the evidence did not support, and the response is to stop
  rather than to feed it harder.
