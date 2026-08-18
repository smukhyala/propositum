/**
 * Google sent them back. Swap the code, store the credential, say so plainly.
 *
 * ── What lands in the URL bar, and what deliberately does not ────────────
 *
 * On success this redirects to `/` with nothing appended. On every failure it
 * redirects to `/?problem=<sentence>`, which is the channel the front door
 * already renders — `src/app/page.tsx` has an `hm-problem` paragraph for
 * exactly this and describes it as *"the only text on this screen a person did
 * not ask to see"*.
 *
 * **No token, no code and no error body ever reaches that query string.** A URL
 * is the least private place in a browser: it is in history, in the address
 * bar, in a screenshot, and in whatever the person pastes when they ask for
 * help. So the sentences below are written here, from a closed set of outcomes,
 * and nothing from Google's response is interpolated into any of them.
 *
 * ── Why the failures are sentences rather than codes ─────────────────────
 *
 * `actions.ts` sets the house rule: every failure carries a sentence written
 * for the person rather than for a log. Four of the five say what to do next,
 * and the fifth — the scope refusal — says what was refused and why, because a
 * person who granted something wider deserves to know it was thrown away
 * rather than quietly used.
 */

import { NextResponse } from 'next/server'
import { completeCalendarConnection } from '@/server/calendar'

export const dynamic = 'force-dynamic'

function back(request: Request, problem?: string): NextResponse {
  const url = new URL('/', request.url)
  if (problem !== undefined) url.searchParams.set('problem', problem)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  // Google's own refusal path — the person pressed Cancel on the consent
  // screen, or their admin blocks the scope. Not a failure to report as one.
  if (params.get('error')) {
    return back(request, 'Propositum was not given access to your calendar. Nothing was stored.')
  }

  const code = params.get('code') ?? ''
  const state = params.get('state') ?? ''
  if (code === '' || state === '') {
    return back(request, 'That calendar link did not carry what it needed. Try connecting again.')
  }

  const result = await completeCalendarConnection({ code, state }, Date.now())

  switch (result.kind) {
    case 'connected':
      return back(request)
    case 'not-configured':
      return back(request)
    case 'expired':
      return back(request, 'That took too long, so Propositum let it go. Try connecting again.')
    case 'refused':
      return back(request, "That reply didn't match the request Propositum sent. Nothing was stored.")
    case 'wrong-scope':
      return back(
        request,
        'Propositum asks to see when you are busy and nothing else. It was granted something wider, so it stored nothing. Try connecting again.',
      )
    case 'unavailable':
      return back(request, 'Propositum could not reach Google just then. Try connecting again.')
  }
}
