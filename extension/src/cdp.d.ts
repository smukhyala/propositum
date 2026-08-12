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

export declare function classifyPausedRequest(
  paused: unknown,
  approvedOrigins: unknown,
  patternCovers?: (pattern: string, origin: string) => boolean,
  mainFrameId?: string | null,
): 'allow' | 'blocked-request' | 'off-origin'
