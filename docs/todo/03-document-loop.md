# 03 — Close the document loop, and get H2 a numerator

**Status:** ~~not started~~ **items 1, 3 and 4 done 2026-08-26. Items 2 and 5
remain, and neither is small.**
**Blocked by:** [`01`](./01-menu-bar-app.md), for the H2 half only. ~~The import and
export work is independent and can be done at any time.~~ **It was, and it is
done.**
**Blocks:** any real answer to H2 — *the hypothesis that can kill the product*.

---

## Is this already done?

```bash
grep -rn 'download\|toBlob\|clipboard\|\.docx' --include='*.tsx' src/ui src/app
grep -n 'textarea' src/app/projects/\[projectId\]/page.tsx
```

~~**As of 2026-08-26:** the first returns nothing, and the second returns a bare
`<textarea rows={14}>` at line 673. Work goes in by paste and comes out by manual
selection. There is no file import, no URL import, no Google Docs, no Word, no
Notion, no export, no download and no copy button anywhere in the product.

That textarea is the one screen that still looks like a developer tool, in an
interface that is otherwise well above prototype.~~

**Re-run later the same day:** the first returns `src/ui/document.tsx`, which
holds the clipboard write and the download. The second returns nothing — the
project screen no longer has a textarea of its own, and
`tests/reachability.test.ts` asserts it does not get one back. Still true, and
still deliberately: **no URL import, no Google Docs, no Word, no Notion.**

---

## What you have to do yourself

**Nothing external.** No account, no fee, no application. This is the only file
here with an empty version of this section, which is a good reason to do it when
the others are waiting on Apple.

Since 2026-08-26 you can also reach the screens this changes without an
afternoon: `npm run seed:shift` writes a finished shift with an open question in
under a second.

One decision that is yours rather than mine: **whether `.docx` is worth a
dependency.** `docs/FOUNDING_BRIEF.md` excludes rich text, and the document
engine normalises to one sentence per line so a change can point at the sentence
it changed. A `.docx` export that loses that mapping is a different feature from
a Markdown export that keeps it. Markdown and clipboard first; `.docx` only if
somebody actually asks.

---

## The work

1. ~~**Import from a file.**~~ **Done 2026-08-26.** Pick a `.md`, `.markdown` or
   `.txt`. It is read in the browser, lands in the box on screen, and is
   submitted by the same form and the same server action a paste always used —
   so it runs through `src/domain/document/normalise.ts` because that path
   already did.

   *Same path, no second door* is a structural property rather than a promise,
   and `tests/document-import.test.ts` pins it as absences: the file input has no
   `name`, so the browser cannot submit the file even if a route appeared;
   `src/ui/document.tsx` contains no `fetch`, `XMLHttpRequest` or `sendBeacon`;
   and no route under `src/app/api` reads multipart or form data. 200 KB is the
   cap and it **refuses** past it rather than truncating, because a document
   arriving with its ending silently removed is the worst of the three
   behaviours.

   Dropping is not built. Picking is.
2. **Import from a URL.** Only from an approved source, and only through the
   existing gate. This is a capability, not a convenience: it must not become a
   way for page text to reach a prompt outside `Datamarked`. **Still not built,
   2026-08-26, and deliberately not done alongside item 1** — a file a person
   chose in their own operating system's dialog and read on screen before saving
   is not the same object as bytes fetched from a host, and treating them as one
   because they both end up in a textarea is the mistake. It needs an ADR before
   it needs a control.
3. ~~**Export to Markdown, and a copy button.**~~ **Done 2026-08-26.** Both act
   on the box rather than the stored version, and the line above them says which
   of the two you are holding: *Version 3 · 48 words · saved*, or *· changes you
   have not saved*. Copy fails loudly if the browser refuses the clipboard,
   because a button that silently does nothing is worse than no button. The
   download is named after the document.
4. ~~**Replace the textarea.**~~ **Done 2026-08-26.** Serif, 17px, line-height
   1.7, a taller minimum, and the three controls in a row above it. Not rich
   text — the brief excludes it and the one-sentence-per-line mapping is why —
   just the face, the measure and the leading. The monospace it replaced was not
   a neutral choice: it said *configuration* about the one screen that holds the
   person's own words.
5. **Then get H2 a numerator.** A rate needs verdicts, a verdict is what a person
   did to real work, and today no real work can easily get into or out of the
   system. Once it can:
   ```bash
   npm run eval -- --report
   ```
   reads H2 off the database and nowhere else. `renderH2FromRuns` currently
   reports the denominator and says the numerator is missing.
   Threshold: **≥60% accepted**.

---

## Done when

- ~~A document can be brought in from a file and taken out again without the
  clipboard doing the work.~~ **Done 2026-08-26.**
- ~~The project page no longer has a raw Markdown textarea as its document
  editor.~~ **Done 2026-08-26**, and `tests/reachability.test.ts` refuses one
  coming back.
- `eval-scores.json` or the `--report` output carries a real H2 rate from real
  verdicts on real work. **Not done, and not close.** It needs a person doing
  real work through the product, which is [`01`](./01-menu-bar-app.md). What
  changed today is that the door is wider, not that anybody walked through it.

---

## One defect this surfaced

**`normalise` did not fold `\r\n`**, so a document imported from a Windows file
stored one carriage return per structural line: identical on screen, different
string, different `contentHash`, and drift against a Shift that had pinned the
other spelling of the same words. Reachable before the import by pasting from a
Windows editor. Fixed in `src/domain/document/normalise.ts`, pinned in
`tests/document-engine.test.ts`, with what it costs stated in the docblock.

Pinning it turned up a second thing: that file's claim that `Intl.Segmenter`
*"knows about abbreviations and decimals"* is **too strong**. It splits `Dr.
Alves` and `No. 7`; the existing test used the spellings that happen to survive.
Struck and narrowed with the measurements beside it, and the real behaviour is
pinned. Not fixed on purpose — the failure makes the addressable unit *smaller*,
which is the safe direction, and `linesOf` hands out offsets that live changesets
already point at.

---

## What this does not cover

- **H2 quality, only H2 count.** `docs/EVALUATION.md`: work that was easy and
  irrelevant scores identically to work that moved the intention toward its
  definition of success, as long as the person accepted both.
- **Google Docs, Word, Notion.** Each is an integration with its own OAuth scope,
  its own egress and its own ADR. §8's *do not build* list names automatic
  ingestion from exactly these. Import from a file is not that; a live connector
  is.
- **Undo on a verdict.** Once a change is accepted or rejected the card says *"You
  accepted this."* permanently, and `Put these into your document` cannot be
  undone either. Whether that should change is a Principle 9 question and needs
  its own argument.
