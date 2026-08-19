/** TEMPORARY diagnostic. Delete with the branch. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir, cpus } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'

const triggersSql = join(process.cwd(), 'prisma', 'triggers.sql')

function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  const statements: string[] = []
  let current = ''
  for (const line of withoutComments.split('\n')) {
    current += line + '\n'
    const trimmed = line.trim()
    const ends =
      trimmed === 'END;' || (trimmed.endsWith(';') && !/^(BEGIN|CREATE|WHEN|SELECT)/i.test(trimmed))
    if (ends) {
      if (current.trim()) statements.push(current.trim())
      current = ''
    }
  }
  if (current.trim()) statements.push(current.trim())
  return statements
}

async function triggerNames(prisma: PrismaClient): Promise<Set<string>> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type = 'trigger'",
  )
  return new Set(rows.map((r) => r.name))
}

/** Install, checking after every DROP whether the thing is actually gone. */
async function installWatched(prisma: PrismaClient, label: string): Promise<boolean> {
  const sql = await readFile(triggersSql, 'utf8')
  let clean = true
  for (const statement of splitStatements(sql)) {
    const drop = statement.match(/^DROP TRIGGER IF EXISTS (\w+);/i)?.[1]
    const create = statement.match(/^CREATE TRIGGER (\w+)/i)?.[1]
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (e) {
      clean = false
      const names = await triggerNames(prisma)
      console.log(
        `[${label}] FAILED on ${drop ? 'DROP ' + drop : 'CREATE ' + create}: ${(e as Error).message.split('\n').filter(Boolean).slice(-1)[0]}`,
      )
      console.log(
        `[${label}]   sqlite_master says ${create} present=${names.has(create ?? '')}, total triggers=${names.size}`,
      )
      break
    }
    if (drop !== undefined) {
      const names = await triggerNames(prisma)
      if (names.has(drop)) {
        clean = false
        console.log(`[${label}] DROP of ${drop} reported success and the trigger is STILL THERE`)
      }
    }
  }
  return clean
}

async function attempt(url: string, label: string, rounds: number): Promise<void> {
  for (let i = 1; i <= rounds; i++) {
    const prisma = new PrismaClient({ datasources: { db: { url } } })
    const [{ v }] = await prisma.$queryRawUnsafe<Array<{ v: string }>>(
      'SELECT sqlite_version() AS v',
    )
    const [{ mode }] = await prisma.$queryRawUnsafe<Array<{ mode: string }>>(
      'PRAGMA journal_mode',
    ).then((r) => r.map((x: Record<string, unknown>) => ({ mode: String(Object.values(x)[0]) })))
    const first = await installWatched(prisma, `${label} r${i} install-1`)
    const second = await installWatched(prisma, `${label} r${i} install-2`)
    console.log(
      `[${label} r${i}] sqlite=${v} journal=${mode} install-1 clean=${first} install-2 clean=${second}`,
    )
    await prisma.$disconnect()
  }
}

const dir = mkdtempSync(join(tmpdir(), 'propositum-diagnose-'))
const base = `file:${join(dir, 'test.db')}`
execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
  env: { ...process.env, DATABASE_URL: base },
  stdio: 'pipe',
})
console.log(`cpus=${cpus().length} node=${process.version} platform=${process.platform}`)
await attempt(base, 'default-pool', 3)
await attempt(`${base}?connection_limit=1`, 'pool-1', 3)
rmSync(dir, { recursive: true, force: true })
