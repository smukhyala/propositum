# Offer reticence — remembering that you said no

**Status:** design, for review · 2026-08-22
**Requested by:** the owner — _"add logging for accepted vs rejected task proposals so it can be
fine tuned to user"_
**Governs:** a new `OfferReticence` table, a narrowing-only policy over
`src/domain/detection/grounds.ts`, and one line on the front door
**Needs:** ADR-0020 before the policy lands. The table and the writer do not.

---

## What was asked for, and what turned out to already exist

The request reads as one thing and is three, and two of them are already built. Stating that first,
because it is most of the answer.

| What gets decided | Accepted             | Rejected                              | Read by                    |
| ----------------- | -------------------- | ------------------------------------- | -------------------------- |
| `ProposedChange`  | `ChangeVerdict` row  | `ChangeVerdict` row                   | `npm run eval -- --report` |
| `ShiftOutcome`    | `OutcomeVerdict` row | `OutcomeVerdict` row                  | `npm run eval -- --report` |
| `WorkOffer`       | full durable row     | **`offersDeclined += 1`, no subject** | `--report`, as a rate      |

Per-change and per-outcome accept/reject is **already logged in full** — append-only, timestamped,
one row per decision — and already read: `printH2` in `scripts/eval.ts` tallies it off the durable
database and scores it against `H2_PASS_RATE`. `PRODUCT_PRINCIPLES.md` §15's line that _"the verdict
tables are append-only and have no reader"_ means no reader **that changes behaviour**; `scoreH2`
has no production caller, which is a different and deliberate fact.

So there is nothing to add on that side, and this design adds nothing. The gap is offers.

## The gap, at its real size

An accepted offer becomes a `WorkOffer` row carrying its title, rationale and thread signature. A
declined offer becomes `+1` on an integer in `OfferTally` and **nothing else** — no signature, no
origin, no title. That asymmetry is deliberate, and `src/server/ambient-store.ts` states why:

> a durable row saying "Propositum thought you were job-hunting" about an offer **NOBODY ACCEPTED**
> is exactly the profile this buffer refuses to become.

Per-strand narrowing does already exist, and this is the part most easily missed: `declineThread`
snoozes the declined signature for `SNOOZE_MS` — one hour — so _"not now"_ already means something
more specific than a counter. It lives in the in-memory ambient buffer, so it dies on restart and is
forgotten with the buffer.

**This design does not invent a capability. It makes an existing one durable, and pays the price
that durability costs.**

## The decision

**Declines accumulate against a hashed strand identity, raise the bar for that strand only, decay,
and are visible when they act.**

### 1. The table

```prisma
model OfferReticence {
  /// sha256(signature + per-install salt), hex. Never the terms themselves.
  signatureHash  String @id
  /// How many times a strand hashing to this has been declined.
  declines       Int    @default(0)
  /// The local calendar day of the most recent decline, `YYYY-MM-DD`.
  lastDeclinedOn String

  @@map("offer_reticence")
}
```

Four things about this shape, each of which is the answer to something already argued in the
repository:

**A date, never an instant.** `OfferTally` carried an `updatedAt` and it was deleted the day it
landed, because a millisecond instant is _"a durable, per-day record of roughly when this person
stopped browsing"_ — 3,600,000 times finer than the hour bucket that table had already refused. The
same argument applies here unchanged, so `lastDeclinedOn` reuses `dayBucket()` from
`src/server/offer-tally.ts` and stores a string.

**No column a subject could go in.** As with `OfferTally`, this is structural rather than a promise:
there is no `signature`, no `origin`, no `title`, no `subject`. A test asserts the column list, the
way `tests/eval.test.ts` already does for `OfferTally`.

**Nothing about accepts is stored.** An accept already writes a `WorkOffer`. Here, an accept
**deletes the row** for that hash — see §3.

**One row per strand identity, not per decline.** A decline log with one row per event would be a
timeline of when you dismissed things. A count and a day is what the policy needs and is the least
that will do it.

### 2. What the hash does, and what it does not

It stops the database being readable at a glance, and it stops any correlation of one install's
rows against another's.

The salt is 32 random bytes, generated once on first use and stored in a one-row `install_secret`
table in the same database. There is no keychain integration and this design does not add one — a
secret in the same file as the data it protects is the honest shape of what is available, and
pretending otherwise by putting it in an env var the app also reads would buy nothing.

It does **not** stop someone confirming a guess. The salt lives in the same SQLite file, so anyone
holding the database holds the salt, and `sha256('forecast+kauai+south+weather' + salt)` is a
comparison anybody can make. The signature space is small enough for a candidate list to be worth
trying.

That limit is stated here, in ADR-0020, and in `docs/SECURITY_AND_PRIVACY.md` — rather than left to
be implied by the word _hash_, which is exactly the shape of promise §11 forbids. **What the hash
buys is that no process, log line or backup ever contains the terms in readable form.** It is a
real improvement over plaintext and it is not anonymity.

### 3. The policy — narrowing only

`src/domain/detection/grounds.ts:1278` is the bar:

```ts
sufficient: intent.length >= INTENT_REQUIRED && axes >= INVESTMENT_REQUIRED
```

Reticence raises the second number, for one strand:

```
required = INVESTMENT_REQUIRED + min(declines, 2)
```

So a strand declined once needs three investment axes instead of two; declined twice or more, four.
`INTENT_REQUIRED` is untouched. **The term is added, never subtracted**, and that is enforced by a
property test rather than by the shape of the expression — see §6.

**The interface change this forces, named rather than discovered during implementation.** The
grounds computation is a pure domain function and has no database. It gains one optional parameter —
a `declines: number` defaulting to `0` — and the caller in the detection path is what looks the hash
up. That direction matters: the domain stays pure and testable, the impure lookup stays at the edge,
and a caller that forgets to pass it gets today's behaviour rather than a crash or a silent widening.

**Where the held-back count comes from.** The detection path already drops strands for two reasons —
snoozes, and `MAX_THREADS_SHOWN` — and counts the latter as `strandsSuppressed`. Reticence is a
third reason and must be counted **separately**, not folded into that number: `strandsSuppressed`
means "found, good enough, and cut for room", and a strand held back by reticence was not good
enough under its own raised bar. Merging them would make an existing metric mean two things, and the
front-door line needs the reticence count alone.

**An accept deletes the row.** This is the only thing that lowers the bar, and it is a person
acting, which is precisely what §15 permits: _"Trust history may narrow autonomy on its own;
widening always needs a person."_ It also makes the mechanism self-healing rather than a ratchet
that only ever tightens.

**Decay.** Rows whose `lastDeclinedOn` is more than 30 days old are deleted. A person who stopped
caring about a subject a month ago should not still be paying for it, and a reticence that only
accumulates would eventually silence the product. The sweep lives in the worker beside
`sweepActionEvidence` (`src/server/evidence-sweep.ts`), which already runs on startup and hourly for
exactly this kind of retention and already argues why both halves are needed.

### 4. It has to be visible, and that is not a nicety

§15 forbids _"a default computed from past behaviour and applied without being shown"_, and a
suppressed offer is invisible by construction — there is no screen for the thing that did not
happen. Worse: `strandsSuppressed` already counts strands found and discarded in silence, which
ADR-0008 names as the failure the multi-strand change existed to remove, and ADR-0018 says it _"makes
that number bigger and does not fix it."_ Shipping reticence without a surface makes an acknowledged
failure worse.

So the front door gains one line, rendered only when reticence actually held something back:

> Two things were held back because you've said not now to them before. **Show them anyway**

Three properties, all load-bearing:

- It is shown **only when the policy acted**, so it is not decoration on a quiet day.
- It **names no subject** — a count, exactly as the counters do. Saying _which_ thing was held back
  would put the subject on screen, which is the row this design refuses to store.
- **Show them anyway** is a human act, and therefore the one control allowed to widen. Pressing it
  renders the held strands for that poll; it does not delete the rows. Accepting one does.

**The policy and this line ship in the same commit.** The policy alone is the §15 violation, and a
sequence where it lands first "and the UI follows" is that violation with a plan attached.

### 5. What is NOT in this design

- **No accept-side learning.** Nothing gets easier because you said yes. That is §15's first
  forbidden clause and it is not being spent.
- **No cross-strand generalisation.** A decline about one strand teaches nothing about a similar
  one. Doing that needs a notion of similarity between subjects, which is a model reading your
  declines — a much larger decision, and one this design would rather leave open than half-take.
- **Nothing in the product reads `ChangeVerdict` / `OutcomeVerdict`.** They stay CLI-only. The only
  thing the app could do with a per-change acceptance rate is change behaviour, and per-change
  verdicts are not the signal that should tune whether Propositum speaks.
- **No extension change.** `/api/capture/ambient/decline` still takes an origin, so declines through
  the notification path stay origin-wide and cannot key a signature. That gap is named in
  `ambient-store.ts` already; this design does not close it and does not widen it.

### 6. Tests

| What                                                                               | Why it is not covered by the ones above                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Property: no sequence of declines yields `required < INVESTMENT_REQUIRED`          | The direction is the whole principle. An expression that looks additive today can be edited; this fails if the edit lands.        |
| Source-text guard: the writer's call sites pass no signature, origin, title or URL | The same shape as `tests/eval.test.ts`'s `OfferTally` column assertion and `calendar-scope`'s refusals — structural, not trusted. |
| Column-list assertion on `offer_reticence`                                         | Makes "no column a subject could go in" checkable rather than promised.                                                           |
| Accept deletes the row; decline increments it                                      | The self-healing half, which is what keeps this from being a ratchet.                                                             |
| The sweep deletes past 30 days and nothing newer                                   | Retention promises that nothing runs are the ones that quietly stop being true.                                                   |
| Reachability: the held-back line is rendered from `src/app/page.tsx`               | Otherwise §15's answer is prose with nothing enforcing it — the same gap `reachability.test.ts` exists for.                       |

### 7. Sequence

Each step leaves the suite green and the product coherent.

1. **Schema, writer, and the hash.** Declines are recorded. Nothing reads them. No behaviour change.
2. **The 30-day sweep**, in the worker beside the evidence sweep.
3. **The policy and the front-door line, together.** Never apart.
4. **ADR-0020**, the `SECURITY_AND_PRIVACY.md` paragraph, and `README.md`'s ADR count 19 → 20 —
   which `tests/counts.test.ts` enforces.

Step 1 is shippable on its own and is genuinely useful without step 3: it answers _"is anybody
declining, and is it the same thing repeatedly"_ from real data, which is the question that should
decide whether step 3 is worth having at all.

## The strongest objection, stated rather than answered

A hash of a short term-set is a weak anonymiser, and this design spends a real refusal —
`ambient-store.ts`'s sentence about the job-hunting row — to buy a behaviour that a person could
also get by pressing "Not now" twice. The honest counter is that they _cannot_: the current snooze
forgets in an hour, so a person who declines the same strand every evening for a week is asked
seven times and the product learns nothing. That is the failure being fixed, and it is a real one.

What this design does not claim is that the hash makes the row harmless. It makes it unreadable,
non-portable and short-lived. Whether that is enough is the question ADR-0020 has to answer in the
open, and it is the reason the ADR gates step 3 rather than step 1.
