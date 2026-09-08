/**
 * The single path an ExternalEvent enters by.
 *
 * ── Why this is a second file and not a second method ────────────────────
 *
 * `ledger-writer.ts` owns two tables already — `observation_event` and
 * `action_evidence` — so a third method there would have been the smaller diff.
 * It is not this one, and the reason is the sentence that file exists to make
 * true: it is *"the module that datamarks"*, and `tests/reachability.test.ts`
 * pins `observationEvent.create` at one caller because *"a second caller would
 * be a second path by which raw text could reach SQLite"*.
 *
 * Nothing here datamarks, because nothing here may carry page-authored text —
 * see `attested` below. Keeping the two writers in two files is what stops that
 * asymmetry becoming an argument somebody has to remember; a reader who opens
 * this file does not find the untrusted door beside it. ADR-0034.
 *
 * ── What this module does NOT do ─────────────────────────────────────────
 *
 * It does not observe anything. Both permitted sources are assertions — a
 * person, or a fixture — and there is no member for a thing that watches
 * something and writes rows on its own schedule. It never reads the clock: like
 * the observation ledger, `occurredAt` and `elapsedMs` are supplied, so a
 * week-long fixture replays in a second and a replayed week and a lived one are
 * the same input.
 *
 * It also does not write, edit, or create an `Intention`. `intentionId` points
 * at one; nothing here touches the row it points at (ADR-0011, unchanged).
 */

import { z } from 'zod'
import type { PrismaClient } from '@prisma/client'

/**
 * Closed and code-owned. **Neither member is a sensor, and that is the whole
 * guard.**
 *
 * A third member is not configuration and not a row: it is the decision
 * ADR-0034's first *Revisit when* names, and it carries a permission argument
 * this set does not. `tests/external-ledger.test.ts` asserts the length so that
 * adding one goes red rather than passing quietly.
 */
export const EXTERNAL_EVENT_STATED_BY = ['declared', 'replay'] as const
export type ExternalEventStatedBy = (typeof EXTERNAL_EVENT_STATED_BY)[number]

/**
 * Closed and code-owned, with one member.
 *
 * One is the honest size of what two non-sensor sources can state, not a
 * placeholder for a richer set — `THREAD_PROVIDERS` holds one provider on the
 * same terms. There is no `other`.
 *
 * **A deadline passing is deliberately absent.** It is a stated date and a
 * clock, derivable at read time, and writing it would be Propositum recording
 * its own arithmetic as an observation — the direction ADR-0033 warned about in
 * its closing paragraph.
 */
export const EXTERNAL_EVENT_KINDS = ['arrived'] as const
export type ExternalEventKind = (typeof EXTERNAL_EVENT_KINDS)[number]

/**
 * What a caller submits. Note what is absent: no `seq` and no `id`, for the
 * reason `incomingEventSchema` gives — those are the ledger's to assign, and
 * accepting them would hand sequencing back to the caller this module exists to
 * take it from.
 *
 * Note also what has no field: there is nowhere to put page-authored text. That
 * is absence rather than a rule, which is the heuristic `AGENTS.md` states —
 * *"There is no field for it" beats "must not"*.
 */
export const incomingExternalEventSchema = z.object({
  statedBy: z.enum(EXTERNAL_EVENT_STATED_BY),
  kind: z.enum(EXTERNAL_EVENT_KINDS),
  occurredAt: z.date(),
  /** Source-supplied, never `Date.now()`. Relative to the first event of the
   *  stream that wrote it; zero for `declared`, where there is no stream. */
  elapsedMs: z.number().int().nonnegative(),
  /** Which Intention this bears on. Set by the hand that stated the event. */
  intentionId: z.string().optional(),
  /** Only what Propositum itself recorded. NOT the browser-attested sense the
   *  observation ledger uses — nothing attests either source here. */
  attested: z.record(z.string(), z.unknown()),
})

export type IncomingExternalEvent = z.infer<typeof incomingExternalEventSchema>

export type AppendExternalResult =
  | { readonly ok: true; readonly id: string; readonly seq: number }
  /** A malformed event is a writer fact, not an absence of knowledge. It is not
   *  a `CaptureGap` and must never be rendered as one. */
  | { readonly ok: false; readonly reason: 'malformed'; readonly detail: string }
  /**
   * The mirror of `unknown-session` on the observation path, and it exists for
   * the same reason: without it a bad `intentionId` becomes a raw foreign-key
   * exception thrown out of the writer, which a route turns into a 500 that a
   * caller cannot tell apart from the database being down.
   */
  | { readonly ok: false; readonly reason: 'unknown-intention'; readonly detail: string }

export interface ExternalWriter {
  append(event: unknown): Promise<AppendExternalResult>
}

export function createExternalWriter(prisma: PrismaClient): ExternalWriter {
  /**
   * In-process serialisation, for `createLedgerWriter`'s reason rather than out
   * of symmetry: SQLite permits exactly one writer, and concurrent
   * `BEGIN IMMEDIATE` transactions queue on the write lock until Prisma's
   * five-second interactive timeout starts failing them.
   *
   * It matters more here than there. `seq` on this table is **global** rather
   * than per session, so every append contends with every other one — there is
   * no session key to spread the contention across.
   */
  let queue: Promise<unknown> = Promise.resolve()

  function serialise<T>(work: () => Promise<T>): Promise<T> {
    // Chain on settle rather than resolve, so one failure cannot wedge the
    // queue for everything behind it.
    const next = queue.then(work, work)
    queue = next.catch(() => undefined)
    return next
  }

  return {
    async append(raw) {
      const parsed = incomingExternalEventSchema.safeParse(raw)
      if (!parsed.success) {
        return { ok: false, reason: 'malformed', detail: parsed.error.message } as const
      }
      const event = parsed.data

      return serialise(async () =>
        prisma.$transaction(async (tx) => {
          if (event.intentionId !== undefined) {
            const intention = await tx.intention.findUnique({
              where: { id: event.intentionId },
              select: { id: true },
            })
            if (!intention) {
              return { ok: false, reason: 'unknown-intention', detail: event.intentionId } as const
            }
          }

          // Gapless by construction, and read inside the transaction so two
          // appends cannot agree on the same number.
          const last = await tx.externalEvent.findFirst({
            orderBy: { seq: 'desc' },
            select: { seq: true },
          })
          const seq = (last?.seq ?? 0) + 1

          const row = await tx.externalEvent.create({
            data: {
              seq,
              statedBy: event.statedBy,
              kind: event.kind,
              occurredAt: event.occurredAt,
              elapsedMs: event.elapsedMs,
              ...(event.intentionId === undefined ? {} : { intentionId: event.intentionId }),
              attested: event.attested as object,
            },
            select: { id: true },
          })

          return { ok: true, id: row.id, seq } as const
        }),
      )
    },
  }
}
