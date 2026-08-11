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
