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
import type { BrowserReport, ControlFailure, DispatchableKind, PageObservation, ScreenCapture } from '../act/channel'
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
    /**
     * Carried opaquely, matching the wire.
     *
     * This was `ActionParams` — the gate's shape — and that is narrower than
     * what actually crosses. `navigate` sends a RESOLVED url, because the tool
     * has already joined the path to the approved source's origin and proven the
     * result did not leave it; re-deriving that in the extension would be a
     * second implementation of the check that matters most. `src/act/channel.ts`
     * types the same field `Record<string, unknown>` and says why: deterministic
     * code built it and the extension validates it per kind.
     */
    params: Record<string, unknown>
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

/**
 * The failures after which we cannot say whether the world changed.
 *
 * Every browser failure is recorded `unverified` — CONTEXT.md is explicit that
 * the verdict covers both "nothing happened" and "we cannot tell". What this set
 * changes is the SENTENCE the ledger carries, and that distinction is the whole
 * reason `not-delivered` and `not-reported` are separate codes.
 *
 * Telling somebody "it did not go through" about an instruction that reached
 * their browser and may well have pressed Send is the single most damaging thing
 * this ledger could say, because they will act on it — retry the order, re-send
 * the message. The reverse error is merely annoying: they check something that
 * never happened.
 *
 * `not-delivered` is deliberately absent: the guarded UPDATE means the row was
 * still `queued`, so the instruction provably never left the app.
 */
export const UNVERIFIED_FAILURES: ReadonlySet<ControlFailure> = new Set<ControlFailure>([
  'not-reported',
  'timed-out',
])

/**
 * Raised by a tool when the channel reported a failure.
 *
 * A class rather than a bare `Error` so the loop can record the deterministic
 * `failure` code beside the prose, instead of parsing a message. The loop
 * catches it exactly where it catches everything else a tool can throw, so
 * nothing about the ledger ordering changes.
 */
export class BrowserControlError extends Error {
  readonly failure: ControlFailure

  constructor(failure: ControlFailure, detail: string) {
    super(`${failure}: ${detail}`)
    this.name = 'BrowserControlError'
    this.failure = failure
  }
}

/**
 * Re-exported so the loop and the tools import their vocabulary from the thing
 * they hold, not from the wire module underneath it.
 *
 * The definitions live in `src/act/channel.ts` because that is where both ends
 * of the channel agree on them, and there is exactly one declaration. This is a
 * doorway, not a second home.
 */
export type { BrowserReport, ControlFailure, DispatchableKind, PageObservation, ScreenCapture }
export { DISPATCH_TIMEOUT_MS } from '../act/channel'
