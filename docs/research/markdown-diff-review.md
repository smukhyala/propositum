# Markdown diff and change review: computing, addressing, and reviewing prose changes

_Research for [#7](https://github.com/smukhyala/propositum/issues/7), feeding the decision in [#12](https://github.com/smukhyala/propositum/issues/12)._
_Researched 2026-08-06. npm and GitHub figures were pulled from the registry and REST APIs on that date and will drift._

---

## 0. Bottom line

Four claims, in order of how much they change the design:

1. **The "stable section addressing" problem in the ticket is two different problems, and the one that is certain
   to happen is the easy one.** Accepting change #3 shifts the offsets of changes #4..#n — that happens 100% of the
   time and needs no clever addressing at all, provided you never mutate the document during review. The hard
   version (the base document moved underneath the proposal) is contingent, and slice 0 can design it out.

2. **Do not ask the model for patches. Ask it for text, and compute the changeset deterministically.** Every
   patch-addressing scheme (`str_replace`, heading paths, injected ids) fails when the model mis-quotes, drops an
   id, or emits overlapping edits. Diffing model output against the base version gives non-overlapping,
   exactly-addressed changes by construction — and it is the literal shape of "models propose; deterministic code
   authorizes."

3. **The diff is not what delivers the one-minute promise. A summary list is.** Google Docs, GitHub, and the
   accessible-redlining literature all lead with narrative and put the diff behind it. Budget the engineering
   accordingly: the ranked list of "what changed and why" is the interface; the diff is the evidence you expand into.

4. **An all-red rewrite is a policy failure, not a rendering failure.** No differ can rescue a wholesale rewrite.
   The fix is upstream — bound how much of the document one action may touch — plus an honest fallback that stops
   diffing and says "rewritten" when similarity drops below a floor, rather than shredding two unrelated paragraphs
   into confetti.

5. **There is no library to install for the actual job.** Every maintained, adopted diff renderer is built for
   code. The three packages that are architecturally right for Markdown prose have **9, 15, and 8 weekly npm
   downloads** between them, and one is dead (§2.3). This is a build, not a buy — a few hundred lines composing
   `remark` + `diff`, but it must appear in the estimate rather than being assumed away.

Recommended addressing scheme, in one line: **base-version character offsets as the resolution key, a W3C-style
quote anchor (`prefix`/`exact`/`suffix`) as a redundant verifier, and a content hash of the base as a hard
precondition** — the "multiple selectors for robustness" pattern from the Web Annotation Data Model, which is also,
independently, what Hypothesis and Anthropic's `str_replace` tool converged on.

---

## 1. The question

> How should a Markdown document diff be computed, addressed, and reviewed so that a returning user understands the
> changes in about a minute?

The measured outcome is re-entry quality. The failure mode named in the ticket — a diff that reads as an entirely-red
rewrite — is worth taking literally, because it is the *default* outcome of naively pointing code-diff tooling at
prose. Almost every library in section 2 was built for source code, and code has properties prose does not:

| | Code | Prose |
|---|---|---|
| Line breaks | Semantic; a line is a unit of meaning | Arbitrary; a paragraph is the unit, lines are wrapping artefacts |
| Token stability | Identifiers repeat exactly | Words recur constantly; exact repeats are ambiguous, not identical |
| Reordering | Rare and usually meaningful | Common and often meaning-preserving |
| Reading mode | Scanned, non-linear, by structure | Read linearly, for sense |
| Local edit | Touches one line | Reflows a whole paragraph in the source |

That last row is the one that kills line-based diffs on Markdown: changing one word in a hard-wrapped paragraph
marks the entire paragraph as changed. This is not hypothetical — it is why the "one sentence per line" convention
exists (see §6.4).

Two sub-questions carry most of the risk, and I have given them the most space: **stable addressing** (§3) and
**whether per-change accept/reject is even possible** (§4).

---

## 2. Library comparison

All figures from `registry.npmjs.org`, `api.npmjs.org/downloads`, and the GitHub REST API, queried 2026-08-06.
"Last push" is the repository's `pushed_at`; "published" is the latest version's npm publish timestamp.

### 2.1 Diff engines

| Package | Latest | Published | Weekly DL | Last commit | Open issues / PRs | Types | Size (min+gz) | Granularity | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| `diff` (jsdiff) | 9.0.0 | 2026-04-13 | 138.4M | 2026-06-01 | 15 / 5 | bundled | 7.9 KB | char, word, line, **sentence**, css, json, array | **Maintained.** The default choice. |
| `google/diff-match-patch` (upstream) | — | — | — | **2019-07-25** | 69 / 29 | — | — | — | **Dead — archived by Google.** |
| `diff-match-patch` (npm, JackuB fork) | 1.0.5 | 2020-05-20 | 6.2M | 2022-12-07 | 6 / 3 | **none** (`@types/*` exists) | 6.2 KB | char + fuzzy patch | **Stale.** No publish in 6 years, no bundled types. |
| `@sanity/diff-match-patch` | 3.2.0 | 2025-01-22 | 847k | 2026-01-30 | 0 / 0 | bundled | 7.0 KB | char + fuzzy patch | **Maintained fork.** Use this, not the original. |
| `diff-match-patch-ts` | 2.0.0 | 2026-06-16 | 200k | 2026-06-16 | 0 / 0 | bundled | 6.3 KB | char + fuzzy patch | **Maintained**, TS-native. Second viable fork. |
| `fast-diff` | 1.3.0 | 2023-05-19 | 53.5M | 2023-05-19 | 2 / 1 | bundled | 3.0 KB | char (simplified Myers) | Dormant-but-stable. Huge install base (Quill/Slate). |
| `fast-myers-diff` | 3.2.0 | 2024-01-12 | 111k | 2024-01-12 | 7 / 1 | bundled | **1.7 KB** | sequence-agnostic (needs pre-tokenising) | Lightly maintained. Smallest option. |
| `prosemirror-changeset` | 2.4.1 | 2026-04-14 | 16.3M | 2026-04-01 | 1 / 0 | bundled | — | spans over PM steps | **Maintained but unusable here — see below.** |

**Two traps in this table, both of which would have cost real time.**

**Trap 1 — `diff-match-patch` is a name, not a maintained project.** Google's canonical repository is **archived**,
last real commit **2019-07-25**, with 69 open issues and 29 open PRs. The npm package `diff-match-patch` is not
published from it — it comes from a third-party fork whose last commit was 2022-12-07 and which ships **no bundled
TypeScript types**. The algorithm is still excellent (its Bitap matcher is what Hypothesis runs in production), but
if you want it, take `@sanity/diff-match-patch` or `diff-match-patch-ts` — both are TS-native, actively maintained,
and carry a zero open-issue backlog.

**Trap 2 — `prosemirror-changeset` cannot do what its download count suggests.** Two separate things are going on:

- *It looks dead and is not.* Every `ProseMirror/*` GitHub repo was archived 2026-04-01 (*"This repository was
  archived by the owner on Apr 1, 2026. It is now read-only"*) with a README pointing at `code.haverbeke.berlin`.
  But `prosemirror-changeset@2.4.1` was **published 2026-04-14, after the archive**, and the package's `repository`
  field already points at the new forge. The project moved off GitHub; it did not die. Any automated maintenance
  scan that only checks GitHub will get this wrong.
- *It is still the wrong tool.* It operates on a ProseMirror `Node` plus a sequence of `Step`/`StepMap`s produced by
  **live editing**. It cannot diff two independent Markdown strings — there is no editing session between our base
  version and the worker's output, so there are no steps to distil. Its 16.3M weekly downloads come from
  rich-text-editor stacks, not from snapshot diffing.

  We still take a **design principle** from it (`simplifyChanges`, §6.5) and its **span model** (deleted spans
  address the old document, inserted spans the new — §4.2). We just cannot take the code.

### 2.2 React renderers

| Package | Latest | Published | Weekly DL | Last commit | Open issues / PRs | Size (gz) | Verdict |
|---|---|---|---|---|---|---|---|
| `react-diff-viewer` | 3.1.1 | 2020-05-22 | 268k | ~2022-04-26 | 60 / 22 | 15.6 KB | **Dead.** No release in 6 years; **peer-capped at React ≤16**; oldest open issue from 2019. |
| `react-diff-viewer-continued` | 4.4.0 | 2026-07-14 | 891k | 2026-07-14 | 16 / 2 | 51.4 KB | **Maintained fork**, React 15–19. Has superseded the original (3× the downloads). |
| `react-diff-view` | 3.3.3 | 2026-03-30 | 275k | 2026-03-30 | 10 / 1 | 23.3 KB | Maintained. **Requires unified-diff text as input.** Maintainer's own README flags thin tests / bus factor. |
| `@git-diff-view/react` | 0.1.7 | 2026-07-13 | 78k | **2026-08-04** | 11 / 4 | **~330 KB** | Most actively maintained of the set, but by far the heaviest (bundles `highlight.js`/`lowlight`). |
| `diff2html` | 3.4.56 | 2026-01-31 | 508k | 2026-01-31 | 16 / 18 | 12.7 KB | Maintained but strained (18 open PRs, an open issue from 2016). **Not a React component** — emits an HTML string. |

Every one of these is a **code** diff viewer: line numbers, gutters, syntax highlighting, monospace, fixed columns.
`react-diff-view` and `diff2html` both take a *unified diff string* as input, forcing a line-based intermediate —
precisely the lossy step to avoid for prose. `@git-diff-view/react`'s ~330 KB is almost entirely syntax
highlighting we would never use.

### 2.3 Markdown / AST / prose-aware

| Package or tool | Weekly DL | Last commit | Notes |
|---|---|---|---|
| `@nicia-ai/prose-diff` | **9** | 2026-07-21 | remark/mdast, block-level diff with **content-identity matching across moves**, byte-faithful hunks. Architecturally the best fit found in the entire survey — and published three weeks ago with 1 GitHub star. **Read it; do not depend on it.** |
| `markdown-ast-diff` | 15 | 2025-07-16 | True mdast-level diff + remark plugin, BULD algorithm ported from `lowdown`. Single maintainer, 2 stars, unproven. |
| `markdown-diff` | 8,080 | 2025-02-04 (dependabot only) | **Not AST-based** — word diff via jsdiff over `marked` tokens, emits `<ins>`/`<del>`. README says "WIP". |
| `unist-diff` | **8** | 2020-08-21 | Generic unist tree diff, **no node identity** — its own README says "not ideal but better than nothing". **Dead.** |
| `nono/mddiff` | n/a | **2015-02-20** | Markdown AST diff. **Dead** — 11 years untouched. |
| `htmldiff-js` | 146k | 2023-08-29 | Word-level HTML diff emitting `<ins>`/`<del>`. No types at all. Stale enough to have spawned forks. |
| `node-htmldiff` | 35k | 2023-08-03 | Same idea, typed, configurable "atomic tags". Feature-frozen but stable. |
| `davidar/pandiff` | n/a (CLI) | 2026-01-21 | 394 stars, TypeScript, MIT. Pandoc-AST prose diff; outputs **CriticMarkup**, HTML, PDF, `.docx` with Track Changes. Needs a Pandoc binary — wrong shape to embed, right shape as a **reference implementation**. |
| `PiotrTrzpil/markdown-diff-viewer` | n/a | 2026-06-11 | 11 stars. Block-level + character-level Markdown diff with a browser UI. Worth reading. |
| `CriticMarkup-toolkit` | n/a | **2021-03-04** | 841 stars, unmaintained 5 years. The *syntax* is alive; the toolkit is not. |
| `unified` / `remark-parse` | 50.6M / 47.0M | 2026-06-03 | Not a differ — the AST substrate. Actively maintained. |

Names that **do not exist on npm at all**, confirmed by direct registry lookup: `mdast-util-diff`, `mdast-diff`,
`remark-diff`, `hast-util-diff`.

**The category is empty, and that is the finding.** There is no maintained, adopted, React-native,
Markdown-semantic diff component. The three packages that are *architecturally* right — `@nicia-ai/prose-diff`,
`markdown-ast-diff`, `unist-diff` — have **9, 15, and 8 weekly downloads** between them, and one of them is dead.
Everything with real adoption is a code diff viewer. Plan to compose `remark` + `diff` + our own React rendering.
The good news is that this is a few hundred lines, not a platform; the bad news is that "just install a Markdown
diff component" is not an option and should not appear in any estimate.

### 2.4 What I would actually install

- **`diff` (jsdiff)** — the engine. Zero dependencies, 7.9 KB, 138M weekly.
- **`unified` / `remark-parse` / `mdast-util-*`** — block segmentation and rendering, and source offsets for free
  (§3.1).
- **`Intl.Segmenter`** (platform built-in, no dependency) for sentence boundaries — see the warning below.
- **Not** `react-diff-viewer*`, `react-diff-view`, `@git-diff-view/react`, `diff2html` — all code-shaped, all force
  a line-based intermediate, and the original `react-diff-viewer` is additionally capped at React ≤16.
- `@sanity/diff-match-patch` **only if** fuzzy re-anchoring (§3.5) actually gets built. Not speculatively.

> **Do not use jsdiff's `diffSentences` for real prose.** Reading `src/diff/sentence.ts`, the entire boundary rule
> is: `.`, `!`, or `?` immediately followed by whitespace — equivalent to `/(?<=[.!?])(\s+|$)/`. jsdiff's own README
> calls this naive and English-only and recommends `Intl.Segmenter({ granularity: 'sentence' })` combined with
> `diffArrays` instead. For a partnership proposal — full of "e.g.", "Inc.", "$1.5M", numbered clauses — the naive
> rule will mis-segment constantly. Use `Intl.Segmenter` + `diffArrays`. (Also note jsdiff v9 exports exactly eight
> diff functions; `diffTrimmedLines` and `diffCommas` no longer exist — trimming is now an `ignoreWhitespace`
> option on `diffLines`.)

*Remaining uncertainty:* nothing here was benchmarked on realistic proposal-length documents. jsdiff's `diffWords`
is O(nd), which is fine at these sizes, but that is reasoning, not measurement.

---

## 3. Stable section addressing

This is the sub-question that determines whether per-change accept/reject is possible, so it gets the most space.

### 3.0 The reframe: two problems, not one

The ticket asks "how does a patch target a section when earlier sections have already shifted?" That phrasing
merges two problems with very different difficulty and very different likelihood:

**Problem A — intra-review shift.** Certain. All changes in a run are computed against one base version. The moment
the reviewer accepts change #3, changes #4..#n hold offsets into a document that no longer exists. This happens on
every single review with more than one change.

**Problem B — inter-version drift.** Contingent. The base document changed between when the changeset was computed
and when it is applied — because the human edited it during the run, or because the run was resumed against a newer
version.

**Problem A dissolves completely** if you never mutate the document during review. Accepting a change writes a
*decision*, not a document. The rendered result is a pure function of (base, changes, decisions). All changes stay
addressed against the same immutable base for the entire review; nothing ever shifts. Materialisation is a single
right-to-left splice pass. This is not a workaround — it is what Google Docs does (§5.1) and what GitHub does
(§5.2), and it is the single most important structural decision in this document.

**Problem B is the genuinely hard one**, and slice 0 can largely design it out: the worker runs on a *copy* (already
a standing constraint), and the review UI can refuse to materialise if the base's content hash no longer matches.
Refusing loudly is a correct answer. Silently misapplying is not.

Everything below is therefore evaluated against Problem B, since Problem A has a structural answer.

### 3.1 Option A — character offsets into a hashed base version

Address each change as `{ baseVersionId, baseContentHash, start, end }`, offsets into the exact base bytes.

*Strengths.* Exact, cheap, unambiguous. Gives a total order for free, which makes non-overlap trivially checkable
and makes right-to-left splicing correct by construction. Comes free from the parser: unist `Point` carries an
optional 0-indexed `offset` field ("The `offset` field (0-indexed integer) represents a character in a source
file"), and remark populates it for parsed nodes — so every mdast block already knows its byte range in the source.

*Failure cases.*
- **Silent catastrophe under drift.** If the base moved, offsets still *resolve* — to the wrong text. This is the
  worst failure mode available: no error, wrong document. Mitigated only by the content-hash precondition, which
  must be enforced, not documented.
- **Useless for human inspection.** `{start: 4127, end: 4396}` in a ledger tells a debugging human nothing.
- **Brittle to normalisation.** Line-ending conversion, trailing-whitespace trimming, or a prettier pass on the
  Markdown invalidates every offset in the changeset.
- **Does not survive a round trip through a model.** If you ever hand offsets to an LLM and ask it to return them,
  it will get them wrong. Offsets are for deterministic code only.

*Note:* unist's spec says `position` "must not be present if a node is generated" — so any node your own code
synthesises has no offsets. Do not build a scheme that assumes every node has them.

### 3.2 Option B — heading paths

Address as `["Partnership terms", "Pricing"]`, resolved by walking mdast headings. Human-readable, and the obvious
first idea.

*Failure cases — this option is worse than it looks.*
- **Wrong granularity, fatally.** A heading path addresses a *section*. Per-change accept/reject needs to address
  two independent changes *inside* one section. Heading paths cannot express that, so they cannot support the
  feature the ticket is asking about. This alone disqualifies them as the primary key.
- **Renaming a heading breaks the path** — and for a partnership proposal, "rename the section heading" is a
  *likely* proposed edit, not an edge case. The addressing scheme breaks exactly when the worker does the thing
  it was asked to do.
- **Duplicate headings are ambiguous, and disambiguation is positional.** GitHub's slug algorithm resolves
  collisions with ordinal suffixes (`overview`, `overview-1`, `overview-2`, in document order). Inserting a new
  duplicate heading *earlier* in the document renumbers every later one. So the "stable" id is a function of what
  came before it — which is precisely the property we were trying to avoid.
- **Preamble is unaddressable.** Content before the first heading has no path.
- **Level changes reparent everything.** Promoting `###` to `##` silently moves every following block to a
  different path.

*Verdict:* useful as a **display grouping and navigation affordance** ("3 changes in Pricing"), never as the
resolution key. Keep it on the record as denormalised metadata; do not resolve against it.

### 3.3 Option C — injected stable block ids

Notion-style: give every block an identity, e.g. `<!-- pid: blk_7f3a -->` or a `{#blk_7f3a}` attribute.

*Strengths.* Genuinely stable across reordering and across text edits *within* a block. Makes moves detectable for
free. This is the right answer for a system where the editor is the only writer.

*Failure cases.*
- **The model is the killer.** The worker is an LLM emitting Markdown. Asking it to faithfully preserve opaque ids
  through a rewrite is asking for the failure mode that LLMs are worst at: it will drop them, duplicate them,
  reorder them, or invent them. This is *testable* — and worth testing before committing — but the prior is bad.
- **Split and merge are undefined.** One paragraph becomes two: which keeps the id? Two merge into one: which id
  survives? Every real editing session does this.
- **It pollutes the artefact.** A partnership proposal that a human might export, email, or open in another editor
  now carries HTML comments. The map commits to "Markdown documents"; ids fight that.
- **Ingestion just moves the problem.** Any document not authored inside the system needs ids assigned, and
  re-ingesting an externally-edited copy requires matching new blocks to old ids — which is the anchoring problem
  again, one layer down.

*Verdict:* correct for a Notion; wrong for slice 0, primarily because of the LLM round trip.

### 3.4 Option D — quote anchors (`prefix` / `exact` / `suffix`)

Address by quoting the text and its surrounding context. Three independent lineages converged on this, which is the
strongest signal in this whole document:

- **W3C Web Annotation Data Model** defines `TextQuoteSelector` with `exact` ("A copy of the text which is being
  selected, after normalization"), `prefix` ("A snippet of text that occurs immediately before the text which is
  being selected"), and `suffix`. It explicitly blesses layering: "Multiple Selectors _SHOULD_ select the same
  content, however some Selectors will not have the same precision as others."
- **Hypothesis** ships exactly this in production for annotating arbitrary, mutating web pages. They abandoned
  XPath ranges because it "is vulnerable to changes to the structure of the page that render stored XPaths
  invalid," and now run a four-stage fallback: range selector → position selector → fuzzy match on
  prefix+suffix context → fuzzy match on the quote alone. They store **32 characters** of prefix and suffix, and
  use a modified `diff-match-patch` (Bitap) for the fuzzy stages.
- **Anthropic's text editor tool** — the mainstream way an LLM addresses an edit today — is `str_replace` with
  `old_str` that "must match exactly, including whitespace and indentation," plus the documented guidance "Make
  sure replacements match exactly one location to avoid unintended edits," and a defined error on ambiguity:
  `"Error: Found 3 matches for replacement text. Please provide more context to make a unique match."`

That last one is the same algorithm as `TextQuoteSelector` reinvented for tool calls: quote the target, add context
until unique, fail loudly on ambiguity.

*Failure cases.*
- **Non-uniqueness is common in proposals specifically.** Boilerplate recurs — "Deliverables", "Payment terms",
  "We will provide". `prefix`/`suffix` fix most of it; a position hint fixes most of the rest; neither is a
  guarantee.
- **Fuzzy thresholds are a tuning liability.** `diff-match-patch` exposes `Match_Threshold` (default 0.5; "If
  Match_Threshold is closer to 0, the requirements for accuracy increase. If closer to 1 then it is more likely
  that a match will be found") and `Match_Distance` (default 1000; "An exact letter match which is 'distance'
  characters away from the fuzzy location would score as a complete mismatch"). Loosen them and you get silent
  misapplication, which is worse than failure. `patch_apply` returns a boolean array of which patches applied, and
  the upstream docs themselves warn the results are "not too useful since large patches may get broken up
  internally."
- **Anchor fails when the quoted text itself was edited** — but note this is the *correct* behaviour. You want to
  refuse, not guess.
- **Normalisation is a whole sub-problem.** Whitespace, smart quotes, Unicode composition. W3C is explicit that
  selection "_MUST_ be in terms of unicode code points... not in terms of code units."
- **Cost.** O(n·m) per anchor. Irrelevant at proposal size; relevant if you ever anchor thousands of changes.

*Verdict:* the right **verifier**, and the right thing to log for humans. Not the right primary key when you already
have exact offsets against a hashed base.

### 3.5 Option E — CRDT (Yjs / Automerge)

The only scheme that is *correct* under genuine concurrent editing. Yjs `RelativePosition` is anchored to CRDT item
identity rather than an index — the docs are explicit that "normal index-positions (expressed as integers) are not
convenient to use because the index-range is invalidated as soon as a remote change manipulates the document."
Automerge's `Cursor` is the same idea: "a relative position, 'before character X', rather than an absolute
position."

*Failure cases — and they are decisive for this project.*
- **The worker does not emit CRDT operations.** It emits text. To get ops you must diff the text and *synthesise*
  them — which reintroduces the whole matching problem at the boundary, and gives you false identity: a rewritten
  sentence becomes delete+insert with no stable identity anyway. The CRDT's core guarantee evaporates at exactly
  the seam where you needed it.
- **Both CRDTs still return "anchor lost."** Yjs `createAbsolutePositionFromRelativePosition` returns `null` "if
  the relative position cannot be referenced, or the type is deleted." So even the correct answer sometimes says
  "I don't know" — it just says it honestly. Which means you need the fallback UX regardless.
- **It costs you portable Markdown.** The source of truth becomes an opaque binary doc. That fights the stack
  decision ("Markdown documents") and complicates "execution is reversible: copies and versions only."
- **Enormous conceptual weight for slice 0,** which explicitly forbids abstractions not needed to test
  intention-preserving continuation.

*Verdict:* the right answer for real-time multiplayer editing. Not the problem slice 0 has. Revisit if and when two
humans edit the same artefact simultaneously.

### 3.6 Option F — git-style patch with fuzz

`git apply` / GNU `patch` with context lines and a fuzz factor. Proven at enormous scale.

*Failure cases.* Line-granular, so it inherits every problem in the §1 table unless you enforce semantic line
breaks (§6.4). Fuzz silently misapplies — the same objection as loose fuzzy thresholds. And a git-backed store
buys version identity cheaply but gives you nothing at all for per-change addressing *within* a version, which is
where the difficulty is.

*Verdict:* reasonable for **versioning** (see #12), irrelevant for addressing.

### 3.7 Recommended scheme

Layer three things, per the W3C robustness pattern:

```
Anchor = {
  // 1. RESOLUTION KEY — exact, deterministic, machine-only
  baseVersionId: string
  start: number          // char offset into base, inclusive
  end: number            // char offset into base, exclusive

  // 2. VERIFIER — W3C TextQuoteSelector shape, ~32 chars of context (Hypothesis' number)
  prefix: string
  exact: string          // MUST equal base.slice(start, end)
  suffix: string

  // 3. PRECONDITION — enforced, not documented
  baseContentHash: string  // sha256 of the exact base bytes
}
```

Resolution order: verify `baseContentHash` → if it matches, use offsets and assert `exact` still matches → if the
hash does not match, **do not fall back to fuzzy matching by default**; surface "the document moved, re-run or
review manually." Keep fuzzy re-anchoring as an explicit, opt-in, clearly-labelled recovery path, never as a silent
default. And carry `headingPath: string[]` alongside as denormalised metadata for grouping and navigation only —
never resolve against it.

The reason this is cheap is §3.0: with a decisions-not-mutations review model, the hash matches for the entire
review, so the verifier and the recovery path are load-bearing only in the rare Problem-B case.

---

## 4. Per-change accept/reject: data model sketch

### 4.1 The core invariant

> **Review produces decisions, never documents.** The reviewed artefact is a pure function
> `materialise(base, changes, decisions)`.

Everything good follows from this:

- Changes never need re-addressing mid-review — the base is immutable for the whole session.
- Accept order is commutative; there is no "accept #3 then #5 differs from #5 then #3."
- Undo is a verdict flip, not an inverse patch.
- The three views the user needs — *inline*, *preview accepted*, *preview rejected* — are the **same fold with
  different decision maps**. That is not a coincidence; it is exactly Google's `SuggestionsViewMode` (§5.1).
- Append-only falls out naturally: decisions are inserted, never updated. Current verdict = latest row per
  `changeId`. This satisfies the ledger constraint in #12 without a special mechanism.

### 4.2 Types

```ts
/** Immutable. Everything in it is addressed against exactly one base version. */
interface Changeset {
  id: string
  runId: string                 // the AgentRun that produced it
  baseVersionId: string         // ArtifactVersion this was diffed against
  baseContentHash: string       // precondition for materialisation
  changes: ProposedChange[]     // sorted by anchor.start, guaranteed non-overlapping
  summary: string               // "Tightened pricing, added a scope carve-out, flagged one open question"
}

interface ProposedChange {
  id: string
  ordinal: number               // stable display order == document order
  kind: 'insert' | 'delete' | 'replace' | 'move'
  anchor: Anchor                // §3.7
  before: string                // exact base text in [start, end) — redundant on purpose
  after: string                 // replacement text ('' for a delete)

  // --- the one-minute layer ---
  summary: string               // one line, imperative, human: "Cut the boilerplate intro"
  reason: string                // WHY. Attribution. One sentence.
  significance: 'substantive' | 'editorial'   // lets the UI collapse typo-level noise by default

  // --- provenance (walks back to the ledger) ---
  actionRecordId: string
  sourceRefs: string[]          // approved sources this change leaned on
  headingPath: string[]         // display grouping ONLY — never used to resolve
}

/** Append-only. Current verdict for a change = the most recent row. */
interface ReviewDecision {
  id: string
  changeId: string
  verdict: 'accepted' | 'rejected' | 'edited'
  editedText?: string           // present iff verdict === 'edited'
  decidedAt: Date
  decidedBy: string
}
```

`'edited'` is not decoration. **H2 scores generated work as accepted, edited, or rejected** — if the model collapses
edit into accept, H2 is unmeasurable. The data model has to carry the distinction the hypothesis is testing.

### 4.3 Materialisation

```ts
function materialise(
  base: string,
  changes: ProposedChange[],
  decisions: Map<string, ReviewDecision>,
): string {
  assertHash(base, changeset.baseContentHash)   // precondition, throws
  assertNonOverlapping(changes)                  // invariant, throws

  const applied = changes
    .filter(c => decisions.get(c.id)?.verdict !== 'rejected' && decisions.has(c.id))
    .sort((a, b) => b.anchor.start - a.anchor.start)   // DESCENDING — the whole trick

  let out = base
  for (const c of applied) {
    if (out.slice(c.anchor.start, c.anchor.end) !== c.before) throw new AnchorDriftError(c.id)
    const text = decisions.get(c.id)!.editedText ?? c.after
    out = out.slice(0, c.anchor.start) + text + out.slice(c.anchor.end)
  }
  return out
}
```

Descending order is why no position remapping is ever needed: splicing at a high offset cannot disturb a lower one.
Single pass, no `Mapping`, no rebasing, no CRDT.

### 4.4 The non-overlap invariant — and how to actually get it

`assertNonOverlapping` is doing real work. Overlapping changes break commutativity and make "accept A but not B"
ill-defined. You do not get non-overlap by asking nicely; you get it **by construction**:

> Run **one** diff over the whole document and group the resulting opcodes into changes. Never let the model emit a
> set of independent patches.

Which leads to the strongest process recommendation here:

> **The model proposes prose. Deterministic code computes the changeset.**

The worker returns rewritten text (whole document, or better, one bounded section). A deterministic differ turns
that into non-overlapping, exactly-addressed, hash-verified changes. This:

- eliminates the entire "the model emitted a patch that does not apply" failure class, which is the dominant
  failure mode of `str_replace`-style editing;
- makes the non-overlap invariant free rather than checked;
- is the literal shape of the standing constraint *models propose; deterministic code authorizes*.

**The seam this creates, stated honestly:** if the differ computes the changes, the model never named them, so
where does per-change `reason` come from? Two options, neither clean:

1. **Two-field response.** The worker returns `{ newText, rationales: [{ quote, why }] }` and rationales are matched
   to computed changes by span overlap. Unmatched rationales degrade to changeset-level notes. Lossy but workable.
2. **Bounded scope per run.** The policy gate constrains one action to one section. Then a run produces one
   section rewrite and one rationale, and attribution is exact by construction. Fewer, coarser changes — but for
   slice 0 that is a feature, and it also directly attacks the all-red problem (§6.5).

I recommend (2) for slice 0 and flag (1) as the thing to build when scope widens. This is a real open question, not
a solved one — see §9.

### 4.5 Attribution without clutter

The ticket asks how to show *why* inline without cluttering. The answer from both reference products (§5) is
**progressive disclosure keyed to the change**, never inline in the text flow:

- `reason` lives on the `ProposedChange`, not in the document text.
- Always visible in the **summary list** (which is where the one-minute promise is actually kept).
- In the diff, surfaced on hover *and* on keyboard focus — focus, not just hover, or it is inaccessible.
- Not `<ins cite=...>` / `<del datetime=...>`: the HTML spec says those attributes are "primarily intended for
  private use (e.g., by server-side scripts), not for readers." Use `aria-details` pointing at the reason block
  instead (§7).

---

## 5. How Google Docs and GitHub actually model this

### 5.1 Google Docs — suggestions are flagged ranges over one live document

The API structure is more informative than the UI. There is **no** `SuggestedInsertion` object; suggestions are
**id arrays on the content elements themselves**. A `TextRun` carries:

- `suggestedInsertionIds[]` — *"A `TextRun` may have multiple insertion IDs if it's a nested suggested change. If
  empty, then this is not a suggested insertion."*
- `suggestedDeletionIds[]` — *"If empty, then there are no suggested deletions of this content."*
- `suggestedTextStyleChanges` — a map *"keyed by suggestion ID."*

The same pattern repeats on every leaf type (`AutoText`, `PageBreak`, `InlineObjectElement`, `RichLink`, …), and
paragraphs carry the parallel `suggestedParagraphStyleChanges`.

Three things follow, and all three are directly load-bearing for us:

1. **`suggestionId` is per-change**, not per-user or per-session. It is the addressing unit, and it ties a content
   range to its style changes.
2. **Deleted text stays in the document, flagged.** A suggested deletion is not removed and stored as a diff — the
   content remains, marked. There is exactly one document body at all times.
3. **The accepted/rejected views are computed projections, not stored documents.** `SuggestionsViewMode`:
   - `SUGGESTIONS_INLINE` — *"The returned document has suggestions inline. Suggested changes will be
     differentiated from base content within the document."*
   - `PREVIEW_SUGGESTIONS_ACCEPTED` — *"The returned document is a preview with all suggested changes accepted."*
   - `PREVIEW_WITHOUT_SUGGESTIONS` — *"The returned document is a preview with all suggested changes rejected if
     there are any suggestions in the document."*
   - `DEFAULT_FOR_CURRENT_ACCESS` — falls back to `PREVIEW_WITHOUT_SUGGESTIONS` for view-only users.

   Notably, indexes are only self-consistent for further edits when fetched with `SUGGESTIONS_INLINE` — i.e. the
   inline view is the canonical coordinate space and the previews are derived. **This is exactly the
   `materialise(base, changes, decisions)` fold in §4.3, with three different decision maps.** Adopting it means we
   are following a design that has survived at Google Docs' scale.

In the UI: Editing → **Suggesting**; *"You'll see your change in a new color. Anything you delete will be crossed
out"*; per-suggestion Accept/Reject; **Tools → Review suggested edits → Accept all / Reject all**; and a preview
dropdown that maps 1:1 onto the two preview view modes.

**Two things worth knowing before copying Google.** First, for most of the API's life you could *read* suggestions
but not create, accept, or reject them programmatically. That changed — but only inside the **Workspace Developer
Preview**: `WriteControl.writeMode: SUGGEST` (*"Apply all updates as suggestions"*) and
`AcceptSuggestionRequest` / `RejectSuggestionRequest` all carry the badge *"Available as part of the Google
Workspace Developer Preview Program"*, and `SUGGEST` mode does not support all request types. Second, the sub-agent
could not verify from primary sources what happens to a **comment attached to a suggestion** when that suggestion
is accepted or rejected, nor whether accept/reject is owner-restricted. Both are unresolved.

### 5.2 GitHub — comments anchored to a commit, and honest about going stale

GitHub's model is the opposite of Google's: the document *does* move, so comments are anchored to a specific commit
and are allowed to become invalid.

Review comment fields (REST):

- `path` — *"The relative path to the file that necessitates a comment."*
- `position` — **deprecated**. *"This parameter is closing down. Use line instead... the line just below the `@@`
  line is position 1, the next line is position 2..."*
- `line` — *"The line of the blob in the pull request diff that the comment applies to. For a multi-line comment,
  the last line of the range."* Plus `start_line`, `side` (LEFT/RIGHT), `start_side`.
- `commit_id` — *"The SHA of the commit needing a comment."*
- `original_position`, `original_line`, `original_start_line`, `original_commit_id`, `diff_hunk` — the frozen
  location as of creation time.

The `original_*` family is the whole mechanism, and it is worth stating plainly: **GitHub does not try to keep
comments correctly attached. It freezes the original anchor and marks the comment outdated.** GraphQL exposes this
as a first-class boolean on `PullRequestReviewComment`: `outdated` — *"Identifies when the comment body is
outdated."*

I want to be precise about the confidence here: the *existence* of `outdated` and of the `original_*` fields is
documented and verified. The **exact trigger** is not — GitHub's REST docs mention outdated comments only in
passing (*"you can see which conversations are unresolved, resolved, and outdated"*) and never explain the
mechanism. Community reports suggest recalculation is closer to per-file-diff-rebuild than per-line semantic
tracking. Treat the mechanism as inferred. Also note that `diff_hunk`, `original_commit_id`, `original_line`, and
`original_start_line` appear in the schema with **types but no prose descriptions at all** — GitHub's own reference
does not define them.

**Suggested changes are markdown convention, not structure.** The ` ```suggestion ` fence lives inside the comment
`body` string; there is no suggestion object in REST or GraphQL. Programmatic consumers must parse the fence
themselves. Granularity: *"To apply the change in its own commit, click **Commit suggestion**"*, or *"click **Add
suggestion to batch**... click **Commit suggestions**"* — per-suggestion or arbitrary-subset-batched, one commit
either way. There is no accept/reject for a plain comment at all; comments are only resolved/unresolved/outdated.

Review states: `PENDING` (*"A review that has not yet been submitted"*), `COMMENTED` (*"An informational review"*),
`APPROVED` (*"A review allowing the pull request to merge"*), `CHANGES_REQUESTED` (*"A review blocking the pull
request from merging"*), `DISMISSED`.

### 5.3 Word OOXML — inline revision marks

Worth one paragraph because it is structurally the third possible answer. Word embeds revisions **in the document
flow**: `w:ins` is a real element siding with `w:r` runs — *"This element specifies that the inline-level content
contained within it shall be treated as inserted content which has been tracked as a revision."*

```xml
<w:p>
  <w:r><w:t>Some</w:t></w:r>
  <w:ins w:id="0" w:author="Joe Smith" w:date="2006-03-31T12:50:00Z">
    <w:r><w:t>text</w:t></w:r>
  </w:ins>
</w:p>
```

`w:id` is the per-change id (Google's `suggestionId` by another name); `w:author` and `w:date` carry attribution.
`w:del` is symmetric, keeping deleted text present as `w:delText` — again, content stays and gets flagged.
Nesting is explicitly permitted, which is how "someone deleted text that was itself an unaccepted insertion" is
represented.

**This is the CriticMarkup shape** (`{++insert++}`, `{--delete--}`, `{~~old~>new~~}`, `{>>comment<<}`) — the
Markdown-native version of the same idea, and what `pandiff` emits. It is genuinely tempting because it keeps
everything in one file. I am recommending against it as the *storage* model (§8) for one reason: an inline
representation makes the changeset and the document the same object, which destroys the property in §4.1 that made
per-change accept/reject easy. It remains a good **export/interchange** format.

### 5.4 What the three have in common

| | Google Docs | GitHub | Word OOXML |
|---|---|---|---|
| Change identity | `suggestionId`, per-change | comment id + `original_commit_id` | `w:id`, per-change |
| Deleted content | stays, flagged | lives in the base commit | stays, as `w:delText` |
| Addressing | range in the one live doc | frozen line in a frozen commit | structural position, inline |
| Under drift | n/a — doc doesn't fork | marks `outdated`, does not re-attach | n/a |
| Accepted view | computed projection | new commit | computed projection |
| Granularity | per suggestion | per suggestion, batchable | per revision mark |

Two lessons: **every one of them keeps a per-change id and computes the accepted view rather than storing it**, and
**the one system that faces drift refuses to guess** — it flags `outdated` and hands the problem to a human. Both
go straight into §8.

---

## 6. Prose vs. code: what the evidence actually says

### 6.1 State of the evidence — read this before the rest

I want to be straight about this rather than dress it up. **There is no settled empirical literature on prose diff
comprehension.** Searching for controlled comparisons of side-by-side vs. unified for prose returns essentially
nothing; even for *code* the picture is thin. What exists is:

- one directly relevant CHI paper (§6.2),
- one adjacent CHI paper about authorship over time, not change review,
- strong *product* evidence from systems that diff prose at enormous scale (§6.3),
- and code-review evidence that generalises plausibly but not rigorously (§6.6).

Everything below is labelled by which of those it is. Where I am extrapolating, I say so.

### 6.2 The one direct study: Diffamation (CHI 2010)

Chevalier, Dragicevic, Bezerianos & Fekete, *"Using text animated transitions to support navigation in document
histories,"* CHI '10, pp. 683–692. The system animates text smoothly between revisions rather than showing a static
diff. Their controlled study "suggests that smooth text animation allows users to track changes in the evolution of
textual documents more effectively than flipping pages."

Two honest caveats. First, the compared baseline was *flipping between revisions*, not a good static diff — so this
is not evidence that animation beats a well-designed diff. Second, I could not retrieve the paper's participant
count or effect sizes (the HAL mirror was behind an access wall), so I am relying on the authors' own project-page
summary.

What I take from it, cautiously: **for prose, the reader's problem is maintaining continuity of meaning across
versions, and techniques that preserve continuity help.** Static red/green marks destroy continuity — you cannot
read the new text as prose because the old text is interleaved with it. That is a real argument for making
"preview accepted" a first-class, one-keystroke view rather than a buried option, which happens to be free under
§4.3.

DocuViz (Wang, Olson, Zhang, Nguyen & Olson, CHI '15) is often cited nearby but answers a different question — it
visualises *who wrote what, when* across a Google Doc's whole history, for finding "seismic activity." Useful
inspiration for a shift report; not evidence about change review.

### 6.3 Product evidence: everyone who diffs prose at scale abandons the source diff

**Wikipedia / wikidiff2.** MediaWiki's diff engine does word-level diffing, and — critically — **detects moved
paragraphs**. The method: compare paragraphs classified as additions against those classified as deletions,
compute "the ratio of the changed and unchanged parts for each pair," and above a similarity threshold render them
as *moved* rather than as delete+insert. It then runs word-level comparison *inside* matched moved paragraphs to
surface edits that "have been skipped before." Stated motivation: *"Spotting additional changes in moved paragraphs
can be quite difficult."* Note the WMDE team's own candour about the threshold: *"the threshold used was just a
wild guess that worked well with the quite homogenous test set but did not in other cases,"* later "tweaked by
iterating over our tests." Expect to tune this empirically; there is no principled value.

**MediaWiki VisualEditor.** Renders a **visual diff** — the rendered document with changes marked — alongside the
wikitext diff. Where a source diff shows a swapped paragraph as *"a paragraph was deleted and an entirely new
paragraph was added,"* the visual diff identifies "that this is what occurred." Formatting changes appear "in notes
on the side." Rationale: editors can "directly see the changes they and others have made without needing to
understand wikitext."

**GitHub's rendered prose diffs (2014).** GitHub — a company whose entire product is code diffs — shipped a
*separate rendered view* for prose files, toggled by a "rendered" button. Motivation: *"Building great software is
about more than code. Whether you're writing docs, planning development, or blogging what you've learned, better
prose makes for better products."* Notable rendering detail: non-text changes (e.g. a changed URL) appear with "a
low-key dotted underline," revealed on hover — an early instance of the progressive-disclosure pattern in §4.5.

**VS Code.** For accessibility specifically, VS Code restructures its side-by-side diff into a **unified** view
(§7.4). A second, independent product decision toward linearising prose-ish diffs.

Four independent systems, same conclusion: **the source diff is the wrong artefact for prose; render the document
and mark the changes on it.**

### 6.4 The cheapest single intervention: semantic line breaks

If the artefact is stored as Markdown, the **authoring convention matters more than the diff library.** With
hard-wrapped paragraphs, a one-word change marks the whole paragraph as changed in any line-based tool. With one
sentence per line, a one-word change is a one-line diff.

The convention traces to Brian Kernighan, *UNIX for Beginners* (Bell Labs TM 74-1273-18, 1974-10-29): start each
sentence on a new line, break at commas and semicolons, because "most people change documents by rewriting phrases
and adding, deleting and rearranging sentences," so "these precautions simplify any editing you have to do later."

For Propositum this is nearly free and compounds with everything else: **normalise every artefact to one sentence
per line on write.** It makes line diffs usable as a cheap fallback, makes changes naturally sentence-shaped
(which is the unit humans review prose in), and makes the diff smaller without any algorithmic work.

The caveat: it changes the bytes of the document, so normalisation must happen *before* the base hash is taken, and
must be idempotent. If normalisation runs after anchors are computed, every offset is invalidated (§3.1).

Complementary, if you ever shell out to git: `--word-diff-regex=<regex>` "uses a regex to decide what a word is
instead of considering runs of non-whitespace to be a word," configurable per-filetype via a `.gitattributes` diff
driver.

### 6.5 Granularity: the readable-diff paradox

Two authorities land in the same place from different directions:

**diff-match-patch** ships `diff_cleanupSemantic` explicitly for human readability: *"If a diff is to be
human-readable, it should be passed to diff_cleanupSemantic."* Its canonical example: diffing "mouse" against
"sofas" naively yields `[(-1,"m"),(+1,"s"),(0,"o"),(-1,"u"),(+1,"fa"),(0,"s"),(-1,"e")]` — technically minimal,
humanly unreadable — and semantic cleanup collapses it to `[(-1,"mouse"),(+1,"sofas")]`. There is a sibling,
`diff_cleanupEfficiency`, for machine processing.

**prosemirror-changeset** ships `simplifyChanges`, documented on the same principle: it *"makes the assumption that
having both insertions and deletions within a word is confusing, and, when such changes occur without a word
boundary between them, they should be expanded to cover the entire set of words (in the new document) they touch,"*
with an exception for single-character replacements. (We take the rule, not the library — §2.1, trap 2.)

**The paradox:** a maximally-matched diff is minimal but shredded; a coalesced diff is readable but *looks
redder*. You cannot optimise both. The resolution both libraries reach is **snap to word boundaries** — never
show a change smaller than a word, never split a word.

I would push one step further for prose and add a **similarity floor**:

> If a block's similarity to its predecessor falls below a threshold, stop diffing it. Label it **"rewritten"** and
> show old and new as two whole blocks.

This is the honest rendering of a rewrite, and it reads faster than a shredded word diff of two texts that share
only function words. It is the same machinery as wikidiff2's move detection, applied with the opposite polarity.
The threshold will be a guess; wikidiff2's authors admit theirs was too.

Recommended granularity stack, coarsest first:
1. **Block** (mdast node) — align; detect moves by similarity, per wikidiff2.
2. **Sentence** — the unit humans review prose in; free if §6.4 is adopted. Segment with `Intl.Segmenter`, not
   jsdiff's `diffSentences` (§2.4).
3. **Word** — within changed sentences only, snapped to boundaries.
4. **Never sub-word.** Both libraries above independently say don't.

### 6.6 Volume: extrapolated, and labelled as such

The clearest quantitative evidence about review comprehension is from **code** review, and I am extrapolating:

- The SmartBear/Cisco study (2,500 reviews, 3.2M LOC, 10 months) found defect detection is best at **200–400 lines
  per sitting** and "once reviews grow past 400 lines, defect detection starts to drop off," with detection rates
  also falling after 60–90 minutes of continuous review.
- Sadowski et al., *"Modern Code Review: A Case Study at Google"* (ICSE-SEIP 2018; 12 interviews, 44 survey
  respondents, 9M reviewed changes) found "the majority of changes are small, have one reviewer and no comments
  other than the authorization to commit," with 70% committed within 24 hours.

The direction is unambiguous and matches intuition: **review quality collapses with change volume.** For a
one-minute re-entry target, the operative number is not 400 lines — it is closer to *a handful of changes*. Which
means the all-red problem is fundamentally solved **upstream, by the policy gate**, not downstream by the differ.
Bound what one action may touch.

I would not cite the specific 200–400 figure as applying to prose. It is code, from 2006, at Cisco.

### 6.7 Side-by-side vs. inline, for prose

No study I could find answers this for prose. Reasoning from properties plus the product evidence:

**Inline (unified) should be the default for prose**, because —
- prose reflows; side-by-side alignment requires stable line correspondence, which prose does not have;
- prose is read linearly for sense, and two columns force a saccade mid-sentence at exactly the moment the reader
  is building meaning;
- the "old vs new" juxtaposition that makes side-by-side valuable for code is much less valuable when the reader's
  real question is "does the new text read well," which is answered by *preview accepted*, not by the diff;
- side-by-side is worse for assistive technology (§7.4), and GitHub itself already defaults to unified on narrow
  viewports.

Confidence: moderate. This is a well-supported inference, not a measured result. If it matters, prototype both
against the fixture corpus — that is what #13/`prototype` is for.

---

## 7. Accessibility

Colour-only diffs fail WCAG **1.4.1 Use of Color**, which is **Level A** — a floor, not a stretch goal.

### 7.1 The criteria that bind

- **1.4.1 Use of Color (A):** *"Color is not used as the only visual means of conveying information, indicating an
  action, prompting a response, or distinguishing a visual element."* The Understanding document names this exact
  pattern — comparative data distinguished only by hue — as a failure, and lists sufficient alternatives: text
  labels, icons, patterns, numbers, contrast/lightness differences.
- **1.3.1 Info and Relationships (A):** *"Information, structure, and relationships conveyed through presentation
  can be programmatically determined or are available in text."* Failure technique **F2** is directly on point: a
  diff conveying added/removed purely through CSS, with no semantic markup, fails 1.3.1.
- **1.4.3 Contrast (Minimum, AA):** text on a diff highlight must still hit 4.5:1 (3:1 for large text). Check in
  *both* themes — a highlight tuned for light mode routinely fails in dark.
- **1.3.2 Meaningful Sequence (A):** bears directly on side-by-side. A two-column layout built with grid/flex reads
  in DOM order, which can interleave or scramble old and new.

*Unresolved:* whether a diff highlight background is in scope for **1.4.11 Non-text Contrast (3:1)** is genuinely
contested — its Understanding document scopes the criterion to UI components and graphical objects, and a passive
highlight behind static prose is not cleanly either. No W3C source rules on it. Be conservative (aim ~3:1 against
the page) because automated tools may flag it, but do not treat it as settled.

### 7.2 `<ins>` / `<del>` are necessary and not sufficient

Per the HTML spec, `<ins>` "represents an addition to the document" and `<del>` "represents a removal." They have a
transparent content model and **should not cross implied paragraph boundaries** — wrap each affected paragraph
separately. The `cite` and `datetime` attributes are explicitly *"primarily intended for private use (e.g., by
server-side scripts), not for readers"* — so they are not an attribution mechanism for users.

**The critical finding.** MDN states, identically on both element pages:

> "The presence of the `del` element is not announced by most screen reading technology in its default
> configuration."
> "The presence of the `ins` element is not announced by most screen reading technology in its default
> configuration."

Corroborated from three independent directions: NVDA added support **Chrome-only**, via IAccessible2
`content_deletion` / `content_insertion` role mappings; practitioner testing reports VoiceOver and Narrator do not
announce them meaningfully, and `<s>` is never announced as struck-through by any major screen reader; and a
legal-redlining accessibility writeup reports JAWS has supported `<del>` since 2022 *but only when the user presses
Insert+F to request formatting information* — which is not "announced by default."

MDN's recommended workaround is visually-hidden generated content:

```css
del::before, del::after,
ins::before, ins::after {
  clip-path: inset(100%);
  clip: rect(1px, 1px, 1px, 1px);
  height: 1px; width: 1px;
  overflow: hidden; position: absolute; white-space: nowrap;
}
del::before { content: " [deletion start] "; }
del::after  { content: " [deletion end] "; }
```

With MDN's own caveat, which matters for a word-level prose diff: *"Some people who use screen readers deliberately
disable announcing content that creates extra verbosity. Because of this, it is important to not abuse this
technique and only apply it in situations where not knowing content has been deleted would adversely affect
understanding."* **Apply it per change-region, never per token.**

### 7.3 ARIA roles

`role="insertion"` / `role="deletion"` are in **WAI-ARIA 1.2** (*"A deletion contains content that is marked as
removed or content that is being suggested for removal"*). Two constraints:

- **Name is prohibited** on both — `aria-label` / `aria-labelledby` cannot be used. Any announced text must come
  from content or visually-hidden text, i.e. §7.2's technique regardless.
- MDN prefers the HTML elements: *"Using the `<ins>` and `<del>` element will automatically communicate a section
  has a role of insertion or deletion. If at all possible, prefer using the HTML elements."*

`role="suggestion"` (wrapping a paired deletion+insertion — exactly our `replace` change kind) is **ARIA 1.3
editor's draft**, in a spec carrying the note *"This work is being replaced with changes to the core of ARIA."* Do
not depend on it. Relatedly: GitHub was asked to adopt these roles for PR diffs and a maintainer replied in May 2024
that it is *"not currently being actively worked on."*

Do **not** use `<mark>` / `role="mark"` — wrong semantics (reference highlighting, not change state).
`aria-description` is also 1.3-draft; MDN advises `aria-describedby` instead. For attribution, `aria-details`
pointing at the reason block is the right mechanism (§4.5).

*Uncertainty:* the precise NVDA/JAWS/VoiceOver support matrix for the ARIA roles specifically (as distinct from the
HTML elements) could not be verified against a11ysupport.io directly. Treat as directional.

### 7.4 Layout, navigation, and announcements

**VS Code is the strongest product evidence on layout.** It ships a dedicated **Accessible Diff Viewer** (F7 /
Shift+F7) that presents diffs *in a unified patch format* rather than the default side-by-side panes, navigable
with Up/Down, Enter to return focus to the modified pane, Escape to dismiss. It layers **audio cues** for "diff
line inserted" (`+`), "deleted" (`-`), and "modified" (`+-`). A real product deliberately **linearises a
side-by-side diff for assistive technology** rather than trying to make two panes readable. GitHub's parallel move
is a split/unified toggle plus hunk-jump shortcuts (Ctrl+Alt+↑/↓).

Note that GitHub's **colourblind themes** — swapping red/green for orange/blue — are a complement, not a fix: still
a colour-only encoding, so they do not satisfy 1.4.1 and do nothing for screen readers.

**Announcements.** Use `aria-live="polite"`, never `assertive` — an accepted change is an expected outcome of the
user's own action. Insert the live region at mount, not just before the update. But prefer **focus management over
live regions** where possible: GitHub's accessibility team chose focusing-and-reading a header over `aria-live` for
search results precisely because of races between competing announcements. Accepting a change should move focus to
the next pending change, whose accessible name states the new state.

### 7.5 Implementable checklist

- [ ] `<ins>` / `<del>` in the DOM; never cross paragraph boundaries.
- [ ] Redundant **non-colour cue per change**: a `+` / `−` glyph or an "Added" / "Removed" badge. Doing double duty
      as the 1.4.1 cue and half the screen-reader fix.
- [ ] Underline insertions, strike deletions — *in addition to* colour, never instead of. Never rely on
      strikethrough alone; it is not announced by anything.
- [ ] Visually-hidden "Added by Propositum: …" / "Removed: …" per **change region**, not per token.
- [ ] Text-on-highlight contrast ≥ 4.5:1, verified in light *and* dark themes.
- [ ] Next-change / previous-change keyboard shortcuts. This matters more than layout choice.
- [ ] On landing at a change, move real focus to a stable anchor; handle the case where the target was deleted.
- [ ] Unified/inline as the default; side-by-side only as an opt-in, never the sole path.
- [ ] `aria-live="polite"` region mounted at load; announce "Change accepted. 3 remaining," not the whole diff.
- [ ] `aria-details` → the `reason` block for attribution. Not `cite` / `datetime`.
- [ ] A document-level count ("6 changes across 3 sections") so a screen reader user can gauge scope before drilling
      in. The redlining source calls a plain-language summary "the real safety net" — which is §8's headline too.

---

## 8. Recommendation

**Store.** Markdown, normalised to **one sentence per line** on write, before hashing. Full content snapshots per
`ArtifactVersion` — proposal documents are small, snapshots are simple, and they make the base hash trivially
meaningful. Changesets and decisions live beside the document, never inside it (no CriticMarkup, no injected ids,
in storage). Keep CriticMarkup as an **export** format.

**Propose.** The worker returns **prose, not patches** — one bounded section per action, scoped by the policy gate.
Deterministic code diffs it against the base and emits the `Changeset`. This satisfies *models propose;
deterministic code authorizes*, makes non-overlap free, and eliminates the whole "patch failed to apply" failure
class.

**Address.** Base-version character offsets as the resolution key, a W3C-style `prefix`/`exact`/`suffix` anchor
(~32 chars of context, per Hypothesis) as the verifier, and `baseContentHash` as an enforced precondition. Carry
`headingPath` for grouping only. **On hash mismatch, refuse and tell the user** — GitHub's `outdated` behaviour,
which is the only one of the three reference products that faces drift and it chooses not to guess. Fuzzy
re-anchoring stays behind an explicit opt-in.

**Review.** Decisions, never mutations. `materialise(base, changes, decisions)` is a pure right-to-left fold.
Inline / preview-accepted / preview-rejected are the same fold with different decision maps, exactly as Google's
`SuggestionsViewMode` implies. Verdicts are `accepted | rejected | edited` — the third is required for H2 to be
measurable. Decision rows are append-only; current verdict is the latest row.

**Compute.** `diff` (jsdiff) over `remark`-segmented blocks, with `Intl.Segmenter` for sentence boundaries — *not*
jsdiff's `diffSentences`, whose entire rule is "`.`/`!`/`?` followed by whitespace" and which will shred a document
full of "e.g.", "Inc.", and "$1.5M" (§2.4). Block-align first, detect moves by similarity (wikidiff2), then
sentence, then word, snapped to word boundaries (`simplifyChanges` / `diff_cleanupSemantic`). Below a similarity
floor, stop and label the block **"rewritten."** No `react-diff-viewer*`, no `react-diff-view`, no `diff2html` — all
code-shaped, all force a lossy line-based intermediate. And budget for the fact that **the Markdown-diff component
does not exist as a dependency** (§2.3): the three architecturally-correct packages have 9, 15, and 8 weekly
downloads between them. This is a few hundred lines we write, and the estimate must say so.

**Render — this is the part that keeps the one-minute promise.** Lead with a **change summary list**, not a diff:

```
6 changes · 3 sections · 2 substantive
─────────────────────────────────────────
Pricing
  ▸ Tightened the fee paragraph            Accept  Reject
    why: the source deck quotes a range, not a fixed number
  ▸ Added a scope carve-out                Accept  Reject
    why: your note said out-of-scope work has burned us before
Timeline
  ▸ Rewrote the milestone table            Accept  Reject
    ⚠ rewritten — review in full
...
```

Each row: one-line summary, one-line `why`, accept/reject inline, expandable to the diff. **The diff is evidence
you expand into; the list is the interface.** Both reference products do this — Google's *Tools → Review suggested
edits* sidebar, GitHub's PR description above Files-changed — and the accessible-redlining literature names the
plain-language summary as the real safety net.

Then: a **rendered-Markdown** diff, not a source diff (Wikipedia, VisualEditor, and GitHub's own prose-diff feature
all reached this independently). Inline/unified, not side-by-side. Editorial-significance changes collapsed by
default. And **preview-accepted as a one-keystroke toggle** — because per Diffamation, the reader's real question
about prose is "does the new text read well," which a marked-up diff structurally cannot answer.

**Accept the all-red problem is upstream.** Bound the worker's blast radius in the policy gate. No differ rescues a
wholesale rewrite, and the code-review volume evidence says comprehension collapses with change size regardless of
rendering.

---

## 9. Open questions

1. **Where does per-change `reason` come from, given deterministic diffing?** §4.4. Bounded per-section scope
   solves it for slice 0 by making one run = one change. It does not solve the general case. Unresolved.
2. **The similarity floor for "rewritten," and the threshold for move detection.** Both are guesses. WMDE was
   candid that theirs "was just a wild guess." Needs the fixture corpus.
3. **Does the LLM reliably preserve injected block ids?** I rejected Option C partly on a prior about model
   behaviour. It is cheaply testable and would change the recommendation if the prior is wrong.
4. ~~Does `diffSentences` segment real proposal prose acceptably?~~ **Answered: no.** Its boundary rule is
   `/(?<=[.!?])(\s+|$)/` and jsdiff's own README calls it naive and English-only. Use `Intl.Segmenter` +
   `diffArrays`. The remaining unknown is whether `Intl.Segmenter`'s sentence segmentation is itself good enough on
   proposal prose — that one is still untested.
5. **Inline vs. side-by-side for prose: unmeasured.** §6.7 is inference plus product evidence, not a result. A
   prototype against the fixture corpus would settle it.
6. **What happens to a `reason` when its change is rejected?** Google Docs' behaviour for comments attached to
   accepted/rejected suggestions could not be verified from primary sources. Our own answer should be deliberate:
   I suspect the reason survives in the ledger even when the change does not, since H3 needs the record.
7. **GitHub's exact outdating trigger.** Documented as a state, never as a mechanism. If we ever want re-attachment
   rather than refusal, we cannot copy GitHub — there is nothing published to copy.
8. **Does normalising to one-sentence-per-line alter the artefact in ways a user would object to?** It changes the
   bytes of a document a human may have authored. Idempotence and ordering vs. hashing need care (§6.4).
9. **1.4.11 applicability to highlight backgrounds.** Genuinely unresolved in the W3C sources. Being conservative
   costs little.
10. **ARIA `insertion`/`deletion` real-world support.** Directional only; a11ysupport.io could not be reached.
    Worth a live NVDA/VoiceOver pass before relying on the roles rather than the visually-hidden text.
11. **Is `@nicia-ai/prose-diff` worth reading, vendoring, or ignoring?** It is the only package found that does
    block-level mdast diffing with content-identity matching across moves — exactly the §6.5 design — but it is
    three weeks old with 9 weekly downloads and one star. Reading it is clearly worth an hour. Depending on it is
    clearly not. Vendoring a subset is the interesting middle option and I have not evaluated its code quality.

---

## 10. Sources

**Specifications**
- W3C Web Annotation Data Model — https://www.w3.org/TR/annotation-model/
- WCAG 2.2 — 1.4.1 Use of Color — https://www.w3.org/TR/WCAG22/#use-of-color · Understanding — https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- WCAG 2.2 — 1.3.1 Info and Relationships — https://www.w3.org/TR/WCAG22/#info-and-relationships
- WCAG 2.2 — 1.3.2 Meaningful Sequence — https://www.w3.org/TR/WCAG22/#meaningful-sequence
- WCAG 2.2 — 1.4.3 Contrast (Minimum) — https://www.w3.org/TR/WCAG22/#contrast-minimum
- WCAG 2.2 — 1.4.11 Non-text Contrast — https://www.w3.org/TR/WCAG22/#non-text-contrast · Understanding — https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- WAI-ARIA 1.2, `insertion` / `deletion` roles — https://www.w3.org/TR/wai-aria-1.2/
- ARIA Annotations (editor's draft) — https://w3c.github.io/annotation-aria/
- HTML Standard, edits (`ins` / `del`) — https://html.spec.whatwg.org/multipage/edits.html
- unist (Node, Position, Point) — https://github.com/syntax-tree/unist

**Product and API documentation**
- Google Docs API — Document reference (`TextRun`, `suggestedInsertionIds`, `suggestedDeletionIds`) — https://developers.google.com/workspace/docs/api/reference/rest/v1/documents
- Google Docs API — working with suggestions — https://developers.google.com/workspace/docs/api/how-tos/suggestions
- Google Docs API — `batchUpdate` / `WriteControl.writeMode` — https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate
- Google Docs API — `Request` types (`AcceptSuggestionRequest`, `RejectSuggestionRequest`) — https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/request
- Google Docs Help — Suggest edits — https://support.google.com/docs/answer/6033474
- GitHub REST — pull request review comments — https://docs.github.com/en/rest/pulls/comments
- GitHub REST — pull request reviews — https://docs.github.com/en/rest/pulls/reviews
- GitHub GraphQL — `PullRequestReviewComment.outdated`, `PullRequestReviewState` — https://docs.github.com/en/graphql/reference/pulls
- GitHub Docs — incorporating feedback / committing suggestions — https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request
- GitHub Blog — Rendered Prose Diffs — https://github.blog/2014-02-14-rendered-prose-diffs/
- GitHub Blog — colorblind themes — https://github.blog/changelog/2021-09-29-colorblind-themes-beta/
- GitHub Blog — accessibility behind code search and code view — https://github.blog/engineering/user-experience/accessibility-considerations-behind-code-search-and-code-view/
- GitHub accessibility docs — pull requests — https://accessibility.github.com/documentation/guide/pull-requests/
- GitHub community — ARIA roles for code changes — https://github.com/orgs/community/discussions/14030
- VS Code — accessibility / Accessible Diff Viewer — https://code.visualstudio.com/docs/configure/accessibility/accessibility
- Anthropic — text editor tool (`str_replace`, unique-match requirement) — https://platform.claude.com/docs/en/agents-and-tools/tool-use/text-editor-tool
- Open XML SDK — `InsertedRun` (`w:ins`, quoting ISO/IEC 29500-1) — https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.insertedrun
- MediaWiki — Wikidiff2 — https://www.mediawiki.org/wiki/Wikidiff2
- MediaWiki — How we improved Wikidiff2 — https://www.mediawiki.org/wiki/Wikidiff2/How_we_improved_Wikidiff2
- MediaWiki — VisualEditor/Diffs — https://www.mediawiki.org/wiki/VisualEditor/Diffs
- Git — diff options (`--word-diff`, `--word-diff-regex`) — https://git-scm.com/docs/diff-options
- CriticMarkup syntax — https://fletcher.github.io/MultiMarkdown-6/syntax/critic.html

**Libraries**
- jsdiff — https://github.com/kpdecker/jsdiff (sentence boundary rule: `src/diff/sentence.ts`)
- diff-match-patch (archived upstream) — https://github.com/google/diff-match-patch · API wiki — https://github.com/google/diff-match-patch/wiki/API
- `@sanity/diff-match-patch` — https://www.npmjs.com/package/@sanity/diff-match-patch
- `diff-match-patch-ts` — https://www.npmjs.com/package/diff-match-patch-ts
- fast-diff — https://github.com/jhchen/fast-diff · fast-myers-diff — https://github.com/gliese1337/fast-myers-diff
- prosemirror-changeset — https://github.com/ProseMirror/prosemirror-changeset (archived; moved to https://code.haverbeke.berlin/prosemirror/prosemirror-changeset)
- react-diff-viewer — https://github.com/praneshr/react-diff-viewer · continued fork — https://github.com/Aeolun/react-diff-viewer-continued
- react-diff-view — https://github.com/otakustay/react-diff-view
- `@git-diff-view/react` — https://www.npmjs.com/package/@git-diff-view/react
- diff2html — https://github.com/rtfpessoa/diff2html
- pandiff — https://github.com/davidar/pandiff
- `@nicia-ai/prose-diff` — https://www.npmjs.com/package/@nicia-ai/prose-diff
- markdown-ast-diff — https://www.npmjs.com/package/markdown-ast-diff
- markdown-diff — https://github.com/martijnvanduijneveldt/markdown-diff
- unist-diff (dead) — https://github.com/syntax-tree/unist-diff
- mddiff (dead) — https://github.com/nono/mddiff
- htmldiff-js — https://github.com/dfoverdx/htmldiff-js · node-htmldiff — https://github.com/idesis-gmbh/node-htmldiff
- MDN — `Intl.Segmenter` — https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- Yjs relative positions — https://docs.yjs.dev/api/relative-positions
- Automerge cursors — https://automerge.org/docs/reference/documents/text/
- github-slugger — https://github.com/Flet/github-slugger
- npm registry / downloads APIs (figures dated 2026-08-06) — https://registry.npmjs.org · https://api.npmjs.org/downloads

**Research and practice**
- Chevalier, Dragicevic, Bezerianos & Fekete, "Using text animated transitions to support navigation in document histories," CHI '10, 683–692 — https://doi.org/10.1145/1753326.1753427 · project page https://aviz.fr/diffamation
- Wang, Olson, Zhang, Nguyen & Olson, "DocuViz: Visualizing Collaborative Writing," CHI '15, 1865–1874 — https://doi.org/10.1145/2702123.2702517
- Sadowski, Söderberg, Church, Sipko & Bacchelli, "Modern Code Review: A Case Study at Google," ICSE-SEIP 2018 — https://sback.it/publications/icse2018seip.pdf
- SmartBear / Cisco code review case study — https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf
- Hypothesis — Fuzzy Anchoring — https://web.hypothes.is/blog/fuzzy-anchoring/
- Kernighan, "UNIX for Beginners" (1974) via Rhodes Mill, "Semantic Linefeeds" — https://rhodesmill.org/brandon/2012/one-sentence-per-line/
- MDN — `<del>` — https://developer.mozilla.org/en-US/docs/Web/HTML/Element/del · `<ins>` — https://developer.mozilla.org/en-US/docs/Web/HTML/Element/ins
- MDN — `suggestion` role — https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/suggestion_role
- NVDA — content insertion/deletion support PR — https://github.com/nvaccess/nvda/pull/8558
- "Making Redlining Accessible" — https://accessabilityofficer.com/blog/making-redlining-accessible
