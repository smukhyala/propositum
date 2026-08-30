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
import { SchemaBehindError } from '../src/persistence/append-only'
import { EX_CONFIG } from '../src/runtime/exit-codes'
import { createRepositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { createModelClient } from '../src/model/provider'
import { startWorkerProcess, installSignalHandlers } from '../src/runtime/worker-process'
import { executeRun } from '../src/server/execute-run'
import { admitRun, expireConfirmations, sweepAbandonedIntents } from '../src/server/confirmations'
import { readReplies, sayWhatIsOutstanding } from '../src/server/thread'
import { createPlaywrightFetcher } from '../src/policy/playwright-fetcher'
import { sweepActionEvidence } from '../src/server/evidence-sweep'
import { sweepReticence } from '../src/server/reticence-sweep'

try {
  process.loadEnvFile('.env')
} catch {
  /* the key may come from the environment */
}

/**
 * ~~No key, no worker.~~ **Amended 2026-08-26: no key, no SHIFTS.**
 *
 * The hard exit was right while the worker only drained runs. It stopped being
 * right when the phone thread landed on this process's tick
 * ([ADR-0021](../docs/adr/0021-a-thread-on-the-persons-phone.md)): nothing about
 * saying *"a shift ended"* or *"I need a decision"* reaches a model, so a keyless
 * install was one where a person could pair a phone on `/first-run` and it would
 * never say anything, with nothing anywhere explaining why. That is the swallowed
 * notification again, one process out.
 *
 * The shape is the one `src/server/calendar.ts` already uses for a missing client
 * id: **the feature is absent, not broken.** With no key this process starts,
 * tends the thread, and claims no runs — and says so once rather than dying.
 * `/first-run` tells the person what to add and what is missing until they
 * do, so the two halves agree about the same fact.
 */
/**
 * Normalised once, because three places ask about it and they must agree.
 *
 * `ANTHROPIC_API_KEY=` with nothing after it — which is what `.env.example`
 * ships and what a half-finished setup looks like — is an empty STRING, not
 * `undefined`. The startup check below is `!apiKey` and catches it; a later
 * `apiKey === undefined` does not. Measured: with the variable set and empty,
 * the process correctly said it had no key and then correctly reported itself
 * draining runs, which are two different answers to one question.
 *
 * So it is `undefined` or a real key, and nothing in between reaches the rest of
 * this file.
 */
const apiKey = process.env['ANTHROPIC_API_KEY']?.trim() || undefined
if (apiKey === undefined) {
  console.log('[worker] No ANTHROPIC_API_KEY, so no shift can run. Set one in .env — see /first-run.')
  console.log('[worker] Staying up anyway: a paired phone still gets what happened and what needs deciding.')
}

/**
 * The worker creates its OWN database handle. It never imports src/server/db,
 * which memoises one for the Next process — two processes, two lifetimes.
 *
 * ── Why this one failure is caught and the rest are not ──────────────────
 *
 * `createDatabase` installs and verifies the append-only guards, and there are
 * two ways that ends badly. A guard that will not install means the ledger is
 * unprotected and this process must die loudly with everything it knows. A
 * MISSING TABLE means somebody has not run `npx prisma db push` since the schema
 * changed — a setup step, with a one-line fix, and an unhandled rejection is the
 * worst possible way to deliver one.
 *
 * Measured before this existed: three crash-loops, three walls of minified
 * Prisma client, and the actual instruction appearing nowhere in the output.
 */
let db: Awaited<ReturnType<typeof createDatabase>>
try {
  db = await createDatabase({})
} catch (error) {
  if (error instanceof SchemaBehindError) {
    console.error(`[worker] ${error.message}`)
    // EX_CONFIG. Restarting cannot fix a table that does not exist, and
    // `scripts/dev.ts` reads this code as "do not try again" — so the
    // instruction above is printed once instead of three times.
    process.exit(EX_CONFIG)
  }
  throw error
}
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
 * The retention sweeps, wired to something that actually runs.
 *
 * Two of them — ActionEvidence and reticence — sharing one interval and one
 * process, and nothing else. Each has its own `try` below, for the reason
 * `sweepStaleDeclines` argues.
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
    const result = await sweepActionEvidence({
      evidence: ctx.repos.evidence,
      now: () => new Date(),
    })
    if (result.deleted > 0) {
      console.log(
        `[worker] swept ${result.deleted} action evidence row(s) — ` +
          `${result.settled.deleted} settled, ${result.expired.deleted} past the window`,
      )
    }
  } catch (error) {
    // A failed sweep is not a failed worker. Runs must keep draining, and the
    // next pass is an hour away.
    console.error(
      `[worker] evidence sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * The reticence sweep, in its own `try` — which is the whole point of it being
 * a second function.
 *
 * These two sweeps shared one `try` and it was the wrong shape. A throw from
 * `sweepActionEvidence` jumped past `sweepReticence` entirely, so an evidence
 * sweep that failed every hour — a locked database, a migration half-applied,
 * anything durable — would silently stop declines decaying, and the only thing
 * on the console would say the EVIDENCE sweep failed. ADR-0020's thirty days is
 * a promise that a person stops paying for a "not now" eventually; converting it
 * into permanent silence as a side effect of an unrelated failure, with no line
 * saying so, is exactly the invisible retention failure the interval above
 * exists to prevent.
 *
 * So: one `try` each, one message each, and both run on every pass whatever the
 * other one did.
 */
async function sweepStaleDeclines(): Promise<void> {
  try {
    const reticence = await sweepReticence({
      reticence: ctx.repos.reticence,
      now: () => new Date(),
    })
    if (reticence.deleted > 0) {
      console.log(`[worker] forgot ${reticence.deleted} stale decline(s)`)
    }
  } catch (error) {
    console.error(
      `[worker] decline sweep failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/** Both retention sweeps, on one clock and independent of each other. Awaited
 *  in sequence rather than raced because they share one SQLite file and neither
 *  is urgent. */
async function sweepRetention(): Promise<void> {
  await sweepEvidence()
  await sweepStaleDeclines()
}

await sweepRetention()
setInterval(() => void sweepRetention(), SWEEP_INTERVAL_MS).unref()

/**
 * How often the phone is told anything. ADR-0021.
 *
 * ── Why this is a second clock and not a deps entry ──────────────────────
 *
 * The same argument `SWEEP_INTERVAL_MS` makes above, and it lands the same way.
 * `startWorkerProcess`'s deps are a run-draining loop; this is a channel, with a
 * different cadence and no relationship to draining beyond sharing a process.
 *
 * It is also the only shape that WORKS here. The loop's idle branch is the only
 * place a deps entry could hang, and the idle branch is reached exactly when
 * `claimNext` returns nothing — so a feed wired there goes quiet for the whole
 * of a shift, which is precisely the window in which a run stops to ask a
 * question. A confirmation raised at minute three would be announced whenever
 * the run finally ended, which is the opposite of the point.
 *
 * Five seconds. Not one, because nothing here is urgent enough to poll a third
 * party twelve times a minute, and every pass costs one indexed insert per
 * outstanding message that has already been said. Not a minute, because
 * `CONFIRMATION_EXPIRY_HOURS` is counting from the moment a run parks and the
 * person is not at the desk.
 */
const THREAD_INTERVAL_MS = 5_000

/**
 * Say what is outstanding, and read what came back.
 *
 * Its own `try`, for the reason the two retention sweeps have one each: a throw
 * from the send would jump past the read, so a provider that is refusing sends —
 * a revoked token, a blocked bot — would silently stop answers being collected
 * too, and the only line on the console would be about sending.
 *
 * Both halves are no-ops when nothing is paired, which is the ordinary state.
 *
 * `offerOpen` is null here and that is not a gap. A composed offer lives in the
 * Next app process's memory and ADR-0008 refuses it a row, so this process
 * genuinely cannot see one — a `yes` arriving on this feed is `unrecognised`,
 * which is the honest answer from a process with nothing to accept.
 */
async function tendTheThread(): Promise<void> {
  try {
    const said = await sayWhatIsOutstanding(ctx, Date.now())
    if (said > 0) console.log(`[worker] said ${said} thing(s) on the thread`)
  } catch (error) {
    console.error(
      `[worker] could not reach the thread: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    const heard = await readReplies(ctx, Date.now())
    if (heard.answered > 0) console.log(`[worker] recorded ${heard.answered} answer(s) from the thread`)
  } catch (error) {
    console.error(
      `[worker] could not read the thread: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

setInterval(() => void tendTheThread(), THREAD_INTERVAL_MS).unref()

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
      if (settled > 0)
        console.log(`[worker] recorded ${settled} unfinished action(s) as unverified`)

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
      /**
       * With no key, nothing is ever claimed — so `execute` below is
       * unreachable and the loop idles for ever, which is exactly what a worker
       * that cannot run a shift should do.
       *
       * Refusing HERE rather than at startup is what keeps the rest of this
       * process alive: the thread interval below needs no model, and a keyless
       * install that could not tell a person their shift ended was the bug this
       * replaced. A run enqueued in that state simply waits, and the moment a
       * key appears and this process restarts, it is drained.
       */
      apiKey === undefined
        ? Promise.resolve(null)
        : ctx.repos.runs.claim({ ...lease, controlToken: randomBytes(32).toString('base64url') }),
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
    // A client per run, not per process, and that is the point: the run id is
    // only in scope here, and it is what makes this the ONE construction site
    // whose `ModelCallRecord` rows can be joined back to what they were for.
    // The other four call sites have no run to name.
    execute: (runId, fence) => {
      // Unreachable without a key, because `claimNext` above hands back nothing.
      // Narrowed rather than asserted: the day somebody changes that refusal,
      // this is a compile error instead of a client built with `undefined`.
      if (apiKey === undefined) {
        throw new Error('a run was claimed with no ANTHROPIC_API_KEY — claimNext should have refused')
      }
      return executeRun(runId, {
        fence,
        ctx,
        model: createModelClient({ apiKey, runId, record: ctx.repos.modelCalls.create }),
        fetcher,
        now: () => Date.now(),
      })
    },
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

console.log(
  apiKey === undefined
    ? '[worker] up, tending the thread. Not draining runs — there is no key.'
    : '[worker] draining runs — ctrl-c to stop',
)
await handle.done
