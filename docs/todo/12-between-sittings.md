# 12 — Somewhere to put an event outside a sitting, and an ordering that can see it

**Status:** ~~not started — decided, not built~~ **step 1 built 2026-09-07; steps 2–9 open.** The
ledger, its guards and its writer exist and nothing calls the writer — `tests/reachability.test.ts`
pins that in its *deferred, and asserted as deferred* block, which is where the next person should
look first.
**Decided by:** [ADR-0034](../adr/0034-somewhere-to-put-an-event-outside-a-sitting.md),
[ADR-0035](../adr/0035-what-a-person-said-they-are-waiting-on.md),
[ADR-0036](../adr/0036-ordering-candidates-without-a-score.md) and
[ADR-0037](../adr/0037-was-the-offer-any-good.md), all accepted 2026-09-07
**Blocked by:** [`00`](./00-score-the-hypotheses.md), and this one is not a formality — see below
**Blocks:** nothing. It is the first work in this folder that unblocks a **roadmap stage** rather
than a feature: `ROADMAP.md` Stage 2's *what would have to exist first* is item 1 of *The work*, and
nothing else

## Is this already done?

```bash
# 1. the second ledger
grep -n 'model ExternalEvent' prisma/schema.prisma
# 2. its writer, which must be the only one
grep -rn 'externalEvent.create' src/
# 3. the field a person writes, and the sixth lifecycle word
grep -rn 'statedWait' src/ ; grep -n "'waiting'" src/domain/intention/state.ts
# 4. the ordering across kinds
ls src/domain/detection/order-candidates.ts 2>/dev/null
# 5. replay
grep -n '"replay"' package.json
```

~~**As of 2026-09-07 every one of these returns nothing.**~~ **Re-marked the same day, by the change
that built step 1: greps 1 and 2 now return.** `model ExternalEvent` is in the schema and
`externalEvent.create` has exactly one caller, `createExternalWriter`. Greps 3, 4 and 5 still return
nothing — there is no `statedWait`, no sixth lifecycle member, no cross-kind ordering and no replay
command. **Nothing calls `createExternalWriter`**, which is the honest summary of what step 1 bought:
a place to put something, and nothing putting anything in it.

## Blocked by

**[`00`](./00-score-the-hypotheses.md), and the reason is the substance of the work rather than
process.** `npm run eval -- --report` exits 1 today because `evening-classes` is sealed and
unscored, so the harness this work is measured by is red before it starts. More than that:
[ADR-0037](../adr/0037-was-the-offer-any-good.md) exists to explain a specific number —
`baselineAtLeastAsGood` true on four scenarios of four — and its new comparison is only readable
beside a scored corpus. **Building the ledger against a red harness produces a slice nobody can
grade.**

Nothing else. The ledger writer, the append-only guards, the ordering and the replay path all extend
things that are built and tested.

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| 1 | **Score `evening-classes`** — `npm run eval -- --worksheet`, then a paid run, then hand-score it. About $1.40 on its own, and the person who wrote the reference is the one who scores it | an hour, plus the run |
| 2 | **Decide whether an inbound phone reply may discharge a wait — and treat it as a permission question, not a lookup.** It is a fourth member of [ADR-0021](../adr/0021-a-thread-on-the-persons-phone.md) §5's closed parse union and a sixth of §6's message set, and it would let a message arriving from a transport change what an Intention displays. ADR-0021 pins that set in `tests/conversation.test.ts` so adding to it goes red and forces the argument. **It needs its own ADR**, and [ADR-0035](../adr/0035-what-a-person-said-they-are-waiting-on.md)'s last *Revisit when* already says the discharge path is written for it and the permission argument is not | an afternoon, and an ADR |
| 3 | **Score `longitudinalAtLeastAsGood`** once the slice runs — the second hand-scored judgment ADR-0037 opens by calling its own cost | an hour |

## The work

In this order. Steps 1 and 2 leave the product working and change no behaviour, which is what makes
them safe to land alone.

1. ~~**The ledger, read by nothing.**~~ **Done 2026-09-07.** `model ExternalEvent` with `seq`
   global and gapless, `onDelete: Restrict` rather than Prisma's `SetNull` default (which on an
   append-only row is an UPDATE the guard aborts), and **no `untrusted` column** — the datamark door
   stays singular. Three triggers in `prisma/triggers.sql` and `REQUIRED_GUARDS`;
   `createExternalWriter` in `src/persistence/external-writer.ts`, pinned at zero callers in the
   deferred block. `GUARDED_TABLES` was repaired in the same change — it named seven tables while
   fourteen were guarded, so on half of them a guard firing surfaced as Prisma's P2003 lie
   untranslated, and `tests/append-only.test.ts` now holds the two lists to each other rather than to
   a hand-written third. `tests/external-ledger.test.ts` is the rest. Original text: `model ExternalEvent` per
   [ADR-0034](../adr/0034-somewhere-to-put-an-event-outside-a-sitting.md), its three append-only
   triggers registered in `REQUIRED_GUARDS` **and** in `GUARDED_TABLES` — the second list already
   names fewer tables than the first, and this is the table that would have hit that bug next — plus
   `createExternalWriter` as its only writer. Add the writer to `tests/reachability.test.ts`'s
   *deferred, and asserted as deferred* block, which is **empty right now and kept that way
   deliberately, "so the next deferred capability has somewhere to land."** This is that capability.
2. ~~**`ExternalEventSource` and `ExternalEventKind` as closed sets**~~ **Done 2026-09-07, and the
   type is `ExternalEventStatedBy`** — the field is `statedBy`, not `source`, because `event.source`
   already means an `ApprovedSourceId` and `CaptureAdapter` was renamed off `ObservationSource` to
   stop exactly that. Two members and one member, asserted by length in
   `tests/external-ledger.test.ts` so a third goes red. A third source is the sensor decision and is
   still not this file.
3. **`Intention.statedWait`**, written on the working-agreement screen and by nothing else. Move the
   writer assertion out of the deferred block in the same commit — that is the reachability rule,
   and it is the step where it bites.
4. **The sixth lifecycle word.** `waiting` in `IntentionState`, reachable only from a set
   `statedWait` with no discharging `ExternalEvent`. Precedence after `done` and `needs-you`, before
   `sleeping`. **`CONTEXT.md`'s *Displaces:* line for `IntentionState` retires `waiting (as a
   member)` and the strike is lifted here** — that is a vocabulary reversal, and
   [ADR-0035](../adr/0035-what-a-person-said-they-are-waiting-on.md) is the argument for it.
   **And do not correct "five members" to "six" in the nine places that state it.** It is a
   hand-maintained count in `ARCHITECTURE.md` (four times), `ROADMAP.md`, `MVP.md`, `VISION.md`,
   `CONTEXT.md` and `state.ts`, and nothing checks any of them —`tests/counts.test.ts` has rules for
   terms, decisions, principles and layers and none for members. `AGENTS.md` says what to do with a
   number like that: *"better, delete the number and point at the thing that knows it."* Point at
   `INTENTION_STATES`, which `tests/intention.test.ts` already pins. The count has survived only
   because it has not moved yet, and this step is what moves it.
5. **The ordering across kinds**, per [ADR-0036](../adr/0036-ordering-candidates-without-a-score.md).
   Pure, total, clockless, lexicographic over named facts. `intent-lab.ts` at the repo root is the
   bench for this — it drives the real detection pipeline with no database and no model call.
6. **The front door renders the order and the reason.** One sentence per candidate naming the key
   that put it there. [ADR-0019](../adr/0019-disclosure-and-what-may-never-fold.md)'s *what may never
   fold* list governs what can go behind a `Disclosure` here.
7. **The retention answer, which [ADR-0034](../adr/0034-somewhere-to-put-an-event-outside-a-sitting.md)
   leaves open on purpose.** `docs/SECURITY_AND_PRIVACY.md` promises that deleting a `Project`
   deletes its events, and an `ExternalEvent` hangs off an `Intention` whose `projectId` is nullable,
   so that promise is false for a class of row until something answers it. `offer_tally`'s escape —
   *"four numbers and a date, no subject"* — is not available: this table names what somebody was
   waiting on. Decide the delete path and add the row to that document's retention table in the same
   commit.
8. **`npm run replay`**, through the real endpoints the way `scripts/seed-offer.ts` already does, and
   the fixtures with their must-not lists, sealed into their own lock.
9. **The docs, in this commit and not after it.** `ARCHITECTURE.md` layers 2, 3 and 4 — and **only
   when the code moves**, which for layer 4 is step 5 and not step 1. `ROADMAP.md` Stage 2's
   *what would have to exist first*. `MVP.md`'s out-of-scope row for `ExternalEvent`, which moves
   from *blocked by structure* to *blocked by scope* and is **not deleted**. `VISION.md`'s
   *"none of that can reach this system"*. The `waiting` sentences in `CONTEXT.md` and in
   `ARCHITECTURE.md`'s *The lifecycle word*.

## Done when

- `grep -n 'model ExternalEvent' prisma/schema.prisma` returns a model, and
  `grep -rn 'externalEvent.create' src/` returns exactly one production caller.
- `ObservationEvent.sessionId` is **still required** — the old guarantee intact where it always was.
- An Intention with an undischarged `statedWait` reads *Waiting* on the front door, and the same
  Intention reads *Sleeping* the moment an `ExternalEvent` discharges it.
- `npm run replay -- <fixture>` twice produces the same candidates in the same order.
- A fixture's must-not list is non-empty and is not surfaced.
- `tests/grounds.test.ts`'s standing afternoon of ordinary reading **still does not qualify**. If
  that fixture starts passing, this work broke [Principle 13](../PRODUCT_PRINCIPLES.md) whatever else
  it improved.
- `npm test`, `npm run typecheck` and `npm run build` are green, and
  `npm run eval -- --report` exits 0.

## What this does not cover

- **No sensor.** Nothing watches anything. The two sources are a person and a fixture, and a third is
  [ADR-0034](../adr/0034-somewhere-to-put-an-event-outside-a-sitting.md)'s own *Revisit when*.
  Automatic Gmail/Slack/Calendar/GitHub/Notion ingestion stays on the do-not-build list; what changes
  in `MVP.md` is only the *reason* beside that row.
- **No scheduler and no notification.** A `waiting` Intention is a word and a candidate. Nothing
  wakes up, nothing polls, and nothing tells anybody about it.
- **Nothing infers a wait.** Not from page text, not from a `SessionClaim`, not from a mail body.
- **No learning.** Nothing reads acceptance history. [ADR-0020](../adr/0020-remembering-a-decline.md)'s
  narrowing-only reticence is the whole of what learns, and this does not extend it.
- **Still one Intention per Project, still no graph, still one wait per Intention.**
- **It does not make H2 measurable.** That needs a person recording verdicts on real work —
  [`03`](./03-document-loop.md) item 5 — and this changes nothing about it.

## What would make this deletable rather than done

If [ADR-0037](../adr/0037-was-the-offer-any-good.md)'s comparison comes back saying a reading that
can see between sittings is **not** better than one that cannot, then the ledger is room built for a
thesis the evidence did not support. The honest response is to record that and stop, not to add a
sensor to rescue it — and `MVP.md`'s failure table already says so about H2 in almost the same words.
