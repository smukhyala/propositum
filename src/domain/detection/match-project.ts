/**
 * Is this the work Propositum already has a project for?
 *
 * ── Why filing is arithmetic and not a model call ────────────────────────
 *
 * A model naming the match would be a model deciding where someone's work gets
 * filed, and filing is the person's business. The same line the detector draws
 * between "which words recur" and "what they mean" applies one layer up:
 * counting the words two subjects have in common is a fact two people watching
 * the same screen would agree on, and "this is the same piece of work" is a
 * judgment. Propositum is allowed the first and offers the second.
 *
 * It also keeps the honest failure honest. When this is wrong, the person can
 * see exactly why — two words in common — and one click undoes it. A model's
 * answer would be unarguable, and the correction would feel like a complaint
 * rather than a fix.
 *
 * ── This is the repo's first cross-session continuity ────────────────────
 *
 * `CONTEXT.md` lists "there is no cross-session continuity" under the risks the
 * vocabulary does not remove: the objective does not survive a session, and a
 * second session starts cold, which the product's own shift-change metaphor
 * implies otherwise. This is the first thing that carries anything across one.
 *
 * What it carries is deliberately narrow — the PROJECT, and therefore its
 * approved sources and its document. It does not carry an objective, a reading
 * or a claim, and it must not grow to. Those are what a session is for reading
 * fresh, and a stale objective silently inherited by the next sitting is the
 * failure the cold start exists to avoid.
 *
 * ── Which way to be wrong ────────────────────────────────────────────────
 *
 * Two failures, and they do not cost the same.
 *
 * A false SPLIT leaves a second project beside the first. The person sees both
 * on the front page, and re-filing one sitting is a click.
 *
 * A false MERGE silently files new work under an old subject. The sources of an
 * unrelated project become approved for it, the wrong document is what
 * Propositum offers to work on, and — worst — nothing on screen says a decision
 * was made at all. Undoing it means noticing it first.
 *
 * So the thresholds below are set to split when unsure, and the near-miss is
 * the case the tests care most about.
 */

import { termsOf } from './topics'

/**
 * How many words two subjects must share, at a minimum.
 *
 * Two, not one. A single shared word is how "general intuition" and "general
 * relativity" become one project — the stopword list already drops the words
 * that are common to everything, so what survives is specific enough that one
 * of them recurring is coincidence more often than it is a subject.
 *
 * The cost is stated plainly rather than hidden: a project whose whole name is
 * ONE word can never be matched, so every sitting on it opens a new project.
 * That is the cheap failure, and it is visible on the front page.
 *
 * ── These are guesses, set before any real data existed ──────────────────
 *
 * The same admission `detect.ts` makes about its own numbers, for the same
 * reason: nobody has watched this fire against a month of real browsing. They
 * live together here so tuning them is a diff rather than an excavation.
 */
export const SHARED_TERMS_FOR_MATCH = 2

/**
 * And what share of the SMALLER of the two term sets that must be.
 *
 * Measured against the smaller set on purpose. A project called "world models"
 * has two words and a thread has up to eight, so measuring against the union —
 * or against the thread — would make a short, exactly-right name score worse
 * than a long vague one. What is being asked is "is the narrower of these two
 * subjects mostly contained in the other", which is the question.
 *
 * At 0.6: two words in common out of two is a match, two out of three is a
 * match, two out of four is not. That last one is the line — a four-word
 * subject sharing half its words with another four-word subject is exactly the
 * near-miss that reads as a merge and is not one.
 */
export const SHARED_SHARE_FOR_MATCH = 0.6

/** A project Propositum could file this sitting under. */
export interface ProjectCandidate {
  readonly id: string
  readonly name: string
  readonly terms: readonly string[]
}

export interface ProjectMatch {
  readonly projectId: string
  /** How many words the two subjects have in common. Shown to the person, so
   *  the reason a sitting landed where it did is never a mystery. */
  readonly overlap: number
}

/**
 * The words a project's name is about.
 *
 * Wraps `termsOf` rather than tokenising again, so both sides of the comparison
 * are produced by one function. A second notion of "what this is about" is how
 * a thread and the project named after that same thread stop matching each
 * other — the bug would be invisible, because both halves would look right.
 *
 * A project has no URL, so the empty string is passed and `termsOf` falls back
 * to the title alone. That is not a special case there; it is the path it
 * already takes for anything it cannot parse.
 */
export function projectTerms(name: string): readonly string[] {
  return [...termsOf(name, '')]
}

/**
 * Does this thread look like work Propositum already has a project for?
 *
 * Term overlap only. A model naming the match would be a model deciding where
 * work gets filed, and filing is the person's business.
 *
 * The strongest candidate wins, and ties go to the one listed first — the
 * caller orders candidates newest-first, so a tie resolves to the project the
 * person touched most recently, which is the better guess and, more
 * importantly, the same guess every time.
 */
export function matchProject(
  threadTerms: readonly string[],
  candidates: ReadonlyArray<ProjectCandidate>,
): ProjectMatch | null {
  const thread = new Set(threadTerms)
  if (thread.size === 0) return null

  let best: ProjectMatch | null = null

  for (const candidate of candidates) {
    const terms = new Set(candidate.terms)
    if (terms.size === 0) continue

    let overlap = 0
    for (const term of terms) {
      if (thread.has(term)) overlap += 1
    }

    if (overlap < SHARED_TERMS_FOR_MATCH) continue
    if (overlap / Math.min(thread.size, terms.size) < SHARED_SHARE_FOR_MATCH) continue

    // Strictly greater, so the first of equals keeps it. Order is the caller's
    // to choose and this must not quietly reorder it.
    if (best === null || overlap > best.overlap) {
      best = { projectId: candidate.id, overlap }
    }
  }

  return best
}
