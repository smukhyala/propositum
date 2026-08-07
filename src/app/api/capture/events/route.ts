/**
 * Where captured events arrive.
 *
 * Two things this route must never do:
 *
 *   1. Trust the request. `admit()` applies all four transport controls; CORS
 *      is not one of them, because `text/plain` is CORS-safelisted and a forged
 *      POST would otherwise be delivered and executed.
 *   2. Write through a repository. Events go through the LEDGER WRITER, which
 *      is the only thing that keeps `seq` gapless under concurrent bursts.
 */

import { NextResponse } from 'next/server'
import { admit } from '@/capture/transport'
import { appContext } from '@/server/db'
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
    { headers, body },
    { expectedOrigin: expectedOrigin(), sessionToken: live.token, sessionId: live.sessionId },
  )

  if (!admission.ok) {
    // 403 with the reason. The reason is useful in a log and tells an attacker
    // only which of four controls they failed, which they could determine by
    // trying anyway.
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const { ledger } = await appContext()
  const now = Date.now()

  // A heartbeat is implied by events arriving. Close any open gap first, so a
  // burst after a silence is recorded on the near side of it.
  store.heartbeat(now)
  store.closeGap()

  const results = []
  for (const raw of admission.events) {
    const event = raw as Record<string, unknown>
    results.push(
      await ledger.append(live.sessionId, {
        ...event,
        // The extension sends ISO strings; the writer's schema wants a Date.
        observedAt: typeof event['observedAt'] === 'string' ? new Date(event['observedAt']) : event['observedAt'],
      }),
    )
  }

  const accepted = results.filter((r) => r.ok).length
  const adversarial = results.some((r) => r.ok && r.adversarial)

  return NextResponse.json({
    ok: true,
    accepted,
    rejected: results.length - accepted,
    // Surfaced so the panel can warn without waiting for the reading.
    adversarial,
  })
}
