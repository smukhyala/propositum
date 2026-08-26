# ADR-0020 — Remembering a decline

**Status:** accepted · 2026-08-22
**Depends on:** [Principle 15](../PRODUCT_PRINCIPLES.md) — _learned trust may recommend; it may
never grant_. This ADR is the first thing in the product that learns anything, so it is the first
thing that principle binds rather than describes
**Extends:** [ADR-0008](0008-ambient-detection.md) — the snooze `declineThread` already applies to a
declined signature, made durable and given a decay ·
[ADR-0015](0015-measuring-loudness-and-saving-an-afternoon.md) — `offer_tally`'s shape argument,
reused unchanged: a day, never an instant, and no column a subject could go in
**Amends:** nothing is struck. What it **spends** is a written refusal in
[`src/server/ambient-store.ts`](../../src/server/ambient-store.ts), and _The price paid_ below is
that transaction stated rather than netted out
**Requested by:** the owner, 2026-08-21 — _"add logging for accepted vs rejected task proposals so
it can be fine tuned to user"_. Two thirds of that request turned out to be built already; see
[the design](../superpowers/specs/2026-08-22-offer-reticence-design.md)
**Anticipated by:** [ADR-0016](0016-everyday-computing-direction.md), refusal 3 and its final
_Revisit when_ — this is the ADR that entry says will one day be written

---

## The gap, at its real size

Saying _not now_ to a strand already means something more specific than a counter, and this is the
part most easily missed. `declineThread` snoozes the declined **signature** for `SNOOZE_MS` — one
hour — so the next poll does not put the same thing back. Per-strand narrowing exists.

It lives in the in-memory ambient buffer. It dies on restart and it is forgotten with the buffer.

So a person who turns down the same strand every evening for a week is asked seven times, and
Propositum learns nothing from any of the seven. `OfferTally` records that it happened —
`offersDeclined += 1`, and by design **no signature, no origin, no title** — which answers _how
often does this product get told no_ and cannot answer _is it being told no about the same thing_.
Neither half of what exists holds the answer: the half that knows which strand forgets in an hour,
and the half that persists never knew.

**This ADR does not invent a capability.** It makes an existing one durable, and pays what
durability costs.

## The decision

**A decline accumulates against a salted hash of the strand's signature; the count raises the bar
for that strand alone, by at most two; it decays after thirty days; and an accept clears it.**

Concretely:

|                |                                                                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stored**     | one row in `offer_reticence` per strand identity: `signatureHash`, `declines`, `lastDeclinedOn`                                                                            |
| **The bar**    | `required = INVESTMENT_REQUIRED + min(declines, 2)`, so a strand turned down once needs three investment axes and twice-or-more needs four. `INTENT_REQUIRED` is untouched |
| **Decay**      | rows whose `lastDeclinedOn` is more than **30 days** old are deleted, by `sweepReticence` in the worker beside `sweepActionEvidence`                                       |
| **Cleared by** | accepting an offer for that strand — the row is deleted, not decremented                                                                                                   |
| **Visible as** | one front-door line, rendered only when reticence actually held something back                                                                                             |

**Corrected 2026-08-22 — _The bar_ above is the arithmetic, and the arithmetic is not the whole
gate.** The row stays exactly as written, because it is what was decided and a later reader should
find it; what follows is what it left out.

Both halves of that row are true — the term added is `min(declines, 2)`, and `INTENT_REQUIRED` is
genuinely untouched — and together they read as though a declined strand's only new obstacle is one
or two extra investment axes. It is not. `src/server/front-door.ts` gates a declined strand on
`groundsFor(...).sufficient`, which is the whole grounds bar: an intent ground **and** enough axes,
not the axes alone. So a strand that has no intent ground at all is held back by reticence however
many investment axes it has, and stays held back until the row decays — where the sentence above
implies one decline leaves it showing. An eight-minute afternoon on a newsletter, followed across
three sites and never searched for, is exactly that strand, and `detectThreads` admits it.

**That is the code narrowing more than this ADR described, which is an incomplete description rather
than a breach.** Principle 15's rule is an asymmetry: history may narrow autonomy on its own and may
never widen it. A gate that is stricter than the text said is on the permitted side of that line —
the direction the property test holds is unaffected, and no sequence of declines makes Propositum
speak where it would otherwise have been quiet. The stricter reading is also defensible on its own
terms rather than merely tolerable: a strand that never produced an intent ground is the newsletter
afternoon the grounds bar exists to refuse, and asking for one before speaking about a subject
somebody has already turned down is the conservative thing to want.

**What was considered and not done, since it is the obvious repair.** `groundsFor` could return its
axes count, and the front door could then compare that count against `required` alone and match the
sentence to the character. That is a change to the shape of the one interface the offer gate and the
front door both read, made late, to buy agreement with a sentence rather than any behaviour a person
would notice — and the sentence is the half that was wrong. So the sentence moved.

Four details are each the answer to something this repository has already argued, so they are
settled rather than open:

**A date, never an instant.** `OfferTally` carried an `updatedAt` and it was deleted the day it
landed, because a millisecond instant is a durable per-day record of roughly when this person
stopped browsing — finer, by 3,600,000, than the hour bucket that table had already refused.
`lastDeclinedOn` reuses `dayBucket()` and stores a `YYYY-MM-DD` string.

**No column a subject could go in.** Structural, not a promise: there is no `signature`, no
`origin`, no `title`, no `url`. `tests/reticence-store.test.ts` asserts the column list, the way
`tests/eval.test.ts` already does for `OfferTally`.

**One row per strand identity, not one per decline.** A row per event would be a timeline of when
you dismissed things. A count and a day is what the policy needs and the least that will do it.

**Nothing is stored about an accept.** An accept already writes a `WorkOffer`. Here it only deletes.

_On the word._ The column is `declines` because `OfferTally.offersDeclined` is already spelled that
way and a second vocabulary for one event would be worse than an imperfect first. `CONTEXT.md`'s
four verbs reserve _declines_ for the model; in consumer copy the person's act is **Not now**, and
this ADR changes nothing about that.

## Why this is inside Principle 15, not a reversal of it

§15 is the principle that would forbid this if anything did. Its rule is an asymmetry, not a ban:

> A false narrowing is annoying and a false widening is dangerous, so the bias belongs on that side,
> exactly as it does for stop conditions.

and, in the sentence this ADR is built on:

> Trust history may narrow autonomy on its own; widening always needs a person.

Reticence narrows and only narrows. The term is **added** to the bar and never subtracted, so no
sequence of declines can make Propositum speak where it would otherwise have stayed quiet. That
direction is held by a property test rather than by the shape of the expression, because an
expression that looks additive today is one edit from not being.

The one thing that lowers the bar is a person accepting an offer, which is a person acting — the
widening §15 permits, in the form it demands. It also stops the mechanism being a ratchet: a subject
you turned down four times and then took up is not one Propositum should stay quiet about.

**This was already ruled allowable, and the citation matters more than the argument.** ADR-0016's
refusal 3 left this design out of slice 1 and said exactly why:

> Worth naming precisely, because there is a version of this that Principle 15's own asymmetry would
> permit: history may **narrow** on its own and may never **widen**, so a policy that can only raise
> the bar for speaking is inside the rule. That version is a real design and it is **not built
> here**, by scope decision on 2026-08-20.

and its _Revisit when_ closes the loop:

> **Somebody proposes an intervention policy that only narrows.** It is inside Principle 15 and it
> is a real design. It needs its own ADR, and the reason it is not in this one is scope, not
> principle — so the next reader does not have to re-derive that it was allowed.

This is that ADR. Nothing is being overturned; a deferral is being taken up on the terms it was
deferred under.

**§15's closing line moves, and it is worth saying which way.** It reads _"Enforced by nothing,
because nothing learns yet. No component reads acceptance history…"_ After this ADR, one component
does — `groundsFor`, through one optional `declines` parameter that defaults to `0`. The principle
stops being a rule about a future and becomes a rule about a live code path, which is the moment it
was written for: _"This principle is being written before the first thing that learns, which is the
only point at which a rule like this is cheap — after, it is a migration."_ It is now cheap and it
is now load-bearing.

**Which is why the policy and the front-door line ship in one commit.** §15 also forbids _"a default
computed from past behaviour and applied without being shown"_, and a suppressed offer is invisible
by construction — there is no screen for the thing that did not happen. `strandsSuppressed` already
counts strands found and discarded in silence, which ADR-0008 names as the failure the multi-strand
change existed to remove and ADR-0018 says _"makes that number bigger and does not fix it"_. So the
front door gains one line, shown only when reticence acted, naming a count and never a subject:

> Two things were held back because you've said not now to them before. **Show them anyway**

The policy alone is the §15 violation, and a sequence where it lands first _and the interface
follows_ is that violation with a plan attached.

## What the hash does not buy

`src/domain/detection/reticence.ts` states this in its own docblock and this ADR says the same thing
in the same words, deliberately, so that neither is the only place a reader could find it.

The salt is 32 random bytes, made once on first use, never rotated — rotating it would silently
orphan every row, every count would read as zero, and nothing would fail — and stored in a one-row
`install_secret` table **in the same SQLite file as the rows it salts**. There is no keychain here;
~~reaching the macOS Keychain needs a signed native helper this product does not have and is not
building ([ADR-0012](0012-screen-capture-refused.md))~~ **— corrected 2026-08-26: the helper exists
and the Keychain is refused, which is a different sentence.**
[ADR-0023](0023-the-tray-app-owns-the-runtime.md) is a signed binary and
[ADR-0025](0025-computer-use-beyond-the-browser.md) gives it three TCC grants; reaching the Keychain
from it is a credential-storage decision nobody has taken, and ADR-0023's prohibition 3 is the file
that knows. **Nothing about this table changes** — the salt is still beside the rows it salts and
that is still not anonymity. And moving it to an env var the app also reads would buy nothing while
looking like it bought something.

What that means, plainly:

- **It does stop the database being readable at a glance**, and it stops one install's rows being
  correlated against another's, because the salt differs per install.
- **It does not stop somebody confirming a guess.** Anyone holding the database holds the salt, so
  `sha256(salt + ':' + 'forecast+kauai+south+weather')` is a comparison they can make, and the space
  of plausible signatures is small enough for a candidate list to be worth trying.
- **What is bought is that no process, no log line and no backup ever contains the terms in readable
  form.**

That is a real improvement over plaintext **and it is not anonymity.** The limit is written here, in
the module, and in [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md), rather than left to
be implied by the word _hash_ — which is exactly the shape of promise Principle 11 forbids.

## The price paid

`src/server/ambient-store.ts` refuses, in writing, the thing this ADR partly does:

> a durable row saying "Propositum thought you were job-hunting" about an offer **NOBODY ACCEPTED**
> is exactly the profile this buffer refuses to become. Declining has to cost nothing and leave
> nothing behind, or the honest thing to do with the feature is turn it off.

**After this ADR, declining leaves something behind.** There is now a durable row per declined
strand identity, written on a path that previously wrote nothing, and it exists precisely because
nobody accepted the offer. That is a refusal being spent, not a refusal being reinterpreted, and the
reason it is stated in the ADR body rather than in a footnote is that a later reader looking for how
this was allowed should find it at full size.

What the payment does **not** include, stated so the debit is not read as larger than it is: the row
holds a hash, a small integer and a date; it names no subject and has no column one could go in; it
is deleted by an accept and by the thirty-day sweep; and it is per-install, so it is not portable.
The buffer's own promise — that nothing you looked at reaches the database, no URL, no title, no
dwell — is unchanged, and no page ever becomes durable on this path.

What is honestly lost is the word **nothing**. `ambient-store.ts`'s sentence is now true of the
buffer and no longer true of the product, and that file's docblock is the place a reader will meet
the older claim first.

## Rejected alternatives

**Storing the signature in plaintext.** The simplest thing that works, and it is the refused row
unmitigated — `SELECT * FROM offer_reticence` would read as a list of subjects this person was
thinking about and turned down, in a file no button reaches and every backup copies. The hash does
not make the row harmless; it makes it unreadable, non-portable and short-lived, which is a
different and smaller claim, and it is the one worth paying for.

**Narrowing globally off `OfferTally`, with no new storage at all.** Genuinely safe: the counts
exist, nothing new is written, no refusal is spent. It fails on the only thing that matters — it
cannot tell one subject from another. A person who turns down four unrelated suggestions and wants a
fifth about something else would get a quieter product across the board, which is a worse product
rather than a better-targeted one, and it would make Propositum quiet about the very strand a person
is about to say yes to. The per-strand behaviour is the feature; global volume is the thing that
would be degraded by having it.

**Accept-side learning — a strand getting easier because you said yes to it before.** This is §15's
first forbidden clause, _acceptance history widening a permission_, and it is not being spent. It is
also the more tempting half, because it feels generous rather than restrictive, which is why the
principle names it first.

**Cross-strand generalisation** — a decline about one subject teaching Propositum about a similar
one. That needs a notion of similarity between subjects, which is a model reading your declines. A
much larger decision, and one this ADR would rather leave open than half-take.

**Closing the extension's decline path at the same time.** `/api/capture/ambient/decline` takes an
origin, so declines through the notification path stay origin-wide and cannot key a signature. That
gap is already named in `ambient-store.ts`. This ADR neither closes it nor widens it.

## Where this could still go wrong

**Two counts of "did not appear", and adding them would be wrong.** `strandsSuppressed` means
_found, good enough, and cut for room_ — `MAX_THREADS_SHOWN`. The reticence count means _held back
because it did not clear its own raised bar_. They are different facts about different strands, and
a future reader who sums them to answer _how much did Propositum hold back today_ will produce a
number that is not about anything. They are deliberately not merged for that reason: folding
reticence into `strandsSuppressed` would make an existing metric mean two things, and the front-door
line needs the reticence count alone. If a single held-back total is ever wanted, it needs its own
name and its own argument, not an addition.

**A held-back strand frees its display slot, and something else takes it.** Found in review of the
first implementation, kept rather than fixed, and written down here because it is the sort of edge a
later reader will find on their own and assume was an oversight. The front door bounds what it shows
by `MAX_THREADS_SHOWN`, and reticence removes a strand **before** that bound is applied. So with four
qualifying strands and a bound of three, holding the first one back does not leave two on screen — it
puts the fourth one there, which would otherwise have been counted in `strandsSuppressed` and never
seen.

That is inside Principle 15 rather than a breach of it, and the distinction is worth being exact
about. **No bar was lowered for the promoted strand.** It had already cleared every gate on its own
grounds, and nothing about the declined strand's history bought it anything. What changed is that a
slot stopped being occupied by a strand nobody wants to see. §15 forbids history WIDENING a
permission; vacating a queue position is not a permission, and the promoted strand is subject to
exactly the same bar it always was — including its own reticence, if it has any.

**Added 2026-08-22 — and the promoted strand arrives with a name now.** It did not at first, and the
reason is worth keeping: `/api/session/current` applied the display bound **before** reticence while
Home applied it after, so on the four-strand afternoon the poll named A, B, C and the screen showed
B, C, D. D reached the front door with no subject, and kept the degraded sentence for as long as the
buffer held it, because that poll is the only thing in the product that ever calls `nameThread`.
Two spellings of one derivation is what produced it — the poll held its own copy of the filters and
gained no reticence check when the screen did. The poll now takes its strands from
`noticedAfternoon`, so what Home shows is what the poll names and pins, and there is one spelling to
keep true.

The alternative was considered and is worse for the person: checking reticence after the bound would
make a held-back strand spend one of three slots and render nothing in it, so a decline would cost
the person a proposal about something else. That is a real loss to buy a symmetry nobody benefits
from.

What it costs is precision in the counters, and it compounds the entry above. `strandsSuppressed`
stays honest — the promoted strand genuinely was not cut for room. But the total number of strands
that did not appear is now `strandsSuppressed + heldBack`, and **neither number alone answers "what
did Propositum not show me today"** while the sum still does not answer "how much did Propositum hold
back", for the reason the entry above gives. Both readings are wrong and the second is the tempting
one. `tests/front-door.test.ts` pins the promotion so that a later re-ordering has to arrive through
a failing test rather than through a tidy-up.

**The visibility answer is an interface requirement, so it is only as true as its test.** §15 is
answered by a line on the front door, and prose in an ADR cannot keep a line rendered.
The policy ships with an assertion in
`tests/reachability.test.ts`, by file path, that the held-back line is reached from
`src/app/page.tsx` — and that assertion is the whole enforcement. Deleting it, or letting it pass
against a line rendered where nobody meets it, would leave this ADR claiming a defence the product
no longer has. It is exactly the gap that test already exists for.

**A weak anonymiser on a small input space.** Said again here because it is the objection most
likely to be raised by someone who reads only this section: a hash of a short term-set is guessable
by anyone holding the file, and the file is not encrypted. The mitigation is retention and shape,
not cryptography.

**Thirty days is a guess.** It is chosen to be longer than a piece of work and shorter than a habit,
and nothing has measured it. If declines turn out to cluster inside a week, the number is too
generous and the rows outlive their usefulness; if a person returns to a subject every six weeks,
they will be asked as though they had never said no. Either finding should move the constant, and
`RETICENCE_RETENTION_DAYS` is one number in one file so that it can be moved.

**The cap could stop being a cap.** `min(declines, 2)` bounds the narrowing at two extra axes; a
later edit that removes the cap to make the product _really_ listen would turn a bounded reticence
into a mechanism that can silence a strand permanently, which is the ratchet the accept-clear exists
to prevent. The property test holds the direction and not the ceiling.

## Revisit when

- **The counts show nobody turns down the same strand twice.** Then the policy is not worth having,
  the schema and the writer can stay as a measurement, and the honest move is to say so rather than
  finish the plan out of momentum.
- **Anything asks for the decline path to key on a subject.** That is the refused row arriving by
  another route, and this ADR is where the price was recorded.
- **A native helper is built for any reason.** Then the salt can leave the database, and the honest
  limit in _What the hash does not buy_ becomes a smaller one. ADR-0012 is the document to reopen.
