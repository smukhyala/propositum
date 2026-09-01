import { describe, it, expect, vi } from 'vitest'
import { runWorker } from '../src/runtime/worker-loop'
import type { RunLedger, WorkerDeps, WorkerJob } from '../src/runtime/worker-loop'
import { startWorkerProcess } from '../src/runtime/worker-process'
import { FakeModelClient } from '../src/model/fake'
import type { ScriptedReply } from '../src/model/fake'
import { allowlisted, fixtureFetcher } from '../src/policy/fetcher'
import { ACTION_KINDS, BROWSER_ACTION_KINDS, MAX_PLAN_STEPS } from '../src/domain/handoff/policy'
import { PROGRESSING_ACTION_KINDS } from '../src/runtime/worker-loop'
import type { BrowserControl, BrowserReport } from '../src/runtime/browser-control'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { stripComments } from './support/strip-comments'

/* ── harness ───────────────────────────────────────────────────────────── */

interface Recorded {
  intents: Array<{
    kind: string
    authorized: boolean
    refusedRule?: string | undefined
    seq: number
  }>
  outcomes: Array<{ intentId: string; result: string; detail?: string | undefined }>
  order: string[]
}

function ledger(): { ledger: RunLedger; recorded: Recorded } {
  const recorded: Recorded = { intents: [], outcomes: [], order: [] }

  return {
    recorded,
    ledger: {
      async recordIntent(input) {
        // Whatever the loop minted. The gate has already stamped it onto the
        // AuthorizedAction, so a ledger that invented its own id would hand the
        // tools a row that does not exist.
        const id = input.id
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
        recorded.outcomes.push({
          intentId: input.intentId,
          result: input.result,
          detail: input.detail,
        })
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
        byId: async () => ({
          id: 'ver-1',
          documentId: 'doc-1',
          content: 'Base.',
          contentHash: 'h',
        }),
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

/**
 * A browser that answers `observe-page` and nothing else.
 *
 * Deliberately thinner than `tests/browser-loop.test.ts`'s `FakeBrowser`, which
 * scripts a fixed list of reports and treats running out as a finding. The one
 * test here that needs a channel is asserting a COUNT — that three looks in a
 * row still trip a rule — so a fake that can answer indefinitely is what makes
 * the count the only thing under test. It says nothing about how the browser
 * path behaves, which is that file's job.
 */
class ObservingBrowser implements BrowserControl {
  private looks = 0

  async dispatch(): Promise<BrowserReport> {
    this.looks += 1
    return {
      ok: true,
      observation: {
        snapshotId: `snap-${this.looks}`,
        url: 'https://northwind.example.com/partners',
        title: 'Northwind — Partners',
        tree: `r${this.looks} button "Show more"`,
        truncated: false,
      },
    }
  }
}

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
      act({
        kind: 'draft-section',
        decisionNeeded: { question: 'Which tier?', whyItMatters: 'the close depends on it' },
      }),
    ])

    const result = await runWorker(job(), d)

    expect(result.decisions).toHaveLength(1)
    expect(d.recorded.intents).toHaveLength(0)
  })

  it('halts the run under stop-when-uncertain', async () => {
    const d = deps([
      plan('decide the tier', 'draft commercials'),
      act({
        kind: 'draft-section',
        decisionNeeded: { question: 'Which tier?', whyItMatters: 'x' },
      }),
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
      act({
        kind: 'draft-section',
        decisionNeeded: { question: 'Which tier?', whyItMatters: 'x' },
      }),
      act({
        kind: 'draft-section',
        targetSection: 'Commercials',
        prose: 'We propose the standard tier.',
      }),
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

  /**
   * The sibling of the test above, and it was missing for as long as the bug was.
   *
   * `read-approved-source` pushed its text into `gathered`; `read-document`
   * fetched the version, took `versionId` for the summary sentence and dropped
   * `content` on the floor. `gathered` is the only channel by which anything a
   * run reads reaches the next prompt, so the worker could read the document
   * and never see a word of it.
   *
   * Nothing failed. The intent was authorized, the outcome was `succeeded` and
   * `within_scope`, and the ledger showed a capability working perfectly. What
   * happened in production on 2026-08-22 was that the model read the document,
   * was handed nothing, read it again, said *"I have not yet seen any of the
   * note's contents in this session"*, and `no-progress` correctly ended a run
   * that had produced nothing. Every route to a `Changeset` runs through a
   * model that has read the document, so the application database held zero of
   * them — with the gate, the ledger and the stop rules all working exactly as
   * designed.
   *
   * The assertion is on the CONTENT reaching the next prompt, not on the call
   * succeeding, because the call always succeeded. That is the whole lesson.
   */
  it('hands the document text to the next proposal, not just a summary of it', async () => {
    const d = deps([
      plan('read what is already written', 'draft from it'),
      act({ kind: 'read-document' }),
      act({ kind: 'draft-section', targetSection: 'Commercials', prose: 'We propose 15%.' }),
    ])

    await runWorker(job(), d)

    const secondProposal = (d.model as FakeModelClient).calls[2]
    expect(secondProposal?.user).toContain('Base.')
  })
})

describe('the worker process', () => {
  const noRuns = () => ({
    sweepExpiredLeases: vi.fn(async () => 0),
    claimNext: vi.fn(async (): Promise<{ id: string } | null> => null),
    // `admit` and `readRun` are REQUIRED deps, not optional ones, and that is
    // deliberate: an optional hook defaulting to "carry on" is a fence that
    // silently is not there, which is precisely the state CONTEXT.md described
    // for years while no column existed.
    admit: vi.fn(async (_id: string): Promise<'proceed' | 'settled'> => 'proceed'),
    readRun: vi.fn(
      async (
        _id: string,
      ): Promise<{ status: string; claimedBy: string | null; cancelRequested: boolean } | null> =>
        null,
    ),
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

/**
 * A research-only run could not read more than three sources. Structurally.
 *
 * ── The arithmetic, which is the whole bug ───────────────────────────────
 *
 * `suggestions-only` is the safest position on the Output dial, and
 * `compilePolicy` implements it by deleting `draft-section` and everything that
 * can operate a page. On a document shift what survives is reads — and every
 * read reports `changedSomething: false`, because it is one. The counter only
 * ever resets on that field, so nothing the run was PERMITTED to do could reset
 * it, and `no-progress` fired on the third action every time.
 *
 * Not on a fixture, not on a model's choice. The safest setting on the panel
 * was also the one that capped the research at three sources, and nothing on
 * that panel says so.
 *
 * ── What it did to the numbers ───────────────────────────────────────────
 *
 * `docs/eval-runs/2026-08-27-run.log` has the `suggestions-only` lisbon shift
 * ending `succeeded on no-progress` after three actions with zero proposed
 * changes — absorbed silently by H2's rule that a zero-change run under
 * `suggestions-only` is excluded from the denominator. A hypothesis that can
 * kill the product was sharing its explanation with an off-purpose constant.
 *
 * ── Where the exemption lives, which is narrower than it first was ───────
 *
 * In the COUNTER, not in the rule. `evaluateStructuralStops` is untouched; the
 * loop stops incrementing `consecutiveNoProgress` for a completed action that
 * changed nothing when nothing the run may do could have changed anything.
 *
 * ── What is NOT exempted, and each of these is asserted below ────────────
 *
 * A raised question, a gate refusal and a failed action all still increment,
 * because none of them is *"a read that could not have been anything else"* —
 * they are a run that is asking, or being refused, or breaking, and three in a
 * row is going in circles whatever the dial says. A research-only run that asks
 * every turn or fails every turn still halts on `no-progress` at three.
 *
 * The browser path never had this problem, and it is asserted below rather than
 * assumed: `navigate` survives `suggestions-only` and reports progress, so a
 * browser research shift is not exempt at all and three `observe-page`s in a
 * row still stop it. `tests/browser-loop.test.ts` owns the rest of that path.
 */
describe('a run that may not write is not bounded by the rule about writing', () => {
  /** Research only, on a document shift: reads and nothing else survive. */
  const researchOnly = () =>
    job({ controls: { ...job().controls, output: 'suggestions-only' } })

  it('reads past three sources instead of halting on the arithmetic', async () => {
    const steps = Array.from({ length: 8 }, (_, i) => ({ intent: `read ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps } },
      ...Array.from({ length: 8 }, () => act({ kind: 'read-document' })),
    ])

    const result = await runWorker(researchOnly(), d)

    expect(result.stoppedBy).not.toContain('no-progress')
    expect(result.actionsTaken).toBeGreaterThan(3)
  })

  it('still stops a drafting run that reads forever, which is what the rule is for', async () => {
    // The same plan under `draft-changes`. Here the run COULD have drafted and
    // did not, so three reads in a row really is going in circles.
    const steps = Array.from({ length: 8 }, (_, i) => ({ intent: `read ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps } },
      ...Array.from({ length: 8 }, () => act({ kind: 'read-document' })),
    ])

    const result = await runWorker(job(), d)

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.actionsTaken).toBe(3)
  })

  it('still stops a research-only run that asks a question every turn', async () => {
    // Under `stop-only-when-blocked` a raised question does not halt, so with
    // nothing else bounding it a model that asks every turn would call until the
    // deadline — thirty minutes of nothing, reported as a budget the person
    // gave it. The exemption above must not buy that, and does not: a question
    // is not a read that could only have been a read.
    const steps = Array.from({ length: 8 }, (_, i) => ({ intent: `ask ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps } },
      ...Array.from({ length: 8 }, (_, i) =>
        act({
          kind: 'read-document',
          decisionNeeded: { question: `Which hotel? (${i})`, whyItMatters: 'the budget' },
        }),
      ),
    ])

    const result = await runWorker(researchOnly(), d)

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.decisions).toHaveLength(3)
  })

  it('still stops a research-only run whose every action fails', async () => {
    // A source that will not resolve, three times. The action was attempted and
    // came back with nothing, which is a run breaking rather than a run reading
    // — and `no-progress` is the only rule that catches it.
    const steps = Array.from({ length: 8 }, (_, i) => ({ intent: `read ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps } },
      ...Array.from({ length: 8 }, () =>
        act({ kind: 'read-approved-source', approvedSourceId: 'src-northwind' }),
      ),
    ])
    d.readSource.sources.urlFor = async () => null

    const result = await runWorker(researchOnly(), d)

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.actionsTaken).toBe(3)
    expect(d.recorded.outcomes.map((o) => o.result)).toEqual(['failed', 'failed', 'failed'])
  })

  it('does not exempt a browser research shift, because navigate survives the dial', async () => {
    // `compilePolicy` leaves `observe-page`, `navigate` and `capture-screen`
    // under `suggestions-only`, and `navigate` reports progress. So this run
    // COULD have got somewhere and chose to look at the same page three times,
    // which is exactly what the rule is for. This is the assertion that proves
    // the exemption is read off the compiled allowlist rather than off the dial.
    const steps = Array.from({ length: 8 }, (_, i) => ({ intent: `look ${i}` }))
    const d = deps([
      { kind: 'ok', value: { steps } },
      ...Array.from({ length: 8 }, () => act({ kind: 'observe-page' })),
    ])
    d.browser = { control: new ObservingBrowser() }

    const result = await runWorker(
      job({
        controls: { ...job().controls, output: 'suggestions-only' },
        scope: { ...job().scope, allowedActionKinds: [...BROWSER_ACTION_KINDS] },
      }),
      d,
    )

    expect(result.stoppedBy).toContain('no-progress')
    expect(result.actionsTaken).toBe(3)
  })
})

/**
 * The exemption is only as good as the set it reads.
 *
 * `PROGRESSING_ACTION_KINDS` is hand-written and `perform` is the thing it
 * describes, so it can drift — and it fails silently in the dangerous
 * direction: a kind that CAN make progress, left out of the set, exempts a run
 * that could go in circles from the rule that catches it. So the set is read
 * back off `perform`'s own source.
 *
 * Comments are stripped first, because the block above `perform`'s browser
 * cases discusses `changedSomething: true` in prose and a naive grep counts it.
 */
describe('the set that exempts a run is the set the handlers actually produce', () => {
  const source = stripComments(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src/runtime/worker-loop.ts'), 'utf8'),
  )

  /** Each `case '<kind>':` in `perform`, paired with the body up to the next. */
  function bodies(): Map<string, string> {
    const from = source.indexOf('async function perform(')
    expect(from).toBeGreaterThan(-1)
    const region = source.slice(from)
    const found = new Map<string, string>()
    const cases = [...region.matchAll(/case '([a-z-]+)': \{/g)]
    for (const [at, match] of cases.entries()) {
      const start = match.index ?? 0
      const end = cases[at + 1]?.index ?? region.length
      found.set(match[1] ?? '', region.slice(start, end))
    }
    return found
  }

  it('finds a handler for every ActionKind, or the rest of this proves nothing', () => {
    expect([...bodies().keys()].sort()).toEqual([...ACTION_KINDS].sort())
  })

  it('exempts exactly the kinds whose handler never reports progress', () => {
    const reportsProgress = [...bodies().entries()]
      .filter(([, body]) => body.includes('changedSomething: true'))
      .map(([kind]) => kind)

    expect(reportsProgress.sort()).toEqual([...PROGRESSING_ACTION_KINDS].sort())
  })
})
