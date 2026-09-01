# propositum

Propositum watches an approved work session in Chrome, builds a structured reading of what the person
was going for, and — once they have ratified an explicit agreement — continues in a constrained
environment while they are away. They come back to what changed, why, and what it could not decide
for them. *Propositum* is Latin for intention.

**Status: pre-alpha.** The slice runs end to end~~ and no hypothesis has a number yet. `eval-scores.json`
is still a blank worksheet~~ — **scored 2026-08-27: H1 passed one scenario of four, H3 failed on a
missed stop, and the baseline read at least as well on all four (`docs/EVALUATION.md`, Second
run)**. `README.md` is the authority on setup and on what is built; it says
plainly where the gaps are, and so should you.

This file is the agent-facing manual. `CLAUDE.md` is a stub that imports it, so Claude Code and other
agent tools read the same thing.

## Read before you write

1. **`CONTEXT.md`** — the ubiquitous language, and the **only** glossary. There is no
   `UBIQUITOUS_LANGUAGE.md`. Every schema field, prompt, table and UI string uses these words. It also
   holds the banned table.
2. **The ADRs that touch your area** — `docs/adr/`. Each records the option it rejected and why. If
   your change contradicts one, say so explicitly — *"contradicts ADR-0007, but worth reopening
   because…"* — and amend that ADR in the same change. Silently overriding a decision loses the
   argument that produced it.
3. **`docs/PRODUCT_PRINCIPLES.md`** — each principle states what it concretely forbids, and names
   whether it is enforced by a type, a test, or discipline alone.

`docs/ARCHITECTURE.md` is layer build status and `docs/ROADMAP.md` is stage framing. Neither is the
glossary — `CONTEXT.md` still is. The layer names in `docs/ARCHITECTURE.md` are **not** vocabulary;
nothing in code, schema, prompts or UI may be named after one.

**`docs/todo/` is what is left to do**, one file per piece of work, added 2026-08-26. Each carries an
**Is this already done?** command before anything else, because work here has a documented habit of
landing before the document predicting it notices — two of those files were overtaken within hours of
being written. **Run that command before you believe a status line, including the ones in this file.**
Each also names the parts that are **not software**: an account to open, a fee to pay, a certificate
to request, a button only a person can press. Those have lead times and they are usually the reason a
two-week job takes five.

**Keeping that folder true is part of the change, not a tidy-up afterwards** *(added 2026-08-26)*.
Three rules, and the third is the one that gets skipped:

- **You finished something a file here predicted** — strike it and date it in that file, in the same
  commit. Do not delete the item; a checklist that silently loses its finished entries reads as
  though they were never on it.
- **You found work no file here covers** — add it, with all six headings. A `TODO` comment in a
  source file is not this; nobody reads `src/` looking for what is left.
- **You accepted an ADR for something you did not build** — **write the file in the same change that
  accepts the ADR.** An accepted decision with no todo beside it is the worst state in this
  repository, because every other document starts describing the new product in the present tense
  while `grep` still finds nothing. That is exactly what happened on 2026-08-26: ADR-0024, ADR-0025
  and ADR-0026 landed, `CONTEXT.md`, `VISION.md` and `SECURITY_AND_PRIVACY.md` were rewritten around
  them, and [`docs/todo/README.md`](docs/todo/) named the missing work in one paragraph without
  writing it down. [`06`](docs/todo/06-buying-things.md),
  [`07`](docs/todo/07-off-the-browser.md) and [`08`](docs/todo/08-one-time-codes.md) exist because
  of that gap, and this rule exists so the next one is closed on the day rather than found later.

A decided-but-unbuilt term also gets the **specification rather than a description** fence in
`CONTEXT.md` — the `PurchaseAuthorization` entry is the pattern, and the fence comes off in the
commit that builds the thing. Where a document and the code disagree, **the code is right**, and the
document is the one to fix.

## Commands

```bash
npm run dev        # port 3117 — starts the worker beside it, one terminal
npm run worker     # the worker alone, for anyone who wants them apart
npm run dev:web    # the app alone, same port
npm test           # the whole suite; no credentials, no database, no network
npm run typecheck  # also where the *.type-test.ts compile-time proofs run
npm run build
npx prisma db push
```

~~`npm run dev` and `npm run worker` are both required.~~ **One command, 2026-08-26** —
`scripts/dev.ts` spawns both as siblings and Ctrl-C stops both
([ADR-0001](docs/adr/0001-worker-runtime.md), amended). The consequence of the worker NOT running is
unchanged and is why this is worth a script: a run nobody drains, and a session that stays `away` for
ever. `npm run seed:shift` and `npm run seed:offer` produce something to look at without waiting for
an afternoon.

`test`, `typecheck` and `build` all pass on a clone with no `.env` and no database. If one needs setup
on your machine, that is a bug in the repository.

**`npm run test:live` and `npm run eval` are different.** They call the real API, cost money, and are
never part of `npm test`. `npm run capture:afternoon` writes a profile of your own browsing to a file
— read the docblock at the top of `src/fixtures/capture-afternoon.ts` first, and never commit one
containing real browsing.

Two setup facts that cost an afternoon:

- **`npx prisma db push` silently drops the append-only triggers** on any table it rebuilds. They are
  reinstalled and verified at the next app startup. Restart before trusting the database — a ledger
  without its triggers looks identical and is not append-only.
- **The extension's host grant needs a user gesture**, so nothing can automate it. `extension/README.md`
  is the authoritative order.

Port 3117 is pinned in the dev and start scripts, a hardcoded constant in the extension, the Google
OAuth redirect URI, and the tray app's `src-tauri/src/origin.rs`. `tests/capture.test.ts` is the
count that stays true: it asserts the scripts, the extension and the tray agree — the OAuth pin is
the one nothing asserts.

## Layout

In pipeline order, because the order is the design:

| | |
|---|---|
| `extension/`, `src/capture/` | Observation. Holds no tools and changes nothing. The extension is **buildless** — the file in git is the file Chrome runs, which is why grep tests over it are real guards. |
| `src/domain/` | Pure logic — `detection`, `handoff`, `execution`, `document`, `outcome`, `intention`, and — since 2026-08-26 — `conversation`, the closed set of things the phone thread may say and the parser for what comes back ([ADR-0021](docs/adr/0021-a-thread-on-the-persons-phone.md)). Imports nothing from `app`, `model`, `persistence` or `policy`, calls no `fetch`, and **may not read the clock**: `Date.now()` and `new Date()` are grepped for and rejected, so clocks are injected. |
| `src/model/`, `src/model/boundaries/` | Every model-calling place, behind one `ModelClient`. `provider.ts` is the only construction site — a `switch` on a provider name there is the first half of a Worker Router, which is on the do-not-build list. |
| `src/policy/` | `gate.ts` and the tools behind it. Nothing in `tools.ts` accepts anything but an `AuthorizedAction`. |
| `src/runtime/` | The worker loop and process, drained by `scripts/worker.ts` in its own OS process (ADR-0001, amended — `npm run dev` now spawns it as a sibling), plus the browser control channel and `thread-channel.ts`, **the one file that knows Telegram exists**. A second transport is a new file here and a test enforces that. |
| `src/persistence/` | Repositories, the single ledger writer, and `append-only.ts`. The only Prisma consumer. |
| `src/server/` | Route-facing orchestration and the server actions. |
| `src/app/`, `src/ui/` | Next.js routes and client components. `src/app/welcome/` is the setup screen, added 2026-08-26 — five steps, each reading what is actually true rather than tracking a cursor, so there is no progress row to get out of step with the truth. Its derivation lives in `src/server/welcome.ts` because a `.tsx` server component is the one thing here nothing can assert against. |
| `src/eval/`, `src/fixtures/` | The offline harness and its scenarios. |

Prisma's SQLite provider has **no enums**. Every closed set is a `String` whose authoritative
definition is the Zod schema in `src/domain`; the schema comment listing the members is documentation,
not constraint.

## Invariants you may not quietly break

Changing one of these is an ADR, not a diff.

- **Models propose; deterministic code authorises.** Never the reverse. `compilePolicy` structurally
  cannot receive a `StatedIntent` — passing prose into a policy decision is a compile error.
- **Observation never executes actions.** The two ledgers are disjoint.
- **Two rows per action** — an `ActionIntent` before and an `ActionOutcome` after. One row holding both
  would force an `UPDATE` into an append-only table.
- **Page text reaches a prompt only as `Datamarked`**, through one door. The brand's symbol is never
  exported, so raw page text cannot reach a prompt by accident.
- **No dial, default, timeout or model may pre-approve an irreversible action.** The acknowledgement is
  per action, by a person, and a question that times out produces no verdict row and therefore no
  permission.
- **Nothing is ever copied.** The `Changeset` is the copy, and "copy" is banned from the interface.
- **No cloud, no telemetry, no server of ours.** `ANTHROPIC_API_KEY` is the only credential needed; ~~the
  optional Google scope is `calendar.freebusy` and nothing else (ADR-0014)~~ **amended 2026-09-01,
  [ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md), decided and unbuilt**: two
  more optional scopes are permitted on paper — `gmail.modify` (everything in mail but permanent
  delete; send only inside a ratified `SendAuthorization`) and `calendar.app.created` (holds on a
  calendar Propositum creates; the person's own calendars stay unreachable by construction).
  `grep -rn 'gmail' src/` still returns nothing, and where this line and the code disagree, the code
  is right.

**The heuristic all of these express:** prefer absence to a rule, and a type to a convention. *"There
is no field for it"* beats *"must not"*, and a compile error beats a review note. Extend that pattern
rather than relying on care.

### Do not build

Binding, from `docs/superpowers/specs/2026-08-16-direction-update-source.md` §8 by way of
`docs/ARCHITECTURE.md`: a full graph database · automatic Gmail/Slack/Calendar/GitHub/Notion ingestion
· continuous autonomous background scheduling · learned trust models · multi-provider quality or cost
routing · large multi-agent swarms · ~~unrestricted computer use~~ · automatic multi-intention compute
allocation · cross-device continuity · proactive consequential action without an established
permission policy.

A clean interface is permitted; a router is not.

**One entry struck, 2026-08-26 — [ADR-0025](docs/adr/0025-computer-use-beyond-the-browser.md).**
Computer use is the product: Propositum **will** drive macOS rather than one Chrome tab. **Decided,
not built** — `grep -rn 'approvedApplications' src/` finds nothing today, and the same is true of
ADR-0024's `PurchaseAuthorization` and ADR-0026's `chat.db` reader. Read the ADRs for what was
decided and the code for what runs; where this file and the code disagree, the code is right and this
line is the one to fix. It is the only entry ever removed from this list and it is struck rather than
deleted, so the next person proposing a removal has to argue against something. **What stays forbidden is `unrestricted`**, and the
restrictions are ADR-0025 §3, not this file: no shell · no `osascript` or AppleScript · no filesystem
read outside the one `chat.db` reader ([ADR-0026](docs/adr/0026-reading-a-one-time-code.md)) · no
keychain · no enumeration of what is running · every mutating action checked against an application
allowlist the person ratified.

**Two invariants below moved with it and are restated because they are the ones most likely to be
read as still true.** *"No cloud, no telemetry, no server of ours"* is unchanged. *"Observation never
executes actions"* is unchanged. But *"no dial, default, timeout or model may pre-approve an
irreversible action"* now sits beside a `PurchaseAuthorization`
([ADR-0024](docs/adr/0024-purchases-within-a-ratified-authorisation.md)) — which is not a dial, not a
default and not a model: it is a structured object a person ratified, per purchase scope, with a
ceiling nothing may relax. *(And since 2026-09-01, beside a `SendAuthorization` and a per-contract
ratified unsubscribe list —
[ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md), the same shape on the same
argument: ratified structured objects whose absence is the deny, none of them a dial.)*

## What "done" means

**A change is done when the guards agree with you.** These are not ordinary tests — they are the
rulebook, and they fail on the class of mistake prose cannot prevent.

| Guard | What it refuses |
|---|---|
| `tests/architecture.test.ts` | A capability that reaches the network without going through the gate; a tool for sending, purchasing, publishing or deleting *(**read the test's own comment before trusting that clause** — since [ADR-0010](docs/adr/0010-acting-in-the-browser.md) it is a statement about our function names and not about reachable effects, and since [ADR-0024](docs/adr/0024-purchases-within-a-ratified-authorisation.md) buying is a thing Propositum does)*; a `src/domain` file that reads a clock or imports a layer above it. |
| `tests/reachability.test.ts` | Something built, tested, and called by nothing. |
| `tests/append-only.test.ts` | A ledger table that can take an `UPDATE` or a `DELETE`. |
| `tests/boundaries.test.ts` | A model boundary that could grant a permission, launder page text into an instruction, or widen a closed set of kinds. |
| `tests/consumer-vocabulary.test.ts` *(added 2026-08-26)* | A word `CONTEXT.md` bans, in something a person reads — `take over`, `shift`, `claim`, `task`. It extracts prose rather than grepping source, so the same word stays legal as a type, an identifier, a route and a docblock. |
| `tests/policy-gate.type-test.ts`, `tests/untrusted-budget.type-test.ts` | Compile-time proofs via `@ts-expect-error`. They hold no `it()` and vitest never sees them — **`npm run typecheck` is what runs them**, and passing means the wrong code did not compile. |

`tests/reachability.test.ts` deserves the extra minute. It asserts, per capability, either *this is
reached* or *this is deferred, and asserted as deferred*. **If you wire something up, move its
assertion out of the deferred block in the same change. If you build something you cannot wire yet,
add it to the deferred block.** A capability in neither is the exact hole the file exists to close.
Its greps strip comments and imports first, because a docblock mentioning a function once satisfied
one of them.

Beyond the guards:

- **A change without a test that would have failed before it is not done.** The suite runs in about
  twenty seconds; there is no budget argument here.
- **A new domain word goes into `CONTEXT.md` before it goes into a schema.** ~~Nothing enforces
  this.~~ **Partly, since 2026-08-26:** `tests/consumer-vocabulary.test.ts` runs the banned-words
  table against every screen, so a *banned* word reaching a surface is caught. A *missing* word — one
  you invented that the glossary has never heard of — is still nobody's job but yours. If
  the word you need is not in the glossary, either you are inventing language the project does not
  use, or there is a real gap. Both are worth a sentence in the pull request.
- **Never add a count you have to maintain by hand.** If your change moves a number some document
  states, fix that document in the same commit — or better, delete the number and point at the thing
  that knows it. This file follows that rule; keep it that way.
- **`docs/todo/` is left true in the same commit** *(added 2026-08-26)*. Strike what you finished,
  add what you found, and **write the file for a decision you accepted but did not build** — the
  three rules are argued at the top of this document. Nothing enforces any of them; the failure mode
  is a corpus that describes a product nobody has written, and it has happened once already.
- **`docs/ARCHITECTURE.md` is re-marked in the same commit as any major change** *(added
  2026-08-27)*. A major change is one that moves a layer's Status cell, spends a bound that file
  states as permanent, or accepts an ADR that reverses something it asserts. `tests/counts.test.ts`
  reads the Status column and nothing else, so **no test will ever catch a stale claim in the
  prose** — it is corrected by somebody remembering or not at all. It went 0-for-3 on ADR-0024,
  ADR-0025 and ADR-0026 for a day, which is why this bullet exists.

  **Keep it short.** Re-mark the sentence that is now false, strike and date it in place, and stop —
  the correction is a clause or two beside the claim, never a new section and never a summary of the
  ADR, which is what the ADR is for. **A status cell moves only when the code moves**, so a decision
  that is accepted and unbuilt gets a corrected sentence and an unchanged cell; that distinction is
  the whole value of the column and it is the easiest thing to lose on the day an ADR lands.

## Vocabulary

Every schema field, prompt, table and UI string uses `CONTEXT.md`'s words. Read its banned table before
naming anything. The traps you will actually hit:

- **`Task` is banned outright.** Write `PlanStep`, `ActionIntent` or `AgentRun`.
- **Bare `action` and bare `Objective` are banned.** Write `ActionKind` (a type) or `ActionIntent` (an
  instance); write "the reading's objective claim" or "the contract's stated objective".
- **`outcome` is banned as a column name**, because it is ambiguous between `disposition` and
  `terminalReason`. It is *not* banned as a foreign key: `outcomeId` and `shiftOutcomeId` say exactly
  what they hold.
- **`WorkingAgreement` is reserved** for a durable delegation policy that is not built. Until it is,
  the object is a `HandoffContract` and "Working agreement" is its consumer label.
- ~~**Four verbs, never interchangeable:**~~ **Five, 2026-08-26:** the gate **refuses** · the human
  **rejects** · the model **declines** · the human **confirms** · the human **answers**. Rejecting is a
  decision about work already held; confirming is permission for something that has not happened and
  cannot be undone once it has; answering is prose in reply to a `DecisionNeeded` and grants nothing at
  all ([ADR-0022](docs/adr/0022-the-fourth-verdict.md)).
- **The handover verb is *hand over*, never *take over*** *(2026-08-26)*. Both were live on adjacent
  screens with the direction reversed between them — the project screen said *Hand this over*, the
  agreement's own button said *Take over*. The person is the subject, the way they are in all five
  verbs above.
- **`shift` and `claim` are internal words** *(2026-08-26)*. Correct as a type, an identifier, a
  route and a docblock; banned in anything a person reads. A Shift's consumer wording is *"While you
  were away"*; a SessionClaim's is the sentence itself. Twelve screens said `shift` before this.

Four of those are executable: `tests/consumer-vocabulary.test.ts` fails on `task`, `take over`,
`shift` and `claim` reaching a screen. The rest of this list is still discipline.

"Worker" means three different things here — a layer in `docs/ARCHITECTURE.md`, an `AgentRun.role`, and
the `npm run worker` process. Say which.

## Documents, commits and pull requests

**Corrections are struck and dated in place, never overwritten.** What a reader has believed until now
is worth leaving on the page beside what replaced it — that is why `~~old claim~~ **Corrected
2026-08-16: …**` is all over this repository rather than a clean edit. Apply it in every document a
reader would consult, not just the one you noticed.

**Principles are appended, never inserted or renumbered.** Source comments in `src/` cite them by
number. A principle that turns out to be wrong is struck and dated in place, keeping its number.

**Commit subjects are a sentence about what changed for the product**, in the imperative, frequently
two clauses joined by *and*. No `feat:` prefixes, no ticket ids, no file names. From the history:

```
Classify how a page was arrived at, and stop holding the address it came from
Read free/busy, and spend the sentence that said there was no account
One comment stripper, because the second one was a guard away from blind
```

The test is whether somebody reading `git log` in a month learns what the product can now do, or what
it stopped claiming. `Update actions.ts` fails it. Bodies are prose, hard-wrapped near eighty columns,
and they argue: what was believed, what turned out false, what the fix costs.

**Branches** are `<track>/<slug>`. Four tracks are in use — `product/` for a shipped surface,
`direction/` for work following a direction update, `agent/` for work an agent drove end to end, and
`unit<N>/` for a numbered slice off a product branch. Match the nearest rather than inventing a fifth.

**Pull request bodies** carry what changed, in the register of a commit subject; the ADR or issue it
answers, linked; and what you did **not** do, plus what is now reachable that was not. That last half
is the one that gets lost, and it is what `tests/reachability.test.ts` is about.

**Say the true thing, including when it is unimpressive.** This applies to a status table and a pull
request description as much as to the product. Understating what the product does is still saying a
false thing about it.

Prose in this repository uses British spelling — `serialisation`, `authorise`, `honour`.

## Style

There is no formatter. **Match the file you are editing:** no semicolons, single quotes, two-space
indent. Docblocks explain the decision and then state what it does **not** cover — that habit is the
house style and the most valuable thing in the codebase, because a guard whose limit is unstated reads
as a stronger promise than it is.

Two shapes that are easy to get wrong:

- **Failures are values, never exceptions**, at every seam — `ActionResult<T>`, `BoundaryResult<T>`,
  `Admission`, `Authorization`, `AppendResult`, `ConnectionResult`, `DriftCheck`. An exception thrown
  across the server-action boundary arrives client-side as an opaque digest, and one thrown through the
  worker loop turns a recoverable boundary failure into a dead run.
- **`exactOptionalPropertyTypes` and `verbatimModuleSyntax` are on.** Optionals are set by conditional
  spread — `...(x === undefined ? {} : { x })` — and every type-only import needs `import type`.

Prisma reports an append-only trigger abort as **P2003, "Foreign key constraint violated"**, which is
wrong. Go through `guarded()` in `src/persistence/errors.ts` or the error will say the wrong thing.

`src/server/actions.ts` and `src/persistence/repositories/index.ts` are the two largest and hottest
files. Expect conflicts, rebase early, and keep unrelated changes out of them.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `smukhyala/propositum`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.
Work is tracked from the [wayfinder map](https://github.com/smukhyala/propositum/issues/1).

### Triage labels

The five canonical triage roles, using their default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Subagents and skills for this repo

`.claude/agents/` holds reviewers that already know the rules above — `propositum-reviewer` (the guards
and the principles), `vocabulary-auditor` (`CONTEXT.md` and the banned table), `stale-claim-hunter`
(claims in the docs that the code has outgrown), and `privacy-boundary-reviewer` (what a change newly
lets Propositum see).

`.claude/skills/` holds the workflows — `write-adr`, `wayfinder`, `house-voice`, `wire-a-capability`
and `run-eval`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
