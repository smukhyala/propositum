/**
 * The app process's one capture session store.
 *
 * Same reasoning as src/server/db.ts: the library exposes a factory with no
 * hidden state, and the app's composition root owns exactly one instance,
 * hung off globalThis so Next's hot reload does not silently reset a live
 * session's token mid-capture.
 */

import { createCaptureSessionStore } from './capture-session'
import type { CaptureSessionStore } from './capture-session'

declare global {
  // eslint-disable-next-line no-var
  var __propositumCapture: CaptureSessionStore | undefined
}

export function captureStore(): CaptureSessionStore {
  globalThis.__propositumCapture ??= createCaptureSessionStore()
  return globalThis.__propositumCapture
}

/** The extension id we accept events from. Pinned by the manifest `key`; until
 *  that is set, an env override keeps local development possible without
 *  loosening the check itself. */
export function expectedOrigin(): string {
  const id = process.env['PROPOSITUM_EXTENSION_ID']
  return id ? `chrome-extension://${id}` : 'chrome-extension://unset'
}
