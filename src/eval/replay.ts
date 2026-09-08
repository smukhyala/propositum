/**
 * A recorded stream, and what it should have produced. ADR-0037.
 *
 * ── Why a stream is JSONL and a scenario is a TypeScript module ──────────
 *
 * `scenario.ts` argues that an eval scenario must be TypeScript: page text has
 * to be constructed through `datamark()`, whose brand cannot survive
 * serialisation. **A stream carries no page text at all** — an `ExternalEvent`
 * has no field one could go in, deliberately (ADR-0034) — so the argument does
 * not reach here, and JSONL buys the thing it is good at: a week of events that
 * a person can read, diff and hand to somebody else.
 *
 * ── Deterministic, because the times are supplied ────────────────────────
 *
 * Every event carries `elapsedMs` from the stream's own origin, so a fixture
 * spanning days replays in milliseconds and twice in a row gives the same
 * answer. Nothing in the fold reads a clock; `now` arrives as a parameter, for
 * the reason `src/domain/**` may never call one.
 *
 * ── The must-not list is the half that matters ───────────────────────────
 *
 * A fixture that only asserts what should appear cannot catch the expensive
 * failure. Principle 13's standing guard is an afternoon of ordinary reading
 * that must NOT qualify, and `expectSilence` generalises it: every stream names
 * what it must stay quiet about, and `tests/replay.test.ts` refuses a stream
 * whose list is empty.
 */

import { z } from 'zod'
import type { Candidate } from '../domain/detection/order-candidates'
import { orderCandidates, stillWorthSaying } from '../domain/detection/order-candidates'

/**
 * One line of a stream.
 *
 * The first two are a person's acts, replayed — a project comes into being and
 * somebody states what they are waiting on. Only `arrived` is an
 * `ExternalEvent`, which is why it is the only member carrying `elapsedMs`.
 */
export const replayLineSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('project'),
    /** Stable within the stream, and the key every later line refers to. Never
     *  a database id: a fixture cannot know one. */
    name: z.string().min(1),
  }),
  z.object({
    type: z.literal('intention'),
    project: z.string().min(1),
    objective: z.string().min(1),
    definitionOfDone: z.string().min(1),
    /** What the person said they are waiting on. Absent means they said
     *  nothing, which is a stream about a project with no wait. */
    statedWait: z.string().min(1).optional(),
  }),
  z.object({
    /** A person re-states or takes back a wait, part-way through. The line that
     *  makes the discharge bound testable: an arrival before this cannot answer
     *  the wait stated after it. */
    type: z.literal('wait'),
    project: z.string().min(1),
    /** Absent takes the wait back, which only a person may do. */
    statedWait: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('arrived'),
    project: z.string().min(1),
    /** From the stream's origin, never a wall clock. */
    elapsedMs: z.number().int().nonnegative(),
  }),
])

export type ReplayLine = z.infer<typeof replayLineSchema>

export const replayStreamSchema = z.object({
  name: z.string().min(1),
  /** Why this stream exists — what it is trying to catch. */
  rationale: z.string().min(1),
  lines: z.array(replayLineSchema).min(1),
  /** Projects a correct replay should surface, in order. */
  expectSurfaced: z.array(z.string()),
  /**
   * Projects it must NOT surface, and why each.
   *
   * Non-empty by rule — see the module docblock. A stream with nothing it must
   * stay quiet about is not measuring restraint.
   */
  expectSilence: z.array(z.object({ project: z.string().min(1), because: z.string().min(1) })),
})

export type ReplayStream = z.infer<typeof replayStreamSchema>

export type ParseResult =
  | { readonly ok: true; readonly stream: ReplayStream }
  | { readonly ok: false; readonly detail: string }

/**
 * Parse a stream file: a JSON header line, then one JSON object per line.
 *
 * Failures are values here for the reason they are values everywhere else in
 * this repository — a thrown parse error out of a CLI is a stack trace where a
 * sentence about line 14 belongs.
 */
export function parseStream(text: string): ParseResult {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))

  const header = lines[0]
  if (header === undefined) return { ok: false, detail: 'the stream is empty' }

  let head: unknown
  try {
    head = JSON.parse(header)
  } catch {
    return { ok: false, detail: 'line 1 is not JSON, and it has to be the header' }
  }

  const body: unknown[] = []
  for (const [index, line] of lines.slice(1).entries()) {
    try {
      body.push(JSON.parse(line))
    } catch {
      return { ok: false, detail: `line ${index + 2} is not JSON` }
    }
  }

  const parsed = replayStreamSchema.safeParse({ ...(head as object), lines: body })
  if (!parsed.success) return { ok: false, detail: parsed.error.message }
  return { ok: true, stream: parsed.data }
}

/** What one project looked like after the stream ran. */
export interface ReplayedProject {
  readonly project: string
  readonly statedWait: string | null
  /** `elapsedMs` of the discharging arrival, or null if none arrived after the
   *  wait was stated. */
  readonly arrivedAtElapsedMs: number | null
}

/**
 * The fold: replayed projects to ordered candidates.
 *
 * Pure and clockless. `originEpochMs` is what `elapsedMs` is relative to, and
 * both arrive from the caller so a lived stream and a replayed one are the same
 * input to everything downstream.
 *
 * **Only a discharged wait becomes a candidate.** An open one does not, which is
 * ADR-0036 as built and is argued there: an open wait carries no decision and
 * has no way to leave the list.
 */
export function candidatesFrom(
  projects: readonly ReplayedProject[],
  originEpochMs: number,
): Candidate[] {
  const candidates: Candidate[] = []

  for (const project of projects) {
    if (project.statedWait === null) continue
    if (project.arrivedAtElapsedMs === null) continue

    candidates.push({
      kind: 'discharged-wait',
      intentionId: project.project,
      statedWait: project.statedWait,
      arrivedAtEpochMs: originEpochMs + project.arrivedAtElapsedMs,
    })
  }

  // An arrival stops being news after a week, exactly as it does on the front
  // door. A stream that spans months must not report a candidate the product
  // would have stopped showing.
  const latest = Math.max(
    originEpochMs,
    ...candidates.map((c) => (c.kind === 'discharged-wait' ? c.arrivedAtEpochMs : originEpochMs)),
  )
  return orderCandidates(candidates.filter((c) => stillWorthSaying(c, latest)))
}
