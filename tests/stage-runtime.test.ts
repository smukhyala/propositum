/**
 * The staging script and the things it stands on agree, before any bundle.
 *
 * `scripts/stage-runtime.ts` runs on a Mac with network, minutes at a time —
 * nothing this suite can exercise. What it CAN pin, on any platform in
 * seconds, are the agreements that rot silently: the inventory names real
 * paths, the pinned Node satisfies `engines.node`, and `tauri.conf.json`'s
 * resources/externalBin entries point at what the script actually produces.
 * A rename on either side of any of those goes red here rather than at the
 * end of a twenty-minute release build.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * The staged tree itself (its own script asserts the load-bearing paths and
 * the zero-symlink invariant after staging), signing, and anything that
 * needs the darwin-arm64 artefacts — this file must pass on the ubuntu CI
 * runner and on a clone with no build.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  INVENTORY,
  NODE_VERSION,
  SIDECAR_RELATIVE,
  TREE_RELATIVE,
} from '../scripts/stage-runtime'

const repo = fileURLToPath(new URL('..', import.meta.url))

describe('staging stands on things that exist', () => {
  it('names only paths the checkout holds', () => {
    for (const entry of INVENTORY) {
      expect(existsSync(join(repo, entry)), `the inventory names ${entry}`).toBe(true)
    }
  })

  it('pins a Node the engines floor accepts', () => {
    const floor = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).engines.node
    const major = parseInt(floor.replace('>=', ''), 10)
    expect(NODE_VERSION.startsWith(`${major}.`)).toBe(true)
  })

  it('agrees with tauri.conf.json about where the bundle reads from', () => {
    // The config paths are relative to src-tauri/; the script's are relative
    // to the repo root. externalBin names the sidecar WITHOUT the target
    // triple — Tauri appends it at bundle time — so the produced name must be
    // the config's name plus `-<triple>`.
    const config = JSON.parse(readFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8'))
    expect(config.bundle.resources).toEqual({ [`../${TREE_RELATIVE}`]: 'runtime' })
    expect(config.bundle.externalBin).toHaveLength(1)
    const [external] = config.bundle.externalBin
    expect(`../${SIDECAR_RELATIVE}`).toBe(`${external}-aarch64-apple-darwin`)
  })
})
