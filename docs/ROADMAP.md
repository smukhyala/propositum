# Roadmap

Four stages, in the order they unlock each other. **No dates and no estimates appear in this file**,
by the same rule that fixed the MVP thresholds before any result existed: a date is a number nobody
measured, and once written it starts arguing with the work.

Layer-by-layer build status is [`ARCHITECTURE.md`](./ARCHITECTURE.md). Vocabulary is
[`CONTEXT.md`](../CONTEXT.md). Section references of the form **§8** point at the direction document
these stages come from, archived at
[`docs/superpowers/specs/2026-08-16-direction-update-source.md`](./superpowers/specs/2026-08-16-direction-update-source.md);
§8 is its *do not build yet* list.

---

## Stage 1 — Guided Intention Continuation

**Now, except the screen that shows the `Intention`.** An explicit `Intention` — decided in
[ADR-0011](./adr/0011-intention-above-worksession.md) and ~~**not yet a table**~~ **a table as of
2026-08-16** — a `WorkSession`, a ratified `HandoffContract`, one bounded worker, one reviewer, and
re-entry. Everything in that list except the `Intention` was built before this change; the
`Intention` is the one thing this stage is still adding, and it is now a row that is written and
attached but **rendered nowhere** — [`ARCHITECTURE.md`](./ARCHITECTURE.md) §1 carries the
one-command check, and says in the same breath which half is still owed.

**This stage is [`MVP.md`](./MVP.md), and is deliberately not restated here.** Scope, the three
hypotheses, the pass/fail numbers, the acceptance criteria and the assumptions live there and are
edited there. A summary in this file would be a second copy of a document that already exists, and the
two would drift silently — both would look authoritative and a reader would have no way to tell which
was stale. **This is the only structural decision in this file that matters:** the roadmap points at
the MVP, and never paraphrases it.

What is true today, and MVP.md is the authority on it: the slice runs end to end, and **no hypothesis
has a number yet.**

---

## Stage 2 — Event-Driven Understanding

**Later. Direction, not commitment.** Intention state updates from more than one sensor — external
events as well as watched work — with real state reconciliation behind it and opportunity detection
that has more than one candidate to weigh.

*What would have to exist first:* somewhere to put an event that did not happen inside a sitting.
`ObservationEvent.sessionId` is required with a single ledger writer, so today there is no such place
at all — see [`ARCHITECTURE.md`](./ARCHITECTURE.md), State Ingestion. This is also the stage that
makes `waiting` a reachable `IntentionState`; until then the union has five members and not six.

Direction §8 puts automatic Gmail/Slack/Calendar/GitHub ingestion on the do-not-build list, and this
stage does not start by ignoring that.

---

## Stage 3 — Adaptive Delegation

**Later. Direction, not commitment.** Standing agreements that outlive a single handoff, richer
permissions, trust that can *recommend* autonomy, executor selection, and better stopping.

*What would have to exist first:* a policy object with a lifetime longer than one `HandoffContract`.
`WorkingAgreement` is a **reserved name with no object behind it** and stays that way until this
stage. The constraint that survives from here into that one: **learned trust never overrides
permissions.** History can recommend a setting; it can never silently create one.

---

## Stage 4 — Multi-Intention Everyday AI

**Later, and furthest out. Direction, not commitment.** Several persistent intentions at once,
background scheduling of where the next hour is best spent, state that crosses tools and devices, and
progress that is proactive but permissioned.

*What would have to exist first:* more than one Intention per `Project` — today the limit is one — and
concurrency the schema does not have. One live session at a time is enforced in the app layer rather
than in the database, so a surface listing several `working` intentions would look correct and be
unable to start the second one.

Orchestration deserves particular scepticism at this stage, for the reason
[`VISION.md`](./VISION.md) already gives: a generic agent framework built before one workflow works is
the failure mode the founding brief names most sharply.

---

## What this file is not

It is not a commitment, and stages 2 to 4 are not scheduled. **None of stages 2 to 4 is implemented,
in whole or in part, and the one addition stage 1 makes is not implemented either.** Everything in
stages 2 to 4 is on direction §8's *do not build yet* list or depends on
something that is, and [`MVP.md`](./MVP.md)'s Out of scope table is where those exclusions are recorded
with their reasons rather than left to be re-litigated.

The gap between stage 1 and stage 4 is large and this file does not compress it. Propositum today is
one sensor, one worker, one reviewer, and — once this slice lands — one flat table and a lifecycle
word computed from rows that already existed.
