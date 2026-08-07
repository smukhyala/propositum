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
 */

export interface WorkerProcessDeps {
  /** Reap orphans from a previous life. Runs once, before any claim. */
  sweepExpiredLeases(now: Date): Promise<number>
  /** Claim the oldest pending run, or null. */
  claimNext(lease: { leaseUntil: Date; startedAt: Date }): Promise<{ id: string } | null>
  /** Execute one claimed run to completion. */
  execute(runId: string): Promise<void>
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
}

const DEFAULT_LEASE_MS = 60_000
const DEFAULT_IDLE_POLL_MS = 1_000

export interface WorkerProcessHandle {
  /** Drain until stopped. Resolves when the loop exits. */
  readonly done: Promise<{ runsCompleted: number }>
  /** Cooperative shutdown — finishes the run in flight, then exits. Never
   *  abandons an action mid-flight, which would leave an intent with no
   *  outcome and be indistinguishable from a crash. */
  stop(): void
}

export function startWorkerProcess(
  deps: WorkerProcessDeps,
  options: WorkerProcessOptions = {},
): WorkerProcessHandle {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS
  const idlePollMs = options.idlePollMs ?? DEFAULT_IDLE_POLL_MS
  const log = deps.log ?? (() => undefined)

  let stopping = false

  const done = (async () => {
    const swept = await deps.sweepExpiredLeases(deps.now())
    if (swept > 0) log(`swept ${swept} orphaned run(s) from a previous life`)

    let runsCompleted = 0

    while (!stopping) {
      if (options.maxRuns !== undefined && runsCompleted >= options.maxRuns) break

      const now = deps.now()
      const claimed = await deps.claimNext({
        leaseUntil: new Date(now.getTime() + leaseMs),
        startedAt: now,
      })

      if (!claimed) {
        await deps.sleep(idlePollMs)
        continue
      }

      log(`claimed ${claimed.id}`)
      try {
        await deps.execute(claimed.id)
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
