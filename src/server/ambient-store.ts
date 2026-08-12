/**
 * What Propositum has seen while no session is running.
 *
 * ── The privacy shape, stated once ───────────────────────────────────────
 *
 * This is the part of the product that watches without being asked, so the
 * constraints on it are the ones worth being loud about:
 *
 *   - **In memory only.** Nothing here touches SQLite. It dies with the
 *     process, and there is no path by which it can outlive one. The ledger
 *     still means "the record of a session", which is what makes
 *     `ObservationEvent` interpretable at all.
 *   - **Metadata only.** A cleaned URL, a title, dwell and scroll. There is no
 *     field for page text, and the 2,000-character excerpt begins only after a
 *     session starts. A test asserts the shape so this cannot drift.
 *   - **Bounded twice** — by a rolling time window and by a hard row cap, so a
 *     day of browsing cannot accumulate into a profile.
 *   - **Discarded by default.** Declining an offer clears it. Accepting one
 *     folds it into the new session, where it becomes a normal, auditable
 *     ObservationEvent with the ordinary rules applying.
 *
 * ── Why "discarded" is the honest word ───────────────────────────────────
 *
 * `clear()` drops the reference. Node may hold the memory until it collects,
 * and this cannot promise otherwise — so it does not claim to erase, only to
 * forget. The stronger guarantee is the one above it: none of this was ever
 * written down.
 */

import { FAST_DETECT, WINDOW_MS } from '../domain/detection/detect'
import type { AmbientObservation, PauseDetected, WorkDetected } from '../domain/detection/detect'
import type { OfferGrounds } from '../domain/detection/grounds'
import type { ShiftOutcomeKind } from '../domain/execution/outcome-kinds'

/**
 * A hard ceiling independent of the window.
 *
 * The window alone is not a bound: a busy hour could hold thousands of rows and
 * still be "the last 30 minutes". This makes the worst case a number someone
 * can reason about.
 */
export const MAX_OBSERVATIONS = 500

/** Once declined, stay quiet about the same origin for this long. */
export const SNOOZE_MS = 60 * 60_000

/** A thread that has been named, keyed by the terms that defined it. */
export interface NamedThread {
  readonly signature: string
  readonly subject: string
  readonly confident: boolean
}

/**
 * What Propositum would do about a named thread, before anybody has said yes.
 *
 * ── In memory, and durable only on acceptance ────────────────────────────
 *
 * This never touches SQLite until a person accepts it, which is the same rule
 * the header above applies to ambient observations and it is there for the same
 * reason: a durable row saying "Propositum thought you were job-hunting" about
 * an offer NOBODY ACCEPTED is exactly the profile this buffer refuses to
 * become. Declining has to cost nothing and leave nothing behind, or the honest
 * thing to do with the feature is turn it off.
 *
 * ── It grants nothing ────────────────────────────────────────────────────
 *
 * Every field except `grounds` and `expects` is prose a model wrote, and
 * nothing reads any of it to decide anything. There is no field for a URL, a
 * host, an origin or a source id — the sites come from the buffer, keyed by
 * this thread's signature, on the accept path. See `boundaries/offer.ts`.
 */
export interface WorkOffer {
  readonly signature: string
  /** Recorded so an accepted offer can say which prompt composed it. */
  readonly promptVersion: string
  readonly title: string
  readonly rationale: string
  /** OfferOutline — ordered one-line intentions. Display only: these never
   *  become PlanSteps, and no gate reads them. */
  readonly outline: readonly string[]
  readonly produces: string
  /** What the offer says it will NOT do. `excludes` rather than CONTEXT.md's
   *  `willNotDo`, because the column that stores it on acceptance is already
   *  called `excludes` — one word for one concept, and the schema is the side
   *  that is harder to change. */
  readonly excludes: readonly string[]
  /** ShiftOutcomeKinds, already coerced against the closed set. A statement
   *  about the shape of a result, never about what may be done. */
  readonly expects: readonly ShiftOutcomeKind[]
  /** What the deterministic bar saw, frozen here because the buffer it was
   *  computed from is bounded by a window and a cap and will not hold the
   *  answer an hour later. */
  readonly grounds: OfferGrounds
  /** False when the reading did not add up to one thing worth doing. The
   *  interface must render that as vagueness rather than suppress it. */
  readonly confident: boolean
}

export interface AmbientStore {
  /** The name for this thread, if one has been produced. */
  nameFor(signature: string): NamedThread | null
  /** Record a name. Dropped if `clear()` ran while the call was in flight —
   *  see the implementation, and `startNaming` must precede it. */
  remember(named: NamedThread): void
  /** True while a naming call is actually in flight. For an interface that
   *  wants to say "working it out" rather than showing nothing. */
  isNaming(signature: string): boolean
  /**
   * True once naming has been ATTEMPTED at all — in flight, finished with a
   * name, or finished with nothing.
   *
   * This is the question the caller has to ask, and asking the other one is the
   * defect it replaced: `nameFor() || isNaming()` was false again the moment a
   * failed call cleared its marker, so a model that kept failing was re-called
   * on every 30-second poll, forever. Measured at about sixty retries.
   */
  attemptedNaming(signature: string): boolean
  startNaming(signature: string): void
  /** The attempt concluded with no name. Clears the in-flight marker and leaves
   *  the attempt recorded, so it is never made again for this thread. */
  finishNaming(signature: string): void

  /** The offer for this thread, if one has been composed. */
  offerFor(signature: string): WorkOffer | null
  /** Record an offer. Dropped if `clear()` ran while the call was in flight. */
  rememberOffer(signature: string, offer: WorkOffer): void
  /** True while a composing call is in flight. */
  isComposing(signature: string): boolean
  /** True once composing has been attempted at all. Same shape and same reason
   *  as `attemptedNaming` — a failure is a settled outcome, not a reason to
   *  ask the same model the same thing again in thirty seconds. */
  attemptedOffer(signature: string): boolean
  startComposing(signature: string): void
  /** The attempt concluded with no offer. */
  finishComposing(signature: string): void
  /** The pages that formed a thread, kept so accepting carries the THREAD
   *  rather than everything from the same sites. */
  rememberThread(signature: string, urls: readonly string[]): void
  pagesOfThread(signature: string): readonly string[]
  /** Observations for an explicit set of pages. */
  forUrls(urls: readonly string[], nowMs: number): readonly AmbientObservation[]
  /** Record one ambient observation. Trims by window and cap on the way in. */
  record(observation: AmbientObservation, nowMs: number): void
  /** Everything still inside the window, oldest first. */
  since(nowMs: number): readonly AmbientObservation[]
  /** Forget everything. Called on decline, on session start, and on stop. */
  clear(): void
  /** Stop offering for this origin until the snooze expires. */
  decline(origin: string, nowMs: number): void
  isSnoozed(origin: string, nowMs: number): boolean
  /** Observations for one origin, for folding into a session on accept. */
  forOrigin(origin: string, nowMs: number): readonly AmbientObservation[]
  size(): number
}

export function createAmbientStore(): AmbientStore {
  let observations: AmbientObservation[] = []
  const declined = new Map<string, number>()
  const names = new Map<string, NamedThread>()
  const naming = new Set<string>()
  const offers = new Map<string, WorkOffer>()
  const composing = new Set<string>()
  const threads = new Map<string, readonly string[]>()

  /**
   * Every thread a model has been asked about, whatever came back.
   *
   * Separate from the in-flight sets on purpose. "Is a call running" and "has a
   * call ever been made" are different questions, and conflating them is the
   * whole of the retry defect: the second one is what decides whether to spend
   * money, and it has to stay true after a failure clears the first.
   */
  const attemptedNames = new Set<string>()
  const attemptedOffers = new Set<string>()

  const trim = (nowMs: number) => {
    observations = observations.filter((o) => nowMs - o.at <= WINDOW_MS)
    if (observations.length > MAX_OBSERVATIONS) {
      // Drop the oldest. Recent activity is what a detection is about.
      observations = observations.slice(observations.length - MAX_OBSERVATIONS)
    }
  }

  return {
    record(observation, nowMs) {
      observations.push(observation)
      trim(nowMs)
    },

    since(nowMs) {
      trim(nowMs)
      return observations
    },

    /**
     * Forget everything, and mean everything.
     *
     * This used to drop the observations and keep the names — so a subject
     * Propositum had worked out about somebody survived the session start that
     * was supposed to fold it in, and would have survived a decline. With a
     * composed offer in here too, that gap stops being untidy: an offer is a
     * paragraph about what somebody appeared to be doing, and one that outlives
     * "no thanks" is the profile this whole object refuses to become.
     *
     * The attempt memory goes with it, and that is right rather than a
     * loophole. It exists to stop the SAME still-detected thread being asked
     * about on every poll; a clear only happens when a person has started a
     * session or turned an offer down, and whatever browsing comes afterwards
     * is genuinely new.
     */
    clear() {
      observations = []
      names.clear()
      naming.clear()
      offers.clear()
      composing.clear()
      attemptedNames.clear()
      attemptedOffers.clear()
      threads.clear()
    },

    decline(origin, nowMs) {
      declined.set(origin, nowMs)
      // Declining is also a statement that what was seen was not work. Keeping
      // it would mean the next detection fires off the same evidence.
      observations = observations.filter((o) => o.origin !== origin)
    },

    isSnoozed(origin, nowMs) {
      const at = declined.get(origin)
      return at !== undefined && nowMs - at < SNOOZE_MS
    },

    forOrigin(origin, nowMs) {
      trim(nowMs)
      return observations.filter((o) => o.origin === origin)
    },

    rememberThread(signature, urls) {
      threads.set(signature, [...urls])
    },
    pagesOfThread: (signature) => threads.get(signature) ?? [],
    forUrls(urls, nowMs) {
      trim(nowMs)
      const wanted = new Set(urls)
      return observations.filter((o) => wanted.has(o.url))
    },

    nameFor: (signature) => names.get(signature) ?? null,
    /**
     * Record a name, unless the buffer was forgotten while the call was in
     * flight.
     *
     * A model call takes about fifteen seconds and a person can decline or
     * start a session inside that. `clear()` empties the in-flight marker along
     * with everything else, so its absence here means exactly one thing: this
     * result is about a buffer that no longer exists, and writing it would put
     * a subject back that somebody has just been promised was thrown away.
     */
    remember(named) {
      if (!naming.has(named.signature)) return
      names.set(named.signature, named)
      naming.delete(named.signature)
      attemptedNames.add(named.signature)
    },
    isNaming: (signature) => naming.has(signature),
    attemptedNaming: (signature) => attemptedNames.has(signature),
    startNaming(signature) {
      naming.add(signature)
      attemptedNames.add(signature)
    },
    finishNaming(signature) {
      naming.delete(signature)
      attemptedNames.add(signature)
    },

    offerFor: (signature) => offers.get(signature) ?? null,
    /** Dropped when the buffer was forgotten mid-call, for the reason given on
     *  `remember` — and it matters more here, because an offer says more about
     *  a person than a name does. */
    rememberOffer(signature, offer) {
      if (!composing.has(signature)) return
      offers.set(signature, offer)
      composing.delete(signature)
      attemptedOffers.add(signature)
    },
    isComposing: (signature) => composing.has(signature),
    attemptedOffer: (signature) => attemptedOffers.has(signature),
    startComposing(signature) {
      composing.add(signature)
      attemptedOffers.add(signature)
    },
    finishComposing(signature) {
      composing.delete(signature)
      attemptedOffers.add(signature)
    },

    size: () => observations.length,
  }
}

/** The identity of a thread, for caching a name against it. Terms are already
 *  ordered by how often they recur, so the same subject followed longer keeps
 *  the same signature until its shape genuinely changes. */
export function signatureOf(terms: readonly string[]): string {
  return terms.slice(0, 4).join('+')
}

/* ── the suggestion the person actually sees ───────────────────────────── */

/**
 * An offer, never an action.
 *
 * Detection produces one of these and stops. Starting a session and handing
 * over both remain human acts — `SessionPhase` says only a human act ends a
 * session, and the same reasoning applies to starting one. A product that
 * silently began recording because it thought you looked busy would be the
 * thing the founding brief's exclusion list was refusing.
 */
export type Suggestion =
  | {
      readonly kind: 'start-session'
      /** The primary site, for the source that gets approved on accept. */
      readonly origin: string
      /** Every site the thread runs through. */
      readonly origins: readonly string[]
      /** The recurring subject words. */
      readonly terms: readonly string[]
      /** The thread's signature. The only identifier a link may carry, and the
       *  key the accept path reads everything else off the buffer with. */
      readonly thread: string
      /** Present once the subject boundary has named the thread. Absent for the
       *  first poll or two, and absent for good when there is no API key. */
      readonly subject?: string | undefined
      /** Rendered verbatim. Says what was seen, never what it means. */
      readonly sentence: string
      readonly because: string
      readonly detected: WorkDetected
    }
  /**
   * The full offer: what Propositum would DO about what it saw, in its own
   * words, above the deterministic grounds that permitted it to ask.
   *
   * `start-session` above is the DEGRADED FORM of this, not a different
   * feature. When the grounds bar is not met, or no offer has been composed —
   * because composing takes about fifteen seconds, or because there is no API
   * key at all — the person still gets "you have been looking into X, across
   * three sites" and a button that starts watching. The feature degrades to
   * yesterday's behaviour rather than vanishing, which matters because a poll
   * that answers `null` is indistinguishable to the extension from detection
   * having failed.
   */
  | {
      readonly kind: 'work-offer'
      /** The signature — the ONLY thing a URL may carry. Everything else here
       *  is read back off the server-side buffer at acceptance. */
      readonly thread: string
      readonly subject: string
      readonly title: string
      readonly rationale: string
      readonly outline: readonly string[]
      readonly produces: string
      /** What it says it will NOT do. Shown on the offer screen and nowhere
       *  else — see `src/ui/offer.tsx` for why it must never appear beside the
       *  contract's enforced permissions. */
      readonly excludes: readonly string[]
      /** The deterministic grounds, rendered VERBATIM and ABOVE the model's
       *  sentence. The person's own facts first, the model's reading second. */
      readonly grounds: readonly string[]
      /** Shown, each individually untickable. Code-derived from the pages the
       *  thread ran through — never model-authored, never link-supplied. */
      readonly origins: readonly string[]
      readonly sentence: string
      readonly because: string
    }
  | {
      readonly kind: 'hand-off'
      readonly sentence: string
      readonly because: string
      readonly detected: PauseDetected
    }

/** Said out loud, because a suggestion produced under shortened test thresholds
 *  must not read like one produced by real work. */
const UNDER_TEST = FAST_DETECT ? ' (fast-detect is on — thresholds are 20× shorter than normal.)' : ''

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000))
  return `${m} minute${m === 1 ? '' : 's'}`
}

/** The hostname, as a person would say it. */
export function hostOf(origin: string): string {
  return origin.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * The offer, in the words the pages themselves used.
 *
 * This says WHAT RECURRED, not what it means: "General Intuition, across 3
 * sites", never "you are researching frontier world-model labs". Naming the
 * subject in a sentence a person would recognise needs a model, and that is a
 * separate decision — see ADR-0008.
 */
export function describeWork(
  detected: WorkDetected,
  threadSignature: string,
  named?: NamedThread | null,
): Suggestion {
  const words = detected.terms.slice(0, 3).join(' ')
  const sites = detected.origins.length
  const where = sites === 1 ? hostOf(detected.origins[0] ?? '') : `${sites} sites`

  const sentence =
    named && named.confident
      ? // Only when the model was sure. A confident wrong name is worse than an
        // honest vague one, and the vague one is still true.
        `Looks like you're working on ${named.subject}.`
      : words
        ? `You have been looking into ${words} — across ${where}.`
        : `You have been reading across ${where}.`

  return {
    kind: 'start-session',
    // The site the thread ran through most, for the source that gets approved.
    origin: detected.origins[0] ?? '',
    origins: detected.origins,
    terms: detected.terms,
    thread: threadSignature,
    ...(named ? { subject: named.subject } : {}),
    sentence,
    because:
      detected.because === 'searched-and-followed'
        ? `You searched for it, then read ${detected.pages} pages across ${where}.${UNDER_TEST}`
        : `${detected.pages} pages across ${where}, ${minutes(detected.engagedMs)} of reading.${UNDER_TEST}`,
    detected,
  }
}

/**
 * The offer, as the person will read it.
 *
 * The ordering of the fields here is the argument the screen makes. `grounds`
 * comes off the deterministic detector and is rendered above everything the
 * model wrote; `title` and `rationale` are the model's reading of those facts;
 * `excludes` is the half people read hardest and is the reason the model is
 * allowed to write prose at all.
 *
 * `origins` is code-derived from the pages the thread ran through. It is in the
 * suggestion so the screen can list what it is about to approve — NOT so a
 * caller can send it back. The accept path re-derives the same set from the
 * buffer and never takes one from its caller; see `observedOriginPatterns`.
 */
export function describeOffer(
  detected: WorkDetected,
  threadSignature: string,
  subject: string,
  offer: WorkOffer,
): Suggestion {
  const sites = detected.origins.length
  const where = sites === 1 ? hostOf(detected.origins[0] ?? '') : `${sites} sites`

  return {
    kind: 'work-offer',
    thread: threadSignature,
    subject,
    title: offer.title,
    rationale: offer.rationale,
    outline: offer.outline,
    produces: offer.produces,
    excludes: offer.excludes,
    grounds: offer.grounds.sentences,
    origins: detected.origins,
    sentence: `Looks like you're working on ${subject}.`,
    because: `${detected.pages} pages across ${where}, ${minutes(detected.engagedMs)} of reading.${UNDER_TEST}`,
  }
}

export function describePause(detected: PauseDetected): Suggestion {
  return {
    kind: 'hand-off',
    sentence: 'You have stepped away.',
    because: `${minutes(detected.workedMs)} of work, then quiet for ${minutes(detected.idleForMs)}.${UNDER_TEST}`,
    detected,
  }
}
