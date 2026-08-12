/**
 * How the extension learns which session it is capturing, and gets its token.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `POST /api/session` mints a per-session bearer token, but only the caller
 * sees it. When a person starts a session from the UI, the extension never
 * learns the token and every event it posts is rejected with 403 — capture
 * silently does nothing while the interface says a session is running.
 *
 * That is the worst failure mode in the product: the person believes they are
 * being watched and they are not.
 *
 * ── Why handing the token over here is safe ──────────────────────────────
 *
 * This endpoint is credential-bearing, so it is guarded the same way event
 * submission is, minus the token it exists to supply:
 *
 *   - Proof the request was not page-initiated: our `Origin` when Chrome sends
 *     one, and `Sec-Fetch-Site: none` when it does not. Granting the loopback
 *     host permission the extension cannot work without makes Chrome drop the
 *     Origin header entirely — see `fromOurExtension`.
 *   - A custom header, which forces a preflight a hostile page cannot satisfy.
 *     Remember `text/plain` is CORS-safelisted — CORS alone stops nothing here.
 *
 * The remaining exposure is another extension the person installed
 * deliberately, which is outside this threat model: something with
 * `chrome-extension://` origin and knowledge of our header is already running
 * code the person approved.
 */

import { NextResponse } from 'next/server'
import { CUSTOM_HEADER, fromOurExtension } from '@/capture/transport'
import { appContext } from '@/server/db'
import { ambientStore, captureStore, expectedOrigin } from '@/server/capture-store'
import { describePause, describeWork, signatureOf } from '@/server/ambient-store'
import { nameThread } from '@/server/name-thread'
import { AnthropicModelClient } from '@/model/anthropic'
import { detectPause, detectWork } from '@/domain/detection/detect'

/** An origin, or an empty string. Never throws — a malformed stored URL is a
 *  ledger curiosity, not a reason to fail a poll the extension depends on. */
function safeOrigin(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}

/**
 * An `ObservationKind` as the detector's smaller vocabulary.
 *
 * The two that matter are `engaged` and `switchedAway`; everything else is an
 * arrival as far as `detectPause` is concerned. Anything unrecognised falls to
 * `navigation`, which is the conservative end: a new kind would count as
 * activity and delay a hand-off offer rather than produce one.
 */
function ambientKind(kind: string): 'navigation' | 'query' | 'engagement' | 'away' {
  if (kind === 'engaged') return 'engagement'
  if (kind === 'switchedAway') return 'away'
  if (kind === 'queried') return 'query'
  return 'navigation'
}

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false, reason: 'missing-custom-header' }, { status: 403 })
  }

  // The same check event submission uses, from one definition. Chrome sends NO
  // Origin for a host-permitted loopback fetch, so this accepts either our
  // origin or a browser-attested non-page caller — see `fromOurExtension`.
  if (!fromOurExtension((name) => request.headers.get(name) ?? undefined, expectedOrigin())) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'bad-origin',
        // Said out loud because the most likely cause is a missing
        // PROPOSITUM_EXTENSION_ID, and a silent 403 sends people hunting the
        // wrong thing entirely.
        hint: `Expected ${expectedOrigin()}. Set PROPOSITUM_EXTENSION_ID in .env to your unpacked extension's id.`,
      },
      { status: 403 },
    )
  }

  const live = captureStore().current()

  /**
   * No session. Has Propositum noticed work anyway?
   *
   * The offer rides on the poll the extension already makes, rather than a
   * second endpoint on its own timer — one round trip, and the suggestion can
   * never be staler than the session state it arrives with.
   *
   * It is a SUGGESTION. Nothing here starts a session, approves a source or
   * records anything durable; accepting is a human act on a human's click.
   */
  if (!live) {
    const ambient = ambientStore()
    const now = Date.now()
    const detected = detectWork(ambient.since(now), now)

    if (!detected || ambient.isSnoozed(detected.origins[0] ?? '', now)) {
      return NextResponse.json({ ok: true, session: null, suggestion: null })
    }

    const suggestion = describeWork(detected)
    const signature = signatureOf(detected.terms)

    // Pin which pages this thread was made of, so accepting later carries the
    // thread and not everything that happened to be on the same sites.
    ambient.rememberThread(signature, detected.urls)

    const named = ambient.nameFor(signature)

    // Naming happens in the BACKGROUND. This poll exists to be cheap, a model
    // call takes about 15 seconds, and a failure must not take the offer with
    // it. The deterministic offer goes out now; the next poll carries the name.
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!named && apiKey) {
      void nameThread(ambient, new AnthropicModelClient({ apiKey }), detected)
    }

    return NextResponse.json({
      ok: true,
      session: null,
      suggestion: named
        ? {
            ...suggestion,
            thread: signature,
            // Only overwrite the sentence when the model was sure. A confident
            // wrong name is worse than an honest vague one.
            sentence: named.confident
              ? `Looks like you're working on ${named.subject}.`
              : suggestion.sentence,
            subject: named.subject,
            offer: named.offer,
            offerLabel: named.offerLabel,
          }
        : { ...suggestion, thread: signature },
    })
  }

  const { repos } = await appContext()
  const session = await repos.sessions.byId(live.sessionId)
  if (!session) return NextResponse.json({ ok: true, session: null })

  const sources = await repos.projects.approvedSources(session.projectId)

  /**
   * A session IS running. Is this a natural point to hand over?
   *
   * Computed from the session's own ObservationEvents rather than from the
   * ambient buffer, which is not being fed while a session runs — the ledger
   * already holds exactly this, and double-recording the same browsing in two
   * places to save a mapping would be the worse trade.
   */
  const events = await repos.events.bySession(live.sessionId)
  const asAmbient = events.map((event) => {
    const attested = (event.attested ?? {}) as Record<string, unknown>
    const url = typeof attested['url'] === 'string' ? attested['url'] : ''
    const dwell = attested['dwellMs']

    return {
      at: event.observedAt.getTime(),
      origin: url === '' ? '' : safeOrigin(url),
      url,
      title: typeof attested['title'] === 'string' ? attested['title'] : '',
      // The kind has to survive the crossing. This flattened everything to
      // `navigation`, which threw away the one fact `detectPause` needs most:
      // `switchedAway` is `chrome.idle` saying the person left, and without it
      // the detector cannot tell an engagement report from a still-open tab
      // apart from somebody actually being here.
      kind: ambientKind(event.kind),
      ...(typeof dwell === 'number' ? { engagedMs: dwell } : {}),
    }
  })

  const pause = detectPause(asAmbient, Date.now())

  return NextResponse.json({
    ok: true,
    suggestion: pause === null ? null : describePause(pause),
    session: {
      id: live.sessionId,
      token: live.token,
      startedAtMs: live.startedAtMs,
      sources: sources
        .filter((s) => s.grantState === 'granted')
        .map((s) => ({
          id: s.id,
          // The extension matches an event's page against this, so it needs the
          // origin without the `/*` suffix.
          origin: s.originPattern.replace(/\/\*$/, ''),
          label: s.label,
        })),
    },
  })
}
