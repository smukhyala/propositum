/**
 * Screen C — "While you were away".
 *
 * ── Everything here is a rendering of durable rows ───────────────────────
 *
 * Exactly one sentence on this screen was written by a model: the narrative
 * line, read straight off the `ShiftReport` row, and allowed to be absent. Every
 * other line is derived here, deterministically, from the ledger, the plan
 * steps, the changeset, the capture gaps and the run's terminal status —
 * PRODUCT_PRINCIPLES §8. A model summarising its own ledger can soften or omit;
 * the ledger underneath is the receipt.
 *
 * ── Two screens, chosen here ─────────────────────────────────────────────
 *
 * The document is never locked during a shift (ADR-0003), so the person can
 * edit it while Propositum works. When they have, the base has moved and the
 * whole changeset is refused rather than merged — their edit always wins. That
 * is routine, and what it needs is not a greyed-out review surface but an
 * explanation, so it renders `DriftedShift` instead: no diff, no verdicts.
 *
 * ── Why this reads `db.prisma` directly in places ────────────────────────
 *
 * `repos` has no reader for `ActionIntent`, `ActionOutcome`, `PlanStep` or
 * `AgentRun`-by-contract, and those four ARE the report — "what I did" and
 * "what I didn't do, and why" render from the ledger or they are model prose
 * wearing a table's clothes. Everything still goes through `appContext()`, so
 * there is one handle and the append-only guards are verified before this page
 * can read anything. The repository methods this wants are named in the report.
 */

import Link from 'next/link'
import type { PrismaClient } from '@prisma/client'

import { appContext } from '@/server/db'
import { checkDrift, diff, materialise } from '@/domain/document/changeset'
import type { ChangeScale, FoldableChange } from '@/domain/document/changeset'
import { linesOf, normalise } from '@/domain/document/normalise'
import { MUTATING_ACTION_KINDS } from '@/domain/handoff/policy'
import { asShiftOutcomeKind, isDecidable, readOutcomeDetail } from '@/domain/outcome/shift-outcome'
import { whereItStopped } from '@/domain/intention/where-it-stopped'
import { BackLink, Empty, Masthead, Sheet } from '@/ui/primitives'
import { Away } from '@/ui/sprites'
import { DriftedShift, ShiftReport } from '@/ui/shift-report'
import type { DecisionView, LogRow, ShiftWindow } from '@/ui/shift-report'
import type { OutcomeView } from '@/ui/outcome'
import type { ChangeView } from '@/ui/diff'

/** Every line here is read out of the database on the way past. There is
 *  nothing to cache and a stale re-entry note is a lie about a live shift. */
export const dynamic = 'force-dynamic'

/* ── time, said the way a person says it ────────────────────────────────── */

const CLOCK = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })

function at(when: Date): string {
  return CLOCK.format(when)
}

/* ── small readers ──────────────────────────────────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function textOf(source: Record<string, unknown>, key: string): string | null {
  const value = source[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function numberOf(source: Record<string, unknown>, key: string): number | null {
  const value = source[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/* ── what an action was, in plain words ─────────────────────────────────── */

/**
 * One ActionIntent as a phrase, from the kind and its recorded parameters.
 *
 * Deterministic and code-authored on purpose. The model's own `reason` for
 * wanting the action is shown too, but always as an attributed quotation —
 * on a hostile page that sentence is downstream of attacker text, and prose
 * from a page must never be presented as Propositum's own account of itself.
 */
function actionPhrase(kind: string, params: Record<string, unknown>, sourceLabels: ReadonlyMap<string, string>): string {
  switch (kind) {
    case 'read-approved-source': {
      const id = textOf(params, 'approvedSourceId')
      const label = id === null ? null : sourceLabels.get(id) ?? null
      return `read ${label ?? 'one of your approved sources'}`
    }
    case 'read-document':
      return 'read your document'
    case 'draft-section': {
      const section = textOf(params, 'sectionPath')
      return section === null ? 'draft a section' : `draft ${section}`
    }
    case 'complete-purchase':
      // The amount and origin ride the outcome's own detail line, which is
      // code-composed from the attested charge — this phrase names the act.
      return 'complete the purchase you authorised'
    default:
      // The kind is a model-supplied string when the gate refused it as
      // unknown, so it is never rendered. The quoted reason below carries the
      // specifics, where it reads as something Propositum was told.
      return 'do something I have no way to do'
  }
}

/** The same phrase, past tense, for a thing that happened. */
function didPhrase(kind: string, params: Record<string, unknown>, sourceLabels: ReadonlyMap<string, string>): string {
  const phrase = actionPhrase(kind, params, sourceLabels)
  if (phrase.startsWith('draft ')) return `Drafted ${phrase.slice('draft '.length)}`
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/** Deterministic rule ids, said as sentences. Never the id itself. */
const REFUSAL_REASONS: Record<string, string> = {
  source_not_approved: "It isn't one of your approved sources, so I never opened it.",
  source_missing: "There was no approved source named, so there was nothing to check against your list.",
  action_kind_not_allowed: "Your settings don't allow that.",
  unknown_action_kind:
    "I can't do that at all — reading your approved sources and drafting text is the whole of what I can do. If that came from a page rather than from you, it's worth a look.",
  document_missing: 'No document was named.',
  off_plan: 'It was outside the plan, and you asked me to follow it closely.',
  step_out_of_scope: 'It was a step ahead of the one I was on, and you asked me to finish that first.',
  plan_limit_exceeded: 'The plan was longer than I am allowed to work through.',
  budget_exhausted: 'The time you gave me had already run out.',
  purchase_not_authorized:
    "You didn't authorise a purchase in this agreement, so buying is refused outright.",
  purchase_count_exceeded:
    'The charges you authorised were already used up, so no further purchase was allowed.',
  purchase_expired: 'Your authorisation to spend had already ended with the agreement.',
}

/* ── where a change lands ───────────────────────────────────────────────── */

interface Heading {
  readonly start: number
  readonly title: string
}

/**
 * The headings of the version you left, with their offsets.
 *
 * Orientation only. The address of a change is its offset pair — heading paths
 * were rejected as an addressing scheme because they cannot tell two changes in
 * one section apart, and they break exactly when the worker renames a heading,
 * which is a thing a good draft does.
 */
function headingsOf(base: string): Heading[] {
  const found: Heading[] = []
  for (const line of linesOf(base)) {
    const match = /^#{1,6}\s+(.*)$/.exec(line.text.trimStart())
    const title = match?.[1]?.trim()
    if (title) found.push({ start: line.start, title })
  }
  return found
}

function headingAbove(headings: readonly Heading[], offset: number): string | null {
  let title: string | null = null
  for (const heading of headings) {
    if (heading.start <= offset) title = heading.title
    else break
  }
  return title
}

/* ── scale ──────────────────────────────────────────────────────────────── */

/**
 * "changed 4 words", "rewrote 2 sentences".
 *
 * The label is not persisted, so it is recomputed with the same function that
 * produced the changeset in the first place: fold every change into the base,
 * diff the result against the base, and match block for block by offset. That
 * is the original computation re-run, not a second implementation of it — a
 * renderer that computes its own scale is how two parts of the product come to
 * disagree about how big a change is.
 */
function scalesByOffset(base: string, changes: readonly FoldableChange[]): Map<number, ChangeScale> {
  const byOffset = new Map<number, ChangeScale>()
  if (changes.length === 0) return byOffset

  const whole = materialise(
    base,
    changes,
    changes.map((_, changeIndex) => ({ changeIndex, verdict: 'accept' as const })),
  )
  for (const recomputed of diff(base, whole, '').changes) {
    byOffset.set(recomputed.startOffset, recomputed.scale)
  }
  return byOffset
}

/** When a block did not line up, scale the pair on its own rather than guess. */
function scaleOfPair(before: string, after: string): ChangeScale {
  const single = diff(before, after, '').changes
  const only = single.length === 1 ? single[0] : undefined
  if (only) return only.scale

  if (before.trim() === '') return { kind: 'added', label: 'added text', similarity: 0 }
  if (after.trim() === '') return { kind: 'removed', label: 'removed text', similarity: 0 }
  return { kind: 'edited', label: 'changed text', similarity: 0 }
}

/* ── the page ───────────────────────────────────────────────────────────── */

export default async function ShiftPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params
  const { db, repos } = await appContext()

  const contract = await repos.contracts.byId(contractId)
  if (!contract) return <Missing />

  const session = await repos.sessions.byId(contract.sessionId)
  const project = session ? await repos.projects.byId(session.projectId) : null

  const runs = await db.prisma.agentRun.findMany({
    where: { contractId },
    orderBy: { createdAt: 'asc' },
    include: {
      steps: { orderBy: { ordinal: 'asc' } },
      intents: { orderBy: { seq: 'asc' }, include: { outcome: true } },
    },
  })

  if (contract.acceptedAt === null || runs.length === 0) {
    return (
      <NotStarted
        title={project?.name ?? 'This project'}
        up={
          project
            ? { href: `/projects/${project.id}`, label: project.name }
            : { href: '/', label: 'All projects' }
        }
        sessionHref={`/sessions/${contract.sessionId}`}
      />
    )
  }

  /* ── the shift's boundaries ───────────────────────────────────────────── */

  const worker = runs.find((run) => run.role === 'worker') ?? runs[0]!
  const last = runs[runs.length - 1]!
  const live = runs.some((run) => run.status === 'pending' || run.status === 'claimed' || run.status === 'running')
  /**
   * The run "Take back control" would stop, or null.
   *
   * The newest live one rather than the first, because a shift's runs are a
   * chain — a continuation carrying `resumesRunId` is what picks the work up
   * after a confirmation — and the one still going is the one at the end.
   * Halting an earlier one would report success and stop nothing.
   *
   * A parked run is deliberately NOT here. It is not live by the test above, so
   * it never becomes `liveRunId` and this screen never offers to stop it.
   *
   * ~~Stopping it is reached from the question's own screen, where a person can
   * see what they are closing.~~ **Struck the day it was written.** There is no
   * such control: `/shifts/[contractId]/confirm/[requestId]` offers *Go ahead*,
   * *Don't*, and — since #139 — a fresh handover, and nothing that ends the run
   * without answering. So ADR-0030's step 0 has one caller, `takeBackControl`,
   * and it is reachable only while the run is live. A person who wants to close
   * a parked question answers it. Naming a screen that has no such control is
   * the defect #141 was written to remove, and writing it into the fix would
   * have been the second time.
   */
  const liveRunId =
    [...runs]
      .reverse()
      .find((run) => run.status === 'pending' || run.status === 'claimed' || run.status === 'running')
      ?.id ?? null
  const endedAt = live ? null : last.endedAt
  const sweptAwake = last.terminalReason === 'lease-expired'

  const shiftWindow: ShiftWindow = {
    startedLabel: at(contract.acceptedAt),
    endedLabel: endedAt === null ? 'still going' : at(endedAt),
    approximate: !live && sweptAwake,
    approximateWhy:
      !live && sweptAwake
        ? 'Your Mac slept and I stopped then. I only noticed when it woke, so that end time is when I noticed — not when I stopped.'
        : null,
  }

  /* ── the document, and whether it moved ───────────────────────────────── */

  // `baseVersionId` is nullable now: a Shift that acted in a browser pins no
  // document. Everything below already copes with `baseRow` being absent — it
  // was written for the case where the version was deleted — so the only new
  // thing is not asking for a row when there is no id to ask about.
  const baseRow =
    contract.baseVersionId === null
      ? null
      : await db.prisma.documentVersion.findUnique({
          where: { id: contract.baseVersionId },
          select: { id: true, ordinal: true, content: true, documentId: true, document: { select: { title: true } } },
        })
  const baseContent = normalise(baseRow?.content ?? '')
  const headings = headingsOf(baseContent)
  const latest = baseRow ? await repos.documents.latestVersion(baseRow.documentId) : null

  /* ── the changes ──────────────────────────────────────────────────────── */

  const changeset = await repos.changesets.forContract(contractId)

  /**
   * Has this review already been folded into a version?
   *
   * A settled review is not a drifted one and must not render as either. The
   * changes are in the document, the decisions are on the record, and the only
   * honest thing left to say is which version came out of it — so the drift
   * check is skipped entirely rather than reporting a base that legitimately
   * moved because we ourselves moved it.
   */
  const settledVersion =
    changeset?.settledAsVersionId === undefined || changeset.settledAsVersionId === null
      ? null
      : await repos.documents.version(changeset.settledAsVersionId)

  const drift =
    settledVersion !== null
      ? ({ ok: true } as const)
      : changeset && latest
        ? checkDrift(latest.content, changeset.baseHash)
        : ({ ok: true } as const)

  // Only the spans and their replacements. This used to carry a fabricated
  // `scale` to satisfy the type, passed to a fold that never read it — a value
  // that looked like data and was not. `materialise` and `scalesByOffset` both
  // take `FoldableChange` now, so there is nothing to invent.
  const stored: FoldableChange[] = (changeset?.changes ?? []).map((change) => ({
    startOffset: change.startOffset,
    endOffset: change.endOffset,
    replacement: change.replacement,
  }))
  const scales = scalesByOffset(baseContent, stored)

  // Display-only annotations from the second pass. Grouped by change here so
  // the card never has to ask for them, and absent entirely when the reviewer
  // did not run — which is a supported outcome, not a degraded one.
  const findings = changeset ? await repos.findings.forChangeset(changeset.id) : []
  const findingsByChange = new Map<string, Array<{ kind: string; detail: string }>>()
  for (const finding of findings) {
    if (finding.changeId === null) continue
    const list = findingsByChange.get(finding.changeId) ?? []
    list.push({ kind: finding.kind, detail: finding.detail })
    findingsByChange.set(finding.changeId, list)
  }

  /**
   * The same second pass, about a whole production rather than one change.
   *
   * `review@2` shows the reviewer outcome handles `O1…On` and tells it to cite
   * the most specific handle it can, so a finding about a collection or a draft
   * is stored with `outcomeId` set and `changeId` null. `forChangeset` joins
   * through `changeId` and cannot see one, which is why these rows were written
   * for weeks and rendered nowhere — `tests/reachability.test.ts` asserted that
   * absence in its deferred block until this query got wired.
   *
   * Read per run rather than per outcome because that is the query that exists
   * and because one round-trip is right for a page that already makes several.
   * Findings from every run of this Shift are merged: `runId` distinguishes the
   * worker from the reviewer, and only the reviewer writes findings at all, so
   * merging cannot mix two voices.
   *
   * A finding that cites neither a change nor an outcome — the reviewer talking
   * about the run as a whole — is deliberately still dropped here. It has no
   * card to sit on, and inventing one would be this screen deciding the review
   * has a section that `review@2` never promised.
   */
  const outcomeFindings = new Map<string, Array<{ kind: string; detail: string }>>()
  for (const run of runs) {
    for (const finding of await repos.findings.forRun(run.id)) {
      if (finding.outcomeId === null) continue
      const list = outcomeFindings.get(finding.outcomeId) ?? []
      list.push({ kind: finding.kind, detail: finding.detail })
      outcomeFindings.set(finding.outcomeId, list)
    }
  }

  const changes: ChangeView[] = (changeset?.changes ?? []).map((change) => {
    const scale = scales.get(change.startOffset) ?? scaleOfPair(change.exact, change.replacement)
    const verdict = change.verdict?.verdict
    return {
      id: change.id,
      where: headingAbove(headings, change.startOffset),
      scaleLabel: scale.label,
      scaleKind: scale.kind,
      findings: findingsByChange.get(change.id) ?? [],
      before: change.exact,
      after: change.replacement,
      reason: change.reason,
      verdict:
        verdict === 'accept' || verdict === 'reject' || verdict === 'edit' ? verdict : null,
    }
  })

  /* ── what the shift made ──────────────────────────────────────────────── */

  /**
   * Every `ShiftOutcome` this Shift produced, turned into something renderable.
   *
   * Deterministic, and every field of it is a column: the headline and the
   * reason are stored on the row, which is why the one-minute list can be built
   * without touching the ledger and why it goes on reading the same after the
   * person has rejected everything in it. Nothing here is model prose assembled
   * on the way past.
   *
   * The three narrowings — kind, reversibility, detail — all go through
   * `src/domain/outcome/shift-outcome.ts`, so this screen, the card and the
   * server action cannot form three different opinions about what `landed`
   * means. The one thing worth repeating here: `landed` is decided by
   * `isDecidable` returning false, which is deny-by-default, so a reversibility
   * nobody recognises is reported rather than offered a verdict.
   *
   * Empty for every Shift that ran before the table had a writer, and the note
   * renders exactly as it did before when it is.
   */
  const outcomes = await repos.outcomes.forContract(contractId)

  const made: OutcomeView[] = outcomes.map((shiftOutcome) => {
    const kind = asShiftOutcomeKind(shiftOutcome.kind)
    const detail = readOutcomeDetail(shiftOutcome.detail)
    const verdict = shiftOutcome.verdict?.verdict
    return {
      id: shiftOutcome.id,
      kind,
      landed: !isDecidable(shiftOutcome.reversibility),
      headline: shiftOutcome.headline,
      reason: shiftOutcome.reason,
      items: detail.items,
      body: detail.body,
      addressedTo: detail.addressedTo,
      where: detail.where,
      whatYouCanDo: detail.whatYouCanDo,
      verdict:
        verdict === 'accept' || verdict === 'reject' || verdict === 'edit' ? verdict : null,
      // Only the document outcome points at the review below, and only when
      // there is one to point at. A count of nothing would read as a promise
      // the rest of the page does not keep — and a run can say it produced
      // document changes while its changeset failed to write, which is exactly
      // when "0 changes below" would appear.
      changeCount: kind === 'document-changes' && changes.length > 0 ? changes.length : null,
      findings: outcomeFindings.get(shiftOutcome.id) ?? [],
    }
  })

  /* ── the ledger, as two lists ─────────────────────────────────────────── */

  const sources = session ? await repos.projects.approvedSources(session.projectId) : []
  const sourceLabels = new Map(sources.map((source) => [source.id, source.label]))

  const did: LogRow[] = []
  const didnt: LogRow[] = []

  for (const run of runs) {
    for (const intent of run.intents) {
      const kindParams = asRecord(intent.params)

      if (!intent.authorized) {
        const rule = intent.refusedRule ?? ''
        // The rule sentence is code-authored; the worker's own reason is quoted
        // and attributed rather than stated flatly. On a hostile page that
        // sentence is downstream of attacker text (ADR-0006), and this is the
        // screen where an injection surfaces — so it must read as something
        // Propositum was told, not as something Propositum concluded.
        const said = intent.reason.trim() === '' ? '' : ` My reason at the time, in the words I had for it: “${intent.reason.trim()}”.`
        // A source the gate did not recognise has no label to name, and calling
        // it "one of your approved sources" would be false in the one row where
        // that matters most.
        const phrase =
          rule === 'source_not_approved'
            ? "open a site you haven't approved"
            : actionPhrase(intent.kind, kindParams, sourceLabels)
        didnt.push({
          id: intent.id,
          time: at(intent.createdAt),
          sentence: `Didn't ${phrase}`,
          detail: `${REFUSAL_REASONS[rule] ?? "Your agreement doesn't cover it."}${said}`,
          mark: 'refused',
        })
        continue
      }

      const outcome = intent.outcome
      // Widened rather than narrowed: a stored kind is a string, and asserting
      // it into the enum would be the renderer deciding what the ledger holds.
      const mutating = (MUTATING_ACTION_KINDS as ReadonlySet<string>).has(intent.kind)
      const sentence = didPhrase(intent.kind, kindParams, sourceLabels)

      if (!outcome) {
        // The routine ending under "a local worker stops when the Mac sleeps",
        // not an error — so it is said calmly, and it always carries the second
        // clause the record can prove.
        const why =
          run.terminalReason === 'lease-expired'
            ? "Your Mac slept before this finished, so I can't tell you how it went."
            : "I stopped before this finished, so I can't tell you how it went."
        const nothing = mutating
          ? 'Nothing was changed — whatever it was writing never reached the changes above.'
          : 'Nothing was changed.'
        did.push({
          id: intent.id,
          time: at(intent.createdAt),
          sentence: `Started to ${actionPhrase(intent.kind, kindParams, sourceLabels)}`,
          detail: `${why} ${nothing}`,
          mark: 'unknown',
        })
        continue
      }

      if (outcome.result === 'failed') {
        did.push({
          id: intent.id,
          time: at(intent.createdAt),
          sentence: `Couldn't ${actionPhrase(intent.kind, kindParams, sourceLabels)}`,
          detail: `${outcome.detail ?? 'It did not go through.'} Nothing was changed.`,
          mark: 'failed',
        })
        continue
      }

      did.push({
        id: intent.id,
        time: at(intent.createdAt),
        sentence,
        ...(outcome.detail === null ? {} : { detail: outcome.detail }),
        mark: mutating ? 'wrote' : 'done',
      })
    }
  }

  /* ── what it never got to ─────────────────────────────────────────────── */

  const planned = worker.steps
  const reached = worker.progressStep
  for (const step of planned) {
    if (step.ordinal <= reached) continue
    didnt.push({
      id: step.id,
      time: null,
      sentence: `Didn't get to: ${step.intent}`,
      detail: 'I stopped before this step.',
      mark: 'stopped',
    })
  }

  /* ── what it missed ───────────────────────────────────────────────────── */

  const missed = await gaps(db.prisma, contract.sessionId)

  /* ── where it stopped ─────────────────────────────────────────────────── */

  const report = await repos.reports.forContract(contractId)
  const decisions: DecisionView[] = (report?.decisions ?? []).map((decision) => ({
    id: decision.id,
    question: decision.question,
    whyStopped: decision.whyStopped,
    needs: decision.needs,
    answer: decision.answer,
  }))

  const stopped = whereItStopped({
    live,
    status: last.status,
    terminalReason: last.terminalReason,
    reached,
    planned: planned.length,
    hasDecision: decisions.length > 0,
  })

  const tally = [
    planned.length > 0 ? `${Math.min(reached, planned.length)} of ${count(planned.length, 'step')}` : 'no plan recorded',
    decisions.length > 0 ? `${count(decisions.length, 'decision')} for you` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  const kicker = baseRow?.document.title ?? project?.name ?? 'Propositum'

  // The way back up. A person reaches this note from a link they followed hours
  // after they left, so the exit has to be on the page rather than in their
  // browser history.
  const up = project
    ? { href: `/projects/${project.id}`, label: project.name }
    : { href: '/', label: 'All projects' }

  /* ── the drifted shift is a different note ────────────────────────────── */

  /**
   * What a drifted Shift still made.
   *
   * A drifted document says nothing about anything else the run produced. A
   * collection or an answer is not addressed by offsets into a version, so it
   * cannot have drifted, and it still needs deciding — without this it would
   * vanish along with the review that could not be applied, and the person
   * would never learn it existed.
   *
   * The document outcome is dropped, because the whole point of this screen is
   * that its changes are set aside and the sentence above says so.
   */
  const madeBesidesTheDocument = made.filter(
    (shiftOutcome) => shiftOutcome.kind !== 'document-changes',
  )

  /** The same list, minus what already happened. "Pick up at…" has to name
   *  something a person can act on, and a landed outcome is a report. */
  const waitingBesidesTheDocument = madeBesidesTheDocument.filter(
    (shiftOutcome) => !shiftOutcome.landed,
  )

  if (changeset && !drift.ok) {
    return (
      <DriftedShift
        kicker={kicker}
        narrative={report?.narrative ?? null}
        window={shiftWindow}
        tally={tally}
        decisions={decisions}
        setAside={changes.length}
        made={madeBesidesTheDocument}
        did={did}
        didnt={didnt}
        missed={missed}
        stopped={stopped}
        driftDetail={
          latest && baseRow && latest.ordinal > baseRow.ordinal
            ? `I started from version ${baseRow.ordinal}. Your document is on version ${latest.ordinal} now.`
            : 'Your document no longer matches the version I started from.'
        }
        handoverHref={`/sessions/${contract.sessionId}`}
        up={up}
      />
    )
  }

  return (
    <ShiftReport
      kicker={kicker}
      narrative={report?.narrative ?? null}
      window={shiftWindow}
      tally={tally}
      decisions={decisions}
      made={made}
      changes={changes}
      noChangesNext={
        live
          ? 'Propositum is still working. Anything it proposes appears here when it stops.'
          : contract.output === 'suggestions-only'
            ? // "Research only" removes every kind that could write into the
              // document, so no text was ever going to appear here. Where the
              // rest of it is depends on whether this Shift produced anything
              // else — the list above, or the account of the work below.
              `You set it to research only, so it couldn't propose document text at all. What it ${
                madeBesidesTheDocument.length > 0 ? 'made is above' : 'found is below'
              }.`
            : 'It stopped before it had anything to propose. What it did get to is below.'
      }
      did={did}
      didnt={didnt}
      missed={missed}
      stopped={stopped}
      liveRunId={liveRunId}
      resume={
        changes.length > 0
          ? `Pick up at ${changes[0]?.where ?? 'the top of the document'}, where the first change is waiting.`
          : waitingBesidesTheDocument.length > 0
            ? 'Pick up at what Propositum made, above.'
            : null
      }
      up={up}
      contractId={contract.id}
      alreadyPutIn={
        settledVersion === null ? null : { ordinal: settledVersion.ordinal }
      }
    />
  )
}

/* ── gaps ───────────────────────────────────────────────────────────────── */

/**
 * "I stopped seeing your work from 2:10 to 2:41 (your Mac slept)."
 *
 * Gaps are events, not absences — a hole indistinguishable from inactivity
 * makes a reading confidently report a lull that never happened. Capture is off
 * for the whole shift, so every gap here happened before the handover, and the
 * copy says so rather than implying Propositum was watching while it worked.
 */
async function gaps(prisma: PrismaClient, sessionId: string): Promise<LogRow[]> {
  const workSession = await prisma.workSession.findUnique({
    where: { id: sessionId },
    select: { startedAt: true },
  })
  if (!workSession) return []

  const events = await prisma.observationEvent.findMany({
    where: { sessionId, kind: 'captureGap' },
    orderBy: { seq: 'asc' },
    select: { id: true, attested: true },
  })

  const WHY: Record<string, string> = {
    service_worker_terminated: 'Your browser shut the extension down.',
    machine_slept: 'Your Mac slept.',
    transport_disconnected: 'The connection dropped.',
    permission_revoked: 'Access to that source was withdrawn.',
  }

  return events.map((event) => {
    const attested = asRecord(event.attested)
    const from = numberOf(attested, 'startedAtElapsedMs')
    const to = numberOf(attested, 'endedAtElapsedMs')
    const started = from === null ? null : new Date(workSession.startedAt.getTime() + from)
    const ended = to === null ? null : new Date(workSession.startedAt.getTime() + to)
    const minutes = from !== null && to !== null ? Math.max(1, Math.round((to - from) / 60_000)) : null

    return {
      id: event.id,
      time: started && ended ? `${at(started)}–${at(ended)}` : null,
      sentence:
        minutes === null
          ? 'I stopped seeing your work for a while before you handed over.'
          : `I stopped seeing your work for ${count(minutes, 'minute')} before you handed over.`,
      detail: `${WHY[String(attested['reason'] ?? '')] ?? 'I was not watching.'} Anything you did in that window isn't in what I read.`,
      mark: 'gap' as const,
    }
  })
}

/* ── the two states that are not a note ─────────────────────────────────── */

function Missing() {
  return (
    <Sheet>
      <BackLink href="/">&larr; All projects</BackLink>
      <Masthead
        kicker="Propositum"
        title="There is nothing to report here"
        mark={<Away size={20} />}
        subtitle="This working agreement doesn't exist any more, or the link is wrong."
      />
      <Empty
        title="Nothing to show."
        next="Open the project this was handed over from, and start again from the session there."
        action={
          <Link className="sh-go" href="/">
            All projects
          </Link>
        }
      />
      <Styles />
    </Sheet>
  )
}

function NotStarted({
  title,
  up,
  sessionHref,
}: {
  readonly title: string
  readonly up: { readonly href: string; readonly label: string }
  readonly sessionHref: string
}) {
  return (
    <Sheet>
      <BackLink href={up.href}>&larr; {up.label}</BackLink>
      <Masthead
        kicker={title}
        title="Nothing has happened yet"
        mark={<Away size={20} />}
        subtitle="This agreement hasn't been handed over, so there is nothing to report on yet."
      />
      <Empty
        title="Propositum hasn't started."
        next="Set how far it should go and hand the work over. Nothing starts on its own."
        action={
          <Link className="sh-go" href={sessionHref}>
            Back to the session
          </Link>
        }
      />
      <Styles />
    </Sheet>
  )
}

/** Two states on this route render outside `ShiftReport`, so they carry their
 *  own one rule rather than reaching into another file's stylesheet. */
function Styles() {
  return (
    <style href="propositum-shift-page" precedence="default">
      {`.sh-go { display: inline-block; font: inherit; font-size: 0.8125rem; line-height: 1.4; padding: 0.35rem 0.9rem; border: 1px solid var(--accent); border-radius: 3px; background: var(--accent); color: var(--ground); text-decoration: none; }
.sh-go:hover { filter: brightness(1.07); }
.sh-go:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`}
    </style>
  )
}
