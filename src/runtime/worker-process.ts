/**
 * The worker process from ADR-0001.
 *
 * A separate long-lived Node process draining the `Run` table. Its lifetime is
 * decoupled from both the browser and the Next server, which is the only way
 * "work continues after you leave" can be true.
 *
 * ── Orphans are the default, not the edge case ───────────────────────────
 *
 * Node documents that child processes "may continue running after the parent
 * exits regardless of whether they are detached or not" — Node never kills its
 * children. That default is exactly why a run survives a dev-server restart,
 * and exactly why a careless worker outlives everything.
 *
 * The lease is the answer: a claimed run carries a `leaseUntil` the worker
 * renews, and a startup sweep marks expired leases `interrupted`. The sweep's
 * clock is not the lid's — it may run hours after the Mac slept — which is why
 * the report says "sometime before X" rather than a minute it does not know.
 *
 * ── The SIGTERM handler must exit ────────────────────────────────────────
 *
 * Installing a handler REMOVES Node's default exit. A handler that forgets to
 * call `process.exit` produces a worker that cannot be killed, which looks like
 * a bug in something else entirely.
 *
 * ── The fence CONTEXT.md has always described and never had ──────────────
 *
 * CONTEXT.md §4 says, in as many words, that "every action boundary re-reads
 * `status` and `claimedBy`; a Runner that no longer holds the claim aborts
 * without writing". **That has never been true.** The columns landed in the
 * schema in wave 1 and nothing read them; before that there were no columns at
 * all. It did not matter much while the worst a stale run could do was append a
 * draft nobody asked for to a document still under review.
 *
 * A run that drives the person's real Chrome is the first run where a stale
 * claim can press a button on a live page, in an authenticated session, in
 * their name. So the fence stops being a paragraph here.
 *
 * Three things can end a run from outside, and the fence reports all three:
 *
 *   - **the claim moved.** Another process swept this run's expired lease and
 *     re-claimed it. Two workers driving one browser tab is the failure this
 *     column exists for, and the loser must abort WITHOUT WRITING — its writes
 *     would interleave with the winner's on an append-only ledger, where they
 *     could not be told apart afterwards.
 *   - **the person asked it to stop.** `cancelRequested` is a flag, not a kill.
 *   - **the run already ended.** A sweep marked it `interrupted` while it was
 *     mid-turn; a resurrected worker must not carry on under a dead row.
 *
 * ── Why "detach first, POST second" does not violate ADR-0007 ────────────
 *
 * ADR-0007 requires halts to land at the next action boundary, because
 * abandoning an action in flight leaves an `ActionIntent` with no
 * `ActionOutcome` — indistinguishable from a crash, and reported to the person
 * as `unknown` when we know exactly what happened. The kill switches in
 * ADR-0010 detach the debugger BEFORE telling the app, which may happen
 * mid-action, and that reads like a straight violation. It is not.
 *
 * **Detaching is not a halt.** A halt is a decision the run makes and then acts
 * on. Detaching is the REMOVAL OF THE CAPABILITY the run was using, and it is
 * meant to work precisely when the run cannot be trusted to make decisions —
 * which is why it must not depend on the app being reachable, or on this
 * process still being alive to notice.
 *
 * The property ADR-0007 actually protects is that an abandoned action never
 * leaves an intent with no outcome. That property is preserved by MOVING THE
 * WRITER: the abandoning worker does not record the outcome, the app does, on
 * the next return or on the startup sweep, marked `observedBy: 'recovery'` in
 * the ADR-0003 sense — it may only record what it can prove and may never
 * infer. See `settleAbandonedIntents` in `src/server/confirmations.ts`.
 *
 * The fence below is the other half: it lands the run's own halt at an action
 * boundary, so the ordinary case never needs recovery at all.
 */

/**
 * Why a run must stop, read off its own row rather than inferred.
 *
 * `claim-lost` is deliberately separate from `run-ended`. Both mean "stop", and
 * they mean very different things to whoever reads the ledger afterwards: one
 * says another process is now doing this work, the other says nobody is.
 */
export type FenceVerdict =
  | { readonly proceed: true }
  | {
      readonly proceed: false
      readonly reason: 'claim-lost' | 'cancel-requested' | 'run-ended'
    }

/**
 * The check a run performs at every action boundary.
 *
 * Handed to `execute` rather than imported by it, so the loop cannot mistake
 * some other run's fence for its own and cannot decline to construct one.
 *
 * It is an `async` read of a durable row on purpose. Caching the answer would
 * defeat the point: the whole reason to re-read is that the row changed while
 * the run was busy, and a cached fence is a fence that reports the state at the
 * moment the run started.
 */
export interface RunFence {
  /** Re-read `status`, `claimedBy` and `cancelRequested`. Call at every action
   *  boundary, BEFORE committing the next `ActionIntent`. */
  check(): Promise<FenceVerdict>
}

/**
 * Whether a claimed run may enter the loop at all.
 *
 * Separate from the fence because it answers a different question at a
 * different moment: the fence asks "may I keep going", this asks "should I ever
 * have started". `settled` means the caller has already completed the run and
 * written whatever the person needs to read — see `admitContinuation` in
 * `src/domain/execution/continuation.ts` for the case this exists for.
 */
export type RunAdmission = 'proceed' | 'settled'

export interface WorkerProcessDeps {
  /**
   * Reap orphans from a previous life. Runs before any claim, and again
   * whenever the queue is empty.
   *
   * ── Why "once at startup" was not enough ─────────────────────────────────
   *
   * A run parked on `awaiting-confirmation` holds NO lease, deliberately — a
   * run waiting overnight for an answer must not be reaped as an orphan and
   * must not hold a claim while somebody reads. The consequence is that the
   * lease sweep structurally cannot see it, and the thing that CAN — expiring
   * the question after a day — was running exactly once per worker lifetime.
   * On a worker left up for a week, a question nobody answered would never
   * expire: no ending, no re-entry note, forever. Which is the state the sweep
   * exists to prevent.
   *
   * So it runs on the idle path too, where there is nothing claimed and
   * therefore nothing to race.
   */
  sweepExpiredLeases(now: Date): Promise<number>
  /** Claim the oldest pending run, or null. `claimedBy` is written so the fence
   *  below has something to compare against. */
  claimNext(lease: {
    leaseUntil: Date
    startedAt: Date
    claimedBy: string
  }): Promise<{ id: string } | null>
  /**
   * Decide whether this run enters the loop, settling it if not.
   *
   * Required rather than optional, and that is a deliberate cost. An optional
   * hook defaulting to `proceed` would mean a caller that forgot to wire it got
   * a continuation that resumes after its deadline and silently does nothing —
   * the exact failure the coordinator's decision exists to prevent, arriving
   * quietly through a default. A required dep fails at the type level instead.
   */
  admit(runId: string): Promise<RunAdmission>
  /** Re-read the fence columns. One row, three fields; called at every action
   *  boundary, so it must stay a point read. */
  readRun(runId: string): Promise<{
    status: string
    claimedBy: string | null
    cancelRequested: boolean
  } | null>
  /**
   * Execute one claimed run to completion.
   *
   * The fence arrives as a SECOND PARAMETER rather than a required property of
   * some deps object, so an executor written before this existed still
   * type-checks: a `(runId) => Promise<void>` assigns to this signature. That
   * is a migration affordance and not an invitation — an executor that ignores
   * the fence is an executor that can press a button on behalf of a claim it
   * has lost.
   */
  execute(runId: string, fence: RunFence): Promise<void>
  now(): Date
  /** Injected so tests do not actually wait. */
  sleep(ms: number): Promise<void>
  log?: ((message: string) => void) | undefined
}

export interface WorkerProcessOptions {
  readonly leaseMs?: number
  readonly idlePollMs?: number
  /** Stop after this many runs. Tests use it; production omits it. */
  readonly maxRuns?: number | undefined
  /**
   * Who this process says it is, written to `AgentRun.claimedBy`.
   *
   * Must be unique per process. Two workers sharing an identity would each
   * conclude it still holds a claim the other took, which is the one thing the
   * column exists to prevent — so the default mixes the pid with a random
   * suffix rather than trusting the pid alone, which a container can reuse.
   */
  readonly workerId?: string | undefined
  /** How often the idle loop re-runs `sweepExpiredLeases`. Tests shorten it. */
  readonly sweepEveryMs?: number | undefined
}

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_IDLE_POLL_MS = 1_000
/** How often the idle loop re-sweeps. Five minutes, because the shortest thing
 *  it reaps is a day old and the file it writes to is somebody's laptop. */
const DEFAULT_SWEEP_EVERY_MS = 5 * 60_000

function defaultWorkerId(): string {
  const pid = typeof process === 'undefined' ? 0 : process.pid
  return `worker-${pid}-${Math.random().toString(36).slice(2, 10)}`
}

export interface WorkerProcessHandle {
  /** Drain until stopped. Resolves when the loop exits. */
  readonly done: Promise<{ runsCompleted: number }>
  /** Cooperative shutdown — finishes the run in flight, then exits. Never
   *  abandons an action mid-flight, which would leave an intent with no
   *  outcome and be indistinguishable from a crash. */
  stop(): void
  /** What this process wrote to `claimedBy`. Exposed so a test can assert the
   *  fence compares against something real rather than against `undefined`. */
  readonly workerId: string
}

export function startWorkerProcess(
  deps: WorkerProcessDeps,
  options: WorkerProcessOptions = {},
): WorkerProcessHandle {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS
  const workerId = options.workerId ?? defaultWorkerId()
  const sweepEveryMs = options.sweepEveryMs ?? DEFAULT_SWEEP_EVERY_MS
  const log = deps.log ?? (() => undefined)

  let stopping = false

  /**
   * The fence for one run.
   *
   * A closure over `runId` and this process's identity, so there is no way to
   * ask it about a different run and no way for the executor to answer the
   * question itself.
   *
   * A read that FAILS reports `run-ended`. That is the fail-safe direction: a
   * database the worker cannot reach is a worker that cannot prove it still
   * holds the claim, and the rule is that a run which cannot prove it holds the
   * claim stops. Failing open here would mean a network blip authorises
   * continuing to drive somebody's browser.
   */
  function fenceFor(runId: string): RunFence {
    return {
      async check(): Promise<FenceVerdict> {
        let row: Awaited<ReturnType<WorkerProcessDeps['readRun']>>
        try {
          row = await deps.readRun(runId)
        } catch {
          return { proceed: false, reason: 'run-ended' }
        }

        if (row === null) return { proceed: false, reason: 'run-ended' }

        // Order matters, and it is the order the person would want explained.
        // A lost claim is checked first because it is the only one of the three
        // where CONTINUING WOULD BE ACTIVELY HARMFUL rather than merely late:
        // another process is driving the same contract, and two runs writing
        // interleaved intents to an append-only ledger cannot be untangled
        // afterwards.
        if (row.claimedBy !== workerId) return { proceed: false, reason: 'claim-lost' }

        // Then the person's own stop. Reported before `run-ended` so that a run
        // cancelled and then swept says "you stopped me" rather than "I was
        // reaped", which is what they will remember doing.
        if (row.cancelRequested) return { proceed: false, reason: 'cancel-requested' }

        // `claimed` and `running` are the two live statuses. Anything else —
        // `interrupted` from a sweep, or a terminal status written by something
        // that concluded this run was over — means the row this worker is
        // acting under no longer describes a live run.
        if (row.status !== 'claimed' && row.status !== 'running') {
          return { proceed: false, reason: 'run-ended' }
        }

        return { proceed: true }
      },
    }
  }

  const done = (async () => {
    let lastSweptAtMs = deps.now().getTime()
    const swept = await deps.sweepExpiredLeases(deps.now())
    if (swept > 0) log(`swept ${swept} orphaned run(s) from a previous life`)

    let runsCompleted = 0

    while (!stopping) {
      if (options.maxRuns !== undefined && runsCompleted >= options.maxRuns) break

      const now = deps.now()
      const claimed = await deps.claimNext({
        leaseUntil: new Date(now.getTime() + leaseMs),
        startedAt: now,
        claimedBy: workerId,
      })

      if (!claimed) {
        /**
         * Nothing to do, so sweep — but not on every poll.
         *
         * The idle poll is a second by default and sweeping every second would
         * be a write-heavy no-op loop against a file somebody's editor is also
         * touching. `sweepEveryMs` bounds it, and the only thing it delays is
         * an expiry that is already twenty-four hours old.
         */
        if (now.getTime() - lastSweptAtMs >= sweepEveryMs) {
          lastSweptAtMs = now.getTime()
          const reaped = await deps.sweepExpiredLeases(now)
          if (reaped > 0) log(`swept ${reaped} run(s) while idle`)
        }

        await deps.sleep(idlePollMs)
        continue
      }

      log(`claimed ${claimed.id}`)

      /**
       * The admission check, before the loop and not inside it.
       *
       * A continuation whose shift already ended must NOT enter the loop, plan,
       * propose, and be refused — that produces a run which appears to resume
       * and then silently does nothing, and the person's only evidence that
       * their answer was heard is a refusal row written in the gate's
       * vocabulary. `admit` completes the run and writes the sentence instead.
       *
       * It still counts toward `runsCompleted`: a run was claimed and settled,
       * and a `maxRuns` that ignored settlements would spin forever on a queue
       * full of them.
       */
      let admission: RunAdmission
      try {
        admission = await deps.admit(claimed.id)
      } catch (error) {
        // Admission that throws is treated as "do not start". A run we cannot
        // decide about is a run we do not put a browser in the hands of.
        log(
          `run ${claimed.id} not admitted: ${error instanceof Error ? error.message : String(error)}`,
        )
        runsCompleted += 1
        continue
      }

      if (admission === 'settled') {
        log(`run ${claimed.id} settled without starting`)
        runsCompleted += 1
        continue
      }

      try {
        await deps.execute(claimed.id, fenceFor(claimed.id))
      } catch (error) {
        // A run that throws is a failed run, not a dead worker. The ledger
        // already holds what it was attempting.
        log(`run ${claimed.id} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      runsCompleted += 1
    }

    return { runsCompleted }
  })()

  return {
    done,
    workerId,
    stop() {
      stopping = true
    },
  }
}

/**
 * Wire cooperative shutdown to signals.
 *
 * Explicitly exits. Installing a handler removes Node's default exit, so
 * omitting this line is how you get a worker you cannot kill.
 */
export function installSignalHandlers(handle: WorkerProcessHandle, exit: (code: number) => void): () => void {
  const onSignal = () => {
    handle.stop()
    handle.done.then(
      () => exit(0),
      () => exit(1),
    )
  }

  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)

  return () => {
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
  }
}
