# ADR-0012 — A rolling screenshot cache, refused

**Status:** accepted · 2026-08-17 — **and what it accepts is a refusal.** Ten ADRs in this series
adopt something and [ADR-0010](0010-acting-in-the-browser.md) reverses a refusal. This is the first
one whose whole content is a *no*.
**Reversed in part:** 2026-08-26 by [ADR-0025](0025-computer-use-beyond-the-browser.md) — the refusal
of screen capture, **for acting only**. Screen Recording is taken and a screenshot of the whole
screen is captured per turn under a ratified contract. **The refusal this ADR is actually about
survives untouched:** there is no ambient rolling screenshot cache, observation gets no screenshots,
and the two ledgers stay disjoint (ADR-0025 §5). The cost argument is spent, exactly as
[ADR-0023](0023-the-tray-app-owns-the-runtime.md)'s prohibition 1 predicted — nine days after this
was written.
**Affirms:** [`docs/VISION.md`](../VISION.md) — *"**Not planned, at any horizon.** Full-screen
recording. Keystroke logging. Automatic access to every application. These are not sequencing
decisions."* · [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) — *"**Your screen.** No
screen recording, no video, and no screenshot of anything you are doing."*
~~**Amends:** nothing. **Both sentences above keep their wording exactly.** This ADR is the argument
they never had, not a change to what they say.~~ **Struck 2026-08-26: both are being struck in
place.** `VISION.md`'s bullet loses two of its three clauses — full-screen recording, and automatic
access to every application — and keeps *keystroke logging*, which is unchanged and still true.
`SECURITY_AND_PRIVACY.md`'s bullet loses two of its three and keeps *no video*. That this header
promised their wording would never change, and that the promise lasted nine days, is left on the page
rather than edited away.
**Bounded by:** [ADR-0010](0010-acting-in-the-browser.md) — the one screenshot exception that exists,
and which stays the only one
**Depends on:** [ADR-0008](0008-ambient-detection.md) — what ambient capture is permitted to hold,
and the asymmetry that makes a false positive the expensive failure
**Research:** [`docs/research/intent-signals.md`](../research/intent-signals.md) §3, §5.3, §8 ·
[`docs/research/intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §2.1, §3.4,
§5.3, §7

## Why an ADR is owed for something already forbidden

Meeting notes, 2026-08-17: *"Screenshotting planned, with a rolling cache (roughly 1 hour)"*, under
the heading *Intent Detection and Data Gathering*, beside *"Richer data beyond web pages will improve
model quality."*

Two documents already forbid it in as many words, so nothing has to change for this not to be built.
An ADR is owed anyway, for one reason: **a promise with no argument behind it is the kind that gets
overturned by the first person who arrives with a reason.** This repo has watched that happen. The
`debugger` refusal in [ADR-0002](0002-observation-capture.md) was a **table row** — that ADR argued
the extension over Playwright at length and never argued *that particular no* in prose — and
ADR-0010 reversed it in a paragraph. Correctly, as it turned out; the speed is the point. A refusal
that is only a sentence in a privacy document is an idea that comes back every few weeks until
someone says yes on a Friday.

The contrast inside the same ADR is the model for this one. ADR-0002 *did* argue the refusal it
cared about — it gave up `transitionType`, said what it took instead
(*"`document.referrer` and the Navigation Timing `type` as partial substitutes"*), and named the
condition that would reopen it: *"Revisit if H1 scores poorly and ablation implicates navigation
intent."* That still reads as a decision. The `debugger` row read as a preference, and was treated
as one.

So this is written to be read back. Not *we did not build it*; **we priced it, against the two
research notes commissioned to price it, and declined.**

## The proposal, at its strongest

A rolling cache of full-screen frames, roughly an hour deep, on the person's own machine — captured
periodically, indexed locally, thrown away as it ages out. It would be the input to detection
alongside browsing metadata.

**Stated as its advocates would state it, because the weak version is not worth refusing:**

- **It sees the work that is not in Chrome.** A person writing in a document, reading a PDF in
  Preview, in a terminal, in a native banking or messaging app, is invisible to Propositum today, and
  the product's own framing — *notice what you are working on* — quietly means *notice what you are
  working on in one application*.
- **It sees what a person wrote, not which page they had open.** Every ambient observation in this
  system is a fact about a *destination*: a cleaned URL, a title, a dwell figure. None of them is a
  fact about the **content of the work**. A frame of a half-written paragraph is evidence of a kind
  the whole detection pipeline currently has to guess at.
- **It answers the question `detectPause` cannot.** `chrome.idle` reports that the machine has had no
  input, and `detectPause` treats that as *they stepped away*. Someone who switched to their editor
  and is working harder than before produces the same reading
  ([`intent-signals.md`](../research/intent-signals.md) §5.1). Frames would separate those two
  afternoons trivially.
- **It is the one signal on the list with no ceiling.** Everything else researched buys a specific
  fact. Frames buy whatever turns out to matter later, which is a real property and the reason
  people keep proposing them.

None of that is wrong. It is refused on price.

## Why it is refused

### 1. It is the most expensive item on a ranked list, and nothing near it is close

*(Re-quoted 2026-08-17, the same day this ADR was accepted. The first version of this section said
"fourteen signals" and "row 13 of 14", reproduced the table row under the wrong number with a cost
cell in its own words, and presented one sentence as a verbatim quotation from the note that the
note does not contain. Corrected against `intent-signals.md` §3 line by line. The error mattered
more here than it would elsewhere: this is the first and most-cited refusal in the document, and it
rests entirely on the note being quoted accurately.)*

[`intent-signals.md`](../research/intent-signals.md) ranks **sixteen** signals by what each buys
divided by what it costs. A rolling screenshot cache is **row 15 of 16** — above only `CGEventTap`
input monitoring, which the note does not treat as a tradeoff at all (*"excluded by the founding
brief and by `SECURITY_AND_PRIVACY.md`. Not a tradeoff; a line"*). Row 15, reproduced as the note
writes it:

| # | Signal | What it buys | What it costs | Reversible? |
|---|---|---|---|---|
| **15** | Rolling screenshot cache | everything, indiscriminately | Screen Recording TCC, recurring system alerts, a **restricted Apple entitlement framed as VNC-only**, 48 GB/month, and **a documented reversal** | Yes — but the promise does not come back |

On why rows like it appear on the list at all, the note is explicit, and this is its actual sentence:
*"Rows 15–16 are here because the brief asked for them to be priced, not because the price is worth
paying."* Its closing line about the whole table is the one worth carrying into a product decision:
*"More observation is the expensive way to guess at something people keep writing down."*

**The frontier framing in this document is this ADR's own and is not the note's.** The note ranks and
prices; it nowhere uses the phrase *efficient frontier*, and the sentence that used to appear here
inside quotation marks was written by this ADR. Stated in the ADR's own voice, with no borrowed
authority: **screen recording, keystroke logging and a rolling screenshot cache are the three rows
where the price stops being a tradeoff.** They cost the largest privacy surface on the list, the
strictest permission gate macOS has, a system indicator held for as long as capture runs, and a
reversal of a promise `VISION.md` and `SECURITY_AND_PRIVACY.md` both make without a horizon on it.
That is an argument, it is arguable, and it should be answered rather than deferred to.

The permission gate is *Privacy & Security › Screen & System Audio Recording*
([§5.3](../research/intent-signals.md)); the modern API is ScreenCaptureKit (macOS 12.3+), with
`CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()` as the preflight/request pair.
It is the strictest consumer-visible gate on the machine, and macOS shows a system indicator for the
whole time it is held — **by design, and we would not want it otherwise.**

**And Propositum cannot reach any of it today.** ~~There is no macOS binary.~~ **Struck
2026-08-28 — false since ADR-0023's stage 1 (2026-08-27), and this file was missed by the same
sweep that missed ADR-0014; [ADR-0027](0027-a-sealed-bundle-and-where-the-state-moves.md) has
since given that binary a signing pipeline. This ADR's refusal of an ambient screenshot buffer is
untouched, exactly as ADR-0025 restated.** Frames would require a
signed and notarised native helper, a native-messaging host manifest, the `nativeMessaging`
permission (*"Communicate with cooperating native applications."*) and a launchd agent to keep it
alive. The research puts that plainly: *"That cost is larger than every TCC prompt below put
together."* So the proposal is not "add a capture loop"; it is "become a desktop product", which is
also conflict 2 in the meeting notes and is not this ADR's to settle.

### 2. The returns on additional behavioural signal flatten after two, and the two cost nothing

This is the argument that would still hold even if frames were free.

Fox et al. (TOIS 2005) is the founding implicit-feedback study, and it ran the ablation nobody quotes
([`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §2.1):

| Model | Accuracy predicting a satisfied visit |
|---|---|
| Clickthrough alone (baseline) | **40%** |
| **Dwell + exit type — two variables** | **66%** |
| All nineteen predictors | **70%** |

Verbatim: *"Using just these two variables in the Bayesian model, accuracy for predicting SAT was
66%… **both of which were very close to the model using the full set of 19 predictor variables**."*
Two signals recover about 94% of the full model. **Seventeen more buy four points.** Propositum
already collects one of the two, and the other is one enum on an existing schema.

The same shape appears in the only published work that observes a person's whole screen and decides
whether to speak. ProAgentBench (arXiv:2602.04482, Feb 2026) collects **screenshots at 1 Hz plus
application metadata over 500+ hours** — 28,528 events — with hard negatives deliberately chosen to
resemble genuine trigger moments. Best frontier accuracy on *should I intervene now* is **64.4%**;
precision across all models is **51.6–60.8%**; recall is **81–99%**, so every model over-triggers.
That is with vastly more observation than this product will ever hold, on data gathered for the
purpose. Its observation-window ablation reports *"diminishing returns beyond the 5-minute mark"* —
one sixth of `WINDOW_MS`.

The conclusion this repo has to take from that is not comfortable but it is clear: **the binding
constraint on this product is not the richness of what it watches.** It is the decision threshold and
the one or two facts only the person has. A cache would spend the largest privacy budget available on
the axis with the least evidence behind it.

### 3. The arithmetic arrives before the argument, and it does not survive it either

Frames are only useful if something reads them, and reading them costs money this product has
published a claim about ([`intent-signals.md`](../research/intent-signals.md) §8.2). Per Anthropic's
vision documentation an image costs `⌈width/28⌉ × ⌈height/28⌉` visual tokens; a full-resolution
Retina frame is about **4,784 tokens, or $0.0239**:

| Capture interval | Frames per hour | Cost per hour of watching |
|---|---|---|
| every 5 s | 720 | **$17.22** |
| every 30 s | 120 | **$2.87** |
| every 60 s | 60 | **$1.44** |

Beside that, the figure [`docs/MVP.md`](../MVP.md) already publishes in the row explaining why there
is no cost dial: *"Measured on a real boundary at \$0.0325 and 15.1 s per call: a 30-minute budget
buys ~120 sequential calls, about a dollar. **Latency binds; cost never does.**"*

**Interpreting one frame a minute costs more per hour than an entire half-hour handoff run.** The
sentence *cost never binds* is load-bearing for a shipped decision, and a cache would make it false
the day it landed. Downsampling to the standard tier (1,568 tokens) brings once-a-minute to roughly
$0.47/hour — still half a handoff run per hour spent on watching rather than working.

Storage is smaller but not nothing: at roughly 2 MB per Retina PNG — **an estimate, not a cited
figure; Apple publishes no representative size** — one frame every five seconds is about 1.4 GB/hour,
or 11 GB in an eight-hour day.

### 4. No published evidence that frames beat structured metadata here — an absence, not a proof

Stated precisely, because the temptation is to round it up into a result.

**What was found** are head-to-heads on *agent action*, and they go against pixels. OSWorld
(arXiv:2404.07972) runs identical models over identical desktop work with different observation
spaces: for GPT-4o the accessibility tree alone scores **11.36%** against **5.03%** for the
screenshot alone — **2.26×** — adding the screenshot on top makes it slightly worse, and the single
best cell in the table is a text-only model reading a structured tree (**12.24%**). Microsoft's own
WindowsAgentArena finds accessibility markers worth up to **+57%** on top of the best pixel parsing.
Apple's *Screen Recognition* is the honest counter-case and it is about **coverage**, not accuracy —
59% of screens have annotations matching no accessible element — which is a strong argument in an
application with no accessible structure and a weak one in a browser.

**What was not found** is the comparison that would actually decide this: nobody has published
whether screenshot-derived context names *what a person is working on* better than URLs, titles and
dwell do. There is no benchmark for it —
[`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §3.4 reports that **no
primary source segmenting a full page-visit stream into threads of work could be found at all**;
every published result is query-log based. `findThreads` is doing something the literature has not
measured, so neither has anyone measured the thing that would replace it.

**That is an absence of evidence and it is not evidence of absence.** A rolling cache might work
better. The claim here is narrower and it is the only one the research supports: *there is no
published result to point at, in either direction, and the burden of producing one sits with the
proposal rather than with the refusal.* If the cache is ever built, it will be built on a bet, and it
should be described that way rather than as a known improvement.

The one thing periodic visual capture *is* demonstrated to do well is help a **human** remember.
Microsoft Research's SenseCam work reports an amnesia case study in which recall of an event *"nearly
tripled"* over two weeks of review, reaching *"a 76% average recall"*. That is a real and impressive
result about a person reviewing images. **It is evidence for a recall product. It is not evidence for
this one** — and pointed the other way, automatic retrieval over a personal visual archive is
published at **MAP 0.045–0.063** (NTCIR-14 Lifelog-3), against 0.399 with a human steering.

### 5. Microsoft Recall — accurately, including where the research is thin

Recall is the only shipped rolling-screenshot cache with first-party documentation, so it is the
nearest thing to a natural experiment. Four things in its record bear on this decision, and the
fourth is the one that should settle it.

**It converts pixels back into text before anything can find anything.** Microsoft Learn: *"Recall
uses optical character recognition (OCR), local to the PC, to analyze snapshots and facilitate
search"*, into a vector database. A product team building exactly this arrived at §4's conclusion
independently: the retrieval index is text either way, and the only question is whether you inherit
the structure or pay to rebuild it.

**Microsoft's own verb for the sensitive-content filter is "helps reduce", not "prevents"** —
*"Sensitive content filtering is on by default and helps reduce passwords, national ID numbers and
credit card numbers from being stored in Recall."* The reference page lists roughly 170 detected
types and **publishes no accuracy figure, no false-negative rate, and no stated limitation.**
Microsoft also documents one leak directly relevant to a browser product: *"Parts of filtered
websites can still appear in snapshots such as embedded content, the browser's history, or an opened
tab that isn't in the foreground."*

**Independent testing of the hardened, re-released version found the filter failing.** Kevin
Beaumont, April 2025, on shipped Recall on a Copilot+ PC: *"The feature to filter sensitive data
doesn't appear to work reliably, across multiple devices from testing"*; a valid credit card number
was captured and indexed, *"It captured and indexed the CVV, too"*; and *"Recall still captures and
stores things after deletion"*, including disappearing Signal and WhatsApp messages.

**And encryption at rest does not defend a cache that a process on the same machine must be able to
read.** The current version of Alex Hagenah's TotalRecall no longer attacks the encryption at all —
it injects into the unprotected rendering process that receives decrypted data, and reads plaintext
without admin rights. **That is precisely the threat model a local-first product on a developer's
laptop lives in**, and it is the sharpest form of the largest-privacy-surface argument in §1: a
compromised machine, or a subpoena, gets the hour.

**Where the research is thin, and it is thinner than the paragraphs above make it look.** The two
notes disagree about what could be retrieved:
[`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §7.3 quotes Microsoft Learn
directly, while [`intent-signals.md`](../research/intent-signals.md) §8.4 records that Microsoft's own
Recall documentation could not be retrieved in that session at all. Both notes flag the widely-quoted
*"every 5 seconds"* and *"25 GB ≈ 3 months"* figures as appearing on **no Microsoft primary page
checked** — treat both as unsourced. Microsoft's published security account names months of internal
review and an independent third-party penetration test, but **the vendor is not named and no results
were published**; there is no MSRC-channel write-up. The UK ICO's June 2024 statement exists in this
corpus only as **SECONDARY** press coverage and could not be verified.

**So the argument this ADR takes from Recall is the narrow one**, and it is deliberately not *"Recall
was badly received, therefore no"*. Reception is not evidence. What is evidence: the filter is
first-party documented as partial, was independently measured failing, and the store is readable by
same-user code. Those three would be true of any cache we built, because they are properties of the
shape rather than of Microsoft.

## What was chosen instead, and the honest comparison

Three things, all of which cost less than one TCC prompt and none of which requires a native binary.
They are the top of the same ranked list that puts a cache at row 15.

| Chosen | Cost | What it buys | Where it is argued |
|---|---|---|---|
| **Scroll depth** on the ambient path | one optional number; `content.js` has computed it all along and the ambient schema had no field for it | the only defence against *"three tabs opened and skimmed"* that is not a dwell threshold. Claypool: time, scroll, and their combination are the three things that correlated with interest | [`intent-suggestion-quality.md`](../research/intent-suggestion-quality.md) §10.2 |
| **Exit type** — how a page was left | one enum on an existing schema; the extension already knows the answer | the co-equal top variable in Fox et al., and the difference between *read it and moved on* and *bounced straight back* | §10.1 |
| **Human-authored salience** — tab group titles, reading list, bookmarks | one honest Chrome warning each, optional and requestable in context | **a thread name the person typed themselves** | [`intent-signals.md`](../research/intent-signals.md) §3, §4.3 |

The third deserves its own sentence, because it is the one that reframes the whole question. The
signals research ranks `tabGroups` second of sixteen overall, and of the Chrome APIs it says
*"`tabGroups` is the best signal in this table and it is not close"*:
`topics.ts` runs a stopword list, a branding-suffix regex and a Damerau-Levenshtein neighbour test to
reconstruct a label a person would recognise, and `boundaries/subject.ts` then spends a model call
turning it into a sentence. **A tab group titled *"world models"* is that sentence, authored by the
person, with no model call and no possibility of a confidently-wrong name.** The output the detector
is straining to reconstruct is occasionally sitting in the browser already, typed.

**And the honest half of that comparison.** These are not a substitute for what a cache would have
seen; they are cheaper answers to a narrower question.

- **They are all inside Chrome.** Every one of them is blind to a document, a PDF, a terminal or a
  native application, which is exactly the gap the proposal was aimed at. Nothing chosen here closes
  it, and nothing above claims it does.
- **`tabGroups` is excellent when present and absent most of the time.** Most people do not use tab
  groups. It is the right shape for an optional permission and the wrong shape for a dependency —
  it may raise confidence and must never gate detection.
- **Exit type and scroll are better measurements of what is already measured.** They sharpen
  `read-deeply`; they do not add a new kind of fact. The evidence says that is where the returns are,
  and the evidence could be wrong.

## What this changes in the code

**Nothing.** No threshold moves, no ground changes, no session that qualifies today stops qualifying,
and no model runs anywhere in the detection path — [ADR-0008](0008-ambient-detection.md)'s rule is
untouched and this ADR does not reopen it. The signals in the table above land under their own
tickets, on their own evidence, and **a signal landing must not silently retune a constant** — the
thresholds in `grounds.ts` are guesses set before real browsing existed, they are named as guesses,
and moving them is a separate decision that needs its own measurement.

## What would have to be true to revisit

Written concretely, in the form [ADR-0002](0002-observation-capture.md) used for the refusal it did
argue — the thing given up, the substitute taken, and the condition that reopens it. **Three
preconditions, all of them, not any of them.**

**1. Evidence, on this repo's own fixtures, that the cheap signals are exhausted.** The order is
fixed: land exit type and scroll, narrow `came-back` to cross-origin returns, take the free Chrome
signals, and **measure**. This repo has an eval harness for exactly this. The case for a cache begins
with a scored comparison showing detection quality flat after those, and it should include the number
`PRODUCT_PRINCIPLES.md` §13 already names as missing — **how often Propositum speaks at all**, not
just how often it is right. Absent that, *"richer data beyond web pages will improve model quality"*
is a hypothesis with a published counterexample (refusal 2 above) rather than a finding.

**2. A permission story a person can hold in their head, and four facts nobody has established.**
Minimally: capture that is **off by default**, requested at the moment it would help rather than at
install, with a visible in-product indicator that is ours in addition to the system's, an obvious
kill switch, and per-application or per-window exclusion that we do not describe as reliable —
because Rewind's exclusion controls were sincere, documented, and leaked anyway, and
[`docs/VISION.md`](../VISION.md) already quotes that warning *against ourselves* rather than against
them.
Before any of that is designed, [`intent-signals.md`](../research/intent-signals.md) §5.3 lists four
things that must be established **on the machine**, not from documentation: (a) the verbatim macOS
screen-recording consent text, (b) whether macOS 15+ re-prompts periodically, (c) whether
`SCShareableContent` enumeration is gated behind the permission, and (d) whether `kCGWindowName` —
another application's window title — is. All four are widely asserted and none is sourced.

**3. A local-inference story good enough that frames never leave the machine — and this is the
precondition with the least evidence behind it.** A cache whose frames reach a hosted model is not a
local-first product, and the arithmetic in refusal 3 above prices that path out anyway. So the frames
would have to be read on-device, and the honest state of that is:

- **Apple's Foundation Models** can classify and tag text on-device, but the observation window is
  **4,096 tokens total**; it is **rate-limited specifically in the background** at an unpublished
  rate, and Propositum's whole premise is working while the person is away; and Apple
  *"periodically updates `SystemLanguageModel` in routine OS updates"*, which trades a privacy gain
  for the exact reproducibility `EVALUATION.md` depends on. `CONTEXT.md` bans timer-driven model
  calls partly because they make fixtures unscoreable; a model that ships with a point release of
  the operating system is worse on that axis, not better.
- **`VNRecognizeTextRequest`** would do OCR with no TCC grant of its own — capturing the pixels is
  the whole cost — but Apple publishes no latency or accuracy figure for either recognition level.
- **Whether a 3B–8B local model can name what someone is working on from a dozen titles is unknown.**
  No first-party benchmark answers it. It is *"an eval, not a citation"*, and it is a day's work
  against `subject@1` on existing fixtures.

**If those three are met, the ADR that reverses this one must open by saying what it costs**, in the
form ADR-0010 used: that *"no screen recording"* can never be said again, because a promise withdrawn
once is not a promise. That is the price, and it is not refundable by a good implementation.

## The honest limit of this refusal

**The strongest argument against this ADR is inside it, and it is this: Propositum cannot see work
that does not happen in Chrome, and for the people it is being aimed at that is a real fraction of
the work.**

The stated ICP is students and recent graduates: booking appointments, managing finances, and the
rest of the grown-up administration they are doing for the first time. Some of that is browser work
and the product will see it. Some of it is not: a banking or brokerage application on a desktop or a
phone, a PDF of a lease read in Preview, a form
downloaded and filled in a native reader, a conversation in Messages about when the appointment
actually is. Every one of those is invisible here, permanently, by this decision. The gap is not a
sequencing problem that later work closes; it is the shape of the product.

Three further limits, none of them rounded down:

- **The chosen signals do not address the gap at all.** Scroll, exit type and tab group titles make
  Chrome-shaped detection sharper. They do not make it wider. Anyone reading *What was chosen
  instead* as a replacement for the proposal has read it wrong.
- **`detectPause` still cannot tell *gone* from *working elsewhere*.** That defect is real, the cache
  would have fixed it, and this ADR does not. The cheaper fix — frontmost-application **identity**
  only, which needs no TCC prompt — is a different decision and deserves its own ADR, which this one
  does not pre-empt in either direction. Keeping *which application* and *what is in it* apart is
  most of the value here; they will arrive as one proposal.
- **Refusing on an efficient-frontier argument is a bet that the frontier does not move** — and the
  frontier framing is this document's, not the research's, which is worth saying twice because §1
  once presented it as a quotation. Local
  models get better and cheaper. If the day comes when frames are read on-device by a pinned model at
  no meaningful cost, refusal 3 evaporates and refusal 2 weakens, and what is left is the privacy
  surface and the promise — which is a smaller case than the one made here, and it should be argued
  on its own terms rather than by pointing back at this document.

## Revisit when

- **The cheap signals are landed and measured, and detection quality is flat.** That is precondition
  1, and it is the only route to reopening this that is not an assertion.
- **Someone proposes a cache "just for the current window", or "only while a session is running", or
  "only of Chrome".** Each of those sounds narrower and none of them is: the permission is the same,
  the store is the same, and the retention is the whole point. A narrowing that keeps the gate needs
  this ADR reopened, not routed around it.
- **A desktop process is built for some other reason.** Once a native helper exists, the marginal
  cost of a capture loop looks small and the standing argument in §1 gets quietly cheaper. That is
  when this document matters most, and it is the failure mode to watch for.
- **ADR-0010's screenshot exception is proposed for widening.** *"A screenshot only when the tree is
  insufficient"*, of a tab Propositum opened, under a ratified agreement, swept within seven days, is
  bounded by three facts a cache has none of. Widening it is this decision under another name.
- **The frontmost-application question arrives.** Expect it bundled with screen capture; unbundle it
  before deciding either.
