/**
 * Build the tray app end to end: stage, sign, bundle, audit, notarise.
 *
 *     npm run tray:build
 *
 * One entry point for the dev machine and CI, so there is exactly one order
 * and it cannot be re-derived wrong. How far it goes is decided by the
 * environment, never by flags:
 *
 *   - nothing set                → unsigned .app + .dmg, for a local smoke test
 *   - APPLE_SIGNING_IDENTITY     → signed, hardened runtime, audited
 *   - + APPLE_API_ISSUER/KEY/KEY_PATH → notarised and stapled, .app and .dmg both
 *
 * The order is the whole design: `stage-runtime.ts` produces the tree,
 * `sign-runtime.ts` signs its Mach-Os (inside-out signing starts with the
 * payload), then `tauri build` signs the Node sidecar and the tray binary
 * with `src-tauri/entitlements.plist`, notarises the .app and staples it —
 * and this script notarises the .dmg too, which Tauri only codesigns,
 * because todo 01's Done-when runs `stapler validate` against the artefact a
 * stranger actually downloads.
 *
 * ── The audit, and the assumption it is a tripwire for ───────────────────
 *
 * Tauri's bundler passes the configured entitlements file to every codesign
 * invocation, sidecars included — read from its source at 2.11, not from its
 * docs. If a future CLI stops doing that, the shipped Node loses
 * `allow-jit` and aborts at first JIT allocation on a stranger's machine, so
 * the audit here fails the build the moment the sidecar's entitlements or
 * any bundled Mach-O's signature look wrong. The manual fallback, should
 * that day come: sign the sidecar yourself (`codesign --force --timestamp
 * --options runtime --entitlements src-tauri/entitlements.plist -s "$ID"
 * …/Contents/MacOS/node`), re-sign the outer bundle the same way, then
 * `notarytool submit` + `stapler staple` by hand — every piece already
 * exists below, only the order changes.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { stage } from './stage-runtime'
import { machOFiles, signRuntime } from './sign-runtime'

const repo = fileURLToPath(new URL('..', import.meta.url))
const tree = join(repo, 'dist-runtime', 'runtime')
const bundleDir = join(repo, 'src-tauri', 'target', 'aarch64-apple-darwin', 'release', 'bundle')

const say = (line: string) => console.log(`[tray:build] ${line}`)
const die = (line: string): never => {
  console.error(`[tray:build] ${line}`)
  process.exit(1)
}

const identity = process.env.APPLE_SIGNING_IDENTITY?.trim() || undefined
const notary =
  process.env.APPLE_API_ISSUER !== undefined &&
  process.env.APPLE_API_KEY !== undefined &&
  process.env.APPLE_API_KEY_PATH !== undefined

/** codesign's details land on stderr, so this is spawnSync, not execFileSync:
 * a non-zero exit means unsigned outright, `Signature=adhoc` means signed by
 * nobody — notarisation refuses both. */
function badSignature(path: string): boolean {
  const shown = spawnSync('codesign', ['--display', '--verbose=4', path], { encoding: 'utf8' })
  return shown.status !== 0 || shown.stderr.includes('Signature=adhoc')
}

function audit(app: string) {
  const { machos, symlinks } = machOFiles(app)
  const escaping = symlinks.filter((link) => {
    const resolved = spawnSync('readlink', ['-f', link], { encoding: 'utf8' })
    return resolved.status !== 0 || !resolved.stdout.trim().startsWith(app)
  })
  if (escaping.length > 0) {
    die(`the bundle holds symlinks that escape it:\n  ${escaping.join('\n  ')}`)
  }

  if (identity === undefined) {
    say('unsigned build — skipping the signature audit')
    return
  }

  const unsigned = machos.filter(badSignature)
  if (unsigned.length > 0) {
    die(`Mach-O files in the bundle are unsigned or ad-hoc:\n  ${unsigned.join('\n  ')}`)
  }

  const node = join(app, 'Contents', 'MacOS', 'node')
  if (!existsSync(node)) die('the Node sidecar is missing from Contents/MacOS')
  // With `--entitlements - --xml` the entitlements themselves go to stdout.
  const entitled = spawnSync('codesign', ['--display', '--entitlements', '-', '--xml', node], {
    encoding: 'utf8',
  })
  if (entitled.status !== 0 || !entitled.stdout.includes('com.apple.security.cs.allow-jit')) {
    die(
      'the Node sidecar was signed without allow-jit — the sidecar-entitlement assumption broke; see this file\'s docblock for the manual re-sign path',
    )
  }

  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app], {
    stdio: 'inherit',
  })
  say(`audited ${machos.length} Mach-O files — all signed, sidecar entitled`)
}

async function build() {
  say('staging the runtime')
  await stage()

  say('signing the staged tree')
  signRuntime(tree)

  say('tauri build (bundle, sign, and — when the notary env is set — notarise the .app)')
  // A failed earlier run leaves dmg debris the retry trips over, twice
  // observed: bundle_dmg.sh's intermediate rw.*.dmg beside the .app, and —
  // found 2026-08-30 — a stale FINAL dmg, which makes its hdiutil convert
  // die with "File exists" and nearly shipped an old artefact under a new
  // signature. Every .dmg under the bundle dir is a build product; sweep
  // them all.
  for (const dir of ['macos', 'dmg']) {
    if (!existsSync(join(bundleDir, dir))) continue
    for (const leftover of readdirSync(join(bundleDir, dir))) {
      if (leftover.endsWith('.dmg')) rmSync(join(bundleDir, dir, leftover))
    }
  }
  execFileSync(
    process.execPath,
    ['node_modules/@tauri-apps/cli/tauri.js', 'build', '--target', 'aarch64-apple-darwin'],
    { cwd: repo, stdio: 'inherit' },
  )

  const app = join(bundleDir, 'macos', 'Propositum.app')
  if (!existsSync(app)) die(`no .app at ${app}`)
  audit(app)

  const dmgs = existsSync(join(bundleDir, 'dmg'))
    ? readdirSync(join(bundleDir, 'dmg')).filter((name) => name.endsWith('.dmg'))
    : []
  const only = dmgs[0]
  if (dmgs.length !== 1 || only === undefined) {
    die(`expected one .dmg in ${join(bundleDir, 'dmg')}, found ${dmgs.length}`)
    return
  }
  const dmg = join(bundleDir, 'dmg', only)

  if (identity !== undefined && notary) {
    say('notarising the .dmg itself — Tauri already notarised the .app inside it')
    execFileSync(
      'xcrun',
      [
        'notarytool',
        'submit',
        dmg,
        '--issuer',
        process.env.APPLE_API_ISSUER as string,
        '--key-id',
        process.env.APPLE_API_KEY as string,
        '--key',
        process.env.APPLE_API_KEY_PATH as string,
        '--wait',
      ],
      { stdio: 'inherit' },
    )
    execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' })
    execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'inherit' })
    execFileSync('spctl', ['-a', '-vvv', '-t', 'install', app], { stdio: 'inherit' })
    say('notarised, stapled and Gatekeeper-accepted')
  } else if (identity !== undefined) {
    say('signed but not notarised — the notary env (APPLE_API_ISSUER/KEY/KEY_PATH) is not set')
  } else {
    say('unsigned build finished — set APPLE_SIGNING_IDENTITY (and the notary env) to ship it')
  }

  say(`app: ${app}`)
  say(`dmg: ${dmg}`)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  await build()
}
