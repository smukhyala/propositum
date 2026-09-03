# ADR-0033 — A late tick is a slept machine, and the wake notification is refused

**Status:** accepted · 2026-09-03
**Depends on:** [ADR-0002](0002-observation-capture.md) — the heartbeat transport and the `Origin`
pinned to the extension id, which is what makes *the observer is on this machine* structural rather
than assumed
**Beside:** [ADR-0023](0023-the-tray-app-owns-the-runtime.md) — its *Revisit when* trigger
*"a second sensor is proposed for this process"* is what the rejected option below fires. Nothing
that ADR decides changes; the trigger is answered rather than left open
**Answers:** [`docs/todo/04`](../todo/04-quick-fixes.md) item 10, which recorded the mechanism
problem on 2026-08-27 and said a caller could not fix it. That was right

## Context

**Until today every `CaptureGap` reason named something Propositum observed. `machine_slept` names
something it infers**, from the lateness of its own timer, and the inference has two false positives
with names. That sentence is the cost and it is at the top because the rest of this document is
about why the trade is worth taking.

`CaptureGap` has four reasons. `service_worker_terminated` has been writable since the gap sweeper
got a clock on 2026-08-27; `permission_revoked` and `transport_disconnected` are written where they
are observed. `machine_slept` was writable by nothing, and `docs/todo/04` item 10 said why in one
sentence: **from inside the browser a slept machine and a dead MV3 service worker are the same
event.** Both produce *no heartbeat for N minutes*. No amount of wiring separates them, because the
signal being wired is the ambiguous one.

That is not cosmetic. `README.md` publishes it, `CONTEXT.md` gives the reason a consumer string —
*"I stopped seeing your work from 2:10 to 2:41 (your Mac slept)"* — and the eval corpus leans on the
sentence: `partnership-messy` seals *"A 34-minute stretch is missing from the record, so part of
what they did is unknown."* A person who closed their laptop at lunch was being told, in the
product's own words, that our software fell over. **A gap attributed to the wrong cause is a worse
artefact than a gap with no cause**, because it reads as knowledge.

## Decision

**The app process's own timer is the second signal. A sweep tick that arrives more than two whole
periods late is proof this process was not being scheduled, and a process that was not being
scheduled was not watching anything.**

`src/server/suspension.ts` holds the detector and `src/server/gap-watch.ts` samples it once per
tick, before anything is awaited. When it fires, `sweepForGap` writes a `captureGap` with reason
`machine_slept` for the window; when it does not, nothing about the existing behaviour changes.

**Why this separates the two causes and elapsed silence does not.** A dead service worker does not
stop the app process running — Chrome kills its own worker, not our timer. A suspended machine stops
everything. So silence is the extension's clock and it is ambiguous; the lateness of our tick is
ours and it is not.

**Why the inference is sound at all.** *"We were suspended, therefore capture stopped"* holds only
if the observer is on this machine, and that is structural rather than assumed: the extension posts
to `127.0.0.1` and the transport pins the `Origin` to the extension id
([ADR-0002](0002-observation-capture.md)). There is no arrangement of this product in which the
browser being watched is somewhere else.

**Four properties of the shape, each of which was a way to get this wrong.**

1. **The reason is decided before the row is written, never after.** An `ObservationEvent` is
   append-only, so a design that recorded a gap on silence and then relabelled it on waking would
   need an `UPDATE` the ledger refuses. It is the *Two rows per action* problem in a different
   layer, and the answer is the same: two facts, two rows. A machine that slept and woke to a
   service worker that never came back produces `machine_slept` and then, one grace period later,
   `service_worker_terminated`. Both are true, neither amends the other.
2. **The sleep gap is not read off the heartbeat, so it does not race it.** On waking, our timer and
   Chrome's alarms both fire and the order is unpredictable. A design that waited for silence to
   still be visible at the next sweep would lose most real sleeps to a heartbeat that arrived
   first — `machine_slept` would be writable in principle and rare in practice, which is the
   dishonest version of this change. `noteSuspension` is a separate input to the store.
3. **The recorded window never contradicts a row the ledger already holds.** The detector knows only
   that the process stopped somewhere inside the interval before the late tick, so the store clamps
   the start to the last heartbeat. If we heard from the extension twenty seconds in, the gap begins
   there.
4. **The same minutes are not reported twice.** `accountedThroughMs` is what the store has already
   said about the quiet; the silence sweep measures from the later of that and the last heartbeat.

**Nothing else moves.** No Chrome permission — and none would help, because Chrome has no API that
reports the machine slept. No `src-tauri/` change, no new endpoint, no new transport, no schema
change, no new closed-set member. The whole of it is one small module, one method on the session
store, and a `Suspension` passed to a sweeper that was already there.

## Rejected alternatives

**A sleep/wake notification from the tray app, delivered to the gap sweeper.** The option this ADR
was expected to take, and it is the better signal on the merits, so it is worth stating at full
strength. `NSWorkspace.willSleepNotification` and `didWakeNotification` are AppKit notifications on
the workspace's own notification centre. They need **no TCC permission and no entitlement** — they
are not in the class of thing [ADR-0023](0023-the-tray-app-owns-the-runtime.md)'s prohibition 1
guarded and [ADR-0025](0025-computer-use-beyond-the-browser.md) spent. They smuggle in none of
ADR-0025 §3's list: no shell, no `osascript`, no filesystem read, no keychain, no enumeration of
what is running. They fire at the *actual* sleep and wake instants rather than at a tick boundary,
they are unambiguous where the timer is inferential, and the tray already supervises both children
and already talks to `127.0.0.1:3117`. It is perhaps two afternoons.

Refused, on three costs that are each larger than what it buys:

- **It is a second sensor in the tray process**, which is ADR-0023's own *Revisit when* trigger and
  its prohibition 4 — struck for computer use, and struck for *"only while acting under a ratified
  contract, never ambiently"*. A sleep subscription is ambient by construction: it runs whenever the
  tray runs, which is always. Every previous widening of that binary was bought for a named caller
  inside a ratified run. This one would be the first that is not, and the precedent is worth more
  than the precision.
- **It needs an inbound endpoint that accepts a state assertion from something that is not the
  extension.** The capture routes have four transport controls and all four are shaped around one
  caller ([ADR-0002](0002-observation-capture.md)). A second caller means a second admission story
  for a POST that changes what the person is told about their own afternoon, and *"the tray said
  so"* is a claim no page can make but a local process can.
- **It only exists on one platform and only in one mode.** The tray is macOS, and the product is
  developed, tested and run in CI as a checkout with two terminals and no tray at all. A signal that
  is absent in the configuration everybody actually works in is a signal nobody sees fail.

What is bought against that is roughly thirty seconds of boundary precision on an interval that is
minutes long by construction — a gap shorter than `HEARTBEAT_GRACE_MS` is not recorded at all.

**A wall-clock against monotonic-clock divergence.** The other cheap option, and the one this
decision was expected to reduce to. Its correctness depends on whether the platform's monotonic
clock counts time the machine was suspended — `CLOCK_MONOTONIC` on Linux does not, and libuv's
darwin implementation is the load-bearing detail. **This document does not know that answer**, which
is precisely the argument: a signal whose meaning inverts on an unverified platform detail is worse
than one that does not care. Tick lateness is correct under both readings, and it also needs one
clock rather than two.

**Reading `chrome.idle`'s `locked` state.** Free — ADR-0002 already holds the `idle` permission — and
a Mac usually does lock when it sleeps. Refused because it answers a different question: a screen
lock is not a suspension, a screensaver reports the same state, and a locked machine can be a
machine still working. It would attribute a coffee break as sleep, which is the failure mode this
whole item exists to avoid.

**The extension reporting on revival that it was terminated.** Named in `docs/todo/04` item 10 as the
other candidate. A revived service worker can tell that time passed and cannot tell why — it is the
ambiguous signal again, read from the side that has less information.

**Leaving it unwritable, and recording the refusal.** The honest outcome if the signal cost anything
real, and the shape [ADR-0027](0027-a-sealed-bundle-and-where-the-state-moves.md) §4 uses for the
update feed. Not taken because the signal turned out to cost nothing: no permission, no sensor, no
endpoint, no platform. Refusing a free correction of a false statement would be the wrong kind of
conservatism.

## What this costs

**A reason that used to be a report is now an inference, and it is wrong in two named ways.**

- **A stopped process reads as a slept machine.** `kill -STOP` on the app for longer than the
  tolerance produces exactly a late tick, and
  [ADR-0025](0025-computer-use-beyond-the-browser.md) §2's kill-switch verification is that command.
  The gap is real in both cases — nothing was watching — but the reason names the wrong cause.
- **A wall clock stepped forward reads as a slept machine.** A correction larger than a minute, from
  a dead clock battery or a manual change, records a gap that did not happen. A step backwards is
  ignored rather than read as negative time.

**A timing constant is now load-bearing for the ledger's contents.** `GAP_SWEEP_INTERVAL_MS` used to
decide only how quickly a gap was noticed. It now also derives `SUSPENSION_TOLERANCE_MS`, so
changing it changes what the person is told about their afternoon. That is why the tolerance is
derived from the interval rather than typed beside it.

**The app process's liveness is now an input to the observation record.** Not a sensor — it observes
nothing about the person, the machine's contents or what is running, and it can only ever produce an
*absence* of knowledge. But it is the first thing in the ledger that comes from Propositum watching
itself rather than watching a browser, and the next proposal in that direction will find the
argument half made.

**And what it does not fix.** A gap whose cause is genuinely unknown is still recorded as
`service_worker_terminated`, because that is the observation we actually made and there is no
`unknown` member to write instead. Adding one is a schema change plus a consumer string plus a
sentence about what Propositum does not know, and it is a different decision from this one.

## What holds the line now

| | |
|---|---|
| `tests/capture-api.test.ts` | That silence *alone* never reaches `machine_slept` — six sweeps of pure silence, and it appears in none of them. That is the assertion that keeps this from becoming a guess |
| `tests/capture-api.test.ts` | The tolerance: an on-time tick, and lateness one millisecond inside the threshold, both claim nothing |
| `tests/reachability.test.ts` | `createSuspensionDetector` has the gap watch as a caller, and `noteSuspension` has **exactly one** — the sweeper. A second author of the reason on a row nobody can `UPDATE` is the defect |
| `tests/append-only.test.ts` | Unchanged, and that is the point: the reason is decided before the write because there is no other way to decide it |
| `src/server/suspension.ts` | Its docblock states the two false positives. A guard whose limit is unstated reads as a stronger promise than it is |

**Where this could still go wrong.** Nothing tests the detector against a real suspension, and
nothing can — a test that sleeps the machine is not a test. What is pinned is the arithmetic and the
separation; what is taken on faith is that a suspended macOS does not service a `setInterval`, which
is true and is not asserted anywhere in this repository.

## Revisit when

- **A `machine_slept` row is seen on a machine that did not sleep.** Then the tolerance is too small
  or the false-positive list is too short, and the first thing to check is whether something is
  stopping the app process.
- **`GAP_SWEEP_INTERVAL_MS` is changed.** The tolerance follows it, and so does the slop on the
  start of every recorded sleep.
- **Anything proposes the tray sleep/wake subscription again.** It is the better signal and the
  three costs above are what it has to answer — the sensor precedent first.
- **The app process stops being co-resident with the browser it watches.** A remote or containerised
  arrangement makes *"we were suspended, therefore capture stopped"* false, and this becomes the
  wrong inference rather than an imprecise one.
- **Anybody proposes an `unknown` gap reason.** It is the honest answer to the paragraph at the end
  of *What this costs*, and it is a schema change with a consumer string attached.
