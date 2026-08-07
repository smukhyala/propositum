/**
 * The startup self-check the extension badges an error against.
 *
 * Deliberately unauthenticated and information-free: it answers "is the app
 * listening", nothing more. The extension needs this before a session exists,
 * so there is no token to present yet — and anything reachable on loopback can
 * already tell that a port is open.
 */

import { NextResponse } from 'next/server'
import { CUSTOM_HEADER } from '@/capture/transport'

export async function GET(request: Request) {
  // Still requires the custom header, so a hostile page's no-preflight probe
  // does not get a 200 out of it.
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
