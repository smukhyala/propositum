/**
 * The control channel, end to end, with `fetch` standing in for the extension.
 *
 * Both ends of this channel are HTTP, so the whole thing is provable headlessly:
 * the route handlers are called with real `Request` objects against a real
 * SQLite database, and the "extension" is a few lines of test code that polls
 * and reports. Nothing here mocks the part that matters — the guarded UPDATE is
 * the real one, and the race below is a real race.
 *
 * The most important assertion in the file is the second one: **two pollers must
 * never receive the same instruction.** A redelivered instruction is a second
 * click on someone's live page, so this is not a queue-hygiene test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { POST as dispatchRoute } from '../src/app/api/act/dispatch/route'
import { GET as nextRoute } from '../src/app/api/act/next/route'
import { POST as reportRoute } from '../src/app/api/act/report/route'
import { POST as haltRoute } from '../src/app/api/act/halt/route'
import { CONTROL_HEADER, MIN_HOLD_MS, admitControl, dispatchRequestSchema } from '../src/act/channel'
import { appContext } from '../src/server/db'
import type { AppContext } from '../src/server/db'

const EXTENSION_ID = 'aaaabbbbccccddddeeeeffffgggghhhh'
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`
const TOKEN = 'a-control-token-that-is-long-enough'

let dir: string
let ctx: AppContext
let contractId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-act-'))
  const url = `file:${join(dir, 'test.db')}`

  process.env['DATABASE_URL'] = url
  process.env['PROPOSITUM_EXTENSION_ID'] = EXTENSION_ID
  // Shortens this process's own poll so a test proving the LOSER gets nothing
  // does not have to sit through twenty-five seconds. The route clamps it to
  // POLL_TIMEOUT_MS, so it can only ever bring the answer forward.
  process.env['PROPOSITUM_ACT_POLL_MS'] = '1500'

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  ctx = await appContext()

  const project = await ctx.repos.projects.create('acting')
  const content = 'A document.'
  const doc = await ctx.repos.documents.create({
    projectId: project.id,
    title: 'a doc',
    content,
    contentHash: createHash('sha256').update(content).digest('hex'),
  })
  const session = await ctx.repos.sessions.start(project.id)
  const reading = await ctx.repos.readings.create({
    sessionId: session.id,
    throughSeq: 0,
    claims: [],
  })
  const contract = await ctx.repos.contracts.createDraft({
    sessionId: session.id,
    readingId: reading.id,
    objective: 'act in the browser',
    definitionOfDone: 'the thing is done',
    guidance: [],
    approvedSourceIds: [],
    allowedActionKinds: ['observe-page', 'click-element'],
    baseVersionId: doc.versionId,
    initiative: 'follow-closely',
    progress: 'current-step-only',
    output: 'suggestions-only',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  })
  contractId = contract.id
}, 120_000)

afterAll(async () => {
  await ctx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/* ── fixtures ──────────────────────────────────────────────────────────── */

let seq = 0

/** A run that holds a control token and is in a state that may still act. */
async function actingRun(): Promise<string> {
  const run = await ctx.repos.runs.enqueue({
    contractId,
    role: 'worker',
    controlToken: TOKEN,
  })
  await ctx.db.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'running' } })
  return run.id
}

/** An authorized intent, written and committed before anything is dispatched —
 *  the dispatch row's foreign key, and the append-only record of the attempt. */
async function intentFor(runId: string): Promise<string> {
  seq += 1
  const row = await ctx.db.prisma.actionIntent.create({
    data: {
      runId,
      seq,
      kind: 'observe-page',
      reason: 'look at the page',
      params: {},
      authorized: true,
    },
    select: { id: true },
  })
  return row.id
}

function workerRequest(body: unknown, overrides: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:3117/api/act/dispatch', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CONTROL_HEADER]: '1',
      authorization: `Bearer ${TOKEN}`,
      ...overrides,
    },
    body: JSON.stringify(body),
  })
}

function extensionGet(overrides: Record<string, string> = {}): Request {
  return new Request('http://127.0.0.1:3117/api/act/next', {
    method: 'GET',
    headers: { [CONTROL_HEADER]: '1', origin: EXTENSION_ORIGIN, ...overrides },
  })
}

function extensionPost(path: string, body: unknown, overrides: Record<string, string> = {}): Request {
  return new Request(`http://127.0.0.1:3117${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CONTROL_HEADER]: '1',
      origin: EXTENSION_ORIGIN,
      ...overrides,
    },
    body: JSON.stringify(body),
  })
}

const observation = {
  snapshotId: 's1',
  url: 'https://example.test/orders',
  title: 'Orders',
  tree: 'e12 button "Track shipment"',
  truncated: false,
}

function dispatchBody(runId: string, intentId: string, timeoutMs = 8_000) {
  return { runId, intentId, kind: 'observe-page', params: { snapshotId: 's1' }, timeoutMs }
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

/* ── the round trip ────────────────────────────────────────────────────── */

describe('an instruction reaches the browser and the report comes back', () => {
  it('hands the command out exactly once and settles the held response', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    // Not awaited: this response is held open until the report arrives.
    const held = dispatchRoute(workerRequest(dispatchBody(runId, intentId)))

    const polled = await json(await nextRoute(extensionGet()))
    expect(polled['command']).toMatchObject({ intentId, kind: 'observe-page' })

    // The row moved under the guarded UPDATE, which is the durable half of the
    // handover. The held response is the convenience.
    const row = await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { intentId } })
    expect(row.status).toBe('delivered')
    expect(row.deliveredAt).not.toBeNull()

    const reported = await json(
      await reportRoute(extensionPost('/api/act/report', { intentId, ok: true, observation })),
    )
    expect(reported['ok']).toBe(true)

    const answer = await json(await held)
    expect(answer).toEqual({ ok: true, report: { ok: true, observation } })

    const settled = await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { intentId } })
    expect(settled.status).toBe('reported')

    // The tree went into the SECOND ledger, through its one door. The route
    // does not write the row itself: `appendEvidence` is what datamarks the
    // page-authored text and cleans the browser-attested URL.
    const evidence = await ctx.db.prisma.actionEvidence.findMany({ where: { intentId } })
    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.kind).toBe('page-snapshot')
    expect(evidence[0]?.untrusted).not.toBeNull()
  }, 20_000)

  it('refuses an intent the gate did not authorize, or one belonging to another run', async () => {
    // "The gate already authorised it" has to be a read, not an assumption. A
    // worker whose next move is chosen by a model could otherwise name a
    // REFUSED intent and have the channel carry it to a live page.
    const runId = await actingRun()
    const refused = await ctx.db.prisma.actionIntent.create({
      data: {
        runId,
        seq: 900 + (seq += 1),
        kind: 'observe-page',
        reason: 'look',
        params: {},
        authorized: false,
        refusedRule: 'action_kind_not_allowed',
      },
      select: { id: true },
    })

    expect(
      await json(await dispatchRoute(workerRequest(dispatchBody(runId, refused.id)))),
    ).toMatchObject({ ok: false, failure: 'not-delivered' })

    // Another run's intent, presented with this run's token.
    const otherRun = await actingRun()
    const otherIntent = await intentFor(otherRun)

    expect(
      await json(await dispatchRoute(workerRequest(dispatchBody(runId, otherIntent)))),
    ).toMatchObject({ ok: false, failure: 'not-delivered' })

    // And a kind the intent row does not record.
    const intentId = await intentFor(runId)
    const mismatched = { ...dispatchBody(runId, intentId), kind: 'click-element' }

    expect(await json(await dispatchRoute(workerRequest(mismatched)))).toMatchObject({
      ok: false,
      failure: 'not-delivered',
    })

    expect(await ctx.db.prisma.actionDispatch.count({ where: { runId } })).toBe(0)
  }, 20_000)

  it('abandons an orphan sitting ahead of the instruction someone is waiting for', async () => {
    // An app restart leaves a `queued` row whose worker is gone. Handing it out
    // later clicks something for an instruction nobody is waiting on, so the
    // poll drains it instead — and `abandon` refuses a delivered row, so this
    // can never erase a record of something that was handed out.
    const runId = await actingRun()
    const orphanIntent = await intentFor(runId)
    const orphan = await ctx.repos.dispatches.enqueue({
      runId,
      intentId: orphanIntent,
      kind: 'observe-page',
      params: {},
    })

    const intentId = await intentFor(runId)
    const held = dispatchRoute(workerRequest(dispatchBody(runId, intentId, 6_000)))

    const polled = await json(await nextRoute(extensionGet()))
    expect(polled['command']).toMatchObject({ intentId })

    expect(
      (await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { id: orphan.id } })).status,
    ).toBe('abandoned')

    await reportRoute(extensionPost('/api/act/report', { intentId, ok: true, observation }))
    await held
  }, 20_000)

  it('never hands the same command to two pollers', async () => {
    // The assertion this whole file exists for. Both pollers see the same queued
    // row; the conditional UPDATE decides, and the loser gets nothing rather
    // than a second copy of an instruction that clicks something.
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    void dispatchRoute(workerRequest(dispatchBody(runId, intentId, 4_000)))

    const [a, b] = await Promise.all([
      nextRoute(extensionGet()).then(json),
      nextRoute(extensionGet()).then(json),
    ])

    const commands = [a['command'], b['command']].filter((command) => command !== null)
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ intentId })
  }, 20_000)
})

/* ── what happens when the browser says nothing ────────────────────────── */

describe('a dispatch that is never answered', () => {
  it('resolves as not-delivered when no browser ever took it', async () => {
    // Nothing polls. The instruction never left this process, so nothing
    // happened in anyone's browser and the channel says exactly that.
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const answer = await json(
      await dispatchRoute(workerRequest(dispatchBody(runId, intentId, MIN_HOLD_MS))),
    )

    expect(answer).toEqual({
      ok: false,
      failure: 'not-delivered',
      detail: 'no browser took this instruction before the wait ended',
    })

    // Abandoned, so a later poll cannot pick it up and click something whose
    // answer nobody is waiting for.
    const row = await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { intentId } })
    expect(row.status).toBe('abandoned')
  }, 20_000)

  it('resolves as not-reported once a browser has taken it, and never redelivers', async () => {
    // The honest unknown. The instruction is out there; it may have run.
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const held = dispatchRoute(workerRequest(dispatchBody(runId, intentId, MIN_HOLD_MS)))
    const polled = await json(await nextRoute(extensionGet()))
    expect(polled['command']).toMatchObject({ intentId })

    const answer = await json(await held)
    expect(answer).toEqual({
      ok: false,
      failure: 'not-reported',
      detail: 'the browser took this instruction and did not report back',
    })

    // Still `delivered` — never abandoned, because a row saying `abandoned` over
    // an effect that landed reads as "nothing happened".
    const row = await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { intentId } })
    expect(row.status).toBe('delivered')

    // And it is not handed out a second time.
    const again = await json(await nextRoute(extensionGet()))
    expect(again['command']).toBeNull()
  }, 20_000)

  it('tells a reporting extension plainly when nobody is waiting', async () => {
    const answer = await json(
      await reportRoute(
        extensionPost('/api/act/report', { intentId: 'never-dispatched', ok: true, observation }),
      ),
    )

    expect(answer['reason']).toBe('nobody-waiting')
  })
})

/* ── stopping ──────────────────────────────────────────────────────────── */

describe('halting', () => {
  it('settles held dispatches as control-lost and flags the run', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const held = dispatchRoute(workerRequest(dispatchBody(runId, intentId, 20_000)))
    // Let the dispatch reach its hold before the halt arrives.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const halted = await json(
      await haltRoute(extensionPost('/api/act/halt', { runId, reason: 'the person clicked stop' })),
    )
    expect(halted).toMatchObject({ ok: true, settled: 1, flagged: true })

    const answer = await json(await held)
    expect(answer).toMatchObject({ ok: false, failure: 'control-lost' })

    const run = await ctx.repos.runs.byId(runId)
    expect(run?.cancelRequested).toBe(true)

    // Settling the socket is only half of stopping: a row left `queued` is the
    // instruction a later poll would hand to a browser after the person pressed
    // Stop.
    const row = await ctx.db.prisma.actionDispatch.findUniqueOrThrow({ where: { intentId } })
    expect(row.status).toBe('abandoned')
  }, 20_000)

  it('answers a later dispatch immediately rather than holding a socket open', async () => {
    const runId = await actingRun()
    await haltRoute(extensionPost('/api/act/halt', { runId, reason: 'detached' }))

    const intentId = await intentFor(runId)
    const started = Date.now()
    const answer = await json(
      await dispatchRoute(workerRequest(dispatchBody(runId, intentId, 20_000))),
    )

    expect(answer).toMatchObject({ ok: false, failure: 'control-lost' })
    expect(Date.now() - started).toBeLessThan(1_000)
  }, 20_000)
})

/* ── the four controls ─────────────────────────────────────────────────── */

describe('every transport control refuses', () => {
  it('refuses a body that is not application/json', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const response = await dispatchRoute(
      workerRequest(dispatchBody(runId, intentId), { 'content-type': 'text/plain' }),
    )

    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ detail: 'bad-content-type' })
  })

  it('refuses a request without the custom header', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const request = new Request('http://127.0.0.1:3117/api/act/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(dispatchBody(runId, intentId)),
    })

    expect(await json(await dispatchRoute(request))).toMatchObject({
      detail: 'missing-custom-header',
    })
  })

  it('refuses a foreign Origin on the extension half', async () => {
    const response = await nextRoute(extensionGet({ origin: 'https://evil.example' }))

    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ reason: 'bad-origin' })
  })

  it('refuses a bad bearer token on the worker half', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)

    const response = await dispatchRoute(
      workerRequest(dispatchBody(runId, intentId), { authorization: 'Bearer not-the-token' }),
    )

    expect(response.status).toBe(403)
    expect(await json(response)).toMatchObject({ failure: 'not-delivered', detail: 'bad-token' })

    // Refused at the door means no row: the service worker never saw it.
    expect(await ctx.db.prisma.actionDispatch.findUnique({ where: { intentId } })).toBeNull()
  })

  it('refuses a run whose token has been cleared, and a run that has ended', async () => {
    const runId = await actingRun()
    const intentId = await intentFor(runId)
    await ctx.db.prisma.agentRun.update({ where: { id: runId }, data: { status: 'succeeded' } })

    expect(
      await json(await dispatchRoute(workerRequest(dispatchBody(runId, intentId)))),
    ).toMatchObject({ detail: 'bad-token' })
  })

  it('accepts the extension when Chrome sends no Origin at all', () => {
    // The trap from the capture transport, which applies identically here:
    // granting the loopback host permission makes Chrome DROP the Origin
    // header, so requiring it would refuse the only legitimate caller.
    const admission = admitControl(
      { headers: { [CONTROL_HEADER]: '1', 'sec-fetch-site': 'none' }, body: null },
      { from: 'extension', expectedOrigin: EXTENSION_ORIGIN },
      { kind: 'none' },
    )

    expect(admission.ok).toBe(true)
  })

  it('refuses a body that does not match the envelope', () => {
    const admission = admitControl(
      {
        headers: {
          'content-type': 'application/json',
          [CONTROL_HEADER]: '1',
          authorization: `Bearer ${TOKEN}`,
        },
        body: { runId: 'r', intentId: 'i', kind: 'read-document', params: {}, timeoutMs: 10 },
      },
      { from: 'worker', controlToken: TOKEN },
      { kind: 'json', schema: dispatchRequestSchema },
    )

    // `read-document` is a real ActionKind and is not a thing a browser does.
    // The channel carries the six that drive a page and refuses the rest here,
    // rather than handing the extension a kind it has no code for.
    expect(admission).toEqual({ ok: false, reason: 'malformed-envelope' })
  })
})
