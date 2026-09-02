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
- **There is no `prisma/migrations/`, and that is a decision rather than an
  omission** (2026-08-19). `db push` means a schema change on your branch cannot be
  replayed on somebody else's database: they push the schema themselves and rebuild
  their local data. That is cheap while every database here is disposable and every
  fixture is regenerated, and it is exactly wrong the first time anybody has data
  they would mind losing. **That is the trigger to revisit it** — not a headcount,
  and not the size of the schema.
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
| `tests/architecture.test.ts` | A capability that reaches the network without going through the gate. Also: any tool for sending, purchasing, publishing or deleting — ~~the brief's exclusions, asserted as absent~~ **read that test's own comment before trusting the clause, corrected 2026-08-26.** It greps `src/policy/tools.ts` for five function names, so since [ADR-0010](./docs/adr/0010-acting-in-the-browser.md) it is a statement about what we ship and not about reachable effects — `click-element` presses the page's own Send button. Since [ADR-0024](./docs/adr/0024-purchases-within-a-ratified-authorisation.md), buying is a thing Propositum is decided to do. The same row was corrected in `AGENTS.md` the same day; this copy is why the strike-and-date convention exists. **What this file's table now also refuses:** a schema field that could hold a credential, an action kind that carries one, a downgrade of the `password_field` refusal to a confirmation, and a remembered yes. |
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

- **A change without a test that would have failed before it is not done.** ~~The
  suite runs in about twenty seconds;~~ **corrected 2026-09-01:** about twenty
  seconds on a developer Mac, and roughly twice that on the CI runner, whose
  two cores are why a Markdown-only pull request went red on timeouts. Either
  way there is no budget argument here.
- **A new domain word goes into `CONTEXT.md` before it goes into a schema.** Nothing
  enforces this — it is a convention, and conventions are the ones that rot. If the
  word you need is not in the glossary, either you are inventing language the
  project does not use, or there is a real gap. Both are worth a sentence in the PR.
- **A count is allowed only where something checks it.** The README documented five
  of its own counts going stale, and the count of stale counts had gone stale too.
  `tests/counts.test.ts` now holds the rule: state a number and it must match the file
  that knows — glossary terms, banned rows, ADRs, principles, layers. Deleting a number
  always passes. The size of this suite has no cheap source of truth, so that one may
  not be stated at all. If your change moves a checked number, the test says so.

---

## Running it

```bash
npm test          # the whole suite; no credentials, no database, no network
npm run typecheck
npm run build
```

All three pass on a clone with no `.env` and no `prisma db push`. If any of them
needs setup on your machine, that is a bug in the repository, not in your machine.

**"No database" above is about setup, not behaviour** *(said plainly 2026-09-01)*.
A good share of the suite builds temporary SQLite files of its own and spawns
`npx prisma db push` for them; what it never touches is yours, because
`tests/support/no-real-database.ts` points `DATABASE_URL` at a path that does not
exist. The same sentence in `.github/workflows/ci.yml` had to be struck for being
read the other way, and `tests/counts.test.ts` now refuses it there.

**CI runs in UTC and your machine probably does not.** Anything that reads the
real clock and names a date behaves differently there — one test asserted the
complete contents of a table that also holds a row stamped `Date.now()`, and it
was green in an afternoon at UTC-7 and red an hour later on the runner. Reproduce
the runner's day from here with `TZ=UTC npm test` before blaming the runner.

**A test that passes on a quiet machine is not a passing test.** The other defect
CI found on its first run needed a busy one: two statements that depend on each
other were handed to different pooled connections, which never happens with
nothing else running. If you are chasing something that only fails on CI, put the
machine under load before concluding it is the platform.

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
  `ANTHROPIC_API_KEY`; ~~the optional Google scope is `calendar.freebusy` and nothing
  else (ADR-0014)~~ **amended 2026-09-01,
  [ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md): two more optional
  scopes are decided and unbuilt — `gmail.modify` and `calendar.app.created` — each its
  own consent, each behind the gate when built.**
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

**Match the file you are editing.** In practice that means no semicolons, single
quotes, two-space indent, and docblocks that explain the decision and then state
what they do *not* cover. That last habit is the house style and the most valuable
thing in the codebase — a guard whose limit is unstated reads as a stronger promise
than it is, and no formatter can supply it.

Prettier holds the mechanical half, configured to the style already here:

```bash
npm run format          # every file you changed against main
npm run format -- path  # or exactly these
npm run format:check    # the same set, reported not written
```

**There is deliberately no repo-wide reformat, and no formatting check in CI.**
Running Prettier over the whole tree rewrites 107 of 175 source files — measured
2026-08-19, +2,390 / −877 lines, nearly all re-wrapping — which is a decision
about `git blame` on a codebase whose docblocks are the point. Files converge as
they are edited. `scripts/format.ts` says what would have to be true before a CI
check earns its place.

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

[`docs/todo/`](./docs/todo/) is the longer-form version of the same list — one
file per piece of work, each opening with a command that tells you whether it is
already done. **Leaving it true is part of a change** *(2026-08-26)*: strike what
you finished, add what you found, and if you accepted an ADR for something you
did not build, write the file in the same change. `AGENTS.md` argues all three.
The last one is the one that gets skipped, and the cost is a corpus that
describes a product nobody has written — which has happened once, and is why
[`06`](./docs/todo/06-buying-things.md), [`07`](./docs/todo/07-off-the-browser.md)
and [`08`](./docs/todo/08-one-time-codes.md) were written after their decisions
rather than beside them.
