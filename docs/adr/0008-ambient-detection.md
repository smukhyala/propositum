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
| **What it records while watching** | Metadata only — cleaned URL, title, dwell, scroll. Never page text. |
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
- **Anyone proposes writing ambient observations to disk.** That is not a tuning change; it is a
  different decision and needs its own ADR.
