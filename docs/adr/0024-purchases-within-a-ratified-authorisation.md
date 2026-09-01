# ADR-0024 — Buying things, within an authorisation the person ratified

**Status:** accepted · 2026-08-26
**Amends:** [ADR-0010](./0010-acting-in-the-browser.md) — §3's account of what the network mechanism
does. The mechanism stays; it stops being unconditional.
**Depends on:** [ADR-0004](./0004-policy-gate.md) (the gate), [ADR-0006](./0006-trust-boundary.md)
(why prose may not reach a permission decision)
**Requested by:** the owner, 2026-08-26 — *"it can buy things, but needs explicit human permission"*, and, on what
separates the two cases: *"if i say 'buy 10 avacados from amazon' it should do EXACTLY that … If i
say 'find me food for dinner' it should NOT place an order or charge, as permission was not
explicitly added"*

## The sentence that stops being true

**Propositum may now spend your money — decided here, and not yet built.** The distinction is not
pedantry: as this ADR is accepted `extension/src/cdp.js` still refuses every non-`GET`,
`LANDING_ACTION_KINDS` is still empty, and `src/ui/agreement.tsx` still tells people Propositum
cannot buy anything, correctly. [`docs/todo/06-buying-things.md`](../todo/06-buying-things.md) is the
work between the decision and the capability. Everything below describes what is being permitted.

Until today it could not, and the reason was not a policy —
it was that `extension/src/cdp.js` failed every request the agent's tab was about to send that was
not a `GET`, at the network, unconditionally:

```js
if (method === '') return 'blocked-request'
if (method !== 'GET') return 'blocked-request'
```

That is the strongest guarantee this product has ever had, and this ADR spends it. Say what it was
worth before saying what replaces it: it could not be misconfigured, could not be clicked through,
did not depend on a classifier being right or a person being awake, and it held equally against a
hostile page, a mistaken model and a bug in our own gate. `LANDING_ACTION_KINDS` is an empty set
today precisely because the transport could not honour a member — the enum was telling the truth.

What replaces it is a **structured authorisation a person ratified**, checked by deterministic code
against what Chrome is holding. That is a real mechanism and it is weaker than an absence. It can be
wrong about an amount it could not parse, it can be ratified by somebody who did not read it, and it
inherits every weakness of the ratification screen [ADR-0006](./0006-trust-boundary.md) already calls
the actual trust boundary.

This is the second ADR in the series whose net effect on safety is negative. The first was
[ADR-0010](./0010-acting-in-the-browser.md), and it said the same thing about itself.

## Context

The product's stated job is to continue someone's work while they are away. Every errand people
actually want — order this, book that, submit this form, reply in this thread — is a `POST`. So the
block that made Propositum safe also made it unable to do the thing it exists for. ADR-0010 already
recorded the shape of this problem for reads; this is the same problem one layer further on.

The obvious design is a confirmation per purchase, and it is what an earlier draft of this decision
proposed. It is wrong, for a reason ADR-0010 already documents about itself:

> A hostile page can force a confirmation storm, and habituation is a real attack. Make every control
> post, and every action needs a human; the twentieth dialog gets clicked without reading.

A person who is asked to confirm every charge is a person who stops reading the confirmations, and
the one that mattered arrives looking exactly like the nineteen that did not. Worse, it does not
deliver the product: being interrupted for each of ten errands is not being away.

## What is actually being asked for

Two instructions, and the difference between them is the whole design:

| Instruction | Names | Should |
|---|---|---|
| *"Buy 10 avocados from Amazon"* | a merchant, an item, a quantity | buy them, without asking again |
| *"Find me food for dinner"* | nothing purchasable | never charge anything |

The second is not a smaller version of the first. It is a research task that happens to be adjacent
to a shop, and a product that reads it as permission to spend is a product nobody can use.

So the authorisation is not per action and not per session. **It is per instruction, and it exists
only when the instruction actually contained one.**

## Decision

**A `PurchaseAuthorization` is a structured object on `ContractScope`, drafted by a model, ratified
by a person on the screen they already ratify, and checked by the gate against the request Chrome is
holding. A non-`GET` is refused unless one covers it.**

```ts
interface PurchaseAuthorization {
  readonly originPattern: string   // where. Matched exactly, never by prefix
  readonly whatFor: string         // display only. Never read by the gate
  readonly maxAmount: number       // the ceiling, in minor units
  readonly currency: string        // ISO 4217, from a closed set
  readonly maxCount: number        // how many charges this permits
  readonly expiresAt: Date         // and until when
}
```

*(2026-09-01, the build — two corrections the code decided, both toward this document's own
argument. `maxAmount` became `maxAmountMinor`: the comment above already said minor units, and a
name that says so cannot be misread by a caller holding dollars. And `expiresAt` is **derived, not
stored or drafted** — `acceptedAt + timeLimitMinutes`, the immutable pair the deadline already
derives from — so an authorisation structurally cannot outlive its contract, which answers the
second *Revisit when* trigger below by construction instead of by review. While the expiry derives
from that pair it is production-coincident with the budget check; the gate's `purchase_expired`
rule exists for the day a stored expiry earns its own argument. `CONTEXT.md`'s entry records the
same corrections, dated.)*

### 1. Why a structured object, and not the instruction itself

The tempting shape is to let the objective authorise: the person wrote *"buy 10 avocados"*, so
buying is permitted. **That is prose reaching a permission decision, and it is the one thing this
codebase makes a compile error.** [ADR-0006](./0006-trust-boundary.md):

> `compilePolicy(scope, controls)` is typed so it *cannot receive* `StatedIntent`. Prose reaching a
> permission decision is a compile error, not a review note.

The objective is inside the injection blast radius — a page can rewrite it before the person ever
sees the handoff screen. If the objective authorised spending, an injection would authorise spending.
So the model **drafts** the authorisation as constrained values, the person **ratifies** it, and
`compilePolicy` receives a `ContractScope` exactly as it does today. Same asymmetry as everywhere
else here: a model may propose, and only a person may permit.

`whatFor` is prose and is display-only, for the same reason an inferred `constraint` claim is: it
tells the person what they are agreeing to and the gate never reads it.

### 2. What the gate checks, and where the facts come from

At `Fetch.requestPaused`, before the request leaves the machine:

| Check | Fact from |
|---|---|
| origin matches `originPattern` | Chrome, attested |
| method is not `GET` ⇒ an authorisation is required | Chrome, attested |
| amount ≤ `maxAmount` | the request body Chrome is holding |
| charges so far < `maxCount` | the ledger |
| now < `expiresAt` | the injected clock |

Four of the five cannot be forged by a page. The fifth is the honest weakness and §4 is about it.

**No authorisation on the contract ⇒ every non-`GET` is refused**, exactly as today. *"Find me food
for dinner"* produces nothing to ratify, so the block is still unconditional for it. This is the case
`tests/purchase-authorisation.test.ts` carries as a standing fixture, and it is the one that must
never start passing.

### 3. The ceiling is not optional and is not a dial

`maxAmount` exists because *"buy 10 avocados"* must not become a $400 charge — through a wrong
variant, a subscription upsell, a currency confusion, or a page that is not the page we thought.

A charge above the ceiling **refuses and asks**. ~~That is the one confirmation that survives this
decision~~ **Corrected 2026-09-01, by the build, toward the stricter verb:** what survives is a
`DecisionNeeded`, not a `ConfirmationRequest` — the human **answers**, and per ADR-0022 an answer
grants nothing. A confirmation here would need a yes-path, and a yes-path would need the ceiling to
travel back to the transport relaxed, which is the relaxation §*below* forbids every dial; the
person's remedy is a fresh agreement with a ceiling they choose, ratified on the screen that shows
it. The rest of the paragraph holds as written: it is well-behaved precisely because it is rare — it
fires only when something has
already gone wrong, so a person seeing one has reason to read it. A question that fires on every
purchase teaches people to dismiss it; one that fires when the number is wrong teaches them to look.

**Per [principle 6](../PRODUCT_PRINCIPLES.md), no control may relax this.** A setting may turn
purchasing off entirely — narrowing is always allowed. Nothing may turn the ceiling check off,
because that is a dial pre-approving an irreversible action, which the principle forbids outright.

### 4. What was refused, and why

**A confirmation per purchase.** Argued at its strongest: it is the mechanism ADR-0010 already built,
it needs no new schema, no ratification-screen work and no amount parsing, and it puts a human in
front of every irreversible act — which is exactly what principle 9 asks for. It is refused anyway,
on ADR-0010's own evidence about itself: habituation is not a hypothetical, the storm is
attacker-triggerable, and a person interrupted per errand has not been left alone. The authorisation
moves the same human decision **earlier**, to a moment when they are at their desk reading one
screen about one job, rather than later, to twenty moments when they are not.

**A standing spend limit with no origin or item.** *"Propositum may spend up to $200 a week."*
Simpler, and it is a [`WorkingAgreement`](../../CONTEXT.md) in everything but name — a durable
delegation this project has deliberately not built. It also authorises the wrong axis: the risk is
not the total, it is buying the wrong thing from the wrong place, and a weekly budget says nothing
about either.

**A denylist of checkout hosts.** Refused for the reason `CONTEXT.md` already gives about denylists
beside allowlists: two mechanisms create a precedence question with no principled answer. The
existing pair works because both are one-way ratchets in the same direction. A denylist that could
permit would break that.

**Reading the amount with a model.** A model parsing a request body to decide whether a charge is
within budget is a model deciding whether it needs permission, which is the same thing as deciding it
does not. Deterministic parsing only, and where parsing fails, §5.

### 5. The honest limits

- **The amount is not always readable.** A checkout `POST` may carry an opaque token, a GraphQL blob,
  or nothing at all, with the real price held server-side. **An unparseable amount refuses and asks.**
  That is the safe direction and it will be a common one — the ceiling check is therefore a real bound
  on some sites and a prompt on others, and this ADR does not pretend that is elegant.
- **The price can change between ratification and checkout.** The merchant owns the page. This is why
  the check is at the paused request rather than at ratification: the number the ceiling is compared
  against is the number about to be sent, not the number the model read earlier.
- **`maxCount` counts requests, not orders.** A site that retries, or that splits a basket across two
  calls, spends the count faster than a person would expect. Erring toward refusing is the correct
  direction and it will occasionally end a run that was doing fine.
- **Nothing here defends against the person's own mistake.** Ratifying an authorisation for the wrong
  merchant buys the wrong thing, correctly, with a receipt. That is what ratification means.
- **A `GET` can still charge.** [ADR-0010](./0010-acting-in-the-browser.md) named this hole and it is
  unchanged: one-click confirmation links are `GET`s, the network mechanism never sees them, and no
  authorisation is consulted. It is not closable by anything in this ADR.

## What this costs

- **The strongest guarantee in the product, spent.** `docs/SECURITY_AND_PRIVACY.md`'s
  *"capabilities that do not exist"* section shrinks, and the sentence *"Propositum cannot buy
  anything"* — currently true by mechanism — becomes *"Propositum cannot buy anything you did not
  authorise it to buy"*, which is a different and weaker claim.
- **`tests/architecture.test.ts`'s "no tool for sending, purchasing, publishing or deleting" now
  means nothing at all.** It already meant less than it says after ADR-0010; after this it is a
  statement about our function names and nothing else. The test keeps its comment saying so.
- **A new closed set to keep closed.** Currency, and the ledger of charges. Both are places a future
  change can widen quietly.
- **One more thing on the ratification screen.** [Principle 10](../PRODUCT_PRINCIPLES.md) says a
  person must be able to understand and resume in about a minute; a screen with a spend authorisation
  on it is a screen with more to read. The authorisation is rendered as one line with the amount
  prominent, not as a form.

## Revisit when

- **The amount turns out to be unparseable on most real checkouts.** Then the ceiling is theatre on
  those sites and the honest response is to say so in the interface, not to guess harder.
- **Anyone proposes an authorisation that outlives its contract.** That is a `WorkingAgreement`, it is
  reserved, and it needs its own decision — not a longer `expiresAt`.
- **Anyone proposes deriving an authorisation without ratification** — from acceptance history, from a
  previous run, from a default. [Principle 15](../PRODUCT_PRINCIPLES.md): history may recommend, it
  may never grant.
- **The refuse-and-ask path starts firing often.** That means the ceilings are drafted too tight, and
  the fix is better drafting — never a wider default, and never a remembered yes.
