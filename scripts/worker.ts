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

import { createDatabase } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { AnthropicModelClient } from '../src/model/anthropic'
import { startWorkerProcess, installSignalHandlers } from '../src/runtime/worker-process'
import { executeRun } from '../src/server/execute-run'
import { createPlaywrightFetcher } from '../src/policy/playwright-fetcher'

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

const handle = startWorkerProcess(
  {
    sweepExpiredLeases: (now) => ctx.repos.runs.sweepExpiredLeases(now),
    claimNext: (lease) => ctx.repos.runs.claim(lease),
    execute: (runId) =>
      executeRun(runId, {
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
