/**
 * Can an afternoon be saved and played back, and does it come back the same?
 *
 * ── The defect this closes, in three sentences ───────────────────────────
 *
 * Three signals landed on the ambient path this week — `scrollFraction`,
 * `exitType` and `arrival` — and `/api/capture/ambient/debug` reported none of
 * them, so nobody could see one in a live session. The only real-session
 * fixture in the repo was made by copying that response by hand
 * (`tests/topics.test.ts`:46), so no fixture could contain them either. Both
 * halves are the same defect: the buffer was only ever visible through a
 * summary, and a summary cannot be replayed.
 *
 * ── What each block here is for ──────────────────────────────────────────
 *
 *   - *what the endpoint shows* — the emitted rows are EXACTLY the fields
 *     `AmbientObservation` declares. Both directions matter: a missing field is
 *     the defect above, and an unexpected one is a privacy widening nobody
 *     decided on, since this response hands over the whole buffer.
 *   - *the round trip* — the capture path, driven through the real routes:
 *     browsing in, response out, file shape in, same three answers back.
 *   - *the saved afternoon* — a file on disk, which the buffer deliberately is
 *     not, replaying to the answers it recorded.
 *   - *still nobody's decision* — the three signals ride the whole way round
 *     and change no answer. `tests/reachability.test.ts` pins that structurally
 *     by counting mentions; this pins it behaviourally, on a real buffer.
 *
 * ── Why the real route handlers and not a hand-built store ───────────────
 *
 * Because the projection is the thing under test. `tests/capture-api.test.ts`
 * drives the ambient POST handler directly for the same reason and says so:
 * what is worth pinning is the schema and the projection into
 * `AmbientObservation`, and a running server adds nothing but flakiness. This
 * file adds the second projection — the debug response — because a fixture cut
 * from a projection cannot reproduce a bug in the projection.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { POST as ambientRoute } from '../src/app/api/capture/ambient/route'
import { GET as debugRoute } from '../src/app/api/capture/ambient/debug/route'
import { CUSTOM_HEADER } from '../src/capture/transport'
import type { AmbientObservation } from '../src/domain/detection/detect'
import {
  EVERY_KIND_IS_LISTED,
  loadAfternoon,
  parseAfternoon,
  replayAfternoon,
} from '../src/fixtures/afternoon'
import type { CapturedAfternoon } from '../src/fixtures/afternoon'
import { ambientObservationFields } from './support/ambient-fields'

const MINUTE = 60_000

/** The name the committed capture was saved under. Its own `note` says what it
 *  is and, more to the point, what it is not. */
const SAVED = 'world-models-synthesised'

/** The second capture, added 2026-08-20 with `compared-options`. See its own
 *  describe block for why one afternoon on disk was not enough. */
const COMPARING = 'comparing-monitors-synthesised'

const post = (observations: readonly unknown[]) =>
  new Request('http://127.0.0.1:3117/api/capture/ambient', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CUSTOM_HEADER]: '1',
      // A forbidden header name, so no page can forge it and a non-browser
      // caller sends it freely. See src/capture/transport.ts.
      'sec-fetch-site': 'none',
    },
    body: JSON.stringify({ observations }),
  })

const debug = (
  headers: Record<string, string> = { [CUSTOM_HEADER]: '1', 'sec-fetch-site': 'none' },
) => new Request('http://127.0.0.1:3117/api/capture/ambient/debug', { headers })

interface DebugBody {
  readonly held: number
  readonly now: number
  readonly observations: readonly Record<string, unknown>[]
  readonly detectsWork: unknown
  readonly detectsPause: unknown
  readonly grounds: unknown
}

async function capture(observations: readonly unknown[]): Promise<DebugBody> {
  const posted = await ambientRoute(post(observations))
  expect(posted.status, 'the buffer refused the browsing this test is about').toBe(200)

  const response = await debugRoute(debug())
  expect(response.status).toBe(200)
  return (await response.json()) as DebugBody
}

beforeEach(() => {
  // The store is a process-wide singleton hung off globalThis, and `clear()` is
  // not enough because a snooze deliberately outlives one. Dropping the
  // instance is the honest reset, as tests/multiple-threads.test.ts does.
  globalThis.__propositumAmbient = undefined
})

/**
 * An afternoon of reading, in the shape the extension sends.
 *
 * Six pages across three origins, two searches, one page returned to, and every
 * engagement carrying scroll and an exit type. It is invented; what makes it
 * worth replaying is that it goes through the real schema and the real
 * projection on the way in.
 */
function anAfternoon(now: number): readonly unknown[] {
  const base = now - 25 * MINUTE
  const a1 = 'https://arxiv.org/abs/2401.11111'
  const a2 = 'https://arxiv.org/abs/2401.22222'

  return [
    {
      at: base,
      url: 'https://www.google.com/search?q=world+models+survey',
      title: 'world models survey - Google Search',
      kind: 'query',
      arrival: 'no-referrer',
    },
    {
      at: base + 30_000,
      url: a1,
      title: 'World Models: A Survey',
      kind: 'navigation',
      arrival: 'cross-origin',
    },
    {
      at: base + 2 * MINUTE,
      url: a1,
      title: '',
      kind: 'engagement',
      engagedMs: 75_000,
      scrollFraction: 0.68,
      exitType: 'left-unloaded',
    },
    {
      at: base + 3 * MINUTE,
      url: a2,
      title: 'Learning World Models — a Survey',
      kind: 'navigation',
      arrival: 'same-origin',
    },
    {
      at: base + 4 * MINUTE,
      url: a2,
      title: '',
      kind: 'engagement',
      engagedMs: 41_000,
      scrollFraction: 0.42,
      exitType: 'left-cached',
    },
    {
      at: base + 6 * MINUTE,
      url: 'https://openreview.net/forum?id=WMBench',
      title: 'World Model Benchmarks — A Survey',
      kind: 'navigation',
      arrival: 'cross-origin',
    },
    {
      at: base + 7 * MINUTE,
      url: 'https://openreview.net/forum?id=WMBench',
      title: '',
      kind: 'engagement',
      engagedMs: 52_000,
      scrollFraction: 0.31,
      exitType: 'hidden',
    },
    {
      at: base + 9 * MINUTE,
      url: a1,
      title: 'World Models: A Survey',
      kind: 'navigation',
      arrival: 'back-or-forward',
    },
    {
      at: base + 10 * MINUTE,
      url: a1,
      title: '',
      kind: 'engagement',
      engagedMs: 96_000,
      scrollFraction: 0.91,
      exitType: 'hidden',
    },
  ]
}

describe('what the debug endpoint shows', () => {
  it('emits every field the buffer holds, and only those', async () => {
    /**
     * The assertion that makes the other three worth having.
     *
     * `ambientObservationFields()` reads the declaration out of `detect.ts`
     * rather than trusting a list written here — see its own header for the
     * measured reason, which is that a test asserting `Object.keys` of a
     * literal it just built can only fail if somebody edits the test.
     *
     * Equality rather than `toContain`, in both directions and deliberately:
     *
     *   - a field DROPPED is the defect this whole change exists about, and
     *     three of them went missing for a week without a red test;
     *   - a field APPEARING is a privacy widening nobody decided on. This
     *     response is the whole buffer now, and the endpoint emits its rows
     *     whole precisely so it cannot drop one — which means it also cannot
     *     refuse one. This is the test that catches the second half.
     */
    const now = Date.now()

    const body = await capture([
      {
        at: now - MINUTE,
        url: 'https://arxiv.org/abs/2401.11111',
        title: 'World Models: A Survey',
        kind: 'engagement',
        engagedMs: 75_000,
        scrollFraction: 0.68,
        exitType: 'left-unloaded',
        arrival: 'cross-origin',
        groupTitle: 'world models',
      },
    ])

    expect(body.observations).toHaveLength(1)
    expect(Object.keys(body.observations[0] ?? {}).sort()).toEqual(ambientObservationFields())
  })

  it('reports the three signals landed this week, which it did not before', async () => {
    // Named one by one rather than left to the key-set check above, because the
    // key-set check would go green on a row that carried all ten keys with the
    // three interesting ones nulled out.
    const now = Date.now()

    const body = await capture([
      {
        at: now - MINUTE,
        url: 'https://arxiv.org/abs/2401.11111',
        title: 'World Models: A Survey',
        kind: 'engagement',
        engagedMs: 75_000,
        scrollFraction: 0.68,
        exitType: 'left-unloaded',
        arrival: 'cross-origin',
      },
    ])

    const row = body.observations[0]
    expect(row?.scrollFraction).toBe(0.68)
    expect(row?.exitType).toBe('left-unloaded')
    expect(row?.arrival).toBe('cross-origin')
  })

  it('carries the clock the answers were computed at, or a capture cannot be replayed', async () => {
    const now = Date.now()
    const body = await capture([
      { at: now - MINUTE, url: 'https://arxiv.org/abs/1', title: 'One', kind: 'navigation' },
    ])

    expect(typeof body.now).toBe('number')
    // Within the window, or every replay of this capture answers null and looks
    // like a detector that broke.
    expect(body.now).toBeGreaterThanOrEqual(now)
  })

  it('still refuses a caller that cannot send the two headers', async () => {
    /**
     * The guard, pinned here because this change made the prize much larger.
     *
     * Before, a caller that got past it read back origins, page counts and up
     * to eight titles each. It now reads back the buffer — every cleaned URL,
     * every title, per-page dwell, and the three signals. The endpoint's own
     * docblock argues that the transport controls are what make that
     * acceptable, so a test that the controls still bite belongs beside the
     * change that raised the stakes.
     */
    const noHeader = await debugRoute(debug({}))
    expect(noHeader.status).toBe(403)
    expect(await noHeader.json()).toEqual({ ok: false, reason: 'missing-custom-header' })

    const noProof = await debugRoute(
      debug({ [CUSTOM_HEADER]: '1', origin: 'https://evil.example' }),
    )
    expect(noProof.status).toBe(403)
  })
})

describe('the round trip', () => {
  it('an afternoon captured from the endpoint replays to the same three answers', async () => {
    /**
     * The assertion the whole path exists for.
     *
     * A capture is only worth having if replaying it reproduces the DECISION,
     * not merely the rows. So the comparison is against the answers the live
     * buffer gave at capture time — `detectsWork`, `detectsPause`, `grounds` —
     * and the replay recomputes all three from the file's own rows and the
     * file's own clock. Anything the detector reads that the capture lost shows
     * up here as a disagreement.
     */
    const now = Date.now()
    const body = await capture(anAfternoon(now))

    // Exactly what the capture command writes: the response body, verbatim,
    // with the note added. If this drifts from `capture-afternoon.ts` the test
    // is measuring a shape nothing produces.
    const file = JSON.stringify({ note: 'round-trip, in memory', ...body }, null, 2)
    const afternoon = parseAfternoon(file, 'the round-trip capture')

    // Non-vacuous: a buffer that detected nothing would replay `null` to `null`
    // and prove none of this.
    expect(
      afternoon.detectsWork,
      'the fixture detects no work, so the replay compares nothing',
    ).not.toBeNull()
    expect(afternoon.grounds?.sufficient).toBe(true)

    expect(replayAfternoon(afternoon)).toEqual({
      detectsWork: body.detectsWork,
      detectsPause: body.detectsPause,
      grounds: body.grounds,
    })
  })

  it('carries the three signals into the file, which a hand-copied fixture could not', async () => {
    const now = Date.now()
    const body = await capture(anAfternoon(now))
    const afternoon = parseAfternoon(
      JSON.stringify({ note: 'n', ...body }),
      'the round-trip capture',
    )

    const engagements = afternoon.observations.filter((o) => o.kind === 'engagement')
    expect(engagements.length).toBeGreaterThan(0)
    expect(engagements.every((o) => typeof o.scrollFraction === 'number')).toBe(true)
    expect(engagements.every((o) => o.exitType !== undefined)).toBe(true)
    expect(afternoon.observations.some((o) => o.arrival === 'back-or-forward')).toBe(true)
  })

  it('knows every observation kind, and the compiler is what checks that', () => {
    // `EVERY_KIND_IS_LISTED` is typed `true` only while nothing in
    // `AmbientObservation['kind']` is missing from the parser's list, so the
    // real assertion is `tsc --noEmit` and this line cannot fail on its own.
    // It is here so the export has a reader and so somebody grepping for it
    // lands on the reason rather than on a lone declaration.
    expect(EVERY_KIND_IS_LISTED).toBe(true)
  })

  it('refuses a capture with no clock rather than replaying it against now', () => {
    // The failure this prevents is the quiet one: `Date.now()` on a file saved
    // yesterday windows every row out and answers null, which reads as a
    // detector that changed its mind.
    const body = {
      note: 'n',
      held: 1,
      observations: [
        {
          at: 1,
          origin: 'https://a.example',
          url: 'https://a.example/1',
          title: 'A',
          kind: 'navigation',
        },
      ],
      detectsWork: null,
      detectsPause: null,
      grounds: null,
    }

    expect(() => parseAfternoon(JSON.stringify(body), 'x')).toThrow(/no `now`/)
  })

  it('refuses a capture with no note, because a fixture nobody can explain gets believed', () => {
    const body = {
      now: 1,
      held: 0,
      observations: [],
      detectsWork: null,
      detectsPause: null,
      grounds: null,
    }

    expect(() => parseAfternoon(JSON.stringify(body), 'x')).toThrow(/no `note`/)
  })

  it('refuses an empty capture, because null replaying to null proves nothing', () => {
    const body = {
      note: 'n',
      now: 1,
      held: 0,
      observations: [],
      detectsWork: null,
      detectsPause: null,
      grounds: null,
    }

    expect(() => parseAfternoon(JSON.stringify(body), 'x')).toThrow(/no observations/)
  })
})

describe('the saved afternoon', () => {
  const afternoon: CapturedAfternoon = loadAfternoon(SAVED)

  it('says what it is, and that it is not a recording', () => {
    // The one thing a file in this directory must never be able to do quietly
    // is pass for somebody's real browsing.
    expect(afternoon.note).toMatch(/SYNTHESISED/)
  })

  it('replays from disk to the answers it recorded', () => {
    expect(afternoon.detectsWork).not.toBeNull()
    expect(afternoon.grounds?.sufficient).toBe(true)

    expect(replayAfternoon(afternoon)).toEqual({
      detectsWork: afternoon.detectsWork,
      detectsPause: afternoon.detectsPause,
      grounds: afternoon.grounds,
    })
  })

  it('holds all three signals, so a fixture on disk can finally carry them', () => {
    expect(afternoon.observations.some((o) => typeof o.scrollFraction === 'number')).toBe(true)
    expect(afternoon.observations.some((o) => o.exitType !== undefined)).toBe(true)
    expect(afternoon.observations.some((o) => o.arrival !== undefined)).toBe(true)
  })

  it('survives the clock moving, because it replays against its own', () => {
    // The saved `now` is in the past and gets further into the past every day.
    // If anything here reached for the real clock this would be the assertion
    // that went red — quietly, one thirty-minute window after it was written.
    expect(Date.now()).toBeGreaterThan(afternoon.now)
    expect(replayAfternoon(afternoon).detectsWork).not.toBeNull()
  })
})

/**
 * The second saved afternoon: comparing monitors across three shops.
 * ADR-0018, 2026-08-20.
 *
 * ── Why a second file, when one already replays ──────────────────────────
 *
 * Because the one that was here answers `sufficient: true` on grounds that all
 * existed before ADR-0018, so it cannot say whether the new ground survives the
 * trip from a browser to a decision. Every other fixture for
 * `compared-options` is a hand-built `ThreadPage[]` — which is the right shape
 * for arguing arithmetic and the wrong one for proving that a scroll fraction
 * and an arrival make it through `ambientSchema`, through the store, through
 * `pagesOf`, and into a ground. This file went through all four.
 *
 * ── What makes it worth its own file rather than another test ────────────
 *
 * `docs/PRODUCT_PRINCIPLES.md` §13 is about a fixture that was smaller than the
 * session it recorded. The defence is that the file's own `note` states the
 * session in words and these tests check the words against the rows — ten pages
 * across three retailers, a thread spanning less than `SUSTAINED_MS`, nothing
 * held for a minute. If somebody trims this fixture, the description stops
 * matching and the trim is what goes red.
 */
describe('the saved comparison afternoon', () => {
  const afternoon: CapturedAfternoon = loadAfternoon(COMPARING)

  it('says what it is, and that it is not a recording', () => {
    expect(afternoon.note).toMatch(/SYNTHESISED/)
  })

  it('replays from disk to the answers it recorded', () => {
    expect(afternoon.detectsWork).not.toBeNull()
    expect(afternoon.grounds?.sufficient).toBe(true)

    expect(replayAfternoon(afternoon)).toEqual({
      detectsWork: afternoon.detectsWork,
      detectsPause: afternoon.detectsPause,
      grounds: afternoon.grounds,
    })
  })

  it('clears the offer bar on compared-options, and would not clear it without', () => {
    /**
     * The whole reason the file exists. `searched-then-read` is the intent
     * ground; `followed-across` and `read-around` are the two ends of one axis
     * and count once between them; `read-deeply` and `stayed-with-it` are
     * provably absent. So the comparison is the second axis and there is no
     * other candidate for it.
     */
    const kinds = afternoon.grounds?.kinds ?? []

    expect(kinds).toContain('compared-options')
    expect(kinds).toContain('searched-then-read')
    expect(kinds).not.toContain('read-deeply')
    expect(kinds).not.toContain('stayed-with-it')

    expect(afternoon.grounds?.sentences).toContain(
      'You read 10 pages across 3 sites and went back to one of them.',
    )
  })

  it('is the session its note describes, counted off the rows', () => {
    // §13, made mechanical. The note says one search, ten product pages across
    // three retailers, and a return to one of them.
    const products = afternoon.observations.filter(
      (o) => o.kind === 'navigation' && !o.url.includes('google.com'),
    )
    const shops = new Set(products.map((o) => o.origin))

    expect(new Set(products.map((o) => o.url)).size).toBe(10)
    expect(shops.size).toBe(3)
    expect(afternoon.observations.filter((o) => o.kind === 'query')).toHaveLength(1)
    // Eleven navigations to ten pages: the eleventh is the return.
    expect(products).toHaveLength(11)
  })

  it('carries a scroll fraction on every product page, because the ground needs one', () => {
    // The transport claim, on this file rather than in general. A capture whose
    // engagements lost their scroll would replay to a different answer, and the
    // replay test above would say so — this says WHY.
    const engagements = afternoon.observations.filter((o) => o.kind === 'engagement')

    expect(engagements.length).toBeGreaterThan(0)
    expect(engagements.every((o) => typeof o.scrollFraction === 'number')).toBe(true)
    expect(afternoon.observations.some((o) => o.arrival === 'cross-origin')).toBe(true)
  })

  it('stops qualifying the moment the three signals are taken back off it', () => {
    // The inverse of the world-models file's test, and much sharper: there, the
    // signals cost one ground and no offer. Here they are the offer.
    const stripped = afternoon.observations.map((o) => {
      const { scrollFraction: _scroll, exitType: _exit, arrival: _arrival, ...rest } = o
      return rest as AmbientObservation
    })

    const without = replayAfternoon({ ...afternoon, observations: stripped })

    expect(without.grounds?.kinds).not.toContain('compared-options')
    expect(without.grounds?.sufficient).toBe(false)
  })
})

describe('somebody’s decision at last', () => {
  it('the three signals ride all the way round and one of them changes the answer', () => {
    /**
     * ~~The behavioural half of the deferral.~~ **The behavioural half of the
     * consumption, 2026-08-20 — ADR-0018.**
     *
     * ~~The day one of them is consumed this goes red beside the reachability
     * budget, and the two together say which afternoons started qualifying.~~
     * That day was 2026-08-20 and this is the inverted test. It says the thing
     * a grep cannot: on a captured buffer, with six grounds firing and
     * sufficiency true, deleting the three signals from every row now changes
     * the answer — and it names which ground moves, so the equality cannot go
     * green again because some other ground quietly took over.
     *
     * **`came-back` is the one, and it is the whole of the difference on this
     * afternoon.** The return to the first arXiv abstract came from
     * openreview.net and was classified `'back-or-forward'`, which is inside
     * `RETURN_ARRIVALS`; strip the classification and the return is a tally
     * nothing can read. The five other grounds are untouched: nothing here was
     * held open unscrolled, and one site's worth of read pages is short of
     * `COMPARED_ORIGINS`.
     *
     * **Sufficiency does NOT move**, which is worth asserting rather than
     * assuming. Two searches carry the intent half on their own, so this
     * afternoon is still offered work with or without the signals. An afternoon
     * of research whose only intent ground was the return is the one that
     * stopped qualifying, and `tests/grounds.test.ts` holds that case with the
     * arXiv reader who clicked back to the first abstract.
     */
    const afternoon = loadAfternoon(SAVED)

    const stripped = afternoon.observations.map((o) => {
      const { scrollFraction: _scroll, exitType: _exit, arrival: _arrival, ...rest } = o
      return rest as AmbientObservation
    })

    // Non-vacuous: something was actually removed.
    expect(JSON.stringify(stripped)).not.toEqual(JSON.stringify(afternoon.observations))

    const withSignals = replayAfternoon(afternoon)
    const without = replayAfternoon({ ...afternoon, observations: stripped })

    expect(withSignals.grounds?.kinds).toContain('came-back')
    expect(without.grounds?.kinds).not.toContain('came-back')
    expect(without.grounds?.kinds).toEqual(
      withSignals.grounds?.kinds.filter((kind) => kind !== 'came-back'),
    )

    // The thread, its pause and its sufficiency are all unmoved. Only what may
    // be claimed about the return changed.
    expect(without.detectsWork).toEqual(withSignals.detectsWork)
    expect(without.detectsPause).toEqual(withSignals.detectsPause)
    expect(without.grounds?.sufficient).toBe(true)
    expect(withSignals.grounds?.sufficient).toBe(true)
  })
})
