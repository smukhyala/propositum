/**
 * Working out what to offer to do, without making anyone wait for it.
 *
 * A direct mirror of `name-thread.ts`, and deliberately so: same background
 * shape, same once-per-signature cache, same in-flight marker, same treatment
 * of failure. What differs is the bar in front of it and what comes out.
 *
 * ── Never on the request path ────────────────────────────────────────────
 *
 * The extension polls every thirty seconds and a real call takes about fifteen.
 * Composing inline would make the cheapest thing the extension does into the
 * slowest, and a failed call would take the deterministic suggestion down with
 * it. So the poll answers immediately with whatever exists, and a later poll
 * carries the offer.
 *
 * ── A higher bar than naming, and it is arithmetic ───────────────────────
 *
 * `detectWork` decides whether Propositum may SAY something. `OfferGrounds`
 * decides whether it may offer to DO something, and the difference is the point
 * of ADR-0009: at least one intent ground and at least two investment ones, no
 * model involved. The check runs BEFORE the attempt is recorded, because
 * grounds accumulate — a thread that is not yet worth an offer at 14:03 may be
 * at 14:20, and marking it attempted on the way past the bar would mean the
 * offer never comes.
 *
 * ── The defect this file does not inherit ────────────────────────────────
 *
 * `name-thread.ts` cleared its in-flight marker on failure and recorded
 * nothing, so a failing model was re-called on every poll, forever. That is
 * fixed there and must never be reproduced here — which is why the guard asks
 * `attemptedOffer`, a question that stays true after a failure, rather than
 * `offerFor() || isComposing()`, which does not.
 *
 * A failure is a NORMAL OUTCOME rather than an error. The person gets the
 * degraded form — the deterministic suggestion, which says what was seen and
 * offers to start a session about it — and nothing above this call is waiting
 * to be told why.
 *
 * ~~The cost of that, said out loud: a thirty-second network outage settles the
 * thread the same way a refusal does, and it stays settled. It is deliberate.
 * The alternative is a retry budget, and a retry budget on a thirty-second poll
 * is how the sixty-call bug happened in the first place — it would have to be
 * bounded, backed off, and keyed per signature, which is three mechanisms to
 * recover an offer the person can get anyway by carrying on reading past the
 * next clear. Revisit it if transport failures turn out to be common enough to
 * notice.~~
 *
 * **Amended 2026-08-16 — that cost was paid, and it was too high.** The revisit
 * condition met itself on the first real afternoon: `model_call_record` holds
 * `offer | claude-opus-5 | 11179ms | transport` against a thread somebody was
 * genuinely working on, and that thread never got an offer, with nothing on
 * screen to say why. The paragraph above treats every `!outcome.ok` as the same
 * event, and it is not one event. **A refusal, a truncation and a schema
 * mismatch are ANSWERS** — the model was asked and this is what came back, and
 * settling them is the argument above, unchanged and still correct. **A
 * transport failure is not an answer at all**; the question never arrived.
 * Recording "the model had nothing to offer" about a call the model never saw
 * is the only kind of wrong this file can be that nobody can detect from the
 * outside.
 *
 * So `answered()` splits the two, and a call that did not complete gets exactly
 * one more — see `COMPOSE_ATTEMPTS`. The old paragraph's fear was three
 * mechanisms; this is one, and it is a bound rather than a budget.
 *
 * ── The mirror with `name-thread.ts` is now broken, on purpose ────────────
 *
 * `nameThread` still settles a transport failure permanently, and this file no
 * longer does. That is a real inconsistency between two files whose whole
 * design was "the same shape twice", and it is written down here rather than
 * left to be discovered. The reason it is tolerable in this direction: naming's
 * degraded form is a sentence that is merely vaguer, while this one's is the
 * absence of the feature ADR-0009 exists for. The reason it is still owed:
 * nothing about a lost packet cares which boundary it lost.
 *
 * ── What is written down, and when ───────────────────────────────────────
 *
 * A `WorkOffer` lives in memory only. It reaches SQLite when, and only when, a
 * person accepts it. The rule is ADR-0008's, applied to the same kind of thing
 * for the same reason: a durable row saying "Propositum thought you were
 * job-hunting" about an offer nobody accepted is exactly the profile the
 * ambient buffer refuses to become.
 */

import { datamark } from '../model/untrusted'
import { offerBoundary, outcomeKindsOf } from '../model/boundaries/offer'
import type { FailureKind, ModelClient } from '../model/client'
import { PRODUCIBLE } from '../domain/outcome/shift-outcome'
import { threadPagesOf } from '../domain/detection/detect'
import { groundsFor } from '../domain/detection/grounds'
import { QUERY_PARAMS } from '../capture/url'
import type { AmbientObservation, WorkDetected } from '../domain/detection/detect'
import { signatureOf } from './ambient-store'
import type { AmbientStore, NamedThread } from './ambient-store'

/** Titles are shown twelve at a time — enough for a subject to be legible,
 *  short of the point where a long afternoon starts to read as a dossier. */
const TITLES_SHOWN = 12

/** Searches are the clearest statement of intent available without asking, and
 *  also the most personal thing in the buffer. Six of them. */
const SEARCHES_SHOWN = 6

/**
 * How many times one thread's offer may be ASKED FOR, in total, ever.
 *
 * Two, and the second only when the first did not complete. The bound is the
 * whole of the design, so it is a number here rather than a policy somewhere:
 * this function is fired by a poll loop, from a fire-and-forget `void`, with
 * nowhere for an error to surface, against an API that charges per call. An
 * unbounded retry on that path is strictly worse than the bug it fixes — that
 * is the sixty-call defect the header describes, and sixty calls is a real
 * invoice.
 *
 * Thirty seconds is the FLOOR, not the interval. The service worker's heartbeat
 * alarm is `HEARTBEAT_MINUTES = 0.5`, and the extension's panel calls
 * `/api/session/current` again every time somebody opens it — which is not on
 * any timer at all. So "how often can this be re-entered" has no upper bound
 * worth writing down, and that is precisely why the bound here is a COUNT
 * against the signature rather than a cooldown against the clock. A cooldown
 * would also need a clock, and this file is on the poll path.
 *
 * A count against the signature is not by itself a count against a PERSON's
 * afternoon: `clear()` forgets the signature along with everything else, so the
 * count restarts. That is right — a clear is somebody having accepted or
 * declined, and what follows is genuinely new browsing — but it means the
 * attempts of an invocation started before the clear must not be spent after
 * it. See the loop below, which is where that goes wrong if nothing stops it.
 *
 * Two rather than three because the second attempt is not cheap and its odds
 * are not independent: the first one already spent the SDK's own backoff (the
 * observed failure took 11.2 seconds before giving up), so a transport failure
 * that survives both attempts is an outage rather than a blip, and an outage is
 * not waited out one poll at a time. If both fail the thread settles exactly as
 * an answer would, and the person gets the deterministic suggestion — which is
 * less than this would have said and is never wrong.
 */
const COMPOSE_ATTEMPTS = 2

/**
 * Did the model ANSWER, or did the call not arrive?
 *
 * The distinction the retry turns on, and the reason it reads `FailureKind`
 * rather than inventing a second vocabulary beside it: `client.ts` already
 * classifies every failure by `stop_reason` before any parse, and a parallel
 * taxonomy here would be a second place for the same four words to mean
 * something slightly different.
 *
 * An answer is terminal. `refusal` is the model deciding; `truncation` is the
 * model answering and running out of room, and a bigger budget is not this
 * call's decision to make; `schema-mismatch` is a well-formed answer of the
 * wrong shape, which the client already spent its one repair turn on. Asking
 * again asks the same model the same thing.
 *
 * `transport` is network or 5xx — the call did not complete, so there is no
 * answer to settle. Note the deliberate disagreement with `recoveryFor`, which
 * returns `'none'` for `transport`: that function is about whether the CLIENT
 * should re-issue the HTTP request inside one call, and it is right that it
 * should not, because the SDK is already backing off in there. This is a
 * different question one level up — whether a thread that was never actually
 * asked should be marked as having been asked — and it has a different answer.
 *
 * Exhaustive with no `default`, so a fifth `FailureKind` is a type error here
 * rather than a silent retry.
 */
function answered(failure: FailureKind): boolean {
  switch (failure) {
    case 'refusal':
      return true
    case 'truncation':
      return true
    case 'schema-mismatch':
      return true
    case 'transport':
      return false
  }
}

/**
 * What they typed into a search box, and only when it was about this.
 *
 * Two rules, and both are about what leaves the machine rather than about the
 * prompt reading well.
 *
 * **It has to be a real search.** `kind === 'query'` is set by the extension
 * for any URL with a `?` in it, so a link carrying `?utm_source=` arrives
 * claiming to be one. The term has to be in a parameter `cleanUrl` kept, which
 * is the closed list of things search boxes actually use.
 *
 * **It has to be about the thread.** This reads the whole window rather than
 * only the pages that joined the thread — a results page often does not join
 * one — so the overlap check is doing real work: the unrelated search that
 * happened in the same half hour, the one about a diagnosis, the one about a
 * new job, never leaves this function. That is the filter, and the thread's
 * own words are what it is against.
 */
function searchesIn(
  observations: readonly AmbientObservation[],
  terms: readonly string[],
): readonly string[] {
  const wanted = new Set(terms)
  const found: string[] = []

  for (const observation of observations) {
    if (observation.kind !== 'query') continue

    let typed = ''
    try {
      const params = new URL(observation.url).searchParams
      for (const key of QUERY_PARAMS) {
        const value = params.get(key)
        if (value !== null && value.trim() !== '') {
          typed = value.trim()
          break
        }
      }
    } catch {
      continue
    }

    if (typed === '') continue

    const words = typed.toLowerCase().split(/[^a-z0-9]+/)
    if (!words.some((w) => wanted.has(w))) continue
    if (found.includes(typed)) continue

    found.push(typed)
  }

  return found.slice(0, SEARCHES_SHOWN)
}

/**
 * Compose the offer for a named thread, or settle on there not being one.
 *
 * Everything page-authored crosses the datamark door on the way in, including
 * the subject — which was itself composed from titles, and does not become
 * trusted by having been through a model.
 */
export async function composeOffer(
  store: AmbientStore,
  model: ModelClient,
  detected: WorkDetected,
  named: NamedThread,
  /**
   * The clock, passed in rather than read.
   *
   * Optional and last, so the caller on the poll path says nothing about time
   * and gets the wall clock. It exists because the ambient buffer trims
   * relative to "now" — a fixture forty minutes long would otherwise be empty
   * by the time the grounds were computed, and the bar would be untestable at
   * exactly the point it matters most.
   */
  nowMs: number = Date.now(),
): Promise<void> {
  const signature = signatureOf(detected.terms)

  /**
   * The thread's own pages, rebuilt the way the detector built them.
   *
   * `groundsFor` measures per-page facts — arrival counts, per-page dwell, term
   * sets — which `WorkDetected` does not carry because it has to survive being
   * serialised into a poll response. `threadPagesOf` rebuilds them from the
   * same buffer, windowed the same way and narrowed to the URLs the thread was
   * actually made of, so the two views cannot disagree.
   */
  const pages = threadPagesOf(store.since(nowMs), detected, nowMs)
  const grounds = groundsFor(detected, pages)

  // The bar, before the memory. See the header: recording an attempt here would
  // silence a thread that has not yet earned an offer but is about to.
  if (!grounds.sufficient) return

  // One question, covering both the poll that would race a call in flight and
  // the poll that would retry one that already failed.
  if (store.attemptedOffer(signature)) return

  /**
   * Which buffer this invocation is about, taken before anything is sent.
   *
   * Read here rather than asked for later because every marker this function
   * could otherwise consult is emptied by `clear()` and can be set again by the
   * next poll — see `AmbientStore.generation`. This is the only value in scope
   * that a `clear()` cannot make true again.
   */
  const buffer = store.generation()

  store.startComposing(signature)

  try {
    // The whole window, not only the thread's pages: a results page frequently
    // does not join the thread it started, and the overlap check inside is what
    // keeps an unrelated search out.
    const searches = searchesIn(store.since(nowMs), detected.terms)

    const input = {
      terms: detected.terms,
      titles: detected.titles.slice(0, TITLES_SHOWN).map((t) => datamark(t)),
      searches: searches.map((s) => datamark(s)),
      subject: datamark(named.subject),
      siteCount: detected.origins.length,
      pageCount: detected.pages,
      readingMinutes: Math.max(1, Math.round(detected.engagedMs / 60_000)),
      grounds: grounds.sentences,
      producible: PRODUCIBLE,
    }

    /**
     * The retry, and where it is NOT.
     *
     * It is here — between `startComposing` and the settle, inside the marker's
     * own critical section — rather than across polls, and that placement is
     * the entire concurrency argument. `startComposing` adds to `attemptedOffers`
     * SYNCHRONOUSLY, before the first `await` in this function, so every other
     * poll that reaches `composeOffer` for this signature returns at the
     * `attemptedOffer` guard above and never gets here. This loop awaits each
     * attempt in turn, so the two calls are sequential and never concurrent, and
     * it clears nothing on the way round — the alternative design, letting a
     * transport failure un-set `attemptedOffer` so the next poll re-enters, is
     * the one that would reopen the race the two markers exist to close, and it
     * would reopen it against a paid API on a few-second timer.
     *
     * ~~The ceiling is therefore `COMPOSE_ATTEMPTS` calls per signature per
     * buffer lifetime, no matter how many pollers ask, and a `clear()` is the
     * only thing that resets it — which is a person having accepted or
     * declined.~~
     *
     * **Corrected 2026-08-16. That sentence was false in both halves, and the
     * second attempt is the reason.** A `clear()` does not RESET the count, it
     * un-latches `attemptedOffers` while this invocation is still inside its
     * loop — so a poll thirty seconds later starts a fresh budget of two
     * alongside a retry that has not fired yet. Measured at four calls for one
     * signature. And the first half was worse than wrong: a `clear()` is a
     * person having ACCEPTED an offer or turned one down, and the retry fired a
     * new outbound call afterwards, carrying `input` — their page titles, their
     * typed searches, the subject composed from both — about a buffer they had
     * just been told was thrown away. Everything else in this design refuses to
     * leave a TRACE of a forgotten buffer (`rememberOffer` and `finishComposing`
     * both drop results for exactly that reason); this made a fresh transmission
     * of one, which is strictly stronger, and it was new behaviour rather than
     * something the retry inherited — before the retry there was no second call
     * to make.
     *
     * So the loop asks `store.generation()`, and so does everything after it.
     * The ceiling that IS true: `COMPOSE_ATTEMPTS` calls per signature per
     * buffer — where a buffer ends at a `clear()` — no matter how many pollers
     * ask, and a call in flight when one lands neither continues nor writes.
     *
     * Nothing sleeps between attempts. The pause has already happened: the SDK
     * backs off inside the call that failed, which is why the observed transport
     * failure took 11.2 seconds rather than milliseconds. A timer here would be
     * a second backoff stacked on a first, and `recoveryFor` is explicit that
     * stacking them hides the real error behind a timeout.
     */
    let outcome = await model.run(offerBoundary, input)
    let attempts = 1

    while (
      attempts < COMPOSE_ATTEMPTS &&
      !outcome.ok &&
      !answered(outcome.failure) &&
      store.generation() === buffer
    ) {
      attempts += 1
      outcome = await model.run(offerBoundary, input)
    }

    /**
     * The buffer this was about is gone. Leave, touching nothing.
     *
     * Not `finishComposing`, which is the tempting one and is wrong twice. Its
     * own guard already makes it a no-op after a plain `clear()`, so on the
     * simple path it buys nothing; and after a clear-then-refill it is actively
     * destructive, because `composing` holds the SECOND invocation's marker by
     * then and deleting it would silently drop an offer somebody is owed. The
     * success path is worse still: `rememberOffer` would write an offer
     * composed from a forgotten afternoon into a buffer that is about something
     * else entirely.
     *
     * This is `finishComposing`'s own doctrine applied one level up — a result
     * about a buffer nobody holds any more must leave no trace at all.
     */
    if (store.generation() !== buffer) return

    if (!outcome.ok) {
      // Settled as "no offer" rather than retried. Either the model answered —
      // declined, ran out of room, or produced the wrong shape — or the call
      // failed to arrive `COMPOSE_ATTEMPTS` times, which is an outage rather
      // than a blip. The deterministic suggestion stands: it says what was seen,
      // which is less than this would have said and is never wrong.
      store.finishComposing(signature)
      return
    }

    const composed = outcome.value
    store.rememberOffer(signature, {
      signature,
      promptVersion: offerBoundary.promptVersion,
      title: composed.title,
      rationale: composed.rationale,
      outline: composed.outline,
      produces: composed.produces,
      excludes: composed.excludes,
      // The closed set is applied here, in code. The grammar carries it to the
      // model as prose and enforces nothing.
      expects: outcomeKindsOf(composed.outcomeKinds),
      grounds,
      confident: composed.confident,
    })
  } catch {
    /**
     * A throw is settled, and it is NOT folded into the transport retry above.
     *
     * `client.ts` is explicit that `run()` does not throw for model failures —
     * a transport error arrives as `{ ok: false, failure: 'transport' }`, which
     * is the path that now gets a second attempt. What reaches here instead is
     * "programmer error — a boundary that cannot be built at all", plus
     * whatever the client itself failed to catch. Retrying that means retrying
     * something nobody has classified, on the same paid path, and a bug that
     * throws deterministically would throw twice.
     *
     * So: settled, no offer, no retry, and nothing above this call is waiting
     * to be told why. If a real transport failure ever starts arriving here
     * instead, the fix belongs in the client, where the classification lives.
     *
     * The generation check is the same one the loop makes, for the same reason:
     * a throw arriving after a `clear()` must not settle a signature that now
     * belongs to a later buffer's poll. Settling somebody else's in-flight call
     * as failed is how a thread becomes permanently unofferable with nothing
     * saying why — see `finishNaming`, which was bitten by exactly that.
     */
    if (store.generation() !== buffer) return
    store.finishComposing(signature)
  }
}
