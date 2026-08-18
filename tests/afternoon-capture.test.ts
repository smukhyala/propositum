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

const debug = (headers: Record<string, string> = { [CUSTOM_HEADER]: '1', 'sec-fetch-site': 'none' }) =>
  new Request('http://127.0.0.1:3117/api/capture/ambient/debug', { headers })

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
    { at: base + 30_000, url: a1, title: 'World Models: A Survey', kind: 'navigation', arrival: 'cross-origin' },
    {
      at: base + 2 * MINUTE,
      url: a1,
      title: '',
      kind: 'engagement',
      engagedMs: 75_000,
      scrollFraction: 0.68,
      exitType: 'left-unloaded',
    },
    { at: base + 3 * MINUTE, url: a2, title: 'Learning World Models — a Survey', kind: 'navigation', arrival: 'same-origin' },
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
    { at: base + 9 * MINUTE, url: a1, title: 'World Models: A Survey', kind: 'navigation', arrival: 'back-or-forward' },
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

    const noProof = await debugRoute(debug({ [CUSTOM_HEADER]: '1', origin: 'https://evil.example' }))
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
    expect(afternoon.detectsWork, 'the fixture detects no work, so the replay compares nothing').not.toBeNull()
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
    const afternoon = parseAfternoon(JSON.stringify({ note: 'n', ...body }), 'the round-trip capture')

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
    const body = { note: 'n', held: 1, observations: [{ at: 1, origin: 'https://a.example', url: 'https://a.example/1', title: 'A', kind: 'navigation' }], detectsWork: null, detectsPause: null, grounds: null }

    expect(() => parseAfternoon(JSON.stringify(body), 'x')).toThrow(/no `now`/)
  })

  it('refuses a capture with no note, because a fixture nobody can explain gets believed', () => {
    const body = { now: 1, held: 0, observations: [], detectsWork: null, detectsPause: null, grounds: null }

    expect(() => parseAfternoon(JSON.stringify(body), 'x')).toThrow(/no `note`/)
  })

  it('refuses an empty capture, because null replaying to null proves nothing', () => {
    const body = { note: 'n', now: 1, held: 0, observations: [], detectsWork: null, detectsPause: null, grounds: null }

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

describe('still nobody’s decision', () => {
  it('the three signals ride all the way round and change no answer', () => {
    /**
     * The behavioural half of the deferral.
     *
     * `tests/reachability.test.ts` holds it structurally, by budgeting every
     * mention of the three field names in production code to an exact count.
     * That guard is the stronger one and this does not replace it — it says
     * something the count cannot: on a real captured buffer, with six grounds
     * firing and sufficiency true, deleting all three signals from every row
     * leaves the detection byte-identical.
     *
     * The day one of them is consumed this goes red beside the reachability
     * budget, and the two together say which afternoons started qualifying.
     */
    const afternoon = loadAfternoon(SAVED)

    const stripped = afternoon.observations.map((o) => {
      const { scrollFraction: _scroll, exitType: _exit, arrival: _arrival, ...rest } = o
      return rest as AmbientObservation
    })

    // Non-vacuous: something was actually removed.
    expect(JSON.stringify(stripped)).not.toEqual(JSON.stringify(afternoon.observations))

    expect(replayAfternoon({ ...afternoon, observations: stripped })).toEqual(
      replayAfternoon(afternoon),
    )
  })
})
