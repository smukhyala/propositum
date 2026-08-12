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

import type { PrismaClient } from '@prisma/client'
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
  }
}

/* ── Project ───────────────────────────────────────────────────────────── */

export interface ProjectRepository {
  create(name: string): Promise<{ id: string; name: string }>
  byId(id: string): Promise<{ id: string; name: string } | null>
  list(): Promise<Array<{ id: string; name: string }>>
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
  readonly baseVersionId: string
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
  enqueue(input: { contractId: string; role: 'worker' | 'reviewer' }): Promise<{ id: string }>
  /**
   * Claim the oldest pending run, atomically.
   *
   * Read-then-write inside `$transaction`, which Prisma opens with
   * BEGIN IMMEDIATE (verified, ADR-0001) — a deferred BEGIN would fail with
   * SQLITE_BUSY_SNAPSHOT, which the busy timeout does NOT retry.
   */
  claim(input: { leaseUntil: Date; startedAt: Date }): Promise<{ id: string; contractId: string; role: string } | null>
  renewLease(id: string, leaseUntil: Date): Promise<void>
  complete(id: string, status: 'succeeded' | 'failed', endedAt: Date, terminalReason?: string): Promise<void>
  /** Node never kills its children regardless of `detached`, so orphans are the
   *  default rather than the edge case. This is how they are reaped. */
  sweepExpiredLeases(now: Date): Promise<number>
  byId(id: string): Promise<{ id: string; status: string; contractId: string; progressStep: number } | null>
  advanceProgress(id: string, step: number): Promise<void>
}

function agentRunRepository(prisma: PrismaClient): AgentRunRepository {
  return {
    enqueue: ({ contractId, role }) =>
      prisma.agentRun.create({ data: { contractId, role }, select: { id: true } }),

    claim: ({ leaseUntil, startedAt }) =>
      prisma.$transaction(async (tx) => {
        const next = await tx.agentRun.findFirst({
          where: { status: 'pending' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, contractId: true, role: true },
        })
        if (!next) return null

        await tx.agentRun.update({
          where: { id: next.id },
          data: { status: 'claimed', leaseUntil, startedAt },
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
        select: { id: true, status: true, contractId: true, progressStep: true },
      }),

    advanceProgress: async (id, step) => {
      await prisma.agentRun.update({ where: { id }, data: { progressStep: step, status: 'running' } })
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
    changes: readonly ProposedChangeInput[]
  }): Promise<{ id: string }>
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
    create: ({ contractId, baseVersionId, baseHash, changes }) =>
      prisma.changeset.create({
        data: { contractId, baseVersionId, baseHash, changes: { create: [...changes] } },
        select: { id: true },
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
export interface ReviewFindingRepository {
  create(input: {
    runId: string
    findings: ReadonlyArray<{ changeId: string | null; kind: string; detail: string }>
  }): Promise<number>
  forChangeset(changesetId: string): Promise<Array<{ changeId: string | null; kind: string; detail: string }>>
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
        })),
      })
      return count
    },
    forChangeset: (changesetId) =>
      prisma.reviewFinding.findMany({
        where: { change: { changesetId } },
        select: { changeId: true, kind: true, detail: true },
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
