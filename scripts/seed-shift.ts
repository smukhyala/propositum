/**
 * A finished shift, written straight into the database.
 *
 *   npm run seed:shift
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * Testing the half of the product a person touches WITHOUT waiting for an
 * afternoon. Reaching a re-entry note the honest way means loading the
 * extension, granting sites, browsing until the grounds fire, ratifying an
 * agreement, and then waiting for a run — twenty minutes and a handful of model
 * calls before anybody sees the screen they were trying to look at.
 *
 * This writes the rows that afternoon would have produced. No model, no network,
 * under a second.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * It does not fake an offer. A composed offer lives in the Next app process's
 * memory and ADR-0008 refuses it a row, so there is nothing here to write — that
 * half is `npm run seed:offer`, which drives the real detector.
 *
 * It does not fake capture. No `ObservationEvent` is written, so the session
 * timeline is empty and says so. Inventing browsing history to make a screen
 * look busier would be putting a fabricated afternoon in the one ledger the
 * person is told is a record of their own.
 *
 * ── The one thing worth checking that it makes possible ──────────────────
 *
 * A `DecisionNeeded` with no answer. That is the row a phone can answer
 * (ADR-0022), and it is the single most interesting thing to test on this
 * channel — so it is seeded open on purpose.
 */

import { createDatabase } from '../src/persistence/client'
import { createRepositories } from '../src/persistence/repositories/index'
import { diff, hashContent } from '../src/domain/document/changeset'

try {
  process.loadEnvFile('.env')
} catch {
  /* a seed needs no key */
}

/**
 * Refuses in production, and the check is the first thing it does.
 *
 * This writes a project, a session and a document that did not happen. On a
 * machine holding somebody's real work that is not test data, it is a forgery in
 * their own ledger.
 */
if (process.env['NODE_ENV'] === 'production') {
  console.error('seed:shift is a development tool and will not run in production.')
  process.exit(1)
}

const url = process.env['DATABASE_URL'] ?? 'file:./propositum.db'
const db = await createDatabase({ url })
const repos = createRepositories(db.prisma)

const now = new Date()
const hourAgo = new Date(now.getTime() - 60 * 60_000)

const BASE = `# The Lisbon trip

We are going in October. The flights are not booked.

Accommodation is undecided. Somewhere near the water would be good, but the
prices around Belem look high for what they are.

Nothing has been said about how we get around once we are there.
`

const name = 'The Lisbon trip'

/**
 * Reuse the project if this has been run before.
 *
 * ── Why, and it is not tidiness ──────────────────────────────────────────
 *
 * The first version created a project every time. Six runs while testing left
 * six identical *"The Lisbon trip"* entries on the front door, which is not just
 * clutter — it is the wrong SHAPE. A project accumulating shifts is what really
 * happens; six projects each with one shift is a picture of a product nobody has
 * used twice, and testing against it teaches the wrong thing about the screen.
 *
 * Reused rather than replaced, because nothing here may delete: the ledger is
 * append-only by design and a seed that could clear its own tracks would need a
 * capability the product deliberately does not have.
 */
const existing = await db.prisma.project.findFirst({
  where: { name },
  orderBy: { createdAt: 'asc' },
  select: { id: true, intention: { select: { id: true } } },
})

const project = existing ?? (await repos.projects.create(name))
const intention =
  existing?.intention ??
  (await repos.intentions.create({
    projectId: project.id,
    objective: 'Work out the Lisbon trip well enough to book it',
    definitionOfDone: 'Flights chosen, somewhere to stay shortlisted, and a note on getting around',
  }))
const session = await repos.sessions.start(project.id, intention.id)
const reading = await db.prisma.sessionReading.create({
  data: { sessionId: session.id, throughSeq: 1 },
  select: { id: true },
})
const document = await repos.documents.create({
  projectId: project.id,
  title: name,
  content: BASE,
  contentHash: hashContent(BASE),
})

const contract = await repos.contracts.createDraft({
  sessionId: session.id,
  readingId: reading.id,
  intentionId: intention.id,
  objective: 'Work out the Lisbon trip well enough to book it',
  definitionOfDone: 'Flights chosen, somewhere to stay shortlisted, and a note on getting around',
  guidance: ['Do not book anything.'],
  approvedSourceIds: [],
  allowedActionKinds: ['read-document', 'draft-section'],
  baseVersionId: document.versionId,
  initiative: 'follow-closely',
  progress: 'current-step-only',
  output: 'draft-changes',
  interruption: 'stop-when-uncertain',
  timeLimitMinutes: 30,
})
await repos.contracts.accept(contract.id, hourAgo)
const run = await repos.runs.enqueue({ contractId: contract.id, role: 'worker' })
await repos.runs.complete(run.id, 'succeeded', now)

/**
 * The note, with one question left open.
 *
 * The narrative is a stop rule's consumer label, which is what `writeReport`
 * puts there today — every one of them starts with "I " and a test asserts it,
 * so the seed inherits the house voice rather than inventing a second one.
 */
await repos.reports.create({
  contractId: contract.id,
  narrative: 'I stopped because this needs a decision only you can make.',
  decisions: [
    {
      question: 'Do you want to be near the water, or near the centre?',
      whyStopped:
        'Both shortlists are defensible and they do not overlap. Choosing one throws the other away, and it is not my call to make.',
      needs: 'A decision only you can make.',
      ordinal: 0,
    },
  ],
})

/**
 * The changes, computed by the real engine rather than written by hand.
 *
 * ── The bug this replaced, kept because it was invisible ─────────────────
 *
 * The first version wrote `startOffset` / `endOffset` / `baseHash` itself, with
 * `baseHash: sha256(BASE)`. That looked right and produced a note showing the
 * **drift** screen — *"You changed the document while I was working on it"* —
 * with none of the three changes reviewable. Nothing errored; the seed simply
 * produced the wrong screen.
 *
 * The reason is one line in `checkDrift`: it hashes `normalise(currentContent)`,
 * not the raw text. `normalise` reflows paragraphs to one sentence per line, so
 * a hash of the raw document can never match, and every seeded changeset was
 * born already drifted.
 *
 * So this hands the base and the rewritten prose to `diff()` — the same function
 * `execute-run.ts` calls on a real run — and lets it compute the hash, the
 * offsets and the anchors. **The worker returns prose, not patches**, which is
 * the invariant `changeset.ts` opens with, and a seed that computed patches was
 * quietly not testing the thing it looked like it was testing.
 */
const IMPROVED = `# The Lisbon trip

We are going in October. The flights are not booked. The two that work are the 07:40 direct and the 13:15 with a stop in Madrid; the direct is about forty pounds more each.

Accommodation is undecided. Somewhere near the water would be good, but the
prices around Belem look high for what they are. Alcantara is ten minutes further out and roughly a third less.

Getting around is the metro and the 15E tram; a Viva Viagem card covers both and is the usual advice for a week.
`

const proposed = diff(
  BASE,
  IMPROVED,
  'Filled in the three things the objective names as done and the document had nothing on.',
)

await repos.changesets.create({
  contractId: contract.id,
  baseVersionId: document.versionId,
  baseHash: proposed.baseHash,
  /**
   * Named field by field, as `src/server/outcomes/document-changes.ts` does.
   *
   * `diff()` returns a `scale` alongside each change — the derived
   * "changed 4 words" label — and `ProposedChangeInput` does not take one,
   * because it is computed for display rather than stored. Spreading the whole
   * object is a Prisma error at runtime, which is how this was found.
   */
  changes: proposed.changes.map((change) => ({
    startOffset: change.startOffset,
    endOffset: change.endOffset,
    prefix: change.prefix,
    exact: change.exact,
    suffix: change.suffix,
    replacement: change.replacement,
    reason: change.reason,
  })),
})

console.log(`Seeded a finished shift on "${name}".`)
console.log(`  the note:      /shifts/${contract.id}`)
console.log(`  the project:   /projects/${project.id}`)
console.log('')
console.log('One question is open, so it will be said on a paired thread within a few seconds.')
console.log('Answer it from the phone, then reload the note.')

await db.close()
