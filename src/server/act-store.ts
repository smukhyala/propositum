/**
 * The app process's in-flight control channel: who is waiting, and for what.
 *
 * ── In memory, and that is not a shortcut ────────────────────────────────
 *
 * Every durable fact about a browser instruction lives in `ActionDispatch`: it
 * was queued, it was handed out at this moment, it was reported at that one.
 * What lives here is the thing that CANNOT be durable — the HTTP response the
 * worker is blocked on, which belongs to a socket held by this process and dies
 * with it.
 *
 * So the store holds exactly that, and nothing that would be missed. If the app
 * restarts, every held response dies with it, the worker's `fetch` fails, and it
 * retries `dispatch` for the same `intentId` — which is idempotent on the unique
 * key, so a retry cannot double-deliver an instruction the browser may already
 * have run. Persisting any of this would create a second copy of a truth the row
 * already holds, and the two would eventually disagree.
 *
 * Hung off `globalThis` for the same reason as `captureStore()`: Next's dev
 * server hot-reloads modules, and a fresh store mid-run would strand a worker
 * against a promise nobody can settle any more.
 *
 * ── Why the poll finds its work through here ─────────────────────────────
 *
 * `GET /api/act/next` carries no run id — the extension drives one tab and does
 * not know or need to know which run is talking to it. The queue is per-run in
 * the database, so something has to name the runs worth looking at, and the set
 * of runs with a worker currently blocked on a report is exactly that set. It is
 * also self-cleaning: when the hold ends, for any reason, the run leaves the set.
 *
 * The store never decides who WINS. Two pollers that both see the same queued
 * row both attempt the guarded UPDATE, and the database decides. Anything else
 * would be a second arbiter for a race that already has one.
 */

import type { BrowserReport, ControlFailure } from '../act/channel'

/**
 * How a held response ends, and the discrimination is the point.
 *
 * `reported: true` means the extension answered — even when what it answered is
 * that the action failed. `reported: false` means the CHANNEL failed and no
 * answer exists. Those are different facts about different components, and
 * flattening them into one `ok` would lose the only distinction the worker
 * actually acts on: whether anything is known about what happened in the
 * browser.
 */
export type ChannelAnswer =
  | { readonly reported: true; readonly report: BrowserReport }
  | { readonly reported: false; readonly failure: ControlFailure; readonly detail: string }

/** How long a poller sleeps before re-reading the queue, when nothing has
 *  announced. Short enough that a dispatch written by a process other than this
 *  one is still picked up promptly, long enough not to spin. */
export const POLL_TICK_MS = 500

interface Hold {
  readonly runId: string
  readonly dispatchId: string
  readonly heldSince: number
  readonly settle: (answer: ChannelAnswer) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface ActStore {
  /**
   * Block until the extension reports on this intent, or until the wait ends.
   *
   * `onExpiry` is called by the store and its answer becomes the report. It is
   * a callback rather than a fixed failure because what the expiry MEANS depends
   * on the row: a dispatch nobody ever took did not happen, and a dispatch that
   * was handed out may have. Only the caller can read the row, and it must read
   * it at expiry rather than beforehand.
   */
  hold(input: {
    runId: string
    intentId: string
    dispatchId: string
    timeoutMs: number
    onExpiry: () => Promise<{ failure: ControlFailure; detail: string }>
  }): Promise<ChannelAnswer>
  /** Settle a held response. `false` means nobody was waiting — the worker gave
   *  up, or this is a different process than the one that dispatched. */
  settle(intentId: string, report: BrowserReport): boolean
  /** What is being waited for, for a route handed an intent id that has to
   *  update a row keyed by its own id and write evidence keyed by a run. */
  awaited(intentId: string): { runId: string; dispatchId: string } | null
  /**
   * What each waiting run is actually waiting FOR, oldest hold first.
   *
   * The dispatch id is the load-bearing half. Without it a poll can only ask
   * "what is queued for this run", and the answer may be an ORPHAN — a row from
   * a hold that died with the app, or one left behind by a halt. Handing that
   * out means clicking something for an instruction nobody is waiting on, in a
   * live page, and reporting it to nobody. So the poll is told which row the
   * hold expects and hands out that one.
   */
  waiting(): readonly { runId: string; dispatchId: string }[]
  /** Something was queued. Wakes every poller so it re-reads. */
  announce(): void
  /** Sleep until an announcement or `timeoutMs`, whichever comes first. */
  awaitAnnouncement(timeoutMs: number): Promise<void>
  /**
   * The person stopped it, or the browser went away.
   *
   * Settles every held response for the run with `control-lost` and remembers
   * the run, so a dispatch arriving afterwards fails immediately instead of
   * holding a socket open for twenty-five seconds waiting for hands that are
   * gone. Detaching happens in the extension BEFORE this call — a stop that has
   * to reach a server before it takes effect is not a stop — so by the time this
   * runs it is recording something already true.
   *
   * Returns the dispatch rows it just stopped waiting for, because settling the
   * socket is only half of stopping: the row is still `queued`, and a queued row
   * nobody is waiting for is exactly the instruction a later poll would hand to
   * a browser after the person pressed Stop. The caller abandons them.
   */
  halt(runId: string, detail: string): readonly string[]
  halted(runId: string): boolean
}

/**
 * How many halted run ids to remember.
 *
 * Bounded because this is process-lifetime memory in a long-running server and
 * an unbounded set of ids is a slow leak. Forgetting the oldest is safe: a run
 * whose halt has been forgotten falls back to the ordinary path, where its
 * dispatch waits and then reports `not-delivered` because no extension is
 * polling for it. Slower, and true.
 */
const HALTED_MEMORY = 100

export function createActStore(): ActStore {
  const holds = new Map<string, Hold>()
  const wakers = new Set<() => void>()
  const haltedRuns: string[] = []

  const release = (intentId: string): Hold | undefined => {
    const hold = holds.get(intentId)
    if (!hold) return undefined
    clearTimeout(hold.timer)
    holds.delete(intentId)
    return hold
  }

  return {
    hold: ({ runId, intentId, dispatchId, timeoutMs, onExpiry }) =>
      new Promise<ChannelAnswer>((resolve) => {
        // A second hold for the same intent means the worker retried a dispatch
        // whose answer it never saw. The old socket is already gone, so the old
        // promise is settled rather than left dangling — an unsettled promise
        // here is a request that never answers.
        const previous = release(intentId)
        previous?.settle({
          reported: false,
          failure: 'not-reported',
          detail: 'superseded by a retry of the same intent',
        })

        const timer = setTimeout(() => {
          holds.delete(intentId)
          void onExpiry()
            .then((ending) => resolve({ reported: false, ...ending }))
            .catch((error: unknown) => {
              // `onExpiry` reads the row to decide what the silence meant, and a
              // read can fail — SQLite busy, or the process shutting down. An
              // unsettled promise here is a request that never answers AND an
              // unhandled rejection, which under Node's default takes the app
              // down with every other hold on it. So a failed read answers the
              // honest unknown: we cannot say whether the browser took this.
              resolve({
                reported: false,
                failure: 'not-reported',
                detail: `the wait ended and the dispatch could not be read: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              })
            })
        }, timeoutMs)

        holds.set(intentId, {
          runId,
          dispatchId,
          heldSince: Date.now(),
          settle: resolve,
          timer,
        })
      }),

    settle: (intentId, report) => {
      const hold = release(intentId)
      if (!hold) return false
      hold.settle({ reported: true, report })
      return true
    },

    awaited: (intentId) => {
      const hold = holds.get(intentId)
      return hold ? { runId: hold.runId, dispatchId: hold.dispatchId } : null
    },

    waiting: () =>
      [...holds.values()]
        .sort((a, b) => a.heldSince - b.heldSince)
        .map((hold) => ({ runId: hold.runId, dispatchId: hold.dispatchId })),

    announce: () => {
      const woken = [...wakers]
      wakers.clear()
      for (const wake of woken) wake()
    },

    awaitAnnouncement: (timeoutMs) =>
      new Promise<void>((resolve) => {
        if (timeoutMs <= 0) {
          resolve()
          return
        }
        const wake = () => {
          clearTimeout(timer)
          resolve()
        }
        const timer = setTimeout(() => {
          wakers.delete(wake)
          resolve()
        }, timeoutMs)
        wakers.add(wake)
      }),

    halt: (runId, detail) => {
      if (!haltedRuns.includes(runId)) {
        haltedRuns.push(runId)
        if (haltedRuns.length > HALTED_MEMORY) haltedRuns.shift()
      }

      const stopped: string[] = []
      for (const [intentId, hold] of [...holds.entries()]) {
        if (hold.runId !== runId) continue
        release(intentId)
        hold.settle({ reported: false, failure: 'control-lost', detail })
        stopped.push(hold.dispatchId)
      }
      return stopped
    },

    halted: (runId) => haltedRuns.includes(runId),
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __propositumAct: ActStore | undefined
}

export function actStore(): ActStore {
  globalThis.__propositumAct ??= createActStore()
  return globalThis.__propositumAct
}
