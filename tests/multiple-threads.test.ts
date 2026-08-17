/**
 * An afternoon has more than one strand, and they all have to survive.
 *
 * ── What was lost, and where ─────────────────────────────────────────────
 *
 * `findThreads` has always returned EVERY thread, disjoint — a page belongs to
 * exactly one — and `detectWork` took `threads[0]`. Everything else was found
 * and thrown away with nothing anywhere recording that it had been, which is
 * worse than not finding it: a missed detection is a gap, and a discarded one
 * is a gap that looks like a gap.
 *
 * ── Weighted the way `detection.test.ts` is, and for the same reason ─────
 *
 * ADR-0008 names the false positive as the expensive failure, so the bar has to
 * be the SAME bar for every strand. Half of what is pinned below is that a
 * weaker strand cannot arrive through a back door — one bar, written once, in
 * `detectThreads`.
 *
 * The other half is the two ways showing three strands goes wrong quietly:
 * turning one down taking the others with it, and accepting one carrying
 * another's pages. Neither would look like anything from the outside. The first
 * reads as a subject that stopped being detected; the second reads as a session
 * with slightly odd sources.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  ENGAGED_MS_FOR_WORK,
  EVERY_STRAND,
  MAX_THREADS_SHOWN,
  detectThreads,
  detectWork,
  threadPagesOf,
} from '../src/domain/detection/detect'
import type { AmbientObservation } from '../src/domain/detection/detect'
import { groundsFor } from '../src/domain/detection/grounds'
import { createAmbientStore, signatureOf, SNOOZE_MS } from '../src/server/ambient-store'
import { noticedStrands, strandBySignature } from '../src/server/front-door'

// `revalidatePath` needs a request store no test process has. It is Next's
// cache talking to itself and has nothing to do with what is under test.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

/**
 * Every boundary call the poll makes, in order, tagged with the terms it was
 * asked about.
 *
 * The subject of one of the tests below rather than a debugging aid: *which
 * strands get composed for* is a fact about how many notifications the product
 * can produce, and the only place it is visible is the sequence of calls. A
 * stubbed client is what makes that sequence assertable without a key, an
 * invoice, or fifteen seconds per call.
 */
const modelCalls: string[] = []

vi.mock('@/model/provider', () => ({
  createModelClient: () => ({
    run: (boundary: { readonly name: string }, input: { readonly terms?: readonly string[] }) => {
      const terms = input.terms ?? []
      modelCalls.push(`${boundary.name}[${terms.join(',')}]`)

      if (boundary.name === 'subject') {
        return Promise.resolve({
          ok: true,
          value: { subject: terms.slice(0, 2).join(' '), confident: true },
          telemetry: {},
        })
      }

      return Promise.resolve({
        ok: true,
        value: {
          title: 'Line those up side by side',
          rationale: 'You have been at this across three sites.',
          outline: ['Read the three'],
          produces: 'A page with the three compared',
          excludes: ['Nothing is sent anywhere'],
          outcomeKinds: [],
          confident: true,
        },
        telemetry: {},
      })
    },
  }),
}))

const T0 = 1_786_471_000_000
const MINUTE = 60_000
const GOOGLE = 'https://www.google.com'

/**
 * A query as a search engine writes it: spaces as `+`, not `%20`.
 *
 * Not cosmetic. `cleanUrl` re-serialises a URL through `URLSearchParams`, which
 * emits `+`, so a fixture written with `%20` is a URL that changes shape on its
 * way into the ledger and stops matching the constant it was built from.
 */
function searchable(query: string): string {
  return encodeURIComponent(query).replace(/%20/g, '+')
}

function searchFor(at: number, query: string): AmbientObservation {
  return {
    at,
    origin: GOOGLE,
    url: `${GOOGLE}/search?q=${searchable(query)}`,
    title: `${query} - Google Search`,
    kind: 'query',
  }
}

function readPage(
  at: number,
  url: string,
  title: string,
  engagedMs: number,
): AmbientObservation {
  return { at, origin: new URL(url).origin, url, title, kind: 'navigation', engagedMs }
}

/**
 * The recorded afternoon, with the click-throughs it did not have.
 *
 * The three subjects are the ones watched live and written down at the top of
 * `topics.ts`: a perturbation/robotics search, a DMD-vs-SPO search, and Extended
 * Kalman Filters followed through to an article. That sitting produced NOTHING
 * — the person never clicked through on the first two, so no term reached two
 * origins and no thread formed — and `canonical-terms.test.ts` pins it that way
 * on purpose. This fixture is the same three subjects with the destination pages
 * the real one lacked, which is what makes it a fixture about strand COUNT
 * rather than a second copy of that test.
 *
 * **One word is changed from the recording and it is worth saying which.** The
 * second search really read *"DMD vs SPO robotics"*. With `robotics` in it, that
 * page shares a term with the perturbation strand, `findThreads` seeds on the
 * commonest term first, and the two subjects correctly become ONE thread — which
 * is the algorithm working and would leave this file asserting about two strands
 * while claiming three. So the fixture says *"policy optimization"* instead. The
 * merge it avoids is not a bug and is not being tested around; it is simply a
 * different fixture.
 *
 * Deliberately ordered so the strongest is not the one with the most reading:
 * the perturbation strand leads on page count, Kalman leads on dwell, and
 * DMD-vs-SPO trails both. `findThreads` sorts by searches, then breadth, then
 * time, so the expected order is perturbation, Kalman, DMD — and a test that
 * asserted the order of three equal strands would be asserting about nothing.
 */
const PERTURBATION_SEARCH = `${GOOGLE}/search?q=${searchable('techniques to measure peturbation robotcs')}`
const KALMAN_SEARCH = `${GOOGLE}/search?q=${searchable('Extended Kalman Filters')}`
const DMD_SEARCH = `${GOOGLE}/search?q=${searchable('DMD vs SPO policy optimization')}`

const KALMAN_ARTICLE = 'https://medium.com/@someone/extended-kalman-filters'

/** The perturbation/robotics strand. Four pages, the widest of the three. */
const PERTURBATION: AmbientObservation[] = [
  searchFor(T0, 'techniques to measure peturbation robotcs'),
  readPage(T0 + MINUTE, 'https://arxiv.org/abs/2401.1', 'Perturbation-Aware Robotics Navigation', 90_000),
  readPage(T0 + 2 * MINUTE, 'https://science.example/legged', 'Robustness to Perturbation in Legged Robotics', 40_000),
  readPage(T0 + 3 * MINUTE, 'https://github.example/sim', 'Perturbation Simulation for Robotics', 30_000),
]

/** The Kalman strand. Three pages, and the only real reading of the afternoon. */
const KALMAN: AmbientObservation[] = [
  searchFor(T0 + 4 * MINUTE, 'Extended Kalman Filters'),
  readPage(T0 + 5 * MINUTE, KALMAN_ARTICLE, 'Extended Kalman Filters', 4 * MINUTE),
  readPage(T0 + 6 * MINUTE, 'https://tds.example/ekf', 'Extended Kalman Filters in Practice', 2 * MINUTE),
]

/** The DMD-vs-SPO strand. Three pages, barely read. */
const DMD: AmbientObservation[] = [
  searchFor(T0 + 7 * MINUTE, 'DMD vs SPO policy optimization'),
  readPage(T0 + 8 * MINUTE, 'https://arxiv.org/abs/2402.2', 'DMD versus SPO for Policy Optimization', 40_000),
  readPage(T0 + 9 * MINUTE, 'https://blog.example/dmd-spo', 'Comparing DMD and SPO Policy Optimization', 20_000),
]

const AFTERNOON: AmbientObservation[] = [...PERTURBATION, ...KALMAN, ...DMD]
const NOW = T0 + 10 * MINUTE

/**
 * A fourth qualifying subject, so the bound is tested against something that
 * would otherwise be returned rather than against an empty tail.
 *
 * At module scope rather than inside one `describe`, because two questions want
 * it: how many strands the detector returns when nothing filters them, and which
 * three reach the screen once something does. The second is the one that was
 * wrong — the bound was spent before the snooze filter ran — and it cannot be
 * asked at all without a strand sitting behind the bound.
 */
const TOKIO = 'https://tokio.example/why'
const FOURTH: AmbientObservation[] = [
  searchFor(T0 + 10 * MINUTE, 'rust async runtime comparison'),
  readPage(T0 + 11 * MINUTE, TOKIO, 'Tokio async runtime for Rust', 30_000),
  readPage(T0 + 12 * MINUTE, 'https://smol.example/docs', 'Smol async runtime for Rust', 25_000),
]

const FOUR = [...AFTERNOON, ...FOURTH]
const LATER = T0 + 13 * MINUTE

/**
 * A brand-new process-wide ambient store, holding the afternoon.
 *
 * `clear()` is not enough for a test that touches the singleton, and the reason
 * is a real property rather than a testing inconvenience: a snooze deliberately
 * OUTLIVES a clear — `declined` and `declinedThreads` are the two maps `clear()`
 * leaves alone, because a clear is a person accepting or declining and "not now"
 * is supposed to hold for an hour across exactly that. So a test that declined a
 * strand would decide the next test's answer for it. Dropping the singleton is
 * the honest reset.
 */
async function freshGlobalStore(at: number, observations: readonly AmbientObservation[] = AFTERNOON) {
  globalThis.__propositumAmbient = undefined
  const { ambientStore } = await import('../src/server/capture-store')
  const shift = at - NOW
  for (const observation of observations) {
    ambientStore().record({ ...observation, at: observation.at + shift }, at)
  }
  return ambientStore()
}

/** Whichever strand holds this page. The tests name subjects, not indices. */
function strandWith(
  observations: readonly AmbientObservation[],
  url: string,
  now = NOW,
  limit = MAX_THREADS_SHOWN,
) {
  return detectThreads(observations, now, limit).find((thread) => thread.urls.includes(url))
}

/* ── every strand, not just the loudest ──────────────────────────────────── */

describe('an afternoon with three subjects in it', () => {
  it('returns all three, and not one', () => {
    const found = detectThreads(AFTERNOON, NOW)

    expect(found).toHaveLength(3)
  })

  it('returns them strongest first', () => {
    const found = detectThreads(AFTERNOON, NOW)

    // Breadth beats dwell, and dwell beats the strand that was barely read.
    // Named by their pages rather than by index, so a reordering of the fixture
    // cannot make this pass for the wrong reason.
    expect(found[0]?.urls).toContain(PERTURBATION_SEARCH)
    expect(found[1]?.urls).toContain(KALMAN_ARTICLE)
    expect(found[2]?.urls).toContain(DMD_SEARCH)
  })

  it('keeps each strand to its own pages', () => {
    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)

    expect(kalman).toBeDefined()
    expect(kalman?.urls).toEqual([KALMAN_SEARCH, KALMAN_ARTICLE, 'https://tds.example/ekf'])
    // The failure this would be: a session started on Kalman filters arriving
    // with somebody's robotics reading as approved sources.
    expect(kalman?.urls).not.toContain(PERTURBATION_SEARCH)
  })

  it('names each strand in the words that were on its own pages', () => {
    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)
    const perturbation = strandWith(AFTERNOON, PERTURBATION_SEARCH)

    expect(kalman?.terms).toContain('kalman')
    expect(perturbation?.terms).toContain('perturbation')
    expect(perturbation?.terms).not.toContain('kalman')
  })

  /**
   * `signatureOf` keys the offer cache, the name cache, `rememberThread`, the
   * notification id and the durable `WorkOffer.threadSignature`. Two strands
   * answering to one signature means the second `rememberThread` overwrites the
   * first, and somebody accepting one subject gets the other's sources.
   */
  it('gives every strand its own signature', () => {
    const signatures = detectThreads(AFTERNOON, NOW).map((thread) => signatureOf(thread.terms))

    expect(new Set(signatures).size).toBe(signatures.length)
  })
})

/* ── the bound, and the bar ──────────────────────────────────────────────── */

describe('how many strands may be shown, and which', () => {
  it('finds all four when nothing bounds it', () => {
    // Without this the bound test below would pass against a detector that had
    // simply stopped finding the fourth subject.
    expect(detectThreads(FOUR, LATER, 10)).toHaveLength(4)
  })

  it('shows no more than the bound', () => {
    expect(detectThreads(FOUR, LATER)).toHaveLength(MAX_THREADS_SHOWN)
  })

  it('drops the weakest when it has to, never the strongest', () => {
    const shown = detectThreads(FOUR, LATER)

    expect(shown.some((thread) => thread.urls.includes(PERTURBATION_SEARCH))).toBe(true)
    expect(shown.some((thread) => thread.urls.includes(TOKIO))).toBe(false)
  })

  it('asks for every strand and gets every strand', () => {
    expect(detectThreads(FOUR, LATER, EVERY_STRAND)).toHaveLength(4)
  })

  it('asks for none and gets none', () => {
    expect(detectThreads(FOUR, LATER, 0)).toEqual([])
  })

  /**
   * The back door this file exists to keep shut.
   *
   * A second strand must clear the bar `detectWork` already applied — a thread,
   * plus enough reading or one search. Three pages of a recipe across three
   * sites, glanced at, is a thread by `findThreads` and is not work by anybody's
   * standard.
   */
  it('leaves out a strand that fails the engagement bar', () => {
    const SKIMMED: AmbientObservation[] = [
      readPage(T0 + 10 * MINUTE, 'https://recipes.example/lasagne', 'Lasagne al forno', 8_000),
      readPage(T0 + 11 * MINUTE, 'https://food.example/lasagne', 'Lasagne, the easy way', 6_000),
      readPage(T0 + 12 * MINUTE, 'https://cook.example/lasagne', 'Lasagne for four', 5_000),
    ]

    const withSkimming = [...AFTERNOON, ...SKIMMED]
    const later = T0 + 13 * MINUTE

    // It IS a thread — otherwise this test is about thread formation and not
    // about the bar.
    expect(detectThreads(withSkimming, later, 10).length).toBe(3)
    expect(
      detectThreads(withSkimming, later, 10).some((thread) =>
        thread.urls.includes('https://recipes.example/lasagne'),
      ),
    ).toBe(false)
  })

  it('lets a skimmed strand in once it has been read', () => {
    // The same three pages, held long enough to be work. Without this the test
    // above would pass against a detector that had refused them for some other
    // reason entirely.
    const READ: AmbientObservation[] = [
      readPage(T0 + 10 * MINUTE, 'https://recipes.example/lasagne', 'Lasagne al forno', ENGAGED_MS_FOR_WORK),
      readPage(T0 + 11 * MINUTE, 'https://food.example/lasagne', 'Lasagne, the easy way', 6_000),
      readPage(T0 + 12 * MINUTE, 'https://cook.example/lasagne', 'Lasagne for four', 5_000),
    ]

    expect(
      detectThreads([...AFTERNOON, ...READ], T0 + 13 * MINUTE, 10).some((thread) =>
        thread.urls.includes('https://recipes.example/lasagne'),
      ),
    ).toBe(true)
  })
})

/* ── one accessor, one answer ────────────────────────────────────────────── */

describe('detectWork is the strongest strand and nothing else', () => {
  it('returns exactly what the first of detectThreads returns', () => {
    expect(detectWork(AFTERNOON, NOW)).toEqual(detectThreads(AFTERNOON, NOW)[0])
  })

  it('still answers null when there is nothing', () => {
    expect(detectWork([], NOW)).toBeNull()
    expect(detectThreads([], NOW)).toEqual([])
  })

  it('agrees with detectThreads on a buffer holding exactly one strand', () => {
    expect(detectWork(KALMAN, NOW)).toEqual(detectThreads(KALMAN, NOW)[0])
    expect(detectThreads(KALMAN, NOW)).toHaveLength(1)
  })
})

/* ── turning one down ────────────────────────────────────────────────────── */

/**
 * The trap. All three strands begin with a google search, so all three have
 * `https://www.google.com` at the head of their origins — and `decline(origin)`
 * drops every observation on a site. Saying "not now" to Kalman filters through
 * that door takes the searches that seeded the other two strands with it, and
 * the screen loses two subjects the person never answered.
 */
describe('declining one strand leaves the others where they are', () => {
  const kalmanSignature = () => {
    const strand = strandWith(AFTERNOON, KALMAN_ARTICLE)
    expect(strand).toBeDefined()
    return { signature: signatureOf(strand?.terms ?? []), urls: strand?.urls ?? [] }
  }

  function loaded() {
    const store = createAmbientStore()
    for (const observation of AFTERNOON) store.record(observation, NOW)
    return store
  }

  it('the fixture really does share a site across all three strands', () => {
    // Without this the tests below would pass against a fixture where declining
    // an origin could not have hurt anybody.
    for (const strand of detectThreads(AFTERNOON, NOW)) {
      expect(strand.origins).toContain(GOOGLE)
    }
  })

  it('drops the declined strand and keeps the rest', () => {
    const store = loaded()
    const { signature, urls } = kalmanSignature()

    store.declineThread(signature, urls, NOW)

    const left = detectThreads(store.since(NOW), NOW)
    expect(left).toHaveLength(2)
    expect(left.some((thread) => thread.urls.includes(KALMAN_ARTICLE))).toBe(false)
    expect(left.some((thread) => thread.urls.includes(PERTURBATION_SEARCH))).toBe(true)
    expect(left.some((thread) => thread.urls.includes(DMD_SEARCH))).toBe(true)
  })

  it('leaves the searches that seeded the other strands alone', () => {
    const store = loaded()
    const { signature, urls } = kalmanSignature()

    store.declineThread(signature, urls, NOW)

    // The one that would go missing if the shared site were dropped: without
    // its search page the perturbation strand loses the typed words that name
    // it, and `searched-and-followed` becomes a different sentence.
    const perturbation = strandWith(store.since(NOW), PERTURBATION_SEARCH)
    expect(perturbation?.searches).toBe(1)
    expect(perturbation?.urls).toContain(PERTURBATION_SEARCH)
  })

  it('stays quiet about that subject for the snooze, then allows it again', () => {
    const store = loaded()
    const { signature, urls } = kalmanSignature()

    store.declineThread(signature, urls, NOW)

    expect(store.isThreadSnoozed(signature, NOW + SNOOZE_MS / 2)).toBe(true)
    expect(store.isThreadSnoozed(signature, NOW + SNOOZE_MS + 1)).toBe(false)
    // And says nothing about a subject nobody answered.
    const other = strandWith(AFTERNOON, DMD_SEARCH)
    expect(store.isThreadSnoozed(signatureOf(other?.terms ?? []), NOW)).toBe(false)
  })

  /**
   * The same claim through the control the front door actually posts to, which
   * is where the wiring can be wrong while the store is right.
   */
  it('through the action the button posts to', async () => {
    const { declineThreadOffer } = await import('../src/server/actions')

    const at = Date.now()
    const ambient = await freshGlobalStore(at)

    const kalman = strandWith(ambient.since(at), KALMAN_ARTICLE, at)
    expect(kalman).toBeDefined()

    const result = await declineThreadOffer(signatureOf(kalman?.terms ?? []))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The pages it dropped are the strand's own, and not one more.
    expect(result.value.pagesDropped).toBe(kalman?.urls.length)

    const left = detectThreads(ambient.since(at), at)
    expect(left).toHaveLength(2)
    expect(left.some((thread) => thread.urls.includes(KALMAN_ARTICLE))).toBe(false)
    expect(left.some((thread) => thread.urls.includes(PERTURBATION_SEARCH))).toBe(true)
  })

  it('refuses an empty signature rather than snoozing nothing', async () => {
    const { declineThreadOffer } = await import('../src/server/actions')

    const result = await declineThreadOffer('   ')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.problem.code).toBe('invalid-input')
  })

  /**
   * The contrast, kept because it is the whole argument for a second method.
   *
   * This is what the extension's decline endpoint still does, and it is why
   * `declineThread` exists rather than the front door reusing `decline`.
   */
  it('shows what declining the SITE would have taken with it', () => {
    const store = loaded()

    store.decline(GOOGLE, NOW)

    // Not "one strand loses a page". Every strand of the afternoon began at a
    // search, so dropping the site drops the page that made each of them a
    // thread — and the screen goes empty on the strength of one "not now".
    // Measured, rather than argued: this is the answer, and it is why the
    // front door's control is keyed by signature.
    expect(detectThreads(store.since(NOW), NOW)).toEqual([])
  })
})

/* ── what the front door derives, where it can be asserted against ───────── */

/**
 * The three decisions that used to be inside `page.tsx`.
 *
 * A `.tsx` server component is the one thing in this suite nothing can render,
 * and `front-door.ts` exists because of what that cost last time: a mutation
 * that made every project render *Sleeping* left the whole suite green. These
 * fail in the same shape — a strand filtered out that should not be, a button
 * pointed at the wrong subject — and neither would look like anything.
 */
describe('what the front door would show', () => {
  function loadedStore() {
    const store = createAmbientStore()
    for (const observation of AFTERNOON) store.record(observation, NOW)
    return store
  }

  it('shows every strand, strongest first', () => {
    const store = loadedStore()
    const shown = noticedStrands(store, store.since(NOW), NOW)

    expect(shown).toHaveLength(3)
    expect(shown[0]?.detected.urls).toContain(PERTURBATION_SEARCH)
    expect(shown[2]?.detected.urls).toContain(DMD_SEARCH)
  })

  it('gives each one the signature its buttons will carry', () => {
    const store = loadedStore()
    const shown = noticedStrands(store, store.since(NOW), NOW)

    for (const strand of shown) {
      expect(strand.signature).toBe(signatureOf(strand.detected.terms))
    }
    expect(new Set(shown.map((strand) => strand.signature)).size).toBe(3)
  })

  it('leaves out a strand this screen was told to be quiet about', () => {
    const store = loadedStore()
    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)
    // Snoozed WITHOUT dropping its pages, so what is being tested is the
    // snooze check and not the page removal that ordinarily accompanies it.
    store.declineThread(signatureOf(kalman?.terms ?? []), [], NOW)

    const shown = noticedStrands(store, store.since(NOW), NOW)
    expect(shown).toHaveLength(2)
    expect(shown.some((strand) => strand.detected.urls.includes(KALMAN_ARTICLE))).toBe(false)
  })

  it('leaves out a strand whose leading site the extension declined', () => {
    // The coarser check, kept because the decline endpoint takes an origin. All
    // three strands lead with google here, so this empties the screen — which is
    // the gap `declineThread` exists to keep the front door out of.
    const store = loadedStore()
    store.decline(GOOGLE, NOW)

    expect(noticedStrands(store, store.since(NOW), NOW)).toEqual([])
  })

  it('finds the strand a button named, and not the strongest one', () => {
    const store = loadedStore()
    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)
    const picked = strandBySignature(store.since(NOW), NOW, signatureOf(kalman?.terms ?? []))

    expect(picked?.urls).toContain(KALMAN_ARTICLE)
    expect(picked?.urls).not.toContain(PERTURBATION_SEARCH)
  })

  it('finds nothing for a signature that is not there', () => {
    const store = loadedStore()

    // The ordinary "gone quiet" case and the crafted one, which want the same
    // answer: the accept path turns null into a sentence and starts nothing.
    expect(strandBySignature(store.since(NOW), NOW, 'nothing+like+this')).toBeNull()
    expect(strandBySignature(store.since(NOW), NOW, '   ')).toBeNull()
  })
})

/* ── the bound is spent on strands somebody can actually see ─────────────── */

/**
 * The failure this whole file exists to end, reintroduced one line further down.
 *
 * `MAX_THREADS_SHOWN` was handed to `detectThreads` and the snoozed strands were
 * filtered out of the RESULT, so a subject somebody had already answered "not
 * now" to spent one of the three slots and a qualifying strand behind it fell
 * off the end — off the screen, and off the pass that names and pins for the
 * screen, so it could not have been accepted even if it had been shown.
 *
 * Every test below is at four strands with one of them snoozed, because that is
 * the smallest arrangement where a bound applied at the wrong end is visible at
 * all. At three, or at four with none snoozed, both orders give the same answer.
 */
describe('a strand somebody turned down does not cost a strand somebody has not', () => {
  const ranked = () => detectThreads(FOUR, LATER, EVERY_STRAND)
  const strongest = () => signatureOf(ranked()[0]?.terms ?? [])
  const fourth = () => signatureOf(ranked()[3]?.terms ?? [])

  /** The afternoon, plus the rust strand, with one subject snoozed and its pages
   *  left alone — so what is under test is the ORDER of the bound and the
   *  filter, and not the page removal that ordinarily comes with a decline. */
  function loadedWithOneSnoozed(signature: string) {
    const store = createAmbientStore()
    for (const observation of FOUR) store.record(observation, LATER)
    store.declineThread(signature, [], LATER)
    return store
  }

  it('the fixture really does hide a fourth strand behind the bound', () => {
    // Without this every assertion below could pass against a detector that had
    // simply stopped finding four subjects.
    expect(ranked()).toHaveLength(4)
    expect(detectThreads(FOUR, LATER)).toHaveLength(MAX_THREADS_SHOWN)
    expect(fourth()).not.toBe('')
  })

  it('still shows three of them', () => {
    const store = loadedWithOneSnoozed(strongest())
    const shown = noticedStrands(store, store.since(LATER), LATER)

    expect(shown).toHaveLength(MAX_THREADS_SHOWN)
    expect(shown.map((strand) => strand.signature)).not.toContain(strongest())
    // The one that used to be dropped in silence.
    expect(shown.map((strand) => strand.signature)).toContain(fourth())
  })

  it('never shows more than three', () => {
    // The bound moved; it did not loosen. Nothing snoozed, four qualifying.
    const store = createAmbientStore()
    for (const observation of FOUR) store.record(observation, LATER)

    expect(noticedStrands(store, store.since(LATER), LATER)).toHaveLength(MAX_THREADS_SHOWN)
  })

  it('lets the promoted strand be accepted, which is the half that would fail quietly', () => {
    const store = loadedWithOneSnoozed(strongest())
    const shown = noticedStrands(store, store.since(LATER), LATER)
    const last = shown[shown.length - 1]

    // Showing it and then answering its button with "that has gone quiet" is a
    // worse outcome than not showing it, so the lookup the button reaches has to
    // be unbounded too.
    const picked = strandBySignature(store.since(LATER), LATER, last?.signature ?? '')
    expect(last?.signature).toBe(fourth())
    expect(picked?.urls).toEqual(last?.detected.urls)
    expect(picked?.urls).toContain(TOKIO)
  })

  it('lets the promoted strand be turned down, and drops its own pages', async () => {
    const { declineThreadOffer } = await import('../src/server/actions')

    const at = Date.now()
    const ambient = await freshGlobalStore(at, FOUR)
    const rust = detectThreads(ambient.since(at), at, EVERY_STRAND).find((thread) =>
      thread.urls.includes(TOKIO),
    )
    expect(rust).toBeDefined()

    const result = await declineThreadOffer(signatureOf(rust?.terms ?? []))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // A bounded lookup here finds nothing, falls through to `pagesOfThread`, and
    // snoozes the signature while leaving every page that will re-form it. That
    // failure is invisible: the strand disappears for the snooze and comes back,
    // which is what a snooze looks like anyway.
    expect(result.value.pagesDropped).toBe(rust?.urls.length)
    expect(
      detectThreads(ambient.since(at), at, EVERY_STRAND).some((thread) =>
        thread.urls.includes(TOKIO),
      ),
    ).toBe(false)
  })

  it('is named and pinned by the poll, not only rendered by the screen', async () => {
    /**
     * The other half of the same defect. The poll had the identical shape, so
     * the promoted strand was never `rememberThread`-pinned — and
     * `observedOriginPatterns` answers an empty page list with no sites at all,
     * so accepting it would have been refused with "Propositum has no record of
     * the work this describes".
     *
     * No key, so no model call is made and none is needed: what is under test is
     * the deterministic half.
     */
    const key = process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']

    try {
      const { captureStore } = await import('../src/server/capture-store')
      const { CUSTOM_HEADER } = await import('../src/capture/transport')
      const { GET } = await import('../src/app/api/session/current/route')

      captureStore().end()

      const at = Date.now()
      const ambient = await freshGlobalStore(at, FOUR)
      const all = detectThreads(ambient.since(at), at, EVERY_STRAND)
      expect(all).toHaveLength(4)
      ambient.declineThread(signatureOf(all[0]?.terms ?? []), [], at)

      const response = await GET(
        new Request('http://localhost:3117/api/session/current', {
          headers: { [CUSTOM_HEADER]: '1', 'sec-fetch-site': 'none' },
        }),
      )
      const body = (await response.json()) as { suggestion: { thread?: string } | null }

      const promoted = all[3]
      expect(ambient.pagesOfThread(signatureOf(promoted?.terms ?? []))).toEqual(promoted?.urls)
      // And the badge names the strongest strand still standing, not the one
      // that was turned down.
      expect(body.suggestion?.thread).toBe(signatureOf(all[1]?.terms ?? []))
    } finally {
      if (key === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = key
    }
  })
})

/* ── how many strands may be composed for, which is a different number ───── */

/**
 * What the extra strands cost, and which of them can interrupt somebody.
 *
 * Naming runs for every strand on the screen — the front door renders the
 * subject, and a name interrupts nobody. Composing is different in kind: the
 * poll returns `kind: 'work-offer'` for whichever strand leads, and
 * `service-worker.js` turns exactly that into a `requireInteraction`
 * notification. A strand holding an offer before it has ever led is a strand
 * ready to interrupt somebody about a subject they have never been shown.
 */
describe('what the poll spends on three strands', () => {
  /**
   * The estimate this replaced said a secondary strand "rarely clears the higher
   * bar". Measured, two of the three do.
   *
   * Pinned as a fixture because a stated cost is the only guard there is —
   * PRODUCT_PRINCIPLES §13 records that offer-rate creep is caught by nothing —
   * and because the comment in `route.ts` now asserts this number out loud. If
   * `grounds.ts` moves and this becomes one of three, the sentence describing it
   * has to move too.
   */
  it('two of the three strands clear the grounds bar', () => {
    const clearing = detectThreads(AFTERNOON, NOW).filter(
      (strand) => groundsFor(strand, threadPagesOf(AFTERNOON, strand, NOW)).sufficient,
    )

    expect(detectThreads(AFTERNOON, NOW)).toHaveLength(3)
    expect(clearing).toHaveLength(2)
  })

  it('names every strand and composes for the leading one only', async () => {
    process.env['ANTHROPIC_API_KEY'] = 'not-a-real-key-the-client-is-stubbed'
    modelCalls.length = 0

    try {
      const { captureStore } = await import('../src/server/capture-store')
      const { CUSTOM_HEADER } = await import('../src/capture/transport')
      const { GET } = await import('../src/app/api/session/current/route')

      captureStore().end()

      const at = Date.now()
      const ambient = await freshGlobalStore(at)
      const signatures = detectThreads(ambient.since(at), at).map((strand) =>
        signatureOf(strand.terms),
      )
      expect(signatures).toHaveLength(3)

      // Three polls: the first names, the second composes off the names, the
      // third would compose for anything the second left. Naming and composing
      // are both fire-and-forget, so each poll is followed by a turn of the
      // event loop rather than awaited.
      for (let poll = 0; poll < 3; poll += 1) {
        await GET(
          new Request('http://localhost:3117/api/session/current', {
            headers: { [CUSTOM_HEADER]: '1', 'sec-fetch-site': 'none' },
          }),
        )
        await new Promise((resolve) => setTimeout(resolve, 25))
      }

      // Every strand named: this is what the front door renders, and it is the
      // reason the poll does any of this for a screen it does not draw.
      for (const signature of signatures) {
        expect(ambient.nameFor(signature)?.confident).toBe(true)
      }

      // One offer, for the strand the response is about. The second strand
      // clears the grounds bar — the test above says so — so this is a decision
      // about leadership and not the bar declining to fire.
      expect(ambient.offerFor(signatures[0] ?? '')).not.toBeNull()
      expect(ambient.offerFor(signatures[1] ?? '')).toBeNull()
      expect(ambient.offerFor(signatures[2] ?? '')).toBeNull()

      expect(modelCalls.filter((call) => call.startsWith('subject['))).toHaveLength(3)
      expect(modelCalls.filter((call) => call.startsWith('offer['))).toHaveLength(1)
    } finally {
      delete process.env['ANTHROPIC_API_KEY']
    }
  })
})

/* ── which pages an acceptance carries ───────────────────────────────────── */

/**
 * `rememberThread` is how the right pages reach the ledger, and it is keyed by
 * signature. The end-to-end version of this — a real session, a real approval,
 * real `ObservationEvent`s — is in `tests/start-from-suggestion.test.ts`, which
 * has the database. This is the same claim at the seam where it is decided.
 */
describe('accepting the second strand pins the second strand', () => {
  it('remembers the pages of whichever strand was answered', () => {
    const store = createAmbientStore()
    for (const observation of AFTERNOON) store.record(observation, NOW)

    for (const strand of detectThreads(store.since(NOW), NOW)) {
      store.rememberThread(signatureOf(strand.terms), strand.urls)
    }

    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)
    const perturbation = strandWith(AFTERNOON, PERTURBATION_SEARCH)

    expect(store.pagesOfThread(signatureOf(kalman?.terms ?? []))).toEqual(kalman?.urls)
    expect(store.pagesOfThread(signatureOf(perturbation?.terms ?? []))).toEqual(perturbation?.urls)
    // The two are genuinely different lists, or the assertions above prove
    // nothing about routing.
    expect(kalman?.urls).not.toEqual(perturbation?.urls)
  })

  it('pins every strand the screen will show, so any of them can be accepted', async () => {
    /**
     * The poll, not the screen.
     *
     * `/api/session/current` is the only thing in the product on a timer, and it
     * is where a strand's pages get pinned against its signature. If it pinned
     * only the strongest, the accept path for the second and third would find
     * `pagesOfThread` empty — and `observedOriginPatterns` answers an empty page
     * list with no sites at all, so accepting them would be refused with
     * "Propositum has no record of the work this describes".
     *
     * No `ANTHROPIC_API_KEY` here, so no model call is made and none is needed:
     * what is under test is the deterministic half.
     */
    const key = process.env['ANTHROPIC_API_KEY']
    delete process.env['ANTHROPIC_API_KEY']

    try {
      const { captureStore } = await import('../src/server/capture-store')
      const { CUSTOM_HEADER } = await import('../src/capture/transport')
      const { GET } = await import('../src/app/api/session/current/route')

      captureStore().end()

      // Recorded relative to now, because the route reads the wall clock and a
      // buffer stamped in 2026 would be outside the window by the time it looks.
      const at = Date.now()
      const ambient = await freshGlobalStore(at)

      const response = await GET(
        new Request('http://localhost:3117/api/session/current', {
          headers: { [CUSTOM_HEADER]: '1', 'sec-fetch-site': 'none' },
        }),
      )
      const body = (await response.json()) as { suggestion: { thread?: string } | null }

      const strands = detectThreads(ambient.since(at), at)
      expect(strands).toHaveLength(3)

      for (const strand of strands) {
        expect(ambient.pagesOfThread(signatureOf(strand.terms))).toEqual(strand.urls)
      }

      // And exactly one of them is what the extension badges and notifies from.
      // ADR-0008 names interruption as the expensive failure; three strands is
      // more to read on a screen somebody opened, never three notifications.
      expect(body.suggestion?.thread).toBe(signatureOf(strands[0]?.terms ?? []))
    } finally {
      if (key === undefined) delete process.env['ANTHROPIC_API_KEY']
      else process.env['ANTHROPIC_API_KEY'] = key
    }
  })

  it('carries only that strand when the buffer is read back by its urls', () => {
    const store = createAmbientStore()
    for (const observation of AFTERNOON) store.record(observation, NOW)

    const kalman = strandWith(AFTERNOON, KALMAN_ARTICLE)
    store.rememberThread(signatureOf(kalman?.terms ?? []), kalman?.urls ?? [])

    const carried = store.forUrls(store.pagesOfThread(signatureOf(kalman?.terms ?? [])), NOW)
    const urls = [...new Set(carried.map((observation) => observation.url))]

    expect(urls).toEqual([KALMAN_SEARCH, KALMAN_ARTICLE, 'https://tds.example/ekf'])
  })
})
