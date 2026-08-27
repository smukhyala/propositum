# ADR-0021 — A thread on the person's phone, and the sentence that stops being true

**Status:** accepted · 2026-08-26
**Amends:** [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) — *"Nothing about what you
read, wrote or handed over is stored anywhere but here."* That clause is marked **"This half is
unchanged"** in the table ADR-0014 wrote, and it is the half this ADR changes ·
[`docs/VISION.md`](../VISION.md) and [`README.md`](../../README.md) carry the same claim and are
struck in the same commit. **Struck and dated in place, never deleted** — a reader has to be able to
see what was promised before they can judge what replaced it
**Depends on:** [ADR-0014](0014-reading-free-busy.md) — the precedent for a second egress, and the
two questions it wrote down for *"the first external source"*, which this ADR is the first to have
to answer · [ADR-0019](0019-disclosure-and-what-may-never-fold.md) — the closed list of what may
never be folded, which is why the ratification does not move to a phone ·
[ADR-0007](0007-stop-conditions.md) — the consumer labels this channel quotes rather than composes ·
[ADR-0008](0008-ambient-detection.md) — the offer, and the loudness metric this channel must land in
**Beside:** [ADR-0012](0012-screen-capture-refused.md) — the refusal whose warning about native
binaries applies to [ADR-0023](0023-the-tray-app-owns-the-runtime.md), not to this one

---

## What this costs

**Today Propositum has two secrets and two egresses. After this it has three of each, and the third
egress carries, in plain readable prose, the subject of the work the person was doing.** That is the
price, and it is stated first because everything below argues the price is bounded, and a bounded
price is still a price.

The two egresses today are named in `SECURITY_AND_PRIVACY.md` as *"Two things leave the machine"*:
prompts to Anthropic, and — if a calendar is connected — one free/busy request to Google that
*"carries no page, no title, no subject and nothing off your session"*. That parenthesis is the
thing to hold onto, because the third egress is its opposite. **A thread message is nothing but
subject.** *"You have had three tabs about the Lisbon trip open for forty minutes — want me to pick
it up?"* is the product working correctly, and it is also a sentence about a person's life sitting
on a server in another country.

**And the messages are not end-to-end encrypted.** A Telegram bot conversation is a cloud chat.
Telegram holds it, can read it, and retains it under their policy and not ours. Saying *"we run no
server"* while a third party holds a readable log of what Propositum told you about your own
afternoon would be exactly the wording this repository exists not to use.

The third secret is a bot token, and it is unlike the first two in a way that is worth stating
because it is the one genuinely good property here. `ANTHROPIC_API_KEY` is the app's own credential,
*"the same for every copy of the software"*. The Google refresh token is per-person. **The bot token
is per-person and has no operator.** The person creates their own bot through Telegram's BotFather;
we never see it, never hold it, never route through it, and there is no account of ours that could
be compelled to produce it. There is no shared Propositum bot and there must never be one, because a
shared bot is a server of ours wearing a different hat.

**What survives, said narrowly rather than rounded up.** *"No server of ours"* is still literally
true. The worker long-polls Telegram; there is no inbound webhook, no host, no relay, no queue and
nothing to operate. That is a real claim and a narrow one, and this ADR does not get to spend it as
if it were the larger claim it sits next to.

**What is bought.** The product's entire premise is that the person leaves. Until now the only
channel that could reach them was a Chrome notification on the machine they walked away from.
`src/domain/execution/stop-conditions.ts` sets `CONFIRMATION_EXPIRY_HOURS = 24`, which is a
twenty-four hour window during which a run has stopped, is holding nothing, and is waiting on a
person who has no way of knowing. A `DecisionNeeded` is worse — it is recorded, surfaced, and
unanswerable by anyone at all. The channel is not a convenience feature. It is the first thing in
this product that can reach the person the product is designed around the absence of.

## Context

Two facts about this repository set the shape.

**Inbound has nowhere to land, by construction.** `ObservationEvent.sessionId` is required and
`src/persistence/ledger-writer.ts` is the single door every event enters by. ADR-0014 left the
consequence written down: *"A connector is therefore not an integration job. It is a schema change
plus a second writer, and the second writer is the thing that argument exists to forbid."*

**Nothing may call a model on a timer.** `CONTEXT.md` bans it, and `SECURITY_AND_PRIVACY.md` states
the trap in one sentence: *"An email that arrives at 3am is a model call at 3am unless something is
designed first to prevent it."*

Those are the two questions that document says *"the first external source has to answer in its own
ADR"*. This is that ADR, and the answers are short because the design refuses the premise rather
than satisfying it.

## Decision

**A message channel is a transport for the interface, not a capability of the worker. It is
outbound-first, its message set is closed, and no model composes any part of it.**

### 1. The channel is not a tool

It is not an `ActionKind`. It takes no `AuthorizedAction`. It is not exported from
`src/policy/tools.ts`. `LANDING_ACTION_KINDS` stays empty and `classifyPausedRequest` keeps failing
every non-`GET` request unconditionally, so *"Propositum can operate a page and cannot send from
it"* remains true word for word.

This distinction is the whole safety argument and it is worth being blunt about how thin the line
is. The difference between *the app tells you something* and *the worker sends a message* is not a
difference in bytes on a wire. It is a difference in who initiates. `src/runtime/thread-channel.ts`
is reached by the worker **process**, from the same poll loop that already drains `AgentRun` — never
by the worker **loop**, which is the thing a model steers. A model cannot cause a message to be
sent, because there is no proposal shape that means *send*, and the gate that would have to
authorise one has no rule for it.

**What holds this:** `tests/architecture.test.ts` already greps `src/policy/tools.ts` for
`export function sendMessage`. That grep has been described in its own comment as meaning less than
it used to, since `click-element` can press a page's own Send button. This ADR gives it back some of
its meaning in one narrow direction: **we still ship no code that composes a message on the
person's behalf.** What we now ship is code that tells the person something about their own run.

### 2. No model composes a message

Every message is a template over durable rows, in `src/domain/conversation/messages.ts`, built the
way `STOP_RULES` is built. The eight model boundaries in `tests/boundaries.test.ts` do not become
nine.

ADR-0019 already refused *"a shorter model-written summary of the permissions"* on Principle 8, and
that refusal applies with more force here. A permission screen is read at a desk. A message is read
on a lock screen, in a queue, one-handed. **If a model could write the sentence, the sentence a
person acts on fastest would be the one nothing in this repository can check.**

Where the thread carries model prose — the offer's `rationale`, the shift `headline` — it quotes an
existing row verbatim. Those rows were already composed, already stored, and already shown on a
screen. Quoting one is not a ninth boundary; generating a phone-shaped variant of one would be.

### 3. What a message may contain

Derived prose only: a subject, an offer's rationale and outline, a stop rule's consumer label, a
shift headline, a `DecisionNeeded`'s question and `whyItMatters`, and a code-generated confirmation
sentence from `confirmationQuestion()`.

**Never:** page-authored text, quotations, an element's accessible name, a tab title, typed text, a
screenshot, or a URL other than a `127.0.0.1:3117` deep link. The rule with an edge on it:
**anything that has crossed `datamark()` may not leave the machine.** That is not a style guide, it
is the same boundary the trust model already draws, extended one hop.

The confirmation screen's own docblock is the reason screenshots are named explicitly: *"A
screenshot of somebody's authenticated session is the most sensitive byte-string this product
holds. An endpoint that serves one by id is a second door onto it, guarded separately, forever."* A
message channel that could carry an image would be that second door with a worse lock.

### 4. A confirmation may never be answered by reply

`src/app/api/act/confirmation/route.ts` states this before this ADR existed:

> It is a READ, and that is the whole design. There is no POST here and there must never be one …
> A notification with an Approve button would be approving without seeing what you are approving —
> and a channel that could carry the approval would make that button one line of code away forever.

The extension already learned the sharper version. Its notification has **one** button, *Show me*,
and deliberately not even a *Don't*, because *"a two-button notification teaches the hand to answer
these without reading, and the hand does not distinguish which of the two buttons it learned on."*

So a confirmation message carries a sentence and a link and no verb. `ConfirmationVerdict` keeps
exactly two writers, both server actions on a page a person is looking at.

**The one reply that is safe is the one this repository does not have yet**, and it gets its own
decision — [ADR-0022](0022-the-fourth-verdict.md). An answer to a `DecisionNeeded` grants no
permission, widens no scope, and reverses nothing. It is the inverse of a confirmation, which is
precisely why one may be given from a lock screen and the other may never be.

### 5. An inbound message is not an observation

It never becomes an `ObservationEvent`. `sessionId` stays required, `ledger-writer.ts` stays the
single writer, and no second writer is introduced.

An inbound reply is one of three things and nothing else, parsed by
`src/domain/conversation/reply.ts` into a closed union: an offer answer, an answer to an open
`DecisionNeeded`, or unrecognised. **Unrecognised writes nothing** and is answered *"I didn't follow
that"* — because a channel that silently swallows what it cannot parse is a channel that appears to
have been told something.

And the 3am problem does not arise, because **nothing reads a reply into a prompt.** A reply writes
a row. The next model call is the one the worker was going to make anyway, on the schedule it was
already on.

### 6. Silence is still a correct output

The message set is closed and every member carries a decision, because Principle 13 forbids *"a
notification with no decision attached to it"* and names this exact erosion path in its own text:
*"Notifications are the obvious place this erodes first, because a notification is the cheapest
thing to add and the hardest to attribute."*

No progress pings. No "still working". No daily summary. Five members:

| Trigger | Reply |
|---|---|
| An offer composed while no session runs | `yes` → a deep link · `not now` → `declineThreadOffer` |
| A `ConfirmationRequest` raised | **none.** A link, and no verb |
| A `DecisionNeeded` raised | free text → `DecisionVerdict` ([ADR-0022](0022-the-fourth-verdict.md)) |
| A run reaching a terminal status | none — the decision is to go and review |
| A `CaptureGap` while away | none |

Adding a sixth is a diff to that table and to `tests/conversation.test.ts`, which is the point of
writing it here rather than in a comment.

**And the channel lands in the loudness denominator.** ADR-0015's `offer_tally` counts offers shown
per hour of observed browsing. A message about an offer is an offer shown. If it did not count, the
one metric that would notice this channel getting louder would be measuring the quieter surface and
reporting it as the whole.

## Rejected alternatives

**A contentless doorbell — *"something needs you"* and a link, never a subject.** This is the
version where no promise is struck and no document is amended, and it was genuinely tempting for
about an hour. It fails on its own terms. Principle 13's requirement is a decision attached to the
notification, and *"something needs you"* attaches nothing — you cannot decide whether to open it,
which makes it strictly worse than the Chrome notification it duplicates, and it arrives in more
places. A person who cannot triage from the message will open every message, and a channel you open
every time is a channel that has taught you nothing. **The subject is not decoration on the
notification. The subject is what makes it a decision rather than an alarm.**

**Apple Messages for Business.** Grey bubbles, not blue. Requires a registered company, an
Apple-approved Messaging Service Provider, and brand assets submitted for review. The customer must
open the conversation first, and proactive contact is limited to Apple-approved use cases —
so the one message that matters most, *I stopped and I need you*, is the one the channel is designed
to prevent. Refused on the product shape, before the corporate requirements are even reached.

**A hosted iMessage relay** — Sendblue, Loop, Blooio and the rest. These work by running racks of
Mac minis with real Apple IDs. Every sentence would pass through a vendor whose business is holding
other people's messages, at $39 to $1000 a month. This is *"no server of ours"* traded for *"no
server of ours, but a server of theirs, and we chose it for you."* Refused.

**A local iMessage bridge** — `osascript` to send, `~/Library/Messages/chat.db` to read. This is the
one that is genuinely right for this product eventually, and it is deferred rather than refused. It
keeps everything on the person's own machine, matches the register the product already lives in, and
it is what this channel interface exists to accept later. It is not first for one reason: **sending
is reliable and reading is not.** Full Disk Access does not propagate to processes launched from a
LaunchAgent, and the failure mode is a silent read of an empty database — a channel that appears to
work and quietly receives nothing. That belongs behind an interface that already has a working
implementation to be compared against, not as the only implementation shaping it.

**Push notifications via APNs, or a web push service.** Needs an Apple developer account and a push
server. A push server is a server of ours, and this time there is no reading of the word that saves
it.

**Signal, via `signal-cli`.** Better privacy properties than Telegram by some distance — the
messages would be end-to-end encrypted, which is the exact defect named at the top of this ADR. It
is rejected for now on shape rather than principle: `signal-cli` requires a dedicated phone number,
registration is fragile, and it has no equivalent of an inline keyboard, so every reply becomes text
to parse. **This is the most likely thing to overturn this ADR**, and it is written here so that the
person who arrives with it has a running start rather than an argument to have.

## What holds the line now

Mechanisms, because the structural guarantee — *there is no channel* — is what is being spent.

| | |
|---|---|
| `tests/thread-scope.test.ts` | The containment template `tests/reachability.test.ts` uses for `groupTitle` and `authoredLabel`, applied here: a thread message reaches a person and **never** a model boundary, **never** `compilePolicy`, **never** a `ContractScope`. It may inform a person and may not inform a decision |
| `tests/conversation.test.ts` | The message union is closed, and every member carries a decision |
| `tests/boundaries.test.ts` | Unchanged, and that is the assertion — eight boundaries, still eight |
| `tests/architecture.test.ts` | No `fetch` and no clock in `src/domain/conversation/`; the transport lives in `src/runtime/` |
| `tests/reachability.test.ts` | `LANDING_ACTION_KINDS` still empty |
| `tests/thread-channel.test.ts` | **Only the paired chat is a reply.** A bot's username is public and `getUpdates` returns everything anyone sent it, so the transport drops what is not from the paired `chatId` — and acknowledges it anyway, so a stranger cannot push the person's own reply out of the provider's window |

**Where this could still go wrong, said plainly.** The rule *"anything that has crossed `datamark()`
may not leave the machine"* is enforced by a grep over `src/domain/conversation/` and by the message
union being closed. Neither of those follows a value at runtime. A future message member that
interpolates a field which *happens* to hold page-authored text would pass both. The honest
statement is that the boundary is held by the union being small enough to read, and a union that
grows past what one person can hold in their head has stopped being the mechanism it claims to be.

**And the inbound scope is a conversation, not a person.** The paired `chatId` is what makes a reply
a reply, and it is the only thing that does. It says nothing about who is holding the phone — anyone
with it unlocked is in that chat, exactly as anyone at the unlocked desk is at the screen. What it
does buy is that the bot's public username stops being a way in: without it, a stranger's `yes`
accepted an offer, and a stranger replying to their own message forged an answer, because Telegram
numbers messages per chat and `keyForProviderMessageId` scopes on `provider` — which is always
`telegram`.

## Revisit when

- **Anyone proposes a shared Propositum bot**, for any reason, including onboarding friction. That
  is a server of ours and the argument at the top of this ADR is the answer.
- **Anyone proposes a reply that grants something** — a confirmation, a scope, a source, a dial.
  Read `src/app/api/act/confirmation/route.ts`'s docblock first; it was written before this channel
  existed and it is about this channel.
- **`signal-cli` grows an inline-keyboard equivalent**, or somebody is willing to take the
  registration cost. The end-to-end encryption defect at the top of this ADR goes away.
- **The local iMessage bridge's read path becomes reliable** — specifically, when Full Disk Access
  propagates predictably to a supervised child process. Then it is the default and Telegram is the
  cross-platform fallback.
- **A message member is added that is not in the table in §6.** Not a code review note. The table is
  the decision.
- **The offers-per-hour figure starts climbing after this lands.** ADR-0015 built that number to
  notice exactly this, and Principle 13 predicted the channel it would notice.
