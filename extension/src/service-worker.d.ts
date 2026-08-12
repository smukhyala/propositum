/**
 * Types for `service-worker.js`, so a test can LOAD the file Chrome runs.
 *
 * Empty on purpose, and the emptiness is the statement. The service worker
 * exports nothing — it is all top-level listener registration, which is what
 * MV3 requires if a terminated worker is to be woken for an event at all. The
 * only thing worth asserting about it from a test is that evaluating it works,
 * and `tests/extension-cdp.test.ts` does exactly that with `chrome` stubbed.
 *
 * See `search-url.d.ts` for why a hand-written `.d.ts` beside a hand-written
 * `.js` is not a build step: nothing is compiled and the extension still ships
 * the exact source that was reviewed.
 */

export {}
