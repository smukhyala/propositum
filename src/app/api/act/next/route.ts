/**
 * The long poll. An MV3 service worker asks for something to do.
 *
 * ── The one assertion this file exists to make true ──────────────────────
 *
 * **Two pollers can never receive the same instruction.** Handing one out is a
 * conditional UPDATE `queued → delivered` that reports whether it won, so the
 * check and the write are one statement with no window between them. Both
 * pollers read the same row, both attempt the claim, exactly one wins, and the
 * loser goes back to looking. The database is the only arbiter; nothing in this
 * process decides.
 *
 * That matters more here than the usual queue reason. A redelivered instruction
 * is not a duplicated job that some idempotency key absorbs later — it is a
 * second click on someone's live page, on the same button, in a session that is
 * really theirs.
 *
 * ── Why the wait ends where it does ──────────────────────────────────────
 *
 * At `POLL_TIMEOUT_MS`, deliberately under Chrome's ~30s idle window, so the
 * poll ends because the SERVER answered and never because Chrome killed the
 * worker mid-request. The difference is not latency, it is knowledge: a poll
 * that dies with the service worker leaves us unable to say whether the answer
 * arrived, and this channel refuses to hold that state about an instruction that
 * presses buttons.
 *
 * ── There is no run id in the request, on purpose ────────────────────────
 *
 * The extension drives one tab and does not know which run is talking to it,
 * which is a boundary worth keeping: knowing run ids would not help it act and
 * would give a component that shares a process with every page in the browser
 * one more thing worth stealing. The runs worth looking at are the ones with a
 * worker currently blocked on a report, which the act store knows.
 *
 * **The RESPONSE carries one, and that is not a reversal of the paragraph
 * above.** It refuses a run id as an INPUT — the extension must not be able to
 * choose which run it is answered about — and says nothing about what it needs
 * in order to stop. `POST /api/act/halt` takes a run id, and ADR-0010 §7 says
 * stopping must work with the app closed, so the id cannot be fetched at the
 * moment it is wanted. It rides out with the command that opens the tab, which
 * is what `service-worker.js` has always read it from. Until it was sent, every
 * halt raised from the browser was refused by a schema before
 * `runs.requestCancel` ran, in a request whose failure nothing checked.
 *
 * **The cost, stated rather than discovered later: with two runs acting at once,
 * this route would hand run B's instruction to the extension attached to run A's
 * tab.** Today one run acts at a time, so it cannot happen; the moment two can,
 * the poll needs to know which tab is asking, and that is a change to what the
 * extension is told at attach time rather than something this file can fix
 * alone.
 *
 * ── Only the instruction someone is waiting for ──────────────────────────
 *
 * The poll hands out the dispatch the hold NAMES, never merely the oldest queued
 * row for that run. The difference is an orphan: a row left `queued` by an app
 * restart or by a halt, whose worker is long gone. Handing one of those out
 * clicks something in a live page for an instruction nobody is waiting on, and
 * reports the result to nobody. So an orphan found ahead of the awaited row is
 * ABANDONED — which the repository only permits while it is still queued, so
 * this can never erase a record of something that was handed out.
 */

import { NextResponse } from 'next/server'

import { POLL_TIMEOUT_MS, admitControl } from '@/act/channel'
import type { DispatchableKind } from '@/act/channel'
import { POLL_TICK_MS, actStore } from '@/server/act-store'
import { appContext } from '@/server/db'
import { expectedOrigin } from '@/server/capture-store'

/**
 * A test may SHORTEN this process's own wait, never lengthen it.
 *
 * An integration test that has to sit through twenty-five seconds to prove a
 * loser gets nothing is a test people stop running. The clamp is what makes the
 * knob safe: it can only bring the answer forward, so no configuration can push
 * a poll past the window it was chosen to stay inside.
 */
function pollWindowMs(): number {
  const override = Number(process.env['PROPOSITUM_ACT_POLL_MS'])
  if (!Number.isFinite(override) || override <= 0) return POLL_TIMEOUT_MS
  return Math.min(override, POLL_TIMEOUT_MS)
}

export async function GET(request: Request) {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const admission = admitControl(
    { headers, body: null },
    { from: 'extension', expectedOrigin: expectedOrigin() },
    { kind: 'none' },
  )

  if (!admission.ok) {
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const store = actStore()
  const { repos } = await appContext()
  const deadline = Date.now() + pollWindowMs()

  for (;;) {
    for (const { runId, dispatchId } of store.waiting()) {
      // Drain any orphan sitting ahead of the awaited row, so one stale
      // instruction cannot wedge a run's queue forever.
      let queued = await repos.dispatches.nextQueued(runId)
      while (queued !== null && queued.id !== dispatchId) {
        // Guarded: `abandon` refuses a delivered row, so losing this race means
        // some other poller took it and this loop simply moves on.
        await repos.dispatches.abandon(queued.id)
        queued = await repos.dispatches.nextQueued(runId)
      }

      if (queued === null) continue

      const won = await repos.dispatches.claim({ id: queued.id, deliveredAt: new Date() })
      // Lost the race to another poller. Not an error — the other one has it,
      // and this one keeps looking rather than reporting a failure that did not
      // happen.
      if (!won) continue

      return NextResponse.json({
        command: {
          // Outbound only, and it is what makes Stop real. See the note on
          // `DispatchedCommand`: the section above refuses a run id in the
          // REQUEST and that still holds, but `POST /api/act/halt` takes one and
          // stopping cannot depend on the app being reachable to look it up. The
          // extension stores it beside `controlledTabId` when the tab is
          // created; without it every halt from the browser was refused 403 by a
          // schema, silently, and the run carried on.
          runId,
          intentId: queued.intentId,
          kind: queued.kind as DispatchableKind,
          params: (queued.params ?? {}) as Record<string, unknown>,
        },
      })
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    // Wake on an announcement, or on the tick — whichever is sooner. The tick
    // exists so an instruction written by some other process (a second app
    // instance, a repair script) is still picked up, rather than waiting for an
    // announcement that only this process can make.
    await store.awaitAnnouncement(Math.min(remaining, POLL_TICK_MS))
  }

  return NextResponse.json({ command: null })
}
