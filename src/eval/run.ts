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
 */

import { handlesFor, sessionReadingBoundary } from '../model/boundaries/session-reading'
import type { SessionReadingOutput } from '../model/boundaries/session-reading'
import { baselineBoundary } from './baseline'
import type { BaselineOutput } from './baseline'
import { runMechanicalChecks } from './score'
import type { MechanicalChecks } from './score'
import { checkSeal, readSeals } from './seal'
import type { SealStatus } from './seal'
import { BrokenSealError } from './seal'
import type { Scenario } from './scenario'
import type { CallTelemetry, ModelClient } from '../model/client'

export interface ScenarioRun {
  readonly scenario: Scenario
  readonly seal: SealStatus
  readonly reading: SessionReadingOutput | null
  readonly baseline: BaselineOutput | null
  readonly checks: MechanicalChecks | null
  readonly telemetry: readonly CallTelemetry[]
  readonly failures: readonly string[]
}

export interface RunOptions {
  /** Also run the raw-log baseline, so the structured reading has something to
   *  be better than. Costs a second call per scenario. */
  readonly withBaseline?: boolean
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
  if (!readingResult.ok) failures.push(`reading: ${readingResult.failure} — ${readingResult.detail}`)

  let baseline: BaselineOutput | null = null
  if (options.withBaseline) {
    const baselineResult = await client.run(baselineBoundary, input)
    telemetry.push(baselineResult.telemetry)
    if (baselineResult.ok) baseline = baselineResult.value
    else failures.push(`baseline: ${baselineResult.failure} — ${baselineResult.detail}`)
  }

  const reading = readingResult.ok ? readingResult.value : null

  return {
    scenario,
    seal,
    reading,
    baseline,
    checks: reading ? runMechanicalChecks(reading, handles) : null,
    telemetry,
    failures,
  }
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
    out.push(`    ${checks.claimCount} claims`)
  }

  const byKind = (kind: string) => (c: { kind: string }) => c.kind === kind
  const kinds = [...new Set([...scenario.reference.map((c) => c.kind), ...(reading?.claims ?? []).map((c) => c.kind)])]

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
    out.push('  If this reads as well as the reading above, SessionReading is not earning its place.')
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
