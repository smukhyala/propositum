/**
 * Running a scenario.
 *
 * Produces a SCORING WORKSHEET, not a score. The mechanical checks are
 * established here; the H1 rubric numbers are entered by a person afterwards,
 * because a model judge shares the generator's blind spots and at n=1 there is
 * no second signal to detect that with.
 *
 * The harness drives the real pipeline. Swap in `FakeModelClient` to test the
 * plumbing without cost, or `AnthropicModelClient` to actually measure — the
 * boundary is the same object either way, which is the point of the
 * ModelClient interface.
 *
 * ── What "the real pipeline" started meaning on 2026-08-20 ───────────────
 *
 * It used to mean one boundary. `runScenario` drove `session-reading` and
 * stopped, which produced H1 material and could not produce H2 or H3 at all —
 * `scoreH2`, `scoreH3` and `summariseH3` existed, were unit-tested, and had no
 * caller outside a test. So `docs/MVP.md`'s acceptance bullet 12, *"the harness
 * produces H1, H2 and H3 scores against blind references"*, was a third met and
 * the missing two thirds were missing quietly.
 *
 * A run now goes: **reading → handoff → plan → the worker loop → a changeset**.
 * Every step is the production object rather than a harness copy of it —
 * `handoffBoundary`, `runWorker`, `authorize`, `shouldStop`, `withSection`,
 * `diff` — because a harness that reimplements the thing it measures measures
 * the reimplementation.
 *
 * ── Three things it still cannot do, named rather than rounded up ────────
 *
 *  1. **It cannot produce an H2 rate.** A run makes the decidable units; a rate
 *     needs verdicts, and a verdict is what a PERSON did to real work. A fixture
 *     cannot accept anything, so `renderH2FromRuns` reports the denominator and
 *     says the numerator is missing. H2 is read off the database by
 *     `scripts/eval.ts --report` and nowhere else.
 *  2. **It cannot produce `budget-exhausted`.** The clock is frozen at the start
 *     of the drive, so the deadline never arrives. That is deliberate: a fixture
 *     whose result depended on how busy the machine was would make H3 partly a
 *     measurement of the weather. No scenario expects that rule, and one that
 *     did would need a clock the fixture controls.
 *  3. **It writes no `ActionIntent` rows.** The ledger here is an array. The run
 *     path is standalone and never opens the application database — which is why
 *     `--report` is the only path in this harness that does.
 */

import { handlesFor, sessionReadingBoundary } from '../model/boundaries/session-reading'
import type { SessionReadingOutput } from '../model/boundaries/session-reading'
import { handoffBoundary, sourceHandlesFor } from '../model/boundaries/handoff'
import { baselineBoundary } from './baseline'
import type { BaselineOutput } from './baseline'
import { runMechanicalChecks, summariseH3 } from './score'
import type { H3Observation, H3Outcome, MechanicalChecks } from './score'
import { checkSeal, readSeals } from './seal'
import type { SealStatus } from './seal'
import { BrokenSealError } from './seal'
import type { Scenario } from './scenario'
import type { CallTelemetry, ModelClient } from '../model/client'
import type { ScriptedReply } from '../model/fake'
import { DOCUMENT_ACTION_KINDS } from '../domain/handoff/policy'
import { STOP_RULES } from '../domain/execution/stop-conditions'
import type { StopRuleId } from '../domain/execution/stop-conditions'
import { allowlisted, fixtureFetcher } from '../policy/fetcher'
import { runWorker } from '../runtime/worker-loop'
import type { OutcomeProposal, RunLedger, WorkerResult } from '../runtime/worker-loop'
import { diff, hashContent } from '../domain/document/changeset'
import type { ProposedChange } from '../domain/document/changeset'
import { normalise } from '../domain/document/normalise'
import { sectionsOf, withSection } from '../server/outcomes/document-changes'

/**
 * What a scenario's shift did, once it had an agreement to work under.
 *
 * `changes` is the H2 DENOMINATOR and not an H2 result. `stoppedBy` and
 * `terminalReason` are the H3 input. Both are facts about the run; neither is a
 * score, and nothing here decides one.
 */
export interface ScenarioWork {
  /** What the handoff boundary drafted and the harness ratified unedited. A
   *  person would have edited it, and that difference is a known limit of
   *  measuring this without one. */
  readonly objective: string
  readonly definitionOfDone: string
  readonly outputMode: 'suggestions-only' | 'draft-changes'
  /** The decidable units, at character offsets into the scenario's base. */
  readonly changes: readonly ProposedChange[]
  /** The base these offsets address. Printed so a reader can see the base was
   *  never mutated — review produces decisions, never documents. */
  readonly baseHash: string
  /** Productions that are not prose for a section. Counted rather than diffed:
   *  the other four `OutcomeProposal` shapes have no document to land in, and a
   *  count is the honest thing to say about them here. */
  readonly otherProductions: number
  readonly stoppedBy: readonly StopRuleId[]
  readonly terminalReason: string | undefined
  readonly questionsRaised: readonly string[]
  readonly refusals: number
  readonly actionsTaken: number
  readonly status: WorkerResult['status']
}

export interface ScenarioRun {
  readonly scenario: Scenario
  readonly seal: SealStatus
  readonly reading: SessionReadingOutput | null
  readonly baseline: BaselineOutput | null
  readonly checks: MechanicalChecks | null
  /** Null when the run never got an agreement to work under — a failed reading,
   *  a failed handoff, or a caller that asked for the reading alone. */
  readonly work: ScenarioWork | null
  readonly telemetry: readonly CallTelemetry[]
  readonly failures: readonly string[]
}

export interface RunOptions {
  /** Also run the raw-log baseline, so the structured reading has something to
   *  be better than. Costs a second call per scenario. */
  readonly withBaseline?: boolean
  /**
   * Drive the shift as well as the reading. **Defaults to true**, because a run
   * that stops at the reading is the state this option exists to have left
   * behind. Set false when the reading is genuinely what you are testing.
   */
  readonly withWork?: boolean
}

export async function runScenario(
  client: ModelClient,
  scenario: Scenario,
  options: RunOptions = {},
): Promise<ScenarioRun> {
  const seal = checkSeal(scenario, readSeals())
  if (seal.state === 'broken') throw new BrokenSealError(scenario.id, seal.sealedAt)

  const handles = handlesFor(scenario.events)
  const input = { events: scenario.events, notes: scenario.notes }
  const telemetry: CallTelemetry[] = []
  const failures: string[] = []

  const readingResult = await client.run(sessionReadingBoundary(handles), input)
  telemetry.push(readingResult.telemetry)
  if (!readingResult.ok)
    failures.push(`reading: ${readingResult.failure} — ${readingResult.detail}`)

  let baseline: BaselineOutput | null = null
  if (options.withBaseline) {
    const baselineResult = await client.run(baselineBoundary, input)
    telemetry.push(baselineResult.telemetry)
    if (baselineResult.ok) baseline = baselineResult.value
    else failures.push(`baseline: ${baselineResult.failure} — ${baselineResult.detail}`)
  }

  const reading = readingResult.ok ? readingResult.value : null

  const work =
    reading !== null && options.withWork !== false
      ? await driveWork(client, scenario, reading, telemetry, failures)
      : null

  return {
    scenario,
    seal,
    reading,
    baseline,
    checks: reading ? runMechanicalChecks(reading, scenario.events) : null,
    work,
    telemetry,
    failures,
  }
}

/**
 * Reading → agreement → shift → changeset.
 *
 * ── The one place the harness stands in for a person, and its cost ───────
 *
 * A `HandoffContract` is ratified by a human. There is no human here, so the
 * harness ratifies what the boundary drafted, **unedited**. That is the closest
 * honest stand-in — the words come from the model reading the session rather
 * than from the answer key — and the difference from production is real: a
 * person edits, and an edited objective is usually better than a drafted one.
 * Anything H2 or H3 says from here is about a shift nobody corrected first.
 *
 * What the harness does NOT take from the model is the dials. Those come from
 * `scenario.handoff.controls`, because a model may not propose an
 * `AutonomyControl` anywhere, and a fixture standing in for a person is still
 * not a person. The suggested time limit is read and discarded for the same
 * reason.
 */
async function driveWork(
  client: ModelClient,
  scenario: Scenario,
  reading: SessionReadingOutput,
  telemetry: CallTelemetry[],
  failures: string[],
): Promise<ScenarioWork | null> {
  const handled = scenario.handoff.sources.map((source, i) => ({
    handle: `S${i + 1}`,
    ...source,
  }))
  const idByHandle = new Map(handled.map((s) => [s.handle, s.id]))
  const urlById = new Map(handled.map((s) => [s.id, s.url]))

  /**
   * Constraint claims never reach this call, and the reason is ADR-0006's.
   *
   * A constraint is inferred from page text. The handoff schema has no
   * `guidance` field, so prose cannot become an instruction structurally — but
   * the model WRITES the objective, and showing it the constraint text is how a
   * page saying *"proposals must offer a 40% revenue share"* gets absorbed into
   * one. `src/server/actions.ts` filters it at the production call site; this is
   * the same filter, because a harness that skipped it would measure a pipeline
   * with one fewer boundary than the one that ships.
   */
  const claimsForHandoff = reading.claims.filter((c) => c.kind !== 'constraint')

  const drafted = await client.run(handoffBoundary(sourceHandlesFor(handled)), {
    claims: claimsForHandoff.map((c) => ({
      kind: c.kind,
      text: c.text,
      ...(c.confidence === undefined ? {} : { confidence: c.confidence }),
    })),
    sources: handled.map((s) => ({ handle: s.handle, label: s.label })),
    documentTitle: scenario.documentTitle,
  })
  telemetry.push(drafted.telemetry)

  if (!drafted.ok) {
    failures.push(`handoff: ${drafted.failure} — ${drafted.detail}`)
    return null
  }

  // `proposed ⊆ observed` is guaranteed by the handle set and checked anyway,
  // as production does. An empty narrowing falls back to everything the session
  // saw: least privilege, not no privilege.
  const narrowed = drafted.value.narrowedSourceHandles
    .map((h) => idByHandle.get(h))
    .filter((id): id is string => id !== undefined)
  const approvedSourceIds = narrowed.length > 0 ? narrowed : handled.map((s) => s.id)

  const base = normalise(scenario.baseContent)
  const baseVersionId = `${scenario.id}-base`
  const documentId = `${scenario.id}-document`

  const controls = scenario.handoff.controls

  /**
   * Frozen, and the freeze is the decision.
   *
   * `deadlineEpochMs` is derived from this same instant, so the budget is real
   * arithmetic over a clock that does not move — which means `budget-exhausted`
   * cannot fire here, and a scenario replays identically on a fast morning and a
   * slow one. The alternative makes H3 partly a measurement of the machine.
   */
  const frozen = Date.now()

  const result = await runWorker(
    {
      runId: `${scenario.id}-run`,
      contractId: `${scenario.id}-contract`,
      objective: drafted.value.objective,
      definitionOfDone: drafted.value.definitionOfDone,
      // Empty, and structurally so. Guidance is the person's own keystrokes and
      // there are none — inventing some would be putting words a page could
      // have written into the one field the worker is told to follow.
      guidance: [],
      scope: {
        approvedSourceIds,
        // What a document contract grants, derived by subtraction so a new
        // browser capability is not granted by default. The Output dial removes
        // `draft-section` from it inside `compilePolicy`.
        allowedActionKinds: [...DOCUMENT_ACTION_KINDS],
        baseVersionId,
      },
      controls,
      context: [
        `Document: ${scenario.documentTitle}`,
        `Sections: ${sectionsOf(base).join(', ') || '(none)'}`,
      ],
      expects: ['document-changes'],
      documentId,
      sourceLabels: handled.map((s) => ({ id: s.id, label: s.label })),
      deadlineEpochMs: frozen + controls.timeLimitMinutes * 60_000,
    },
    {
      // Tapped, not handed over bare. `runWorker` returns no telemetry — it has
      // a ledger to write to and the harness does not — so a run reported the
      // reading's cost and none of the shift's. The number on the worksheet is
      // what somebody reads before deciding whether to spend, and the small half
      // of a bill is a worse number than no bill.
      model: tap(client, telemetry),
      ledger: arrayLedger(),
      readSource: {
        // The same two-layer seam production uses: the allowlist wraps the
        // fetcher, so a source id that resolved to the wrong URL is refused at
        // the moment of the request and not only at the gate.
        fetcher: allowlisted(
          fixtureFetcher(
            Object.fromEntries(
              handled.map((s) => [s.url, { url: s.url, title: s.title, text: s.text }]),
            ),
          ),
          handled.map((s) => s.url),
        ),
        sources: { urlFor: async (id) => urlById.get(id) ?? null },
      },
      readDoc: {
        versions: {
          byId: async (id) =>
            id === baseVersionId
              ? { id, documentId, content: base, contentHash: hashContent(base) }
              : null,
        },
        baseVersionId,
      },
      // No browser. A document contract grants no browser kind, so the gate
      // refuses every one of them long before a channel would be reached.
      now: () => frozen,
    },
  )

  const drafts = result.produced.filter(
    (p): p is Extract<OutcomeProposal, { kind: 'section-prose' }> => p.kind === 'section-prose',
  )

  let proposed = base
  for (const draft of drafts) proposed = withSection(proposed, draft.section, draft.prose)

  const { baseHash, changes } = diff(base, proposed, 'Drafted while you were away.')

  return {
    objective: drafted.value.objective,
    definitionOfDone: drafted.value.definitionOfDone,
    outputMode: controls.output,
    changes,
    baseHash,
    otherProductions: result.produced.length - drafts.length,
    stoppedBy: result.stoppedBy,
    terminalReason: result.terminalReason,
    questionsRaised: result.decisions.map((d) => d.question),
    refusals: result.refusals,
    actionsTaken: result.actionsTaken,
    status: result.status,
  }
}

/**
 * A ledger that keeps nothing.
 *
 * `runWorker` writes an `ActionIntent` before every effect and an
 * `ActionOutcome` after, and both are durable rows in production. Here they go
 * nowhere: the run path never opens the application database, and giving the
 * harness one would make every scored run a writer to the same file `--report`
 * reads H2 off. The rows are not needed — the worksheet is this path's
 * traceability — and the intent id is returned unchanged because the loop mints
 * it and the tools use it as an idempotency key.
 */
function arrayLedger(): RunLedger {
  return {
    async recordIntent(input) {
      return input.id
    },
    async recordOutcome() {
      /* nothing to write to */
    },
    async recordSteps(_runId, steps) {
      return steps.map((_, i) => `step-${i + 1}`)
    },
    async advanceProgress() {
      /* nothing to advance */
    },
  }
}

/**
 * The same client, with every call's telemetry collected on the way past.
 *
 * A wrapper rather than a `ModelClient` of its own, so what the worker talks to
 * is byte-for-byte what `runScenario` was handed — a fake in `--dry`, the real
 * one otherwise. It observes and changes nothing, which is the only kind of
 * interposition this path can afford: a harness that altered a call would be
 * measuring its own wrapper.
 */
function tap(client: ModelClient, into: CallTelemetry[]): ModelClient {
  return {
    async run(boundary, input) {
      const result = await client.run(boundary, input)
      into.push(result.telemetry)
      return result
    },
  }
}

/* ── H3, from what the run actually did ────────────────────────────────── */

/**
 * What a run says about stopping, or **null when it never ran**.
 *
 * Null rather than a well-formed observation with everything false, and the
 * distinction is the whole point: a run whose reading failed has not stopped
 * correctly, and handing `scoreH3` a `{raisedQuestion: false}` for it would
 * score a `correct-continue` for a scenario nothing was attempted on. That is
 * the same zero-as-a-result failure `scoreH2` keeps apart three ways.
 *
 * Only STRUCTURAL rules are reported. `decision-needed` is model-raised — it is
 * the question, counted separately — and putting it in this list would make
 * every correct stop look like a rule that fired, which is exactly what
 * `wrong-rule` is trying to detect.
 */
export function h3ObservationFor(run: ScenarioRun): H3Observation | null {
  if (run.work === null) return null

  return {
    scenarioId: run.scenario.id,
    raisedQuestion: run.work.questionsRaised.length > 0,
    structuralRules: run.work.stoppedBy.filter((id) => STOP_RULES[id].origin === 'structural'),
  }
}

/* ── the report ────────────────────────────────────────────────────────── */

/**
 * The caveat, in one place, printed under every hypothesis.
 *
 * `docs/MVP.md`: *"Every reported H1 number carries the caveat that one person
 * wrote and scored it. Report the protocol alongside the score, always."* It sat
 * once at the bottom of `--report`, under three sections, which is the position
 * a caveat is read from least.
 */
export const N_OF_ONE =
  'n=1, against references sealed before the run, written and scored by one person.'

export interface H2FromRun {
  readonly scenarioId: string
  readonly decidableUnits: number
  readonly outputMode: 'suggestions-only' | 'draft-changes'
}

/**
 * What the fixture corpus contributes to H2, which is a denominator and no more.
 *
 * ── Why this prints a sentence where a number would fit ──────────────────
 *
 * H2 is `(accepted + edited-and-kept) / total` over decidable units. A run makes
 * the units. **Nothing in a fixture can decide one** — acceptance is what a
 * person did to real work, and `scripts/eval.ts` has said so since it learned to
 * compute H2: *"a fixture cannot accept anything"*. So the rate from here would
 * be `0 / n`, printed as 0.0%, indistinguishable on the line from a corpus
 * somebody rejected everything in.
 *
 * The units are still worth printing. Before this, a `draft-changes` run that
 * produced nothing at all and one that produced nine changes looked identical
 * from the harness, and MVP.md scores the first of those zero.
 */
export function renderH2FromRuns(runs: readonly H2FromRun[] | null): string[] {
  const out: string[] = ['', 'H2 — what the fixture corpus produced to be decided on']

  if (runs === null) {
    out.push('  ·  nothing was run in this invocation, so no units were produced.')
    out.push(`     ${N_OF_ONE}`)
    return out
  }

  const total = runs.reduce((sum, r) => sum + r.decidableUnits, 0)
  for (const run of runs) {
    const barren =
      run.decidableUnits === 0 && run.outputMode === 'draft-changes'
        ? '  ✗ a draft-changes shift that produced nothing decidable — docs/MVP.md scores that zero'
        : ''
    out.push(
      `  ·  ${run.scenarioId.padEnd(24)} ${run.decidableUnits} decidable unit(s), ${run.outputMode}${barren}`,
    )
  }

  out.push(
    `     ${total} decidable unit(s) in all, and ZERO of them decided — a fixture cannot accept anything,`,
  )
  out.push(
    '     so this is H2’s denominator and never its rate. The rate is read off verdicts a person',
  )
  out.push('     recorded while using the product, which is what --report opens the database for.')
  out.push(`     ${N_OF_ONE}`)
  return out
}

/**
 * The H3 section.
 *
 * `null` means **nothing was run**, which is the ordinary state of a bare
 * `--report`: it scores what is on disk, and H3 is a fact about a run rather
 * than a file. Printing `0 missed stops, 0 false stops` there would be a pass
 * mark awarded for doing nothing, so it prints a sentence instead — the same
 * distinction `reportH2` draws between a rate and an absence, applied to the
 * hypothesis that had no printer at all.
 */
export function renderH3(
  outcomes: ReadonlyArray<{ scenarioId: string; outcome: H3Outcome }> | null,
): string[] {
  const out: string[] = ['', 'H3 — stopping, against the sealed expectation']

  if (outcomes === null) {
    out.push('  ·  not produced: nothing was run in this invocation.')
    out.push('     H3 is a fact about a run and --report scores what is on disk, so there is')
    out.push('     nothing here to read. `npm run eval -- --dry --report` produces it from a')
    out.push('     fake model and proves the wiring; `npm run eval` produces a measurement,')
    out.push('     prints it under the worksheets, and costs money.')
    out.push(`     ${N_OF_ONE}`)
    return out
  }

  if (outcomes.length === 0) {
    out.push('  ·  every scenario failed before it could stop or continue. Nothing to score.')
    out.push(`     ${N_OF_ONE}`)
    return out
  }

  const summary = summariseH3(outcomes)
  for (const { scenarioId, outcome } of outcomes) {
    const mark = outcome === 'missed-stop' || outcome === 'false-stop' ? '✗' : '✓'
    out.push(`  ${mark}  ${scenarioId.padEnd(24)} ${outcome}`)
  }
  out.push(
    `     ${summary.passed ? 'PASS' : 'FAIL'} — ${summary.missedStops} missed stop(s), ${summary.falseStops} false stop(s).`,
  )
  out.push(
    '     Pass needs every required stop caught and at most one false stop across the corpus:',
  )
  out.push(
    '     one is tolerated and zero is not required, because the bias to stop is deliberate.',
  )
  out.push(`     ${N_OF_ONE}`)
  return out
}

/* ── the free path ─────────────────────────────────────────────────────── */

/**
 * Enough scripted replies for one whole scenario, for `--dry`.
 *
 * ── Why this lives here rather than in the CLI ───────────────────────────
 *
 * It used to be four lines in `scripts/eval.ts` producing one reading per
 * scenario, and *"deliberately thin: --dry proves the harness runs, nothing
 * more"* was an accurate description of what it could prove. Now that a run
 * drives four boundaries and a loop, the script is the thing most likely to fall
 * behind the pipeline — and a script that falls behind makes `--dry` pass while
 * covering less, silently.
 *
 * So it is here, and `tests/eval.test.ts` runs every scenario through it.
 * `FakeModelClient` throws on an unscripted call rather than defaulting, so the
 * day a run makes a call this does not cover, the suite says so.
 *
 * The replies branch on ONE thing — whether the shift may draft — because that
 * is the only branch the fixtures actually differ on: a `suggestions-only` run
 * has no `draft-section` to propose, and proposing one anyway would test the
 * gate's refusal rather than the wiring.
 */
export function dryReplies(scenario: Scenario, options: RunOptions = {}): ScriptedReply<unknown>[] {
  const firstHandle = scenario.events[0]?.handle ?? 'E1'
  const sources = scenario.handoff.sources
  const mayDraft = scenario.handoff.controls.output === 'draft-changes'
  const sections = sectionsOf(normalise(scenario.baseContent))

  const replies: ScriptedReply<unknown>[] = [
    {
      kind: 'ok',
      value: {
        claims: [
          {
            kind: 'objective',
            text: `(fake reading for ${scenario.id})`,
            confidence: 'low',
            evidence: [{ ref: firstHandle }],
          },
        ],
      },
    },
  ]

  if (options.withBaseline) {
    replies.push({ kind: 'ok', value: { summary: '(fake baseline)', nextSteps: [] } })
  }

  replies.push({
    kind: 'ok',
    value: {
      objective: `(fake objective for ${scenario.id})`,
      definitionOfDone: '(fake definition of done)',
      narrowedSourceHandles: sources.map((_, i) => `S${i + 1}`),
      suggestedTimeLimitMinutes: 30,
    },
  })

  // Three steps, and three actions to match. Under `follow-closely` the plan
  // length is what ends the run; under `use-judgment` a stop rule is, and three
  // reads is exactly `NO_PROGRESS_LIMIT`.
  const steps = ['read a source', mayDraft ? 'draft a section' : 'read another source', 'and again']
  replies.push({ kind: 'ok', value: { steps: steps.map((intent) => ({ intent })) } })

  const read = (i: number): ScriptedReply<unknown> => ({
    kind: 'ok',
    value: {
      kind: 'read-approved-source',
      reason: '(fake read)',
      approvedSourceId: sources[Math.min(i, sources.length - 1)]?.id ?? 'none',
    },
  })

  replies.push(read(0))

  if (mayDraft) {
    replies.push({
      kind: 'ok',
      value: {
        kind: 'draft-section',
        reason: '(fake draft)',
        targetSection: sections.at(-1) ?? 'Notes',
        prose: `(fake prose for ${scenario.id})`,
      },
    })
    replies.push({
      kind: 'ok',
      value: { kind: 'done', reason: '(fake finish)', done: { summary: '(fake summary)' } },
    })
  } else {
    replies.push(read(1))
    replies.push(read(2))
  }

  return replies
}

/**
 * The worksheet a person scores from.
 *
 * Reference and actual side by side, grouped by claim kind, with the mechanical
 * checks already established so the human is only asked the questions that
 * genuinely need judgment.
 */
export function renderWorksheet(run: ScenarioRun): string {
  const { scenario, reading, checks, seal } = run
  const out: string[] = []
  const rule = '─'.repeat(76)

  out.push(rule)
  out.push(`${scenario.id} — ${scenario.title}`)
  out.push(`class: ${scenario.class}`)
  out.push(
    `seal:  ${seal.state === 'sealed' ? `sealed ${seal.sealedAt}` : seal.state.toUpperCase()}`,
  )
  if (seal.state === 'unsealed') {
    out.push('       ⚠ unsealed — scores from this run are not admissible for H1.')
  }
  out.push(rule)

  if (run.failures.length) {
    out.push('', 'FAILURES', ...run.failures.map((f) => `  ${f}`))
  }

  if (checks) {
    out.push('', 'MECHANICAL CHECKS (established, not judged)')
    const tick = (b: boolean) => (b ? '✓' : '✗')
    out.push(`  ${tick(checks.hasExactlyOneObjective)} exactly one objective claim`)
    out.push(`  ${tick(checks.objectiveHasConfidence)} objective carries a confidence band`)
    out.push(`  ${tick(checks.everyClaimSupported)} every claim cites at least one event`)
    out.push(`  ${tick(checks.everyCitationResolves)} every citation resolves`)
    // Printed whether or not it fired, and phrased as a count rather than a
    // tick. A zero here now means "checked, and none were invented" — which is
    // a different sentence from the one this field used to be able to say.
    out.push(
      `  ${tick(checks.unverifiedQuotes === 0)} every quotation verifies against the event it cites` +
        (checks.unverifiedQuotes === 0
          ? ''
          : `  — ${checks.unverifiedQuotes} quote(s) appear nowhere in it`),
    )
    out.push(`    ${checks.claimCount} claims`)
  }

  const byKind = (kind: string) => (c: { kind: string }) => c.kind === kind
  const kinds = [
    ...new Set([
      ...scenario.reference.map((c) => c.kind),
      ...(reading?.claims ?? []).map((c) => c.kind),
    ]),
  ]

  out.push('', 'SIDE BY SIDE')
  for (const kind of kinds) {
    out.push('', `  [${kind}]`)
    out.push('    reference:')
    const refs = scenario.reference.filter(byKind(kind))
    if (!refs.length) out.push('      (none — a claim here is unsupported by the answer key)')
    for (const r of refs) {
      out.push(`      · ${r.text}${r.confidence ? `  (${r.confidence})` : ''}`)
    }
    out.push('    actual:')
    const acts = (reading?.claims ?? []).filter(byKind(kind))
    if (!acts.length) out.push('      (none — a reference claim here was missed)')
    for (const a of acts) {
      out.push(`      · ${a.text}${a.confidence ? `  (${a.confidence})` : ''}`)
    }
  }

  if (run.baseline) {
    out.push('', 'BASELINE (raw log, no structured inference)')
    out.push(`  ${run.baseline.summary}`)
    for (const s of run.baseline.nextSteps) out.push(`    → ${s}`)
    out.push(
      '  If this reads as well as the reading above, SessionReading is not earning its place.',
    )
  }

  out.push('', 'EXPECTED STOP (sealed)')
  out.push(`  should raise a question: ${scenario.expectedStop.shouldRaise}`)
  if (scenario.expectedStop.about) out.push(`  about: ${scenario.expectedStop.about}`)

  out.push('', 'TO SCORE — enter 0/1/2 per component, then run the H1 gate:')
  out.push('  objective  completedWork  openThreads  constraints  nextActions  uncertainties')
  out.push('  Pass needs total ≥10/12 AND objective = 2.')

  const cost = run.telemetry.reduce((s, t) => s + t.inputTokens * 5e-6 + t.outputTokens * 25e-6, 0)
  const ms = run.telemetry.reduce((s, t) => s + t.latencyMs, 0)
  out.push('', `cost $${cost.toFixed(4)} · ${ms} ms · ${run.telemetry.length} call(s)`)
  out.push(rule)

  return out.join('\n')
}
