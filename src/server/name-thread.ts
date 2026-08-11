/**
 * Putting a name to a detected thread, without making anyone wait for it.
 *
 * ── Never on the request path ────────────────────────────────────────────
 *
 * The extension polls every 30 seconds and a real model call takes about 15.
 * Naming inline would make a poll that exists to be cheap into the slowest
 * thing the extension does, and a failed call would take the offer down with
 * it.
 *
 * So the poll returns the deterministic offer immediately and starts naming in
 * the background. The next poll serves the named version. The person sees
 * "you have been looking into general intuition — across 3 sites" for up to
 * thirty seconds, then "General Intuition" with an offer to act on it. Both are
 * true; the second is better.
 *
 * ── One call per thread, ever ────────────────────────────────────────────
 *
 * Keyed on the thread's terms. A subject followed for an hour is named once,
 * and an in-flight marker stops two polls racing to name the same thing.
 *
 * A failure is remembered as "no name", not retried forever — a model that
 * cannot name a thread now will not do better in thirty seconds, and the
 * deterministic offer is a perfectly good fallback.
 */

import { datamark } from '../model/untrusted'
import { offerableOf, subjectBoundary } from '../model/boundaries/subject'
import type { ModelClient } from '../model/client'
import type { WorkDetected } from '../domain/detection/detect'
import { signatureOf } from './ambient-store'
import type { AmbientStore } from './ambient-store'

/** Titles are page-authored, so every one crosses the datamark door. */
export async function nameThread(
  store: AmbientStore,
  model: ModelClient,
  detected: WorkDetected,
): Promise<void> {
  const signature = signatureOf(detected.terms)
  if (store.nameFor(signature) || store.isNaming(signature)) return

  store.startNaming(signature)

  try {
    const outcome = await model.run(subjectBoundary, {
      terms: detected.terms,
      titles: detected.titles.slice(0, 12).map((t) => datamark(t)),
      searches: [],
      siteCount: detected.origins.length,
    })

    if (!outcome.ok) {
      // Remembered as unnameable rather than retried. The deterministic offer
      // stands, and it is not wrong — only less specific.
      store.finishNaming(signature)
      return
    }

    const named = outcome.value
    store.remember({
      signature,
      subject: named.subject,
      confident: named.confident,
      offer: offerableOf(named.offer),
      offerLabel: named.offerLabel,
    })
  } catch {
    store.finishNaming(signature)
  }
}
