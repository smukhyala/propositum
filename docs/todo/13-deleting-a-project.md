# 13 — Deleting a project, and letting ~~thirteen~~ fourteen ledgers lose a guard

**Status:** ~~not started — decided, not built.~~ **Done 2026-09-08, the same day the ADR was
accepted.** `deleteWithEverything` in `src/persistence/repositories/index.ts`, `deleteProject` in
`src/server/actions.ts`, *Delete this project* on the project screen, and
`tests/delete-project.test.ts`. Everything below is struck rather than deleted, per the rules at the
top of [`AGENTS.md`](../../AGENTS.md).

**Three things it found that this file did not predict**, and the second is the one worth reading:

1. **The count was thirteen and it was fourteen.** `external_event` arrived from ADR-0034 the same
   day and both this file and the ADR took the count without it.
2. **A mis-ordered delete does not fail — Prisma nullifies the child.** `PRAGMA foreign_keys` is on,
   but for an optional relation Prisma's default is `SetNull` and it performs that itself, so a bad
   cascade quietly edits rows it does not own rather than aborting. The order below is load-bearing
   for that reason and not for the one written here. ADR-0038 now carries the measurement.
3. **The delete needed a refusal nobody asked for.** A sitting in another project naming this
   project's Intention would be silently detached; it now throws before the transaction opens.
**Decided by:** [ADR-0038](../adr/0038-deleting-a-project.md), accepted 2026-09-08
**Blocked by:** nothing in code, and nothing in judgment. This is the one file in this folder that
makes the product **safer** rather than less safe — [`06`](./06-buying-things.md),
[`07`](./07-off-the-browser.md), [`08`](./08-one-time-codes.md), [`10`](./10-the-mailbox.md) and
[`11`](./11-calendar-holds.md) all widen what Propositum may do, and this narrows what it keeps
**Blocks:** an export flow, if one is ever wanted. *Take it with me* and *delete it* are one act in
the order they should run

## Is this already done?

```bash
# 1. the path itself
grep -rn 'deleteProject\|projects.delete' src/
# 2. the guards that have to move — expect three per table today, two after
grep -c "observation_event_no_delete\|action_intent_no_delete" src/persistence/append-only.ts
# 3. the test that would exist
ls tests/delete-project.test.ts 2>/dev/null
```

~~**As of 2026-09-08 grep 1 and check 3 return nothing, and grep 2 returns 2** — the guards are all
still there. When grep 1 returns code, this file is stale and the striking rules at the top of
[`AGENTS.md`](../../AGENTS.md) apply.~~

**Later the same day: grep 1 returns code, check 3 lists the file, and grep 2 returns 0.** Which is
what done looks like here. Note that grep 2's expectation — *"expect three per table today, two
after"* — was written against the wrong subject: it counts trigger NAMES in `append-only.ts`, and
the delete guards are gone from that list entirely, so it prints `0` rather than the `2` this file
predicted. The command was right and the sentence beside it was not.

## Blocked by

Nothing. The cascade order is knowable from `prisma/schema.prisma`, the delete is a server action of
the shape `renameProject` already has, and the guard change is a line per table in
`REQUIRED_GUARDS` and a block per table in `prisma/triggers.sql`.

**One judgment call is worth making before the code**, and it is not a blocker: whether a person
deleting a project should be offered an export first. ADR-0038 refuses to attach one, deliberately,
so that deletion does not wait on it — but if export is close, doing them together is better than
doing them in this order.

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| 1 | **Decide the confirmation wording.** ADR-0038 says the screen names what goes — how many sittings, documents and recorded actions. Somebody has to write that sentence, and it is the whole of what makes the act reviewable | minutes |
| 2 | **Delete a real project on your own machine and check the file shrinks.** The one part nothing can assert: that the rows are gone rather than orphaned | minutes, after the build |

## The work

In this order. Steps 1 and 2 change no behaviour and are separately revertible.

1. **The guards, from three to two.** Remove `*_no_delete` from `REQUIRED_GUARDS` and from
   `prisma/triggers.sql` for the thirteen tables a Project owns. **Keep the `DROP TRIGGER IF EXISTS`
   line** for each — `action_evidence` sets that precedent and states the reason: a database created
   before the change is corrected at startup rather than left with a delete that works on one
   machine and fails on another. `tests/append-only.test.ts` asserts two per table and asserts that
   no-`UPDATE` and no-`REPLACE` are still both present.
2. **The cascade, in one transaction.** Order it from the leaves in. `ExternalEvent` hangs off
   `Intention` rather than `Project`, so it goes before the Intention does — that is the thing
   ADR-0034 could not answer alone and the reason `onDelete: Restrict` stops being a refusal and
   becomes an ordering constraint.
3. **The server action and the screen.** One caller, human-reached, on the project screen beside the
   rename. The confirmation names the counts. `tests/reachability.test.ts` pins the caller at one.
4. **`tests/delete-project.test.ts`** — all-or-nothing on failure, and no orphaned Intention
   produced. There is already one orphan in the author's own database, made while verifying
   ADR-0034's retention finding; this path must not make more.
5. **The documents.** `SECURITY_AND_PRIVACY.md`'s *Retention and deletion* section, which currently
   says everything stays until you delete the file — that sentence is the one this work changes, and
   it was only corrected into truth on 2026-09-07. `CONTEXT.md`'s `Project` entry gains the fact
   that a person may delete one. `AGENTS.md`'s invariant list, if the append-only line there names
   a count.

## Done when

- `grep -rn 'deleteProject' src/` returns exactly one production caller, and
  `tests/reachability.test.ts` says so.
- Deleting a project removes its sessions, events, documents, contracts, runs, ledgers and Intention
  — and its `ExternalEvent`s — leaving no orphan.
- An `UPDATE` on any of those tables is **still refused**. The delete guard went; the other two did
  not.
- A failed delete leaves everything.
- `npm test`, `npm run typecheck` and `npm run build` are green.

## What this does not cover

- **Export.** A separate feature and a separate file. ADR-0038 refuses to attach it so that deletion
  does not wait on it.
- **Per-row, per-session or per-event deletion.** Refused by ADR-0038 and the refusal is the point:
  a ledger you can remove one line from is a ledger you can rewrite by subtraction.
- **Undo, archive, or a bin.** Refused for the same reason — a row that says *deleted* is not
  deleted, and it is strictly more than was there before.
- **Anything about the eval corpus.** A person deleting a project deletes measurements with it.
  ADR-0038 records that as a cost rather than solving it, and the trigger for solving it is somebody
  watching a number move for a reason they cannot reconstruct.

## What would make this deletable rather than done

Nothing. This is the one file here that closes a gap between what the product promises and what it
does, rather than adding a capability — and the promise it closes was struck into honesty on
2026-09-07 rather than being met.
