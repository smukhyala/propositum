---
name: write-adr
description: Use when recording a decision in propositum, amending or reversing an existing one, or when a change contradicts an ADR. Covers the house ADR format — the header chain, the option rejected and why, the cost stated as a cost, and the Revisit when section.
---

# Writing an ADR

An ADR here is not a summary of what was built. It is the argument, kept so that the next person to
arrive with a reason has to answer it. `docs/adr/0012-screen-capture-refused.md` exists purely because a
promise with no argument behind it is the kind that gets overturned — ADR-0002's refusal of the
`debugger` permission was a table row, and ADR-0010 reversed it in a paragraph.

## Before writing

```bash
ls docs/adr/                       # the next number, zero-padded to four
```

Read the ADRs you are amending, reversing or depending on. Read `CONTEXT.md` for the terms you will use.
If your decision contradicts an existing ADR, you must say so — in the ADR, and in the pull request —
and **amend that ADR in the same change**. Silently overriding a decision loses the argument that
produced it.

## The shape

```markdown
# ADR-00NN — A sentence naming the decision, not a noun phrase

**Status:** accepted · YYYY-MM-DD
**Ticket:** [#NN](https://github.com/smukhyala/propositum/issues/NN)
**Depends on:** [ADR-000N](./000N-slug.md) (what it depends on, specifically)
**Amends:** [ADR-000N](./000N-slug.md) — the permission model, and only that
**Reverses:** [ADR-000N](./000N-slug.md) — the refusal of X
**Research:** [`docs/research/thing.md`](../research/thing.md)

## Context

## Decision

## What this costs

## Revisit when
```

Only the header lines that apply. Be specific in them — *"amends ADR-0002's permission model, and only
that"* is the useful form, because the next reader needs to know what still stands.

The title is a **sentence**. From the set: *"Acting in the person's own browser"*, *"A rolling
screenshot cache, refused"*, *"Reading free/busy, and the account that stops being none"*.

## The four habits that make these ADRs work

**1. State the rejected option and why.** Every ADR here records what it did not do. An ADR with one
option is a note.

**2. State the proposal at its strongest before declining it.** ADR-0012 refuses a screenshot cache and
spends most of its length making the case *for* one. A refusal that argues against a weak version of the
proposal will not survive the person who arrives with the strong version.

**3. Say the cost as a cost, in the opening, not in a footnote.** ADR-0010 opens by saying its net
effect on safety is negative. ADR-0014 opens with *"Today Propositum has one secret and one egress.
After this it has two of each, and it has an account."* If your decision makes something worse, that
sentence goes near the top or the ADR is selling something.

**4. Name what holds the line now.** When a decision replaces a structural guarantee with a mechanism,
say which mechanism, where it lives, and that mechanisms erode. Where a test is the enforcement, name
the test file — and if that test could pass while meaning something else, say that too.

## Revisit when

A list of concrete triggers, not a date. *"Anyone proposes writing ambient observations to disk"* is a
trigger. *"In six months"* is not. ADR-0015 was written because an ADR-0008 trigger fired.

## After

- Amend `CONTEXT.md` if the decision changes vocabulary — and strike the old text in place, dated,
  rather than overwriting it.
- Amend `docs/PRODUCT_PRINCIPLES.md` if it changes what is forbidden. Principles are **appended, never
  inserted or renumbered**, because `src/` cites them by number; a principle that turns out to be wrong
  is struck and dated in place, keeping its number.
- Update `docs/ARCHITECTURE.md`'s layer status if the decision moved one.
- Every document that states the sentence you just changed has to be struck too. ADR-0014's *"no
  account"* had to be struck in four places.

Use the `house-voice` skill for the commit and the pull request body.
