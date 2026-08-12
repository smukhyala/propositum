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

export interface Repositories {
  readonly projects: ProjectRepository
  readonly sessions: WorkSessionRepository
  readonly events: ObservationEventReader
  readonly readings: SessionReadingRepository
  readonly contracts: HandoffContractRepository
  readonly runs: AgentRunRepository
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
    projects: projectRepository(prisma),
    sessions: workSessionRepository(prisma),
    events: observationEventReader(prisma),
    readings: sessionReadingRepository(prisma),
    contracts: handoffContractRepository(prisma),
    runs: agentRunRepository(prisma),
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
  start(projectId: string): Promise<{ id: string; phase: string }>
  byId(id: string): Promise<{ id: string; projectId: string; phase: string; endedAt: Date | null } | null>
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
   */
  refile(id: string, projectId: string): Promise<void>
}

function workSessionRepository(prisma: PrismaClient): WorkSessionRepository {
  const setPhase = async (id: string, phase: SessionPhase) => {
    await prisma.workSession.update({ where: { id }, data: { phase } })
  }

  return {
    start: (projectId) =>
      prisma.workSession.create({ data: { projectId }, select: { id: true, phase: true } }),
    byId: (id) =>
      prisma.workSession.findUnique({
        where: { id },
        select: { id: true, projectId: true, phase: true, endedAt: true },
      }),
    forProject: (projectId) =>
      prisma.workSession.findMany({
        where: { projectId },
        select: { id: true, phase: true, startedAt: true },
        orderBy: { startedAt: 'desc' },
      }),
    markAway: (id) => setPhase(id, 'away'),
    markObserving: (id) => setPhase(id, 'observing'),
    refile: async (id, projectId) => {
      await prisma.workSession.update({ where: { id }, data: { projectId } })
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
}

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
   */
  claim(input: {
    leaseUntil: Date
    startedAt: Date
    claimedBy?: string
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

    claim: ({ leaseUntil, startedAt, claimedBy }) =>
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
        data: { status, endedAt, ...(terminalReason ? { terminalReason } : {}) },
      })
    },

    sweepExpiredLeases: async (now) => {
      const result = await prisma.agentRun.updateMany({
        where: { status: { in: ['claimed', 'running'] }, leaseUntil: { lt: now } },
        // The sweep's clock is not the lid's — it may run hours after the Mac
        // slept, which is why the report says "sometime before X".
        data: { status: 'interrupted', terminalReason: 'lease-expired', endedAt: now },
      })
      return result.count
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
