/**
 * An afternoon, replayed at the real ambient endpoint.
 *
 *   npm run dev            # in one terminal
 *   npm run seed:offer     # in another
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * The complement of `seed:shift`. That one writes rows an afternoon would have
 * produced; this one **plays the afternoon**. Nothing is written directly: it
 * posts pages at `POST /api/capture/ambient`, exactly as the extension does, and
 * everything after that is the real thing — the real detector, the real grounds,
 * the real subject and offer boundaries, and the real message on a paired
 * thread.
 *
 * So it costs a model call or two and it exercises the path that actually
 * matters. A fabricated offer would prove that a screen can render a fixture; it
 * would prove nothing about whether Propositum notices an afternoon.
 *
 * ── Why it does not need the extension id ────────────────────────────────
 *
 * `fromOurExtension` accepts our origin when the browser sends one, and
 * otherwise accepts a caller the browser attests was not page-initiated —
 * `Sec-Fetch-Site: none`. A script sends the second, which is the same
 * guarantee the endpoint always had, *"stated honestly"* in
 * `src/capture/transport.ts`'s own words: a forged header was always possible
 * from a non-browser client. This is that client, and it is not a new hole.
 *
 * ── Why the afternoon is written here and not taken from the eval fixture ─
 *
 * It was taken from `src/fixtures/scenarios/lisbon-thread.ts` first, and the
 * detector refused it. That is worth recording rather than quietly working
 * around, because the reason is a real fact about the two:
 *
 * **An eval scenario's pages are shaped for the WORKER, and a detection needs
 * pages shaped for the DETECTOR.** The fixture carries long source TEXT for a
 * run to read and titles that only have to identify a source — *"Casa Alfama —
 * rooms and rates"*, *"Miradouro Rooms — rates"*. The detector reads titles, and
 * those three do not share enough vocabulary to be one subject. Nothing is
 * broken; they are answering different questions.
 *
 * So the pages are here, and they are what the real ones would say — a hotel
 * page about a Lisbon hotel has Lisbon in its title. Borrowing the fixture and
 * quietly editing its titles would have been worse than either: a seed claiming
 * fidelity to a sealed scenario while not having it.
 */

import { ENGAGED_MS_FOR_WORK } from '../src/domain/detection/detect'

try {
  process.loadEnvFile('.env')
} catch {
  /* the app holds the key, not this */
}

if (process.env['NODE_ENV'] === 'production') {
  console.error('seed:offer is a development tool and will not run in production.')
  process.exit(1)
}

const base = process.env['PROPOSITUM_BASE_URL'] ?? 'http://127.0.0.1:3117'

/**
 * Spread backwards from now, inside the detector's window.
 *
 * The window is thirty minutes and the grounds care about dwell and about
 * coming back, so pages stamped all at one instant would clear nothing. Spacing
 * them is what makes this an afternoon rather than a burst.
 */
const now = Date.now()
/**
 * One afternoon, on three sites, about one thing.
 *
 * Three origins because `followed-across` wants more than one site and one site
 * is not following anything across. The subject is in every title because that
 * is what pages about a trip to Lisbon actually say, and it is what makes these
 * one strand rather than three unrelated pages.
 */
const pages = [
  {
    url: 'https://skyward.example.com/lgw-lis',
    title: 'Skyward — flights from London to Lisbon in October',
  },
  {
    url: 'https://casa-alfama.example.com/rates',
    title: 'Casa Alfama, Lisbon — rooms and rates for October',
  },
  {
    url: 'https://miradouro.example.com/rates',
    title: 'Miradouro Rooms, Lisbon — October rates and availability',
  },
]

if (pages.length === 0) {
  console.error('The fixture has no pages. Nothing to replay.')
  process.exit(1)
}

/**
 * The afternoon, shaped so the detector can actually recognise one.
 *
 * ── Why this is not just "post the fixture's pages" ──────────────────────
 *
 * The first version of this script did exactly that, and the detector refused
 * it — correctly. `groundsFor` wants one INTENT ground and two INVESTMENT
 * grounds, and three pages read once in a row is neither: nothing was searched
 * for, and nothing was returned to. It looks like reading, not like pursuing.
 *
 * That refusal is the product working, and it is worth keeping the shape of it
 * written down here: **a seed that quietly produced an offer would be a seed
 * that had stopped testing the bar.** So this replays the afternoon a person
 * would actually have had —
 *
 *   a search  →  the three sites  →  back to the first one
 *
 * — which fires `searched-then-read` and `came-back` on the intent side, and
 * `read-deeply` plus `followed-across` on the investment side. Each page gets a
 * real dwell and a scroll, because `heldOpenUnread` takes an unscrolled page
 * that was switched away from OUT of the deep-read grounds.
 */
const SEARCH = 'https://duckduckgo.com/?q=lisbon+in+october+where+to+stay'

interface Observation {
  at: number
  url: string
  title: string
  kind: 'navigation' | 'query' | 'engagement' | 'away'
  engagedMs?: number
  scrollFraction?: number
  exitType?: 'hidden' | 'left-cached' | 'left-unloaded'
  arrival?: 'no-referrer' | 'same-origin' | 'cross-origin' | 'reloaded' | 'back-or-forward'
}

const observations: Observation[] = []
let at = now - (pages.length + 2) * (Math.ceil(ENGAGED_MS_FOR_WORK / 3) + 30_000)

/**
 * How long each page is read for.
 *
 * Two and a half minutes, and the number is chosen against a threshold rather
 * than by feel. `detectWork` will not form a strand below
 * `ENGAGED_MS_FOR_WORK`, which is **eight minutes across the whole thread** —
 * the first version of this script spent ninety seconds a page over five pages,
 * came to seven and a half minutes, and was refused. That was the detector being
 * right and this script being thirty seconds short.
 *
 * Imported rather than written as a number, so a change to the threshold cannot
 * leave this seeding an afternoon that no longer qualifies.
 */
const DWELL_MS = Math.ceil(ENGAGED_MS_FOR_WORK / 3)

/** One page, read properly: arrived at, dwelt on, scrolled, left. */
function read(url: string, title: string, arrival: NonNullable<Observation['arrival']>): void {
  observations.push({ at, url, title, kind: 'navigation', arrival })
  observations.push({
    at: at + DWELL_MS,
    url,
    title,
    kind: 'engagement',
    engagedMs: DWELL_MS,
    // Scrolled, because `heldOpenUnread` takes an unscrolled page that was
    // switched away from OUT of the deep-read grounds.
    scrollFraction: 0.72,
    exitType: 'left-cached',
  })
  at += DWELL_MS + 30_000
}

// The search that started it.
read(SEARCH, 'lisbon in october where to stay at DuckDuckGo', 'no-referrer')

// Three sites, each arrived at from somewhere else.
for (const page of pages) read(page.url, page.title, 'cross-origin')

/**
 * And back to the first one, from a different origin.
 *
 * `came-back` deliberately does not count a `same-origin` arrival — the largest
 * published sample says 77% of fast revisits are a click home inside a site
 * somebody never left, which is not coming back to anything.
 */
const first = pages[0]
if (first !== undefined) read(first.url, first.title, 'cross-origin')

const response = await fetch(`${base}/api/capture/ambient`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-propositum-capture': '1',
    // See the header. This is the browser-attested half of the same check.
    'sec-fetch-site': 'none',
  },
  body: JSON.stringify({ observations }),
})

const body = (await response.json().catch(() => null)) as { ok?: boolean; reason?: string } | null

if (!response.ok || body?.ok !== true) {
  console.error(`The app refused the pages: ${body?.reason ?? response.status}`)
  if (body?.reason === 'session-running') {
    console.error('End the session first — Propositum offers between sessions, not during one.')
  }
  process.exit(1)
}

console.log(`Replayed ${observations.length} observations across ${pages.length} pages.`)
console.log('')
console.log('The detector runs on the next poll. Open the front door to see what it made of it:')
console.log(`  ${base}/`)
console.log('')
console.log('If the extension is not loaded, nothing polls — open the front door and reload once.')
console.log('An offer needs a key: without ANTHROPIC_API_KEY it stays a subject with no proposal.')
