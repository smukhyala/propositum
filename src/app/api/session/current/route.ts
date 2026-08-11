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
import { captureStore, expectedOrigin } from '@/server/capture-store'

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
  if (!live) return NextResponse.json({ ok: true, session: null })

  const { repos } = await appContext()
  const session = await repos.sessions.byId(live.sessionId)
  if (!session) return NextResponse.json({ ok: true, session: null })

  const sources = await repos.projects.approvedSources(session.projectId)

  return NextResponse.json({
    ok: true,
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
