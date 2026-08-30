/**
 * The one bit the tray needs: is setup unfinished.
 *
 * The consumer is the menu-bar app (ADR-0023): on launch, once the children
 * serve, it reads this once and opens the first-run window when the answer
 * is yes. The body is a single boolean, deliberately — broad-derive,
 * narrow-serve: the tray decides nothing (prohibition 5), so it must not
 * receive anything it could decide with, and "open the window or don't" is
 * one bit. The derivation stays in `src/server/first-run.ts` where the
 * thirty-two-combination test can hold it; `light.rs`'s sibling,
 * `api/intention-state`, carries the fuller argument for serving the app's
 * own words to Rust instead of re-typing them where no guard can read.
 *
 * Header posture is `capture/health`'s: the custom header, so a hostile
 * page's no-preflight probe does not get a 200. Not authentication —
 * anything on loopback can send a header — and the body is one boolean
 * about this machine's own setup.
 */

import { NextResponse } from 'next/server'
import { CUSTOM_HEADER } from '@/capture/transport'
import { firstRunState } from '@/server/first-run'

export async function GET(request: Request) {
  if (request.headers.get(CUSTOM_HEADER) !== '1') {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const state = await firstRunState()
  // `unfinished`, never `at`: the durable-grants bit. Deriving from `at`
  // reopened the window on every launch of a working install and leaked
  // offer presence — `unfinishedFrom`'s docblock carries the argument.
  return NextResponse.json({ unfinished: state.unfinished })
}
