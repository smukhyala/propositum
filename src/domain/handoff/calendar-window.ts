/**
 * How long is the gap before the next thing they have to be at?
 *
 * ── The one question this file exists to answer, and the one it refuses ──
 *
 * `detectPause` can tell that somebody left. It finds an `away` observation and
 * stops there, because nothing in a browser knows whether that person went to
 * make coffee or went to a two-hour review. Budget is the one autonomy dial
 * denominated in time, and *"a local worker stops when your Mac sleeps"* is
 * already the honest limit on it — so the dial is set by a person guessing.
 *
 * Google Calendar's free/busy answers exactly that question and nothing else:
 * a list of `{ start, end }` pairs, no titles, no attendees, no descriptions.
 * The arithmetic over those pairs is here, and it is arithmetic — no model, no
 * clock, no network, no import from anything above the domain.
 *
 * **What it refuses.** It returns a NUMBER OF MINUTES and a member of a closed
 * set, and it decides nothing. `compilePolicy` cannot receive any of it, no
 * gate reads it, and no caller may write it into `AutonomyControls`. A calendar
 * is not deterministic code authorising something; it is a second person's
 * meeting invitation, which is to say it is data about the person that arrived
 * from outside and gets exactly as much authority as page text does — none.
 * [ADR-0014](../../../docs/adr/0014-reading-free-busy.md) opens on that cost.
 *
 * ── `now` is a parameter, always ─────────────────────────────────────────
 *
 * Every function here takes `now` in epoch milliseconds. Nothing under
 * `src/domain/**` may read the clock — `tests/architecture.test.ts` greps the
 * source text for both ways of doing it, which is why this paragraph describes
 * them rather than spelling them, since a docblock that names the pattern fails
 * the guard that reads it. The rule bites harder here than almost anywhere else
 * in the domain: a free/busy answer is entirely a statement about time, so a
 * function that read the clock itself would produce a different suggestion on
 * every render of the same screen and no test could pin any of them.
 */

/**
 * One interval Google says the person is busy in.
 *
 * Two timestamps. That is the whole of what `freebusy.query` returns per entry
 * — *"List of time ranges during which this calendar should be regarded as
 * busy"* — and it is the whole of what this type is allowed to grow. A field
 * for a title, a summary, an organiser or an event id here would mean the read
 * path had asked for a scope it must not ask for, and the guard in
 * `tests/calendar-scope.test.ts` is the thing that says so out loud.
 *
 * Epoch milliseconds rather than RFC 3339 strings, because the domain does
 * arithmetic and string dates are a clock in disguise: comparing them means
 * parsing them, and parsing them means a timezone, and a timezone is a fact
 * about the machine rather than about the interval.
 */
export interface BusyInterval {
  readonly startMs: number
  readonly endMs: number
}

/**
 * What the calendar says about the stretch of time starting now.
 *
 * A closed three-member union, and the two members that are NOT `until` are the
 * interesting ones, because both of them mean *say nothing*:
 *
 *  - `clear` — nothing busy between now and the horizon. This is the state a
 *    free afternoon produces and it is deliberately not *"suggest the maximum"*.
 *    An empty calendar is not evidence that somebody has four hours; it is
 *    evidence that they did not write anything down, which is the ordinary case
 *    for most people most of the time.
 *  - `busy-now` — an interval already covers `now`. The person is in the thing.
 *    The gap before the next commitment is zero, and there is nothing here that
 *    could honestly bound a budget. Note what this deliberately does not do:
 *    it does not read the CURRENT interval's `end` and suggest working until
 *    then. That number is real, but it answers *"when does this meeting
 *    finish"* rather than *"how long will they be away from the desk"*, and
 *    the two differ by however long it takes to walk back.
 */
export type FreeWindow =
  | { readonly kind: 'clear' }
  | { readonly kind: 'busy-now' }
  | {
      readonly kind: 'until'
      /** Whole minutes from `now` to the start of the next busy interval,
       *  rounded DOWN. Rounding up would produce a suggestion that overruns the
       *  thing it was derived from, which is the one direction this must never
       *  round in. */
      readonly minutes: number
      /** When that interval starts, so a screen can name a clock time rather
       *  than a duration. Never a title — there is none to have. */
      readonly startsAtMs: number
    }

/**
 * The gap between `now` and the next busy interval, inside a bounded horizon.
 *
 * ── Why a horizon at all, when the query already had one ─────────────────
 *
 * The read path asks Google for a bounded window and could simply trust it. It
 * does not, for the reason the ambient buffer is bounded twice: a bound that
 * lives only in the caller is a bound one refactor away from being absent, and
 * the failure is silent — a nine-hour gap would produce a nine-hour suggestion
 * that nothing on the screen would flag as odd.
 *
 * ── The overlap rules, stated because they are where this gets fiddly ────
 *
 * Intervals may overlap, may be zero-length, may arrive unsorted, and may sit
 * entirely in the past — Google guarantees none of those things away. So:
 *
 *  - An interval is IGNORED if it ends at or before `now`. It is over.
 *  - An interval is `busy-now` if it starts at or before `now` and ends after
 *    it. Touching the boundary counts as busy, which is the cautious direction:
 *    a meeting starting exactly now is a meeting.
 *  - Otherwise the answer is the EARLIEST start among the intervals that begin
 *    after `now` and before the horizon. Earliest, not first — the array order
 *    is Google's and is not a promise.
 */
export function freeWindowUntilBusy(
  busy: readonly BusyInterval[],
  now: number,
  horizonMs: number,
): FreeWindow {
  const horizon = now + horizonMs
  let soonest: number | null = null

  for (const interval of busy) {
    // Malformed pairs are dropped rather than repaired. An interval that ends
    // before it starts is not a shorter interval, it is a value nobody can
    // interpret, and guessing which end was wrong is how a suggestion comes to
    // be derived from something that was never in anybody's calendar.
    if (!Number.isFinite(interval.startMs) || !Number.isFinite(interval.endMs)) continue
    if (interval.endMs < interval.startMs) continue

    if (interval.endMs <= now) continue
    if (interval.startMs <= now) return { kind: 'busy-now' }
    if (interval.startMs >= horizon) continue

    if (soonest === null || interval.startMs < soonest) soonest = interval.startMs
  }

  if (soonest === null) return { kind: 'clear' }

  return {
    kind: 'until',
    minutes: Math.floor((soonest - now) / 60_000),
    startsAtMs: soonest,
  }
}

/**
 * The largest offered time limit that fits entirely inside the gap.
 *
 * ── The property that makes this safe, and it is a property of the range ──
 *
 * The returned number is always a MEMBER OF `choices`, or null. `choices` is
 * `TIME_LIMIT_CHOICES` — the same closed set the radio group on the agreement
 * screen offers — so the calendar cannot introduce a value a person could not
 * already have picked with one click. It cannot widen the dial's range, cannot
 * invent a 7-minute budget, and cannot propose 9 hours because somebody's
 * Friday is empty. Clicking the control this feeds is, byte for byte, the same
 * state change as clicking a radio.
 *
 * That is worth more than it sounds. The hard constraint on this whole feature
 * is that free/busy *may never set a limit, never widen one, and never lower
 * one*. Two things hold it: this function's range, and the fact that nothing
 * writes its result into `useState`'s initial value. The second is a sentence
 * somebody has to keep true in a `.tsx` file; the first is a type.
 *
 * ── Fits INSIDE, and never merely near ──────────────────────────────────
 *
 * `choice <= window.minutes`, strictly. A 65-minute gap suggests 60, not 120.
 * The rounding in `freeWindowUntilBusy` already goes down, so a 59-second
 * remainder cannot promote a choice either. The whole point of the number is
 * that the work stops before the person is due somewhere else; a suggestion
 * that overruns is worse than no suggestion, because it carries the authority
 * of having been derived from something.
 *
 * Returns null for `clear`, for `busy-now`, and for a gap shorter than the
 * smallest choice. **Null means the screen says nothing at all** — not a
 * default, not a zero, not a greyed-out control. A person who never connects a
 * calendar and a person whose next meeting is in four minutes see the same
 * screen, and that is deliberate.
 */
export function suggestTimeLimit(
  window: FreeWindow,
  choices: readonly number[],
): number | null {
  if (window.kind !== 'until') return null

  let best: number | null = null
  for (const choice of choices) {
    if (choice > window.minutes) continue
    if (best === null || choice > best) best = choice
  }

  return best
}
