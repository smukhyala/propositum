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
 * ── One call per thread, ever — including the failures ───────────────────
 *
 * Keyed on the thread's terms. A subject followed for an hour is named once,
 * and an in-flight marker stops two polls racing to name the same thing.
 *
 * The failure half of that sentence was a lie until now, and the bug is worth
 * writing down because it is easy to write again. The guard asked
 * `nameFor() || isNaming()`, and a failed call cleared its in-flight marker
 * WITHOUT recording anything — so the guard was false again immediately and the
 * next poll re-fired. A model that kept failing was therefore called on every
 * poll for as long as the thread stayed detectable: about sixty calls, from a
 * fire-and-forget `void` on a request path with no backoff and nowhere for an
 * error to surface. `attemptedNaming` is the fix, and it is a different
 * question from `isNaming` on purpose.
 *
 * A naming failure is a NORMAL OUTCOME, not an error. The person simply gets
 * the degraded form — the deterministic sentence, which is vaguer and always
 * true — and a model that cannot name this thread now will not do better in
 * thirty seconds.
 */

import { datamark } from '../model/untrusted'
import { subjectBoundary } from '../model/boundaries/subject'
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
  // Attempted, not named: one question covers the poll that would race a call
  // in flight and the poll that would retry one that already failed.
  if (store.attemptedNaming(signature)) return

  store.startNaming(signature)

  try {
    const outcome = await model.run(subjectBoundary, {
      terms: detected.terms,
      titles: detected.titles.slice(0, 12).map((t) => datamark(t)),
      searches: [],
      siteCount: detected.origins.length,
    })

    if (!outcome.ok) {
      // Remembered as unnameable rather than retried. The deterministic
      // sentence stands, and it is not wrong — only less specific.
      store.finishNaming(signature)
      return
    }

    const named = outcome.value
    store.remember({
      signature,
      subject: named.subject,
      confident: named.confident,
    })
  } catch {
    // A thrown error is the same outcome as a returned failure as far as the
    // person is concerned, and it gets the same treatment: settled, no name,
    // no retry. Nothing above this call is waiting for a reason.
    store.finishNaming(signature)
  }
}
