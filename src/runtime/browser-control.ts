/**
 * The worker's hands, seen from the worker.
 *
 * ── One outstanding action per run, ever ─────────────────────────────────
 *
 * `dispatch()` blocks until the browser reports or the channel gives up. There
 * is no queue here, no batching, and no way to have two instructions in flight:
 * the worker observes, decides, acts, and cannot decide the next thing until it
 * knows what the last one did. That is what makes ordering a property of the
 * design rather than a discipline — together with `ActionIntent.seq`, which is
 * unique per run, so the ledger could not record an overlap even if one
 * happened.
 *
 * It is also the reason the interface is this small. A richer client — retries,
 * pipelining, a local queue — would be the same code that makes an instruction
 * arrive twice, and for a browser action that means a second click on someone's
 * live page.
 *
 * ── This never retries, and that is the point ────────────────────────────
 *
 * Every failure below is returned, not thrown and not retried. `dispatch` is
 * idempotent on `intentId` at the app, so a retry is SAFE in the narrow sense
 * that it cannot enqueue a second row — but a retry after `not-reported` is a
 * retry of an action that may already have happened, and only the caller, which
 * knows what it was trying to do, can decide whether repeating it is acceptable.
 * A client that silently retried would make that decision for it, invisibly, on
 * exactly the actions where it matters.
 */

import type { ActionParams } from '../policy/gate'
import type { BrowserReport, DispatchableKind } from '../act/channel'
import { CONTROL_HEADER, MAX_HOLD_MS, REQUIRED_CONTENT_TYPE, dispatchResponseSchema } from '../act/channel'

/**
 * How long the client waits beyond the app's own hold before it stops believing
 * in the connection.
 *
 * The app answers at `timeoutMs`; if nothing arrives by then plus this, the app
 * is gone rather than slow. Small, because the answer is already late by
 * construction, and the correct response to a dead app is to say so rather than
 * to wait longer in case it comes back.
 */
export const APP_SLACK_MS = 5_000

export interface BrowserControl {
  dispatch(input: {
    intentId: string
    kind: DispatchableKind
    params: ActionParams
    timeoutMs: number
  }): Promise<BrowserReport>
}

export function createBrowserControl(input: {
  appOrigin: string
  runId: string
  token: string
  fetch: typeof globalThis.fetch
}): BrowserControl {
  const { appOrigin, runId, token, fetch } = input

  return {
    dispatch: async ({ intentId, kind, params, timeoutMs }) => {
      const controller = new AbortController()
      const abort = setTimeout(
        () => controller.abort(),
        Math.min(timeoutMs, MAX_HOLD_MS) + APP_SLACK_MS,
      )

      try {
        const response = await fetch(`${appOrigin}/api/act/dispatch`, {
          method: 'POST',
          headers: {
            'content-type': REQUIRED_CONTENT_TYPE,
            [CONTROL_HEADER]: '1',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ runId, intentId, kind, params, timeoutMs }),
          signal: controller.signal,
        })

        const answer: unknown = await response.json().catch(() => null)
        const parsed = dispatchResponseSchema.safeParse(answer)

        if (parsed.success) {
          return parsed.data.ok
            ? parsed.data.report
            : { ok: false, failure: parsed.data.failure, detail: parsed.data.detail }
        }

        // A body this client cannot read is the app refusing or breaking before
        // anything reached a browser. `not-delivered` is what that means, and
        // the status code goes in the detail so the reason is not lost.
        return {
          ok: false,
          failure: 'not-delivered',
          detail: `the app answered ${response.status} with nothing this client could read`,
        }
      } catch (error) {
        // The app never answered. That is the honest unknown rather than a
        // failure to deliver: the instruction may be sitting in a browser that
        // is doing it right now, and this process cannot see the row that would
        // say. Reporting `not-delivered` here would be a claim that nothing
        // happened, made by the one component in no position to make it.
        return {
          ok: false,
          failure: 'not-reported',
          detail: `the app did not answer: ${error instanceof Error ? error.message : String(error)}`,
        }
      } finally {
        clearTimeout(abort)
      }
    },
  }
}
