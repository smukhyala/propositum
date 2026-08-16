# Design — Persistent intentions, and the documents that have to move first

**Date:** 2026-08-16
**Source:** `Propositum_Direction_Update.docx`, archived verbatim at
[`2026-08-16-direction-update-source.md`](./2026-08-16-direction-update-source.md)
**Status:** approved for implementation, 2026-08-16

This is the design. The direction document is the input; this file is what we decided to do about
it, and — more importantly — what we decided **not** to do about it.

---

## The finding that shapes everything below

The repository is further toward the direction document than the direction document assumes. Nine
parallel area surveys found that the gap is overwhelmingly **vocabulary and altitude**, not
machinery:

- Five of the eleven §1 primitives already exist under the direction document's own names:
  `HandoffContract`, `ObservationEvent`, `AgentRun`, `ShiftReport`, `Project`.
- A sixth — Intention — exists **field for field** as `StatedIntent` (objective, definitionOfDone,
  guidance) with the wrong lifetime. Promoting it is a move, not a build.
- Four of the ten §3 layers are built and argued in ADRs: Delegation/Policy, Execution Runtime,
  Verification, Re-entry.
- §2's "Opportunity-to-Help Detection", including its *do not invent work simply to remain active*
  clause, is shipped as `src/domain/detection/grounds.ts` with a regression fixture — an afternoon
  of ordinary reading — that must **not** qualify.
- Several §7 privacy asks are met in stronger form than requested. "Separate state inference from
  action authorization" is a **compile error** here, proved by eight `@ts-expect-error` directives,
  not a review note.

So this is not a rewrite. It is one ADR, five documents, two new documents, one table, and three
small pieces of wiring that were already half-built.

---

## The three obstacles, and how each is answered

These are the reason this work needs a design document rather than a checklist. All three live in
`CONTEXT.md`, and all three were put there deliberately by someone who had already considered the
thing we are now proposing.

### 1. `Intention` is a banned word

`CONTEXT.md`'s banned-words table reads:

| Banned | Write instead |
|---|---|
| `Intention` as a field or type | prose only — allowed in VISION.md |

And `StatedIntent`'s own *Displaces:* line claims "Intention (as a field)". The word was considered
and refused, twice.

**Answer:** lift the ban, in ADR-0011, with the reversal recorded rather than absorbed. `Intention`
is what the direction document calls it and what VISION.md already calls it in prose; a second
translation layer between the documents and the schema would cost more than the collision does.

**The collision is real and is accepted, not denied.** The runtime is saturated with `intent`:
`ActionIntent`, `intentId`, `recordIntent`, `AuthorizedAction.intentId`, `orphanedIntentIds`,
`PlanStep.intent`. `intentId` is additionally the browser channel's idempotency key. Every one of
them stays exactly as it is. Renaming `intentId` → `actionIntentId` would touch the append-only
ledger's hottest path and a pinned wire protocol, which is a large risky diff for a naming win.
ADR-0011 says this in its own voice, so the next reader finds the argument rather than re-derives it.

### 2. The corpus contains an argued refusal of the direction's central claim

`CONTEXT.md`, "Known risks this vocabulary does not remove":

> **The objective still does not [survive a session], and must not**: a stale objective inherited
> quietly by the next sitting is worse than a cold read, because nothing on screen would say it had
> been. What carries forward is where the work lives, never what Propositum thinks it is for.

**Answer:** the objection is **invisibility, not persistence**, and it is answered rather than
deleted. An `Intention` is **human-ratified only** — born from words the person typed or edited when
they accepted a handoff, and edited only by a person. No detector writes one. No model boundary
writes one. `SessionClaim{kind:'objective'}` stays exactly as it is: per-sitting, model-inferred,
evidence-bearing, cold every time.

Nothing is inherited quietly, because nothing is inherited by inference at all. The risk entry is
**amended in place with a struck line and a date**, in the convention this document uses fourteen
times, and the amendment says which half of the original ruling survives — the half about silent
inheritance, which is now enforced by construction.

### 3. `WorkingAgreement` is spent twice

`CONTEXT.md:492` lists `WorkingAgreement (as a type name)` among the names `HandoffContract`
*displaces*. `CONTEXT.md:493` makes "Working agreement" `HandoffContract`'s **consumer label**,
rendered in seven places across `src/ui/agreement.tsx`, `src/ui/reading.tsx`, `src/app/page.tsx`,
`src/app/start/page.tsx` and the README.

**Answer:** reserve the name, defer the object. Standing agreements are in §8's *do not build yet*
shadow anyway. `CONTEXT.md` records the reservation so nobody spends the word a third time,
`ARCHITECTURE.md` documents the durable layer as UNIMPLEMENTED, and **no UI copy changes**.

---

## Decisions taken without asking

Recorded here so they can be overturned deliberately rather than discovered.

### Computer use: the repository wins, not the direction document

Direction §4 lists Computer Use as *Later — fallback when structured APIs are unavailable*. This
repository shipped it as **Now** on 2026-08-11 (ADR-0010), and VISION.md documents the reversal under
a heading called *The honest cost of moving this line*.

Applying §4 literally would write a false capability claim **backwards** into a document that
already carries a struck-through `~~Now. None.~~`, and would undo SECURITY_AND_PRIVACY.md's rewritten
capability section. That is a direct violation of PRODUCT_PRINCIPLES §11, *Say the true thing,
including when it is unimpressive* — in the rare inverted form where the untrue thing is the
**modest** one.

The direction document is behind the repository here, not ahead of it. What §4 actually gets right
is the **preference ordering** — native APIs, then structured integrations, then browser DOM, then
visual computer use — and that ordering is already honoured and already stated in VISION.md.
`ARCHITECTURE.md` records computer use as the fallback tier under structured APIs and notes the
tension explicitly rather than resolving it silently in either direction.

### `IntentionState` is a computed view with five members, not a stored column with six

Repo precedent is unanimous and written down: `EnforcedPolicy`, `Shift` and `ActionStatus` are all
computed views, on the argument that *two stores for one truth is exactly how a UI comes to display
something the gate cannot enforce*. Every fact the lifecycle states derive from already exists as a
durable row.

Direction §1's lifecycle has six states. `waiting` means *progress depends on an external event or
dependency*, and **nothing in this system can produce an external event** — `ExternalEvent` is on
§8's do-not-build list, and `ObservationEvent.sessionId` is required with a single ledger writer, so
no event outside a sitting can be persisted at all.

Five members ship: `working`, `delegated`, `needs-you`, `sleeping`, `done`. `waiting` is documented
in `ARCHITECTURE.md` as the state that arrives with event ingestion, and is **not** declared in the
union. An enum member nothing can reach is exactly the kind of thing this repository writes down
instead of shipping.

### No `UBIQUITOUS_LANGUAGE.md`

Direction §9 names one. `CONTEXT.md` **is** that file, and `docs/agents/domain.md` routes every
skill-driven agent session to it by path. Creating a second glossary would split the single context
the repo is built around and silently downgrade the first one.

### `Blocker`, `Dependency` and `ProgressEvent` are not added as terms

Direction §1 lists them. `DecisionNeeded`'s *Displaces:* line already explicitly retires the words
*blocker* and *escalation* — introducing `Blocker` would be a vocabulary **reversal**, not an
addition, and it would need its own argument that nobody has made. `Dependency` and `ProgressEvent`
have nothing that can produce them. All three belong in `ARCHITECTURE.md` marked UNIMPLEMENTED.

---

## Scope: what changes now

Direction §8 draws the line and this design does not move it. Three additions are permitted and
exactly three are made:

1. `Intention` above `WorkSession` in domain language.
2. `Project` and `WorkSession` attachable to an `Intention`, without a graph system.
3. Minimal desired outcome, definition of success, and lifecycle state.

Plus §8's two wiring clauses, both of which turn out to be half-built already: *keep model/provider
interfaces abstract and workers replaceable*, and *record action outcomes and user accept/edit/reject
decisions as structured feedback*.

### What does not get built, and where it goes instead

§8's ten-item do-not-build list is **pasted into `MVP.md`'s Out of scope table** in that table's own
`| Excluded | Why | Where |` format. It currently has nowhere to live, and a list with nowhere to
live gets re-litigated by the next reader.

Two items on it are additionally blocked by structure, which is worth stating because it means they
cannot be built by accident: `ObservationEvent.sessionId` is required with a single ledger writer, so
**no event outside a sitting can be persisted at all**; and `Blocker` is a word `CONTEXT.md`
deliberately displaced.

### The one vertical slice

Per §12 — *after the docs are consistent, compare the codebase against the revised MVP and implement
only the next smallest missing vertical slice.*

One **mutable** `Intention` table, by the same reasoning already written down for `Project`: it holds
no inference and carries no provenance, so nothing about it is append-only. **No triggers, no
`REQUIRED_GUARDS` entry, no `triggers.sql` edit, no entry in `tests/append-only.test.ts`'s
hand-maintained checklist.** This sidesteps the four-coordinated-edits problem entirely.

Two **nullable** foreign keys — `WorkSession.intentionId`, `HandoffContract.intentionId` — so every
existing row, fixture and test keeps working with no backfill.

One repository, one pure `intentionState()` function, one writer at the accept-offer path, one
round-trip test.

---

## Architecture: the ten layers, honestly marked

`ARCHITECTURE.md` is a new file and is the single largest risk in this work, because the failure mode
is inflation. The mitigation is structural: **each layer carries its own Now/Later marker**, rather
than one caveat at the top. This corpus marks every individual claim; a flat layer list under a
blanket disclaimer would be the first document in it to break that convention, and the most quotable
one.

| Layer | Status | Owned today by |
|---|---|---|
| Intention Graph | **partial** — one flat table, no graph | `Intention` (this slice) |
| State Ingestion | **partial** — one sensor, browser only | `ledger-writer.ts`, the MV3 extension |
| State Reconciler | **partial** — `matchProject` only | `src/domain/detection/match-project.ts` |
| Progress Reasoner | **partial** — offer grounds, no ranking | `src/domain/detection/grounds.ts` |
| Delegation / Policy | **built** | `compilePolicy` + the gate, ADR-0004/0006 |
| Worker Router | **unimplemented, and not being built** | — (§8 forbids; ADR-0005 agrees) |
| Execution Runtime | **built** | `runWorker`, ADR-0001/0010 |
| Verification | **built, and near-decorative** | `scopeVerdict` + reviewer |
| Outcome / Learning | **data built, nothing reads it** | three verdict tables, append-only |
| Re-entry | **built** | `ShiftReport`, ADR-0003 |

Two disambiguations belong in the first paragraph of that file, because both words are already taken:
**"worker"** already means `AgentRun.role` and `npm run worker`; **"router"** must not be read as
Next.js routing.

---

## Workstreams

Ten, partitioned by **file ownership**. Two workstreams that both edit `CONTEXT.md` are not parallel,
so exactly one owns it.

### Wave 1 — documents and independent copy (parallel, no file overlap)

| # | Sole owner of | Deliverable |
|---|---|---|
| 1 | `docs/adr/0011-*.md`, `CONTEXT.md` | **Keystone.** ADR-0011 + the CONTEXT.md edits it authorises |
| 2 | `docs/VISION.md`, `docs/PRODUCT_PRINCIPLES.md` | Reframe + four principles, each with a **Forbids:** line |
| 3 | `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `README.md`, `AGENTS.md` | Two new files, two hygiene fixes |
| 4 | `docs/MVP.md`, `docs/EVALUATION.md` | Scope-preserving reframe |
| 5 | `docs/SECURITY_AND_PRIVACY.md` | Trust versus authorization |
| 6 | `src/app/start/page.tsx`, `src/ui/confirm.tsx`, `src/app/layout.tsx` | Three consumer-copy fixes |

Workstream 1 is the keystone but **not a blocker for the other document workstreams**: `Intention` is
already permitted as prose in VISION.md by the very banned-words row being amended. Wave 1 agents all
cite ADR-0011 by number, which is why the number is fixed here rather than chosen at write time.

### Wave 2 — the vertical slice (sequential; sole owner of the shared files)

Workstream 7 owns `prisma/schema.prisma`, `src/persistence/repositories/index.ts` and
`src/server/actions.ts` for its duration. No other code workstream runs concurrently.

### Wave 3 — three follow-ons (sequenced by file ownership, not by dependency)

| # | Deliverable | Why it is §8-permitted |
|---|---|---|
| 8 | Home surfaces what is waiting on the person | makes the Intention visible; no new capability |
| 9 | Model provider factory + `ModelCallRecord` gets its first caller | §8: *keep interfaces abstract*; explicitly **not** a router |
| 10 | Trajectory reader; `scoreH2` gets its first caller | §8: *record outcomes as structured feedback* |

Workstreams 9 and 10 are each fixing something already found and worth naming: `modelCallRecord`
appears **nowhere** in `src/` or `scripts/` — the table exists with all three append-only triggers
installed, `onCall` is declared and never passed, and every call's model, latency, tokens and failure
kind is computed and discarded. And `scoreH2`/`H2Tally` have **no production caller**, which means
the MVP's own H2 acceptance metric is not currently computable from the database.

---

## Landmines every workstream is briefed on

Discovered during evaluation. Each one is a green-looking failure.

1. **`prisma db push` silently drops append-only triggers** on any table it rebuilds. Exit code 0, no
   warning. `ensureAppendOnlyGuards` reinstalls at the *next* app startup, so the window is invisible.
   Both the app and the worker restart after any schema change, and neither writes in between.
2. **`tests/reachability.test.ts` contains a *deferred, and asserted as deferred* block** that asserts
   named capabilities are **still unwired** — `callersOf(...)` must equal `[]`. Currently pinned:
   `shiftReportBoundary`, `sweepForGap`, `controlLost`, `modelCallRecord.create`, `findings.forRun`,
   `confirmations.create`, `createBrowserControl`. Wiring one turns the suite red **by design**, and
   the correct fix is to **relocate the claim into the reachable section, never delete it**.
3. **Two type-test files end in `-test.ts`, not `.test.ts`**, so vitest skips them entirely.
   `npm run typecheck` **is** the assertion — each `@ts-expect-error` fails typecheck when the line it
   guards becomes legal. Widening anything intention-shaped can pass `npm test` cleanly and fail only
   under typecheck. **Both commands, always. Neither is a superset of the other.** There is no lint
   script, no ESLint config and no CI: every invariant is enforced only when someone types both.
4. **`tests/architecture.test.ts` enforces layering by grepping source text**, and fails with messages
   about the product rather than about your change. Live traps: `src/domain/**` may import nothing
   from app/model/persistence/policy, may not call `fetch` or `node:fs`, and may **never** call
   `Date.now()` or `new Date()` — so `src/domain/intention/state.ts` takes `now` as a parameter.
5. **Tests cite documentation by path and section in comments but never read those files.** Editing a
   cited sentence leaves a **green** test whose comment now describes a document that no longer says
   that. The repo already has one such case and documents it twice. Every document workstream
   re-checks the tests that quote the sentence it edits.
6. **`references.lock.json` holds a SHA-256 per sealed eval reference** and the harness refuses to
   score a scenario whose reference changed. The sanctioned escape is to **add** a scenario, never to
   edit one. No workstream touches the harness, the scenarios or the lock file.
7. **The offer/detection signature is unstable.** `signatureOf(terms)` is documented flapping A→B→A
   across three polls, yet it keys six things including the durable `WorkOffer.threadSignature`. The
   Intention's identity is derived independently; `matchProject` does the joining.
8. **One live session at a time is enforced in the app layer, not the schema**, and one acting run at
   a time is load-bearing in the browser channel. A Home listing several `working` intentions would
   look right and be unable to start the second one.
9. **`GUARDED_TABLES` in `errors.ts` is already stale** — it names 7 tables while 13 are guarded, so a
   trigger firing on six of them still surfaces as Prisma's P2003 "Foreign key constraint violated"
   lie. Not this work's job to fix; this work's job is not to add a fourteenth.

---

## Verification

Baseline, measured 2026-08-16 before any change: **1028 tests across 40 files pass in 14.5s;
`tsc --noEmit` clean.**

Every workstream returns to that bar. Both commands, every time:

```
npm test && npm run typecheck
```

Document-only workstreams run them too — `tests/architecture.test.ts` and
`tests/reachability.test.ts` both grep source text, and workstream 6 edits three `.tsx` files.

---

## What this design deliberately does not claim

The direction document's destination is an intention control plane coordinating human and AI progress
across events, tools and devices. After this work lands, Propositum will have **one flat table, one
sensor, one worker, one reviewer, and a lifecycle word computed from rows that already existed.**

That is the honest description, and it is the one the documents will carry. The gap between it and
the destination is written into `ARCHITECTURE.md` and `ROADMAP.md` as layers marked unimplemented —
not because the ambition is doubted, but because this corpus's most valuable property is that a
reader can tell the two apart, and that property is easier to keep than to recover.
