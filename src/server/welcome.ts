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
 * nothing can assert against, so the derivation lives here and the page keeps
 * the markup.
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

import { appContext } from './db'
import { ambientStore, captureStore } from './capture-store'
import { recentKnocks } from './extension-pairing'
import type { Knock } from './extension-pairing'
import { noticedAfternoon } from './front-door'
import { INTENT_REQUIRED, INVESTMENT_REQUIRED } from '@/domain/detection/grounds'
import { TELEGRAM } from '@/domain/conversation/channel'

/**
 * The steps, in the order they must be done.
 *
 * `paired` is last and is not a step somebody can skip ahead to: the thread's
 * first message is an offer, and an offer that does not exist yet is a greeting
 * — which Principle 13 forbids outright. So the screen does not invite pairing
 * until there is something to say.
 */
export const WELCOME_STEPS = ['key', 'extension', 'sources', 'watching', 'phone'] as const

export type WelcomeStep = (typeof WELCOME_STEPS)[number]

export interface WelcomeState {
  /** The first step that is not done. `null` when everything is. */
  readonly at: WelcomeStep | null
  /** Every step, so the page can show what is behind as well as what is next. */
  readonly done: Readonly<Record<WelcomeStep, boolean>>

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
  readonly at: WelcomeStep | null
  readonly done: Readonly<Record<WelcomeStep, boolean>>
} {
  const done: Record<WelcomeStep, boolean> = {
    key: facts.keySet,
    extension: facts.extensionPaired,
    sources: facts.anySourceApproved,
    // "Watching" is done once there is something to offer. Before that it is the
    // step somebody is ON, not one they have failed — which is why the screen
    // for it says what it is waiting for rather than what went wrong.
    watching: facts.anythingToOffer,
    phone: facts.threadPaired,
  }

  return { at: WELCOME_STEPS.find((step) => !done[step]) ?? null, done }
}

/**
 * Read every fact, then decide.
 *
 * Deliberately one pass with no early return: a screen that renders step two
 * cannot know whether step four is also done, and *"everything behind you is
 * done"* is a different sentence from *"here is the next thing"*. Both are on
 * the page, so both are computed.
 */
export async function welcomeState(nowMs: number = Date.now()): Promise<WelcomeState> {
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
  }
}
