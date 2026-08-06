# Enforcing append-only persistence with Prisma + SQLite

Research for [#8](https://github.com/smukhyala/propositum/issues/8). Feeds [#12](https://github.com/smukhyala/propositum/issues/12) (artifact, versioning and ledger model).

Environment assumed throughout: local-first, single-user, macOS, Node 22.22.2, npm, Prisma 7.x (`prisma@7.9.1` is latest as of 2026-08-06), SQLite via `@prisma/adapter-better-sqlite3`.

Claims below are marked **[verified]** when I ran them or read them in a primary source, and **[inferred]** when I reasoned to them without direct confirmation. Anything I could not settle is in [Open questions](#open-questions).

---

## The question

`ObservationEvent` and `ActionRecord` are supposed to be immutable. The audit story — "every action carries a reason, a result, and a verification status, append-only" — rests entirely on that. The ticket's framing is the right one: *application-level discipline is not enforcement*. So the question is not "how do we write append-only code" but:

> **What makes an `UPDATE` on `ActionRecord` actually fail?**

And, one level deeper, the question that turns out to matter more:

> **What makes that failure keep happening six months from now, after the schema has changed three times?**

The second question is where this research landed somewhere I did not expect. Short version: the mechanism that gives you real enforcement (a SQLite trigger) is silently destroyed by Prisma's own migration path for SQLite, with exit code 0 and no warning. Details in [How triggers survive Prisma migrations](#how-triggers-survive-or-do-not-survive-prisma-migrations).

### Threat model, stated honestly

This is a single-user local-first app. The user owns the machine, the file, and the process. **There is no cryptographic or OS-level defence against the machine's own owner**, and any document that implies otherwise is selling something. What we are actually defending against, in descending order of realism:

1. **A future refactor** — someone (or an agent) adds `prisma.actionRecord.update({...})` to fix a bug, and nobody notices the audit guarantee died. This is the threat the ticket names and it is by far the most likely.
2. **A careless tool** — Prisma Studio, a stray `sqlite3` session, a seed script, a migration.
3. **Silent corruption** — a crash mid-write, a partial record, a lost commit after power loss.
4. **Deliberate tampering by the user**, then presenting the ledger as trustworthy to someone else. Only *detectable*, never *preventable*, in a local-first design.

Rank mechanisms against (1) and (2) — that is where enforcement earns its keep.

---

## Enforcement mechanisms ranked by bypass difficulty

Ranked hardest-to-bypass first. Each entry names the specific bypass, because a mechanism whose bypass you cannot name is a mechanism you do not understand.

### Tier 3 — enforced by the database engine, for every process

#### 1. SQLite `BEFORE UPDATE` / `BEFORE DELETE` / `BEFORE INSERT`-replace triggers with `RAISE(ABORT)`

The strongest thing available. SQLite evaluates triggers itself, so they hold for *every* connection: Prisma, Prisma Studio, the `sqlite3` CLI, DB Browser, a Python script, a future refactor, an agent with a shell.

```sql
CREATE TRIGGER IF NOT EXISTS "ActionRecord_no_update"
BEFORE UPDATE ON "ActionRecord"
BEGIN SELECT RAISE(ABORT, 'ActionRecord is append-only'); END;

CREATE TRIGGER IF NOT EXISTS "ActionRecord_no_delete"
BEFORE DELETE ON "ActionRecord"
BEGIN SELECT RAISE(ABORT, 'ActionRecord is append-only'); END;

-- Required. See the INSERT OR REPLACE hole below.
CREATE TRIGGER IF NOT EXISTS "ActionRecord_no_replace"
BEFORE INSERT ON "ActionRecord"
WHEN EXISTS (SELECT 1 FROM "ActionRecord" WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'ActionRecord is append-only'); END;
```

**[verified]** against system SQLite 3.51.0 on macOS. `UPDATE`, `DELETE ... WHERE`, `DELETE FROM t` with no `WHERE`, and `INSERT ... ON CONFLICT DO UPDATE` all abort with `SQLITE_CONSTRAINT (19)`.

Two non-obvious results worth recording:

- **`DELETE FROM t` with no `WHERE` still fires the trigger.** SQLite has a "truncate optimization" that erases a table without visiting rows, but the docs state it applies only "when the WHERE clause and RETURNING clause are both omitted from a DELETE statement **and the table being deleted has no triggers**" ([lang_delete.html](https://www.sqlite.org/lang_delete.html)). Having the trigger disables the optimization, which is exactly the behaviour we want. **[verified]**

- **`INSERT OR REPLACE` bypasses a naive two-trigger design.** This is a real hole. Per [lang_conflict.html](https://www.sqlite.org/lang_conflict.html), REPLACE deletes conflicting rows, and delete triggers fire *only if recursive triggers are enabled* — and `PRAGMA recursive_triggers` **defaults to OFF** ([pragma.html](https://www.sqlite.org/pragma.html#pragma_recursive_triggers)). **[verified]** empirically: with only the update/delete triggers installed, `INSERT OR REPLACE INTO "ActionRecord" VALUES ('a1','TAMPERED')` succeeded silently and overwrote the row. Adding the `BEFORE INSERT ... WHEN EXISTS` guard closes it. **[verified]** — and `RAISE(ABORT)` does *not* degrade to a no-op under `INSERT OR IGNORE`; it still aborts.

**Bypasses, named:**

| Bypass | Cost | Realistic? |
|---|---|---|
| `DROP TABLE "ActionRecord"` — drops the table's triggers *before* the implicit delete, "so this cannot cause any triggers to fire" ([lang_droptable.html](https://www.sqlite.org/lang_droptable.html)) | one statement | **Yes — Prisma does this itself.** See next section. |
| `DROP TRIGGER "ActionRecord_no_update";` | one statement, any write connection | Yes, if someone means to |
| `PRAGMA writable_schema=ON; DELETE FROM sqlite_master WHERE type='trigger';` | two statements | Only deliberate. **[verified]** works |
| Swap the whole `.db` file for an edited copy | trivial | Only deliberate |
| Hex-edit the file | moderate | Only deliberate |

`VACUUM`, `VACUUM INTO`, and `.dump`/restore all **preserve** triggers. **[verified]** — so a "compact the database" feature is safe.

**What triggers do NOT give you:** they enforce "nothing written is mutated". They say nothing about "everything that happened was written". A run that crashes before its ledger write leaves no trace, and no trigger can help. That is [transactional integrity](#transactional-integrity-when-a-run-crashes-mid-action), a separate problem.

**One runtime caveat, probably not applicable but worth knowing.** [prisma/prisma#14918](https://github.com/prisma/prisma/issues/14918) (open, Postgres) reports that a `BEFORE INSERT` trigger which *modifies or redirects the inserted row* makes `prisma.x.create()` fail with "Query createOneX is required to return data, but found no record(s)" — Prisma expects its `RETURNING` to come back. The triggers recommended here only `RAISE(ABORT)`; they never rewrite a row, so this should not bite. But if anyone later adds a trigger that populates a column, expect trouble at the Prisma layer. **[not tested on SQLite.]**

#### 2. A DB-enforced hash chain (`BEFORE INSERT` linearity trigger)

Not in the ticket, but it belongs in the ranking because it is the only mechanism that survives its own bypass. Give each ledger row `seq`, `prevHash`, `hash`, and enforce chain linearity in the database:

```sql
CREATE TRIGGER IF NOT EXISTS "ActionRecord_chain"
BEFORE INSERT ON "ActionRecord"
WHEN NEW."prevHash" IS NOT COALESCE(
  (SELECT "hash" FROM "ActionRecord" ORDER BY "seq" DESC LIMIT 1), 'GENESIS')
BEGIN SELECT RAISE(ABORT, 'ledger: prevHash does not match head'); END;
```

**[verified]** — correct-chain inserts succeed; an insert with a stale `prevHash` (a fork, or a backfill) aborts.

This is **detection, not prevention**, and it is worth being precise about why it still matters. If a migration silently drops the no-update triggers (which it will — next section) and some later code mutates a row, the chain no longer verifies, and the app can *tell the user their ledger is no longer trustworthy*. That converts the worst failure mode — silent, undetected loss of the audit guarantee — into a loud one. For an audit log, loud-and-broken beats quiet-and-broken.

Operational note: the trigger reads the current head inside the `INSERT`, so "read head → compute hash → insert" must happen inside **one** transaction. If two appends race, the loser aborts with the chain error rather than forking the chain — which is the correct outcome, but the append path needs a retry. SQLite's single-writer model makes this cheap; it is one more reason not to hold a long interactive transaction open elsewhere.

**Bypass:** recompute the chain forward from the mutated row. There is no secret involved, so this costs a short script. Hashing with an HMAC keyed from the macOS Keychain raises the cost to "extract the key from the Keychain on your own machine", which is not a real barrier either. Do not oversell this. Its value is against accidents and corruption, not against the user.

### Tier 2 — enforced at runtime, but only inside one object

#### 3. Prisma client extension rejecting mutating operations

```ts
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (APPEND_ONLY.has(model!) && MUTATING.has(operation)) {
          throw new AppendOnlyViolation(model!, operation);
        }
        return query(args);
      },
    },
  },
});
```

Real runtime enforcement, and it produces a good error message with a stack trace pointing at the offending call — genuinely better developer feedback than a raw `SQLITE_CONSTRAINT`. But its scope is *the extended client object*, not the database.

**Bypasses, named — and there are more of them than I expected:**

- **Nested writes walk straight past it.** This is the big one, and it is documented by Prisma as a limitation: **"The `query` extension type does not support nested read and write operations."** ([Client extensions — Limitations](https://www.prisma.io/docs/orm/prisma-client/client-extensions)). So a guard on `actionRecord.delete` does **not** fire for `prisma.agentRun.update({ where: {...}, data: { actions: { deleteMany: {...} } } })` — from the extension's point of view that is a single `agentRun.update`. Any relation from a mutable model to an append-only one is an open door. **[verified from docs.]**
- **Raw queries, if you nest the hook wrong.** `$allOperations` at the **top level** of `query` covers model operations *and* raw queries (with `model` arriving as `undefined`). `$allOperations` under **`$allModels`** covers model operations **only**. Writing the `$allModels` form — the natural thing to write — leaves `$executeRaw` completely unguarded. **[verified from docs.]**
- **Even Prisma's own example gets this wrong.** The official [`readonly-client` extension](https://github.com/prisma/prisma-client-extensions/tree/main/readonly-client) blocks `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`, `$runCommandRaw` — but **omits `$queryRaw`**. On SQLite, `DELETE FROM "ActionRecord" RETURNING *` is valid SQL and goes through `$queryRaw`. Its own README says it "is not intended to be used in production environments".
- **A second, unextended client.** `new PrismaClient({ adapter })` without `.$extends(...)` anywhere — a test helper, a script, a seed file. One line.
- Any other process touching the file at all.

Useful as a *fast, friendly* guard layered on top of the trigger — it fails at the call site with a real stack trace. Dangerous as the only guard, because its holes are not the ones you would guess.

### Tier 1 — compile-time only, erased at runtime

#### 4. A narrowed repository type

```ts
interface ActionLedger {
  append(record: NewActionRecord): Promise<ActionRecordId>;
  read(runId: RunId): Promise<ActionRecord[]>;
}
```

Good design. Not enforcement. **Bypass:** import `PrismaClient` directly, or `as any`, or reach through the repository's private field. Cost: one import. The type disappears at `tsc` output.

Note: Prisma offers **no** supported way to generate a client without `update`/`delete` for a given model. `@@ignore` removes the model entirely; `omit` hides *fields from results*, not operations. A `Omit<PrismaClient['actionRecord'], 'update' | 'delete' | ...>` wrapper type is the closest available, and it is still Tier 1. **[inferred from the schema reference; I found no such generator option, but absence is harder to prove than presence.]**

#### 5. An ESLint rule banning `prisma.actionRecord.update`

**Bypass:** `// eslint-disable-next-line`, or `const t = prisma.actionRecord; t.update(...)`, or `prisma['actionRecord'].update(...)`. Cost: near zero. Its real value is *social* — the violation shows up in CI and in a diff, so someone has to consciously decide to suppress it. That raises the cost of an accident from zero to "you typed a disable comment", which is not nothing.

### Tier 0 — not enforcement

#### 6. Convention, code review, a comment saying `// append-only!`

**Bypass:** typing. This is the baseline the ticket correctly refuses to accept.

### The ranking, compressed

| # | Mechanism | Stops accidents | Stops the owner | Survives a migration |
|---|---|---|---|---|
| 1 | SQLite triggers | **Yes, all processes** | No | **No — see below** |
| 2 | DB-enforced hash chain | Detects, doesn't stop | Detects only | Same problem, but detection persists in the data |
| 3 | Prisma client extension | Yes, within one client object | No | Yes (it lives in TS) |
| 4 | Narrowed repository type | Weakly | No | Yes |
| 5 | Lint rule | Weakly, but visibly | No | Yes |
| 6 | Convention | No | No | n/a |

The uncomfortable shape of that table: **the mechanisms that actually enforce are the ones that migrations destroy, and the ones that survive migrations do not actually enforce.** The recommendation exists to fix that.

---

## How triggers survive (or do not survive) Prisma migrations

### Prisma does not model triggers, and this is settled, not pending

Prisma's docs name triggers explicitly in [Unsupported database features](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features):

> "Prisma Migrate uses the Prisma schema to determine what features to create in the database. However, some database features **cannot be represented in the Prisma schema**, including but not limited to: Stored procedures · **Triggers** · Views"

This is not a gap awaiting a fix. [prisma/prisma#26712](https://github.com/prisma/prisma/issues/26712) ("Support for Stored Procedures and sql related features") was **closed as not planned in March 2025** — the most recent team signal I found. The `topic: database triggers` label carries nine issues, none of which is an accepted schema-level feature request. The 2026-08-02 changelog entry announces first-class *partial index* support in Prisma 8; there is no corresponding movement on triggers.

At the source level, the engine's internal schema type has no trigger field at all. `SqlSchema` (`sql-schema-describer/src/lib.rs`) carries `tables, enums, views, procedures, indexes, check_constraints, …` — but **no `triggers`**. And `SqlMigrationStep` (`sql_migration.rs`) enumerates every operation Migrate can emit (`CreateTable`, `DropTable`, `RedefineTables`, `CreateIndex`, `DropView`, …) with **no `CreateTrigger` / `DropTrigger` variant**. Triggers are not merely unrendered; they are unrepresentable in the migration engine's own data model. **[verified by reading the source.]**

### Its SQLite introspection cannot see them either

Prisma's SQLite schema describer reads exactly this from `sqlite_master`:

```sql
SELECT name, type, sql FROM sqlite_master WHERE type='table' OR type='view' ORDER BY name ASC
```

— `schema-engine/sql-schema-describer/src/sqlite.rs`, line 112, `prisma/prisma-engines@main`. Indexes are read separately (`type = 'index'`). **Triggers are never read.** **[verified by reading the source on `main`, last pushed 2026-08-05.]**

This cuts both ways, and both directions matter.

**Good: triggers cannot produce false drift.** Drift detection is `dialect.diff(shadow_schema, live_schema)` followed by `migration_is_empty` (`commands/src/commands/diagnose_migration_history.rs`). Because `SqlSchema` carries no trigger data and `SqlMigrationStep` has no trigger variant, **a trigger can never make that diff non-empty**. Two supporting details, both **[verified by reading the source]**:

- **The SQLite shadow database is in-memory**, not a file — `connect_to_shadow_db()` returns `rusqlite::Connection::open_in_memory()`. No `shadowDatabaseUrl`, no provisioning, no permissions. The docs agree: "SQLite | No special requirements."
- **Migration files are replayed verbatim** into it — `connection.raw_cmd(&script)` over the whole `.sql` file. So a hand-written `CREATE TRIGGER` genuinely runs in the shadow database. Prisma then describes both sides trigger-blind and sees nothing.

Net effect: a trigger committed inside a migration file is **safe from drift**. `prisma migrate dev` will not report it, will not propose dropping it, and will not invalidate the migration. That is a real and reassuring result — the good news in this section.

**Bad:** the migration engine cannot preserve what it cannot see, and the destructive-change checker cannot warn about it. `flavour/sqlite/destructive_change_checker.rs` reasons only about column arity, type casts and row counts; its full warning set is `NonEmptyTableDrop`, `NonEmptyColumnDrop`, `PrimaryKeyChange`, `RiskyCast`, `NotCastable`, `UniqueConstraintAddition`, `EnumValueRemoval`. Nothing about triggers, or about any un-modelled object. **[verified by reading the source.]**

**Also bad, and worth recording as a standing risk: invisibility is a property of the current Prisma version, not a guarantee.** [prisma/prisma#29289](https://github.com/prisma/prisma/issues/29289) (open, Prisma 7.4.2) reports that hand-created *partial indexes* — previously invisible, therefore safe — became visible to the describer in **Prisma 7.4.0** and are now dropped as drift. The reporter's summary is the governing rule for this entire area:

> "Previously, the migration engine did not detect these partial indexes during the shadow database diff, so they were left untouched. After upgrading to Prisma 7.4.0, the engine now detects them and — since they have no corresponding declaration in `schema.prisma` — treats them as drift. […] Partial indexes created via the officially recommended workflow (customizing migrations) are no longer safe across Prisma upgrades."

So: **what the describer sees but the schema does not declare gets dropped as drift; what the describer does not see is left alone — and the boundary between those two categories moved in a minor release.** Triggers sit safely in the second category today. If Prisma ever adds trigger *introspection* without adding trigger *modelling*, append-only guards would go from "silently destroyed by table rebuilds" to "actively proposed for deletion on every migration". The startup-assert-and-verify design recommended below survives that change. A migration-file-only design does not.

Compare [prisma/prisma#13407](https://github.com/prisma/prisma/issues/13407) (open since 2022, manually created partition tables) and [#24180](https://github.com/prisma/prisma/issues/24180) (generated columns + GIN index reverted by the next `migrate dev`) — both objects the describer *does* see. Notably, [discussion #19104](https://github.com/prisma/prisma/discussions/19104) has a user reporting that their generated columns were reverted while **their trigger modifications were not** — independent, user-side corroboration of trigger blindness.

I found **no report anywhere of Prisma emitting `DROP TRIGGER`**, which is consistent with the source: it structurally cannot. I also found **no SQLite-specific report of the table-rebuild collateral described next**. The behaviour is real and reproducible, and appears to be undocumented and unreported.

### The failure: Prisma's SQLite "redefine tables" path drops your triggers, silently

SQLite supports only four native `ALTER TABLE` operations — rename table, rename column, add column, drop column ([lang_altertable.html](https://www.sqlite.org/lang_altertable.html)). Everything else requires the documented 12-step rebuild. Prisma implements that rebuild in `flavour/sqlite/renderer.rs::render_redefine_tables`, and the source comment cites the SQLite page by name:

```rust
// Based on 'Making Other Kinds Of Table Schema Changes' from https://www.sqlite.org/lang_altertable.html,
...
result.push("PRAGMA defer_foreign_keys=ON".to_string());
result.push("PRAGMA foreign_keys=OFF".to_string());
...
    let temporary_table_name = format!("new_{}", tables.next.name());
    result.push(self.render_create_table_as(tables.next, ...));
    copy_current_table_into_new_table(...);
    result.push(format!(r#"DROP TABLE "{}""#, tables.previous.name()));
    result.push(format!(r#"ALTER TABLE "{old_name}" RENAME TO "{new_name}""#, ...));
    for index in tables.next.indexes().filter(|idx| !idx.is_primary_key()) {
        result.push(self.render_create_index(index));
    }
```

Step 8 of SQLite's own procedure — the one Prisma's comment points at — reads:

> "Use CREATE INDEX, **CREATE TRIGGER**, and CREATE VIEW to reconstruct indexes, triggers, and views associated with table X."

**Prisma implements the `CREATE INDEX` third of that sentence and nothing else.** The `DROP TABLE` on the line above takes the triggers with it, and per [lang_droptable.html](https://www.sqlite.org/lang_droptable.html), "Any triggers attached to the table are dropped from the database schema before the implicit DELETE FROM is executed, so this cannot cause any triggers to fire" — so not even the no-delete trigger gets a chance to object.

I ran Prisma's exact emitted sequence by hand against a table carrying the three append-only triggers. **[verified]**:

```
exit code: 0  (no error, no warning)
triggers remaining: <NONE>
data survived:      a1|because ; a2|second
UPDATE now:         -> UPDATE SUCCEEDED
                    a1|SILENTLY MUTATED ; a2|SILENTLY MUTATED
```

The table is fine. The data is fine. The audit guarantee is gone, and nothing anywhere said so. This is precisely the "a future refactor will quietly break it" failure the ticket is trying to prevent — except the refactor doesn't even have to touch the ledger code. Changing an unrelated column on the same table is enough.

### When does Prisma choose to redefine a table?

From `flavour/sqlite/schema_differ.rs::set_tables_to_redefine` **[verified by reading the source]**, a SQLite table is redefined (and therefore has its triggers destroyed) if **any** of these hold:

- a primary key is created, dropped, or changed
- **any column is dropped**
- **a required (non-nullable) column is added**
- **any column changed** — type, nullability, or default
- **any foreign key is created or dropped**

What is *safe* — i.e. handled with a plain `ALTER TABLE ADD COLUMN` and no rebuild — is essentially: **adding a nullable column with no foreign key**, plus adding or dropping indexes.

That is a much narrower safe path than it looks. Adding `ActionRecord.verificationStatus String` (required) rebuilds the table. Adding a relation to `AgentRun` rebuilds the table. Making a field optional rebuilds the table.

Two consequences flow directly from this:

1. **Any hand-written DDL attached to the table dies the same way** — `CHECK` constraints, generated columns, and triggers alike, since `render_create_table_as` builds the replacement table from Prisma's model only. **[inferred, high confidence, from the same source path; I verified it for triggers only.]**
2. **It is an argument for a JSON payload column.** If the shape of an event lives inside a `payload` TEXT column, schema evolution happens in Zod rather than in `ALTER TABLE`, and the table itself almost never needs rebuilding. That is a real, mechanical benefit that connects the [payload storage decision](#event-payload-storage) to this one.

### The documented workflow, and why it is not sufficient

Prisma's supported answer for unsupported SQL is `prisma migrate dev --create-only`, then hand-edit the generated `migration.sql` ([Unsupported database features](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features), which uses a trigger as its worked example; [Customizing migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations)). That works for *installing* the triggers once, and — per the drift analysis above — they will stay installed and undisturbed until a table rebuild.

It does not help you *keep* them, because:

- **There is no post-migrate hook.** `prisma.config.ts` exposes exactly three `migrations` options — `path`, `seed`, and `initShadowDb` — and in Prisma 7 `seed` fires only on an explicit `prisma db seed` (auto-seeding after `migrate dev`/`migrate reset` was **removed** in v7). **[verified from the [config reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference) and the [v7 upgrade guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).]**
- **`initShadowDb` is not a substitute.** It runs against the *shadow* database, and it runs *before* the migration replay — i.e. before your tables exist. It cannot host `CREATE TRIGGER`.
- So re-creating triggers after every table rebuild reduces to *a human remembering to hand-append `CREATE TRIGGER` to every future migration that touches those tables.* That is Tier 0 discipline guarding a Tier 3 mechanism. It will fail, and when it fails it fails silently.

### What the other migration commands do to your triggers

All rows **[verified from the engine source or the docs]**, none run end-to-end.

| Command | Effect on triggers | Why |
|---|---|---|
| `migrate dev` (no table rebuild) | preserved | Drift is trigger-blind |
| `migrate dev` (**table rebuild**) | **silently destroyed** | `DROP TABLE` in `render_redefine_tables` |
| `migrate reset` | destroyed, then **restored** — but only if they live in a committed migration file | SQLite `reset()` truncates the `.db` via `std::fs::File::create`, then replays all migrations verbatim |
| `db push` | **destroyed on any table rebuild**, never restored | "`db push` does not interact with or rely on migrations" — your trigger migrations are never replayed |
| `db push --force-reset` | **destroyed permanently** | wipes the file, no migration replay |
| `db pull` | untouched (read-only), but the resulting `schema.prisma` records no trace that triggers exist | describer is trigger-blind |

Two corollaries worth stating plainly:

1. **A trigger created by hand in `sqlite3` and never committed to a migration is destroyed by `migrate reset` and never comes back.** Guards must exist in code, not in someone's shell history.
2. **`db push` must not exist in this project.** It is the one command that destroys guards with no path to restoring them.

The fix is not to rely on migrations at all for this. See the recommendation.

---

## Event payload storage

### What Prisma's SQLite provider supports

- **`Json` works on SQLite, since Prisma 6.2.0.** The features matrix footnote: *"JSON and Enum types are supported in SQLite as of Prisma ORM 6.2.0."* **[verified]**

- **The docs understate what you get, and I initially repeated their error.** The [Working with Json fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields) page says advanced JSON filtering "is supported by PostgreSQL and MySQL only" and **never mentions SQLite at all**. That line is stale relative to 6.2.0. The engine's connector capabilities (`psl/psl-core/src/builtin_connectors/sqlite_datamodel_connector.rs`) grant SQLite `Json | JsonFiltering | JsonFilteringJsonPath | AdvancedJsonNullability`. **[verified from the engine source.]** Actual SQLite filter surface:

  | Operator | SQLite |
  |---|---|
  | `equals`, `not` | ✅ |
  | `path` | ✅ — **string** form (`"$.a.b"`, MySQL syntax) only; the array form `["a","b"]` **panics** in the quaint SQLite visitor |
  | `string_contains` / `string_starts_with` / `string_ends_with` | ✅ |
  | `array_starts_with` / `array_ends_with` | ✅ |
  | `array_contains` | ❌ — `unimplemented!("JSON contains is not supported on SQLite")` |
  | `lt` / `lte` / `gt` / `gte` on JSON | ❌ — needs `JsonFilteringAlphanumeric` |
  | `Json[]` list fields | ❌ |
  | full-text `search` | ❌ |

  ⚠️ Caveat: the engine test suite gates its `extract_json_path` test to MySQL only, so SQLite `path` filtering is *enabled by capability and implemented in the visitor* but thinly covered by tests. Treat it as working-but-lightly-tested.

- **How `Json` is physically stored: plain JSON text, not SQLite's binary JSONB.** Prisma declares the column type `JSONB` (`renderer.rs:273`, `ColumnTypeFamily::Json => "JSONB"`) but SQLite **has no `JSONB` column type** — per [json1.html](https://sqlite.org/json1.html), "JSONB is … intended for internal use by SQLite only" and "SQLite stores JSON as ordinary text". The identifier is just a marker Prisma reads back on introspection. On the wire, v6 bound `serde_json::to_string(value)` as a TEXT parameter; v7's `@prisma/adapter-better-sqlite3` maps `'JSONB' -> ColumnTypeEnum.Json` and passes strings through. **[verified from the engine and adapter source.]**

- **SQLite itself is not the limitation.** JSON functions have been built in by default since 3.38.0 (2022); `->`/`->>` arrived in the same release; JSONB landed in 3.45.0 (2024). `@prisma/adapter-better-sqlite3@7.9.1` depends on `better-sqlite3 ^12.6.0`, which bundles **SQLite 3.51.2** — so the empirical results in this document (run against system SQLite 3.51.0) are essentially the engine Propositum will ship. That build also sets `SQLITE_DEFAULT_FOREIGN_KEYS=1`. **[verified from the published packages.]**

Critically, **[verified]** on 3.51.0:

```sql
CREATE INDEX Ev_kind ON Ev(json_extract(payload,'$.kind'));
EXPLAIN QUERY PLAN SELECT id FROM Ev WHERE json_extract(payload,'$.kind')='doc_edit';
-- QUERY PLAN
-- `--SEARCH Ev USING COVERING INDEX Ev_kind (<expr>=?)
```

So a JSON payload column is **not** unindexable or unqueryable in SQLite. Expression indexes have been available since SQLite 3.9.0 and require deterministic functions — `json_extract()` carries `SQLITE_DETERMINISTIC`, so it qualifies ([expridx.html](https://sqlite.org/expridx.html), [json1.html](https://sqlite.org/json1.html)). Generated columns (3.31.0+) can also be indexed. Prisma's schema DSL can express neither; both need hand-written SQL.

⚠️ **But do not build on a hand-made index.** Prisma's describer *does* read indexes, and an index with no counterpart in `schema.prisma` is drift. This is not speculative: [prisma/prisma#29289](https://github.com/prisma/prisma/issues/29289) (open, Prisma 7.4.2) is exactly this failure for partial indexes, which became visible to the describer in 7.4.0 and are now dropped — and the reporter's conclusion was that "partial indexes created via the officially recommended workflow are no longer safe across Prisma upgrades." **[verified from the issue]**; I did not separately confirm the behaviour for *expression* indexes, which may still be in the invisible category today — but that is precisely the category that just moved. Treat any hand-made index as a liability. If you need one, either reinstall it at startup alongside the triggers, or wait for Prisma 8's first-class expression- and partial-index support (announced 2026-08-02).

### Recommendation: hybrid, with the payload as `String`, not `Json`

Model the ledger row as **a thin typed spine plus one opaque payload**:

```prisma
model ActionRecord {
  id          String   @id            // ULID / UUIDv7 — sortable, client-generated
  seq         Int      @unique        // monotonic; drives the hash chain
  runId       String                  // typed: you filter on it
  kind        String                  // typed: discriminant, you filter on it
  occurredAt  DateTime                // typed: you sort on it
  payload     String                  // canonical JSON, Zod-validated both ways
  prevHash    String
  hash        String

  @@index([runId, seq])
}
```

Typed columns for exactly the fields you *filter, sort, or join on*. Everything else goes in `payload`.

**Why `String` and not `Json`** — this is the load-bearing part, and it is not the obvious choice:

1. **The hash chain requires byte-stable serialization, and with `Json` you do not own the bytes.** You must hash exactly what is stored. Prisma's serializer is Prisma's business: v6 wrote `serde_json::to_string(value)` from Rust; v7 passes a JS-serialized string through the better-sqlite3 adapter. That is already *two* implementations across one major version. A future change to key ordering or number formatting would silently invalidate every hash in the ledger, with no error and no migration. With `String` you own the canonical form — sorted keys, no insignificant whitespace — and the chain stays valid across Prisma versions forever.
2. **Zod at every boundary is already a project constraint.** `payload: String` + `Schema.parse(JSON.parse(row.payload))` is the honest expression of that. `Json` gives you `Prisma.JsonValue`, which you have to validate anyway — so the typing bought you nothing and cost you control of the bytes.
3. **Type affinity, and it bites in exactly the place that matters.** A column declared `JSONB` contains none of `INT`/`CHAR`/`CLOB`/`TEXT`/`BLOB`/`REAL`/`FLOA`/`DOUB`, so under [SQLite's affinity rules](https://www.sqlite.org/datatype3.html) it gets **NUMERIC** affinity, and SQLite silently coerces anything that looks numeric. **[verified]** on 3.51.0:

   ```
   CREATE TABLE A (j JSONB, t TEXT);
   -- inserting the same strings into both columns:
   '{"a":1}' -> j: text     | t: text
   '123'     -> j: INTEGER  | t: text
   '12.5'    -> j: REAL     | t: text
   ```

   Prisma **knows** about this and compensates on read — the v6 conversion layer has explicit `ValueRef::Integer(i) if c.is_json()` and `ValueRef::Real(f) if column.is_json()` branches that re-wrap the number as JSON. So a Prisma → Prisma round-trip is fine. But a read via `$queryRaw`, `json_extract`, the `sqlite3` CLI, or **anything computing a hash over the stored value** sees an integer where JSON text was written. That is precisely the audit-and-verify path. **[The affinity behaviour and the Prisma compensation code are both verified; `renderer.rs:273` emits `"JSONB"` as the declared type.]**
4. `json_extract` and expression indexes work on TEXT just as well. **[verified]**

**What is lost:** you cannot write `where: { payload: { path: ['kind'], equals: 'doc_edit' } }` — but you could not do that on SQLite anyway. You promote a field to a typed column the moment you need to query it. That promotion is *adding a nullable column*, which is the one schema change that does **not** rebuild the table and does **not** destroy your triggers. The design and the migration constraint point the same direction, which is usually a sign the design is right.

---

## Transactional integrity when a run crashes mid-action

This section contains the finding most likely to contradict an existing project assumption, so I want to be direct about it.

### The contradiction

The founding brief says: *"Every action carries a reason, a result, and a verification status, append-only."* Read naively, that is one `ActionRecord` row with `reason`, `result`, and `verificationStatus` columns.

But the reason exists **before** the action runs and the result exists **after**. One row holding both means writing the row, doing the work, then **`UPDATE`-ing the row with the result** — which is exactly the operation append-only forbids. The brief's own sentence, taken literally, requires you to break the brief's own constraint.

Worse is the alternative people reach for to avoid the update: write the single row *after* the action completes, inside the same transaction as the effect. That is the genuinely dangerous option, because:

- If the process crashes between the effect and the commit, the file on disk was modified and **the ledger has no record that anything happened at all.** Side effects with no audit trail is the worst possible outcome for this product — strictly worse than a messy ledger.
- The effect is a Markdown file on the filesystem. **A SQLite transaction cannot roll that back.** Any mental model where "the transaction covers the action" is wrong from the start.

### The resolution: intent and outcome are separate append-only facts

```
ActionRecord      — intent. Written and COMMITTED BEFORE the effect.
                    Carries: runId, kind, reason, target, proposed change.
ActionOutcome     — result. Written and committed AFTER the effect.
                    Carries: actionId, status, verification, error, artifactVersionId.
```

Both insert-only. "Current status of an action" becomes a **computed view** (`LEFT JOIN`, take the latest outcome per action), not a mutable column. This matches issue #12's own note that some of these models "are computed views rather than tables" — this is one of them.

Three things fall out of this that are strictly better than the single-row design:

1. **The crash case becomes observable rather than lost.** An `ActionRecord` with no `ActionOutcome` *is* the definition of "cancelled or crashed mid-action". You get crash forensics for free, and the shift report can say "this action started and we do not know how it ended" — which is honest, and is the kind of thing this product is supposed to be good at.
2. **Append-only survives contact with reality.** No status column ever needs updating.
3. **Retries and re-verification are natural** — append another outcome; the history of attempts is preserved instead of overwritten.

### Commit granularity: one transaction per ledger write, not one per run

The natural Prisma instinct is to wrap a whole agent run in `prisma.$transaction(async (tx) => { ... })`. **Do not do this for the ledger.** Three reasons, and the third makes it moot anyway:

- **Crash semantics.** SQLite rolls back the whole transaction. The filesystem does not. You lose the entire ledger for the run while keeping every side effect it produced.
- **SQLite is single-writer.** "There can only be one writer at a time" ([wal.html](https://www.sqlite.org/wal.html)). An interactive transaction held open for the duration of a model call holds the write lock, and every other write in the app queues behind it.
- **Prisma will kill it.** `$transaction`'s interactive form defaults to `maxWait: 2000ms` and **`timeout: 5000ms`** ([Transactions](https://www.prisma.io/docs/orm/prisma-client/queries/transactions)). An agent run takes minutes. Wrapping one in an interactive transaction does not merely risk losing the ledger — it aborts. **[verified from docs.]**

The ledger write for a single step should be its own short transaction, committed before the effect is attempted.

Three further SQLite-specific facts about Prisma transactions worth recording **[verified]**:

- **SQLite supports only `Serializable`.** The docs' isolation table gives SQLite `No/No/No/No/✔️`, and note "the timing issues discussed in this section do not apply to CockroachDB and SQLite, because these databases only support the highest `Serializable` isolation level." One less thing to reason about.
- **Prisma 7 serializes transactions with a process-local mutex.** `PrismaBetterSqlite3Adapter` holds a single better-sqlite3 connection and an `async-mutex`; `startTransaction` acquires the mutex, then issues a plain (deferred) `BEGIN`. Savepoints are implemented (`SAVEPOINT` / `ROLLBACK TO` / `RELEASE`). This removes in-process `SQLITE_BUSY` entirely — but gives **no cross-process guarantee**. If anything else ever opens the same file, set better-sqlite3's `timeout` (busy_timeout) explicitly; it passes through the adapter's options.
- **On Prisma 6.x there is a live deadlock hazard.** [prisma/prisma#29870](https://github.com/prisma/prisma/issues/29870) (open as of 2026-08-03, reported against 6.19.2): concurrent interactive transactions beyond the tokio worker count make *every* transaction fail at ~5s with `P1008`, including the lock holder. And quaint maps `SQLITE_BUSY` to `ErrorKind::SocketTimeout`, so **lock contention surfaces as a misleading "Socket timeout", not a busy error** — worth knowing before debugging it at 2am. The v7 mutex design appears to be the structural fix, but the issue is still open; **[inferred]** that v7 is unaffected.

### Durability on macOS — a caveat that applies to every option here

Do not rely on defaults here; they are not what you would guess. **[verified]** on this machine's SQLite 3.51.0:

```
default journal_mode : delete      <- NOT wal
PRAGMA synchronous   : 2 (FULL)
PRAGMA fullfsync     : 0 (off)
compile options      : SQLITE_DEFAULT_SYNCHRONOUS=2, SQLITE_DEFAULT_WAL_SYNCHRONOUS=1
```

Two things to notice. WAL is **not** on by default — it has to be enabled, though once enabled it is persistent across connections ([wal.html](https://www.sqlite.org/wal.html)). And this build carries `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, meaning a database *opened* in WAL mode falls back to `synchronous=NORMAL` unless you set it explicitly — which is exactly the setting SQLite warns about:

> "The downside to this configuration is that **transactions are no longer durable and might rollback following a power failure or hard reset.**" — [wal.html](https://www.sqlite.org/wal.html)

So the naive path — turn on WAL for concurrency, leave everything else alone — quietly gives you a *non-durable audit ledger*. (Caveat: these figures are from the system `sqlite3`; the build bundled by `better-sqlite3` may differ. Set the pragmas explicitly and assert their values rather than trusting either.)

And on macOS specifically, even `synchronous=FULL` is weaker than it sounds. From the local `fsync(2)` man page on this machine **[verified]**:

> "Note that while fsync() will flush all data from the host to the drive […] the drive itself may not physically write the data to the platters for quite some time and it may be written in an out-of-order sequence. […] **This is not a theoretical edge case.** This scenario is easily reproduced with real world workloads and drive power failures. For applications that require tighter guarantees […] Mac OS X provides the F_FULLFSYNC fcntl."

SQLite can use it — `PRAGMA fullfsync` — but **the default is off** ([pragma.html](https://www.sqlite.org/pragma.html#pragma_fullfsync)).

### How to actually set them under Prisma 7

**Prisma sets no PRAGMAs at all, and the adapter gives you no hook.** The entire connection setup in `@prisma/adapter-better-sqlite3@7.9.1` is:

```ts
const db = new Database(dbPath, config)
db.defaultSafeIntegers(true)
```

No `pragma`, no `journal_mode`, no `busy_timeout`. The adapter's own options are just `{ shadowDatabaseUrl?, timestampFormat? }` plus better-sqlite3's `Options`, and **the underlying `Database` handle is not exposed**. [prisma/prisma#3303](https://github.com/prisma/prisma/issues/3303) ("SQLite: Use WAL mode") has been open since **2020**, with a contributor noting it "is not on that roadmap and is not high priority". **[verified from the adapter source.]**

The working route, and it does work:

- `journal_mode=WAL` is **persistent** — set it once against the file and every future connection inherits it. Prisma's own regression tests do exactly this (`11789-sqlite-with-wal-or-connection_limit`) via raw SQL against `PrismaBetterSqlite3`.
- `synchronous` and `fullfsync` are **per-connection**, so they must be re-issued each time the client connects. This is workable *specifically because* Prisma 7's better-sqlite3 adapter holds **one** connection: `await prisma.$executeRawUnsafe('PRAGMA synchronous = FULL')` on startup applies to the connection Prisma actually writes through.
- Then read them back and assert. `PRAGMA synchronous;` returning anything other than `2` means the ledger is not durable, and the app should say so rather than assume.

Note this makes durability depend on a runtime assertion in your startup path — the same shape as the trigger guards, and for the same underlying reason: Prisma models the schema, not the database.

**This is also a point in SQLite's favour over JSONL**, and it surprised me: Node's `fs.fsync` documents itself as POSIX `fsync(2)` and exposes **no** `F_FULLFSYNC` path. So a pure-Node JSONL writer *cannot* reach full durability on macOS without native code, while SQLite can with one pragma. **[verified from the Node 22 fs docs and the macOS man page.]**

---

## The local-first migration story

The premise in the ticket is right and it changes the analysis: **the user will never knowingly run a migration.** There is no ops team, no maintenance window, no `prisma migrate deploy` in a CI pipeline they watch. There is an app that they update, which then opens a database file containing months of their real work.

That means:

1. **`prisma migrate dev` is a developer-only tool.** It requires a shadow database, it can reset, and it is not something to run on a user's machine.
2. **The app must call `prisma migrate deploy` (or the programmatic equivalent) at startup**, applying pending migrations to the user's file, then continue. There is no supported post-migration hook, so **whatever happens next has to be your own code.**
3. **`prisma db push` must never appear anywhere near this project.** It is the fast path that skips migration files entirely, and drift afterwards prompts a reset.
4. **Every table rebuild is a full copy of the user's ledger.** `INSERT INTO new_X SELECT ... FROM X` on a table with months of observation events is a real cost, and it happens inside app startup where the user is watching a spinner. Another argument for keeping the ledger tables' *shape* stable and letting the payload absorb change.
5. **Backup before migrating.** `VACUUM INTO 'propositum-backup-<timestamp>.db'` is one statement, produces a consistent single-file snapshot, and **[verified]** preserves triggers. Do it before applying migrations, keep the last N. For a local-first app where the data is irreplaceable and the user did not ask for the migration, this is not optional.

### The startup contract this implies

Because there is no post-migrate hook and Prisma will destroy the triggers, guard installation must be an **idempotent startup assertion**, not a migration artifact:

```
on app start:
  1. open db
  2. PRAGMA journal_mode=WAL; synchronous=FULL; fullfsync=ON
  3. VACUUM INTO backup if migrations are pending
  4. prisma migrate deploy
  5. assertAppendOnlyGuards()      // CREATE TRIGGER IF NOT EXISTS × N per table
  6. verifyAppendOnlyGuards()      // read sqlite_master, compare trigger SQL to expected
  7. verifyHashChain(tail)         // cheap: last N rows, full scan on demand
  8. if 6 or 7 fail -> refuse to start / enter a read-only "ledger integrity" mode
```

Step 5 is what makes the trigger survive Prisma. Step 6 is what makes its absence *loud* rather than silent. `CREATE TRIGGER IF NOT EXISTS` is valid SQLite **[verified from the [CREATE TRIGGER grammar](https://www.sqlite.org/lang_createtrigger.html)]**, so step 5 is safe to run unconditionally on every boot.

---

## SQLite vs. plain JSONL: the contrarian case, argued properly

The ticket asks whether SQLite is even right here. It deserves a real answer, because the JSONL case is stronger than a database-first instinct expects.

### The case FOR JSONL + a relational index

1. **Append-only is the file's native semantics, not a constraint bolted on.** `O_APPEND` means "each write on the file is appended to the end" (macOS `open(2)`). There is nothing to enforce, because there is no `UPDATE` operation to begin with. The whole [enforcement ranking](#enforcement-mechanisms-ranked-by-bypass-difficulty) above becomes unnecessary rather than merely satisfied.

2. **macOS gives you an OS-level append-only flag, and it is stronger than I expected.** `chflags uappnd` sets `UF_APPEND` — "The file may only be appended to" — and per `chflags(2)` it "may be set or unset by either the owner of a file or the super-user", so **no root is required**. I tested it on this machine **[verified]**:

   | Operation | Result |
   |---|---|
   | append (`>>`) | **OK** |
   | truncate (`> file`) | **BLOCKED** — `Operation not permitted` |
   | seek + overwrite in place | **BLOCKED** — `[Errno 1] Operation not permitted` |
   | `rm -f file` | **BLOCKED** — `Operation not permitted` |
   | `chflags nouappnd` as owner | succeeds — the bypass |

   `rm` being blocked genuinely surprised me; the Linux `chattr +a` analogue does not prevent unlink when the directory is writable. On macOS, a sealed JSONL segment resists deletion by any program running as the user — including a buggy cleanup routine, a `fs.rm`, or an over-enthusiastic agent. The bypass is one `chflags nouappnd`, so it is Tier-3-against-accidents and Tier-0-against-intent — the same profile as a SQLite trigger, but obtained from the OS rather than maintained against a migration engine.

   **SQLite cannot use this at all** — it needs random writes into the middle of the file. This is a JSONL-only capability.

3. **Nothing can silently disarm it.** There is no equivalent of "an unrelated schema change rebuilt the table and dropped your guards". The migration engine cannot reach a file it does not know about.

4. **The ledger becomes independently readable.** `cat`, `jq`, `grep`, a diff tool, a text editor, a future maintainer with no Prisma installed. For an audit artifact whose entire purpose is inspectability, "the format is a text file" is a real property, and it survives the project's own death.

5. **Schema evolution is free.** New event kinds are new lines. Old lines are parsed by old schema versions. There is no migration at all — which, given [the migration story](#the-local-first-migration-story), is not a small thing.

6. **It is honest about what it is.** An audit log is a log. Modelling a log as a mutable relational table and then spending four mechanisms preventing the mutation is, arguably, fighting the tool.

### The case AGAINST JSONL

1. **Torn writes on crash.** A single `write()` on an `O_APPEND` fd is atomic with respect to *offset*, so concurrent appenders never interleave — but a crash mid-`write` can still leave a partial line on disk. Mitigable (parse-and-discard a trailing incomplete line; a hash chain makes truncation detectable), but it is code you must write, test, and get right. SQLite gives you "Writes to an SQLite database are atomic. They either happen completely or not at all, even during system crashes or power failures" ([appfileformat.html](https://www.sqlite.org/appfileformat.html)) for free. **[verified from docs; I did not test torn writes.]**

2. **Durability on macOS is *worse*, not better.** As above: Node exposes only POSIX `fsync`, which the macOS man page explicitly says does not guarantee the data reached the platter. SQLite can ask for `F_FULLFSYNC`. This inverts the naive intuition that "a file is simpler so it must be safer".

3. **Two stores means two-phase consistency problems.** "JSONL plus a relational index" means the index can disagree with the log — index written, crash before log append, or vice versa. You now need a reconciler that rebuilds the index from the log, plus a way to know the index is stale. That is a real subsystem. Rebuilding-from-log-on-startup is the clean answer and it is fine at n=1 user, but it is more code than "one database".

4. **Provenance queries are the whole point, and they are joins.** Issue #12's definition of done is: *given a sentence in the final document, walk back to the action, the reason, the source, and the observation event.* That is a chain of joins across five entities. In SQLite it is a query. Over JSONL it is either "load everything into memory" (fine at slice-0 scale, not fine later) or "maintain the relational index" — at which point you have SQLite anyway, and you are maintaining it *in addition to* the log rather than instead of it.

5. **You still need SQLite for everything else.** `Project`, `WorkSession`, `HandoffContract`, `ArtifactVersion` are mutable, relational, and already going in Prisma. JSONL does not remove SQLite from the stack; it adds a second store beside it. "Simpler" is doing a lot of work in that sentence.

6. SQLite's own position, for what it is worth: it recommends itself as a "replacement for *ad hoc* disk files" and notes it "can be faster than the filesystem" for this shape of workload ([whentouse.html](https://www.sqlite.org/whentouse.html)). Self-interested, but the atomicity argument stands on its own.

### Verdict on the contrarian option

**JSONL is genuinely better on enforcement and worse on everything else.** It wins the exact axis the ticket says matters most — the guarantee cannot be silently disarmed by a migration — and loses on crash atomicity, macOS durability, provenance queries, and total system complexity.

I do not think the answer is to pick one. The answer is that the *enforcement* property JSONL offers can be obtained inside SQLite (triggers) provided you solve the one thing that breaks it (migrations), and the *inspectability* property can be obtained by exporting rather than by storing. See below.

---

## Recommendation

**SQLite as the single store, with defence in depth, and one non-negotiable startup assertion.**

Concretely, in priority order:

1. **Install the three triggers per append-only table** — no-`UPDATE`, no-`DELETE`, no-replace-`INSERT`. The third is not optional; without it `INSERT OR REPLACE` walks through. **[verified]**

2. **Put them in a migration file *and* assert them at every application start.** Both, because they cover different failures:
   - the migration file is what restores them after `migrate reset` (which truncates the file and replays migrations verbatim);
   - the idempotent startup assertion (`CREATE TRIGGER IF NOT EXISTS`, run *after* `prisma migrate deploy`) is what restores them after a table rebuild.

   The startup assertion is the single most important line in this recommendation, because Prisma **will** drop these triggers — silently, with exit code 0 — the first time any migration changes a column on those tables. There is no post-migrate hook, so this must live in your own startup path. Treat it as part of "opening the database", not part of "migrating".

3. **Verify them at every start, and fail loudly.** Read `sqlite_master`, compare the trigger SQL to the expected text, and if it does not match, refuse to write. A guard you do not verify is a guard you are assuming.

4. **Hash-chain the ledger, and enforce chain linearity with a `BEFORE INSERT` trigger.** This is what makes a *past* violation detectable even if the guards were absent at the time. It is the only mechanism that keeps working after its own bypass. Compute the hash over **canonical JSON that you control**, which is why the payload column is `String` and not `Json`.

5. **Layer a Prisma client extension on top, and know its holes.** It catches the mistake at the call site with a good stack trace instead of a `SQLITE_CONSTRAINT` from three layers down. Put `$allOperations` at the **top level** of `query` (so raw operations are covered), block `$queryRaw` as well as `$executeRaw` (Prisma's own example forgets it, and `DELETE … RETURNING` goes through `$queryRaw` on SQLite), and understand that **nested writes bypass it entirely** — that hole is only closed by the trigger. Ship exactly one `PrismaClient` construction site and lint against a second.

6. **Split `ActionRecord` (intent, committed before the effect) from `ActionOutcome` (result, committed after).** One short transaction each. Never wrap a run in one long interactive transaction. "Current status" is a computed view. This is a genuine departure from the founding brief's phrasing and should be raised in #12.

7. **Payload as canonical-JSON `String`; promote to typed columns only what you filter, sort, or join on.** Promotion is an *added nullable column*, which is the one migration shape that does not rebuild the table.

8. **Set the pragmas at open, and assert their values:** `journal_mode=WAL`, `synchronous=FULL`, `fullfsync=ON`. None of these is the default. On macOS the third is what the first two are usually *assumed* to already mean, and it is off.

9. **`VACUUM INTO` a timestamped backup before applying migrations.** The user did not ask for the migration; they should not pay for it.

10. **Export the ledger to JSONL as a product feature, not a storage format.** This recovers JSONL's real advantage — `cat`, `jq`, `grep`, portability, longevity, inspectability by a human with no tooling — without paying for a second store, a reconciler, or hand-rolled crash recovery. Seal exported segments with `chflags uappnd` if you want the OS to guarantee they are never rewritten. **[verified that this works on macOS.]**

**Where I would change my mind:** if provenance turns out to be reconstructed in memory anyway (plausible at n=1 with a single work session), point 4 in the JSONL-against case evaporates, and JSONL-as-truth with SQLite-as-derived-index becomes the more honest architecture. That decision belongs to #12, once the provenance query shape is actually known.

---

## A test that would fail if append-only were violated

Three layers. The first is the one that matters, because it is the one that catches the *silent migration* failure — and it is the one a normal test suite would not think to write.

### 1. The guard-survives-migration test (the important one)

This must run against a database that has had **all migrations applied in sequence**, not against a freshly-pushed schema — because the whole failure mode is a *later* migration destroying a guard installed by an *earlier* one.

```ts
// tests/ledger/append-only.guards.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

const APPEND_ONLY_TABLES = ['ObservationEvent', 'ActionRecord', 'ActionOutcome'] as const;

describe('append-only guards survive the full migration history', () => {
  let db: Database; // better-sqlite3 handle

  beforeAll(async () => {
    db = await freshDbWithAllMigrationsApplied(); // migrate deploy, NOT db push
    await assertAppendOnlyGuards(db);             // the production startup routine
  });

  it.each(APPEND_ONLY_TABLES)('%s still has all three triggers', (table) => {
    const names = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name = ?`)
      .all(table)
      .map((r) => r.name);

    expect(names).toEqual(
      expect.arrayContaining([
        `${table}_no_update`,
        `${table}_no_delete`,
        `${table}_no_replace`,
      ]),
    );
  });

  it.each(APPEND_ONLY_TABLES)('%s rejects UPDATE at the engine level', (table) => {
    seedOneRow(db, table, { id: 'r1' });
    expect(() => db.prepare(`UPDATE "${table}" SET id = 'r2'`).run())
      .toThrow(/append-only/);
    expect(rowCount(db, table)).toBe(1);
  });

  it.each(APPEND_ONLY_TABLES)('%s rejects DELETE, with and without WHERE', (table) => {
    seedOneRow(db, table, { id: 'r1' });
    expect(() => db.prepare(`DELETE FROM "${table}" WHERE id='r1'`).run()).toThrow(/append-only/);
    // no WHERE: SQLite's truncate optimization must stay disabled by the trigger
    expect(() => db.prepare(`DELETE FROM "${table}"`).run()).toThrow(/append-only/);
    expect(rowCount(db, table)).toBe(1);
  });

  it.each(APPEND_ONLY_TABLES)('%s rejects INSERT OR REPLACE', (table) => {
    seedOneRow(db, table, { id: 'r1', marker: 'original' });
    // Without the _no_replace trigger this SUCCEEDS SILENTLY, because
    // PRAGMA recursive_triggers defaults to OFF and the delete trigger never fires.
    expect(() => insertOrReplace(db, table, { id: 'r1', marker: 'TAMPERED' })).toThrow(/append-only/);
    expect(readMarker(db, table, 'r1')).toBe('original');
  });

  it.each(APPEND_ONLY_TABLES)('%s rejects ON CONFLICT DO UPDATE', (table) => {
    seedOneRow(db, table, { id: 'r1', marker: 'original' });
    expect(() => upsertViaOnConflict(db, table, { id: 'r1', marker: 'TAMPERED' })).toThrow(/append-only/);
    expect(readMarker(db, table, 'r1')).toBe('original');
  });
});
```

**Why this catches the real bug:** if someone adds a required column to `ActionRecord`, Prisma emits `DROP TABLE "ActionRecord"` and the triggers vanish. `assertAppendOnlyGuards` reinstalls them, so the test passes — which is the *correct* outcome, because production does the same thing on the same path. If someone deletes or breaks `assertAppendOnlyGuards`, or moves it before `migrate deploy`, every one of these fails immediately. **The test guards the guard-installer, which is the actual fragile component.**

Deliberately absent from `beforeAll`: any call that installs triggers *other than the production routine*. If the test installs its own triggers, it tests SQLite rather than Propositum.

### 1b. The nested-write test (the documented hole in the extension layer)

```ts
it('a nested write from a mutable parent cannot delete ledger rows', async () => {
  const { runId } = await seedRunWithActions(3);

  // Prisma's `query` extension does NOT see nested operations, so this reaches
  // the database as a single agentRun.update and the extension never fires.
  // Only the trigger stops it.
  await expect(
    prisma.agentRun.update({
      where: { id: runId },
      data: { actions: { deleteMany: {} } },
    }),
  ).rejects.toThrow(/append-only/);

  expect(await prisma.actionRecord.count({ where: { runId } })).toBe(3);
});
```

If this test passes with a message from the client extension rather than from the trigger, the extension is doing more than Prisma documents and the test is lying — assert on the SQLite error, not on the friendly one. If the schema has no relation from `AgentRun` to `ActionRecord`, this hole does not exist; add the test anyway, so that adding the relation later is what makes it fail.

### 2. The hash-chain test (catches historical violation, guards or no guards)

```ts
it('detects mutation of an already-written record even with guards removed', async () => {
  const db = await ledgerWithNRecords(50);

  // Simulate the exact post-migration state: guards gone, data intact.
  db.exec(`DROP TRIGGER "ActionRecord_no_update"`);
  db.prepare(`UPDATE "ActionRecord" SET reason = 'rewritten' WHERE seq = 17`).run();

  const result = await verifyHashChain(db, 'ActionRecord');
  expect(result.ok).toBe(false);
  expect(result.firstBrokenSeq).toBe(17);
});

it('detects truncation of the ledger tail', async () => {
  const db = await ledgerWithNRecords(50);
  db.exec(`DROP TRIGGER "ActionRecord_no_delete"`);
  db.prepare(`DELETE FROM "ActionRecord" WHERE seq > 40`).run();

  expect((await verifyHashChain(db, 'ActionRecord')).ok).toBe(false);
});
```

### 3. The crash-mid-action test (the property triggers cannot give you)

```ts
it('a run killed mid-action leaves an intent with no outcome, never an effect with no intent', async () => {
  const { runId, docPath } = await startRunThatWillBeKilled();
  await killProcessAfterFirstFileWrite();

  const db = await reopen();
  const intents  = actionRecordsFor(db, runId);
  const outcomes = actionOutcomesFor(db, runId);

  expect(intents.length).toBeGreaterThan(0);              // the effect was never unrecorded
  expect(outcomes.length).toBeLessThan(intents.length);   // the crash is visible, not erased
  expect(await fileWasModified(docPath)).toBe(true);
  expect(reconstructStatus(intents, outcomes).at(-1)).toBe('unknown');
});
```

This is the test that would have failed under the single-row-with-`UPDATE` design, and the one that would have failed if the run were wrapped in a single long transaction — in that case `intents.length` would be `0` while the file on disk had been modified.

---

## Open questions

Things I could not settle, stated as uncertainty rather than guessed at.

1. **Does Prisma propose dropping a hand-made *expression* index on SQLite today?** Confirmed for *partial* indexes ([#29289](https://github.com/prisma/prisma/issues/29289), regression in Prisma 7.4.0), not separately confirmed for expression indexes. Either way I would not depend on one without a startup reinstall. **A 20-minute experiment settles this**; the answer only changes how much work "index the JSON payload" costs, not whether the recommendation holds.

2. **Whether `prisma migrate deploy` is safe to invoke in-process** in a packaged desktop/Next.js app, or whether it requires the CLI on the user's machine. The programmatic migration story determines whether the startup contract above is implementable as written. **This is the biggest remaining unknown, because the whole recommendation hangs on a startup sequence that runs migrations and then re-asserts guards.**

3. **Does the `PRAGMA synchronous` / `fullfsync` route through `$executeRawUnsafe` actually stick?** The reasoning is sound — Prisma 7's better-sqlite3 adapter holds one connection — but I did not run it, and I do not know whether the adapter ever reconnects. Assert the pragma values after setting them and treat a mismatch as a startup failure.

4. **Is `prisma/prisma#29870` fixed in v7?** The v7 mutex + deferred-`BEGIN` design looks structurally immune, but the issue is open and was reported against 6.19.2. If Propositum ever runs two processes against the same file, re-check.

5. **Does SQLite `path` JSON filtering actually work?** It is enabled by connector capability and implemented in the quaint visitor, but the engine's `extract_json_path` test is gated to MySQL only — so it ships with thin coverage. Verify empirically before depending on it. (Moot under the `String` payload recommendation.)

6. **Torn-write behaviour of `O_APPEND` under real crash conditions on APFS.** I asserted that a partial line is possible; I did not test it, and APFS's copy-on-write behaviour may make it rarer than on other filesystems. Only matters if JSONL becomes the store of truth rather than an export.

7. **Is there any supported way to narrow the generated Prisma client** so `update`/`delete` do not exist on a model? I found none, but absence is harder to prove than presence.

---

## Sources

Primary sources only. Everything below was read directly.

**SQLite (sqlite.org)**
- [CREATE TRIGGER](https://www.sqlite.org/lang_createtrigger.html) — grammar including `IF NOT EXISTS`; `RAISE(ABORT|FAIL|ROLLBACK|IGNORE)` semantics
- [DELETE](https://www.sqlite.org/lang_delete.html) — the truncate optimization applies only when "the table being deleted has no triggers"
- [DROP TABLE](https://www.sqlite.org/lang_droptable.html) — "Any triggers attached to the table are dropped from the database schema before the implicit DELETE FROM is executed, so this cannot cause any triggers to fire"
- [ALTER TABLE](https://www.sqlite.org/lang_altertable.html) — the four supported operations; "Making Other Kinds Of Table Schema Changes", step 8: "Use CREATE INDEX, CREATE TRIGGER, and CREATE VIEW to reconstruct indexes, triggers, and views"
- [ON CONFLICT](https://www.sqlite.org/lang_conflict.html) — REPLACE fires delete triggers only when recursive triggers are enabled
- [PRAGMA](https://www.sqlite.org/pragma.html) — `recursive_triggers` (default OFF), `writable_schema`, `fullfsync` (default off, macOS only), `synchronous`, `journal_mode`, `query_only`
- [Write-Ahead Logging](https://www.sqlite.org/wal.html) — single writer; `synchronous=NORMAL` transactions "are no longer durable and might rollback following a power failure"
- [SQLite As An Application File Format](https://www.sqlite.org/appfileformat.html) — atomicity guarantee
- [Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html) — checklist; "Replacement for *ad hoc* disk files"
- [Datatypes In SQLite — type affinity](https://www.sqlite.org/datatype3.html) — `JSONB` gets NUMERIC affinity; text that looks numeric is coerced
- [JSON Functions And Operators](https://sqlite.org/json1.html) — built in by default since 3.38.0; `->`/`->>`; JSONB (3.45.0) is "intended for internal use by SQLite only" and "SQLite stores JSON as ordinary text"; JSON functions are `SQLITE_DETERMINISTIC`
- [Indexes On Expressions](https://sqlite.org/expridx.html) — since 3.9.0; requires deterministic functions; `CREATE INDEX` only
- [Generated Columns](https://sqlite.org/gencol.html) — since 3.31.0; `STORED` gives an ordinary index, `VIRTUAL` an expression index

**Prisma — source code (`prisma/prisma-engines@main`, last pushed 2026-08-05). The schema engine is still Rust in v7; only the query engine went Rust-free, so this is the code that actually runs.**
- `flavour/sqlite/renderer.rs::render_redefine_tables` — `DROP TABLE` + `ALTER TABLE ... RENAME TO`, recreates indexes only, never triggers or views
- `flavour/sqlite/schema_differ.rs::set_tables_to_redefine` — the exact conditions that cause a table rebuild
- `flavour/sqlite/destructive_change_checker.rs` — full warning set; no concept of triggers, so no warning is possible
- `sql-schema-describer/src/sqlite.rs:112` — `SELECT name, type, sql FROM sqlite_master WHERE type='table' OR type='view'` — triggers are never described
- `sql-schema-describer/src/lib.rs` — `SqlSchema` has `tables`, `views`, `procedures`, `indexes`, `check_constraints` … and **no `triggers`**
- `sql_migration.rs` — `SqlMigrationStep` has no `CreateTrigger`/`DropTrigger` variant
- `commands/src/commands/diagnose_migration_history.rs` — drift = `dialect.diff(shadow, live)` + `migration_is_empty`
- `flavour/sqlite.rs` + `flavour/sqlite/connector/native/mod.rs` — shadow DB is `open_in_memory()`; migrations replayed with `raw_cmd(&script)`; `reset()` truncates the `.db` file with `std::fs::File::create`
- `flavour/sqlite/renderer.rs:273` — `ColumnTypeFamily::Json => "JSONB"` (the declared type for a Prisma `Json` field)
- `psl/psl-core/src/builtin_connectors/sqlite_datamodel_connector.rs` — SQLite capabilities: `Json | JsonFiltering | JsonFilteringJsonPath | AdvancedJsonNullability` (added by `3dc72ed0`, shipped in 6.2.0)
- `quaint/src/visitor/sqlite.rs` — `visit_json_extract` panics on array-path form; `visit_json_array_contains` and `visit_text_search` are `unimplemented!`
- `quaint/src/connector/sqlite/{conversion.rs,error.rs}` — `Json` bound as a TEXT parameter; `SQLITE_BUSY` mapped to `ErrorKind::SocketTimeout`
- `@prisma/adapter-better-sqlite3@7.9.1` — `better-sqlite3.ts` (single connection + `async-mutex`, plain `BEGIN`, savepoints, **no PRAGMAs**), `conversion.ts` (`'JSONB' -> ColumnTypeEnum.Json`); depends on `better-sqlite3 ^12.6.0`, which bundles **SQLite 3.51.2** with `SQLITE_DEFAULT_FOREIGN_KEYS=1`

**Prisma — documentation (prisma.io)**
- [Unsupported database features](https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features) — triggers named as unrepresentable; `--create-only` workflow, with a trigger as the worked example
- [Customizing migrations](https://www.prisma.io/docs/orm/prisma-migrate/workflows/customizing-migrations)
- [prisma.config.ts reference](https://www.prisma.io/docs/orm/reference/prisma-config-reference) — `migrations` supports only `path`, `seed`, `initShadowDb`; no post-migrate hook
- [About the shadow database](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database) — "SQLite | No special requirements."
- [SQLite provider](https://www.prisma.io/docs/orm/overview/databases/sqlite) — `@prisma/adapter-better-sqlite3`; `Json` → `"JSONB"`; enums unenforced at the DB level
- [Database features matrix](https://www.prisma.io/docs/orm/reference/database-features) — "JSON and Enum types are supported in SQLite as of Prisma ORM 6.2.0"; expression indexes "Prisma schema: Not yet"
- [Working with Json fields](https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-json-fields) — **stale**: says advanced JSON filtering is "PostgreSQL and MySQL only", never mentions SQLite
- [Transactions and batch queries](https://www.prisma.io/docs/orm/prisma-client/queries/transactions) — `maxWait: 2000ms`, `timeout: 5000ms`; SQLite supports `Serializable` only
- [Client extensions: query](https://www.prisma.io/docs/orm/prisma-client/client-extensions/query) — `$allModels.$allOperations` vs. top-level raw-query interception
- [Client extensions: Limitations](https://www.prisma.io/docs/orm/prisma-client/client-extensions) — "The `query` extension type does not support nested read and write operations"
- [prisma-client-extensions / readonly-client](https://github.com/prisma/prisma-client-extensions/tree/main/readonly-client) — Prisma's own example; blocklist omits `$queryRaw`
- [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7) — driver adapters required; `@prisma/adapter-better-sqlite3`; auto-seed after `migrate dev`/`reset` removed

**Prisma — issues and discussions**
- [#26712](https://github.com/prisma/prisma/issues/26712) — "Support for Stored Procedures and sql related features", **closed as not planned, March 2025**
- [#29289](https://github.com/prisma/prisma/issues/29289) (open, 7.4.2) and [#29220](https://github.com/prisma/prisma/issues/29220) (closed, 7.4.0) — hand-created partial indexes became visible to the describer and are now dropped as drift. The clearest statement of the see-it/drop-it rule
- [#13407](https://github.com/prisma/prisma/issues/13407) — manually created partition tables proposed for deletion (open since 2022)
- [#24180](https://github.com/prisma/prisma/issues/24180) — custom migration SQL (generated column + GIN index) reverted by the next `migrate dev`
- [#14918](https://github.com/prisma/prisma/issues/14918) — a `BEFORE INSERT` trigger that modifies rows breaks `prisma.x.create()` (Postgres)
- [#29870](https://github.com/prisma/prisma/issues/29870) — SQLite concurrent interactive transactions deadlock; `SQLITE_BUSY` surfaces as `P1008` (open, reported against 6.19.2)
- [#3303](https://github.com/prisma/prisma/issues/3303) — "SQLite: Use WAL mode", **open since 2020**, explicitly deprioritized
- [discussion #19104](https://github.com/prisma/prisma/discussions/19104) — user reports generated columns reverted while trigger modifications were not

**Platform (read locally on the target machine, macOS 25.5, `sqlite3` 3.51.0, Node v22.22.2)**
- `man 2 fsync` — "the drive itself may not physically write the data to the platters for quite some time […] This is not a theoretical edge case […] Mac OS X provides the F_FULLFSYNC fcntl"
- `man 2 chflags` / `man 1 chflags` — `UF_APPEND` "The file may only be appended to", settable by the owner
- `man 2 open` — "Opening a file with O_APPEND set causes each write on the file to be appended to the end"
- [Node.js v22 `fs`](https://nodejs.org/docs/latest-v22.x/api/fs.html) — `fs.fsync` documents itself as POSIX `fsync(2)`; no `F_FULLFSYNC` surface

**Empirical**

All results marked **[verified]** were produced on the target machine on 2026-08-06 against system `sqlite3` **3.51.0** and the macOS filesystem. That version is essentially what Propositum will ship: `@prisma/adapter-better-sqlite3@7.9.1` → `better-sqlite3 ^12.6.0` → **SQLite 3.51.2**.

Experiments run: trigger enforcement across `UPDATE` / `DELETE` (with and without `WHERE`) / `ON CONFLICT DO UPDATE`; the `INSERT OR REPLACE` hole and the `BEFORE INSERT` guard that closes it; `RAISE(ABORT)` not degrading under `INSERT OR IGNORE`; Prisma's literal `render_redefine_tables` statement sequence destroying triggers with exit code 0; the `PRAGMA writable_schema` bypass; plain `DROP TRIGGER`; `VACUUM` / `VACUUM INTO` / `.dump` preserving triggers; the `BEFORE INSERT` hash-chain linearity trigger; `json_extract` expression indexes being chosen by the query planner; `JSONB`-vs-`TEXT` column affinity coercion; default `journal_mode` / `synchronous` / `fullfsync` and the `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1` compile option; and the `chflags uappnd` append / truncate / overwrite / `rm` matrix.

**Not run:** anything requiring a Prisma installation (installing packages was out of scope). Every Prisma claim here comes from its documentation, its published packages, or its engine source — never from observing Prisma execute.
