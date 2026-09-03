# ADR-0032 — A document may come in from a host, but only one already approved

**Status:** accepted · 2026-09-03
**Depends on:** [ADR-0006](./0006-trust-boundary.md) (the one datamark door, and only that),
[ADR-0002](./0002-observation-capture.md) (the worker's browser stays a separate process),
[ADR-0004](./0004-policy-gate.md) (the gate whose token this deliberately does not mint)
**Answers:** [`docs/todo/03-document-loop.md`](../todo/03-document-loop.md) item 2, open since
2026-08-26

## The cost, first

Today the app process fetches nothing from anybody's host. After this it fetches one page, on a
press, from an origin the person already approved — so **the process that holds the database and the
API key has an egress it did not have**, and a document the person saves can hold bytes a host chose
rather than bytes they typed.

Both halves are real and neither is new in kind. Page text already reaches a document by paste, and
`src/runtime/worker-loop.ts` already says so in the one place it matters: *"a document accumulates
text the person pasted out of pages, and nothing distinguishes those bytes from the ones they
typed."* What changes is who does the fetching, and it is now the app rather than the worker.

## Context

Four sentences stop being true today, and they are all the same sentence:

- `README.md`, *Current limitations*: *"There is no URL import … the first of those is a capability
  rather than a convenience — text fetched from a host is untrusted in a way a file you picked
  yourself is not, and it needs an ADR before it needs a button."*
- `AGENTS.md` names `README.md` as the authority on what is built, so its framing follows that line.
- `docs/todo/03-document-loop.md` item 2: *"Import from a URL. Only from an approved source, and only
  through the existing gate … It needs an ADR before it needs a control."*
- `src/ui/document.tsx`'s docblock: *"Not `.docx`, and not a URL … it needs its own ADR before it
  needs a control."*

This is that ADR. The premise every one of them states is correct and is kept: **a file a person
chose in their own operating system's dialog is not the same object as bytes fetched from a host**,
and the difference is not that one is riskier text. It is that the second is an *act Propositum
performs on the person's behalf, against a machine belonging to somebody else*. A file import needs no
permission model because nothing leaves the machine. A page import does.

Item 2's own wording — *"only through the existing gate"* — turns out to be the part that cannot be
taken literally, and §2 is why.

## Decision

### 1. The person supplies an address; the project's approved sources decide whether it is fetched

The import takes a web address the person types or pastes. It is matched with the existing
`matchesPattern` against the `ApprovedSource` rows of **that project**, `grantState: 'granted'` only.
No match is a refusal named `source_not_approved` — the same word the gate uses for the same thing,
so a person who has seen one refusal recognises the other.

**There is no field for approving a host from the import.** The control cannot widen the allowlist,
offer to, or carry a "just this once". Approving a source is a Chrome host grant mirrored by a form
three sections up the same screen; the import is downstream of that and can only ever be. That is the
absence this decision leans on, rather than a rule about what nobody should add.

Two smaller refusals ride along, both already in `matchesPattern`: only `http:` and `https:`, so a
`file:` or `data:` address is not an address here; and a redirect that lands on a different origin
from the one approved is refused after the fact, the way `src/policy/playwright-fetcher.ts` already
refuses one.

### 2. It is not a tool, and it mints no `AuthorizedAction`

**The rejected option, at its strongest.** Route the import through `authorize()` and
`readApprovedSource`. It is the obvious design and almost everything recommends it: one allowlist
check, one refusal vocabulary, one `ActionIntent` and one `ActionOutcome` in the ledger, and the
person's own re-entry screen would show *"read Northwind's partnership page"* beside everything else
Propositum did. `tests/architecture.test.ts` says a capability reaching the network goes through the
gate, and this would be the letter of that.

It is refused because of what it would have to invent in order to typecheck. `authorize()` takes an
`EnforcedPolicy`, which `compilePolicy` produces from a `ContractScope` — a **ratified
`HandoffContract`**. A person on the project screen has no contract, is not away, and has handed
nothing over. Minting a policy to satisfy the parameter means minting an `AuthorizedAction` outside a
ratified agreement, and every safety property in this repository rests on that being impossible.
ADR-0006 §5 is explicit: *"No `AgentRun` may start from an unratified `HandoffContract`."* A
synthetic contract nobody agreed to, created so that a convenience could reuse a token, is the shape
that ends that sentence — not loudly, but by making it conditional.

So the import gets a **narrower door instead of a borrowed one**: `importApprovedPage` in
`src/policy/page-import.ts`. It has no `ActionKind`, takes no `AuthorizedAction`, holds no
`BrowserControl`, and returns text. It cannot click, type, navigate, press a key, take a picture or
buy anything, because there is no parameter by which any of those could reach it. It is not in
`src/policy/tools.ts` and must never be: that file's invariant is that everything in it is gated, and
adding an ungated function beside the gated ones would spend the guard rather than pass it.

The honest summary: **this is a network capability outside the gate, and what bounds it is that it
can only read, only an origin already approved, and only when a person presses.**

### 3. The text crosses `datamark()`, which is still the one door

The fetched text goes through `datamark()` before it is returned, and what lands in the box is
`.sanitized` — control characters, zero-width characters and bidi overrides removed, exactly as for
every other page-authored string. `looksAdversarial()` is true when sanitisation removed something
that does not occur in benign article text, and the person is told so in the line under the box,
before they save anything.

This costs a **third member of `RetentionBudget`**, and that is the part worth arguing rather than
noting. `src/model/untrusted.ts` declares the set of budgets closed, code-owned and justified by two
paragraphs, precisely so a third cannot be invented at a call site. This one is invented in that
file, with its paragraph, and published in `docs/SECURITY_AND_PRIVACY.md` beside the other two:
**200,000 characters**, the same bound a file import already refuses past, because a document
arriving from a host and a document arriving from a disk are one object and should not have two caps.

The alternative was to reuse the 2,000-character excerpt budget. That budget is a promise about what
Propositum retains about a person's **browsing**, and this is not that; borrowing it would either
make the promise false or make the feature a 350-word stub. Reusing `SNAPSHOT_BUDGET_CHARS` would
have been worse — a promise about what an **acting agent** kept, quietly spent on something else,
which is the exact failure that file's second paragraph exists to describe.

Above the budget the import **refuses rather than truncates**, on item 1's argument kept verbatim: a
document arriving with its ending silently removed is the worst of the three behaviours. So the
budget's truncation is unreachable from this path, and it sits there as the door's own floor rather
than as the thing that bounds a document.

### 4. Nothing is stored, and neither ledger is touched

The fetched text lands **in the box on screen**. It is stored only if the person presses the save
button that was already there, which runs the server action that was already there, which runs
`normalise` as it always did. Same path, no second door — the property
`tests/document-import.test.ts` pins for a file, extended to a page.

No `ObservationEvent` is written. A person-initiated read on a project screen is not a `WorkSession`
observation, there may be no session at all, and inventing a kind for it would put an app-process
fetch into the ledger whose whole claim is that it records what the person did in their own browser.
No `ActionIntent` is written either, because §2 means there is no action. **Both ledgers are
untouched, and they stay disjoint.**

The cost of that is stated rather than hidden: **the import leaves no durable trace.** If a person
brings in a page and saves it, the document holds the words and nothing anywhere records where they
came from. A file import has the same hole and nobody has minded; this one is more worth minding,
because the bytes came off a network. It is the first thing under *Revisit when*.

### 5. Refused: the app process does not get a browser

`src/policy/playwright-fetcher.ts` argues that a plain `fetch` returns the HTML shell for most modern
pages, and that *"reading a shell and reporting it as the page's content would be a quiet lie to
inference — worse than failing, because nothing looks wrong."* That argument is correct and it does
not transfer here, for one reason: **on this path there is no inference to lie to.** The result goes
to a person, on screen, in the box, before anything is stored. A shell arriving is visible in the
second it arrives.

So the import uses `fetch` and a deterministic HTML-to-text reader, and the app process does not
launch Chromium. What that buys is specific: **the process holding the person's database and their
API key never executes a host's JavaScript.** ADR-0002 kept the worker's browser in a separate
process for a version of this reason, and putting one in the app process would undo that on the
convenience path rather than on the acting path.

**The cost, plainly: a client-rendered page arrives nearly empty.** The person sees a handful of
words instead of the article, and their recourse is to open it in their own browser and paste. That
is a worse feature than the one with a browser in it, and it is the trade this ADR is making.

### 6. Refused for now: bringing in a page during a Shift

A worker reading an approved source under a ratified contract already exists and is
`read-approved-source`. Nothing here touches it, and there is deliberately no path from this import
into a run: the import is a thing a person does at their own screen while they are present. Wiring it
into a Shift would be a second way for a worker to acquire page text, arriving through a door that
mints no intent row — which is the property §4 chose, and it is only safe because a person is looking
at it.

## What holds the line now

Named, because §2 replaced a structural guarantee with a smaller structure and a set of tests.

| Mechanism | What it holds |
|---|---|
| The fetcher is wrapped by `allowlisted()` **inside** `importApprovedPage`, from the same patterns it matched against | one construction site, so a caller cannot hand in an unchecked fetcher |
| `importApprovedPage` takes no `AuthorizedAction` and returns text | there is no parameter through which it could act |
| It is not in `src/policy/tools.ts` | `tests/architecture.test.ts` would fail it there, correctly |
| `tests/page-import.test.ts` | refuses an unapproved host **and pins that the fetcher was never called**; refuses a redirect off-origin; proves the text is sanitised; proves the refusal above the cap |
| `tests/document-import.test.ts` | the absence of an upload route survives; the component reaches the network by exactly one named server action |
| `tests/reachability.test.ts` | one caller, and it is the screen |

Mechanisms erode, and a grep is a coarse instrument. The strongest of these is the first, because it
is a construction site rather than a check somebody has to remember to write.

## What this costs

- **An egress in the app process**, described above and published in
  `docs/SECURITY_AND_PRIVACY.md`. It is on demand, to an origin already approved, and carries no
  credential — the fetch sends no cookies and no profile — but it tells that host the person's
  address and the moment they pressed.
- **A third published bound**, and a `RetentionBudget` with one member that is a cap on a document
  rather than on what Propositum keeps about browsing. The type name is doing slightly less work
  than it did.
- **No provenance.** §4.
- **A worse reader than the worker's**, §5, and the person pays it on exactly the pages that are
  hardest to copy out of by hand.

## Revisit when

- **Anybody wants to know where a document's words came from.** That is the §4 hole, and the answer
  is a durable row, which is a schema change and its own argument.
- **Somebody proposes launching a browser in the app process**, for this or for anything. §5 is the
  argument to answer, and the answer has to be about the API key and the database, not about page
  quality.
- **The import is proposed for a Shift**, or for anything that runs while the person is away. §6.
- **A second approved-source-shaped allowlist appears anywhere.** There is one, it is
  `ApprovedSource`, and the moment there are two the word stops meaning anything.
- **`RetentionBudget` gains a fourth member.** Three was already one more than that file wanted.
