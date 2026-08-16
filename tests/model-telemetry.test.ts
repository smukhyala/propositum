/**
 * `ModelCallRecord`'s first caller, held to what it claims.
 *
 * ── What was untested, and how that was found ────────────────────────────
 *
 * The whole deliverable. Replacing `modelCallRecordRepository`'s body with
 * `create: async (row) => { void row; return { id: 'dropped' } }` — not one row
 * ever written — left `npm test` and `npm run typecheck` completely green.
 * Changing `modelId()`'s fallback from `DEFAULT_MODEL` to another model id did
 * the same, and would have moved which model every boundary in the product
 * calls. The only assertion in the repo was `tests/reachability.test.ts`'s grep
 * for the TEXT `modelCalls.create`, which proves three files mention it and
 * nothing about a row arriving.
 *
 * So there are three claims here and they are deliberately at three different
 * levels: the wiring (does `createModelClient` hand the sink a row), the write
 * (does the repository put that row in SQLite), and the configuration (is the
 * default model still the default).
 *
 * ── Why the client is exercised against a stubbed `fetch` ────────────────
 *
 * `AnthropicModelClient` constructs its own SDK, so there is no transport to
 * inject. The one seam left is `globalThis.fetch`, and a 400 is the cheapest
 * complete round trip: the SDK does not retry it, the client classifies the
 * throw as `transport`, `recoveryFor('transport')` is `none` — so exactly one
 * attempt happens and exactly one row must arrive. That is ADR-0005's rule
 * under test: *"`onCall` fires once per attempt, INCLUDING FAILURES —
 * traceability that only records successes is not traceability."* A failure is
 * also the only attempt shape reachable without inventing a model reply.
 *
 * The live contract test at `tests/model-boundary.live.test.ts` is the one that
 * exercises a real success, and `vitest.config.ts` excludes `*.live.test.ts`
 * from `npm test` — so nothing in the default suite reaches `onCall` but this.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createModelClient, modelId } from '../src/model/provider'
import type { ModelCallRow } from '../src/model/provider'
import { DEFAULT_MODEL } from '../src/model/anthropic'
import { handlesFor, sessionReadingBoundary } from '../src/model/boundaries/session-reading'
import type { PromptEvent } from '../src/model/boundaries/session-reading'
import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'

const MODEL_ENV_VAR = 'PROPOSITUM_MODEL'

/* ── the wiring ─────────────────────────────────────────────────────────── */

const events: PromptEvent[] = [
  { handle: 'E1', kind: 'visited', at: '14:02', attested: 'Northwind partnership terms' },
]

/** A 400 the SDK will not retry, whose message deliberately avoids the word the
 *  client uses to tell a local size error apart from a network one. */
function refusingFetch(): typeof globalThis.fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'no transport in tests' },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof globalThis.fetch
}

describe('a model call becomes a row, or the ledger cannot reconstruct what ran', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env[MODEL_ENV_VAR]
  })

  async function callOnce(options: { runId?: string | null }): Promise<ModelCallRow[]> {
    globalThis.fetch = refusingFetch()
    const written: ModelCallRow[] = []

    const client = createModelClient({
      apiKey: 'not-a-real-key',
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      record: async (row) => {
        written.push(row)
        return { id: 'collected' }
      },
    })

    const result = await client.run(sessionReadingBoundary(handlesFor(events)), {
      events,
      notes: [],
    })

    expect(result.ok).toBe(false)
    // The sink is fire-and-forget by design — `provider.ts` argues why at
    // length — so the write is not awaited by the call. One turn of the
    // microtask queue is all it needs, and if that ever stops being true this
    // line is where it will say so.
    await Promise.resolve()

    return written
  }

  it('writes exactly one row per attempt, carrying the boundary, the model and the failure', async () => {
    const written = await callOnce({})

    expect(written).toHaveLength(1)
    expect(written[0]?.boundary).toBe('session-reading')
    expect(written[0]?.model).toBe(DEFAULT_MODEL)
    // A failed attempt is recorded as one. This is the half that was dropped on
    // the floor for the whole build.
    expect(written[0]?.failureKind).toBe('transport')
    expect(written[0]?.repairTurns).toBe(0)
    expect(written[0]?.promptVersion).not.toBe('')
  })

  it('records a null runId for the boundaries that run before any AgentRun exists', async () => {
    // Four of the eight, two of them with no session at all. Null is ordinary
    // here, not a gap, and a row that invented a run id would be worse.
    const written = await callOnce({})

    expect(written[0]?.runId).toBeNull()
  })

  it('records the run id when the caller has one', async () => {
    const written = await callOnce({ runId: 'run-1' })

    expect(written[0]?.runId).toBe('run-1')
  })

  it('records nothing when no sink is supplied, which is the eval harness’s case', async () => {
    // `scripts/eval.ts` never opens the application database, so it passes no
    // sink. That must stay a no-op rather than a throw — omitting the hook is
    // yesterday's behaviour, and it is the one caller for which that is right.
    globalThis.fetch = refusingFetch()
    const client = createModelClient({ apiKey: 'not-a-real-key' })

    const result = await client.run(sessionReadingBoundary(handlesFor(events)), {
      events,
      notes: [],
    })

    expect(result.ok).toBe(false)
  })

  it('does not fail the call when the sink rejects', async () => {
    // The specific accident `provider.ts`'s `.catch` prevents: an unhandled
    // rejection from a telemetry write, which Node terminates the process for —
    // a worker mid-shift dying because a SQLite insert lost a race. The loss is
    // silent and `provider.ts` says so rather than claiming a mitigation.
    globalThis.fetch = refusingFetch()
    const client = createModelClient({
      apiKey: 'not-a-real-key',
      record: async () => {
        throw new Error('the database went away')
      },
    })

    const result = await client.run(sessionReadingBoundary(handlesFor(events)), {
      events,
      notes: [],
    })
    await Promise.resolve()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure).toBe('transport')
  })
})

/* ── the configuration ──────────────────────────────────────────────────── */

describe('one read decides which model runs', () => {
  const before = process.env[MODEL_ENV_VAR]

  afterEach(() => {
    if (before === undefined) delete process.env[MODEL_ENV_VAR]
    else process.env[MODEL_ENV_VAR] = before
  })

  it('is the default when nothing is configured', () => {
    // The collapse of five construction sites into one must not have moved
    // which model runs. Nothing else in the suite would notice if it had.
    delete process.env[MODEL_ENV_VAR]

    expect(modelId()).toBe(DEFAULT_MODEL)
  })

  it('honours an override', () => {
    process.env[MODEL_ENV_VAR] = 'claude-something-else'

    expect(modelId()).toBe('claude-something-else')
  })

  it('treats a blank or whitespace override as a request for the default', () => {
    // An override someone cleared in `.env` is a request for the default, never
    // a request to call a model with no name.
    process.env[MODEL_ENV_VAR] = '   '
    expect(modelId()).toBe(DEFAULT_MODEL)

    process.env[MODEL_ENV_VAR] = ''
    expect(modelId()).toBe(DEFAULT_MODEL)
  })
})

/* ── the write ──────────────────────────────────────────────────────────── */

describe('the row lands in the database', () => {
  let dir: string
  let db: Database
  let repos: Repositories

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'propositum-model-telemetry-'))
    const url = `file:${join(dir, 'test.db')}`
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    db = await createDatabase({ url })
    repos = createRepositories(db.prisma)
  }, 120_000)

  afterAll(async () => {
    await db?.close()
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const row = {
    runId: null as string | null,
    boundary: 'session-reading',
    model: DEFAULT_MODEL,
    promptVersion: 'v1',
    inputTokens: 470,
    outputTokens: 120,
    latencyMs: 1234,
    stopReason: 'end_turn' as string | null,
    failureKind: null as string | null,
    repairTurns: 0,
  }

  it('writes a row with no run, which is what four of the eight boundaries produce', async () => {
    const written = await repos.modelCalls.create(row)

    const stored = await db.prisma.modelCallRecord.findUnique({ where: { id: written.id } })

    expect(stored?.runId).toBeNull()
    expect(stored?.boundary).toBe('session-reading')
    expect(stored?.model).toBe(DEFAULT_MODEL)
    expect(stored?.inputTokens).toBe(470)
    expect(stored?.latencyMs).toBe(1234)
    expect(stored?.stopReason).toBe('end_turn')
    expect(stored?.failureKind).toBeNull()
  })

  it('writes a row against a real run, and a failed attempt is one of them', async () => {
    const project = await repos.projects.create('Telemetry')
    const session = await repos.sessions.start(project.id, null)
    const reading = await db.prisma.sessionReading.create({
      data: { sessionId: session.id, throughSeq: 1 },
      select: { id: true },
    })
    const contract = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      intentionId: null,
      objective: 'Something',
      definitionOfDone: 'Something else',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: null,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())
    const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })

    const written = await repos.modelCalls.create({
      ...row,
      runId: run.id,
      stopReason: null,
      failureKind: 'transport',
      repairTurns: 1,
    })

    const stored = await db.prisma.modelCallRecord.findUnique({ where: { id: written.id } })

    expect(stored?.runId).toBe(run.id)
    expect(stored?.failureKind).toBe('transport')
    expect(stored?.repairTurns).toBe(1)
  })
})
