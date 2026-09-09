/**
 * Copy the database, then bring its schema up to date.
 *
 *   npm run db:prepare
 *
 * Run before anything opens the database — the tray's preflight runs it at every
 * launch, `npm run dev` runs it through the same path, and a developer who has
 * just pulled a schema change runs it by hand. It replaces `prisma db push`
 * everywhere except in tests, which build throwaway files and should keep using
 * the throwaway tool. ADR-0039.
 *
 * The decisions live in `src/persistence/prepare.ts` and are unit-tested; this
 * file is the process that performs them, and holds only what needs a
 * filesystem or a subprocess.
 *
 * ── Exit codes, because a supervisor reads them ──────────────────────────
 *
 * `EX_CONFIG` when the environment is wrong — no `DATABASE_URL`, or one this
 * cannot parse. `1` when a step failed. `0` when the database is ready.
 * **A failure here must stop the launch**, which is why preflight blocks on it:
 * a child that starts against a half-migrated file is the thing this exists to
 * prevent.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  BASELINE_MIGRATION,
  backupNameFor,
  planFor,
  pruneBackups,
  type DatabaseState,
} from '../src/persistence/prepare'
import { EX_CONFIG } from '../src/runtime/exit-codes'

/** `file:./dev.db` and `file:/abs/path.db` both reach here. Relative paths
 *  resolve against the schema directory, which is how Prisma reads them. */
function fileFromUrl(url: string): string | null {
  if (!url.startsWith('file:')) return null
  const raw = url.slice('file:'.length)
  if (raw.startsWith('/')) return raw
  return join(process.cwd(), 'prisma', raw.replace(/^\.\//, ''))
}

/**
 * What is in the file.
 *
 * **A raw query over `sqlite_master`, and the rawness is the point.** This runs
 * BEFORE the schema is known to match the file, so any read that goes through
 * the generated client's model types is asking a question in a language the
 * file may not speak. `$queryRawUnsafe` bypasses that entirely — it is one
 * string sent to SQLite, and a stale client cannot make it wrong.
 *
 * `node:sqlite` would be the more direct instrument and is not used: it is
 * experimental in Node 22 and prints a warning on import, which in a bundled
 * launch means a line in the person's log at every start, for ever, about a
 * thing that is working correctly.
 */
async function inspect(databaseFile: string, url: string): Promise<DatabaseState> {
  if (!existsSync(databaseFile)) {
    return { exists: false, hasMigrationHistory: false, hasOurTables: false }
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type = 'table'`,
    )
    const names = rows.map((row) => row.name)

    return {
      exists: true,
      hasMigrationHistory: names.includes('_prisma_migrations'),
      // `project` is the oldest table in the schema and the one every other
      // table hangs off. If it is here, this is one of ours.
      hasOurTables: names.includes('project'),
    }
  } finally {
    await prisma.$disconnect()
  }
}

function backUp(databaseFile: string): string {
  const target = backupNameFor(databaseFile, new Date())
  copyFileSync(databaseFile, target)

  const dir = dirname(databaseFile)
  const prefix = `${basename(databaseFile)}.backup-`
  const existing = readdirSync(dir).filter((name) => name.startsWith(prefix))

  for (const stale of pruneBackups(existing)) {
    rmSync(join(dir, stale), { force: true })
  }

  return target
}

function prisma(args: readonly string[]): void {
  execFileSync('npx', ['prisma', ...args], { stdio: 'inherit' })
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env and try again.')
    process.exit(EX_CONFIG)
  }

  const databaseFile = fileFromUrl(url)
  if (databaseFile === null) {
    console.error(`DATABASE_URL is not a file: URL, so there is nothing to migrate: ${url}`)
    process.exit(EX_CONFIG)
  }

  const plan = planFor(await inspect(databaseFile, url))
  console.log(`Preparing ${databaseFile} — ${plan.because}`)

  if (plan.backUp) {
    const copy = backUp(databaseFile)
    // Printed rather than logged quietly: the path is the only thing a person
    // needs if the migration below turns out to have been the wrong idea.
    console.log(`  copied to ${copy} (${statSync(copy).size} bytes)`)
  }

  if (plan.baseline) {
    console.log(`  marking ${BASELINE_MIGRATION} applied without running it`)
    prisma(['migrate', 'resolve', '--applied', BASELINE_MIGRATION])
  }

  prisma(['migrate', 'deploy'])
  console.log('Database ready. The append-only guards are reinstalled and verified at startup.')
}

main().catch((error: unknown) => {
  console.error('Could not prepare the database, and nothing was migrated.')
  console.error(error)
  process.exit(1)
})
