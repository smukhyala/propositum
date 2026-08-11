/**
 * The single path an ObservationEvent enters by.
 *
 * ── Why there is exactly one ────────────────────────────────────────────
 *
 * `seq` must be gapless per session, because inference reads the stream in
 * order and the eval replays it. Two writers assigning their own sequence
 * produce duplicates or holes under concurrency, and the resulting corruption
 * is invisible — the stream still looks like a stream.
 *
 * So the repositories deliberately expose no `appendEvent`. This is it.
 *
 * ── Sanitisation happens here, not at the caller ────────────────────────
 *
 * `append` takes RAW page text and datamarks it on the way in. That makes it
 * structurally impossible to get unsanitised page content into the ledger:
 * there is one door, and it sanitises.
 *
 * The alternative — asking callers to datamark first — is a convention, and the
 * extension is the least trustworthy caller in the system.
 *
 * ── Gaps are events, not absences ───────────────────────────────────────
 *
 * A hole indistinguishable from inactivity makes inference confidently report a
 * lull that never happened. That is the H1 corruption hardest to notice,
 * because nothing looks wrong.
 */

import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'
import { datamark, looksAdversarial } from '../model/untrusted'
import { cleanUrl } from '../capture/url'

/** Closed and code-owned. Adding a member is a schema change plus migration,
 *  never configuration. There is no `other`. */
export const OBSERVATION_KINDS = [
  'visited',
  'queried',
  'excerpted',
  'engaged',
  'returnedTo',
  'switchedAway',
  'documentEdited',
  'note',
  'sourceApproved',
  'captureGap',
] as const
export type ObservationKind = (typeof OBSERVATION_KINDS)[number]

/** Which kinds must carry an approved source, enumerated rather than described
 *  as "the browser ones" — `switchedAway` is by construction not attributable
 *  to a source. */
const REQUIRES_SOURCE = new Set<ObservationKind>([
  'visited',
  'queried',
  'excerpted',
  'engaged',
  'returnedTo',
  'sourceApproved',
])

export const CAPTURE_GAP_REASONS = [
  'service_worker_terminated',
  'machine_slept',
  'transport_disconnected',
  'permission_revoked',
] as const
export type CaptureGapReason = (typeof CAPTURE_GAP_REASONS)[number]

/**
 * What a caller submits. Note what is absent: no `seq` and no `id`. Those are
 * the ledger's to assign, and accepting them would hand sequencing back to the
 * caller this module exists to take it from.
 */
export const incomingEventSchema = z.object({
  kind: z.enum(OBSERVATION_KINDS),
  /** Adapter-assigned. Recorded for gap detection; NEVER used for ordering. */
  sourceSeq: z.number().int().nonnegative().optional(),
  observedAt: z.date(),
  /** Source-supplied, so a 40-minute fixture replays in 400ms and nothing in
   *  here calls Date.now(). */
  elapsedMs: z.number().int().nonnegative(),
  approvedSourceId: z.string().optional(),
  documentId: z.string().optional(),
  /** What Chrome or Propositum itself asserted. Safe to reason over. */
  attested: z.record(z.string(), z.unknown()),
  /** RAW page text. Sanitised and fenced by this module — never pass a
   *  pre-datamarked value. */
  untrustedText: z.string().optional(),
})

export type IncomingEvent = z.infer<typeof incomingEventSchema>

export type AppendResult =
  | { readonly ok: true; readonly id: string; readonly seq: number; readonly adversarial: boolean }
  /**
   * A malformed event is a LEDGER-WRITER fact, not a capture gap. Rendering it
   * as "I stopped seeing your work" would be a false statement to the person
   * about our own software.
   */
  | { readonly ok: false; readonly reason: 'malformed'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'unknown-session' }
  | { readonly ok: false; readonly reason: 'source-not-approved'; readonly detail: string }

export interface GapSignal {
  readonly sessionId: string
  readonly expectedSourceSeq: number
  readonly gotSourceSeq: number
}

export interface LedgerWriter {
  append(sessionId: string, event: unknown): Promise<AppendResult>
  recordGap(input: {
    sessionId: string
    reason: CaptureGapReason
    startedAtElapsedMs: number
    endedAtElapsedMs: number
    observedAt: Date
  }): Promise<AppendResult>
  /** Emitted when an adapter's own sequence skips or goes backwards. The caller
   *  decides what to do; the writer only reports. */
  onGapSignal(listener: (signal: GapSignal) => void): void
}

/** Every key here holds a URL, wherever the event came from. */
const URL_KEYS = ['url', 'referrer'] as const

/**
 * The door sanitises URLs too, not only page text.
 *
 * This used to be true of `untrustedText` and false of `attested`, so a
 * credential or a tracking parameter in `location.href` reached the row
 * verbatim — while `cleanUrl` sat tested and uncalled in the capture layer and
 * `docs/SECURITY_AND_PRIVACY.md` promised a cleaned URL.
 *
 * Doing it here rather than in each caller is the whole point: the extension,
 * the in-app editor and anything added later all come through `append`, so the
 * promise cannot be bypassed by forgetting to call something.
 */
function cleanUrls(attested: Record<string, unknown>): Record<string, unknown> {
  let touched = false
  const out: Record<string, unknown> = { ...attested }

  for (const key of URL_KEYS) {
    const value = out[key]
    if (typeof value !== 'string') continue

    const cleaned = cleanUrl(value)
    if (cleaned !== value) touched = true
    out[key] = cleaned
  }

  return touched ? out : attested
}

export function createLedgerWriter(prisma: PrismaClient): LedgerWriter {
  const listeners: Array<(signal: GapSignal) => void> = []
  const lastSourceSeq = new Map<string, number>()

  /**
   * In-process serialisation. Not belt-and-braces — required.
   *
   * SQLite permits exactly one writer. Firing 25 concurrent `BEGIN IMMEDIATE`
   * transactions at it does not parallelise anything; they queue on the write
   * lock, and with Prisma's 5-second interactive-transaction timeout they
   * start timing out rather than waiting. Measured: 25 concurrent appends
   * exceeded 5s and failed.
   *
   * The extension fires events in bursts, so this is the normal case, not an
   * edge one. Chaining appends through a promise queue makes the contention
   * disappear: each transaction takes an uncontended lock, and the whole burst
   * completes in milliseconds.
   *
   * "Single writer" therefore has to mean serialised, not merely singular.
   */
  let queue: Promise<unknown> = Promise.resolve()

  function serialise<T>(work: () => Promise<T>): Promise<T> {
    // Chain on settle rather than resolve, so one failure cannot wedge the
    // queue for the rest of the session.
    const next = queue.then(work, work)
    queue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  async function write(
    sessionId: string,
    event: IncomingEvent,
    payload: { attested: unknown; untrusted: unknown },
  ): Promise<AppendResult> {
    // BEGIN IMMEDIATE, verified in ADR-0001 — a deferred read-then-write would
    // fail with SQLITE_BUSY_SNAPSHOT, which the busy timeout does not retry.
    // Wrapped in `serialise` so the lock is never contended; see the comment
    // on the queue above.
    return serialise(() => prisma.$transaction(async (tx) => {
      const session = await tx.workSession.findUnique({
        where: { id: sessionId },
        select: { id: true },
      })
      if (!session) return { ok: false, reason: 'unknown-session' } as const

      if (event.approvedSourceId) {
        const source = await tx.approvedSource.findUnique({
          where: { id: event.approvedSourceId },
          select: { grantState: true },
        })
        if (!source || source.grantState !== 'granted') {
          return {
            ok: false,
            reason: 'source-not-approved',
            detail: event.approvedSourceId,
          } as const
        }
      }

      const last = await tx.observationEvent.findFirst({
        where: { sessionId },
        orderBy: { seq: 'desc' },
        select: { seq: true },
      })
      const seq = (last?.seq ?? 0) + 1

      const row = await tx.observationEvent.create({
        data: {
          sessionId,
          seq,
          ...(event.sourceSeq === undefined ? {} : { sourceSeq: event.sourceSeq }),
          observedAt: event.observedAt,
          elapsedMs: event.elapsedMs,
          kind: event.kind,
          ...(event.approvedSourceId === undefined ? {} : { approvedSourceId: event.approvedSourceId }),
          ...(event.documentId === undefined ? {} : { documentId: event.documentId }),
          attested: payload.attested as object,
          ...(payload.untrusted === undefined ? {} : { untrusted: payload.untrusted as object }),
        },
        select: { id: true },
      })

      return {
        ok: true,
        id: row.id,
        seq,
        adversarial:
          typeof payload.untrusted === 'object' &&
          payload.untrusted !== null &&
          (payload.untrusted as { adversarial?: boolean }).adversarial === true,
      } as const
    }))
  }

  return {
    async append(sessionId, raw) {
      const parsed = incomingEventSchema.safeParse(raw)
      if (!parsed.success) {
        return {
          ok: false,
          reason: 'malformed',
          detail: parsed.error.issues
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('; '),
        }
      }

      const event = parsed.data

      if (REQUIRES_SOURCE.has(event.kind) && !event.approvedSourceId) {
        return {
          ok: false,
          reason: 'malformed',
          detail: `kind "${event.kind}" requires approvedSourceId`,
        }
      }

      // Adapter sequence is a health signal only. A skip or a regression means
      // the adapter lost events; it never affects our ordering.
      if (event.sourceSeq !== undefined) {
        const previous = lastSourceSeq.get(sessionId)
        if (previous !== undefined && event.sourceSeq !== previous + 1) {
          const signal: GapSignal = {
            sessionId,
            expectedSourceSeq: previous + 1,
            gotSourceSeq: event.sourceSeq,
          }
          for (const listener of listeners) listener(signal)
        }
        lastSourceSeq.set(sessionId, event.sourceSeq)
      }

      // The one door, and it sanitises.
      const marked = event.untrustedText === undefined ? undefined : datamark(event.untrustedText)

      return write(sessionId, event, {
        attested: cleanUrls(event.attested),
        untrusted:
          marked === undefined
            ? undefined
            : {
                text: marked.sanitized,
                removed: marked.removed,
                adversarial: looksAdversarial(marked),
              },
      })
    },

    recordGap({ sessionId, reason, startedAtElapsedMs, endedAtElapsedMs, observedAt }) {
      return write(
        sessionId,
        {
          kind: 'captureGap',
          observedAt,
          elapsedMs: endedAtElapsedMs,
          attested: {},
        },
        {
          attested: { reason, startedAtElapsedMs, endedAtElapsedMs },
          untrusted: undefined,
        },
      )
    },

    onGapSignal(listener) {
      listeners.push(listener)
    },
  }
}
