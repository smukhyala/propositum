# Contributing to Propositum

This file exists because the repository was written by one person and is about to
be read by more than one. Most of what follows was already true — it was true in
somebody's head, or in a test that fails without saying why, or in the shape of
174 commits. Written down, it stops being something you have to infer from the
diff you are about to conflict with.

Where this file and the code disagree, **the code wins and this file is a bug.**

---

## Before you write anything

Read, in this order:

1. **[`CONTEXT.md`](./CONTEXT.md)** — the ubiquitous language, and the only glossary.
   Every schema field, prompt, table and UI string uses these words. It also holds
   the banned table: words the interface may not use, `Task` among them, outright.
2. **The ADRs that touch your area** — [`docs/adr/`](./docs/adr/). Each records the
   option it rejected and why. If your change contradicts one, say so in the pull
   request explicitly — *"contradicts ADR-0007, but worth reopening because…"* — and
   amend the ADR in the same change. Silently overriding a decision loses the
   argument that produced it.
3. **[`AGENTS.md`](./AGENTS.md)** if you are driving an agent, which most work here is.

[`README.md`](./README.md) is the authority on setup and is not repeated here.

Two setup facts that cost people an afternoon:

- **`npx prisma db push` silently drops the append-only triggers** on any table it
  rebuilds. They are reinstalled and verified at the next app startup. Restart
  before trusting the database — a ledger without its triggers looks identical and
  is not append-only.
- **The extension's host grant needs a user gesture**, so nothing can automate it.
  [`extension/README.md`](./extension/README.md) is the authoritative order.

---

## What "done" means

**A change is done when the guards agree with you.** The rules in this repository
are executable wherever that was possible, and the tests that hold them are not
ordinary tests — they are the rulebook, and they fail on the class of mistake that
prose could not prevent:

| Guard | What it refuses |
|---|---|
| `tests/architecture.test.ts` | A capability that reaches the network without going through the gate. Also: any tool for sending, purchasing, publishing or deleting — the brief's exclusions, asserted as absent. |
| `tests/reachability.test.ts` | Something built, tested, and called by nothing. Read this one before you start; see below. |
| `tests/append-only.test.ts` | A ledger table that can take an `UPDATE` or a `DELETE`. |
| `tests/boundaries.test.ts` | A model boundary that could grant a permission, launder page text into an instruction, or widen a closed set of kinds. All eight boundaries, asserted distinct. |
| `tests/policy-gate.type-test.ts`, `tests/untrusted-budget.type-test.ts` | Compile-time proofs, via `@ts-expect-error`. These hold no `it()` and vitest never sees them — **`npm run typecheck` is what runs them**, and a passing run means the wrong code *did not compile*. |

`tests/reachability.test.ts` deserves the extra minute. Three defects shipped here
because code was correct, tested, and wired to nothing — `documents.create` had no
caller at all, so the entire handoff path answered every request with a refusal
that read like a hint. The file now asserts, per capability, either *this is
reached* or *this is deferred, and asserted as deferred*. **If you wire something
up, move its assertion out of the deferred block in the same change. If you build
something you cannot wire yet, add it to the deferred block.** A capability in
neither is the exact hole the file exists to close.

Beyond the guards:

- **A change without a test that would have failed before it is not done.** The
  suite runs in about twenty seconds; there is no budget argument here.
- **A new domain word goes into `CONTEXT.md` before it goes into a schema.** Nothing
  enforces this — it is a convention, and conventions are the ones that rot. If the
  word you need is not in the glossary, either you are inventing language the
  project does not use, or there is a real gap. Both are worth a sentence in the PR.
- **Never add a count you have to maintain by hand.** The README documents five of
  its own counts going stale, and the count of stale counts also went stale. If your
  change moves a number some document states, fix that document in the same commit —
  or better, delete the number and point at the thing that knows it.

---

## Running it

```bash
npm test          # the whole suite; no credentials, no database, no network
npm run typecheck
npm run build
```

All three pass on a clone with no `.env` and no `prisma db push`. If any of them
needs setup on your machine, that is a bug in the repository, not in your machine.

**`npm run test:live` and `npm run eval` are different.** They call the real API,
cost money, and are never part of `npm test` or CI. Two further cautions:

- `references.lock.json` is a **seal**. The blind-reference rule is mechanical:
  editing an answer key breaks the hash and the run refuses. Do not "fix" a lock.
- `eval-scores.json` is a single shared worksheet with a `scoredBy` field. Two
  people scoring at once will conflict on it. Say in the issue that you are
  scoring before you start.

`npm run capture:afternoon` writes **a profile of your own browsing** to a file.
Read the docblock at the top of `src/fixtures/capture-afternoon.ts` before running
it, and never commit one containing real browsing — a git history is forever and
the ambient buffer is not.

---

## Invariants you may not quietly break

These are decided, documented, and load-bearing. Changing one is an ADR, not a diff.

- **Models propose; deterministic code authorizes.** Never the reverse.
  `compilePolicy` structurally cannot receive a `StatedIntent`.
- **Observation may never execute actions.**
- **No cloud, no telemetry, no server of ours.** The only credential needed is
  `ANTHROPIC_API_KEY`; the optional Google scope is `calendar.freebusy` and nothing
  else (ADR-0014).
- **Every inference carries provenance to its events**, and every action is an
  `ActionIntent` before and an `ActionOutcome` after — two rows, because one row
  holding both would force an `UPDATE` into an append-only table.
- **Nothing is ever copied.** The `Changeset` is the copy, and "copy" is banned
  from the interface.
- **Page text reaches a prompt only as `Datamarked`**, and only through the one
  door. [`docs/SECURITY_AND_PRIVACY.md`](./docs/SECURITY_AND_PRIVACY.md) tabulates
  the boundaries and names the model's judgment as the weakest layer.
- **Say the true thing, including when it is unimpressive.** This applies to the
  README, to a status table, and to a PR description. Understating what the product
  does is still saying a false thing about it.

A new runtime dependency is a decision. There are seven, and each one is load-bearing.

---

## Branches, commits, pull requests

**Branches** are `<track>/<slug>`. Four tracks are in use: `product/` for a shipped
surface, `direction/` for work that follows a direction update, `agent/` for work an
agent drove end to end, and `unit<N>/` for a numbered slice off a product branch.
Match the nearest one rather than inventing a fifth.

**Commit subjects are a sentence about what changed for the product**, in the
imperative, frequently two clauses joined by *and*. There are no `feat:` prefixes,
no ticket ids, and no file names. From the actual history:

```
Classify how a page was arrived at, and stop holding the address it came from
Read free/busy, and spend the sentence that said there was no account
One comment stripper, because the second one was a guard away from blind
Correct the last two places the expired argument was still stated as live
```

The test is whether somebody reading `git log` a month later learns what the
product can now do, or what it stopped claiming. `Update actions.ts` fails it.

**Pull requests** go against `main`, which requires CI green. In the body:

- what changed, in the same register as the commit subject;
- the ADR or issue it answers, linked;
- what you did **not** do, and what is now reachable that was not — this is the
  half that gets lost, and it is the half `tests/reachability.test.ts` is about.

---

## Style

There is no formatter yet, and this is worth knowing rather than discovering:
**match the file you are editing.** In practice that means no semicolons, single
quotes, two-space indent, and docblocks that explain the decision and then state
what it does *not* cover. That last habit is the house style and the most valuable
thing in the codebase — a guard whose limit is unstated reads as a stronger promise
than it is.

Two files are large and hot: `src/server/actions.ts` and
`src/persistence/repositories/index.ts` are touched by roughly one commit in seven
each. Expect conflicts there, rebase early, and keep unrelated changes out of them.

---

## Finding work

Work is tracked as GitHub issues, with the
[wayfinder map](https://github.com/smukhyala/propositum/issues/1) as the root: the
map holds the destination, the decisions so far, and the fog. Its **Not yet
specified** section is the honest list of what is named and not done.

`docs/agents/issue-tracker.md` has the `gh` conventions; `docs/agents/triage-labels.md`
has the labels. `ready-for-agent` means fully specified and safe to hand to an
agent; `ready-for-human` means it needs judgment that has not been written down yet.
