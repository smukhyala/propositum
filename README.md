# Propositum

**Understands where you were going, and keeps going while you're away.**

*Propositum* is Latin for intention. Knowledge work rarely ends at a stopping point — it ends at an
interruption, with a half-drafted section and six tabs whose relevance only you understand. The
expensive part of coming back isn't resuming the typing. It's rebuilding the intention.

Propositum watches an approved work session, builds a structured reading of what you were going
for, and — once you've ratified an explicit agreement — continues in a constrained environment
while you're gone. You come back to what changed, why, and what it couldn't decide for you.

> **Status: pre-alpha. The slice runs end to end; ~~no hypothesis has a number yet~~ struck
> 2026-08-27 — H1 and H3 have numbers, and the numbers are not flattering.** Capture,
> reading, handoff, the gated worker, the changeset, the shift report, review and the fold into a
> new document version are all built and wired — and, since 2026-08-26, so are a setup screen, an
> optional phone thread, and an answer to a raised decision that is kept rather than discarded.
> ~~What is missing is evidence: `eval-scores.json` is still the blank worksheet, and H1, H2 and H3
> are unscored.~~ **Scored 2026-08-27** ([docs/EVALUATION.md](docs/EVALUATION.md), *Second run*):
> **H1 passed one scenario of four. H3 failed on a missed stop — the run filed its sealed question
> inline in the document instead of asking it. And on all four scenarios the raw-log baseline was
> judged to catch the person up at least as well as the structured reading** — in the scorer's own
> words, the quality is about the same and the structure was just faster to read. That last finding
> has now appeared on two runs out of two, and the question it puts on the table is whether
> `SessionReading`'s inference apparatus is buying anything a formatted retelling would not. H2 is
> still unmeasured; it needs a person deciding on real work.
>
> **A third run, 2026-09-02** ([docs/EVALUATION.md](docs/EVALUATION.md), *Third run*), paid for to
> settle one question and worth reading for what it did not settle. H3 reads **PASS** — and over
> three scenarios rather than four, because `partnership-messy`'s reading boundary failed and
> produced no observation at all. That is the scenario August's only missed stop came from, so
> nothing here shows that failure fixed; it shows it was not measured. **H1 was not scored and the
> baseline was not run**, so the finding above is neither confirmed nor cleared by it.
> This README says plainly where the gaps are rather than rounding them up.
>
> **The gap that shrank and the one that did not.** Setup is no longer the reason a second person
> cannot run this — ~~`/welcome`~~ **`/first-run` (renamed 2026-08-30, todo 09 built)** pairs the extension and explains the key. ~~Two terminals still are,
> and [ADR-0023](./docs/adr/0023-the-tray-app-owns-the-runtime.md) decides the menu-bar app that
> would end them without building a line of it.~~ **Corrected 2026-08-28, in two steps this
> paragraph never recorded: stage 1 built that app on 2026-08-27, and stage 2
> ([ADR-0027](./docs/adr/0027-a-sealed-bundle-and-where-the-state-moves.md)) built the pipeline
> that ships it as a signed, notarised `.dmg` — the first release waits on the signing
> credentials [`docs/todo/01`](docs/todo/01-menu-bar-app.md) records as open, and the terminals
> are for developers.** `docs/todo/` carries what is
> left, with the external, non-software parts named.

---

## What exists today

| | |
|---|---|
| [`CONTEXT.md`](./CONTEXT.md) | The ubiquitous language, and the only glossary — there is no `UBIQUITOUS_LANGUAGE.md`. ~~38 terms, 28 banned.~~ ~~Corrected 2026-08-16: 54 terms.~~ ~~56 terms, and 21 rows in the banned table, one of them struck — corrected 2026-08-19.~~ ~~57 terms, and 21 rows in the banned table, one of them struck — `WorkSoFar` added 2026-08-20 ([ADR-0017](./docs/adr/0017-continuing-an-intention.md)).~~ ~~60 terms, and 21 rows in the banned table, one of them struck — `DecisionVerdict`, `ThreadConnection` and `ThreadMessage` added 2026-08-26 ([ADR-0021](./docs/adr/0021-a-thread-on-the-persons-phone.md), [ADR-0022](./docs/adr/0022-the-fourth-verdict.md)).~~ ~~60 terms, and 24 rows in the banned table, one of them struck — `take over`, `shift` and `claim` added 2026-08-26, and the first three rows anything actually runs: `tests/consumer-vocabulary.test.ts`.~~ ~~61 terms, and 27 rows in the banned table, one of them struck — `PurchaseAuthorization` added 2026-08-26 ([ADR-0024](./docs/adr/0024-purchases-within-a-ratified-authorisation.md)), along with three bans that exist to keep a field from arriving: the credential words, the remembered-yes words, and the bare purchase nouns.~~ ~~62 terms, and 27 rows in the banned table, one of them struck — `FirstRun` added 2026-08-30 with the todo 09 build (ticket #127): the first-run surface finally has a name, displacing `welcome`, `onboarding` and `wizard`.~~ ~~63 terms, and 27 rows in the banned table, one of them struck — `SendAuthorization` and `CalendarHold` added 2026-09-01 ([ADR-0029](./docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md)), both fenced as specifications until the code lands.~~ **64 terms, and 27 rows in the banned table, one of them struck — counted together 2026-09-02, when the two branches met: `SendAuthorization` and `CalendarHold` (2026-09-01, [ADR-0029](./docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md), both fenced as specifications until the code lands) and `FirstRun` (2026-08-30, the todo 09 build, ticket #127, displacing `welcome`, `onboarding` and `wizard`). Each branch had counted without the other, and both cells were right on their own branch and wrong on main.** ~~CONTEXT.md's own closing line carries the term count and is the authority on it~~ — **it does not and never did, so the authority this cell named did not exist.** The count now lives here and `tests/counts.test.ts` checks it against the glossary, which is the only version of this cell that has ever been able to stay true. Every schema, prompt, table and UI string uses these words. |
| [`docs/MVP.md`](./docs/MVP.md) | What slice 0 is, the three hypotheses, and the pass/fail numbers — fixed before any result existed. |
| [`docs/VISION.md`](./docs/VISION.md) | Where this goes, with **now** and **later** kept strictly apart. |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Ten layers, each marked with what is built and what would have to exist first. Five layers are partial or absent — ~~six~~, corrected 2026-08-19 and now counted by a test. |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md) | Four stages. Stage 1 points at MVP.md rather than restating it; stages 2–4 are direction, not commitment, and none is implemented. ~~Stage 1's one addition — the `Intention` table — is not implemented either as of 2026-08-16.~~ **Amended 2026-08-16, later the same day: the table, the two nullable foreign keys and the lifecycle word landed.** This cell was written in the doc wave and outlived it by hours — the fifth stale count in this table, and the one with the shortest half-life. |
| [`docs/PRODUCT_PRINCIPLES.md`](./docs/PRODUCT_PRINCIPLES.md) | ~~Ten principles~~ **15 principles, corrected 2026-08-16**, each stating what it concretely forbids. PRODUCT_PRINCIPLES.md's own header carries the count and is the authority on it — and says the header had been wrong since principle 11 arrived. Fourth stale count in this table, in the document that tells the others to say the true thing. |
| [`docs/research/`](./docs/research/) | The long answers to the questions the architecture waited on. ~~\~4,900 lines~~ **The number is deleted rather than corrected, 2026-08-20.** It was right on the day it was written, 2026-08-06, and was a little over half the truth by 2026-08-18 — `intent-signals.md` arrived and `intent-suggestion-quality.md` grew, and neither moved this cell. `tests/counts.test.ts` has no rule for the noun *lines*, so this is the one count in this table nothing checks, and the row two below says the ADR count went stale *"because nothing counted them. Something counts them now"* — true of that row and never true of this one. `wc -l docs/research/*.md` is the only version of this figure that stays true. |
| [`docs/FOUNDING_BRIEF.md`](./docs/FOUNDING_BRIEF.md) | The originating brief, kept as history. |
| [`docs/adr/`](./docs/adr/) | ~~Seven decisions~~ ~~eleven, corrected 2026-08-16~~ ~~15 decisions, corrected 2026-08-19~~ ~~18 decisions — three landed 2026-08-20 with the everyday-computing direction~~ ~~19 decisions — [ADR-0019](./docs/adr/0019-disclosure-and-what-may-never-fold.md) landed 2026-08-22 with the interface simplification and is the newest~~ ~~20 decisions — [ADR-0020](./docs/adr/0020-remembering-a-decline.md) landed 2026-08-22 with offer reticence and is the newest~~ ~~23 decisions — three landed together 2026-08-26 with the phone thread and the menu-bar app: [ADR-0021](./docs/adr/0021-a-thread-on-the-persons-phone.md), [ADR-0022](./docs/adr/0022-the-fourth-verdict.md) and [ADR-0023](./docs/adr/0023-the-tray-app-owns-the-runtime.md), the last of which is the newest~~ ~~26 decisions — three more landed the same day, and together they are the largest reversal in the series: [ADR-0024](./docs/adr/0024-purchases-within-a-ratified-authorisation.md) lets Propositum buy things, [ADR-0025](./docs/adr/0025-computer-use-beyond-the-browser.md) takes it out of the browser and onto the machine, and [ADR-0026](./docs/adr/0026-reading-a-one-time-code.md) lets it read a 2FA code out of Messages. ADR-0023 was amended by them (struck earlier: "two days after") the same day it was accepted~~ ~~27 decisions — [ADR-0027](./docs/adr/0027-a-sealed-bundle-and-where-the-state-moves.md) landed 2026-08-28 with the signed `.dmg`, seals the bundle, moves an installed copy's state to Application Support, and refuses the update feed for now; it is the newest~~ ~~28 decisions — [ADR-0028](./docs/adr/0028-a-capped-key-ships-in-the-bundle.md) landed 2026-08-29 with the todo 09 design: a tester build may carry a spend-capped bundled key, so the first run stops asking for one; it is the newest~~ ~~27 decisions on this branch — corrected 2026-09-01: [ADR-0029](./docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md) reopens ADR-0014 for the mailbox and a calendar of our own, and its number deliberately skips 0027 and 0028, which are accepted on the tray-release branch and arrive with its merge. Before it, three landed together on 2026-08-26, the largest reversal in the series: [ADR-0024](./docs/adr/0024-purchases-within-a-ratified-authorisation.md) lets Propositum buy things, [ADR-0025](./docs/adr/0025-computer-use-beyond-the-browser.md) takes it out of the browser and onto the machine, and [ADR-0026](./docs/adr/0026-reading-a-one-time-code.md) lets it read a 2FA code out of Messages. ADR-0023 was amended by them (struck earlier: "two days after") the same day it was accepted~~ ~~29 decisions — the two branches met 2026-09-02: [ADR-0027](./docs/adr/0027-a-sealed-bundle-and-where-the-state-moves.md) and [ADR-0028](./docs/adr/0028-a-capped-key-ships-in-the-bundle.md) arrived with the tray-release merge, beside [ADR-0029](./docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md), which reopens ADR-0014 for the mailbox and a calendar of our own and is the newest by number.~~ ~~30 decisions — corrected 2026-09-02: [ADR-0030](./docs/adr/0030-a-halt-closes-the-question.md) decides what stopping a run parked on a question does, which until then was nothing at all, and is the newest.~~ ~~31 decisions — corrected 2026-09-02, later the same day: [ADR-0031](./docs/adr/0031-a-first-look-is-progress.md) makes a first read of something progress, so `no-progress` stops halting a plan that reads several things before it writes — the failure two paid eval runs produced. It is the newest.~~ **32 decisions — corrected 2026-09-03: [ADR-0032](./docs/adr/0032-a-page-from-a-source-already-approved.md) lets a document come in from a host, and only from an origin the project already approved. It is the newest.**, each with the option it rejected and why. The number went stale four ADRs ago, was corrected, and went stale again by four within three days — because nothing counted them. Something counts them now, which is why this correction was made in the same commit as the ADR rather than three days after it. |
| Runtime | Next 16, TypeScript strict, Prisma + SQLite, Zod 4, Vitest. ~~336 tests.~~ ~~1,028 across 40 files, measured 2026-08-16.~~ ~~1,124 across 44 files, measured 2026-08-16 after the Intention slice.~~ **The number is gone, 2026-08-19.** It was stale by a factor of three, then stale within the day, then stale again — three corrections making the same argument, which this cell has finally taken: `npm test` prints it, nothing here can check it, so nothing here says it. `tests/counts.test.ts` fails if it comes back. |
| The product | Chrome MV3 capture, the reading with per-claim evidence, the editable agreement, the unbypassable gate, the worker and reviewer, the diff, the shift report, per-change accept/reject, and the fold into a new version. **Added 2026-08-26:** the ~~`/welcome`~~ setup screen *(since 2026-08-30: `/first-run`, an opening ask routing consent cards — todo 09 built)*, the optional phone thread ([ADR-0021](./docs/adr/0021-a-thread-on-the-persons-phone.md)), and **an answer to a `DecisionNeeded` that is actually kept** ([ADR-0022](./docs/adr/0022-the-fourth-verdict.md)) — the screen used to offer a button beside the words *"Propositum doesn't keep your answer"*, so `needs-you` could be entered and never left. **Later the same day: a document can be opened from a `.md` or `.txt` file, copied, and downloaded**, and the editor is prose rather than monospace. The file is read in your browser and lands in the box on screen before anything is stored — there is no upload endpoint, and `tests/document-import.test.ts` pins that as an absence rather than a promise. **Added 2026-09-03 ([ADR-0032](./docs/adr/0032-a-page-from-a-source-already-approved.md)):** a page can be brought in from an origin the project already approved, matched before anything is requested, sanitised at the same door, and landed in the same box — the upload endpoint is still absent and still pinned. |
| [`extension/`](./extension/) | The capture extension. See its README — the host grant is a step only you can do, from the side panel. |

~~**Built but not yet wired**, and asserted as such in `tests/reachability.test.ts` so it cannot be
mistaken for done: the shift-report narrative boundary (the field currently holds a stop-rule
label), the heartbeat gap sweeper (so two of four `CaptureGap` reasons cannot occur), and~~ ~~the
`ModelCallRecord` writer (so the ledger does not reconstruct model calls)~~ — **the
`ModelCallRecord` writer was wired 2026-08-16 and the reachability claim moved into the reachable
section; every model call now records its boundary, model, latency, tokens and failure kind.**

**The other two were wired 2026-08-27, along with outcome-scoped review findings.** The handover
note now opens with a sentence boundary 6 wrote from rows rather than with a stop-rule label; the
gap sweeper has a clock, so `service_worker_terminated` is writable — **`machine_slept` still is
not**, because elapsed silence cannot tell a slept machine from a dead service worker; and a
reviewer finding about a whole production is rendered on the card it belongs to instead of being
stored and shown to nobody.

~~**What is left in that block is one pin, and it is different in kind.**~~ **The block emptied on
2026-09-01: the pin went red on the commit that built
[ADR-0024](./docs/adr/0024-purchases-within-a-ratified-authorisation.md), exactly as it said it
would, and was promoted.** `LANDING_ACTION_KINDS` holds `complete-purchase`; the extension refuses
any non-`GET` that arrives without a one-shot landing permit a ratified authorisation armed, and
releases exactly one covered request at or under the ceiling. The mechanism was spent by the ADR the
old sentence named, not by an afternoon of wiring.

~~That is three.~~ ~~**Corrected 2026-08-16: the suite pins seven.**~~ ~~**The suite pins ten, and
this paragraph accounts for six of them — corrected 2026-08-16, twice in one day.**~~
**The number is deleted rather than corrected again, 2026-08-20 — which is what the struck sentence
already told the next reader to do.** It said *"Read `tests/reachability.test.ts`'s deferred, and
asserted as deferred block rather than this sentence — it is the thing that is enforced, and this one
is prose that has now gone stale three times."* Slice 1 would have made it four: ~~five pins were
promoted out of the block in one wave~~ **struck 2026-08-20, later the same day — the fourth pin
count this paragraph has had to withdraw, and this one was wrong when it was written rather than
overtaken later.** No single wave promoted that many, the block had lost none of its pins yet on the
day the sentence was typed, and the paragraph immediately below this one enumerates more than the
sentence claimed. It is deleted rather than corrected, for the reason the sentence itself gives:
the honest move is to stop keeping the count in two places.
`tests/counts.test.ts` says the same in its own header — *"Deleting the number is always allowed and
always passes, which is the outcome the README argues for in its own prose."*

**What slice 1 moved, since a reader who remembers the old sentence needs to know which way.**
`createBrowserControl`, `confirmations.create` and `controlLost` are all reachable now
([#91](https://github.com/smukhyala/propositum/issues/91)): a run drives the browser, the gate stops
to ask a person, and a lost tab is reported. `scrollFraction`, exit type and arrival are read by the
offer grounds ([ADR-0018](./docs/adr/0018-the-everyday-shapes.md)). ~~What is still pinned as deferred
is the shift-report narrative boundary, the gap sweeper, outcome-scoped review findings, and
`LANDING_ACTION_KINDS`~~ ~~**Amended 2026-08-26 — two pins added and one spent.** Still deferred: the
shift-report narrative boundary, the gap sweeper, outcome-scoped review findings,
`LANDING_ACTION_KINDS`,~~ **Amended again 2026-08-27: three of those four are spent, and only
`LANDING_ACTION_KINDS` is still deferred.** And — ~~new with [ADR-0021](./docs/adr/0021-a-thread-on-the-persons-phone.md) —
**the message set, which is built and which no transport sends**, outbound and inbound pinned
separately because they go live in different commits.~~ **Struck 2026-08-26, later the same day, by
the commit that built the transport.** Both pins went red exactly as that block intends and have
moved up: `tests/reachability.test.ts` now asserts the opposite — that every message goes through
`src/server/thread.ts` and no second sender exists, that `parseReply` has one caller, and that
`api.telegram.org` appears in `src/runtime/thread-channel.ts` and nowhere else. **This cell was
written in the morning and outlived the claim by an afternoon**, which is the shortest half-life in
this file since the Stage 1 row. What was spent: `DecisionVerdict` sat in the
deferred block for one commit and moved up when something wrote one, which is that block working
rather than a claim about it. `LANDING_ACTION_KINDS` — ~~**still empty, so no irreversible outcome
can occur**~~ **holds `complete-purchase` since 2026-09-01 (ADR-0024 built): one irreversible
outcome kind can occur, within a ratified ceiling, and only that** — which
[ADR-0010](./docs/adr/0010-acting-in-the-browser.md) recorded as a decision about the transport:
the extension still fails every uncovered non-`GET` request, so any other landing kind
would still be a claim the channel cannot honour. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks
each of these against the layer it belongs to.

~~**Not measured:** the harness produces H1 material and cannot yet produce H2 or H3, and both
scenarios expect a stop — so the false-stop half of H3 has nothing to score against.~~
**Struck 2026-08-20, by the harness that landed the same day.** Three claims in one sentence, and
the corpus moved under all three. A run now goes reading → handoff → plan → the worker loop → a
changeset, and `scripts/eval.ts` calls `scoreH3` on every driven run. The corpus is four scenarios,
not two. `monitor-shortlist` and `lisbon-thread` seal `shouldRaise: false`, which is exactly the
input `scoreH3`'s `false-stop` arm needs, and `tests/eval.test.ts` asserts that outcome against the
real fixture. [`docs/EVALUATION.md`](./docs/EVALUATION.md) was corrected by the same workstream and
this line was not — one claim in two places, one of which nothing checks, which is the failure
`tests/counts.test.ts`'s own header is about.

**What is still not measured, said narrowly rather than rounded back up.** ~~No hypothesis has a
number: `eval-scores.json` is still the blank worksheet~~ **struck 2026-08-27 — H1 and H3 are
scored (one pass in four, and a missed stop; the status block above carries it)**. The H1 component
scores are typed by a
person after a run, because a model judge shares the generator's blind spots. A run cannot produce
an H2 *rate* — a rate needs verdicts, a verdict is what a person did to real work, and a fixture
accepts nothing; `renderH2FromRuns` reports the denominator and says the numerator is missing, and
the rate is read off the database by `npm run eval -- --report` and nowhere else. `budget-exhausted`
is unreachable because the drive freezes the clock, and ADR-0007's `information-missing` class still
has no scenario.

Work is tracked on the [wayfinder map](https://github.com/smukhyala/propositum/issues/1).

[`CONTRIBUTING.md`](./CONTRIBUTING.md) is the working agreement for anyone else committing here — what the guard tests refuse, which invariants are ADRs rather than diffs, and the commit and branch conventions the history follows but never stated. Licensed [Apache-2.0](./LICENSE).

---

## The demo workflow

1. ~~Create a project and approve the sources Propositum may see.~~ **Struck 2026-08-26.** Nothing
   in the product creates a project: `createProject` is private and reached only by accepting an
   offer, on the owner's instruction that *"the user shouldn't have to create it."* Propositum
   watches, notices a subject, offers, and the project is made in your name when you say yes.
   Approving sources is still yours to do, on the project screen and in the extension's side panel.
   **First run starts at ~~`/welcome`~~ [`/first-run`](http://127.0.0.1:3117/first-run)** *(renamed 2026-08-30)*, which reads what is actually
   true — key, paired extension, approved source, pages arriving, phone — and shows the first step
   whose answer is no.
2. **Start session.** You research and draft normally.
3. ~~**Take over.**~~ **Struck 2026-08-26 — the verb is *hand over*.** Propositum shows *what I
   think you're working on*, with the evidence behind each claim. You correct it. Two words for one
   act had the direction pointing opposite ways on adjacent screens: the project page said *Hand
   this over*, the agreement's own button said *Take over*, and a first-timer could not tell who was
   taking over what. `CONTEXT.md` settles it — the person is always the subject, as they are in
   every other consumer verb here.
4. Set the working agreement — what it may look at, what it may change, how far to go, how long.
5. Leave.
6. Come back to *while you were away*: what changed, why, what it couldn't verify, and what it
   needs from you.
7. Accept or reject each change.

---

## Setup

**Installing, without this repository** *(the path built 2026-08-28,
[ADR-0027](./docs/adr/0027-a-sealed-bundle-and-where-the-state-moves.md) — and the release list
is empty until the first `v*` tag ships, which waits on the signing credentials
[`docs/todo/01`](docs/todo/01-menu-bar-app.md) records as open)*: download the `.dmg`
from the [releases page](https://github.com/smukhyala/propositum/releases), drag Propositum to
Applications, launch it, and paste an API key into *Set the API key…* on its menu-bar icon — no
terminal, no Node, no clone. Apple Silicon, macOS 14 or later. The extension still has to be
sideloaded until [`docs/todo/05`](docs/todo/05-chrome-web-store.md) is done. Everything below is
the developer's path.

Requires **Node ≥ 22** and npm. macOS.

```bash
npm install
cp .env.example .env          # add ANTHROPIC_API_KEY from console.anthropic.com
                              # the Google calendar variables are optional — see below
npx prisma db push            # creates the file and installs the append-only guards
npm run dev                   # serves on 3117, and starts the worker beside it
```

**A menu-bar app exists since 2026-08-27** (`src-tauri/`, ADR-0023 stage 1): `npm run build` then
`npm run tray:dev` puts both halves under a supervisor that restarts a crashed child with backoff,
shows one status light, and writes both children's output to
`~/Library/Logs/Propositum/Propositum.log` — the first log this product has had that survives the
terminal closing. ~~It supervises this checkout in production mode (`next start`), takes no macOS
permission (`tests/tray-permissions.test.ts` holds it to none), and every control on it is a link to
a page here. What it does not yet do: hold the key field, run `prisma db push` at launch, or ship as
a signed `.dmg` — that is [`docs/todo/01-menu-bar-app.md`](docs/todo/01-menu-bar-app.md)'s remaining
half.~~ **Corrected 2026-08-28 — that sentence went stale twice.** The key field and the per-launch
`prisma db push` landed with stage 1 itself, on the day the sentence was written; and stage 2
([ADR-0027](./docs/adr/0027-a-sealed-bundle-and-where-the-state-moves.md)) bundles the runtime
and, from the first `v*` tag once the signing credentials exist, ships a signed, notarised `.dmg`
— the pipeline is built and verified unsigned end to end, and
[`docs/todo/01`](docs/todo/01-menu-bar-app.md) records exactly what stays open. An installed copy
keeps its `.env` and
database in `~/Library/Application Support/Propositum/`, while `tray:dev` still supervises this
checkout. It takes no TCC permission; what it does hold, since stage 2, are two hardened-runtime
JIT carve-outs for the bundled Node, and `tests/tray-permissions.test.ts` pins that distinction —
TCC vocabulary banned, the entitlements file pinned to exactly those two keys. Every control on it
is still a link to a page here.

**Then open ~~`/welcome`~~ [`/first-run`](http://127.0.0.1:3117/first-run)** *(2026-08-30 — the tray now opens it in its own window on first launch, as an opening ask routing consent cards; before that, since 2026-08-26, five steps at `/welcome`)*. ~~Five steps, each~~ Facts, each
reading what is actually true rather than tracking a cursor — the key, a paired extension, an
approved source, whether pages are arriving, and the phone — so refreshing, arriving by a link and
coming back tomorrow all land in the same place. There is no progress row to get out of step with
the truth. It is the first onboarding this product has had; before it, a new person's entire
introduction was the front door saying *"Go and read about something for a while."*

Two of the steps above stop being manual there. The extension id is **paired from the screen** and
no longer copied out of `chrome://extensions` into `.env`, and the key is **detected and explained
rather than collected** — no product a person buys asks them for an API key, so that step says out
loud that it is scaffolding for whoever is running the software.

~~`ANTHROPIC_API_KEY` is the only credential needed. SQLite is a local file; there is no cloud, no
account, and no telemetry.~~

**Struck 2026-08-18 — [ADR-0014](./docs/adr/0014-reading-free-busy.md), and left visible because a
reader has to be able to see what was promised.** The same sentence is struck and dated in
[`docs/VISION.md`](./docs/VISION.md) and [`docs/SECURITY_AND_PRIVACY.md`](./docs/SECURITY_AND_PRIVACY.md),
which is why it could not stand here.

`ANTHROPIC_API_KEY` is still the only credential **needed** — everything in the block above runs on
it alone, and that is the state of a fresh clone. *(Amended 2026-08-29,
[ADR-0028](./docs/adr/0028-a-capped-key-ships-in-the-bundle.md), ~~accepted and unbuilt~~ **built 2026-08-30**: a tester
build may carry a spend-capped bundled key, which stops being the person's credential — the ADR
says that cost plainly, and the person's own key outranks it by construction.)* There is still no cloud, no telemetry and no
server of ours — **and as of 2026-08-26 that clause is doing more work than it used to.**
[ADR-0021](./docs/adr/0021-a-thread-on-the-persons-phone.md) adds an optional phone thread, and what
it sends is *derived prose about your own work*: what Propositum thinks you are on, why it stopped,
what it needs you to decide. The worker long-polls Telegram, so there is genuinely no host of ours —
and the sentences still sit on Telegram's servers, unencrypted end to end. The bot is one you create
yourself and we never see it. Leave it unpaired and the feature is **absent**. **But "no account" is
gone**: connecting a Google calendar is optional, off unless
you do it, and it adds `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` to `.env` plus one
OAuth refresh token in the local database. ~~The scope is `calendar.freebusy` and nothing else~~
**Amended 2026-09-01 — the scope granted today is still only `calendar.freebusy`, but "nothing
else" is withdrawn as a promise:
[ADR-0029](docs/adr/0029-the-mailbox-and-a-calendar-of-our-own.md) decides two more (mail without
delete or unratified send; holds on a calendar Propositum creates), neither built yet.** The
free/busy read is *"View your availability in your calendars"*, which returns busy start/end times
and cannot return a title, an attendee or a description. Leave the two variables blank and the
feature is **absent**: nothing is read and no request leaves the machine. ADR-0014 opens on what it
costs, and ADR-0029 on what the widening costs.

~~**For real capture** you also need the extension loaded and its id in `.env`~~ **Amended
2026-08-26 — there is a setup screen now.** Open **~~`/welcome`~~ `/first-run`** *(renamed 2026-08-30)* and it walks the rest: it says whether
the key is there, offers to pair whichever extension has just knocked (no copying an id into a file),
counts the sites you have allowed, says what it is waiting for, and — once there is a real offer —
pairs your phone. `PROPOSITUM_EXTENSION_ID` still wins over anything paired there, so a clone that
sets it behaves exactly as it did.

What has **not** changed: you still have to grant each source from the side panel, because a host
grant needs a user gesture and nothing else can do it.
[`extension/README.md`](./extension/README.md) is still the authoritative order for loading it.

**To see any of this without waiting for an afternoon**, two development seeds:

```bash
npm run seed:shift    # a finished shift with one open question — no model, no network
npm run seed:offer    # replays an afternoon at the real ambient endpoint, so the real detector runs
```

`seed:shift` is the one worth having: it produces a `DecisionNeeded` nobody has answered, which is
the thing a paired phone can answer ([ADR-0022](./docs/adr/0022-the-fourth-verdict.md)). Both refuse
to run under `NODE_ENV=production`.

Whenever the schema changes, `prisma db push` rebuilds the affected table and **silently drops its
append-only triggers**. They are reinstalled and verified at the next app startup; restart before
trusting the database.

```bash
npm test              # unit + schema snapshot tests
npm run typecheck
npm run verify:model  # offline SDK checks, plus a live round-trip if a key is present
```

**Two seed commands, added 2026-08-26, for testing the half of the product a person touches without
waiting for an afternoon.**

```bash
npm run seed:shift    # a finished shift with an open question, in under a second
npm run seed:offer    # replays a real afternoon through the real detector
```

`seed:shift` writes the rows an afternoon would have produced — no model, no network. It
deliberately fakes neither an offer nor capture: a composed offer has no row to write
([ADR-0008](./docs/adr/0008-ambient-detection.md)), and inventing browsing history would put a
fabricated afternoon in the one ledger a person is told is a record of their own.

`seed:offer` writes nothing directly. It posts pages at `POST /api/capture/ambient` exactly as the
extension does, so everything after that is real — the real detector, the real grounds, the real
subject and offer boundaries, and the real message on a paired thread. It costs a model call or two,
and that is the point: *"A fabricated offer would prove that a screen can render a fixture; it would
prove nothing about whether Propositum notices an afternoon."*

Its docblock is worth reading for what happened first. The afternoon was taken from
`src/fixtures/scenarios/lisbon-thread.ts` and **the detector refused it — correctly.** An eval
scenario's pages are shaped for the *worker*: long source text to read, and titles that only have to
identify a source. The detector reads titles, and *"Casa Alfama — rooms and rates"* and *"Miradouro
Rooms — rates"* do not share enough vocabulary to be one subject. Nothing was broken; the two are
answering different questions. The pages were written fresh rather than borrowed and quietly
re-titled, because that would have been **a seed claiming fidelity to a sealed scenario while not
having it**.

---

## Repository structure

```
CONTEXT.md              the ubiquitous language — read this first
docs/                   MVP, vision, principles, research, ADRs
prisma/                 the SQLite schema, including the append-only ledger tables
scripts/                verification utilities
src/app/                Next.js routes
tests/                  offline tests, no credentials required
```

~~`prisma/  SQLite schema (minimal by design until the ledger model lands)`~~ **Re-marked
2026-08-20.** The ledger model landed and is now the largest thing in the schema:
`ObservationEvent`, `ActionIntent`, `ActionOutcome` and `ModelCallRecord` are all in
`prisma/schema.prisma`, and `src/persistence/ledger-writer.ts` is its single writer. The line was
written on 2026-08-06 against a schema that held one model, and it outlived that by a fortnight
while the status paragraph at the top of this file said the ledger was wired. Struck out here
rather than in the block above, because strikethrough does not render inside a fence — and a
description hidden in a code block is not a count, so nothing here could have caught it.

---

## Current limitations

These are properties of the design, not a to-do list.

- **"Leave your desk", not "leave the building".** A lid close can't be blocked, only delayed ~30
  seconds, so a local worker stops when your Mac sleeps. Cloud execution would fix it and is out of
  scope.
- **One shift per session.** Re-entry ends at accept/reject. No *keep going*, no *redirect*.
- **No cross-session continuity.** A second session starts cold.
- **n=1.** One person authors the references and scores the results. Every reported number carries
  that caveat.
- **Budget is time, not money.** Measured on a real boundary at ~$0.033 and ~15 s per model call, a
  30-minute budget buys roughly 120 calls for about a dollar — latency binds long before cost does.
- **Injection can change what the worker attempts, never what it can touch.** But it also reaches
  the session reading, so your review of the agreement is load-bearing rather than a formality.
- ~~**A document comes in as Markdown or plain text, and nothing else** *(2026-08-26)*. Paste it, or
  open a `.md` / `.txt` file. There is no URL import, no Google Docs, no Word and no Notion, and the
  first of those is a capability rather than a convenience — text fetched from a host is untrusted
  in a way a file you picked yourself is not, and it needs an ADR before it needs a button.~~
  **Struck 2026-09-03 — [ADR-0032](./docs/adr/0032-a-page-from-a-source-already-approved.md) is
  that ADR, and the button exists.** A document can now also come in from a page, and the premise
  the struck text states is what bounds it: **only from an origin this project already approved**,
  matched before anything is requested, so an unapproved host is never asked and never learns you
  looked. The text crosses the same `datamark()` door page text always has, and it lands in the box
  in front of you — nothing is stored until you save it. Google Docs, Word and Notion are still
  absent, and each is an integration with its own scope and its own ADR. Two costs, stated because
  they are real: the app process now fetches, which it never did; and it **runs none of the page's
  code**, so a page that builds itself in the browser arrives nearly empty and you are better off
  pasting.
- **One sentence per line is the addressable unit, and the split is imperfect** *(measured
  2026-08-26)*. `Intl.Segmenter` is decisively better than splitting on every full stop, and it
  still ends a sentence at `Dr. Alves` and `No. 7`. The failure makes the unit smaller, which is the
  safe direction — a paragraph-sized unit is what turns a four-word edit into a wall of red — and
  no text is ever lost or altered.

---

## On the broader vision

Everything in [`docs/VISION.md`](./docs/VISION.md) beyond the **Now** sections — multi-project
work, adaptive autonomy, structured app integrations, ~~computer use,~~ cross-device continuity — is
**direction, not commitment, and none of it is implemented.**

**Computer use struck 2026-08-16.** It moved from Later to Now on 2026-08-11
([ADR-0010](./docs/adr/0010-acting-in-the-browser.md)) and this line did not move with it, which is
the same failure as the stale counts above and in the more embarrassing direction: understating what
the product can do is still saying a false thing about it. ~~What is actually true is narrower than
either version — the control channel is built and **no run yet constructs one**, asserted in
`tests/reachability.test.ts`.~~ **Struck 2026-08-20: a run constructs one.** The narrower claim was
true for nine days and is not now — a shift whose ratified agreement grants a kind needing a live
page drives the person's own Chrome, and the gate stops for a person before anything the browser
attests it cannot take back. ~~What has *not* moved is `LANDING_ACTION_KINDS`, still empty.~~
**Moved 2026-09-01 — ADR-0024 built: it holds `complete-purchase`, and a ratified authorisation
can land exactly one covered charge at or under its ceiling. The live purchase itself has not been
made; [`docs/todo/06-buying-things.md`](./docs/todo/06-buying-things.md) keeps that open.**
[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) marks it layer by
layer; [`docs/ROADMAP.md`](./docs/ROADMAP.md) has the stages beyond slice 0.

The project's own principle applies to its README: say the true thing, including when it's
unimpressive. This is a foundation and an experiment designed so it can fail. It is not a product.
