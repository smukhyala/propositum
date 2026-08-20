/**
 * The one line a person reads above the thing they are being asked to allow.
 *
 * ── Why this is a function and not a prompt ──────────────────────────────
 *
 * `ConfirmationRequest.summary` is specified in CONTEXT.md as **code-generated
 * from attested facts** and never model prose, and ADR-0010 §5 gives the
 * reason in one sentence: *"a model that could write the words asking for its
 * own permission is a model that can argue for itself."* The worker has just
 * been refused. It has every incentive to describe what it wants in the way
 * most likely to get a yes, and the person reading has no way to tell a careful
 * description from a persuasive one.
 *
 * So the question is assembled here, from a closed set of `ActionKind`s and one
 * browser-attested host, by code that cannot be talked into anything.
 *
 * ── What is deliberately NOT in the sentence ─────────────────────────────
 *
 * **The text about to be typed**, even though the screen shows it and the
 * person plainly needs it. `ActionParams.inputText` is composed by a model —
 * not page-authored, not attested, but not ours either — and folding it into a
 * value CONTEXT.md calls code-generated would make that description false for
 * one member of the enum. `src/ui/confirm.tsx` renders it verbatim in its own
 * block, which is both more honest about where it came from and more useful:
 * a page title is not a place a person can read a paragraph.
 *
 * **The element's accessible name.** It is page-authored, so it may only ever
 * appear as an attributed quotation in the page's own voice — which is what the
 * screen does with it. Spoken in Propositum's voice, inside a sentence
 * Propositum is claiming it generated from attested facts, it would be exactly
 * the laundering the whole `Datamarked` boundary exists to prevent. It is also
 * unavailable: the extraction that produces `ElementEvidence` is not wired, so
 * every proposal reaches the classifier with no evidence and escalates. That is
 * the cautious state and it is why these questions are frequent.
 *
 * **The method.** ADR-0010 §5 names it as one of the three facts, and it is not
 * knowable here: nothing has been sent, so Chrome has not described a request
 * to us. The method belongs to the network mechanism, which fires later and on
 * a different path. Claiming one would be inventing an attested fact, which is
 * worse than omitting a real one.
 *
 * ── No model, no clock, no I/O ───────────────────────────────────────────
 *
 * Pure and total, like every other decision in this directory. Given the same
 * facts it returns the same sentence, so what a person was asked can be
 * reconstructed from the row rather than reproduced by running something.
 */

import type { ActionKind } from '../handoff/policy'

/**
 * Everything the sentence may be built from.
 *
 * `attestedUrl` is `PageObservation.url` — Chrome saying where the tab is, not
 * the page saying where it wishes it were. It is nullable because a run that
 * has observed nothing has no page, which the gate refuses long before this is
 * reached; the null branch exists so this function is total rather than because
 * the state is expected.
 */
export interface ConfirmationFacts {
  readonly kind: ActionKind
  readonly attestedUrl: string | null
  /** `Enter`, `Tab` or `Escape`. The gate has already refused anything else. */
  readonly key?: string | undefined
}

/**
 * The host, or nothing.
 *
 * A host rather than the whole URL, because this is a title and a person
 * recognises a site by its name. The full attested URL is on the screen
 * underneath, where there is room for it.
 *
 * Returns null rather than throwing on anything unparseable. A malformed URL
 * here would mean the browser reported something we cannot read, and the right
 * response is a vaguer question rather than no question — the alternative is an
 * exception thrown while trying to ask for permission, which loses the pause
 * entirely and is the one failure this whole mechanism cannot survive.
 */
function hostOf(url: string | null): string | null {
  if (url === null || url.length === 0) return null
  try {
    const host = new URL(url).host
    return host.length > 0 ? host : null
  } catch {
    return null
  }
}

/**
 * Where, said the same way in every branch.
 *
 * The fallback names Propositum rather than the site, because "a page" on its
 * own reads as though we know which one and are not saying.
 */
function whereOf(url: string | null): string {
  const host = hostOf(url)
  return host === null ? 'a page Propositum opened' : host
}

/**
 * One line, in the register of the agreement panel's own capability labels.
 *
 * The screen supplies the kicker — *"One thing I could not undo"* — so this is
 * the title beneath it and not a whole sentence. Short, concrete, and about the
 * mechanism rather than the effect, because the effect is exactly what nobody
 * here knows: `click-element` presses whatever the page put under the pointer,
 * and a title claiming to know whether that sends, buys or expands a row would
 * be the model's argument for itself wearing our voice.
 *
 * Total over `ActionKind`. A kind outside `CONFIRMABLE_ACTION_KINDS` cannot
 * reach here — the gate never raises `confirmation_required` for one — but the
 * fallback says something true rather than throwing, for the reason `hostOf`
 * gives: nothing in this file may fail in a way that costs the person the
 * question.
 */
export function confirmationQuestion(facts: ConfirmationFacts): string {
  const where = whereOf(facts.attestedUrl)

  switch (facts.kind) {
    case 'click-element':
      return `Press something on ${where}`
    case 'type-text':
      return `Type into a box on ${where}`
    case 'press-key':
      return facts.key === undefined || facts.key.length === 0
        ? `Press a key on ${where}`
        : `Press ${facts.key} on ${where}`
    default:
      return `Do something on ${where}`
  }
}
