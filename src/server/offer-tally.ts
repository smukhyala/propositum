/**
 * How loud Propositum has been, counted without recording what about.
 *
 * ── What this exists to close ────────────────────────────────────────────
 *
 * `docs/PRODUCT_PRINCIPLES.md` §13's own honest limit: *"the other half is
 * enforced by nothing. The grounds threshold is a floor on WHEN Propositum may
 * offer, not a ceiling on how often it may speak, and there is no metric
 * anywhere that would catch an offer rate creeping upward."* The offer bar was
 * lowered twice in two days — `DEEP_READ_MS` from 90s to 60s, and a fourth
 * investment ground — and nothing in the repository would have shown whether
 * either was right.
 *
 * `docs/research/intent-suggestion-quality.md` §10.5 names the fix, and names
 * it as three numbers *"all derivable from data the system already has, and none
 * requiring a model"*: offers shown per hour of observed browsing, decline rate,
 * and strands detected but not shown. This file writes the raw counts;
 * `src/eval/offer-rate.ts` turns them into those three and says what they are
 * not.
 *
 * The decision, with the price named and the open question left open, is
 * `docs/adr/0015-measuring-loudness-and-saving-an-afternoon.md` (2026-08-18).
 * `docs/SECURITY_AND_PRIVACY.md` carries the user-facing half — what this table
 * holds, what it cannot hold, and the fact that nothing in the product deletes
 * it.
 *
 * ── A count is not a profile, and a count with a subject attached is ──────
 *
 * ADR-0008 makes the ambient buffer non-durable on purpose, and
 * `src/server/ambient-store.ts` states why in one sentence: *"a durable row
 * saying 'Propositum thought you were job-hunting' about an offer NOBODY
 * ACCEPTED is exactly the profile this buffer refuses to become."*
 *
 * Nothing here may become that, and the test the design has to pass is the
 * sentence itself. *"Four offers were shown in the last hour of observed
 * browsing"* names no work, no site and no subject; the refused row names one in
 * its first six words. So: **no terms, no signature, no origin, no title, no
 * URL, no id of anything reaches this file's sink.** What crosses from the
 * buffer is a boolean — *is this strand new?* — and what is written is an
 * integer. `prisma/schema.prisma`'s `OfferTally` has no column a subject could
 * be put in, which is what makes this structural rather than a promise, and
 * `tests/eval.test.ts` asserts the column list rather than trusting it.
 *
 * The one thing genuinely newly held is the day bucket, and the schema's
 * docblock argues it rather than waving it past: a lifetime total cannot show a
 * rate creeping upward, a trend needs buckets, and a day is the coarsest bucket
 * that can show one.
 *
 * ── Every count is best-effort, and losing one is the correct failure ─────
 *
 * A counter may never cost a person an observation, a suggestion or a page
 * render. Every write here is fire-and-forget and every failure is swallowed:
 * the ambient endpoint keeps its shape of touching no database on the request
 * path, the 30-second poll keeps its shape of answering before it opens one, and
 * a `--report` that is missing four counts is still a better instrument than the
 * nothing it replaces.
 */

import { existingAppContext } from './db'
import type { OfferTallyDelta } from '../persistence/repositories/index'

export type { OfferTallyDelta }

/**
 * The LOCAL calendar day of an instant, as `YYYY-MM-DD`.
 *
 * Local rather than UTC, and it is not an arbitrary pick: the question is
 * whether a person's browsing produced more offers this week than last, and for
 * anyone west of Greenwich a UTC bucket cuts their evening in half and files it
 * under tomorrow. The cost is that a database carried across time zones has two
 * days meeting in the middle, which is a wrong answer of a few minutes at a
 * boundary rather than a systematically wrong one every night.
 *
 * Built from the local getters rather than `toISOString`, which is UTC by
 * definition and is the mistake this comment exists to stop someone making
 * back. `padStart` rather than arithmetic, because a one-digit month sorting
 * before a two-digit one would silently break `all()`'s ordering.
 */
export function dayBucket(nowMs: number): string {
  const at = new Date(nowMs)
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/**
 * Add to today's counts, and never make anybody wait for it.
 *
 * Deliberately returns `void` rather than a promise. A caller that could
 * `await` this would eventually be a caller that does, and the two call sites
 * that matter most are the ones whose whole shape is *do not touch the database
 * here*: the ambient endpoint, which holds the request open while the extension
 * flushes, and the poll, whose own comment says it *"returns before touching the
 * database at all when nothing is detected"*. A void function cannot be awaited
 * by accident.
 *
 * The `catch` is empty on purpose and it is the honest behaviour rather than
 * laziness. What can fail here is a missing database, a startup guard check, or
 * two writes racing to create the same day's row. None of those is worth a 500
 * on a capture endpoint, and none of them is worth a log line on a path that
 * runs every thirty seconds forever — a counter that fills a console is a
 * counter somebody turns off.
 *
 * ── It writes to a database somebody else opened, and opens none ─────────
 *
 * *(Corrected 2026-08-18, the day it landed, after review.)* ~~This called
 * `appContext()`, which builds a handle if none exists.~~ In a `vitest` worker
 * that built one from `.env`, which is the developer's real `propositum.db`, so
 * `npx vitest run tests/multiple-threads.test.ts` — a file with no interest in
 * counters at all — wrote three shown and two declined into it, and doubled
 * them on a second run. `npm run eval -- --report` then reported a 67% decline
 * rate that no person had produced, displacing the *"nothing counted yet"* that
 * `src/eval/offer-rate.ts` is careful to keep distinct from zero. A measurement
 * fabricated by its own test suite is worse than an absent one.
 *
 * `existingAppContext()` returns the handle only if something else already
 * built one, so this function cannot be the reason a database is opened. See
 * its docblock in `src/server/db.ts` for why the alternative — passing `repos`
 * in from each call site — fails on the two sites whose whole shape is *touch
 * no database here*, and for the one count that is lost in exchange.
 */
export function countQuietly(delta: OfferTallyDelta, nowMs: number): void {
  const context = existingAppContext()
  if (context === undefined) return

  const day = dayBucket(nowMs)

  void context
    .then((ctx) => ctx.repos.offerTally.add(day, delta))
    .catch(() => {
      /* A lost count. See above: never a lost observation, offer or render. */
    })
}
