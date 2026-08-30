/**
 * What is set up, what is not, and which thing to say next.
 *
 * ── Why this is not eight branches inside `page.tsx` ──────────────────────
 *
 * The same argument `src/server/front-door.ts` opens with, and it applies here
 * for a worse reason. Every decision below fails silently: a step that reports
 * itself done when it is not sends somebody to the next one and leaves them
 * hunting; a step that reports itself pending when it is done tells them their
 * own machine is broken. A `.tsx` server component is the one thing in this repo
 * nothing can assert against, so the derivation lives here and the page —
 * `src/app/first-run/page.tsx`, rendered on `/first-run` and in the window
 * the tray opens — keeps the markup.
 *
 * ── It is a state machine over facts, not a wizard with a cursor ──────────
 *
 * Nothing is stored about where somebody "is". Each step is a question with an
 * answer in the world — is the key set, is an extension paired, has a source
 * been approved — and the screen renders the first one whose answer is no. So
 * refreshing, arriving by a link, coming back tomorrow, and restarting both
 * processes all land in the same place, and there is no progress row to get out
 * of step with the truth.
 *
 * ── What each step is honest about ────────────────────────────────────────
 *
 * **The key is detected, never collected.** `ANTHROPIC_API_KEY` identifies the
 * application, not the person, and `src/server/calendar.ts` already settled
 * where that kind of value lives: *"`.env` is exactly where the app's own
 * credentials live"*. Building a nice form for it would also be building the
 * wrong flow — no product a person buys asks them for an API key, so this step
 * is scaffolding for whoever is running the software, and it says so.
 *
 * **Watching is reported as capture health, not as progress.** Principle 1
 * forbids *"any progress indicator derived from event volume, action count, or
 * elapsed time"*, and a bar filling up as somebody reads would be exactly that.
 * What this reports instead is whether anything has arrived at all — the
 * difference between *it is on and waiting* and *it is not receiving anything*,
 * which is the only question at that moment that has an action attached.
 *
 * The bar itself is stated as the two conditions `src/domain/detection/grounds.ts`
 * enforces, quoted from the constants rather than written out again, so a change
 * to the thresholds cannot leave this screen describing the old ones.
 */

import { join } from 'node:path'

import { appContext } from './db'
import { ambientStore, captureStore } from './capture-store'
import { recentKnocks } from './extension-pairing'
import type { Knock } from './extension-pairing'
import { noticedAfternoon } from './front-door'
import { INTENT_REQUIRED, INVESTMENT_REQUIRED } from '@/domain/detection/grounds'
import { TELEGRAM } from '@/domain/conversation/channel'

/**
 * The steps, in the order the trail shows them.
 *
 * ~~`paired` is last and is not a step somebody can skip ahead to.~~ Rewritten
 * 2026-08-30, with the todo 09 design: the first run is consent cards a person
 * may grant in any order, so pairing the phone early is allowed — pairing
 * SENDS nothing, and what Principle 13 actually forbids survives intact: the
 * thread's first message is still the offer, never a greeting
 * (`src/server/thread.ts` completes a pairing without emitting a word). The
 * order here still names the dependency truth the trail renders: nothing to
 * watch before a site is allowed, nothing to offer before anything arrives.
 */
export const FIRST_RUN_STEPS = ['key', 'extension', 'sources', 'watching', 'phone'] as const

export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number]

export interface FirstRunState {
  /** The first step that is not done. `null` when everything is. */
  readonly at: FirstRunStep | null
  /** Every step, so the page can show what is behind as well as what is next. */
  readonly done: Readonly<Record<FirstRunStep, boolean>>

  /** Whether a model can be reached at all. Detected, never collected. */
  readonly keySet: boolean

  /** The paired extension id, or null. */
  readonly pairedExtension: string | null
  /** Extensions that have knocked and been refused, most recent first. */
  readonly knocking: readonly Knock[]

  /** How many origins a person has approved, across every project. */
  readonly approvedSources: number

  /** Whether anything at all has arrived recently. Health, not progress. */
  readonly seeingPages: boolean
  /** A session is running, so the ambient path is off by design. */
  readonly sessionLive: boolean
  /** How many grounds of each kind an offer needs. Quoted from the detector. */
  readonly bar: { readonly intent: number; readonly investment: number }

  /** A composed offer is on the table right now, and its lookup key. */
  readonly offer: string | null

  /** The phone thread, once paired. */
  readonly threadPaired: boolean

  /**
   * Where the extension folder actually is, absolute, for the guided
   * sideload. The children run with the runtime tree as cwd
   * (`src-tauri/src/supervisor.rs`), so this is the checkout's `extension/`
   * in development and `Propositum.app/Contents/Resources/runtime/extension`
   * in an installed copy — the card can name the real path instead of
   * "the extension folder".
   */
  readonly extensionFolder: string
}

/** The five answers the ordering is computed from. All booleans, no reading. */
export interface SetupFacts {
  readonly keySet: boolean
  readonly extensionPaired: boolean
  readonly anySourceApproved: boolean
  readonly anythingToOffer: boolean
  readonly threadPaired: boolean
}

/**
 * Which step somebody is on, from what is true.
 *
 * ── Why this is separate from the reading ────────────────────────────────
 *
 * It is the half that can be wrong in a way nobody would spot. Reading a fact
 * either works or throws; ORDERING them wrongly produces a screen that is
 * confidently, quietly incorrect — telling somebody to pair an extension they
 * paired an hour ago, or that they are finished when nothing is watching. Pure
 * and exported so a test can hold all thirty-two combinations, which is the only
 * way to know the table is complete.
 *
 * The order is not arbitrary and each step depends on the one before it: there
 * is nothing to allow before an extension can ask, nothing to watch before a
 * site is allowed, and nothing to say on a phone before there is an offer —
 * which is Principle 13, because a first message with nothing attached is a
 * greeting.
 */
export function stepFrom(facts: SetupFacts): {
  readonly at: FirstRunStep | null
  readonly done: Readonly<Record<FirstRunStep, boolean>>
} {
  const done: Record<FirstRunStep, boolean> = {
    key: facts.keySet,
    extension: facts.extensionPaired,
    sources: facts.anySourceApproved,
    // "Watching" is done once there is something to offer. Before that it is the
    // step somebody is ON, not one they have failed — which is why the screen
    // for it says what it is waiting for rather than what went wrong.
    watching: facts.anythingToOffer,
    phone: facts.threadPaired,
  }

  return { at: FIRST_RUN_STEPS.find((step) => !done[step]) ?? null, done }
}

/** The three sources a card can grant, in the order the ask decides. */
export type ConsentSource = 'extension' | 'calendar' | 'phone'

/**
 * Which card comes first, from the opening ask.
 *
 * The ask — act on things now, quietly watch, just connect sources — is the
 * one thing on the first run that is genuinely not a fact about the machine,
 * so it lives in the URL and routes presentation only. The ordering is the
 * kind of quietly-wrong decision this module exists to keep out of a `.tsx`:
 * somebody who said "act" being shown the calendar first is confidently,
 * silently the wrong screen. `null` means the ask has not been answered and
 * the page renders the ask itself.
 */
export function consentOrder(
  ask: 'act' | 'watch' | 'connect' | null,
): readonly ConsentSource[] | null {
  switch (ask) {
    case 'act':
      return ['extension', 'phone', 'calendar']
    case 'watch':
      return ['extension', 'calendar', 'phone']
    case 'connect':
      return ['calendar', 'extension', 'phone']
    case null:
      return null
  }
}

/**
 * Read every fact, then decide.
 *
 * Deliberately one pass with no early return: a screen that renders step two
 * cannot know whether step four is also done, and *"everything behind you is
 * done"* is a different sentence from *"here is the next thing"*. Both are on
 * the page, so both are computed.
 */
export async function firstRunState(nowMs: number = Date.now()): Promise<FirstRunState> {
  const keySet = (process.env['ANTHROPIC_API_KEY'] ?? '').trim() !== ''

  const { repos } = await appContext()

  const pairedExtension =
    process.env['PROPOSITUM_EXTENSION_ID'] ?? (await repos.pairing.current('chrome'))

  const knocking = pairedExtension === null ? recentKnocks(nowMs) : []

  const approvedSources = await repos.projects.approvedSourceCount()

  const live = captureStore().current()
  const ambient = ambientStore()
  const observations = ambient.since(nowMs)

  /**
   * Not a count, and not rendered as one.
   *
   * The page asks "is anything arriving" and this answers it. What it must not
   * become is a number that goes up while somebody watches, which is the shape
   * Principle 1 rules out and the shape this screen is most tempted toward.
   */
  const seeingPages = observations.length > 0

  const offer = (() => {
    if (live !== null) return null
    const leading = noticedAfternoon(ambient, observations, nowMs).shown[0]
    if (leading === undefined) return null
    // A strand with no composed offer is not something to advertise on this
    // screen: the phone's first message is the offer, and half of one is worse
    // than waiting.
    return ambient.offerFor(leading.signature) === undefined ? null : leading.signature
  })()

  const threadPaired = (await repos.thread.status(TELEGRAM)) !== null

  const { at, done } = stepFrom({
    keySet,
    extensionPaired: pairedExtension !== null,
    anySourceApproved: approvedSources > 0,
    anythingToOffer: offer !== null,
    threadPaired,
  })

  return {
    at,
    done,
    keySet,
    pairedExtension,
    knocking,
    approvedSources,
    seeingPages,
    sessionLive: live !== null,
    bar: { intent: INTENT_REQUIRED, investment: INVESTMENT_REQUIRED },
    offer,
    threadPaired,
    extensionFolder: join(process.cwd(), 'extension'),
  }
}
