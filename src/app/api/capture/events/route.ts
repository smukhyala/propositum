/**
 * Where captured events arrive.
 *
 * Two things this route must never do:
 *
 *   1. Trust the request. `admit()` applies all four transport controls; CORS
 *      is not one of them, because `text/plain` is CORS-safelisted and a forged
 *      POST would otherwise be delivered and executed.
 *   2. Write through a repository. Events go through the LEDGER WRITER, which
 *      is the only thing that keeps `seq` gapless under concurrent bursts.
 */

import { NextResponse } from 'next/server'
import { admit } from '@/capture/transport'
import { matchesPattern } from '@/policy/fetcher'
import { rawSignalSchema, toSemanticEvent } from '@/server/capture-adapter'
import { appContext } from '@/server/db'
import { captureStore, expectedOrigin } from '@/server/capture-store'

export async function POST(request: Request) {
  const store = captureStore()
  const live = store.current()
  if (!live) return NextResponse.json({ ok: false, reason: 'no-session' }, { status: 409 })

  const body = await request.json().catch(() => null)
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key] = value
  })

  const admission = admit(
    { headers, body },
    { expectedOrigin: expectedOrigin(), sessionToken: live.token, sessionId: live.sessionId },
  )

  if (!admission.ok) {
    // 403 with the reason. The reason is useful in a log and tells an attacker
    // only which of four controls they failed, which they could determine by
    // trying anyway.
    return NextResponse.json({ ok: false, reason: admission.reason }, { status: 403 })
  }

  const { ledger, repos } = await appContext()
  const now = Date.now()

  // A heartbeat is implied by events arriving. Close any open gap first, so a
  // burst after a silence is recorded on the near side of it.
  store.heartbeat(now)
  store.closeGap()

  // Which approved source each signal belongs to is decided HERE, from the
  // grant list, not taken from the request. The extension proposes a URL; the
  // app decides whether that URL is something it is allowed to have seen.
  const sessionRow = await repos.sessions.byId(live.sessionId)
  const sources = sessionRow ? await repos.projects.approvedSources(sessionRow.projectId) : []
  const granted = sources.filter((source) => source.grantState === 'granted')

  const results = []
  let unattributed = 0
  let ignored = 0

  for (const raw of admission.events) {
    const parsed = rawSignalSchema.safeParse(raw)
    if (!parsed.success) {
      // A malformed signal is a ledger-writer fact, not a gap. Hand it to the
      // writer so it is recorded as rejected rather than dropped here in
      // silence — the ledger owns the count of what it would not accept.
      results.push(await ledger.append(live.sessionId, raw as Record<string, unknown>))
      continue
    }

    const signal = parsed.data

    // `away` is by construction not attributable to a source: the person left.
    if (signal.signal === 'away') {
      const event = toSemanticEvent(signal, '', live.navigation)
      if (event) results.push(await ledger.append(live.sessionId, event))
      continue
    }

    const source = granted.find((s) => matchesPattern(signal.url, s.originPattern))
    if (!source) {
      // Chrome should have made this impossible — a content script is only
      // registered for granted origins. If one arrives anyway the grant list is
      // authoritative and the signal is dropped, which is the second check the
      // gate's own design calls for.
      unattributed += 1
      continue
    }

    const event = toSemanticEvent(signal, source.id, live.navigation)
    if (!event) {
      // A glance, or a stray selection. Classified and deliberately not stored.
      ignored += 1
      continue
    }

    results.push(await ledger.append(live.sessionId, event))
  }

  const accepted = results.filter((r) => r.ok).length
  const adversarial = results.some((r) => r.ok && r.adversarial)

  return NextResponse.json({
    ok: true,
    accepted,
    rejected: results.length - accepted,
    // Classified and deliberately not stored — a glance, or a stray selection.
    // Reported so "nothing appeared" is distinguishable from "nothing arrived".
    ignored,
    // Should be zero: Chrome only injects into granted origins. A non-zero
    // value means the grant list and the registered scripts disagree.
    unattributed,
    // Surfaced so the panel can warn without waiting for the reading.
    adversarial,
  })
}
