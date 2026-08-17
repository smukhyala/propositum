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
 * The cost of that, said out loud: a thirty-second network outage settles the
 * thread the same way a refusal does, and it stays settled. It is deliberate.
 * The alternative is a retry budget, and a retry budget on a thirty-second poll
 * is how the sixty-call bug happened in the first place — it would have to be
 * bounded, backed off, and keyed per signature, which is three mechanisms to
 * recover an offer the person can get anyway by carrying on reading past the
 * next clear. Revisit it if transport failures turn out to be common enough to
 * notice.
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
import type { ModelClient } from '../model/client'
import { PRODUCIBLE } from '../domain/execution/outcome-kinds'
import { groundsFor } from '../domain/detection/grounds'
import { threadPagesOf } from '../domain/detection/detect'
import { searchQueryOf } from '../domain/detection/topics'
import type { ThreadPage } from '../domain/detection/topics'
import type { WorkDetected } from '../domain/detection/detect'
import { signatureOf } from './ambient-store'
import type { AmbientStore, NamedThread } from './ambient-store'

/** Titles are shown twelve at a time — enough for a subject to be legible,
 *  short of the point where a long afternoon starts to read as a dossier. */
const TITLES_SHOWN = 12

/** Searches are the clearest statement of intent available without asking, and
 *  also the most personal thing in the buffer. Six of them. */
const SEARCHES_SHOWN = 6

/**
 * What they typed into a search box, and only when it was really a search.
 *
 * `searchQueryOf` is the same structural test `grounds.ts` uses to decide the
 * intent half of the sufficiency rule, and using it here rather than
 * `kind === 'query'` matters for a reason beyond consistency. The extension
 * marks any URL carrying a `?` as a query, so a WordPress post at `?p=1234` and
 * a paginated listing at `?s=2` both arrive claiming to be searches. Showing
 * those to the model as "they searched for 1234" would not merely read oddly —
 * it would put a fabricated statement of the person's intent at the top of the
 * evidence a proposal is composed from.
 *
 * The pages are the thread's own, so a search from the same half hour about
 * something else — the one about a diagnosis, the one about a new job — is not
 * here to be filtered: it never joined this thread and this function never sees
 * it.
 */
function searchesIn(pages: readonly ThreadPage[]): readonly string[] {
  const found: string[] = []

  for (const page of [...pages].sort((a, b) => a.at - b.at)) {
    const typed = searchQueryOf(page.url)
    if (typed === null || found.includes(typed)) continue
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

  // The pages the detection was actually made of, rebuilt from the same buffer
  // and windowed the same way — `threadPagesOf` exists so the bar cannot
  // measure browsing the detection had already discarded, and so a "3 sites"
  // ground cannot count a site the thread never ran through.
  const pages = threadPagesOf(store.since(nowMs), detected, nowMs)
  const grounds = groundsFor(detected, pages)

  // The bar, before the memory. See the header: recording an attempt here would
  // silence a thread that has not yet earned an offer but is about to.
  if (!grounds.sufficient) return

  // One question, covering both the poll that would race a call in flight and
  // the poll that would retry one that already failed.
  if (store.attemptedOffer(signature)) return

  store.startComposing(signature)

  try {
    const searches = searchesIn(pages)

    const outcome = await model.run(offerBoundary, {
      terms: detected.terms,
      titles: detected.titles.slice(0, TITLES_SHOWN).map((t) => datamark(t)),
      searches: searches.map((s) => datamark(s)),
      subject: datamark(named.subject),
      siteCount: detected.origins.length,
      pageCount: detected.pages,
      readingMinutes: Math.max(1, Math.round(detected.engagedMs / 60_000)),
      grounds: grounds.sentences,
      producible: PRODUCIBLE,
    })

    if (!outcome.ok) {
      // Settled as "no offer" rather than retried. The deterministic suggestion
      // stands: it says what was seen, which is less than this would have said
      // and is never wrong.
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
    // A thrown error and a returned failure are the same thing to the person,
    // and get the same treatment: settled, no offer, no retry.
    store.finishComposing(signature)
  }
}
