# ADR-0003 — Artifacts, versioning, and the append-only ledger

**Status:** accepted · 2026-08-06
**Ticket:** [#12](https://github.com/smukhyala/propositum/issues/12)
**Research:** [`markdown-diff-review.md`](../research/markdown-diff-review.md) ·
[`append-only-persistence.md`](../research/append-only-persistence.md)

## Context

Two promises meet in this schema. *Every change is reversible* needs an immutable base and a
decision trail. *Every action is inspectable* needs a ledger nothing can quietly rewrite. Both are
load-bearing for the trust model, and both are easy to implement in a way that looks right and
isn't.

## Decisions

### 1. Review produces decisions, never documents

The base stays immutable. The worker returns **prose**, not patches, and deterministic code diffs
it against the base to produce a `Changeset` of `ProposedChange`s. The human's `ChangeVerdict`s are
stored; a document is `materialise(base, changes, decisions)` — a pure right-to-left fold.

This is "models propose, deterministic code authorizes" applied to editing: **the model never
asserts what changed, only what the text should say.**

It also dissolves the addressing problem. Accepting change 3 would shift changes 4..n *if* review
mutated a document — but it doesn't, so character offsets into the base are stable by construction
and per-change accept/reject needs no clever anchoring. Google Docs works this way: its three
suggestion view modes are one document under three decision maps.

**Heading-path addressing was rejected.** It cannot distinguish two changes inside one section, and
renaming a heading is a likely edit in a proposal document — so the anchor breaks precisely when
the worker does its job well.

### 2. Full snapshots, not diffs, not git

A `DocumentVersion` holds complete content. For a local single-user Markdown document the bytes are
irrelevant, and a base readable without replaying a chain is worth far more.

Content is normalised to **one sentence per line** so diffs land on sentences rather than
paragraphs. Sentence splitting uses `Intl.Segmenter`, **never jsdiff's `diffSentences`** — its
entire rule is `.`/`!`/`?` plus whitespace, and "e.g.", "Inc." and "$1.5M" shred it.

### 3. `ActionRecord` splits in two

The founding brief defines it as "an append-only record of an action, its reason, its result, and
its verification status." That cannot hold as one row: the reason exists **before** the action, the
result **after**. One row forces an `UPDATE`, which append-only forbids.

`ActionIntent` is written and **committed before any effect**. `ActionOutcome` follows. A run that
dies mid-action still shows what it was attempting — which is exactly when the audit story matters.

A **refusal** is an `ActionIntent` with `authorized = false`, a deterministic `refusedRule`, and no
outcome. Refusals are queryable because they are evidence about H3.

`ActionStatus` is derived, never stored.

### 4. The document is never locked

The human is never blocked from their own document. Their edit creates a new `DocumentVersion`;
when the `Shift` returns, `Changeset.baseHash` no longer matches and the whole changeset is refused.
**The human's own edit always wins.**

Costs a wasted `Shift` occasionally. Buys two things: the product never tells someone no about their
own file, and — less obviously — a lock would need a release path for the case where a sleep-killed
run holds it with no live holder, possibly for hours. No lock, no hole.

### 5. Append-only is enforced by triggers, verified at startup

**Three triggers per table**, not two. A no-`UPDATE` + no-`DELETE` pair looks sufficient and is not:
`INSERT OR REPLACE` deletes the conflicting row and inserts a new one, but `PRAGMA
recursive_triggers` defaults **off**, so the delete trigger never fires and the row is silently
overwritten. The third is a `BEFORE INSERT` guard on the conflict.

**Reinstalled and verified at every startup.** Prisma's SQLite `render_redefine_tables` path does
`DROP TABLE` + rename and recreates **indexes only** — it implements the `CREATE INDEX` third of
SQLite's table-rebuild procedure and omits `CREATE TRIGGER`. Exit code 0, data intact, no warning,
and the destructive-change checker has no concept of triggers.

So any dropped column, changed column, added required column, PK or FK change silently removes
every guard. **The mechanism meant to prevent a quiet break is itself quietly breakable** — which
is why it is a runtime invariant, not a migration artifact, and why `ensureAppendOnlyGuards()`
throws rather than warns. A database that accepts an `UPDATE` on the ledger is worse than an app
that will not boot, because the first one is silent.

`REQUIRED_GUARDS` in `src/persistence/append-only.ts` is the specification; `prisma/triggers.sql`
is the implementation; the verify step checks one against the other, so adding to one without the
other fails at startup rather than leaving a table unguarded.

Guarded: `observation_event`, `action_intent`, `action_outcome`, `model_call_record`,
`change_verdict`, `document_version`. Plus `handoff_contract`, frozen once `accepted`.

Deliberately unguarded: `agent_run` (the claim target — a claim *is* a mutation), and
`session_reading` / `session_claim` (the human edits these before ratifying).

## Two traps found while building this

**Prisma reports trigger aborts as foreign-key violations.** SQLite raises
`SQLITE_CONSTRAINT_TRIGGER` (1811) carrying our message; Prisma's ORM maps it to **P2003, "Foreign
key constraint violated"**, and the message is lost. It is inconsistent — `observation_event`
surfaces the true message, while `document_version` and `handoff_contract`, both FK targets, get
remapped.

Every guard still holds and data is untouched; only the diagnosis is wrong. But "foreign key
constraint violated" on an append-only table sends you hunting a relation bug that does not exist.
Tests assert **rejection plus unchanged data**, never the message. A repository layer should re-map
P2003 on these tables back to something honest.

**Prisma emits `BEGIN IMMEDIATE`** for both interactive and batch `$transaction` (6.19.3, verified).
The run-claim path needs no raw SQL. Had it been deferred, a read-then-write would fail with
`SQLITE_BUSY_SNAPSHOT`, which the busy timeout does not retry.

## No enums

Prisma enums are Postgres/MySQL only. Every closed set is a `String`, with members listed in a
schema comment. **The Zod schema in `src/domain` is the constraint; the comment is documentation.**

This lines up with what [#3](https://github.com/smukhyala/propositum/issues/3) verified about
model-facing schemas — `enum` does not survive schema transformation either, so a closed set is
enforced by our code at both boundaries, never by the platform.

## Provenance: one sentence traced back to its event

The walkthrough the ticket asks for. Given a sentence in the reviewed draft:

```
ProposedChange.replacement          the sentence
  └── changesetId → Changeset       which Shift proposed it
        ├── baseVersionId           what it was written against
        ├── baseHash                and whether that base still holds
        └── contractId → HandoffContract
              ├── objective / definitionOfDone     what it was for
              ├── approvedSourceIds                what it was allowed to read
              └── readingId → SessionReading
                    └── SessionClaim[]             what we believed
                          └── Evidence[]
                                ├── eventId → ObservationEvent   what you actually did
                                └── quote                        verified against that event

ActionIntent  (runId + kind='draft-section' + reason)   why it acted
  └── ActionOutcome.draftText                            what it produced
        └── scopeVerdict                                 whether it stayed in bounds
```

Every hop is a foreign key. No step requires a model to be truthful about its own history, because
no step is model-authored — `ObservationEvent`s are never minted by a model, and `Evidence` quotes
are verified against the cited event's stored text or **counted as fabricated**, which is itself an
H1 datum.

## Consequences

- 20 tables. Large, but each is a `CONTEXT.md` term; nothing here invents a name. Terms marked
  *computed view* deliberately have no table: `EnforcedPolicy`, `Shift`, `ExecutionPlan`,
  `ActionStatus`.
- `ProposedChange` carries a W3C-style `prefix`/`exact`/`suffix` anchor alongside offsets. With
  refuse-on-drift these are belt-and-braces — if the base hash matches, the bytes are identical —
  but they make a corrupted changeset detectable rather than silently misapplied.
- `SessionReading.throughSeq` records the highest event the reading saw, making it reproducible and
  telling the eval exactly what input produced it. `isReference` marks blind references.
- `ModelCallRecord` is separate from `ActionIntent`. A model call is not an action the person
  authorized, and the ledger they *read* must not list them.
- Refuse-on-drift means a wasted `Shift` is a normal outcome. The shift report must explain it in
  those terms, not as an error.

## Revisit when

- A second content type appears — that is when `Document` earns a supertype, and not before.
- Documents grow large enough that full snapshots hurt. Unlikely for prose.
- A repository layer is built: fold the P2003 re-mapping into it.
