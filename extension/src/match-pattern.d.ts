/**
 * Types for `match-pattern.js`, so a test can import the file Chrome runs.
 * See `search-url.d.ts` for why a `.d.ts` is not a build step.
 */

/** True when `pattern` — a Chrome host match pattern — covers `origin`. */
export declare function patternCovers(pattern: string, origin: string): boolean
