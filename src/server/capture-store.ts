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
import { createAmbientStore } from './ambient-store'
import type { AmbientStore } from './ambient-store'

declare global {
  // eslint-disable-next-line no-var
  var __propositumCapture: CaptureSessionStore | undefined
  // eslint-disable-next-line no-var
  var __propositumAmbient: AmbientStore | undefined
}

export function captureStore(): CaptureSessionStore {
  globalThis.__propositumCapture ??= createCaptureSessionStore()
  return globalThis.__propositumCapture
}

/**
 * What Propositum has seen while no session is running.
 *
 * Hung off globalThis for the same reason as the capture store — a hot reload
 * must not silently drop it — but unlike that one it is deliberately never
 * persisted. It dies with the process, and that is the guarantee.
 */
export function ambientStore(): AmbientStore {
  globalThis.__propositumAmbient ??= createAmbientStore()
  return globalThis.__propositumAmbient
}

/** The extension id we accept events from. Pinned by the manifest `key`; until
 *  that is set, an env override keeps local development possible without
 *  loosening the check itself. */
export function expectedOrigin(): string {
  const id = process.env['PROPOSITUM_EXTENSION_ID']
  return id ? `chrome-extension://${id}` : 'chrome-extension://unset'
}
