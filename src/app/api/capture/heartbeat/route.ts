/**
 * Liveness.
 *
 * The MV3 service worker cannot report its own death, so silence is the signal.
 * This route records that the extension is still there; `detectGap` turns a
 * long enough silence into a `captureGap` with reason
 * `service_worker_terminated`.
 */

import { NextResponse } from 'next/server'
import { admit } from '@/capture/transport'
import { captureStore, expectedOrigin } from '@/server/capture-store'

export async function POST(request: Request) {
  const store = captureStore()
  const live = store.current()
  if (!live) return NextResponse.json({ ok: false, reason: 'no-session' }, { status: 409 })

  const body = await request.json().catch(() => null)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const admission = admit(
    { headers, body: { events: [], ...(body as object) } },
    { expectedOrigin: expectedOrigin(), sessionToken: live.token, sessionId: live.sessionId },
  )
  if (!admission.ok) {
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  store.heartbeat(Date.now())
  store.closeGap()

  return NextResponse.json({ ok: true })
}
