/**
 * What is actually in the ambient buffer, right now.
 *
 * Detection thresholds were set before any real browsing existed, and the first
 * contact with real browsing produced a suggestion about a video call. Tuning
 * against a buffer nobody can see is how that happens twice.
 *
 * Read-only, and it shows exactly what the detector sees — no more. If page
 * text ever appeared here it would mean the ambient path had started carrying
 * some, which is the thing three other places exist to prevent.
 *
 * ── This shipped with no guard at all, and that was a real hole ──────────
 *
 * Every other capture route runs `admit()` or `fromOurExtension()` before it
 * does anything. This one ran neither, and answered `GET` to anybody. The
 * ambient buffer is the whole of what Propositum saw while nobody asked it to
 * watch — the exact thing ADR-0008 argues must never be durable or reachable —
 * so ANY PAGE IN THE BROWSER could `fetch('http://127.0.0.1:3117/api/capture/
 * ambient/debug')` and read back half an hour of somebody's browsing: every
 * origin, every page count, and up to eight page titles each. A simple GET with
 * no custom header is CORS-safelisted, so the request was delivered and
 * executed; the response was withheld from the page only by the same-origin
 * policy, which is one `<img>`-shaped trick away from not being a defence at
 * all, and is no defence whatsoever against a local process or an extension.
 *
 * ── Transport controls, not an environment flag ──────────────────────────
 *
 * Both were on the table. The controls win, for two reasons.
 *
 * The first is that a flag defaulting to off means the person who needs this
 * discovers it AFTER the browsing they wanted to explain has already aged out
 * of the buffer's thirty-minute window. This endpoint exists to answer "why did
 * it offer me that" while the answer still exists, and a switch you must have
 * flipped in advance cannot answer it.
 *
 * The second is that the controls are enforced by the browser rather than by
 * remembering. The custom header forces a CORS preflight this app deliberately
 * never satisfies, so a page's request is never delivered — and `Sec-Fetch-Site`
 * is a forbidden header name, so no script can forge the `none` that a
 * browser-privileged caller sends. That is the same argument the write path
 * already rests on, made once, in `src/capture/transport.ts`.
 *
 * There is no per-session bearer token here because there is no session — this
 * route exists precisely when none is running — and no content-type check
 * because a GET has no body. Two of the four controls apply and both are
 * applied.
 *
 * ── Debugging it by hand ─────────────────────────────────────────────────
 *
 * A terminal is not a page, so this is one command:
 *
 *     curl -H 'x-propositum-capture: 1' -H 'sec-fetch-site: none' \
 *          http://127.0.0.1:3117/api/capture/ambient/debug
 *
 * `sec-fetch-site` is forbidden to scripts and free to curl, which is the whole
 * distinction this endpoint needed and did not have.
 */

import { NextResponse } from 'next/server'

import { CUSTOM_HEADER, fromOurExtension } from '@/capture/transport'
import { detectPause, detectWork, threadPagesOf } from '@/domain/detection/detect'
import { groundsFor } from '@/domain/detection/grounds'
import { ambientStore, expectedOrigin } from '@/server/capture-store'

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
    return NextResponse.json({ ok: false, reason: 'bad-origin' }, { status: 403 })
  }

  const store = ambientStore()
  const now = Date.now()
  const observations = store.since(now)

  const byOrigin = new Map<string, { pages: Set<string>; engagedMs: number; titles: string[] }>()
  for (const o of observations) {
    const entry = byOrigin.get(o.origin) ?? { pages: new Set<string>(), engagedMs: 0, titles: [] }
    entry.pages.add(o.url)
    if (o.engagedMs !== undefined) entry.engagedMs = Math.max(entry.engagedMs, o.engagedMs)
    if (o.title && !entry.titles.includes(o.title)) entry.titles.push(o.title)
    byOrigin.set(o.origin, entry)
  }

  const detected = detectWork(observations, now)

  return NextResponse.json({
    held: observations.length,
    origins: [...byOrigin]
      .map(([origin, e]) => ({
        origin,
        pages: e.pages.size,
        engagedMinutes: Math.round(e.engagedMs / 60_000),
        titles: e.titles.slice(0, 8),
      }))
      .sort((a, b) => b.engagedMinutes - a.engagedMinutes),
    detectsWork: detected,
    detectsPause: detectPause(observations, now),
    // The second bar, shown beside the first. "It detected work but did not
    // offer" is otherwise indistinguishable from "it detected nothing", and
    // those have completely different fixes.
    grounds:
      detected === null
        ? null
        : groundsFor(detected, threadPagesOf(observations, detected, now)),
  })
}
