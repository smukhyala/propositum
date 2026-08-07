/**
 * Session control.
 *
 * Starting a session is the explicit act the whole model rests on — capture is
 * off until it happens, and only a human act ends it.
 *
 * The response carries the bearer token the extension will present on every
 * subsequent request. It is issued once, held in the extension's session
 * storage, and never persisted server-side: a restart should re-establish a
 * session rather than silently resume one with a stale credential.
 */

import { NextResponse } from 'next/server'
import { appContext } from '@/server/db'
import { captureStore } from '@/server/capture-store'

export async function POST(request: Request) {
  const { projectId } = (await request.json()) as { projectId?: string }
  if (!projectId) return NextResponse.json({ ok: false, reason: 'projectId required' }, { status: 400 })

  const { repos } = await appContext()
  const session = await repos.sessions.start(projectId)
  const live = captureStore().start(session.id, Date.now())
  const sources = await repos.projects.approvedSources(projectId)

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    token: live.token,
    sources: sources
      .filter((s) => s.grantState === 'granted')
      .map((s) => ({ id: s.id, origin: s.originPattern.replace(/\/\*$/, ''), label: s.label })),
  })
}

export async function DELETE(request: Request) {
  const { sessionId } = (await request.json()) as { sessionId?: string }
  if (!sessionId) return NextResponse.json({ ok: false, reason: 'sessionId required' }, { status: 400 })

  const { repos } = await appContext()
  await repos.sessions.end(sessionId, new Date())
  captureStore().end()

  return NextResponse.json({ ok: true })
}
