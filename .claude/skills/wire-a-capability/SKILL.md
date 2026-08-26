---
name: wire-a-capability
description: Use when building something new in propositum, or connecting something already built to the product. Covers the reachability discipline — every capability is asserted either reached or deferred, and wiring one means moving its assertion in the same change.
---

# Wiring a capability

`tests/reachability.test.ts` exists because an adversarial review found three pieces of **correct,
tested code that nothing called**. `repos.reports.create` had no caller, so no `ShiftReport` was ever
written and the guard it exists to enforce could never fire — it would have demoed as fixed having never
once run. `runWorker` had no caller, so pressing Take over stranded the session in `away` for ever while
the interface offered "Take back control".

Every one passed typecheck and unit tests. **Coverage of a function says nothing about whether the
product can reach it**, and that gap is invisible in a green suite.

## The rule

Every capability is asserted in one of two places in `tests/reachability.test.ts`:

- **reached** — something in `src/` or `scripts/` calls it, and the test pins that; or
- **deferred, and asserted as deferred** — nothing calls it, and the test pins *that*, with a comment
  saying what has to exist first.

**A capability in neither is the exact hole the file exists to close.**

So:

- **If you build something you cannot wire yet**, add it to the deferred block, with the reason.
- **If you wire something up**, move its assertion out of the deferred block **in the same change**.
- **If you build and wire it at once**, add a reached assertion.

## The checklist

1. Build it, with a test that would have failed before the change.
2. Wire it — find the real caller in the product, not a test.
3. Open `tests/reachability.test.ts` and move or add the assertion.
4. Update `docs/ARCHITECTURE.md` if this moved a layer's status marker. Nothing checks that column, so
   nothing will tell you.
5. Update `README.md` if it lists this capability as unwired — and strike the old claim rather than
   overwriting it. The README has said the wrong number here more than once.
6. Say what became reachable in the pull request body. That is one of its three headings.

## Writing the assertion

The helper is `callersOf(needle, definingFile)`. It greps `src/` and `scripts/` — and `extension/` for
`.js` and `.html` — **excluding the defining file**, so a repository's own definition never counts as a
caller.

Three traps, each of which has already happened here:

- **Comments count unless stripped.** The first version of this file counted a *comment* mentioning
  `repos.reports.create` as a caller; deleting the real call left the test green, kept alive by the
  file's own header comment about the bug. `stripComments` exists for this.
- **Imports count unless stripped.** Removing the real `cleanUrl` calls left the `import { cleanUrl }`
  line behind and the grep counted it, while three behavioural tests went red.
- **The needle can name something nothing writes.** A pin written as `modelCallRecord.create` could only
  ever have gone red for a repository that happened to be named that, and would have stayed green
  through a correctly wired `modelCalls`. **Name the accessor the callers actually write** —
  `reports.create`, `outcomes.create`, `findings.create(` — which is the convention every assertion in
  the file already follows.

Give each assertion a message saying what is broken if it fails, in product terms:

```
'nothing writes a ShiftOutcome — a run can only produce a document'
'nothing records an OutcomeVerdict — a production cannot be accepted or rejected'
```

Where exactly one caller is correct, pin that too — *"the outcome writers must be the only caller, so
kind and reversibility have one author"*.

## The honest limit

These are crude greps on purpose: a sophisticated check would need the thing it is checking to already
work. They prove a capability is *mentioned* somewhere live, not that a person can reach it by using the
product. A green reachability suite is a floor, not a demonstration.
