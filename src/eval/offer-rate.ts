/**
 * The three numbers §10.5 says nothing measures.
 *
 * ── What they are, and where they come from ──────────────────────────────
 *
 * `docs/research/intent-suggestion-quality.md` §10.5 answers
 * `docs/PRODUCT_PRINCIPLES.md` §13's honest limit — *"there is no metric
 * anywhere that would catch an offer rate creeping upward"* — with three
 * numbers, and with the shipped products that already track them:
 *
 *   1. **Offers shown per hour of observed browsing.** GitHub's
 *      *completion-shown rate*, which they track as a first-class production
 *      metric alongside acceptance. The denominator is the half that gets left
 *      out, and an offer count without it is unreadable: four offers is
 *      restraint across a day and a pathology across ten minutes.
 *   2. **Decline rate.** How often a person says "Not now" to what was shown.
 *   3. **Strands detected but not shown.** `MAX_THREADS_SHOWN` caps what
 *      appears and recorded nothing about what it cut, which is the failure
 *      ADR-0008 says the multi-strand change existed to remove.
 *
 * ── This file computes; `src/server/offer-tally.ts` counts ───────────────
 *
 * Same split as `score.ts`: arithmetic over rows, in a file that decides nothing
 * it cannot show its working for. `OfferTallyDay` below is structurally
 * satisfied by the repository's type and deliberately not imported from it, for
 * the reason `H2Unit` gives one file over — importing the repository type would
 * pull the module that talks to Prisma into the scoring layer.
 *
 * ── Null is not zero, and that is the whole reporting discipline ─────────
 *
 * `scoreH2` is the model here. A rate of `0.0%` and *nobody has used this
 * product yet* are different claims, they are indistinguishable on the line
 * where somebody reads them, and only one of them is evidence. So every rate is
 * `number | null` and the null case is a sentence rather than a number.
 *
 * ── There is deliberately no pass mark, and that is not an oversight ─────
 *
 * §10.5 offers the closest thing to a calibration anybody has published —
 * Donato et al.'s editors found research missions were **10% of sessions**, and
 * *"if Propositum's offer rate materially exceeds one strand per ten sessions of
 * ordinary browsing, it is firing on something other than research"*. That is
 * per SESSION. This is per HOUR. Converting one into the other needs a mean
 * session length that nothing here measures, and a gate whose threshold was
 * invented to make the conversion work would be worse than no gate: it would
 * make `--report` exit non-zero on a number nobody could defend, and the first
 * response to that is to raise the threshold rather than to look at the product.
 *
 * So these numbers are printed and never scored, and `--report`'s exit code does
 * not change because of them. A human reads the per-day column and asks whether
 * it is going up. That is a weaker instrument than a gate and it is an honest
 * one, and it is strictly more than the nothing that was there before.
 *
 * ── What "shown" means, exactly, because it is generous ──────────────────
 *
 * A strand counts as shown when it is put where a person could see it: rendered
 * on Home, or returned to the poll as the one the badge and the notification
 * name. Not when they looked at it. A Home render nobody read and a notification
 * dismissed unread both count, and that is deliberate — this is a measure of how
 * often the product SPOKE, and something said to somebody who was not listening
 * was still said. GitHub's *completion-shown rate* has exactly the same
 * property.
 */

/** One day's counts. Four integers and a date — the absence of a subject field
 *  is the design, and `prisma/schema.prisma` argues it. */
export interface OfferTallyDay {
  readonly day: string
  readonly observedMinutes: number
  readonly offersShown: number
  readonly offersDeclined: number
  readonly strandsSuppressed: number
}

/** One day, with its own rate. The series is what makes a creep visible; the
 *  totals alone cannot show a change over time. */
export interface OfferRateDay {
  readonly day: string
  readonly observedMinutes: number
  readonly offersShown: number
  readonly offersDeclined: number
  readonly strandsSuppressed: number
  /** Offers per hour of observed browsing, or null when nothing was observed. */
  readonly perObservedHour: number | null
}

export interface OfferRateReport {
  /** Days with any count at all. Zero means nothing has been recorded, which is
   *  the ordinary state until somebody uses the product. */
  readonly days: number
  readonly observedMinutes: number
  readonly offersShown: number
  readonly offersDeclined: number
  /**
   * Strands cut by `MAX_THREADS_SHOWN`.
   *
   * **An undercount, and the direction is worth knowing.** This is counted where
   * the cut is visible, which is Home — the poll returns one strand and cannot
   * say what it did not return. So an afternoon of four strands that nobody
   * opened Home for is four strands, one badged and three unrecorded, and this
   * number stays at zero. It measures suppression a person could have seen,
   * which is the suppression the ADR's argument is about.
   */
  readonly strandsSuppressed: number
  /**
   * Offers shown per hour of observed browsing, over the whole series, or null.
   *
   * Null when no minute of browsing was observed. Deliberately null even if
   * offers were somehow shown in those zero minutes — a rate with an empty
   * denominator is not a large number, it is not a number, and the counts are
   * printed beside it so an impossible pair is visible rather than smoothed.
   */
  readonly perObservedHour: number | null
  /**
   * Declines over offers shown, or null when nothing has been shown.
   *
   * **It can exceed 1, and it is not clamped.** A showing is deduplicated
   * against a marker that dies with the app process; a decline is an act and is
   * counted every time. Restart the app between an offer and the "Not now" that
   * answers it and the numerator has a decline whose showing was counted on a
   * different day, or not at all. A rate over 100% is that happening, and it is
   * more useful visible than rounded down to a plausible number.
   */
  readonly declineRate: number | null
  readonly firstDay: string | null
  readonly lastDay: string | null
  /** The most recent days, oldest first, bounded by `RECENT_DAYS`. */
  readonly recent: readonly OfferRateDay[]
}

/** How many days the report prints individually. Long enough to see a trend,
 *  short enough that nobody scrolls past it. */
export const RECENT_DAYS = 7

/** Minutes to hours, in the one place, so the denominator cannot be divided by
 *  60 in one function and by 3600 in another. */
function perHour(count: number, observedMinutes: number): number | null {
  if (observedMinutes <= 0) return null
  return count / (observedMinutes / 60)
}

export function reportOfferRate(days: readonly OfferTallyDay[]): OfferRateReport {
  let observedMinutes = 0
  let offersShown = 0
  let offersDeclined = 0
  let strandsSuppressed = 0

  for (const day of days) {
    observedMinutes += day.observedMinutes
    offersShown += day.offersShown
    offersDeclined += day.offersDeclined
    strandsSuppressed += day.strandsSuppressed
  }

  // Sorted here rather than trusted from the caller: `all()` orders by day and a
  // second reader of this function should not have to know that.
  const ordered = [...days].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
  const recent = ordered.slice(Math.max(0, ordered.length - RECENT_DAYS)).map((day) => ({
    ...day,
    perObservedHour: perHour(day.offersShown, day.observedMinutes),
  }))

  return {
    days: days.length,
    observedMinutes,
    offersShown,
    offersDeclined,
    strandsSuppressed,
    perObservedHour: perHour(offersShown, observedMinutes),
    // Not `kept / decided` — this is the OTHER rate, and it is deliberately not
    // an acceptance rate. See `OFFER_RATE_CAUTION`.
    declineRate: offersShown <= 0 ? null : offersDeclined / offersShown,
    firstDay: ordered[0]?.day ?? null,
    lastDay: ordered[ordered.length - 1]?.day ?? null,
    recent,
  }
}

/**
 * What these numbers cannot do, printed where they are printed.
 *
 * Not a footnote and not a doc link, because the failure mode is somebody
 * reading a low decline rate as a job well done. GitHub's own words, from §6.3,
 * about the metric they invented and use most:
 *
 * > *"being hyper-focused on a metric like acceptance rate can lead to
 * > experiences that look good on paper, but do not result in happy
 * > developers."*
 *
 * The decline rate below is the same number from the other end, and optimising
 * it is the same mistake: an offer nobody declines may be an offer nobody read.
 * §6.2 is the constructive half — JetBrains got **+~50% acceptance and −~40%
 * cancels by REMOVING suggestions**, with output held flat — so the lever these
 * numbers are for is subtraction, and the number to watch is the first one.
 */
export const OFFER_RATE_CAUTION = [
  'These say how OFTEN Propositum spoke, never whether it was right to. There is',
  'no measure here of whether an offer was any good, and a decline rate is an',
  'acceptance rate turned around — GitHub, who track one in production: "being',
  'hyper-focused on a metric like acceptance rate can lead to experiences that',
  'look good on paper, but do not result in happy developers." The number to',
  'watch is the first one, and the lever the research supports is subtraction.',
] as const
