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
| [`CONTEXT.md`](./CONTEXT.md) | The ubiquitous language, and the only glossary — there is no `UBIQUITOUS_LANGUAGE.md`. ~~38 terms, 28 banned.~~ **Corrected 2026-08-16: 54 terms, and 21 rows in the banned table, one of them now struck.** CONTEXT.md's own closing line carries the term count and is the authority on it; this cell had been wrong since 2026-08-11, which is what keeping a count in two places does. Every schema, prompt, table and UI string uses these words. |
| [`docs/MVP.md`](./docs/MVP.md) | What slice 0 is, the three hypotheses, and the pass/fail numbers — fixed before any result existed. |
| [`docs/VISION.md`](./docs/VISION.md) | Where this goes, with **now** and **later** kept strictly apart. |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Ten layers, each marked with what is built and what would have to exist first. Six of the ten are partial or absent. |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Four stages. Stage 1 points at MVP.md rather than restating it; stages 2–4 are direction, not commitment, and none is implemented. ~~Stage 1's one addition — the `Intention` table — is not implemented either as of 2026-08-16.~~ **Amended 2026-08-16, later the same day: the table, the two nullable foreign keys and the lifecycle word landed.** This cell was written in the doc wave and outlived it by hours — the fifth stale count in this table, and the one with the shortest half-life. |
| [`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) | ~~Ten principles~~ **fifteen, corrected 2026-08-16**, each stating what it concretely forbids. PRODUCT_PRINCIPLES.md's own header carries the count and is the authority on it — and says the header had been wrong since principle 11 arrived. Fourth stale count in this table, in the document that tells the others to say the true thing. |
| [`docs/research/`](./docs/research/) | ~4,900 lines answering the questions the architecture waited on. |
| [`docs/FOUNDING_BRIEF.md`](./docs/FOUNDING_BRIEF.md) | The originating brief, kept as history. |
| [`docs/adr/`](./docs/adr/) | ~~Seven decisions~~ **eleven, corrected 2026-08-16 ([ADR-0011](./docs/adr/0011-intention-above-worksession.md) is the newest)**, each with the option it rejected and why. The number went stale four ADRs ago and nothing noticed, because nothing counts them. |
| Runtime | Next 16, TypeScript strict, Prisma + SQLite, Zod 4, Vitest. ~~336 tests.~~ ~~1,028 tests across 40 files, measured 2026-08-16.~~ **1,124 tests across 44 files, measured 2026-08-16 after the Intention slice.** The first correction was stale by roughly a factor of three; the second was stale within the day, which is the argument against keeping a count here at all. |
| The product | Chrome MV3 capture, the reading with per-claim evidence, the editable agreement, the unbypassable gate, the worker and reviewer, the diff, the shift report, per-change accept/reject, and the fold into a new version. |
| [`extension/`](./extension/) | The capture extension. See its README — the host grant is a step only you can do, from the side panel. |

**Built but not yet wired**, and asserted as such in `tests/reachability.test.ts` so it cannot be
mistaken for done: the shift-report narrative boundary (the field currently holds a stop-rule
label), the heartbeat gap sweeper (so two of four `CaptureGap` reasons cannot occur), and ~~the
`ModelCallRecord` writer (so the ledger does not reconstruct model calls)~~ — **the
`ModelCallRecord` writer was wired 2026-08-16 and the reachability claim moved into the reachable
section; every model call now records its boundary, model, latency, tokens and failure kind.**

~~That is three.~~ ~~**Corrected 2026-08-16: the suite pins seven.**~~ **The suite pins ten, and
this paragraph accounts for six of them — corrected 2026-08-16, twice in one day.** The count above
was wrong in both directions at once: it had not caught up with four capabilities, and it had never
counted `joinedExisting`, `projects.rename`, `revokeSource` or `sessions.refile` at all. Read
`tests/reachability.test.ts`'s *deferred, and asserted as deferred* block rather than this sentence
— it is the thing that is enforced, and this one is prose that has now gone stale three times.
The four this paragraph had not
caught up with are `controlLost` (two structural stop rules cannot fire), `findings.forRun`
(outcome-scoped review findings are written and never shown), `confirmations.create` (the gate has
never yet stopped to ask a person anything), and `createBrowserControl` — **no run drives the
browser**, so the acting path decided in [ADR-0010](./docs/adr/0010-acting-in-the-browser.md) has both
ends built and nothing holding the middle. `LANDING_ACTION_KINDS` is likewise empty, so no
irreversible outcome can occur. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks each of these
against the layer it belongs to.

**Not measured:** the harness produces H1 material and cannot yet produce H2 or H3, and both
scenarios expect a stop — so the false-stop half of H3 has nothing to score against.

Work is tracked on the [wayfinder map](https://github.com/smukhyala/propositum/issues/1).

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
prisma/                 SQLite schema (minimal by design until the ledger model lands)
scripts/                verification utilities
src/app/                Next.js routes
tests/                  offline tests, no credentials required
```

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
the product can do is still saying a false thing about it. What is actually true is narrower than
either version — the control channel is built and **no run yet constructs one**, asserted in
`tests/reachability.test.ts`. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks it layer by
layer; [`docs/ROADMAP.md`](./docs/ROADMAP.md) has the stages beyond slice 0.

The project's own principle applies to its README: say the true thing, including when it's
unimpressive. This is a foundation and an experiment designed so it can fail. It is not a product.
