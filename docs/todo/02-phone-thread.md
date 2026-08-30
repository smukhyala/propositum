# 02 — The thread on the person's phone

**Status: done, 2026-08-26.** Landed while this folder was being written.
**Decided by:** [ADR-0021](../adr/0021-a-thread-on-the-persons-phone.md)

This file is kept rather than deleted, because what it predicted and what
happened are different and the difference is worth leaving on the page.

---

## Is this already done?

Yes. Verified 2026-08-26:

```bash
ls src/runtime/thread-channel.ts          # exists
grep -rn 'repos.thread' src/server        # src/server/thread.ts, src/server/first-run.ts
grep -n 'the channel can speak' tests/reachability.test.ts
```

The two assertions this file was written to close have **moved out of the
deferred block** and now assert the opposite — that the channel speaks, from
exactly two feeds and no others. `tests/reachability.test.ts` records the move
in its own voice: *"These were in deferred, and asserted as deferred for two
commits… They went red the way that block is supposed to."*

What shipped, and it is more than this file asked for:

| | Where |
|---|---|
| The transport, provider behind one file | `src/runtime/thread-channel.ts` — a test asserts `api.telegram.org` appears nowhere else |
| The orchestrator, the only sender and the only parser | `src/server/thread.ts` |
| Pairing UI, with the BotFather steps written out | ~~`src/app/welcome/page.tsx`~~ `src/app/first-run/page.tsx`, the phone card *(renamed 2026-08-30)* |
| The loudness coupling | `sayOffer(` sits inside `newlyShown(` in the poll route, so a send and ADR-0015's count fire on **one gate** |
| The disclosure | *"What goes through Telegram"* — that the sentences sit on Telegram's servers and are **not encrypted end to end** |

The refusal held too: `parseReply` still has no member a confirmation answer
could become, so an irreversible action cannot be confirmed from a phone. That
is an absence rather than a check, which is the form ADR-0021 asked for.

---

## What was external, and stays external

Unchanged, and now written on the pairing screen rather than only here:

- **Create the bot yourself through @BotFather** — `/newbot`, and it hands you a
  token. There is no shared Propositum bot and ADR-0021 forbids one.
- **Message your own bot once.** A bot cannot start a conversation, so the chat
  id does not exist until a person has spoken first. Nothing can automate this.
- Leave it unpaired and the feature is **absent** — not broken, not an error.

---

## What is still not done

- **Nothing scores whether a message was worth sending.** `docs/EVALUATION.md`
  already names this gap for offers; the channel inherits it. The offer rate
  counts how often Propositum spoke, not whether it should have.
- **Telegram only.** A second provider is a second argument, not a second case
  in a switch — and the one-transport test would go red, correctly, if somebody
  tried.
- **`docs/SECURITY_AND_PRIVACY.md` is now behind rather than ahead.** It
  disclosed the third egress before the code landed, which was the right order.
  Check the three-egress table reads as present tense.
