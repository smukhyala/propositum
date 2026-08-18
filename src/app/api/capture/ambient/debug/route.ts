/**
 * What is actually in the ambient buffer, right now.
 *
 * Detection thresholds were set before any real browsing existed, and the first
 * contact with real browsing produced a suggestion about a video call. Tuning
 * against a buffer nobody can see is how that happens twice.
 *
 * Read-only, and it shows exactly what the detector sees — no more. If page
 * text ever appeared here it would mean the ambient path had started carrying
 * some, which is the thing three other places exist to prevent.
 *
 * ── This shipped with no guard at all, and that was a real hole ──────────
 *
 * Every other capture route runs `admit()` or `fromOurExtension()` before it
 * does anything. This one ran neither, and answered `GET` to anybody. The
 * ambient buffer is the whole of what Propositum saw while nobody asked it to
 * watch — the exact thing ADR-0008 argues must never be durable or reachable —
 * so ANY PAGE IN THE BROWSER could `fetch('http://127.0.0.1:3117/api/capture/
 * ambient/debug')` and read back half an hour of somebody's browsing: every
 * origin, every page count, and up to eight page titles each. A simple GET with
 * no custom header is CORS-safelisted, so the request was delivered and
 * executed; the response was withheld from the page only by the same-origin
 * policy, which is one `<img>`-shaped trick away from not being a defence at
 * all, and is no defence whatsoever against a local process or an extension.
 *
 * ── Transport controls, not an environment flag ──────────────────────────
 *
 * Both were on the table. The controls win, for two reasons.
 *
 * The first is that a flag defaulting to off means the person who needs this
 * discovers it AFTER the browsing they wanted to explain has already aged out
 * of the buffer's thirty-minute window. This endpoint exists to answer "why did
 * it offer me that" while the answer still exists, and a switch you must have
 * flipped in advance cannot answer it.
 *
 * The second is that the controls are enforced by the browser rather than by
 * remembering. The custom header forces a CORS preflight this app deliberately
 * never satisfies, so a page's request is never delivered — and `Sec-Fetch-Site`
 * is a forbidden header name, so no script can forge the `none` that a
 * browser-privileged caller sends. That is the same argument the write path
 * already rests on, made once, in `src/capture/transport.ts`.
 *
 * There is no per-session bearer token here because there is no session — this
 * route exists precisely when none is running — and no content-type check
 * because a GET has no body. Two of the four controls apply and both are
 * applied.
 *
 * ── Debugging it by hand ─────────────────────────────────────────────────
 *
 * A terminal is not a page, so this is one command:
 *
 *     curl -H 'x-propositum-capture: 1' -H 'sec-fetch-site: none' \
 *          http://127.0.0.1:3117/api/capture/ambient/debug
 *
 * `sec-fetch-site` is forbidden to scripts and free to curl, which is the whole
 * distinction this endpoint needed and did not have.
 *
 * ── What the summary alone could not say, 2026-08-18 ─────────────────────
 *
 * Three signals landed on the ambient path this week — `scrollFraction`,
 * `exitType` and `arrival` — and this response carried none of them. It is the
 * only window into the buffer, so all three were invisible in a live session:
 * nobody could look at their own afternoon and judge whether a signal was worth
 * consuming, which is the first thing anyone would want to do before deciding.
 * Worse, `tests/topics.test.ts`:46 records the only real-session fixture in the
 * repo as *"Verbatim from `/api/capture/ambient/debug`"* — copied out of this
 * response by hand — so a fixture built the way fixtures are built here
 * STRUCTURALLY could not contain them.
 *
 * ── Per observation, verbatim, rather than rolled up per origin ──────────
 *
 * Both shapes were on the table. The rollup loses precisely the thing all three
 * signals are for.
 *
 *   - **Two of them mean nothing apart from the dwell on the SAME page.**
 *     Claypool et al. (IUI 2001) measured time, scroll, and *the combination*
 *     as what correlated with stated interest; every Fox et al. (TOIS 2005)
 *     decision-tree node is dwell AND exit type. A mean scroll fraction across
 *     an origin is a number about no page at all, and the commonest exit type
 *     on a host says nothing about the one page that was read for a minute.
 *   - **`arrival` is a per-navigation fact whose whole content is "was this
 *     page chosen".** Answering it per site answers a question nobody asked.
 *   - **A fixture cut from a projection cannot reproduce a bug in the
 *     projection.** This response is now the input to a real capture path —
 *     `src/fixtures/afternoon.ts` — and a summary would have made every
 *     afternoon saved through it unable to test the summary.
 *
 * So the rows go out as they sit in the buffer. The per-origin block stays
 * above them unchanged, because that half is what a person actually reads in a
 * terminal, and it is cheap. `MAX_OBSERVATIONS` bounds the array at 500 rows,
 * so the response is large rather than unbounded.
 *
 * ── The rows are emitted WHOLE, and that is the load-bearing choice ──────
 *
 * `observations` is the array itself, not a projection of it. Every drift this
 * change exists to correct was a hand-built projection: `flushAmbient` copies
 * the wire shape field by field and dropped `scrollFraction` for the whole
 * build while three comments said it was captured, and the per-origin block
 * below is a second one that dropped all three. **A serialisation that names no
 * field cannot drop one.**
 *
 * It cannot drop one and it also cannot refuse one, which is the cost and on a
 * privacy-sensitive endpoint it is a real cost: a field added to
 * `AmbientObservation` tomorrow appears in this response without anybody
 * deciding it should. That is held by a test rather than by care —
 * `tests/afternoon-capture.test.ts` asserts the emitted key set is exactly what
 * `AmbientObservation` declares, so a new field and a dropped field are each
 * one red test.
 *
 * One consequence worth stating rather than leaving to be found: **this file
 * deliberately does not name the three fields anywhere.**
 * `tests/reachability.test.ts` budgets every mention of them in production code
 * to an exact count per file, and this commit changes no budget — which is the
 * honest signal that nothing here reads them. Emitting is not consuming. No
 * threshold moved, no ground was added, and `detectsWork` answers exactly what
 * it answered yesterday.
 *
 * ── What this hands over that it did not, said plainly ───────────────────
 *
 * More. The guard section above lists what a caller could read back before:
 * every origin, every page count, and up to eight page titles each. It is now
 * the buffer — every cleaned URL, every title, per-page dwell, and the three
 * signals. That is a genuine widening of one guarded response, and it is the
 * same widening as *"it shows exactly what the detector sees"*, which is the
 * sentence at the top of this file and was always the intent. What makes it
 * acceptable is unchanged and is not weakened here: two headers a page cannot
 * send, so a `curl` is the only caller that gets any of it. Nothing new is
 * COLLECTED — every field above was already in the buffer, put there by a
 * schema that argues for it one route up.
 */

import { NextResponse } from 'next/server'

import { CUSTOM_HEADER, fromOurExtension } from '@/capture/transport'
import { detectPause, detectWork, threadPagesOf } from '@/domain/detection/detect'
import { groundsFor } from '@/domain/detection/grounds'
import { ambientStore, expectedOrigin } from '@/server/capture-store'

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
    return NextResponse.json({ ok: false, reason: 'bad-origin' }, { status: 403 })
  }

  const store = ambientStore()
  const now = Date.now()
  const observations = store.since(now)

  const byOrigin = new Map<string, { pages: Set<string>; engagedMs: number; titles: string[] }>()
  for (const o of observations) {
    const entry = byOrigin.get(o.origin) ?? { pages: new Set<string>(), engagedMs: 0, titles: [] }
    entry.pages.add(o.url)
    if (o.engagedMs !== undefined) entry.engagedMs = Math.max(entry.engagedMs, o.engagedMs)
    if (o.title && !entry.titles.includes(o.title)) entry.titles.push(o.title)
    byOrigin.set(o.origin, entry)
  }

  const detected = detectWork(observations, now)

  return NextResponse.json({
    held: observations.length,
    /**
     * The clock the two detections below were computed against.
     *
     * Not decoration. `detectWork`, `detectPause` and `threadPagesOf` all
     * window the buffer against a `now` they are handed, so replaying these
     * rows tomorrow with tomorrow's clock drops every one of them and answers
     * `null` — and the answer would look like a detector that had changed its
     * mind rather than a fixture read at the wrong time. Saving the clock
     * beside the rows is what makes a capture replayable at all; see
     * `replayAfternoon` in `src/fixtures/afternoon.ts`, which reads this field
     * and never `Date.now()`.
     */
    now,
    origins: [...byOrigin]
      .map(([origin, e]) => ({
        origin,
        pages: e.pages.size,
        engagedMinutes: Math.round(e.engagedMs / 60_000),
        titles: e.titles.slice(0, 8),
      }))
      .sort((a, b) => b.engagedMinutes - a.engagedMinutes),
    detectsWork: detected,
    detectsPause: detectPause(observations, now),
    // The second bar, shown beside the first. "It detected work but did not
    // offer" is otherwise indistinguishable from "it detected nothing", and
    // those have completely different fixes.
    grounds:
      detected === null
        ? null
        : groundsFor(detected, threadPagesOf(observations, detected, now)),
    /**
     * The buffer, whole, oldest first — and LAST in the body on purpose.
     *
     * A person running the `curl` above is reading a terminal, and the summary
     * they want is four lines. Five hundred rows in front of it would bury the
     * answer to *"why did it offer me that"*, which is the question this
     * endpoint exists for. A person cutting a fixture pipes the whole thing to
     * a file and does not care where the array sits.
     *
     * Emitted as the array rather than mapped over. The docblock at the top of
     * this file argues why at length; the short version is that every field
     * this change exists to restore was lost by a hand-written projection, and
     * this response is not going to be the third one.
     */
    observations,
  })
}
