/**
 * An afternoon of somebody's browsing, saved on purpose, and replayable.
 *
 * ── The practice this replaces ───────────────────────────────────────────
 *
 * `tests/topics.test.ts`:46 says *"Verbatim from `/api/capture/ambient/debug`
 * on 2026-08-11."* That is the only fixture in this repo built from real
 * browsing, and it was made by a person reading a JSON response on a terminal
 * and retyping it as `ThreadPage` literals. Two things follow from that, and
 * both of them bit:
 *
 *   - **It goes through a display projection twice** — once in the endpoint,
 *     once in the hand — so it can only contain what the summary chose to show.
 *     `scrollFraction`, `exitType` and `arrival` were all absent from that
 *     summary, so no fixture made this way could contain them however carefully
 *     it was typed. That is a structural limit, not carelessness.
 *   - **A hand-copy is a summary of a summary.** `docs/PRODUCT_PRINCIPLES.md`
 *     §13 records what that costs: a pinned fixture written at three pages,
 *     one per site, standing in for a session its own docstring recorded as
 *     twelve pages across three sites — and the missing nine were the ones that
 *     made `read-around` fire. The fixture was smaller than the session it
 *     claimed to be, and a whole day's reasoning was done against the smaller
 *     one.
 *
 * So: the endpoint now emits the rows whole, and this module is the other end
 * of that. A capture is the response body written to a file, unedited. Nothing
 * between the buffer and the file has an opinion.
 *
 * ── This file IS a profile, and that is the honest word for it ───────────
 *
 * `docs/adr/0008-ambient-detection.md` makes the ambient buffer non-durable on
 * purpose: *"a durable row saying 'Propositum thought you were job-hunting'
 * about an offer NOBODY ACCEPTED is exactly the profile this buffer refuses to
 * become."* A captured afternoon is that row and about four hundred of its
 * friends — every URL, every title, how long each page held somebody, how far
 * down they got, how they left, how they arrived, and the subject Propositum
 * decided it was all about.
 *
 * Nothing here contradicts ADR-0008, because ADR-0008 is a constraint on what
 * the PRODUCT keeps, and this is a person choosing to write their own browsing
 * to a file in their own repository. Those are different acts. The distinction
 * is only worth anything if the second one stays deliberate, so:
 *
 * *(That argument now lives in
 * `docs/adr/0015-measuring-loudness-and-saving-an-afternoon.md`, added
 * 2026-08-18 after review, rather than only here. ADR-0008's *Revisit when*
 * says in as many words that writing ambient observations to disk *"needs its
 * own ADR"* — and a docblock is exactly the location that trigger exists to
 * move the reasoning out of. The list below stands; the decision it belongs to
 * is now written down somewhere a person reads before touching this path.)*
 *
 *   - the capture is one command, run by hand, that refuses to run without a
 *     terminal attached and without the fixture's name typed back — see
 *     `capture-afternoon.ts`, which argues each guard and names what it does
 *     not stop;
 *   - nothing in the product reads this directory. Its only consumers are
 *     tests. A capture cannot be triggered by the app, by the worker, by a
 *     poll, or by anything on a timer, because no code path in any of them
 *     mentions this module;
 *   - and a saved afternoon does not expire, which the buffer does. Thirty
 *     minutes becomes forever the moment it lands on disk. Committing one is
 *     publishing it to everybody who can read the repository. That sentence is
 *     printed by the capture command, before and after it writes.
 *
 * ── What the replay proves, and what it does not ─────────────────────────
 *
 * `replayAfternoon` re-runs `detectWork`, `detectPause` and `groundsFor` over
 * the saved rows at the saved clock, and the round-trip test compares that
 * against the answers the live buffer gave at capture time. Passing means the
 * capture is complete enough to reproduce the decision — that nothing the
 * detector reads was lost on the way to the file.
 *
 * It does NOT prove the fixture is representative, that the answer was right,
 * or that a signal absent from a capture is absent from real browsing. It is a
 * recording of one afternoon. `src/fixtures/hostile-session.ts` makes the same
 * distinction about itself in its own words and for the same reason.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { detectPause, detectWork, threadPagesOf } from '../domain/detection/detect'
import type { AmbientObservation, PauseDetected, WorkDetected } from '../domain/detection/detect'
import { groundsFor } from '../domain/detection/grounds'
import type { OfferGrounds } from '../domain/detection/grounds'

/** Where a captured afternoon lands. One directory, so `ls` is the index. */
export const AFTERNOONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'afternoons')

/**
 * The four kinds, listed once here and checked against the type below.
 *
 * A fourth copy of a closed vocabulary — `detect.ts` declares it, the ambient
 * route repeats it as a `z.enum`, `content.js` has its own — and copies drift.
 * `EVERY_KIND_IS_LISTED` is a compile-time proof that this one has not: it is
 * typed `true` only while nothing in `AmbientObservation['kind']` is missing
 * from the array, so adding a fifth kind and forgetting this line fails
 * `tsc --noEmit` rather than silently letting a row through unvalidated.
 */
const KINDS = ['navigation', 'query', 'engagement', 'away'] as const satisfies readonly AmbientObservation['kind'][]

export const EVERY_KIND_IS_LISTED: [Exclude<AmbientObservation['kind'], (typeof KINDS)[number]>] extends [never]
  ? true
  : false = true

/**
 * What a captured afternoon file holds.
 *
 * This is the debug endpoint's response body, and the file on disk is that body
 * verbatim with one key added — see `note`. The fields named here are the ones
 * a replay needs; a file also carries the endpoint's `origins` summary and
 * anything else the response grows, and `parseAfternoon` neither reads nor
 * strips those. **Lossless means the FILE is lossless.** A narrower type in
 * front of it is not a loss, because the file is the artefact and this is a
 * view of it.
 */
export interface CapturedAfternoon {
  /**
   * Why this afternoon was saved, typed by the person who saved it.
   *
   * The one key the capture command adds to the response body, and it is
   * required rather than optional. A fixture nobody can date or explain is the
   * fixture that gets believed about the wrong session — §13 again. It also
   * has to be the place a synthesised afternoon says so out loud, because a
   * file in this directory otherwise reads as a recording of somebody's real
   * browsing whatever it actually is.
   */
  readonly note: string
  /**
   * The clock the recorded answers were computed at.
   *
   * Every detector here windows against a `now` it is handed, so a replay must
   * use this and never the current time. A capture replayed at `Date.now()`
   * a day later holds nothing inside `WINDOW_MS` and answers `null` — which
   * reads exactly like a detector that stopped working.
   */
  readonly now: number
  readonly held: number
  /** The buffer, whole and in order. What `detectWork` was actually given. */
  readonly observations: readonly AmbientObservation[]
  /** What the live buffer answered, frozen. The thing a replay is compared to. */
  readonly detectsWork: WorkDetected | null
  readonly detectsPause: PauseDetected | null
  readonly grounds: OfferGrounds | null
}

/** What a replay answers. The same three questions, in the same order the
 *  endpoint asks them. */
export interface ReplayedAfternoon {
  readonly detectsWork: WorkDetected | null
  readonly detectsPause: PauseDetected | null
  readonly grounds: OfferGrounds | null
}

/**
 * The saved rows, put back through the detector at the saved clock.
 *
 * Deliberately the same three calls the debug route makes, in the same shape,
 * including `threadPagesOf` rebuilding the thread's pages rather than a caller
 * passing a set in. A replay that reconstructed the grounds by some other route
 * would be testing a second implementation and calling the agreement a
 * round trip.
 *
 * No clock is read here, for the same reason `groundsFor` reads none: the point
 * is that this function's answer depends on nothing but the file.
 */
export function replayAfternoon(afternoon: CapturedAfternoon): ReplayedAfternoon {
  const { observations, now } = afternoon
  const detectsWork = detectWork(observations, now)

  return {
    detectsWork,
    detectsPause: detectPause(observations, now),
    grounds:
      detectsWork === null
        ? null
        : groundsFor(detectsWork, threadPagesOf(observations, detectsWork, now)),
  }
}

/** A parse that refuses rather than repairs. `from` names the file, because a
 *  message about "an afternoon" is useless when there are six of them. */
function refuse(from: string, why: string): never {
  throw new Error(`${from} is not a captured afternoon: ${why}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read a capture, checking the parts a replay depends on.
 *
 * ── What is checked, and the line it stops at ────────────────────────────
 *
 * The envelope and every observation's five required fields. Not the optional
 * metadata, and not the recorded answers beyond their outermost shape.
 *
 * That line is drawn where it is on purpose. This input is a file in the
 * reader's own repository, written by a command they ran — not a request from
 * a browser — so the failure this guards against is a truncated download or a
 * hand-edit, not an attacker. A full re-validation would mean a fifth
 * declaration of the ambient vocabulary living here, and the drift between four
 * copies is already a thing three files have to argue about.
 *
 * What that gives up, said rather than discovered: a capture whose
 * `scrollFraction` has been hand-edited to the string `"0.4"` loads without
 * complaint. It cannot change a detection, because nothing reads that field —
 * and if that ever stops being true, this comment is wrong and the check has to
 * grow. `tests/afternoon-capture.test.ts` pins the round trip, which is the
 * property that would actually break.
 */
export function parseAfternoon(text: string, from: string): CapturedAfternoon {
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error) {
    refuse(from, `it is not JSON (${String(error)})`)
  }

  if (!isObject(body)) refuse(from, 'the top level is not an object')
  if (typeof body.note !== 'string' || body.note.trim() === '') {
    refuse(from, 'it has no `note` saying what it is — see CapturedAfternoon.note')
  }
  if (typeof body.now !== 'number' || !Number.isFinite(body.now)) {
    refuse(from, 'it has no `now`, so there is no clock to replay it at')
  }
  if (typeof body.held !== 'number') refuse(from, '`held` is not a number')
  if (!Array.isArray(body.observations)) refuse(from, '`observations` is not an array')

  // Non-vacuous at the source, the same way `ambientObservationFields` is: an
  // empty array would satisfy every per-row check below and replay to `null`,
  // and a test comparing `null` to `null` is a round trip about nothing.
  if (body.observations.length === 0) {
    refuse(from, 'it holds no observations — an empty capture replays to nothing and proves nothing')
  }

  for (const [index, row] of body.observations.entries()) {
    const where = `observations[${index}]`
    if (!isObject(row)) refuse(from, `${where} is not an object`)
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) refuse(from, `${where}.at is not a number`)
    if (typeof row.origin !== 'string') refuse(from, `${where}.origin is not a string`)
    if (typeof row.url !== 'string') refuse(from, `${where}.url is not a string`)
    if (typeof row.title !== 'string') refuse(from, `${where}.title is not a string`)
    if (!(KINDS as readonly string[]).includes(row.kind as string)) {
      refuse(from, `${where}.kind is ${JSON.stringify(row.kind)}, which is not one of ${KINDS.join(', ')}`)
    }
  }

  if (body.detectsWork !== null && !isObject(body.detectsWork)) {
    refuse(from, '`detectsWork` is neither null nor an object')
  }
  if (body.detectsPause !== null && !isObject(body.detectsPause)) {
    refuse(from, '`detectsPause` is neither null nor an object')
  }
  if (body.grounds !== null && !isObject(body.grounds)) {
    refuse(from, '`grounds` is neither null nor an object')
  }

  // The cast is the honest end of the checks above, and it is why the block
  // comment says where they stop. Everything the replay reaches for has been
  // checked; the optional metadata rides along untouched, which is the whole
  // point of a lossless capture.
  return body as unknown as CapturedAfternoon
}

/** One saved afternoon, by the name it was saved under. */
export function loadAfternoon(name: string): CapturedAfternoon {
  const file = join(AFTERNOONS_DIR, `${name}.json`)
  return parseAfternoon(readFileSync(file, 'utf8'), file)
}
