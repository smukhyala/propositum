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
 * exactly what a test can pin. Stage 1 of the menu-bar app uses nothing that
 * needs a grant, so the honest assertion is cheap: the config carries none of
 * the vocabulary a grant requires.
 *
 * ── The stage-2 seam ─────────────────────────────────────────────────────
 *
 * ADR-0025 amends prohibition 1: the shipped binary WILL hold Accessibility,
 * Screen Recording and Full Disk Access — when the capabilities that use them
 * (todo 07, todo 08) are built. The day that lands, this file goes red, and
 * that is the design: the permission enters the config in the same change
 * that argues for it, over this docblock's objection rather than around it.
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

describe('the tray app requests no TCC permission', () => {
  it('names the bundle it can never rename', () => {
    // Shipped once, changing it orphans every install — the todo's own
    // warning. Pinned so a scaffold regeneration cannot quietly reset it to
    // com.tauri.dev.
    expect(config.identifier).toBe('com.propositum.app')
    expect(config.productName).toBe('Propositum')
  })

  it('carries no permission vocabulary in its config', () => {
    const text = JSON.stringify(config)
    for (const needle of [
      'UsageDescription',
      'entitlements',
      'Entitlements',
      'NSAppleEventsUsage',
      'ScreenCapture',
      'Accessibility',
    ]) {
      expect(
        text,
        `tauri.conf.json mentions ${needle} — a TCC grant is entering by config, and ADR-0023/0025 say that takes an argued change, not a scaffold edit`,
      ).not.toContain(needle)
    }
  })

  it('bundles no entitlements or plist-extras file', () => {
    // A hand-rolled walk rather than `recursive: true`, because `target/` and
    // `gen/` hold thousands of build products (including Tauri's own generated
    // Info.plist, which is not a request for anything) and reading them makes
    // the suite slow while proving nothing about what WE declared.
    const skip = new Set(['target', 'gen', 'node_modules'])
    const offending: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (/entitlements|Info\.plist/i.test(entry.name)) offending.push(path)
      }
    }
    walk(join(repo, 'src-tauri'))
    expect(
      offending,
      'an entitlements or Info.plist file entered src-tauri — the permission surface is no longer empty',
    ).toEqual([])
  })
})
