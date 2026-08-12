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
 * ── The run id, which the poll deliberately does not hand out ────────────
 *
 * `GET /api/act/next` returns an intent and nothing else, so the extension
 * cannot learn a run id from the channel. It has to be told one when the tab is
 * opened and the attachment is made — the same moment it is told which tab it
 * may drive. That is a real coupling between this route and whoever opens the
 * tab, and it is written down here because the alternative reading — that the
 * extension can derive it — is false and would produce a halt nobody can send.
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
  const stopped = actStore().halt(runId, `the browser was detached: ${reason}`)

  const { repos } = await appContext()

  // Settling the socket is only half of stopping. The row is still `queued`, and
  // a queued row nobody is waiting for is precisely the instruction a later poll
  // would hand to a browser after the person pressed Stop. `abandon` refuses a
  // delivered row, so this can only ever discard something that never left.
  for (const dispatchId of stopped) await repos.dispatches.abandon(dispatchId)

  const flagged = await repos.runs.requestCancel(runId)

  return NextResponse.json({ ok: true, settled: stopped.length, flagged })
}
