/**
 * Where observations arrive when no session is running.
 *
 * ── Deliberately not the ledger ──────────────────────────────────────────
 *
 * This route does NOT go through the ledger writer, and that is the point.
 * `ObservationEvent` means "part of the record of a session", and a session is
 * something a human started. Writing ambient observations there would make the
 * ledger mean "everything Propositum ever saw", which is a different product
 * and a worse promise.
 *
 * So these land in an in-memory buffer that dies with the process, holds
 * metadata only, and is discarded unless the person accepts the offer it
 * produces. See `src/server/ambient-store.ts`.
 *
 * ── Guarded the same way, minus the token ────────────────────────────────
 *
 * There is no session, so there is no per-session bearer token to present. The
 * other three controls all still apply — `application/json`, the custom header,
 * and proof the request was not page-initiated. Losing the token is why this
 * route accepts only metadata and can only ever fill a buffer that is thrown
 * away: the blast radius of a forged ambient observation is a suggestion the
 * person declines.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { CUSTOM_HEADER, REQUIRED_CONTENT_TYPE, fromOurExtension } from '@/capture/transport'
import { cleanUrl } from '@/capture/url'
import { ambientStore, captureStore, expectedOrigin } from '@/server/capture-store'
import { countQuietly } from '@/server/offer-tally'

/**
 * What the extension may send. There is no field for page text, and adding one
 * would be a change to the privacy promise rather than to a schema.
 *
 * ── `scrollFraction`, added 2026-08-17 ───────────────────────────────────
 *
 * It is metadata about how far down a page somebody got. It carries no page
 * content, names nothing on the page, and widens the privacy promise by not one
 * word — which is why it is a schema change and not an ADR. What it corrects is
 * the opposite kind of drift: `content.js` has computed and sent this on every
 * engagement report for as long as the report has existed, THIS SCHEMA had no
 * field for it, and `docs/adr/0008-ambient-detection.md` plus two comments in
 * `src/domain/detection/detect.ts` all said ambient capture carried "dwell and
 * scroll". Three true-sounding sentences over a field that was dropped on
 * arrival.
 *
 * **Bounded, and bounded to the same numbers as the session path.** A fraction
 * is `[0, 1]`; `rawSignalSchema` in `src/server/capture-adapter.ts` already says
 * so with `z.number().min(0).max(1)`, and a second definition of the same word
 * is how two paths start disagreeing about one page. Not `.int()`, obviously,
 * and not `.nonnegative()` alone — an unbounded "fraction" is the field a
 * hostile or buggy sender puts `1e9` in, and `engagedByUrl`-shaped code that
 * takes a maximum would then hold that number for the life of the window.
 *
 * **Optional, exactly as `engagedMs` is.** Only an engagement report has one.
 * A navigation, a query and an `away` have nothing to say about scrolling, and
 * an absent field must mean absent rather than zero — zero is a real reading
 * ("they did not scroll"), and conflating the two would put a page nobody
 * scrolled and a page nobody measured into the same bucket.
 *
 * **A bad value refuses the batch rather than being silently repaired.** Same
 * as every other field here: a clamp would let a sender establish a value the
 * schema says is impossible, and a drop would make one malformed row invisible.
 * The service worker's 4xx handling drops a refused batch instead of retrying
 * it, which is the behaviour that keeps a bad field from becoming a wedge.
 *
 * ── `exitType` and `groupTitle`, added 2026-08-17 (ADR-0013) ─────────────
 *
 * **`exitType` — how the page was left.** `docs/research/intent-suggestion-quality.md`
 * §2.1 quotes Fox et al. (TOIS 2005): dwell and exit type together recover 66%
 * against 70% for all nineteen implicit signals they measured. Propositum has
 * had one of the two since the beginning. This is the other.
 *
 * A `z.enum` and not a `z.string()`, and that is the load-bearing part. The set
 * is closed in `extension/src/content.js`'s `EXIT_TYPES` and closed again here,
 * and the two must not drift — the same arrangement `looksLikeSearch` and
 * `searchQueryOf` are held in by `tests/search-url.test.ts`, for the same
 * reason: a capture-layer vocabulary with one author cannot be widened from the
 * browser. A fourth value invented in the extension is refused at this door
 * rather than arriving as a string nothing downstream has a case for.
 *
 * What each value means, and what it does NOT mean, is argued at length beside
 * `EXIT_TYPES`. The short version, because it bounds what may ever be built on
 * this: **`left-unloaded` is four events** — navigated onward, closed the tab,
 * quit the browser, reloaded — and a content script cannot tell them apart
 * without `tabs`, `webNavigation` or `history`, all three of which this product
 * refuses. ~~Nothing reads the field yet; `tests/reachability.test.ts` holds that
 * as a deferred assertion, and the reason is written there.~~
 *
 * **Re-marked 2026-08-20 (ADR-0018): the field is read, and the deferred
 * assertion no longer exists.** `heldOpenUnread` in
 * `src/domain/detection/grounds.ts` is `scrollFraction === 0 && exitType ===
 * 'hidden'` — a page nobody scrolled that was switched away from is not a read —
 * and it vetoes pages inside `readAround`, `deepestRead` and `comparedOptions`,
 * all three of which decide whether an offer is made. The pin that used to hold
 * this went red in the wave that wired it and was deleted; `detect.ts` was
 * re-marked on the day and this door was not.
 *
 * **`groupTitle` — the label a person typed for their own group of tabs.** It
 * is the one field on this route that is neither derived from a URL nor written
 * by a page: a human wrote it, about their own work. `docs/research/intent-signals.md`
 * §4.3 is the argument for wanting it, and the reason it is bounded here at 120
 * rather than 300 is that it is a label rather than a document — see
 * `AMBIENT_GROUP_TITLE_MAX` in the service worker, which bounds it again on the
 * way out so the sender stays the stricter of the two.
 *
 * **It is untrusted text and it is treated as such.** A tab group title is
 * page-adjacent in exactly the way a page title is — anybody can be induced to
 * type anything — so it may never reach a prompt unmarked, may never reach
 * `compilePolicy` or any gate, and may never widen an offer. Today it is
 * structurally incapable of doing any of those: the only thing that reads it is
 * `describeWork`'s sentence in `src/server/ambient-store.ts`, the model
 * boundaries name their inputs field by field and do not name this one, and
 * `tests/reachability.test.ts` pins that containment rather than trusting it.
 * The day something wants to put it in a prompt, `datamark` is the door, on the
 * same terms as `detected.titles`.
 *
 * ── `arrival`, added 2026-08-18 ──────────────────────────────────────────
 *
 * **How the person got to the page, and deliberately not the page they came
 * from.** `extension/src/content.js` has sent `referrer` and `navigationType`
 * on every navigation for as long as the signal has existed, and
 * `src/capture/semantics.ts` consumes both — on the SESSION path, where its own
 * comment calls the referrer *"our partial substitute for transitionType, which
 * lives behind `webNavigation`"*. Detection runs on this path, and this path
 * dropped them: `flushAmbient` never copied them and this schema had no field
 * for them. The same shape as `scrollFraction` above, found one day later.
 *
 * **This field is strictly less than the session path already carries, and that
 * is the design rather than an accident of scope.** A referrer is the URL of a
 * page somebody came FROM. It may name a site nothing else here observes and
 * nobody approved. The ledger may hold one because a session is consented,
 * scoped to approved sources and auditable row by row; this buffer is what
 * Propositum saw while nobody asked, so it gets the classification and never
 * the URL. The classification is computed in the content script — see
 * `ARRIVALS` there. ~~and the URL it was computed from does not leave the
 * page.~~ **Corrected 2026-08-18:** it leaves the page on every navigation,
 * because the content script cannot know whether a session is running and the
 * session path needs it; the extension's service worker deletes it on the
 * no-session branch before anything is buffered. What this route can say for
 * itself is the part that binds here — **there is no field on this schema a
 * referrer could arrive in**, so a sender that tried would have it stripped by
 * the parse below, and `flushAmbient` does not try.
 *
 * **A `z.enum`, for exactly the reason `exitType` is one.** Five values, closed
 * in `ARRIVALS`, closed again here, and declared as `Arrival` in
 * `src/domain/detection/detect.ts`. Three authors, one set, and the vocabulary
 * cannot be widened from the browser: a sixth value invented in the extension
 * is refused at this door rather than arriving as a string nothing downstream
 * has a case for.
 *
 * **Optional, and absent means absent.** Only a navigation or a query has one;
 * an engagement report and an `away` have nothing to say about how a page was
 * reached. It is also absent for a navigation this product declines to
 * classify — a `prerender` entry, a referrer that will not parse — and an
 * absent field must not be read as any of the five.
 *
 * **What it is worth, and where it is weak, because the weakness is the reason
 * nothing reads it.** `grounds.ts` is built on the distinction *did they pursue
 * this, or receive it?*, and today the only evidence of pursuit is a search.
 * Arrival is direct evidence of the same thing. It is also weakest precisely
 * where that file most wants it: a link whose page suppressed its referrer
 * arrives as `no-referrer` and reads as somebody typing an address, and
 * newsletters and mail clients are among the things that suppress referrers.
 * `tests/reachability.test.ts` holds the deferral and names what would justify
 * lifting it.
 *
 * **A schema change and not an ADR, on the precedent `scrollFraction` set two
 * fields up.** It costs no permission, changes no manifest entry, carries no
 * page content, and names nothing on the page. What it does do — and this is
 * the part that would have deserved an ADR had it gone the other way — is
 * decline to carry a URL the session path already carries. Widening the ambient
 * buffer to hold referrers WOULD be an ADR; narrowing a signal to five words on
 * the way in is the schema doing its job. `docs/SECURITY_AND_PRIVACY.md` gains
 * the row, because that is the document a person reads.
 */
const ambientSchema = z.object({
  observations: z
    .array(
      z.object({
        at: z.number().int().nonnegative(),
        url: z.string(),
        title: z.string().max(300),
        kind: z.enum(['navigation', 'query', 'engagement', 'away']),
        engagedMs: z.number().int().nonnegative().optional(),
        scrollFraction: z.number().min(0).max(1).optional(),
        exitType: z.enum(['hidden', 'left-cached', 'left-unloaded']).optional(),
        arrival: z
          .enum(['no-referrer', 'same-origin', 'cross-origin', 'reloaded', 'back-or-forward'])
          .optional(),
        groupTitle: z.string().max(120).optional(),
      }),
    )
    .max(100),
})

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.startsWith(REQUIRED_CONTENT_TYPE)) {
    return NextResponse.json({ ok: false, reason: 'bad-content-type' }, { status: 403 })
  }
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, await expectedOrigin())) {
    return NextResponse.json({ ok: false, reason: 'bad-origin' }, { status: 403 })
  }

  // A session is running, so these belong in the ledger, not here. The
  // extension should have stopped sending them; say so rather than quietly
  // double-recording the same browsing in two places.
  if (captureStore().current() !== null) {
    return NextResponse.json({ ok: false, reason: 'session-running' }, { status: 409 })
  }

  const body = await request.json().catch(() => null)
  const parsed = ambientSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'malformed' }, { status: 400 })
  }

  const store = ambientStore()
  const now = Date.now()

  /**
   * How many rows this batch actually put in the buffer, which is not how many
   * arrived. See the observed-minute count below for why the difference is the
   * whole point of counting it.
   */
  let recorded = 0

  for (const raw of parsed.data.observations) {
    // Cleaned here as well as at the ledger door. This buffer never reaches the
    // ledger, so it would otherwise be the one place a credential in a URL
    // could sit unstripped.
    const url = cleanUrl(raw.url)
    let origin: string
    try {
      origin = new URL(url).origin
    } catch {
      continue // Not a URL we can attribute. Drop it rather than guess.
    }

    store.record(
      {
        at: raw.at,
        origin,
        url,
        title: raw.title,
        kind: raw.kind,
        ...(raw.engagedMs === undefined ? {} : { engagedMs: raw.engagedMs }),
        // Spread the same way `engagedMs` is, and for the same reason: under
        // `exactOptionalPropertyTypes` an explicit `undefined` is not the same
        // as an absent key, and `AmbientObservation` means absent.
        ...(raw.scrollFraction === undefined ? {} : { scrollFraction: raw.scrollFraction }),
        ...(raw.exitType === undefined ? {} : { exitType: raw.exitType }),
        // Spread on the same terms as the two above. Nothing is derived from it
        // here and nothing may be: the classification arrives already made, and
        // the value it was made from — a referrer URL — is not on this request
        // and must never be added to it.
        ...(raw.arrival === undefined ? {} : { arrival: raw.arrival }),
        // Trimmed here as well as at the sender. A title of spaces is not a
        // label somebody authored, and `describeWork` would render it as one —
        // "You have been looking into  ." — which is worse than the term list
        // it would have displaced.
        ...(raw.groupTitle === undefined || raw.groupTitle.trim() === ''
          ? {}
          : { groupTitle: raw.groupTitle.trim() }),
      },
      now,
    )
    recorded += 1
  }

  /**
   * One minute of observed browsing, counted at most once.
   *
   * ── The denominator, and why it is measured here ─────────────────────
   *
   * `docs/research/intent-suggestion-quality.md` §10.5 asks for *offers shown
   * per hour of observed browsing*, and the second half is the half that gets
   * dropped: four offers is restraint across a day and a pathology across ten
   * minutes. This route is the only place that knows watching happened at all.
   *
   * **What it actually measures, stated exactly.** Minutes in which the
   * extension had something to report while no session was running — a visible
   * tab reporting every fifteen seconds, flushed every thirty. Not minutes the
   * person was at the keyboard, and not minutes they were reading: a person
   * staring at one page reports the same as a person walking through ten. It
   * is a measure of how much watching there was, which is exactly what an
   * offer rate needs to be divided by.
   *
   * ── And what it is not ───────────────────────────────────────────────
   *
   * It is one integer per day in `offer_tally` and it names nothing. No URL, no
   * origin, no title, no term — this loop has all four in hand and passes none
   * of them on. A count of minutes cannot say what any of them was about, which
   * is the line ADR-0008 draws and the reason a tally is allowed to be durable
   * where the buffer it counts is not.
   *
   * The store answers *is this minute new* and holds one number to do it; the
   * response is not made to wait for the write, and a lost count is the correct
   * failure here — see `countQuietly`.
   *
   * ── `recorded`, not `observations.length`, 2026-08-18 ────────────────
   *
   * *(Corrected the day this landed, after review.)* ~~The guard was
   * `parsed.data.observations.length > 0` — what the extension SENT.~~ That is
   * the wrong quantity and it rounds in the one direction this measurement may
   * not round in. A batch whose rows all fall out of the loop above — every URL
   * unparseable, so every one hits `continue` — observed nothing, and still
   * counted a full minute of *"observed browsing"*. Proved against the real
   * route: two unparseable URLs returned `{"ok":true,"held":0}`, meaning the
   * buffer kept nothing, beside `observedMinutes: 1`.
   *
   * A minute of watching that was not watching inflates the denominator, which
   * LOWERS the reported offer rate — quieting the alarm this whole measurement
   * exists to raise. `newlyObservedMinute`'s own docblock says the same
   * sentence about a double-counted minute; this is the same error arriving
   * through the numerator's door instead.
   *
   * `recorded > 0 &&` short-circuits, so a batch that recorded nothing does not
   * even mark the minute as counted — the next batch in the same minute that
   * does record something still gets it.
   */
  if (recorded > 0 && store.newlyObservedMinute(now)) {
    countQuietly({ observedMinutes: 1 }, now)
  }

  return NextResponse.json({ ok: true, held: store.size() })
}
