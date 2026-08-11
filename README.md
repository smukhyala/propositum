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
| [`CONTEXT.md`](./CONTEXT.md) | The ubiquitous language. 38 terms, 28 banned. Every schema, prompt, table and UI string uses these words. |
| [`docs/MVP.md`](./docs/MVP.md) | What slice 0 is, the three hypotheses, and the pass/fail numbers — fixed before any result existed. |
| [`docs/VISION.md`](./docs/VISION.md) | Where this goes, with **now** and **later** kept strictly apart. |
| [`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) | Ten principles, each stating what it concretely forbids. |
| [`docs/research/`](./docs/research/) | ~4,900 lines answering the questions the architecture waited on. |
| [`docs/FOUNDING_BRIEF.md`](./docs/FOUNDING_BRIEF.md) | The originating brief, kept as history. |
| [`docs/adr/`](./docs/adr/) | Seven decisions, each with the option it rejected and why. |
| Runtime | Next 16, TypeScript strict, Prisma + SQLite, Zod 4, Vitest. 336 tests. |
| The product | Chrome MV3 capture, the reading with per-claim evidence, the editable agreement, the unbypassable gate, the worker and reviewer, the diff, the shift report, per-change accept/reject, and the fold into a new version. |
| [`extension/`](./extension/) | The capture extension. See its README — the host grant is a step only you can do, from the side panel. |

**Built but not yet wired**, and asserted as such in `tests/reachability.test.ts` so it cannot be
mistaken for done: the shift-report narrative boundary (the field currently holds a stop-rule
label), the heartbeat gap sweeper (so two of four `CaptureGap` reasons cannot occur), and the
`ModelCallRecord` writer (so the ledger does not reconstruct model calls).

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
npx prisma db push            # creates the file and installs the append-only guards
npm run dev                   # serves on 3117 — the port the extension is pinned to
npm run worker                # a second terminal; runs are drained here, not in the app
```

`ANTHROPIC_API_KEY` is the only credential needed. SQLite is a local file; there is no cloud, no
account, and no telemetry.

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
work, adaptive autonomy, structured app integrations, computer use, cross-device continuity — is
**direction, not commitment, and none of it is implemented.**

The project's own principle applies to its README: say the true thing, including when it's
unimpressive. This is a foundation and an experiment designed so it can fail. It is not a product.
