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
  readonly offer: string
  readonly offerLabel: string
}

/**
 * A composed offer, held against the thread it was composed for.
 *
 * Held in memory beside the observations for the same reason they are: nothing
 * here is durable until somebody accepts. A `WorkOffer` row is written at
 * acceptance and not before, so an offer nobody answered leaves no trace of
 * having been made — which is the difference between a product that noticed
 * something and a product that kept a file on you.
 *
 * There is deliberately no field here for a site. `ContractScope`'s sources are
 * derived from the buffer by deterministic code; see ADR-0009 §1 and
 * `src/model/boundaries/offer.ts`.
 */
export interface ComposedOffer {
  readonly signature: string
  readonly promptVersion: string
  readonly title: string
  readonly rationale: string
  readonly outline: readonly string[]
  readonly produces: string
  readonly excludes: readonly string[]
  /** ShiftOutcomeKinds, already coerced against the closed set. */
  readonly expects: readonly string[]
  /** The deterministic grounds this offer was allowed to be composed on,
   *  frozen with it so the screen and the durable row cannot disagree. */
  readonly grounds: readonly string[]
  readonly groundKinds: readonly string[]
}

export interface AmbientStore {
  /** The name for this thread, if one has been produced. */
  nameFor(signature: string): NamedThread | null
  remember(named: NamedThread): void
  /** True if naming is already in flight for this thread, so a poll every 30
   *  seconds cannot start a second call for the same subject. */
  isNaming(signature: string): boolean
  startNaming(signature: string): void
  finishNaming(signature: string): void
  /** The composed offer for this thread, if one has been produced. */
  offerFor(signature: string): ComposedOffer | null
  rememberOffer(offer: ComposedOffer): void
  /**
   * Same in-flight marker as naming, for the same reason: the poll runs every
   * 30 seconds and composing takes about 15.
   *
   * `compose-offer.ts` deliberately does NOT clear this on a failure, so the
   * marker doubles as "a call has already been made for this thread". Clearing
   * it there is how one thread the model keeps declining becomes a paid call
   * every thirty seconds. `finishComposing` therefore has no caller on the
   * unhappy path by design; it exists for a caller that genuinely wants a
   * retry to be possible, and there is not one yet.
   */
  isComposing(signature: string): boolean
  startComposing(signature: string): void
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
  const threads = new Map<string, readonly string[]>()
  const offers = new Map<string, ComposedOffer>()
  const composing = new Set<string>()

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
     * Forget everything — and everything means everything.
     *
     * This used to drop only the observations, leaving the names, the threads
     * and (once offers existed) the composed offer behind. That is a stale
     * offer waiting to be served against a thread whose evidence has been
     * thrown away: `/start?thread=…` would render somebody else's proposal over
     * an empty buffer, and the accept path would then refuse it with "there is
     * nothing for it to go on" — a screen that argues with itself.
     *
     * Called on decline, on session start and on stop. In every one of those
     * the person has drawn a line under what was seen, so the derived things
     * have no standing either.
     */
    clear() {
      observations = []
      names.clear()
      naming.clear()
      threads.clear()
      offers.clear()
      composing.clear()
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
    remember(named) {
      names.set(named.signature, named)
      naming.delete(named.signature)
    },
    isNaming: (signature) => naming.has(signature),
    startNaming(signature) {
      naming.add(signature)
    },
    finishNaming(signature) {
      naming.delete(signature)
    },

    offerFor: (signature) => offers.get(signature) ?? null,
    rememberOffer(offer) {
      offers.set(offer.signature, offer)
      composing.delete(offer.signature)
    },
    isComposing: (signature) => composing.has(signature),
    startComposing(signature) {
      composing.add(signature)
    },
    finishComposing(signature) {
      composing.delete(signature)
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
  offer: ComposedOffer,
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
    grounds: offer.grounds,
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
