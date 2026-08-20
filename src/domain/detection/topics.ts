/**
 * What someone is looking into, across every site they looked at.
 *
 * ── Why per-origin detection was the wrong shape ─────────────────────────
 *
 * The first detector grouped by origin and needed three pages on one site.
 * Real research does not look like that. A recorded session:
 *
 *     27m  2p  meet.google.com          Google Meet
 *      2m  1p  chatgpt.com
 *      1m  2p  jobs.ashbyhq.com         General Intuition & Medal Jobs
 *      0m  2p  www.google.com           general intuition - Google Search
 *      0m  1p  www.generalintuition.com General Intuition | The frontier lab…
 *
 * The thread is obvious to a person and invisible to that detector: **General
 * Intuition**, followed across a search, a company site and a jobs page. No
 * origin has three pages. Meanwhile a 27-minute video call dominated every
 * dwell-based measure and produced the suggestion.
 *
 * So the unit of detection is a THREAD — pages that share subject matter,
 * wherever they live.
 *
 * ── Why this also fixes the video call, without a blocklist ──────────────
 *
 * A thread needs its terms to recur **across at least two origins**. "Google
 * Meet" shares nothing with anything else the person was doing, so it forms no
 * thread and disappears — not because it is on a list of apps to ignore, but
 * because sitting in one place is structurally not what following a subject
 * looks like. A blocklist would need endless maintenance and would still miss
 * the next tool.
 *
 * ── Still no model ───────────────────────────────────────────────────────
 *
 * This is string arithmetic over titles and search terms. It can say WHICH
 * words recur; it cannot say what they mean. Naming the subject in a sentence a
 * person would recognise is a separate step, and a separate decision.
 *
 * That includes `vocabularyOf`, which decides that two spellings are one word.
 * It is counting and edit distance, it is deterministic, and it never asks
 * anything what a word means — see its own block for why the distance is the
 * least of the three rules there, and what the other two are for.
 */

/**
 * Types only, and that is what keeps this from being a cycle.
 *
 * `detect.ts` imports four functions from here, so a value import back would be
 * a real one. `import type` is erased by `verbatimModuleSyntax`, so nothing
 * circular exists at runtime — and the two closed sets stay declared beside the
 * `AmbientObservation` fields they classify, where their arguments are, rather
 * than being copied into a fifth place.
 */
import type { Arrival, ExitType } from './detect'

/**
 * Words that carry no subject.
 *
 * Includes the big platform names, deliberately. They appear in the title of
 * every page on their own properties and would otherwise bind unrelated pages
 * into one enormous false thread.
 */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'as',
  'how',
  'what',
  'why',
  'when',
  'where',
  'who',
  'which',
  'can',
  'do',
  'does',
  'you',
  'your',
  'i',
  'my',
  'we',
  'our',
  'us',
  'me',
  'new',
  'more',
  'get',
  'best',
  'top',
  'via',
  'about',
  'all',
  'into',
  'google',
  'search',
  'youtube',
  'twitter',
  'reddit',
  'github',
  'linkedin',
  'facebook',
  'medium',
  'home',
  'page',
  'index',
  'login',
  'sign',
  'welcome',
  'loading',
  'untitled',
  'dashboard',
  'inbox',
  'docs',
  'doc',
  'pdf',
  'html',
  'www',
  'com',
  'org',
  'net',
  'io',
  'ai',
  'app',
  'jobs',
  'careers',
])

/**
 * Trailing site branding: "… - Google Search", "… | Acme", "… — Acme Blog".
 *
 * The leading `\s+` is load-bearing and was missing. Without it the separator
 * class matched the hyphen INSIDE a word, so any title whose subject was
 * hyphenated lost everything after it: `termsOf('gpt-4 vs claude', '')`
 * returned `{gpt}`, and "PA-LOCO: Learning Perturbation-Adaptive Locomotion"
 * lost the two words it was about. `grounds.ts` documented the symptom and
 * routed around it rather than fixing it here, which left every other caller
 * still paying for it.
 *
 * Branding goes after a space. A hyphen with no space before it is part of a
 * word, and this now says so.
 */
const BRANDING = /\s+[|–—-]\s*[^|–—-]{1,40}$/

/**
 * One subject, written two ways.
 *
 * A `Set<string>` of terms answers `has('perturbation')` with `false` when the
 * page said "perturbations", so the two-minute read that best supported a
 * thread was the page excluded from it. Every human reading those titles would
 * have called it one subject.
 *
 * ── Why this is the smallest rule that works, and not a stemmer ───────────
 *
 * Singulars only. `-ing` and `-ed` are deliberately left alone: "learning" and
 * "learn" are frequently different subjects, and this function is also both
 * halves of `matchProject`, which decides which Project a sitting is FILED
 * under. `CONTEXT.md` tunes that toward splitting on the grounds that a false
 * split is one click and a false merge silently inherits the wrong sources and
 * the wrong document. Every rule below therefore has to be one a person would
 * agree with instantly, because the expensive failure is agreeing too much.
 *
 * A real stemmer was the alternative and is refused for the same reason the
 * detector refuses a blocklist and a model: it would collapse words this file
 * cannot argue about, in a path where the collapse is invisible and the damage
 * is silent.
 *
 * ── Where it is wrong, named rather than discovered ───────────────────────
 *
 * `series` → `sery` and `species` → `specy`. Both are wrong and both are
 * harmless here, because the cost of a bad stem is a term that matches nothing
 * — a MISSED join, which is the cheap direction. A bad stem only becomes
 * expensive if two different words land on the same string, and the guards
 * below exist to keep that rare: nothing under five characters is touched, and
 * `-ss`, `-us` and `-is` endings are left alone so `process`, `status` and
 * `analysis` survive intact.
 */
function singular(word: string): string {
  // The floor. `abs` is an arXiv path segment that reached a real thread's
  // subject terms once; stemming short tokens would add a second way for that
  // class of junk to arrive, and buys nothing — English plurals are longer.
  if (word.length < 5) return word

  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`
  // Not plurals. Checked before the two rules below, which would both bite.
  if (/(?:ss|us|is)$/.test(word)) return word
  if (/(?:s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith('s')) return word.slice(0, -1)

  return word
}

/**
 * The words, before normalisation. One tokeniser, two callers.
 *
 * `termsOf` and `surfacesOf` must not disagree about what a word is, for the
 * same reason `projectTerms` wraps `termsOf` rather than tokenising again: two
 * notions of "what this page is about" produce a bug where both halves look
 * right.
 */
function tokenise(title: string, url: string): string[] {
  const cleanedTitle = title.replace(BRANDING, ' ')

  // The path often carries the subject when the title does not — /world-models.
  let path = ''
  try {
    const parsed = new URL(url)
    path = decodeURIComponent(parsed.pathname).replace(/\.[a-z0-9]{1,5}$/i, '')
    const query = parsed.searchParams
    for (const key of ['q', 'query', 'search', 's']) {
      const value = query.get(key)
      if (value) path += ` ${value}`
    }
  } catch {
    /* not a URL; the title alone will have to do */
  }

  return `${cleanedTitle} ${path}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

/** Terms worth clustering on. Short tokens and stopwords are dropped. */
export function termsOf(title: string, url: string): Set<string> {
  // Normalised LAST, so the stopword list stays a list of words as written
  // rather than a list of stems nobody would recognise reading it.
  return new Set(tokenise(title, url).map(singular))
}

/**
 * Each normalised term back to the spelling that produced it.
 *
 * Matching wants `perturbation`; a person reading a sentence about their own
 * afternoon wants the word they actually saw. Without this the front door said
 * *"you have been looking into world model"*, and for the handful of words the
 * rule gets wrong it would have said *"looking into sery"* — a stem is a
 * matching key and was never fit to be shown to anybody.
 *
 * Only the display path uses this. Nothing compares surfaces, because comparing
 * them is the exact bug the normalisation just fixed.
 */
export function surfacesOf(title: string, url: string): Map<string, string> {
  const surfaces = new Map<string, string>()
  for (const word of tokenise(title, url)) {
    const term = singular(word)
    // First spelling seen wins, so the same buffer renders the same sentence
    // every time it is asked.
    if (!surfaces.has(term)) surfaces.set(term, word)
  }
  return surfaces
}

/** A term must recur across at least this many origins to bind a thread. */
export const ORIGINS_FOR_THREAD = 2

/** Pages a thread needs before it is a subject rather than a coincidence.
 *
 *  Both of these sit above `vocabularyOf` rather than beside `findThreads`
 *  because they now have two readers. `findThreads` uses them to decide whether
 *  a thread exists; `vocabularyOf` uses them to decide whether a word has enough
 *  evidence behind it to absorb another word's spelling. Those must be the same
 *  bar, or a merge could manufacture the very thread the bar was refusing. */
export const PAGES_FOR_THREAD = 3

/**
 * The shortest term this may touch.
 *
 * ~~At one edit apart, short words are a minefield: form/from, trial/trail,
 * cat/cot, bear/beat, host/cost. Every one of those is two words a person means
 * differently, and none of them is a typo of the other often enough to be worth
 * the merge. Six is where the density of one-edit neighbours in English drops
 * far enough that "one edit apart" starts to mean "one of these is a slip".~~
 *
 * **That second sentence was made up, and it is false.** Measured over
 * `/usr/share/dict/words` with the `oneEditApart` below, counting only
 * neighbours that share a first letter and also clear the floor:
 *
 *     >= 6 chars   218,002 words   81,121 have such a neighbour   37.2%
 *     >= 7 chars   200,533         66,848                          33.3%
 *     >= 8 chars   176,810         51,662                          29.2%
 *     >= 9 chars   146,957         37,123                          25.3%
 *     >= 10 chars  114,662         24,618                          21.5%
 *
 * There is no cliff. More than a third of long English words have a one-edit
 * real-word neighbour, and going to ten characters — which would kill `robotc`,
 * one of the two cases this exists for — still leaves a fifth of them. Sampled
 * pairs at six and above: filter/filler, content/contest, course/coarse,
 * banking/baking, sharing/staring, writing/waiting, founder/founded,
 * present/prevent, hosting/hoisting, designer/designed. Every one is two words.
 *
 * So the floor buys the 3-to-5-character band, where the density is worse and
 * the pairs are commoner still, and nothing else. **It is not the safety
 * argument and it never was.** The safety argument is the pair of rules below
 * it: the absorbed word must have been TYPED, once, and the word absorbing it
 * must already carry a thread on its own. Six is kept because it is free and it
 * excludes the worst band; the two real cases clearing it at six and eleven is a
 * fact about the cases, not evidence about the number.
 */
export const CANONICAL_MIN_LENGTH = 6

/**
 * Exactly one Damerau-Levenshtein edit apart — substitute, insert, delete, or
 * swap two neighbours. Never two.
 *
 * Written out rather than run as a DP matrix because at a distance of one the
 * whole thing is three cases, and three named cases are easier to argue with
 * than a table.
 *
 * The transposition case is the one plain Levenshtein counts as two edits and
 * refuses. It has to be here: `robotcs` for `robotics` is a dropped letter and
 * `teh` for `the` is a swap, and a hand typing too fast produces both equally.
 * Counting a swap as two would exclude half of what a typo actually is.
 */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false

  const difference = a.length - b.length
  if (difference > 1 || difference < -1) return false

  if (difference === 0) {
    // Walk in from both ends. What is left in the middle is the whole edit.
    let head = 0
    while (head < a.length && a[head] === b[head]) head += 1
    let tail = a.length - 1
    while (tail > head && a[tail] === b[tail]) tail -= 1

    // One character differs: a substitution.
    if (head === tail) return true
    // Two adjacent characters differ and are each other's: a transposition.
    return tail === head + 1 && a[head] === b[tail] && a[tail] === b[head]
  }

  // One character more on one side. Skip the first mismatch in the longer
  // string; everything after it must line up with what is left of the shorter.
  const longer = difference === 1 ? a : b
  const shorter = difference === 1 ? b : a
  let at = 0
  while (at < shorter.length && longer[at] === shorter[at]) at += 1
  return longer.slice(at + 1) === shorter.slice(at)
}

/**
 * One subject, spelled wrong once.
 *
 * ── The observation ──────────────────────────────────────────────────────
 *
 * Watched live. In one sitting a person searched, in this order:
 *
 *     "techniques to measure peturbation robotcs"   google
 *     "DMD vs SPO robotics"                          google
 *     "Extended Kalman Filters"                      google -> medium.com
 *
 * After `singular` the buffer holds `robotc` from the first and `robotic` from
 * the second. One edit apart, obviously one subject to any person reading the
 * two lines, and two unrelated tokens to everything below `termsOf`.
 *
 * ── What this does NOT fix, said before anything else ────────────────────
 *
 * **This change would not have produced an offer in that session, and it would
 * not even have merged those two terms.** Both failures are worth writing down
 * because either one alone would be enough to make the claim false.
 *
 *   - The first two searches were both on google.com. A term must recur across
 *     `ORIGINS_FOR_THREAD` origins to seed a thread, and merging two google-only
 *     searches produces one origin, not two. No thread, so no offer. The real
 *     blocker in that sitting was that the person never clicked through.
 *   - The frequency rule below would have refused the merge anyway. `robotc`
 *     was seen once and `robotic` was seen once; neither is strictly more
 *     frequent than the other, so neither may absorb the other. `peturbation`
 *     is worse still — the correct spelling never appeared in that sitting at
 *     all, so there was nothing for it to merge into.
 *
 * So this is a fix for the class, not for the instance. It pays off in a sitting
 * long enough to be worth offering anything about, where the destination pages
 * carry the word spelled correctly a dozen times and the typo appears once, in
 * one search URL. That asymmetry is the whole design.
 *
 * ── Why canonicalisation, and not fuzzy comparison ───────────────────────
 *
 * The obvious change is to make the comparisons approximate: `findThreads` uses
 * `Set.has`, `matchProject` counts exact overlap, `pursuitOf` intersects sets,
 * and `signatureOf` joins terms into an offer's identity. Making all four fuzzy
 * is four blast radii, and the last one is the worst: a signature built from
 * approximately-equal strings is a signature that can change while the subject
 * does not, and `extension/src/service-worker.js` already records a signature
 * flapping A->B->A across polls. That is not a defect to enlarge.
 *
 * So the window is canonicalised ONCE — near-identical terms are clustered and
 * each is rewritten to one representative — and every existing exact-match
 * consumer keeps comparing strings for equality, unchanged.
 *
 * ── The rule that shipped first, and why it was not a safety argument ────
 *
 * ~~A term merges into a neighbour only when the neighbour is **strictly more
 * frequent across the window**. A typo is by nature a one-off; the word it was
 * a typo of is the one the person keeps meeting.~~
 *
 * The prose said "a one-off". The code said `if (count <= mine) continue`, which
 * is not that. Thirty-nine pages merged into forty. `contest` on three pages was
 * absorbed by `content` on four, both ordinary words, no typo anywhere; and
 * `modeling` on three was absorbed by `modelling` on four, which is not even a
 * misspelling, just the other side of the Atlantic. Both were measured against
 * the working tree, not imagined. The gap between what a
 * comment claims and what the line under it does is the whole defect, and it is
 * worth leaving the strikethrough in place so the next reader can see that this
 * file once argued for a rule it had not written.
 *
 * Three things went wrong downstream of that gap, all measured against the
 * working tree:
 *
 *   - **A sitting refiled itself.** Three contest pages and four content pages,
 *     no typo. `contest` was erased from `detected.terms`, and `matchProject`
 *     moved the sitting from the Contest project to the Content project — the
 *     silent false merge `match-project.ts` spends its header naming as the
 *     expensive one.
 *   - **One unrelated page manufactured a detection.** Two `waiting` pages on
 *     two origins detect nothing. Add one page titled "writing an outline" and
 *     `writing` merges into `waiting`, which supplies the third page AND the
 *     third origin, and the outline lands in `detected.urls` — the list that
 *     becomes approved sources on accept.
 *   - **A merge dissolved as the window slid.** One buffer polled two minutes
 *     apart across the 30-minute edge produced two different signatures, where
 *     the code before the pass produced one. `signatureOf(detected.terms)` keys
 *     the offer cache and is a durable column.
 *
 * ── What the rule is now ─────────────────────────────────────────────────
 *
 * Two conditions, and between them they are the safety argument. Neither is
 * distance, and the length floor's own block explains why it is not either.
 *
 * **1. The absorbed word was TYPED, exactly once.** It must appear on exactly
 * one page in the window, and that page must be a search — `searchQueryOf`, the
 * domain's own test, not the extension's `?`-spotting.
 *
 * This is the rule the observation actually supports, and the earlier version
 * was a generalisation of it that nothing had asked for. **The only string in
 * this pipeline a person typed is a search query.** Titles are written by the
 * author of the page, and a word an author spelled unusually is a word they
 * meant — it is consistent, it is theirs, and repairing it is not ours to do.
 * `robotcs` was typed. `writing an outline` was a page somebody wrote.
 *
 * The two together are what make this affordable: a word that appears once, in
 * something a person typed, is the shape of a slip in a way that "a word that
 * appears once" alone is not.
 *
 * **2. The absorbing word already carries a thread on its own.**
 * `PAGES_FOR_THREAD` pages across `ORIGINS_FOR_THREAD` origins, counted before
 * any merge. So the absorbed page can never be the page or the origin that
 * brings a thread into existence: the thread is there without it, and all a
 * merge can do is add one page to something that already qualified.
 *
 * The first rule is precision, the second is blast radius. The second one is
 * the more important, because it is the one that holds even when the first is
 * wrong about a particular word.
 *
 * ── Two consequences worth stating, because they are load-bearing ────────
 *
 * **Nothing is erased.** `rewrite` UNIONS: a page keeps the word it used and
 * gains the representative beside it. The first version replaced, and that is
 * how `contest` vanished from a sitting that had three contest pages on it.
 * `matchProject` compares thread terms against `projectTerms(name)`, which is
 * not canonicalised and cannot be — the project was named before this window
 * existed. A rewrite that deletes an observed word is a rewrite that can make
 * two things stop matching without anything on screen saying so.
 *
 * **A chain cannot form.** Absorbing needs three pages; being absorbed needs
 * one. No word can do both, so the chain-following loop that used to sit here
 * is gone rather than guarded. It was reaching results two edits from where they
 * started — `cashing` -> `caching` -> `coaching` — which is exactly what
 * `oneEditApart`'s own block says never happens, and what a test in
 * `canonical-terms.test.ts` claims to pin. If rule 1 is ever loosened, the worst
 * this can now do is refuse to follow a hop, which is the cheap direction.
 *
 * ── Where this is still wrong, named rather than discovered ──────────────
 *
 * Somebody searches once, mid-afternoon, for something unrelated whose subject
 * word is six or more characters, shares a first letter with what they are
 * researching, and is one edit from it. That search page joins the thread and
 * becomes one of the approved sources on accept. `writing`/`waiting`,
 * `content`/`contest` and `course`/`coarse` are all still reachable this way.
 *
 * The cost is now one page inside a detection that already existed, rather than
 * a detection that would not have existed — the second rule is what moved it,
 * and it is the difference between diluting a real thread and inventing one.
 * That is the cheap direction, but it is not free, and it is the same class as
 * the search for "nissan altima" that became evidence for a hiking trip.
 *
 * **The line where this stops being affordable is a longer window.** Every
 * guard here is a count over a 30-minute buffer of a handful of pages. Widen
 * the window and the number of six-letter words in it goes up, "appears exactly
 * once" stops being rare, and the chance that some search that afternoon is one
 * edit from the subject approaches certainty. At that size the answer is not a
 * tighter count — it is a dictionary, which this file refuses for the same
 * reason it refuses a blocklist, or dropping the pass. It is not a bigger
 * version of what is written below.
 */

/**
 * The spelling seen most, ties broken lexicographically.
 *
 * Deterministic for the same reason the canonical term is: the label rides
 * beside `terms` in `WorkDetected`, and a sentence about somebody's afternoon
 * that changes wording between two polls of an unchanged buffer reads as a
 * system making things up.
 */
function commonest(counted: Map<string, number> | undefined): string | null {
  if (counted === undefined) return null

  let best: string | null = null
  let bestCount = 0
  // Sorted, then strictly greater, so equal counts keep the first alphabetically.
  for (const word of [...counted.keys()].sort()) {
    const count = counted.get(word) ?? 0
    if (count > bestCount) {
      best = word
      bestCount = count
    }
  }
  return best
}

/**
 * What the window's words are, and how each of them is spelled.
 *
 * One object rather than two functions, because the two halves are answers to
 * the same question and a caller that took only one of them would be a caller
 * whose labels and whose terms could disagree.
 */
export interface Vocabulary {
  /** Every term seen in the window, mapped to the spelling that stands for it.
   *  Representatives map to themselves. */
  readonly canonical: ReadonlyMap<string, string>
  /** Each canonical term to the most common surface behind it, ties broken
   *  lexicographically. For sentences shown to somebody; never for comparison. */
  readonly surface: ReadonlyMap<string, string>
}

/**
 * The window's vocabulary.
 *
 * ── Read from titles and URLs, never from `page.terms`, and this is load-bearing
 *
 * The counts come from `surfacesOf(page.title, page.url)`, whose keys are
 * exactly what `termsOf` returns for the same page — one tokeniser, so this is
 * not a second notion of what a page is about. It matters that it reads the
 * TITLE rather than `page.terms`: it makes the vocabulary a pure function of the
 * window's raw contents, so applying it to `page.terms` and then computing it
 * again gives the identical answer. That is what makes `canonicalise`
 * idempotent, and idempotence is what lets the pass sit on more than one path
 * without the paths disagreeing.
 *
 * ── Why the label is the representative's OWN spellings, and nothing else ─
 *
 * `findThreads` used to pick a label from the thread's own members, first
 * spelling seen. Both halves of that break once a cluster can merge: the
 * mistyped search is often the FIRST page in the buffer — it is what started the
 * sitting — so first-seen renders the whole thread as "robotcs".
 *
 * ~~Counting across the window rather than the members is what makes the label
 * reliably the representative's own spelling: the representative is by
 * construction on more pages than the typo, so its spelling outnumbers the
 * typo's wherever those pages ended up.~~
 *
 * **That inference does not hold and the counting version was measured doing the
 * exact thing it claimed to prevent.** The representative's PAGES outnumber the
 * typo's; its SPELLINGS need not, because `singular` deliberately folds
 * `robotics` and `robotic` into one term while leaving them two surfaces. Five
 * pages — `robotics` once, `robotic` twice, `robotcs` twice — pooled to
 * `{robotics:1, robotic:2, robotcs:2}`, and the lexicographic tie-break handed
 * the label to `robotcs`. The thread rendered as "robotcs learning" on the front
 * page, and `page.tsx` turns those same words into a created Project's NAME.
 * Before the pass existed, that fixture labelled itself `robotics`.
 *
 * So the pool is gone. A representative's label comes from ITS OWN spellings,
 * counted across the window, and an absorbed word's spelling is never a
 * candidate for anything. That is what the paragraph above was trying to
 * describe, said as code instead of as an inference about counts. It is also
 * free: rule 2 guarantees a representative has at least `PAGES_FOR_THREAD`
 * spellings of its own to choose between, so there is no fallback case.
 *
 * The remaining cost is real and small: a term spelled one way inside a thread
 * and another way on an unrelated page elsewhere in the window is labelled with
 * whichever spelling is commoner overall. Both are spellings of the same word.
 */
export function vocabularyOf(pages: readonly ThreadPage[]): Vocabulary {
  const pagesByTerm = new Map<string, number>()
  const originsByTerm = new Map<string, Set<string>>()
  /** True while every page carrying this term was a search — i.e. every time
   *  this word appeared, a person had typed it. One page written by somebody
   *  else is enough to make it the author's spelling rather than a slip. */
  const typedByTerm = new Map<string, boolean>()
  const spellings = new Map<string, Map<string, number>>()

  for (const page of pages) {
    // The domain's own test, never `page.searched` — that field needs the
    // extension to have labelled the navigation a query, and the extension
    // labels any URL with a `?` a query. `grounds.ts` refuses to trust it for
    // the same reason and this must not be looser than the bar above it.
    const typed = searchQueryOf(page.url) !== null

    for (const [term, word] of surfacesOf(page.title, page.url)) {
      pagesByTerm.set(term, (pagesByTerm.get(term) ?? 0) + 1)
      const origins = originsByTerm.get(term) ?? new Set<string>()
      origins.add(page.origin)
      originsByTerm.set(term, origins)
      typedByTerm.set(term, (typedByTerm.get(term) ?? true) && typed)
      const counted = spellings.get(term) ?? new Map<string, number>()
      counted.set(word, (counted.get(word) ?? 0) + 1)
      spellings.set(term, counted)
    }
  }

  // Sorted, so nothing below depends on the order the buffer happened to
  // arrive in. `signatureOf` derives an offer's identity from these strings; a
  // canonical choice that flapped with insertion order would make an offer
  // impossible to explain an hour afterwards.
  const terms = [...pagesByTerm.keys()].sort()
  const into = new Map<string, string>()

  for (const term of terms) {
    if (term.length < CANONICAL_MIN_LENGTH) continue
    // Rule 1, both halves. Once, and typed. A word on two pages is a word the
    // person met twice, and nobody makes the same slip twice in half an hour
    // often enough to be worth what agreeing costs when this is wrong.
    if ((pagesByTerm.get(term) ?? 0) !== 1) continue
    if (typedByTerm.get(term) !== true) continue

    let best: string | null = null
    let bestCount = 0

    for (const other of terms) {
      if (other === term) continue
      if (other.length < CANONICAL_MIN_LENGTH) continue
      // Typos rarely land on the first letter, and this cuts a whole class of
      // false merge for the price of one comparison.
      if (other[0] !== term[0]) continue

      // Rule 2. The absorbing word has to carry a thread WITHOUT the page being
      // absorbed, so a merge can only ever add a page to a thread that already
      // exists. This is what stops one unrelated search from supplying a
      // thread's deciding page and deciding origin at the same time — and
      // therefore from putting a page nobody was researching into
      // `detected.urls`, which is the list that becomes approved sources.
      const count = pagesByTerm.get(other) ?? 0
      if (count < PAGES_FOR_THREAD) continue
      if ((originsByTerm.get(other)?.size ?? 0) < ORIGINS_FOR_THREAD) continue

      if (!oneEditApart(term, other)) continue

      // Strictly greater, over a list already sorted ascending, so equal counts
      // resolve to the lexicographically first candidate — the same one, every
      // time, for the same window.
      if (count > bestCount) {
        best = other
        bestCount = count
      }
    }

    if (best !== null) into.set(term, best)
  }

  // One hop, and there is deliberately no loop here. Absorbing needs
  // `PAGES_FOR_THREAD` pages and being absorbed needs exactly one, so no word
  // can be on both ends of a merge and a chain cannot form. The loop that used
  // to follow one was reaching results two edits from where they started —
  // `cashing` -> `caching` -> `coaching` — which contradicts `oneEditApart`'s
  // own block and the test that claims to pin it.
  const canonical = new Map<string, string>()
  for (const term of terms) canonical.set(term, into.get(term) ?? term)

  // A representative is labelled from its own spellings. An absorbed word's
  // spelling is never in the running, for any term, ever — see the block above
  // for the fixture where pooling them rendered a thread as "robotcs".
  const surface = new Map<string, string>()
  for (const term of terms) {
    if ((canonical.get(term) ?? term) !== term) continue
    surface.set(term, commonest(spellings.get(term)) ?? term)
  }

  return { canonical, surface }
}

/**
 * The representative added BESIDE the word the page used, never instead of it.
 *
 * Replacing was the first version and it is how `contest` disappeared from a
 * sitting with three contest pages on it. `matchProject` compares thread terms
 * against `projectTerms(name)`, which is not canonicalised and cannot be — the
 * project was named in some other window, possibly months ago. So a rewrite that
 * deletes an observed word can make a thread stop matching the project it
 * belongs to, and `match-project.ts` spends its header explaining that this is
 * the failure with nothing on screen to notice.
 *
 * The union costs one string in a set and keeps the invariant that a page's
 * terms always contain what the page actually said. Clustering still works,
 * because every page in a cluster now carries the representative too.
 *
 * A one-page word cannot reach `Thread.terms` — `findThreads` keeps only terms
 * on more than one member — so nothing a typo added survives into a signature.
 */
function rewrite(
  pages: readonly ThreadPage[],
  canonical: ReadonlyMap<string, string>,
): ThreadPage[] {
  return pages.map((page) => {
    const terms = new Set(page.terms)
    for (const term of page.terms) {
      const representative = canonical.get(term)
      if (representative !== undefined) terms.add(representative)
    }
    return { ...page, terms }
  })
}

/**
 * The window with near-identical terms rewritten to one spelling each.
 *
 * ── This must sit where BOTH page-building paths go through it ───────────
 *
 * Two independent paths build `ThreadPage[]` from one buffer: `detectWork` ->
 * `findThreads`, and `threadPagesOf`, which `compose-offer.ts` and the ambient
 * debug route call separately. `grounds.ts`'s `pursuitOf` intersects the second
 * path's `page.terms` with the first path's `detected.terms`. Canonicalising in
 * one and not the other would leave the two views of the same page disagreeing
 * about what word is on it, grounds would silently stop firing, and the suite
 * would stay green while the product never offered anything again.
 *
 * So it is applied in `pagesOf`, which is the one function both paths build
 * pages with, and again at the top of `findThreads` for callers holding pages
 * they built themselves. Applying it twice is safe by construction — see
 * `vocabularyOf` on why the vocabulary is derived from titles rather than from
 * the terms it rewrites.
 */
export function canonicalise(pages: readonly ThreadPage[]): ThreadPage[] {
  return rewrite(pages, vocabularyOf(pages).canonical)
}

/**
 * Query parameters that carry something a person typed.
 *
 * Narrower than `capture/url.ts`'s `QUERY_PARAMS`, deliberately, and not
 * imported from it — that list exists to decide what may be STORED, and being
 * generous there is the safe direction, because keeping one parameter too many
 * costs a slightly longer URL. Being generous HERE costs a false offer.
 *
 * `s` and `p` are the two dropped. `?p=1234` is a WordPress post id and `?s=2`
 * is page two of a listing at least as often as either is a search, and a
 * ground that fires on a page number is not an intent ground.
 *
 * Every parameter here also survives `cleanUrl`, which strips the rest before
 * anything reaches the ambient buffer. A parameter this list recognised and
 * that one discarded would be a rule that can never fire.
 */
const SEARCH_PARAMS = ['q', 'query', 'search', 'k'] as const

/**
 * Paths that name searching: /search, /results, /find, Amazon's /s, /web.
 *
 * The root path counts too, because DuckDuckGo, Kagi and several others put the
 * query straight on the origin — `https://duckduckgo.com/?q=…`.
 */
const SEARCH_PATH = /^\/((search|results|find|web|s|sp)(\/|$).*)?$/i

/**
 * The thing they typed, if this URL is a search. Null otherwise.
 *
 * ── Why the domain re-decides what the extension already labelled ────────
 *
 * The service worker marks `kind: 'query'` on any URL carrying a `?`, so a
 * checkout page, a paginated listing and a tracked newsletter link all arrive
 * claiming to be searches. That was survivable while a search only made the
 * copy read oddly. It stops being survivable in `grounds.ts`, where a search is
 * an INTENT ground and the whole "did they pursue this or merely receive it"
 * half of the sufficiency rule would be satisfiable by a question mark.
 *
 * So the test lives here, in code the extension cannot widen, and it is
 * structural rather than a list of search engines: a recognised parameter, a
 * path that names searching, and a value that looks like words rather than an
 * id. A brand list would need endless maintenance and would still miss the next
 * engine — the same argument that kept a blocklist out of thread detection.
 *
 * It is deliberately possible for this to say no to a real search on some site
 * with an unusual shape. A missed search costs one ground; a false one costs an
 * interruption, and ADR-0008 names which of those is the expensive failure.
 */
export function searchQueryOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  // Not decoded: a search path is ASCII, and `decodeURIComponent` throws on a
  // stray `%` — a malformed URL must cost a ground, never a crash in detection.
  if (!SEARCH_PATH.test(parsed.pathname)) return null

  for (const param of SEARCH_PARAMS) {
    const value = parsed.searchParams.get(param)
    if (value === null) continue

    const term = value.trim().toLowerCase().replace(/\s+/g, ' ')
    // Two characters and at least one letter. `?q=1` is a page number wearing a
    // search parameter's name, and an id is not something anybody typed.
    if (term.length >= 2 && /[a-z]/.test(term)) return term
  }

  return null
}

export interface ThreadPage {
  readonly url: string
  readonly origin: string
  readonly title: string
  readonly terms: ReadonlySet<string>
  readonly engagedMs: number
  readonly at: number
  /** True when this page was reached by searching — the strongest statement of
   *  intent available without asking. */
  readonly searched: boolean
  /** How many times they ARRIVED at this page, counting only arrivals that
   *  followed a visit somewhere else. One on the way through; two or more means
   *  they left and chose to come back, which is a different fact entirely. */
  readonly visits: number
  /**
   * How each of those returns was arrived at, in time order. Empty for a page
   * seen once — `visits` is the tally and this is what each arrival past the
   * first was.
   *
   * ── Why the ARRIVALS and not just the count, 2026-08-20 ──────────────────
   *
   * `came-back` used to read `visits >= 2` and nothing else, and Adar, Teevan &
   * Dumais's 612,000-user revisit study says that in the only band a
   * thirty-minute window can see, 77% of returns are a click home from a spoke
   * of the same site. `grounds.ts` wrote that finding down on 2026-08-17 and
   * declined to act on it, because the buffer could not tell the two apart.
   * This is the field that lets it: `'same-origin'` IS the click home, and the
   * other members are not. See `returnedTo` in `grounds.ts` for the predicate
   * and [ADR-0018](../../../docs/adr/0018-the-everyday-shapes.md) for the
   * decision.
   *
   * **Optional, and absent is not permissive.** A page whose returns nothing
   * classified cannot fire `came-back`, which is the direction ADR-0008 says to
   * be wrong in — a missed intent ground costs an offer nobody sees. It also
   * means a fixture has to say HOW somebody came back before it may stand for
   * somebody coming back, which is the failure mode `docs/PRODUCT_PRINCIPLES.md`
   * §13 records about fixtures that were smaller than the sessions they named.
   */
  readonly returnArrivals?: readonly Arrival[] | undefined
  /**
   * How far down this page they got, 0 to 1, deepest report wins. Absent when
   * nothing reported one.
   *
   * Bounded at the app's door, never here — see
   * `AmbientObservation.scrollFraction`, which this is the per-page fold of.
   *
   * **Zero is a real reading and not a missing one.** `content.js` starts its
   * counter at zero and reports whatever it reached, so a page that fits on one
   * screen and was read completely reports zero — the same false negative
   * `classifyEngagement` fixed on the SESSION path by adding `interacted`, a
   * field the ambient path has no room for. `grounds.ts` therefore uses this to
   * refuse only in conjunction with `exitType`, and never as a floor of its own.
   */
  readonly scrollFraction?: number | undefined
  /**
   * How this page was left, latest report wins. Absent when they have not left
   * it — which, on a live buffer, is the page they are reading right now.
   *
   * Latest rather than first, because Chrome fires `visibilitychange` and then
   * `pagehide` on an ordinary same-tab navigation, so a page navigated away
   * from reports `'hidden'` and then `'left-cached'`, and the second is the
   * more informative of the two.
   */
  readonly exitType?: ExitType | undefined
  /**
   * The title of the tab group this page sits in, if the person named one.
   *
   * ── Beside `terms`, never inside it ──────────────────────────────────────
   *
   * The tempting thing is to tokenise it into `terms` so a group called "world
   * models" binds its pages into a thread. That is refused, and the refusal is
   * the whole safety argument for the field:
   *
   *   - `findThreads` seeds on terms recurring across `ORIGINS_FOR_THREAD`
   *     origins. A group title is on every page in the group by construction,
   *     so it would supply a seed term, the origin count AND the page count at
   *     once — manufacturing a thread out of the fact that somebody tidied
   *     their tabs. That is the same failure `vocabularyOf`'s rule 2 spends its
   *     length preventing for a one-edit typo, arriving by a wider door.
   *   - `signatureOf` is built from thread terms and keys the offer cache and a
   *     durable column. Renaming a tab group would silently change the identity
   *     of work in progress.
   *   - `grounds.ts` intersects `page.terms` with `detected.terms` in
   *     `pursuitOf`. A term the person typed into a group name is not evidence
   *     that they searched for it.
   *
   * So it rides alongside, is read by exactly one thing —
   * `authoredLabelOf` → `Thread.authoredLabel` → the sentence — and changes no
   * arithmetic anywhere. `tests/detection.test.ts` asserts that grounds and
   * sufficiency are byte-identical with and without it.
   */
  readonly groupTitle?: string | undefined
}

export interface Thread {
  /** The recurring terms, most common first. The raw material for a name. */
  readonly terms: readonly string[]
  /** The same words as a person wrote them, aligned index-for-index with
   *  `terms`. For sentences shown to somebody; never for comparison. */
  readonly labels: readonly string[]
  readonly pages: readonly ThreadPage[]
  readonly origins: readonly string[]
  readonly engagedMs: number
  readonly since: number
  readonly searches: number
  /** What the person called this themselves, if they called it anything. See
   *  `authoredLabelOf`. Absent for every thread whose pages are in no titled
   *  tab group, which is most of them. */
  readonly authoredLabel?: string | undefined
}

/**
 * The name the person gave this work, out of the tab groups its pages sit in.
 *
 * ── Why this is a count and not "the first one" ──────────────────────────
 *
 * A thread can span two groups — somebody splits their reading, or drags half
 * of it somewhere — and it can span a group and no group at all, which is the
 * common case the moment a search result opens in a fresh tab. First-seen would
 * therefore hand the label to whichever page happened to be scanned first, and
 * `topics.ts` has already been caught by exactly that: `findThreads` used to
 * take the first spelling it met and rendered a whole thread as *"robotcs"*,
 * because the mistyped search is the page that STARTED the sitting and is first
 * in the buffer.
 *
 * So it is the label carried by the most pages, ties broken lexicographically —
 * `commonest`, the same function and the same determinism argument the surface
 * labels use. The same window must produce the same sentence every time it is
 * polled, or a person watching Home reads a system making things up.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * There is no minimum. One page of a five-page thread in a group called "world
 * models" is enough to label it, and that is deliberate: a label is a NAME,
 * the alternative name is a bag of stemmed words, and a person's own word about
 * one of these pages beats an algorithm's word about all five. It is also the
 * cheap direction — the worst case is a vaguer sentence, and `describeWork`
 * still refuses to let it displace a confident model name.
 */
function authoredLabelOf(pages: readonly ThreadPage[]): string | undefined {
  const counted = new Map<string, number>()
  for (const page of pages) {
    const label = page.groupTitle
    if (label === undefined || label === '') continue
    counted.set(label, (counted.get(label) ?? 0) + 1)
  }

  return commonest(counted) ?? undefined
}

/**
 * Group pages into subject threads.
 *
 * Seeded on terms that recur across origins, then every page sharing any seed
 * term joins. One page can belong to one thread — the strongest — because an
 * offer that names two overlapping subjects asks the person to do the
 * disambiguating this is meant to save.
 */
export function findThreads(input: readonly ThreadPage[]): Thread[] {
  // Near-identical spellings collapse before anything counts them. Already done
  // in `pagesOf` on the detection path; done again here because `findThreads` is
  // exported and a caller holding hand-built pages must not get a different
  // answer from the same buffer. Idempotent — see `canonicalise`.
  const vocabulary = vocabularyOf(input)
  const pages = rewrite(input, vocabulary.canonical)

  const originsByTerm = new Map<string, Set<string>>()
  const countByTerm = new Map<string, number>()

  for (const page of pages) {
    for (const term of page.terms) {
      const origins = originsByTerm.get(term) ?? new Set<string>()
      origins.add(page.origin)
      originsByTerm.set(term, origins)
      countByTerm.set(term, (countByTerm.get(term) ?? 0) + 1)
    }
  }

  // The seeds: terms that show up on more than one site. A subject followed
  // across sites is what distinguishes research from sitting on one page.
  const seeds = [...originsByTerm]
    .filter(([, origins]) => origins.size >= ORIGINS_FOR_THREAD)
    .map(([term]) => term)
    .sort((a, b) => (countByTerm.get(b) ?? 0) - (countByTerm.get(a) ?? 0))

  const threads: Thread[] = []
  const claimed = new Set<string>()

  for (const seed of seeds) {
    const members = pages.filter((p) => !claimed.has(p.url) && p.terms.has(seed))
    if (members.length < PAGES_FOR_THREAD) continue

    for (const page of members) claimed.add(page.url)

    // Every term the members share, ordered by how often it recurs — this is
    // what a naming step would be given.
    const within = new Map<string, number>()
    for (const page of members) {
      for (const term of page.terms) within.set(term, (within.get(term) ?? 0) + 1)
    }

    const terms = [...within]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term)
      .slice(0, 8)

    const authored = authoredLabelOf(members)

    threads.push({
      terms,
      // Taken from the window's vocabulary rather than rebuilt from the members'
      // titles here. The old version tokenised again and kept the first spelling
      // it met, and that breaks once a cluster can merge: the mistyped search is
      // often the FIRST page in the buffer, because it is what started the
      // sitting, so first-seen would render the whole thread as "robotcs".
      // `vocabularyOf` counts each representative's OWN spellings instead — the
      // version that counted a merged pool rendered a thread as "robotcs" too,
      // by a different route, and its block records that fixture.
      labels: terms.map((term) => vocabulary.surface.get(term) ?? term),
      pages: members,
      origins: [...new Set(members.map((p) => p.origin))],
      engagedMs: members.reduce((total, p) => total + p.engagedMs, 0),
      since: Math.min(...members.map((p) => p.at)),
      searches: members.filter((p) => p.searched).length,
      // The one thing in this object the PERSON wrote. Computed from the
      // members and read only by the sentence; nothing above it — the seeds,
      // the term ranking, the sort — has seen it, which is what makes the
      // byte-equality test in `tests/detection.test.ts` possible to write.
      ...(authored === undefined ? {} : { authoredLabel: authored }),
    })
  }

  // A thread the person searched for outranks one they merely passed through,
  // then breadth, then time.
  threads.sort(
    (a, b) =>
      b.searches - a.searches || b.pages.length - a.pages.length || b.engagedMs - a.engagedMs,
  )
  return threads
}
