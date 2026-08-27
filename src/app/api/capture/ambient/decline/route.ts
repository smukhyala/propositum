/**
 * "Not now."
 *
 * Declining does two things, and the second one matters more than it looks:
 * it snoozes the origin, AND it drops the observations that produced the
 * suggestion. Without the second, the next poll sees the same evidence and
 * offers again the moment the snooze expires — which is how a well-meaning
 * prompt becomes a thing people mute.
 *
 * ~~There is deliberately no record of the decline beyond an in-memory
 * timestamp. "Propositum remembers that you said no to this site" is a fact
 * about the person, and this feature is already asking for enough trust without
 * keeping one.~~
 *
 * **Amended 2026-08-18, and the struck sentence is still true of everything it
 * was about.** A count is kept now — the integer 1, added to today's row in
 * `offer_tally`. Nothing about WHICH site, and that is the whole of the
 * distinction: *"Propositum remembers that you said no to this site"* is a fact
 * about the person and remains unrecorded, while *"one offer was declined on the
 * 18th"* is a fact about how loud Propositum was. The origin is in scope on this
 * very line and is not passed on; there is no column in `offer_tally` it could
 * be written to.
 *
 * The reason to keep even that much is `docs/PRODUCT_PRINCIPLES.md` §13's own
 * honest limit — *"there is no metric anywhere that would catch an offer rate
 * creeping upward"* — and `docs/research/intent-suggestion-quality.md` §10.5,
 * which names the decline rate as one of the three numbers that closes it.
 * Declining is the half of that pair a person performs, and a product that
 * refuses to count how often it is turned down has decided not to find out.
 */

import { NextResponse } from 'next/server'

import { CUSTOM_HEADER, REQUIRED_CONTENT_TYPE, fromOurExtension } from '@/capture/transport'
import { ambientStore, expectedOrigin } from '@/server/capture-store'
import { countQuietly } from '@/server/offer-tally'

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

  const body = (await request.json().catch(() => null)) as { origin?: unknown } | null
  const origin = typeof body?.origin === 'string' ? body.origin : ''
  if (origin === '') {
    return NextResponse.json({ ok: false, reason: 'no-origin' }, { status: 400 })
  }

  const now = Date.now()
  ambientStore().decline(origin, now)
  // The integer 1, and not the origin two lines above it. See the amendment in
  // this file's header for why those are different kinds of fact.
  countQuietly({ offersDeclined: 1 }, now)

  return NextResponse.json({ ok: true })
}
