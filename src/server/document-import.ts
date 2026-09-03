/**
 * The screen's half of the page import — ADR-0032.
 *
 * ── Why this is a module and not just a server action ────────────────────
 *
 * `src/server/actions.ts` is `'use server'`, so every export it carries becomes
 * a callable endpoint, and it is already the largest file in the repository.
 * The logic lives here and takes its repositories as a parameter, the way
 * `src/server/confirmations.ts` does, so the action above it is a thin skin
 * that turns a refusal into a sentence.
 *
 * ── The two things it does, and the one it refuses ───────────────────────
 *
 * It reads the project's `ApprovedSource` rows that Chrome still grants, and it
 * builds the reader. That is all. The deciding — whether this address is inside
 * one of those origins — belongs to `importApprovedPage`, which is also the only
 * place the allowlist wrapper is constructed.
 *
 * **`grantState: 'granted'` is filtered HERE**, and it is the reason this
 * function exists rather than the repository call being inlined. A revoked
 * source is a permission Chrome has taken back; the extension is structurally
 * incapable of reading one, and an import that ignored the column would be the
 * one path in the product that could read an origin the person had withdrawn.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It writes nothing. No repository on `ctx` is called for anything but the
 * read above, and there is no ledger writer in scope — the import's whole
 * output is a value returned to a screen.
 */

import type { Repositories } from '../persistence/repositories/index'
import { importApprovedPage } from '../policy/page-import'
import type { PageImport } from '../policy/page-import'
import { httpFetcher } from '../policy/http-fetcher'
import type { FollowingFetcher, SourceFetcher } from '../policy/fetcher'

export interface ImportContext {
  readonly repos: Repositories
}

/**
 * Bring one page in, for one project.
 *
 * `reader` is injected so the test suite never reaches the network. Production
 * passes nothing and gets `httpFetcher()`, which runs no JavaScript and sends
 * no credential.
 */
export async function bringInApprovedPage(
  ctx: ImportContext,
  projectId: string,
  address: string,
  reader: SourceFetcher | FollowingFetcher = httpFetcher(),
): Promise<PageImport> {
  const sources = await ctx.repos.projects.approvedSources(projectId)
  const granted = sources
    .filter((source) => source.grantState === 'granted')
    .map(({ id, originPattern, label }) => ({ id, originPattern, label }))

  try {
    return await importApprovedPage(address, granted, reader)
  } finally {
    await reader.close()
  }
}
