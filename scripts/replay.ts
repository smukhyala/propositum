/**
 * Replay a recorded stream, and say what Propositum would have surfaced.
 *
 *   npm run replay -- src/fixtures/streams/partner-event.jsonl
 *
 * ── Why this writes to a throwaway database ──────────────────────────────
 *
 * `seed:shift` and `seed:offer` write to yours on purpose — they exist to put
 * something on your screen. This one is a measurement, and a measurement that
 * leaves rows behind is one you can only run once. It builds a temporary SQLite
 * file, installs the append-only guards, replays into that, prints, and deletes
 * it. Nothing it does can reach `propositum.db`.
 *
 * ── Why it calls the writer directly rather than an endpoint ─────────────
 *
 * `seed:offer` posts at the real ambient endpoint because the extension does,
 * and the point there is to exercise the transport. There is no endpoint for an
 * `ExternalEvent` and this script is not standing in for one: `replay` is a
 * member of `ExternalEventStatedBy`, so this script **is** the source, and
 * `createExternalWriter` is exactly the door it is meant to come through.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It does not detect strands. A stream carries no browsing, and the ambient
 * buffer is in-process and separate; ordering a strand against a discharged
 * wait on one screen is step 6 of `docs/todo/12-between-sittings.md`. So the
 * candidates below are discharged waits, and the silence list is what proves
 * the ones that should not appear do not.
 *
 * It costs nothing and calls no model. There is no boundary on this path.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { ensureAppendOnlyGuards } from '../src/persistence/append-only'
import { createExternalWriter } from '../src/persistence/external-writer'
import { createRepositories } from '../src/persistence/repositories/index'
import { reasonFor } from '../src/domain/detection/order-candidates'
import { candidatesFrom, parseStream, type ReplayedProject } from '../src/eval/replay'

/**
 * The stream's origin. Fixed, never `Date.now()`, so two runs of one stream are
 * the same input — which is the property the whole file exists for.
 */
const ORIGIN_EPOCH_MS = Date.UTC(2026, 0, 1, 9, 0, 0)

const path = process.argv[2]
if (path === undefined) {
  console.error('Usage: npm run replay -- <stream.jsonl>')
  process.exit(1)
}

const parsed = parseStream(readFileSync(path, 'utf8'))
if (!parsed.ok) {
  console.error(`That stream did not read: ${parsed.detail}`)
  process.exit(1)
}
const stream = parsed.stream

const dir = mkdtempSync(join(tmpdir(), 'propositum-replay-'))
const url = `file:${join(dir, 'replay.db')}`
let failed = false

try {
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  const prisma = new PrismaClient({ datasources: { db: { url } } })
  try {
    await ensureAppendOnlyGuards(prisma)
    const repos = createRepositories(prisma)
    const writer = createExternalWriter(prisma)

    // Everything a person did happens at the stream's origin unless a later
    // line moves it. Injected, never read, so two runs are one input.
    let clockMs = ORIGIN_EPOCH_MS

    const projectIds = new Map<string, string>()
    const intentionIds = new Map<string, string>()
    const waits = new Map<string, string>()
    const arrivals = new Map<string, number>()

    for (const line of stream.lines) {
      if (line.type === 'project') {
        const row = await prisma.project.create({ data: { name: line.name } })
        projectIds.set(line.name, row.id)
        continue
      }

      if (line.type === 'intention') {
        const projectId = projectIds.get(line.project)
        if (projectId === undefined) throw new Error(`no project named ${line.project}`)
        const created = await repos.intentions.create({
          projectId,
          objective: line.objective,
          definitionOfDone: line.definitionOfDone,
          ...(line.statedWait === undefined
            ? {}
            : { statedWait: line.statedWait, statedWaitAt: new Date(clockMs) }),
        })
        intentionIds.set(line.project, created.id)
        if (line.statedWait !== undefined) waits.set(line.project, line.statedWait)
        continue
      }

      if (line.type === 'wait') {
        const id = intentionIds.get(line.project)
        if (id === undefined) throw new Error(`no intention on ${line.project}`)
        await repos.intentions.stateWait(id, line.statedWait ?? null, new Date(clockMs))
        if (line.statedWait === undefined) waits.delete(line.project)
        else waits.set(line.project, line.statedWait)
        // A wait stated now is not answered by an arrival already recorded, and
        // the database is what decides that. Dropping the local note keeps this
        // script from reporting a discharge the bound refused.
        arrivals.delete(line.project)
        continue
      }

      const intentionId = intentionIds.get(line.project)
      if (intentionId === undefined) throw new Error(`no intention on ${line.project}`)
      const written = await writer.append({
        statedBy: 'replay',
        kind: 'arrived',
        occurredAt: new Date(ORIGIN_EPOCH_MS + line.elapsedMs),
        elapsedMs: line.elapsedMs,
        intentionId,
        attested: { statedBy: 'replay', stream: stream.name },
      })
      if (!written.ok) throw new Error(`the ledger refused an arrival: ${written.reason}`)
      // The stream's clock only ever moves forward, and only an arrival moves
      // it: a person's acts happen at whatever moment the stream had reached.
      clockMs = Math.max(clockMs, ORIGIN_EPOCH_MS + line.elapsedMs)
      // Last arrival wins, which is what "most recent" means downstream.
      arrivals.set(line.project, line.elapsedMs)
    }

    // Read the discharge back off the database rather than trusting the loop —
    // the bound at `statedWaitAt` is the thing worth exercising, and asserting
    // the fixture's own arithmetic would prove nothing about it.
    const replayed: ReplayedProject[] = []
    for (const [project, projectId] of projectIds) {
      const facts = await repos.intentions.factsForProject(projectId)
      replayed.push({
        project,
        statedWait: facts?.statedWait ?? null,
        arrivedAtElapsedMs:
          facts?.waitDischarged === true ? (arrivals.get(project) ?? null) : null,
      })
    }

    const candidates = candidatesFrom(replayed, ORIGIN_EPOCH_MS)
    const surfaced = candidates.map((candidate) =>
      candidate.kind === 'strand' ? candidate.signature : candidate.intentionId,
    )
    const latest = Math.max(0, ...replayed.map((p) => p.arrivedAtElapsedMs ?? 0))
    const now = ORIGIN_EPOCH_MS + latest

    console.log(`\n${stream.name}`)
    console.log(`${stream.rationale}\n`)

    if (candidates.length === 0) {
      console.log('  Nothing to say. Silence is a correct output.\n')
    }
    for (const [index, candidate] of candidates.entries()) {
      const who = candidate.kind === 'strand' ? candidate.signature : candidate.intentionId
      console.log(`  ${index + 1}. ${who}`)
      console.log(`     ${reasonFor(candidate, now)}`)
    }

    const expected = stream.expectSurfaced
    if (surfaced.join('|') !== expected.join('|')) {
      console.error(`\n  ✗ surfaced [${surfaced.join(', ')}], expected [${expected.join(', ')}]`)
      failed = true
    } else {
      console.log(`\n  ✓ surfaced exactly what was expected, in order`)
    }

    for (const quiet of stream.expectSilence) {
      if (surfaced.includes(quiet.project)) {
        console.error(`  ✗ spoke about ${quiet.project}, and should not have: ${quiet.because}`)
        failed = true
      }
    }
    if (!failed && stream.expectSilence.length > 0) {
      console.log(`  ✓ stayed quiet about ${stream.expectSilence.length}, each for its own reason\n`)
    }
  } finally {
    await prisma.$disconnect()
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
