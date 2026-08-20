/**
 * A comparison afternoon, from the buffer to a `collection` on the re-entry
 * screen. ADR-0018, slice 1.
 *
 * ── Why this file exists, and what it refuses to assume ──────────────────
 *
 * ADR-0018 admits comparison shapes deliberately: `compared-options` moves the
 * shopping and rent-portal afternoons from *residual false positive* to
 * *target*. That is only worth anything if what a person gets at the end of one
 * is a thing Propositum can actually produce. Two halves of that path were
 * already built and neither had ever been driven from the other:
 *
 *   - `OutcomeProposal` kind `item` → `src/server/outcomes/collection.ts` →
 *     one `collection` `ShiftOutcome`. `tests/outcomes.test.ts` pins how a
 *     collection RENDERS, from a hand-written production.
 *   - `groundsFor` → `composeOffer` → a `WorkOffer` whose `expects` came off
 *     the offer boundary. `tests/compose-offer.test.ts` pins that, from a
 *     hand-built thread.
 *
 * Nothing joined them, so "a comparison run produces a collection" was an
 * inference from two green files rather than a fact. This is the fact. It
 * starts at the committed capture of a comparison afternoon — the same rows
 * `/api/capture/ambient` accepted — and ends at a row in SQLite that
 * `readOutcomeDetail` can render.
 *
 * ── What is real here and what is scripted ───────────────────────────────
 *
 * Real: the ambient buffer, `detectWork`, `groundsFor`, `composeOffer`'s gate
 * and its projection of the boundary's `outcomeKinds`, the contract, the run,
 * `recordOutcomes`, the database, and the reader.
 *
 * Scripted: the two model calls. `FakeModelClient` answers the offer boundary
 * and the worker loop, because a model deciding what to collect is not what is
 * under test and a live call would make this file cost money. What the model
 * says is checked against the closed set in code either way — the offer's
 * `expects` is `outcomeKindsOf(...)`, not the model's string.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../src/persistence/client'
import type { Database } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'
import { createLedgerWriter } from '../src/persistence/ledger-writer'
import { recordOutcomes } from '../src/server/outcomes/index'
import { loadWorkspace } from '../src/server/outcomes/workspace'
import { readOutcomeDetail } from '../src/domain/outcome/shift-outcome'
import { FakeModelClient } from '../src/model/fake'
import type { ScriptedReply } from '../src/model/fake'
import { composeOffer } from '../src/server/compose-offer'
import { createAmbientStore, signatureOf } from '../src/server/ambient-store'
import type { NamedThread } from '../src/server/ambient-store'
import { detectWork, threadPagesOf } from '../src/domain/detection/detect'
import { groundsFor } from '../src/domain/detection/grounds'
import { loadAfternoon } from '../src/fixtures/afternoon'
import type { AppContext } from '../src/server/db'

// `revalidatePath` needs a request store that does not exist in a test process.
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

/** The committed capture. Its own `note` says what it is and that nobody
 *  browsed it; `tests/afternoon-capture.test.ts` holds it to its description. */
const COMPARING = 'comparing-monitors-synthesised'

let dir: string
let db: Database
let repos: Repositories
let ctx: AppContext
let projectId: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-comparison-'))
  const url = `file:${join(dir, 'test.db')}`
  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })
  db = await createDatabase({ url })
  repos = createRepositories(db.prisma)
  ctx = { db, repos, ledger: createLedgerWriter(db.prisma) }
  projectId = (await repos.projects.create('monitors')).id
}, 120_000)

afterAll(async () => {
  await db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * What the offer boundary is scripted to return.
 *
 * `phone-a-friend` is in the list on purpose: it is not one of the five kinds,
 * and the closed set is applied in code rather than by trusting the model. The
 * assertion below is that it fell out, which is the same property
 * `tests/compose-offer.test.ts` pins and the one that decides whether this
 * whole path can be steered by prose.
 */
const OFFER = {
  title: 'Put the monitors you have been looking at in one table',
  rationale: 'You read ten of them across three shops and went back to one.',
  outline: ['Read the specifications off each page', 'Line them up', 'Mark the ones with a hub'],
  produces: 'One table of the monitors, with price, size and ports',
  excludes: ['Buy anything', 'Write to any of the shops'],
  outcomeKinds: ['collection', 'phone-a-friend'],
  confident: true,
}

describe('a comparison afternoon reaches an offer that expects a collection', () => {
  it('clears the grounds bar on compared-options and asks for a collection', async () => {
    const afternoon = loadAfternoon(COMPARING)
    const store = createAmbientStore()
    for (const observation of afternoon.observations) store.record(observation, observation.at)

    const detected = detectWork(store.since(afternoon.now), afternoon.now)
    expect(detected, 'the committed capture stopped detecting as work').not.toBeNull()

    const grounds = groundsFor(
      detected!,
      threadPagesOf(store.since(afternoon.now), detected!, afternoon.now),
    )

    // The bar, and the ground that carries it. Named rather than implied,
    // because an offer composed for some other reason would prove nothing about
    // comparison afternoons.
    expect(grounds.kinds).toContain('compared-options')
    expect(grounds.sufficient).toBe(true)

    const named: NamedThread = {
      signature: signatureOf(detected!.terms),
      subject: '27 inch monitors',
      confident: true,
    }

    const model = new FakeModelClient([{ kind: 'ok', value: OFFER } as ScriptedReply<unknown>])
    await composeOffer(store, model, detected!, named, afternoon.now)

    const offer = store.offerFor(named.signature)
    expect(offer?.title).toBe(OFFER.title)
    // The closed set is applied in code: the invented kind is dropped rather
    // than mapped to whichever of the five it resembles.
    expect(offer?.expects).toEqual(['collection'])
    // And the grounds ride onto the offer, so the durable row can answer "why
    // did it ask me this" after the buffer is gone.
    expect(offer?.grounds.kinds).toContain('compared-options')
  })
})

describe('a run for that offer writes a collection', () => {
  /**
   * A contract of the shape an accepted comparison offer produces: nothing to
   * write into, so `baseVersionId` is null and the gate refuses the document
   * capabilities. `output: 'collect-items'` is the dial ADR-0009 gives a
   * collection offer.
   */
  async function acceptedContract() {
    const sessionId = (await repos.sessions.start(projectId)).id
    const reading = await repos.readings.create({
      sessionId,
      throughSeq: 0,
      claims: [{ kind: 'objective', text: 'Compare the monitors.', ordinal: 0, evidence: [] }],
    })

    const contract = await repos.contracts.createDraft({
      sessionId,
      readingId: reading.id,
      objective: 'Compare the monitors.',
      definitionOfDone: 'One table of the monitors with price, size and ports.',
      guidance: [],
      approvedSourceIds: [],
      allowedActionKinds: ['read-document'],
      baseVersionId: null,
      initiative: 'use-judgment',
      progress: 'remaining-plan',
      output: 'collect-items',
      interruption: 'stop-only-when-blocked',
      timeLimitMinutes: 30,
    })
    await repos.contracts.accept(contract.id, new Date())

    return contract.id
  }

  it('turns three items into one collection a person can read', async () => {
    const contractId = await acceptedContract()
    const contract = await repos.contracts.byId(contractId)
    if (!contract) throw new Error('no contract')

    const enqueued = await repos.runs.enqueue({ contractId, role: 'worker' })

    /**
     * The productions a comparison run makes. One `item` per monitor, which is
     * the shape `collection.ts` groups — *"eleven shipping rates are one thing a
     * person came back to, not eleven things"*, and three monitors are one
     * shortlist rather than three outcomes.
     */
    await recordOutcomes(ctx, {
      run: { id: enqueued.id },
      contract: { id: contractId },
      workspace: await loadWorkspace(ctx, contract),
      produced: [
        {
          kind: 'item',
          intentId: 'a',
          label: 'Aurora 27',
          fields: { price: '£329', ports: 'USB-C hub' },
        },
        {
          kind: 'item',
          intentId: 'b',
          label: 'Meridian 27',
          fields: { price: '£299', ports: 'HDMI only' },
        },
        {
          kind: 'item',
          intentId: 'c',
          label: 'Calder 27',
          fields: { price: '£355', ports: 'USB-C hub' },
        },
      ],
    })

    const written = await repos.outcomes.forRun(enqueued.id)

    // ONE outcome for three items, which is the grouping decision rather than a
    // shortcut: three separate outcomes each headlined "a monitor" is the shape
    // that makes somebody press Accept all.
    expect(written).toHaveLength(1)
    expect(written[0]?.kind).toBe('collection')

    // Held. Nothing left Propositum, so the person's accept or reject still
    // decides — which is the whole promise a comparison offer makes.
    expect(written[0]?.reversibility).toBe('held')

    // And the reader can render it. A card that arrives blank below the headline
    // fails nothing on its own, which is why the writer is checked against the
    // reader directly rather than against a shape written here.
    const detail = readOutcomeDetail(written[0]!.detail)
    expect(detail?.items).toEqual([
      'Aurora 27 — price: £329 · ports: USB-C hub',
      'Meridian 27 — price: £299 · ports: HDMI only',
      'Calder 27 — price: £355 · ports: USB-C hub',
    ])
  })
})
