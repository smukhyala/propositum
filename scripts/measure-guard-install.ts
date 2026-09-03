/**
 * What a test file's database actually costs, split into its two halves.
 *
 * ── Why this exists, and why it is temporary ─────────────────────────────
 *
 * [#97](https://github.com/smukhyala/propositum/issues/97) offered three
 * explanations for three tests timing out on CI and passing on a re-run of the
 * same commit. PR #131 answered it with the first — a global `testTimeout` —
 * and measured enough to justify that. It did not look at the third, which is
 * about a different number: nobody has measured what
 * `ensureAppendOnlyGuards` costs on `ubuntu-latest` as against a developer
 * machine.
 *
 * The timeout is a cure rather than a diagnosis and says so in its own comment.
 * What it changed is what the next observation means: with 30 s of headroom, an
 * install that has quietly become five times slower on Linux is invisible until
 * it is thirty times slower. The measurement gets harder to take at exactly the
 * moment it stops hurting — which is why it is taken now.
 *
 * **This script is scaffolding and should be deleted once the number is in the
 * comment beside the code.** `PR #82` did the same thing for the same question
 * and was deleted in the same week; this follows it deliberately.
 *
 * ── What it measures, and what it deliberately does not ──────────────────
 *
 * Two numbers per iteration, because the CI header's correction is about which
 * of them dominates:
 *
 *   - `push`    — spawning `npx prisma db push`, which is a Node process
 *                 start plus a schema apply.
 *   - `install` — `ensureAppendOnlyGuards` against the database that push
 *                 just made: read `triggers.sql`, split it, and run every
 *                 statement in one transaction, then verify.
 *
 * It runs them SEQUENTIALLY and alone. That is not what CI does — the whole
 * point of #97 is contention between parallel vitest workers — so these are
 * per-operation costs, not a reproduction of the failure. Reproducing the
 * contention would measure the runner's scheduler; this measures the thing the
 * issue asks about, on both machines, with the same code.
 *
 * It also does not touch the application database: every iteration builds its
 * own temp file and deletes it.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { ensureAppendOnlyGuards } from '../src/persistence/append-only'

/** Enough to see a distribution rather than one sample, and few enough that
 *  this finishes inside a CI step. */
const ITERATIONS = Number(process.env['GUARD_MEASURE_ITERATIONS'] ?? 5)

const ms = (from: bigint): number => Number(process.hrtime.bigint() - from) / 1e6

function summarise(label: string, samples: readonly number[]): string {
  const sorted = [...samples].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const total = samples.reduce((sum, value) => sum + value, 0)
  return [
    `${label.padEnd(8)}`,
    `median ${median.toFixed(0).padStart(6)} ms`,
    `min ${(sorted[0] ?? 0).toFixed(0).padStart(6)} ms`,
    `max ${(sorted[sorted.length - 1] ?? 0).toFixed(0).padStart(6)} ms`,
    `mean ${(total / samples.length).toFixed(0).padStart(6)} ms`,
  ].join('  ')
}

async function main(): Promise<void> {
  const pushes: number[] = []
  const installs: number[] = []

  for (let i = 0; i < ITERATIONS; i += 1) {
    const dir = mkdtempSync(join(tmpdir(), 'propositum-measure-'))
    const url = `file:${join(dir, 'test.db')}`

    const pushStarted = process.hrtime.bigint()
    execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    })
    pushes.push(ms(pushStarted))

    const prisma = new PrismaClient({ datasources: { db: { url } } })
    const installStarted = process.hrtime.bigint()
    await ensureAppendOnlyGuards(prisma)
    installs.push(ms(installStarted))

    await prisma.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  }

  const medianOf = (samples: readonly number[]): number => {
    const sorted = [...samples].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }

  console.log(`platform: ${process.platform}/${process.arch}  node ${process.version}`)
  console.log(`iterations: ${ITERATIONS}`)
  console.log(summarise('push', pushes))
  console.log(summarise('install', installs))

  const push = medianOf(pushes)
  const install = medianOf(installs)
  const share = (install / (push + install)) * 100
  console.log(
    `install is ${share.toFixed(1)}% of one test file's database setup ` +
      `(${install.toFixed(0)} ms of ${(push + install).toFixed(0)} ms)`,
  )
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
