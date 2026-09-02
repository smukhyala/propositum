/**
 * The continuing loop, driven against a fake browser.
 *
 * ── Why a fake channel and not a real one ────────────────────────────────
 *
 * `src/model/fake.ts` explains the layering and this file is the same argument
 * one layer down. What is being tested here is CONTROL FLOW: does the loop
 * commit an intent before the effect, does it advance `currentSnapshotId` to the
 * page a tool handed back, does a channel failure become a row rather than an
 * escaped exception, do the two caps actually bind. None of those questions is
 * answered any better by a real Chrome, and all of them become slower, flakier
 * and harder to assert against.
 *
 * What this deliberately does NOT test is whether synthesised input behaves the
 * way we think it does in a real background tab. ADR-0010 records that as
 * unverified, and a green run here is not evidence about it.
 *
 * ── The fake is held to the real contract ────────────────────────────────
 *
 * `FakeBrowser` returns `BrowserReport`s and nothing else, in the order they
 * were scripted, and running out is an error rather than a default — the same
 * rule `FakeModelClient` follows, for the same reason: a test that makes an
 * unexpected extra dispatch has found something and should say so.
 */

import { describe, it, expect } from 'vitest'

import { runWorker } from '../src/runtime/worker-loop'
import type { RunLedger, WorkerDeps, WorkerJob } from '../src/runtime/worker-loop'
import { historyForContract, recoverOrphanedIntents } from '../src/runtime/history'
import type { ConfirmedAction, HistoryReader, LedgerIntentRow } from '../src/runtime/history'
import type { BrowserControl, BrowserReport, PageObservation } from '../src/runtime/browser-control'
import { FakeModelClient } from '../src/model/fake'
import type { ScriptedReply } from '../src/model/fake'
import { allowlisted, fixtureFetcher } from '../src/policy/fetcher'
import {
  MAX_ACTIONS_PER_RUN,
  MUTATING_ACTION_KINDS,
  BROWSER_ACTION_KINDS,
} from '../src/domain/handoff/policy'
import type { ElementEvidence } from '../src/domain/execution/reversibility'

/* ── harness ───────────────────────────────────────────────────────────── */

interface Recorded {
  intents: Array<{
    id: string
    kind: string
    authorized: boolean
    refusedRule?: string | undefined
    seq: number
    params: Record<string, unknown>
    stepId: string | null
  }>
  outcomes: Array<{
    intentId: string
    result: string
    scopeVerdict: string
    detail?: string | undefined
    observedBy?: string | undefined
  }>
  /** Every ledger write in the order it happened, so "intent before effect" is
   *  an assertion about a sequence rather than about two counts. */
  order: string[]
}

function ledger(): { ledger: RunLedger; recorded: Recorded } {
  const recorded: Recorded = { intents: [], outcomes: [], order: [] }

  return {
    recorded,
    ledger: {
      async recordIntent(input) {
        // The id is the CALLER's now — the gate stamped it onto the token before
        // the row existed, and the browser channel keys its dispatch on it. A
        // ledger that minted its own would put a different id on the row from
        // the one the dispatch carries, which is the defect this replaced.
        const id = input.id
        recorded.intents.push({
          id,
          kind: input.kind,
          authorized: input.authorized,
          refusedRule: input.refusedRule,
          seq: input.seq,
          params: input.params,
          stepId: input.stepId,
        })
        recorded.order.push(`intent:${input.kind}:${input.authorized ? 'yes' : 'no'}`)
        return id
      },
      async recordOutcome(input) {
        recorded.outcomes.push({
          intentId: input.intentId,
          result: input.result,
          scopeVerdict: input.scopeVerdict,
          detail: input.detail,
          observedBy: input.observedBy,
        })
        recorded.order.push(`outcome:${input.intentId}:${input.result}`)
      },
      async recordSteps(_runId, steps) {
        return steps.map((_, i) => `step-${i}`)
      },
      async advanceProgress() {
        /* no-op */
      },
    },
  }
}

/** A page, as the browser would describe it. `tree` is deliberately prose-ish:
 *  nothing in the loop parses it, and something that looked parseable would
 *  invite a test that pretends the loop understands the page. */
function observed(n: number): PageObservation {
  return {
    snapshotId: `snap-${n}`,
    url: `https://orders.example.com/page/${n}`,
    title: `Orders — page ${n}`,
    // The real shape `flattenAXTree` writes in `extension/src/cdp.js`:
    // `${ref} ${role} "${name}"`, one node per line. It used to be written
    // ref-last, which was a shape only a test could produce — and it stopped
    // being harmless the moment `descriptorFor` began reading these lines to
    // decide whether a confirmation still covers the element it was given for.
    tree: `r${n} button "Show more"\nn${n} link "Next"`,
    truncated: false,
  }
}

class FakeBrowser implements BrowserControl {
  readonly dispatched: Array<{ intentId: string; kind: string; params: Record<string, unknown> }> =
    []
  private readonly scripted: BrowserReport[]

  constructor(scripted: ReadonlyArray<BrowserReport>) {
    this.scripted = [...scripted]
  }

  async dispatch(input: {
    intentId: string
    kind: string
    params: Record<string, unknown>
    timeoutMs: number
  }): Promise<BrowserReport> {
    this.dispatched.push({ intentId: input.intentId, kind: input.kind, params: input.params })

    const next = this.scripted.shift()
    if (!next) {
      throw new Error(
        `FakeBrowser: unscripted dispatch of "${input.kind}" (#${this.dispatched.length}).`,
      )
    }
    return next
  }
}

/** A benign, well-formed element. Nothing in the lexicon, not a submit control,
 *  not inside a form — so `classifyReversibility` returns `ordinary` and the
 *  proposal reaches the tool. */
function benign(snapshotId: string, ref: string): ElementEvidence {
  return {
    accessibleNameTokens: ['Show', 'more'],
    role: 'button',
    isSubmitControl: false,
    isInsideForm: false,
    formHasSensitiveField: false,
    ref,
    snapshotId,
  }
}

function job(over: Partial<WorkerJob> = {}): WorkerJob {
  return {
    runId: 'run-1',
    contractId: 'contract-1',
    objective: 'Find the tracking number for my last order',
    definitionOfDone: 'The tracking number is written down',
    guidance: [],
    scope: {
      approvedSourceIds: ['src-orders'],
      allowedActionKinds: [...BROWSER_ACTION_KINDS],
    },
    controls: {
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    },
    context: ['Nothing is pinned to write into'],
    expects: ['answer'],
    documentId: undefined,
    sourceLabels: [{ id: 'src-orders', label: 'Orders' }],
    deadlineEpochMs: 1_000_000,
    ...over,
  }
}

type MutableDeps = { -readonly [K in keyof WorkerDeps]: WorkerDeps[K] } & {
  recorded: Recorded
  browserFake: FakeBrowser
}

function deps(
  replies: ScriptedReply<unknown>[],
  reports: ReadonlyArray<BrowserReport>,
  over: Partial<WorkerDeps> = {},
): MutableDeps {
  const { ledger: led, recorded } = ledger()
  const browserFake = new FakeBrowser(reports)

  // Deterministic, so an assertion can name the exact key a dispatch carried.
  // The real default is `crypto.randomUUID`, which would make every one of these
  // tests read as a comparison between two opaque strings.
  let minted = 0
  const newIntentId = () => {
    minted += 1
    return `intent-${minted}`
  }

  return {
    model: new FakeModelClient(replies),
    ledger: led,
    readSource: {
      fetcher: allowlisted(fixtureFetcher({}), ['https://orders.example.com/*']),
      sources: { urlFor: async () => 'https://orders.example.com/' },
    },
    readDoc: { versions: { byId: async () => null } },
    browser: { control: browserFake },
    elementEvidence: ({ snapshotId, ref }) => benign(snapshotId, ref),
    newIntentId,
    now: () => 0,
    recorded,
    browserFake,
    ...over,
  }
}

const plan = (...intents: string[]): ScriptedReply<unknown> => ({
  kind: 'ok',
  value: { steps: intents.map((intent) => ({ intent })) },
})

const act = (over: Record<string, unknown>): ScriptedReply<unknown> => ({
  kind: 'ok',
  value: { reason: 'because', ...over },
})

const done = (summary = 'Finished.'): ScriptedReply<unknown> =>
  act({ kind: 'observe-page', done: { summary } })

/* ── 1. observe → act → observe ────────────────────────────────────────── */

describe('the loop observes, acts, and observes again', () => {
  it('runs a whole turn per action and finishes on done', async () => {
    const d = deps(
      [
        plan('look at the orders page'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done('I opened the order and read the tracking number.'),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual([])
    expect(result.summary).toBe('I opened the order and read the tracking number.')
    expect(result.actionsTaken).toBe(2)

    // One ActionIntent per turn — never a batch, never two intents for one
    // authorization.
    expect(d.recorded.intents.map((i) => i.kind)).toEqual(['observe-page', 'click-element'])
    expect(d.recorded.intents.map((i) => i.seq)).toEqual([1, 2])
  })

  it('commits every intent before the effect it is the reason for', async () => {
    const d = deps(
      [
        plan('look, then click'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
    )

    await runWorker(job(), d)

    // Strictly interleaved. A run that died between any two of these still shows
    // what it was attempting, which is exactly when the audit story matters.
    expect(d.recorded.order).toEqual([
      'intent:observe-page:yes',
      'outcome:intent-1:succeeded',
      'intent:click-element:yes',
      'outcome:intent-2:succeeded',
    ])
  })

  it('advances the snapshot to the one each action returned', async () => {
    // The whole point of an acting tool returning its own post-action page: the
    // second click names `snap-2`, which only exists because the first click
    // handed it back.
    const d = deps(
      [
        plan('click twice'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r2', snapshotId: 'snap-2' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
        { ok: true, observation: observed(3) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.actionsTaken).toBe(3)
    expect(d.recorded.intents.every((i) => i.authorized)).toBe(true)
    expect(d.browserFake.dispatched.map((x) => x.params.snapshotId)).toEqual([
      undefined,
      'snap-1',
      'snap-2',
    ])
  })

  it('shows the model the page it is deciding against, fenced', async () => {
    const d = deps(
      [plan('look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    await runWorker(job(), d)

    const secondProposal = (d.model as FakeModelClient).calls[2]
    expect(secondProposal?.user).toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
    expect(secondProposal?.user).toContain('Show more')
    // The attested url is stated as attested, beside a tree stated as authored
    // by the page. A model has no other way to tell the two apart.
    expect(secondProposal?.user).toContain('https://orders.example.com/page/1')
    expect(secondProposal?.user).toMatch(/attested by the browser/i)
  })

  it('dispatches one instruction per committed intent, keyed by it', async () => {
    // The idempotency key. One authorised intent, at most one dispatch — a retry
    // after a transport error must not click twice.
    const d = deps(
      [plan('look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    await runWorker(job(), d)

    expect(d.browserFake.dispatched).toHaveLength(1)
    expect(d.browserFake.dispatched[0]?.intentId).toBe(d.recorded.intents[0]?.id)
  })
})

/* ── 2. the stale snapshot ─────────────────────────────────────────────── */

describe('a proposal cannot act on a page the run did not just see', () => {
  it('refuses a stale snapshotId', async () => {
    // The model has just been handed `snap-2` and names `snap-1` — the tree it
    // saw a turn ago. That is the difference between clicking `Cancel order` and
    // clicking whatever re-rendered into its place.
    const d = deps(
      [
        plan('click, then click again'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(d.recorded.intents[2]).toMatchObject({
      kind: 'click-element',
      authorized: false,
      refusedRule: 'stale_snapshot',
    })
    // Refused, so nothing was dispatched for it and nothing was recorded as an
    // outcome — a refusal means nothing happened.
    expect(d.browserFake.dispatched).toHaveLength(2)
    expect(d.recorded.outcomes).toHaveLength(2)
    expect(result.refusals).toBe(1)
  })

  it('refuses a snapshot-dependent action before the run has observed anything', async () => {
    // There is no special case for "the first one". A run that has observed
    // nothing has no current snapshot, and every ref is stale against it.
    const d = deps(
      [
        plan('click blind'),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [],
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[0]?.refusedRule).toBe('stale_snapshot')
    expect(d.browserFake.dispatched).toHaveLength(0)
  })
})

/* ── 3. history rebuilt from rows ──────────────────────────────────────── */

describe('the history is rebuilt from the ledger, not carried in a process', () => {
  const rows = (over: Partial<LedgerIntentRow>[] = []): LedgerIntentRow[] => [
    {
      id: 'i1',
      runId: 'run-0',
      seq: 1,
      kind: 'observe-page',
      reason: 'look at the orders page',
      authorized: true,
      refusedRule: null,
      outcome: { result: 'succeeded', scopeVerdict: 'within_scope', detail: 'looked at orders' },
    },
    {
      id: 'i2',
      runId: 'run-0',
      seq: 2,
      kind: 'click-element',
      reason: 'open the order',
      authorized: true,
      refusedRule: null,
      outcome: { result: 'succeeded', scopeVerdict: 'within_scope', detail: 'clicked' },
    },
    {
      id: 'i3',
      runId: 'run-0',
      seq: 3,
      kind: 'click-element',
      reason: 'press Place order',
      authorized: false,
      refusedRule: 'confirmation_required',
      outcome: null,
    },
    ...(over as LedgerIntentRow[]),
  ]

  const reader = (source: readonly LedgerIntentRow[]): HistoryReader => ({
    intentsForContract: async () => source,
  })

  it('counts authorized intents, and only mutating ones toward the mutating cap', async () => {
    const rebuilt = await historyForContract('contract-1', {
      ledger: reader(rows()),
      mutatingKinds: MUTATING_ACTION_KINDS,
    })

    // Three rows: two authorized (one of them mutating), one refused.
    expect(rebuilt.actionsTaken).toBe(2)
    expect(rebuilt.mutatingActionsTaken).toBe(1)
    expect(rebuilt.orphanedIntentIds).toEqual([])
  })

  it('carries the refusal into the turns, so the agent does not propose it again', async () => {
    const rebuilt = await historyForContract('contract-1', {
      ledger: reader(rows()),
      mutatingKinds: MUTATING_ACTION_KINDS,
    })

    expect(rebuilt.turns).toHaveLength(3)
    expect(rebuilt.turns[2]).toEqual({
      kind: 'click-element',
      summary: 'press Place order',
      outcome: 'refused: confirmation_required',
    })
  })

  it('finds an authorized intent with no outcome, and says it is unknown', async () => {
    const orphan: LedgerIntentRow = {
      id: 'i4',
      runId: 'run-0',
      seq: 4,
      kind: 'type-text',
      reason: 'fill in the reference',
      authorized: true,
      refusedRule: null,
      outcome: null,
    }

    const rebuilt = await historyForContract('contract-1', {
      ledger: reader(rows([orphan])),
      mutatingKinds: MUTATING_ACTION_KINDS,
    })

    expect(rebuilt.orphanedIntentIds).toEqual(['i4'])
    // It still counts against both caps. An action that was authorised and may
    // well have landed is not made free by the process dying before it could be
    // written down.
    expect(rebuilt.actionsTaken).toBe(3)
    expect(rebuilt.mutatingActionsTaken).toBe(2)
    expect(rebuilt.turns[3]?.outcome).toMatch(/unknown/i)
  })

  it('never calls its own in-flight action an orphan', async () => {
    // An orphan and an action in flight are the same row. Recovering one that
    // belongs to the asking run would write `failed` against something about to
    // succeed — and, because `intentId` is unique on `action_outcome`, the real
    // outcome would then fail to insert and take the run down with it.
    const inFlight: LedgerIntentRow = {
      id: 'i9',
      runId: 'run-1',
      seq: 1,
      kind: 'click-element',
      reason: 'happening right now',
      authorized: true,
      refusedRule: null,
      outcome: null,
    }

    const rebuilt = await historyForContract('contract-1', {
      ledger: reader(rows([inFlight])),
      mutatingKinds: MUTATING_ACTION_KINDS,
      excludeRunId: 'run-1',
    })

    expect(rebuilt.orphanedIntentIds).toEqual([])
    // It still counts. Excluding it from RECOVERY is not excluding it from the
    // blast radius — it was authorized, and it may well have landed.
    expect(rebuilt.actionsTaken).toBe(3)
  })

  it('writes a recovery outcome that records the gap rather than guessing', async () => {
    const { ledger: led, recorded } = ledger()

    const written = await recoverOrphanedIntents(['i4'], led)

    expect(written).toBe(1)
    expect(recorded.outcomes[0]).toMatchObject({
      intentId: 'i4',
      // Under-claims deliberately: we cannot show it worked. It does NOT mean
      // nothing happened — a click dispatched before the process died may well
      // have landed.
      result: 'failed',
      scopeVerdict: 'unverified',
      observedBy: 'recovery',
    })
  })

  it('recovers before it acts, so the run seeds its counters from real rows', async () => {
    const orphan: LedgerIntentRow = {
      id: 'i4',
      runId: 'run-0',
      seq: 4,
      kind: 'type-text',
      reason: 'fill in the reference',
      authorized: true,
      refusedRule: null,
      outcome: null,
    }

    const d = deps(
      [plan('carry on'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
      { history: reader(rows([orphan])) },
    )

    const result = await runWorker(job(), d)

    expect(result.recovered).toBe(1)
    // The recovery outcome is the FIRST ledger write of the run, before any
    // intent it commits itself. Everything before that line is settled;
    // everything after belongs to this run.
    expect(d.recorded.order[0]).toBe('outcome:i4:failed')
    // ...and the counters continue from what the contract had already done: 3
    // prior authorized actions plus this run's one.
    expect(result.actionsTaken).toBe(4)
  })
})

/* ── 4. the caps bind ──────────────────────────────────────────────────── */

describe('the two caps actually bind', () => {
  it('stops at MAX_ACTIONS_PER_RUN', async () => {
    // Enough observes to run past the cap, and enough pages to answer them. The
    // loop must stop itself rather than keep asking.
    const replies: ScriptedReply<unknown>[] = [plan('keep looking')]
    const reports: BrowserReport[] = []
    for (let i = 0; i < MAX_ACTIONS_PER_RUN + 5; i += 1) {
      replies.push(act({ kind: 'navigate', approvedSourceId: 'src-orders', path: `/page/${i}` }))
      reports.push({ ok: true, observation: observed(i) })
    }

    const d = deps(replies, reports)
    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('action-limit')
    expect(result.actionsTaken).toBe(MAX_ACTIONS_PER_RUN)
  })

  it('current-step-only means exactly one change out in the world', async () => {
    // ADR-0010's redefinition, end to end: a step is the interval between two
    // mutating actions, so `current-step-only` compiles to
    // `maxMutatingActions = 1` and the SECOND click is refused.
    const d = deps(
      [
        plan('click, then click again'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r2', snapshotId: 'snap-2' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
    )

    const result = await runWorker(
      job({ controls: { ...job().controls, progress: 'current-step-only' } }),
      d,
    )

    expect(d.recorded.intents[2]).toMatchObject({
      kind: 'click-element',
      authorized: false,
      refusedRule: 'step_out_of_scope',
    })
    expect(result.refusals).toBe(1)
    // The looking was never capped — only the changing.
    expect(d.recorded.intents.filter((i) => i.authorized).map((i) => i.kind)).toEqual([
      'observe-page',
      'click-element',
    ])
  })

  it('tells the model how many changes it has left', async () => {
    const d = deps(
      [plan('look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    await runWorker(job({ controls: { ...job().controls, progress: 'current-step-only' } }), d)

    expect((d.model as FakeModelClient).calls[1]?.user).toContain(
      'Changes you may still make out in the world: 1',
    )
  })
})

/* ── 5. a channel failure is a row, not an escape ──────────────────────── */

describe('a control failure lands in the ledger', () => {
  it('records a failed outcome and carries on', async () => {
    const d = deps(
      [
        plan('click something behind a banner'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: false, failure: 'blocked-request', detail: 'the click landed on a consent dialog' },
      ],
    )

    const result = await runWorker(job(), d)

    // The intent is committed either way. What changed is what we can say about
    // it afterwards.
    expect(d.recorded.intents[1]).toMatchObject({ kind: 'click-element', authorized: true })
    expect(d.recorded.outcomes[1]).toMatchObject({ result: 'failed', scopeVerdict: 'unverified' })
    expect(d.recorded.outcomes[1]?.detail).toContain('consent dialog')

    // Not an exception that escaped the loop and took the ledger with it.
    expect(result.status).toBe('succeeded')
  })

  it('leaves the snapshot where it was, so the next proposal cannot use a page that never arrived', async () => {
    const d = deps(
      [
        plan('click, fail, click again'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: false, failure: 'stale-snapshot', detail: 'ref r1 no longer resolves' },
        { ok: true, observation: observed(2) },
      ],
    )

    await runWorker(job(), d)

    // `snap-1` is still current after the failure, so the retry is authorized
    // rather than refused as stale. A failed action did not advance anything.
    expect(d.recorded.intents[2]).toMatchObject({ kind: 'click-element', authorized: true })
  })

  it('says plainly that a delivered-but-unreported action may have landed', async () => {
    /**
     * The one sentence this ledger must never get wrong.
     *
     * `not-delivered` means the instruction expired while still queued — no
     * browser saw it. `not-reported` means it WAS delivered and never answered:
     * it may have pressed the button, twice, or not at all. Telling somebody
     * "it did not go through" about the second is the damaging error, because
     * they act on it — retry the order, re-send the message.
     */
    const d = deps(
      [
        plan('click'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: false, failure: 'not-reported', detail: 'the browser never answered' },
      ],
    )

    await runWorker(job(), d)

    expect(d.recorded.outcomes[1]?.scopeVerdict).toBe('unverified')
    expect(d.recorded.outcomes[1]?.detail).toMatch(/unknown/i)
  })

  it('does not claim uncertainty about an instruction that never left', async () => {
    // The other half of the pair. `not-delivered` is the one negative statement
    // the channel can actually make, and softening it into "we cannot tell"
    // would throw away the only case where the world is knowably unchanged.
    const d = deps(
      [
        plan('click'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: false, failure: 'not-delivered', detail: 'still queued at expiry' },
      ],
    )

    await runWorker(job(), d)

    expect(d.recorded.outcomes[1]?.detail).toContain('still queued at expiry')
    expect(d.recorded.outcomes[1]?.detail ?? '').not.toMatch(/unknown/i)
  })

  it('refuses a browser kind when the run has no channel, rather than reporting success', async () => {
    const d = deps([plan('look'), act({ kind: 'observe-page' }), done()], [], {
      browser: undefined,
    })

    await runWorker(job(), d)

    expect(d.recorded.outcomes[0]).toMatchObject({ result: 'failed' })
    expect(d.recorded.outcomes[0]?.detail).toMatch(/no browser/i)
  })
})

/* ── 5b. the screenshot actually reaches the model ─────────────────────── */

describe('a captured screen is attached, not merely announced', () => {
  it('sends the pixels alongside the prose on the next turn', async () => {
    /**
     * The defect a review found: `PromptParts` was `{ system, user }`, the
     * client sent a bare string, and the boundary said *"a screenshot is
     * attached"* when nothing was. A run only spends a `capture-screen` because
     * the tree was insufficient, so the likely behaviour was to look again, get
     * nothing again, and burn the action cap discovering it does not work.
     */
    const d = deps(
      [plan('look closer'), act({ kind: 'observe-page' }), act({ kind: 'capture-screen' }), done()],
      [
        { ok: true, observation: observed(1) },
        {
          ok: true,
          capture: { mediaType: 'image/png', base64: 'PNGBYTES' },
        },
      ],
    )

    await runWorker(job(), d)

    const afterCapture = (d.model as FakeModelClient).calls[3]
    expect(afterCapture?.images).toEqual([{ mediaType: 'image/png', base64: 'PNGBYTES' }])
    expect(afterCapture?.user).toContain('screenshot')
  })

  it('drops the picture once a new tree arrives, because it is now of a page that is gone', async () => {
    const d = deps(
      [
        plan('look closer, then move on'),
        act({ kind: 'observe-page' }),
        act({ kind: 'capture-screen' }),
        act({ kind: 'navigate', approvedSourceId: 'src-orders', path: '/page/2' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        {
          ok: true,
          capture: { mediaType: 'image/png', base64: 'PNGBYTES' },
        },
        { ok: true, observation: observed(2) },
      ],
    )

    await runWorker(job(), d)

    const afterNavigate = (d.model as FakeModelClient).calls[4]
    expect(afterNavigate?.images).toBeUndefined()
    expect(afterNavigate?.user).not.toContain('screenshot')
  })

  it('attaches nothing when nothing was captured', async () => {
    const d = deps(
      [plan('look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    await runWorker(job(), d)

    expect((d.model as FakeModelClient).calls[2]?.images).toBeUndefined()
  })
})

/* ── 6. the pause, and why it is not a loop ────────────────────────────── */

describe('a confirmation pause is not a run going in circles', () => {
  /** No evidence about any element. Every field of `ElementEvidence` is
   *  page-authored, so absence is the state an attacker can most cheaply
   *  produce — and it escalates. */
  const blind = { elementEvidence: undefined }

  it('refuses an unconfirmed click, because absent evidence escalates', async () => {
    const d = deps(
      [
        plan('click'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        done(),
      ],
      [{ ok: true, observation: observed(1) }],
      blind,
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[1]?.refusedRule).toBe('confirmation_required')
  })

  it('stops at the first pause, and never under a loop rule', async () => {
    /**
     * A pause ends the run, and it ends it as a QUESTION rather than as a halt.
     *
     * ── What this assertion used to be, and why it moved ─────────────────
     *
     * It used to propose three clicks back to back and assert that all three
     * were refused with the run still not halted — the property being that a
     * pause must never be reported as `no-progress` or `refusal-loop`. That
     * property is why `PAUSING_RULES` exists, and it survives verbatim; what
     * changed is where it is asserted, because a run can no longer reach a
     * second pause.
     *
     * ADR-0010 §5 says the run halts when the gate refuses for want of
     * confirmation, and the mechanical reason is in `creditedDeadlineFor`:
     * it sums `(requestedAt, decidedAt)` pairs, so two questions asked a minute
     * apart and answered together would credit the same wait twice. The pause
     * credit is only correct if pauses are serial, and one pause per run is
     * what makes them serial.
     *
     * So the earlier version's stronger reading — *nothing between the asks* —
     * is now structural rather than tested: there is no second ask.
     */
    const d = deps(
      [
        plan('ask three times'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r2', snapshotId: 'snap-1' }),
        act({ kind: 'click-element', ref: 'r3', snapshotId: 'snap-1' }),
        done(),
      ],
      [{ ok: true, observation: observed(1) }],
      blind,
    )

    const result = await runWorker(job(), d)

    expect(result.refusals).toBe(1)
    expect(d.recorded.intents.filter((i) => !i.authorized).map((i) => i.refusedRule)).toEqual([
      'confirmation_required',
    ])

    // The half that matters: no stop rule fired. A person whose run stopped to
    // ask them something must not read "I kept needing things the agreement
    // does not allow" or "I was going in circles".
    expect(result.stoppedBy).toEqual([])
    expect(result.terminalReason).toBeUndefined()
  })

  it('reports which refused intent the question is about', async () => {
    /**
     * The refused `ActionIntent` is the join `ConfirmationRequest.intentId`
     * needs, and it is the thing `confirmationIdFor` matches a continuation's
     * proposal against. Returning the id rather than the proposal is what keeps
     * the model out of it: the person is asked about a row the gate already
     * refused, not about a description the worker supplied.
     */
    const d = deps(
      [
        plan('press it'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
      ],
      [{ ok: true, observation: observed(1) }],
      blind,
    )

    const result = await runWorker(job(), d)

    expect(result.awaiting?.intentId).toBe('intent-2')
    expect(result.awaiting?.kind).toBe('click-element')
  })

  it('builds the question from the page the browser attested, not from the model', async () => {
    // `observed(1)` is served from `https://orders.example.com/...`, which is
    // what Chrome said. The worker's own `reason` is 'because', and it must not
    // appear anywhere in what the person reads.
    const d = deps(
      [
        plan('press it'),
        act({ kind: 'observe-page' }),
        act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
      ],
      [{ ok: true, observation: observed(1) }],
      blind,
    )

    const result = await runWorker(job(), d)

    expect(result.awaiting?.question).toBe('Press something on orders.example.com')
    expect(result.awaiting?.question).not.toContain('because')
  })

  it('produces no question at all when the run was never paused', async () => {
    const d = deps(
      [plan('just look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    const result = await runWorker(job(), d)

    expect(result.awaiting).toBeUndefined()
  })

  it('still counts three ORDINARY refusals as a loop', async () => {
    // The other half of the pair. The exemption is narrow on purpose: a run that
    // keeps proposing things the agreement does not allow is exactly what
    // `refusal-loop` is for, and a fix that quieted both would have removed the
    // rule rather than corrected it.
    const d = deps(
      [
        plan('propose the impossible'),
        act({ kind: 'send-email' }),
        act({ kind: 'send-email' }),
        act({ kind: 'send-email' }),
      ],
      [],
    )

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('refusal-loop')
  })

  it('cannot loop on pauses at all, which is stronger than being bounded', async () => {
    /**
     * What this replaces, and why the replacement is stronger rather than
     * looser.
     *
     * It used to assert that a run proposing an irreversible action every turn
     * was ENDED BY THE TURN CAP, because with a pause exempt from both loop
     * counters nothing else finished it — thirty minutes of model calls in
     * production, and a genuinely infinite loop under an injected clock. The
     * bound was the fix.
     *
     * The bound is still there and still guards every other way of looping. It
     * is no longer what ends this run: the first pause does, on turn two, so the
     * failure that test was written for is now impossible rather than capped.
     * The scenario is kept — forty-five proposals, all of them pauses — so that
     * a change which reopened the loop would be caught here by the run not
     * ending where it should.
     */
    const replies: ScriptedReply<unknown>[] = [plan('ask forever'), act({ kind: 'observe-page' })]
    for (let i = 0; i < MAX_ACTIONS_PER_RUN + 5; i += 1) {
      replies.push(act({ kind: 'click-element', ref: `r${i}`, snapshotId: 'snap-1' }))
    }

    const d = deps(replies, [{ ok: true, observation: observed(1) }], blind)

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual([])
    expect(result.refusals).toBe(1)
    // One authorized action all run — the observe.
    expect(result.actionsTaken).toBe(1)
    // ...and the model was asked exactly three times: the plan, the observe, and
    // the one proposal that paused. Forty-two scripted replies went unused.
    expect(result.awaiting?.intentId).toBe('intent-2')
  })
})

/* ── 6a. losing the browser is a stop, not a string of failures ────────── */

describe('losing the tab ends the run as control-lost', () => {
  /**
   * `control-lost` and its consumer sentence — *"I lost the tab I was working
   * in."* — have existed in `STOP_RULES` since stop conditions were written, and
   * `evaluateStructuralStops` has been unable to raise it because nothing set
   * `RunProgress.controlLost`. `tests/reachability.test.ts` pinned that absence.
   *
   * The failure it leaves is not silence, which would at least be visible. The
   * run keeps proposing into a channel that has no hands: each action is
   * authorized, dispatched, fails, and is recorded `unverified`, until three
   * consecutive failures trip `no-progress` and the person is told *"I stopped
   * because I was going in circles without changing anything"* — about a run
   * that was going in circles because they closed the tab.
   */
  it('stops on the first control-lost rather than circling', async () => {
    const d = deps(
      [
        plan('look, then look again'),
        act({ kind: 'observe-page' }),
        act({ kind: 'observe-page' }),
        act({ kind: 'observe-page' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: false, failure: 'control-lost', detail: 'the tab is gone' },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual(['control-lost'])
    // The failed action is still a recorded row. Losing the hands does not
    // erase what was attempted.
    expect(d.recorded.outcomes.at(-1)).toMatchObject({
      result: 'failed',
      scopeVerdict: 'unverified',
    })
  })

  it('does not treat an ordinary channel failure as losing the browser', async () => {
    // `not-delivered` says the instruction never left the app. The hands are
    // still there, and a run that stopped over one would be quitting on a
    // recoverable hiccup.
    const d = deps(
      [plan('look twice'), act({ kind: 'observe-page' }), act({ kind: 'observe-page' }), done()],
      [
        { ok: false, failure: 'not-delivered', detail: 'nothing took it' },
        { ok: true, observation: observed(1) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual([])
  })
})

/* ── 6b. the person's yes actually lands ───────────────────────────────── */

describe('a confirmed action is not asked about twice', () => {
  /**
   * The end-to-end bug this closes, in one sentence: `confirmRequest` records
   * the yes, the continuation run proposes the same action, and the gate refuses
   * it `confirmation_required` all over again — because nothing populated
   * `RunContext.confirmedRequestIds` and no proposal ever carried an id. It
   * fails safe, and it reads to the person as *Propositum ignored my answer*.
   */
  const confirmed = (over: Partial<ConfirmedAction> = {}): ConfirmedAction => ({
    requestId: 'confreq-1',
    intentId: 'i-refused',
    kind: 'click-element',
    params: { ref: 'r1', snapshotId: 'snap-OLD' },
    // The element as it stood in the snapshot the person was shown. `observed(1)`
    // still writes this line, so a yes given about it still covers it — and the
    // cases below move it to show what happens when the page does.
    descriptor: 'r1 button "Show more"',
    ...over,
  })

  const readerWith = (confirmations: readonly ConfirmedAction[]): HistoryReader => ({
    intentsForContract: async () => [],
    confirmationsForContract: async () => confirmations,
  })

  const proposeClick = (): ScriptedReply<unknown>[] => [
    plan('press it'),
    act({ kind: 'observe-page' }),
    act({ kind: 'click-element', ref: 'r1', snapshotId: 'snap-1' }),
    done(),
  ]

  it('carries the yes onto the proposal, and the gate allows it', async () => {
    // `blind` — no element evidence, so the classifier escalates and the action
    // needs a confirmation. With one on file, it goes through.
    const d = deps(
      proposeClick(),
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
      { elementEvidence: undefined, history: readerWith([confirmed()]) },
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[1]).toMatchObject({ kind: 'click-element', authorized: true })
    // Deterministic code attached it — the model has no field to propose it in.
    expect(d.recorded.intents[1]?.params.confirmationId).toBe('confreq-1')
  })

  it('does not let a yes about one control cover a different one', async () => {
    // The person was shown `r9`. A yes about that is not a yes about `r1`, and
    // the match is on the identifying params rather than on the kind alone.
    const d = deps(proposeClick(), [{ ok: true, observation: observed(1) }], {
      elementEvidence: undefined,
      history: readerWith([confirmed({ params: { ref: 'r9' } })]),
    })

    await runWorker(job(), d)

    expect(d.recorded.intents[1]?.refusedRule).toBe('confirmation_required')
    expect(d.recorded.intents[1]?.params.confirmationId).toBeUndefined()
  })

  it('does not require the snapshot to match, because a continuation has a new one', async () => {
    // The confirmed intent names `snap-OLD`; the continuation observed the page
    // again and is on `snap-1`. Requiring equality would mean no confirmation
    // ever applied to anything.
    const d = deps(
      proposeClick(),
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
      { elementEvidence: undefined, history: readerWith([confirmed()]) },
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[1]?.authorized).toBe(true)
  })

  /**
   * The retarget, which is what issue #109 was about.
   *
   * A `ref` is meaningful only against the snapshot that issued it, and a
   * continuation is a new run looking at a new one. So ref-equality alone let a
   * page that re-rendered between the question and the answer move a yes about
   * one control onto whatever took its place. The element's own line of the tree
   * is the identity; the ref is a coordinate, and coordinates move.
   */
  it('does not carry a yes onto an element that has changed under the same ref', async () => {
    const d = deps(
      proposeClick(),
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
      {
        elementEvidence: undefined,
        // The person said yes about "Track shipment" at `r1`. The page now has
        // something else there, and `observed(1)` says so.
        history: readerWith([confirmed({ descriptor: 'r1 button "Track shipment"' })]),
      },
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[1]?.refusedRule).toBe('confirmation_required')
    expect(d.recorded.intents[1]?.params.confirmationId).toBeUndefined()
  })

  it('asks again rather than guessing when the confirmed element was never recorded', async () => {
    // No descriptor on the confirmed side — an old row, or a request raised with
    // no page-snapshot beside it. There is nothing to agree, so the answer is no.
    // One extra question is the only direction worth failing in.
    const d = deps(proposeClick(), [{ ok: true, observation: observed(1) }], {
      elementEvidence: undefined,
      history: readerWith([confirmed({ descriptor: null })]),
    })

    await runWorker(job(), d)

    expect(d.recorded.intents[1]?.refusedRule).toBe('confirmation_required')
  })

  it('still covers a confirmed action that never named an element', async () => {
    // A `press-key` is identified by its key and the page it was asked about.
    // Demanding a descriptor of one would refuse every one of them forever.
    const d = deps(
      [
        plan('press it'),
        act({ kind: 'observe-page' }),
        act({ kind: 'press-key', key: 'Enter', snapshotId: 'snap-1' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
      {
        elementEvidence: undefined,
        history: readerWith([
          confirmed({ kind: 'press-key', params: { key: 'Enter' }, descriptor: null }),
        ]),
      },
    )

    await runWorker(job(), d)

    expect(d.recorded.intents[1]).toMatchObject({ kind: 'press-key', authorized: true })
    expect(d.recorded.intents[1]?.params.confirmationId).toBe('confreq-1')
  })

  it('rebuilds the id set the gate checks membership of', async () => {
    const rebuilt = await historyForContract('contract-1', {
      ledger: readerWith([confirmed(), confirmed({ requestId: 'confreq-2' })]),
      mutatingKinds: MUTATING_ACTION_KINDS,
    })

    expect([...rebuilt.confirmedRequestIds]).toEqual(['confreq-1', 'confreq-2'])
  })

  it('treats an absent reader as nothing confirmed', async () => {
    // A drafting run has no confirmation story and must not be obliged to have
    // one. Absent resolves to the same state the gate defaults to.
    const rebuilt = await historyForContract('contract-1', {
      ledger: { intentsForContract: async () => [] },
      mutatingKinds: MUTATING_ACTION_KINDS,
    })

    expect(rebuilt.confirmedRequestIds.size).toBe(0)
    expect(rebuilt.confirmations).toEqual([])
  })
})

/* ── 7. the plan reports, and authorizes nothing ───────────────────────── */

describe('the plan is reporting now', () => {
  it('writes no plan step onto an intent', async () => {
    const d = deps(
      [plan('look'), act({ kind: 'observe-page' }), done()],
      [{ ok: true, observation: observed(1) }],
    )

    await runWorker(job(), d)

    expect(d.recorded.intents.every((i) => i.stepId === null)).toBe(true)
  })

  it('keeps going past the end of the plan under use-judgment', async () => {
    // One planned step, three actions. Under the old shape the run ended when
    // the list did; an agent that decides from what it just saw cannot be bound
    // by a list written before it looked.
    const d = deps(
      [
        plan('have a look'),
        act({ kind: 'observe-page' }),
        act({ kind: 'observe-page' }),
        act({ kind: 'navigate', approvedSourceId: 'src-orders', path: '/page/9' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
        { ok: true, observation: observed(3) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.actionsTaken).toBe(3)
    expect(result.stoppedBy).toEqual([])
  })

  it('stops a run that only ever asks questions', async () => {
    /**
     * The bound the plan used to supply by accident.
     *
     * Under `stop-only-when-blocked` a raised question does not halt, and the
     * loop used to move on to the next plan step — so a model that asked
     * something every turn ran out of steps. With no plan to run out of, the
     * same model would ask until the deadline: thirty minutes of calls
     * producing nothing, reported to the person as a budget they set.
     */
    const ask = (n: number) =>
      act({
        kind: 'observe-page',
        decisionNeeded: { question: `Which one, ${n}?`, whyItMatters: 'it decides the rest' },
      })

    const d = deps([plan('have a look'), ask(1), ask(2), ask(3), ask(4)], [])

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.decisions).toHaveLength(3)
    // The fourth was never asked for — the run stopped at a boundary.
    expect((d.model as FakeModelClient).pendingReplies).toBe(1)
  })

  it('does not hold a question against a run that then does real work', async () => {
    // The demo's centrepiece: complete the work AND raise one strategic
    // decision. One question resets as soon as something actually happens.
    const d = deps(
      [
        plan('have a look'),
        act({
          kind: 'observe-page',
          decisionNeeded: { question: 'Which tier?', whyItMatters: 'the close depends on it' },
        }),
        act({ kind: 'navigate', approvedSourceId: 'src-orders', path: '/page/1' }),
        act({ kind: 'navigate', approvedSourceId: 'src-orders', path: '/page/2' }),
        act({ kind: 'navigate', approvedSourceId: 'src-orders', path: '/page/3' }),
        done(),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
        { ok: true, observation: observed(3) },
      ],
    )

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual([])
    expect(result.decisions).toHaveLength(1)
    expect(result.actionsTaken).toBe(3)
  })

  it('stops at the end of the plan under follow-closely, without burning refusals', async () => {
    // Initiative is what still binds a plan-shaped run, and it binds cleanly:
    // the loop ends rather than proposing off-plan three times and reporting the
    // result as a refusal loop.
    const d = deps(
      [plan('have a look'), act({ kind: 'observe-page' })],
      [{ ok: true, observation: observed(1) }],
    )

    const result = await runWorker(
      job({ controls: { ...job().controls, initiative: 'follow-closely' } }),
      d,
    )

    expect(result.actionsTaken).toBe(1)
    expect(result.refusals).toBe(0)
    expect(result.stoppedBy).toEqual([])
    expect((d.model as FakeModelClient).pendingReplies).toBe(0)
  })
})

/**
 * ADR-0024, and the gap that opened on the day it was built.
 *
 * `LANDING_ACTION_KINDS` gained `complete-purchase` on 2026-09-01 and the arm
 * that carries it out returned no `produced` — so the covered request left the
 * machine, the ledger held the charge, and `recordOutcomes` was handed nothing
 * to write an `external-effect` row from. A run whose only work was the
 * purchase reported that it had produced nothing. This is the assertion that
 * would have gone red that day: the loop's `produced` carries exactly one
 * `landed` proposal, for the purchase intent, composed from the ATTESTED charge
 * and not from anything a model said.
 */
describe('a completed purchase is produced as a landed outcome', () => {
  it('yields one landed proposal, for the purchase intent, off the attested charge', async () => {
    const d = deps(
      [
        plan('buy the thing'),
        act({ kind: 'observe-page' }),
        act({ kind: 'complete-purchase', ref: 'r1', snapshotId: 'snap-1' }),
        done('Bought it.'),
      ],
      [
        { ok: true, observation: observed(1) },
        {
          ok: true,
          observation: observed(2),
          charge: { amountMinor: 4200, currency: 'USD', origin: 'https://orders.example.com' },
        },
      ],
    )

    const result = await runWorker(
      job({
        scope: {
          approvedSourceIds: ['src-orders'],
          allowedActionKinds: ['observe-page', 'complete-purchase'],
          purchaseAuthorization: {
            originPattern: 'https://orders.example.com',
            whatFor: 'the thing',
            maxAmountMinor: 5000,
            currency: 'USD',
            maxCount: 1,
            expiresAtEpochMs: 1_000_000,
          },
        },
      }),
      d,
    )

    expect(result.stoppedBy).toEqual([])
    expect(d.recorded.outcomes.map((o) => o.result)).toEqual(['succeeded', 'succeeded'])
    expect(result.produced).toEqual([
      {
        kind: 'landed',
        intentId: 'intent-2',
        what: 'Paid $42.00',
        where: 'https://orders.example.com',
      },
    ])
  })

  it('produces nothing when the permit was never consumed, because nothing was bought', async () => {
    // An ok report with no charge means the press landed nothing. The tool
    // throws, the outcome row reads failed, and there is no landed proposal
    // for a charge that did not happen.
    const d = deps(
      [
        plan('buy the thing'),
        act({ kind: 'observe-page' }),
        act({ kind: 'complete-purchase', ref: 'r1', snapshotId: 'snap-1' }),
        done('Tried.'),
      ],
      [
        { ok: true, observation: observed(1) },
        { ok: true, observation: observed(2) },
      ],
    )

    const result = await runWorker(
      job({
        scope: {
          approvedSourceIds: ['src-orders'],
          allowedActionKinds: ['observe-page', 'complete-purchase'],
          purchaseAuthorization: {
            originPattern: 'https://orders.example.com',
            whatFor: 'the thing',
            maxAmountMinor: 5000,
            currency: 'USD',
            maxCount: 1,
            expiresAtEpochMs: 1_000_000,
          },
        },
      }),
      d,
    )

    expect(d.recorded.outcomes.map((o) => o.result)).toEqual(['succeeded', 'failed'])
    expect(result.produced).toEqual([])
  })
})
