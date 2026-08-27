/**
 * Which extension this install answers to, and how a person gets to say.
 *
 * ── The failure this exists for ───────────────────────────────────────────
 *
 * Loading the unpacked extension mints an id. Until that id is in
 * `PROPOSITUM_EXTENSION_ID`, every capture request is refused with
 * `bad-origin` — correctly, and invisibly. `.env.example` says so, the response
 * body carries a hint, and neither is anywhere a person looks. The result is a
 * product that appears installed and captures nothing, which is the same shape
 * as the swallowed notification and the blank report: the software knew what was
 * wrong and told no one.
 *
 * ── What this is, said narrowly ───────────────────────────────────────────
 *
 * **Not authentication, and the welcome screen must not imply otherwise.**
 * Anything running on this machine can call the app claiming to be an extension,
 * and a forged `Origin` was always possible from a non-browser client —
 * `src/capture/transport.ts` says exactly that about the check this feeds. What
 * changes is only WHERE the person expresses the decision: on a screen, having
 * been shown the id, rather than by pasting it into a file. The person clicking
 * is the authorisation, on the same terms as the extension's own **Allow**
 * gesture, and the copy on the page says so.
 *
 * ── Why the knock buffer is memory and not a table ────────────────────────
 *
 * A refused origin is a fact about the last few minutes, not about the person.
 * `src/server/ambient-store.ts` makes the same call for observations and states
 * the reason this file inherits: a durable row about something nobody accepted
 * is a profile of attempts. Nothing here survives a restart, and after a restart
 * the extension's own 30-second poll refills it within half a minute.
 */

import { appContext, existingAppContext } from './db'

/** One browser, one pairing. The primary key enforces it; this names it. */
export const CHROME = 'chrome'

/**
 * How long a knock stays offerable.
 *
 * Five minutes, and the number is a property of the loop rather than a taste:
 * the extension's heartbeat alarm fires every 30 seconds, so a live extension
 * re-knocks ten times inside this window. Anything that stopped knocking is
 * gone, and offering to pair with something that is no longer there would be
 * offering a decision that cannot be checked.
 */
export const KNOCK_TTL_MS = 5 * 60_000

/**
 * How many distinct origins are held at once.
 *
 * Small on purpose. This is a list a person reads and picks from, so a list
 * longer than a screen is not a better list — and an unbounded map keyed by
 * whatever a caller sends is a memory the caller controls.
 */
export const MAX_KNOCKS = 8

export interface Knock {
  /** The full origin, exactly as it arrived. */
  readonly origin: string
  /** The id inside it — what a person compares against `chrome://extensions`. */
  readonly extensionId: string
  readonly lastAtMs: number
}

interface KnockBuffer {
  note(origin: string | undefined, nowMs: number): void
  recent(nowMs: number): readonly Knock[]
  clear(): void
}

function createKnockBuffer(): KnockBuffer {
  const seen = new Map<string, number>()

  return {
    note(origin, nowMs) {
      // Only a chrome-extension origin is offerable. A page origin reaching the
      // refusal path is a page that got further than it should have, and it is
      // not something to invite somebody to trust.
      if (origin === undefined || !origin.startsWith('chrome-extension://')) return
      const id = origin.slice('chrome-extension://'.length)
      if (!/^[a-p]{32}$/.test(id)) return

      seen.set(origin, nowMs)

      // Oldest out. `Map` iterates in insertion order and `set` on an existing
      // key does not reorder, so the first entry is the least recently ADDED
      // rather than the least recently seen — close enough for a list of eight,
      // and cheaper than re-sorting on every refused request.
      while (seen.size > MAX_KNOCKS) {
        const oldest = seen.keys().next()
        if (oldest.done === true) break
        seen.delete(oldest.value)
      }
    },

    recent(nowMs) {
      const live: Knock[] = []
      for (const [origin, at] of seen) {
        if (nowMs - at > KNOCK_TTL_MS) {
          seen.delete(origin)
          continue
        }
        live.push({
          origin,
          extensionId: origin.slice('chrome-extension://'.length),
          lastAtMs: at,
        })
      }
      // Most recent first: the extension somebody just loaded is the one they
      // are looking for.
      return live.sort((a, b) => b.lastAtMs - a.lastAtMs)
    },

    clear() {
      seen.clear()
    },
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __propositumKnocks: KnockBuffer | undefined
}

/** Hung off `globalThis` for the reason `captureStore()` is: Next's hot reload
 *  must not silently drop it mid-poll. */
function knocks(): KnockBuffer {
  globalThis.__propositumKnocks ??= createKnockBuffer()
  return globalThis.__propositumKnocks
}

/** Record a refused origin. Called from the routes that refuse one. */
export function noteKnock(origin: string | undefined, nowMs: number = Date.now()): void {
  knocks().note(origin, nowMs)
}

/** What `/welcome` offers to pair with. */
export function recentKnocks(nowMs: number = Date.now()): readonly Knock[] {
  return knocks().recent(nowMs)
}

/** Used by the tests, and by pairing — a paired extension is no longer knocking. */
export function forgetKnocks(): void {
  knocks().clear()
}

/**
 * The origin the app accepts, from the environment or from the row.
 *
 * **`.env` wins.** A clone that already sets `PROPOSITUM_EXTENSION_ID` behaves
 * exactly as it did before this file existed, and somebody who has pinned an id
 * in configuration does not have it quietly overridden by a click. The row is
 * the fallback, not the authority.
 *
 * Returns the same `chrome-extension://unset` sentinel as before when there is
 * neither, because the check is never loosened — an install with no answer
 * refuses everything, which is the state a fresh clone is in and the state
 * `/welcome` exists to get somebody out of.
 */
export async function resolveExtensionOrigin(): Promise<string> {
  const fromEnv = process.env['PROPOSITUM_EXTENSION_ID']
  if (fromEnv) return `chrome-extension://${fromEnv}`

  /**
   * `existingAppContext()`, never `appContext()`.
   *
   * This runs on every capture request, including the ones that arrive before
   * anything has opened a database — and opening one as a side effect of an
   * origin check would make a rejected request create a file. The same reason
   * `declineThreadOffer` reaches for it.
   */
  const pending = existingAppContext()
  if (pending === undefined) return 'chrome-extension://unset'

  try {
    const ctx = await pending
    const paired = await ctx.repos.pairing.current(CHROME)
    return paired ? `chrome-extension://${paired}` : 'chrome-extension://unset'
  } catch {
    // A database that cannot be read refuses, it does not admit. Failing open
    // here would turn a broken install into an open door.
    return 'chrome-extension://unset'
  }
}

export type PairResult =
  | { readonly ok: true; readonly extensionId: string }
  | { readonly ok: false; readonly reason: 'not-knocking' | 'malformed' }

/**
 * Pair with an id a person picked off the screen.
 *
 * It must be one that is actually knocking. That is not a security property —
 * see the header — it is an honesty one: offering to pair with an arbitrary
 * string would let somebody pair with a typo and then spend an afternoon
 * wondering why nothing is captured, which is the exact failure this whole file
 * is about.
 */
export async function pairExtension(
  extensionId: string,
  nowMs: number = Date.now(),
): Promise<PairResult> {
  const id = extensionId.trim()
  if (!/^[a-p]{32}$/.test(id)) return { ok: false, reason: 'malformed' }

  const knocking = recentKnocks(nowMs).some((knock) => knock.extensionId === id)
  if (!knocking) return { ok: false, reason: 'not-knocking' }

  const ctx = await appContext()
  await ctx.repos.pairing.pair(CHROME, id)
  forgetKnocks()
  return { ok: true, extensionId: id }
}
