/**
 * A read-only lab bench for the intent detector, for showing somebody how an
 * afternoon becomes an offer.
 *
 * Feeds ambient observations through the real pipeline — `detectThreads` →
 * `threadPagesOf` → `groundsFor` — and prints, per strand, the grounds that
 * fired with their consumer sentences, the grounds that did not with the
 * measurement that fell short, the intent count against `INTENT_REQUIRED`, the
 * axis count against `INVESTMENT_REQUIRED`, and the verdict.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * It is not a test and nothing imports it. It touches no database, makes no
 * model call and opens no socket, so it says nothing about `composeOffer`,
 * about the two gates above `grounds.sufficient` (`leads` and notification
 * suppression), or about anything downstream of somebody saying yes. It reads
 * the arithmetic half of the offer decision and only that half.
 *
 * The "what if the bar moved" table at the end recomputes sufficiency from the
 * grounds that ALREADY fired. It does not re-run detection, so it cannot show
 * the effect of moving a DURATION — only of moving the two counting rules.
 *
 *   npx tsx intent-lab.ts               # all scenarios
 *   npx tsx intent-lab.ts --only=news   # substring match on the scenario name
 *   npx tsx intent-lab.ts --quiet       # verdict lines only
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { detectThreads, threadPagesOf, FAST_DETECT, WINDOW_MS } from './src/domain/detection/detect'
import type { AmbientObservation, Arrival, ExitType } from './src/domain/detection/detect'
import {
  groundsFor,
  INTENT_GROUNDS,
  INVESTMENT_GROUNDS,
  INVESTMENT_AXES,
  INTENT_REQUIRED,
  INVESTMENT_REQUIRED,
  DEEP_READ_MS,
  SUSTAINED_MS,
  ORIGINS_FOR_OFFER,
  PAGES_ON_ONE_ORIGIN,
  READ_AROUND_MS,
  COMPARED_ORIGINS,
  COMPARISON_SCROLL_FRACTION,
  QUERIES_FOR_REFINEMENT,
  PAGES_AFTER_QUERY_FOR_OFFER,
} from './src/domain/detection/grounds'
import type { GroundKind } from './src/domain/detection/grounds'

/* ── plumbing ──────────────────────────────────────────────────────────── */

const args = new Set(process.argv.slice(2))
const only = [...args].find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? ''
const quiet = args.has('--quiet')

const B = (s: string) => `\x1b[1m${s}\x1b[0m`
const D = (s: string) => `\x1b[2m${s}\x1b[0m`
const G = (s: string) => `\x1b[32m${s}\x1b[0m`
const R = (s: string) => `\x1b[31m${s}\x1b[0m`
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`
const C = (s: string) => `\x1b[36m${s}\x1b[0m`

const secs = (ms: number) => `${Math.round(ms / 1000)}s`
const mins = (ms: number) => `${(ms / 60_000).toFixed(1)}m`

type Page = ReturnType<typeof threadPagesOf>[number]

/** The veto, restated here so the read-out can name it. `grounds.ts` owns the
 *  real one; this copy is only ever used to EXPLAIN, never to decide. */
const parked = (p: Page) => p.scrollFraction === 0 && p.exitType === 'hidden'

interface Verdict {
  readonly scenario: string
  readonly strand: number
  readonly kinds: readonly GroundKind[]
  readonly intent: number
  readonly axes: number
  readonly sufficient: boolean
}

const verdicts: Verdict[] = []

/* ── the read-out ──────────────────────────────────────────────────────── */

function report(name: string, note: string, observations: readonly AmbientObservation[], now: number): void {
  if (only !== '' && !name.toLowerCase().includes(only.toLowerCase())) return

  console.log('\n' + B('━'.repeat(84)))
  console.log(B(name))
  if (note !== '') console.log(D('  ' + note))
  console.log(D(`  ${observations.length} observations in the buffer`))

  const threads = detectThreads(observations, now)
  if (threads.length === 0) {
    console.log(
      '\n  ' + R('no thread formed') +
        D('  — nothing shared a subject across 2 origins over 3 pages, or the strand'),
    )
    console.log(D('                     was under ENGAGED_MS_FOR_WORK with no search in it.'))
    console.log('  ' + B('offer? ') + Y('no — Propositum stays quiet'))
    return
  }

  threads.forEach((detected, i) => {
    const pages = threadPagesOf(observations, detected, now)
    const grounds = groundsFor(detected, pages)

    const intent = grounds.kinds.filter((k) => (INTENT_GROUNDS as readonly GroundKind[]).includes(k))
    const hitAxes = INVESTMENT_AXES.filter((axis) =>
      (axis as readonly GroundKind[]).some((k) => grounds.kinds.includes(k)),
    )

    verdicts.push({
      scenario: name,
      strand: i + 1,
      kinds: grounds.kinds,
      intent: intent.length,
      axes: hitAxes.length,
      sufficient: grounds.sufficient,
    })

    /* what the detector thinks this strand IS */
    const span = pages.length === 0 ? 0 : Math.max(...pages.map((p) => p.at)) - Math.min(...pages.map((p) => p.at))
    const deepest = Math.max(0, ...pages.filter((p) => !parked(p)).map((p) => p.engagedMs))
    const perOrigin = new Map<string, number>()
    for (const p of pages) {
      if (p.engagedMs >= READ_AROUND_MS && !parked(p)) perOrigin.set(p.origin, (perOrigin.get(p.origin) ?? 0) + 1)
    }
    const bestOrigin = [...perOrigin.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['—', 0]
    const parkedCount = pages.filter(parked).length

    console.log(
      `\n  ${B(`strand ${i + 1}`)}  ${C(detected.labels.slice(0, 5).join(' '))}` +
        D(`   because: ${detected.because}`),
    )
    console.log(
      D(
        `    ${detected.origins.length} sites · ${pages.length} pages · ${detected.searches} searches · ` +
          `${mins(detected.engagedMs)} engaged · ${mins(span)} span` +
          (parkedCount > 0 ? ` · ${parkedCount} page(s) parked and vetoed` : ''),
      ),
    )

    if (!quiet) {
      /* the sentences a person would actually be shown */
      console.log('\n  ' + D('── what it says to you ─────────────────────────────'))
      if (grounds.sentences.length === 0) console.log(D('     (nothing — no ground fired)'))
      for (const s of grounds.sentences) console.log(`     ${G('✓')} ${s}`)

      /* and the ones that did not, with the measurement that fell short */
      const why: Record<GroundKind, string> = {
        'searched-then-read': `${detected.searches} searches, needs ≥1 then ≥${PAGES_AFTER_QUERY_FOR_OFFER} pages after`,
        'refined-the-search': `${detected.searches} searches, needs ≥${QUERIES_FOR_REFINEMENT}`,
        'came-back': `no page revisited from another site (same-origin returns do not count)`,
        'read-deeply': `deepest unparked read ${secs(deepest)}, needs ≥${secs(DEEP_READ_MS)}`,
        'stayed-with-it': `span ${mins(span)}, needs ≥${mins(SUSTAINED_MS)}`,
        'followed-across': `${detected.origins.length} sites, needs ≥${ORIGINS_FOR_OFFER}`,
        'read-around': `best site has ${bestOrigin[1]} pages read ≥${secs(READ_AROUND_MS)}, needs ≥${PAGES_ON_ONE_ORIGIN} (on ${bestOrigin[0]})`,
        'compared-options': `needs ≥${COMPARED_ORIGINS} sites, every page ≥${secs(READ_AROUND_MS)} and scrolled ≥${COMPARISON_SCROLL_FRACTION}, plus a cross-origin return`,
      }
      const missed = [...INTENT_GROUNDS, ...INVESTMENT_GROUNDS].filter((k) => !grounds.kinds.includes(k))
      if (missed.length > 0) {
        console.log('\n  ' + D('── what did not fire, and why ──────────────────────'))
        for (const k of missed) console.log(D(`     ✗ ${k.padEnd(20)} ${why[k]}`))
      }
    }

    /* the decision, which has no model in it */
    const intentOk = intent.length >= INTENT_REQUIRED
    const axesOk = hitAxes.length >= INVESTMENT_REQUIRED
    console.log('\n  ' + D('── the arithmetic ──────────────────────────────────'))
    console.log(
      `     did you CHOOSE this   ${(intentOk ? G : R)(String(intent.length))} / ${INTENT_REQUIRED} intent grounds` +
        D(`   [${intent.join(', ') || '—'}]`),
    )
    console.log(
      `     did you INVEST in it  ${(axesOk ? G : R)(String(hitAxes.length))} / ${INVESTMENT_REQUIRED} axes` +
        D(`          [${hitAxes.map((a) => a.join('|')).join(', ') || '—'}]`),
    )
    console.log(
      '     ' + B('offer?') + '                ' +
        (grounds.sufficient ? G('YES — Propositum speaks') : Y('no — Propositum stays quiet')),
    )
  })
}

/* ── 1. the two committed fixtures, replayed and self-checked ──────────── */

interface Fixture {
  readonly note: string
  readonly now: number
  readonly observations: AmbientObservation[]
  readonly grounds: { readonly kinds: string[]; readonly sentences: string[]; readonly sufficient: boolean }
}

const checks: string[] = []

for (const file of ['world-models-synthesised', 'comparing-monitors-synthesised']) {
  const fx = JSON.parse(
    readFileSync(join(import.meta.dirname, 'src/fixtures/afternoons', `${file}.json`), 'utf8'),
  ) as Fixture

  report(`FIXTURE — ${file}`, fx.note.split('.')[0] + '.', fx.observations, fx.now)

  /* The fixture carries what the repo already asserts about it. If this bench
   * disagrees, the bench is wrong and not the detector. */
  const strand = detectThreads(fx.observations, fx.now)[0]
  const got = strand === undefined ? null : groundsFor(strand, threadPagesOf(fx.observations, strand, fx.now))
  const agrees =
    got !== null &&
    JSON.stringify(got.kinds) === JSON.stringify(fx.grounds.kinds) &&
    JSON.stringify(got.sentences) === JSON.stringify(fx.grounds.sentences) &&
    got.sufficient === fx.grounds.sufficient
  checks.push(`${agrees ? G('agrees') : R('DISAGREES')}  ${file}`)
}

/* ── 2. afternoons built here, to move the bar on purpose ──────────────── */

const T0 = 1_787_000_000_000
const min = (n: number) => n * 60_000

function nav(t: number, origin: string, path: string, title: string, arrival: Arrival): AmbientObservation {
  return { at: T0 + t, origin, url: `${origin}${path}`, title, kind: 'navigation', arrival }
}
function query(t: number, q: string): AmbientObservation {
  return {
    at: T0 + t,
    origin: 'https://www.google.com',
    url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    title: `${q} - Google Search`,
    kind: 'query',
    arrival: 'no-referrer',
  }
}
function read(
  t: number, origin: string, path: string, title: string,
  seconds: number, scrollFraction: number, exitType: ExitType = 'left-cached',
): AmbientObservation {
  return {
    at: T0 + t, origin, url: `${origin}${path}`, title,
    kind: 'engagement', engagedMs: seconds * 1000, scrollFraction, exitType,
  }
}

/* (a) The standing false positive. Twelve pieces, three sites, 45s each, and
 *     nothing searched — an afternoon of clearing a newsletter backlog. */
const NEWS = ['https://news-a.example', 'https://news-b.example', 'https://news-c.example']
const newsletter: AmbientObservation[] = []
for (let i = 0; i < 12; i += 1) {
  const site = NEWS[i % 3] as string
  const t = min(i * 1.5)
  const title = `Kubernetes operator patterns, part ${i + 1}`
  newsletter.push(nav(t, site, `/piece/${i}`, title, 'cross-origin'))
  newsletter.push(read(t + 5_000, site, `/piece/${i}`, title, 45, 0.6))
}
report(
  'SYNTHETIC — clearing a newsletter backlog',
  'Twelve pieces, three sites, 45s each, nothing searched, nothing returned to. Must stay quiet.',
  newsletter,
  T0 + min(19),
)

/* (a2) The same backlog, except they searched for it once and read on. That
 *      single search buys the intent ground, and the investment half was
 *      already clear — this is the false positive `grounds.ts` §8 admits it
 *      tolerates, reproduced. */
const searchedNewsletter: AmbientObservation[] = [
  query(0, 'kubernetes operator patterns'),
  ...newsletter.map((o) => ({ ...o, at: o.at + min(1) })),
]
report(
  'SYNTHETIC — the same backlog, but they searched for it first',
  'One search added. Nothing else changed. This is the admitted false positive.',
  searchedNewsletter,
  T0 + min(20),
)

/* (b) Genuine research: searched, refined, read deeply, came back from
 *     elsewhere. Should speak. */
const research: AmbientObservation[] = [
  query(0, 'retrieval augmented generation evaluation'),
  nav(min(1), 'https://arxiv.org', '/abs/2501.11111', 'Evaluating Retrieval Augmented Generation', 'cross-origin'),
  read(min(1) + 5_000, 'https://arxiv.org', '/abs/2501.11111', 'Evaluating Retrieval Augmented Generation', 140, 0.8),
  nav(min(4), 'https://arxiv.org', '/abs/2501.22222', 'Retrieval Augmented Generation Benchmarks', 'same-origin'),
  read(min(4) + 5_000, 'https://arxiv.org', '/abs/2501.22222', 'Retrieval Augmented Generation Benchmarks', 90, 0.7),
  nav(min(7), 'https://arxiv.org', '/abs/2501.33333', 'A Survey of Retrieval Augmented Generation', 'same-origin'),
  read(min(7) + 5_000, 'https://arxiv.org', '/abs/2501.33333', 'A Survey of Retrieval Augmented Generation', 60, 0.55),
  query(min(10), 'retrieval augmented generation evaluation harness'),
  nav(min(11), 'https://github.com', '/org/rag-eval', 'rag-eval — a retrieval augmented generation harness', 'cross-origin'),
  read(min(11) + 5_000, 'https://github.com', '/org/rag-eval', 'rag-eval — a retrieval augmented generation harness', 120, 0.5),
  nav(min(14), 'https://openreview.net', '/forum', 'Retrieval Augmented Generation Evaluation Track', 'cross-origin'),
  read(min(14) + 5_000, 'https://openreview.net', '/forum', 'Retrieval Augmented Generation Evaluation Track', 80, 0.4),
  /* back to the first paper, arriving from a different site */
  nav(min(17), 'https://arxiv.org', '/abs/2501.11111', 'Evaluating Retrieval Augmented Generation', 'cross-origin'),
  read(min(17) + 5_000, 'https://arxiv.org', '/abs/2501.11111', 'Evaluating Retrieval Augmented Generation', 70, 0.9),
]
report(
  'SYNTHETIC — an afternoon of real research',
  'Searched, refined the search, read deeply, and came back to the first paper from elsewhere.',
  research,
  T0 + min(19),
)

/* (c) The same afternoon with every tab PARKED — opened, never scrolled,
 *     switched away from. `heldOpenUnread` should strike the reading grounds. */
const parkedAfternoon = research.map((o) =>
  o.kind === 'engagement' ? { ...o, scrollFraction: 0, exitType: 'hidden' as ExitType } : o,
)
report(
  'SYNTHETIC — the same afternoon, every tab parked and never touched',
  'Identical navigation. Every engagement now scrollFraction 0, exitType hidden — the heldOpenUnread veto.',
  parkedAfternoon,
  T0 + min(19),
)

/* ── 3. what the bench checked itself against ──────────────────────────── */

console.log('\n' + B('━'.repeat(84)))
console.log(B('Self-check — bench output vs the grounds the fixtures already assert'))
for (const c of checks) console.log('  ' + c)
console.log(
  D('  A disagreement here means this file is wrong, not the detector.') +
    (FAST_DETECT ? '\n  ' + R('PROPOSITUM_FAST_DETECT is ON — every duration is 20× shorter than normal.') : ''),
)
console.log(D(`  window ${mins(WINDOW_MS)} · deep read ${secs(DEEP_READ_MS)} · sustained ${mins(SUSTAINED_MS)}`))

/* ── 4. move the bar, using the grounds that already fired ─────────────── */

console.log('\n' + B('━'.repeat(84)))
console.log(B('If the bar moved — same afternoons, same fired grounds, different rule'))
console.log(D('  Recomputed from the grounds above. Moving a DURATION would need a re-run, so'))
console.log(D('  this table only moves the two counting rules.\n'))

const bars: ReadonlyArray<readonly [number, number, string]> = [
  [1, 2, 'as shipped'],
  [1, 1, 'INVESTMENT_REQUIRED → 1'],
  [2, 2, 'INTENT_REQUIRED → 2'],
  [0, 2, 'INTENT_REQUIRED → 0'],
]

const label = (v: Verdict) =>
  v.scenario.replace(/^(FIXTURE|SYNTHETIC) — /, '') + (v.strand > 1 ? ` #${v.strand}` : '')
const width = Math.max(...verdicts.map((v) => label(v).length), 10)
const COL = 24

console.log(
  D('  ' + 'afternoon'.padEnd(width) + '  grounds  ' + bars.map(([, , n]) => n.padEnd(COL)).join('')),
)
for (const v of verdicts) {
  const cells = bars.map(([i, a]) => {
    const ok = v.intent >= i && v.axes >= a
    return (ok ? G : Y)((ok ? 'speaks' : 'quiet').padEnd(COL))
  })
  console.log('  ' + label(v).padEnd(width) + D(`  ${v.intent}i/${v.axes}a   `) + cells.join(''))
}
console.log(
  '\n' +
    D('  Read the columns, not the rows. Two afternoons clear the investment half and\n') +
    D('  are stopped by the intent half alone; one clears intent and is stopped by\n') +
    D('  investment. Whichever bar you lower, some afternoon you did not mean starts\n') +
    D('  speaking — which is the whole of the argument on 2026-08-16.'),
)
console.log()
