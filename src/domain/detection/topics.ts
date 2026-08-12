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
 */

/**
 * Words that carry no subject.
 *
 * Includes the big platform names, deliberately. They appear in the title of
 * every page on their own properties and would otherwise bind unrelated pages
 * into one enormous false thread.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'as',
  'how', 'what', 'why', 'when', 'where', 'who', 'which', 'can', 'do', 'does', 'you', 'your', 'i',
  'my', 'we', 'our', 'us', 'me', 'new', 'more', 'get', 'best', 'top', 'via', 'about', 'all', 'into',
  'google', 'search', 'youtube', 'twitter', 'reddit', 'github', 'linkedin', 'facebook', 'medium',
  'home', 'page', 'index', 'login', 'sign', 'welcome', 'loading', 'untitled', 'dashboard', 'inbox',
  'docs', 'doc', 'pdf', 'html', 'www', 'com', 'org', 'net', 'io', 'ai', 'app', 'jobs', 'careers',
])

/** Trailing site branding: "… - Google Search", "… | Acme", "… — Acme Blog". */
const BRANDING = /\s*[|–—-]\s*[^|–—-]{1,40}$/

/** Terms worth clustering on. Short tokens and stopwords are dropped. */
export function termsOf(title: string, url: string): Set<string> {
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

  const words = `${cleanedTitle} ${path}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w))

  return new Set(words)
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
}

export interface Thread {
  /** The recurring terms, most common first. The raw material for a name. */
  readonly terms: readonly string[]
  readonly pages: readonly ThreadPage[]
  readonly origins: readonly string[]
  readonly engagedMs: number
  readonly since: number
  readonly searches: number
}

/** A term must recur across at least this many origins to bind a thread. */
export const ORIGINS_FOR_THREAD = 2

/** Pages a thread needs before it is a subject rather than a coincidence. */
export const PAGES_FOR_THREAD = 3

/**
 * Group pages into subject threads.
 *
 * Seeded on terms that recur across origins, then every page sharing any seed
 * term joins. One page can belong to one thread — the strongest — because an
 * offer that names two overlapping subjects asks the person to do the
 * disambiguating this is meant to save.
 */
export function findThreads(pages: readonly ThreadPage[]): Thread[] {
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

    threads.push({
      terms: [...within]
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .map(([term]) => term)
        .slice(0, 8),
      pages: members,
      origins: [...new Set(members.map((p) => p.origin))],
      engagedMs: members.reduce((total, p) => total + p.engagedMs, 0),
      since: Math.min(...members.map((p) => p.at)),
      searches: members.filter((p) => p.searched).length,
    })
  }

  // A thread the person searched for outranks one they merely passed through,
  // then breadth, then time.
  threads.sort(
    (a, b) => b.searches - a.searches || b.pages.length - a.pages.length || b.engagedMs - a.engagedMs,
  )
  return threads
}
