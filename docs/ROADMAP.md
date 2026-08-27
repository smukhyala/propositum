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

~~**Now, except the screen that shows the `Intention`.**~~ **Now, except resumption — re-marked
2026-08-20 ([ADR-0017](./adr/0017-continuing-an-intention.md)).** An explicit `Intention` — decided
in [ADR-0011](./adr/0011-intention-above-worksession.md) and ~~**not yet a table**~~ **a table as of
2026-08-16** — a `WorkSession`, a ratified `HandoffContract`, one bounded worker, one reviewer, and
re-entry. Everything in that list except the `Intention` was built before this change; the
`Intention` is the one thing this stage is still adding, and it is now a row that is written and
attached but ~~**rendered nowhere**~~ **rendered on the front door as of 2026-08-16** —
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §1 carries the one-command check, and says in the same breath
which half is still owed.

**The half still owed is the one this stage is named after, and it took until 2026-08-20 to say so
plainly.** *Guided Intention Continuation* is what this stage is called, and until slice 1 nothing
continued: the row survived and **nothing resumed it**, which the last paragraph of
[`MVP.md`](./MVP.md)'s user journey states in its own voice — ~~*"Saying the row survives is a claim
about storage, not about continuity."*~~ **Re-marked 2026-08-20, later the same day: that quotation
was not a quotation.** MVP.md now reads *"Saying the row survives **was** a claim about storage.
This is a claim about what is on screen, and it is still not a claim about continuity"* — amended by
ADR-0017 on the same day, and the wording above was deleted from MVP.md by the very commit that
added this paragraph quoting it. So this file paraphrased the MVP while asserting *in its own
voice*, which is the one thing the structural note below forbids by name; a reader following the
link to check the quotation would not have found it. The half that survives the correction is the
continuity half, which MVP.md still says. Two documents therefore read as though the stage were one
screen from complete while the word in its title was unimplemented. `WorkSoFar`
([ADR-0017](./adr/0017-continuing-an-intention.md)) is what closes that, and it closes it to a
strictly smaller extent than the stage name suggests: a person still starts every sitting, and what
Propositum *thinks* they are doing is still rebuilt from nothing each time.

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

*What "more than one sensor" does not mean (added 2026-08-17,
[ADR-0012](./adr/0012-screen-capture-refused.md)).* A second sensor here is a **structured source
that states something** — a calendar entry, an issue, a message header — not a wider view of the
person's machine. A rolling screenshot cache was proposed on 2026-08-17 and refused;
[`VISION.md`](./VISION.md)'s *"Not planned, at any horizon"* holds unchanged across every stage in
this file, and this stage does not reach it by increments. The direction is **more of what the
person has already stated**, not more of what can be watched.

---

## Stage 3 — Adaptive Delegation

**Later. Direction, not commitment.** Standing agreements that outlive a single handoff, richer
permissions, trust that can *recommend* autonomy, executor selection, and better stopping.

*What would have to exist first:* a policy object with a lifetime longer than one `HandoffContract`.
`WorkingAgreement` is a **reserved name with no object behind it** and stays that way until this
stage. The constraint that survives from here into that one: **learned trust never overrides
permissions.** History can recommend a setting; it can never silently create one.

*"Richer permissions" is about what Propositum may **do**, not about what it may **watch** (added
2026-08-17).* Widening delegation is this stage's subject. Widening observation is a separate
decision taken separately, and ~~the only one taken so far is a refusal —
[ADR-0012](./adr/0012-screen-capture-refused.md)~~ **there are now three, and two of them widen —
corrected 2026-08-26.** [ADR-0025](./adr/0025-computer-use-beyond-the-browser.md) takes Screen
Recording and reads the accessibility tree of every application on a ratified allowlist;
[ADR-0026](./adr/0026-reading-a-one-time-code.md) takes Full Disk Access for one reader over
`chat.db`. Neither is built as this is corrected. **The sentence below survives unchanged and is now
doing all the work**, which is why it is worth reading twice: history may recommend a setting, and it
may never grant a view — none of the three came from history, and each is ratified per contract or
granted once by a person in System Settings. The sentence above applies to sensors with no softening.

---

## Stage 4 — Multi-Intention Everyday AI

**Later, and furthest out. Direction, not commitment.** Several persistent intentions at once,
background scheduling of where the next hour is best spent, state that crosses tools and devices, and
progress that is proactive but permissioned.

*"State that crosses tools and devices" is about carrying an `Intention`, not about watching a second
machine (added 2026-08-17).* An Intention that survives being picked up on another device is a
persistence question. **Observing** that other device is a different one, already ruled on in two
places: its screen by [ADR-0012](./adr/0012-screen-capture-refused.md), and its tab list by the
`tabs` refusal [ADR-0002](./adr/0002-observation-capture.md) made and
[ADR-0008](./adr/0008-ambient-detection.md) left standing. Nothing in this stage is a route around
either.

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
in whole or in part**, and ~~the one addition stage 1 makes is not implemented either~~ *(struck
2026-08-20: the `Intention` table landed on 2026-08-16 and this sentence did not follow it — the
exact drift the file's own pointer-not-paraphrase rule exists to prevent, committed in the one
paragraph that had no pointer)*. Everything in
stages 2 to 4 is on direction §8's *do not build yet* list or depends on
something that is, and [`MVP.md`](./MVP.md)'s Out of scope table is where those exclusions are recorded
with their reasons rather than left to be re-litigated.

**A second direction document arrived on 2026-08-20** and is archived at
[`docs/superpowers/specs/2026-08-20-everyday-intelligence-direction-source.md`](./superpowers/specs/2026-08-20-everyday-intelligence-direction-source.md).
[ADR-0016](./adr/0016-everyday-computing-direction.md) records what it changes — the first workflows
stop being research-and-draft alone — and, at greater length, the four things it asks for that this
repository is **not** doing: leaving Chrome, taking two free Chrome permissions before H1 has a
number, learning an intervention threshold, and letting inference write an Intention. **§8 of the
2026-08-16 document is unchanged and still binding**, and none of the stages above moves.

The gap between stage 1 and stage 4 is large and this file does not compress it. Propositum today is
one sensor, one worker, one reviewer, and — once this slice lands — one flat table and a lifecycle
word computed from rows that already existed.
