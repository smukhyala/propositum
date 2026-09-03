# 04 — The half-day of things that are just wrong

**Status:** ~~not started~~ ~~done 2026-08-26, except item 7, which is the owner's.~~ ~~Two left,
2026-08-27: item 7, which is the owner's, and item 10, which was added the same day and is not a
quick fix at all — it is here so nobody rediscovers why it cannot be one.~~ **One left, 2026-09-03:
item 7, which is the owner's. Item 10 was built the day
[ADR-0033](../adr/0033-a-late-tick-is-a-slept-machine.md) was accepted — it was never a quick fix
and it never became one; what changed is that the signal it said nothing supplied turned out to be
in the sweeper's own timer.**
**Blocked by:** nothing at all.
**Blocks:** nothing.

It took rather longer than half a day, and the reason is item 4: the file said
*shift* leaked onto four screens and it had leaked onto **twelve**. Two other
counts here were low as well. What the fixes cost is written beside each one.

~~Ten~~ **eleven** small defects, one of which fixed itself while this file was being
written, and one of which — item 10, added 2026-08-27 — turned out not to be small. None is hard, none depends on anything, and each one is
visible to the first person who uses the product. Do them when something else is
waiting on Apple or on a model run.

~~**Item 0 was added 2026-08-26** and is now the most valuable one here: an
onboarding screen was built and nothing points at it.~~ **Struck the same day —
it was fixed within the hour.** `src/app/page.tsx` now computes `welcomeState()`
and links `/welcome` *(now `/first-run`)* from the front door when setup is unfinished. Item 0 below
is kept struck rather than deleted, because a todo that silently loses its most
valuable item reads as though it was never there.

---

## Is this already done?

Run all of these. Each line that produces output is a job still to do.

```bash
# 0. the setup screen exists and nothing links to it (route renamed /first-run 2026-08-30)
grep -rn '/first-run' --include='*.tsx' src/app src/ui | grep -v 'src/app/first-run/'

# 1. no route-level boundaries
find src/app -name 'loading.tsx' -o -name 'error.tsx' -o -name 'not-found.tsx'

# 2. README step 1 describes a flow that was deleted
#    NOTE: strikethrough keeps the old words on the page on purpose, so a plain
#    grep matches whether or not this is done. Check for the ~~ instead.
grep -n '~~Create a project and approve the sources' README.md

# 3. two verbs for one act
grep -rn 'Hand this over\|Take over\|Handing over' --include='*.tsx' src/ui src/app

# 4. undefined words in user copy
grep -rn 'this shift has no document\|Read the claims below' --include='*.tsx' src/ui

# 5. the extension id is not pinned
grep -c '"key"' extension/manifest.json
```

~~As of 2026-08-26: (0) **returns `src/app/page.tsx` — done**; (1) returns
nothing, so there are still **no route boundaries at all**; (2) matches the
struck form, so it is **done**; (3) and (4) still hit; (5) returns `0`.~~

**Re-run later the same day, after the work below:** (0) hits — done; (1) returns
**three files**, `loading.tsx`, `error.tsx` and `not-found.tsx` — `error.tsx` was
already there when this file was written, which the original note missed; (2)
matches the struck form — done; (3) still hits `Hand this over` and `Handing
over…`, which is now the *correct* answer rather than a job, and no longer hits
`Take over`; (4) returns nothing; (5) still returns `0`, and that one is
deliberate.

**~~Seven left, not nine.~~ ~~One left, and it is item 7.~~ ~~Two left, 2026-08-27 — item 7 and item
10.~~ One left again, 2026-09-03 — item 7.** Everything struck below
is struck rather than deleted, because a checklist that silently loses its
finished items reads as though they were never on it.

### Two counts in this file were wrong

Both were found by doing the work, and both are the same shape — a number written
from the greps at the top rather than from the code.

- **Item 4 said four sites. There were twelve**, across five files, including the
  front door's count sentence and both `Back to the shift` links on the
  confirmation screen.
- **Item 8 said one misattribution. There were two** — ADR-0001 and ADR-0023 both
  credit `README.md` with a sentence that has never been in it.

---

## What you have to do yourself

**Nothing external**, with one exception:

- **Pinning the extension `key`** means generating a keypair and pasting the
  public half into `extension/manifest.json`. That is a command, not an
  application — but decide it once and never change it, because the id is
  derived from it and `PROPOSITUM_EXTENSION_ID`, the loopback `Origin` check and
  anybody's existing install all follow it. `manifest.json`'s own comment says
  *"REPLACE before any real install — this is a placeholder."*

---

## The work

0. ~~**Link `/welcome`.**~~ **Done 2026-08-26.** `src/app/page.tsx` calls
   `welcomeState()` and links the route when setup is unfinished, so a person
   with nothing set up no longer lands on *"Go and read about something for a
   while."* with no way forward. What is still worth checking when you are next
   in that file: the link is one row among several on the front door, and the
   screen it points at is the only thing standing between a fresh clone and
   nothing working at all.

1. ~~**Add `loading.tsx`, `error.tsx` and `not-found.tsx`.**~~ **Done
   2026-08-26.** Two of them, in fact: `src/app/error.tsx` already existed when
   this file was written, with a `SchemaBehindError` branch that names the one
   failure it can recognise and refuses to guess at any other. What landed is
   `src/app/loading.tsx` — no spinner and no estimate, because a progress bar
   over an unknown wait is an invented number — and `src/app/not-found.tsx`,
   which reuses the primitives so it reads as the same product as the bespoke
   `Missing()` on the shift screen.

   Worth knowing: `not-found.tsx` is **reached by the product**, not only by
   mistyped URLs. `notFound()` already had three callers on paths a person
   walks. `tests/route-boundaries.test.ts` renders all three screens and asserts
   those callers still exist, because a boundary reached only by typing mistakes
   is decoration and should be distinguishable from this.

2. ~~**Fix README step 1.**~~ **Done 2026-08-26** — struck and dated in place. It says *"Create a project and approve the sources
   Propositum may see."* Project creation was deliberately removed:
   `createProject` in `src/server/actions.ts` is private and called only by
   `startFromSuggestion` and `splitIntoNewProject`. The front door's own comment
   quotes the brief that killed it — *"I don't want the user to define the
   projects themselves."* Strike and date it; do not overwrite.

3. ~~**Settle on one verb for the handover.**~~ **Done 2026-08-26 — the verb is
   *hand over*.** The person is the subject, the way they are in all five
   consumer verbs. In the app that was one label: the agreement's primary button
   went from `Take over` to `Hand over`, and `Hand this over`, `Handing over…`
   and `Hand over again` were already right. The component followed —
   `TakeOver` in `src/ui/reading.tsx` is `HandOver`.

   The ruling is in `CONTEXT.md` twice: a banned-table row, and a twelfth entry
   under *Deliberate overrides of the founding brief*, because
   `docs/FOUNDING_BRIEF.md` lists *Take over* in its approved vocabulary and the
   brief's own rule is that the later document wins and must say so. README step
   3 and `docs/MVP.md` step 4 are struck and dated.

4. ~~**Define or remove `shift` in user copy.**~~ **Removed 2026-08-26. There
   were twelve of them, not four**, across `src/ui/agreement.tsx`,
   `src/ui/reading.tsx`, `src/ui/confirm.tsx`, `src/app/page.tsx`,
   `src/app/projects/[projectId]/page.tsx`, `src/app/shifts/[contractId]/page.tsx`
   and the confirmation screen. No new ruling was needed: `CONTEXT.md`'s `Shift`
   entry already says **Consumer: While you were away**, and the word had simply
   never been held to it.

   The front door's sentence is the one worth reading. *"Two shifts finished
   while you were away"* became *"Propositum finished work on two projects while
   you were away"* — the noun is gone rather than replaced, which also retired
   `countWordCapped`, whose only caller it was.

5. ~~**Define or remove `claims`.**~~ **Removed 2026-08-26**, in two places
   rather than one — the second was *"The claims they were meant to support are
   still here"* on the same screen. `CONTEXT.md`'s `SessionClaim` entry says
   **Consumer: internal**, so the fix was to name the sentences instead of the
   rows.

6. ~~**Delete or justify `/start`.**~~ **Justified 2026-08-26, and written down
   in the page's own docblock.** The condition this item was waiting on has
   happened: [`02`](./02-phone-thread.md) landed, and
   `src/domain/conversation/messages.ts` now links `/start?thread=…` from the
   thread on a person's phone. With `extension/src/panel.html` that is two
   callers, both reached by somebody who is not looking at the app, which is
   exactly what the front door cannot serve. Deleting it would take the accept
   path off both surfaces.

7. **Pin the extension `key`.** **Still open, deliberately, 2026-08-26 — this
   one is the owner's.** It is a command rather than an application, but it
   permanently fixes the extension id and therefore invalidates any install that
   already exists, including the working development pairing on the machine this
   was written on. Doing that on somebody's behalf is not a quick fix, it is a
   decision with a blast radius, so it is left named rather than made.
   `manifest.json`'s own comment still says *"REPLACE before any real install —
   this is a placeholder."*

8. ~~**Fix the ADR-0023 misattribution.**~~ **Done 2026-08-26, and there were
   two.** `docs/adr/0001-worker-runtime.md` makes the same mistake, and it
   matters more there: that ADR's argument is about *where* the protection lived,
   and a sentence in a worker docblock is read by somebody already editing the
   worker while a sentence in the README is read by somebody setting up. Those
   are different people, and the second was never warned at all. Both struck and
   dated in place; the sentence is at `scripts/worker.ts:11`, with a copy at
   `scripts/dev.ts:9`.

9. ~~**Check the four-verbs table.**~~ **Done 2026-08-26.** Struck and dated in
   place, keeping the section. Its consumer-language table also gained the two
   rulings from items 3 and 4, so the principles and `CONTEXT.md` now say the
   same thing about the same words.

10. ~~**`machine_slept` is still an unwritable `CaptureGap` reason.**~~ **Built 2026-09-03 —
    [ADR-0033](../adr/0033-a-late-tick-is-a-slept-machine.md).** *(Added
    2026-08-27, found while wiring the gap sweeper.)*

    **What this item got right, and it is most of it:** elapsed silence cannot
    tell the two apart, a caller could not fix that, and the fix was not going
    to be half a day. **What it got wrong is where it looked.** It sent the
    reader to the menu-bar app or the extension for a signal, and the signal was
    in the file the item was written beside: the gap watch runs a
    `setInterval`, a suspended machine does not service one, and a dead service
    worker does not stop the app process being scheduled. So a tick that arrives
    two whole periods late is proof nobody was watching, and it is a different
    signal from silence rather than a cleverer reading of the same one.

    The menu-bar app's `NSWorkspace` wake notification is refused in that ADR
    rather than deferred — it is the better signal and it costs a second ambient
    sensor in that binary, an inbound endpoint for a caller that is not the
    extension, and a macOS-only dependency, to buy about thirty seconds of
    precision on an interval that is minutes long.

    The grep below now returns `src/server/gap-sweeper.ts` and the two tests
    beside it. **The last paragraph of this item still stands**: with no signal,
    the gap is recorded with the reason that is true rather than with a guess,
    and that is exactly what happens on the first tick after a restart, when
    the detector has nothing to compare against.

    ```bash
    grep -rn "machine_slept" src/
    ```

    Two of the four reasons used to be unreachable because `sweepForGap` had no
    caller. It has one now — `src/server/gap-watch.ts`, armed by `startSession`
    and disarmed by `endSession` — so `service_worker_terminated` is writable.
    **`machine_slept` is not, and a caller cannot make it one.**

    The reason is not wiring, which is why this is a separate item rather than a
    loose end on the last one: from the app's side the two are *identical*.
    Elapsed silence is all there is, and a slept machine and a dead service
    worker both produce exactly that. Telling them apart needs a signal nothing
    currently supplies — a wake notification from the OS, or the extension
    reporting on revival that it was terminated rather than that time passed.

    Both of those are the menu-bar app's ([`01`](./01-menu-bar-app.md)) or the
    extension's, so **this is not the half-day job the rest of this file is**.
    It is listed here because the alternative is that a reader runs the grep,
    finds a reason no row can carry, and has to rediscover why.

    Until then the gap is recorded with the reason that is true — the extension
    went quiet — rather than with a guess about why, which is the correct fail
    direction and is worth keeping if this is ever built.

---

## Done when

- `npm test` and `npm run typecheck` are green. **They are: 77 files, and
  `npm run build` too.**
- The five commands under *Is this already done?* return what a finished repo
  returns. **Four of five do; the fifth is item 7 and is the owner's.**
- ~~Each fix has a test that would have failed before it. `tests/canonical-terms.test.ts`
  and `tests/handover-honesty.test.ts` are the right homes for items 3, 4 and 5.~~
  **`tests/canonical-terms.test.ts` was the wrong file** — it is about typo
  merging in `src/domain/detection/topics.ts` and has nothing to do with consumer
  copy. Items 3, 4 and 5 got a new guard instead,
  **`tests/consumer-vocabulary.test.ts`**, which is the sixth one in `AGENTS.md`'s
  table. It extracts what a person can read out of `src/ui`, `src/app` and
  `extension/src/panel.html` — JSX text with its interpolations rewritten, the
  literals inside those interpolations, prose attributes, and free-standing
  sentences — and fails on *take over*, *shift*, *claim* and *task*. Item 1 got
  `tests/route-boundaries.test.ts`. `tests/handover-honesty.test.ts` and
  `tests/agreement-honesty.test.ts` both went red on the copy change, which is
  what they are for, and were updated.

---

## What this does not cover

- **Onboarding.** None of this adds a welcome screen, a tour or a first-run flow. *(One exists since 2026-08-30 — todo 09 built `/first-run` and the tray window — but not through this file.)*
  That is [`01`](./01-menu-bar-app.md), and it is not a small job.
- **Responsive layout.** The app is a single desktop column with no header, no
  navigation and two padding breakpoints. That is a deliberate register, not an
  oversight, and changing it is a design decision rather than a fix.
- **Item 7.** Named, argued, and left for the owner. See above.

---

## Found while doing this, and worth its own attention

Two defects that no item here predicted. Both are recorded where they live; they
are listed again because a todo file that closes without mentioning what it
disturbed is not a record of what happened.

1. **`tests/reachability.test.ts` was blind to twenty-five lines of
   `src/app/projects/[projectId]/page.tsx`.** Its comment stripper — a third copy
   of the naive regex `tests/support/strip-comments.ts` was extracted to
   replace — treated `/` followed by `*` in a JSX example URL as opening a block
   comment, and swallowed everything to the next real close marker. A whole
   component render was invisible, and `callersOf` reported it had no callers
   while the screen rendered it. **This fails silently in the direction that
   matters**: a needle that vanishes makes `not.toEqual([])` go red and get
   noticed, and makes a `toEqual` or a deferred-block assertion go green.

   Fixed at the call site with `&#42;` and a comment, and a new assertion —
   *nothing a stripper eats is a component render* — catches the class. The
   stripper itself is unchanged and its limit is now stated: the shared scanner
   is **not** a fix, because JSX text is not a string, and measured on the same
   file it lost more lines than the naive one did.

2. **`normalise` did not fold `\r\n`.** A prose line survived a stray carriage
   return by accident, and a heading, a list item, a table row and every line
   inside a fence kept theirs — so the same words arriving from a Windows file
   produced a different string, a different `contentHash`, and drift against work
   nobody had touched. Reachable before the file import by pasting from a Windows
   editor. Fixed in `src/domain/document/normalise.ts` with the cost stated.

   While pinning it, a **third** thing turned up: that file's claim that
   `Intl.Segmenter` *"knows about abbreviations and decimals"* is too strong. It
   splits `Dr. Alves` and `No. 7`, and the existing test happened to use the
   spellings that survive. The claim is struck and narrowed with the measurements
   beside it, and the real behaviour is pinned. **Not fixed**, on purpose: the
   failure makes the unit smaller, which is the safe direction, and `linesOf`
   hands out offsets that live changesets already point at.

3. **A gap shorter than the grace period plus one sweep is never recorded at
   all.** *(Found 2026-09-03, doing item 10.)* The service worker dies at 0 and
   revives at 80 seconds. `HEARTBEAT_GRACE_MS` is 75 seconds and the sweep ticks
   every 30, so the tick at 90 seconds sees a heartbeat from 80 and reports
   nothing — an outage longer than the grace period leaves no row. Nothing in
   the product is wrong about it; the timeline simply reads as continuous over a
   minute and a half nobody watched.

   **Not fixed, and it is not a quick fix either.** Closing it means the
   extension reporting on revival that it was gone, which is a message the
   transport does not have and an extension change on a buildless file that has
   to pass Web Store review ([`05`](./05-chrome-web-store.md)). ADR-0033's sleep path
   does not have this defect — a suspension is recorded from the suspension
   itself rather than from silence still being visible at the next tick, which
   is the same bug in the shape it would have taken there.
