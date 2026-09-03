# 06 — Let Propositum buy the thing it was asked to buy

**Status:** ~~not started — **decided, not built.**~~ **Built 2026-09-01, except the live purchase.**
All eight work items landed in five commits on `agent/complete-purchase`; what remains is the one
*Done when* only a person can do — a real charge, made and refunded, with a card and money the owner
is willing to lose — plus the real-basket calibration of the amount parser that goes with it.
**Decided by:** [ADR-0024](../adr/0024-purchases-within-a-ratified-authorisation.md), accepted
2026-08-26
**Blocked by:** ~~nothing technical. Blocked by judgment on
[`00`](./00-score-the-hypotheses.md)~~ *(spent 2026-09-01: the numbers existed and were poor — H1
one of four, H3 failed — and the owner directed the build with that on the table, recorded in
[`docs/research/instinct.md`](../research/instinct.md) §8.)*
**Blocks:** [`07`](./07-off-the-browser.md) — ADR-0025 depends on this one, because a non-`GET` being
sendable at all is what makes signing in possible. That dependency is now satisfied on the browser
side.

~~The decision is written and the argument is finished. **Nothing is built.**~~ **The build is in;
the purchase is not.** This file stays open for the live half, and its work list below is struck
rather than deleted because each item carries the argument its implementation answered.

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

~~**As of 2026-08-26:** (1) returns nothing…~~ ~~**Re-answered 2026-09-01, mid-build…**~~
**Re-answered a second time the same day, post-build:** (1) returns the object, the gate rules and
the five columns; (2) returns the refusal INSIDE the permit branch — the bare unconditional line is
gone, and `tests/architecture.test.ts` now asserts its absence; (3) returns a set holding
`complete-purchase`; (4) exists and passes for the real reasons on every arm, including the
network's two.

So **Propositum can buy exactly what a person ratified, and nothing else** — refused at the network
without a permit, over the ceiling, in the wrong currency, at the wrong origin, past the count, or
after the agreement's own end. The alarm fired on the commit that moved the branch, exactly as the
paragraph below said it would, and was deliberately updated in it: the guard now confines *"Buy
anything"* to the no-authorisation arm and the refusal to the no-permit arm.

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

**All eight struck 2026-09-01 — built across five commits on `agent/complete-purchase`, in exactly
this order, with item 6 written before item 5 as instructed.** The items are left readable rather
than deleted, because each carries the argument its implementation answered. What the build decided
inside them, worth a line each: expiry is DERIVED (`acceptedAt + timeLimitMinutes`), never stored or
drafted, so an authorisation structurally cannot outlive its contract; the charge counter fails
CLOSED when unwired; item 4's "refuses and asks" is a typed transport failure
(`amount-over-ceiling` / `amount-unparseable`) that ends the run with a `DecisionNeeded` — an answer
grants nothing, and the remedy is a re-ratification, never a mid-run override; and item 5's five
checks became four at the network plus the count at the gate, with a ONE-SHOT permit making
landings ≤ authorised intents by construction.

1. ~~**The vocabulary is already in — take the fences off in the commit that builds this.**~~ *(done 2026-09-01)*
   `CONTEXT.md` was written ahead of the code on 2026-08-26 and says so about itself, in **two
   places**, both of which go stale the moment a field exists:

   - the `PurchaseAuthorization` entry, whose fence reads *"Nothing in `src/` or `prisma/` holds any
     of these fields… so **Propositum cannot buy anything today**"*;
   - the `ContractScope` entry, which lists `purchaseAuthorization` among *"two more decided
     2026-08-26 and neither built"* and quotes a `grep` that will stop returning nothing.

   A glossary that says the fields do not exist while they do is worse than one that says nothing,
   and the second fence is the one that gets missed because it is inside somebody else's entry.

2. ~~**`PurchaseAuthorization` on `ContractScope`, optional, absence is the deny.**~~ *(done 2026-09-01)*
   ~~`src/domain/handoff/policy.ts:336`~~ **the line number is gone, 2026-09-01, because it had
   already moved:** line 336 is a docblock about plan length now. The exported
   `PurchaseAuthorization` interface and the optional `purchaseAuthorization` field on
   `ContractScope` are both in `src/domain/handoff/policy.ts`. Six fields, and the closed set —
   currency — gets its Zod schema in `src/domain` like every other closed set, because Prisma's
   SQLite provider has no enums.
   Nothing in `AutonomyControls` gains a field: per
   [principle 6](../PRODUCT_PRINCIPLES.md) a dial may switch purchasing off and may never relax the
   ceiling.

3. ~~**Draft it at the handoff boundary, and ratify it on the screen that already ratifies.**~~ *(done 2026-09-01)* The model
   proposes constrained values; `src/ui/agreement.tsx` renders **one line with the amount prominent,
   not a form** — [principle 10](../PRODUCT_PRINCIPLES.md), a person has about a minute. The
   boundary schema gets the four constrained fields and nothing that could carry prose into a
   permission; `tests/boundaries.test.ts` is where that is held.

   *"Find me food for dinner"* must produce **nothing to ratify**, so the screen shows no
   authorisation and the block stays unconditional for it. That is the whole design and it is item 6.

4. ~~**Parse the amount at `Fetch.requestPaused`, deterministically, and refuse when you cannot.**~~ *(done 2026-09-01)*
   `extension/src/cdp.js`. Never a model — a model deciding whether a charge is within budget is a
   model deciding whether it needs permission. **Unparseable refuses and asks**, which ADR-0024 §5
   says will be common, and the interface has to say that honestly rather than implying the ceiling
   binds everywhere.

5. ~~**Then, and only then, stop refusing every non-`GET`.**~~ *(done 2026-09-01)* One branch in
   `classifyPausedRequest`, in `extension/src/cdp.js` — ~~`:553`~~ **struck 2026-09-01: it named
   a line of the docblock above the branch, not the branch itself.**
   Everything above is inert until this line moves, which is why it is fifth and not first: the
   product is safe throughout steps 1–4 and stops being safe at step 5.

   Five checks at the paused request, four of which a page cannot forge — origin, method and amount
   from Chrome; the charge count from the ledger; the clock injected. The fifth, the amount, is the
   honest weakness.

6. ~~**`tests/purchase-authorisation.test.ts`, with the fixture that must never pass.**~~ *(done 2026-09-01)* *"Find me food
   for dinner"* drafts no authorisation and therefore charges nothing. Write this test **before item
   5**, watch it pass for the boring reason, and then make sure it still passes for the real one.

7. ~~**Move the reachability assertions in the same change.**~~ *(done 2026-09-01)* `LANDING_ACTION_KINDS` stops being empty,
   so `src/server/outcomes/external-effect.ts`'s reasoning about emptiness changes and the
   `external-effect` `ShiftOutcomeKind` becomes reachable for the first time. Per
   [`AGENTS.md`](../../AGENTS.md): if you wire something up, move its assertion out of the deferred
   block in the same change.

8. ~~**Strike the promises, everywhere, in the same commit.**~~ *(done 2026-09-01)* ~~`src/ui/agreement.tsx:298`~~
   **the line number is gone, 2026-09-01, because it had already moved:** the promise the guard
   names is the *"Buy anything"* row, and the comment beside `ABSENT` in `src/ui/agreement.tsx`
   records that it left that list on 2026-09-01 and renders conditionally now. Point at the thing;
   a line number is a count somebody has to maintain by hand. It is not the only promise. `docs/SECURITY_AND_PRIVACY.md`'s *capabilities that
   do not exist* section shrinks, and *"Propositum cannot buy anything"* — true by mechanism today —
   becomes *"cannot buy anything you did not authorise"*, which is a weaker claim and has to read
   like one.

---

## Done when

- ~~`npm test`, `npm run typecheck` and `npm run build` are green, with
  `tests/purchase-authorisation.test.ts` in the suite.~~ *(met 2026-09-01)*
- ~~The four commands under *Is this already done?* return what a finished repo returns.~~ *(met
  2026-09-01)*
- ~~The *"Buy anything"* guard in `tests/architecture.test.ts` has been **deliberately updated**, not
  deleted~~ *(met 2026-09-01 — it fired first, which is the mechanism working, and its replacement
  holds the two-arm promise the way the old one held the absolutes)*.
- **A real purchase has been made and refunded, and the `ActionIntent` / `ActionOutcome` pair for it
  reads correctly on the re-entry screen.** ***Open — the one item only a person can close, and the
  reason this file is not done.*** The same session should calibrate `parseChargeAmount`'s key list
  against real checkouts, which no fixture can do. ~~*Added 2026-09-02:* the same session should also
  watch the network panel for same-origin non-`GET` requests fired **between the press and the
  checkout request** — the permit is not bound to the initiating request (ADR-0024 §2, the sixth
  fact), so a telemetry `POST` carrying an amount would consume it first. If that happens on a real
  basket once, binding the permit to the request Chrome attributes to the press stops being a
  follow-up and becomes the next item here.~~ **Bound 2026-09-03 (#147), and the question the live
  session has to answer changed with it.** The permit now releases only what Chrome attributes to the
  tab going somewhere — `Document`, main frame — so a telemetry `POST` cannot consume it. What the
  session must now watch for is the opposite failure: **whether the checkout request is a tab
  navigation at all.** If the merchant's *Place order* fires an `XHR` or a `fetch`, the press ends in
  a refused request and a halted run, and nothing can be bought there. Note, per merchant, which of
  the two it was — that count is what decides whether browser purchasing is worth keeping. While the
  panel is open, note also whether the checkout navigation carries `Sec-Fetch-User: ?1`: it is the
  one further narrowing available, and no fixture can establish it.
- ~~`CONTEXT.md`'s `PurchaseAuthorization` entry no longer carries its *specification rather than a
  description* fence.~~ *(met 2026-09-01)*

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
