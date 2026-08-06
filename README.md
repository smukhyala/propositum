# Propositum

**Understands where you were going, and keeps going while you're away.**

*Propositum* is Latin for intention. Knowledge work rarely ends at a stopping point — it ends at an
interruption, with a half-drafted section and six tabs whose relevance only you understand. The
expensive part of coming back isn't resuming the typing. It's rebuilding the intention.

Propositum watches an approved work session, builds a structured reading of what you were going
for, and — once you've ratified an explicit agreement — continues in a constrained environment
while you're gone. You come back to what changed, why, and what it couldn't decide for you.

> **Status: pre-alpha. There is no working product yet.** The foundation is built — vocabulary,
> research, runtime, and the experiment design. The vertical slice is not. This README describes
> what exists, and says plainly where it doesn't.

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
| Runtime | Next 16, TypeScript strict, Prisma + SQLite, Zod 4, Vitest. Stands up, tests pass. |

**Not built yet:** the Chrome extension, session-state inference, the handoff screen, the policy
gate, the worker and reviewer, the diff and review UI, the shift report, the evaluation harness.
That is most of the product.

Work is tracked on the [wayfinder map](https://github.com/smukhyala/propositum/issues/1).

---

## The demo workflow, when it exists

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
npx prisma generate
npm run dev
```

`ANTHROPIC_API_KEY` is the only credential needed. SQLite is a local file; there is no cloud, no
account, and no telemetry.

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
- **Budget is time, not money.** Measured at ~$0.009 and ~7.8 s per model call, a 30-minute budget
  is about $2 — latency binds long before cost does.
- **Injection can change what the worker attempts, never what it can touch.** But it also reaches
  the session reading, so your review of the agreement is load-bearing rather than a formality.

---

## On the broader vision

Everything in [`docs/VISION.md`](./docs/VISION.md) beyond the **Now** sections — multi-project
work, adaptive autonomy, structured app integrations, computer use, cross-device continuity — is
**direction, not commitment, and none of it is implemented.**

The project's own principle applies to its README: say the true thing, including when it's
unimpressive. This is a foundation and an experiment designed so it can fail. It is not a product.
