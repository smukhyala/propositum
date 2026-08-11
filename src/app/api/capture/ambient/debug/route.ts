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
 */

import { NextResponse } from 'next/server'

import { detectPause, detectWork } from '@/domain/detection/detect'
import { ambientStore } from '@/server/capture-store'

export async function GET() {
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
    detectsWork: detectWork(observations, now),
    detectsPause: detectPause(observations, now),
  })
}
