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
