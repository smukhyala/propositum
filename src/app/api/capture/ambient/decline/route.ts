/**
 * "Not now."
 *
 * Declining does two things, and the second one matters more than it looks:
 * it snoozes the origin, AND it drops the observations that produced the
 * suggestion. Without the second, the next poll sees the same evidence and
 * offers again the moment the snooze expires — which is how a well-meaning
 * prompt becomes a thing people mute.
 *
 * There is deliberately no record of the decline beyond an in-memory timestamp.
 * "Propositum remembers that you said no to this site" is a fact about the
 * person, and this feature is already asking for enough trust without keeping
 * one.
 */

import { NextResponse } from 'next/server'

import { CUSTOM_HEADER, REQUIRED_CONTENT_TYPE, fromOurExtension } from '@/capture/transport'
import { ambientStore, expectedOrigin } from '@/server/capture-store'

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

  const body = (await request.json().catch(() => null)) as { origin?: unknown } | null
  const origin = typeof body?.origin === 'string' ? body.origin : ''
  if (origin === '') {
    return NextResponse.json({ ok: false, reason: 'no-origin' }, { status: 400 })
  }

  ambientStore().decline(origin, Date.now())

  return NextResponse.json({ ok: true })
}
