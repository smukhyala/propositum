# The todo folder

Each file here is one piece of work, sized so that a person can pick it up cold.

**This is working scaffolding, not part of the corpus.** `CONTEXT.md` is still the
glossary, `docs/adr/` still holds the decisions, and nothing in this folder
overrides either. When a file here is finished, mark it done and leave it — a
finished todo is a record of what the state was when somebody started.

## How to read a file here

Every one has the same six headings, in this order:

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

## The order, and why

| | File | Rough size | Costs money |
|---|---|---|---|
| 0 | [`00-score-the-hypotheses.md`](./00-score-the-hypotheses.md) | 1–2 days | ~$1–$6 of API |
| 1 | [`01-menu-bar-app.md`](./01-menu-bar-app.md) | 2–3 weeks, **narrowed** | $99/yr Apple Developer |
| 2 | [`02-phone-thread.md`](./02-phone-thread.md) | **done 2026-08-26** | no |
| 3 | [`03-document-loop.md`](./03-document-loop.md) | ~~~1 week~~ **import, export and the editor done 2026-08-26; items 2 and 5 left** | no |
| 4 | [`04-quick-fixes.md`](./04-quick-fixes.md) | ~~half a day~~ **done 2026-08-26, except item 7** | no |
| 5 | [`05-chrome-web-store.md`](./05-chrome-web-store.md) | 1 day + weeks of waiting | $5 one-off |

**0 comes first because everything after it is premature if it fails.** H1, H2
and H3 have no numbers, `eval-scores.json` is a blank worksheet, and
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

## What is deliberately not in this folder

- **Cloud execution.** It fixes *"leave your desk, not leave the building"* and
  it is a different product with a different privacy argument. It needs an ADR
  before it needs a todo.
- **A landing `ActionKind`.** Making Propositum able to send, buy or publish is
  not a line in a set — `extension/src/cdp.js` fails every non-`GET` request
  unconditionally, and spending that mechanism needs its own ADR the way
  `Runtime.evaluate` does.
- **Accounts, billing, teams.** `docs/FOUNDING_BRIEF.md` excludes them and is
  right to.
