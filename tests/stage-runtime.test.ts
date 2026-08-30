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
 * runner and on a clone with no build. It therefore never asserts that
 * anything under `dist-runtime/` EXISTS; the last test below is about the two
 * paths `tray.yml` fabricates, not about a runtime.
 */

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  BUNDLED_KEY_RELATIVE,
  bundledKeyFrom,
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

  it('takes the bundled key from the environment, or leaves the floor', () => {
    // ADR-0028 §3: absence is the floor (the first run asks), never an error.
    expect(bundledKeyFrom({ PROPOSITUM_BUNDLED_KEY: 'sk-capped' })).toBe('sk-capped')
    expect(bundledKeyFrom({ PROPOSITUM_BUNDLED_KEY: '  sk-capped\n' })).toBe('sk-capped')
    expect(bundledKeyFrom({})).toBeNull()
    expect(bundledKeyFrom({ PROPOSITUM_BUNDLED_KEY: '' })).toBeNull()
    expect(bundledKeyFrom({ PROPOSITUM_BUNDLED_KEY: '   ' })).toBeNull()
  })

  it('names the bundled-key file the same on both sides of the language gap', () => {
    // The staging script writes it, the Rust crate reads it, and neither can
    // import the other — the origin.rs/capture.test.ts pin idiom.
    const crate = readFileSync(join(repo, 'src-tauri', 'src', 'runtime.rs'), 'utf8')
    expect(crate).toContain(`join("${BUNDLED_KEY_RELATIVE}")`)
  })

  it('the tray check fabricates exactly the paths the bundle reads from', () => {
    // tauri-build resolves resources and externalBin in its BUILD SCRIPT, so
    // `cargo check` on a checkout that has never staged needs both paths to
    // exist. `tray.yml` makes them empty rather than spending minutes staging
    // a runtime it will not use. That workflow is YAML on a runner with no
    // Node, so it cannot import these constants — the agreement is asserted
    // here instead, and a rename that misses it goes red on ubuntu in seconds
    // rather than on macOS after a cargo build.
    //
    // Comment lines are dropped first, so a docblock naming a path cannot
    // stand in for the step that creates it. `tests/support/strip-comments.ts`
    // is deliberately not used: it is a JS/HTML scanner and knows nothing of
    // `#`.
    const steps = readFileSync(join(repo, '.github', 'workflows', 'tray.yml'), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n')
    expect(steps).toContain(`mkdir -p ${TREE_RELATIVE} `)
    expect(steps).toContain(`> ${SIDECAR_RELATIVE}`)
  })
})
