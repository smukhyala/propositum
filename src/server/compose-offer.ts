/**
 * Composing what Propositum would do, without making anyone wait for it.
 *
 * ── The same shape as naming, one bar higher ─────────────────────────────
 *
 * `name-thread.ts` explains why this cannot happen on the request path: the
 * extension polls every 30 seconds, a real model call takes about 15, and a
 * failed call must not take the offer down with it. All of that applies here
 * unchanged, so this is deliberately the same shape — fire into the background,
 * cache against the thread signature, serve the composed version on a later
 * poll, and degrade to the deterministic offer in the meantime.
 *
 * What is different is the gate in front of it. Naming runs the moment
 * `detectWork` fires, because the cost of a wrong subject line is a sentence
 * nobody agrees with. Composing runs only once `OfferGrounds.sufficient` — one
 * intent ground and two investment grounds, arithmetic, no model — because the
 * cost of a wrong offer is a person's attention spent ratifying something, and
 * then their sources and their Chrome. ADR-0009 §2.
 *
 * ── One call per thread, ever — and "ever" includes the failures ─────────
 *
 * Keyed on the same signature the name is keyed on. A subject followed for an
 * hour is composed for once, and the in-flight marker stops two polls racing.
 *
 * A failure is remembered as "no offer" rather than retried, and the mechanism
 * is that the marker is DELIBERATELY NOT CLEARED on any unsuccessful path. An
 * earlier version cleared it, which read as tidy and meant that a thread the
 * model kept declining — or one where it kept naming outcome kinds outside the
 * closed set — fired a fresh fifteen-second paid call every thirty seconds for
 * as long as the thread survived the buffer's window. A model that cannot
 * compose an offer now will not do better in half a minute, and the degraded
 * `start-session` form is a perfectly good fallback that ships today.
 *
 * `clear()` wipes the marker along with everything else, which is right: the
 * person declined, or started a session, and the next thread is a new question.
 */

import { datamark } from '../model/untrusted'
import { offerBoundary, outcomeKindsOf } from '../model/boundaries/offer'
import type { ModelClient } from '../model/client'
import type { OfferGrounds } from '../domain/detection/grounds'
import type { WorkDetected } from '../domain/detection/detect'
import { signatureOf } from './ambient-store'
import type { AmbientStore } from './ambient-store'

/** Titles are page-authored, so every one crosses the datamark door. */
export async function composeOffer(
  store: AmbientStore,
  model: ModelClient,
  detected: WorkDetected,
  subject: string,
  grounds: OfferGrounds,
): Promise<void> {
  const signature = signatureOf(detected.terms)
  if (store.offerFor(signature) || store.isComposing(signature)) return

  // The bar, restated at the call site rather than only at the caller's. This
  // function is the one thing in the codebase that can turn observation into a
  // proposal to act, and a guard that lives only in its caller is a guard the
  // next caller will not have.
  if (!grounds.sufficient) return

  store.startComposing(signature)

  try {
    const outcome = await model.run(offerBoundary, {
      terms: detected.terms,
      subject,
      titles: detected.titles.slice(0, 12).map((t) => datamark(t)),
      grounds: grounds.sentences,
      siteCount: detected.origins.length,
    })

    // The marker stays set on every path below that does not remember an
    // offer. See the header: clearing it is how one declined thread becomes a
    // paid call every thirty seconds.
    if (!outcome.ok) return

    /**
     * Is the evidence this was composed from still there?
     *
     * Fifteen seconds is long enough for the person to have declined, or to
     * have accepted the degraded offer and started a session — both of which
     * call `clear()`. Writing the offer in anyway would resurrect a proposal
     * built on observations that have been thrown away, and because the route
     * will not recompose once an offer exists, that resurrected offer and its
     * frozen grounds would go on describing a sitting nobody is having.
     *
     * `pagesOfThread` is emptied by the same `clear()`, so its absence is the
     * cheapest available proof that the line has been drawn.
     */
    if (store.pagesOfThread(signature).length === 0) return

    const composed = outcome.value
    const expects = outcomeKindsOf(composed.expects)

    // A model that named no recognisable outcome kind has not said what this
    // would produce, and the contract template is picked from that answer. An
    // offer with nothing to pick from is dropped rather than defaulted: a
    // default here would be code quietly deciding the shape of the work.
    if (expects.length === 0) return

    store.rememberOffer({
      signature,
      promptVersion: offerBoundary.promptVersion,
      title: composed.title,
      rationale: composed.rationale,
      outline: composed.outline,
      produces: composed.produces,
      excludes: composed.excludes,
      expects,
      grounds: grounds.sentences,
      groundKinds: grounds.kinds,
    })
  } catch {
    // Also deliberately leaves the marker set. A thread that threw once will
    // throw again, and this runs unattended on a thirty-second timer.
  }
}
