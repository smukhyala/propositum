# Offer Reticence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember that a person declined a strand, so repeated "Not now" makes Propositum quieter about that strand — and never louder about anything.

**Architecture:** A `OfferReticence` row per declined strand, keyed by a salted SHA-256 of the thread signature so no readable subject is stored. The count raises `INVESTMENT_REQUIRED` for that strand only, inside the existing pure `groundsFor`; the impure lookup stays at the edge in the poll route. Accepting deletes the row (a person acting is the only thing allowed to lower a bar), and rows decay after 30 days. When reticence holds something back, the front door says so and offers to show it anyway.

**Tech Stack:** TypeScript strict, Prisma + SQLite, Vitest, Next 16 App Router, Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-08-22-offer-reticence-design.md`

## Global Constraints

- **Narrow only.** No code path may make `sufficient` true where it would have been false without reticence. Enforced by a property test in Task 5, not by the shape of an expression.
- **A date, never an instant.** Every durable value here is a `YYYY-MM-DD` day bucket from `dayBucket()` in `src/server/offer-tally.ts`. `OfferTally`'s `updatedAt` was deleted the day it landed for exactly this reason.
- **No column a subject could go in.** `offer_reticence` has no `signature`, `origin`, `title`, `subject` or `url` column, and a test asserts the column list.
- **CONTEXT.md governs every UI string.** Banned in UI copy: _copy, patch, hunk, diff chunk, changeset, anchor, offset, fold, materialise, base version, commit, merge, ledger entry, agent run, job, orchestration, allowlist_. The word _confidence_ never appears in UI copy. Four verbs stay distinct: the gate **refuses** · the human **rejects** · the model **declines** · the human **confirms**.
- **ADR-0020 must exist before Task 5 lands.** Tasks 1–4 store data and change no behaviour; Task 5 is the policy and needs the argument written down first. Task 6 writes it — **do Task 6 before Task 5 if executing strictly in order is inconvenient**, but never land Task 5 without it.
- **Task 5 is one commit.** The policy and the front-door line ship together. The policy alone is the §15 violation.
- **Formatting:** run `npx prettier --write <the files you touched>` before committing. CI does not check formatting; the repo formats files as they are edited.
- **Tests needing a database** create a throwaway one — see the `beforeAll` in `tests/append-only.test.ts`. `tests/support/no-real-database.ts` points the default `DATABASE_URL` at a nonexistent path on purpose.

---

### Task 1: The salt and the hash

**Files:**

- Create: `src/domain/detection/reticence.ts`
- Create: `tests/reticence.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `hashSignature(signature: string, salt: string): string` · `installSalt(store: SaltStore): Promise<string>` · `interface SaltStore { read(): Promise<string | null>; write(salt: string): Promise<void> }`

- [ ] **Step 1: Write the failing test**

Create `tests/reticence.test.ts`:

```ts
/**
 * The hash, and the one thing it must never do.
 *
 * A signature is readable terms — `forecast+kauai+south+weather` — and the
 * whole reason this file exists is that those terms must not reach a durable
 * row. The assertion that matters is the third one: no fragment of the input
 * survives into the output.
 */
import { describe, expect, it } from 'vitest'

import { hashSignature, installSalt } from '../src/domain/detection/reticence'
import type { SaltStore } from '../src/domain/detection/reticence'

const SALT = 'a'.repeat(64)

describe('hashing a thread signature', () => {
  it('is stable for the same signature and salt', () => {
    expect(hashSignature('forecast+kauai', SALT)).toBe(hashSignature('forecast+kauai', SALT))
  })

  it('differs when the salt differs, so two installs never match', () => {
    expect(hashSignature('forecast+kauai', SALT)).not.toBe(
      hashSignature('forecast+kauai', 'b'.repeat(64)),
    )
  })

  it('carries no fragment of the terms it was made from', () => {
    const hashed = hashSignature('forecast+kauai+south+weather', SALT)

    for (const term of ['forecast', 'kauai', 'south', 'weather']) {
      expect(hashed).not.toContain(term)
    }
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the install salt', () => {
  function store(initial: string | null): SaltStore & { written: string[] } {
    const written: string[] = []
    let held = initial
    return {
      written,
      read: async () => held,
      write: async (salt) => {
        written.push(salt)
        held = salt
      },
    }
  }

  it('generates one on first use and keeps it', async () => {
    const s = store(null)

    const first = await installSalt(s)
    const second = await installSalt(s)

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
    // Written once. A salt that rotated would orphan every row silently.
    expect(s.written).toHaveLength(1)
  })

  it('never overwrites one that already exists', async () => {
    const s = store(SALT)

    expect(await installSalt(s)).toBe(SALT)
    expect(s.written).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reticence.test.ts`
Expected: FAIL — `Cannot find module '../src/domain/detection/reticence'`

- [ ] **Step 3: Write the implementation**

Create `src/domain/detection/reticence.ts`:

```ts
/**
 * Turning a thread signature into something durable that is not a subject.
 *
 * ── What this buys, and what it does not ─────────────────────────────────
 *
 * `src/server/ambient-store.ts` refuses, in writing, "a durable row saying
 * 'Propositum thought you were job-hunting' about an offer NOBODY ACCEPTED".
 * A signature is readable terms, so storing one is that row. This makes the
 * stored value unreadable and non-portable between installs.
 *
 * It does NOT make it unguessable. The salt lives in the same SQLite file as
 * the rows, so anyone holding the database can hash a candidate signature and
 * compare — and the space of plausible signatures is small enough for a
 * candidate list to be worth trying. What is bought is that no process, log
 * line or backup ever contains the terms in readable form. That is a real
 * improvement over plaintext and it is not anonymity, and ADR-0020 says so in
 * the same words rather than letting "hash" imply the stronger claim.
 */

import { createHash, randomBytes } from 'node:crypto'

/** Where the install's salt lives. A row, in this product; the indirection is
 *  here so the hashing is testable without a database. */
export interface SaltStore {
  read(): Promise<string | null>
  write(salt: string): Promise<void>
}

/**
 * The salt for this install, made once and never rotated.
 *
 * Rotating it would silently orphan every existing row — the same signature
 * would hash to something new, every count would read as zero, and nothing
 * would fail. So the only write is the first one.
 */
export async function installSalt(store: SaltStore): Promise<string> {
  const existing = await store.read()
  if (existing !== null) return existing

  const fresh = randomBytes(32).toString('hex')
  await store.write(fresh)
  return fresh
}

/** Salt first, so the input cannot be extended onto a known prefix. */
export function hashSignature(signature: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${signature}`).digest('hex')
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/reticence.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck, format and commit**

```bash
npm run typecheck
npx prettier --write src/domain/detection/reticence.ts tests/reticence.test.ts
git add src/domain/detection/reticence.ts tests/reticence.test.ts
git commit -m "feat: salted hashing for thread signatures"
```

---

### Task 2: The table and the repository

**Files:**

- Modify: `prisma/schema.prisma` (append two models at the end)
- Modify: `src/persistence/repositories/index.ts` (interface at ~line 83, registration at ~line 106, factory beside `offerTallyRepository` at ~line 2972)
- Create: `tests/reticence-store.test.ts`

**Interfaces:**

- Consumes: `hashSignature`, `installSalt`, `SaltStore` from Task 1.
- Produces: `repos.reticence`, an `OfferReticenceRepository` with `salt(): Promise<string>` · `declinesFor(hashes: readonly string[]): Promise<ReadonlyMap<string, number>>` · `record(hash: string, day: string): Promise<void>` · `clear(hash: string): Promise<void>` · `sweepDeclinedBefore(day: string): Promise<number>`

- [ ] **Step 1: Write the failing test**

Create `tests/reticence-store.test.ts`:

```ts
/**
 * The row, and the columns it must not have.
 *
 * The column-list assertion is the important one and it is the same shape
 * `tests/eval.test.ts` uses for `OfferTally`: "no column a subject could go in"
 * is checkable rather than promised, and a migration that adds one turns this
 * red.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createRepositories } from '../src/persistence/repositories/index'
import type { Repositories } from '../src/persistence/repositories/index'

let dir: string
let prisma: PrismaClient
let repos: Repositories

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'propositum-reticence-'))
  const url = `file:${join(dir, 'test.db')}`

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  })

  prisma = new PrismaClient({ datasources: { db: { url } } })
  repos = createRepositories(prisma)
}, 120_000)

afterAll(async () => {
  await prisma?.$disconnect()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('the reticence table', () => {
  it('holds four columns and none of them could carry a subject', async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM pragma_table_info('offer_reticence')`,
    )
    const names = columns.map((c) => c.name).sort()

    expect(names).toEqual(['declines', 'lastDeclinedOn', 'signatureHash'])
  })

  it('counts declines against one hash and leaves others alone', async () => {
    await repos.reticence.record('hash-a', '2026-08-22')
    await repos.reticence.record('hash-a', '2026-08-23')
    await repos.reticence.record('hash-b', '2026-08-23')

    const found = await repos.reticence.declinesFor(['hash-a', 'hash-b', 'hash-c'])

    expect(found.get('hash-a')).toBe(2)
    expect(found.get('hash-b')).toBe(1)
    // Absent, not zero — the caller decides what "never declined" means.
    expect(found.has('hash-c')).toBe(false)
  })

  it('forgets a hash entirely when it is cleared', async () => {
    await repos.reticence.record('hash-cleared', '2026-08-22')
    await repos.reticence.clear('hash-cleared')

    const found = await repos.reticence.declinesFor(['hash-cleared'])
    expect(found.has('hash-cleared')).toBe(false)
  })

  it('sweeps rows last declined before a day and keeps the rest', async () => {
    await repos.reticence.record('hash-old', '2026-07-01')
    await repos.reticence.record('hash-new', '2026-08-22')

    const deleted = await repos.reticence.sweepDeclinedBefore('2026-08-01')

    expect(deleted).toBe(1)
    const found = await repos.reticence.declinesFor(['hash-old', 'hash-new'])
    expect(found.has('hash-old')).toBe(false)
    expect(found.get('hash-new')).toBe(1)
  })

  it('returns one salt and the same salt every time', async () => {
    const first = await repos.reticence.salt()
    const second = await repos.reticence.salt()

    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(second).toBe(first)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reticence-store.test.ts`
Expected: FAIL — `offer_reticence` has no columns, and `repos.reticence` is undefined.

- [ ] **Step 3: Add the two models**

Append to `prisma/schema.prisma`:

```prisma
/// One secret per install, made once and never rotated.
///
/// Exists only to salt `OfferReticence.signatureHash`. It is in the same file
/// as the rows it salts, which bounds what the hashing can claim — see
/// `src/domain/detection/reticence.ts` and ADR-0020, both of which say so rather than
/// letting the word "hash" imply more.
model InstallSecret {
  /// Always `salt`. One row, enforced by the primary key rather than by a check.
  name  String @id
  value String

  @@map("install_secret")
}

/// How often a strand has been turned down, without recording which strand.
///
/// `src/server/ambient-store.ts` refuses a durable row naming a subject nobody
/// accepted. This is the narrowest thing that answers "have they said no to
/// this before" without being that row: a salted hash, a count, and a day.
///
/// There is deliberately NO column a subject could go in — no signature, no
/// origin, no title, no url — and `tests/reticence-store.test.ts` asserts the
/// column list rather than trusting this comment.
model OfferReticence {
  /// sha256(salt + ':' + signature), hex. Never the terms themselves.
  signatureHash String @id
  /// How many times a strand hashing to this has been declined.
  declines      Int    @default(0)
  /// The local calendar day of the most recent decline, `YYYY-MM-DD`.
  ///
  /// A DATE, never an instant, and for the reason `OfferTally.updatedAt` was
  /// deleted the day it landed: a millisecond timestamp here would be a durable
  /// per-day record of roughly when this person stopped browsing.
  lastDeclinedOn String

  @@map("offer_reticence")
}
```

- [ ] **Step 4: Add the repository**

In `src/persistence/repositories/index.ts`, add to the `Repositories` interface beside `readonly offerTally: OfferTallyRepository`:

```ts
  readonly reticence: OfferReticenceRepository
```

Add to the object `createRepositories` returns, beside `offerTally: offerTallyRepository(prisma),`:

```ts
    reticence: offerReticenceRepository(prisma),
```

Add beside `offerTallyRepository`:

```ts
/**
 * Declines, per hashed strand.
 *
 * `declinesFor` takes a batch because the caller has a page of strands and one
 * query is one round trip. A hash that has never been declined is ABSENT from
 * the map rather than present as zero: the difference is what lets the caller
 * treat "no row" and "a row reading 0" as the same thing without either of them
 * meaning something it does not.
 */
export interface OfferReticenceRepository {
  /** This install's salt, made on first call. */
  salt(): Promise<string>
  declinesFor(hashes: readonly string[]): Promise<ReadonlyMap<string, number>>
  record(hash: string, day: string): Promise<void>
  clear(hash: string): Promise<void>
  /** Rows whose last decline is strictly before `day`. Returns how many went. */
  sweepDeclinedBefore(day: string): Promise<number>
}

function offerReticenceRepository(prisma: PrismaClient): OfferReticenceRepository {
  return {
    salt: () =>
      installSalt({
        read: async () => {
          const row = await prisma.installSecret.findUnique({ where: { name: 'salt' } })
          return row?.value ?? null
        },
        write: async (value) => {
          // `create` would throw on the second caller in a race. One local user
          // makes that unlikely and an upsert makes it impossible, and the cost
          // is a word.
          await prisma.installSecret.upsert({
            where: { name: 'salt' },
            create: { name: 'salt', value },
            update: {},
          })
        },
      }),

    declinesFor: async (hashes) => {
      if (hashes.length === 0) return new Map()

      const rows = await prisma.offerReticence.findMany({
        where: { signatureHash: { in: [...hashes] } },
        select: { signatureHash: true, declines: true },
      })

      return new Map(rows.map((row) => [row.signatureHash, row.declines]))
    },

    record: async (hash, day) => {
      await prisma.offerReticence.upsert({
        where: { signatureHash: hash },
        create: { signatureHash: hash, declines: 1, lastDeclinedOn: day },
        update: { declines: { increment: 1 }, lastDeclinedOn: day },
      })
    },

    clear: async (hash) => {
      await prisma.offerReticence.deleteMany({ where: { signatureHash: hash } })
    },

    sweepDeclinedBefore: async (day) => {
      // `YYYY-MM-DD` sorts lexicographically in the same order it sorts
      // chronologically, which is the whole reason the column is that shape and
      // not an epoch. A string comparison IS a date comparison here.
      const result = await prisma.offerReticence.deleteMany({
        where: { lastDeclinedOn: { lt: day } },
      })
      return result.count
    },
  }
}
```

Add the import at the top of the file, beside the other `../../server` imports:

```ts
import { installSalt } from '../../domain/detection/reticence'
```

- [ ] **Step 5: Regenerate the client and run the test**

```bash
npm run db:generate
npx vitest run tests/reticence-store.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Push the schema to the working database**

```bash
npx prisma db push
```

Expected: the two new tables are created. **Restart the app afterwards** — `prisma db push` silently drops the append-only triggers and they are reinstalled and verified at the next startup.

- [ ] **Step 7: Full suite, format and commit**

```bash
npm run typecheck
npm test
npx prettier --write prisma/schema.prisma src/persistence/repositories/index.ts tests/reticence-store.test.ts
git add prisma/schema.prisma src/persistence/repositories/index.ts tests/reticence-store.test.ts
git commit -m "feat: offer_reticence table and repository"
```

---

### Task 3: Record a decline, clear on accept

**Files:**

- Modify: `src/server/actions.ts` — `declineThreadOffer` (~line 1973, after `ambient.declineThread(...)`), `acceptWorkOffer` (~line 1524), `startFromSuggestion` (~line 979)
- Create: `tests/reticence-writer.test.ts`

**Interfaces:**

- Consumes: `repos.reticence` from Task 2, `hashSignature` from Task 1, `dayBucket` from `src/server/offer-tally.ts`, `signatureOf` (already imported in `actions.ts`).
- Produces: nothing new. This task only writes rows.

- [ ] **Step 1: Write the failing test**

Create `tests/reticence-writer.test.ts`:

```ts
/**
 * What the decline path is allowed to hand the store.
 *
 * A source-text guard, in the shape `tests/calendar-scope.test.ts` argues for:
 * the property is "no readable subject reaches this sink", and no runtime
 * assertion can see a future call site that passes one. So the call is pinned.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hashSignature } from '../src/domain/detection/reticence'

const actions = readFileSync(
  fileURLToPath(new URL('../src/server/actions.ts', import.meta.url)),
  'utf8',
)

describe('the decline path records a hash and never a signature', () => {
  it('passes a hashSignature call to record, not the signature', () => {
    expect(actions).toMatch(/reticence\.record\(\s*hashSignature\(/)
  })

  it('never hands the store a bare signature or origin', () => {
    // The three shapes that would put a subject in the row.
    expect(actions).not.toMatch(/reticence\.record\(\s*thread\b/)
    expect(actions).not.toMatch(/reticence\.record\(\s*signature\b/)
    expect(actions).not.toMatch(/reticence\.record\(\s*origin\b/)
  })

  it('clears on accept, which is the only thing that lowers a bar', () => {
    expect(actions).toMatch(/reticence\.clear\(\s*hashSignature\(/)
  })
})

describe('the hash used by the writer', () => {
  it('is the one the reader will compute', () => {
    // Both sides call the same function with the same argument order, so a
    // change to either is a change to both. Stated as a test because a second
    // spelling of the same hash is the failure that would leave every count
    // silently zero.
    const salt = 'c'.repeat(64)
    expect(hashSignature('a+b', salt)).toBe(hashSignature('a+b', salt))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reticence-writer.test.ts`
Expected: FAIL — no `reticence.record(` in `actions.ts`.

- [ ] **Step 3: Record the decline**

In `src/server/actions.ts`, add to the imports:

```ts
import { hashSignature } from '../domain/detection/reticence'
```

`dayBucket` is already exported from `./offer-tally`; add it to that existing import if it is not there.

In `declineThreadOffer`, immediately after `ambient.declineThread(thread, urls, now)`:

```ts
/**
 * And the durable half, which the snooze above is not.
 *
 * `declineThread` snoozes this signature for an hour and forgets it with
 * the buffer, so a person who declines the same strand every evening is
 * asked again every evening and the product learns nothing. This is that,
 * remembered — as a salted hash, a count and a day, and never the terms.
 *
 * ADR-0020 carries the argument, including what the hash does not buy.
 */
const { repos } = await appContext()
await repos.reticence.record(hashSignature(thread, await repos.reticence.salt()), dayBucket(now))
```

- [ ] **Step 4: Clear on accept**

In `acceptWorkOffer`, after the offer is accepted and the session created — beside the existing `repos.intentions.create` call — add:

```ts
/**
 * Accepting forgets every decline of this strand.
 *
 * The only thing permitted to lower a bar is a person acting, and this is
 * that act. It also keeps reticence from being a ratchet: a subject you
 * turned down four times and then took up is not one Propositum should stay
 * quiet about.
 */
await repos.reticence.clear(hashSignature(thread, await repos.reticence.salt()))
```

Add the same two lines to `startFromSuggestion`, using whatever local variable holds the thread signature there — it is the same value `signatureOf(detected.terms)` produces.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/reticence-writer.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full suite, format and commit**

```bash
npm run typecheck
npm test
npx prettier --write src/server/actions.ts tests/reticence-writer.test.ts
git add src/server/actions.ts tests/reticence-writer.test.ts
git commit -m "feat: record declines and clear them on accept"
```

---

### Task 4: The thirty-day sweep

**Files:**

- Create: `src/server/reticence-sweep.ts`
- Create: `tests/reticence-sweep.test.ts`
- Modify: `scripts/worker.ts` (inside `sweepEvidence`, ~line 80)

**Interfaces:**

- Consumes: `repos.reticence.sweepDeclinedBefore` from Task 2, `dayBucket` from `src/server/offer-tally.ts`.
- Produces: `sweepReticence(deps: ReticenceSweepDeps): Promise<{ deleted: number }>` · `RETICENCE_RETENTION_DAYS = 30` · `interface ReticenceSweepDeps { reticence: Pick<OfferReticenceRepository, 'sweepDeclinedBefore'>; now: () => Date }`

- [ ] **Step 1: Write the failing test**

Create `tests/reticence-sweep.test.ts`:

```ts
/**
 * A retention promise that nothing runs is the kind that quietly stops being
 * true, so the cutoff is computed here and asserted rather than described.
 */
import { describe, expect, it } from 'vitest'

import { RETICENCE_RETENTION_DAYS, sweepReticence } from '../src/server/reticence-sweep'

function deps(now: string) {
  const asked: string[] = []
  return {
    asked,
    reticence: {
      sweepDeclinedBefore: async (day: string) => {
        asked.push(day)
        return 3
      },
    },
    now: () => new Date(now),
  }
}

describe('the reticence sweep', () => {
  it('asks for everything last declined before thirty days ago', async () => {
    const d = deps('2026-08-22T12:00:00')

    const result = await sweepReticence(d)

    expect(RETICENCE_RETENTION_DAYS).toBe(30)
    // 2026-08-22 minus 30 days.
    expect(d.asked).toEqual(['2026-07-23'])
    expect(result.deleted).toBe(3)
  })

  it('uses a day bucket, so the cutoff carries no time of day', async () => {
    const morning = deps('2026-08-22T01:00:00')
    const evening = deps('2026-08-22T23:00:00')

    await sweepReticence(morning)
    await sweepReticence(evening)

    // Same day in, same cutoff out. A sweep whose boundary moved with the clock
    // would make retention depend on when the worker happened to start.
    expect(morning.asked).toEqual(evening.asked)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reticence-sweep.test.ts`
Expected: FAIL — `Cannot find module '../src/server/reticence-sweep'`

- [ ] **Step 3: Write the sweep**

Create `src/server/reticence-sweep.ts`:

```ts
/**
 * Reticence decays, and this is what makes that true rather than intended.
 *
 * A person who stopped caring about a subject a month ago should not still be
 * paying for having said no to it, and a reticence that only ever accumulates
 * would eventually silence the product one strand at a time. Thirty days is
 * chosen to be longer than a piece of work and shorter than a habit.
 *
 * Lives beside `sweepActionEvidence` in the worker for the reason that file
 * already argues: the worker is the only long-lived process Propositum owns,
 * and retention that runs only on a machine that restarts is the worst shape a
 * retention promise can take.
 */

import { dayBucket } from './offer-tally'
import type { OfferReticenceRepository } from '../persistence/repositories/index'

export const RETICENCE_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60_000

export interface ReticenceSweepDeps {
  readonly reticence: Pick<OfferReticenceRepository, 'sweepDeclinedBefore'>
  readonly now: () => Date
}

export async function sweepReticence(deps: ReticenceSweepDeps): Promise<{ deleted: number }> {
  const cutoff = dayBucket(deps.now().getTime() - RETICENCE_RETENTION_DAYS * DAY_MS)

  return { deleted: await deps.reticence.sweepDeclinedBefore(cutoff) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/reticence-sweep.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Wire it into the worker**

In `scripts/worker.ts`, add the import beside the other `src/server` imports:

```ts
import { sweepReticence } from '../src/server/reticence-sweep'
```

Inside `sweepEvidence`, after the existing `sweepActionEvidence` block and still inside the same `try`:

```ts
const reticence = await sweepReticence({ reticence: ctx.repos.reticence, now: () => new Date() })
if (reticence.deleted > 0) {
  console.log(`[worker] forgot ${reticence.deleted} stale decline(s)`)
}
```

- [ ] **Step 6: Full suite, format and commit**

```bash
npm run typecheck
npm test
npx prettier --write src/server/reticence-sweep.ts tests/reticence-sweep.test.ts scripts/worker.ts
git add src/server/reticence-sweep.ts tests/reticence-sweep.test.ts scripts/worker.ts
git commit -m "feat: forget declines after thirty days"
```

---

### Task 5: The policy and the line — ONE COMMIT

> **Do not split this task.** The policy without the visible line is what §15 forbids: "a default computed from past behaviour and applied without being shown." A sequence where the policy lands first and the interface follows is that violation with a plan attached. ADR-0020 (Task 6) must already exist.

**Files:**

- Modify: `src/domain/detection/grounds.ts` — `groundsFor` at line 1200, the `sufficient` expression at line 1278
- Modify: `src/server/compose-offer.ts` — signature at line 239, the `groundsFor` call at line 267
- Modify: `src/app/api/session/current/route.ts` — the `composeOffer` call at line 333
- Modify: `src/server/front-door.ts` — `noticedAfternoon` at line 276
- Modify: `src/app/page.tsx` — the front-door render
- Modify: `tests/grounds.test.ts` — the property test goes here, where `groundsFor`'s builders already live
- Modify: `tests/reachability.test.ts` — add the held-back assertion

**Interfaces:**

- Consumes: `repos.reticence.declinesFor` from Task 2, `hashSignature` from Task 1.
- Produces: `groundsFor(detected, pages, declines?)` · `composeOffer(store, model, detected, named, nowMs?, declines?)` · `noticedAfternoon(store, observations, nowMs, reticent?)` returning `{ shown, suppressed, heldBack }`

- [ ] **Step 1: Write the failing test**

Append to `tests/grounds.test.ts`, which already owns `groundsFor` and has the `page()` and
`detected()` builders this needs. Do not create a new file — the builders are local to that one and
copying them is how two spellings of a fixture start to disagree.

The page set below is lifted verbatim from that file's existing case _"one intent ground and two
investment grounds is enough"_ (around line 846). That is the right strand to test on because it
sits **exactly on** the bar: two investment axes against `INVESTMENT_REQUIRED = 2`. One decline
must therefore tip it from sufficient to not, which is the smallest observable version of the whole
policy.

```ts
describe('reticence only ever narrows', () => {
  /** The strand from "one intent ground and two investment grounds is enough" —
   *  sufficient at exactly the bar, so one decline is visible. */
  function onTheBar() {
    const pages = [
      page({
        url: 'https://a.example/1',
        engagedMs: DEEP_READ_MS,
        ...returnedFromElsewhere(),
        at: T0,
      }),
      page({ url: 'https://b.example/1', at: T0 + MINUTE }),
      page({ url: 'https://c.example/1', at: T0 + 2 * MINUTE }),
    ]
    return { detected: detected(SUBJECT, pages), pages }
  }

  function sufficientAt(declines: number): boolean {
    const { detected: d, pages } = onTheBar()
    return groundsFor(d, pages, declines).sufficient
  }

  it('admits a strand nobody has declined', () => {
    expect(sufficientAt(0)).toBe(true)
  })

  it('refuses the same strand once it has been declined', () => {
    // Two axes was enough; three is now required. This is the policy, in one
    // assertion, on the smallest strand that can show it.
    expect(sufficientAt(1)).toBe(false)
  })

  it('never admits at a higher decline count what it refused at a lower one', () => {
    let previous = true

    for (const declines of [0, 1, 2, 3, 10, 100]) {
      const now = sufficientAt(declines)
      // Monotonic: more declines can only ever take admission away.
      if (!previous) expect(now).toBe(false)
      previous = now
    }
  })

  it('cannot be widened by a negative or absurd count', () => {
    // A caller passing -5 must not buy a LOWER bar than one passing 0. The
    // clamp in `groundsFor` is the only thing making this true, and this is
    // what fails if somebody simplifies it away.
    expect(sufficientAt(-5)).toBe(sufficientAt(0))
    expect(sufficientAt(Number.NEGATIVE_INFINITY)).toBe(sufficientAt(0))
  })

  it('defaults to today’s behaviour when the caller says nothing', () => {
    const { detected: d, pages } = onTheBar()

    expect(groundsFor(d, pages).sufficient).toBe(groundsFor(d, pages, 0).sufficient)
  })

  it('leaves the published floor where it is', () => {
    // Cited by name in grounds.ts's own prose and in ADR-0018.
    expect(INVESTMENT_REQUIRED).toBe(2)
  })
})
```

`INVESTMENT_REQUIRED` may need adding to that file's existing import from
`../src/domain/detection/grounds`; `DEEP_READ_MS`, `MINUTE`, `T0`, `SUBJECT`, `page`,
`detected` and `returnedFromElsewhere` are all already in scope there.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/grounds.test.ts`
Expected: FAIL — `groundsFor` takes two arguments, so `sufficientAt(1)` returns `true`.

- [ ] **Step 3: Raise the bar in `groundsFor`**

In `src/domain/detection/grounds.ts`, change the signature at line 1200:

```ts
export function groundsFor(
  detected: WorkDetected,
  pages: readonly ThreadPage[],
  /**
   * How many times this strand has been declined before.
   *
   * Optional and last, so every existing caller keeps today's behaviour and a
   * caller that forgets it gets the floor rather than a silent widening. The
   * lookup is impure and belongs at the edge; this function stays pure and
   * takes a number.
   */
  declines = 0,
): OfferGrounds {
```

Replace the `sufficient` expression at line 1278:

```ts
/**
 * The bar, plus whatever the person has already said no to.
 *
 * `Math.max(declines, 0)` is not defensive tidiness — it is the only thing
 * standing between this expression and a caller that widens the bar by
 * passing a negative. §15 permits narrowing and forbids widening, and a
 * clamp is how that becomes a property of the code rather than of every
 * caller. `Math.min(…, 2)` bounds how quiet reticence can make Propositum:
 * four axes is already a high bar and there is no honest reading of "they
 * said no eleven times" that should mean silence forever.
 */
const required = INVESTMENT_REQUIRED + Math.min(Math.max(declines, 0), 2)

return {
  kinds,
  sufficient: intent.length >= INTENT_REQUIRED && axes >= required,
  sentences,
}
```

- [ ] **Step 4: Run the policy test to verify it passes**

Run: `npx vitest run tests/grounds.test.ts`
Expected: PASS — the whole file, including the six new assertions.

- [ ] **Step 5: Thread the lookup through the edge**

In `src/server/compose-offer.ts`, add a parameter after `nowMs`:

```ts
  nowMs: number = Date.now(),
  /** Declines already recorded against this strand. The caller looks it up;
   *  this function stays a pure consumer of the number. */
  declines = 0,
): Promise<void> {
```

and pass it at line 267:

```ts
const grounds = groundsFor(detected, pages, declines)
```

In `src/app/api/session/current/route.ts`, at the `composeOffer` call around line 333, look the count up first:

```ts
const salt = await repos.reticence.salt()
const declined = await repos.reticence.declinesFor([hashSignature(signature, salt)])

void composeOffer(
  store,
  model,
  detected,
  named,
  now,
  declined.get(hashSignature(signature, salt)) ?? 0,
)
```

Use whatever local names that route already has for the store, model, detected thread and signature; do not introduce new ones.

- [ ] **Step 6: Count what reticence held back**

In `src/server/front-door.ts`, give `noticedAfternoon` an optional fourth parameter and a third return field:

```ts
export function noticedAfternoon(
  store: AmbientStore,
  observations: readonly AmbientObservation[],
  nowMs: number,
  /**
   * Hashes this person has declined before, and how often.
   *
   * Passed in rather than looked up: this function is synchronous and the
   * front door is not, so the impure half stays with the caller. An empty map
   * is today's behaviour exactly.
   */
  reticent: ReadonlyMap<string, number> = new Map(),
): NoticedAfternoon {
```

**Read this before writing it.** `noticedAfternoon` does **not** currently call `groundsFor` at
all — it filters on the two snoozes and then bounds by `MAX_THREADS_SHOWN`. The grounds gate lives
only in `composeOffer`. So this step is not "pass one more argument to an existing call"; it is
introducing the grounds check to the front-door path for the first time, and it must only ever
_remove_ a strand that reticence is holding back. A strand with no declines must take exactly the
path it takes today.

Add the two imports:

```ts
import {
  EVERY_STRAND,
  MAX_THREADS_SHOWN,
  detectThreads,
  threadPagesOf,
} from '../domain/detection/detect'
import { groundsFor } from '../domain/detection/grounds'
```

(`threadPagesOf` is exported from `src/domain/detection/detect.ts:1049` and takes
`(observations, detected, now)` — the same call `compose-offer.ts` and `actions.ts` already make.)

Declare `let heldBack = 0` beside `shown` and `suppressed`, and add this **after** both existing
snooze checks and **before** `seen.add(signature)`:

```ts
/**
 * A third reason a strand does not appear, counted apart from the other two.
 *
 * `strandsSuppressed` means "good enough, and cut for room". This means
 * "did not clear the bar it now has to clear". Adding them together would
 * make one number mean two things, which is why they are two.
 *
 * Guarded on `declines > 0` so a strand nobody has turned down never
 * reaches `groundsFor` here at all — this path did not consult the grounds
 * before today, and reticence is not the change that should quietly start
 * gating the front door on them.
 */
const declines = reticent.get(hashSignature(signature, salt)) ?? 0
if (declines > 0) {
  const pages = threadPagesOf(observations, detected, nowMs)
  if (!groundsFor(detected, pages, declines).sufficient) {
    heldBack += 1
    continue
  }
}
```

Return `{ shown, suppressed, heldBack }` and add `readonly heldBack: number` to the
`NoticedAfternoon` interface. Add `salt: string` to the parameter list beside `reticent`, defaulting
to `''` — the salt and the map both come from the caller, because this function is synchronous and
must not reach for a database.

- [ ] **Step 7: Say so on the front door**

In `src/app/page.tsx`, look the reticence up beside the existing `noticedAfternoon` call and render one line when `heldBack > 0`:

```tsx
{
  /*
   * §15 forbids "a default computed from past behaviour and applied without
   * being shown", and a suppressed offer is invisible by construction — there
   * is no screen for the thing that did not happen. This is that screen, and
   * it is one line.
   *
   * It names no subject. A count is what the counters already say; naming
   * which strand was held back would put on screen exactly the subject
   * `offer_reticence` refuses to store.
   *
   * "Show them anyway" is the human act, and therefore the only control here
   * allowed to widen anything. It shows them for this poll; it deletes no
   * rows. Accepting one does that.
   */
}
{
  heldBack > 0 ? (
    <p className="hm-because hm-foot">
      {heldBack === 1
        ? 'One thing was held back because you’ve said not now to it before.'
        : `${heldBack} things were held back because you’ve said not now to them before.`}{' '}
      <a href="/?showHeld=1">Show them anyway</a>
    </p>
  ) : null
}
```

Read `showHeld` from `searchParams` and pass `new Map()` as `reticent` when it is set — that is what "show them anyway" means, and it keeps the widening in a query parameter a person's click produced rather than in stored state.

- [ ] **Step 8: Pin the line as reachable**

In `tests/reachability.test.ts`, add to the block that asserts the front door's other obligations:

```ts
it('says when reticence held something back, or the policy is invisible', () => {
  const home = read('src/app/page.tsx')

  // §15's answer is an interface requirement, and an interface requirement
  // with no test is the weak link ADR-0011 named. This is that test.
  expect(home).toContain('heldBack')
  expect(home).toContain('Show them anyway')
})
```

Use whatever helper that file already has for reading a source file; do not add a second one.

- [ ] **Step 9: Full suite and ONE commit**

```bash
npm run typecheck
npm test
npx prettier --write src/domain/detection/grounds.ts src/server/compose-offer.ts src/app/api/session/current/route.ts src/server/front-door.ts src/app/page.tsx tests/grounds.test.ts tests/reachability.test.ts
git add src/domain/detection/grounds.ts src/server/compose-offer.ts src/app/api/session/current/route.ts src/server/front-door.ts src/app/page.tsx tests/grounds.test.ts tests/reachability.test.ts
git commit -m "feat: declines raise the bar, and the front door says so"
```

---

### Task 6: ADR-0020 and the documents

**Files:**

- Create: `docs/adr/0020-remembering-a-decline.md`
- Modify: `docs/SECURITY_AND_PRIVACY.md`
- Modify: `README.md` — the ADR count in the `docs/adr/` row (line 33)

**Interfaces:**

- Consumes: everything above.
- Produces: nothing in code. `tests/counts.test.ts` enforces the README number.

- [ ] **Step 1: Write ADR-0020**

Create `docs/adr/0020-remembering-a-decline.md`, following the house format — a `**Status:**` / `**Depends on:**` / `**Extends:**` header block, then the argument. It must contain, in this order:

1. **The gap**, at its real size: `declineThread` already snoozes a signature for an hour and forgets it with the buffer, so a person declining the same strand nightly is asked nightly and nothing is learned.
2. **The decision**: declines accumulate against a salted hash, raise `INVESTMENT_REQUIRED` for that strand by at most 2, decay after 30 days, and are cleared by an accept.
3. **Why this is inside §15 rather than a reversal of it**, quoting the asymmetry: _"Trust history may narrow autonomy on its own; widening always needs a person."_ Cite ADR-0016's refusal 3, which records that this exact design was left out of slice 1 **by scope, not by principle**.
4. **What the hash does not buy**, in the same words as `src/domain/detection/reticence.ts`: the salt is in the same file as the rows, a candidate signature can be hashed and compared, and what is bought is that no process, log line or backup holds the terms in readable form.
5. **The price paid**: `ambient-store.ts`'s refusal of "a durable row saying 'Propositum thought you were job-hunting'" is spent to the extent that a durable row now exists per declined strand. State that plainly rather than arguing it away.
6. **Rejected alternatives**: plaintext signatures (the refused row, unmitigated) · narrowing globally off `OfferTally` with no new storage (safe, but cannot tell one subject from another) · accept-side learning (§15's first forbidden clause).
7. **Where this could still go wrong**: reticence and `strandsSuppressed` are two counts of "did not appear" and a future reader that adds them together would be wrong; and the front-door line is an interface requirement, so it is only as true as `tests/reachability.test.ts` keeps it.

- [ ] **Step 2: Add the privacy paragraph**

In `docs/SECURITY_AND_PRIVACY.md`, add `offer_reticence` and `install_secret` to whatever inventory of stored data that document keeps, saying: what the row holds (a salted hash, a count, a day), what it cannot hold (no column for a subject), how long it lives (30 days from the last decline), and the honest limit on the hash. Match the surrounding voice — that file already carries struck-and-dated corrections.

- [ ] **Step 3: Update the ADR count**

In `README.md` line 33, strike the current figure and add the new one in the house style — the existing cell already carries four struck counts, so follow it exactly:

```
~~19 decisions — [ADR-0019](./docs/adr/0019-disclosure-and-what-may-never-fold.md) landed 2026-08-22 with the interface simplification and is the newest~~ **20 decisions — [ADR-0020](./docs/adr/0020-remembering-a-decline.md) landed 2026-08-22 with offer reticence and is the newest**
```

- [ ] **Step 4: Verify the count test passes**

Run: `npx vitest run tests/counts.test.ts`
Expected: PASS. If it fails, the README number and the file count in `docs/adr/` disagree — fix the README, never the test.

- [ ] **Step 5: Full suite, format and commit**

```bash
npm run typecheck
npm test
npx prettier --write docs/adr/0020-remembering-a-decline.md docs/SECURITY_AND_PRIVACY.md
git add docs/adr/0020-remembering-a-decline.md docs/SECURITY_AND_PRIVACY.md README.md
git commit -m "docs: ADR-0020, remembering a decline"
```

---

## Verification, end to end

After Task 6, prove the loop closes on real data rather than on tests:

```bash
npm run dev      # :3117
npm run worker   # second terminal
```

1. On the front door, decline a strand with **Not now**.
2. `sqlite3 propositum.db "select * from offer_reticence;"` — one row, a 64-character hex hash, `declines = 1`, today's date. **Confirm the terms appear nowhere in the row.**
3. Decline the same strand again. `declines = 2`.
4. `sqlite3 propositum.db "select value from install_secret;"` — one salt, and confirm hashing the signature yourself reproduces the stored hash.
5. Accept an offer for that strand. The row is gone.
6. `npm run eval -- --report` — the offer rate section still reports declines as before; reticence changes what is offered, not what is counted.

## Notes for whoever executes this

- **Tasks 1–4 change no behaviour.** They can land and sit. If the counts show nobody declines the same strand twice, Task 5 is not worth having and this plan should stop at Task 4 — say so rather than finishing it out of momentum.
- **`prisma db push` drops the append-only triggers** and they are reinstalled at the next app startup. Restart before trusting the database after Task 2.
- **The one thing not to compromise on** is Task 5's indivisibility. Everything else here is negotiable.
