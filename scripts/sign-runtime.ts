/**
 * Sign every Mach-O in the staged runtime tree, before the bundler runs.
 *
 * Notarisation rejects any unsigned executable code anywhere in the bundle,
 * and Tauri's bundler signs only what it placed itself — the tray binary and
 * the Node sidecar — never the payload it copied into `Resources`. The staged
 * tree carries real Mach-Os (esbuild, Prisma's engines, `.node` dylibs), all
 * ad-hoc linker-signed by their publishers, which notarisation refuses and
 * the hardened Node's library validation would refuse at dlopen too. Signing
 * them here, with the same Developer ID the bundle gets, fixes both at once —
 * and is why the entitlements file needs no `disable-library-validation`:
 * same team, no hole.
 *
 * Signing happens BEFORE bundling because an embedded signature is byte
 * content — the bundler's copy carries it along, and the true inside-out
 * order (payload, then sidecar, then binary, then bundle) falls out of the
 * sequencing in `scripts/release-tray.ts` for free.
 *
 * ── Detection is magic bytes, never a hand-list ──────────────────────────
 *
 * A missed Mach-O comes back as a named path in `notarytool log`; the fix is
 * always this detector, never an inventory. The fat magic (`cafebabe`) is
 * shared with Java class files, so a fat hit must also look like a sane
 * arch count.
 *
 * ── What this does not do ────────────────────────────────────────────────
 *
 * No entitlements: nothing in Resources JITs — the two carve-outs in
 * `src-tauri/entitlements.plist` belong to the processes Tauri signs. And
 * with `APPLE_SIGNING_IDENTITY` unset it signs nothing and exits 0, listing
 * what it skipped, so an unsigned smoke build stays one command.
 */

import { openSync, readSync, closeSync, lstatSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MACH_O_THIN = new Set([0xcffaedfe, 0xcefaedfe])
const FAT = new Set([0xcafebabe, 0xcafebabf])

function isMachO(path: string): boolean {
  const fd = openSync(path, 'r')
  try {
    const head = Buffer.alloc(8)
    if (readSync(fd, head, 0, 8, 0) < 8) return false
    const magic = head.readUInt32BE(0)
    if (MACH_O_THIN.has(magic)) return true
    // A fat header's arch count is small; a Java class file puts its version
    // here and every real one reads ≥ 45.
    return FAT.has(magic) && head.readUInt32BE(4) < 30
  } finally {
    closeSync(fd)
  }
}

/** Every Mach-O under `root`, plus the symlink sweep: any symlink at all is a
 * staging failure (`stage-runtime.ts` materialises them), reported rather
 * than signed around. */
export function machOFiles(root: string): { machos: string[]; symlinks: string[] } {
  const machos: string[] = []
  const symlinks: string[] = []
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) symlinks.push(path)
      else if (stat.isDirectory()) walk(path)
      else if (stat.isFile() && stat.size >= 8 && isMachO(path)) machos.push(path)
    }
  }
  walk(root)
  return { machos, symlinks }
}

export function signRuntime(root: string) {
  const identity = process.env.APPLE_SIGNING_IDENTITY
  const { machos, symlinks } = machOFiles(root)

  if (symlinks.length > 0) {
    console.error(`[sign] the tree holds symlinks, which staging promised not to:\n  ${symlinks.join('\n  ')}`)
    process.exit(1)
  }

  if (identity === undefined || identity.trim() === '') {
    console.log(`[sign] APPLE_SIGNING_IDENTITY is unset — leaving ${machos.length} Mach-O files ad-hoc signed (fine for a local smoke build, refused by notarisation)`)
    return
  }

  for (const path of machos) {
    execFileSync('codesign', ['--force', '--timestamp', '--options', 'runtime', '-s', identity, path])
    execFileSync('codesign', ['--verify', '--strict', path])
  }
  console.log(`[sign] signed ${machos.length} Mach-O files with "${identity}"`)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  const fallback = join(fileURLToPath(new URL('..', import.meta.url)), 'dist-runtime', 'runtime')
  signRuntime(process.argv[2] ?? fallback)
}
