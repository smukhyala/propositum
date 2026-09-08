/**
 * The second ledger. ADR-0034.
 *
 * Two of these tests are about the writer working. The rest are about the
 * decision holding — the closed sets, the absent column, the referential action,
 * and the guarantee on the FIRST ledger that this change was careful not to
 * spend. Those are the ones that matter in six months.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureAppendOnlyGuards } from '../src/persistence/append-only'
import { createRepositories } from '../src/persistence/repositories/index'
import {
  createExternalWriter,
  EXTERNAL_EVENT_KINDS,
  EXTERNAL_EVENT_STATED_BY,
} from '../src/persistence/external-writer'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

let dir: string
let prisma: PrismaClient
let intentionId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-external-'))
  const url = `file:${join(dir, 'test.db')}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  prisma = new PrismaClient({ datasources: { db: { url } } })
  await ensureAppendOnlyGuards(prisma)

  const intention = await prisma.intention.create({
    data: { objective: 'ship the thing', definitionOfDone: 'it is shipped' },
  })
  intentionId = intention.id
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('the closed sets are the guard', () => {
  /**
   * The whole containment of ADR-0034 is that neither source watches anything.
   * A third member is the sensor decision, with a permission argument this set
   * does not carry — so this length is the thing that goes red, not a review.
   */
  it('permits exactly two sources, and neither is a sensor', () => {
    expect(EXTERNAL_EVENT_STATED_BY).toEqual(['declared', 'replay'])
  })

  it('permits exactly one kind', () => {
    expect(EXTERNAL_EVENT_KINDS).toEqual(['arrived'])
  })

  /**
   * A deadline passing is arithmetic over a stated date and a clock. Writing it
   * as a row would be Propositum recording its own reasoning as an observation,
   * which is the direction ADR-0033 warned about in its closing paragraph.
   */
  it('has no member for something only a clock could produce', () => {
    for (const kind of EXTERNAL_EVENT_KINDS) {
      expect(kind).not.toMatch(/deadline|due|overdue|elapsed|expired/)
    }
  })
})

describe('the table holds no page-authored text', () => {
  /**
   * Structural, not a promise. `UntrustedContent` may only cross into SQLite
   * through `createLedgerWriter`, which is the module that datamarks and is
   * pinned at one caller for exactly that reason. A second writer with an
   * `untrusted` column would be the second path that pin exists to refuse.
   *
   * Asserted against the schema text rather than the client, because a Prisma
   * client is generated and a reader checking this claim opens the schema.
   */
  it('declares no untrusted column on external_event', () => {
    const schema = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(schema.indexOf('model ExternalEvent'))
    const body = model.slice(0, model.indexOf('\n}'))
    expect(body).not.toMatch(/^\s*untrusted\s/m)
  })

  it('refuses SetNull, which on an append-only row is an UPDATE the guard aborts', () => {
    const schema = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(schema.indexOf('model ExternalEvent'))
    const body = model.slice(0, model.indexOf('\n}'))
    expect(body).toContain('onDelete: Restrict')
    expect(body).not.toContain('onDelete: SetNull')
  })
})

describe('the writer', () => {
  it('assigns a gapless global seq, with no session to be gapless within', async () => {
    const writer = createExternalWriter(prisma)
    const first = await writer.append({
      statedBy: 'declared',
      kind: 'arrived',
      occurredAt: new Date(0),
      elapsedMs: 0,
      intentionId,
    })
    const second = await writer.append({
      statedBy: 'replay',
      kind: 'arrived',
      occurredAt: new Date(1000),
      elapsedMs: 1000,
    })

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.seq).toBe(first.seq + 1)
  })

  /** Failures are values at every seam here, for `AppendResult`'s reason: an
   *  exception across a route boundary arrives as an opaque digest. */
  it('returns a malformed event rather than throwing it', async () => {
    const writer = createExternalWriter(prisma)
    const result = await writer.append({ statedBy: 'a sensor', kind: 'arrived' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('malformed')
  })

  /** The mirror of `unknown-session`. Without it a bad id becomes a raw
   *  foreign-key throw that a caller cannot tell from the database being down. */
  it('refuses an Intention that does not exist, as a value', async () => {
    const writer = createExternalWriter(prisma)
    const result = await writer.append({
      statedBy: 'declared',
      kind: 'arrived',
      occurredAt: new Date(0),
      elapsedMs: 0,
      intentionId: 'no-such-intention',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('unknown-intention')
  })

  it('never calls the clock, so a replayed week and a lived one are one input', () => {
    const source = readFileSync(join(repo, 'src/persistence/external-writer.ts'), 'utf8')
    const code = source.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/Date\.now\(\)/)
    expect(code).not.toMatch(/new Date\(\)/)
  })
})

describe('append-only, and the first ledger untouched', () => {
  it('refuses an UPDATE and a DELETE on a written row', async () => {
    const writer = createExternalWriter(prisma)
    const written = await writer.append({
      statedBy: 'declared',
      kind: 'arrived',
      occurredAt: new Date(0),
      elapsedMs: 0,
    })
    expect(written.ok).toBe(true)
    if (!written.ok) return

    await expect(
      prisma.externalEvent.update({ where: { id: written.id }, data: { kind: 'arrived' } }),
    ).rejects.toThrow()
    await expect(prisma.externalEvent.delete({ where: { id: written.id } })).rejects.toThrow()
  })

  /**
   * The sentence ADR-0034 spends only half of. `ObservationEvent.sessionId`
   * stays required, so *no event outside a sitting can be persisted* is still
   * true of the observation ledger — which is where it always was.
   */
  it('leaves ObservationEvent.sessionId required', () => {
    const schema = readFileSync(join(repo, 'prisma/schema.prisma'), 'utf8')
    const model = schema.slice(schema.indexOf('model ObservationEvent'))
    const body = model.slice(0, model.indexOf('\n}'))
    expect(body).toMatch(/^\s*sessionId\s+String\s*$/m)
    expect(body).not.toMatch(/^\s*sessionId\s+String\?/m)
  })
})

describe('a wait, and what discharges it', () => {
  /**
   * The property that is easy to get wrong and invisible when you do.
   *
   * Discharge is bounded at `statedWaitAt`, so an arrival that answered a
   * PREVIOUS wait cannot discharge the one stated after it. Without the bound a
   * person who states a second wait finds it already discharged, and the only
   * symptom is a screen that quietly stops saying *Waiting*.
   */
  it('is not discharged by an arrival that answered the previous wait', async () => {
    const repos = createRepositories(prisma)
    const writer = createExternalWriter(prisma)

    const project = await prisma.project.create({ data: { name: 'waits' } })
    const intention = await prisma.intention.create({
      data: {
        projectId: project.id,
        objective: 'book the venue',
        definitionOfDone: 'it is booked',
      },
    })

    await repos.intentions.stateWait(intention.id, 'a reply from the venue')
    let facts = await repos.intentions.factsForProject(project.id)
    expect(facts?.statedWait).toBe('a reply from the venue')
    expect(facts?.waitDischarged).toBe(false)

    const arrival = await writer.append({
      statedBy: 'declared',
      kind: 'arrived',
      occurredAt: new Date(),
      elapsedMs: 0,
      intentionId: intention.id,
    })
    expect(arrival.ok).toBe(true)

    facts = await repos.intentions.factsForProject(project.id)
    expect(facts?.waitDischarged, 'an arrival after the wait discharges it').toBe(true)

    // A second wait, stated after that arrival. The old arrival must not answer
    // it — this is the assertion the bound exists for.
    await new Promise((resolve) => setTimeout(resolve, 5))
    await repos.intentions.stateWait(intention.id, 'the deposit to clear')

    facts = await repos.intentions.factsForProject(project.id)
    expect(facts?.statedWait).toBe('the deposit to clear')
    expect(
      facts?.waitDischarged,
      'a re-stated wait was discharged by the arrival that answered the previous one',
    ).toBe(false)
  })

  /**
   * The boundary itself, which nothing hit until a review pointed at it.
   *
   * The predicate is `occurredAt >= statedWaitAt`, so an arrival recorded at the
   * exact millisecond a wait is stated DOES discharge it. That is a real
   * property and it is asserted rather than left to be discovered: the replay
   * fixture whose whole job is the bound was passing because of a bookkeeping
   * map rather than because of this, and the equal case is where the two
   * answers differ.
   *
   * `scripts/replay.ts` advances its clock by a millisecond before a re-stated
   * wait for exactly this reason — a person re-states after what they just saw.
   */
  it('is discharged by an arrival at the same instant, which is what >= means', async () => {
    const repos = createRepositories(prisma)
    const writer = createExternalWriter(prisma)

    const project = await prisma.project.create({ data: { name: 'boundary' } })
    const intention = await prisma.intention.create({
      data: { projectId: project.id, objective: 'o', definitionOfDone: 'd' },
    })

    const instant = new Date()
    await repos.intentions.stateWait(intention.id, 'something', instant)
    await writer.append({
      statedBy: 'declared',
      kind: 'arrived',
      occurredAt: instant,
      elapsedMs: 0,
      intentionId: intention.id,
    })

    const facts = await repos.intentions.factsForProject(project.id)
    expect(facts?.waitDischarged).toBe(true)
    expect(facts?.waitDischargedAt?.getTime()).toBe(instant.getTime())

    // One millisecond earlier and it does not, which is the half the fixture
    // depends on.
    const later = new Date(instant.getTime() + 1)
    await repos.intentions.stateWait(intention.id, 'something else', later)
    const after = await repos.intentions.factsForProject(project.id)
    expect(after?.waitDischarged).toBe(false)
    expect(after?.waitDischargedAt).toBeNull()
  })

  /**
   * The half ADR-0035 calls the sharpest hole if it is missing: a wait a person
   * cannot take back would hold a slot on the front door for ever.
   */
  it('is cleared by a person, and clearing takes the moment with it', async () => {
    const repos = createRepositories(prisma)

    const project = await prisma.project.create({ data: { name: 'clearing' } })
    const intention = await prisma.intention.create({
      data: { projectId: project.id, objective: 'o', definitionOfDone: 'd' },
    })

    await repos.intentions.stateWait(intention.id, 'something')
    await repos.intentions.stateWait(intention.id, null)

    const facts = await repos.intentions.factsForProject(project.id)
    expect(facts?.statedWait).toBeNull()
    expect(facts?.waitDischarged).toBe(false)

    const row = await prisma.intention.findUnique({
      where: { id: intention.id },
      select: { statedWaitAt: true },
    })
    expect(row?.statedWaitAt, 'a moment with no wait is a fact about nothing').toBeNull()
  })
})
