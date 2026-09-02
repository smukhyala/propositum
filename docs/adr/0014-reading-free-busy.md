# ADR-0014 — Reading free/busy, and the account that stops being none

**Status:** accepted · 2026-08-18 · **amended by [ADR-0029](./0029-the-mailbox-and-a-calendar-of-our-own.md), 2026-09-01** — the
single-scope claim is withdrawn by reopening, the route the *Revisit when* below demands. The
free/busy read, its five prohibitions and its never-persisted posture all stand.
**Amends:** [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) — *"**Everything is local.**
SQLite on your machine. No account, no cloud, no sync, no server."* ·
[`docs/VISION.md`](../VISION.md) — *"Everything is local. There is no cloud, no telemetry, and no
account."* Both sentences are **struck and dated in place, not deleted.** A reader has to be able to
see what was promised before they can judge what replaced it
**Depends on:** [ADR-0008](0008-ambient-detection.md) — ambient detection, the in-memory buffer, and
`detectPause`, whose defect this addresses exactly one half of ·
[ADR-0004](0004-policy-gate.md) — what authorises, and the rule that a thing which is not
deterministic code does not
**Beside:** [ADR-0012](0012-screen-capture-refused.md) — the other proposal aimed at the same hole.
That ADR named it (*"`detectPause` still cannot tell *gone* from *working elsewhere*"*), refused to
fill it with pixels, and said the cheaper answers deserved their own decisions. This is one of them
**Research:** [`intent-signals.md`](../research/intent-signals.md) §3 (row 7), §5.4, §5.5, §6.2

---

## What this costs

**Today Propositum has one secret and one egress. After this it has two of each, and it has an
account.** That is the whole price and it is stated first because everything below is an argument
that the price is bounded, and a bounded price is still a price.

The secret today is `ANTHROPIC_API_KEY`, in `.env`, gitignored — **the app's own credential**, the
same for every copy of the software, and no more a fact about a person than the version number is.
The second secret is not like that at all. **An OAuth refresh token is a durable credential naming
one specific human being**, issued against their Google identity, held on their disk, and valid
until somebody revokes it. It is per-person data, not configuration.

The egress today is prompts to Anthropic, and `SECURITY_AND_PRIVACY.md` names it as *"the single
exception"*. After this there is a second host that Propositum talks to on its own initiative, about
a person, on a schedule the person did not type.

And the sentence goes. *"No account"* was true in the strongest possible sense — there was nothing
to sign in to, nothing to sign in *with*, and no third party who knew this software existed. There
is now an OAuth consent screen with a product name on it, sitting in a person's Google security
settings under *Your connections to third-party apps*, which is what an account is even though it
has no password of ours. **A promise withdrawn once is not a promise**, in the register
[ADR-0010](0010-acting-in-the-browser.md) used about its own reversal, and this document does not get
to claim that a narrower scope makes the withdrawal smaller than it is. It makes the *exposure*
smaller. The withdrawal is the same size either way.

**What is bought for that** — stated once, plainly, and not repeated in a louder font later. Budget
is the one autonomy dial denominated in time, `detectPause` finds an `away` observation and stops
there, and *"a run stops when your Mac sleeps"* is already the honest limit printed against it. Free/
busy answers *how long will they be gone* and answers nothing else. It is the only signal researched
that answers that question without a native binary, a screen-recording grant, or a permission whose
button says *Allow Full Access*.

Whether a Budget suggested from a calendar makes a single handoff better is **unmeasured**, here and
everywhere. See *Honest limits*.

---

## What is actually asked for

**One scope, this exact string, and no other:**

```
https://www.googleapis.com/auth/calendar.freebusy
```

Google's own description of it, from
[Calendar API auth](https://developers.google.com/workspace/calendar/api/auth) as reproduced in
[`intent-signals.md`](../research/intent-signals.md) §6.2:

> *"View your availability in your calendars."*

**One method,
[`freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query),
and what it returns is the entire argument for this design.** The response carries
`calendars.(key).busy[]`, and each entry is a bare `start` and `end`:

> *"List of time ranges during which this calendar should be regarded as busy."*

**No titles. No attendees. No descriptions. No organiser, no location, no conference link, no
attachment, no recurrence, no event id.** Two timestamps per interval, and the interval does not say
what it is. A person who spends Thursday afternoon in a meeting called *Redundancy consultation*
shows up here identically to one having lunch.

### What the ADR requires beyond the scope itself

The scope is narrow. These make the *use* of it narrow, and they are requirements of this decision
rather than descriptions of an implementation:

| Requirement | Why it is here rather than left to the code |
|---|---|
| **The query names `primary` and nothing else** | The scope permits asking about calendars a person has access to. This asks about one. A shared team calendar, a partner's calendar, a subscribed calendar of somebody's release dates — none is queried, so none can be read |
| **No `calendar.calendarlist.readonly`** | Without it Propositum cannot learn what calendars exist. That is a capability nobody needs to answer *how long will they be gone*, and asking for it would mean the list is on record |
| **Busy intervals are never persisted** | They are read, used to compose one suggested number, and dropped. Nothing from a calendar reaches SQLite, so there is no calendar data to leak, subpoena, or forget to delete. The one thing written to disk is the token row |
| **The window asked about is bounded and short** | A few hours forward from `now`, because that is the whole question. A month of free/busy would answer a question nobody asked and is a materially different disclosure of the same shape |
| **Nothing about the person's browsing goes to Google** | The outbound request contains a time window, the literal string `primary`, and an access token. No URL, no page title, no subject, nothing off the ambient buffer. Anthropic gets prompts; Google gets *"is this person busy between these two moments"* and cannot tell why anybody is asking |

**On the security assessment, with the verification stated rather than assumed.**
[`intent-signals.md`](../research/intent-signals.md) §6.2 records that no Calendar scope is
restricted, and says how it established that: *"Verified by absence: Google's canonical restricted
list covers Gmail, Drive, Fit, Chat, Data Portability, Photos Ambient and Health. Calendar does not
appear on it at all."* So no CASA assessment and no annual reassessment — the cost that ends the
Gmail option in the same note. **That is the research note's verification, dated 2026-08-17, and it
has not been re-checked against Google's page for this ADR.** It is cited as a finding with a date on
it, not as a standing fact, because a scope list is exactly the kind of document that changes without
telling anybody.

**A second scope with almost the same name exists and is not taken.** The same table lists
`calendar.events.freebusy` — *"See the availability on Google calendars you have access to."* The two
descriptions differ in wording and the note does not establish what they differ in *substance*.
`calendar.freebusy` is taken because its description is the narrower of the two on its face — *your
availability in your calendars* rather than *calendars you have access to* — and because a single
fixed scope string is a thing a test can pin. **What the two actually differ on is not established
here**, and anybody who finds out should write it down rather than assume this ADR knew.

---

## What was refused, and why

**`calendar.events.readonly` — *"View events on all your calendars."***

This is the most interesting decision in the document and the one most likely to be reopened, so it
is argued rather than listed.

The full `Events` resource carries `eventType`, whose values include **`focusTime`** and
**`outOfOffice`**. Those two are not inferences. They are **a person declaring their own intent in a
structured field the calendar provides for exactly that purpose** — and
[`intent-signals.md`](../research/intent-signals.md) §6.2 rates that class of signal the strongest
thing in the whole note:

> *"Those two are the person declaring their own intent in a structured field. Nothing inferred from
> browsing comes close."*

It is the same finding the note reaches three more times independently — a tab group title, a Slack
`status_text`, a git branch name — and states as the pattern across the top of its ranking: *"More
observation is the expensive way to guess at something people keep writing down."* `outOfOffice`
would say *gone, and here is when I am back*, from the person's own hand. This ADR is about a hole
that a declared intent fills better than any arithmetic over timestamps can.

**It is refused anyway, and the reason is a bundle.** `eventType` does not come on its own. It comes
attached to `summary`, `description`, `attendees[]` with each person's `responseStatus`, `organizer`,
`conferenceData` and `attachments` — for **every event on every calendar**, because the scope has no
per-calendar and no per-field tier. The price of one enum is the title of every appointment a person
has: the interview they have not told their employer about, the clinic, the lawyer, the funeral. A
product whose privacy document says *"No page text. No selections. No excerpt."* about web browsing
cannot coherently hold the full text of somebody's diary in order to shave a few minutes off a
suggested time limit.

**The honest half of that trade**, because rounding it up would be the easy move here: refusing
`events.readonly` costs a real and better signal, and what is taken instead is strictly worse at the
job. Two timestamps cannot distinguish *out of office until Monday* from *a 45-minute call*; they
cannot see a Focus block a person set precisely so that software would leave them alone; and they
give the same reading for a meeting somebody will walk out of early as for a flight. **The refusal is
on price, not on quality**, which is the same shape ADR-0012 used, and it should be re-priced rather
than re-asserted if the price ever changes.

**What the refusal is not.** It is not a claim that titles are unnecessary. It is a claim that they
are not obtainable at a proportionate cost *today*. See *What would have to change*.

---

## What else was on the table

### A pasted secret `.ics` URL

Google publishes a per-calendar private address in iCalendar format; so do iCloud and most CalDAV
servers. A person pastes one URL into Propositum, which fetches it on a timer and reads the free/busy
shape out of it. **It preserves *"no account"* exactly** — no OAuth client, no consent screen, no
refresh token, no third party who knows this software exists, and nothing in anybody's connected-apps
list. On the single axis this ADR spends its opening paragraphs on, it wins outright.

**It was not chosen, for three reasons, and the first is the one that decides it.**

1. **A secret URL is a bearer credential with none of a token's properties.** It carries no scope: the
   `.ics` behind it is the **full event text** — titles, descriptions, attendees — so the narrowest
   thing this ADR does, asking for times without titles, becomes impossible. Reading only the times
   would be our code declining, which is [ADR-0008](0008-ambient-detection.md)'s behavioural
   guarantee again, in a place where the OAuth path offers a structural one. Given the choice between
   *Google will not send us titles* and *we promise not to read the titles Google sent us*, this
   repository has learned which sentence survives contact with a hurry.
2. **Revocation is coarse and slow.** Rotating a secret address invalidates every subscriber of it —
   the person's phone, their partner's calendar app, whatever else they pasted it into years ago.
   A refresh token is revoked from one screen, alone, in seconds.
3. **A pasted URL is a support surface.** It is typed by hand, it expires silently, it 404s after a
   rotation, and it fails in ways that look identical to *no calendar connected* — which, under this
   ADR's silent-degradation rule, means it fails invisibly and forever.

**What would make it the right answer later:** if OAuth verification turns out to be the blocking
cost of shipping this to anybody other than its author (see *Honest limits*), an `.ics` URL is the
path that needs no Google relationship at all. It is also the only option here that works for a
calendar Google does not host. If it is ever built, it needs its own ADR, and that ADR's first job is
to say what stops the full event text being read once it is on the machine.

### macOS EventKit

Reads every account the Mac syncs — Google *and* iCloud *and* Exchange — in one query, with **no
network, no second credential, and no account**. On the axes this ADR opens on it is the best option
on the list, and [`intent-signals.md`](../research/intent-signals.md) §10 recommends it over the
OAuth path for precisely that reason.

**Two facts stop it, and the first is Apple's.** From
[Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store),
quoted verbatim in [§5.4](../research/intent-signals.md):

> *"**NOTE:** Your app can't request read-only access to either events or reminders. To read events
> or reminders from the event store, your app needs full access."*

**There is no read-only tier.** The TCC prompt for `kTCCServiceCalendar_FULL` reads
*"\"%@\" would like full access to your Calendar."* and the button says **`Allow Full Access`** — read
*and write*, to every calendar the Mac syncs. §5.4 calls this out as the one place in the entire note
where the OAuth path is *narrower* than the local one, and it is not close: a person clicking
*Allow Full Access* has granted more than `calendar.events.readonly` would have, plus the ability to
modify their calendar, plus — via `EKEvent.birthdayContactIdentifier` — join keys into Contacts.

~~**The second is that the binary does not exist.**~~ **Struck 2026-08-28 — the strike the
2026-08-26 sweep missed: the binary has existed since ADR-0023's stage 1, and
[ADR-0027](0027-a-sealed-bundle-and-where-the-state-moves.md) built the pipeline that signs and
notarises it (the first signed artefact waits on `docs/todo/01`'s credential steps).**
EventKit needs a signed and notarised native helper, a native-messaging host manifest and a
launchd agent — the first of those exists unsigned with its signing pipeline in place; the other
two do not.
[ADR-0012](0012-screen-capture-refused.md)
priced that exact dependency, and what survives of its conclusion is the account argument above,
which was always the load-bearing half: the proposal is not *add a calendar read*, it is *become a
desktop product* — and the desktop product has now been argued into existence on its own terms
rather than smuggled in through a calendar read.

**What would make it the right answer later:** Apple shipping a read-only events tier, which would
make it better than this decision on every axis simultaneously — or a native helper arriving for some
other reason, at which point only the *Allow Full Access* string stands between EventKit and the
right answer, and that string is a good deal weaker an objection than a whole desktop application is.
**ADR-0012 names the same dynamic as its own failure mode to watch for**, and it is worth repeating
against ourselves: once a native binary exists, everything that needs one gets quietly cheaper, and
the arguments that were really about cost get re-read as arguments about principle.

---

## What it may never do

Five prohibitions. The first is the one the rest exist to protect.

**1. It authorises nothing.** Models propose and deterministic code authorises — and a calendar is
neither. A busy interval is a fact read off a network response, from a source that is neither our
code nor a person in front of us, and [ADR-0004](0004-policy-gate.md)'s whole architecture is that
such things do not decide. Free/busy may **suggest** a time limit which a person then sets on the
handoff screen. It may never *be* one.

**2. It may not set, raise or lower a dial.** `AutonomyControls.timeLimitMinutes` is set by the human,
on the working-agreement screen, before ratification, as it is today.

~~The suggestion arrives as a **pre-filled number and a sentence saying where it came from**, in
exactly the posture [`docs/VISION.md`](../VISION.md)'s honest limits already describe for
`StatedIntent`: *"The person edits words somebody else wrote."* That is a real check and a weak one,
it is written down as weak in two places, and this ADR adds a third thing that arrives pre-filled
rather than inventing a new kind of consent for it.~~

~~A pre-filled default is not neutral — a suggested 90 becomes 90 for most people most of the time,
and saying otherwise would be pretending a UI affordance is a decision procedure.~~

**Struck 2026-08-18, the same day, and left visible because this section is what a later reader
implements from.** The code that shipped is *stronger* than the paragraph above and the paragraph
would have talked somebody into weakening it. **Nothing is pre-filled.** `timeLimitMinutes` is
initialised from the model's clamped proposal and from nothing else, exactly as it was before this
ADR; the calendar's number appears as **a sentence and a button beside the dial** — *"Your calendar
has you busy from 3:00 pm. [Stop by then — 1 hour]"* — and pressing that button is byte for byte the
same state change as pressing one of the five radios. Until a person presses something, the dial
holds the number it would have held if no calendar existed.

That distinction is the whole of the difference between *suggests* and *sets*, and it is worth more
than the paragraph it replaces. A pre-filled default is not neutral: a suggested 90 becomes 90 for
most people most of the time, which is a UI affordance doing the work of a decision procedure. An
offer that must be pressed cannot do that — the default outcome of ignoring the screen is the
model's number, not Google's.

What bounds the number either way is that **it is bounded by the same dial it always was** — it is a
member of `TIME_LIMIT_CHOICES` or it is not offered — a person sees it before ratifying, and it can
only ever be what a human accepts. And **the sentence outlives the press**: the provenance line
stays on screen once the limit equals the suggestion, so nobody ratifies a calendar-derived budget
with nothing on the screen saying it is one. Only the button goes, because it would then change
nothing. `tests/calendar-agreement.test.ts` renders both states and asserts exactly this.

**3. It may not reach `compilePolicy`, `EnforcedPolicy`, or any gate.** `compilePolicy(scope,
controls)` is pure and total over the human-set dials and nothing else; there is no parameter for a
calendar and there must not be one. Nothing in the authorisation path may read a busy interval,
directly or through a field that carries one. The deadline derivation stays what
[`CONTEXT.md`](../../CONTEXT.md) says it is —
`contract.acceptedAt + timeLimitMinutes + Σ(confirmation waits)` — over immutable timestamps on
durable rows, and a calendar contributes no term to that sum. **If a busy interval can be found
anywhere downstream of ratification, this design is wrong and no amount of narrowness in the scope
repairs it.**

**4. It may not become an `ObservationEvent`, or reach a model.** Free/busy is not a sensor.
`ObservationEvent.sessionId` is required and `ledger-writer.ts` is the single door;
`SECURITY_AND_PRIVACY.md`'s *Event ingestion beyond the browser* argues that this makes external
sources structurally absent rather than merely unbuilt, and **that argument survives this ADR intact,
because a busy interval never becomes an event.** Nor does it enter a prompt: no `ModelBoundary`
gains a field for it, there is no model in this path at all, and the ban on model calls on a timer is
untouched because nothing here calls a model.

**5. It may not surface an error where a suggestion would have been**, and it may not take a screen
down instead. *(Second clause added 2026-08-18: the first implementation of the front-door row had no
`catch` around its database read, so a missing `calendar_connection` table — anybody who pulls this
commit onto an existing database before running `prisma db push` — returned a 500 for the product's
entire entry screen. **No page at all is the largest possible violation of this rule**, not an
exception to it. Every calendar entry point a screen can reach is now failure-total: it returns
nothing rather than throwing, and `tests/calendar-front-door.test.ts` executes that.)*

No calendar connected, an expired or revoked token, no network, a Google 500, a slow response, a
malformed body, a clock the person's machine disagrees with — **every one of these leaves the product exactly as it is today.**
The dial keeps its ordinary default, no banner appears, no toast, no red text, no *"couldn't reach
your calendar"*. A person who never connects a calendar must not be able to tell this shipped.

That is a deliberate and slightly uncomfortable choice, so it is argued rather than asserted: a
failure notice here would be an interruption produced by an *optional* feature, on the screen whose
entire job is a person deciding whether to hand over work, about a thing they did not ask for in that
moment. **The cost is that a quietly-broken connection stays quietly broken** — a person who
connected a calendar in March and had the grant revoked in April gets no suggestions and no
explanation. The mitigation is that the connection's state is legible **where a person went looking
for it** — on the settings surface that offers connecting and disconnecting — and nowhere else. A
failure a person can discover by asking is not the same as a failure that announces itself, and this
ADR takes the first deliberately.

---

## Where the refresh token lives

**Not `.env`.** That file holds the application's own credentials — `ANTHROPIC_API_KEY` is the same
string for every copy of Propositum and says nothing about anybody. A refresh token is the opposite:
it names one person, it is issued to them, and it is theirs to revoke. Putting per-person data in the
configuration file is a category error that a later reader would copy, and it puts a live credential
somewhere people paste into issues and screen-share without thinking, because *"it's just env vars"*.

**Not the macOS Keychain**, which is where it would ideally live, and ~~this is a limitation rather
than a preference: reaching the Keychain properly needs the signed native helper that
[ADR-0012](0012-screen-capture-refused.md) established does not exist and is not being built.~~

**Corrected 2026-08-26 — it is a preference now, not a limitation, and that is the harder position to
hold.** [ADR-0023](0023-the-tray-app-owns-the-runtime.md) ships a signed binary and
[ADR-0025](0025-computer-use-beyond-the-browser.md) gives it Accessibility, Screen Recording and Full
Disk Access. The helper this ADR said did not exist now exists and holds more than a Keychain
entitlement would have required. So the token sits on disk because moving it is a credential-storage
decision nobody has taken — see ADR-0023's prohibition 3, which is the only copy of this claim worth
citing from now on.

**So: the local database, in its own table.** The requirements on it:

- **Mutable, like `Project` and `Intention`.** A token is refreshed and revoked; it is not a record of
  something that happened. **No append-only triggers and no `REQUIRED_GUARDS` entry** — an
  append-only credential store would be a table that accumulates every token a person ever held and
  can never delete one, which is the opposite of what a secret needs.
- **Deleting the connection deletes the row.** Disconnecting in the app must actually remove it, and
  should attempt revocation at Google as well — but the row goes either way, because a revocation
  that needs the network to succeed is not a disconnect.
- **Neither the deletion nor the row may depend on the configuration.** *(Added 2026-08-18, after the
  first implementation got this wrong in both halves.)* `.env.example` presents blanking
  `GOOGLE_OAUTH_CLIENT_ID` as the way to switch this feature off, so that is a state a person will
  reach on purpose — and in it, the delete returned early and the front-door row disappeared, which
  together left a live Google credential in SQLite with no control in the product able to remove it
  and no screen admitting it was there. **Off and orphaned are not the same state.** The delete needs
  a database and nothing else; only the *revocation* needs the client credentials, and with none
  there is simply no revocation to attempt. The row is read from the database first and the
  configuration decides only whether the *invitation to connect* is worth showing. A credential on
  disk is never invisible.
- **Never logged, never rendered, never in a model prompt, never in an error message, never in an
  exception's text, and never in a URL.** The token has no consumer surface at all: what a person
  sees is *connected* or *not connected*, and the account it belongs to.

**The honest part.** The SQLite file is not encrypted, and this ADR does not pretend the token is
protected by anything other than the file permissions and disk encryption of the machine it sits on.
Any process running as that user can read it — which is the same trust model
`SECURITY_AND_PRIVACY.md` already lives in, and precisely the threat model ADR-0012 §5 describes
against a local capture store. **It is a real exposure and it is the one this ADR most expects to be
criticised for.** What makes it survivable is the last property below.

---

## Honest limits

Named without rounding up.

- **A calendar says where somebody said they would be, not where they are.** Every one of these is
  ordinary: the meeting that ended twenty minutes early, the block held for focus and then abandoned,
  the appointment somebody skipped, the all-day event that is a reminder rather than an absence, the
  invitation accepted and forgotten. Free/busy reports the *declaration*. It has no idea whether
  anybody honoured it.
- **Free/busy from one account is not every commitment.** This reads one Google calendar. It does not
  see iCloud, or Exchange, or work-versus-personal split across two logins, or a calendar somebody
  keeps on paper. EventKit's one genuine advantage was reading all of them at once, and that
  advantage is given up here.
- **Most departures are not on any calendar at all.** Lunch, a walk, a phone call, sleep, the end of
  the day. Free/busy is silent for all of them, and silence means *today's behaviour*, so the
  suggestion is **absent most of the time**. That is the same shape ADR-0013 records for `tabGroups`
  — *excellent when present, absent most of the time, must never gate anything* — and it is the
  strongest reason the suggestion cannot be load-bearing.
- **The credential is long-lived, and that is a different risk from an API key.** An API key is a
  string with a spending limit. A refresh token is a standing relationship with a person's identity
  provider, and it renews itself. **The mitigation is that it is revocable by the person at any time,
  from Google, without our cooperation** — one screen, one click, and the grant is gone whatever this
  software thinks. That is a genuine property of the OAuth model and it is the reason a token is
  preferable to a pasted secret URL. **It is a mitigation and not an excuse.** It does not make the
  token less valuable while it is valid, does not help a person who does not know to go and look, and
  does not undo a read that already happened.
- **The benefit is unmeasured.** Nothing establishes that a Budget suggested from a calendar produces
  better handoffs than the default does. `MVP.md`'s H2 is not about this, no fixture scores it, and
  the research note ranks the signal on what it *buys* — the answer to a question — rather than on
  any evidence that having the answer improves an outcome. **This ADR spends an account on an
  untested hypothesis**, and that sentence belongs in it.
- **The OAuth client story is unsettled and is the largest unpriced cost here.** A Google client
  requires an OAuth consent screen with a real publisher behind it, and
  [`intent-signals.md`](../research/intent-signals.md) §6.2 prices the Google path as *"verification
  plus a demo video"* against EventKit's one dialog. Whether an unverified client is workable for a
  local-first product, and what limits Google places on one, is **not established here** — the
  specific user caps in circulation were not verified for this ADR and are not asserted in it. This
  decision covers the scope and the mechanism. **It does not establish that this can ship to
  strangers**, and if verification turns out to be the blocker then the `.ics` path above is the one
  that survives it.
- **Nothing prevents this from becoming the wedge.** *"We already have a Google connection"* is the
  sentence that arrives next, attached to Gmail, or Drive, or a wider Calendar scope. It is not an
  argument, the consent screen a person saw named one thing, and every additional scope is its own
  decision at its own price. This is recorded as the predicted failure mode rather than left to be
  discovered. *(2026-09-01: the predicted sentence arrived, and it was taken by the route this
  document demanded rather than by drift —
  [ADR-0029](./0029-the-mailbox-and-a-calendar-of-our-own.md) reopens this decision, argues the
  Gmail price this ADR's research note recorded, and pays it deliberately. The prediction held; so
  did the trigger.)*

---

## What would have to change to revisit the wider scope

`calendar.events.readonly` is refused on a bundle, so what reopens it is the bundle coming apart.
Concretely, **any one of these**:

1. **Google ships a scope that returns `eventType` without event text.** That is the whole refusal
   dissolved: the declared-intent field is the best signal in the note, and the only thing standing
   between this product and it is that the titles come with it. A scope described as *see when you
   have marked yourself out of office* would be taken the day it existed.
2. **Google ships per-calendar or per-field scoping**, such that a person can grant events on one
   calendar they choose. The objection is *every event on every calendar*; a scope a person can aim
   is a different object.
3. **Apple ships a read-only EventKit tier**, at which point the whole question moves off Google and
   the answer is the local path the research recommends — one dialog, no network, no token, no
   account, every account the Mac syncs. This is the outcome to hope for and the one nobody here
   controls.
4. **A measured result that free/busy is insufficient.** If suggested Budgets are landed, scored, and
   the failures are demonstrably the ones titles would have fixed — *out of office all week read as a
   45-minute gap* — then the trade is being made on evidence instead of on principle, which is the
   only honest way to spend a promise this size a second time.

**What does not reopen it:** that it would be convenient; that the token already exists; that a
person *"has already connected their calendar anyway"*. The consent screen named one scope, and the
narrowness is the entire reason this ADR was acceptable to write.

---

## What this requires elsewhere

Stated as requirements of this decision, so that a later reader can check the code against the ADR
rather than the other way round.

- **`src/domain/**` stays sealed.** Free/busy arithmetic that belongs in the domain — turning
  intervals plus a moment into a suggested number of minutes — imports nothing from app, model,
  persistence or policy, calls no `fetch` and no `node:fs`, and **never reads a clock**: `now` is a
  parameter. The network call and the token live outside the domain entirely.
- **The token table is mutable.** No append-only triggers, no `REQUIRED_GUARDS` entry, and
  `tests/append-only.test.ts` must still pass afterwards. `prisma db push` silently drops the
  triggers, so the app and the worker are restarted after any schema change and that test is the
  check.
- **Failure is silence.** Every failure path returns *no suggestion* and is indistinguishable, from
  the handoff screen's point of view, from *no calendar connected*.
- **The scope string is pinned.** It is one literal, it is the only one, and widening it should have
  to be a deliberate edit that a test notices — the same discipline
  [`tests/extension-permissions.test.ts`](../../tests/extension-permissions.test.ts) applies to the
  extension's manifest, for the same reason: a permission that can be widened quietly will be.

---

## Revisit when

- **Any of the four conditions above fires**, especially Apple shipping a read-only tier, which makes
  this decision obsolete rather than merely wrong.
- **A suggested Budget is measured and does not help.** Then this should be removed rather than kept,
  because the account is only worth having for something that works, and an unused connection is a
  live credential with no upside.
- **Anyone proposes reading free/busy for a calendar other than `primary`**, or over a longer window,
  or on a schedule rather than at a handoff. Each sounds like a parameter change and each widens what
  Google is told about a person.
- **Anyone proposes a second Google scope on the strength of this one.** That is the wedge named
  above; it needs this ADR reopened, not extended.
- **A busy interval turns up downstream of the handoff screen** — in `compilePolicy`, in
  `EnforcedPolicy`, in a gate, in a prompt, or in the ledger. That is not a bug to fix in place; it
  means the prohibition in this document failed and the design needs re-reading.
- **The `.ics` path is proposed.** It preserves *"no account"*, which is the one thing this ADR
  spends, so it deserves a hearing — and its own ADR, whose first job is what stops the full event
  text being read.
