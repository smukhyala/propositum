# ADR-0008 — Ambient detection: watch continuously, offer, never act

**Status:** accepted · 2026-08-11
**Amends:** [ADR-0002](0002-observation-capture.md) — the permission model, and only that
**Overrides:** the founding brief's exclusion of *automatic project recognition*; `CONTEXT.md`
§2's *never on a timer*; [`docs/MVP.md`](../MVP.md) assumption 3

## Context

Assumption 3 was: *"The person will actually start and stop sessions explicitly."* It was named as
a bet rather than a fact, and it lost on first contact with use. The owner started a session,
browsed the site they had approved, and the honest summary was **"I did a session and interacted
with the site, but Propositum didn't do anything."**

Two separate failures were tangled in that sentence, and only one of them was this one. The other
was a transport bug ([#63](https://github.com/smukhyala/propositum/issues/63)) where capture was
refused by its own origin check. But the product ask survived the bug being fixed:

> the way I want this to work is that I don't have to provide context on what I'm doing and give it
> that, it should always be watching and once it recognizes I'm doing something it steps in and
> asks to help

That is a direct reversal of a founding-brief exclusion, and it was made with the exclusion quoted
back and the cost stated.

## Decision

**Propositum watches continuously, detects work deterministically, and offers. It never acts.**

| | |
|---|---|
| **What it may see** | Every `https` origin. `host_permissions: ["https://*/*"]` at install. |
| **What it records while watching** | Metadata only — cleaned URL, title, dwell, ~~scroll~~ ~~**and, on the ambient path, still not scroll**~~ **scroll, how the page was left, and the title of the tab group the page sits in where the person made one**. Never page text. *(Amended ~~twice~~ **three times** on 2026-08-17; the second amendment corrects the first, and the third records that the change the first two argued about was made. **What is true:** the app's ambient schema accepts a scroll fraction as of 2026-08-17 and `AmbientStore` carries it; ~~**the extension does not send one**, so nothing is recorded and this row may not claim it~~ *(true until 2026-08-17; see the third amendment at the end of this row)*. The first amendment said "scroll — true since 2026-08-17" and named the app's schema as the place the value was dropped. Both halves were wrong. The value is dropped **earlier and in the extension**: `flushAmbient` in `extension/src/service-worker.js` projects each buffered signal onto the wire shape by hand and copies `dwellMs` across as `engagedMs` without copying `scrollFraction`, so no request the extension builds has ever carried the field — the app's missing schema field was the second gate, not the first. ~~Landing the one-line producer change is deliberately **not** done here: `content.js` does not clamp, `ambientSchema` refuses anything outside `[0, 1]`, and a refused batch is dropped rather than retried, so sending the field today would let one overscrolled page discard up to a hundred observations. That changes which afternoons qualify, which is the one thing this correction is not allowed to do.~~ *(Done on 2026-08-17 by ADR-0013, which answers this objection by omitting an out-of-range reading rather than clamping it — see the third amendment below.)* See `content.js`'s own note above `reportEngagement`, which had this right and was the only place in the corpus that did. ~~The row claimed scroll from the day it was written, 2026-08-11, and it is a specification still.~~ **AMENDED A THIRD TIME 2026-08-17 — [ADR-0013](0013-authored-labels-and-exit-type.md), which lists this ADR under its *Amends* header and should have landed this edit in the same diff. The producer line was written: `flushAmbient` now copies `scrollFraction` onto the wire, guarded on the value already being inside `[0, 1]` — so an out-of-range reading is OMITTED rather than clamped, which is exactly what happened to every reading before today, and no batch the app accepts today starts being refused. That answers the objection the struck text raises, and it is the reason the change was affordable after all. So **the extension does send one**, the row is a description at last, and ADR-0013 adds two more fields beside it: an exit type and a tab group title. `tests/reachability.test.ts` asserts the projection carries all three, sliced to `flushAmbient` so that a field mentioned elsewhere in the worker cannot keep the assertion green. **Nothing in the detector reads scroll or exit type even now** — landing a signal and consulting it stay two decisions, and the same file holds both deferrals.** Found by [`docs/research/intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §9, which ranks scroll second among the behavioural signals that carry anything at all — behind exit type, and ahead of the other seventeen measures Fox et al. logged.)* *(**AMENDED A FOURTH TIME 2026-08-18.** One more field, and the row's list is now: cleaned URL, title, dwell, scroll, how the page was left, **how it was arrived at**, and the tab group title. `arrival` is one of five closed values — `no-referrer`, `same-origin`, `cross-origin`, `reloaded`, `back-or-forward` — and it is the same shape of defect as `scrollFraction`, found one day later: `extension/src/content.js` has sent `referrer` and `navigationType` on every navigation since the signal existed, `src/capture/semantics.ts` consumes both and calls the referrer *"our partial substitute for transitionType, which lives behind `webNavigation`"* — and that is the SESSION path. Detection runs on this one, which dropped both. **What this row must not be read as saying:** the ambient buffer does NOT hold the referrer. It holds a classification computed inside the content script, and ~~the URL it was computed from never leaves the page~~ **no referrer reaches this app on this path.** *(Corrected 2026-08-18, same day, after review. The struck claim was wrong and it was the load-bearing one: `content.js` sends `referrer` on every navigation because the session path needs it and the script must not be able to learn whether a session is running, so the URL crossed into the extension's service worker and — until the correction — was written into `chrome.storage.session` by `bufferAmbient` and left there until the next flush. `flushAmbient` never put it on the wire, so the APP half was always true. The fix deletes `referrer` and `navigationType` on the worker's no-session branch, in the same destructure that deletes page text, so the extension's own buffer no longer holds one either.)* The asymmetry is the decision: a session is consented, scoped and auditable, and may hold the address somebody came from; the always-on buffer may not, because that address can name a site nothing else here observes. No permission was taken and no manifest entry changed. **Nothing in the detector reads it**, which makes three signals landed and unread — `tests/reachability.test.ts` holds all three deferrals and, for this one, an expiry: build the offer-rate measurement §10.5 says does not exist and judge all three against it, or take the fields out.)* |
| **Where that goes** | An in-memory buffer, bounded by a 30-minute window **and** a 500-row cap. Never the ledger. *(One exception, added 2026-08-16: a TITLE may be copied onto a later report for the same URL, because the extension sends one on a navigation and not on an engagement, so a page still being read under an expired navigation would otherwise report minutes of dwell under an empty name. A copy may never itself be copied, so a title can be just under two windows old and no more. The row it lives on is an ordinary row and the cap, the decline filter and `clear()` all apply to it unchanged. See `withCarriedTitle` in `src/server/ambient-store.ts`.)* |
| **How work is recognised** | Arithmetic. No model call. |
| **What detection produces** | A suggestion. Never a session, never an action. |
| **What accepting does** | Approves the source, starts the session, folds the buffer in, **and drafts a contract from the offer** — one click, all four the person's. *(Fourth clause added 2026-08-11 by [ADR-0009](0009-composed-offers.md). The row above it is unchanged and is restated verbatim there.)* |
| **What declining does** | ~~Drops the observations and snoozes the origin for an hour.~~ *(Amended 2026-08-17.)* Drops the observations and snoozes for an hour — **by THREAD from the front door, by origin from the extension**. The unit had to split when one afternoon started producing several offers: strands share sites, an afternoon that begins with three searches puts `www.google.com` at the head of all of them, and an origin-wide decline of one would silently take the other two's seed pages with it. `AmbientStore.declineThread` is the narrow one; `decline` stays because `/api/capture/ambient/decline` takes an origin and the extension is not being changed. The coarse path is a real gap and is named in that method's own block. |

Two detectors, both deterministic. `detectWork` fires on pages-and-dwell or on query-then-reading.
`detectPause` fires on real work followed by a real gap, and feeds the proactive hand-off offer.

## Why the exclusion existed, and what actually replaces it

The exclusion was not squeamishness. It was carrying a real guarantee: **Chrome, not our code,
decided what Propositum could see.** `optional_host_permissions` meant an unapproved origin was
structurally invisible — not filtered by an `if` statement we could get wrong.

Broad host permission gives that up. There is no way to keep it and also notice work on a site the
person has not set up yet, and noticing that is the entire feature. So the guarantee is now
**behavioural**, which is a weaker kind, and pretending otherwise would be the actual failure.

Weaker does not mean unenforced. It is enforced in three places rather than asserted in one:

1. **The service worker strips `text` on the no-session path.** There is exactly one line in the
   extension that decides page text may travel.
2. **The content script does not know whether a session is running.** Deliberately — a page could
   otherwise learn the answer by timing what its own script is permitted to do.
3. **The ambient endpoint's schema has no field that could carry text**, and a test greps it for
   `text`, `excerpt`, `content`, `untrusted` and `body`.

### The reason `tabs` and `webNavigation` are absent expired the day this ADR was accepted

*(Added 2026-08-17, from [`docs/research/intent-signals.md`](../research/intent-signals.md) §2.2
and §4.1. Nothing in the manifest changes here; what changes is which argument is load-bearing.)*

`extension/manifest.json`'s permission comment gives the reason those two are not requested, and the
reason is a **price**:

> `webNavigation costs the 'Read your browsing history' warning, and carries transitionType — the`
> `most semantically loaded signal there is […]. We give it up and take document.referrer plus`
> `Navigation Timing as partial substitutes.`

**That price stopped existing on 2026-08-11, and this ADR is the decision that removed it.** Chrome's
install prompt is a list of rendered *messages*, not of permission ids, generated by an ordered rule
engine in which each rule consumes the permissions it covers. The first host rule fires on
`kHostsAll` — which `https://*/*` produces — and its second list, the absorb list, contains
`kTab`, `kWebNavigation`, `kTopSites` and `kFavicon` by name. Chrome's own docs say it in one
sentence: *"the `"tabs"` warning won't show if the extension also requests `"<all_urls>"`."* And
because Chrome decides *"is this a privilege increase?"* by comparing the rendered message sets
rather than the ids, adding either one in an update would not even disable the extension pending
re-approval.

So there is no warning left to give up, and no re-consent to be stopped by. **The exclusion may
still be right. It is no longer right for the reason written down** — and a reason that has quietly
stopped applying is the kind the first person to check overturns. What it stands on now is
capability, and capability has to be argued rather than inherited:

- **`tabs` returns every open tab's URL and title.** That is a different fact about a person from
  *every page they visit while a content script runs on it*: it is what they have **kept open**, all
  of it, at once, including the windows they are not looking at. Broad host permission bought us the
  pages they walk through; `tabs` would buy the shape of their whole desk.
- **`webNavigation` carries `transitionType`**, which is the single most useful signal on the list
  and therefore the one most worth being careful about. `src/domain/detection/grounds.ts` spends its
  length approximating exactly this distinction — *"intent separates pursuing from receiving"* —
  and `typed` versus `link` would answer it outright. Taking it is a real detection decision with a
  real argument for it, which is precisely why it should be taken deliberately in its own ADR rather
  than absorbed into this one because it turned out to be free.
- **Web Store policy forbids taking either speculatively**, and says so in the terms that apply:
  *"Don't attempt to 'future proof' your Product by requesting a permission that might benefit
  services or features that have not yet been implemented."*

**Neither permission is taken here and no threshold moves because of this section.** It records that
the stated reason expired, six days after this ADR expired it, and what would have to be argued in
its place. ~~The manifest comment still cites the warning; correcting it is owed and is not this
file.~~

#### Everywhere the expired reason was written down

*(Added 2026-08-17, after review. The paragraph above owed one correction — the manifest comment —
and `docs/SECURITY_AND_PRIVACY.md` was amended the same day. A search then found the same two claims
in **six other places**: that `webNavigation` costs a warning, and that Chrome refuses to hand over
other tabs. One of the six is a numbered safety property inside the argument for granting `debugger`.
Listing them is the point. A false sentence corrected in one document and left standing in six is a
corpus that contradicts itself, and whoever lands on one of the six gets the strong version with no
pointer to the amendment.)*

**Corrected 2026-08-17, struck and dated in the house form:**

| Where | What it claimed |
|---|---|
| [ADR-0010](0010-acting-in-the-browser.md) §1 | *"there is no call the extension can make that returns a tab it did not create … the constraint is enforced by Chrome refusing, not by our code remembering"* — as a numbered safety property of the `debugger` grant |
| [`docs/VISION.md`](../VISION.md), *Observation* | *"What Chrome still refuses to hand over is the existence of any **other tab**"* |
| `extension/manifest.json`, `_comment_permissions` | *"Chrome enforces the constraint, not our code"*, and `webNavigation`'s warning price |
| `extension/manifest.json`, `_comment_debugger` | *"That constraint is still enforced by Chrome refusing rather than by our code remembering"* |

*(For the record, and corrected before this list existed:
[`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md), *Data explicitly not collected* — the
bullet that started all of this.)*

**Still owed, and named here so the debt is visible rather than forgotten:**

- **`extension/README.md`**, *What it can see* — *"Without `tabs`, the extension is structurally
  incapable of learning that the person visited anything else — Chrome will not hand over the URL,
  the title, or the tab. The constraint is enforced by the browser, not by our code being correct."*
  This file is doubly stale: it also still describes `optional_host_permissions`, which this ADR
  replaced on 2026-08-11. It wants rewriting rather than striking, which is why it is not done in
  this pass.
- **`src/policy/tools.ts`**, the `listTabs` / `attachToTab` bullet — *"there is no call that returns
  a tab we did not create."* What survives there is the narrower true claim: `chrome.tabs.create` is
  the only source of a tab id in the extension, and the greps are what keep it so.
- **`docs/research/intent-suggestion-quality.md`** §3.1 and §10.4 pair Jones & Klinkner's Table 8
  accuracies with Table 3's trained optima. Unrelated to permissions, found in the same review, and
  corrected in `src/domain/detection/detect.ts`'s `WINDOW_MS` note but not yet in the note itself.

**And the same finding falsified a promise elsewhere in the corpus**, because `chrome.tabs.query()`
needs no permission at all and is therefore reachable from the shipped extension today. See
[`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md), *Data explicitly not collected*, where
the tab-list bullet is amended and its guarantee handed to
[`tests/extension-permissions.test.ts`](../../tests/extension-permissions.test.ts). That is the
third enforcement point above acquiring a fourth sibling, and it is worth naming here: this ADR
traded a structural guarantee for a behavioural one and then found, six days later, that it had
traded one more than it counted.

## Why no model runs on a timer

`CONTEXT.md` §2 banned periodic interpretation for two reasons, and both are still good:

- it would feed hostile page text to a model while nobody is watching, during the phase whose whole
  purpose is passive observation;
- it would make the event stream non-reproducible, so the eval harness could not re-score a fixture.

A deterministic detector keeps both. The cost is that the offer can say *what it saw* and not *what
it means*: "you have been reading northwind.example.com — mostly Tiers", never "you are comparing
partner tiers". Naming the work needs a model, and a model on a timer is the thing being avoided.

~~The heuristic-gate-then-one-model-call option was considered and rejected for now.~~

**Adopted the same day.** The deterministic offer read *"you have been looking into general
intuition — across 3 sites"*, and the thing actually asked for was *"oh, you're researching world
models"*. String arithmetic does not get there, and the gap was the difference between a feature
that works and one that technically fires.

So [`boundaries/subject.ts`](../../src/model/boundaries/subject.ts) names the thread — the seventh
boundary, and the only one that runs with no session and no contract. Both of §2's reasons survive
intact rather than being argued away:

- **It runs only after `detectWork` has already fired**, so nothing reaches a model that has not
  first cleared a deterministic bar, and a quiet afternoon of browsing costs nothing.
- **Once per thread**, keyed on its terms, with an in-flight marker so two polls cannot race.
- **It sees titles and search terms only.** Ambient capture holds no page text, so there is none to
  send — the strongest form of the guarantee, because it does not depend on remembering to leave
  anything out. Titles are page-authored and every one is datamarked.
- **It cannot reach the eval harness.** Detection is in no scored scenario, so `SessionReading`
  reproducibility is untouched.

It runs in the background, never on the request path: the poll returns the deterministic offer
immediately and the next one carries the name. The model's sentence is used only when it reports
confidence — a confident wrong name is worse than an honest vague one.

## Several strands, one notification

*(Added 2026-08-17. The product owner: "it should also be able to detect multiple threads at once
if needed.")*

`findThreads` has always returned **every** thread, disjoint — each page is claimed by exactly one —
and `detectWork` took `threads[0]`. A recorded afternoon had three strands: a perturbation/robotics
search, a DMD-vs-SPO search, and Extended Kalman Filters followed through to an article. Only the
last surfaced. The other two were found and discarded, which is worse than not finding them, because
nothing anywhere recorded that they had been.

**The screen shows every strand. The badge and the notification still name only the strongest.**

| | |
|---|---|
| **Where several are shown** | The front door, bounded by `MAX_THREADS_SHOWN = 3` — applied **after** the snooze filters, so a strand somebody already answered cannot spend a slot *(corrected 2026-08-17; it was applied before, and four qualifying strands with the strongest snoozed showed two)* |
| **What names each one** | `/api/session/current`, once per signature, in the background — up to `MAX_THREADS_SHOWN` naming calls of about 2.7 seconds each |
| **What composes an offer** | The leading strand only, and up to `COMPOSE_ATTEMPTS = 2` calls for it. ~~Usually nothing, because `composeOffer` returns at its own `grounds.sufficient` gate.~~ *(Struck 2026-08-17: measured, 2 of the recorded afternoon's 3 strands clear that gate. Being secondary is a ranking, not a weakness, so the gate was never going to keep them cheap — see below.)* |
| **What the poll returns** | One `suggestion`, the strongest. The response shape is unchanged |
| **What accepting one does to the others** | Ends them. `clear()` runs on session start and ambient capture stops while a session runs, so the other strands necessarily die — and the screen says so rather than implying they wait |
| **What declining one does to the others** | Leaves them where they are, and the screen says so. It buys **no quiet from the notification channel**: the next strand is promoted and may be notified about within a poll or two. `quietUntil` in `service-worker.js` is written only by the notification's own "Not now" *(stated 2026-08-17 — see below)* |

The asymmetry is this ADR's own argument, applied one step further. Interruption is the expensive
failure and `docs/PRODUCT_PRINCIPLES.md` §13 requires notifications be actionable and sparse — but
**Home is a place a person chooses to visit**, so more information there is not an interruption.

The comment this replaces read *"One origin at a time on purpose: an offer that names two sites is
asking the person to do the disambiguating."* Half of that had already stopped being true — a thread
has been multi-origin since `topics.ts` replaced per-origin detection, and *"across 3 sites"* is the
sentence that ships. The half that survives is about an **offer**: a notification naming two subjects
and asking which is making somebody disambiguate. Showing several named strands on a page they opened
is a different act, and nothing here multiplies notifications.

### Why composing is gated on leadership, and what turning one down still does not buy

*(Added 2026-08-17, after the first version of this section shipped.)*

The first version composed an offer for every named strand, on the reasoning in the struck table row
above. Both halves of that reasoning were wrong, and the second one cost something.

**The gate does not keep secondary strands cheap.** `grounds.sufficient` wants one intent ground and
two investment ones. A strand that was searched for, read for two minutes and followed across three
sites clears it whether or not it is the strongest — two of the recorded afternoon's three did.

**And a composed offer is notification-ready.** The poll returns `kind: 'work-offer'` for whichever
strand leads, and the service worker turns exactly that into a `requireInteraction` notification. So
a strand that had never been advertised was arriving already holding an offer, and the first poll
after somebody turned the leading strand down at the front door interrupted them about a different
subject. Measured, on this ADR's own three-strand fixture.

So `composeOffer` runs for the leading strand only. The property that restores is worth naming: **a
strand cannot be ready to interrupt somebody before it has been advertised.** A strand that leads
later is composed then, one poll behind, exactly as it was before the screen showed several. Naming
is unaffected and still runs for all three, because a name is what the front door renders and it
interrupts nobody.

**What that does not fix, and what it would take.** The front door's "Not now" buys no quiet from the
notification channel at all. It snoozes one signature; the next strand is promoted, composed a poll
later, notified about a poll after that — roughly a minute, on an afternoon whose strands do not
share a site. `quietUntil` is written in one place in `extension/src/service-worker.js`, inside the
notification's own "Not now", and no server-side decline reaches it.

That is behaviour from before this section existed rather than something it introduced, and it is not
being narrowed here, because narrowing it is a **product decision nobody has taken**: making one
front-door decline silence the others for `SNOOZE_MS` would contradict what the screen tells the
person in as many words — *"Turning one down on its own leaves the others where they are."* Both
readings are defensible and only one of them can be true, so it is recorded as an open question
rather than settled in a review. §13's honest limit already names notifications as the place this
erodes first; this row is that limit with a specific path attached to it.

**What it costs, stated.** `detectWork` is now `detectThreads(…, 1)[0]`, which is not identical to
what it was: a strongest thread that failed the engagement bar used to mean *nothing*, even when a
weaker thread cleared it. Filtering before ranking is the honest order and can only return a thread
that passed the bar, so the widening is exactly the afternoons where the top-ranked strand was
skimmed and a real one sat behind it. That is the cheap direction by this ADR's own asymmetry, and it
is recorded rather than left to be found.

## Why the buffer is memory and not a table

`ObservationEvent` means *part of the record of a session*. Writing ambient observations there would
make the ledger mean *everything Propositum ever saw* — a different product, and a worse promise.
Provenance would also become unrecoverable: nothing would distinguish what a person chose to have
watched from what was seen anyway.

So ambient observations are held in memory, die with the process, and are discarded unless accepted.
On accept they become ordinary `ObservationEvent`s through the one ledger door, carrying
`attested.ambient = true`, because *"seen before you started"* is provenance the timeline must not
hide.

`clear()` drops a reference. Node may hold the memory until it collects, and this does not claim to
erase — only to forget. The stronger guarantee is the one above it: none of it was ever written down.

## What this costs, stated plainly

- **An install-time warning.** Chrome says *"Read and change all your data on all websites."* That
  is accurate, and it is the price of the feature.
- **A weaker guarantee**, traded from structural to behavioural. Three enforcement points and a test
  are not the same as Chrome refusing.
- **False positives are the expensive failure.** A missed detection costs a suggestion nobody sees.
  A false one interrupts someone reading the news and teaches them to ignore the feature. The tests
  are weighted accordingly — most of them pin what must *not* fire.
- **A reading built from ambient events is thinner**, because ambient carries no page text. Honest,
  and worth saying in the interface rather than discovering.

## What is deliberately still true

- **Detection never starts a session.** Only a human act does, exactly as `SessionPhase` requires.
- **Observation still never executes actions.** The two ledgers stay disjoint.
- **Interpretation still happens once**, when the person hands over.
- **Continuation is still out of scope.** Detection changes how a session *starts*; it does not
  extend what happens after a shift ends.

## Revisit when

- **A named thread is wrong in a way that matters.** Naming is live; what is untested is how often
  it is right. `subject@1` is one prompt seen by one person, and the failure to watch for is a
  confident name for the wrong subject — the one case the `confident` flag exists to prevent and
  cannot guarantee.
- **A false positive is observed in real use.** The thresholds are guesses, set before any real
  browsing existed. They are constants in one file for that reason.
- ~~**Anyone proposes writing ambient observations to disk.** That is not a tuning change; it is a
  different decision and needs its own ADR.~~ **Fired 2026-08-18 —
  [ADR-0015](0015-measuring-loudness-and-saving-an-afternoon.md).** Two things now write off this
  path: `npm run capture:afternoon`, a hand-run command that saves the buffer to a JSON fixture, and
  `offer_tally`, a durable per-day count of how often Propositum spoke. ADR-0015 argues them
  separately, because only one of them is a profile and the product cannot make that one. The trigger
  is left struck rather than deleted, and it is worth reading twice: **the code landed before the
  ADR did**, with the argument living in a docblock, which is the location this bullet exists to move
  it out of.
