/**
 * Where the worker hands an instruction over, and waits.
 *
 * This response is HELD OPEN until the browser reports or the wait ends, which
 * is the property the whole channel is built around: the worker blocks on each
 * report, so there is **exactly one outstanding action per run, ever**. That,
 * together with `ActionIntent.seq` being unique per run, is what guarantees
 * ordering — not a queue discipline, and not a promise the worker makes to
 * itself.
 *
 * Two things this route must never do:
 *
 *   1. Redeliver. Handing an instruction out is a guarded UPDATE, and once a
 *      dispatch is `delivered` it is never handed out again — for a browser
 *      action, "deliver twice" means "click twice". A dispatch that expires
 *      while delivered answers `not-reported`, which says the action MAY have
 *      happened, rather than `not-delivered`, which would say it did not.
 *   2. Answer from the wait. What the expiry means is read off the row, in one
 *      guarded statement, at the moment it expires — see `onExpiry` below.
 */

import { NextResponse } from 'next/server'

import { MAX_HOLD_MS, MIN_HOLD_MS, admitControl, dispatchRequestSchema } from '@/act/channel'
import { actStore } from '@/server/act-store'
import { appContext } from '@/server/db'

/**
 * Run statuses whose control token still means anything.
 *
 * The token is minted when a run is claimed and cleared when it reaches a
 * terminal state, so a finished run should hold no credential at all. This is
 * the belt to that braces: a token that outlives its run — because the clearing
 * write failed, or because a crash beat it — still cannot drive a browser,
 * because the status is checked here rather than assumed there.
 */
const ACTING_STATUSES: ReadonlySet<string> = new Set(['claimed', 'running'])

export async function POST(request: Request) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const body: unknown = await request.json().catch(() => null)

  // The run id is read out of an UNAUTHENTICATED body, and that is not the same
  // as trusting it: it is used solely to look up which secret to compare
  // against. A forged or mistyped id yields either no run or the wrong run's
  // token, and in both cases the comparison below fails. This is the same shape
  // as a username arriving beside a password.
  const claimedRunId =
    typeof body === 'object' && body !== null && typeof (body as { runId?: unknown }).runId === 'string'
      ? (body as { runId: string }).runId
      : null

  const { repos } = await appContext()
  const run = claimedRunId === null ? null : await repos.runs.byId(claimedRunId)
  const controlToken = run !== null && ACTING_STATUSES.has(run.status) ? run.controlToken : null

  const admission = admitControl(
    { headers, body },
    { from: 'worker', controlToken },
    { kind: 'json', schema: dispatchRequestSchema },
  )

  if (!admission.ok) {
    // `not-delivered` is the truthful code for every refusal at this door: the
    // service worker never saw the instruction, so nothing happened in anyone's
    // browser. The reason travels in `detail`, which is useful in a log and
    // tells a caller only which control it failed — which it could learn by
    // trying anyway.
    return NextResponse.json(
      { ok: false, failure: 'not-delivered', detail: admission.reason },
      { status: 403 },
    )
  }

  const { runId, intentId, kind, params, timeoutMs } = admission.body
  const store = actStore()

  if (store.halted(runId)) {
    // The person detached, or the tab closed. Answering immediately rather than
    // holding a socket open for twenty-five seconds is the whole reason the halt
    // is remembered: the run's next action should fail now, so the run can end
    // and say so, rather than time out once per remaining instruction.
    return NextResponse.json(
      { ok: false, failure: 'control-lost', detail: 'this run was halted' },
      { status: 409 },
    )
  }

  const dispatch = await repos.dispatches.enqueue({ runId, intentId, kind, params })

  if (dispatch.status === 'reported') {
    // The instruction ran and the browser answered, and the answer went to a
    // connection that no longer exists. The report body is deliberately not
    // stored — it is not evidence, and `ActionEvidence` is written by whoever
    // consumed it — so we cannot replay it. `not-reported` is the honest code:
    // something happened out there and this process cannot say what.
    return NextResponse.json({
      ok: false,
      failure: 'not-reported',
      detail: 'already reported; the answer was lost with the connection',
    })
  }

  if (dispatch.status === 'abandoned') {
    return NextResponse.json({
      ok: false,
      failure: 'not-delivered',
      detail: 'this instruction was abandoned before it was handed out',
    })
  }

  const hold = Math.min(Math.max(timeoutMs, MIN_HOLD_MS), MAX_HOLD_MS)

  // Registered BEFORE the announcement, and the order is load-bearing rather
  // than tidy: a poll that woke first would look for runs with someone waiting,
  // find none, and park again for a full tick. `hold` registers synchronously,
  // so by the time anything is woken the run is in the waiting set.
  const pending = store.hold({
    runId,
    intentId,
    dispatchId: dispatch.id,
    timeoutMs: hold,
    onExpiry: async () => {
      // One guarded statement answers the only question that matters. `abandon`
      // refuses to touch a delivered row, so winning it PROVES the instruction
      // was never handed out, and losing it proves it was. Reading the status
      // first and then deciding would leave a window in which a poll takes the
      // row between the read and the write.
      const neverDelivered = await repos.dispatches.abandon(dispatch.id)

      return neverDelivered
        ? {
            failure: 'not-delivered' as const,
            detail: 'no browser took this instruction before the wait ended',
          }
        : {
            failure: 'not-reported' as const,
            detail: 'the browser took this instruction and did not report back',
          }
    },
  })

  // Wake any poll that is currently parked, so the ordinary case costs a round
  // trip rather than a tick.
  store.announce()

  const answer = await pending

  // The two arms say different things about different components. `ok: true`
  // means the browser answered — including when what it answered is that the
  // action failed, which is a fact about the page. `ok: false` means the channel
  // never got an answer at all, which is a fact about the channel, and the
  // worker treats the two differently: one is evidence, the other is a gap.
  return answer.reported
    ? NextResponse.json({ ok: true, report: answer.report })
    : NextResponse.json({ ok: false, failure: answer.failure, detail: answer.detail })
}
