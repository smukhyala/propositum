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
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
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
      },
      now,
    )
  }

  return NextResponse.json({ ok: true, held: store.size() })
}
