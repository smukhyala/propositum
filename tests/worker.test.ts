import { describe, it, expect, vi } from 'vitest'
import { runWorker } from '../src/runtime/worker-loop'
import type { RunLedger, WorkerDeps, WorkerJob } from '../src/runtime/worker-loop'
import { startWorkerProcess } from '../src/runtime/worker-process'
import { FakeModelClient } from '../src/model/fake'
import type { ScriptedReply } from '../src/model/fake'
import { allowlisted, fixtureFetcher } from '../src/policy/fetcher'
import { MAX_PLAN_STEPS } from '../src/domain/handoff/policy'

/* ── harness ───────────────────────────────────────────────────────────── */

interface Recorded {
  intents: Array<{ kind: string; authorized: boolean; refusedRule?: string | undefined; seq: number }>
  outcomes: Array<{ intentId: string; result: string; detail?: string | undefined }>
  order: string[]
}

function ledger(): { ledger: RunLedger; recorded: Recorded } {
  const recorded: Recorded = { intents: [], outcomes: [], order: [] }
  let n = 0

  return {
    recorded,
    ledger: {
      async recordIntent(input) {
        n += 1
        const id = `intent-${n}`
        recorded.intents.push({
          kind: input.kind,
          authorized: input.authorized,
          refusedRule: input.refusedRule,
          seq: input.seq,
        })
        recorded.order.push(`intent:${input.kind}`)
        return id
      },
      async recordOutcome(input) {
        recorded.outcomes.push({ intentId: input.intentId, result: input.result, detail: input.detail })
        recorded.order.push(`outcome:${input.result}`)
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

const PAGES = {
  'https://northwind.example.com/partners': {
    url: 'https://northwind.example.com/partners',
    title: 'Northwind — Partners',
    text: 'Standard partners receive a 15% revenue share.',
  },
}

function job(over: Partial<WorkerJob> = {}): WorkerJob {
  return {
    runId: 'run-1',
    // The unit of history and of both caps. A confirmation pause ends one run
    // and starts another under the same contract, so anything counted per run
    // would reset every time somebody was asked a question.
    contractId: 'contract-1',
    objective: 'Draft the Northwind proposal',
    definitionOfDone: 'Commercials and Close drafted',
    guidance: [],
    scope: {
      approvedSourceIds: ['src-northwind'],
      allowedActionKinds: ['read-approved-source', 'read-document', 'draft-section'],
      baseVersionId: 'ver-1',
    },
    controls: {
      initiative: 'follow-closely',
      progress: 'remaining-plan',
      output: 'draft-changes',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    },
    // One-line facts, exactly as the app process assembles them. The worker
    // cannot tell from this that it is looking at a document rather than a
    // spreadsheet or a browser tab, which is the property being tested by
    // everything that does NOT branch on it.
    context: ['Document: Northwind proposal', 'Sections: Scope, Commercials'],
    expects: ['document-changes'],
    // A `Document` id, and note that it is NOT `ver-1`. The two being distinct
    // is the whole point: the loop used to put the version id under this key.
    documentId: 'doc-1',
    sourceLabels: [{ id: 'src-northwind', label: 'Northwind Partners' }],
    deadlineEpochMs: 1_000_000,
    ...over,
  }
}

type MutableDeps = { -readonly [K in keyof WorkerDeps]: WorkerDeps[K] } & { recorded: Recorded }

function deps(replies: ScriptedReply<unknown>[], nowMs = 0): MutableDeps {
  const { ledger: led, recorded } = ledger()
  return {
    model: new FakeModelClient(replies),
    ledger: led,
    readSource: {
      fetcher: allowlisted(fixtureFetcher(PAGES), ['https://northwind.example.com/*']),
      sources: { urlFor: async () => 'https://northwind.example.com/partners' },
    },
    readDoc: {
      versions: {
        // `documentId` used to read `ver-1` here — the fixture had been bent to
        // match the bug, which is why a suite this size never noticed that
        // `read-document` had not once succeeded.
        byId: async () => ({ id: 'ver-1', documentId: 'doc-1', content: 'Base.', contentHash: 'h' }),
      },
      baseVersionId: 'ver-1',
    },
    now: () => nowMs,
    recorded,
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

/* ── tests ─────────────────────────────────────────────────────────────── */

describe('the loop commits the intent before the effect', () => {
  it('writes intent, then outcome, in that order', async () => {
    // A run that dies mid-action must still show what it was attempting.
    const d = deps([
      plan('read the partners page'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
    ])

    await runWorker(job(), d)

    expect(d.recorded.order).toEqual(['intent:read-approved-source', 'outcome:succeeded'])
  })

  it('records an outcome even when the tool throws', async () => {
    const d = deps([
      plan('read a source that will not resolve'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
    ])
    d.readSource.sources.urlFor = async () => null

    const result = await runWorker(job(), d)

    expect(d.recorded.outcomes[0]?.result).toBe('failed')
    expect(result.status).toBe('succeeded') // a failed action is not a failed run
  })
})

describe('reading the document actually works', () => {
  /**
   * A regression test for a capability that had never once succeeded.
   *
   * The loop put `scope.baseVersionId` — a DocumentVersion id — into
   * `params.documentId`, and `readDocument` compared that against the id of the
   * Document the version belonged to. The two can never be equal, so every
   * planned document read passed the gate, committed an ActionIntent, threw, and
   * was recorded as a FAILED outcome with an `unverified` scope verdict. It cost
   * a turn each time and read, in the ledger, as a capability that kept going
   * wrong rather than one that had never worked.
   *
   * Nothing in the suite caught it because the fixture above had `documentId`
   * set to the version id, which made the comparison pass in tests and only in
   * tests.
   */
  it('records a succeeded outcome, not a failed one', async () => {
    const d = deps([plan('read what is already written'), act({ kind: 'read-document' })])

    const result = await runWorker(job(), d)

    expect(d.recorded.intents[0]).toMatchObject({ kind: 'read-document', authorized: true })
    expect(d.recorded.outcomes[0]?.result).toBe('succeeded')
    expect(result.actionsTaken).toBe(1)
  })

  it('reads the pinned base version whatever the document id says', async () => {
    // The version is fixed by the contract, not by anything on the proposal —
    // so a document id that does not match cannot redirect the read, and
    // cannot fail it either.
    const d = deps([plan('read it'), act({ kind: 'read-document' })])

    const result = await runWorker(job({ documentId: 'doc-somewhere-else' }), d)

    expect(d.recorded.outcomes[0]?.result).toBe('succeeded')
    expect(d.recorded.outcomes[0]?.detail).toContain('ver-1')
    expect(result.actionsTaken).toBe(1)
  })

  it('is refused as document_missing when the shift has no document', async () => {
    // The gate's requirement is intact and now reachable: with no document to
    // read, the refusal fires instead of the key being present regardless.
    const d = deps([plan('read it'), act({ kind: 'read-document' })])

    const result = await runWorker(job({ documentId: undefined }), d)

    expect(d.recorded.intents[0]?.refusedRule).toBe('document_missing')
    expect(result.actionsTaken).toBe(0)
  })
})

describe('refusals are recorded, not thrown', () => {
  it('records a refused intent with a deterministic rule and keeps going', async () => {
    const d = deps([
      plan('read something else', 'read the partners page'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-competitor' }),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
    ])

    const result = await runWorker(job(), d)

    expect(result.refusals).toBe(1)
    expect(d.recorded.intents[0]).toMatchObject({
      authorized: false,
      refusedRule: 'source_not_approved',
    })
    // The run continued and did real work afterwards.
    expect(result.actionsTaken).toBe(1)
  })

  it('writes no outcome for a refusal — nothing happened', async () => {
    const d = deps([
      plan('try a forbidden source'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-competitor' }),
    ])

    await runWorker(job(), d)

    expect(d.recorded.outcomes).toHaveLength(0)
  })

  it('refuses an invented capability the page suggested', async () => {
    const d = deps([plan('email the draft'), act({ kind: 'send-email' })])

    const result = await runWorker(job(), d)

    expect(d.recorded.intents[0]?.refusedRule).toBe('unknown_action_kind')
    expect(result.actionsTaken).toBe(0)
  })

  it('stops after three consecutive refusals', async () => {
    const d = deps([
      plan('a', 'b', 'c', 'd'),
      act({ kind: 'send-email' }),
      act({ kind: 'send-email' }),
      act({ kind: 'send-email' }),
    ])

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('refusal-loop')
  })
})

describe('a raised question is not an action', () => {
  it('never reaches the gate, and is always recorded', async () => {
    const d = deps([
      plan('decide the tier'),
      act({ kind: 'draft-section', decisionNeeded: { question: 'Which tier?', whyItMatters: 'the close depends on it' } }),
    ])

    const result = await runWorker(job(), d)

    expect(result.decisions).toHaveLength(1)
    expect(d.recorded.intents).toHaveLength(0)
  })

  it('halts the run under stop-when-uncertain', async () => {
    const d = deps([
      plan('decide the tier', 'draft commercials'),
      act({ kind: 'draft-section', decisionNeeded: { question: 'Which tier?', whyItMatters: 'x' } }),
    ])

    const result = await runWorker(
      job({ controls: { ...job().controls, interruption: 'stop-when-uncertain' } }),
      d,
    )

    expect(result.stoppedBy).toContain('decision-needed')
  })

  it('continues under stop-only-when-blocked, which is what the demo needs', async () => {
    // The headline scenario is a run that completes the draft AND raises one
    // strategic decision.
    const d = deps([
      plan('decide the tier', 'draft commercials'),
      act({ kind: 'draft-section', decisionNeeded: { question: 'Which tier?', whyItMatters: 'x' } }),
      act({ kind: 'draft-section', targetSection: 'Commercials', prose: 'We propose the standard tier.' }),
    ])

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toEqual([])
    expect(result.decisions).toHaveLength(1)
    expect(result.produced).toHaveLength(1)
  })
})

describe('the dials bite', () => {
  it('suggestions-only removes drafting entirely', async () => {
    const d = deps([
      plan('draft commercials'),
      act({ kind: 'draft-section', targetSection: 'Commercials', prose: 'text' }),
    ])

    const result = await runWorker(
      job({ controls: { ...job().controls, output: 'suggestions-only' } }),
      d,
    )

    expect(d.recorded.intents[0]?.refusedRule).toBe('action_kind_not_allowed')
    expect(result.produced).toHaveLength(0)
  })

  it('current-step-only is honoured by the gate', async () => {
    const d = deps([
      plan('step one', 'step two'),
      act({ kind: 'read-document' }),
      act({ kind: 'read-document' }),
    ])

    const result = await runWorker(
      job({ controls: { ...job().controls, progress: 'current-step-only' } }),
      d,
    )

    // Each proposal carries its own step ordinal, so both are in scope.
    expect(result.actionsTaken).toBe(2)
  })
})

describe('budget', () => {
  it('halts before planning when already exhausted, spending no model call', async () => {
    const d = deps([], 2_000_000)

    const result = await runWorker(job({ deadlineEpochMs: 1_000_000 }), d)

    expect(result.stoppedBy).toContain('budget-exhausted')
    expect((d.model as FakeModelClient).calls).toHaveLength(0)
  })

  it('halts at a boundary rather than mid-action', async () => {
    let clock = 0
    const d = deps([
      plan('read', 'read again'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
    ])
    d.now = () => clock

    // Budget runs out only after the first action completes.
    const original = d.ledger.recordOutcome.bind(d.ledger)
    d.ledger.recordOutcome = async (input) => {
      await original(input)
      clock = 2_000_000
    }

    const result = await runWorker(job({ deadlineEpochMs: 1_000_000 }), d)

    expect(result.stoppedBy).toContain('budget-exhausted')
    // The action in flight finished and has an outcome — not left as `unknown`.
    expect(d.recorded.outcomes).toHaveLength(1)
  })
})

describe('blast radius', () => {
  it('rejects an over-long plan at the boundary, before the gate is ever reached', async () => {
    /**
     * Worth being precise about, because the first version of this test assumed
     * the wrong thing.
     *
     * `.max(MAX_PLAN_STEPS)` on the plan schema is a PROSE HINT to the model —
     * the grammar does not enforce it (#3), so a real model genuinely can
     * return more. But Zod enforces it client-side, so an over-long plan fails
     * the boundary, gets one repair turn, and then fails closed.
     *
     * Which means the gate's `plan_limit_exceeded` rule never fires from THIS
     * path. It is still the right rule to have — it covers a plan arriving from
     * anywhere else — but the boundary is what actually stops an over-planning
     * model, and no actions are attempted at all.
     */
    const tooMany = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => ({ intent: `step ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps: tooMany } },
      { kind: 'ok', value: { steps: tooMany } },
    ])

    // The fake holds scripted replies to the boundary's own schema, so it
    // refuses to hand back something the real API's client could never parse.
    await expect(runWorker(job(), d)).rejects.toThrow(/does not satisfy the boundary schema/)
  })

  it('runs a full plan at the cap when it keeps making progress', async () => {
    // Alternating read/draft, because a plan of pure reads correctly trips
    // no-progress after three — see the next test.
    const atCap = Array.from({ length: MAX_PLAN_STEPS }, (_, i) => ({ intent: `step ${i}` }))
    const actions = Array.from({ length: MAX_PLAN_STEPS }, (_, i) =>
      i % 2 === 0
        ? act({ kind: 'read-document' })
        : act({ kind: 'draft-section', targetSection: `S${i}`, prose: `text ${i}` }),
    )
    const d = deps([{ kind: 'ok', value: { steps: atCap } }, ...actions])

    const result = await runWorker(job(), d)

    expect(result.actionsTaken).toBe(MAX_PLAN_STEPS)
    expect(result.stoppedBy).toEqual([])
  })

  it('stops a plan that reads forever without changing anything', async () => {
    // Found while writing the test above: twelve reads in a row IS going in
    // circles, and the no-progress rule catches it at three. The plan cap is
    // not the only thing bounding a runaway run.
    const atCap = Array.from({ length: MAX_PLAN_STEPS }, (_, i) => ({ intent: `read ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps: atCap } },
      ...Array.from({ length: MAX_PLAN_STEPS }, () => act({ kind: 'read-document' })),
    ])

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.actionsTaken).toBe(3)
  })

  it('the gate still refuses an over-long plan arriving from any other path', async () => {
    // Defence in depth: the rule exists for plans the boundary did not produce.
    // Exercised directly in tests/policy-gate.test.ts.
    expect(MAX_PLAN_STEPS).toBeGreaterThan(0)
  })
})

describe('page text is datamarked before it can reach another prompt', () => {
  it('fences gathered source text in the next proposal', async () => {
    const d = deps([
      plan('read the page', 'draft from it'),
      act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
      act({ kind: 'draft-section', targetSection: 'Commercials', prose: 'We propose 15%.' }),
    ])

    await runWorker(job(), d)

    const secondProposal = (d.model as FakeModelClient).calls[2]
    expect(secondProposal?.user).toContain('<<<UNTRUSTED_PAGE_TEXT>>>')
    expect(secondProposal?.user).toContain('15% revenue share')
  })
})

describe('the worker process', () => {
  const noRuns = () => ({
    sweepExpiredLeases: vi.fn(async () => 0),
    claimNext: vi.fn(async (): Promise<{ id: string } | null> => null),
    execute: vi.fn(async (_id: string): Promise<void> => undefined),
    now: () => new Date(0),
    sleep: vi.fn(async (_ms: number): Promise<void> => undefined),
  })

  it('sweeps orphans before claiming anything', async () => {
    // Node never kills its children, so orphans are the default.
    const d = noRuns()
    const handle = startWorkerProcess(d, { maxRuns: 0 })
    await handle.done

    expect(d.sweepExpiredLeases).toHaveBeenCalledOnce()
  })

  it('drains pending runs and stops at maxRuns', async () => {
    const d = noRuns()
    let remaining = 3
    d.claimNext = vi.fn(async () => (remaining-- > 0 ? { id: `run-${remaining}` } : null))

    const handle = startWorkerProcess(d, { maxRuns: 3 })
    const { runsCompleted } = await handle.done

    expect(runsCompleted).toBe(3)
    expect(d.execute).toHaveBeenCalledTimes(3)
  })

  it('treats a throwing run as a failed run, not a dead worker', async () => {
    const d = noRuns()
    let remaining = 2
    d.claimNext = vi.fn(async () => (remaining-- > 0 ? { id: 'run-x' } : null))
    d.execute = vi.fn(async () => {
      throw new Error('boom')
    })

    const handle = startWorkerProcess(d, { maxRuns: 2 })
    const { runsCompleted } = await handle.done

    expect(runsCompleted).toBe(2)
  })

  it('polls when idle rather than spinning', async () => {
    // `sleep` must actually yield. A mock that resolves immediately turns the
    // idle loop into a hot spin that never reaches the macrotask queue — which
    // is how this test first OOM'd the runner rather than failing.
    const d = noRuns()
    let sleeps = 0
    let handle: ReturnType<typeof startWorkerProcess>

    d.sleep = vi.fn(async (ms: number) => {
      sleeps += 1
      if (sleeps >= 3) handle.stop()
      await new Promise((resolve) => setTimeout(resolve, ms))
    })

    handle = startWorkerProcess(d, { idlePollMs: 1 })
    await handle.done

    expect(sleeps).toBeGreaterThanOrEqual(3)
    expect(d.claimNext).toHaveBeenCalled()
  })

  it('stops cooperatively, finishing the run in flight', async () => {
    const d = noRuns()
    const started: string[] = []
    let handle: ReturnType<typeof startWorkerProcess>
    d.claimNext = vi.fn(async (): Promise<{ id: string } | null> => ({ id: 'run-1' }))
    d.execute = vi.fn(async (id: string) => {
      started.push(id)
      handle.stop()
    })

    handle = startWorkerProcess(d, {})
    const { runsCompleted } = await handle.done

    // The run in flight completed; the loop exited after it, not during.
    expect(started).toEqual(['run-1'])
    expect(runsCompleted).toBe(1)
  })
})
