# ADR-0013 — Authored labels and exit type: one permission, taken deliberately

**Status:** accepted · 2026-08-17
**Amends:** [ADR-0002](0002-observation-capture.md) — what the capture layer may observe, and the
claim that every API permission it holds is warning-free · [ADR-0008](0008-ambient-detection.md) —
what ambient capture records while watching
**Beside:** [ADR-0012](0012-screen-capture-refused.md), accepted the same day. That ADR is what was
refused; this one is what was taken instead, and the two should be read together or neither
**Depends on:** [ADR-0008](0008-ambient-detection.md) — the in-memory buffer, the 30-minute window,
the 500-row cap, and the asymmetry that makes a false positive the expensive failure
**Research:** [`intent-signals.md`](../research/intent-signals.md) §3, §4.1, §4.2, §4.3, §4.6, §4.7 ·
[`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §2.1, §9, §10.1

## What this costs, before what it buys

Two things, and the first is the one a reader will care about.

**A new Chrome permission, ~~and it is the first one this extension has asked for that shows a
string of its own at install~~ and it is the first one taken for a capture signal that shows a
string of its own at install.** `tabGroups` renders *"View and manage your tab groups."*
([`intent-signals.md`](../research/intent-signals.md) §4.1, from Chrome's
[permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list)).
It is **not** absorbed by the `kHostsAll` rule that swallows `tabs`, `webNavigation`, `topSites` and
`favicon` under the `https://*/*` grant ADR-0008 took — so unlike those four, this one cannot be
added quietly. The person is asked. That is a cost and it is also the best property this decision
has: the capability that shows a string is the capability nobody can add in an update while nobody
is looking.

*(Struck and corrected 2026-08-17, the day this ADR was accepted, against the very reference it
cites. `tabGroups` is the **third** permission in this manifest that shows a string, not the first.
Chrome's permissions list: `notifications` — *"Display notifications."*; `debugger` — *"Access the
page debugger backend."* plus *"Read and change all your data on all websites."*; `tabGroups` —
*"View and manage your tab groups."* Only `alarms`, `idle`, `scripting`, `sidePanel` and `storage`
are warning-free. `debugger`'s first string is its own and is not absorbed by the host warning
either — `tests/capture.test.ts` has counted it as not-warning-free since it landed. What survives,
and is what the decision actually rested on: this is the first string bought for a **capture
signal** rather than for a mechanism, and it is not absorbed.)*

It makes one sentence in [`extension/manifest.json`](../../extension/manifest.json) false. Its
permission comment opens *"Every permission here is WARNING-FREE at install"*, and after this ADR
that is no longer true. ~~Correcting it belongs in the diff that adds the permission, not here~~
**That sentence was already false before this ADR — `notifications` and `debugger` each show one —
so what this ADR adds is a third string, not the first.** Correcting it belongs in the diff that
adds the permission, not here, and it is named so the debt is visible rather than discovered.

**And this is the first signal Propositum reads that is *about a tab* rather than *from a page*.**
Everything in the ambient buffer today is a fact the content script learned by running inside a
document: the URL of the page it is in, the title that page reports, how long that page was engaged
with. A tab group title is a fact about the *container*, read through the extension APIs, and it is
a different kind of thing. The reader deserves that in the first paragraph.

**The context that makes this uncomfortable, stated up front rather than at the bottom.** Earlier
the same day, [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md)'s *"A list of your open
tabs"* bullet was corrected: what had been written as a structural guarantee — *"there is no call it
can make that returns a tab it did not create itself"*, *"still enforced by the browser rather than
by our code"* — was false, and had been false since ADR-0008 widened host permissions on 2026-08-11.
`chrome.tabs.query()` needs no permission, and under `https://*/*` it returns the URL and title of
every open `https` tab. What holds the promise now is
[`tests/extension-permissions.test.ts`](../../tests/extension-permissions.test.ts): our code
declining, not Chrome refusing.

**So this ADR adds a tab-adjacent capability to a product that discovered, hours ago, that its
tab-list promise was weaker than it had been telling people.** That is the worst possible week to be
taking a permission with the word *tab* in its name, and it is exactly why this is an ADR with an
argument in it rather than a line in a manifest.

## Decision

**Two signals, and only two.**

| | |
|---|---|
| **Exit type** | how a page was left, carried on the ambient path as a small closed enum. No new permission |
| **Authored label** | the title a person typed on their own tab group, read **only** for a page Propositum is already observing. Costs `tabGroups` |
| **Declared where** | `permissions`, at install — **not** `optional_permissions`. Argued below |
| **What reads them** | ~~detection may raise confidence with either~~ **nothing reads exit type at all; the label is read by exactly one thing, `describeWork`'s sentence** *(corrected 2026-08-17 — see constraint 1)*. Neither may gate. Neither may reach `compilePolicy`, a `ContractScope`, or any decision the gate makes |
| **What they are worth** | exit type sharpens a measurement this product already takes. An authored label is a different kind of fact and fires rarely |

Everything else in the ranked list stays where it was. `tabs`, `webNavigation`, `history`,
`bookmarks`, `topSites` and `sessions` are not taken here and the guard keeps forbidding the calls
that reach them.

## The argument for exit type

[`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §2.1 and §9. Fox,
Karnawat, Mydland, Dumais & White (TOIS 2005) is the study that founded implicit feedback, and it
ran the ablation nobody quotes:

| Model | Accuracy predicting a satisfied visit |
|---|---|
| Clickthrough alone (baseline) | **40%** |
| **Dwell + exit type — two variables** | **66%** |
| All nineteen predictors | **70%** |

Verbatim: *"The two most important variables in the Bayesian model were Difference in Seconds and
Exit Type… Using just these two variables in the Bayesian model, accuracy for predicting SAT was
66%… **both of which were very close to the model using the full set of 19 predictor variables**."*

Propositum already collects the first of the two. Exit type is the second, and it is the only signal
on the research note's whole list that is co-equal with something we already have. It separates
*read it and moved on* from *bounced straight back* — a distinction dwell alone cannot express, and
one that every decision-tree node quoted in that paper conditions on. Fox's dissatisfaction node
requires it outright: *"when users spent very little time on a page and they did go back to the
results list, they were likely to be dissatisfied (with a probability of 73.4%)."*

**It must be obtainable without `tabs`, `webNavigation` or `history`, and that constraint is not
negotiable.** A page lifecycle event fires in a document the content script is already running in;
what the service worker knows about a tab it is already exchanging messages with, it knows without
enumerating anything. If it turns out that some part of *how a page was left* is only reachable
through one of those three permissions, that part does not land. The signal is worth having; it is
not worth having at the price of the three permissions this corpus has spent four documents
explaining the absence of.

### The honest limit on the number

**Fox measured exit type in a search context, and this product has no results page.** The exit type
that carries their signal is *back to the SERP* — a return to a ranked list the system itself
produced, which is why it reads as dissatisfaction. Propositum ranks nothing and presents nothing.
A `back` in general browsing is, on Adar, Teevan & Dumais's five weeks of 612,000 users,
overwhelmingly hub-and-spoke: in the sub-hour band that a 30-minute buffer is the only band able to
see, **77.0%** of revisits are same-domain and only **2.9%** were reached via a search
([`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §9.3).

So the 66% does not transfer. What transfers is the *shape* of the finding — that how a page was
left carries information dwell does not — and the specific figure belongs to a task this product
does not perform. Anyone quoting "66%" as a property of Propositum has quoted it wrong, and this
paragraph exists so that the next person to reach for it meets the caveat first.

## The argument for authored labels

[`intent-signals.md`](../research/intent-signals.md) §3 and §4.3. The ranked table puts `tabGroups`
second of sixteen, and the section is titled *"`tabGroups` is the best signal in this table and it
is not close"*.

The reason is not that it is a better measurement. It is that it is a **different kind of fact**,
and it is the fact the whole detection pipeline exists to reconstruct:

> `topics.ts` runs a stopword list, a branding-suffix regex, and a Damerau-Levenshtein neighbour
> test with a measured argument about English word density, to produce a ranked list of recurring
> terms; `boundaries/subject.ts` then spends a model call turning that list into a sentence a
> colleague would recognise. **A tab group titled *"world models"* is that sentence, typed by the
> person, with no model call and no possibility of a confidently-wrong name** — which is the failure
> ADR-0008's own *Revisit when* section names first.

And the pattern is not a one-off. The signals research found it **four separate times**, in four
unrelated systems: a tab group title, a calendar `focusTime` block, a Slack `status_text`, a git
branch name. §3's closing line is the one worth carrying: *"More observation is the expensive way to
guess at something people keep writing down."*

That sentence is the connective tissue between this ADR and ADR-0012. A rolling screenshot cache is
the most expensive possible way to find out what someone is working on. The person naming their own
group of tabs is the cheapest, and it costs one honest warning string.

## The mechanism, which is the whole of why this is narrow

Two facts from Chrome's own documentation, and together they are the entire privacy argument.

**1. `chrome.tabGroups` returns group metadata and never the tabs inside.** Chrome's own sentence,
from the [`tabGroups` reference](https://developer.chrome.com/docs/extensions/reference/api/tabGroups):

> *"To group and ungroup tabs, or to query what tabs are in groups, use the `chrome.tabs` API."*

A `TabGroup` is `{ id, title?, color, collapsed, windowId, shared }`
([`intent-signals.md`](../research/intent-signals.md) §4.2). There is no member that is a tab, a
URL, a title of anything but the group, or a count. The API cannot be walked from a group to its
contents; walking it requires `chrome.tabs`, which the guard forbids and this ADR does not touch.

**2. The group id arrives on a message from a page we are already observing.** `sender.tab` is
present on `chrome.runtime.onMessage` for messages sent by a content script, and Chrome's
[`runtime` reference](https://developer.chrome.com/docs/extensions/reference/api/runtime) lists no
permission requirement for it. `groupId` is not one of the four sensitive properties the `tabs`
permission gates — those are `url`, `pendingUrl`, `title` and `favIconUrl`
([`tabs` reference](https://developer.chrome.com/docs/extensions/reference/api/tabs), quoted at
length in [`intent-signals.md`](../research/intent-signals.md) §2.1).

**So the only sanctioned path is one direction and one direction only:**

> a page Propositum is **already observing** sends its ambient report → the service worker reads
> `sender.tab.groupId` from that message → `chrome.tabGroups.get(groupId)` → the title.

Nothing in that chain can produce a tab Propositum was not already watching, because the chain
*starts* at one. The capability reads a label for pages already in the buffer and gains no ability
to learn that any other tab exists.

### What would break it, named precisely

- **`chrome.tabs.query()`**, which needs no permission and under `https://*/*` returns the URL and
  title of every open `https` tab. It is the first entry on
  [`tests/extension-permissions.test.ts`](../../tests/extension-permissions.test.ts)'s forbidden
  list and it stays there. **Nothing in this ADR authorises it.** If an implementation of this
  decision reaches for it, the implementation is wrong and not the guard.
- **`chrome.tabs.get()`**, for a tab id that came from anywhere but `chrome.tabs.create`. Same list,
  same answer.
- **`chrome.tabGroups.query()`**, which is the new one and is the reason this bullet exists.
  `query()` returns **every group in every window** — including groups whose tabs Propositum has
  never seen and never will. That is metadata about the shape of somebody's whole desk, obtained
  without a single one of those tabs being observed, and it is precisely the thing the `tabs`
  refusal is about. `get(groupId)` for an id that arrived on `sender.tab` is the narrow call;
  `query()` is the wide one. **The forbidden list should carry `chrome.tabGroups.query` beside
  `chrome.tabs.query`**, and a permission taken for the narrow call while the wide call stays
  writable is a permission taken on trust rather than on argument.
- **A groupId from anywhere but `sender.tab`.** A stored id, an id carried forward from an earlier
  message, an id incremented or guessed. Group ids are small integers; nothing stops a call for one
  we were never handed. What stops it is that the value is read off the message and used in the same
  turn.

## What is not granted

Enumerated, because a permission with *tab* in its name reads broader than it is.

| | |
|---|---|
| **A list of your open tabs** | still not granted, and `tabGroups` grants no part of it. No URL, no title, no favicon, no count, no tab id, for any tab — including the tabs in the very group whose name we read |
| **The membership of a group** | not granted. Chrome's documentation says outright that answering *which tabs are in this group* requires `chrome.tabs` |
| **Groups you have not opened a watched page in** | not granted by the sanctioned path, and granted by `chrome.tabGroups.query()`, which is why the bullet above forbids it |
| **Anything about a group beyond its label** | `color`, `collapsed` and `shared` come back on the same object and are of no use to detection. Reading a field because it arrived is how a permission's surface grows without a decision |
| **Any retrospective view** | `history`, `sessions` and `topSites` stay absent. Nothing here sees a page from before the process started |
| **`transitionType`** | `webNavigation` stays absent. Exit type says how a page was **left**; it does not say how the next one was **reached**, and the two are not the same signal. ADR-0008 records what would have to be argued to take the second one |
| **Any widening of what a model may be told** | ~~both signals are untrusted content and are datamarked~~ **neither signal is an input to any model boundary, so neither reaches a prompt at all; `datamark()` is the required door if one ever does** *(corrected 2026-08-17 — see constraint 2)*. Neither may reach `compilePolicy`, a `ContractScope`, an `AuthorizedAction`, or any gate |

### Why a person's own words are still untrusted

A tab group title is typed by the person, not by a page. It is nonetheless untrusted, and the day it
can reach a model it must be datamarked on the same terms as a page title, for three reasons that do
not depend on suspecting the person. *(Tense corrected 2026-08-17: today it reaches no model, so
this section is the rule that binds the first person who wants it to, not a description of a
transform standing in the code.)*

1. **A person can paste.** A label copied out of a page is a page's words wearing a person's
   authorship, and nothing downstream can tell the two apart.
2. **Untrusted is a statement about the channel, not about the author.**
   [`CONTEXT.md`](../../CONTEXT.md)'s rule is one sentence and it is mechanical: *nothing under
   `untrusted` may influence a policy decision, be treated as an instruction, or enter a prompt
   without datamarking.* A value that arrives without a human reading it at the moment it arrives
   belongs under that rule regardless of who typed it.
3. **The `guidance` precedent is the sharp one.** `guidance` is the one field this corpus guards
   hardest — human-typed only, per-contract, never durable — precisely because it is *"the one place
   where page prose could otherwise become something the worker follows"*. Its safety comes from
   being retyped and re-ratified for every contract, not from having been typed by a person once.
   A tab group title is a sentence a person typed weeks ago about something else and has not
   re-read. It gets the weaker treatment, not the stronger one.

## Why it is declared at install rather than requested at runtime

The research prefers the other answer, and the counter-argument is real.
[`intent-signals.md`](../research/intent-signals.md) §4.6 establishes that `tabGroups` carries no
`kFlagCannotBeOptional`, so it *can* be requested at the moment it would help; §4.3 recommends
exactly that, on the grounds that a signal which is *"excellent when present and absent most of the
time"* is the right shape for an optional permission.

**It is taken at install anyway, and the reason is a property of this repo rather than of Chrome.**
[`tests/extension-permissions.test.ts`](../../tests/extension-permissions.test.ts) pins
`optional_permissions` to empty, with the argument that *"a runtime grant is still a grant"* — an
optional permission is a full-strength grant with a later start date, and a set assertion over
`permissions` alone steps straight over it. Putting the first entry in that array would spend an
assertion whose whole value is that it has never had to be edited.

Against that: an install-time grant is held for the life of the extension whether or not the person
ever makes a tab group, and it is asked for at the moment of least context — during install, beside
a warning about all data on all websites, which is when nobody reads anything.

**Both readings are defensible and this ADR picks the one whose failure is visible.** An install
string is in the one place a reviewer and the person both look, and it is in the manifest where the
pinned permission set turns red if it changes. A runtime request is a dialog somebody clicks through
in a moment they will not remember. If the product later grows a real in-context moment to ask in —
a screen where the person is looking at a named thread and can see what the label would be for — the
trade changes and this decision should be reopened rather than inherited.

## What this changes in the code

**Nothing about the bar.** No threshold moves, no ground is added or removed, no session that
qualifies today stops qualifying, no model runs anywhere new in the detection path, and ADR-0008's
*no model on a timer* rule is untouched. This ADR authorises two signals to be **carried**; it does
not authorise them to **decide**.

Four constraints the implementation has to satisfy, stated as the argument rather than as a design:

1. **Neither signal may gate detection.** ~~An authored label may raise confidence and may replace
   a reconstructed name with a typed one.~~ **An authored label may replace the words a
   deterministic sentence shows, and may touch nothing else.** It may never be required for a thread
   to qualify, and a thread with no group must be exactly as detectable as it is today. This is
   ADR-0012's own sentence about the same signal — *"it may raise confidence and must never gate
   detection"* — and it is repeated here because it is the rule this decision is most likely to be
   broken by.

   *(The struck half is corrected 2026-08-17, the day this ADR was accepted, and it was the more
   dangerous half. `OfferGrounds` is `{ kinds, sufficient, sentences }` — there is no confidence on
   it to raise, and "confidence" is a word `CONTEXT.md` displaces from the vocabulary outright.
   Sanctioning a rise here sanctioned the one thing the permission was bought on the promise of
   never doing. What shipped, and what is enforced: a label may not touch `OfferGrounds.kinds`,
   `OfferGrounds.sentences` or `OfferGrounds.sufficient`, and `tests/detection.test.ts` compares
   grounds byte-for-byte with and without one over the same afternoon. Acting on the struck sentence
   turns that test red, which is the intended outcome.)*
2. **Both are untrusted, structurally.** ~~They live under an event's `untrusted` key, they are
   datamarked at the one `datamark()` call site, and there is no path from either to
   `compilePolicy`, a `ContractScope`, an `AuthorizedAction`, or a gate. This is a compile-time
   property in the corpus already and it should stay one.~~ **Neither is an input to any model
   boundary, so neither reaches a prompt in any form; and there is no path from either to
   `compilePolicy`, a `ContractScope`, an `AuthorizedAction`, or a gate.**

   *(Corrected 2026-08-17, the day this ADR was accepted. What shipped has no `untrusted` key on
   `AmbientObservation` — `exitType` and `groupTitle` are plain top-level fields — and no
   `datamark()` call on either. That is a stronger containment than the struck sentence described,
   not a weaker one: `SubjectInput` takes `titles` and `searches` and has no field for a label, and
   `tests/reachability.test.ts` forbids the identifiers `groupTitle` and `authoredLabel` appearing
   in `name-thread.ts` or `compose-offer.ts` at all — datamarked or not. It is enforced by that test
   rather than by the type system, so "compile-time property" was wrong twice. `datamark()` remains
   the required door the day a boundary gains a field for one, which is the condition the section
   above states.)*
3. **The domain rule is unchanged and applies.** `src/domain/**` imports nothing from
   app/model/persistence/policy, calls no `fetch` and no `node:fs`, and never reads a clock. A
   signal arriving from a browser API does not earn an exception.
4. **A signal landing must not silently retune a constant.** ADR-0012 states this and it holds
   here: the thresholds in `grounds.ts` are guesses set before real browsing existed, they are named
   as guesses, and moving them is a separate decision that needs its own measurement.

## The honest limits

**A person who groups their tabs is telling Propositum something. A person who does not, is not.**
Most people do not use tab groups. This signal is present for a minority of sessions and absent for
most, and **a signal that fires rarely cannot carry a rule** — it can only improve the sessions where
it happens to be there. That is the right shape for a confidence input and the wrong shape for a
dependency, and it means the honest expected value of this permission is *better names on some
afternoons*, not *better detection*.

**A group label is a fact partly about tabs we cannot see.** The name someone gave a set of eight
tabs was chosen with all eight in mind, and Propositum reads it having observed two. We learn the
name of a set without learning the set. That is a much narrower thing than enumeration and it is not
nothing, and describing it as *"only metadata about pages we already see"* would be rounding it up.

**A label can be the most sensitive string in the buffer.** A cleaned URL and a page title are
things a site chose to publish. *"job hunt"*, *"second opinion"*, *"lawyers"* are things a person
wrote about themselves, in their own words, for their own eyes. Short is not the same as harmless,
and the label is plausibly the single most revealing eighteen characters the ambient buffer will
ever hold. What bounds it is what bounds everything else on that path — in memory only, a 30-minute
window, a 500-row cap, discarded on decline — and if an offer is accepted it becomes an ordinary
`ObservationEvent` under `untrusted`, durable, in the ledger, like every other thing the person
agreed to have folded in.

**Exit type is a better measurement of what is already measured, not a new kind of fact.** It
sharpens `read-deeply`. It does not make Propositum see anything it could not see, and ADR-0012's
strongest counter-argument is untouched by this ADR: **Propositum still cannot see work that does
not happen in Chrome.** A tab group title is inside Chrome. A page lifecycle event is inside Chrome.
Anyone reading this ADR as narrowing that gap has read it wrong; it makes Chrome-shaped detection
sharper and leaves it exactly as Chrome-shaped as it was.

**And this is a permission taken on evidence about a different task.** Fox is search; Adar is
revisitation; the tab-group argument is a pattern found four times and measured zero times. §3.4 of
the suggestion-quality note reports that **no primary source segmenting a full page-visit stream
into threads of work could be found at all**. There is no benchmark to calibrate any of this
against, and there will not be one. What this ADR rests on is that the two signals are the cheapest
things on a ranked list and that one of them is a sentence a person wrote — not on a measurement of
this product.

## What would have to change to revisit

Concretely, in the form [ADR-0012](0012-screen-capture-refused.md) used.

- **The authored label turns out to fire on fewer than one session in ten, measured on this repo's
  own fixtures.** Then a permission that shows an install string is buying almost nothing, and the
  honest move is to drop it rather than keep it for the afternoons it helps. This is the first thing
  to measure and nothing measures it today — the same gap `PRODUCT_PRINCIPLES.md` §13 names about
  how often Propositum speaks at all.
- **A named thread is wrong because a group title was stale.** A label survives the work it was
  written for; a group called *"world models"* that now holds flight bookings will name the thread
  confidently and wrongly, which is the exact failure ADR-0008's *Revisit when* opens with. If that
  is observed, the answer is not a freshness heuristic — it is that an authored label stops
  outranking the reconstructed name and goes back to being one input among several.
- **Someone proposes `chrome.tabGroups.query()`**, for any reason, including *"to find the group
  the person is most likely working in"*. That is the wide call, it reads groups whose tabs we have
  never observed, and it needs this ADR reopened rather than routed around. The same applies to
  `chrome.tabs.query()` proposed *"only to resolve a group"*.
- **Someone proposes `sessions`, `readingList` or `bookmarks` on the strength of this one.** Each is
  individually cheap and the sum is the bundle Chrome's own quality guidelines name: *"Don't create
  an extension that requires users to accept bundles of unrelated functionality."* Two signals were
  taken here because two is what the evidence supports. A third needs its own evidence, not this
  ADR's momentum.
- **Exit type turns out to be unobtainable without `webNavigation`.** Then it does not land, and the
  question becomes whether `webNavigation` is worth taking on its own argument — which ADR-0008
  already says has to be made deliberately and separately, and which this ADR does not make.
- **A real in-context moment to ask for the permission appears.** Then the install-versus-runtime
  trade above changes, and `optional_permissions` becoming non-empty is a decision about what that
  pinned-empty assertion was protecting, not a mechanical edit to make a test green.

## Revisit when

- The offer rate is measured and the authored label's contribution to it is separable.
- Any call in the extension reaches a group, a tab, or a tab id that did not arrive on
  `sender.tab` from a page already being observed.
- The `tabGroups` warning string changes, or Chrome moves `groupId` behind a permission. Both are
  read from documentation dated 2026-08-17 against Chrome M151/M152, and neither is a contract.
- ADR-0012 is reopened. This ADR is half of that decision and would need re-reading beside it.
