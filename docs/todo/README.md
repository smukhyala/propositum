# The todo folder

Each file here is one piece of work, sized so that a person can pick it up cold.

**This is working scaffolding, not part of the corpus.** `CONTEXT.md` is still the
glossary, `docs/adr/` still holds the decisions, and nothing in this folder
overrides either. When a file here is finished, mark it done and leave it — a
finished todo is a record of what the state was when somebody started.

## How to read a file here

~~Every one has the same six headings, in this order:~~ **Struck 2026-08-26 —
that was never true and it was checked rather than assumed.** Every one covers
these six things, in this order, and where each lives is not uniform: **Blocked
by** is a bold field in the header on [`00`](./00-score-the-hypotheses.md) through
[`05`](./05-chrome-web-store.md) and a full heading on
[`06`](./06-buying-things.md) through [`08`](./08-one-time-codes.md), where there
is an argument rather than a name *(and on [`10`](./10-the-mailbox.md) and
[`11`](./11-calendar-holds.md), which carry both, copying `08`)*. ~~Three files~~ **Some files**
*(the count went stale the day [`11`](./11-calendar-holds.md) arrived with its own seventh heading,
2026-09-01, so it is deleted rather than corrected)* also carry a seventh heading of
their own, and [`02`](./02-phone-thread.md) is finished and has dropped most of
them.

The claim is corrected rather than the files, because the shape was never the
point and a rule nothing enforces is one more thing to keep true by hand.

1. **Is this already done?** — a command to run, and what its output means. Run
   it first. Work in this repository has a habit of landing without the document
   that predicted it noticing.
2. **Blocked by** — what must be finished first, and why. If the thing named
   there is not done, stop.
3. **What you have to do yourself** — the parts that are not software. An
   account to open, a fee to pay, a certificate to request, a button only a
   person can press. These have lead times and they are the reason a two-week
   piece of work takes five.
4. **The work** — numbered, in order.
5. **Done when** — the check that closes the file.
6. **What this does not cover** — stated because a finished todo reads as a
   stronger promise than it is.

A seventh is worth adding when it earns a heading: what the work **disturbed**
that nothing predicted ([`03`](./03-document-loop.md), [`04`](./04-quick-fixes.md)),
or what would make the file **deletable** rather than done
([`08`](./08-one-time-codes.md), [`11`](./11-calendar-holds.md)).

## The order, and why

| | File | Rough size | Costs money |
|---|---|---|---|
| 0 | [`00-score-the-hypotheses.md`](./00-score-the-hypotheses.md) | ~~1–2 days~~ ~~**done 2026-08-27**~~ **re-opened 2026-09-03 — the corpus grew `evening-classes` and it is unscored; `npm run eval -- --report` exits 1 saying so (the file's own status)** | ~~$1–$6 of API~~ $0.99 measured, and $0.81 more on 2026-09-02 |
| 1 | [`01-menu-bar-app.md`](./01-menu-bar-app.md) | ~~2–3 weeks, **narrowed**~~ ~~stage 1 done 2026-08-27; stage 2 (signing, bundling, release) open~~ **stage 2's code landed 2026-08-28 ([ADR-0027](../adr/0027-a-sealed-bundle-and-where-the-state-moves.md)); what stays open in the file: ~~the credential steps and first tagged release,~~ *(`v0.1.0` is a draft release since 2026-09-03)* the stranger-timing metric, and the update feed (refused for now)** | ~~$99/yr Apple Developer~~ **enrolment approved, owner-reported** |
| 2 | [`02-phone-thread.md`](./02-phone-thread.md) | **done 2026-08-26** | no |
| 3 | [`03-document-loop.md`](./03-document-loop.md) | ~~~1 week~~ ~~import, export and the editor done 2026-08-26; items 2 and 5 left~~ **Struck 2026-09-03 — item 2 is built ([ADR-0032](../adr/0032-a-page-from-a-source-already-approved.md); `grep -rln 'importApprovedPage' src/` returns hits), so only item 5 is left** | no |
| 4 | [`04-quick-fixes.md`](./04-quick-fixes.md) | ~~half a day~~ ~~done 2026-08-26, except item 7~~ ~~and item 10, added 2026-08-27~~ **Struck 2026-09-03 — item 10 is built ([ADR-0033](../adr/0033-a-late-tick-is-a-slept-machine.md); `grep -rln 'machine_slept' src/` returns hits) and item 11 opened the same day; the two left are 7 and 11** | no |
| 5 | [`05-chrome-web-store.md`](./05-chrome-web-store.md) | 1 day + weeks of waiting | $5 one-off |
| 6 | [`06-buying-things.md`](./06-buying-things.md) | ~~days, **decided not built**~~ **built 2026-09-01, except the live purchase** | what it buys |
| 7 | [`07-off-the-browser.md`](./07-off-the-browser.md) | **the largest file here**, decided not built | via `01` |
| 8 | [`08-one-time-codes.md`](./08-one-time-codes.md) | ~200 lines, **decided not built** | no |
| 9 | [`09-onboarding.md`](./09-onboarding.md) | ~~**unshaped** — written down 2026-08-27, the owner's design pass pending~~ **Struck 2026-09-03 — designed 2026-08-29, built 2026-08-30 ([#127](https://github.com/smukhyala/propositum/issues/127)); `ls src/app/first-run/page.tsx src/server/first-run.ts` returns both** | no |
| 10 | [`10-the-mailbox.md`](./10-the-mailbox.md) | days, **decided not built** | no — until a build leaves the tester circle, then the CASA bill |
| 11 | [`11-calendar-holds.md`](./11-calendar-holds.md) | ~a day, **decided not built**, and it opens with a stop-the-line check | no |

**6, 7 and 8 were written 2026-08-26**, hours after the decisions that made them necessary and in the
same pass that noticed this folder did not have them. ~~All three are **decided, not built** — the
argument is finished, the ADR is accepted, and `grep` finds nothing in `src/`.~~ **Struck 2026-09-03 —
6 is built (2026-09-01, as its table row says): its own proving grep returns hits across `src/`, and
`extension/src/cdp.js` now releases one covered non-`GET` under a ratified permit rather than refusing
them all. 7 and 8 are still decided, not built — their proving greps return nothing.** Each carries the
command that proves it. **10 and 11 joined the same class on 2026-09-01**, in the same change that
accepted [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md) — the rule about writing
the file beside the decision held this time.

They sit at the end of the table and they are **not** at the end of the order. 7 depends on 1 and on
6; 8 depends on 7. Where a file sits in this table is where it was added, and the *Blocked by*
heading inside it is the thing to believe.

**0 comes first because everything after it is premature if it fails.** ~~H1, H2
and H3 have no numbers, `eval-scores.json` is a blank worksheet,~~ **Scored
2026-08-27, and it partly failed: H1 one pass in four, H3 one missed stop, the
baseline at least as good on every scenario (`docs/EVALUATION.md`, Second run).
The sentence above now cuts the other way — what 06, 07 and 08 would buy with
their guarantees has a number, and the number is not yet worth the price.**
`docs/MVP.md` says of H2 in its own voice: *"H2 is the hypothesis that can kill
the product."* Building distribution for an unproven bet is the expensive
mistake.

**1 comes second because the bet cannot be proven further without it.** H2 needs
a rate, a rate needs verdicts, a verdict is what a person did to real work — and
no second person can currently get the thing running. ADR-0023 says so:
*"the reason n=1 is partly that the second person cannot get the thing
running."*

**4 can be done at any time** and is the only file here with no dependency. It is
last in the table and first in convenience. ~~Its item 0 is the highest value
single change in this folder, because an onboarding screen was built on
2026-08-26 and nothing links to it.~~ **Struck the same day: the front door links
it now.** ~~Nine defects left, and the largest remaining one is that there are no
route-level `loading.tsx`, `error.tsx` or `not-found.tsx` files anywhere.~~
**Struck 2026-08-26 as well — the whole file is done bar item 7**, which is a
decision only the owner should make because it invalidates any extension install
that already exists. `error.tsx` turned out to be there already; `loading.tsx`
and `not-found.tsx` landed with the rest.

**3's independent half went the same afternoon.** A document can now be opened
from a file, copied and downloaded, and the editor is prose rather than
monospace. What is left of 3 is the URL import — a capability that needs an ADR —
and the H2 numerator, which needs a person doing real work and therefore needs 1.

**6, 7 and 8 come last, and the reason is not size.** Each one makes the product
measurably less safe, and each one is currently held shut by a mechanism rather
than a rule: ~~`extension/src/cdp.js` refuses every non-`GET`~~ *(spent 2026-09-01
with 06 — it now releases one covered non-`GET` under a ratified permit,
`extension/src/cdp.js:633`)*, there is no native
binary to hold a TCC permission, and nothing reads a file on the disk. Those are
the strongest guarantees this product has, and **0 is what decides whether they
are worth spending.** Building any of them before H1, H2 and H3 have numbers is
paying the price of a bet without knowing whether the bet paid. *(2026-09-01: 10
and 11 belong to this class too — a mail scope that can read everything, a first
write to a calendar. The numbers exist now and were poor, which is said in 10's
header rather than hidden; the owner directed the work with that on the table.)*

The ADRs say this about themselves — all three open with a section headed *The
sentence that stops being true*, and each says the product
gets less safe — so this ordering is not a fourth opinion, it is the same one
written where somebody picking up work will read it.

## A note on how fast this goes stale

[`02`](./02-phone-thread.md) was written as a week of work and was finished before
the file was committed. `/welcome` landed the same afternoon and took two of
[`01`](./01-menu-bar-app.md)'s four jobs with it. [`04`](./04-quick-fixes.md)'s
item 0 was added and struck inside an hour, and [`01`](./01-menu-bar-app.md) was
narrowed twice in one afternoon — first by `/welcome`, then by `scripts/dev.ts`
collapsing two terminals into one. **Run the *Is this already done?*
commands before you believe any status line here** — that heading exists
because this repository has a documented habit of shipping the thing a document
says is missing, and then not moving the document. `README.md` carries five
struck counts making the same point.

**The habit runs the other way too, 2026-08-26.** Running the commands is what
found that `04`'s item 1 was already a third done — `src/app/error.tsx` existed
and the file did not know — and, in the same pass, that two of its counts were
*low*: item 4 named four screens saying *shift* and there were twelve, and item 8
named one misattributed quotation and there were two. So the heading earns its
place in both directions. A status line here can be behind the code, and it can
also be wrong about how much there is to do.

**And a third direction, found the same evening: a document can be ahead of the
code and read as though it were behind it.** ADR-0024, ADR-0025 and ADR-0026 were
accepted, `CONTEXT.md` gained a `PurchaseAuthorization` entry, `VISION.md` and
`SECURITY_AND_PRIVACY.md` were rewritten to describe a product that drives macOS
and spends money — and **none of it is built.** The commit that landed them says
so in as many words, and three of its own corrections said otherwise for about an
hour before being struck.

That is why the glossary entry for `PurchaseAuthorization` carries a
**specification rather than a description** fence, why [`06`](./06-buying-things.md),
[`07`](./07-off-the-browser.md) and [`08`](./08-one-time-codes.md) all lead with
*decided, not built*, and why each of them tells you to read the ADR for what was
decided and the code for what runs. **When those two disagree, the code is right.**

## What is deliberately not in this folder

- **Cloud execution.** It fixes *"leave your desk, not leave the building"* and
  it is a different product with a different privacy argument. It needs an ADR
  before it needs a todo.
- ~~**A landing `ActionKind`.** Making Propositum able to send, buy or publish is
  not a line in a set — `extension/src/cdp.js` fails every non-`GET` request
  unconditionally, and spending that mechanism needs its own ADR the way
  `Runtime.evaluate` does.~~

  **Struck 2026-08-26 — the ADR arrived, and this bullet asked for exactly the
  argument it got.** [ADR-0024](../adr/0024-purchases-within-a-ratified-authorisation.md)
  spends the block. It moves out of *deliberately not in this folder* and becomes
  work nobody has written: the `PurchaseAuthorization` on `ContractScope`, the
  line on the ratification screen, the amount parse at `Fetch.requestPaused`, the
  charge count off the ledger, and `tests/purchase-authorisation.test.ts` with
  the *"Find me food for dinner"* fixture that must never start passing.
  ~~[ADR-0025](../adr/0025-computer-use-beyond-the-browser.md) and
  [ADR-0026](../adr/0026-reading-a-one-time-code.md) are two more files this
  folder does not have~~ — and ADR-0025 is the largest single piece of work in the
  project, larger than [`01`](./01-menu-bar-app.md), which it also depends on.

  **Struck later the same day: all three files exist now.**
  [`06`](./06-buying-things.md), [`07`](./07-off-the-browser.md) and
  [`08`](./08-one-time-codes.md). This paragraph named the work in one breath and
  did not write it down in the next — which is the exact gap
  [`AGENTS.md`](../../AGENTS.md) now has a rule about: **a decision that is not
  yet built gets a file here, in the same change that accepts the ADR.** The rule
  exists because of this paragraph.

  **The `Runtime.evaluate` half of the comparison is unspent** and ADR-0025 §3
  carries it to the desktop unchanged: no shell, no `osascript`, no AppleScript.
- **Accounts, billing, teams.** `docs/FOUNDING_BRIEF.md` excludes them and is
  right to.
