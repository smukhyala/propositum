/**
 * Types for `cdp.js`, so a test can import the file Chrome runs.
 *
 * See `search-url.d.ts` for why a `.d.ts` beside a hand-written `.js` is not a
 * build step: nothing here is compiled, transformed, or bundled. The extension
 * still ships the exact source that was reviewed, and this file only lets the
 * TypeScript side of the repo hold its pure predicates still.
 *
 * Deliberately partial. Only the pure, testable surface is declared — the
 * halves that talk to `chrome.debugger` are not, because a test that could
 * import them would be a test asserting against a mock of Chrome rather than
 * against Chrome, which is precisely the kind of proof this component must not
 * rest on. The guard for those is the grep in `tests/extension-cdp.test.ts`.
 */

export declare const SNAPSHOT_NODE_CAP: number
export declare const SNAPSHOT_BUDGET_CHARS: number
export declare const NAME_BUDGET_CHARS: number
export declare const SETTLE_CEILING_MS: number
export declare const SETTLE_FLOOR_MS: number
export declare const INDICATOR_GRACE_MS: number

export declare const PRESSABLE_KEYS: Record<string, { key: string; code: string; keyCode: number }>

export declare function originOf(url: unknown): string | null

export declare function isApprovedOrigin(
  url: unknown,
  origins: unknown,
  patternCovers?: (pattern: string, origin: string) => boolean,
): boolean

export declare function centreOfContentQuad(quad: unknown): { x: number; y: number } | null

export declare function sanitiseName(text: unknown): string

/** One node as `Accessibility.getFullAXTree` reports it, loosely. */
export interface AXNodeLike {
  nodeId?: string | number
  ignored?: boolean
  role?: { value?: unknown } | undefined
  name?: { value?: unknown } | undefined
  value?: { value?: unknown } | undefined
  backendDOMNodeId?: number | undefined
  childIds?: ReadonlyArray<string | number> | undefined
}

export declare function flattenAXTree(
  nodes: unknown,
  options?: { nodeCap?: number; charBudget?: number },
): { tree: string; refs: Record<string, number>; truncated: boolean }

/** ADR-0024: the one-shot landing permit, as the classifier sees it. Expiry is
 *  the caller's to enforce — a stale permit is simply not passed. */
export interface LandingPermitLike {
  readonly intentId?: string
  readonly originPattern: string
  readonly maxAmountMinor: number
  readonly currency: string
  readonly until?: number
}

export declare function classifyPausedRequest(
  paused: unknown,
  approvedOrigins: unknown,
  patternCovers?: (pattern: string, origin: string) => boolean,
  mainFrameId?: string | null,
  permit?: LandingPermitLike | null,
): 'allow' | 'blocked-request' | 'off-origin' | 'allow-landing' | 'amount-over-ceiling' | 'amount-unparseable'

/** ADR-0024. A hand-kept copy of `CURRENCY_CODES` in
 *  `src/domain/handoff/policy.ts`; `tests/extension-cdp.test.ts` asserts the
 *  two agree. */
export declare const PERMIT_CURRENCY_CODES: readonly string[]

/** ADR-0024. Pure: the one deterministic amount a checkout body names, or
 *  null, which the caller must refuse as `amount-unparseable`. */
export declare function parseChargeAmount(
  postData: unknown,
  contentType: unknown,
): { amountMinor: number; currency: string } | null

/** ADR-0024. The synchronous half of one-shot: true exactly once per intentId
 *  per service-worker lifetime. */
export declare function claimLandingPermitOnce(intentId: unknown): boolean
