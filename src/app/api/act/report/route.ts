/**
 * What the browser saw, on its way back to the worker that is blocked on it.
 *
 * ── Evidence goes through the one door, and this route does not open it ───
 *
 * A page tree and a screenshot are `ActionEvidence`, the second ledger — bounded
 * by `SNAPSHOT_BUDGET_CHARS`, swept, and never joined to a person's own
 * browsing. It is written HERE, but not by this file: `ledger.appendEvidence` is
 * its only writer, because that is the module that datamarks the tree and cleans
 * the URL. A second writer would be a second path by which raw
 * accessibility-tree text could reach SQLite, and it would pass every other test
 * in the suite.
 *
 * The write never fails for size. An oversized tree is truncated, flagged, and
 * stored, so there is no branch here that tells the extension to hold something
 * and try again — which is exactly how the ambient path wedged in wave 2, with a
 * buffer that only cleared on a success that could never come.
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

import { MAX_BODY_BYTES, admitControl, reportOf, reportRequestSchema } from '@/act/channel'
import { actStore } from '@/server/act-store'
import { appContext } from '@/server/db'
import { expectedOrigin } from '@/server/capture-store'

export async function POST(request: Request) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  // Refused before the body is read, because the per-field bounds in the
  // envelope cannot help once `request.json()` has already allocated whatever
  // arrived. A page cannot reach this route at all, but the process's memory
  // should not depend on that being true.
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, reason: 'too-large' }, { status: 413 })
  }

  const body: unknown = await request.json().catch(() => null)

  const admission = admitControl(
    { headers, body },
    { from: 'extension', expectedOrigin: await expectedOrigin() },
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
  const awaited = store.awaited(intentId)
  if (awaited === null) {
    return NextResponse.json({ ok: false, reason: 'nobody-waiting' }, { status: 409 })
  }

  const { ledger, repos } = await appContext()

  // `delivered → reported`, guarded the same way the claim is, so a duplicate
  // report cannot settle the row twice. Losing it does not stop the payload
  // reaching the worker: the row is a record of the handover, and the worker
  // being told what happened matters more than the bookkeeping agreeing.
  await repos.dispatches.report({ id: awaited.dispatchId, reportedAt: new Date() })

  const report = admission.body

  if (report.ok && 'observation' in report) {
    await ledger.appendEvidence({
      runId: awaited.runId,
      intentId,
      kind: 'page-snapshot',
      url: report.observation.url,
      // RAW, and deliberately so. The door datamarks; a caller that pre-marked
      // would be a second opinion about what untrusted text looks like.
      untrustedText: report.observation.tree,
    })
  } else if (report.ok) {
    await ledger.appendEvidence({
      runId: awaited.runId,
      intentId,
      kind: 'screen-capture',
      url: '',
      image: Buffer.from(report.capture.base64, 'base64'),
    })
  }

  const delivered = store.settle(intentId, reportOf(admission.body))
  if (!delivered) {
    return NextResponse.json({ ok: false, reason: 'nobody-waiting' }, { status: 409 })
  }

  return NextResponse.json({ ok: true })
}
