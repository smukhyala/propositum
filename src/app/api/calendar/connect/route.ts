/**
 * Start the calendar authorisation, or say there is nothing to start.
 *
 * ── Why a route handler and not a server action ──────────────────────────
 *
 * The whole of what this does is send a browser to Google. A `<Link>` to a
 * route that 302s is the smallest thing that does that, it works with
 * JavaScript switched off, and the URL it builds — with a fresh PKCE verifier
 * held in the app process — is minted per click rather than baked into a page
 * that might sit open for an hour.
 *
 * ── Absent, not broken ──────────────────────────────────────────────────
 *
 * With no `GOOGLE_OAUTH_CLIENT_ID` there is no authorisation URL to build, and
 * this redirects home rather than rendering an error. Nothing links here in
 * that state — `calendarRow()` returns null and the front door draws nothing —
 * so reaching this is a hand-typed URL, and the honest answer to a hand-typed
 * URL for a feature that is switched off is the front door.
 */

import { NextResponse } from 'next/server'
import { beginCalendarConnection } from '@/server/calendar'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = beginCalendarConnection(Date.now())
  if (url === null) return NextResponse.redirect(new URL('/', request.url))

  return NextResponse.redirect(url)
}
