/**
 * Bringing a page into the box a person is looking at — ADR-0032.
 *
 * ── Why this is not in `tools.ts` ────────────────────────────────────────
 *
 * Everything in `src/policy/tools.ts` takes an `AuthorizedAction`, and that
 * token exists only inside a ratified `HandoffContract`. A person on the
 * project screen has no contract: they have not handed anything over and they
 * are not away. Routing this through `authorize()` would mean compiling a
 * policy from a contract nobody agreed to, purely so a convenience could reuse
 * a token — and *"no `AgentRun` may start from an unratified `HandoffContract`"*
 * (ADR-0006 §5) would quietly become conditional.
 *
 * So this is a NARROWER door rather than a borrowed one. It has no
 * `ActionKind`, no `BrowserControl`, no `AuthorizedAction` and no write path.
 * It cannot click, type, navigate, press a key, take a picture or buy anything,
 * because there is no parameter through which any of those could reach it. Its
 * whole surface is: an address, the sources that project already approved, and
 * a reader.
 *
 * **It is honestly a network capability outside the gate.** What bounds it is
 * that it can only read, only an origin the person already approved, and only
 * when they press. That is weaker than a gate and it is stated rather than
 * dressed up.
 *
 * ── The one construction site ────────────────────────────────────────────
 *
 * `allowlisted()` is applied HERE, to the fetcher that was passed in, from the
 * same patterns that were just matched against. A caller therefore cannot hand
 * in an unchecked reader and have it used unchecked — there is no arrangement
 * of the arguments that skips the wrapper. That is the strongest thing holding
 * this line, because it is a construction site rather than a check somebody has
 * to remember to write.
 *
 * **Since 2026-09-03 it is also where the reader learns the allowlist at all.**
 * `httpFetcher()` returns a `FollowingFetcher`, which has no `fetch` until it
 * is bound to a list of patterns, and `allowlisted()` is what binds it — so the
 * patterns matched at the door, the patterns the wrapper checks, and the
 * patterns every redirect hop is judged against are one list that was passed
 * once. A reader that followed a hop off the approved path used to be possible
 * here; it is now a call that does not typecheck.
 *
 * ── What this does NOT do ────────────────────────────────────────────────
 *
 * **It stores nothing.** No `Document`, no `DocumentVersion`, no
 * `ObservationEvent`, no `ActionIntent`. The text goes back to the screen; the
 * person saves it with the button that was already there, through the server
 * action that was already there, which normalises as it always did. Both
 * ledgers are untouched and stay disjoint.
 *
 * **It records no provenance**, which is the cost ADR-0032 §4 states: a
 * document that holds these words holds no trace of where they came from.
 *
 * **It does not approve anything.** There is no field on any type here that
 * could add an origin, and that absence is the permission model.
 */

import { datamark, looksAdversarial, IMPORT_BUDGET_CHARS } from '../model/untrusted'
import type { RemovedArtifact } from '../model/untrusted'
import { SourceNotAllowedError, allowlisted, matchesPattern } from './fetcher'
import type { FollowingFetcher, SourceFetcher } from './fetcher'

/**
 * The part of an `ApprovedSource` this needs, and no more.
 *
 * The glossary's word, deliberately, rather than a second one beside it.
 * `CONTEXT.md` lists `AllowedSite`, `allowlist entry`, `whitelist`,
 * `PermittedURL` and bare `Source` as things `ApprovedSource` displaces, and a
 * type here called `ApprovedOrigin` would have been the sixth — a synonym for
 * a concept that already has a name, in the one file where getting the concept
 * wrong is expensive.
 *
 * It is the row minus `grantState`, because nothing here has any use for it: a
 * caller passing revoked rows is a mistake that should be visible in the caller
 * rather than tolerated here.
 */
export interface ApprovedSource {
  readonly id: string
  readonly originPattern: string
  readonly label: string
}

/**
 * Why a page did not come in. A closed set, because each of these is a
 * different sentence on screen and a catch-all would collapse *"that host is
 * not one of yours"* into *"something went wrong"* — which is the refusal a
 * person most needs to be able to tell apart from a failure.
 *
 * `source_not_approved` is the gate's own word for the same thing, on purpose.
 */
export type ImportRefusal =
  | 'not_a_web_address'
  | 'source_not_approved'
  | 'too_large_to_bring_in'
  | 'nothing_readable'
  | 'could_not_read_it'

export interface BroughtInPage {
  readonly approvedSourceId: string
  /** The label the person gave that source when they approved it. */
  readonly sourceLabel: string
  readonly url: string
  /** What the page called itself. Page-authored, sanitised, never a fact. */
  readonly title: string
  /** SANITISED, through `datamark()`. There is no arm of this type that
   *  carries the raw text, so nothing downstream can reach for it. */
  readonly text: string
  /** What sanitisation had to remove, for the sentence the person reads. */
  readonly removed: readonly RemovedArtifact[]
  /** True when what was removed does not occur in benign article text. Not
   *  proof of an attack, and worth saying out loud before they save it. */
  readonly hidden: boolean
}

export type PageImport =
  | { readonly ok: true; readonly page: BroughtInPage }
  | { readonly ok: false; readonly refusal: ImportRefusal; readonly detail?: string }

function refuse(refusal: ImportRefusal, detail?: string): PageImport {
  return { ok: false, refusal, ...(detail === undefined ? {} : { detail }) }
}

/**
 * Fetch one page from a source this project already approved, sanitise it, and
 * hand back the text.
 *
 * Failures are values at every step — an exception thrown from here would cross
 * a server-action boundary and arrive client-side as an opaque digest, with the
 * one sentence the person needed stripped out.
 */
export async function importApprovedPage(
  address: string,
  approved: readonly ApprovedSource[],
  reader: SourceFetcher | FollowingFetcher,
): Promise<PageImport> {
  const wanted = address.trim()
  if (wanted === '') return refuse('not_a_web_address')

  let parsed: URL
  try {
    parsed = new URL(wanted)
  } catch {
    return refuse('not_a_web_address')
  }
  // `matchesPattern` refuses these too. Refusing here as well is what makes the
  // SENTENCE right: a `file:` address is not an unapproved source, it is not an
  // address at all, and telling somebody to approve their own disk would be the
  // wrong instruction.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return refuse('not_a_web_address')
  }

  const source = approved.find((origin) => matchesPattern(parsed.href, origin.originPattern))
  if (!source) return refuse('source_not_approved')

  // The one construction site. The patterns are the ones just matched against,
  // so the check at the door, the check in the wrapper and the check on every
  // redirect hop cannot drift apart — this is also what binds the reader.
  const fetcher = allowlisted(
    reader,
    approved.map((origin) => origin.originPattern),
  )

  let fetched
  try {
    fetched = await fetcher.fetch(parsed.href)
  } catch (error) {
    // The allowlist refusing after a match means a lookup disagreed with
    // itself. It is still a refusal to the person, and it is still the same
    // sentence, because the remedy is the same one.
    if (error instanceof SourceNotAllowedError) return refuse('source_not_approved')
    return refuse('could_not_read_it', error instanceof Error ? error.message : String(error))
  }

  // Refused above the cap rather than truncated, which is the file import's
  // argument kept verbatim: a document arriving with its ending silently
  // removed is the worst of the three behaviours. This is also what keeps
  // `truncated-to-import-budget` unreachable from this path.
  if (fetched.text.length > IMPORT_BUDGET_CHARS) return refuse('too_large_to_bring_in')

  const marked = datamark(fetched.text, { budget: 'import' })
  if (marked.sanitized === '') return refuse('nothing_readable')

  return {
    ok: true,
    page: {
      approvedSourceId: source.id,
      sourceLabel: source.label,
      url: fetched.url,
      title: datamark(fetched.title).sanitized,
      text: marked.sanitized,
      removed: marked.removed,
      hidden: looksAdversarial(marked),
    },
  }
}
