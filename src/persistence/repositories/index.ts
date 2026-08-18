/**
 * Repositories: the only thing that talks to Prisma.
 *
 * ── Why the ports live here and not in src/domain ────────────────────────
 *
 * The obvious move is interfaces in the domain and implementations here. It is
 * not worth it yet, and saying so is more honest than building the ceremony.
 *
 * `src/domain` currently holds pure functions — `compilePolicy`,
 * `evaluateStructuralStops` — which take values and return values. None of them
 * needs a repository, and an architecture test already asserts the domain
 * imports nothing from `persistence`. Defining ports in the domain today would
 * mean inventing a parallel type layer with no consumer, purely to satisfy a
 * diagram.
 *
 * When a domain service appears that genuinely needs to load an aggregate, move
 * its port across then. The dependency direction is already safe.
 *
 * ── Narrow on purpose ────────────────────────────────────────────────────
 *
 * Every method here has a caller or an imminent one. No `findAll`, no generic
 * query builder, no caching. A repository that can express any query is a
 * Prisma client with extra steps.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 *
 * There is no `appendEvent`. Observation events go through the single ledger
 * writer (#35) so `seq` stays gapless under concurrency; exposing an append
 * here would create a second path and quietly break that guarantee. This file
 * only reads them.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { guarded } from '../errors'
// The one domain import in this file, and it is here rather than re-derived so
// that `held` has a single reader. `isDecidable` is a pure two-line predicate
// that argues its own direction — `=== 'held'` rather than `!== 'landed'`, so a
// reversibility nobody has seen before is reported rather than waved through —
// and `trajectory()` needs exactly that direction, because the value it decides
// is whether a row enters the MVP's headline denominator. A second copy of the
// string here is how the two would eventually disagree about that.
import { isDecidable } from '../../domain/outcome/shift-outcome'

export interface Repositories {
  readonly intentions: IntentionRepository
  readonly projects: ProjectRepository
  readonly sessions: WorkSessionRepository
  readonly events: ObservationEventReader
  readonly readings: SessionReadingRepository
  readonly contracts: HandoffContractRepository
  readonly runs: AgentRunRepository
  /** Beside `runs` because a model call points at one when there is one, and at
   *  nothing when there is not. Never in the ledger a person READS — ADR-0005:
   *  a model call is not an action the person authorized. */
  readonly modelCalls: ModelCallRecordRepository
  readonly documents: DocumentRepository
  readonly changesets: ChangesetRepository
  readonly findings: ReviewFindingRepository
  readonly reports: ShiftReportRepository
  readonly offers: WorkOfferRepository
  readonly outcomes: ShiftOutcomeRepository
  readonly confirmations: ConfirmationRepository
  readonly evidence: ActionEvidenceRepository
  readonly dispatches: ActionDispatchRepository
}

export function createRepositories(prisma: PrismaClient): Repositories {
  return {
    intentions: intentionRepository(prisma),
    projects: projectRepository(prisma),
    sessions: workSessionRepository(prisma),
    events: observationEventReader(prisma),
    readings: sessionReadingRepository(prisma),
    contracts: handoffContractRepository(prisma),
    runs: agentRunRepository(prisma),
    modelCalls: modelCallRecordRepository(prisma),
    documents: documentRepository(prisma),
    changesets: changesetRepository(prisma),
    findings: reviewFindingRepository(prisma),
    reports: shiftReportRepository(prisma),
    offers: workOfferRepository(prisma),
    outcomes: shiftOutcomeRepository(prisma),
    confirmations: confirmationRepository(prisma),
    evidence: actionEvidenceRepository(prisma),
    dispatches: actionDispatchRepository(prisma),
  }
}

/**
 * Canonical JSON, as this file writes it.
 *
 * `unknown` will not go into a Prisma `Json` column and widening the column
 * type to make it fit is how an untyped payload spreads. Every Json write below
 * either casts at the Prisma boundary — the same move `ledger-writer.ts` makes
 * for `attested` — or names its element type.
 */
export type JsonObject = Record<string, unknown>

/* ── Intention ─────────────────────────────────────────────────────────── */

/** What one Intention holds. `IntentionState` is NOT here and never will be —
 *  it is computed by `src/domain/intention/state.ts` from rows, and a column
 *  would be a second store for the same truth. */
export interface StoredIntention {
  readonly id: string
  readonly projectId: string | null
  readonly objective: string
  readonly definitionOfDone: string
  readonly completedAt: Date | null
}

/**
 * A Shift is still going while any of its runs is in one of these.
 *
 * The same three `src/app/shifts/[contractId]/page.tsx` calls `live`, written
 * down once so the front door and the re-entry note cannot disagree about
 * whether a shift has ended. The four that are absent are terminal:
 * `succeeded`, `failed`, `interrupted`, and `awaiting-confirmation` — which is
 * terminal FOR THE RUN and is not a finished shift.
 *
 * That last one is the interesting exclusion. A run parked on a question always
 * leaves an unanswered `ConfirmationRequest` behind it, and `intentionState`
 * ranks that above `delegated` — so counting it here would change nothing while
 * the question still stands, and would be wrong once it expires: the run has
 * ended, nobody can answer it any more, and *Propositum is on it* would be the
 * most confident thing the screen could possibly say about that.
 */
const LIVE_RUN_STATUSES: ReadonlySet<string> = new Set(['pending', 'claimed', 'running'])

/**
 * Everything `intentionState()` needs about one Intention, as rows.
 *
 * Deliberately not an `IntentionFacts` — that type lives in `src/domain` and is
 * epoch milliseconds and counts, and the domain may not learn that Prisma
 * exists. This is the row-shaped half; the caller does the arithmetic on the
 * two fields where only the caller knows the answer (see `openSessions`).
 */
export interface IntentionStateFacts {
  readonly intentionId: string
  /** Never null: intentions with no Project are filtered out, because the
   *  screen that reads this lists projects. */
  readonly projectId: string
  /** Set by a person, and only by a person. The whole of `done`. */
  readonly completedAt: Date | null
  /**
   * WorkSessions on this Intention that no human has ended, with their phase.
   *
   * The PHASES are not summarised here, and that is the point of returning the
   * ids beside them. A row saying `observing` means a human started a sitting
   * and no human ended it; it does not mean anything is being captured, and
   * only the app process holding the capture store knows which of these it is
   * actually feeding. Answering that here would mean this file inventing a fact
   * it cannot see.
   */
  readonly openSessions: ReadonlyArray<{ id: string; phase: string }>
  /** Accepted HandoffContracts whose Shift has not ended — `LIVE_RUN_STATUSES`. */
  readonly liveAcceptedContracts: number
  /** When each unanswered `ConfirmationRequest` was asked. Unanswered means no
   *  `ConfirmationVerdict` of any kind; expiry is the domain's to apply. */
  readonly unansweredConfirmationsAskedAt: readonly Date[]
  /**
   * `DecisionNeeded` rows this reader can say are still open — **which is none
   * of them, and always zero. Amended 2026-08-16; the count was live for one
   * wave and is the reason this docblock is long.**
   *
   * The count was `contract.report.decisions.length` over every accepted
   * contract, all-time. `intentionState` ranks `openDecisions > 0` above every
   * other member, so one question raised by one Shift put *Needs you* on that
   * Project's front door **permanently** — with a *While you were away* link to
   * a note where nothing can be done about it. That is the failure the docblock
   * one function up already names for outcomes, reproduced for decisions.
   *
   * ── Why it cannot be fixed by counting better ────────────────────────────
   *
   * There is nothing to count. A `DecisionNeeded` has `question`, `whyStopped`,
   * `needs` and `ordinal` and no answered, resolved or verdict column; nothing
   * deletes one; `ShiftReport.contractId` is `@unique` and `reports.create` is
   * its only writer; a `HandoffContract` only ever moves `draft → accepted`, so
   * it never leaves the filter. The one affordance that looks like an answer —
   * *settle* on the re-entry note — is client-only React state whose own copy
   * says so: *"Propositum doesn't keep your answer — settling this only unlocks
   * accepting the changes together."*
   *
   * Every gate that would make the count clearable turns out to be a gate on
   * something ELSE being undecided, which `undecidedHeldOutcomes` already
   * answers — so the count would never change an answer it did not already
   * agree with. A field whose only honest value is zero is reported as zero,
   * where a reader can see the reasoning, rather than silently dropped.
   *
   * ── What this costs, stated rather than rounded up ───────────────────────
   *
   * A Shift that stopped to ask a question and produced nothing else now reads
   * `sleeping` on the front door and offers no link to its note. That is a
   * MISSED `needs-you`, and ADR-0011 is explicit that a missed one is the
   * expensive direction. It is taken because the alternative was a `needs-you`
   * that is never right again after the first question — a status word that is
   * always on is a status word nobody reads, and it would be wrong on every
   * look rather than on one.
   *
   * **What would undo this:** a durable human act on the note. `finishShift`
   * refuses outright when a Shift produced nothing (*"There is nothing waiting
   * on you"*) and writes no marker of its own for the cases it does accept, so
   * the fix is a row that says the person has been here — `ShiftReport`
   * gaining a `finishedAt` a server action writes, or `DecisionNeeded` gaining
   * the human answer this vocabulary has three of already. Both are a schema
   * change plus a screen, which is a workstream and not a line.
   */
  readonly openDecisions: number
  /** Held ShiftOutcomes still undecided — the `UNSETTLED` predicate, counted. */
  readonly undecidedHeldOutcomes: number
  /**
   * The re-entry note to open when something is waiting: the newest accepted
   * contract carrying a decision, an unanswered confirmation or an undecided
   * outcome — and failing that, simply the newest accepted contract.
   *
   * An EXPIRED confirmation still counts toward *which* note this is, though it
   * counts toward nothing about whether anything is waiting at all. That is
   * deliberate: applying the expiry rule here would put it in a second place,
   * and the note is the right place to land either way. A `DecisionNeeded`
   * counts here for the same reason and on the same terms: it decides which
   * note is worth opening, and decides nothing about whether one is.
   */
  readonly waitingContractId: string | null
}

/**
 * The Intention: durable, mutable, and written only because a person said so.
 *
 * ── Narrower than `ProjectRepository`, on purpose ────────────────────────
 *
 * There is no `complete`, no `revise` and no `delete` here yet. Every one of
 * those is a HUMAN act with no screen behind it — the correction channel is
 * rewriting the sentence, and the surface that offers that is a later
 * workstream's. A repository method with no caller is the exact shape of the
 * three defects `tests/reachability.test.ts` opens with, so they arrive with
 * the screen that calls them rather than ahead of it.
 *
 * `byId` was here and is gone, which is that paragraph applied to itself: it
 * was called by its own test and by nothing in `src/`, so it was the shape it
 * was written to argue against. It comes back with the screen that reads it.
 * Note for whoever writes `delete`: `HandoffContract.intention` is
 * `onDelete: Restrict`, so an Intention any contract points at cannot be
 * deleted — the limit is argued at that relation in `prisma/schema.prisma`.
 *
 * What is absent structurally rather than for now: nothing here takes a model
 * output, a claim, an event or a reading. There is no argument any inference
 * could be passed through — the same bar `WorkOffer` stands behind.
 */
export interface IntentionRepository {
  /**
   * A person stated one. That is the only reason this ever runs.
   *
   * The two strings come from somewhere a person clicked accept on; nothing in
   * this file can tell where, which is why the human-ratified rule lives at the
   * one call site and is argued there.
   */
  create(input: {
    projectId: string | null
    objective: string
    definitionOfDone: string
  }): Promise<StoredIntention>
  /**
   * The Project's Intention, or null. Singular by ADR-0011: at most one per
   * Project, held as a unique index rather than as a convention.
   *
   * This is what stops the writer minting a second one when a sitting joins a
   * project that already has an Intention — the constraint would refuse it
   * anyway, and finding the existing row is the answer rather than the error.
   */
  forProject(projectId: string): Promise<StoredIntention | null>
  /**
   * Every Intention's state facts, for every Project, in one pass.
   *
   * ── Why this exists, when nothing else here crosses a parent ─────────────
   *
   * It is the only cross-parent reader in this file, and it earns that by
   * arithmetic rather than by taste. Every other reader is single-parent —
   * `contracts.acceptedForSession`, `changesets.forContract`,
   * `outcomes.forContract`, `confirmations.pendingForRun` — because every other
   * caller holds one parent id. The front door holds N of them: it lists every
   * Project, and `intentionState` needs five separate facts per Intention.
   * Composed out of the single-parent readers, the honest version of Home is
   * four round trips per project — sessions, contracts, confirmations,
   * outcomes — which is 4N queries on the most-hit route in the product, and
   * the route whose entire content is that list. It would get slower every time
   * Propositum identified something, which is the wrong direction for the one
   * screen whose job is to show that Propositum has been identifying things.
   *
   * So: one method, one nested read, and the cost is flat in the number of
   * projects. Prisma resolves the nesting as a small fixed number of queries —
   * one per relation level — not one per row.
   *
   * ── No parameter, and that is not laziness ───────────────────────────────
   *
   * It could take the project ids Home already has. It does not, because that
   * list grows one bound variable per project and this file has already been
   * bitten by exactly that: `sweepSettledRuns` is written as a relation filter
   * rather than an id list, on the argument that the failure "arrives late, on
   * the machine with the most history". A front door that starts throwing when
   * somebody has read about enough things is the same bug wearing a nicer hat.
   *
   * ── What it deliberately does NOT answer ─────────────────────────────────
   *
   * Which sittings are actually being captured. See `openSessions`.
   */
  factsForEveryProject(): Promise<IntentionStateFacts[]>
  /**
   * The same facts, for one Project.
   *
   * Deliberately not a second query: both entry points call one builder with a
   * different `where`. Two readings of "where is this work" agree until the day
   * somebody edits one of them — the shape `topics.ts` refuses for tokenisers
   * and `front-door.ts` refuses for the derivation sitting on top of this.
   *
   * Null when the Project has no Intention. That is not a sixth state; the
   * screen renders it as *nothing stated yet*, which `statusWordFor` owns.
   */
  factsForProject(projectId: string): Promise<IntentionStateFacts | null>
}

function intentionRepository(prisma: PrismaClient): IntentionRepository {
  const SELECT = {
    id: true,
    projectId: true,
    objective: true,
    definitionOfDone: true,
    completedAt: true,
  } as const

  return {
    create: ({ projectId, objective, definitionOfDone }) =>
      prisma.intention.create({
        data: { projectId, objective, definitionOfDone },
        select: SELECT,
      }),
    forProject: (projectId) => prisma.intention.findUnique({ where: { projectId }, select: SELECT }),

    factsForEveryProject: () => factsWhere({ projectId: { not: null } }),

    factsForProject: async (projectId) => (await factsWhere({ projectId }))[0] ?? null,
  }

  /**
   * One builder, two entry points. See `factsForProject` on the interface for
   * why this is not two queries.
   *
   * The all-projects caller passes `{ projectId: { not: null } }` and the
   * single-project caller passes an id — both exclude an Intention with no
   * Project, which is legal in the schema and has no row on any screen.
   */
  async function factsWhere(where: Prisma.IntentionWhereInput): Promise<IntentionStateFacts[]> {
    /**
     * `UNSETTLED` is declared beside the evidence sweep, a thousand lines
     * further down this file, and is read here rather than re-derived.
     *
     * Its own docblock says why that matters: *"this is the one place that
     * has to learn about it, and getting it wrong is silent"*. The predicate
     * is not the obvious one — four of the five outcome kinds are settled by
     * an `OutcomeVerdict` and `document-changes` never receives one at all,
     * so the naive *"held with no verdict"* counts every document Shift as
     * waiting forever. A second copy of that would put *Needs you* on the
     * front door, permanently, for work the person finished weeks ago.
     *
     * Declaration order is not a hazard: this closure runs when a caller
     * invokes the method, long after the module has finished evaluating.
     */
    const rows = await prisma.intention.findMany({
      // A Project is what the front door lists. An Intention with no Project
      // is legal in the schema and has no row on any screen to sit beside.
      where,
      select: {
        id: true,
        projectId: true,
        completedAt: true,
        sessions: { where: { endedAt: null }, select: { id: true, phase: true } },
        contracts: {
          where: { status: 'accepted', acceptedAt: { not: null } },
          // Newest first, so the first contract carrying a question is the
          // one `waitingContractId` should open.
          orderBy: { acceptedAt: 'desc' },
          select: {
            id: true,
            runs: {
              select: {
                status: true,
                confirmations: { where: { verdict: { is: null } }, select: { createdAt: true } },
                outcomes: { where: UNSETTLED, select: { id: true } },
              },
            },
            report: { select: { decisions: { select: { id: true } } } },
          },
        },
      },
    })

    const facts: IntentionStateFacts[] = []

    for (const row of rows) {
      // Non-null by the WHERE above; the generated type does not know that,
      // so it is narrowed rather than asserted — `acceptedForSession` makes
      // the same move for the same reason.
      if (row.projectId === null) continue

      let liveAcceptedContracts = 0
      let undecidedHeldOutcomes = 0
      const unansweredConfirmationsAskedAt: Date[] = []
      let waitingContractId: string | null = null

      for (const contract of row.contracts) {
        let live = false
        // Toward WHICH note, never toward whether one is waiting. Nothing can
        // clear a `DecisionNeeded`, so counting it into `openDecisions` pins
        // *Needs you* on this Project for good — the argument is at
        // `IntentionStateFacts.openDecisions` and it is longer than this line
        // because it ends in a cost rather than in a fix.
        let waitingHere = contract.report === null ? 0 : contract.report.decisions.length

        for (const run of contract.runs) {
          if (LIVE_RUN_STATUSES.has(run.status)) live = true

          for (const request of run.confirmations) {
            unansweredConfirmationsAskedAt.push(request.createdAt)
          }
          waitingHere += run.confirmations.length

          undecidedHeldOutcomes += run.outcomes.length
          waitingHere += run.outcomes.length
        }

        if (live) liveAcceptedContracts += 1
        if (waitingContractId === null && waitingHere > 0) waitingContractId = contract.id
      }

      facts.push({
        intentionId: row.id,
        projectId: row.projectId,
        completedAt: row.completedAt,
        openSessions: row.sessions.map((sitting) => ({ id: sitting.id, phase: sitting.phase })),
        liveAcceptedContracts,
        unansweredConfirmationsAskedAt,
        // Zero, always, and the field is kept rather than removed so the
        // reasoning has somewhere to live. See its docblock.
        openDecisions: 0,
        undecidedHeldOutcomes,
        waitingContractId: waitingContractId ?? row.contracts[0]?.id ?? null,
      })
    }

    return facts
  }
}

/* ── Project ───────────────────────────────────────────────────────────── */

export interface ProjectRepository {
  create(name: string): Promise<{ id: string; name: string }>
  byId(id: string): Promise<{ id: string; name: string } | null>
  list(): Promise<Array<{ id: string; name: string }>>
  /**
   * The person corrects the name Propositum gave it.
   *
   * Nothing about a project is append-only — it holds no inference and carries
   * no provenance, so a name is just a name and an UPDATE is the honest shape.
   * Auto-naming is only acceptable if it is correctable, and this is where the
   * correction lands.
   */
  rename(id: string, name: string): Promise<void>
  approveSource(input: {
    projectId: string
    originPattern: string
    label: string
  }): Promise<{ id: string }>
  approvedSources(projectId: string): Promise<Array<{ id: string; originPattern: string; label: string; grantState: string }>>
  /**
   * Chrome is authoritative about grants; this mirrors a withdrawal.
   *
   * Nothing wrote this for the whole build — only `'granted'` was ever set — so
   * five UI surfaces rendered a withdrawn state that could not be reached, and
   * a `permission_revoked` CaptureGap could never occur. A stale `granted`
   * leaks nothing, because the extension is structurally incapable of reading a
   * revoked origin; a state the interface can render and the system can never
   * produce is the part worth fixing.
   */
  revokeSource(input: { projectId: string; originPattern: string }): Promise<number>
}

function projectRepository(prisma: PrismaClient): ProjectRepository {
  return {
    create: (name) => prisma.project.create({ data: { name }, select: { id: true, name: true } }),
    rename: async (id, name) => {
      await prisma.project.update({ where: { id }, data: { name } })
    },
    byId: (id) => prisma.project.findUnique({ where: { id }, select: { id: true, name: true } }),
    list: () => prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'desc' } }),
    approveSource: ({ projectId, originPattern, label }) =>
      prisma.approvedSource.upsert({
        where: { projectId_originPattern: { projectId, originPattern } },
        // Re-approving a revoked source is a grant, not a new row — the Chrome
        // permission it mirrors behaves the same way.
        update: { grantState: 'granted' },
        create: { projectId, originPattern, label },
        select: { id: true },
      }),
    approvedSources: (projectId) =>
      prisma.approvedSource.findMany({
        where: { projectId },
        select: { id: true, originPattern: true, label: true, grantState: true },
      }),
    revokeSource: async ({ projectId, originPattern }) => {
      // Chrome reports the origin it withdrew, which may or may not carry the
      // `/*` the pattern is stored with. Match on the host either way rather
      // than silently updating nothing.
      const host = originPattern.replace(/\/\*$/, '')
      const { count } = await prisma.approvedSource.updateMany({
        where: {
          projectId,
          grantState: 'granted',
          OR: [{ originPattern: host }, { originPattern: `${host}/*` }],
        },
        data: { grantState: 'revoked' },
      })
      return count
    },
  }
}

/* ── WorkSession ───────────────────────────────────────────────────────── */

export type SessionPhase = 'observing' | 'away' | 'ended'

export interface WorkSessionRepository {
  /**
   * `intentionId` is optional and last, so every existing caller keeps working
   * and a sitting nobody stated an Intention for gets the honest null rather
   * than a placeholder row.
   */
  start(projectId: string, intentionId?: string | null): Promise<{ id: string; phase: string }>
  byId(id: string): Promise<{
    id: string
    projectId: string
    intentionId: string | null
    phase: string
    endedAt: Date | null
  } | null>
  forProject(projectId: string): Promise<Array<{ id: string; phase: string; startedAt: Date }>>
  /** Explicit transitions only — no generic setter, so the lifecycle stays
   *  readable and an illegal jump has nowhere to hide. */
  markAway(id: string): Promise<void>
  markObserving(id: string): Promise<void>
  end(id: string, endedAt: Date): Promise<void>
  /**
   * The sitting was filed under the wrong subject; move it.
   *
   * `projectId` is not a lifecycle field, so this is not one of the explicit
   * transitions above and deliberately does not go through `setPhase` — where
   * the work is filed and how far through it is are unrelated questions, and a
   * setter that could change both would eventually change both by accident.
   *
   * The sitting's ObservationEvents keep pointing at the ApprovedSources of the
   * project they were recorded under; the ledger is append-only and rewriting
   * history to tidy a filing decision is exactly what append-only is for
   * refusing. The caller carries those origins across as approvals on the
   * destination instead, so what Propositum may see is right going forward.
   *
   * ── Why `intentionId` is REQUIRED here and not optional ──────────────────
   *
   * An Intention belongs to a Project — `Intention.projectId` is `@unique` — so
   * a move that does not answer this question leaves the sitting pointing at
   * the OLD project's Intention, and `draftContract` then stamps that
   * cross-project id onto the new project's HandoffContract. That is exactly
   * the failure CONTEXT.md's cross-session ruling names: an objective inherited
   * quietly, on a screen that says nothing about having inherited it. It is
   * worse here than the cold read that ruling compared it to, because the
   * person pressing the button has just said *this is not that work*.
   *
   * Required rather than defaulted, so the answer is a decision at each call
   * site instead of whatever a default happened to be: `null` where nobody has
   * stated an Intention for the destination, and the destination's own
   * Intention where somebody has.
   */
  refile(id: string, projectId: string, intentionId: string | null): Promise<void>
}

function workSessionRepository(prisma: PrismaClient): WorkSessionRepository {
  const setPhase = async (id: string, phase: SessionPhase) => {
    await prisma.workSession.update({ where: { id }, data: { phase } })
  }

  return {
    start: (projectId, intentionId) =>
      prisma.workSession.create({
        data: { projectId, intentionId: intentionId ?? null },
        select: { id: true, phase: true },
      }),
    byId: (id) =>
      prisma.workSession.findUnique({
        where: { id },
        select: { id: true, projectId: true, intentionId: true, phase: true, endedAt: true },
      }),
    forProject: (projectId) =>
      prisma.workSession.findMany({
        where: { projectId },
        select: { id: true, phase: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
    markAway: (id) => setPhase(id, 'away'),
    markObserving: (id) => setPhase(id, 'observing'),
    refile: async (id, projectId, intentionId) => {
      await prisma.workSession.update({ where: { id }, data: { projectId, intentionId } })
    },
    end: async (id, endedAt) => {
      await prisma.workSession.update({ where: { id }, data: { phase: 'ended', endedAt } })
    },
  }
}

/* ── ObservationEvent (read only — writes go through the ledger writer) ─── */

export interface ObservationEventReader {
  bySession(sessionId: string): Promise<
    Array<{
      id: string
      seq: number
      kind: string
      observedAt: Date
      elapsedMs: number
      approvedSourceId: string | null
      attested: unknown
      untrusted: unknown
    }>
  >
  /** Highest seq written, or null for an empty session. The ledger writer needs
   *  this inside its transaction; nothing else should assign a seq. */
  latestSeq(sessionId: string): Promise<number | null>
  countByKind(sessionId: string, kind: string): Promise<number>
}

function observationEventReader(prisma: PrismaClient): ObservationEventReader {
  return {
    bySession: (sessionId) =>
      prisma.observationEvent.findMany({
        where: { sessionId },
        orderBy: { seq: 'asc' },
        select: {
          id: true,
          seq: true,
          kind: true,
          observedAt: true,
          elapsedMs: true,
          approvedSourceId: true,
          attested: true,
          untrusted: true,
        },
      }),
    latestSeq: async (sessionId) => {
      const row = await prisma.observationEvent.findFirst({
        where: { sessionId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      })
      return row?.seq ?? null
    },
    countByKind: (sessionId, kind) => prisma.observationEvent.count({ where: { sessionId, kind } }),
  }
}

/* ── SessionReading ────────────────────────────────────────────────────── */

export interface ClaimInput {
  readonly kind: string
  readonly text: string
  readonly confidence?: string | undefined
  readonly ordinal: number
  readonly evidence: ReadonlyArray<{ eventId: string; quote?: string | undefined }>
}

export interface SessionReadingRepository {
  /** Reading and claims are written together — a reading with no claims is not
   *  a partial result, it is a broken one. */
  create(input: {
    sessionId: string
    throughSeq: number
    isReference?: boolean
    claims: readonly ClaimInput[]
  }): Promise<{ id: string }>
  byId(id: string): Promise<{
    id: string
    sessionId: string
    throughSeq: number
    claims: Array<{
      id: string
      kind: string
      text: string
      confidence: string | null
      origin: string
      evidence: Array<{ eventId: string; quote: string | null }>
    }>
  } | null>
  latestForSession(sessionId: string): Promise<{ id: string } | null>
  /** The human corrects a claim. `origin` moves to `edited` per claim, never
   *  per revision — revision-level authorship would launder every unedited
   *  inferred claim into a human assertion the moment one word changed. */
  editClaim(claimId: string, text: string): Promise<void>
}

function sessionReadingRepository(prisma: PrismaClient): SessionReadingRepository {
  return {
    create: ({ sessionId, throughSeq, isReference = false, claims }) =>
      prisma.sessionReading.create({
        data: {
          sessionId,
          throughSeq,
          isReference,
          claims: {
            create: claims.map((c) => ({
              kind: c.kind,
              text: c.text,
              ...(c.confidence === undefined ? {} : { confidence: c.confidence }),
              ordinal: c.ordinal,
              evidence: {
                create: c.evidence.map((e) => ({
                  eventId: e.eventId,
                  ...(e.quote === undefined ? {} : { quote: e.quote }),
                })),
              },
            })),
          },
        },
        select: { id: true },
      }),
    byId: (id) =>
      prisma.sessionReading.findUnique({
        where: { id },
        select: {
          id: true,
          sessionId: true,
          throughSeq: true,
          claims: {
            orderBy: { ordinal: 'asc' },
            select: {
              id: true,
              kind: true,
              text: true,
              confidence: true,
              origin: true,
              evidence: { select: { eventId: true, quote: true } },
            },
          },
        },
      }),
    latestForSession: (sessionId) =>
      prisma.sessionReading.findFirst({
        where: { sessionId, isReference: false },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      }),
    editClaim: async (claimId, text) => {
      await prisma.sessionClaim.update({ where: { id: claimId }, data: { text, origin: 'edited' } })
    },
  }
}

/* ── HandoffContract ───────────────────────────────────────────────────── */

export interface ContractInput {
  readonly sessionId: string
  readonly readingId: string
  /**
   * Which Intention this contract advances. NULL is ordinary — a contract with
   * no Intention behind it is legal and is what every contract written before
   * ADR-0011 has.
   *
   * It grants nothing and the gate never reads it. It must be supplied HERE,
   * at draft time: `handoff_contract_frozen_once_accepted` permits an UPDATE
   * only while `status = 'draft'`, so there is no later moment to write it in.
   *
   * Optional rather than required, which is a decision and not laziness. Every
   * contract that already exists has no Intention and none are backfilled, so
   * making this required would be a demand that eight fixtures invent a value
   * the product does not have — and an invented value on a durable row about
   * purpose is the one thing this table exists not to hold.
   */
  readonly intentionId?: string | null
  readonly objective: string
  readonly definitionOfDone: string
  readonly guidance: readonly string[]
  readonly approvedSourceIds: readonly string[]
  readonly allowedActionKinds: readonly string[]
  /**
   * NULL when this Shift pins no document.
   *
   * It was required for as long as every Shift was a document Shift. A Shift
   * that acts in a browser and answers a question has no base to pin, and
   * forcing one would mean the person inventing a document so the schema would
   * let them hand work over.
   */
  readonly baseVersionId: string | null
  readonly initiative: string
  readonly progress: string
  readonly output: string
  readonly interruption: string
  readonly timeLimitMinutes: number
}

export interface HandoffContractRepository {
  createDraft(input: ContractInput): Promise<{ id: string }>
  byId(id: string): Promise<
    | (Omit<ContractInput, 'guidance' | 'approvedSourceIds' | 'allowedActionKinds'> & {
        id: string
        status: string
        acceptedAt: Date | null
        guidance: string[]
        approvedSourceIds: string[]
        allowedActionKinds: string[]
      })
    | null
  >
  /**
   * The accepted contract for one session, if there is one.
   *
   * Slice 0 ships exactly one Shift per WorkSession, so there is at most one —
   * but this orders by `acceptedAt` and takes the newest anyway, because
   * continuation would mint a second contract rather than extend this one, and
   * a reader that silently picked an arbitrary row would then point at the
   * wrong shift.
   *
   * It exists so a person can REACH their shift report. Without it the only
   * route to "While you were away" is typing a contract id into the URL bar,
   * which is not a route.
   */
  acceptedForSession(sessionId: string): Promise<{ id: string; acceptedAt: Date } | null>
  /** The one legal transition. `acceptedAt` is the shift start AND the origin of
   *  the deadline, so a crash-restart cannot reset the budget. */
  accept(id: string, acceptedAt: Date): Promise<void>
  editDraft(id: string, patch: Partial<Pick<ContractInput, 'objective' | 'definitionOfDone' | 'timeLimitMinutes'>>): Promise<void>
  /**
   * Shifts that are over and produced nothing a person could decide on.
   *
   * ── The hole this exists to close ────────────────────────────────────────
   *
   * `outcomes.trajectory()` reads productions: `ShiftOutcome` rows and pre-spine
   * `Changeset`s. A Shift that produced NEITHER contributes no rows, so it is
   * invisible to the metric — and docs/MVP.md names that exact case as an H2
   * failure: *"a run producing zero decidable units under `draft-changes` is a
   * failure and scores 0%."* Read off productions alone, a corpus of barren
   * draft-changes Shifts reports the flattering *no decidable units yet*
   * instead. The error was in the direction that flatters the product, which is
   * the direction a metric must never be wrong in.
   *
   * The spine here is therefore the accepted CONTRACT rather than the
   * production, which is the only object that exists whether or not the Shift
   * made anything.
   *
   * ── Why `awaiting-confirmation` does not count as over ───────────────────
   *
   * It is terminal for the RUN and is not the end of the Shift: the gate
   * refused an action that needs the person, and a successor run carrying
   * `resumesRunId` continues from there if they confirm. A Shift parked there
   * has not finished and has not produced zero — it is waiting on somebody.
   * `LIVE_RUN_STATUSES` alone would get this wrong, which is why the filter
   * below names four statuses rather than reusing that set.
   *
   * ── `ranToACleanStop`, and why the caller needs it ───────────────────────
   *
   * MVP.md's rule is about *a run producing zero*, not about a run that never
   * got to the end. A Shift whose runs all ended `failed` or `interrupted` did
   * not produce zero decidable units; it did not finish. Scoring those as the
   * 0% failure would report *the useful-progress window is empty — stop and
   * reconsider the product* for an expired API key. So the two are separated
   * here and the caller decides, rather than this reader deciding by omission.
   */
  barrenShifts(): Promise<
    Array<{ contractId: string; outputMode: string; ranToACleanStop: boolean }>
  >
}

/**
 * A run status that means this run is not coming back — and that its Shift is
 * genuinely over, which is the narrower claim.
 *
 * `awaiting-confirmation` is deliberately absent. See `barrenShifts`.
 */
const ENDED_RUN_STATUSES: readonly string[] = ['succeeded', 'failed', 'interrupted']

function handoffContractRepository(prisma: PrismaClient): HandoffContractRepository {
  const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])

  return {
    createDraft: (input) =>
      prisma.handoffContract.create({
        data: {
          ...input,
          guidance: [...input.guidance],
          approvedSourceIds: [...input.approvedSourceIds],
          allowedActionKinds: [...input.allowedActionKinds],
        },
        select: { id: true },
      }),
    byId: async (id) => {
      const row = await prisma.handoffContract.findUnique({ where: { id } })
      if (!row) return null
      return {
        ...row,
        guidance: asStrings(row.guidance),
        approvedSourceIds: asStrings(row.approvedSourceIds),
        allowedActionKinds: asStrings(row.allowedActionKinds),
      }
    },
    acceptedForSession: async (sessionId) => {
      const row = await prisma.handoffContract.findFirst({
        where: { sessionId, status: 'accepted', acceptedAt: { not: null } },
        orderBy: { acceptedAt: 'desc' },
        select: { id: true, acceptedAt: true },
      })
      // `acceptedAt` is nullable in the schema and non-null by the WHERE, but
      // the generated type does not know that — so it is narrowed rather than
      // asserted.
      return row && row.acceptedAt ? { id: row.id, acceptedAt: row.acceptedAt } : null
    },
    accept: async (id, acceptedAt) => {
      await guarded('handoff_contract', 'update', () =>
        prisma.handoffContract.update({ where: { id }, data: { status: 'accepted', acceptedAt } }),
      )
    },
    editDraft: async (id, patch) => {
      await guarded('handoff_contract', 'update', () =>
        prisma.handoffContract.update({ where: { id }, data: patch }),
      )
    },

    barrenShifts: async () => {
      const contracts = await prisma.handoffContract.findMany({
        where: {
          status: 'accepted',
          acceptedAt: { not: null },
          // A Shift with no run at all was accepted and never picked up. It is
          // not barren; it has not started.
          runs: { some: {}, none: { status: { notIn: [...ENDED_RUN_STATUSES] } } },
          // The pre-spine production, on the contract rather than on the run.
          // A contract with one is in `trajectory()` already.
          changesets: { none: {} },
        },
        orderBy: { acceptedAt: 'asc' },
        select: {
          id: true,
          output: true,
          runs: { select: { status: true, outcomes: { select: { id: true } } } },
        },
      })

      const barren: Array<{ contractId: string; outputMode: string; ranToACleanStop: boolean }> = []

      for (const contract of contracts) {
        // Filtered here rather than as `runs: { none: { outcomes: { some: {} } } }`
        // so the shape being tested is the one the caller reads: this Shift, in
        // total, produced nothing.
        let produced = 0
        let clean = false
        for (const run of contract.runs) {
          produced += run.outcomes.length
          if (run.status === 'succeeded') clean = true
        }
        if (produced > 0) continue

        barren.push({ contractId: contract.id, outputMode: contract.output, ranToACleanStop: clean })
      }

      return barren
    },
  }
}

/* ── AgentRun — the queue the worker drains ────────────────────────────── */

export interface AgentRunRepository {
  enqueue(input: {
    contractId: string
    role: 'worker' | 'reviewer'
    /** Issued only to a run that will drive the browser. A run that will not
     *  should not hold a credential it cannot use. */
    controlToken?: string
    /** The run this one continues, after a ConfirmationRequest was confirmed. */
    resumesRunId?: string
  }): Promise<{ id: string }>
  /**
   * Claim the oldest pending run, atomically.
   *
   * Read-then-write inside `$transaction`, which Prisma opens with
   * BEGIN IMMEDIATE (verified, ADR-0001) — a deferred BEGIN would fail with
   * SQLITE_BUSY_SNAPSHOT, which the busy timeout does NOT retry.
   *
   * `claimedBy` is optional because the existing worker does not pass one and
   * making it required would break the only caller there is. That is a
   * migration, not a design: the fence CONTEXT.md describes — "every action
   * boundary re-reads `status` and `claimedBy`" — cannot close until whoever
   * claims says who they are.
   *
   * ── `controlToken` is minted HERE, not at enqueue ────────────────────────
   *
   * The token answers one question for the browser control channel: "is this
   * the run the extension agreed to take instructions from". It is not an
   * authorization — the gate still decides every action — but it is the only
   * thing between an arbitrary local caller and the endpoint that drives
   * somebody's real Chrome.
   *
   * A credential minted at enqueue would sit on a `pending` row that nothing is
   * driving, sometimes for a long time, and would survive a claim moving from
   * one process to another. That is the stale-claim hazard `claimedBy` exists
   * to close, wearing different clothes: a token that outlives the run it was
   * issued to is a token a dead worker still holds.
   *
   * So it is minted at the moment a process takes the run, and cleared at every
   * terminal transition — `complete`, `sweepExpiredLeases`, and the two
   * confirmation paths that end a run. See `clearControlToken` below.
   */
  claim(input: {
    leaseUntil: Date
    startedAt: Date
    claimedBy?: string
    controlToken?: string
  }): Promise<{ id: string; contractId: string; role: string } | null>
  renewLease(id: string, leaseUntil: Date): Promise<void>
  /**
   * Write this run's terminal status.
   *
   * WIDENED, deliberately, to include `awaiting-confirmation`. The alternative
   * — a separate `pauseForConfirmation` method — reads better and is wrong,
   * because it implies the run is still alive and it is not. A run that stopped
   * for a confirmation has ended: it holds no lease, the sweep must not reap it
   * as an orphan, and if the person confirms, a SUCCESSOR run carrying
   * `resumesRunId` picks the work up. Keeping the pause out of `complete` would
   * mean two methods writing `endedAt` for the same reason and one of them
   * pretending otherwise.
   *
   * `awaiting-confirmation` is not a failure and takes no `terminalReason` —
   * there is nothing terminal to explain. The ConfirmationRequest is the
   * explanation.
   */
  complete(
    id: string,
    status: 'succeeded' | 'failed' | 'awaiting-confirmation',
    endedAt: Date,
    terminalReason?: string,
  ): Promise<void>
  /** Node never kills its children regardless of `detached`, so orphans are the
   *  default rather than the edge case. This is how they are reaped. */
  sweepExpiredLeases(now: Date): Promise<number>
  /**
   * Revoke the browser credential, for terminal transitions `complete` does not
   * cover.
   *
   * Three paths end a run by writing its status directly rather than through
   * `complete` — the confirmation expiry sweep, the answered-too-late
   * settlement, and a cancelled run — and each one has to revoke, or the token
   * outlives the run it was issued to. Named separately rather than folded into
   * `complete` because those three also write a `terminalReason` `complete`
   * does not accept, and widening `complete` to take every reason would make it
   * the place any status can be written from.
   */
  clearControlToken(id: string): Promise<void>
  byId(id: string): Promise<{
    id: string
    status: string
    contractId: string
    progressStep: number
    /** The fence, finally readable. A run that no longer holds the claim must
     *  abort without writing rather than press a button on a live page. */
    claimedBy: string | null
    cancelRequested: boolean
    controlToken: string | null
    resumesRunId: string | null
  } | null>
  advanceProgress(id: string, step: number): Promise<void>
  /**
   * The person asked this run to stop.
   *
   * A flag, not a kill. Nothing here interrupts anything: the run reads it at
   * its next action boundary and halts itself, which is the only way to stop
   * cleanly when the thing being stopped may be mid-navigation in a real
   * browser. Returns whether a row was actually flagged, so a caller can tell
   * "asked" from "there was nothing left to ask".
   */
  requestCancel(id: string): Promise<boolean>
}

function agentRunRepository(prisma: PrismaClient): AgentRunRepository {
  return {
    enqueue: ({ contractId, role, controlToken, resumesRunId }) =>
      prisma.agentRun.create({
        data: {
          contractId,
          role,
          ...(controlToken === undefined ? {} : { controlToken }),
          ...(resumesRunId === undefined ? {} : { resumesRunId }),
        },
        select: { id: true },
      }),

    claim: ({ leaseUntil, startedAt, claimedBy, controlToken }) =>
      prisma.$transaction(async (tx) => {
        const next = await tx.agentRun.findFirst({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, contractId: true, role: true },
        })
        if (!next) return null

        await tx.agentRun.update({
          where: { id: next.id },
          data: {
            status: 'claimed',
            leaseUntil,
            startedAt,
            ...(claimedBy === undefined ? {} : { claimedBy }),
            ...(controlToken === undefined ? {} : { controlToken }),
          },
        })
        return next
      }),

    renewLease: async (id, leaseUntil) => {
      await prisma.agentRun.update({ where: { id }, data: { leaseUntil } })
    },

    complete: async (id, status, endedAt, terminalReason) => {
      await prisma.agentRun.update({
        where: { id },
        data: {
          status,
          endedAt,
          ...(terminalReason ? { terminalReason } : {}),
          // Cleared on EVERY terminal transition, including
          // `awaiting-confirmation` — which is terminal for this run even
          // though it is not a failure. A run parked overnight on a question
          // must not still hold a credential that drives a browser; if the
          // person confirms, the continuation is claimed and mints its own.
          controlToken: null,
        },
      })
    },

    sweepExpiredLeases: async (now) => {
      const result = await prisma.agentRun.updateMany({
        where: { status: { in: ['claimed', 'running'] }, leaseUntil: { lt: now } },
        // The sweep's clock is not the lid's — it may run hours after the Mac
        // slept, which is why the report says "sometime before X".
        //
        // The token goes with the lease, and that is the whole point of
        // reaping: an orphaned run's worker may still be alive somewhere, and
        // the reason we reap it is that we no longer trust it to be driving.
        data: {
          status: 'interrupted',
          terminalReason: 'lease-expired',
          endedAt: now,
          controlToken: null,
        },
      })
      return result.count
    },

    clearControlToken: async (id) => {
      await prisma.agentRun.update({ where: { id }, data: { controlToken: null } })
    },

    byId: (id) =>
      prisma.agentRun.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          contractId: true,
          progressStep: true,
          claimedBy: true,
          cancelRequested: true,
          controlToken: true,
          resumesRunId: true,
        },
      }),

    advanceProgress: async (id, step) => {
      await prisma.agentRun.update({ where: { id }, data: { progressStep: step, status: 'running' } })
    },

    requestCancel: async (id) => {
      // Scoped to a run that could still act. Flagging a run that already ended
      // would make "cancel requested" appear on a finished shift report and
      // read as though the person stopped something that had already stopped.
      const { count } = await prisma.agentRun.updateMany({
        where: { id, status: { in: ['pending', 'claimed', 'running'] } },
        data: { cancelRequested: true },
      })
      return count === 1
    },
  }
}

/* ── ModelCallRecord ───────────────────────────────────────────────────── */

/**
 * The telemetry table's only writer, and its first one.
 *
 * ── What was here before ─────────────────────────────────────────────────
 *
 * `model_call_record` has had a table and all three append-only triggers since
 * ADR-0003 and NO WRITER. `AnthropicModelClient` computed every field of it on
 * every attempt, handed them to an `onCall` hook nothing passed, and dropped
 * them. This interface is the other end of that hook; `src/model/provider.ts`
 * is what connects the two.
 *
 * ── Write only, and no `guarded()` ───────────────────────────────────────
 *
 * There is no read method, because nothing reads it yet and this file's rule is
 * that every method has a caller or an imminent one. A cost report and an H2
 * tally are the obvious ones and neither is built.
 *
 * `guarded()` wraps update, delete and upsert — the operations the triggers
 * reject — and this table only ever receives inserts. The third trigger
 * (`model_call_record_no_replace`) fires on an INSERT that reuses an existing
 * id, which `@default(cuid())` cannot produce; if it ever did fire, the message
 * would survive because nothing has a foreign key TO this table, so Prisma's
 * P2003 remapping (see `../errors.ts`) has nothing to remap.
 *
 * ── This method does NOT swallow its own failures ────────────────────────
 *
 * A rejection here is a real rejection. The rule that a telemetry write must
 * never fail the model call it describes is held in `src/model/provider.ts`,
 * where the fire-and-forget call is made and where the difference between "this
 * row was lost" and "this call failed" is still visible. Swallowing it here
 * would apply that decision to every future caller — including a backfill or a
 * test that genuinely wants to know the write failed.
 *
 * ── One row per ATTEMPT ──────────────────────────────────────────────────
 *
 * Including failures, per ADR-0005 — traceability that records only successes is
 * not traceability. A repaired boundary call writes two rows. Anyone counting
 * rows is counting attempts, and the arithmetic that turns those back into calls
 * does not exist yet either.
 */
export interface ModelCallRecordRepository {
  /**
   * The input is written out here rather than imported from `src/model`.
   *
   * Neither layer imports the other today and one telemetry row is not a good
   * enough reason to make this the first edge — the same trade `IntentionFacts`
   * takes at the domain boundary, and the same looseness: `boundary`,
   * `stopReason` and `failureKind` are `string` here and narrow unions there.
   * The narrowing is the model layer's to own; the column is a `TEXT`.
   *
   * The check that keeps the two in step is `npm run typecheck` at the call
   * sites, and it is stronger in one direction than the other: a field added
   * here fails every caller, a field removed here fails nobody and simply stops
   * being recorded.
   */
  create(row: {
    /** Null for the boundaries that run before any AgentRun exists — which is
     *  four of the eight, including both that run with no session at all. */
    runId: string | null
    boundary: string
    model: string
    promptVersion: string
    inputTokens: number
    outputTokens: number
    latencyMs: number
    stopReason: string | null
    /** Null means the attempt succeeded. */
    failureKind: string | null
    repairTurns: number
  }): Promise<{ id: string }>
}

function modelCallRecordRepository(prisma: PrismaClient): ModelCallRecordRepository {
  return {
    create: (row) =>
      prisma.modelCallRecord.create({
        data: { ...row },
        select: { id: true },
      }),
  }
}

/* ── Document ──────────────────────────────────────────────────────────── */

export interface DocumentRepository {
  create(input: { projectId: string; title: string; content: string; contentHash: string }): Promise<{ id: string; versionId: string }>
  /** `projectId` is included because an edit has to prove the document belongs
   *  to the project whose session is live before it writes a ledger row. */
  byId(id: string): Promise<{ id: string; title: string; projectId: string } | null>
  forProject(projectId: string): Promise<Array<{ id: string; title: string }>>
  /** Insert-only. A new version never mutates the previous one — an edited base
   *  would silently invalidate every changeset hash pointing at it. */
  addVersion(input: {
    documentId: string
    content: string
    contentHash: string
    origin: 'human' | 'accepted-changeset'
    /** Set for an `accepted-changeset` version. Unique, so a changeset settles
     *  exactly once and the foreign key is the "already reviewed" flag. */
    committedFromChangesetId?: string
  }): Promise<{ id: string; ordinal: number }>
  /** `documentId` is included because a version alone does not say which
   *  document it belongs to, and both `executeRun` and `finishReview` need to
   *  get from the pinned base back to the document it is a version of. */
  version(id: string): Promise<{ id: string; documentId: string; content: string; contentHash: string; ordinal: number } | null>
  latestVersion(documentId: string): Promise<{ id: string; content: string; contentHash: string; ordinal: number } | null>
}

function documentRepository(prisma: PrismaClient): DocumentRepository {
  const nextOrdinal = async (documentId: string) => {
    const last = await prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { ordinal: 'desc' },
      select: { ordinal: true },
    })
    return (last?.ordinal ?? 0) + 1
  }

  return {
    create: async ({ projectId, title, content, contentHash }) => {
      const doc = await prisma.document.create({ data: { projectId, title }, select: { id: true } })
      const version = await prisma.documentVersion.create({
        data: { documentId: doc.id, ordinal: 1, content, contentHash, origin: 'human' },
        select: { id: true },
      })
      return { id: doc.id, versionId: version.id }
    },
    byId: (id) =>
      prisma.document.findUnique({ where: { id }, select: { id: true, title: true, projectId: true } }),
    forProject: (projectId) =>
      prisma.document.findMany({ where: { projectId }, select: { id: true, title: true } }),
    addVersion: async ({ documentId, content, contentHash, origin, committedFromChangesetId }) =>
      prisma.documentVersion.create({
        data: {
          documentId,
          ordinal: await nextOrdinal(documentId),
          content,
          contentHash,
          origin,
          ...(committedFromChangesetId === undefined ? {} : { committedFromChangesetId }),
        },
        select: { id: true, ordinal: true },
      }),
    version: (id) =>
      prisma.documentVersion.findUnique({
        where: { id },
        select: { id: true, documentId: true, content: true, contentHash: true, ordinal: true },
      }),
    latestVersion: (documentId) =>
      prisma.documentVersion.findFirst({
        where: { documentId },
        orderBy: { ordinal: 'desc' },
        select: { id: true, content: true, contentHash: true, ordinal: true },
      }),
  }
}

/* ── Changeset ─────────────────────────────────────────────────────────── */

export interface ProposedChangeInput {
  readonly startOffset: number
  readonly endOffset: number
  readonly prefix: string
  readonly exact: string
  readonly suffix: string
  readonly replacement: string
  readonly reason: string
}

export interface ChangesetRepository {
  create(input: {
    contractId: string
    baseVersionId: string
    baseHash: string
    /**
     * The `document-changes` ShiftOutcome this changeset is the body of.
     *
     * OPTIONAL, and `contractId` stays beside it. Reparenting the changeset onto
     * the outcome and dropping the contract link would be tidier and would break
     * two things that already work: `forContract` is how the review screen finds
     * the changes, and the settled-once foreign key from DocumentVersion depends
     * on nothing about this row moving. So this is a link the outcome path adds,
     * not a spine the document path is rehomed onto.
     */
    outcomeId?: string | undefined
    changes: readonly ProposedChangeInput[]
  }): Promise<{ id: string }>
  /**
   * The changes belonging to one `document-changes` ShiftOutcome.
   *
   * Exists beside `forContract` rather than replacing it, and the difference
   * matters where it is used. `forContract` returns the NEWEST changeset for a
   * contract, which is what the review screen wants — the person is deciding on
   * the latest proposal. The reviewer is judging ONE RUN'S OWN work, and a
   * contract can carry more than one run (a re-accept enqueues another, a stale
   * lease re-claims). Handing the reviewer the newest changeset would let it
   * annotate a different run's changes and resolve its findings to their ids.
   */
  forOutcome(outcomeId: string): Promise<{
    id: string
    changes: Array<ProposedChangeInput & { id: string }>
  } | null>
  forContract(contractId: string): Promise<{
    id: string
    baseVersionId: string
    baseHash: string
    /** The version folded from this changeset, once the person finished the
     *  review. Its absence is what "still open" means — there is no separate
     *  status column that could disagree with the foreign key. */
    settledAsVersionId: string | null
    changes: Array<ProposedChangeInput & { id: string; verdict: { verdict: string; editedText: string | null } | null }>
  } | null>
  /** Append-only: a verdict is recorded once. Changing your mind means the UI
   *  has to say so explicitly rather than overwriting the record. */
  recordVerdict(input: { changeId: string; verdict: 'accept' | 'reject' | 'edit'; editedText?: string }): Promise<void>
  /** Has the review this change belongs to already been folded into a version?
   *  Asked from the change rather than the changeset, because that is what the
   *  verdict controls have in hand. */
  settledFor(changeId: string): Promise<boolean>
}

function changesetRepository(prisma: PrismaClient): ChangesetRepository {
  return {
    create: ({ contractId, baseVersionId, baseHash, outcomeId, changes }) =>
      prisma.changeset.create({
        data: {
          contractId,
          baseVersionId,
          baseHash,
          ...(outcomeId === undefined ? {} : { outcomeId }),
          changes: { create: [...changes] },
        },
        select: { id: true },
      }),
    forOutcome: (outcomeId) =>
      prisma.changeset.findUnique({
        where: { outcomeId },
        select: {
          id: true,
          changes: {
            orderBy: { startOffset: 'asc' },
            select: {
              id: true,
              startOffset: true,
              endOffset: true,
              prefix: true,
              exact: true,
              suffix: true,
              replacement: true,
              reason: true,
            },
          },
        },
      }),

    forContract: async (contractId) => {
      const row = await prisma.changeset.findFirst({
        where: { contractId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          baseVersionId: true,
          baseHash: true,
          settledAs: { select: { id: true } },
          changes: {
            orderBy: { startOffset: 'asc' },
            select: {
              id: true,
              startOffset: true,
              endOffset: true,
              prefix: true,
              exact: true,
              suffix: true,
              replacement: true,
              reason: true,
              verdict: { select: { verdict: true, editedText: true } },
            },
          },
        },
      })
      if (!row) return null

      const { settledAs, ...rest } = row
      return { ...rest, settledAsVersionId: settledAs?.id ?? null }
    },
    recordVerdict: async ({ changeId, verdict, editedText }) => {
      await prisma.changeVerdict.create({
        data: { changeId, verdict, ...(editedText === undefined ? {} : { editedText }) },
      })
    },
    settledFor: async (changeId) => {
      const row = await prisma.proposedChange.findUnique({
        where: { id: changeId },
        select: { changeset: { select: { settledAs: { select: { id: true } } } } },
      })
      return row?.changeset.settledAs != null
    },
  }
}

/* ── ReviewFinding ─────────────────────────────────────────────────────── */

/**
 * Display-only, by design (ADR-0004 and boundary 5's own header).
 *
 * A finding cannot block a change, fail a run, or alter a verdict. Scope
 * adherence is deterministic and already enforced by the gate, so there is
 * nothing here for a model to adjudicate — these annotate the things
 * determinism cannot judge, and the person decides.
 *
 * There is deliberately no update and no delete. A finding is a record of what
 * the second pass said, not a mutable annotation.
 */
export interface ReviewFindingInput {
  readonly changeId: string | null
  /**
   * The non-document production this annotates. AT MOST ONE of `changeId` and
   * `outcomeId` is set, and a finding about the run as a whole sets neither —
   * which is already how `changeId` behaves.
   *
   * Two nullable foreign keys where a polymorphic target would be tempting. They
   * cost nothing here precisely BECAUSE a finding is display-only: nothing has
   * to resolve the target in order to decide anything. The moment a finding
   * gained teeth this shape would need revisiting, and that is an argument for
   * keeping it toothless rather than for generalising the column.
   */
  readonly outcomeId?: string | null | undefined
  readonly kind: string
  readonly detail: string
}

export interface ReviewFindingRepository {
  create(input: { runId: string; findings: readonly ReviewFindingInput[] }): Promise<number>
  forChangeset(changesetId: string): Promise<Array<{ changeId: string | null; kind: string; detail: string }>>
  forRun(runId: string): Promise<
    Array<{ changeId: string | null; outcomeId: string | null; kind: string; detail: string }>
  >
}

function reviewFindingRepository(prisma: PrismaClient): ReviewFindingRepository {
  return {
    create: async ({ runId, findings }) => {
      if (findings.length === 0) return 0
      const { count } = await prisma.reviewFinding.createMany({
        data: findings.map((f) => ({
          runId,
          kind: f.kind,
          detail: f.detail,
          ...(f.changeId === null ? {} : { changeId: f.changeId }),
          ...(f.outcomeId === null || f.outcomeId === undefined ? {} : { outcomeId: f.outcomeId }),
        })),
      })
      return count
    },
    forChangeset: (changesetId) =>
      prisma.reviewFinding.findMany({
        where: { change: { changesetId } },
        select: { changeId: true, kind: true, detail: true },
      }),
    forRun: (runId) =>
      prisma.reviewFinding.findMany({
        where: { runId },
        select: { changeId: true, outcomeId: true, kind: true, detail: true },
      }),
  }
}

/* ── ShiftReport ───────────────────────────────────────────────────────── */

export interface ShiftReportRepository {
  /** Written in the app process when the human returns — never by an AgentRun.
   *  A report producible only by a live runner cannot exist on `interrupted`,
   *  the outcome that most needs one. */
  create(input: {
    contractId: string
    narrative: string | null
    decisions: ReadonlyArray<{ question: string; whyStopped: string; needs: string; ordinal: number }>
  }): Promise<{ id: string }>
  forContract(contractId: string): Promise<{
    id: string
    narrative: string | null
    decisions: Array<{ id: string; question: string; whyStopped: string; needs: string }>
  } | null>
}

function shiftReportRepository(prisma: PrismaClient): ShiftReportRepository {
  return {
    create: ({ contractId, narrative, decisions }) =>
      prisma.shiftReport.create({
        data: {
          contractId,
          narrative,
          decisions: { create: [...decisions] },
        },
        select: { id: true },
      }),
    forContract: (contractId) =>
      prisma.shiftReport.findUnique({
        where: { contractId },
        select: {
          id: true,
          narrative: true,
          decisions: {
            orderBy: { ordinal: 'asc' },
            select: { id: true, question: true, whyStopped: true, needs: true },
          },
        },
      }),
  }
}

/* ── WorkOffer ─────────────────────────────────────────────────────────── */

/**
 * The offer, written only once the person said yes.
 *
 * There is deliberately no `draft`, no `decline` and no `list`. An offer nobody
 * accepted has no row, by the rule ADR-0008 already applies to ambient
 * observations: a durable record of every guess Propositum made about what
 * someone was doing IS a profile, and the whole reason the ambient buffer lives
 * in memory is that it refuses to become one. Declining must cost nothing and
 * leave nothing, and a repository that could write a declined offer would make
 * that a convention rather than a fact.
 */
export interface WorkOfferInput {
  readonly sessionId: string
  readonly threadSignature: string
  readonly promptVersion: string
  readonly title: string
  readonly rationale: string
  /** OfferOutline — ordered one-line intentions. Display only, never PlanSteps. */
  readonly outline: readonly string[]
  readonly produces: string
  readonly excludes: readonly string[]
  /** CODE-DERIVED from the pages the thread ran through. The caller owns that
   *  being true; this is the only field here that reaches a scope decision, so
   *  it is the only one worth being strict about. */
  readonly originPatterns: readonly string[]
  /** ShiftOutcomeKind[], already coerced against the closed set by the caller. */
  readonly expectedKinds: readonly string[]
  /** OfferGrounds — what the detector saw, frozen at acceptance because the
   *  buffer it came from will not hold the answer an hour later. */
  readonly grounds: JsonObject
}

export interface WorkOfferRepository {
  create(input: WorkOfferInput): Promise<{ id: string }>
  forSession(sessionId: string): Promise<
    | (Omit<WorkOfferInput, 'outline' | 'excludes' | 'originPatterns' | 'expectedKinds'> & {
        id: string
        outline: string[]
        excludes: string[]
        originPatterns: string[]
        expectedKinds: string[]
        createdAt: Date
      })
    | null
  >
}

function workOfferRepository(prisma: PrismaClient): WorkOfferRepository {
  const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])

  return {
    create: (input) =>
      prisma.workOffer.create({
        data: {
          sessionId: input.sessionId,
          threadSignature: input.threadSignature,
          promptVersion: input.promptVersion,
          title: input.title,
          rationale: input.rationale,
          outline: [...input.outline],
          produces: input.produces,
          excludes: [...input.excludes],
          originPatterns: [...input.originPatterns],
          expectedKinds: [...input.expectedKinds],
          grounds: input.grounds as object,
        },
        select: { id: true },
      }),
    forSession: async (sessionId) => {
      const row = await prisma.workOffer.findUnique({ where: { sessionId } })
      if (!row) return null
      return {
        ...row,
        outline: asStrings(row.outline),
        excludes: asStrings(row.excludes),
        originPatterns: asStrings(row.originPatterns),
        expectedKinds: asStrings(row.expectedKinds),
        grounds: (row.grounds ?? {}) as JsonObject,
      }
    },
  }
}

/* ── ShiftOutcome ──────────────────────────────────────────────────────── */

export interface ShiftOutcomeInput {
  /** ShiftOutcomeKind, decided by deterministic code. A production matching no
   *  kind never reaches here — the caller drops it and counts it. */
  readonly kind: string
  /** held | landed. Code-assigned. `landed` means there is no verdict to offer. */
  readonly reversibility: string
  readonly headline: string
  readonly reason: string
  /** Already intersected with this run's completed ActionIntents by the caller.
   *  A join, not a claim — this stores what survived the intersection. */
  readonly citedActionIntentIds: readonly string[]
  readonly detail: JsonObject
}

export interface StoredShiftOutcome extends Omit<ShiftOutcomeInput, 'citedActionIntentIds'> {
  readonly id: string
  readonly ordinal: number
  readonly citedActionIntentIds: string[]
  readonly verdict: { verdict: string; editedText: string | null } | null
  readonly createdAt: Date
}

/**
 * One unit somebody either decided on, or was owed a decision on.
 *
 * ── What a unit is, and why it is not one row per outcome ────────────────
 *
 * `docs/MVP.md` defines H2's denominator as **decidable units**, and a unit is
 * not the same size in every kind: a `document-changes` outcome is decided one
 * `ProposedChange` at a time, and a `collection`, an `answer` or a
 * `message-draft` is decided as a whole. So one ShiftOutcome yields either N
 * units or one, and counting outcomes instead would make a run that proposed
 * eight paragraphs and a run that answered one question weigh the same.
 *
 * ── `decidable`, not `landed`, and the difference is the default ─────────
 *
 * The rule this field exists for is that a `landed` outcome is **excluded from
 * the denominator entirely** — not accepted, not rejected. Nobody was ever
 * offered a verdict, so scoring it either way invents a judgment the person did
 * not make, and counting it as accepted would let a run improve its acceptance
 * rate by acting irreversibly.
 *
 * It is written as *is this decidable* rather than *did this land* so the
 * default falls the safe way: a reversibility this reader has never seen is not
 * decidable, so it stays OUT of the headline denominator instead of quietly
 * entering it. The predicate is `isDecidable`, imported rather than re-spelt.
 *
 * ── What it does NOT carry ───────────────────────────────────────────────
 *
 * No `ActionEvidence`, and this is a constraint rather than an omission. The
 * evidence sweep deletes a run's snapshots as soon as every held outcome is
 * decided — which is exactly the moment a trajectory completes — so a reader
 * built on evidence would go blank on precisely the runs it most wants to
 * describe, and would look like an empty dataset rather than a deleted one.
 * Everything here is a semantic row that outlives the sweep.
 */
export interface TrajectoryUnit {
  /** The Shift this unit was produced under. A Shift is addressed by contract
   *  everywhere a person can see it, so it is the id a reader can act on. */
  readonly contractId: string
  /**
   * The Intention the contract advanced, or null.
   *
   * Null is the ordinary value and will stay that way for a long time:
   * `HandoffContract.intentionId` is written at draft time only and **nothing
   * backfills it**, so every Shift that ran before ADR-0011 carries a null and
   * none can be given one — the frozen-once-accepted trigger permits an UPDATE
   * only while the contract is still a draft. A report that read a low count
   * here as "people are not stating intentions" would be reading the migration,
   * not the person.
   */
  readonly intentionId: string | null
  /** `HandoffContract.output` — `suggestions-only` | `draft-changes`. Carried
   *  because H2 excuses a zero-unit run under one of them and fails it under
   *  the other, and the mode is a property of the contract rather than of the
   *  corpus. */
  readonly outputMode: string
  /** The ShiftOutcome, or null for a Changeset written before the outcome spine
   *  existed. See `trajectory()` on why those are in here at all. */
  readonly outcomeId: string | null
  /** The ProposedChange, when the unit is one. Null for the kinds decided
   *  whole. */
  readonly changeId: string | null
  /** May a person be offered a verdict on this at all. See the type docblock. */
  readonly decidable: boolean
  /** `accept` | `reject` | `edit`, or null while nobody has decided.
   *
   *  Deliberately the stored string rather than a union. This is a read of rows
   *  written over months; narrowing it here would turn a value this reader does
   *  not recognise into a type error at the wrong end, and the tally counts
   *  those rather than crashing on them. */
  readonly verdict: string | null
  /** When the run produced it. The ordering key, and the only honest answer to
   *  "over what window is this rate measured". */
  readonly producedAt: Date
}

export interface ShiftOutcomeRepository {
  /**
   * Write a run's productions in one go.
   *
   * Ordinals are assigned HERE, inside one transaction, rather than by the
   * caller. `@@unique([runId, ordinal])` is what makes "the third thing it did"
   * a stable phrase in a report, and a caller counting rows it read a moment
   * ago cannot keep that promise while anything else is writing.
   */
  create(input: {
    runId: string
    outcomes: readonly ShiftOutcomeInput[]
  }): Promise<Array<{ id: string; ordinal: number }>>
  forRun(runId: string): Promise<StoredShiftOutcome[]>
  /**
   * Everything one Shift produced, across every run under its contract.
   *
   * A Shift is addressed by contract everywhere a person can see it — the
   * re-entry note is a route on the contract id, and the fold is too — while an
   * outcome hangs off a run, and a contract has a worker run and possibly a
   * reviewer run. Without this, both the screen and the fold would have to
   * fetch the runs first and then loop, and two callers doing that separately
   * is two chances to miss the reviewer's rows.
   *
   * Ordered oldest run first, then by the ordinal the writer assigned, so "the
   * third thing it made" is a stable phrase across a re-read.
   */
  forContract(contractId: string): Promise<StoredShiftOutcome[]>
  /** One outcome, for the write path that must check `reversibility` before it
   *  will record a verdict against it. */
  byId(id: string): Promise<StoredShiftOutcome | null>
  /** Append-only, exactly as ChangeVerdict is: a verdict is recorded once, and
   *  changing your mind has to be something the interface does visibly. */
  recordVerdict(input: {
    outcomeId: string
    verdict: 'accept' | 'reject' | 'edit'
    editedText?: string
  }): Promise<void>
  /**
   * Every decidable unit this database holds, oldest first, across every Shift.
   *
   * ── Why it exists ────────────────────────────────────────────────────────
   *
   * `ChangeVerdict`, `OutcomeVerdict` and `ConfirmationVerdict` have been
   * append-only and trigger-guarded since ADR-0003, and until this method
   * **nothing read any of them back as a dataset**. `docs/ARCHITECTURE.md`
   * marks that layer *"data built, nothing reads it"*, and the concrete cost
   * was that `scoreH2` had no production caller — so the MVP's own acceptance
   * metric was defined, scored in unit tests, and **not computable from the
   * database it was being collected in**.
   *
   * ── The second query, which is the part most likely to be deleted ────────
   *
   * The obvious spine is `ShiftOutcome`, and on its own it is WRONG here.
   * `Changeset.outcomeId` is nullable and `Changeset.contractId` stays — the
   * schema says so in as many words, because *"a document Shift that produces
   * no ShiftOutcome — every one that has ever run — must keep working
   * unchanged"*. Every changeset written before the outcome spine landed has a
   * null `outcomeId`, so a reader that walked outcomes only would silently drop
   * the entire pre-spine history of the ORIGINAL H2 denominator and report a
   * confident rate over whatever came after. That failure has no symptom: the
   * number arrives, it is a percentage, and it is measured over the wrong
   * corpus. So there are two queries, and the second one is not an edge case.
   *
   * There is no double counting: the second query takes `outcomeId: null`, and
   * a changeset the first query reached by definition has one.
   *
   * ── No parameter, and the same argument `factsForEveryProject` makes ─────
   *
   * The whole trajectory or nothing. Filtering by contract would mean a caller
   * assembling an id list, which is the bound-variable growth this file has
   * already been bitten by, and H2 is a claim about a corpus rather than about
   * one Shift.
   *
   * ── Ordering ─────────────────────────────────────────────────────────────
   *
   * By `producedAt` across productions, then by the writer's `ordinal`, then
   * document order within a changeset. Oldest first, because the question this
   * dataset exists to answer next is whether the rate is moving.
   */
  trajectory(): Promise<TrajectoryUnit[]>
}

function shiftOutcomeRepository(prisma: PrismaClient): ShiftOutcomeRepository {
  const asStrings = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])

  // One column list for every reader here, so a field added to the row cannot
  // appear on one screen and not another.
  const FIELDS = {
    id: true,
    ordinal: true,
    kind: true,
    reversibility: true,
    headline: true,
    reason: true,
    citedActionIntentIds: true,
    detail: true,
    createdAt: true,
    verdict: { select: { verdict: true, editedText: true } },
  } as const

  const shape = (row: {
    id: string
    ordinal: number
    kind: string
    reversibility: string
    headline: string
    reason: string
    citedActionIntentIds: unknown
    detail: unknown
    createdAt: Date
    verdict: { verdict: string; editedText: string | null } | null
  }): StoredShiftOutcome => ({
    ...row,
    citedActionIntentIds: asStrings(row.citedActionIntentIds),
    detail: (row.detail ?? {}) as JsonObject,
  })

  return {
    create: ({ runId, outcomes }) =>
      prisma.$transaction(async (tx) => {
        const last = await tx.shiftOutcome.findFirst({
          where: { runId },
          orderBy: { ordinal: 'desc' },
          select: { ordinal: true },
        })

        // One at a time rather than `createMany`, because SQLite's createMany
        // returns a count and nothing else — and the caller needs the ids, to
        // attach a Changeset to the `document-changes` one.
        const written: Array<{ id: string; ordinal: number }> = []
        let ordinal = (last?.ordinal ?? 0) + 1
        for (const shiftOutcome of outcomes) {
          const row = await tx.shiftOutcome.create({
            data: {
              runId,
              ordinal,
              kind: shiftOutcome.kind,
              reversibility: shiftOutcome.reversibility,
              headline: shiftOutcome.headline,
              reason: shiftOutcome.reason,
              citedActionIntentIds: [...shiftOutcome.citedActionIntentIds],
              detail: shiftOutcome.detail as object,
            },
            select: { id: true, ordinal: true },
          })
          written.push(row)
          ordinal += 1
        }
        return written
      }),

    forRun: async (runId) => {
      const rows = await prisma.shiftOutcome.findMany({
        where: { runId },
        orderBy: { ordinal: 'asc' },
        select: FIELDS,
      })
      return rows.map(shape)
    },

    forContract: async (contractId) => {
      const rows = await prisma.shiftOutcome.findMany({
        where: { run: { contractId } },
        orderBy: [{ run: { createdAt: 'asc' } }, { ordinal: 'asc' }],
        select: FIELDS,
      })
      return rows.map(shape)
    },

    byId: async (id) => {
      const row = await prisma.shiftOutcome.findUnique({ where: { id }, select: FIELDS })
      return row === null ? null : shape(row)
    },

    recordVerdict: async ({ outcomeId, verdict, editedText }) => {
      await prisma.outcomeVerdict.create({
        data: { outcomeId, verdict, ...(editedText === undefined ? {} : { editedText }) },
      })
    },

    trajectory: async () => {
      const CONTRACT = { id: true, intentionId: true, output: true } as const
      // Document order inside a changeset, matching `forOutcome` and
      // `forContract` — so "the third change" is the same change in the report,
      // on the review screen and in this dataset.
      const CHANGES = {
        orderBy: { startOffset: 'asc' },
        select: { id: true, verdict: { select: { verdict: true } } },
      } as const

      const produced = await prisma.shiftOutcome.findMany({
        orderBy: [{ createdAt: 'asc' }, { ordinal: 'asc' }],
        select: {
          id: true,
          kind: true,
          reversibility: true,
          createdAt: true,
          verdict: { select: { verdict: true } },
          run: { select: { contract: { select: CONTRACT } } },
          changeset: { select: { changes: CHANGES } },
        },
      })

      // The pre-spine half. Argued at `trajectory()` in the interface above;
      // deleting this query is how the metric silently changes corpus.
      const unattached = await prisma.changeset.findMany({
        where: { outcomeId: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true, contract: { select: CONTRACT }, changes: CHANGES },
      })

      const units: TrajectoryUnit[] = []

      for (const outcome of produced) {
        const contract = outcome.run.contract
        const shared = {
          contractId: contract.id,
          intentionId: contract.intentionId,
          outputMode: contract.output,
          outcomeId: outcome.id,
          decidable: isDecidable(outcome.reversibility),
          producedAt: outcome.createdAt,
        }

        /**
         * Branching on the KIND rather than on whether a changeset happens to
         * be attached, and the difference is not cosmetic.
         *
         * `document-changes` never receives an `OutcomeVerdict` — it is decided
         * one `ProposedChange` at a time — so a document outcome whose
         * changeset is missing has NOTHING decidable under it. Branching on the
         * changeset's presence would emit one unit for that outcome with a null
         * verdict, and a null verdict reads as *waiting on the person* forever.
         * The unit is a phantom: nobody can ever decide it, because there is no
         * control anywhere that would write the row.
         *
         * Spelt as a comparison rather than as a Prisma filter deliberately:
         * `tests/architecture.test.ts` greps for the ASSIGNMENT form
         * `kind: '<a ShiftOutcomeKind>'` to prove one file assigns a kind. This
         * reads one back, which that grep can tell apart and several other
         * readers already do.
         */
        if (outcome.kind === 'document-changes') {
          for (const change of outcome.changeset?.changes ?? []) {
            units.push({ ...shared, changeId: change.id, verdict: change.verdict?.verdict ?? null })
          }
          continue
        }

        units.push({ ...shared, changeId: null, verdict: outcome.verdict?.verdict ?? null })
      }

      for (const changeset of unattached) {
        for (const change of changeset.changes) {
          units.push({
            contractId: changeset.contract.id,
            intentionId: changeset.contract.intentionId,
            outputMode: changeset.contract.output,
            outcomeId: null,
            changeId: change.id,
            // A ProposedChange addresses character offsets into an immutable
            // base version held inside Propositum. There is no way for one to
            // have landed anywhere, so this is a property of the shape rather
            // than a reversibility being assigned to a row that has none.
            decidable: true,
            verdict: change.verdict?.verdict ?? null,
            producedAt: changeset.createdAt,
          })
        }
      }

      // Both halves arrive sorted; merging them is what needs the pass. Sort is
      // stable in V8, so units produced in the same millisecond keep the order
      // their query gave them — ordinal for outcomes, document order within a
      // changeset.
      units.sort((a, b) => a.producedAt.getTime() - b.producedAt.getTime())
      return units
    },
  }
}

/* ── ConfirmationRequest and its verdict ───────────────────────────────── */

/**
 * The gate stopped and asked the person.
 *
 * Request and verdict share one repository because they are one interaction,
 * and splitting them would leave "is it still pending" belonging to neither.
 * That question is answered by the ABSENCE of a verdict row — there is no
 * status column that could disagree with it, the same shape
 * `Changeset.settledAs` already uses.
 */
export interface ConfirmationRepository {
  create(input: {
    runId: string
    /** The REFUSED intent that produced this. Unique — one intent, one request. */
    intentId: string
    /** Code-generated from attested facts. Never model prose. */
    summary: string
    evidenceId?: string
  }): Promise<{ id: string }>
  /** Requests this run raised that nobody has answered yet. */
  pendingForRun(runId: string): Promise<
    Array<{
      id: string
      intentId: string
      summary: string
      evidenceId: string | null
      createdAt: Date
    }>
  >
  byId(id: string): Promise<
    | {
        id: string
        runId: string
        intentId: string
        summary: string
        evidenceId: string | null
        verdict: string | null
      }
    | null
  >
  /**
   * ONLY A HUMAN CALLS THIS. No model, worker run or reviewer run may.
   *
   * That cannot be enforced by a column — the database cannot see who is
   * holding the keyboard — so it is enforced by there being exactly one caller,
   * in the app process, acting on a request the person is looking at. Saying so
   * here is the point: whoever next wants a confirmation resolved from inside a
   * run has to delete this sentence before they can break the rule.
   */
  recordVerdict(input: {
    requestId: string
    verdict: 'confirmed' | 'rejected'
    decidedAt: Date
  }): Promise<void>
}

function confirmationRepository(prisma: PrismaClient): ConfirmationRepository {
  return {
    create: ({ runId, intentId, summary, evidenceId }) =>
      prisma.confirmationRequest.create({
        data: {
          runId,
          intentId,
          summary,
          ...(evidenceId === undefined ? {} : { evidenceId }),
        },
        select: { id: true },
      }),

    pendingForRun: (runId) =>
      prisma.confirmationRequest.findMany({
        where: { runId, verdict: { is: null } },
        orderBy: { createdAt: 'asc' },
        select: { id: true, intentId: true, summary: true, evidenceId: true, createdAt: true },
      }),

    byId: async (id) => {
      const row = await prisma.confirmationRequest.findUnique({
        where: { id },
        select: {
          id: true,
          runId: true,
          intentId: true,
          summary: true,
          evidenceId: true,
          verdict: { select: { verdict: true } },
        },
      })
      if (!row) return null

      const { verdict, ...rest } = row
      return { ...rest, verdict: verdict?.verdict ?? null }
    },

    recordVerdict: async ({ requestId, verdict, decidedAt }) => {
      await prisma.confirmationVerdict.create({ data: { requestId, verdict, decidedAt } })
    },
  }
}

/* ── ActionEvidence ────────────────────────────────────────────────────── */

/**
 * What the agent saw while acting.
 *
 * DISJOINT from ObservationEvent, which is why this is its own repository and
 * its own table. The two ledgers staying separate is what keeps the published
 * 2,000-character retention promise true: that promise is about the person's
 * own browsing, and an agent driving a browser has to capture whole pages to
 * act at all.
 *
 * ── Corrected: raw text does not arrive here ────────────────────────────
 *
 * This comment used to end "one door writing both would make the promise depend
 * on remembering which caller it was", and read as an argument that the ledger
 * writer must not touch ActionEvidence at all. That conflated two different
 * doors and got the second one wrong.
 *
 * The SEQUENCING door is per-table and must stay singular: `seq` is gapless per
 * session and ActionEvidence has no `seq`, so nothing here belongs in
 * `append()`. The SANITISING door is per-SYSTEM and must also stay singular —
 * ADR-0003 §35 — because a second place that turns raw page text into stored
 * text is a second place to forget to call `datamark`.
 *
 * So `createLedgerWriter().appendEvidence()` is the only production caller of
 * `create` below, and it hands over text that has ALREADY been datamarked and a
 * URL that has already been cleaned. Two ledgers, one sanitiser.
 */
export interface ActionEvidenceRepository {
  create(input: {
    runId: string
    intentId?: string
    /** page-snapshot | screen-capture */
    kind: string
    /** Browser-attested. Chrome said this is where the tab is; the page did not. */
    url: string
    /** Page-authored. Sanitised and bounded by the caller, never interpolated raw. */
    untrusted?: JsonObject
    /**
     * The buffer type parameter is spelled out because Prisma's `Bytes` is
     * `Uint8Array<ArrayBuffer>` and a bare `Uint8Array` is
     * `Uint8Array<ArrayBufferLike>`, which includes `SharedArrayBuffer` and
     * does not assign. Writing it here rather than casting at the boundary
     * keeps the mismatch where a caller can see it — a screenshot arriving over
     * the control channel is an ordinary `Uint8Array` and satisfies this; a
     * Node `Buffer` does not, and should be converted rather than asserted.
     */
    image?: Uint8Array<ArrayBuffer>
    truncated?: boolean
  }): Promise<{ id: string }>
  /**
   * Metadata for one run, WITHOUT the images.
   *
   * A run that drove a browser for half an hour holds megabytes of screen
   * captures, and every caller that wants a list wants a list. Loading the
   * bytes to render "12 pages seen" is the kind of default that only becomes
   * visible once there is real data in the table.
   */
  forRun(runId: string): Promise<
    Array<{
      id: string
      intentId: string | null
      kind: string
      url: string
      truncated: boolean
      createdAt: Date
    }>
  >
  /** The whole row, image included — for rendering the one thing the person
   *  asked to look at. */
  byId(id: string): Promise<
    | {
        id: string
        runId: string
        intentId: string | null
        kind: string
        url: string
        untrusted: unknown
        image: Uint8Array | null
        truncated: boolean
        createdAt: Date
      }
    | null
  >
  /**
   * Delete rows created before `createdBefore`. The unconditional half of the
   * retention promise.
   *
   * Policy — how long the window is, and when it runs — lives in
   * `src/server/evidence-sweep.ts`. This is only the query, because a retention
   * WINDOW written into a repository is a published promise hidden inside a
   * data-access layer, and nobody looks for it there.
   */
  sweepOlderThan(createdBefore: Date): Promise<EvidenceSweepCounts>
  /**
   * Delete rows belonging to runs whose every ShiftOutcome is settled — the
   * person has accepted or rejected each held production, or it already landed
   * and admits no verdict.
   *
   * The normal case, and the one that matters most: once the person has decided
   * what a Shift made, the screenshots of their authenticated session have no
   * remaining reader, and holding them to the end of the window would be
   * keeping them for nobody.
   *
   * A run with NO outcomes at all is not settled — it is unfinished, or it
   * failed, and its evidence is the only account of what it was doing when it
   * stopped. Those rows leave by `sweepOlderThan` instead.
   */
  sweepSettledRuns(): Promise<EvidenceSweepCounts>
}

/**
 * What one sweep pass did.
 *
 * `keptForConfirmation` is not an error count and not a failure. A
 * ConfirmationRequest carries a foreign key to the exact row the person was
 * looking at when they authorised an effect, and `confirmation_request` is
 * append-only — so that row can never be deleted without deleting the record of
 * a human being asked, which is the one piece of this ledger the audit trail
 * genuinely needs. It is counted rather than silently skipped, because a
 * retention sweep that quietly leaves rows behind is a promise with an
 * undocumented exception, and this project already publishes the exception.
 */
export interface EvidenceSweepCounts {
  readonly deleted: number
  readonly keptForConfirmation: number
}

/**
 * How many evidence rows one delete transaction may take.
 *
 * Small on purpose. This is a bound on how long SQLite's single write lock is
 * held, not a throughput setting — see the comment inside `sweep`.
 */
const SWEEP_BATCH = 200

/**
 * A ShiftOutcome that is still waiting on a person.
 *
 * Written as data beside the sweep rather than inlined, because it is a claim
 * about the PRODUCT — what "the person has decided" means — and it has to stay
 * in step with `recordOutcomeVerdict` and `finishShift`. If a sixth outcome
 * kind ever settles by some third route, this is the one place that has to
 * learn about it, and getting it wrong is silent: an outcome that can never
 * settle keeps a run's screenshots alive, and an outcome wrongly counted as
 * settled deletes evidence someone was about to look at.
 */
const UNSETTLED: Prisma.ShiftOutcomeWhereInput = {
  // Landed is never waiting: there is no verdict to give.
  reversibility: { not: 'landed' },
  OR: [
    // The four kinds a person accepts or rejects as a whole.
    { kind: { not: 'document-changes' }, verdict: { is: null } },
    // Document changes are decided one ProposedChange at a time. A changeset
    // with an undecided change is waiting; one with none — or an outcome with
    // no changeset at all — has nothing left to ask.
    //
    // Spelt `{ equals: … }` rather than the shorthand deliberately.
    // `tests/architecture.test.ts` greps for `kind: '<a ShiftOutcomeKind>'` to
    // prove that exactly one file ASSIGNS an outcome kind, and a Prisma filter
    // written in the shorthand is indistinguishable from an assignment to that
    // grep. The long form says "this reads a kind" in a way both a person and
    // the guard can tell apart from writing one.
    {
      kind: { equals: 'document-changes' },
      changeset: { changes: { some: { verdict: { is: null } } } },
    },
  ],
}

export function actionEvidenceRepository(prisma: PrismaClient): ActionEvidenceRepository {
  /**
   * Delete everything matching `where` that no ConfirmationRequest points at,
   * and count what had to stay.
   *
   * The count is taken BEFORE the delete and inside the same transaction. Taken
   * after, it would race a concurrent confirmation and report a number that was
   * never true at any single moment.
   */
  async function sweep(where: Prisma.ActionEvidenceWhereInput): Promise<EvidenceSweepCounts> {
    const keptForConfirmation = await prisma.actionEvidence.count({
      where: { ...where, requests: { some: {} } },
    })

    /**
     * Deleted in small batches, and the batching is about the WRITE LOCK rather
     * than about memory.
     *
     * SQLite permits exactly one writer. A single `deleteMany` over a week of
     * evidence — screenshots included, which are the heaviest rows in the
     * database — holds that lock for as long as it takes, and every concurrent
     * `append()` from the app process is an interactive transaction with
     * Prisma's five-second timeout. `ledger-writer.ts` documents that exact
     * failure and serialises its own writes to avoid it; the sweep runs in a
     * different process and cannot join that queue, so it has to be a good
     * citizen instead. Many short transactions release the lock between
     * batches; one long one does not.
     *
     * Deleting by id rather than re-running the predicate keeps each batch's
     * work proportional to the batch and makes progress monotone — a row
     * selected in a batch is either deleted or gone already.
     */
    let deleted = 0
    for (;;) {
      const batch = await prisma.actionEvidence.findMany({
        where: { ...where, requests: { none: {} } },
        select: { id: true },
        take: SWEEP_BATCH,
      })
      if (batch.length === 0) break

      const { count } = await prisma.actionEvidence.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      })
      deleted += count

      // A batch that deleted nothing means something else is holding these rows
      // — a foreign key added later, most likely. Stopping is right: looping on
      // an unchanging set is the same wedge shape the ambient buffer had.
      if (count === 0) break
    }

    return { deleted, keptForConfirmation }
  }

  return {
    create: ({ runId, intentId, kind, url, untrusted, image, truncated }) =>
      prisma.actionEvidence.create({
        data: {
          runId,
          kind,
          url,
          ...(intentId === undefined ? {} : { intentId }),
          ...(untrusted === undefined ? {} : { untrusted: untrusted as object }),
          ...(image === undefined ? {} : { image }),
          ...(truncated === undefined ? {} : { truncated }),
        },
        select: { id: true },
      }),

    forRun: (runId) =>
      prisma.actionEvidence.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          intentId: true,
          kind: true,
          url: true,
          truncated: true,
          createdAt: true,
        },
      }),

    byId: (id) => prisma.actionEvidence.findUnique({ where: { id } }),

    sweepOlderThan: (createdBefore) => sweep({ createdAt: { lt: createdBefore } }),

    /**
     * Expressed as a relation filter rather than as an id list, and that is a
     * correctness point rather than a tidiness one.
     *
     * The obvious shape — collect every settled run id, then
     * `runId: { in: [...] }` — grows one parameter per settled run and walks
     * into SQLite's bound-variable limit on a database that has simply been
     * used for a few months. The failure arrives late, on the machine with the
     * most history, in the code path whose whole job is not accumulating
     * history.
     *
     * `some: {}` with `none: {…}` on the same relation is an AND: the run has
     * outcomes, and none of them is still awaiting a person. Both halves are
     * needed. A run with NO outcomes is not settled — it is unfinished, or it
     * failed, and its evidence is the only account of what it was doing when it
     * stopped; those rows leave by `sweepOlderThan` instead.
     *
     * ── Two kinds of settled, because there are two kinds of verdict ────
     *
     * `UNSETTLED` below is the honest predicate and the first version of it was
     * wrong in the most expensive possible direction. It read *"held, and no
     * `OutcomeVerdict`"* — which is right for four of the five outcome kinds and
     * permanently FALSE for `document-changes`, the most common thing a Shift
     * produces. A document outcome never receives an `OutcomeVerdict` at all:
     * `recordOutcomeVerdict` refuses that kind outright, because its decidable
     * units are the individual `ProposedChange`s and each carries its own
     * `ChangeVerdict`. So the predicate matched it forever, every run that
     * edited a document counted as unsettled forever, and rule 1 — the one
     * documented as "the rule that fires in ordinary use" — never fired for the
     * ordinary use. A person could accept every change in the afternoon and
     * their screenshots would still sit there for a week.
     *
     * `landed` is settled the moment it is written, because there is nothing to
     * accept about something that already happened out in the world.
     */
    sweepSettledRuns: () => sweep({ run: { outcomes: { some: {}, none: UNSETTLED } } }),
  }
}

/* ── ActionDispatch — the queue the browser control channel drains ─────── */

/**
 * One instruction handed to the browser.
 *
 * MUTABLE, and the claim is the reason. This plays the role for the control
 * channel that AgentRun plays for runs: the queue is a status column and one
 * guarded conditional UPDATE, not new infrastructure.
 *
 * None of it is evidence. The append-only record of what was attempted is the
 * ActionIntent, committed before the dispatch exists, so a dispatch that is
 * redelivered, lost or abandoned changes nothing about what the audit trail
 * says was authorised.
 */
export interface ActionDispatchRepository {
  /**
   * IDEMPOTENT on `intentId`.
   *
   * Re-enqueueing an already-delivered dispatch returns the existing row and
   * does NOT reset its status. For a browser action "deliver twice" means
   * "click twice", and a worker retrying after a transport error whose answer
   * it never saw is the ordinary case rather than the exotic one.
   *
   * Implemented as insert-then-catch rather than `upsert` with an empty
   * `update`. Prisma only emits a native `INSERT … ON CONFLICT` for an upsert
   * it can prove is a single statement, and an empty update does not qualify —
   * it falls back to read-then-write, which under concurrency raises P2002
   * instead of returning the row, which is precisely the case this method
   * exists to make impossible.
   */
  enqueue(input: {
    runId: string
    intentId: string
    kind: string
    params: JsonObject
  }): Promise<{ id: string; status: string }>
  /** The oldest undelivered instruction for this run. A read — it wins nothing. */
  nextQueued(
    runId: string,
  ): Promise<{ id: string; intentId: string; kind: string; params: unknown } | null>
  /**
   * The guarded claim: a conditional UPDATE `queued → delivered` that reports
   * whether it won.
   *
   * `updateMany` with the expected status in the WHERE, rather than a
   * read-then-write, so the check and the write are one statement and there is
   * no window between them at all. Two callers that both read the same row from
   * `nextQueued` will both call this and exactly one gets `true`; the loser must
   * not deliver. Returning a boolean rather than throwing is deliberate —
   * losing this race is a normal outcome, not an error.
   */
  claim(input: { id: string; deliveredAt: Date }): Promise<boolean>
  /** The channel reported back. `delivered → reported`, guarded the same way. */
  report(input: { id: string; reportedAt: Date }): Promise<boolean>
  /**
   * Give up on an instruction that was never delivered.
   *
   * Deliberately refuses to abandon a DELIVERED dispatch. Once the instruction
   * is with the browser we do not know whether it ran, and a row saying
   * `abandoned` over an effect that landed is worse than one saying `delivered`
   * over an effect that did not — the first reads as "nothing happened".
   */
  abandon(id: string): Promise<boolean>
}

function actionDispatchRepository(prisma: PrismaClient): ActionDispatchRepository {
  return {
    enqueue: async ({ runId, intentId, kind, params }) => {
      try {
        return await prisma.actionDispatch.create({
          data: { runId, intentId, kind, params: params as object },
          select: { id: true, status: true },
        })
      } catch (error) {
        // P2002 on `intentId` means the dispatch already exists, which is the
        // retry this method is for. Anything else is a real failure and must
        // not be swallowed — an enqueue that quietly returns a row it did not
        // write would let a worker believe an instruction is on its way.
        const code = (error as { code?: string } | null)?.code
        if (code !== 'P2002') throw error

        return prisma.actionDispatch.findUniqueOrThrow({
          where: { intentId },
          select: { id: true, status: true },
        })
      }
    },

    nextQueued: (runId) =>
      prisma.actionDispatch.findFirst({
        where: { runId, status: 'queued' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, intentId: true, kind: true, params: true },
      }),

    claim: async ({ id, deliveredAt }) => {
      const { count } = await prisma.actionDispatch.updateMany({
        where: { id, status: 'queued' },
        data: { status: 'delivered', deliveredAt },
      })
      return count === 1
    },

    report: async ({ id, reportedAt }) => {
      const { count } = await prisma.actionDispatch.updateMany({
        where: { id, status: 'delivered' },
        data: { status: 'reported', reportedAt },
      })
      return count === 1
    },

    abandon: async (id) => {
      const { count } = await prisma.actionDispatch.updateMany({
        where: { id, status: 'queued' },
        data: { status: 'abandoned' },
      })
      return count === 1
    },
  }
}
