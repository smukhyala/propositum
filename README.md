# Propositum

**Understands where you were going, and keeps going while you're away.**

*Propositum* is Latin for intention. Knowledge work rarely ends at a stopping point — it ends at an
interruption, with a half-drafted section and six tabs whose relevance only you understand. The
expensive part of coming back isn't resuming the typing. It's rebuilding the intention.

Propositum watches an approved work session, builds a structured reading of what you were going
for, and — once you've ratified an explicit agreement — continues in a constrained environment
while you're gone. You come back to what changed, why, and what it couldn't decide for you.

> **Status: pre-alpha. The slice runs end to end; no hypothesis has a number yet.** Capture,
> reading, handoff, the gated worker, the changeset, the shift report, review and the fold into a
> new document version are all built and wired. What is missing is evidence: `eval-scores.json` is
> still the blank worksheet, and H1, H2 and H3 are unscored. This README says plainly where the
> gaps are rather than rounding them up.

---

## What exists today

| | |
|---|---|
| [`CONTEXT.md`](./CONTEXT.md) | The ubiquitous language, and the only glossary — there is no `UBIQUITOUS_LANGUAGE.md`. ~~38 terms, 28 banned.~~ ~~Corrected 2026-08-16: 54 terms.~~ ~~56 terms, and 21 rows in the banned table, one of them struck — corrected 2026-08-19.~~ **57 terms, and 21 rows in the banned table, one of them struck — `WorkSoFar` added 2026-08-20 ([ADR-0017](./docs/adr/0017-continuing-an-intention.md)).** ~~CONTEXT.md's own closing line carries the term count and is the authority on it~~ — **it does not and never did, so the authority this cell named did not exist.** The count now lives here and `tests/counts.test.ts` checks it against the glossary, which is the only version of this cell that has ever been able to stay true. Every schema, prompt, table and UI string uses these words. |
| [`docs/MVP.md`](./docs/MVP.md) | What slice 0 is, the three hypotheses, and the pass/fail numbers — fixed before any result existed. |
| [`docs/VISION.md`](./docs/VISION.md) | Where this goes, with **now** and **later** kept strictly apart. |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Ten layers, each marked with what is built and what would have to exist first. Five layers are partial or absent — ~~six~~, corrected 2026-08-19 and now counted by a test. |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Four stages. Stage 1 points at MVP.md rather than restating it; stages 2–4 are direction, not commitment, and none is implemented. ~~Stage 1's one addition — the `Intention` table — is not implemented either as of 2026-08-16.~~ **Amended 2026-08-16, later the same day: the table, the two nullable foreign keys and the lifecycle word landed.** This cell was written in the doc wave and outlived it by hours — the fifth stale count in this table, and the one with the shortest half-life. |
| [`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) | ~~Ten principles~~ **15 principles, corrected 2026-08-16**, each stating what it concretely forbids. PRODUCT_PRINCIPLES.md's own header carries the count and is the authority on it — and says the header had been wrong since principle 11 arrived. Fourth stale count in this table, in the document that tells the others to say the true thing. |
| [`docs/research/`](./docs/research/) | The long answers to the questions the architecture waited on. ~~\~4,900 lines~~ **The number is deleted rather than corrected, 2026-08-20.** It was right on the day it was written, 2026-08-06, and was a little over half the truth by 2026-08-18 — `intent-signals.md` arrived and `intent-suggestion-quality.md` grew, and neither moved this cell. `tests/counts.test.ts` has no rule for the noun *lines*, so this is the one count in this table nothing checks, and the row two below says the ADR count went stale *"because nothing counted them. Something counts them now"* — true of that row and never true of this one. `wc -l docs/research/*.md` is the only version of this figure that stays true. |
| [`docs/FOUNDING_BRIEF.md`](./docs/FOUNDING_BRIEF.md) | The originating brief, kept as history. |
| [`docs/adr/`](./docs/adr/) | ~~Seven decisions~~ ~~eleven, corrected 2026-08-16~~ ~~15 decisions, corrected 2026-08-19~~ **18 decisions — three landed 2026-08-20 with the everyday-computing direction ([ADR-0018](./docs/adr/0018-the-everyday-shapes.md) is the newest)**, each with the option it rejected and why. The number went stale four ADRs ago, was corrected, and went stale again by four within three days — because nothing counted them. Something counts them now. |
| Runtime | Next 16, TypeScript strict, Prisma + SQLite, Zod 4, Vitest. ~~336 tests.~~ ~~1,028 across 40 files, measured 2026-08-16.~~ ~~1,124 across 44 files, measured 2026-08-16 after the Intention slice.~~ **The number is gone, 2026-08-19.** It was stale by a factor of three, then stale within the day, then stale again — three corrections making the same argument, which this cell has finally taken: `npm test` prints it, nothing here can check it, so nothing here says it. `tests/counts.test.ts` fails if it comes back. |
| The product | Chrome MV3 capture, the reading with per-claim evidence, the editable agreement, the unbypassable gate, the worker and reviewer, the diff, the shift report, per-change accept/reject, and the fold into a new version. |
| [`extension/`](./extension/) | The capture extension. See its README — the host grant is a step only you can do, from the side panel. |

**Built but not yet wired**, and asserted as such in `tests/reachability.test.ts` so it cannot be
mistaken for done: the shift-report narrative boundary (the field currently holds a stop-rule
label), the heartbeat gap sweeper (so two of four `CaptureGap` reasons cannot occur), and ~~the
`ModelCallRecord` writer (so the ledger does not reconstruct model calls)~~ — **the
`ModelCallRecord` writer was wired 2026-08-16 and the reachability claim moved into the reachable
section; every model call now records its boundary, model, latency, tokens and failure kind.**

~~That is three.~~ ~~**Corrected 2026-08-16: the suite pins seven.**~~ ~~**The suite pins ten, and
this paragraph accounts for six of them — corrected 2026-08-16, twice in one day.**~~
**The number is deleted rather than corrected again, 2026-08-20 — which is what the struck sentence
already told the next reader to do.** It said *"Read `tests/reachability.test.ts`'s deferred, and
asserted as deferred block rather than this sentence — it is the thing that is enforced, and this one
is prose that has now gone stale three times."* Slice 1 would have made it four: ~~five pins were
promoted out of the block in one wave~~ **struck 2026-08-20, later the same day — the fourth pin
count this paragraph has had to withdraw, and this one was wrong when it was written rather than
overtaken later.** No single wave promoted that many, the block had lost none of its pins yet on the
day the sentence was typed, and the paragraph immediately below this one enumerates more than the
sentence claimed. It is deleted rather than corrected, for the reason the sentence itself gives:
the honest move is to stop keeping the count in two places.
`tests/counts.test.ts` says the same in its own header — *"Deleting the number is always allowed and
always passes, which is the outcome the README argues for in its own prose."*

**What slice 1 moved, since a reader who remembers the old sentence needs to know which way.**
`createBrowserControl`, `confirmations.create` and `controlLost` are all reachable now
([#91](https://github.com/smukhyala/propositum/issues/91)): a run drives the browser, the gate stops
to ask a person, and a lost tab is reported. `scrollFraction`, exit type and arrival are read by the
offer grounds ([ADR-0018](./docs/adr/0018-the-everyday-shapes.md)). What is still pinned as deferred
is the shift-report narrative boundary, the gap sweeper, outcome-scoped review findings, and
`LANDING_ACTION_KINDS` — **still empty, so no irreversible outcome can occur**, which
[ADR-0010](./docs/adr/0010-acting-in-the-browser.md) now records as a decision about the transport
rather than caution: the extension fails every non-`GET` request unconditionally, so a landing kind
would be a claim the channel cannot honour. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks
each of these against the layer it belongs to.

~~**Not measured:** the harness produces H1 material and cannot yet produce H2 or H3, and both
scenarios expect a stop — so the false-stop half of H3 has nothing to score against.~~
**Struck 2026-08-20, by the harness that landed the same day.** Three claims in one sentence, and
the corpus moved under all three. A run now goes reading → handoff → plan → the worker loop → a
changeset, and `scripts/eval.ts` calls `scoreH3` on every driven run. The corpus is four scenarios,
not two. `monitor-shortlist` and `lisbon-thread` seal `shouldRaise: false`, which is exactly the
input `scoreH3`'s `false-stop` arm needs, and `tests/eval.test.ts` asserts that outcome against the
real fixture. [`docs/EVALUATION.md`](./docs/EVALUATION.md) was corrected by the same workstream and
this line was not — one claim in two places, one of which nothing checks, which is the failure
`tests/counts.test.ts`'s own header is about.

**What is still not measured, said narrowly rather than rounded back up.** No hypothesis has a
number: `eval-scores.json` is still the blank worksheet and the H1 component scores are typed by a
person after a run, because a model judge shares the generator's blind spots. A run cannot produce
an H2 *rate* — a rate needs verdicts, a verdict is what a person did to real work, and a fixture
accepts nothing; `renderH2FromRuns` reports the denominator and says the numerator is missing, and
the rate is read off the database by `npm run eval -- --report` and nowhere else. `budget-exhausted`
is unreachable because the drive freezes the clock, and ADR-0007's `information-missing` class still
has no scenario.

Work is tracked on the [wayfinder map](https://github.com/smukhyala/propositum/issues/1).

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is the working agreement for anyone else committing here — what the guard tests refuse, which invariants are ADRs rather than diffs, and the commit and branch conventions the history follows but never stated. Licensed [Apache-2.0](./LICENSE).

---

## The demo workflow

1. Create a project and approve the sources Propositum may see.
2. **Start session.** You research and draft normally.
3. **Take over.** Propositum shows *what I think you're working on*, with the evidence behind each
   claim. You correct it.
4. Set the working agreement — what it may look at, what it may change, how far to go, how long.
5. Leave.
6. Come back to *while you were away*: what changed, why, what it couldn't verify, and what it
   needs from you.
7. Accept or reject each change.

---

## Setup

Requires **Node ≥ 22** and npm. macOS.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY from console.anthropic.com
                              # the Google calendar variables are optional — see below
npx prisma db push            # creates the file and installs the append-only guards
npm run dev                   # serves on 3117 — the port the extension is pinned to
npm run worker                # a second terminal; runs are drained here, not in the app
```

~~`ANTHROPIC_API_KEY` is the only credential needed. SQLite is a local file; there is no cloud, no
account, and no telemetry.~~

**Struck 2026-08-18 — [ADR-0014](./docs/adr/0014-reading-free-busy.md), and left visible because a
reader has to be able to see what was promised.** The same sentence is struck and dated in
[`docs/VISION.md`](./docs/VISION.md) and [`docs/SECURITY_AND_PRIVACY.md`](./docs/SECURITY_AND_PRIVACY.md),
which is why it could not stand here.

`ANTHROPIC_API_KEY` is still the only credential **needed** — everything in the block above runs on
it alone, and that is the state of a fresh clone. There is still no cloud, no telemetry and no
server of ours. **But "no account" is gone**: connecting a Google calendar is optional, off unless
you do it, and it adds `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to `.env` plus one
OAuth refresh token in the local database. The scope is `calendar.freebusy` and nothing else —
*"View your availability in your calendars"*, which returns busy start/end times and cannot return a
title, an attendee or a description. Leave the two variables blank and the feature is **absent**:
nothing is read and no request leaves the machine. ADR-0014 opens on what it costs.

**For real capture** you also need the extension loaded and its id in `.env`, and you have to grant
each source from the side panel — a host grant needs a user gesture, so nothing else can do it.
[`extension/README.md`](./extension/README.md) is the authoritative six-step order.

Whenever the schema changes, `prisma db push` rebuilds the affected table and **silently drops its
append-only triggers**. They are reinstalled and verified at the next app startup; restart before
trusting the database.

```bash
npm test              # unit + schema snapshot tests
npm run typecheck
npm run verify:model  # offline SDK checks, plus a live round-trip if a key is present
```

---

## Repository structure

```
CONTEXT.md              the ubiquitous language — read this first
docs/                   MVP, vision, principles, research, ADRs
prisma/                 the SQLite schema, including the append-only ledger tables
scripts/                verification utilities
src/app/                Next.js routes
tests/                  offline tests, no credentials required
```

~~`prisma/  SQLite schema (minimal by design until the ledger model lands)`~~ **Re-marked
2026-08-20.** The ledger model landed and is now the largest thing in the schema:
`ObservationEvent`, `ActionIntent`, `ActionOutcome` and `ModelCallRecord` are all in
`prisma/schema.prisma`, and `src/persistence/ledger-writer.ts` is its single writer. The line was
written on 2026-08-06 against a schema that held one model, and it outlived that by a fortnight
while the status paragraph at the top of this file said the ledger was wired. Struck out here
rather than in the block above, because strikethrough does not render inside a fence — and a
description hidden in a code block is not a count, so nothing here could have caught it.

---

## Current limitations

These are properties of the design, not a to-do list.

- **"Leave your desk", not "leave the building".** A lid close can't be blocked, only delayed ~30
  seconds, so a local worker stops when your Mac sleeps. Cloud execution would fix it and is out of
  scope.
- **One shift per session.** Re-entry ends at accept/reject. No *keep going*, no *redirect*.
- **No cross-session continuity.** A second session starts cold.
- **n=1.** One person authors the references and scores the results. Every reported number carries
  that caveat.
- **Budget is time, not money.** Measured on a real boundary at ~$0.033 and ~15 s per model call, a
  30-minute budget buys roughly 120 calls for about a dollar — latency binds long before cost does.
- **Injection can change what the worker attempts, never what it can touch.** But it also reaches
  the session reading, so your review of the agreement is load-bearing rather than a formality.

---

## On the broader vision

Everything in [`docs/VISION.md`](./docs/VISION.md) beyond the **Now** sections — multi-project
work, adaptive autonomy, structured app integrations, ~~computer use,~~ cross-device continuity — is
**direction, not commitment, and none of it is implemented.**

**Computer use struck 2026-08-16.** It moved from Later to Now on 2026-08-11
([ADR-0010](./docs/adr/0010-acting-in-the-browser.md)) and this line did not move with it, which is
the same failure as the stale counts above and in the more embarrassing direction: understating what
the product can do is still saying a false thing about it. ~~What is actually true is narrower than
either version — the control channel is built and **no run yet constructs one**, asserted in
`tests/reachability.test.ts`.~~ **Struck 2026-08-20: a run constructs one.** The narrower claim was
true for nine days and is not now — a shift whose ratified agreement grants a kind needing a live
page drives the person's own Chrome, and the gate stops for a person before anything the browser
attests it cannot take back. What has *not* moved is `LANDING_ACTION_KINDS`, still empty. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks it layer by
layer; [`docs/ROADMAP.md`](./docs/ROADMAP.md) has the stages beyond slice 0.

The project's own principle applies to its README: say the true thing, including when it's
unimpressive. This is a foundation and an experiment designed so it can fail. It is not a product.
