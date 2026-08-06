# ADR-0001 — A separate worker process draining a Run table

**Status:** accepted · 2026-08-06
**Ticket:** [#10](https://github.com/smukhyala/propositum/issues/10)
**Research:** [`docs/research/durable-local-execution.md`](../research/durable-local-execution.md)

## Context

Propositum's core promise is that work continues after the person leaves. A `Shift` runs for
minutes with nobody watching, must be cancellable when they come back early, must enforce a time
budget, and must leave a coherent ledger even if it dies halfway.

The question is not "how do we run an async job" — it is **what owns the run's lifetime**. Get that
wrong and the product does not work at all: a run that dies when the tab closes is not a handoff,
it is a slow request.

## Decision

**A separate long-lived Node worker process, started as its own npm script, draining a `Run` table
in the application's SQLite database.**

```
next dev / next start          npm run worker
        │                              │
        │  writes Run(pending) ───────►│  claims, executes, writes ledger
        │                              │
        └──── reads ledger ◄───────────┘
             (poll on return)
```

- The app writes a `Run` row and returns immediately. It never executes a `Shift`.
- The worker claims a row inside a transaction, executes, and writes `ActionIntent` /
  `ActionOutcome` rows as it goes.
- The UI learns what happened by reading the ledger. It never needs to have been running.

The queue is a table the product needs regardless — `AgentRun` is a domain object with a lifecycle,
not queue plumbing. So the queue costs nothing extra.

## Why

**1. It is the only option whose lifetime is decoupled from both the browser and the Next.js
server.** Everything else ties the run to something that can go away for reasons unrelated to the
work: a tab, a dev-server reload, a deploy.

**2. Cancellation has a real handle.** "Take back control" needs to stop a run in flight. A claimed
row with a status the worker checks at each action boundary gives a cancellation point that is
already where the budget check happens.

**3. Crash coherence.** The ledger is append-only and written as the run proceeds, so a worker that
dies mid-`Shift` leaves a `ShiftReport` that can still be rendered. This is why the report is
written by the app on return rather than by the run — a report only a live runner can produce
cannot exist on `interrupted`, the outcome that most needs one.

## What we rejected, and why it was a real choice

**`after()` — rejected, but not for the reason expected.** It is fully supported self-hosted and
*does* survive a tab close; `next start` drains pending callbacks on SIGTERM. It is rejected because
it offers **no cancel handle and no way to report itself orphaned**. The obvious cheap option was
less obviously wrong than assumed, and the ADR should say so rather than imply it was never viable.

**Inngest, Temporal, Restate — rejected on adoption cost, not on constraint violation.** All three
genuinely run on one Mac with no Docker, no Redis, and no cloud, as single binaries with
SQLite/RocksDB persistence. The research checked this specifically so this ADR could not hide
behind "needs infrastructure." Each would bring a durable-execution model better than ours. Each
also brings a runtime, a DSL, and an operational surface for one user running one job at a time.
Revisit if replanning-across-shifts ships, where their determinism guarantees start paying.

**Vercel Workflow SDK — rejected on a documented limitation.** It looks like an exact fit, but its
own docs state the Local World's queue is in-memory and does not persist across server restarts.
The durable paths are Vercel or PostgreSQL.

**A child process per run — rejected as strictly worse.** It has the same orphan characteristics as
a long-lived worker with none of the observability, and process lifecycle tracking has to be built
anyway.

## Consequences

### Accepted costs

**Two processes to start.** `npm run dev` and `npm run worker`. Documented in the README; a
single-command wrapper is a convenience, not a design change.

**Orphan risk is the flip side of the survival property.** Node documents that child processes "may
continue running after the parent exits **regardless of whether they are detached or not**" — Node
never kills its children. That default is exactly why a run survives a dev-server restart, and
exactly why a careless worker outlives everything. Mitigated by a lease: a claimed `Run` carries a
lease timestamp the worker renews, and a startup sweep marks expired leases `interrupted`.

**A `SIGTERM` handler removes Node's default exit.** Any handler must explicitly exit, or the worker
becomes unkillable. Called out here because it is the kind of thing that looks like a bug in
something else.

### Binding implementation notes

**`BEGIN IMMEDIATE` on the claim path — verified, no workaround needed.** A deferred read-then-write
fails with `SQLITE_BUSY_SNAPSHOT`, which the busy timeout does **not** retry. Prisma 6.19.3 emits
`BEGIN IMMEDIATE` for both interactive and batch `$transaction`, so `$transaction` is safe as-is.
Locked in by `tests/prisma-transaction-mode.test.ts`, which fails if a future Prisma changes it.

**`$transaction`'s interactive default timeout is 5000 ms.** A `Shift` must never be wrapped in one.
Transactions are for individual ledger writes and the claim, never for the run.

**The deadline is derived, never stored.** `contract.acceptedAt + timeLimitMinutes`, an immutable
pair, so a crash-restart loop cannot silently reset the budget by recomputing it.

**Budget is time only.** Measured on a real boundary at 15.1 s and $0.0325 per call ([ADR-0005](./0005-model-boundary.md)),
a 30-minute run buys ~120 sequential calls for roughly a dollar — latency binds long before cost does.

### The limit this does not fix

**"Leave your desk", not "leave the building."** A lid close cannot be blocked, only delayed by
about 30 seconds. The worker stops when the Mac sleeps. This is inherent to local execution rather
than a shortcut — cloud execution would fix it and is out of scope.

Two consequences follow, and both are product-visible:

- A run interrupted by sleep is marked `interrupted` with reason `lease-expired` by the **startup
  sweep**, whose clock may be hours after the lid actually closed. The report must therefore say
  *"sometime before X"* rather than stating a precise end time it does not know.
- `unknown` will be the **routine** `ActionStatus`, not the exception. Most slice-0 shift reports
  will carry a trailing action Propositum cannot adjudicate. The vocabulary makes this honest; it
  does not make it pleasant.

## Revisit when

- Continuation ships and replanning across shifts needs real durable-execution semantics — that is
  when Inngest or Restate start earning their adoption cost.
- Runs need to survive sleep, which means leaving local execution, which is a product decision
  rather than a runtime one.
- More than one run is ever in flight at once. The claim path is built for it; nothing else is.
