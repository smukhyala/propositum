---
name: house-voice
description: Use when writing a commit message, a pull request body, or correcting a claim in a document in the propositum repo. Covers the two-clause imperative commit subject, the three PR headings, and the strike-and-date correction convention that replaces silent overwriting.
---

# The house voice

One rule underneath all of it, and it is `docs/PRODUCT_PRINCIPLES.md` §11: **say the true thing,
including when it is unimpressive.** It applies to a commit subject, a status table and a pull request
description as much as to the product. Understating what the product does is still saying a false thing
about it.

Prose here uses British spelling — `serialisation`, `authorise`, `honour`, `normalise`.

## Commit subjects

**A sentence about what changed for the product**, in the imperative, frequently two clauses joined by
*and* — where the second clause usually names what was removed, stopped or corrected. No `feat:`
prefixes, no ticket ids, no file names. Sentence case, no trailing full stop.

From the actual history:

```
Classify how a page was arrived at, and stop holding the address it came from
Read free/busy, and spend the sentence that said there was no account
Let a mistyped search join the subject it meant, and refuse everything else
One comment stripper, because the second one was a guard away from blind
Correct three README claims the same day's later work made false
Give the lifecycle word a screen, since it had none
```

**The test:** does somebody reading `git log` in a month learn what the product can now do, or what it
stopped claiming? `Update actions.ts` fails it. Subjects here run long — the median is around sixty
characters and the fifty-character rule is not observed. Length is not the constraint; saying nothing is.

**Bodies are prose**, hard-wrapped near eighty columns, four to eight paragraphs, bullets rare. They
argue: what was believed, what turned out to be false, what the fix costs, and what evidence holds it.
Cite ADRs by number and name the test file that enforces the claim.

Write merge commits as sentences too when merging locally — *"Merge the CDP surface, and let go before
asking"*.

## Pull request bodies

Three headings:

```markdown
## What changed

In the register of a commit subject: what the product can now do, or what it stopped claiming.

## What this answers

The issue or ADR, linked. If this contradicts an ADR, say so — "contradicts ADR-0007, but worth
reopening because…" — and amend that ADR in the same change.

## What is now reachable, and what I did not do

Whether a reachability assertion moved into or out of the deferred block in
`tests/reachability.test.ts`, and what you deliberately left undone.
```

That third heading is the one that gets lost, and it is the half the repository cares most about.

Branches are `<track>/<slug>`: `product/` for a shipped surface, `direction/` for work following a
direction update, `agent/` for work an agent drove end to end, `unit<N>/` for a numbered slice off a
product branch. Match the nearest rather than inventing a fifth.

## Correcting a document

**Never overwrite a claim.** Strike it, date it, and state what replaced it:

```markdown
~~ANTHROPIC_API_KEY is the only credential needed. There is no cloud, no account, and no telemetry.~~

**Struck 2026-08-18 — [ADR-0014](./docs/adr/0014-reading-free-busy.md), and left visible because a
reader has to be able to see what was promised.** ...
```

Why the convention exists: what a reader has believed until now is worth leaving on the page beside what
replaced it. A clean edit hides that anybody ever believed the old thing, which is exactly the
information a future reader needs.

Three rules that go with it:

- **Correct it everywhere the sentence appears**, not just where you noticed. ADR-0014's *"no account"*
  had to be struck in four documents. A claim corrected in one place and standing in another is the
  failure the convention exists to prevent.
- **Principles are appended, never inserted or renumbered.** Source comments in `src/` cite them by
  number. A wrong principle is struck and dated in place, keeping its number.
- **Never add a count you have to maintain by hand.** If your change moves a number a document states,
  fix that document in the same commit — or better, delete the number and point at the thing that knows
  it. The README documents five of its own counts going stale, and the count of stale counts also went
  stale.

## Docblocks

The house habit, and the most valuable thing in the codebase: **explain the decision, then state what it
does not cover.** A guard whose limit is unstated reads as a stronger promise than it is. Where a rule
rests on discipline rather than a type or a test, say so — those are the ones that erode.
