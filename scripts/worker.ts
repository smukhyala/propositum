/**
 * The worker process.
 *
 *   npm run worker
 *
 * A separate long-lived Node process, per ADR-0001. Its lifetime is decoupled
 * from the browser and the Next server, which is the only way "work continues
 * after you leave" can be true.
 *
 * Run it alongside `npm run dev`. Without it, pressing Take over enqueues a run
 * that nobody drains and the session stays `away` forever — which was exactly
 * the state the review caught.
 */

import { randomBytes } from 'node:crypto'
import { createDatabase } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { AnthropicModelClient } from '../src/model/anthropic'
import { startWorkerProcess, installSignalHandlers } from '../src/runtime/worker-process'
import { executeRun } from '../src/server/execute-run'
import { admitRun, expireConfirmations, sweepAbandonedIntents } from '../src/server/confirmations'
import { createPlaywrightFetcher } from '../src/policy/playwright-fetcher'
import { sweepActionEvidence } from '../src/server/evidence-sweep'

try {
  process.loadEnvFile('.env')
} catch {
  /* the key may come from the environment */
}

const apiKey = process.env['ANTHROPIC_API_KEY']
if (!apiKey) {
  console.error('No ANTHROPIC_API_KEY. The worker needs one to run a shift.')
  process.exit(1)
}

// The worker creates its OWN database handle. It never imports src/server/db,
// which memoises one for the Next process — two processes, two lifetimes.
const db = await createDatabase({})
const ctx = {
  db,
  repos: createRepositories(db.prisma),
  ledger: createLedgerWriter(db.prisma),
}

/**
 * The worker's own browser — its own process, a fresh ephemeral context per
 * fetch, no credentials (ADR-0002). Never the person's browser: a shared one
 * would put the worker one click from acting inside their authenticated
 * session.
 *
 * The allowlist is applied per run in executeRun, from that contract's approved
 * sources, so this fetcher is never handed an unrestricted one.
 */
const fetcher = await createPlaywrightFetcher({})

/**
 * The ActionEvidence retention sweep, wired to something that actually runs.
 *
 * The worker process is the natural home: it is the only long-lived process
 * Propositum owns, it is already where the orphaned-lease sweep happens, and it
 * is the process that CREATED these rows in the first place.
 *
 * On startup AND on an interval, and both halves are needed. Startup alone
 * would mean a worker left running for a fortnight never sweeps again, so the
 * published window would hold on a machine that restarts and quietly not hold
 * on one that does not — the worst shape a privacy promise can take, because
 * the failure is invisible on the machine you are testing on. The interval
 * alone would mean evidence from a crashed previous life waits an hour.
 *
 * `unref` so a pending timer cannot keep the process alive after ctrl-c. A
 * retention sweep is not a reason to refuse to exit.
 *
 * This is deliberately NOT wired into `startWorkerProcess`'s deps. That
 * interface is a run-draining loop; retention is a different concern with a
 * different clock, and threading it through would have coupled two things whose
 * only relationship is that they happen in the same process.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function sweepEvidence(): Promise<void> {
  try {
    const result = await sweepActionEvidence({ evidence: ctx.repos.evidence, now: () => new Date() })
    if (result.deleted > 0) {
      console.log(
        `[worker] swept ${result.deleted} action evidence row(s) — ` +
          `${result.settled.deleted} settled, ${result.expired.deleted} past the window`,
      )
    }
  } catch (error) {
    // A failed sweep is not a failed worker. Runs must keep draining, and the
    // next pass is an hour away.
    console.error(`[worker] evidence sweep failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

await sweepEvidence()
setInterval(() => void sweepEvidence(), SWEEP_INTERVAL_MS).unref()

const handle = startWorkerProcess(
  {
    /**
     * Two sweeps, not one.
     *
     * The lease sweep reaps orphans — runs whose worker died holding them.
     * `expireConfirmations` reaps the other stuck state, which the lease sweep
     * structurally cannot see: a run parked on `awaiting-confirmation` holds NO
     * lease, on purpose, because a run waiting overnight for an answer must not
     * be reaped as an orphan and must not hold a claim while somebody reads. So
     * without this line a question nobody answered leaves a shift with no
     * ending and no re-entry note, forever.
     *
     * It writes no `ConfirmationVerdict`. Expiry never approves.
     */
    sweepExpiredLeases: async (now) => {
      const expired = await expireConfirmations(ctx, now)
      if (expired > 0) console.log(`[worker] ${expired} unanswered question(s) timed out`)

      const swept = await ctx.repos.runs.sweepExpiredLeases(now)

      /**
       * Last, and after the lease sweep on purpose.
       *
       * A worker killed mid-click leaves an `ActionIntent` with no
       * `ActionOutcome`. Running this AFTER the lease sweep means the runs it
       * abandoned are already terminal, so their stranded intents are in scope
       * on this pass rather than the next one. Running it before would leave
       * every crash reported as `unknown` for one extra restart.
       */
      const settled = await sweepAbandonedIntents(ctx)
      if (settled > 0) console.log(`[worker] recorded ${settled} unfinished action(s) as unverified`)

      return swept
    },
    /**
     * ── The token is minted HERE, because this is where a process takes a run ─
     *
     * `runs.claim` documents the token as minted at claim and takes it as an
     * OPTIONAL parameter — so the mint site is whoever claims, and this is the
     * only thing that does. Until this line it was passed by nobody, which left
     * `AgentRun.controlToken` null on every run in production while the comment
     * beside it read as proof a fence existed. A credential the schema
     * describes and no code issues is worse than none.
     *
     * `randomBytes` rather than `randomUUID`: a UUID is an identifier that
     * happens to be hard to guess, and this is a bearer secret. The distinction
     * matters the day somebody logs one.
     *
     * It is not an authorization — the gate still decides every action. It
     * answers one question for the control channel: *is this the run the
     * extension agreed to take instructions from.* Its lifetime is the claim's;
     * `complete`, `sweepExpiredLeases` and the confirmation paths clear it.
     */
    claimNext: (lease) =>
      ctx.repos.runs.claim({ ...lease, controlToken: randomBytes(32).toString('base64url') }),
    /** The coordinator's decision, at the only point it can be honoured: a
     *  continuation whose shift already ended never enters the loop. */
    admit: (runId) => admitRun(ctx, runId, new Date()),
    readRun: async (runId) => {
      const run = await ctx.repos.runs.byId(runId)
      if (!run) return null
      return {
        status: run.status,
        claimedBy: run.claimedBy,
        cancelRequested: run.cancelRequested,
      }
    },
    // The fence is threaded straight through. It is closed over this run's id
    // and this process's identity, so the executor can neither ask about
    // another run nor answer the question itself.
    execute: (runId, fence) =>
      executeRun(runId, {
        fence,
        ctx,
        model: new AnthropicModelClient({ apiKey }),
        fetcher,
        now: () => Date.now(),
      }),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (message) => console.log(`[worker] ${message}`),
  },
  {},
)

// Explicitly exits. Installing a handler removes Node's default exit, and
// omitting the exit is how you get a worker you cannot kill.
installSignalHandlers(handle, (code) => {
  // Close the browser too, or chromium outlives the worker — Node never kills
  // its children, which is the same default that makes orphaned runs possible.
  void Promise.allSettled([fetcher.close(), db.close()]).then(() => process.exit(code))
})

console.log('[worker] draining runs — ctrl-c to stop')
await handle.done
