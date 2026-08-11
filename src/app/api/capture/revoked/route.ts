/**
 * Chrome withdrew a host grant, and the extension is telling us.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `ApprovedSource.grantState` is a cached mirror of a Chrome permission, and
 * nothing ever wrote `'revoked'` — only `'granted'` was ever set. So the
 * withdrawn state five UI surfaces render was unreachable, and a `captureGap`
 * with reason `permission_revoked` could not occur.
 *
 * ── What a missed call costs ─────────────────────────────────────────────
 *
 * Nothing dangerous. Chrome is authoritative, and a stale `granted` leaks no
 * data, because the extension is structurally incapable of reading an origin it
 * has no permission for — the content script is unregistered before this
 * request is made. What is lost is only the app's ability to SAY so. That is
 * why this fails quietly rather than retrying: the honest report degrades, the
 * privacy guarantee does not.
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
    { headers, body: { events: [], ...(body as object) } },
    { expectedOrigin: expectedOrigin(), sessionToken: live.token, sessionId: live.sessionId },
  )
  if (!admission.ok) {
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const origin = (body as { origin?: unknown } | null)?.origin
  if (typeof origin !== 'string' || origin.trim() === '') {
    return NextResponse.json({ ok: false, reason: 'no-origin' }, { status: 400 })
  }

  const { repos } = await appContext()
  const session = await repos.sessions.byId(live.sessionId)
  if (!session) return NextResponse.json({ ok: false, reason: 'no-session' }, { status: 409 })

  const revoked = await repos.projects.revokeSource({
    projectId: session.projectId,
    originPattern: origin,
  })

  return NextResponse.json({ ok: true, revoked })
}
