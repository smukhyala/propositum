/**
 * The tray app takes no TCC permission, asserted rather than trusted.
 *
 * ── Why this exists, in ADR-0023's own words ─────────────────────────────
 *
 * *"There is no test that fails when this binary requests a TCC permission,
 * and there cannot easily be one."* That sentence was written about runtime
 * behaviour, where it is true. But a Tauri app asks for macOS permissions
 * through config text — a `*UsageDescription` string in the bundle's plist
 * extras, an entitlements file wired into the bundle — and config text is
 * exactly what a test can pin.
 *
 * ── The stage-2 seam ─────────────────────────────────────────────────────
 *
 * ~~Stage 1 of the menu-bar app uses nothing that needs a grant, so the
 * honest assertion is cheap: the config carries none of the vocabulary a
 * grant requires.~~ **This file went red on 2026-08-28 — but not for the
 * reason this docblock predicted.** It predicted TCC grants arriving with
 * todo 07/08 (Accessibility, Screen Recording, Full Disk Access). What
 * arrived first was todo 01 stage 2: the signature notarisation requires,
 * whose hardened runtime needs an entitlements file so the bundled Node's
 * V8 may JIT. Those are different kinds of "permission" — a hardened-runtime
 * entitlement CONSTRAINS our own process and prompts nobody; a TCC grant
 * TAKES something of the person's and prompts them — and the pins below are
 * now the discriminator: the entitlements file is admitted by exact path and
 * exact content, while every piece of TCC vocabulary stays banned. The TCC
 * seam is still ahead, still guarded, and still enters the way this docblock
 * always said it must: by turning this file red in the same change that
 * argues for it.
 *
 * ── What this does NOT cover ─────────────────────────────────────────────
 *
 * Runtime behaviour. A Rust crate could call a TCC-gated API without any
 * plist string and macOS would prompt with a generic message — no config
 * text predicts that. This pins the declared surface, which is the half a
 * clean diff cannot dodge; the other half is held by review and by ADR-0023's
 * "What holds the line now" table, which says so about itself.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('..', import.meta.url))
const config = JSON.parse(readFileSync(join(repo, 'src-tauri', 'tauri.conf.json'), 'utf8'))

/** The words a TCC grant cannot enter the config without. `entitlements` is
 * deliberately NOT here any more — the deep-equal pin below admits exactly one
 * reference to exactly one file, whose content is itself pinned. */
const TCC_NEEDLES = [
  'UsageDescription',
  'NSAppleEventsUsage',
  'ScreenCapture',
  'Accessibility',
  'FullDiskAccess',
]

describe('the tray app requests no TCC permission', () => {
  it('names the bundle it can never rename', () => {
    // Shipped once, changing it orphans every install — the todo's own
    // warning. Pinned so a scaffold regeneration cannot quietly reset it to
    // com.tauri.dev.
    expect(config.identifier).toBe('com.propositum.app')
    expect(config.productName).toBe('Propositum')
  })

  it('states its version exactly once, in Cargo.toml', () => {
    // The menu and the startup log render CARGO_PKG_VERSION, compiled in;
    // tauri.conf.json falls back to Cargo.toml when it holds no version of
    // its own. A second literal here is the drift this refuses.
    expect('version' in config).toBe(false)
  })

  it('carries no permission vocabulary in its config', () => {
    const text = JSON.stringify(config)
    for (const needle of TCC_NEEDLES) {
      expect(
        text,
        `tauri.conf.json mentions ${needle} — a TCC grant is entering by config, and ADR-0023/0025 say that takes an argued change, not a scaffold edit`,
      ).not.toContain(needle)
    }
  })

  it('declares exactly the macOS bundle surface stage 2 argued for', () => {
    // Deep equality, not presence: this simultaneously admits the
    // entitlements reference and refuses `infoPlist` (the door a
    // *UsageDescription walks through), an in-repo `signingIdentity` (the
    // identity arrives by env so the repo never names a certificate), and
    // every key nobody has argued for.
    expect(config.bundle.macOS).toEqual({
      minimumSystemVersion: '14.0',
      entitlements: './entitlements.plist',
    })
  })

  it('holds an entitlements file with exactly the two JIT carve-outs', () => {
    // Hardened-runtime carve-outs on our own processes, not TCC grants —
    // the distinction the docblock argues. Exact set: the absence of
    // disable-library-validation, app-sandbox, get-task-allow and every
    // personal-information/device key is load-bearing, because each would
    // either widen what the binary may do or be refused by notarisation.
    const text = readFileSync(join(repo, 'src-tauri', 'entitlements.plist'), 'utf8')
    const keys = [...text.matchAll(/<key>([^<]+)<\/key>/g)].map((found) => found[1])
    expect(keys).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
    ])
    expect(text.match(/<true\/>/g)).toHaveLength(2)
    expect(text).not.toContain('<false/>')
    for (const needle of TCC_NEEDLES) {
      expect(text).not.toContain(needle)
    }
  })

  it('bundles no entitlements or plist-extras file beyond the pinned one', () => {
    // A hand-rolled walk rather than `recursive: true`, because `target/` and
    // `gen/` hold thousands of build products (including Tauri's own generated
    // Info.plist, which is not a request for anything) and reading them makes
    // the suite slow while proving nothing about what WE declared. The staged
    // runtime lives at the repo root (`dist-runtime/`), outside this walk, so
    // its thousands of third-party files never need a skip entry.
    const skip = new Set(['target', 'gen', 'node_modules'])
    const pinned = join(repo, 'src-tauri', 'entitlements.plist')
    const offending: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/entitlements|Info\.plist/i.test(entry.name) && path !== pinned)
          offending.push(path)
      }
    }
    walk(join(repo, 'src-tauri'))
    expect(
      offending,
      'an entitlements or Info.plist file beyond the pinned one entered src-tauri — the permission surface is widening unargued',
    ).toEqual([])
  })

  it('scopes the one capability to the one window, core defaults only', () => {
    // The tray's declared web surface. ADR-0023 calls Tauri's allowlist
    // "partly enforceable by configuration" — this is the configuration, so
    // a plugin's docs-suggested permissions paste or a scaffold regeneration
    // takes an argued change here.
    const caps = JSON.parse(
      readFileSync(join(repo, 'src-tauri', 'capabilities', 'default.json'), 'utf8'),
    )
    expect(caps.windows).toEqual(['settings'])
    expect(caps.permissions).toEqual(['core:default'])
    const files = readdirSync(join(repo, 'src-tauri', 'capabilities'))
    expect(files).toEqual(['default.json'])
  })
})
