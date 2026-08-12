/**
 * The browser is gone, and this is the extension saying so afterwards.
 *
 * ── The detach has already happened by the time this arrives ─────────────
 *
 * ADR-0010 gives the person three ways to stop it, and requires that stopping
 * never needs the app: Chrome's own infobar, an in-tab chip, and Stop in the
 * app. The extension detaches FIRST and reports second, so stopping works with
 * the app closed, the dev server restarting, or the machine offline. A stop that
 * has to reach a server before it takes effect is not a stop.
 *
 * This route therefore records something already true. It does two things, and
 * neither of them stops anything by itself:
 *
 *   1. Settles every held dispatch for the run with `control-lost`, so a worker
 *      blocked on a report is told now rather than in twenty seconds. That is
 *      the difference between "I lost the browser" and a run that appears to
 *      hang.
 *   2. Flags the run. `cancelRequested` is a flag, not a kill — the run reads it
 *      at its next action boundary and halts itself. Nothing here interrupts
 *      anything, which is the only way to stop cleanly when the thing being
 *      stopped may be mid-navigation in a real browser.
 *
 * ── Why an unknown run is still a success ────────────────────────────────
 *
 * A halt for a run that already ended, or never existed, gets `ok: true` with
 * `flagged: false`. The person's stop must not appear to fail because the thing
 * they stopped had already stopped — and an extension that retries a halt it
 * believes failed is an extension hammering this route while its tab is closed.
 */

import { NextResponse } from 'next/server'

import { admitControl, haltRequestSchema } from '@/act/channel'
import { actStore } from '@/server/act-store'
import { appContext } from '@/server/db'
import { expectedOrigin } from '@/server/capture-store'

export async function POST(request: Request) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const body: unknown = await request.json().catch(() => null)

  const admission = admitControl(
    { headers, body },
    { from: 'extension', expectedOrigin: expectedOrigin() },
    { kind: 'json', schema: haltRequestSchema },
  )

  if (!admission.ok) {
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const { runId, reason } = admission.body

  // The reason is extension-authored prose. It travels into a `detail` string
  // for a log and reaches no prompt and no report — the person is shown
  // `control-lost`, which is code-assigned, and the sentence they read is
  // written by us.
  const settled = actStore().halt(runId, `the browser was detached: ${reason}`)

  const { repos } = await appContext()
  const flagged = await repos.runs.requestCancel(runId)

  return NextResponse.json({ ok: true, settled, flagged })
}
