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
| **What declining does** | Drops the observations and snoozes the origin for an hour. |

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
