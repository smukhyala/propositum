# ADR-0029 — Everything in the mailbox but delete, and a calendar of our own

**Status:** accepted · 2026-09-01
**Ticket:** [#128](https://github.com/smukhyala/propositum/issues/128)
**Amends:** [ADR-0014](./0014-reading-free-busy.md) — reopened, which is the route its own *Revisit
when* demands: *"Anyone proposes a second Google scope on the strength of this one … needs this ADR
reopened, not extended."* The free/busy read, its five prohibitions and its never-persisted posture
all stand; what goes is the claim that its scope would remain the only one.
**Depends on:** [ADR-0004](./0004-policy-gate.md) (the gate) ·
[ADR-0006](./0006-trust-boundary.md) (why prose may not reach a permission decision) ·
[ADR-0024](./0024-purchases-within-a-ratified-authorisation.md) (the authorisation pattern this
borrows, and the habituation argument it rests on)
**Requested by:** the owner, 2026-09-01 — *"amend the adr 0014, it is outdated … It should just have
99.9% safeguards to make sure it never does anything that shouldnt be done"*, and, on mail
specifically: *"Should be able to do everything in mail, besides delete or send. Only can send when
either inherently explicitly told ('send person x this') or when allowed by user. but put emphasis on
security i.e. so propositum doesnt click on a phishing link on accident."*
**Research:** [`docs/research/instinct.md`](../research/instinct.md) — the capability study this
answers, including the deterministic-operations table (§7) and the mail-borne injection incident
(§2, *Security exposure*) that shapes the security section below.

## The sentence that stops being true

**"The optional Google scope is `calendar.freebusy` and nothing else" — decided here, and not yet
built.** As this ADR is accepted, `grep -rn 'gmail' src/` finds nothing,
`tests/calendar-scope.test.ts` still holds every Google scope string in `src/` to exactly one, and
the consent screen still names one thing. [`docs/todo/10-the-mailbox.md`](../todo/10-the-mailbox.md)
and [`docs/todo/11-calendar-holds.md`](../todo/11-calendar-holds.md) are the work between the
decision and the capability. Everything below describes what is being permitted.

## What this costs

**ADR-0014's entire containment was narrowness, and this spends it.** That ADR could say *cannot*
in the strongest form — the scope had nowhere to put an email, so no bug, no injection and no
misbehaving model could read one. After this, for mail, *cannot* becomes *chooses not to*: the scope
below can read every message in the mailbox, and the gap between what Google grants and what the
code does is held by our own restraint plus tests — the same weaker arrangement
[ADR-0026](./0026-reading-a-one-time-code.md) accepts for the message database, taken here a second
time, deliberately.

**The wedge fired, and this document is it.** ADR-0014 §*Enforcement* predicted the failure mode by
name: *"'We already have a Google connection' is the sentence that arrives next, attached to
Gmail…"* That sentence has now arrived. What makes this a decision rather than the drift ADR-0014
feared is the route: the trigger demanded a reopening with its own argument at its own price, and
this is that argument. The consent screen will name three scopes, each ratified separately; a person
who granted free/busy has granted nothing here.

**The price ADR-0014 recorded against Gmail is paid, not waved away.** Its research note ended the
Gmail option on Google's restricted-scope list: every Gmail scope worth having carries a CASA
security assessment, annual reassessment, and verification with a demo video — for a *published*
app. A tester-circle build running as a test-mode OAuth client (≤100 test users) carries none of
that yet, which is the honest reason this is affordable today and a real bill that arrives with any
public build. The verification of that list is dated 2026-08-17 and re-checking it is a named item
in todo 10.

**And principle 9 weakens for the third time.** A Gmail or Calendar API call has no
`Fetch.requestPaused`, so *"irreversibility is decided by what Chrome is about to send"* covers none
of this. §*Principle 9, qualified again* below is the replacement, and it is weaker than an
attestation.

## Context

Propositum's job is continuing someone's work while they are away, and the research is blunt about
where that work lives: the mailbox and the calendar are where errands begin and end, and they are
also where the exact operations exist that software can perform *provably* — every verb below has a
read-after-write proof (`drafts.get` returns the draft on its thread; a re-run of the archive query
returns zero; `events.get` plus the free/busy read we already have shows the hold holding). The same
research records what happens when this surface is taken carelessly: a competing product connected
the whole mailbox, treated arriving mail as instruction, and obeyed a stranger's email within three
weeks of public beta. Both halves of that record shaped this decision — the verbs are worth having
*because* they are provable, and the security section leads *because* the cautionary tale is real.

## Decision

**Two new scopes, these exact strings, beside the free/busy read, which is unchanged:**

```
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar.app.created
```

### 1. The mailbox: everything but delete, inside a ratified sitting

`gmail.modify` is Google's *"all read/write operations except immediate, permanent deletion of
threads and messages"* — the owner's sentence, as a scope. Within a run whose contract grants the
mail kinds, Propositum may read, search, label, archive and draft. Five constraints:

- **Only inside a ratified sitting.** Mail is touched while a run holds a contract that grants it,
  and at no other time. No watch, no push, no poller, no schedule. The do-not-build entry for
  *automatic Gmail ingestion* stands untouched — ingestion is a standing sensor; this is a verb.
- **Nothing is persisted.** No message, header, address or subject is written to any table, the same
  posture `BusyInterval` has. What survives a run is what always survives: the ledger's rows about
  what Propositum *did*, and a `message-draft` held unsent where drafting was the work. There is
  still no row an email could become, still one ledger writer, still no model call on a timer.
- **Drafts are the default terminal.** A composed reply lands in the person's drafts folder and
  stops. The worst outcome of a bad draft is an unsent draft.
- **Permanent delete is structurally absent** — the one mail verb the scope itself cannot perform.
- **Every mutating mail action lands through the gate** as an `ActionKind` with an `AuthorizedAction`
  token, exactly as browser actions do. The enum members are the build's to name (mechanisms, not
  effects, per principle 9); the shape is decided here.

### 2. Sending: absent by default, and only ever inside a `SendAuthorization`

The send verb does not exist as a capability of the product by default —
`tests/architecture.test.ts` continues to assert no send-shaped function, and that guard moves only
in the commit that builds this. What the build adds is a **`SendAuthorization`**: a structured
object on `ContractScope`, patterned exactly on
[`PurchaseAuthorization`](./0024-purchases-within-a-ratified-authorisation.md) —

```ts
interface SendAuthorization {
  readonly recipients: readonly string[]  // exact addresses. Matched exactly, never by domain
  readonly whatFor: string                // display only. Never read by the gate
  readonly maxCount: number               // how many sends this permits
  readonly expiresAt: Date                // never later than the contract's own end
}
```

— drafted by a model **only** from an instruction that names its recipient (*"send Priya the
summary"* names someone, so there is something to draft; *"deal with my inbox"* names no one, so
there is not — the avocados pattern), ratified by the person on the screen they already ratify, and
checked by deterministic code. **Its absence is the deny.** A send to anyone not named refuses; the
refusal is recorded; and per ADR-0024's habituation argument there is no per-send confirmation to
storm — the authorisation is the consent, granted once, while the person is looking at exactly this.

### 3. The calendar: holds on a calendar of our own

`calendar.app.created` grants writes **only to calendars Propositum itself creates**. The build
makes one secondary calendar and writes `CalendarHold`s there — a hold being a busy block with a
start, an end and a label, the write-side counterpart a `BusyInterval` is the read-side of. The
person's own calendars remain unreadable and unwritable in ADR-0014's strongest sense: **the scope
has nowhere to put a write to them and no way to return their contents.** Event titles, attendees
and descriptions of the person's real appointments stay exactly as unobtainable as ADR-0014 left
them; its refusal of `calendar.events.readonly` is untouched and re-affirmed below.

The read half of ADR-0014 is likewise untouched: free/busy still recommends, still never grants,
still reaches no gate. A hold is different in kind — not a recommendation but an *action*, granted
like any other `ActionKind` by a ratified contract, landing through the gate, proven by reading the
event back and watching the free/busy read report the interval busy. **Whether a hold on a secondary
calendar makes the person read as busy to other people is the build's first verification, not this
document's assumption** — if it does not, the calendar half of this decision reopens rather than
widens (see *Revisit when*).

### 4. Security, which the owner asked to lead

Mail is the largest injection surface this product will ever connect: every message is third-party
text, and the research's cautionary incident is a product that let a stranger's email become an
instruction. The postures, all existing, restated here as binding on the build:

- **Mail text reaches a prompt only as `Datamarked`**, through the one door, like all page text.
  There is no second door for email.
- **No instruction arriving by mail can reach a permission decision.** `compilePolicy` cannot
  receive prose — a compile error, per ADR-0006 — and nothing in a message can widen a contract,
  name a send recipient, or touch an authorisation.
- **A link in a mail body is never a navigation target unless its origin is already approved in the
  contract.** The gate's `source_not_approved` refusal already does this for browser navigation; a
  phishing link in email is refused by the same rule, not by a classifier's judgment.
- **The unsubscribe verb is evidence-bound.** An RFC 8058 one-click unsubscribe is a bare POST to
  the URL in the message's DKIM-covered `List-Unsubscribe` header — a fact read from the message's
  authenticated headers, never a URL a model composed. It runs only against senders on a list the
  person ratified, per contract. `SECURITY_AND_PRIVACY.md` already names the *"honest hole"* that a
  GET can be irreversible, an unsubscribe link its own example — this verb is that hole's opposite:
  the link in the body is never clicked; the header's POST endpoint is used instead.

### 5. Principle 9, qualified again

*"Irreversibility is decided by what Chrome is about to send"* holds for actions in a browser and
for nothing else — ADR-0025 said so for desktop actions, and the same qualification is now true a
second way. A first-party API call has no paused request and no attestation. What decides here is
**typed calls our own code authors**, checked deterministically before the call against a ratified
authorisation, and **proven after by read-after-write** — the draft fetched back, the archive query
re-run to zero, the hold read back and visible in free/busy. That is a stronger position than
ADR-0025's (an English lexicon over labels an application wrote) because both sides of the check are
values we construct — and it is still weaker than Chrome's attestation, because the checking code
and the calling code are the same codebase. The gap is held by the gate's structure and the guards,
which is a mechanism, and mechanisms erode. Principle 9 carries this qualification as of this ADR.

## What was refused

**A narrower scope pair — `gmail.compose` + `gmail.metadata` — at its strongest.** Compose cannot
read a single message body; metadata returns headers and never content. A pack built on those two
could draft and could enumerate unsubscribe headers, and a whole class of exposure would not exist.
It is refused because it cannot do what the owner asked — archive, label, read a thread to draft a
reply *in* it — and because it saves less than it seems to: both scopes are on the restricted list,
so the CASA bill is identical, and `gmail.compose` can send drafts, so the send-capability gap
exists in every workable configuration. Google's granularity offers no scope that matches this
product's actual posture; `gmail.modify` at least matches the owner's sentence.

**Send-on-inference.** *"Only can send when inherently explicitly told"* could be read as: let a
model judge whether the instruction implied a send. Refused — a model deciding a send was implied is
a model granting itself permission, ADR-0024 §4's fourth refusal in different clothes. The
instruction's explicitness is exactly what ratification of a `SendAuthorization` establishes, and
nothing else establishes it.

**Gmail filters (standing rules), at their strongest.** A filter is the deterministic ideal — a
criteria/action object with a `filters.get` read-back proof, the most API-shaped thing in the whole
pack. Refused anyway: a filter acts on mail that arrives *after* the run ends, forever, which is an
authorisation outliving its contract — the exact shape ADR-0024's *Revisit when* names as a
[`WorkingAgreement`](../../CONTEXT.md), a word this project has deliberately not spent. When durable
delegation is decided, it gets its own ADR; a mail filter must not smuggle it in.

**Blanket unsubscribe.** *"Unsubscribe me from everything"* delegates the judgment of which senders
matter, and a wrong guess costs real mail. The pack's shape is: Propositum *enumerates* (a
deterministic header sweep), the person *ratifies the list*, Propositum executes per-sender. The
choosing is never delegated.

**Holds on the person's own calendar — `calendar.events.owned` — at its strongest.** Holds would
appear in the calendar the person actually looks at, in every client, with guaranteed free/busy
effect. Refused on the same bundle ADR-0014 refused: that scope reads and edits every event on every
calendar the person owns, so the price of a hold in the right place is the title of every
appointment — the interview, the clinic, the lawyer. ADR-0014 said that refusal should be re-priced
rather than re-asserted; re-priced here, it comes out the same, because `calendar.app.created`
delivers the hold at no read access at all.

## Honest limits

- **The mail gap is restraint, not absence.** The scope can read everything; the code's narrowness
  is enforced by the gate, the guards and review. This is the arrangement this repository calls
  weaker than anything else in it, now load-bearing in two places.
- **Send capability is latent in the scope from the first build**, guarded by the absence of a
  send-shaped function until `SendAuthorization` lands, and by the gate thereafter.
- **The CASA/restricted-list verification is dated 2026-08-17 and must be re-checked** (todo 10).
- **The secondary-calendar free/busy question is open** until the build answers it.
- **Datamarking reduces injection; it does not eliminate it.** A model reading marked hostile text
  can still be influenced in what it *proposes*; the gate bounds what a bad proposal can *do*.

## Revisit when

- **Google ships a narrower mail scope** — per-label grants, a true no-send compose, metadata with
  modify — then this re-prices immediately, in ADR-0014's own register: on price, not on quality.
- **Anyone proposes touching mail outside a ratified sitting** — a watch, a poll, an index, a
  briefing. That is ingestion, it is on the do-not-build list, and it needs its own decision, not
  this one extended.
- **Anyone proposes a `SendAuthorization` that outlives its contract, or one derived without
  ratification** — from history, from a previous yes, from a default. Principle 15: history may
  recommend; it may never grant.
- **A mail body's text turns up unmarked in a prompt, or anywhere near a permission decision.**
  That is not a bug to fix in place; it means the one-door rule failed and the design needs
  re-reading.
- **The build's free/busy verification fails** — a hold that does not hold means
  `calendar.app.created` cannot deliver the feature, and the calendar half reopens against
  `calendar.events.owned` at its stated price rather than drifting there.
- **The restricted-list re-check changes the price**, in either direction.
