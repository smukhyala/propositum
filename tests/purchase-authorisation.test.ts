/**
 * The standing fixture that must never pass FOR THE WRONG REASON.
 *
 * ADR-0024 §2 names this file; docs/todo/06 item 6 orders it written BEFORE
 * the transport branch moves. The sentence it holds: **"Find me food for
 * dinner" drafts no authorisation and therefore charges nothing** — at every
 * layer the refusal could live in, so that when item 5 lands and the network
 * block becomes conditional, every one of these assertions still passes for
 * the REAL reason rather than the boring one.
 *
 * Today (2026-09-01) the boring reason also holds: `classifyPausedRequest`
 * refuses every non-`GET` unconditionally. The last describe pins that
 * explicitly and says which commit rewrites it — it is an assertion of today's
 * truth, not of the design's end state, and docs/todo/06 item 5 is where it is
 * deliberately updated.
 *
 * The DB-backed half runs against a real SQLite file for the reason
 * `tests/accept-work-offer.test.ts` gives: the assertion that matters is about
 * a GRANT that must not exist on a durable row, and a return value alone would
 * pass against a version that granted after answering.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handoffSchema, sourceHandlesFor } from '../src/model/boundaries/handoff'
import {
  ACTION_KINDS,
  compilePolicy,
  grantableActionKinds,
} from '../src/domain/handoff/policy'
import type { AutonomyControls, ContractScope } from '../src/domain/handoff/policy'
import { authorize } from '../src/policy/gate'
import type { RunContext } from '../src/policy/gate'
import { classifyPausedRequest } from '../extension/src/cdp.js'

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

/* ── the instruction that names nothing to buy ─────────────────────────── */

const DINNER_REPLY = {
  objective: 'Find me food for dinner',
  definitionOfDone: 'A shortlist of three places exists',
  narrowedSourceHandles: ['S1'],
  suggestedTimeLimitMinutes: 30,
}

describe('an instruction naming nothing to buy authorises nothing, at every layer', () => {
  it('parses with no purchase object, and absence is the whole of the answer', () => {
    const parsed = handoffSchema(sourceHandlesFor([{ handle: 'S1' }])).safeParse(DINNER_REPLY)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect('purchase' in parsed.data).toBe(false)
  })

  it('is grantable by no default branch, whatever the shift shape', () => {
    for (const pinsDocument of [true, false]) {
      expect(grantableActionKinds(pinsDocument)).not.toContain('complete-purchase')
    }
  })

  const controls: AutonomyControls = {
    initiative: 'follow-closely',
    progress: 'current-step-only',
    output: 'draft-changes',
    interruption: 'stop-when-uncertain',
    timeLimitMinutes: 30,
  }

  const run: RunContext = {
    currentStepOrdinal: 1,
    planLength: 3,
    deadlineEpochMs: 10_000,
    nowEpochMs: 0,
    currentSnapshotId: 'snap-1',
    actionsTaken: 0,
    mutatingActionsTaken: 0,
    chargesLanded: 0,
  }

  it('compiles to a policy with no purchase view at all', () => {
    const scope: ContractScope = {
      approvedSourceIds: ['src-1'],
      allowedActionKinds: [...grantableActionKinds(false)],
    }
    expect(compilePolicy(scope, controls).purchase).toBeUndefined()
  })

  it('is refused as ungranted when the contract never carried the kind', () => {
    const scope: ContractScope = {
      approvedSourceIds: ['src-1'],
      allowedActionKinds: [...grantableActionKinds(false)],
    }
    const verdict = authorize(
      compilePolicy(scope, controls),
      {
        kind: 'complete-purchase',
        params: { snapshotId: 'snap-1', ref: 'e1' },
        reason: 'buy dinner',
        stepOrdinal: 1,
      },
      run,
      'intent-1',
    )
    expect(verdict).toEqual({ authorized: false, rule: 'action_kind_not_allowed' })
  })

  it('is refused as unauthorised even if the kind somehow reached the allowlist', () => {
    // Belt and braces, asserted from the fixture side: the two facts are
    // written by different code, and the gate's own check is the one that
    // cannot drift.
    const scope: ContractScope = {
      approvedSourceIds: ['src-1'],
      allowedActionKinds: [...ACTION_KINDS],
    }
    const verdict = authorize(
      compilePolicy(scope, controls),
      {
        kind: 'complete-purchase',
        params: { snapshotId: 'snap-1', ref: 'e1' },
        reason: 'buy dinner',
        stepOrdinal: 1,
      },
      run,
      'intent-1',
    )
    expect(verdict).toEqual({ authorized: false, rule: 'purchase_not_authorized' })
  })
})

/* ── the DB-backed half: no columns, no grant, on the durable row ──────── */

type Actions = typeof import('../src/server/actions')
type Db = typeof import('../src/server/db')

let dir: string
let actions: Actions
let db: Db

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-purchase-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  process.env['DATABASE_URL'] = url
  actions = await import('../src/server/actions')
  db = await import('../src/server/db')
}, 120_000)

afterAll(async () => {
  const ctx = await db?.appContext()
  await ctx?.db.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('accepting a draft with no purchase columns grants no purchase', () => {
  async function draftedWithoutPurchase() {
    const { repos } = await db.appContext()
    const project = await repos.projects.create('dinner')
    const session = await repos.sessions.start(project.id)
    const reading = await repos.readings.create({
      sessionId: session.id,
      throughSeq: 0,
      claims: [],
    })
    return repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      objective: 'Find me food for dinner',
      definitionOfDone: 'A shortlist of three places exists',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: [...grantableActionKinds(false)],
      baseVersionId: null,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
  }

  it('leaves complete-purchase off the accepted contract, on the row itself', async () => {
    const draft = await draftedWithoutPurchase()
    const accepted = await actions.acceptContract(draft.id, {
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const { repos } = await db.appContext()
    const row = await repos.contracts.byId(accepted.value.contractId)
    expect(row?.status).toBe('accepted')
    expect(row?.allowedActionKinds).not.toContain('complete-purchase')
    expect(row?.purchaseOriginPattern ?? null).toBeNull()
  })

  it('grants the kind ONLY when the draft carries the ratified columns', async () => {
    // The positive half of the same property — live already, because the grant
    // is acceptContract's and does not wait for the transport. The charge
    // still cannot land: the network block is the last fixture below.
    const { repos } = await db.appContext()
    const project = await repos.projects.create('avocados')
    const session = await repos.sessions.start(project.id)
    const reading = await repos.readings.create({
      sessionId: session.id,
      throughSeq: 0,
      claims: [],
    })
    const draft = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      objective: 'Buy 10 avocados from the grocery site',
      definitionOfDone: 'An order confirmation exists',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: [...grantableActionKinds(false)],
      baseVersionId: null,
      purchaseOriginPattern: 'https://grocery.example',
      purchaseWhatFor: 'ten avocados',
      purchaseMaxAmountMinor: 4_000,
      purchaseCurrency: 'USD',
      purchaseMaxCount: 1,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })

    const accepted = await actions.acceptContract(draft.id, {
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'draft-changes',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const { repos: reposAfter } = await db.appContext()
    const row = await reposAfter.contracts.byId(accepted.value.contractId)
    expect(row?.allowedActionKinds).toContain('complete-purchase')
  })

  it('strips the grant under suggestions-only, like every mutating kind', async () => {
    const { repos } = await db.appContext()
    const project = await repos.projects.create('avocados-suggestions')
    const session = await repos.sessions.start(project.id)
    const reading = await repos.readings.create({
      sessionId: session.id,
      throughSeq: 0,
      claims: [],
    })
    const draft = await repos.contracts.createDraft({
      sessionId: session.id,
      readingId: reading.id,
      objective: 'Buy 10 avocados from the grocery site',
      definitionOfDone: 'An order confirmation exists',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: [...grantableActionKinds(false)],
      baseVersionId: null,
      purchaseOriginPattern: 'https://grocery.example',
      purchaseWhatFor: 'ten avocados',
      purchaseMaxAmountMinor: 4_000,
      purchaseCurrency: 'USD',
      purchaseMaxCount: 1,
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })

    const accepted = await actions.acceptContract(draft.id, {
      initiative: 'follow-closely',
      progress: 'current-step-only',
      output: 'suggestions-only',
      interruption: 'stop-when-uncertain',
      timeLimitMinutes: 30,
    })
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return

    const { repos: reposAfter } = await db.appContext()
    const row = await reposAfter.contracts.byId(accepted.value.contractId)
    expect(row?.allowedActionKinds).not.toContain('complete-purchase')
  })
})

/* ── the network, which is where nothing lands today ───────────────────── */

describe("the transport still refuses every non-GET — today's truth, dated", () => {
  it('blocks the checkout POST with no permit in the call, 2026-09-01', () => {
    /**
     * ASSERTS TODAY, not the end state. docs/todo/06 item 5 makes the block
     * conditional on a landing permit; the commit that does so rewrites this
     * assertion to cover both arms — no permit still blocks, and a covered
     * request within the ceiling lands. Until then, a run holding a granted
     * complete-purchase presses Buy and the order does not go through, which
     * is exactly what the agreement screen still says.
     */
    const paused = {
      request: { method: 'POST', url: 'https://grocery.example/checkout' },
      resourceType: 'XHR',
      frameId: 'frame-main',
    }
    expect(classifyPausedRequest(paused, ['https://grocery.example'])).toBe('blocked-request')
  })
})
