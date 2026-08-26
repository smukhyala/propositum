# Security and privacy

What Propositum collects, what it refuses to collect, what it guarantees, and — at equal length —
what it does not.

Written from the decisions in [`docs/adr/`](./adr/) rather than ahead of them. Where a protection is
depth rather than a boundary, this document says so.

_(Added 2026-08-16 — [ADR-0011](./adr/0011-intention-above-worksession.md). Some sections below
constrain capabilities that **do not exist**: standing agreements, event sources beyond the browser,
a worker router. They are here because the constraint on each is one sentence today and a migration
later. Each says in its own first line that the thing is unbuilt, so nothing here can be read as a
capability claim. **The `Intention` belongs on that list**, and it is the one most likely to be
misread, because ADR-0011 authorises it and the next slice builds it. Today there is no `Intention`
table and no `Intention` type. What this document says about what an Intention may hold, and about
its lifecycle states, is a **specification rather than a description** — the same fence
[`CONTEXT.md`](../CONTEXT.md)'s own entry puts around itself.)_

---

## Data collected

There are **three modes**, and they collect very different things. _(Amended 2026-08-11 —
[ADR-0008](./adr/0008-ambient-detection.md). This section previously said "only during an
explicitly started WorkSession, and only from sources the person approved", which is no longer
true and is the reason this amendment leads rather than follows. Amended again the same day —
[ADR-0010](./adr/0010-acting-in-the-browser.md) — because an agent that acts in your browser sees
far more per turn than the watching does in an hour, and a document that did not say so would be
false in the place it can least afford to be.)_

### 1. Ambient — always, every `https` site, metadata only

Propositum watches continuously so it can notice work you have not told it about. What it keeps
while doing so is deliberately thin:

| Collected         | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cleaned URL       | credentials and tracking parameters stripped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Page title        | as the page reports it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Interaction shape | dwell time and scroll depth                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Exit type         | how the page was left, as one of three: **switched away from** (the tab stopped being on screen), **left with the page kept**, **left with the page destroyed**. The last one cannot tell moving on from closing the tab, from quitting, or from reloading — telling those apart needs permissions this product refuses. Nothing here records where you went next                                                                                                                                                                                                                                |
| Tab group label   | **only** the name you typed on a tab group that contains a page Propositum is already watching. Never the group's other tabs, and never a group you have not opened a watched page in                                                                                                                                                                                                                                                                                                                                                                                                            |
| How you arrived   | one of five words, and **never the page you came from**: **no referring page** (typed, bookmarked, or opened in a fresh tab), **followed something inside this site**, **arrived from a different site**, **reloaded**, **went back or forward**. Chrome tells the page the address you came from; that address is compared to this page's own site _inside the page_, and the comparison — not the address — is what reaches Propositum. There is no field on the always-on path an address could sit in. See the correction below for what the extension does with the address in the meantime |

_(Last two rows added 2026-08-17 — [ADR-0013](./adr/0013-authored-labels-and-exit-type.md). The
second one costs a Chrome permission, `tabGroups`, whose install string is **"View and manage your
tab groups."** — ~~the first permission this extension has asked for that shows a string of its
own~~ **the first permission taken for a capture signal that shows a string of its own**. What it
does and does not grant is spelled out under *Data explicitly not collected*, beside the tab-list
bullet it sits next to, because a permission with "tab" in its name reads broader than it is.)_

_(Two corrections the same day, both to sentences this section had no business making. **The exit
type row** said the enum distinguishes *"moved on, closed it, went back, switched away"*. It does
not and it cannot: there are three values, moving on and closing the tab are the SAME value, and
*"went back"* is not a value at all. Separating them would need `tabs`, `webNavigation` or
`history`, which is exactly the set this product refuses — so the row was claiming a discrimination
that could only exist if the promise on this page were broken. **The containment sentence** said
*"Both signals are untrusted content and are datamarked before they can reach a model."* No such
control exists, and the truth is stronger rather than weaker: **neither field is an input to any
model boundary, so neither reaches a prompt in any form, datamarked or not**, and
`tests/reachability.test.ts`'s *"never reaches a model boundary"* is what holds it. `datamark()`
stays named as the required door **if** a prompt ever wants one — a future condition, not a control
standing today.)_

_(Last row added 2026-08-18. It costs **no new permission and changes no manifest entry** — the
values are derived from `document.referrer`, which every page on the web can already read about
itself. Two things are worth reading twice. **First: the row above the classification is what a
different product would collect.** While a session you started is running, Propositum *does* store
the cleaned address you came from, because a session is something you asked for, scoped to sites you
approved, and its rows are ones you can read back. The always-on buffer described in this section
gets the five-word classification and never the address, and that asymmetry is deliberate — an
address you came from can name a site nothing else here ever sees. **Second: one of the five is
honestly weaker than it reads.** A site can tell your browser not to say where you came from, and
mail clients and newsletters do. A link like that arrives here as *"no referring page"* — the same
value as you typing an address — so the word that looks most like a deliberate choice is also what a
suppressed link looks like. Nothing in the product reads this field to decide anything; that limit
is one of the reasons why.)_

*(**Corrected 2026-08-18, the same day, after review.** The row above originally ended _"It is not sent, not held, and there is no field it could sit in"_. The last clause was true. The first two were not, and this document is the worst place in the repository to be wrong in the flattering direction, so the correction is here rather than in a commit message.

What actually happened: the part of the extension that runs inside a web page **cannot be allowed to know whether a session is running** — a page that could time what its own script is permitted to do would learn something about you — so it sends the address you came from every time, and the part of the extension that does know decides what to do with it. When a session is running that address is stored, which is the row two paragraphs up and is the deliberate half. When no session is running it was being kept in the extension's own temporary storage until the next time the extension talked to the app, and longer if the app was not running.

It never reached the app, never reached the database, and never left your computer — the code that builds what gets sent to the app was written field by field and never included it. But _"not held"_ was still false, and it is now true: the extension deletes the address on the no-session path in the same line that deletes page text, before anything stores it. **What you can rely on, stated as narrowly as it is actually enforced:** while nothing is running, the address you came from is used for one comparison inside the page, is deleted by the extension before it is stored anywhere, and never reaches Propositum in any form. While a session you started is running, it is stored, and that is the row you can read back.)*

**No page text. No selections. No excerpt.** There is no field in the ambient schema that could
carry any, and a test asserts it. None of the three rows added above changes that: an exit type is
an enum, an arrival is an enum, and a tab group label is a name you typed rather than anything a
page wrote.

Where it goes matters as much as what it is:

- ~~**In memory only.** It never reaches the database. It dies when the app process does.~~
  **In memory only — the observations. One count is not.** _(Corrected 2026-08-18. See the two
  paragraphs below; the sentence above was written before anything durable sat beside this buffer,
  and this document is the worst place in the repository to leave a promise that has quietly stopped
  being exactly true.)_
- **Bounded twice** — a rolling 30-minute window _and_ a 500-row cap.
- **Discarded by default.** Declining an offer drops it. Accepting one folds it into the session
  you just started, where it becomes an ordinary `ObservationEvent` marked `ambient: true`.

**What is now durable, stated exactly.** _(2026-08-18 —
[ADR-0015](./adr/0015-measuring-loudness-and-saving-an-afternoon.md).)_ Nothing you looked at reaches
the database: no URL, no title, no dwell, no scroll, no exit type, no arrival, no tab group label,
and there is no column any of them could sit in. What reaches it is a **count**, in ~~one table
called~~ **the first of two tables —** `offer_tally`, one row per calendar day, holding five
things — the date, how many distinct minutes
the extension had something to report, how many suggestions Propositum put in front of you, how many
you turned down, and how many it found and did not show. _"Four suggestions in forty observed
minutes on the 18th"_ is the whole of what that row can say. It cannot say what any of them was
about, and no amount of reading the table will tell anybody what you were working on.

It exists because the alternative was worse: the bar for speaking to you was lowered twice in two
days and there was no number anywhere that would have shown whether that made Propositum noisier.
**The cost, named rather than rounded past:** the table does record _which days you browsed with the
extension running, and roughly how much_. That is a real fact about you. It is bounded by being
exactly that — a finer bucket than a day would start to sketch when in the day you work, which is a
fact about a person rather than about the product, and was refused for that reason. Nothing in the
product deletes this table; see _Retention and deletion_.

**The second table, and it is the one that costs something** _(added 2026-08-22 —
[ADR-0020](./adr/0020-remembering-a-decline.md))_. Turning a suggestion down used to leave nothing
behind: the declined strand was snoozed for an hour in memory, forgotten at the next restart, and
`offer_tally` counted the event without recording what it was about. It now also writes one row to
`offer_reticence`, so that saying _not now_ to the same thing every evening means something more than
being asked again every evening.

|                         |                                                                                                                                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the row holds      | three things — a **salted hash** of the strand's signature, **how many times** a strand hashing to that has been turned down, and the **calendar day** of the most recent one                                   |
| What it cannot hold     | there is **no column a subject could go in** — no signature, no origin, no title, no URL. That is the table's shape rather than a promise about it, and `tests/reticence-store.test.ts` asserts the column list |
| A day, never an instant | for the same reason `offer_tally` refused a timestamp: a millisecond instant would be a durable record of roughly _when_ in the evening you stopped                                                             |
| How long it lives       | **30 days from the last decline**, swept hourly by the worker. Accepting an offer for that strand deletes the row immediately                                                                                   |
| The salt                | 32 random bytes in a one-row `install_secret` table, made once on first use and never rotated                                                                                                                   |

**The honest limit on the hash, said here rather than left to the word.** The salt is in the same
SQLite file as the rows it salts, so anyone holding the database holds the salt, and hashing a
guessed signature and comparing it is a thing they can do — and the space of plausible signatures is
small enough for a candidate list to be worth trying. What the hashing buys is that **no process, no
log line and no backup ever contains the terms in readable form**, and that one install's rows cannot
be correlated against another's. That is a real improvement over storing the words and **it is not
anonymity**. Where the salt ought to live is the macOS Keychain, which needs a signed native helper
this product does not have ([ADR-0012](./adr/0012-screen-capture-refused.md)) — the same gap the
calendar token is stuck in, one section below.

**The cost, named rather than rounded past.** `src/server/ambient-store.ts` says in writing that
_"declining has to cost nothing and leave nothing behind"_, and that is no longer true of the
product. A row now exists because of an offer **nobody accepted**, on a path that used to write
nothing. What bounds it is everything in the table above: it names no subject, it has no column for
one, it is per-install, and it is gone thirty days later or the moment you say yes. ADR-0020 records
that transaction at full size rather than arguing it away.

**One more thing changed the same day, and it widens what a caller can read back.** The debug
endpoint — `/api/capture/ambient/debug`, the only window into the buffer — used to answer with a
per-origin summary. It now returns the buffer's rows **whole**: every cleaned URL, every title, the
dwell, the scroll, the exit type and the arrival, exactly as the detector holds them. That is more
than it handed over before, on the most privacy-sensitive path in the product, and it is deliberate:
three signals were being collected that nobody could see, so nobody could judge them. It is reachable
only from something that is not a web page — two transport controls a browser will not let a page
forge, spelled out in that route's own docblock — and it reads the same buffer this section
describes, so it can never hand back anything the table above does not list.

The extension holds `host_permissions: ["https://*/*"]`, so Chrome shows **"Read and change all your
data on all websites"** at install. That warning is accurate. What limits the exposure is no longer
the permission — it is the behaviour above, enforced in three places and tested. ADR-0008 states
plainly that this is a weaker kind of guarantee than the one it replaced.

_(Amended 2026-08-17 — [ADR-0013](./adr/0013-authored-labels-and-exit-type.md). There is now a
~~**second**~~ **further** string at install: **"View and manage your tab groups."**, for
`tabGroups`. Unlike `tabs`, `webNavigation`, `topSites` and `favicon` — whose warnings Chrome
absorbs into the all-websites prompt, so any of them could be added in an update without you being
asked again — this one is **not absorbed**. It is shown. That is a cost and it is also the reason it
was the acceptable permission to take: a capability that cannot be added quietly is the one you get
to refuse._

_"Second" was wrong and is corrected the same day, against Chrome's own
[permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list).
Counting the strings honestly, this extension's permissions show **three**: `notifications` —
*"Display notifications."*; `debugger` — *"Access the page debugger backend."* and *"Read and change
all your data on all websites."*; and now `tabGroups`. `alarms`, `idle`, `scripting`, `sidePanel`
and `storage` show none. What is true of `tabGroups`, and is the part that mattered to the decision,
is that it is the first string bought for a **capture signal** rather than for a mechanism, and that
it is not absorbed by the all-websites prompt.)_

### 2. Session — only when you started one, only on approved sources

Everything below is collected **only** during an explicitly started `WorkSession`, and only from
sources the person approved. This is where page text begins.

| Collected             | Detail                                                       |
| --------------------- | ------------------------------------------------------------ |
| Page title            | of an `ApprovedSource` only                                  |
| Cleaned URL           | query parameters stripped except a recognised search term    |
| Deliberate selections | text the person selected or copied, verbatim                 |
| Readable article text | **at most 2,000 characters** per approved source             |
| Interaction shape     | dwell time, scroll depth, focus changes, returns to a source |
| Document edits        | from the in-app editor, not the browser                      |
| Typed notes           | written by the person                                        |
| Capture gaps          | when Propositum knows it was not watching, and why           |

**The 2,000-character excerpt budget is a published product constant, not a tuning knob.** It is
expensive to change: `ObservationEvent`s are append-only, so raising or lowering it invalidates every
fixture already captured.

### 3. Acting — only under an agreement you ratified, only in a tab Propositum opened

When you hand work over and Propositum acts in your browser, it has to see the page it is acting on.
That is a different kind of collection from the two above and it is kept in a different place.

| Collected              | Detail                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The accessibility tree | the page as the browser describes it to assistive technology — text, controls, labels — **at most 60,000 characters per turn** |
| A screenshot           | **only when the tree is insufficient**, and only of the tab Propositum opened                                                  |
| What it dispatched     | which element, which kind of input, and what the browser attested about the request                                            |

This is `ActionEvidence`, and four things about it are the whole promise:

- **60,000 characters is a published product constant, not a tuning knob** — the same standing as
  the 2,000 above, and it is named `SNAPSHOT_BUDGET_CHARS` in the code. The promise is the artifact
  and the number is downstream of the promise sentence. It exists because an accessibility tree is
  ten to a hundred times an article excerpt and arrives every turn, so an unbounded one would quietly
  become the largest thing Propositum stores.

  **Thirty times larger is a real cost and this document is not going to bury it.** A run is capped
  at 40 actions, so the ceiling is about 2.4 million characters of page text per run — where the same
  person browsing the same sites unaided would leave 2,000 characters per source. The mitigations are
  that it happens only under an agreement you ratified, only in a tab Propositum opened, and that it
  is swept; none of those makes it small.

- **It is a separate ledger from your browsing, and they never join.** `EXCERPT_BUDGET_CHARS`
  governs what Propositum retains about **your own browsing**; `ActionEvidence` is what the agent saw
  **while acting under an agreement you ratified**. Nothing in it is read by inference, joined to an
  observation event, or shown on a session timeline. This is not a loophole around the 2,000 — it is
  a different promise about a different thing, and it works only because it is written down here
  rather than assumed.

- **Almost all of it is kept for at most seven days, and usually far less.** Two rules, and the
  first is the one that normally fires:

  |                            |                                                                                                                                                                                                                      |
  | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **When you have decided**  | once you have accepted or rejected everything a Shift produced, its evidence is deleted at the next sweep — within the hour. For a Shift that edited a document, "decided" means every proposed change has a verdict |
  | **Seven days, regardless** | the backstop for a run that failed, was interrupted, or is waiting on a question nobody answered. `ACTION_EVIDENCE_RETENTION_DAYS = 7`                                                                               |

  Seven, rather than one, because a run stopped for your confirmation can be answered days later —
  asked Friday evening, answered Monday morning — and the screen asking you to authorise an effect
  has to be able to show you the page it is about. Seven, rather than thirty, because a week-old
  accessibility tree of a page you were signed into answers a question nobody is asking. The sweep
  runs in the worker process, at startup and hourly.

- **One class of evidence is kept indefinitely, and this document is not going to round that down
  to seven days.** If Propositum stopped and asked you to authorise an irreversible action, the
  snapshot you were looking at while you decided is **never deleted** — not after you answer, not
  after the run ends, not after the window.

  Why it cannot be deleted: the question Propositum asked you is an append-only audit row that
  points at that snapshot. Deleting the snapshot would either break that record or require editing
  it, and the record of _what a person was shown when they authorised an irreversible effect_ is the
  single most important row in this ledger. It is also, unavoidably, the row most likely to be a
  **screenshot of a page you were signed into** — which is the worst possible thing to keep forever,
  and is why this is stated here in full rather than left as a footnote to a seven-day promise.

  It is bounded by how rarely it happens: one snapshot per confirmation question, and a confirmation
  question is a deliberate stop, not a routine turn. Every sweep counts these rows rather than
  silently skipping them. Recorded as a revisit condition in
  [ADR-0010](./adr/0010-acting-in-the-browser.md).

- **It is the one durable table that can be deleted at all.** Everything else in the ledger is
  guarded by triggers against `UPDATE` and `DELETE` alike. `ActionEvidence` keeps the guard against
  being **rewritten** — what you were shown must stay what you were shown — and deliberately drops
  the guard against being **removed**, because a no-`DELETE` trigger and a retention sweep cannot
  both be true. What stands in for the missing trigger is three tests: the ORM delete exists in one
  place, that place is reachable only through the sweep, and no raw SQL goes round it. That is
  weaker than a trigger — it is a check on our own code rather than a refusal by the database — and
  it is the strongest thing available once a sweep has to exist.

### 4. Calendar — only if you connect one, only times, never stored

_(Added 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md). This is the first thing Propositum
reads that did not come from your browser, and the first that requires an account. If you have not
connected a calendar, none of this happens and nothing below exists.)_

Propositum can tell that you left. It cannot tell how long you will be gone, and _"How long should I
work for?"_ is the one dial measured in time. If you connect a Google calendar, it asks Google one
question, at the moment you are handing work over.

| Collected      | Detail                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Busy intervals | **two timestamps each** — when a busy stretch starts and when it ends. Nothing else exists in the answer |

What that means precisely, because the whole decision rests on it: the scope Propositum asks for is
`calendar.freebusy`, which Google describes as _"View your availability in your calendars."_ The
method it calls returns _"List of time ranges during which this calendar should be regarded as
busy."_ **No event titles. No descriptions. No attendees. No locations, no links, no attachments.**
An hour blocked for something private is the same two numbers as an hour blocked for lunch.

- **Only your main calendar.** Propositum asks about the one calendar Google calls `primary` and no
  other. It never asks what calendars you have, so it cannot learn that a shared or subscribed one
  exists.
- **Only a few hours ahead**, from the moment you are looking at the screen. Not a week, not a month.
- **None of it is stored.** The answer is used to offer you a number and then dropped. There is no
  row in the database holding anything from your calendar, so there is nothing to delete later and
  nothing to leak.
- **It decides nothing, and it does not even fill anything in.** _"Time limit"_ on the
  working-agreement screen arrives holding the number it would have held if you had no calendar. Next
  to it is one sentence — _"Your calendar has you busy from 3:00 pm"_ — and a button offering the
  longest limit that stops before then. Nothing changes until you press it, the sentence stays there
  after you do, and you can ignore it entirely. Nothing from a calendar reaches the part of
  Propositum that decides what a run is allowed to do — see _Action authorization_, below.
- **What Google is told.** The request contains the two ends of the window being asked about, the
  word `primary`, and your access token. **Nothing about your browsing goes with it** — no page, no
  title, no subject, no session. Google cannot tell what you were reading, or why anybody wants to
  know whether you are free.
- **If anything goes wrong, nothing appears.** No calendar connected, an expired grant, no network, a
  bad day at Google — every one of these leaves the screen exactly as it looks today, with no error
  and no banner. The trade is deliberate: you find out by looking at the connection, not by being
  interrupted at the moment you were handing work over.

## Data explicitly not collected

Not "not yet" — these are design commitments, and several are structurally impossible rather than
merely unimplemented.

- **Full page text.** Only the bounded excerpt above, and — while acting — the bounded accessibility
  tree of the tab Propositum opened.
- **A list of your open tabs.** The extension is not granted `tabs`, `webNavigation` or `history`,
  and the acting agent never calls `chrome.debugger.getTargets`. ~~There is no call it can make that
  returns a tab it did not create itself.~~ ~~**This one is still enforced by the browser rather than
  by our code.**~~

  **Amended 2026-08-17 ([`docs/research/intent-signals.md`](./research/intent-signals.md) §2.1):
  both struck sentences were false, and the second one was false in the way that costs the most.**
  `chrome.tabs.query()` needs no permission to call. Chrome's own reference says the `tabs`
  permission _"does not give access to the `chrome.tabs` namespace"_ — it only _"grants an extension
  the ability to call `tabs.query()` against four sensitive properties on `tabs.Tab` instances:
  `url`, `pendingUrl`, `title`, and `favIconUrl`"_ — and that _"host permissions allow an extension
  to read and query a matching tab's four sensitive `tabs.Tab` properties"_. Since
  [ADR-0008](./adr/0008-ambient-detection.md) the manifest holds
  `host_permissions: ["https://*/*"]`. So one line in the service worker would return the URL and
  the title of **every open `https` tab, in every window**, today. No line in the extension is that
  line. That is discipline, not Chrome.

  **The promise is now held by a test rather than by the browser, and a test is weaker than a
  refusal.** This is the register [ADR-0010](./adr/0010-acting-in-the-browser.md) used about its own
  replacement — _"a pause is strictly weaker than an absence"_ — and it applies here unchanged. A
  refusal cannot be forgotten in a hurry, cannot be deleted by somebody who is sure it is redundant,
  and cannot pass because the file it searched got renamed. A test can be all three. The mechanism
  is [`tests/extension-permissions.test.ts`](../tests/extension-permissions.test.ts): it greps the
  extension for `chrome.tabs.query`, `chrome.tabs.get`, `chrome.history.*` and
  `chrome.webNavigation.*`, and it pins the manifest's permission list to an explicit set, so adding
  one has to be a deliberate act rather than an edit nobody reviews.

  **And that mechanism shipped with a hole in it, found and closed the same day.** The grep strips
  comments before searching, and the first version did it with a regular expression that read the
  two characters `/*` **inside a string literal** in `extension/src/panel.html` as the start of a
  comment — deleting thirty-three lines of live side-panel code, in the one file the search was
  extended to cover. A `chrome.tabs.query()` written in that span passed the whole suite. It is
  fixed, and the fix is a scanner plus a per-file check that no code line goes missing. It is
  recorded here rather than quietly repaired because it is the point the paragraph above was
  making: a test can be forgotten, deleted, or **wrong**, and a refusal cannot.

  **The date this stopped being structural is 2026-08-11**, the day ADR-0008 widened
  `optional_host_permissions` into `https://*/*`. It was noticed on 2026-08-17, by research
  commissioned about something else. Six days is the honest measure of how long a written guarantee
  can go on being read as true after the decision underneath it has moved.

  **And the surviving half is thinner than it reads.** `chrome.debugger.getTargets` is genuinely
  never called and [`tests/extension-cdp.test.ts`](../tests/extension-cdp.test.ts) has greped for it
  since ADR-0010 — but ADR-0010 also _granted_ `debugger`, so that refusal is our code declining
  too, not Chrome refusing. The research note calls this half "still structurally true"; it is not,
  quite, and this document is not going to round it up. What is left is two greps over a component
  with no build step, which is a real guard and a weaker one than the sentence it replaced.

  **And as of 2026-08-17 this bullet sits next to a permission whose name suggests otherwise, so it
  has to say what that permission does.** [ADR-0013](./adr/0013-authored-labels-and-exit-type.md)
  grants `tabGroups`, which Chrome describes at install as _"View and manage your tab groups."_
  **The bullet above is unchanged and stays true: no tab is enumerated.** What `tabGroups` grants,
  precisely:

  |                              |                                                                                                                                                                                                                                                                                        |
  | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Grants**                   | the label on a tab group — its `title`, plus `color`, `collapsed` and `shared`, which are of no use here and are not read                                                                                                                                                              |
  | **Does not grant**           | which tabs are in that group. Chrome's own reference says so in as many words: _"To group and ungroup tabs, or to query what tabs are in groups, use the `chrome.tabs` API."_ `chrome.tabs` is the permission this extension does not hold and the namespace the guard forbids calling |
  | **Does not grant**           | any URL, title, favicon or tab id, for any tab, including the tabs in the very group whose name is read                                                                                                                                                                                |
  | **How the group is reached** | a page Propositum is **already watching** sends its ordinary report; the group id rides along on that message as `sender.tab.groupId`; the label is looked up for that one id. The chain starts at a page already in the buffer, so it cannot produce a tab that was not               |
  | **What would widen it**      | `chrome.tabGroups.query()`, which returns every group in every window — including groups whose tabs Propositum has never seen. That is a different capability wearing the same permission, and ADR-0013 says it must stay on the forbidden list beside `chrome.tabs.query`             |

  **This is the same kind of guarantee as the one above it, and no stronger.** Chrome is not
  refusing to tell us which tabs are in the group we asked about — it is refusing to tell us
  _through this API_, while `chrome.tabs.query()` sits one line away needing no permission at all.
  So what keeps the narrow path narrow is the same grep in the same test file, which is our code
  declining. The honest word for it is still **behavioural**, and it was corrected to that word
  earlier the same day. Nothing about adding a permission makes it structural again.

  _(Amended 2026-08-11: this bullet used to say "anything from a source you have not approved".
  Since [ADR-0008](./adr/0008-ambient-detection.md) the extension holds broad host permission and
  does see every `https` page you visit — as metadata, in memory. ~~What Chrome still refuses to
  hand over is the existence of any other tab, which is a narrower promise than the one this bullet
  used to make, and it is the true one.~~ **Struck 2026-08-17: Chrome refuses no such thing, and had
  already stopped refusing it on the day that amendment was written.**)_

- **Keystrokes.** No key logging anywhere.
- **Your screen.** No screen recording, no video, and no screenshot of anything you are doing. The
  only images Propositum ever takes are of the tab it opened itself, while acting under an agreement
  you ratified, when the accessibility tree was not enough to act on — and those are swept.
  _(Amended 2026-08-11. This bullet said "no screenshots" flatly, and that stopped being true with
  [ADR-0010](./adr/0010-acting-in-the-browser.md).)_
- **Anything on your calendar except when you are busy.** No event titles, descriptions,
  attendees, organisers, locations, meeting links or attachments — the scope Propositum asks for
  cannot return any of them, which is why it is the scope it asks for. The wider scope that _would_
  return them, `calendar.events.readonly`, was considered and refused: it carries a field where
  people declare their own intent (_out of office_, _focus time_), which is the best signal in the
  research, and it carries it bundled with the title of every appointment on every calendar. That
  trade is argued in full in [ADR-0014](./adr/0014-reading-free-busy.md).
  **No list of your calendars.** No calendar but your main one. No calendar belonging to anybody
  else. _(Added 2026-08-18.)_
- **Other applications.** Chrome only. _(A connected calendar is read over the network from Google,
  not from an application on your machine. Propositum still reads nothing on this Mac but Chrome.)_
- **Passwords, form contents, or clipboard contents** not deliberately selected in an approved
  source.
- **Telemetry, analytics, or crash reports.** There is no server to send them to.

### Why an extension rather than a controlled browser

Under a Chrome MV3 extension scoped by `optional_host_permissions`, "approved sources only" is a
manifest declaration you consent to in Chrome's own UI and can revoke there. Under a
Playwright-controlled browser it would be an `if` statement in our TypeScript, and a regression
would widen capture to everything, silently, with no visible signal.

Rewind's exclusion controls were sincere, documented, and leaked anyway — through Mission Control,
picture-in-picture, and password managers rendered as extensions. Those leaks were emergent
properties of building exclusions on a see-everything vehicle. That failure mode is not available to
a vehicle that is never handed the data. ([ADR-0002](./adr/0002-observation-capture.md))

## Event ingestion beyond the browser

**One sensor exists, and it is the Chrome extension above.** Email, ~~calendar,~~ Slack, GitHub,
Notion, local files, and agent output from anywhere else are **unbuilt, and this work does not build
them** — they sit on the _do not build yet_ list in [`MVP.md`](./MVP.md)'s Out of scope table.

_(Amended 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md). A calendar is now read, and the
word is struck from the list above so nobody reads this section as saying otherwise. **The argument
below is unaffected, and it is worth being exact about why rather than letting the strike look like a
crack in it.** Free/busy is not a sensor and produces no event: nothing it returns becomes an
`ObservationEvent`, nothing it returns passes `ledger-writer.ts`, nothing it returns is persisted at
all, and it is read once, on demand, at a moment a human is looking at the screen. Both structural
facts below therefore still hold exactly as written — there is still no row an external event could
become, still one writer, and still no model call on a timer. What ADR-0014 spent is the *account*,
argued at length there and struck below under **Local versus remote**. What it did not spend is
this.)_ This section
exists so the constraint is on record before a later reader takes the absence for an oversight and
closes it with a connector.

Two facts make the absence structural rather than a matter of priority. That distinction is the
whole value of this section: it means the line cannot be crossed by accident.

- **No event outside a sitting can be persisted at all.** `ObservationEvent.sessionId` is required,
  and `ledger-writer.ts` is the single door every event enters by — one writer, because `seq` has to
  be gapless per session and two writers assigning their own sequence corrupt the stream invisibly.
  There is no row an external event could become and no writer that would accept it. A connector is
  therefore not an integration job. It is a schema change plus a second writer, and the second writer
  is the thing that argument exists to forbid.
- **[`CONTEXT.md`](../CONTEXT.md) bans model calls on a timer**, and gives two reasons an external
  source would have to answer rather than inherit: periodic interpretation feeds hostile page text to
  a model while no human is watching, and it makes the event stream non-reproducible, so the eval
  harness cannot re-score a fixture. An email that arrives at 3am is a model call at 3am unless
  something is designed first to prevent it.

**Neither of those is a promise never to build this.** They are the two questions the first external
source has to answer in its own ADR — written down now so that answering them is the work, rather
than discovering them.

One consequence is already fixed in the specification. The `Intention` lifecycle is specified with
**five** states — `working`, `delegated`, `needs-you`, `sleeping`, `done`. The direction document
lists a sixth, _waiting_, meaning progress depends on an external event. Nothing here can produce an
external event, so nothing could put an intention into it. It is documented in
[`ARCHITECTURE.md`](./ARCHITECTURE.md) as the state that arrives with event ingestion, and it will
not be declared in the union: an enum member nothing can reach is a promise the schema makes and the
product cannot keep.

## Local versus remote

~~**Everything is local.** SQLite on your machine. No account, no cloud, no sync, no server.~~

~~The single exception: **prompts sent to the Anthropic API**, which contain the observation events
and document text a boundary needs. Nothing else leaves the machine.~~

**Struck 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md). The struck sentences are left
here rather than deleted, because a reader has to be able to see what was promised.** _"No account"_
was true in the strongest available sense: there was nothing to sign in to and nothing to sign in
with. Connecting a Google calendar is signing in. It puts Propositum in your Google security
settings under your connections to third-party apps, and it leaves a long-lived credential on your
disk. That is an account, and calling it something else would be the kind of wording this document
exists not to use.

**What is true instead, as of 2026-08-18:**

|                                                      |                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Your work stays local**                            | SQLite on your machine. No cloud, no sync, no server of ours, no telemetry, no analytics, no crash reports. ~~Nothing about what you read, wrote or handed over is stored anywhere but here.~~ ~~**This half is unchanged**~~ — **struck 2026-08-26, [ADR-0021](./adr/0021-a-thread-on-the-persons-phone.md). It was the unchanged half for eight days. See the row below** |
| **A thread on your phone, optional, off unless you connect it** | If you pair one, Propositum sends you **derived prose about your own work** — a subject, why it is offering, why it stopped, what it needs decided. That is the point of the channel and it is also a sentence about your life on somebody else's server. The bot is **yours**: you create it, we never see it, and there is no shared bot and no operator. The messages are **not end-to-end encrypted** |
| **One account, optional, off unless you connect it** | a Google calendar, for one question: how long you will be away. Nothing is created if you never connect one                                                                                                                                                                                            |
| ~~**Two things leave the machine**~~ **Three, 2026-08-26** | **prompts to the Anthropic API**, which carry the observation events and document text a boundary needs — and, if you connected a calendar, **one request to Google** asking whether you are busy between two moments. That request carries no page, no title, no subject and nothing off your session — and, if you paired a phone thread, **messages to Telegram's Bot API**. Unlike the other two, that one carries the *subject* of your work in readable prose, which is why the row above is struck ([ADR-0021](./adr/0021-a-thread-on-the-persons-phone.md)) |

This is still a privacy property today and a limitation tomorrow — it is also why a run stops when
your Mac sleeps, and answering the question that limit implies is the whole reason the calendar read
exists.

### Send a worker the minimum it needs

Every model call is a `ModelBoundary` with its own prompt builder, schema and token budget
([ADR-0005](./adr/0005-model-boundary.md)), so what travels is a property of the one job being done
rather than of a shared context blob that grows. The reading boundary gets one session's events. A
worker gets the contract's terms, what it has already done **in this run**, and the page in front of
it — not the project's other sessions and not what a previous run did. `WorkerActionInput` is the
list, and it is short enough to read.

**Honest limit: this is a habit of the design, not an enforced maximum.** Nothing rejects a boundary
that builds an over-broad prompt. The token budget bounds size, not relevance, and no test asserts
that a boundary asked for the least it could have.

**There is one provider and there is no router.** `ModelClient` has one real implementation and one
fake. Nothing selects an executor by fit, cost, latency, quality or tool access, and multi-provider
routing beyond clean interfaces is on the _do not build yet_ list. This is recorded here because a
router is exactly the component that would put pressure on this section: choosing a different
executor changes who performs the work, and must not change how much of your data travels with it.

## Retention and deletion

Observation events and the action ledger are **append-only** and cannot be edited. Deleting a
`Project` deletes its sessions, events, documents, and ledger.

**One thing expires on its own: `ActionEvidence`.** _(Amended 2026-08-11 —
[ADR-0010](./adr/0010-acting-in-the-browser.md). This section said "there is no automatic expiry.
Everything persists until you delete it", which was true of a product that only watched. It is not
true of one that keeps whole page trees and screenshots of your authenticated session, and a
document that still said it would be false in the place it can least afford to be.)_

|                                                      |                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything else                                      | persists until you delete it                                                                                                                                    |
| `ActionEvidence`                                     | deleted once you have decided what the Shift produced, and in any case after **seven days** — see _Acting_, above                                               |
| `ActionEvidence` attached to a confirmation question | **kept indefinitely.** The one exception, argued in full above                                                                                                  |
| `offer_tally`                                        | **persists, and nothing in the product deletes it** — see below                                                                                                 |
| `offer_reticence`                                    | deleted **30 days** after the last decline it records, and immediately when you accept an offer for that strand — see _Ambient_, above                          |
| `install_secret`                                     | persists for the life of the install. It is made once and never rotated, because rotating it would silently orphan every `offer_reticence` row rather than fail |

**`offer_tally` is the one table no button reaches** _(added 2026-08-18 —
[ADR-0015](./adr/0015-measuring-loudness-and-saving-an-afternoon.md))_. It holds one row per calendar
day: the date, minutes of observed browsing, suggestions shown, suggestions declined, suggestions
found and not shown. It belongs to no `Project`, so deleting a Project does not reach it, and there
is no other delete path — the code that writes it can add to a day and read the series back, and
that is all it can do. The catch-all row above says _"persists until you delete it"_, and for this
table the honest reading of "you delete it" is **you, in SQLite**:

```
sqlite3 propositum.db 'DELETE FROM offer_tally'
```

That is not a good answer and it is written down rather than smoothed over. It is survivable because
of what the row holds: four numbers and a date, no subject, nothing that says what any suggestion was
about. The reason it has no delete button is that nothing has been built that would offer one, not
that anybody decided it should be permanent — ADR-0015 records that as open.

**Nothing from a calendar is retained at all** _(2026-08-18 —
[ADR-0014](./adr/0014-reading-free-busy.md))_. Busy intervals are read, used to offer one number,
and dropped; no table holds them. The only thing a calendar connection writes to disk is the
credential below, and disconnecting deletes it.

Export is not implemented. The database is a single SQLite file you own and can copy.

## Secrets

~~One credential: `ANTHROPIC_API_KEY`, in `.env`, gitignored. Never logged, never rendered, never
sent anywhere but Anthropic.~~

**Two, since 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md)**, and they are different kinds
of thing, which is why they live in different places:

| Credential                                                     | Where                        | What it is                                                                                         |
| -------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                            | `.env`, gitignored           | **the application's own.** The same string for every copy of Propositum; it says nothing about you |
| The Google refresh token, **only if you connected a calendar** | a row in your local database | **yours.** It names you, it is issued to you, and it is revocable by you                           |

The token is not in `.env`, deliberately: configuration is where the software's own credentials go,
and a per-person credential in there is the sort of file people paste into an issue without thinking.
It is not in the macOS Keychain either, which is where it ought to live — reaching the Keychain needs
a signed native helper this product does not have and is not building
([ADR-0012](./adr/0012-screen-capture-refused.md)).

Both are **never logged, never rendered, never put in a prompt, and never in an error message.**
Neither is ever sent anywhere but to the service it belongs to.

**Two honest points about the token, stated rather than softened.** The database file is not
encrypted, so anything running as you on this Mac can read it — the same trust model everything else
here lives in. And it is long-lived, which is a different risk from an API key: it renews itself. What
bounds that is the one property the alternatives did not have — **you can revoke it from Google at any
time, without Propositum's cooperation, and disconnecting here deletes the row.** That is a
mitigation and not an excuse; it does nothing for someone who never goes to look.

**A third secret exists and it is deliberately not in that table** _(added 2026-08-22 —
[ADR-0020](./adr/0020-remembering-a-decline.md))_. `install_secret` holds 32 random bytes that salt
the `offer_reticence` hashes. It is not a credential: it authenticates nothing, it is issued by
nobody, it reaches no network, and losing it costs you a table of counts and nothing else. It is
listed here anyway, because a secret that is not on the list of secrets is how a document starts
being wrong. The two properties that matter are stated where the table it protects is described: it
lives in the same database file as those rows, so it does not make them unguessable by whoever holds
that file, and it is never rotated.

_(Amended 2026-08-18.)_ **Disconnecting deletes the row whatever else is true.** It does not depend
on Google being reachable, and it does not depend on the two `GOOGLE_OAUTH_*` variables still being
set — blanking those switches the feature off and does not delete anything, so the front door keeps
showing a stored connection, with its Disconnect, until you remove it. A credential on this machine
is never hidden from you by a setting.

## The permission model

1. You create a `Project` and approve sources. Approval is a Chrome host-permission grant, visible
   and revocable in Chrome.
2. You start a session explicitly. Capture is off otherwise.
3. You ratify a `HandoffContract` before anything runs autonomously. **No `AgentRun` may start from
   an unratified contract, and nothing in the autonomy dials can switch that off.**
4. The contract names what may be read and what may be changed. The gate enforces it
   deterministically.
5. You accept or reject every proposed change.

_(Added 2026-08-18 — [ADR-0014](./adr/0014-reading-free-busy.md).)_ **Connecting a calendar is
outside that list on purpose.** It grants Propositum nothing: it is optional, off until you do it,
revocable both here and from Google, and it can only offer a number you were going to set
yourself — the dial arrives unchanged and the offer is a button beside it. Nothing about it can widen
what a run may read or change. If it is disconnected, expired or
broken, every screen behaves exactly as it did before it existed.

**Approval scopes where Propositum may look. It confers no trust on what is found there.**

## Trust is not authorization

_Approval scopes where Propositum may look; it confers no trust on what is found there_ is one
instance of a rule this document now states generally.

[ADR-0007](./adr/0007-stop-conditions.md) already states the asymmetry, for models:

> A model may **never** widen what is permitted — it could grant.
> A model may **always** decline to proceed — it can only withhold.

**Acceptance history is a second source, and it gets the same asymmetry, unchanged.** A record of
which classes of action you have accepted, edited, rejected or required approval for may recommend a
dial's default, and may argue on screen for a wider setting. It may never widen a permission, and it
is never an input the gate reads. It can always make Propositum more cautious.

Naming it as the same asymmetry is worth more than the paragraph itself. There is one rule with two
sources rather than two safety arguments to keep in agreement, and the next source — a heuristic, a
score, a reputation signal from outside — arrives already governed instead of needing its own case
made from scratch.

**None of this is built.** Nothing today counts what you accept or reject in order to recommend
anything. The verdict tables exist, append-only, and nothing reads them for this purpose.

### Standing agreements: the name is reserved, the object is deferred

**There is no standing agreement in this system, and this work does not add one.** Nothing durable
carries permission between handoffs; every `AgentRun` starts from a `HandoffContract` a person
ratified for that run, and the five steps above are the whole of the permission model.
[ADR-0011](./adr/0011-intention-above-worksession.md) reserves `WorkingAgreement` as a type name so
the word is not spent a third time, and builds nothing behind it. _Working agreement_ stays
`HandoffContract`'s consumer label, and no screen changes.

One commitment is recorded now, because it is one sentence today and a migration later:

> **A standing agreement is a ceiling intersected into a contract's scope — never a floor unioned
> onto it.**

That choice, not the feature's interface, decides whether it is safe. Intersection can only narrow
what a run may do, so an agreement that is stale, over-broad, or written in a more trusting mood than
the one you are in now still cannot authorise anything the contract in front of you does not already
allow. Union makes the durable object a grant, and a grant signed months ago is precisely the
permission nobody re-reads.

**Nothing enforces this, because there is nothing yet to enforce it on.** It is a sentence in a
document, which is the weakest kind of guarantee this file contains, and it is here rather than held
in someone's memory of a conversation.

### No agreement may pre-approve an irreversible action

Not a new rule. Two existing ones, cited rather than re-argued, because the way this feature gets
built wrong is by reading _reduce repetitive confirmations_ as _reduce confirmations_.

- [`PRODUCT_PRINCIPLES.md`](./PRODUCT_PRINCIPLES.md) §6: **no dial may ever pre-approve an
  irreversible action**, and _"a model saying 'this is still the same step' is likewise forbidden,
  because that is a grant wearing a description's clothes."_ A standing agreement is a dial with a
  longer life. The principle already reaches it; it does not need extending.
- **`ConfirmationVerdict` has two members, and both are decisions a human made.** There is no value
  meaning _expired_, _assumed_ or _agreed in advance_, and `expireConfirmations` writes no verdict at
  all — an unanswered question keeps its absence, and the gate refuses on the same nothing it saw
  before the question was asked. A third member is how elapsed time would become permission. Its
  absence is why that path does not exist, which is a stronger thing than a rule against taking it.

`classifyReversibility` takes an action kind and the browser's own attestation about the element. It
takes no agreement, no history and no preference, and the correct shape for any future agreement is
one that still cannot reach it.

### What an Intention may accrue

An `Intention` will be the first durable object here that outlives a sitting, which makes it the
obvious place for a profile to accumulate quietly. The boundary, written before the table is:

|                          |                                                                                                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **May hold**             | what a person wrote or edited — the desired outcome and what done looks like. `objective` and `definitionOfDone` are the whole of it                                                                                   |
| **Is not stored at all** | the lifecycle state. `working`, `delegated`, `needs-you`, `sleeping` and `done` are to be computed from rows that already exist; the view is specified and not yet written, so there is no column for them to drift in |
| **May not hold**         | anything inferred about the person rather than stated by them — a working style, a tolerance for risk, a trust score, a learned autonomy level                                                                         |

**`guidance` stays per-contract on `StatedIntent`, and deliberately does not become durable.** It is
the one field this corpus guards hardest: [`CONTEXT.md`](../CONTEXT.md) calls it _"the one place
where page prose could otherwise become something the worker follows"_, which is why it is
human-typed only and why an inferred `constraint` claim never pre-populates it. Its safety is
carried by its lifetime — retyped, re-read and re-ratified for every contract. A durable `guidance`
would be one afternoon's sentence silently steering every later handoff on one old ratification,
which is the standing-agreement failure mode wearing a field name.

**The table's third row is enforced by construction rather than by a check, and that difference is
the point.** Per [ADR-0011](./adr/0011-intention-above-worksession.md) an `Intention` is
**human-ratified only**: a person creates it, a person edits it, no detector writes one, and no model
boundary writes one. There is no writer that could accrue anything, so there is nothing for a check
to catch.

That is a stronger guarantee than a validation rule and a more brittle one. It holds exactly as long
as the writer set stays human, and it would fail **silently** the first time a model boundary is
given an `Intention` field to fill in — no test would go red, because what is protecting the row is
the absence of a writer rather than the shape of its contents.

What Propositum infers about you stays where it already is: `SessionClaim{kind:'objective'}`, one
sitting, evidence-bearing, cold every time. That arrangement is what keeps the boundary observable
rather than merely intended — the inferred thing has a visible lifetime, and the durable thing has a
human author.

## Action authorization

Models propose; deterministic code authorizes. There is no path from model output to a permission
decision.

- Every capability requires an `AuthorizedAction`, a token branded with a symbol only the gate can
  use. A worker holding an unauthorized proposal can do nothing with it.
- The gate is pure — set membership, comparison, boolean. **No model is consulted.**
- Deny by default, no denylist.
- Every refusal is recorded as an `ActionIntent` with a deterministic rule id.
- **Nothing from your calendar is anywhere near this.** _(2026-08-18 —
  [ADR-0014](./adr/0014-reading-free-busy.md).)_ The function that compiles your settings into the
  rule set the gate evaluates takes what a run may read and the four dials you set, and it has no
  parameter a busy interval could arrive through. A calendar is neither deterministic code nor a
  person in front of you, so it authorizes nothing, sets nothing, and cannot raise a limit you set.
  It offers a number on a screen you were already reading, beside the dial, for you to press or
  ignore. That is the whole of it.

### Capabilities that do not exist

_(Rewritten 2026-08-11 — [ADR-0010](./adr/0010-acting-in-the-browser.md). The previous version of
this section said Propositum "cannot send a message or email, purchase or book anything, publish a
document, delete a file, or control your computer". That is no longer true, and the honest version
is below. This is the section of this document most likely to be quoted, so it says the weaker thing
plainly rather than the stronger thing carefully.)_

Propositum can now act in your browser: it can click, type, and submit, in a tab it opened, under an
agreement you ratified. So it **can** press a button that sends something.

What still does not exist, and what replaced what did:

|                                |                                                                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Still absent entirely**      | any capability outside your browser — your filesystem, your other applications, your computer. There is no tool, and an architecture test asserts none exists. *(Qualified 2026-08-26 — see the note under this table. Propositum still cannot reach your filesystem; you can now hand it one file at a time.)*                                                           |
| **Still absent entirely**      | any way for Propositum to run its own JavaScript in a page you are signed into. No `Runtime.evaluate`, no `element.click()`. Clicks are synthesised input at coordinates                                                |
| **Still absent entirely**      | any way to learn that another tab exists, or to act in one                                                                                                                                                              |
| **Replaced by a confirmation** | sending, submitting, buying, publishing, deleting. These used to be absent from the `ActionKind` enum. They are now reachable by a click, and every action the browser attests as irreversible stops and asks you first |

**About that first row, and a file you choose yourself** *(2026-08-26)*. The project screen now has
an *Open a file…* control beside the document. It changes nothing this table says and it is worth
being precise about why, because *"your filesystem"* is the kind of phrase somebody quotes:

- **Propositum has no filesystem capability.** No tool, no path, no directory, nothing it can
  enumerate or open. `tests/architecture.test.ts` greps `src/policy/tools.ts` and that check is
  untouched, because nothing was added to it.
- **The only file ever read is the one you pick in your operating system's own dialog**, and the only
  thing that reads it is your browser. Its text goes into the box on the screen, where you read it
  before Propositum does, and it is stored only if you then press Save. There is no upload endpoint
  and no second parser — a `tests/document-import.test.ts` assertion pins that the file input has no
  `name`, so the browser cannot submit the file even if a route for it ever appeared.
- **What actually changed** is that you can hand Propositum a document without retyping it. That is
  the same act as pasting, with fewer steps.

**A confirmation is weaker than an absence, and this document is not going to pretend otherwise.** An
absence cannot be misconfigured or clicked through; a question can be. What holds it up:

- **Irreversibility is decided by the browser, not by a model and not by the page.** An action needs
  your confirmation when Chrome is about to send a non-`GET` request, or a request to a site outside
  the agreement. Chrome attests the method, so page text cannot forge it.
- **A word list over the button's own label can only make Propositum more cautious**, never less.
- **No dial can pre-approve one.** There is no setting, anywhere, that grants irreversible actions in
  advance. The acknowledgement is per action.
- **Time cannot approve one.** A question that expires produces no answer and no permission. There is
  no path from elapsed time to _yes_.
- **What already happened is never dressed up as reviewable.** If something landed out there,
  Propositum reports it and offers you no verdict, because a Reject button that cannot reject is a
  lie told by the one screen this whole model rests on.

**The honest hole:** a `GET` request can be irreversible — an unsubscribe link, a one-click
confirmation — and the network mechanism does not see those at all. The word list is English-only.
Both are stated in ADR-0010 as the largest uncovered case in this design.

## Prompt injection

The honest section.

### The guarantee

> **An injection can change what the worker attempts. It can never change what the worker may touch.**

`compilePolicy` is typed so it **cannot receive prose**. Passing the objective, definition of done,
or guidance into a permission decision is a compile error. So no page text — however crafted —
widens the source allowlist, adds a capability, or extends the budget.

Verified against the hostile corpus on the loosest possible autonomy settings: a source the
injection tried to add is refused with `source_not_approved`; an invented capability is refused with
`unknown_action_kind`.

### The exposure

**The session-reading boundary is inside the blast radius.** It reads page-derived text and produces
the inferred objective, so a successful injection can rewrite what Propositum thinks you are doing —
_before you see the handoff screen_.

**Your review of the agreement is the thing that catches it.** That is why the review cannot be
switched off, why every claim carries evidence back to its source events, and why fabricated quotes
are counted rather than dropped.

A person who ratifies a contract without reading it has removed the boundary.

### Depth, not boundaries

| Mechanism                                           | Status                       |
| --------------------------------------------------- | ---------------------------- |
| `compilePolicy` cannot receive prose                | **boundary**                 |
| `ContractScope` gates every action                  | **boundary**                 |
| Capabilities absent from `ActionKind`               | **boundary**                 |
| Human ratification before any run                   | **boundary**                 |
| Datamarking and fencing of page text                | depth                        |
| Sanitisation (zero-width, bidi, control characters) | depth                        |
| The system-prompt rule                              | depth                        |
| The model's own judgment                            | depth, and the weakest layer |

**Spotlighting and delimiters are not a boundary.** OWASP 2026 reports adaptive attack success above
90% against twelve recent defences. They are deployed. They are not relied on.

### Observed behaviour, and its limits

Against the hostile fixture (`claude-opus-5`, 2026-08-07) the reading kept the correct objective and
**reported the injection as an uncertainty claim**, naming each payload, rather than following any of
them. It also flagged a page title as page-authored and unverified, unprompted.

**One run, one model, non-adaptive payloads.** This is evidence the prompt contract is coherent. It
is not evidence of safety, and it does not transfer to another model.

It is useful in one specific way: a reading that _reports_ an attack gives you something to react
to, whereas silent resistance looks identical to not having been attacked.

## Trust boundaries in the browser

- The extension talks to `127.0.0.1` over **HTTP**, with a per-session bearer token, an `Origin`
  check pinned to the extension id, and `application/json` plus a custom header. _(Corrected
  2026-08-11: this said "a WebSocket", as does [ADR-0002](./adr/0002-observation-capture.md)'s
  decision table. The shipped extension uses `fetch` plus a 30-second `chrome.alarms` heartbeat, and
  the code is authoritative — a socket is the wrong shape for a service worker that dies every 30
  seconds, and the security argument was never about the transport being a socket. It was about the
  four controls, and all four hold on the HTTP path.)_
- **CORS protects nothing here.** `POST` with `Content-Type: text/plain` is CORS-safelisted, so a
  forged event from a hostile page would be _delivered and executed_ — only the response is
  withheld, and fire-and-forget forgery needs no response. Hence all four controls above.
- Chrome extensions are currently exempt from Local Network Access restrictions. That is documented
  only in an unversioned Google document that says _"currently"_, so the extension performs a
  **startup self-check that fails loudly** rather than assuming it holds.

## Auditability

Every action is an `ActionIntent` (reason, before) and an `ActionOutcome` (result, after), both
append-only. Refusals are recorded too.

Append-only is enforced by **three SQLite triggers per table** — no `UPDATE`, no `DELETE`, and no
`INSERT OR REPLACE`, which walks straight through the first two — reinstalled _and verified_ at every
startup, because Prisma's migrations drop triggers on any table rebuild, silently. Startup **fails**
if a guard is missing: a database that accepts an `UPDATE` on the ledger is worse than an application
that will not boot, because the first one is silent.

**`ActionEvidence` has two of the three**, and that is the only exception in the schema. It is
guarded against being rewritten and not against being removed, because it is the one table that is
swept. See _Retention and deletion_.

Any sentence in a reviewed draft traces back through changeset → contract → reading → claim →
evidence → the originating observation event. Every hop is a foreign key, and no step requires a
model to be truthful about its own history.

## What this document does not cover

- **Multi-user.** Changes the threat model entirely; not a small extension of this one.
- **A malicious local user.** Anyone with your filesystem has your SQLite database.
- **Supply chain.** Dependencies are audited (`npm audit`, currently 0) and not otherwise verified.
- **The compile-time guarantees at runtime.** The `AuthorizedAction` and `Datamarked` brands make
  accidental bypass impossible and deliberate bypass loud. They are not a sandbox: code inside this
  repository could reach either brand reflectively. The threat model is our own future carelessness,
  not an attacker who can already run arbitrary code in the worker.
