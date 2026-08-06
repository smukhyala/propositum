# Durable local execution for long handoff runs

Research for [#4](https://github.com/smukhyala/propositum/issues/4). Feeds the worker-runtime decision in [#10](https://github.com/smukhyala/propositum/issues/10).

**Researched:** 2026-08-06.
**Environment assumed:** macOS **26.5.2 (build 25F84)** — note that "Darwin 25.x" is the *kernel* version of macOS 26, not macOS 15 — Node 22.22.2, npm only, single user, local-first. No Redis, no Docker, no Postgres server, no cloud.
**Doc versions checked:** Next.js docs at **v16.3.0**; Node.js API docs at **v22.x**; SQLite docs at sqlite.org (current); Anthropic TypeScript SDK docs (current); Darwin man pages read from this machine.

Version-specific claims are labelled. Where the docs are silent I say **UNDOCUMENTED** rather than guessing.

---

## The question

What are the real options for running a minutes-long, cancellable, budget-enforced job on macOS, locally, from a Next.js application — and which survives the user closing the browser?

Sub-questions the decision needs answered for each option:

1. Does the run survive tab close, browser quit, `next dev` restart, machine sleep, reboot?
2. How is a run cancelled mid-flight?
3. How does a UI that was *not running* learn what happened?
4. How is a time/compute budget enforced?
5. What is the operational cost, and what breaks first?

---

## Recommendation in one paragraph

**Run the handoff in a separate, long-lived Node worker process that drains a `Run` table in the same SQLite file, started explicitly as a second npm script alongside the dev server.** The queue is a hand-rolled atomic claim — `BEGIN IMMEDIATE` plus a guarded `UPDATE … RETURNING` — against a table the product needs to have anyway; the append-only ledger *is* the progress channel. Cancellation is a `cancelRequested` flag polled at action boundaries, escalating to `SIGTERM` on the worker. The UI polls the ledger; it never needs a live connection. Do **not** boot the worker from `instrumentation.ts`, and do not use `after()` as the primary mechanism.

Two things worth stating up front because they cut against the easy version of this argument. **(1)** The npm ecosystem has no mature SQLite-native queue — one semi-credible LGPL option at ~1.6k weekly downloads, then hobby packages — so hand-rolling is forced, not preferred. **(2)** Inngest, Temporal and Restate *do* run locally on one Mac with no Docker, no Redis and no cloud; they are rejected on cost of adoption, not on constraint violation. Both are set out in [Option F](#f-off-the-shelf-durable-execution). Failure modes named in full [below](#recommendation-with-its-failure-modes).

---

## Options compared

"Survives" = the *work* continues and the *ledger* stays coherent.

| | A. In the request | B. `after()` | C. Worker inside the Next process | **D. Separate worker process** | E. Detached child per run | F. Off-the-shelf durable execution | G. launchd agent / Tauri sidecar |
|---|---|---|---|---|---|---|---|
| Tab close | **UNDOCUMENTED** — result lost either way | Yes | Yes | **Yes** | Yes | n/a | Yes |
| Browser quit | **UNDOCUMENTED** — result lost either way | Yes | Yes | **Yes** | Yes | n/a | Yes |
| `next dev` restart | No | No | No | **Yes** | Yes | Local World: **No** | Yes |
| `next start` stopped (SIGTERM) | No | Drains, then dies | No | **Yes** | Yes | Local World: No | Yes |
| Machine sleep | Process resumes; sockets and wall-clock assumptions do not | Same | Same | **Same** | Same | Same | Same |
| Reboot | No | No | No | No (needs reaper) | No (needs reaper) | No | **Yes**, at next GUI login |
| Cancel handle | None | **None** | In-process flag | **DB flag + SIGTERM** | DB flag + group kill by PID | Framework-specific | DB flag + SIGTERM |
| Budget enforcement | Your code | Your code | Your code | **Your code, one place** | Your code, N places | Framework | Your code |
| UI observes progress | Stream only, dies with tab | Nothing to observe | Poll SQLite | **Poll SQLite** | Poll SQLite | Framework UI | Poll SQLite |
| Extra infra | None | None | None | **One npm script** | None | A second binary, or Postgres/cloud | plist + packaging |
| What breaks first | Client disconnect semantics | No cancel, no visibility | Duplicate/orphan workers on HMR | Worker not running | PID reuse on kill; orphan swarm | Cost of adoption | TCC / signing / dev ergonomics |

Two precisions the table cannot carry:

- **"`next dev` restart" means the Next.js server restarting, not the terminal dying.** For D, the worker is a sibling process started by the same `npm run dev`; a Next.js recompile-restart leaves it untouched, but `Ctrl-C` on the parent script stops both. If a run must survive `Ctrl-C`, the worker has to be started `detached` (Option E's mechanics) or under launchd (Option G) — that is a deliberate choice, not a default.
- **"Reboot: Yes" for launchd is qualified.** A default (Aqua-session) agent loads only "when a user has logged in at the GUI"; a `Background`-session agent loads without GUI login. Neither runs before the machine is up.

---

## Detailed findings

### A. In the request — Server Function or Route Handler

Next.js does **not** document what happens to in-flight async work in a Route Handler or Server Function when the client disconnects.

- The [`route.js` reference](https://nextjs.org/docs/app/api-reference/file-conventions/route) (v16.3.0) documents streaming and `ReadableStream`, but has **no** section on request abort, client disconnect, or cancellation.
- The [`NextRequest` reference](https://nextjs.org/docs/app/api-reference/functions/next-request) (v16.3.0) documents exactly two things — `cookies` and `nextUrl`. **`signal` is not documented.** You can reach `request.signal` because `NextRequest` extends the Web `Request`, but its abort behaviour under Next is not a documented contract.
- Community reports in the Next.js repo say `request.signal`'s abort event does **not** reliably fire on browser cancellation ([discussion #48682](https://github.com/vercel/next.js/discussions/48682), [issue #52809](https://github.com/vercel/next.js/issues/52809)), and that Server Actions have no cancellation story at all ([discussion #54516](https://github.com/vercel/next.js/discussions/54516)). These are first-party repo threads, **not documentation** — treat as evidence that the behaviour is unstable, not as a specification.

There is also a hard Node-level ceiling on any long-held request, independent of Next.js. From the [Node 22 `http` docs](https://nodejs.org/docs/latest-v22.x/api/http.html):

- `server.requestTimeout` — **default `300000` (5 minutes)**, changed in v18.0.0 from "no timeout". "If the timeout expires, the server responds with status 408 without forwarding the request to the request listener and then closes the connection."
- `server.headersTimeout` — default is the minimum of `requestTimeout` or `60000`.
- `server.keepAliveTimeout` — default `5000`.
- `server.timeout` — default `0` (no timeout) since v13.

`requestTimeout` governs *receiving the request*, not writing the response, so a long streamed response is not directly capped by it — but a "minutes-long" job held open in a request is living inside a stack of timeouts that nobody in this project controls or tests. `next start` exposes only `--keepAliveTimeout` ([CLI reference](https://nextjs.org/docs/app/api-reference/cli/next)); `requestTimeout` is not exposed at all without a custom server.

**Verdict: rejected.** Not because it definitely dies, but because whether it dies is undocumented, and the product's central promise cannot rest on undocumented behaviour.

### B. `after()`

`after()` is real, stable, and **fully supported self-hosted** — this is better than commonly assumed and deserves an honest hearing.

From the [`after` reference](https://nextjs.org/docs/app/api-reference/functions/after) (v16.3.0):

> `after` allows you to schedule work to be executed after a response (or prerender) is finished.

> `after` will be executed even if the response didn't complete successfully. Including when an error is thrown or when `notFound` or `redirect` is called.

Version history: `unstable_after` in `v15.0.0-rc`, **stable in `v15.1.0`**.

From the [self-hosting guide](https://nextjs.org/docs/app/guides/self-hosting#after) (v16.3.0):

> `after` is fully supported when self-hosting with `next start`.

> When stopping the server, ensure a graceful shutdown by sending `SIGINT` or `SIGTERM` signals and waiting. The Next.js server will finish in-flight requests and execute any pending `after()` callbacks before exiting. Platforms should allow a configurable drain period (10-30 seconds is recommended) to ensure all background work completes.

On duration:

> `after` will run for the platform's default or configured max duration of your route.

And [`maxDuration`](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration) says:

> Deployment platforms can use `maxDuration` from the Next.js build output to add specific execution limits.

**Read together: on a self-hosted `next start` there is no platform, therefore no platform-imposed max duration, therefore `after()` work is not time-capped by Next.js.** That is an inference from two documents, not a sentence anyone wrote — flagging it as such. It is the single most load-bearing inference in this document and is worth a 20-minute spike to confirm empirically.

Why it is still not the answer:

1. **It dies with the Next.js process.** The graceful-shutdown text is about *draining*, i.e. finishing what is running before exit — not about surviving a restart. A `next dev` recompile-restart or a `Ctrl-C` mid-run loses the run.
2. **There is no cancellation handle.** `after()` returns nothing. There is no run ID, no `AbortController`, no way for a later request to reach into a callback scheduled by an earlier one except through module-global state — which is exactly the state that HMR resets.
3. **There is no way to know it is orphaned.** If the process dies mid-callback, nothing marks the run as interrupted. The ledger is left claiming a run is in progress forever.
4. **In dev, "the Next.js process" is not one process.** The [CLI reference](https://nextjs.org/docs/app/api-reference/cli/next) documents that `next dev` produces two CPU profiles: `dev-main-*` ("Parent process (dev server orchestration)") and `dev-server-*` ("Child server process (request handling and rendering)"). Your `after()` callback lives in the child. That child's exact restart policy on file change is **UNDOCUMENTED**.

**Verdict: rejected as the primary mechanism.** Genuinely fine for fire-and-forget side effects (writing an audit row after a mutation). Not fine for a minutes-long run that must be cancellable and observable.

### C. A worker inside the Next.js process, booted from `instrumentation.ts`

`instrumentation.ts` is the documented server-startup hook. From the [file-convention reference](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) (v16.3.0):

> The file exports a `register` function that is called **once** when a new Next.js server instance is initiated, and must complete before the server is ready to handle requests. `register` can be an async function.

Stable since `v15.0.0`. Next.js calls `register` in all runtimes, so gate on `process.env.NEXT_RUNTIME === 'nodejs'` ([guide](https://nextjs.org/docs/app/guides/instrumentation)).

The trap: "once **per server instance**" is not "once per machine". In dev the server instance is recreated, and community reports say `instrumentation.ts` is invoked multiple times in dev while once in production ([discussion #50198](https://github.com/vercel/next.js/discussions/50198), [#15341](https://github.com/vercel/next.js/discussions/15341)) — **UNDOCUMENTED** in the reference, but consistent with the two-process dev architecture above. If `register()` starts a worker loop, every dev restart risks a second worker competing for the same rows, or an orphan holding a claim.

**Verdict: rejected.** In-process work has the same lifetime as `after()` (dies with the server) *plus* a duplicate-instance hazard. It is strictly worse than D.

`instrumentation.ts` is still the right place for **read-only startup work** — e.g. a reaper pass that marks stale `running` rows as `interrupted` when the app boots. That is idempotent, so running it twice is harmless.

**`worker_threads` does not rescue this option.** It is `Stability: 2 - Stable` in Node 22, but the [docs](https://nodejs.org/docs/latest-v22.x/api/worker_threads.html) define a `Worker` as "an independent JavaScript execution **thread**" within the same process — "`process.exit()` does not stop the whole program, just the single thread", and "Signals are not delivered through `process.on('...')`" inside a worker. A thread cannot outlive its process, so a `next dev` restart kills every worker thread with it, and a worker thread cannot even implement its own signal-based shutdown. Disqualified for this requirement; still the right tool for CPU-bound work *within* a run.

### D. A separate long-lived Node worker process draining a SQLite table — **recommended**

Two OS processes, one SQLite file: the Next.js server (writer of `Run` rows, reader of the ledger) and `worker.ts` (claimer of runs, writer of ledger rows).

**Does SQLite actually support this?** Yes — explicitly, and the best statement of it is [isolation.html](https://www.sqlite.org/isolation.html), not the WAL page:

> There can be multiple database connections open at the same time, and all of those database connections can write to the database file, but they have to take turns. SQLite uses locks to serialize the writes automatically; this is not something that the applications using SQLite need to worry about.

> the reader is only able to see complete committed transactions from the writer… **This is true regardless of whether the two database connections are in the same thread, in different threads of the same process, or in different processes.**

> SQLite implements serializable transactions by actually serializing the writes. **There can only be a single writer at a time to an SQLite database.**

And from [wal.html](https://www.sqlite.org/wal.html):

> Reading and writing can proceed concurrently.

> However, since there is only one WAL file, there can only be one writer at a time.

> All processes using a database must be on the same host computer; WAL does not work over a network filesystem.

> Unlike the other journaling modes, `PRAGMA journal_mode=WAL` is persistent. If a process sets WAL mode, then closes and reopens the database, the database will come back in WAL mode.

So: WAL is set once, out of band, and stays set; two local processes are fully supported; **exactly one may write at a time**. Write transactions must be short — fine for append-only ledger rows, fatal if one is held across an LLM call.

**Three rules, and the third one is the trap.**

1. **Turn WAL on.** Without it a writer blocks every reader.
2. **Set a busy timeout on every connection.** `PRAGMA busy_timeout` ([pragma.html](https://www.sqlite.org/pragma.html)), or `better-sqlite3`'s `timeout` option — "the number of milliseconds to wait when executing queries on a locked database, before throwing a `SQLITE_BUSY` error (default: `5000`)" ([better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)).
3. **Use `BEGIN IMMEDIATE` for any transaction that will write.** This is the single most common bug in hand-rolled SQLite queues, and **a busy timeout does not save you from it.** From [lang_transaction.html](https://www.sqlite.org/lang_transaction.html): "If the first statement after BEGIN DEFERRED is a SELECT, then a read transaction is started. Subsequent write statements will upgrade the transaction to a write transaction if possible, **or return SQLITE_BUSY**." And from [isolation.html](https://www.sqlite.org/isolation.html): the read→write escalation "**fails with an SQLITE_BUSY_SNAPSHOT error**", whereas "**If the BEGIN IMMEDIATE operation succeeds, then no subsequent operations in that transaction will ever fail with an SQLITE_BUSY error.**" `SQLITE_BUSY_SNAPSHOT` is *not* retried by the busy handler. Read-then-write under Prisma's `$transaction()` is therefore exposed unless `BEGIN IMMEDIATE` is used — and **whether Prisma emits `BEGIN` or `BEGIN IMMEDIATE` on SQLite is UNVERIFIED** (open question 2).

**Atomic claim.** SQLite has supported `RETURNING` since **3.35.0 (2021-03-12)** on `INSERT`, `UPDATE` and `DELETE` ([lang_returning.html](https://www.sqlite.org/lang_returning.html)), so a compare-and-set claim is a single statement. There is **no `FOR UPDATE` and no row-level locking in SQLite** — the [`SELECT` grammar](https://www.sqlite.org/lang_select.html) has no locking clause at all — and none is needed, because writes are already globally serialized. `SKIP LOCKED` has nothing to skip. Caveat from the `RETURNING` page: "The rows emitted by the RETURNING clause appear in an arbitrary order" — irrelevant when claiming one row, relevant if you ever claim in batches.

Independent validation that this is the right pattern: **Sidequest**, the one semi-credible SQLite queue on npm, does exactly this. Its docs claim `SELECT ... FOR UPDATE SKIP LOCKED`, but [its actual SQLite backend source](https://github.com/sidequestjs/sidequest/blob/master/packages/backends/sqlite/src/sqlite-backend.ts) does a `SELECT id WHERE state='waiting' … LIMIT n` followed by a guarded `UPDATE … WHERE state='waiting' AND id IN (…) RETURNING *`. The docs page is Postgres marketing copy; the code is the SQLite pattern.

**Prisma — partially resolved, better than I first thought.** Prisma's [SQLite connector page](https://www.prisma.io/docs/orm/overview/databases/sqlite) and [connection URLs reference](https://www.prisma.io/docs/orm/reference/connection-urls) document the URL format and nothing else — no WAL, no `busy_timeout`, no word on concurrency. But two facts change the picture:

- **Prisma does not and will not set WAL for you.** [prisma/prisma#3303 "SQLite: Use WAL mode"](https://github.com/prisma/prisma/issues/3303) has been **open since 2020-08-14** (last updated 2026-07-29). Since `journal_mode=WAL` is persistent in the file, this is a one-time out-of-band step, not a per-connection concern.
- **The busy timeout *is* settable through Prisma.** Prisma 7 removed the Rust query engine, so SQLite now goes through the `@prisma/adapter-better-sqlite3` driver adapter — and that adapter's constructor takes `better-sqlite3`'s own `Options` type (`Options & { url: … }`), so `timeout` passes straight through. The adapter itself issues no PRAGMAs.

So the honest position: **`busy_timeout` — solved via the adapter. WAL — your job, once. `BEGIN IMMEDIATE` — unverified through Prisma, and the reason the claim path below uses raw SQL.**

**Which driver.** `better-sqlite3` (13.0.3, `engines: node >= 22`) is already in the tree because Prisma 7 requires it for SQLite — so use it rather than adding a second SQLite binding. Node's built-in [`node:sqlite`](https://nodejs.org/docs/latest-v22.x/api/sqlite.html) is **Stability 1.1 — Active development** (added v22.5.0; unflagged in v22.13.0 but "still experimental"), and only reached release-candidate status in Node 25/24. Two different SQLite libraries opening the same file is legal but pointless risk. Two further `better-sqlite3` notes: it compiles with `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`, so **WAL defaults to `synchronous=NORMAL`** with a documented "slight loss of durability" — set `synchronous = FULL` if a power cut must not lose the last committed ledger row; and under sustained multi-process access the WAL file can grow without checkpointing, for which its [performance doc](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) recommends `wal_checkpoint(RESTART)`.

**Cross-process change notification does not exist.** SQLite's [`sqlite3_update_hook`](https://www.sqlite.org/c3ref/update_hook.html) "registers a callback function with the database connection identified by the first argument". Whether it fires for other connections is **not addressed by the documentation** — but it is a per-connection C API and there is no documented cross-process notification mechanism in SQLite. Plan on polling.

**Operational cost:** one extra line in `package.json` (`"dev": "npm-run-all -p dev:next dev:worker"` or equivalent), one `worker.ts`, and a reaper. No daemon, no plist, no supervision — in slice 0 the worker is just a second process in the same terminal session.

### E. A detached child process per run

Genuinely credible, and close to being the recommendation. Node documents the semantics precisely ([child_process, Node 22](https://nodejs.org/docs/latest-v22.x/api/child_process.html)):

> On non-Windows platforms, if `options.detached` is set to `true`, the child process will be made the leader of a new process group and session. **Child processes may continue running after the parent exits regardless of whether they are detached or not.**

That sentence is the surprise of this research: **Node does not kill children when the parent dies.** Detaching is about process groups and terminal attachment, not about survival. Two consequences:

1. A child spawned by the Next.js server survives a `next dev` restart *by default*. Good.
2. Every crashed or restarted parent leaves live children behind. That is an orphan swarm waiting to happen, and it applies to option D's worker too.

**So what does `detached` actually buy?** No controlling terminal. `setsid(2)` (Darwin man page) says the calling process "is the session leader of the new session, is the process group leader of a new process group and **has no controlling terminal**." Node's [process docs](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events) say "on non-Windows platforms, the default behavior of `SIGHUP` is to terminate Node.js". A non-detached child therefore dies when the terminal running `npm run dev` goes away; a detached one does not. **That, not "detachment", is the survival mechanism.**

The rest of the documented contract:

> By default, the parent will wait for the detached child process to exit. To prevent the parent process from waiting for a given `subprocess` to exit, use the `subprocess.unref()` method.

> When using the `detached` option to start a long-running process, the process will not stay running in the background after the parent exits unless it is provided with a `stdio` configuration that is not connected to the parent. If the parent process' `stdio` is inherited, the child process will remain attached to the controlling terminal.

So the working recipe is `detached: true` + `stdio: 'ignore'` (or file descriptors) + `unref()` — which is exactly the example the Node docs give.

Three further documented traps, all of which have bitten this shape of design before:

- **`unref()` is voided by IPC.** The escape clause above reads "unless there is an established IPC channel between the child and the parent processes." `fork()` always establishes IPC, so a forked child pins the Next.js server's event loop even after `unref()`. Use `spawn`, or call `subprocess.disconnect()` — "Closes the IPC channel between parent and child processes, allowing the child process to exit gracefully once there are no other connections keeping it alive."
- **Undrained stdout deadlocks the child.** From the same page: "These pipes have limited (and platform-specific) capacity. If the subprocess writes to stdout in excess of that limit without the output being captured, the subprocess blocks, waiting for the pipe buffer to accept more data… Use the `{ stdio: 'ignore' }` option if the output will not be consumed." A worker that logs and whose parent has restarted (so nobody is reading the pipe) will silently hang. Log to a file descriptor, never to an unread pipe.
- **A `SIGTERM` handler removes Node's auto-exit.** From [process docs](https://nodejs.org/docs/latest-v22.x/api/process.html#signal-events): "`'SIGTERM'` and `'SIGINT'` have default handlers on non-Windows platforms that reset the terminal mode before exiting with code `128 + signal number`. **If one of these signals has a listener installed, its default behavior will be removed (Node.js will no longer exit).**" A worker that installs a graceful-shutdown handler and forgets to call `process.exit()` becomes unkillable by anything short of `SIGKILL`. `'SIGKILL'` "cannot have a listener installed, it will unconditionally terminate Node.js on all platforms"; `'SIGSTOP'` likewise.

Cancellation is a real handle: `subprocess.kill([signal])` "sends a signal to the child process. If no argument is given, the process will be sent the `'SIGTERM'` signal." `options.signal` (AbortSignal, added v15.5.0/v14.17.0 for `spawn`) is equivalent to `.kill()` with an `AbortError`, and `options.killSignal` defaults to `'SIGTERM'`.

Two documented hazards:

> Sending a signal to a child process that has already exited is not an error but may have unforeseen consequences. Specifically, if the process identifier (PID) has been reassigned to another process, the signal will be delivered to that process instead which can have unexpected results.

That is fatal for a naive "store the PID, kill it later" cancel button on a long-lived local app. Any PID-based cancel must be guarded by a recorded start time and a liveness check, or avoided.

> On Linux, child processes of child processes will not be terminated when attempting to kill their parent. This is likely to happen when running a new process in a shell or with the use of the `shell` option of `ChildProcess`

(The doc says "On Linux" and makes no macOS claim; identical behaviour on Darwin is **UNVERIFIED** from Node's docs, though it follows from POSIX signal semantics.)

**Group kill is real but is not a Node guarantee.** `process.kill(-pid)` is never documented in `child_process`; [`process.kill()`](https://nodejs.org/docs/latest-v22.x/api/process.html#processkillpid-signal) only alludes to it — "Windows platforms will throw an error if the `pid` is used to kill a process group" — and adds "it is really just a signal sender, like the `kill` system call." The semantics come from `kill(2)`, whose Darwin man page on this machine reads: "if the process number is negative but not -1, the signal is sent to all processes whose process group ID is equal to the absolute value of the process number."

Consequence: with `detached: true` the child *is* a process-group leader (PGID == PID), so `subprocess.kill()` signals **only the child** and orphans any grandchildren, while `process.kill(-pid, 'SIGTERM')` signals the whole tree. Group kill is the right cancel primitive for a job that shells out — but it rests on `kill(2)`, not on Node, and it inherits the same PID-reuse hazard, now aimed at an entire process group.

**Why it loses to D, narrowly:** N runs means N SQLite writers competing for the single WAL writer slot; budget enforcement lives in N places; and cancellation depends on a PID whose reuse Node explicitly warns about. D has one writer, one budget checkpoint, and cancels a process it started and has never lost track of. E's advantages — no idle daemon, nothing to supervise, no claim race — are real, and if the two-terminal ergonomics of D prove intolerable, E is the option to switch to, not `after()`.

### F. Off-the-shelf durable execution

Checked against the constraint "no Redis, no Docker, no Postgres, no cloud". All version, publish-date and download figures below were read from the npm registry and the GitHub API on **2026-08-06**, not from third-party comparisons.

#### F1. Queue libraries

**There is no *mature* SQLite-native job queue on npm. There is exactly one semi-credible option, and a long tail of hobby packages.**

| Package | Latest | Last published | Weekly DL | Backing store |
|---|---|---|---|---|
| **`sidequest`** (+ `@sidequest/sqlite-backend`) | 1.16.2 | 2026-07-22 | ~1,600 | **SQLite** via `better-sqlite3` + knex |
| `plainjob` | 0.0.14 | **2024-10-13** | ~254 | SQLite |
| `workmatic` | 1.1.3 | 2026-06-21 | ~64 | SQLite |
| `better-queue` + `better-queue-sqlite` | 3.8.12 / 1.0.7 | **2022-09-22 / 2022-10-13** | 133k / ~1,086 | SQLite via `sqlite3` v5 |
| `node-persistent-queue` | 1.0.5 | **2023-08-20** | ~82 | SQLite |
| `pg-boss` | 12.27.0 | 2026-08-03 | 1.37M | PostgreSQL (+ a PGlite mode) |
| `graphile-worker` | 0.17.3 | 2026-07-08 | 394k | PostgreSQL 12+ only |
| `bullmq` | 6.0.8 | 2026-08-05 | 7.98M | Redis (Postgres in v6) |
| `bee-queue` | 2.0.0 | 2025-12-08 | 49.5k | Redis 2.8+ |
| `agenda` | 6.2.6 | 2026-07-21 | 189k | MongoDB (also pg, redis — no SQLite) |
| `node-resque` | 9.7.1 | 2026-07-24 | — | Redis |
| `piscina` | 5.3.0 | 2026-07-19 | 10.7M | **none** — thread pool, no durability |
| `p-queue` | 9.3.3 | 2026-07-22 | — | **none** — in-memory concurrency limiter |
| `bree` | 9.2.9 | 2026-02-17 | 47.9k | **none** — scheduler, state is your problem |

Notes that matter:

- **`sidequest`** (1,009 GitHub stars) is the only one worth considering. Caveats, all real: **LGPL-3.0**; ~1.6k weekly downloads; it defaults to a *separate* `./sidequest.sqlite` file and runs its own knex migrations table alongside Prisma's; and its docs misdescribe its own SQLite claim mechanism (see Option D). Its architecture — engine in a forked child process for "crash isolation", jobs on a worker-thread pool — is a reasonable independent vote for the shape recommended here.
- **`better-queue-sqlite` is worse than stale.** It depends on `sqlite3` v5 (the *other* native binding, last released 2024-01-05), which would put a second, older SQLite native module in the tree next to the `better-sqlite3` that Prisma 7 already requires. 13 stars.
- **`bree` is explicitly not durable, by its own README:** "Bree does not force you to use an additional database layer of Redis or MongoDB to manage job state… We recommend you to query a persistent database in your jobs… you should manage boolean job states yourself using queries." It is a scheduler with good cooperative cancellation, not a queue.
- **`piscina` and `p-queue`** have no persistence at all. Fine as execution primitives inside a run.

So: the credible-and-mature cell of this table is **empty**. That is the justification for hand-rolling, not a preference.

#### F2. Durable execution frameworks

**Correction to a common assumption, including my own going in: three of these genuinely run on one Mac with no Docker, no Redis and no cloud.** The reason to reject them is cost of adoption, not constraint violation, and the ADR should say so honestly rather than hiding behind "needs infrastructure".

| Framework | Minimum infra on one Mac | Docker | Redis | Cloud | Constraints met? |
|---|---|---|---|---|---|
| **Inngest** (`inngest start`) | one Go binary; SQLite at `./.inngest/main.db` + an *embedded* in-memory Redis | No | embedded, not external | No | **Yes** (beta) |
| **Temporal** (`temporal server start-dev`) | one Go binary; SQLite via `--db-filename` | No | No | No | **Yes** (dev-only per docs) |
| **Restate** | one self-contained binary (`brew` or `npm -g`); embedded RocksDB in `restate-data/` | No | No | No | **Yes** |
| Vercel Workflow SDK | in-process, zero config | No | No | No | Runs — but **not durable** locally |
| DBOS Transact (TypeScript) | PostgreSQL | — | — | — | No |
| Trigger.dev | Docker Compose + Postgres + Redis/s2 | **Yes** | Yes | No | No |
| Cloudflare Workflows | a Cloudflare account | No | No | **Yes** | No |

- **Inngest** — `inngest start` is "[Beta] Run Inngest as a single-node service", which by default will "Use an in-memory Redis server for the queue and state store" and "Use SQLite for persistence. The default database is located at `./.inngest/main.db`", with state "periodically saved to the SQLite database, including prior to shutdown" — explicitly framed as supporting "zero-dependency deployments" ([self-hosting docs](https://www.inngest.com/docs/self-hosting)). Two caveats: it is **beta**, and "periodically snapshotted" means a hard crash loses the delta since the last snapshot — **the snapshot interval is not documented**, so the durability window is UNVERIFIED. For a product whose ledger must be coherent after a crash, an unspecified loss window is disqualifying on its own.
- **Temporal** — the dev server "runs as a single process with zero runtime dependencies" and "supports persistence to disk and in-memory mode through SQLite"; `--db-filename` is documented as "Path to file for persistent Temporal state store. **By default, Workflow Executions are lost when the server process dies.**" ([CLI docs](https://docs.temporal.io/cli/server), [dev server guide](https://docs.temporal.io/develop/run-a-development-server)). But the same docs say `start-dev` "is not intended for production use" and "skips certain HTTP security checks", and for file-based SQLite "upgrading your database schema to enable advanced Visibility features is not supported". Adoption also means rewriting handoffs as deterministic workflows plus activities, and `@temporalio/worker` pulls webpack and `@swc/core` into a desktop app.
- **Restate** — "Restate is a single self-contained binary. No external dependencies needed", installable via `brew` or `npm install -g @restatedev/restate-server`, persisting to a local `restate-data` directory ([local dev](https://docs.restate.dev/develop/local_dev), [server overview](https://docs.restate.dev/server/overview)). Same structural objection: a supervised second binary plus a programming-model rewrite.
- **DBOS Transact for TypeScript — Postgres, full stop.** The system database is "A connection string to a Postgres database in which DBOS can store internal state", defaulting to `postgresql://…` ([config reference](https://docs.dbos.dev/typescript/reference/configuration)). **SQLite is a Python-SDK-only feature**; search results claiming "DBOS uses SQLite by default" are describing the Python docs. Excluded.
- **Trigger.dev** — self-hosting is Docker Compose with PostgreSQL ([docs](https://trigger.dev/docs/self-hosting/docker)). Excluded.
- **Cloudflare Workflows** — runs on Workers; no documented way to run it off Cloudflare. Excluded.
- **PGlite** — embedded WASM Postgres, which would notionally unlock `graphile-worker` or `pg-boss` (pg-boss ships [a PGlite backend](https://pgboss.io/database-backends)). Killed by one line: "PGlite only has a single exclusive connection to the database" ([pglite.dev](https://pglite.dev/docs/)), and pg-boss's own docs add "PGlite serializes everything through one connection… For high-throughput multi-worker queues, use a server-based PostgreSQL instead." A single exclusive connection means the Next.js process and a worker process **cannot both open the same data directory**. It would force a single-process design — exactly the thing this research is trying to escape. Worth one line in the ADR as the "if we ever collapse to one process" option; otherwise rejected.

**Vercel Workflow SDK (`workflow` v4.8.0)** — the most interesting near-miss, because it looks like it solves exactly this and has Next.js integration. It ships a zero-config "Local World". From its own bundled docs (`docs/deploying/world/local-world.mdx` in the published tarball):

> The local world is designed for development, not production:
> - **In-memory queue** - Steps are queued in memory and do not persist across server restarts
> - **Filesystem storage** - Data is stored in local JSON files
> - **Single instance** - Cannot handle distributed deployments
> - **No authentication** - Suitable only for local development

And the only first-party self-hostable durable backend (`docs/deploying/world/postgres-world.mdx`):

> The Postgres World is a production-ready backend for self-hosted deployments. It uses PostgreSQL for durable storage and graphile-worker for reliable job processing.

Grepping the shipped docs for "sqlite" returns nothing. There *is* a community SQLite World — `@workflow-worlds/turso`, embedded libSQL with a polling queue — but it is **v0.2.2, ~90 weekly downloads, third-party**. So the durable paths are Vercel, PostgreSQL, a 90-downloads-a-week package, or writing your own World against an interface whose surface I did not read (**UNVERIFIED**). Rejected for slice 0; the "write a SQLite World" option is worth costing later, because it would buy the programming model for free.

**Verdict: nothing to adopt now.** Not because the constraints forbid it — Inngest, Temporal and Restate all clear the stated bar — but because every one of them costs a supervised second binary *and* a rewrite of how a handoff is expressed, to solve a problem that a `Run` table and one `UPDATE … RETURNING` solve. That is the definition of speculative infrastructure for slice 0. **Revisit if runs ever need to fan out, retry automatically, or resume across a crash mid-action** — Restate and Temporal are the two to revisit first, and this section is the record of why they were passed over.

### G. OS-level supervision — launchd agents, Tauri sidecars

**Tauri sidecars** are out of scope by the map's own stack decision ("no Tauri", Tauri desktop shell listed under out-of-scope in [#1](https://github.com/smukhyala/propositum/issues/1)). Noted anyway because the ticket names them: a sidecar is an external binary declared via `externalBin` in `tauri.conf.json` and spawned via `app.shell().sidecar(...).spawn()` (Rust) or `Command.sidecar(...)` (JS) — see [v2.tauri.app/develop/sidecar](https://v2.tauri.app/develop/sidecar/). **Whether the sidecar is terminated when the Tauri app exits is not documented on that page** — which, given the Node finding above, means assume it is *not*.

**launchd Launch Agents** are unambiguously the documented mechanism. From `man 8 launchd` on this machine:

> On Darwin operating systems, the canonical way to launch a daemon is through launchd as opposed to traditional POSIX and POSIX-like mechanisms or mechanisms provided in earlier versions of OS X. These alternate methods should be considered deprecated and not suitable for new projects.

> In the launchd lexicon, a daemon is, by definition, a system-wide service of which there is one instance for all clients. **An agent is a service that runs on a per-user basis.**

For a single-user local-first app, a per-user agent in `~/Library/LaunchAgents` is the correct form — no root, no admin approval. Five findings that matter if this is ever adopted:

1. **Omitting `ProcessType` throttles you.** From `man 5 launchd.plist`: "This optional key describes, at a high level, the intended purpose of the job… **If left unspecified, the system will apply light resource limits to the job, throttling its CPU usage and I/O bandwidth.**" `Standard` is "equivalent to no ProcessType being set" in intent but must be stated; `Background` jobs are explicitly resource-limited "to prevent them from disrupting the user experience". A minutes-long LLM run under the default would be silently slowed. This is the single most actionable launchd fact here.
2. **launchd forbids the pattern from Option E.** From the same page's EXPECTATIONS section, a launchd job "**MUST NOT**… Call `daemon(3)`" or "Do the moral equivalent of `daemon(3)` by calling `fork(2)` and have the parent process `exit(3)`". launchd already performs `setsid(2)` and stdio redirection on your behalf. So `detached`/`unref()` is redundant *for a launchd-managed worker* — but still correct for any children that worker spawns. **Do not stack the two models.**
3. **launchd requires a `SIGTERM` handler.** "Handle the SIGTERM signal… and respond to this signal by unwinding any outstanding work quickly and then exiting." Combined with the Node finding above (installing the handler removes auto-exit), this is a two-sided requirement: handle it, and exit explicitly.
4. **`launchctl load`/`unload` are legacy.** `man 1 launchctl` places them under `LEGACY SUBCOMMANDS` with "Recommended alternative subcommands: `bootstrap` | `bootout` | `enable` | `disable`." The modern form is `launchctl bootstrap gui/$UID <plist>` / `launchctl bootout gui/$UID/<label>`. Also: a default (Aqua-session) agent loads only "when a user has logged in at the GUI"; `Background`-session agents "may be loaded independently of a GUI login". And plists in `$HOME/Library/LaunchAgents` must be owned by the loading user and "must disallow group and world writes".
5. **`AbandonProcessGroup`.** By default, "when a job dies, launchd kills any remaining processes with the same process group ID as the job." Children spawned `detached` are in *new* process groups, so launchd will **not** clean them up.

Then the modern-macOS overhead: Apple's current guidance is [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice) (macOS 13+), which "registers the service so it can begin launching **subject to user approval**", expects the plist inside a signed app bundle, and surfaces the agent in System Settings → Login Items & Extensions where the user can switch it off — Apple explicitly tells you to "test your app when the service is in a disabled state". **UNVERIFIED:** whether a hand-installed `~/Library/LaunchAgents/*.plist` from an unsigned local dev tool triggers that approval flow at all, and how TCC attributes file-access prompts for a launchd-spawned process versus a terminal-spawned one. Both would need empirical testing, and a job runner that touches the user's documents is exactly where that would bite.

**Verdict: defer.** Real infrastructure, real unverified risk, and the reboot case is better served by a reaper that marks interrupted runs honestly than by a daemon that silently resumes them. Revisit if and when Propositum is packaged rather than run from a terminal. The worker in option D should be written so that *what supervises it* is a swappable detail: today `npm run dev`, later a plist — bearing in mind point 2, which means the launchd version must **not** self-detach.

---

## Cross-cutting findings

### Cancelling a run mid-flight

Cancellation has to be **cooperative at action boundaries** plus a **hard stop** as a fallback. Three layers:

1. **The flag.** `Run.cancelRequested` set by the Next.js server when the user hits "Take back control". The worker reads it at every action boundary. This is the only layer that produces a coherent ledger, because the worker gets to write a "cancelled here, by user" entry before stopping.
2. **The in-flight model call.** A single Claude call can be long. The Anthropic TypeScript SDK supports aborting a stream — from the [SDK docs](https://platform.claude.com/docs/en/api/sdks/typescript): "If you need to cancel a stream, you can `break` from the loop or call `stream.controller.abort()`." Non-streaming requests take a `signal` via `fetchOptions` (a `RequestInit`).
3. **The process.** `subprocess.kill()` → `SIGTERM`, escalating to `SIGKILL`. `SIGKILL` cannot be caught, so the worker must never hold a write transaction across a model call — every completed action must already be durable when the signal lands.

**Budget enforcement note that changes the design.** From the same SDK docs: "By default requests time out after 10 minutes", the timeout is scaled up to **60 minutes** when `max_tokens` is large and streaming is off, and "Certain errors are automatically retried 2 times by default". A single unconfigured model call can therefore burn **30+ minutes of wall clock** before it throws. A wall-clock budget checked only at action boundaries can overshoot by that much. The `ModelClient` must set an explicit `timeout` and `maxRetries` derived from the run's remaining budget — this is a constraint on [#10](https://github.com/smukhyala/propositum/issues/10)'s budget answer, not an afterthought.

### How a UI that was not running learns what happened

**Poll the ledger. Do not use SSE for this.**

The ledger in SQLite is already the source of truth (it is a standing constraint of the brief: every action carries a reason, a result and a verification status, append-only). A UI that mounts cold reads the ledger and renders the whole history — no replay protocol, no reconnect logic, no "what did I miss" problem, and it works identically whether the run finished an hour ago or is still going.

Live updates then need only a 1–2s poll of a route handler that reads new ledger rows since a cursor. Reasons to prefer that over SSE here:

- SSE's failure mode is a connection; polling's failure mode is a stale render for one second. The former needs `Last-Event-ID` resume logic, the latter needs nothing.
- MDN on [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events): "When not used over HTTP/2, SSE suffers from a limitation to the maximum number of open connections, which can be especially painful when opening multiple tabs, as the limit is per browser and is set to a very low number (6)." Next.js does not serve HTTP/2 from its built-in server — the [custom server guide](https://nextjs.org/docs/pages/guides/custom-server) says HTTP/2 requires either a reverse proxy or your own `server.js` (which "will remove important performance optimizations"). Locally there is no proxy, so this is HTTP/1.1 and that 6-connection budget is real: a user with several Propositum tabs open plus the dev server's own connections is inside it.
- A long-lived SSE response reintroduces exactly the request-lifetime questions option A was rejected over.

SSE remains the right tool later for token-by-token streaming *inside* an active view. It is the wrong tool for "what happened while I was away".

### What machine sleep does

Three separate facts, and they resolve the question cleanly.

**1. The process survives; memory is preserved.** From `man 1 pmset` on this machine:

> hibernatemode = 3 by default on portables. The system will store a copy of memory to persistent storage (the disk), and will power memory during sleep. **The system will wake from memory,** unless a power loss forces it to restore from hibernate image.

Memory — and therefore every process's full state — is restored on wake. Context is lost only on power loss. **A run resumes mid-execution rather than dying.**

**2. Idle sleep is preventable; forced sleep is not.** From Apple's [QA1340](https://developer.apple.com/library/archive/qa/qa1340/_index.html):

> `kIOMessageCanSystemSleep`: Idle sleep is about to kick in. **This message will not be sent for forced sleep.** Applications have a chance to prevent sleep by calling IOCancelPowerChange.

> `kIOMessageSystemWillSleep`: The system WILL go to sleep. If you do not call IOAllowPowerChange or IOCancelPowerChange to acknowledge this message, sleep will be delayed by 30 seconds. NOTE: If you call IOCancelPowerChange to deny sleep it returns kIOReturnSuccess, however **the system WILL still go to sleep.**

> it is not possible to prevent forced sleep, only delay it.

**So a lid close or Apple menu → Sleep cannot be blocked, only delayed by ~30 seconds.** This settles open question 6 below: "close the laptop and walk away" is *not* a supported scenario, and Propositum should say so rather than pretend.

**3. `caffeinate(8)` covers the idle case only.** From `man 8 caffeinate` (`/usr/bin/caffeinate`):

> caffeinate creates assertions to alter system sleep behavior. If no assertion flags are specified, caffeinate creates an assertion to prevent idle sleep. If a utility is specified, caffeinate creates the assertions on the utility's behalf, and those assertions will persist for the duration of the utility's execution.

> `-i` Create an assertion to prevent the system from idle sleeping.
> `-s` Create an assertion to prevent the system from sleeping. **This assertion is valid only when system is running on AC power.**
> `-w` Waits for the process with the specified pid to exit. Once the process exits, the assertion is also released.

`caffeinate -i node worker.js` (wrap form — the man page's own example is `caffeinate -i make`) holds the assertion for exactly the worker's lifetime and releases it automatically. `caffeinate -i -w <pid>` attaches to an already-running process. Verify at runtime with `pmset -g assertions`; `pmset noidle` is documented as "deprecated in favor of caffeinate(8)".

Note also from `man 1 pmset` that `ttyskeepawake` keys on tty activity — and a `detached` process has no controlling terminal, so it contributes nothing there.

**What this means for the design.** Two hazards survive:

- **Wall-clock time skips.** The process resumes, but hours may have passed. A `setTimeout` scheduled before sleep may fire immediately on wake or arbitrarily late. **Never enforce a budget or a lease with a timer alone** — compare persisted timestamps at every action boundary.
- **Open TCP connections are almost certainly dead.** What happens to a process's sockets across sleep/wake is **not stated in any Apple documentation I found**. Assume dead: after a wake, every in-flight model call must be treated as failed.

Both point to the same conclusion: **the worker's unit of durability is the action, not the run.** Each completed action is committed to the ledger before the next begins, so a resumed or restarted worker knows exactly where it stopped, and a lease check based on stored timestamps correctly identifies a run that slept through its own deadline.

**Throttling — partially unverified.** Apple's [App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html) documentation describes priority reduction, timer throttling and I/O throttling, but every eligibility criterion is framed in terms of *apps* ("isn't the foreground app", "hasn't recently updated content in the visible portion of a window"). **Whether a plain `node` process with no `NSApplication` is subject to App Nap is UNVERIFIED.** What *is* documented is that `taskpolicy(8)` policies are inherited by children — so a worker spawned from an already-throttled parent inherits the throttle — and that launchd throttles by default (see Option G).

---

## Recommendation, with its failure modes

**Option D: a single long-lived Node worker process, started explicitly, draining a `Run` table in the app's SQLite file.**

Why this one:

- It is the only option whose lifetime is decoupled from **both** the browser and the Next.js server. Everything else in this table couples to one or the other.
- The queue is not new infrastructure. The `Run` row and the append-only ledger have to exist for the product regardless; "queue" is a status column and one `UPDATE ... RETURNING`.
- One writer means the single-writer constraint of SQLite WAL is satisfied by construction rather than by luck.
- One process means one place to enforce the budget and one place to observe cancellation.
- What supervises the worker is a swappable detail — `npm run dev` now, `launchd` later, nothing else changes.

**What this deliberately does not survive.** Started as a sibling of `next dev`, the worker dies on `Ctrl-C` along with everything else. That is the right trade for slice 0: the promise being tested is *"work continues after the user leaves"*, and the user leaving means closing a tab or shutting the laptop lid — not stopping the dev server. If a run genuinely has to outlive `Ctrl-C`, the escalation path is already mapped: start the same worker `detached` with `stdio` to a log file (Option E's mechanics, same worker code), or move it under launchd (Option G, at which point it must **not** self-detach). Neither changes the worker's internals. Choosing this now would be speculative infrastructure; knowing exactly how to get there is not.

### Failure modes accepted

1. **The worker is not running and everything silently queues.** This is the #1 failure mode and it is a UX bug, not just an ops bug — the user sees "working on it" while nothing works. *Mitigation:* the worker writes a heartbeat row every few seconds; the UI treats a stale heartbeat as a first-class visible state ("Propositum isn't running"), not as a spinner. This must be built in slice 0, not deferred.
2. **A crashed worker leaves runs `running` forever.** *Mitigation:* claims carry a lease (`claimedAt`, `heartbeatAt`); a reaper — run from `instrumentation.ts` at app boot and again at worker boot — marks leases older than N seconds as `interrupted` and writes a ledger entry saying so. Interrupted must be a real, displayable outcome with a partial shift report, not an error state.
3. **`SQLITE_BUSY_SNAPSHOT` on a read-then-write transaction.** Only one writer at a time is possible, and the *busy timeout does not rescue a deferred transaction escalating from read to write* — it fails immediately. Whether Prisma's `$transaction()` emits `BEGIN` or `BEGIN IMMEDIATE` on SQLite is unverified. *Mitigation:* run the claim path in raw SQL with an explicit `BEGIN IMMEDIATE`; keep every other write to a single short statement; never hold a transaction across a model call; set `timeout` through the Prisma better-sqlite3 adapter and `journal_mode=WAL` once out of band.
4. **Machine sleep is unpreventable and skips wall-clock time.** A lid close cannot be blocked (QA1340: forced sleep can only be delayed ~30s). The process resumes, but its open sockets are presumed dead and hours may have elapsed. *Mitigation:* action-level durability, so a resumed run loses at most one action; leases and budgets compared against **persisted timestamps**, never against a `setTimeout`; explicit `timeout`/`maxRetries` on the `ModelClient` so a dead socket fails fast rather than 30 minutes late; `caffeinate -i` wrapping the worker to at least prevent *idle* sleep during a run. And a product decision: the UI should not imply that closing the laptop is safe.
5. **Cancellation is not instant.** A run inside a single long model call stops at the next boundary, or when the stream's `AbortController` fires. A user who expects an instant stop will experience a lag. *Mitigation:* hold the in-flight `AbortController` in the worker and abort it directly on cancel; show "stopping…" honestly rather than pretending it stopped.
6. **Reboot loses queued and running work.** No supervision means nothing restarts. *Mitigation:* the boot reaper reconciles; queued runs stay queued and are picked up when the worker next starts. Accepted, not solved.
7. **Two workers if someone starts it twice.** *Mitigation:* the atomic claim makes double-claiming safe (one wins), but a single-instance advisory lock (a `worker_lock` row with a lease, or a PID file) makes the mistake visible instead of silent.
8. **Orphaned workers.** Node does not kill children on parent exit, and nothing kills a worker started in a terminal that gets closed. *Mitigation:* the same single-instance lock; plus `pkill -f propositum-worker` in a documented `npm run worker:stop`.
9. **An unkillable worker.** Installing a `SIGTERM` handler removes Node's default exit; a worker that swallows the signal and never reaches `process.exit()` survives every `Ctrl-C` and every `kill`. This is a footgun the sketch below defuses explicitly, and it must be covered by a test — "worker exits within N seconds of `SIGTERM`" — not by care.

### Explicitly rejected, and why

- **`after()`** — survives the tab and is fully supported self-hosted, but dies with the server, has no cancellation handle, and cannot report that it was orphaned.
- **Booting the worker from `instrumentation.ts`** — inherits `after()`'s lifetime *and* adds a duplicate-instance hazard in dev.
- **A queue library** — no mature SQLite-native option exists; `sidequest` is the only near-miss (LGPL-3.0, ~1.6k weekly, its own second SQLite file), and `better-queue-sqlite` would add a second, older native SQLite binding to a tree that already has `better-sqlite3` via Prisma 7.
- **The Vercel Workflow SDK** — its own docs say the local world's queue is in-memory and does not survive a server restart; the durable paths are Vercel, PostgreSQL, or a 90-downloads-a-week community SQLite World.
- **Inngest / Temporal / Restate** — all genuinely run locally with no Docker, Redis or cloud. Rejected on adoption cost (a supervised second binary plus a rewrite of how a handoff is expressed), plus Inngest's undocumented snapshot window. These are the options to revisit first if the requirements grow.
- **PGlite-backed `pg-boss` / `graphile-worker`** — a single exclusive connection means one process only, which defeats the entire point.
- **launchd / Tauri sidecar** — correct eventually, speculative now.

---

## Code sketches

Illustrative only. Not tested, not TDD'd, and deliberately missing the Zod boundaries this repo requires.

### D — separate worker process (recommended)

**`package.json`**

```jsonc
{
  "scripts": {
    "dev": "npm-run-all --parallel dev:app dev:worker",
    "dev:app": "next dev",
    // caffeinate -i holds an idle-sleep assertion for as long as the worker runs
    "dev:worker": "caffeinate -i node --experimental-strip-types src/worker/main.ts",
    "worker:stop": "pkill -f 'src/worker/main.ts' || true"
  }
}
```

**One-time database setup.** `journal_mode=WAL` is persistent in the file, so this runs once (a migration step or a boot check), not per connection. Prisma will never do it for you — [prisma#3303](https://github.com/prisma/prisma/issues/3303) has been open since 2020.

```ts
// scripts/init-sqlite.ts — run once; WAL survives close/reopen
import Database from 'better-sqlite3'

const db = new Database('./prisma/dev.db')
db.pragma('journal_mode = WAL')
db.pragma('synchronous = FULL')   // better-sqlite3 defaults WAL to NORMAL,
                                  // which trades a little durability for speed
db.close()
```

```ts
// src/db.ts — busy timeout DOES pass through Prisma 7's adapter
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

const adapter = new PrismaBetterSqlite3({
  url: 'file:./prisma/dev.db',
  timeout: 15_000,   // better-sqlite3 Options.timeout; default is 5000ms
})
export const db = new PrismaClient({ adapter })
```

**Claiming a run.** The subselect-plus-guard is the correct SQLite pattern (SQLite has no `FOR UPDATE`; `SKIP LOCKED` has nothing to skip because writes are already serialized). `RETURNING` requires SQLite ≥ 3.35.0. **`BEGIN IMMEDIATE` is not optional** — a deferred transaction that reads then writes fails with `SQLITE_BUSY_SNAPSHOT`, which the busy timeout does *not* retry. Because Prisma's transaction mode is unverified here, this path uses a raw handle.

```ts
// src/worker/claim.ts
import type BetterSqlite3 from 'better-sqlite3'

const LEASE_MS = 30_000

export function claimNextRun(sqlite: BetterSqlite3.Database, workerId: string) {
  const now = Date.now()

  // BEGIN IMMEDIATE takes the write lock up front, so nothing inside can
  // fail with SQLITE_BUSY. `.immediate()` is better-sqlite3's wrapper for it.
  const claim = sqlite.transaction(() => {
    return sqlite.prepare(`
      UPDATE Run
         SET status = 'running', workerId = ?, claimedAt = ?, heartbeatAt = ?
       WHERE id = (
         SELECT id FROM Run
          WHERE status = 'queued'
             OR (status = 'running' AND heartbeatAt < ?)
          ORDER BY createdAt
          LIMIT 1
       )
         AND status IN ('queued', 'running')   -- re-checked under the write lock
      RETURNING id
    `).get(workerId, now, now, now - LEASE_MS) as { id: string } | undefined
  }).immediate

  return claim()?.id ?? null
}
```

**The loop** — cancellation and budget checked at the same boundary, because they are the same kind of decision.

```ts
// src/worker/main.ts
const workerId = `${process.pid}-${crypto.randomUUID()}`
let stopping = false

// Installing these handlers REMOVES Node's default exit behaviour, so the
// loop below must actually terminate and the process must exit explicitly.
// A second signal forces the issue. SIGKILL cannot be caught at all.
function onSignal() {
  if (stopping) process.exit(130)   // second Ctrl-C / kill: stop pretending
  stopping = true
}
process.on('SIGTERM', onSignal)
process.on('SIGINT', onSignal)

await reapStaleRuns(db)   // idempotent; also run from instrumentation.ts at app boot

while (!stopping) {
  const runId = claimNextRun(sqlite, workerId)   // raw handle; see claim.ts above
  if (!runId) { await sleep(500); continue }

  const budget = await loadBudget(db, runId)
  let inFlight: AbortController | null = null

  try {
    for await (const action of plan(runId)) {
      // --- the one boundary where cancellation and budget are enforced ---
      await db.run.update({ where: { id: runId }, data: { heartbeatAt: Date.now() } })
      const run = await db.run.findUniqueOrThrow({ where: { id: runId } })
      if (run.cancelRequested) throw new Cancelled('user')
      if (budget.exhausted()) throw new Cancelled('budget')

      inFlight = new AbortController()
      const result = await performAction(action, {
        signal: inFlight.signal,
        // budget-derived, so a stalled call fails fast instead of after ~30 min
        // (SDK default: 10 min timeout, scaling to 60 min, retried twice)
        timeout: budget.remainingMs(),
        maxRetries: 1,
      })
      inFlight = null

      // durable per action: a SIGKILL here loses at most this one action
      await appendLedgerEntry(db, runId, result)
      budget.charge(result.usage)
    }
    await finishRun(db, runId, 'completed')
  } catch (err) {
    inFlight?.abort()
    await finishRun(db, runId, err instanceof Cancelled ? 'cancelled' : 'failed', err)
  }
}

process.exit(0)   // required: the SIGTERM listener above removed the auto-exit
```

**Cancellation from the app side** — a write, not a signal. The worker does the stopping.

```ts
// app/api/runs/[id]/cancel/route.ts
export async function POST(_req: Request, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params
  await db.run.update({ where: { id }, data: { cancelRequested: true } })
  return Response.json({ status: 'stopping' })   // honest: not 'stopped'
}
```

**Progress for a UI that was not running** — cursor over the ledger, polled.

```ts
// app/api/runs/[id]/ledger/route.ts
export async function GET(req: NextRequest, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params
  const since = Number(req.nextUrl.searchParams.get('since') ?? 0)
  const [run, entries] = await Promise.all([
    db.run.findUniqueOrThrow({ where: { id } }),
    db.ledgerEntry.findMany({ where: { runId: id, seq: { gt: since } }, orderBy: { seq: 'asc' } }),
  ])
  return Response.json({
    entries,
    cursor: entries.at(-1)?.seq ?? since,
    status: run.status,
    // the honest state: the run says 'running' but nothing is actually running
    workerAlive: Date.now() - run.heartbeatAt < 30_000,
  })
}
```

### E — detached child process per run (runner-up)

The Node docs' own recipe, applied. `detached` + `stdio: 'ignore'` + `unref()` is the documented combination for a child that outlives its parent and detaches from the controlling terminal.

```ts
// app/api/runs/[id]/start/route.ts
import { spawn } from 'node:child_process'
import { openSync } from 'node:fs'

export async function POST(_req: Request, ctx: RouteContext<'/api/runs/[id]'>) {
  const { id } = await ctx.params

  // claim first, so a double-click cannot spawn two children
  const claimed = await db.run.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'starting' },
  })
  if (claimed.count === 0) return Response.json({ error: 'already started' }, { status: 409 })

  const log = openSync(`./.propositum/logs/${id}.log`, 'a')
  const child = spawn(process.execPath, ['src/worker/run-one.ts', id], {
    detached: true,
    stdio: ['ignore', log, log],   // inheriting stdio keeps the child on the terminal
  })
  child.unref()

  await db.run.update({
    where: { id },
    // startedAt guards against PID reuse: the docs warn a reassigned PID
    // means the signal is delivered to some other process entirely
    data: { status: 'running', pid: child.pid!, startedAt: Date.now() },
  })
  return Response.json({ runId: id, pid: child.pid })
}
```

```ts
// cancel: flag first, signal only as escalation, and never by PID alone
await db.run.update({ where: { id }, data: { cancelRequested: true } })

setTimeout(async () => {
  const run = await db.run.findUniqueOrThrow({ where: { id } })
  if (run.status !== 'running' || !run.pid) return
  if (!(await pidStartedAt(run.pid))?.equals(run.startedAt)) return  // PID was reused — do not kill
  process.kill(run.pid, 'SIGTERM')
}, 5_000)
```

Note what the second sketch is missing that the first gets for free: nothing enforces one-run-at-a-time, nothing reaps a child that died between `spawn` and its first ledger write except a lease, and the `pidStartedAt` guard is code that has to be written and tested because Node explicitly warns about PID reassignment.

---

## Open questions

Ordered by how much they could change the decision.

1. **Does `after()` really run unbounded on self-hosted `next start`?** Derived from two docs, stated by neither. Worth a 20-minute spike (an `after()` callback that logs every 30s for 10 minutes under `next start`). It does not change the recommendation, but it changes how much `after()` can be trusted for smaller side effects.
2. **Does Prisma's `$transaction()` emit `BEGIN` or `BEGIN IMMEDIATE` on SQLite?** No primary source states it either way. If it is plain `BEGIN`, every read-then-write Prisma transaction can fail with `SQLITE_BUSY_SNAPSHOT` under two-process contention, and the busy timeout will not retry it. This is the highest-value spike in the list: read the emitted SQL, or just decide up front that the claim path uses raw SQL. (The related questions are already answered: `timeout` passes through the `@prisma/adapter-better-sqlite3` constructor, and WAL is a one-time out-of-band pragma because [prisma#3303](https://github.com/prisma/prisma/issues/3303) has been open since 2020.)
3. **Exactly when does `next dev` restart its child server process?** The CLI docs confirm a parent/child split for `next dev`; the restart policy on file change is undocumented. This determines how often option B/C would actually lose a run in practice, and how noisy an orphan problem option D/E has during development.
4. **Does `next dev` propagate `SIGTERM`/`SIGINT` to the child server process, and does the child drain `after()` callbacks the way `next start` is documented to?** The self-hosting doc's drain guarantee is written about `next start`.
5. **What happens to a Node process's open TCP sockets across sleep/wake?** Not stated in Apple documentation. The *process* survives (memory is preserved — `pmset` hibernatemode), so only the sockets are in question. Design assumes the worst; worth confirming, because it decides whether a slept run can *resume* its current action or must restart it.
6. ~~Does `caffeinate` hold across a lid close?~~ **Answered: no.** QA1340 — "it is not possible to prevent forced sleep, only delay it" (~30s). "Close the laptop and walk away" is not supportable. The remaining question is a *product* one: does Propositum say so in the UI, or silently degrade?
7. **Is a plain `node` process subject to App Nap?** Apple documents App Nap's criteria only for GUI apps. Unverified either way. Matters because a throttled worker turns a 5-minute run into an unpredictable one; a quick `pmset -g assertions` + wall-clock comparison would settle it.
8. **Does a hand-installed `~/Library/LaunchAgents` plist trigger the Ventura+ background-item approval flow, and how does TCC attribute file access for a launchd-spawned process?** Only relevant if Option G is ever adopted, but it should be tested *before* committing to it — a job runner that writes to the user's documents is exactly where TCC attribution bites.
9. **Is `node:sqlite` (added v22.5.0, Stability 1.1 "Active development"; only reached release-candidate status in v25.7.0/v24.15.0) safe to depend on here?** Only relevant if the answer to (2) pushes the worker off Prisma.
10. **`better-sqlite3` is synchronous.** If the worker uses it, every ledger append blocks the worker's event loop. Probably fine for a single-run worker; not fine if the worker also serves anything. Unquantified.

---

## Sources

Primary sources only. Version and date recorded where the page states one.

**Next.js (docs at v16.3.0)**
- [`after`](https://nextjs.org/docs/app/api-reference/functions/after) — semantics, "executed even if the response didn't complete successfully", duration, version history (stable v15.1.0)
- [Self-hosting](https://nextjs.org/docs/app/guides/self-hosting#after) — "`after` is fully supported when self-hosting with `next start`"; SIGINT/SIGTERM drain behaviour; streaming
- [`maxDuration`](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/maxDuration) — "Deployment platforms can use `maxDuration` from the Next.js build output"
- [Route Segment Config](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config) — defaults table, "Set by deployment platform"
- [`route.js`](https://nextjs.org/docs/app/api-reference/file-conventions/route) — streaming; no abort/disconnect section
- [`NextRequest`](https://nextjs.org/docs/app/api-reference/functions/next-request) — documented surface is `cookies` and `nextUrl` only
- [`instrumentation.js`](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation) — `register` called "once when a new Next.js server instance is initiated"; stable v15.0.0
- [Instrumentation guide](https://nextjs.org/docs/app/guides/instrumentation) — `NEXT_RUNTIME` gating
- [`next` CLI](https://nextjs.org/docs/app/api-reference/cli/next) — `next dev` parent (`dev-main`) / child (`dev-server`) processes; `next start --keepAliveTimeout`
- [Custom Server](https://nextjs.org/docs/pages/guides/custom-server) — HTTP/2 requires a reverse proxy or a hand-written server

**Next.js repo (first-party, but discussion threads — not specification)**
- [Discussion #48682](https://github.com/vercel/next.js/discussions/48682) — detecting client disconnections in route handlers
- [Issue #52809](https://github.com/vercel/next.js/issues/52809) — `req` close event not firing on cancelled request
- [Discussion #54516](https://github.com/vercel/next.js/discussions/54516) — no cancellation for server actions
- [Discussion #50198](https://github.com/vercel/next.js/discussions/50198), [#15341](https://github.com/vercel/next.js/discussions/15341) — instrumentation invoked multiple times in dev

**Node.js (v22.x docs)**
- [`child_process`](https://nodejs.org/docs/latest-v22.x/api/child_process.html) — `detached`, "Child processes may continue running after the parent exits regardless of whether they are detached or not", `unref()` and its IPC exemption, `subprocess.disconnect()`, `stdio: 'ignore'` requirement, pipe-capacity blocking, `subprocess.kill()`, `killSignal` default `SIGTERM`, `options.signal` (`spawn` v15.5.0/v14.17.0; `fork` v15.6.0), `options.timeout` (v15.13.0/v14.18.0), PID-reassignment warning, grandchild caveat
- [`process`](https://nodejs.org/docs/latest-v22.x/api/process.html) — signal events; installing a `SIGTERM`/`SIGINT` listener removes the default exit; `SIGKILL`/`SIGSTOP` cannot have listeners; `SIGHUP` terminates by default; `process.kill()` is "really just a signal sender"
- [`globals`](https://nodejs.org/docs/latest-v22.x/api/globals.html) — `AbortController` no longer experimental as of v15.4.0; `AbortSignal.timeout()` v17.3.0/v16.14.0; `AbortSignal.any()` v20.3.0
- [`worker_threads`](https://nodejs.org/docs/latest-v22.x/api/worker_threads.html) — Stability 2; workers are threads of the parent process; signals not delivered
- [`http`](https://nodejs.org/docs/latest-v22.x/api/http.html) — `requestTimeout` default 300000 since v18.0.0; `headersTimeout`; `keepAliveTimeout` 5000; `server.timeout` 0
- [`node:sqlite`](https://nodejs.org/docs/latest-v22.x/api/sqlite.html) — added v22.5.0; "Stability: 1.1 - Active development"; "v22.13.0: SQLite is no longer behind `--experimental-sqlite` but still experimental" (reached Stability 1.2 only in v25.7.0/v24.15.0)
- [Stability index](https://nodejs.org/api/documentation.html#stability-index)

**SQLite (sqlite.org)**
- [Isolation In SQLite](https://www.sqlite.org/isolation.html) — multiple connections and processes may all write, "they have to take turns"; "only a single writer at a time"; `SQLITE_BUSY_SNAPSHOT` on read→write escalation; `BEGIN IMMEDIATE` guarantee
- [Write-Ahead Logging](https://www.sqlite.org/wal.html) — concurrency, "there can only be one writer at a time", same-host requirement, WAL persistence
- [BEGIN / COMMIT / ROLLBACK](https://www.sqlite.org/lang_transaction.html) — `DEFERRED` vs `IMMEDIATE`; "Subsequent write statements will upgrade… or return SQLITE_BUSY"
- [PRAGMA](https://www.sqlite.org/pragma.html) — `journal_mode`, `busy_timeout`, `synchronous`; WAL persistence across connections
- [The RETURNING clause](https://www.sqlite.org/lang_returning.html) — since 3.35.0 (2021-03-12); arbitrary output order
- [SELECT](https://www.sqlite.org/lang_select.html) — grammar contains no `FOR UPDATE` / row-locking clause
- [`sqlite3_update_hook`](https://www.sqlite.org/c3ref/update_hook.html) — per-connection callback; cross-connection behaviour not addressed

**Prisma and drivers**
- [SQLite connector](https://www.prisma.io/docs/orm/overview/databases/sqlite) — connection URL; Prisma 7 requires the `@prisma/adapter-better-sqlite3` driver adapter; silent on WAL, `busy_timeout`, concurrency
- [Connection URLs reference](https://www.prisma.io/docs/orm/reference/connection-urls) — no SQLite parameters documented
- [prisma/prisma#3303 "SQLite: Use WAL mode"](https://github.com/prisma/prisma/issues/3303) — open since 2020-08-14; Prisma does not set WAL
- `@prisma/adapter-better-sqlite3` type definitions (7.9.1, published 2026-07-27) — constructor takes `Options & { url }` from `better-sqlite3`, so `timeout` passes through
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `timeout` default 5000ms; `.transaction().immediate`
- [better-sqlite3 performance](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md) — WAL recommendation; `SQLITE_DEFAULT_WAL_SYNCHRONOUS=1`; `wal_checkpoint(RESTART)` under multi-process access
- [better-sqlite3 threads](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) — one handle per thread

**Anthropic TypeScript SDK**
- [TypeScript SDK docs](https://platform.claude.com/docs/en/api/sdks/typescript) — `stream.controller.abort()`; default 10-minute timeout scaling to 60 minutes with large `max_tokens`; `maxRetries` default 2; `fetchOptions` accepts `RequestInit`

**Queue landscape** — npm registry and GitHub API metadata read on 2026-08-06
- [`sidequest` docs](https://docs.sidequestjs.com/) and its [SQLite backend source](https://github.com/sidequestjs/sidequest/blob/master/packages/backends/sqlite/src/sqlite-backend.ts) — docs claim `FOR UPDATE SKIP LOCKED`; source uses guarded `UPDATE … RETURNING`
- [`better-queue`](https://github.com/diamondio/better-queue) / [`better-queue-sqlite`](https://github.com/diamondio/better-queue-sqlite) — last published 2022; store depends on `sqlite3` v5
- [`graphile-worker` requirements](https://worker.graphile.org/docs/requirements) — "PostgreSQL 12+"
- [`pg-boss`](https://github.com/timgit/pg-boss/blob/master/README.md) and [database backends](https://pgboss.io/database-backends) — Postgres 13+; PGlite mode "serializes everything through one connection"
- [BullMQ](https://docs.bullmq.io/) (Redis) · [bee-queue](https://github.com/bee-queue/bee-queue) (Redis 2.8+) · [Agenda](https://github.com/agenda/agenda) (Mongo/pg/redis, no SQLite)
- [`bree`](https://github.com/breejs/bree) — "Bree does not force you to use an additional database layer… you should manage boolean job states yourself"
- [`piscina`](https://github.com/piscinajs/piscina) — thread pool, no persistence in the feature list
- [PGlite](https://pglite.dev/docs/) — "PGlite only has a single exclusive connection to the database"

**Durable execution frameworks**
- [Inngest self-hosting](https://www.inngest.com/docs/self-hosting) — `inngest start` beta; embedded in-memory Redis; SQLite at `./.inngest/main.db`; periodic snapshots
- [Temporal CLI `server`](https://docs.temporal.io/cli/server) — `--db-filename`; "By default, Workflow Executions are lost when the server process dies"; "not intended for production use"; [dev server guide](https://docs.temporal.io/develop/run-a-development-server); [self-hosted visibility](https://docs.temporal.io/self-hosted-guide/visibility)
- [Restate local dev](https://docs.restate.dev/develop/local_dev) and [server overview](https://docs.restate.dev/server/overview) — "a single self-contained binary. No external dependencies needed"; `restate-data` directory
- [DBOS TypeScript configuration](https://docs.dbos.dev/typescript/reference/configuration) — Postgres system database; SQLite is Python-SDK only
- [Trigger.dev self-hosting](https://trigger.dev/docs/self-hosting/docker) — Docker Compose + Postgres
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/) — Workers platform, account required
- Vercel Workflow SDK — `workflow@4.8.0` published tarball, `docs/deploying/world/local-world.mdx` ("In-memory queue - Steps are queued in memory and do not persist across server restarts") and `docs/deploying/world/postgres-world.mdx` (PostgreSQL + graphile-worker); [repo](https://github.com/vercel/workflow), [worlds manifest](https://github.com/vercel/workflow/blob/main/worlds-manifest.json), [community Turso world](https://github.com/mizzle-dev/workflow-worlds) (v0.2.2, ~90 weekly downloads)

**macOS** — Apple documentation, plus Darwin man pages read from this machine (`caffeinate(8)`, `pmset(1)`, `launchd(8)`, `launchd.plist(5)`, `launchctl(1)`, `taskpolicy(8)`, `kill(2)`, `setsid(2)`)
- `man 8 caffeinate` — `-i`, `-s` ("valid only when system is running on AC power"), `-w <pid>`, wrap-a-utility semantics
- `man 1 pmset` — `hibernatemode` (memory preserved across sleep), `ttyskeepawake`, `noidle` deprecated in favour of `caffeinate(8)`, `-g assertions`
- `man 8 launchd` — "the canonical way to launch a daemon is through launchd"; daemon vs agent
- `man 5 launchd.plist` — `ProcessType` ("If left unspecified, the system will apply light resource limits… throttling its CPU usage and I/O bandwidth"), `KeepAlive`, `RunAtLoad`, `AbandonProcessGroup`, EXPECTATIONS (no self-daemonizing; handle `SIGTERM`)
- `man 1 launchctl` — `load`/`unload` listed under LEGACY SUBCOMMANDS; `bootstrap`/`bootout`/`kickstart`; domain targets; Aqua vs Background session agents; plist ownership and write-permission rules
- `man 2 kill` — negative PID signals the whole process group
- `man 2 setsid` — new session leader "has no controlling terminal"
- [QA1340 — Registering and unregistering for sleep and wake notifications](https://developer.apple.com/library/archive/qa/qa1340/_index.html) — "it is not possible to prevent forced sleep, only delay it"; 30-second delay
- [App Nap](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html) and [Timers](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/Timers.html) — throttling measures; criteria stated for apps only
- [Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice) (macOS 13+) — registration "subject to user approval"; [Updating your app package installer to use the new Service Management API](https://developer.apple.com/documentation/servicemanagement/updating-your-app-package-installer-to-use-the-new-service-management-api); [Managing ongoing background processes](https://developer.apple.com/documentation/appkit/managing-ongoing-background-processes-in-your-mac)

**Web platform**
- [MDN — Using server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) — 6-connection-per-browser-per-domain limit without HTTP/2; `retry:`; `id:` / last event ID

**Tauri**
- [Tauri v2 — Embedding External Binaries (sidecar)](https://v2.tauri.app/develop/sidecar/) — `externalBin`, spawning; sidecar termination on app exit not documented
