/**
 * Stage the runtime a bundled Propositum.app carries.
 *
 *     npm run tray:stage
 *
 * Builds `dist-runtime/` at the repo root — everything Tauri's bundler copies
 * into the .app: the runtime tree for `Contents/Resources/runtime`, and the
 * Node sidecar for `Contents/MacOS/node`. The tray's bundled mode
 * (`src-tauri/src/runtime.rs`) runs the children out of that tree exactly the
 * way stage 1 ran them out of the checkout, which is why the tree IS the
 * checkout's shape: sources under tsx, a full production `node_modules`, a
 * prebuilt `.next`. No `output: 'standalone'`, no precompiled worker — the
 * shape that is known to run is the shape that ships.
 *
 * ── The three invariants this file exists to hold ────────────────────────
 *
 *   - **The dependency graph is the only inventory.** `npm ci --omit=dev`
 *     decides what `node_modules` ships; `tsx`, `playwright` and `prisma`
 *     are real dependencies now because the shipped product spawns all
 *     three. A hand-curated prune list would rot the first time anyone adds
 *     a package.
 *   - **Zero symlinks.** codesign seals a symlink as a link — its literal
 *     target string — so a link escaping the bundle notarises fine and
 *     breaks on a stranger's machine. Everything is materialised by an
 *     explicit pass (Node's `cpSync` honours `dereference` only for the top
 *     of the tree, verified 2026-08-28 — a nested link is copied as a link),
 *     `.bin` shims are deleted (nothing spawns through them; the tray
 *     invokes JS entrypoints directly), and a final sweep fails the stage on
 *     any survivor.
 *   - **The Node is pinned by hash.** The sidecar is downloaded from
 *     nodejs.org, verified against the checksum below, and cached in
 *     `dist-runtime/.cache`. Bumping it is a one-constant diff.
 *   - **Nothing personal rides along.** Staging copies the working tree, not
 *     the git index, and `src/fixtures/afternoons/` is where
 *     `npm run capture:afternoon` writes what ADR-0015 calls "a profile of
 *     you" — the never-commit fence guards commits, and a dev-machine build
 *     does not route through one, so the directory is removed from the
 *     staged tree and asserted absent (nothing in the runtime graph reads
 *     it). The builds themselves run with Next's and Prisma's phone-homes
 *     off, because the artefact they produce promises no telemetry.
 *
 * ── What this does not do ────────────────────────────────────────────────
 *
 * It does not sign anything (`scripts/sign-runtime.ts`), does not run the
 * bundler (`scripts/release-tray.ts` owns the order), and does not stage the
 * Playwright browser — that stays a per-person cache the tray offers to
 * install on a click, because ~150 MB of Chromium does not belong inside a
 * notarised bundle it was never built to live in.
 */

import { createHash } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** One minor behind the latest is deliberate headroom; `engines.node` in
 * `package.json` is the floor and the assertion below keeps them agreeing. */
export const NODE_VERSION = '22.23.2'
export const NODE_SHA256 = '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6'

/** What the runtime tree holds, exactly — `tests/stage-runtime.test.ts` reads
 * this and asserts every entry exists in the checkout, so a rename there goes
 * red here rather than quiet. `.next` and `node_modules` are not on it
 * because they are produced, not copied. */
export const INVENTORY = [
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'tsconfig.json',
  'prisma/schema.prisma',
  'prisma/triggers.sql',
  'src',
  'scripts',
  'public',
  'extension',
]

/** The paths a launch actually loads, asserted after staging so a missing one
 * fails here and not on a stranger's machine. */
export const LOAD_BEARING = [
  '.next/BUILD_ID',
  'node_modules/next/dist/bin/next',
  'node_modules/tsx/dist/cli.mjs',
  'node_modules/prisma/build/index.js',
  'node_modules/@prisma/engines/schema-engine-darwin-arm64',
  'node_modules/.prisma/client/libquery_engine-darwin-arm64.dylib.node',
  'node_modules/.prisma/client/schema.prisma',
  'node_modules/playwright/cli.js',
  'node_modules/@esbuild/darwin-arm64/bin/esbuild',
]

/** Where staging lands, relative to the repo root — exported so
 * `tests/stage-runtime.test.ts` can assert `tauri.conf.json`'s resources and
 * externalBin entries agree with what this script actually produces. */
export const TREE_RELATIVE = 'dist-runtime/runtime'
export const SIDECAR_RELATIVE = 'dist-runtime/bin/node-aarch64-apple-darwin'

/** Where ADR-0028's bundled key rides inside the staged tree, when the
 * builder's environment carries one. `src-tauri/src/runtime.rs` reads the
 * same literal — the test pins the two spellings to each other. */
export const BUNDLED_KEY_RELATIVE = 'bundled-key'

/** Pure, so the test needs no environment: the capped tester key from
 * `PROPOSITUM_BUNDLED_KEY`, or null when the build should ask instead —
 * absence is ADR-0028 §3's floor, not an error. */
export function bundledKeyFrom(env: Record<string, string | undefined>): string | null {
  const key = env['PROPOSITUM_BUNDLED_KEY']?.trim()
  return key === undefined || key === '' ? null : key
}

const repo = fileURLToPath(new URL('..', import.meta.url))
const staging = join(repo, 'dist-runtime')
const tree = join(repo, TREE_RELATIVE)
const cache = join(staging, '.cache')

const say = (line: string) => console.log(`[stage] ${line}`)
const die = (line: string): never => {
  console.error(`[stage] ${line}`)
  process.exit(1)
}

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CHECKPOINT_DISABLE: '1' },
  })

/** Every symlink under `dir`, by lstat — the sweep that makes the zero-symlink
 * invariant checked rather than assumed. */
function symlinksUnder(dir: string): string[] {
  const found: string[] = []
  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name)
      if (lstatSync(path).isSymbolicLink()) found.push(path)
      else if (entry.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return found
}

/** Replace every symlink under `dir` with what it points at. A broken link
 * dies here, with its path — shipping it would mean a stranger finds it. */
function materialiseSymlinks(dir: string) {
  for (const path of symlinksUnder(dir)) {
    let target: string
    try {
      target = realpathSync(path)
    } catch {
      die(`${path} is a broken symlink`)
      return
    }
    rmSync(path)
    cpSync(target, path, { recursive: true })
  }
}

function deleteBinDirs(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name)
    if (entry.name === '.bin') rmSync(path, { recursive: true, force: true })
    else deleteBinDirs(path)
  }
}

async function fetchNode(): Promise<string> {
  const tarball = `node-v${NODE_VERSION}-darwin-arm64.tar.gz`
  const cached = join(cache, tarball)
  if (!existsSync(cached)) {
    say(`downloading ${tarball}`)
    const response = await fetch(`https://nodejs.org/dist/v${NODE_VERSION}/${tarball}`)
    if (!response.ok) die(`nodejs.org answered ${response.status} for ${tarball}`)
    mkdirSync(cache, { recursive: true })
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()))
  }
  const digest = createHash('sha256').update(readFileSync(cached)).digest('hex')
  if (digest !== NODE_SHA256) {
    rmSync(cached)
    die(`the Node tarball's checksum is wrong (${digest}) — deleted, run again`)
  }
  return cached
}

export async function stage() {
  if (process.arch !== 'arm64') {
    die('staging is Apple Silicon only for now — universal is planned, not built')
  }

  const floor = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).engines.node
  if (!NODE_VERSION.startsWith(String(parseInt(floor.replace('>=', ''), 10)) + '.')) {
    die(`the pinned Node ${NODE_VERSION} is not the major engines.node names (${floor})`)
  }

  rmSync(tree, { recursive: true, force: true })
  rmSync(join(staging, 'bin'), { recursive: true, force: true })
  mkdirSync(tree, { recursive: true })

  say('copying the checkout shape')
  for (const entry of INVENTORY) {
    const from = join(repo, entry)
    if (!existsSync(from)) die(`the inventory names ${entry}, which does not exist`)
    cpSync(from, join(tree, entry), { recursive: true, dereference: true })
  }
  rmSync(join(tree, 'src', 'fixtures', 'afternoons'), { recursive: true, force: true })

  // ADR-0028: the capped tester key, from the builder's environment and never
  // from git. The say lines deliberately interpolate nothing — the value
  // reaches the file and nowhere else. Public-by-design inside the bundle
  // (the ADR's cost section owns that argument), so no special mode.
  const bundledKey = bundledKeyFrom(process.env)
  if (bundledKey !== null) {
    writeFileSync(join(tree, BUNDLED_KEY_RELATIVE), bundledKey + '\n')
    say('a bundled key rides in this build (ADR-0028) — the first run will not ask for one')
  } else {
    say('no bundled key in the environment — this build asks for a key, which is the floor')
  }

  say('npm ci --omit=dev (the dependency graph is the inventory)')
  run('npm', ['ci', '--omit=dev'], tree)

  say('prisma generate, into the staged tree')
  run(process.execPath, ['node_modules/prisma/build/index.js', 'generate'], tree)

  say('next build, in the checkout')
  run(process.execPath, ['node_modules/next/dist/bin/next', 'build'], repo)
  // cache/ and dev/ are hundreds of megabytes of things `next start` never
  // reads — filtered out of the copy, left in place for the checkout's own
  // dev server.
  const skipped = new Set(['cache', 'dev', 'diagnostics'])
  cpSync(join(repo, '.next'), join(tree, '.next'), {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const [head] = relative(join(repo, '.next'), source).split('/')
      return head === undefined || head === '' || !skipped.has(head)
    },
  })

  say('deleting .bin shims and materialising symlinks')
  deleteBinDirs(join(tree, 'node_modules'))
  materialiseSymlinks(tree)
  const links = symlinksUnder(tree)
  if (links.length > 0) {
    die(`the staged tree still holds symlinks:\n  ${links.join('\n  ')}`)
  }

  say(`fetching the Node ${NODE_VERSION} sidecar`)
  const tarball = await fetchNode()
  mkdirSync(join(staging, 'bin'), { recursive: true })
  run('tar', ['-xzf', tarball, '-C', join(staging, 'bin'), '--strip-components=2', `node-v${NODE_VERSION}-darwin-arm64/bin/node`], staging)
  const sidecar = join(repo, SIDECAR_RELATIVE)
  renameSync(join(staging, 'bin', 'node'), sidecar)
  chmodSync(sidecar, 0o755)
  const version = execFileSync(sidecar, ['--version'], { encoding: 'utf8' }).trim()
  if (version !== `v${NODE_VERSION}`) die(`the sidecar says it is ${version}`)

  for (const path of LOAD_BEARING) {
    if (!existsSync(join(tree, path))) die(`staged, but ${path} is missing`)
  }
  if (existsSync(join(tree, 'src', 'fixtures', 'afternoons'))) {
    die('src/fixtures/afternoons reached the staged tree — a captured profile must never ship')
  }

  writeFileSync(
    join(tree, 'runtime-manifest.json'),
    JSON.stringify(
      {
        stagedAt: new Date().toISOString(),
        gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
        nodeVersion: NODE_VERSION,
        nextBuildId: readFileSync(join(tree, '.next', 'BUILD_ID'), 'utf8').trim(),
        carriesBundledKey: bundledKey !== null,
      },
      null,
      2,
    ) + '\n',
  )

  const size = execFileSync('du', ['-sh', tree], { encoding: 'utf8' }).split('\t')[0]
  say(`staged ${size} at ${tree}`)
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  await stage()
}
