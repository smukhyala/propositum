# ADR-0015 — Measuring how loud Propositum is, and letting a person save their own afternoon

**Status:** accepted · 2026-08-18
**Fires:** [ADR-0008](0008-ambient-detection.md) — *Revisit when*, third bullet: *"**Anyone proposes
writing ambient observations to disk.** That is not a tuning change; it is a different decision and
needs its own ADR."* Somebody proposed it, it shipped, and this is that ADR arriving after the code
rather than before it — which is itself a finding and is recorded as one below
**Amends:** [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) — *"**In memory only.** It
never reaches the database. It dies when the app process does."* **Struck and dated in place, not
deleted.** The observations still never reach the database; a per-day count now does, and a reader
has to be able to see which half moved
**Depends on:** [ADR-0008](0008-ambient-detection.md) — the ambient buffer, its two bounds, and the
refused row this whole document is measured against ·
[ADR-0013](0013-authored-labels-and-exit-type.md) — the three signals that made the debug endpoint's
blindness worth fixing
**Research:** [`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §6 (the
false-positive economy), §10.5 (the three measurements, named as *"all derivable from data the
system already has, and none requiring a model"*)

---

## Why one ADR for two things

Two artefacts landed together and they look unrelated: a table of counts, and a command that writes
a JSON file. They are one decision because they are the **only two durable things** that have ever
come off the ambient path, and the argument for each is the same argument — *what makes this not the
profile ADR-0008 refuses* — reaching two different answers.

- The **tally** is durable and holds no subject, so it is not a profile by construction.
- A **saved afternoon** is a profile in full, and is acceptable only because the product cannot make
  one. A person can.

Keeping them in one document means the second cannot quietly borrow the first's argument.

## What ADR-0008 actually refuses

One sentence, from `src/server/ambient-store.ts`, quoted in ADR-0008:

> a durable row saying "Propositum thought you were job-hunting" about an offer NOBODY ACCEPTED is
> exactly the profile this buffer refuses to become.

Every load-bearing word in it is about a **subject**. The row is refused because it says what the
offer was about, and says it about a person, and keeps saying it. That is the test both artefacts
below are held to.

## Decision 1 — `offer_tally`: a durable count, and no column a subject could sit in

**What it holds.** One row per local calendar day. Five values: the date, distinct minutes in which
the extension had something to report while no session was running, suggestions put in front of the
person, suggestions declined, and suggestions found but cut by the display bound. Four integers and a
date.

**Why it exists.** `docs/PRODUCT_PRINCIPLES.md` §13 states the hole in its own words: *"the other
half is enforced by nothing. The grounds threshold is a floor on WHEN Propositum may offer, not a
ceiling on how often it may speak, and there is no metric anywhere that would catch an offer rate
creeping upward."* The bar was then lowered twice inside two days — `DEEP_READ_MS` from 90s to 60s,
and a fourth investment ground — with nothing in the repository that would have shown whether either
was right. A product that can get louder and cannot notice is the failure this closes.

**Why it does not become the refused row.** *"Four suggestions in forty observed minutes on the
18th"* names no work, no site and no subject. The refused row names one in its first six words. The
distinction is held structurally rather than by anybody remembering: there is no term, signature,
origin, title, URL or id column, `countQuietly` is typed to accept integers only, and
`tests/eval.test.ts` asserts the column list and the argument list rather than trusting either.

**Why a day bucket, which is the one genuinely new durable fact.** A lifetime total was considered
and rejected: it cannot show a change over time, and the question is precisely whether a rate is
creeping upward. A trend needs buckets, and a day is the coarsest bucket that can show one. What that
newly records is **which days this person browsed with the extension running, and roughly how much**.
That is real and it is the price. An hour bucket would begin to sketch when in the day somebody
works, which is a fact about a person rather than about the product, and no version of the creep
question needs it.

**One field was removed the same day it landed, and the removal is the point.** The table shipped
with an `updatedAt DateTime @updatedAt` — copied in from the model above out of habit, because every
other table has one. A real row read back said `2026-08-18|1|6|4|0|1787090190867`: a millisecond
instant, *14:56:30 local*, rewritten on every observed minute and every offer, therefore a durable
per-day note of roughly when this person stopped browsing. Three and a half million times finer than
the hour bucket the paragraph above had already refused, in the same table, arriving through habit
rather than through a decision. Nothing read it. It is gone, and the schema carries the story where
the field used to be, because *"we did not add a subject column"* is exactly the promise that erodes
one convenient field at a time — and this one was not even a subject.

**What has no answer yet.** Nothing in the product deletes this table. It hangs off no `Project`, so
no cascade reaches it, and no button does either. `docs/SECURITY_AND_PRIVACY.md` now says so plainly
and points at the SQLite one-liner, which is a bad answer written down rather than smoothed over. It
is survivable because of what the row holds; it is still open.

## Decision 2 — `npm run capture:afternoon`: a person may write their own browsing to disk

**What it does.** Fetches the debug endpoint and writes the response, unedited, to
`src/fixtures/afternoons/<name>.json`. Every observation: the cleaned URL, the title, the dwell, the
scroll fraction, the exit type, the arrival, plus the envelope's per-origin rollup, `detectsWork`,
`detectsPause` and the grounds.

**This is a profile.** `src/fixtures/afternoon.ts` says so in those words in its own header, and the
word is not softened here either. It is the refused row and about four hundred of its friends, and a
file has no thirty-minute window and no row cap.

**Why it does not contradict ADR-0008.** ADR-0008 constrains what the **product** keeps. This is a
person writing their own browsing into their own repository. Those are different acts, and the
distinction is worth nothing unless the second one stays deliberate — which is what the mechanism is
for:

1. **No terminal, no capture.** `process.stdin.isTTY` is false for cron, for CI, for a `setInterval`
   in a worker, and for anything the app spawns. *It does not stop* a determined person under a pty,
   and is not meant to: what is being prevented is a capture nobody chose.
2. **The fixture's name typed back.** A `y` is a confirmation you give without reading. *It does not
   stop* a script feeding stdin — which is what guard 1 is for, and why they are two guards.
3. **`--i-mean-it`, and no overwriting.** The flag makes an accidental invocation exit having done
   nothing; the refusal to overwrite stops a second capture silently replacing an afternoon somebody
   had decided to keep.

And the structural half, which is the one that actually matters: **it is not a route, a button, or
anything on the app's side.** A POST that wrote one of these files would put *"save this person's
afternoon to disk"* inside the reach of the poll, the worker, and anything that got past a transport
control. It is a command in a repository, and no code path in the app or the worker mentions the
module.

**What none of the three stop.** Nothing here can tell whose browsing is in the buffer — on somebody
else's machine, the file is theirs. And committing one publishes it to everyone who can read the
repository, for as long as the history exists. Both sentences are printed at the point of use, not
only in a docblock.

**Why it was worth the price.** The only real-session fixture in the repo was made by reading the
debug endpoint's summary on a terminal and retyping it by hand (`tests/topics.test.ts`:46,
*"Verbatim from `/api/capture/ambient/debug` on 2026-08-11"*). A hand-copy of a summary cannot
contain a field the summary omits — which is why no fixture could contain `scrollFraction`,
`exitType` or `arrival` however carefully it was typed — and §13 records what the smaller fixture
already cost: three pages standing in for twelve, with the missing nine being the ones that made
`read-around` fire.

## The endpoint widened, and that is part of this decision

`/api/capture/ambient/debug` used to answer with a per-origin rollup. It now returns the buffer's
rows whole. This hands a caller more than it did, on the most privacy-sensitive path in the product,
and it is deliberate: it is the only window into the buffer, so a signal it does not show is a signal
nobody can judge. Two transport controls a web page cannot forge still gate it, unchanged. The rows
go out **unprojected** on purpose — every drift this corrected was a hand-built projection silently
dropping a field — and the cost of that is real and is held by a test rather than by care: a field
added to `AmbientObservation` tomorrow appears in this response without anybody deciding it should,
and `tests/afternoon-capture.test.ts` turns red when the key set changes in either direction.

## What this does NOT change

**No detection behaviour.** No threshold moved. No ground was added or removed. `scrollFraction`,
`exitType` and `arrival` remain collected and unconsumed, still pinned in
`tests/reachability.test.ts`'s deferred block with per-file mention budgets. Emitting is not
consuming. `detectsWork` answers exactly what it answered the day before.

**No new permission and no manifest change.** `tests/extension-permissions.test.ts` is untouched.

## The honest limits

- **Every number is zero until somebody uses the product.** The tally measures a running installation
  and there is no backfill; the series starts the day it shipped.
- **A minute of "observed browsing" is not a minute of reading.** It is a minute in which the
  extension had something to report. Somebody staring at one page reports the same as somebody
  walking through ten.
- **The counter is best-effort and loses counts on purpose.** Every write is fire-and-forget and
  every failure is swallowed, because a counter may not cost anybody an observation, a suggestion or
  a page render. It also may not *open* a database — it writes only to a handle something else built
  — so on a freshly started app the first ambient POST can arrive before any context exists and its
  minute is lost. Bounded by the poll, which builds one within thirty seconds.
- **`strandsSuppressed` counts once per buffer, and a strand shown, declined and found again an hour
  later is counted twice.** That error raises the alarm rather than quieting it, which is the only
  direction a measurement of one's own loudness may round.
- **A saved afternoon is one afternoon.** Replay proves the capture is complete enough to reproduce
  the decision. It does not prove the fixture is representative, that the decision was right, or that
  a signal absent from a capture is absent from real browsing.
- **This ADR is late.** ADR-0008's trigger said the disk decision needs its own ADR, and the code
  landed first with the argument living in a docblock — which is the exact location the trigger
  exists to move it out of. The three preceding changes each landed their ADR alongside them. Writing
  this afterwards is a correction, not a precedent.

## Revisit when

- **Anything proposes a bucket finer than a day**, or any second temporal column on `offer_tally`.
  Both were refused here and one of them shipped anyway by accident; the next attempt should have to
  argue against this section.
- **Anything proposes reading `offer_tally` from inside the product** — to tune a threshold, to
  throttle, to decide anything. It is an instrument for a person reading `npm run eval -- --report`.
  A control loop that reads its own loudness and adjusts is a different decision with a different
  failure mode.
- **A delete path is wanted.** The open question above. A button, a retention window, or a documented
  refusal — any of the three is an improvement on silence.
- **Anything proposes capturing an afternoon from inside the app**, on a schedule, or without a
  terminal. That undoes the whole of Decision 2 and is not a tuning change.
