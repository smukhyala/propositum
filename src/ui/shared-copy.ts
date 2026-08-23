/**
 * Sentences a person meets on BOTH surfaces, written once.
 *
 * ── The failure this exists for ──────────────────────────────────────────
 *
 * Propositum has two interfaces — this app and the extension's side panel —
 * and they are built and shipped separately. Where they say the same thing,
 * they said it twice, in two wordings:
 *
 *   the app   "Nothing has been recorded. Propositum holds what it saw for
 *              half an hour and throws it away unless you say yes."
 *   the panel "Nothing has been recorded. What Propositum saw is held in
 *              memory for half an hour and thrown away unless you say yes."
 *
 * Both are true and they are not the same sentence. That is worse than it
 * looks on a claim about RETENTION: a person reading one and then the other
 * has to work out whether "held in memory" and "holds what it saw" describe
 * one policy or two, and the only honest answer — they are one — is the one
 * thing neither sentence says. A promise about what is kept cannot be the
 * place where the wording drifts.
 *
 * ── Why a constant and a test, and not an import ─────────────────────────
 *
 * `extension/src/panel.html` is static markup in a separate MV3 build with no
 * bundler and no module graph reaching this file, so it cannot import this. It
 * carries the sentence literally, and `tests/shared-copy.test.ts` asserts the
 * two are identical — the same source-text guard `tests/calendar-scope.test.ts`
 * uses, for the same reason: the coupling is real, so something has to fail
 * when it breaks. Changing the wording here without changing the panel turns
 * the suite red, which is the whole point.
 */

/**
 * Said at the moment a person is deciding, on both surfaces.
 *
 * CONTEXT.md governs the words: no *capture*, no *buffer*, no *session data* —
 * this is what Propositum SAW, and what happens to it if the answer is no.
 */
export const NOTHING_RECORDED_YET =
  'Nothing has been recorded. Propositum holds what it saw for half an hour and throws it away unless you say yes.'
