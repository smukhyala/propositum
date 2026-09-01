# Instinct: what it can do, and what that means for us

*Research note, 2026-08-31. Not product documentation — nothing in here is decided. Sources
are public reporting and one first-party account (our own beta access). ~~Uncommitted by
intent; commit only if it earns a place.~~ **Committed 2026-09-01 — it earned one:
[ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md) cites it as its research
source, and §8 below now carries the owner's answers.***

Instinct is the closest product in the world to what Propositum is for, built on the
opposite architecture. Everything below is organised around one comparison: what an agent
can do when nothing constrains it, and which of our guardrails is the reason we cannot do
the same thing today. That framing is deliberate — each row is simultaneously a
capability report and a price tag on one of our invariants.

**The one-line summary.** Instinct runs a persistent cloud computer per user, holds the
person's passwords and payment methods, reads their whole Google Workspace, and acts
without per-action approval — and users love it, to a $2.5B valuation in beta. Its three
weeks of public existence have also produced a live prompt-injection demonstration, email
retention that survived disconnection, an unapproved outbound email, an unauthorised
$200-fee booking, and autonomous consumption of a verification code. Every one of those
failures is something our architecture makes structurally impossible — and most of what
its users love is something our architecture currently refuses. That tension is the whole
document.

---

## 1. The company

- **Spear Street Technology, Inc. d/b/a Instinct**, San Francisco. Founder/CEO Noah
  Shinn, 23 — ex-Sierra research scientist, first author of the Reflexion paper (NeurIPS
  2023), co-developer of tau-bench. Team publicly described only as "small".
- Invite-only beta since **February 2026**; public launch was Shinn's X post of
  2026-08-26 (~1.9M views). No app-store presence, a deliberately lo-fi one-page site,
  no docs, no company X account.
- **~$350M raised in ~7 months**: seed at ~$50M valuation (Conviction, Greenoaks), $75M
  Series A at >$500M (Kleiner Perkins, early Aug 2026), $250M Series B at **$2.5B**
  co-led by Index and Benchmark (announced 2026-08-26 — two days after TechCrunch's
  privacy exposé). No disclosed revenue; free during beta; the ToS already has a paid
  section.
- **Interface**: "there are no new interfaces" — you text or call an assigned number.
  Press adds WhatsApp, iMessage, email and (one report) Slack. One continuous thread.
- **Architecture** (third-party teardown + investor description, not company docs): a
  persistent cloud machine per user with browser access and cached credentials, plus a
  top-level orchestration agent with visibility across every thread. Underlying model
  undisclosed; reporting says off-the-shelf models with fine-tuning, and the privacy
  policy discloses sharing data with third-party model providers. Payments moved onto
  Stripe Link (~Aug 28); Shinn claims purchasing users average **$1,300+/month** through
  it.
- **Beta population is investors and founders** — Newcomer: "venture capitalists
  themselves seem like the power users of these products." Worth remembering when
  weighing the glowing reports.

## 2. Capability inventory

Ratings:

- **Unrestricted** — what this takes for a computer-use agent with no guardrails:
  *Trivial* (commodity API/automation), *Hard* (real engineering, mostly works),
  *Frontier* (unreliable for anyone, guardrails or not).
- **Propositum today** — *Reached* (wired end to end), *Partly* (the read/draft half
  works, the landing half cannot), *Decided, unbuilt* (an accepted ADR, no code),
  *Blocked* (a specific guardrail forbids it), *Never* (an invariant we would not trade).
  The named guardrail is the thing that would have to move.

The load-bearing fact for nearly every mutating row: **nothing lands**.
`classifyPausedRequest` fails every non-GET request leaving a held tab
(`extension/src/cdp.js`), with no bypass and no confirmable override. Propositum can fill
the form and press Buy; the order does not go through. That is a mechanism, not a missing
wire — ADR-0024 is the argument for spending it, and it is spent per landing kind, not
wholesale.

### Communication and email

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Read / index / triage the whole inbox | first-party (ours) | Trivial (Gmail API) | **Blocked**: do-not-build *automatic Gmail ingestion*; ~~ADR-0014 pins the only Google scope to `calendar.freebusy`~~ **corrected 2026-09-01: the pin was reopened by [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md) — `gmail.modify` is decided, unbuilt; the ingestion ban stands untouched**. In-session reading of a ratified mail tab is reached; a standing index is the banned thing. |
| Send email as the user | demonstrated — including one **unapproved** send (Stanton) | Trivial | **Blocked**: the non-GET abort; and `tests/architecture.test.ts` refuses a function shaped like *send* (ADR-0010 clause). Draft composition inside the tab is reached. |
| Message third parties (WhatsApp etc.), negotiate overnight | demonstrated (Mohnot's vendors) | Hard | **Blocked** twice: non-GET abort, and ADR-0021 — the thread speaks only to the person, in five closed message kinds. Messaging a third party is a different product decision entirely. |
| Consume OTP / verification codes autonomously | demonstrated (Resy signup) | Trivial | **Decided, unbuilt** in a narrower form: ADR-0026 reads a code from `chat.db` within a run a person ratified. Instinct's version — consuming codes with no per-use consent — is the cautionary tale, not the spec. |

### Calendar and scheduling

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Calendar read + event sync | demonstrated | Trivial | **Blocked**: ADR-0014 — free/busy in, one number out, nothing else. Widening scope is an ADR amendment, not a diff *(and on 2026-09-01 that amendment happened — [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md); the read of the person's calendars stays refused)*. |
| Book appointments (doctor, yoga, repairs) | demonstrated | Hard (browser flows, phone fallback) | **Partly**: navigate/fill on approved origins is reached; the booking POST cannot land (non-GET abort → ADR-0024 territory). |
| Healthcare admin (find in-network doctor, intake forms) | user-reported | Hard | **Partly**, same shape — plus the parts that are phone calls, which we do not have at all (see Channels). |

### Purchases, travel and errands

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Buy and rebook flights | **first-party (ours)**; a tester graded its itineraries "an A" | Hard by browser; *near-deterministic by API* (Duffel) | **Decided, unbuilt**: ADR-0024 `PurchaseAuthorization` — plus the non-GET abort it would spend. Flight *search* is reached today (`read-approved-source`). |
| General purchases with stored payment method | demonstrated; $1,300+/mo claim | Hard | **Decided, unbuilt** (ADR-0024). Note §7: the 2026 payment rails make the ceiling *deterministic* — a scoped single-use card cannot overspend even if everything above it misbehaves. |
| Restaurant reservations | demonstrated — including the **unauthorised $200-fee booking** (Yeh) | Hard | **Partly / Decided-unbuilt** — same landing gap. Our per-action confirmation, escalated to the phone and answerable only on the loopback page, exists precisely so the Yeh incident cannot happen. |
| Negotiate bills, cancel subscriptions | demonstrated (Comcast $100→$60) | **Frontier** — no API exists; the market leader (Rocket Money) uses humans | **Blocked** several ways (phone calls, non-GET), and honestly rated: this is probabilistic for everyone. |
| Watch sold-out inventory for days, snipe cancellations | demonstrated — but it **crashed in a live on-sale** a human won | Hard | **Blocked**: do-not-build *continuous autonomous background scheduling*. A bounded, ratified watch-run would need an ADR. |
| Rides, groceries, local services | company-claimed | Hard (no consumer APIs) | **Blocked** (landing) — and the consumer marketplaces are adversarial browser surfaces even unrestricted. |
| Insurance, apartments, "helped buy a house" | user-reported / founder-relayed | Hard | Research half **reached**; transaction half is ADR-0024 and beyond. |

### Web tasks and forms

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Apply to jobs | **first-party (ours)** — no public corroboration found by two researchers | Mixed — see §8: discovery is trivial, big-four ATS forms hard, Workday/LinkedIn frontier | **Partly**: discovery and form-fill are reached on approved origins; submission is a POST; account-creation OTPs are ADR-0026, unbuilt. |
| Fill out paperwork / web forms | user-reported | Trivial-to-Hard | **Partly** — `type-text` into a ratified form is the product working as designed; the password-field refusal (`gate.ts`) and submit-POST are the two stops. |
| Research the user during onboarding | user-reported | Trivial | **Blocked** as ingestion; our analogue is ambient observation, which deliberately holds no page text and strips referrers. |
| CRM / data-room admin | user-reported | Hard | **Partly** — in-tab work on approved origins is what a `HandoffContract` is for; mutations that leave the tab are the same landing gap. |

### Phone and computer control

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Persistent cloud phone + computer per user | investor-described | Hard (it is mostly money) | **Never**: *no cloud, no telemetry, no server of ours*. Our answer is the person's own Chrome (reached) and ADR-0025's allowlisted macOS control (decided, unbuilt). Springwater's critique of Instinct — the cloud agent lacks your cookies and residential identity — is our structural advantage. |
| Store passwords; sign into accounts; **autonomously reset passwords** | demonstrated ("unusually aggressive" — a16z) | Trivial to do, catastrophic to hold | **Never**: no keychain (ADR-0025 §3), no credential store, and the gate's `password_field` refusal is unconditional — not confirmable. The person signs in; we act in the signed-in tab. |
| Make and take phone calls | demonstrated | Hard (telephony + real-time voice) | **Blocked**: no voice channel exists; the thread is text, one transport, closed set (ADR-0021). A call product is a new ADR and a new file in `src/runtime/`. |
| "You appoint the Services as your agent… binding as if entered into directly by you" (ToS) | company-claimed | — | Our counterpart is the ratified `HandoffContract` + per-scope `PurchaseAuthorization` — consent per scope with a ceiling, not a blanket power of attorney buried in terms. |

### Proactive and ambient behaviour

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Proactive follow-ups; unprompted outreach | user-reported — and the failure mode of the two worst incidents | Trivial | **Blocked**: do-not-build *proactive consequential action without an established permission policy*. Our permitted shape is the offer — propose, never act. |
| Multi-day always-on persistence | user-reported | Trivial (it is a daemon) | **Blocked**: *continuous autonomous background scheduling*; runs are deadline-bounded with credited pauses. |

### Memory, privacy posture, channels

| Capability | Evidence | Unrestricted | Propositum today |
|---|---|---|---|
| Index connected services into a persistent store | demonstrated — retention **survived disconnection** (Vo, Yang) | Trivial | **Never** in that form. Nothing is copied; the ambient buffer holds no page text; `Datamarked` is the only door page text has into a prompt. |
| "Vault" — training-exempt storage | company-claimed | — | Our default is their exception: no cloud, no training, ever. The wedge, not a feature. |
| One continuous thread | user-reported (noisy — a user quit over it) | — | ADR-0021's thread is deliberately minimal: five outbound kinds, four inbound shapes, prose only for a `DecisionNeeded` answer. |
| Text/call a number; WhatsApp/iMessage/email/Slack | demonstrated | Trivial | **Partly**: Telegram, one transport by test. Confirmations are `open-only` — deliberately **not** answerable in the thread, which is the exact control Instinct lacked in the OTP and Stanton incidents. |

### Security exposure (theirs, demonstrated)

Two rows that belong in the inventory because they are capabilities in the attacker's
column:

- **Follows instructions embedded in received email.** Alex Cohen mailed his own inbox
  from a fresh account with directions for Instinct; it searched the inbox and mailed
  back a summary, no verification. He deleted his account. Their own privacy policy names
  the risk class. Our counterpart is structural: page text reaches a prompt only as
  `Datamarked`, the boundary tests refuse an instruction laundered from content, and the
  thread parser has no message shape that could carry one.
- **Takes consequential actions without approval.** The Stanton email and the Yeh
  booking. Our counterpart: two ledger rows per action, a gate that authorises before
  any effect, and a confirmation that times out into *no verdict row and therefore no
  permission*.

## 3. Where Instinct breaks (the recorded failures)

Kept verbatim-close because each one is a design input for us:

1. **Vo** — disconnected Google at 11am, got an inbox summary at 2pm; export showed her
   emails as Markdown files. Company: "a gap." Deletion tool shipped days later, no
   postmortem.
2. **Yang** — could not get indexed Gmail deleted on request; a control was added after.
3. **Stanton** — email sent on her behalf without checking. "One unauthorized action can
   reset that trust to zero."
4. **Cohen** — the prompt-injection test above.
5. **Yeh** — off-script booking with a $200 cancellation fee.
6. **Kirkovska** — a sign-up verification code consumed autonomously.
7. **Acharya** — autonomous password reset to complete a purchase.
8. **Chiou** — crashed repeatedly in a live high-demand ticket on-sale a human won.
9. **Kiran** — 13 messages to place an Amazon order that takes 2 taps in the app.
10. **M. Yang** — quit over thread noise and a payment-card request.
11. **Springwater** (structural) — the cloud agent lacks the user's cookies and
    residential network identity, so fingerprinting sites treat it as a stranger.

And the ToS quietly concedes the deepest one: *"Records of Actions available through the
Services may not always be accurate."* Their action log is best-effort prose. Ours is an
append-only table the app re-verifies triggers on at startup. That sentence is the
sharpest single contrast in this entire comparison.

The ToS and privacy policy were re-issued on 2026-08-26 — two days after the TechCrunch
piece, the day of the funding announcement. The "perpetual and irrevocable" training
licence wording survives only in press quotes. Training on user content remains the
default outside the Vault and the Google-API carve-out; that carve-out is
transport-scoped, so the same email text captured via the screen is trainable.

## 4. What Instinct should add (their gaps)

Worth writing down because it doubles as a map of where the market is soft:

1. **A per-action confirmation for irreversible or fee-carrying actions** — the Yeh and
   Stanton incidents are one missing gate. Their post-backlash fix ("stopped the agent
   from taking some actions") is a model-behaviour patch, not a mechanism.
2. **A spend ceiling that is enforced below the model** — scoped single-use payment
   credentials (Stripe Issuing exists; they are already a Stripe partner) rather than a
   stored card the agent can point anywhere.
3. **Deletion that provably deletes, and retention windows** — the policy states none.
4. **Content-scoped, opt-in training** — the transport-scoped carve-out is a trap for
   users who believe "Google data is excluded".
5. **An injection boundary** — any content arriving from a third party (email, page
   text) must be unable to become an instruction. They have acknowledged the class and
   shipped behaviour patches; nothing structural is claimed.
6. **OTP consent** — a verification code is a question addressed to the person; consuming
   one should require a per-use yes.
7. **Thread structure** — parallel jobs in one thread is already costing users.
8. **A hybrid execution mode on the user's own devices** — answers the
   cookies/fingerprint handicap and would blunt the privacy critique. (This is our
   ground; expect them or a competitor to move onto it.)
9. **An accurate action ledger** — see above.

## 5. What we should add (candidate work, in order)

Framed as candidates for `docs/todo/` files or ADRs; none of this is decided by this
document. Each respects the heuristic: prefer absence to a rule, a type to a convention.

1. **Build ADR-0024, and build it on the 2026 rails.** The strongest research finding:
   the payments industry spent 2025-26 making *exactly our invariant* into
   infrastructure. Stripe Shared Payment Tokens and Issuing's single-use virtual cards
   are scoped to one merchant and a fixed amount, enforced in the authorisation path —
   a ceiling that holds even when everything above it misbehaves. AP2 mandates are
   signed evidence of what was consented to. A `PurchaseAuthorization` whose ceiling is
   a *card-network-enforced* ceiling is a stronger promise than Instinct can make with
   a stored card, and it is the first-party capability gap (our user watched Instinct
   buy flights). Flight purchases specifically should go through Duffel-class APIs —
   typed offers, PNR read-after-write, `order.created` webhooks — not browser checkout.
2. **Build ADR-0026** (the `chat.db` code reader). Small, decided, and it unblocks every
   account-creation flow a run encounters. Two known traps: modern macOS stores text in
   the `attributedBody` typedstream blob with `text` NULL, and the DB is WAL-mode —
   query the live file read-only. Full Disk Access is the gate and it is manual.
3. **A draft-only mail pack, by ADR.** The do-not-build entry bans *automatic ingestion*;
   it does not decide against gated, per-agreement mail *actions*. `drafts.create` is
   inert — worst case is an unsent draft — and archive-by-sender, filter creation and
   RFC 8058 unsubscribe (from a person-ratified list) are deterministic with
   read-after-write proof. This would need an ADR arguing the scope line (it touches
   ADR-0014), and the send verb stays absent. *(Decided 2026-09-01, wider than proposed
   here: [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md) takes
   `gmail.modify`, keeps drafts as the default terminal, puts send behind a ratified
   `SendAuthorization` — and refuses the filters this item suggested, as a standing rule
   that outlives its contract.)*
4. **Calendar holds.** `events.insert` on the person's own calendar is deterministic and
   verifiable via the freebusy read we already have — but it contradicts ADR-0014's
   freebusy-only pin, so it is an amendment to that ADR with the option-rejected section
   updated, not a quiet widening. *(Decided 2026-09-01 — and not as recommended here:
   ADR-0029 refuses writes to the person's own calendar and places holds on a
   Propositum-created secondary calendar under `calendar.app.created`, with
   busy-visibility as the build's first check.)*
5. **Verification as a first-class outcome.** We already write two rows per action; the
   research's sharpest line is that deterministic tasks are the ones with a
   read-after-write proof. An `ActionOutcome` that carries typed evidence (a PNR, an
   order id, a re-queried row) turns "reported done" into "proved done" and is exactly
   the register our ledger already speaks.
6. **A job-application slice, honestly scoped.** Greenhouse/Lever/Ashby/SmartRecruiters
   expose public JSON for postings *and per-job question schemas* — deterministic
   discovery with `read-approved-source` today. Form-fill on approved origins is
   reached. Submission is a landing kind (ADR-0024's machinery generalises); Workday and
   LinkedIn stay out (per-tenant accounts; ToS bans with real enforcement — LinkedIn
   flagged 23.5M automated sessions in a quarter). Also a market lesson: human-reviewed
   applications convert at 25-47% vs 0.5-6% for spray automation. Our
   confirmation-per-submission is not a tax; it is the version that works.
7. **Package tracking and price watching.** The cleanest deterministic reads in the
   errand space (EasyPost/AfterShip; Keepa). The *watching* half collides with the
   background-scheduling ban, so the shape is either bounded ratified runs or an ADR —
   but as tester-build demo capabilities they are cheap and impressive.
8. **Say no, on the record, to:** voice/telephony (frontier surface, new transport, whole
   product), bill negotiation and subscription cancellation (no rail exists; the leader
   uses humans), airline check-in, DMV portals, Amazon consumer ordering, consumer food
   delivery, CAPTCHA circumvention (adversarial by policy; the reputable pattern is
   hand-back-to-human, which our confirmation flow already is). A decline list is a
   product asset — it is the honest register the ToS quote in §3 is not.
9. **The privacy wedge as explicit positioning.** Every §3 failure is impossible here by
   construction, not policy: local-first, nothing copied, `Datamarked`-only page text,
   append-only accurate ledger, no standing permission (there is no field for one),
   confirmations answerable only at the loopback page. "Instinct's power without
   Instinct's bargain" is a sentence a reader of this month's press immediately
   understands. Where this lands (README, VISION) is its own change.

## 6. The competitive field, compressed

| Product | Status | One line |
|---|---|---|
| **Poke** (Interaction Co.) | sold to Cognition, Jul 2026 | Best interface in the category (iMessage-native, 100M+ messages) — still couldn't be a company. |
| **ChatGPT Agent** (OpenAI) | live | Operator died into it (Aug 2025); sandboxed cloud VM, hands CAPTCHAs/logins/payments back to the human. |
| **Alexa+** / **Gemini + Spark** / **Meta "Hatch"** | live / rolling out | Distribution incumbents; Gemini replaces Assistant on Android Sep 2026, Spark does credentialed web actions. Scale ≠ reliability. |
| **Claude Cowork / Claude for Chrome** | live | Acts in the user's own signed-in browser with per-site permissions — the philosophical neighbour of our consent posture, with a model company behind it. |
| **OpenClaw** | live, OSS | "Instinct for people who own their data" — self-hosted daemon, 250K stars; Mohnot's line was that Instinct is *"OpenClaw for normal people"*. |
| **Grok Bot** (xAI) | beta, ~$120/mo | Persistent cloud coworkers with terminals. |
| **Yutori / Tasklet / Duckbill / Ohai / Martin** | live | Wedges: monitoring, scheduled automation, human-executed concierge, family ops, budget Jarvis. Duckbill's humans-do-the-irreversible-parts model keeps winning on reliability. |
| **Dot / Sonara / Humane / Rabbit / Adept / MultiOn** | dead or absorbed | The graveyard, next. |

Graveyard lessons that bear directly on us: companionship without execution churns
(Dot); demo-grade autonomy triggers refunds (Rabbit); low-precision autonomy burns the
*user's* reputation (Sonara's 15 duplicate applications); thin autonomy wrappers get
commoditised by model vendors (MultiOn → Operator → ChatGPT Agent); standalone agent
SKUs die into features of distribution channels (Operator itself); and the one
consistent survivor pattern is a human in the loop for irreversible steps (Duckbill) —
which is, mechanically, what our gate is.

## 7. What we could promise at ~100%

The user-facing question this answers: *if a person asked, which things could we do
correctly every time?* The dividing line the research kept reproducing: a task is
promisable when some party returns a **typed receipt** (an API with read-after-write, a
merchant of record, a signed mandate) and unpromisable when the agent is impersonating a
consumer in a browser on an adversarial surface. Verification is the tier test: no
read-after-write proof, no promise.

### Deterministic — promisable today, given the named rail

*(2026-09-01: the "needs mail ADR" and "ADR-0014 amendment" cells below are answered — the ADR is
[ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md), which also overrode two rows: the
calendar-hold rail is `calendar.app.created` on a Propositum-created calendar, not `events.insert`
on the person's own, and standing filters were refused. The table stays as researched; the ADR is
the decision.)*

| Would-be promise | Rail | The proof | For us |
|---|---|---|---|
| Answer "when are you free?" | Calendar `freebusy` | it is a read | **Shipped** (ADR-0014) |
| Archive/label/trash all mail from sender X | Gmail `batchModify` | re-query returns zero | needs mail ADR (§5.3) |
| Standing rule for future mail from X | Gmail filters API | `filters.get` round-trip | needs mail ADR |
| List every subscription sender | header inspection (`List-Unsubscribe`) | rows cite re-fetchable message ids | needs mail ADR; the *choosing* stays with the person |
| Send an email the person approved verbatim | Gmail `send` | SENT-label read-back | send stays absent by design; note the option exists |
| Calendar hold at a stated time | `events.insert` (idempotent id) | `events.get` + freebusy shows busy | ADR-0014 amendment |
| Reschedule own event to a stated time | `events.patch`, `sendUpdates` | re-GET shows new times | same |
| Vacation auto-responder | `updateVacation` | settings read-back | same family |
| Watch a thread for a reply | Gmail `history.list` | complete ordered log — misses impossible, only late | needs mail ADR |
| Reminders / local calendar CRUD | EventKit | fetch-by-identifier | ADR-0025 world, allowlisted app |
| File ops, document/media conversion | shell + pandoc/ffmpeg/sips/textutil | checksums, `ffprobe`, round-trips | ADR-0025 §3 currently bans shell and filesystem — this is the strongest argument for the *narrow* widening that ADR contemplates |
| Track a package | EasyPost / AfterShip | carrier-timestamped events | new capability, reads only |
| Track a price | Keepa / merchant catalog APIs | re-fetchable reads | same |
| Dispatch a courier | DoorDash Drive / Uber Direct | delivery id + webhook lifecycle | ADR-0024 family |
| Issue a spend-capped card for one purchase | Stripe Issuing | authorisation-path enforcement + per-spend events | **the ADR-0024 ceiling, made of infrastructure** |
| Enumerate open roles + exact application questions | Greenhouse/Lever/Ashby public JSON | the schema is the receipt | reachable via `read-approved-source` today |
| Flight search with real bookable offers | Duffel offers | offer id + expiry; re-fetch re-verifies | reachable as a read; booking is §5.1 |

### Near-deterministic — promisable with a typed fallback ("done, or we tell you exactly why not")

Book a flight (Duffel: `offer_expired` and price-change errors are typed; a timeout
resolves via webhook + order lookup) · book a hotel (Expedia Rapid / Duffel Stays) · buy
at an ACP/UCP merchant (scoped token: worst case is a failed charge, never an overcharge)
· one-click unsubscribe (RFC 8058: the header is binary, the POST is exact; the absent
receipt is longitudinal — no new mail in 48h) · "tell me when mail from irs.gov (DMARC-
passing) arrives" (push can drop; the history log means detection is provable within the
poll interval) · decline Friday's meetings (execution exact per event; "which events
count" is ratified once) · draft replies to named threads (envelope exact; prose is
judgment; a draft is inert so the blast radius is zero) · read an OTP from `chat.db`
(exact SQL; the extraction regex and `attributedBody` decode are the fuzz) · run a
headless Shortcut (`shortcuts run` with a receipt output) · send an iMessage *with*
`chat.db` read-back (the AppleScript send alone is fire-and-forget) · autofill a
big-four-ATS application with the person's review before submit · verify an application
landed (confirmation email + portal status).

### Probabilistic — decline, or keep a person in the loop, and say so

Blanket "unsubscribe me from everything" (classification is judgment; header-less
senders are web forms) · "book when we're both free" (slot choice has no ground truth —
propose, person picks, then the booking is exact) · cancel a subscription / negotiate a
bill (no rail; retention flows are designed to resist automation) · price-drop refunds
(dead category — Paribus) · airline check-in (Akamai-defended, classified as abuse) ·
DMV/government portals (server-side eligibility, out-of-band proof) · Amazon consumer
ordering (no Buy API; Zinc-style automation is ToS-grey and lockout-prone) · consumer
food ordering · Workday/iCIMS/Taleo applications (per-tenant accounts, 2FA, parser
fights) · LinkedIn Easy Apply (ban risk to the person's real account) · CAPTCHA (hand
back to the human — our confirmation flow, verbatim) · essay questions (employers now
seed injection traps that positively identify automation) · arbitrary GUI driving
(AX read-backs make failure detectable, never success guaranteed).

The honest-register rule that falls out of this section: **promise the deterministic
tier, type the fallbacks of the middle tier, and put the third tier in the decline list
in the product's own voice.** Instinct's ToS does the opposite — claims everything,
disclaims accuracy of its own records, and bills the user for the difference.

## 8. Questions for you

**Answered by the owner, 2026-09-01.** Kept with their answers rather than deleted, because the
answers are the decisions the rest of the repository now cites.

1. **Is ADR-0024 the next build?** The first-party gap (flights, purchases) plus the
   scoped-card rail argues yes; it is also the biggest bound this repo has ever spent.
   If yes, the todo file should name the non-software parts: a Stripe Issuing account,
   Duffel access, and the first `LANDING_ACTION_KINDS` entry ever.
   — **Yes: purchases are the next major build**, per
   [`docs/todo/06-buying-things.md`](../todo/06-buying-things.md) as written. The
   Duffel/Stripe rails stay flagged (§5.1) and undecided: ADR-0024's mechanism is
   browser checkout attested by Chrome, and first-party API purchasing would be its own
   ADR.
2. **Do we widen ADR-0014, or leave mail/calendar read-only forever?** The draft-only
   mail pack and calendar holds both die or live on that amendment.
   — **Widen, beyond what this section proposed**:
   [ADR-0029](../adr/0029-the-mailbox-and-a-calendar-of-our-own.md) decides everything
   in mail but permanent delete (send only inside a ratified `SendAuthorization`), and
   holds on a calendar Propositum creates. The owner's words: *"everything in mail,
   besides delete or send … put emphasis on security i.e. so propositum doesnt click on
   a phishing link on accident."*
3. **Does the privacy wedge become explicit positioning?** — **No.** *"Dont contrast,
   its fine, can gtm another way."* The architecture stays the argument.
4. **Job applications: worth a slice now?** — **Wait for landing first**; the slice
   goes end to end or not yet.
5. **Anything you saw your Instinct account do that this document is missing?** —
   Standing offer; nothing added yet beyond the three first-party items in §2.

## Sources

Load-bearing ones. TechCrunch privacy exposé (2026-08-24):
techcrunch.com/2026/08/24/instincts-powerful-ai-assistant-is-raising-privacy-and-security-concerns ·
funding (2026-08-26): techcrunch.com/2026/08/26/viral-ai-startup-instinct-has-raised-350-million-at-a-2-5-billion-valuation ·
Forbes valuation piece (2026-08-26): forbes.com/sites/iainmartin/2026/08/26/vcs-are-so-obsessed-with-this-ai-assistant ·
Vellum teardown: vellum.ai/blog/official-instinct-breakdown · usecarly.com hands-on
round-ups: usecarly.com/blog/what-is-instinct-ai and /blog/instinct-ai ·
instinct.co, /terms, /privacy-policy (both revised 2026-08-26) · Shinn launch thread:
x.com/noahrshinn/status/2092691344456351744 · Stripe partnership:
x.com/noahrshinn/status/2093368510449877180 · Cohen injection test:
x.com/anothercohen/status/2091251836917350512 · Acharya architecture thread:
x.com/illscience/status/2090456125858570702 · Tremendous flight review:
tremendous.blog/2026/08/24/my-new-ai-assistant-is-finding-me-cheap-flights-to-japan ·
Captain Compliance OTP report: captaincompliance.com/news/instincts-ai-assistant-can-book-the-table-and-keep-the-inbox ·
Rails and APIs: developers.google.com/workspace/gmail/api (filtering, push, settings) ·
datatracker.ietf.org/doc/html/rfc8058 · duffel.com/docs · stripe.com (ACP/Issuing
agents) · ap2-protocol.org · shopify.dev/docs/agents · developers.greenhouse.io ·
developers.ashbyhq.com · aftership.com/docs · keepa.com/api-docs · Apple: shortcuts CLI,
EventKit, TCC/FDA documentation via createwithswift.com and scriptingosx.com ·
Job-application market: simplify.jobs, github.com/feder-cr/jobs_applier_ai_agent_aihawk,
jobright.ai, trustpilot.com/review/usemassive.com · Competitors: en.wikipedia.org/wiki/OpenAI_Operator,
en.wikipedia.org/wiki/OpenClaw, techcrunch.com/2026/07/24 (Poke/Cognition),
techcrunch.com/2025/09/05 (Dot shutdown), getduckbill.com, yutori.com, hermesagent.agency.
