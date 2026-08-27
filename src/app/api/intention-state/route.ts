/**
 * The status light's one read.
 *
 * The consumer is the menu-bar app (ADR-0023): it polls this and renders
 * exactly the word it gets back, so the five sentences `CONTEXT.md` fixes are
 * served from `INTENTION_STATES` rather than re-typed in Rust — where
 * `tests/consumer-vocabulary.test.ts` cannot read them.
 *
 * Header posture is `capture/health`'s, for the same reason: still requires
 * the custom header, so a hostile page's no-preflight probe does not get a
 * 200 out of it. That is not authentication — anything on loopback can send a
 * header — and the body is one word about your own machine. The header's name
 * now reads narrower than its use; one header and one discipline beats a
 * second constant to pin.
 */

import { NextResponse } from 'next/server'
import { CUSTOM_HEADER } from '@/capture/transport'
import { overallIntentionState } from '@/server/intention-state'

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  return NextResponse.json(await overallIntentionState(Date.now()))
}
