/**
 * What the browser saw, on its way back to the worker that is blocked on it.
 *
 * ── This route stores no evidence, and that is deliberate ────────────────
 *
 * A page tree and a screenshot are `ActionEvidence`, which is the second ledger
 * — bounded by its own published constant, swept, and never joined to a person's
 * own browsing. Writing it HERE would put that decision in the transport, where
 * nothing knows which `ActionIntent` the evidence belongs to or whether the run
 * still holds its claim. The report is handed to the worker, and the worker
 * writes what it keeps.
 *
 * So this route moves a payload and settles a row. Everything page-authored in
 * it — the title, every accessible name in the tree — is untrusted, is carried
 * structurally rather than interpolated, and is never inspected here.
 *
 * ── An unclaimed report is a 409 and not a 500 ───────────────────────────
 *
 * If nobody is waiting, the worker already gave up or the app restarted under
 * it. The extension is told plainly rather than being handed an error it might
 * retry: retrying would not conjure a listener, and the durable row stays
 * `delivered`, which reads as "handed out, fate unknown" — the honest state for
 * an action that ran with nobody left to hear about it.
 */

import { NextResponse } from 'next/server'

import { admitControl, reportOf, reportRequestSchema } from '@/act/channel'
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
    { kind: 'json', schema: reportRequestSchema },
  )

  if (!admission.ok) {
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const store = actStore()
  const { intentId } = admission.body

  // The row is keyed by its own id and the extension only knows the intent, so
  // the mapping comes from the hold. Its absence is exactly the "nobody is
  // waiting" case: there is no listener AND no row id, and inventing a lookup
  // to settle the row anyway would mark it `reported` while the report itself
  // went nowhere.
  const dispatchId = store.dispatchIdFor(intentId)
  if (dispatchId === null) {
    return NextResponse.json({ ok: false, reason: 'nobody-waiting' }, { status: 409 })
  }

  const { repos } = await appContext()

  // `delivered → reported`, guarded the same way the claim is, so a duplicate
  // report cannot settle the row twice. Losing it does not stop the payload
  // reaching the worker: the row is a record of the handover, and the worker
  // being told what happened matters more than the bookkeeping agreeing.
  await repos.dispatches.report({ id: dispatchId, reportedAt: new Date() })

  const delivered = store.settle(intentId, reportOf(admission.body))
  if (!delivered) {
    return NextResponse.json({ ok: false, reason: 'nobody-waiting' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
