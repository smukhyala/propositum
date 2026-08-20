/**
 * Format what you touched, and nothing else.
 *
 *     npm run format               # every file you changed against main
 *     npm run format -- src/a.ts   # or exactly these
 *     npm run format:check         # same set, but only report
 *
 * ── Why this is a script and not `prettier --write .` ────────────────────
 *
 * Running Prettier over this repository rewrites 107 of 175 source files —
 * measured 2026-08-19, +2,390 / −877 lines, almost all of it re-wrapping. That
 * is a decision about `git blame` on a codebase whose most valuable content is
 * the explanatory docblocks, and it was made deliberately: **no repo-wide
 * reformat.** Files converge on the config as people edit them.
 *
 * A `format` script that could do it by accident would undo that decision the
 * first time somebody typed it, which is why the obvious one-liner is not in
 * `package.json`. (`prettier --write` with no path does not error either — it
 * waits on stdin, so the accident is a hang rather than a refusal.)
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * CI does not run this. Formatting is not a reason for a pull request to be red
 * while most of the repository has not been formatted — the check would fail on
 * files nobody in that PR touched. When the last unformatted file is gone,
 * `format:check` over the whole tree becomes a CI step worth adding, and this
 * comment is how you will know it is time.
 */

import { execFileSync, spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const check = argv.includes('--check')
const explicit = argv.filter((arg) => !arg.startsWith('--'))

const git = (args: string[]): string => execFileSync('git', args, { encoding: 'utf8' }).trim()

/** Everything this branch changed, tracked or not. */
function touched(): string[] {
  let base = 'main'
  for (const candidate of ['origin/main', 'main']) {
    try {
      base = git(['merge-base', 'HEAD', candidate])
      break
    } catch {
      // No such ref — try the next, and fall back to comparing against `main`.
    }
  }

  const changed = git(['diff', '--name-only', '--diff-filter=ACMR', base])
  const untracked = git(['ls-files', '--others', '--exclude-standard'])
  return [...changed.split('\n'), ...untracked.split('\n')].filter((line) => line !== '')
}

const files = explicit.length > 0 ? explicit : touched()

if (files.length === 0) {
  console.log('Nothing changed against main, so there is nothing to format.')
  process.exit(0)
}

// `--ignore-unknown` because the changed set contains lockfiles, images and
// `.db` paths, and a formatter that fails on a PNG is a formatter people stop
// running.
const result = spawnSync(
  'npx',
  ['prettier', check ? '--check' : '--write', '--ignore-unknown', ...files],
  { stdio: 'inherit' },
)

process.exit(result.status ?? 1)
