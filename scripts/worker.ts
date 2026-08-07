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
import { fixtureFetcher } from '../src/policy/fetcher'

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
 * Real browsing is a Playwright process behind this same interface (ADR-0002,
 * kept separate from the human's browser). Until that lands the worker reads
 * from a fixture map, which is empty — so a read of any real source fails
 * honestly and is recorded as a failed action, rather than silently returning
 * nothing and looking like the page was blank.
 */
const fetcher = fixtureFetcher({})

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
  void db.close().then(() => process.exit(code))
})

console.log('[worker] draining runs — ctrl-c to stop')
await handle.done
