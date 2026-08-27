# 06 — Let Propositum buy the thing it was asked to buy

**Status:** not started — **decided, not built.**
**Decided by:** [ADR-0024](../adr/0024-purchases-within-a-ratified-authorisation.md), accepted
2026-08-26
**Blocked by:** nothing technical. Blocked by judgment on
[`00`](./00-score-the-hypotheses.md), the same way [`01`](./01-menu-bar-app.md) is: this is the
largest single reduction in safety the product has ever taken, and taking it for an unproven bet is
the wrong order.
**Blocks:** [`07`](./07-off-the-browser.md) — ADR-0025 depends on this one, because a non-`GET` being
sendable at all is what makes signing in possible.

The decision is written and the argument is finished. **Nothing is built.** This file is the work
between the two, and it exists because
[`README.md`](./README.md) named it as *"work nobody has written"* in the same breath as striking the
bullet that used to forbid it.

---

## Is this already done?

```bash
# 1. the object itself — a FIELD, not a mention. The word appears in docblocks
#    describing what was decided, so grep for something only the code would have.
grep -rn 'maxAmount\|originPattern.*PurchaseAuth\|purchaseAuthorization' src/ prisma/

# 2. the transport. This is the one that decides whether Propositum can spend
grep -n "method !== 'GET'" extension/src/cdp.js

# 3. the set the whole thing hangs off
grep -n 'export const LANDING_ACTION_KINDS' src/domain/handoff/policy.ts

# 4. the standing fixture that must never pass
ls tests/purchase-authorisation.test.ts
```

**As of 2026-08-26:** (1) returns nothing — a bare `grep -rn 'PurchaseAuthorization' src/` returns
**one** hit, and it is a docblock in `src/domain/execution/reversibility.ts:75` describing the
decision, which is why command 1 asks for a field name instead. That distinction is the whole point
of this heading: the word is all over the corpus and the fields are nowhere. (2) returns
`extension/src/cdp.js:553`, still refusing unconditionally; (3) returns
`export const LANDING_ACTION_KINDS: ReadonlySet<ActionKind> = new Set<ActionKind>()` at
`src/domain/handoff/policy.ts:168`, still empty; (4) does not exist.

So **Propositum cannot buy anything today**, and every sentence in the product that says so is still
true. `src/ui/agreement.tsx:298` lists *"Buy anything"* under what Propositum has no way to do, and
`tests/architecture.test.ts` couples that promise to the transport — *"says 'Buy anything' only while
every non-GET is blocked"*. **That guard is the alarm for this file.** The day item 5 below lands, it
goes red and names the screen that has started lying about money.

---

## Blocked by

Nothing in code. Two things in judgment, and both are arguments rather than tickets:

- **[`00`](./00-score-the-hypotheses.md).** H1, H2 and H3 still have no numbers. ADR-0024 spends the
  strongest guarantee this product has; spending it before knowing whether the product works is
  paying the price without knowing what was bought.
- **A decision about order with [`07`](./07-off-the-browser.md).** This one is much smaller and it is
  a dependency of that one. Doing it first is right; doing it *only* because it is smaller, and then
  discovering the desktop agent changes what the gate has to check, is not.

---

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| **A decision** | Whether to spend the block at all. It is written down and accepted, and it is still reversible until code exists — an accepted ADR is an argument, not an obligation. | — |
| **A card, and a real basket** | The amount parse in item 4 cannot be written against a fixture. It has to be checked on real checkout requests from real merchants, and §5 of the ADR predicts that a common outcome is *unparseable*. | an afternoon of real shopping |
| **Money you are willing to lose** | The first end-to-end run buys something. Set `maxAmount` low and buy something cheap and returnable. | — |

**Nothing to apply for.** No account, no certificate, no review queue. This is the only file after
[`03`](./03-document-loop.md) with a nearly empty version of this section, and that is misleading
about how serious it is rather than reassuring.

---

## The work

In this order, because the last step is the irreversible one and everything before it is inert.

1. **Put the vocabulary in first.** `CONTEXT.md` already has the
   [`PurchaseAuthorization`](../../CONTEXT.md) entry, written 2026-08-26 with a
   *specification rather than a description* fence around it. **When you build this, that fence comes
   off in the same change** — the entry currently says *"Nothing in `src/` or `prisma/` holds any of
   these fields"*, and a glossary that says that while the fields exist is worse than one that says
   nothing.

2. **`PurchaseAuthorization` on `ContractScope`, optional, absence is the deny.**
   `src/domain/handoff/policy.ts:336`. Six fields, and the closed set — currency — gets its Zod
   schema in `src/domain` like every other closed set, because Prisma's SQLite provider has no enums.
   Nothing in `AutonomyControls` gains a field: per
   [principle 6](../PRODUCT_PRINCIPLES.md) a dial may switch purchasing off and may never relax the
   ceiling.

3. **Draft it at the handoff boundary, and ratify it on the screen that already ratifies.** The model
   proposes constrained values; `src/ui/agreement.tsx` renders **one line with the amount prominent,
   not a form** — [principle 10](../PRODUCT_PRINCIPLES.md), a person has about a minute. The
   boundary schema gets the four constrained fields and nothing that could carry prose into a
   permission; `tests/boundaries.test.ts` is where that is held.

   *"Find me food for dinner"* must produce **nothing to ratify**, so the screen shows no
   authorisation and the block stays unconditional for it. That is the whole design and it is item 6.

4. **Parse the amount at `Fetch.requestPaused`, deterministically, and refuse when you cannot.**
   `extension/src/cdp.js`. Never a model — a model deciding whether a charge is within budget is a
   model deciding whether it needs permission. **Unparseable refuses and asks**, which ADR-0024 §5
   says will be common, and the interface has to say that honestly rather than implying the ceiling
   binds everywhere.

5. **Then, and only then, stop refusing every non-`GET`.** One branch in `extension/src/cdp.js:553`.
   Everything above is inert until this line moves, which is why it is fifth and not first: the
   product is safe throughout steps 1–4 and stops being safe at step 5.

   Five checks at the paused request, four of which a page cannot forge — origin, method and amount
   from Chrome; the charge count from the ledger; the clock injected. The fifth, the amount, is the
   honest weakness.

6. **`tests/purchase-authorisation.test.ts`, with the fixture that must never pass.** *"Find me food
   for dinner"* drafts no authorisation and therefore charges nothing. Write this test **before item
   5**, watch it pass for the boring reason, and then make sure it still passes for the real one.

7. **Move the reachability assertions in the same change.** `LANDING_ACTION_KINDS` stops being empty,
   so `src/server/outcomes/external-effect.ts`'s reasoning about emptiness changes and the
   `external-effect` `ShiftOutcomeKind` becomes reachable for the first time. Per
   [`AGENTS.md`](../../AGENTS.md): if you wire something up, move its assertion out of the deferred
   block in the same change.

8. **Strike the promises, everywhere, in the same commit.** `src/ui/agreement.tsx:298` is the one
   the guard names, and it is not the only one. `docs/SECURITY_AND_PRIVACY.md`'s *capabilities that
   do not exist* section shrinks, and *"Propositum cannot buy anything"* — true by mechanism today —
   becomes *"cannot buy anything you did not authorise"*, which is a weaker claim and has to read
   like one.

---

## Done when

- `npm test`, `npm run typecheck` and `npm run build` are green, with
  `tests/purchase-authorisation.test.ts` in the suite.
- The four commands under *Is this already done?* return what a finished repo returns.
- The *"Buy anything"* guard in `tests/architecture.test.ts` has been **deliberately updated**, not
  deleted — it is the thing that noticed, and its replacement should hold the new promise the way it
  held the old one.
- A real purchase has been made and refunded, and the `ActionIntent` / `ActionOutcome` pair for it
  reads correctly on the re-entry screen.
- `CONTEXT.md`'s `PurchaseAuthorization` entry no longer carries its *specification rather than a
  description* fence.

---

## What this does not cover

- **A `GET` that charges.** One-click confirmation links are `GET`s, the network mechanism never sees
  them, and no authorisation is consulted. ADR-0010 named this hole, ADR-0024 §5 restates it, and
  nothing here closes it.
- **Anything outside a browser.** That is [`07`](./07-off-the-browser.md), which depends on this.
- **A standing spend limit.** *"Up to $200 a week"* is a `WorkingAgreement` in everything but name,
  the word is reserved, and the axis is wrong anyway: the risk is the wrong thing from the wrong
  place, and a weekly total says nothing about either.
- **An authorisation that outlives its contract.** Also a `WorkingAgreement`. Not a longer
  `expiresAt`.
- **The person's own mistake.** Ratifying the wrong merchant buys the wrong thing, correctly, with a
  receipt. That is what ratification means.
