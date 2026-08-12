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
 * ── One call per thread, ever ────────────────────────────────────────────
 *
 * Keyed on the same signature the name is keyed on. A subject followed for an
 * hour is composed for once, and an in-flight marker stops two polls racing.
 * A failure is remembered as "no offer" rather than retried forever: a model
 * that cannot compose one now will not do better in thirty seconds, and the
 * degraded `start-session` form is a perfectly good fallback that ships today.
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

    if (!outcome.ok) {
      store.finishComposing(signature)
      return
    }

    const composed = outcome.value
    const expects = outcomeKindsOf(composed.expects)

    // A model that named no recognisable outcome kind has not said what this
    // would produce, and the contract template is picked from that answer. An
    // offer with nothing to pick from is dropped rather than defaulted: a
    // default here would be code quietly deciding the shape of the work.
    if (expects.length === 0) {
      store.finishComposing(signature)
      return
    }

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
    store.finishComposing(signature)
  }
}
