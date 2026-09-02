# 11 — A hold that must prove it holds

**Status:** not started — **decided, not built.**
**Decided by:** [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md), accepted 2026-09-01
**Blocked by:** nothing in code. Item 2 below is a stop-the-line verification: if it fails, this
file closes by reopening the ADR, not by building around the failure.
**Blocks:** nothing.

## Is this already done?

```bash
# 1. the scope
grep -rn 'calendar.app.created' src/
# 2. the noun
grep -rn 'CalendarHold' src/
# 3. the only calendar endpoint src/ may currently name
grep -n 'calendar/v3' src/server/calendar.ts
```

**As of 2026-09-01, greps 1 and 2 return nothing and grep 3 returns only `calendar/v3/freeBusy`.**
The write side exists in the ADR and the glossary fence, nowhere else.

## Blocked by

See the header.

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| 1 | Add `https://www.googleapis.com/auth/calendar.app.created` to the OAuth consent screen's scopes (testing mode, as with `10`) | minutes |
| 2 | The busy-visibility check needs **a second Google account** to look at the first one's availability from outside | minutes, once you have one |

## The work

1. **Fences off in the commit that builds this** — `CONTEXT.md`'s `CalendarHold` entry and the note
   beside `BusyInterval`.
2. **The verification, before any feature.** Create the secondary calendar, write one hold by hand
   via the API, and answer two questions: does our own `freeBusy` query report the interval busy
   when the query names the secondary calendar id, and does another account see the person as busy?
   **If either answer is no, stop.** ADR-0029's *Revisit when* names this outcome: the calendar
   half reopens against `calendar.events.owned` at its stated price rather than drifting there.
   Write the answer into this file, dated, whichever way it comes out.
3. **The verbs.** Create-hold (and remove-hold, which un-does only what Propositum wrote) as
   `ActionKind`s through the gate, granted by a ratified contract. Proof per action: the event read
   back by id, and the free/busy read showing the interval busy — the product's own ADR-0014 read
   becomes the receipt for its ADR-0029 write.
4. **The guard.** `tests/calendar-scope.test.ts` must be amended deliberately: the single-scope
   equality at L149-161 (as for `10`), and the endpoint pin at L194-196, which currently forbids
   `calendar/v3/calendars/` — the path where events on the app-created calendar live. The
   substring ban on `calendar.events` (L178-187) **stays**: `calendar.app.created` does not
   contain it, and the person's own calendars remain out of reach by test as well as by scope.
5. **Reachability and strikes in the same change**, as ever.

## Done when

- Item 2's answer is written here, dated — and it was yes.
- A ratified contract can place a hold; the ledger row carries both proofs; removing a hold removes
  only what Propositum wrote.
- The scope test holds the new closed set and still bans the person's-calendar scopes and paths.

## What this does not cover

- **Reading the person's calendars.** ADR-0014's refusal stands in full; nothing here reads a
  title, an attendee or a description, and the scope has nowhere to return one.
- **Invitations, attendees, other people's time.** A hold has no attendees; coordinating a meeting
  is judgment plus other people, and neither is delegated here.
- **Holds as suggestions.** The free/busy read still recommends and never grants; a hold is an
  action a contract granted, and the two never trade jobs.

## Delete this file when

Item 2 comes back no and the ADR reopens — the failure note moves into ADR-0029's amendment, and a
todo whose work list can no longer run has nothing left to predict.
