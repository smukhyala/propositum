# ADR-0039 — A migration history, and a copy taken before it runs

**Status:** accepted · 2026-09-08 — **built the same day.**
`src/persistence/prepare.ts`, `scripts/prepare-database.ts`,
`prisma/migrations/0_baseline/`, `src-tauri/src/preflight.rs`,
`tests/prepare-database.test.ts`
**Amends:** [ADR-0023](0023-the-tray-app-owns-the-runtime.md)'s preflight, which ran `prisma db push`
at every launch · [ADR-0027](0027-a-sealed-bundle-and-where-the-state-moves.md), which moved an
installed copy's database to Application Support and made this file somebody's only copy
**Depends on:** [ADR-0003](0003-artifact-versioning-ledger.md) — the append-only guards, which both
`db push` and `migrate deploy` drop on a table rebuild and which are reinstalled at startup either
way

## The sentence that was never written down

There was no migration story. `prisma/migrations/` did not exist, the tray ran **`prisma db push` at
every launch**, and so did every developer after a pull.

`db push` is a development command. It reconciles the file to whatever `schema.prisma` says and asks
nobody: on an additive change it adds a column, and on a narrowing one it rebuilds the table and the
data in the dropped column is gone. There is no history, nothing that can refuse a destructive
change, and no way to know what version a file on somebody's disk is.

That was survivable while the only database was the author's and every schema change happened to be
additive. **It stops being survivable the moment a stranger installs a `.dmg`**, because the failure
is silent, permanent, and lands on the one copy of work nobody else has. ADR-0027 is what made it
urgent: an installed copy keeps its database in `~/Library/Application Support/Propositum/`, which
is exactly the file a person would not think to copy.

## Decision

**Three steps before anything opens the database, in this order: copy, baseline, migrate.**

1. **A copy of the file first**, kept as the last `BACKUPS_KEPT`, named so it sorts in time order.
   Not a backup product — a file beside the file, and the path printed where a person can see it.
2. **`prisma migrate deploy`** replaces `db push` in the tray's preflight and in a new
   `npm run db:prepare`. Migrations are a directory in git, reviewed like anything else.
3. **A database that predates this is BASELINED** — the baseline migration is marked applied without
   being run — because `migrate deploy` against a `db push` file would try to `CREATE TABLE` over
   tables that exist and die on the first one. On the day this landed that was every database in
   existence, including the author's, so it is the migration path rather than an edge case.

**The decision is split from the doing.** `planFor` in `src/persistence/prepare.ts` is a pure
function over three booleans and decides all three steps; the script performs them. That is not
tidiness: baselining is the one operation here that can destroy something, and it deserved to be a
value a test could hold rather than a branch inside a shell command.

**Tests keep using `db push`**, deliberately. Every temporary database in the suite is built and
thrown away, which is what that command is for.

**Four properties, each a way to get this wrong.**

1. **A file is baselined only when it has our tables AND no history.** Baselining a file that is not
   at the baseline marks a migration applied that never ran, leaving a database missing tables every
   later migration assumes — the one path here that loses data rather than protecting it. A file
   with neither is new; a file with both needs nothing.
2. **Every file that exists is copied, with no exception.** Including one this does not recognise.
   *"I do not know what this is"* is the worst possible moment to decide a copy is not worth taking.
3. **Nothing is ever restored automatically.** A copy is written and its path is reported. Putting
   one back is a person moving a file, deliberately — a product that silently restored a backup is a
   product that can silently lose everything done since it was taken.
4. **The ordering with the append-only guards is unchanged and is still the mechanism.** Both
   commands drop triggers on a table rebuild; the reinstall-and-verify runs once per process inside
   `createDatabase()`, after this has finished. There is no *restart after upgrade* step because
   every launch is one.

## Rejected alternatives

**Keep `db push` and be careful.** The status quo, and it has the merit of having worked so far.
Refused because *being careful* is the thing that does not survive contact with a second person, and
the failure it guards against is invisible: nobody notices a column that stopped existing until they
look for the data that was in it, which is months later, on the one machine that had it.

**`db push` plus a warning when the change is destructive.** `db push` can detect this and refuse
without `--accept-data-loss`. Refused because it answers the wrong half: it protects against a
developer's mistake at the moment of the change, and does nothing for the person whose database is
three versions behind and who never sees a terminal. It also leaves no history, so *which* version a
file is at stays unknowable.

**Migrations without the copy.** The obvious smaller change. Refused because `migrate deploy` on
SQLite can still fail part way through a multi-statement migration, and because the whole argument
for migrations is that this file is irreplaceable — a scheme that agrees it is irreplaceable and
then edits it in place without a copy has not taken its own point.

**A backup product — scheduled, rotated, off-machine.** Refused as the wrong scope and the wrong
posture. Off-machine is a server, which this product does not have and argues against having. What
is needed here is narrow: the file as it was one launch ago.

**Bundling `sqlite3` or using `node:sqlite` to read the file's state.** `node:sqlite` is experimental
in Node 22 and prints a warning on import, which in a bundled launch is a line in the person's log
at every start, for ever, about something working correctly. A raw `sqlite_master` query through the
client we already ship answers the same question, and its rawness is the point — it is one string
sent to SQLite, and a client whose generated types have run ahead of the file cannot make it wrong.

## What this costs

- **Every schema change is now two steps**, and the second is not optional. `prisma migrate dev
  --name <what-changed>` writes a migration; committing a schema change without one leaves a
  database nothing will bring forward. Nothing enforces this yet, which is named under *What would
  hold the line* rather than pretended away.
- **Migration files are append-only in the way ledgers are.** An applied migration must not be
  edited — a changed file is a checksum mismatch on every database that already ran it, and
  `migrate deploy` refuses. Fixing a bad migration means writing another one, which is the same
  discipline as the ADRs and the same discipline as `~~struck~~` prose.
- **A launch is slower**, by a file copy proportional to the database. Measured at ~500KB today,
  which is nothing, and it grows with use. If it ever matters the answer is to copy only when the
  migration list is about to change, and that is a worse trade than it sounds — the copy is most
  valuable exactly when something unexpected is about to happen.
- **The backups are unencrypted copies of an unencrypted database**, sitting beside it. That is not
  a new exposure — the database is already there in the same directory — but it is now five files
  saying what one file said, and a person deleting a project (ADR-0038) does **not** reach into
  them. That last point is a real limit on that decision's promise and is recorded in both places.

## What would hold the line

| | |
|---|---|
| `tests/prepare-database.test.ts` | The three states of a file, and that only a pushed one is baselined |
| `tests/prepare-database.test.ts` | Every file that exists is copied, in every branch |
| `tests/prepare-database.test.ts` | A `db push` database survives meeting migrations for the first time — the slow one, and the path every existing install takes exactly once |
| **Nothing yet** | **That a schema change ships with a migration.** A `prisma migrate diff` against the schema would catch it, and it is not written. `docs/todo/14-migrations-and-a-copy.md` carries it, and until it exists this rests on discipline. |
| **Nothing** | That the Rust in `src-tauri/` compiles — there is no Rust toolchain in the environment this was built in, so the preflight change is verified by inspection against `one_shot`'s signature and by matching the supervisor's existing `tsx` invocation. **First run on a machine with `cargo` is the test.** |
