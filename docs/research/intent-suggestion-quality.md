# Does richer observation produce better intent inference? And does better inference produce a suggestion anyone accepts?

_Researched 2026-08-17. Commissioned directly — there is no issue. It feeds
[ADR-0008](../adr/0008-ambient-detection.md), the offer bar in `src/domain/detection/grounds.ts`, and
`docs/PRODUCT_PRINCIPLES.md` §13._

_Every number below is linked to a primary source in [§12](#12-sources). Where only a secondary source
exists it says **SECONDARY**. Where a widely-repeated claim turned out to have no traceable primary
source, that is reported as a finding rather than quietly filled in — and there are **three** of those
([§11](#11-open-questions-and-what-nobody-has-published)), two of which are constants this repo or its
arguments currently lean on._

_**Method note, because it changed what is in this document.** Rendered-PDF summarisation fabricated
numbers on the first paper attempted — an invented dataset size, an invented precision figure, and an
inter-annotator κ that does not exist anywhere in the paper. Everything quantitative below was
re-extracted with `curl` → `pdftotext -layout` → direct read, or read off raw HTML. Several numbers in
this literature exist **only as chart pixels** rather than in any table; those are flagged at the point
of use and should not be quoted to more than one significant figure._

---

## 0. Bottom line

The plan is a chain of four arrows:

> **more signal → better intent inference → better suggestions → more acceptance**

The evidence supports the first arrow *weakly and only for the first two signals*, is thin on the
second, is actively discouraging on the third, and **contradicts the fourth as it is usually drawn**.
Eleven findings, in order of how much they should change what gets built next.

**1. The returns on additional behavioural signal flatten after two signals, and this was measured
twenty years ago.** Fox et al. (TOIS 2005) is the canonical implicit-feedback study and it ran the
ablation nobody quotes. Clickthrough alone predicts a satisfied result visit **40%** of the time.
**Dwell time plus exit type gets to 66%. Adding the other seventeen signals gets to 70%.** Two signals
buy twenty-six points; seventeen more buy four ([§2.1](#21-what-implicit-signals-actually-predict)).
Propositum already collects one of the two.

**2. The single best-evidenced signal Propositum is not collecting is `exit type` — how a page was
left.** It is co-equal top variable with dwell in Fox et al., and it is the one that separates *"read
it and moved on"* from *"bounced straight back"*. Second-best is **scroll** — which arrived on the
ambient path on 2026-08-17, mid-research, and which `AmbientObservation.scrollFraction` records as
*"Nothing reads it"*. The wire is fixed; the ground that should use it is not
([§9](#9-signal-by-signal-verdict-for-propositum), [§10.2](#102-make-scrollfraction-do-something-half-landed-while-this-was-written)).

**3. Two of this repo's constants are folklore with no primary source.** `WINDOW_MS = 30 minutes`
inherits the 30-minute session timeout, which traces to Catledge & Pitkow 1995 — where the number is
**25.5 minutes**, is *mean + 1.5 SD of inter-event idle gaps*, was never validated against any ground
truth, and explicitly measures **when someone walked away from the browser, not where a task ends**.
Jones & Klinkner then measured that a 30-minute timeout scores **57.2%** on goal boundaries against a
**63.1%** do-nothing baseline — worse than doing nothing — and wrote *"The 30-minute standard receives
no support from our results"* ([§3.1](#31-the-30-minute-window-is-folklore-and-the-folklore-is-wrong)).
Separately, `DEEP_READ_MS = 60s` sits next to the industry's "30-second dwell = satisfied" heuristic,
and **that heuristic has no traceable origin either**: the paper universally credited with it does not
contain it, and reports 58.4 s ([§2.2](#22-the-30-second-dwell-threshold-has-no-primary-source)).
The good news for this repo is that 60 s is much closer to the measured number than 30 s is.

**4. `came-back` is probably measuring hub-and-spoke navigation, not intent.** Adar, Teevan & Dumais
analysed five weeks of browsing from **612,000 users**. In the sub-hour revisit band — the *only* band
a 30-minute window can see — **77.0% of revisits came from the same domain**, the fast group had the
highest proportion of same-site links (87%), and only **2.9%** of those pages were reached via a
search. The self-reported intent behind that band is *"Buy something, monitor live content."*
`visitsByUrl` already excludes reloads; it does **not** exclude same-domain returns, which is exactly
the 77% ([§9.3](#93-came-back-is-the-weakest-ground-and-the-fix-is-one-predicate)).

**5. Nobody has shown that a system can decide *when* to speak.** ProAgentBench (Feb 2026) is the
closest published analogue to what Propositum does: 1 Hz screenshots plus app metadata from **500+
hours** of real desktop sessions, 28,528 events, with hard negatives deliberately chosen to look like
real trigger moments. Best frontier accuracy on "should I intervene now" is **64.4%**, precision
across all models **51.6–60.8%**, recall **81–99%**. Every model over-triggers. The paper's own
framing: *"Low precision leads to alert fatigue, excessive false alarms causing users to ignore or
disable assistance features"* ([§5.3](#53-proagentbench--the-closest-published-analogue-to-this-product)).

**6. The history that matters is short — and Propositum's window is already past the plateau.**
ProAgentBench ablates the context window at 10 s / 30 s / 1 min / 2 min / 5 min / 10 min and reports
*"diminishing returns beyond the 5-minute mark"*. Agichtein et al. (SIGIR 2012) found one week of
prior history gave **no significant** gain over none at all; only two weeks did. There is no evidence
anywhere that the span between five minutes and thirty minutes is where suggestion quality lives
([§4](#4-arrow-2--how-much-history-and-how-much-personalisation)).

**7. The false-positive framing in ADR-0008 is right, and the literature makes it sharper in two ways
the ADR does not say.** First, **the cost is irreversible**: LinkedIn measured that halving email
volume cost **2.6%** of page views but cut negative responses by **45%**, and noted *"If a member
clicks the unsubscribe option within an email, we lose the ability to send any emails of that type to
that member in the future."* Second, **removing suggestions can raise acceptance without reducing
output**: JetBrains' completion filter *"boosted the acceptance rate by ~50% and cut the explicit
cancel rate by ~40%"* with the ratio of completed code held steady, and Google's semantic filter
removed 80% of uncompilable Go suggestions and acceptance improved **1.9×** over six weeks
([§6](#6-arrow-4--the-false-positive-economy)).

**8. The only shipped product that did exactly this thing shipped at ~63–67% precision and reported no
acceptance data at all.** Yahoo! Search Pad (WWW 2010) detected "research missions" in web search and
proactively asked *"Do you want to take notes?"*. Research missions were **10% of sessions and 25% of
query volume**. The shipped thresholds put precision at roughly two in three — **one in three prompts
fired on a session that was not research** — and the one engagement fact the paper reports is
negative: *"the Click-Through Rate … remained constant independently of the coverage."* The feature
then vanished with **no published post-mortem** ([§5.2](#52-yahoo-search-pad--the-one-that-actually-shipped-this)).

**9. There is no false-positive cliff, and the question should be retired.** The brief asked at what
false-positive rate people stop reading. The best evidence says there is no such rate. Bliss, Gilson &
Deaton (1995), across 25% / 50% / 75% reliable alarm systems: *"most subjects (about 90%) do not respond
to all alarms but **match their response rates to the expected probability of true alarms**."*
Engagement degrades roughly **linearly with precision** — a system at 30% precision gets roughly 30%
engagement. There is no line to stay above, which means the useful question is *"what is our precision,
and is anyone measuring it"* — and in this repo nobody is
([§6.7](#67-at-what-false-positive-rate-do-people-stop-reading-there-is-no-cliff)).

**10. Habituation is faster than expected and it generalises.** Bravo-Lillo et al. (SOUPS 2013):
engagement with a repeated dialog fell from **10.48 s to ~1.0 s median — about a 90% collapse, with 42%
of it after a single exposure**; only 13–19% then noticed when the text changed to say something
critical. Anderson et al. (CHI 2015): *"a dramatic drop in the visual processing centers of the brain
**after only the second exposure**."* And Vance et al. (SOUPS 2019): habituation to *routine* notifications
**transfers to important ones that look similar** (OR 2.60 at the fifteenth exposure). **Every correct-
but-unimportant offer trains the person to dismiss the offer *shape*.**

**11. The "asking beats inferring" case is real but weaker than it first looks, and the walk-back is
part of the finding.** Asking one clarifying question has an enormous ceiling — Qulac's oracle gives
**+101% MRR** — but the best real question-selector captures under half of it (+33.5%), **a bad question
is worse than not asking at all (−8.7%)**, and in the only direct head-to-head anyone has run, passive
behavioural profiling **beat idealised explicit relevance feedback** (Teevan et al., SIGIR 2005, p<0.05).
People also cannot fully articulate intent: three participants who gave the same stated intent agreed on
**one page out of forty** ([§8](#8-asking-instead-of-inferring)). Ask about a **standing constraint**,
which people can state and which stays true; do not ask about intent, which they cannot.

**What follows from all eleven.** The binding constraint on this product is not the richness of the
observation. It is (a) the decision threshold, which is currently a fixed conjunction of grounds with no
notion of probability or cost, (b) the **timing**, which the interruption literature says matters more
than the content and which nothing here optimises, and (c) the acquisition of the one or two standing
facts only the person has. The cheapest genuinely-evidenced improvements are, in order: carry **exit
type** and **scroll** on the ambient path; narrow **`came-back`** to cross-origin returns; **measure the
offer rate**; and ask **one short question about a standing constraint**, on Home rather than in a
notification ([§10](#10-what-this-means-for-the-code)).

**Two things this document had to walk back**, recorded because a brief that only confirms is not
worth much: the asking case in finding 11 was initially written as one-sided and is not; and Bennett et
al. 2012, cited everywhere for "how much history helps", **does not measure history depth at all** and
says so ([§4.1](#41-how-much-history-actually-helps)).

---

## 1. The question, and the four arrows

Propositum watches a browsing stream, groups pages into subject threads (`findThreads`), applies an
arithmetic bar (`detectWork`), applies a second, higher arithmetic bar before offering to do work
(`groundsFor`), and then interrupts a person with a notification. The team is about to invest in
gathering much richer data — more signals per page, possibly a rolling screenshot cache — on the
assumption that this improves suggestion quality.

That assumption is a chain, and each link is a separate empirical claim:

| # | Arrow | What would have to be true |
|---|---|---|
| **1** | more signal → better intent inference | Additional behavioural signals carry non-redundant information about what a person is trying to do |
| **2** | better inference → better suggestions | A more accurate model of the *subject* produces a more useful *proposal* |
| **3** | better suggestions → more offers accepted | Quality is what limits acceptance, rather than timing, framing, or trust |
| **4** | more accepted → a better product | Acceptance rate is the thing worth maximising |

The rest of this document attacks each arrow. §2 and §3 are arrow 1. §4 is arrow 2. §5 is arrow 3.
§6 is arrow 4. §7 and §8 are the two specific bets on the table — screenshots, and asking. §9 and §10
are what any of it means for the code in this repo.

---

## 2. Arrow 1a — implicit signals: what they predict, and where the curve flattens

### 2.1 What implicit signals actually predict

**Fox, Karnawat, Mydland, Dumais & White, TOIS 2005** is the study everything else in this area cites.
146 Microsoft employees ran an instrumented IE for about six weeks, rating result visits SAT / PSAT /
DSAT, while over thirty implicit measures were logged — dwell in two forms, scroll count and extent
and timing, time-to-first-click, time-to-first-scroll, result position, visit count, exit type, page
size, image count, script count, print, add-to-favourites ([Table II][fox]).

The headline numbers, verbatim:

- Baseline — always predict SAT when a result is clicked: **40%** accuracy on test data.
- Full Bayesian model over nineteen predictors: predicts SAT **70%** of the time; **57%** overall
  across the three-way judgement.
- Restricted to cases where the model was confident (top outcome > 50%): **77%** SAT, **66%** overall,
  but covering 407 of 698 test cases.
- Session level: **74%** SAT, **70%** overall, against a 56% baseline.

And then the sentence that should govern this whole project:

> *"The two most important variables in the Bayesian model were Difference in Seconds and Exit Type…
> Using just these two variables in the Bayesian model, accuracy for predicting SAT was **66%** and
> **56%** for all three judgments overall, **both of which were very close to the model using the full
> set of 19 predictor variables**."*

**Two signals recover about 94% of the full model's SAT accuracy and about 98% of its overall
accuracy.** Seventeen further signals — every scroll variant, every page characteristic, print,
favourites, timing-to-first-anything — buy four points and one point respectively.

This is the strongest single piece of evidence against the team's assumption, and it is not a
marginal or contested result. It is the ablation inside the paper that founded the field.

**Claypool, Le, Wased & Brown (IUI 2001)** is the other foundational study and it agrees on which
signals matter. 75 students, 2,267 pages visited, 1,823 explicitly rated. Verbatim: *"the time spent
on a page, the amount of scrolling on a page and the combination of time and scrolling had a strong
correlation with explicit interest, while individual scrolling methods and mouse-clicks were
ineffective in predicting explicit interest."* On clicks specifically: *"The Kruskal-Wallis test
failed to reject the null hypothesis… the number of mouse clicks is not a good indicator of
interest."*

⚠️ **Despite the phrase "strong correlation", Claypool et al. report no correlation coefficients at
all** — the analysis is box plots and Kruskal-Wallis tests. Any citation giving an *r* value for this
paper is citing something that is not in it.

So the two independent foundational studies converge: **dwell and scroll are the signals; almost
everything else is decoration.** Fox adds exit type, which Claypool did not measure.

### 2.2 The "30-second dwell" threshold has no primary source

This is a genuine negative finding and it is worth stating flatly.

**Kim, Hassan, White & Zitouni (WSDM 2014)** write: *"A dwell time equaling or exceeding **30 seconds**,
as proposed in [14], has typically been used to identify clicks with which searchers are satisfied"*
and *"the most popular threshold being 30 seconds [14]."* Their reference [14] is Fox et al. 2005.

**Fox et al. 2005 contains no 30-second threshold.** Its time cut-points are learned decision-tree
splits at **58.4 s**, **27.1 s** and **9.93 s**, and they are conjunctions, not thresholds. The
satisfaction node reads: *"when users spent more than 58 s on a page (which had lots of images and was
in the top three results) and did not go back to the results list, they were satisfied with the page
**88%** of the time."* The dissatisfaction node: *"when users spent very little time on a page and
they did go back to the results list, they were likely to be dissatisfied (with a probability of
**73.4%**)."* Both nodes require **exit type**, not dwell alone.

No paper proposing 30 seconds could be located. White & Kelly (CIKM 2006), also cited as a user of the
threshold, in fact uses *"the **median** document display time … as a relevance threshold value."*

**What this means for `DEEP_READ_MS`.** The repo's 60 s was arrived at from one observed session
(`grounds.ts` records the reasoning: ninety seconds refused a real sixty-second read). It happens to
land within two seconds of the only empirically-derived split in the literature. That is luck rather
than method, but it is the right kind of luck, and it means the constant should **not** be lowered
toward 30 s on the authority of an industry heuristic that has no paper behind it.

### 2.3 Why one global dwell threshold cannot be right

**Kim et al. (WSDM 2014)** measured per-page-type thresholds and found them wildly different: SAT is
recognised at around **160 s** for easy reading level, **175 s** for moderate, over **200 s** for
difficult, and about **210 s** for technical content. Their verdict: *"a single satisfaction threshold
across all pages may be insufficient."* Note that where 30 seconds *does* appear in that paper, it is
the peak of the **dissatisfaction** probability at medium reading level.

**Liu, White & Dumais (SIGIR 2010)** give the structural reason. Fitting Weibull distributions to
dwell time over **205,873** pages: *"the dwell time is no more than 70 seconds on 80% of the pages"*,
and the shape parameter *"k is less than 1 on 98.5% pages"* — meaning strong **negative aging**: the
hazard of leaving is highest immediately on arrival and falls thereafter. *"Some 'screening' is
carried out at the early stage of browsing a page, and the rate of subsequent abandonment decreases
over time."* Median shape parameter varies by category from 0.6506 (Education) to 0.7979 (Vehicles).

The practical consequence for this repo: the first ~10 seconds on a page are a *screening* decision,
not reading, which is exactly what `READ_AROUND_MS = 20s` is trying to exclude and appears to exclude
correctly. But the same result says that a page held for 60 s on arXiv and a page held for 60 s on a
shopping site are not the same event, and no constant in `grounds.ts` distinguishes them.

### 2.4 The known pathologies, and which ones apply here

**Position and presentation bias.** Joachims et al. (SIGIR 2005 / TOIS 2007) eye-tracked users and
found that the rank-1 abstract is viewed **90.6%** of the time before a click at rank 1 and **73.9%**
of the time before a click at rank 3; *"the abstract right below a click is viewed roughly 50% of the
times."* Their "trust bias" result: with the top two results swapped, when link 1 was in fact the more
relevant, 19 users clicked only l₁ against 1 who clicked only l₂; when link 2 was more relevant, 5
clicked only l₁ against 2 who clicked only l₂.

⚠️ The often-quoted numeric ratio "rank 1 is clicked N× more than rank 2" **does not appear
numerically in either paper** — it is readable only off a figure. Any specific multiplier in
circulation is somebody's reading of a bar chart.

Joachims, Swaminathan & Schnabel (WSDM 2017) model position bias as propensity `p_rank = (1/rank)^η`;
at η = 1 *"the result at rank 10 has a 10% probability of being examined"*, and their real-world
estimates bottom out at *"the smallest p_r ≃ 0.12"* over ranks 1–21.

**How much of this applies to Propositum?** Less than it might appear, and this is worth saying
because it is a place the product is structurally better off than a search engine. Propositum does not
rank anything the person then clicks. It observes navigation the person chose from a surface
Propositum did not build. Position bias is a property of *the system's own presentation*; there is
none here. What *does* transfer is the deeper point underneath position bias: **a click is evidence
about the presentation as much as about the person**, and the same is true of a page opened from a
Google results page — the opening is partly a fact about Google.

**Good abandonment.** Li, Huffman & Tokuda (SIGIR 2009), Google's own study, hand-classified abandoned
queries: *"queries potentially indicating good abandonment make up a significant portion of all
abandoned queries, ranging from **19% to 55%** across the set of locales and modalities."* On PC:
**31.8%** in the US, 23.3% in China, 19.0% in Japan. Of those potential good abandonments, *"For PC
search, an average of 56% … were clearly or possibly met on the results page."*

⚠️ Two caveats that are routinely dropped: these are percentages of **abandoned** queries, not of all
queries; and they are hand-judged estimates of whether a need *could* have been met on the SERP, not
measured satisfaction.

**This one applies directly and it cuts both ways.** `searched-then-read` requires
`PAGES_AFTER_QUERY_FOR_OFFER = 2` pages read after a query. Good abandonment says a large minority of
*successful* searches produce no click at all — so the ground systematically under-fires on searches
that worked. That is the cheap direction by ADR-0008's own asymmetry. The uncomfortable corollary is
the other one: **a search followed by several clicks is at least as much evidence that the results
page failed as that the person is deeply engaged.** `grounds.ts` already half-knows this — it names
"somebody who searched, refined and came back inside a minute having read nothing" as "what a search
going badly looks like, and the worst possible moment to interrupt" — but the *thresholds* do not
encode it, and `refined-the-search` explicitly rewards the pattern.

### 2.5 Where richer signal has been measured to make things worse

This was actively hunted for, and there are seven verified instances. They matter more than the
positive results, because the team's plan assumes the sign is always positive.

1. **Fox et al. 2005** — seventeen extra features buy four points of SAT accuracy and one point
   overall. (§2.1)
2. **Fox et al. 2005, again** — the session model scores 74%/70% only because it is given the explicit
   per-result satisfaction judgements as inputs, which no deployed system has. Removing them drops it
   to **60% SAT / 60% overall against a 56% baseline** — an eighteen-point gain collapses to four.
3. **White & Kelly (CIKM 2006)** — **per-user** dwell thresholds are *worse than one global threshold*.
   By feedback iteration 20 the user-tailored algorithm reaches **−26% MAP / −20% MP10** against the
   global baseline. Verbatim: *"tailoring display time thresholds based on users appears to worsen
   performance"* and *"UserOnly performs worse than any of the other algorithms, including the
   baseline algorithm."* Per-**task** tailoring, by contrast, reached **+20% / +44%**. Personalise the
   task, not the person — see [§4.4](#44-personalising-from-small-n-a-consistent-unwelcome-pattern).
4. **Agichtein, Brill & Dumais (SIGIR 2006)** — the paper usually cited as proof that behavioural data
   helps ranking (and it does: NDCG@1 **0.6 → 0.75**, a 31% relative gain, on queries with interaction
   data) also states *"incorporating user behavior information **degrades accuracy** for queries with
   high original MAP score"*, and that only **46–49%** of test queries had enough interaction data to
   make a prediction at all.
5. **Joachims et al. (SIGIR 2005)** — one of the six click-interpretation strategies, "Click > Earlier
   Click", scored **46.9 ± 13.9** against explicit judgements: *below* the 50% random baseline. A
   plausible-sounding extra signal was worse than a coin flip.
6. **Joachims et al. (WSDM 2017)** — *"Naive SVM-Rank outperforms Propensity SVM-Rank for small
   datasets."* The statistically correct treatment of bias is net-negative until data is plentiful.
   This is the single most relevant result in the whole implicit-feedback literature for a product
   with one user.
7. **Claypool et al. (IUI 2001)** — two of the four proposed indicators were duds: mouse clicks
   ("failed to reject the null hypothesis") and individual scrolling methods ("poor indicators of
   interest").

And the structural warning, from **Joachims (KDD 2002)**: average clickrank across three retrieval
functions of *"substantially different"* quality was **6.26 / 6.18 / 6.04**. More volume of the wrong
aggregate signal produced no discrimination whatsoever.

### 2.6 The ceiling

How well can implicit signals ever agree with what a person would say? Joachims et al. (SIGIR 2005)
give the cleanest answer, because they measured the human ceiling in the same study:

| | Agreement with explicit judgements |
|---|---|
| **Inter-judge agreement (two humans)** | **89.5%** |
| Click > Skip Above | 80.8% ± 3.6 |
| Last Click > Skip Above | 83.1% ± 3.8 |
| Click > Skip Previous | 82.3% ± 7.3 |

Relative, pairwise interpretations of clicks get to about 81–83% against an 89.5% human ceiling.
**Absolute** per-visit satisfaction inference is far worse: Fox's full nineteen-feature model is
**57%** overall, and Kim et al.'s dwell-only click-satisfaction classifier is **0.5682**.

The distinction is the one that matters here. *"This page was more useful to them than that one"* is
inferable at roughly human-adjacent accuracy. *"They were satisfied with this page"* is inferable at
barely-above-chance accuracy with everything anyone has tried. Propositum's grounds are all statements
of the second kind.

---

## 3. Arrow 1b — finding the thread: task segmentation, and the folklore constant

This is the published literature closest to what `findThreads` does, and it is unusually informative
because it has been measured repeatedly on real logs for twenty years.

### 3.1 The 30-minute window is folklore, and the folklore is wrong

**The origin.** Catledge & Pitkow, *Characterizing Browsing Strategies in the World-Wide Web*, WWW3
1995. Georgia Tech, NCSA XMosaic, three weeks from 3 August 1994, 107 users, over 43,000 events. The
entire derivation of the session boundary, verbatim:

> *"Since users will often leave XMosaic running for extended periods of time without interacting with
> it, determining session boundaries artificially was necessary. With the intent of identifying these
> boundaries, the time between each event for all events across users was calculated. **The mean
> between each user interface event was 9.3 minutes. In order to determine session boundaries, all
> events that occurred over 25.5 minutes apart were delineated as a new session.** This means that
> most statistically significant events occurred within 1-1/2 standard deviations (25.5 minutes) from
> the mean."*

Three things follow, and each of them is a finding:

1. **The number is 25.5, not 30.** Thirty is a later rounding. Halfaker et al. (WWW 2015) note it
   directly: *"[Catledge & Pitkow found a] 25.5 minutes inactivity threshold. **Over time this
   threshold has simplified to 30 minutes.**"*
2. **25.5 was never validated.** It is mean + 1.5 SD of inter-event gaps. The paper never justifies
   1.5, never defines "statistically significant events", never reports the SD, and never checks the
   cutoff against any ground truth.
3. **It was never a task boundary.** Its stated purpose is detecting **when the user walked away from
   the browser**. Modern usage — session ≡ task unit — is a repurposing the source does not support.

Halfaker et al.'s own conclusion, on much larger modern data, is *"a good rule-of-thumb inactivity
threshold of about 1 hour"*, with per-dataset optima ranging from 14 minutes (game sessions) to 335
minutes (StackOverflow).

**The measurement of failure.** Jones & Klinkner (CIKM 2008) sampled 312 Yahoo! Search users over
three-day windows in mid-2007 and had editors label **1,820 missions, 2,922 goals and 8,226 queries**.
Their verdicts, verbatim: *"timeouts, whatever their length, are of limited utility in identifying
task boundaries, achieving a **maximum precision of only 70%**"*; *"**The 30-minute standard receives
no support from our results**"*; *"this threshold is **no better than random** for identifying
boundaries between user search tasks."*

With repeated queries removed (their Table 8), the 30-minute timeout is **worse than doing nothing**:

| | Goal boundary | Mission boundary |
|---|---|---|
| Baseline (always "no boundary") | **63.1%** | 59.9% |
| 30-minute timeout | **57.2%** | 73.8% |
| Trained timeout | 69.5% | 75.8% |
| Best classifier | **87.3%** | **84.4%** |

Trained optima were **5 minutes** for goals and **13 minutes** for missions. Neither is anywhere near
thirty.

⚠️ Jones & Klinkner computed **no inter-annotator agreement**: *"One of the future directions for this
work involves obtaining measures of inter-rater reliability for the editorial work."* The numbers are
against one editorial pass.

**What this means for `WINDOW_MS`.** The 30-minute window is doing two jobs in this repo and only one
of them is defensible. As a **buffer retention bound** — how much we are willing to hold in memory
about someone who has not started a session — it is a privacy decision and it is fine. As an implicit
claim that **work more than thirty minutes old is not part of this thread**, it is inherited folklore
that the only paper to measure it calls worse than random. `SUSTAINED_MS`'s own comment already spots
half of this ("fifteen minutes IS half of `WINDOW_MS`, and a rule that asks a thread to span half the
life of the buffer it is measured inside is measuring the window as much as the person"). The
literature says the comment is right and the fix is a longer window, not a smaller ground.

### 3.2 What features actually carry the segmentation

This is the good news, and it is a direct validation of `topics.ts`.

Jones & Klinkner ran per-feature ablations. With repeats included (their Table 7), single-feature
accuracy:

| Feature | Goal boundary | Same-goal | Mission boundary | Same-mission |
|---|---|---|---|---|
| **lev** (normalised Levenshtein) | **89.0%** | **95.3%** | **84.1%** | 77.9% |
| **wordr** (Jaccard on words) | 86.9% | 95.1% | 83.9% | 78.6% |
| **commonw** (common words) | 82.9% | 91.0% | 83.9% | **79.7%** |
| **Time interval** | **62.5%** | 90.9% | 73.8% | 67.6% |

And their Table 12, adding time to edit distance: lev+time scores 85.0 / 95.8 / 78.3 / 76.8 against
lev alone at 85.0 / 95.2 / 78.2 / 77.0. The caption is one sentence: *"The latter does not appear to
help."*

**Lexical overlap dominates. Time is the weakest feature in the paper.**

Every subsequent study agrees on the ordering:

- **Lucchese et al. (WSDM 2011)**, on 1,424 hand-clustered AOL queries, get F-measure **0.81** with
  content distance (tri-gram Jaccard + normalised Levenshtein) plus Wikipedia/Wiktionary semantics,
  against **0.65** for their 26-minute timeout baseline and **0.28** for 5- and 15-minute timeouts.
  ⚠️ This paper reports no "accuracy" figure at all — F-measure, Rand index and Jaccard only.
- **Wang et al. (WWW 2013 — not WSDM)**, on 10,327 hand-labelled Bing tasks, learn weights of
  Q-COSINE **+5.30** and U-JAC-ALL **+4.53** against S-SAME (same session) at only **+1.00**. Their
  own explanation is the sharpest sentence in this literature for Propositum's purposes: *"placing too
  large a weight on S-SAME and Q-TIME **will forbid the method from identifying those cross-session
  tasks**."* The model has to actively **down-weight** the session boundary to work at all.
- **Donato et al. (WWW 2010)**, on Yahoo! Search Pad, report that for mission boundaries *"the most
  predictive features … are **textual features**, among which size of the intersection on
  character-level 3-grams and cosine similarity computed on sets of stemmed words"*, while for
  detecting a research mission *"the most relevant features are the **session-based ones**. In
  particular, the number of clicks and number of queries since the beginning of the session."*

**Read against `topics.ts`, this is close to an endorsement.** `findThreads` seeds threads on terms
recurring across origins — lexical overlap — and uses time only as a window bound. That is exactly the
feature ordering the literature supports, arrived at independently. The one thing the literature does
that `topics.ts` deliberately refuses is *semantic* similarity (Lucchese's wikification, Wang's
embedding features), and `topics.ts` argues the refusal on grounds of silent false merges, which is a
defensible product decision rather than an oversight.

⚠️ **One caution on `vocabularyOf`.** Jones & Klinkner's best single feature is *normalised Levenshtein
distance used as a graded similarity*. `vocabularyOf` uses one-edit Damerau-Levenshtein as a **binary
merge decision**, which is a much stronger commitment from a much weaker signal, and its own docstring
already records two measured false merges (`contest`/`content`, `modeling`/`modelling`). The
literature's usage — distance as a *feature* in a classifier, alongside others — is safer than the
repo's usage — distance as a *rewrite*. The two guards added on 2026-08-17 (typed exactly once; the
absorbing word must already carry a thread) are what make the repo's stronger commitment survivable,
and they should not be relaxed.

### 3.3 Interleaving is the failure mode, and it is common

`findThreads` returns **disjoint** threads: each page is claimed by exactly one, the strongest. The
literature says this is wrong somewhere between one time in six and three times in four, depending on
how you count:

| Source | Measure | Value |
|---|---|---|
| Jones & Klinkner 2008 (Yahoo, 312 users) | missions interleaved or revisited | **17%** |
| Jones & Klinkner 2008 | goals **broken** by a 30-minute timeout | **15%** |
| Jones & Klinkner 2008 | missions containing multiple goals | **20%** |
| Wang et al. 2013 (Bing, 10,327 tasks) | multi-query tasks that interleave | **31.1%** |
| Lucchese et al. 2011 (AOL, 1,424 queries) | queries inside multi-tasking sessions | **74%** |
| Lucchese et al. 2011 | timeout-sessions containing more than one task | **47%** (145/307) |
| Spink et al. 2006 (AltaVista, hand-coded) | multi-query sessions with >1 topic | **81–91.3%** |

⚠️ The Spink figures are conditioned on sessions of ≥2 queries, come from hand-coding 254 and 483
sessions, and report **no inter-rater reliability**. They must not be quoted as "81% of all sessions".
Prevalence estimates in this literature range from **3.8% to 91.3%** depending entirely on method.

Jones & Klinkner also note the harder half: *"the task of matching queries within the same interleaved
goal or mission is **harder** than identifying boundaries."*

**What this says about `MAX_THREADS_SHOWN` and disjointness.** ADR-0008's decision to show several
strands on the front door is directly supported — the single-thread assumption was measurably wrong
17–31% of the time in every dataset anyone has labelled. The **disjointness** assumption is the part
with no support: a page genuinely belonging to two threads is common, and `claimed.add(page.url)`
makes that inexpressible. The cost is a page of evidence going to the wrong strand, which is the same
class of failure as the "nissan altima" case already recorded in `detect.ts`.

### 3.4 The gap: nobody has published segmentation of general browsing

⚠️ **No primary source reporting accuracy for segmenting a full page-visit stream into tasks was
found.** Every result above is query-log based:

- Kotov et al. 2011 uses browser plug-in logs but only segments **queries** — a session is *defined* as
  starting with a Bing query.
- Lucchese 2011, Jones & Klinkner 2008, Wang 2013 and Mehrotra & Yilmaz 2017 are query-log only.
- Catledge & Pitkow 1995 is genuine browser-log data but performs no task segmentation at all.

This is reported as absence of found evidence rather than proven absence, but it is a defensible
claim: **`findThreads` is doing something the published literature has not measured.** It seeds on
terms from titles and URL paths, most of which are not queries at all. The nearest published analogue
in feature terms is Donato et al.'s mission detector at ~95% accuracy on *consecutive query pairs*,
which is a much easier problem on much cleaner input.

The practical consequence: there is no external benchmark to calibrate `findThreads` against, and
there will not be one. The repo's own fixtures are the only evidence, which makes
`tests/grounds.test.ts`'s standing "ordinary afternoon" fixture more load-bearing than it looks — and
`PRODUCT_PRINCIPLES.md` §13 already records the day that fixture was smaller than the session it
claimed to record.

---

## 4. Arrow 2 — how much history, and how much personalisation

### 4.1 How much history actually helps

Three independent measurements, on three different problems, converge on "less than you would think,
and it saturates".

**ProAgentBench (2026)** ablates the observation window across 10 s, 30 s, 1 min, 2 min, 5 min and
10 min and reports *"diminishing returns beyond the 5-minute mark, with marginal gains observed
between 5 and 10 minutes"* ([§5.3](#53-proagentbench--the-closest-published-analogue-to-this-product)).
This is the closest thing to a direct measurement of Propositum's `WINDOW_MS`, on much richer input,
and it puts the plateau at one sixth of the current window.

**Agichtein, White, Dumais & Bennett (SIGIR 2012)** predicted whether a search task would be continued
within five days, from Bing logs of 1,191 users and 28,474 unique queries. Their history-length
ablation (their Table 7), AUC:

| History available | Accuracy | AUC |
|---|---|---|
| None | 0.721 | 0.788 |
| + 1 week | 0.731 | 0.791 *(not significant)* |
| **+ 2 weeks** | **0.751** | **0.829** *(p ≤ 0.01)* |

**One week of history bought nothing measurable.** Two weeks bought about three points of accuracy and
four of AUC.

Their feature analysis is more useful still. Group ablation shows only one group matters: *"the single
most valuable feature group is the **user engagement effort and focus**. Removing these features
degrades performance significantly to roughly that of the original baseline."* Removing the topic
features, or the repeat-query priors, is negligible. And — directly against the team's instinct to
capture more content — *"**Surprisingly, removing text features … has negligible effect on
performance.**"*

The single strongest individual feature (their Table 10, normalised to 1.000): **TaskSpanTime, 1.000**
— *"the amount of time the searcher already has spent on the task in the first two days"* — followed
by DomQueriesPriorHist 0.624 and NumQueryChars 0.371. Correlations: TaskSpanTime **.412**,
NumDomTaskSessions .387, TaskSpanSessions .364; and negatively, NumTaskSwitchSess **−.148**.

Their model reached 0.751 accuracy / 0.829 AUC and **beat human judges on every metric** (humans:
0.677 accuracy, 0.730 precision, 0.692 AUC).

⚠️ Kotov et al. (SIGIR 2011) and Agichtein et al. (SIGIR 2012) share one dataset — identical active
period, identical 28,474 unique queries — so their two ~57%-continuation figures are one measurement,
not a replication.

**What this says about Propositum's own constants.** `WORKED_MS_FOR_HANDOFF = 10 minutes` and
`SUSTAINED_MS = 15 minutes` are both measuring TaskSpanTime, which is the best-evidenced single
predictor of continuation in the literature and the same variable Iqbal & Horvitz found predicted
whether a suspended task was resumed at all ([§6.8](#68-the-cost-of-the-interruption-itself)). Those
two constants are the best-supported numbers in the codebase. The window they sit inside is the worst.

⚠️ **A premise correction worth recording, because it changes what can be claimed.** Bennett, White,
Chu, Dumais, Bailey, Borisyuk & Cui (SIGIR 2012) is the paper usually cited for "how much history
helps", and **it does not measure that**. It measures how *session* depth trades against a fixed six
weeks of history. Verbatim: *"**We leave studying how this tradeoff changes with the amount of
available history from a user as future work.** Therefore, we restricted users to those with at least
one SAT click in each of the six weeks before the week of interest."* It also lists cold start as
unstudied.

What it *does* say is still useful, and it is a within-session diminishing-returns curve: *"the
Session-based personalization steadily increases its gains as more session information becomes
available and **seems to stabilize around 0.55 gain in MAP**. On the other hand, **Historic quickly
decreases its gains**… by the fifth query, the session information accounts for half the gains in
personalization."* Session and historic cross at queries three and four. And the coverage figure is
sobering: personalization touched *"**5.42% (Session) to 9.05% (Union)**"* of query volume at all.

**The only two verified accuracy-vs-history-amount curves found anywhere** are much smaller than the
folklore suggests:

- **Bar-Yossef & Kraus (WWW 2011)** on query auto-completion, weighted MRR by number of recent queries
  used as context: **1 → 0.139, 2 → 0.154, 3 → 0.164.** Decelerating (+10.8%, then +6.5%). Their own
  summary: *"increasing the number of recent queries being taken into account **slightly improves** the
  quality."*
- **DITTO (arXiv:2406.00888)** on demonstration-based alignment: *"From 1 ≤ N ≤ 3, normalized
  performance roughly doubles for each additional demonstration (0% → 5% → 11.9%). However, we observe
  **diminishing returns** when supplying extra demonstrations (4 ≤ N ≤ 7, 11.9% → 15.39%)."*

Add **Parate et al. (UbiComp 2013)** on next-app prediction, which is the closest thing to Propositum's
problem shape in the mobile literature: *"accuracy with top-5 predictions is **extremely high (95%) even
on the first day**, and our average prediction accuracy is 81.89±3.9%"*, with no upward learning trend
over fourteen days. And their context ablation is the same story as everything else in this document:
none 80.85% → location 81.10% → time 81.23% → both **81.35%**. Verbatim: *"The benefits of additional
context is **surprisingly small**… 'contextual' information is partially captured by the app
sequences."*

### 4.2 Relevance beats volume, and this is the sharpest result in the section

Bar-Yossef & Kraus also measured what happens when the context is about something *else*. With
**related** context, weighted MRR is 0.242. With **unrelated** context it is **exactly 0** — *"when the
query and context are unrelated, NearestCompletion is essentially useless"* — and **40% of contexts
were unrelated**. Their shipped answer is a hedged blend rather than a better context model.

Dou, Song & Wen (WWW 2007) found the same shape on the other axis. Personalization gains by click
entropy: at entropy below 0.5, the best method gave *"only a non-significant 0.37% improvement"*; at
entropy ≥ 2.5, *"G-Click has a significant (p < 0.01) 23.37% improvement… P-Click 23.68% improvement."*
And below 1.5, *"Profile-based methods L-Profile, S-Profile and LS-Profile **worsen** search
performance."*

**Personalisation is a routing problem, not an accumulation problem.** Knowing *when the extra context
applies* is worth more than having more of it — which is exactly what `pursuitOf`'s "the search must be
ABOUT the thread" test is doing, and it is the single best-argued predicate in `grounds.ts`.

### 4.3 What "richer" means when it works

ProAgentBench's one clear positive result for richer input is **structured long-term memory**, not
more raw signal: a knowledge-graph memory over prior behaviour lifted overall accuracy from 0.537 to
0.601 and intention accuracy from 0.312 to 0.396. Note what that is — a *compressed, structured*
representation of history, not a longer raw window. The window ablation plateaus; the memory ablation
does not.

This is the same shape as Fox et al.'s result one level up: the gain comes from a small number of
well-chosen, high-information features, not from volume.

### 4.4 Personalising from small n: a consistent, unwelcome pattern

Propositum will have one user's data for some time. Six independent results bear on that, and every
one of them points the same way.

**White & Kelly (CIKM 2006)** compared four ways of setting the dwell threshold used for implicit
relevance feedback: one global threshold for everyone ("All"), per-task, per-user, and per-task-and-
user. Percentage difference in MAP / MP10 against the global baseline, by feedback iteration:

| Iteration | TaskAndUser | TaskOnly | UserOnly |
|---|---|---|---|
| 1 | −3 / +6 | +4 / +6 | −9 / +17 |
| 5 | −7 / +10 | +13 / −1 | +3 / +5 |
| 10 | −8 / +3 | +13 / +35 | −13 / −15 |
| 15 | −7 / +5 | +14 / +15 | −18 / −22 |
| 20 | −8 / −2 | **+20 / +44** | **−26 / −20** |

Verbatim: *"using information about the search task to tailor threshold display times … appears to
enhance performance in later iterations, and **tailoring display time thresholds based on users
appears to worsen performance**."* And: *"UserOnly performs worse than any of the other algorithms,
**including the baseline algorithm (i.e., All)**, where task and user information are ignored."*

**Personalising to the person made it worse than not personalising at all. Personalising to the task
made it much better.** With one user, that is not a limitation to work around — it is the finding. The
axis worth adapting on is *what kind of work this is*, not *who is doing it*.

It is not an isolated result. **Dou, Song & Wen (WWW 2007)**, on twelve days of MSN logs from 10,000
US users, found **three of five personalization strategies scoring below the non-personalized
baseline** (rank scoring, all test queries; baseline WEB = 69.4669):

| Method | Rank score | vs. no personalization |
|---|---|---|
| P-Click | 70.4350 | +1.39% |
| G-Click | 70.4168 | +1.37% |
| LS-Profile | 68.5958 | **−1.25%** |
| S-Profile | 66.7822 | **−3.86%** |
| L-Profile | 66.7378 | **−3.93%** |

Verbatim: *"though L-Profile, S-Profile, and LS-Profile methods improve the search accuracy on many
queries, they also **harm the performance on more queries, which makes them perform worse on
average**."* And the non-monotonic part, which is the one that matters for a product that will
accumulate one person's data for years: *"users who have greater search activities in training days
**do not consistently benefit more**… the performance of L-Profile becomes **more unstable when the
user has more and more queries, especially when they have more than 80 queries**. This is because
there is more noise in queries."*

⚠️ Dou et al. publish no exact fraction of harmed queries — that is a figure only.

**And the canonical "personalization works" paper contains the same warning.** Teevan, Dumais &
Horvitz (SIGIR 2005), 15 participants, 131 queries: *"**Personalized search performed significantly
worse (p<0.01) than the Web rank**, which had a normalized DCG of 0.56."* The best content-only
personalized ranking was 0.46. Only the *blend* won, and barely: *"The combination of the Web ranking
and the personalized ranking (Mix) yielded an average normalized DCG of **0.58**, a small but
significant (p<0.05) improvement."* And: *"**no one parameter setting consistently returned better
results than the original Web ranking**."*

**The LLM-personalization literature reproduces the shape exactly, and it is where a product like this
would actually live.** Every verified result says the first observation carries most of the signal and
further history degrades:

- **LaMP** (arXiv:2304.11406): *"increasing the number of retrieved items leads to improved
  performance… **However, some tasks experience a decline in performance**."* On the printed tables,
  going from zero to one retrieved item gives +0.173 accuracy on LaMP-1U and +0.183 ROUGE-1 on
  LaMP-6U; going from one to the tuned optimum gives +0.036 and **+0.008**. ⚠️ The k-grid is only
  {0, 1, 2, 4} — LaMP never tests beyond four.
- **LongLaMP** (arXiv:2407.11016): *"ROUGE scores increased from k=0 to k=1 but **declined after,
  suggesting too many profiles degraded performance**."* At k=4 on Abstract Generation, the
  personalized score (0.3202) is **below the non-personalized baseline (0.3666)**.
- **OPPU** (arXiv:2402.04401), the widest verified sweep (k → 16): several tasks are worse at k=4 than
  k=2; *"the retrieved items introducing noise and irrelevant behavior patterns."*
- **Hwang et al.** (arXiv:2305.14929): *"**utilizing the top-3 opinions yields similar performance to
  using the top-8 opinions**… simply using the top 3 most relevant opinions performs on par with the
  model with user demographic, ideology, and user's past 16 random opinions."*
- **DITTO** (arXiv:2406.00888): aligns from *"a very small number (< 10) of demonstrations"*, and
  *"we still need **> 500 preferences to match DITTO performance**."* **Four good demonstrations beat
  five hundred preference pairs.**

There is one genuine counterpoint, and it points at a design rather than a volume: **PPlug**
(arXiv:2409.11901) finds that compressing *all* history into a learned soft embedding beats selecting
the top-4 as text. The synthesis is that **history saturates or degrades when stuffed into a prompt as
text, and keeps helping when compressed into a representation** — which is the same conclusion as
ProAgentBench's knowledge-graph result in §4.2.

**Small n may not even be the disadvantage it looks like.** Persona-DB (arXiv:2402.11060) evaluates a
cold-start "Lurkers" cohort of 100 users *"averaging only 13.81 interactions per user"* and reports
**higher** performance there (55.05) than on frequent users (49.03), with the explanation: *"when the
user history becomes frequent, the retrieval of relevant information in a small capacity becomes
harder as there are more semantically similar yet non-relevant items."*

**And the one measurement of personalised *interruptibility* models says they do not transfer.** Horvitz
& Apacible (ICMI 2003) trained models of the cost of interrupting from thousands of two-second cases per
person. Within-subject accuracy was **0.73** and **0.64** against marginal baselines of 0.53 and 0.37.
Across subjects it **collapsed below the baseline**: S1→S2 = **0.28**, S2→S1 = **0.32**. Verbatim:
*"applying a personalized model from one user to predict the outcomes of another user may yield poor
performance … inferential models can show poorer classification accuracy than the marginal models."*
Composite models trained on several people recovered to 0.55–0.66.

Two things follow for a one-user product, and they point in opposite directions. **The good news:**
interruptibility is genuinely personal, so a model of *this* person is worth having and a generic one is
not. **The bad news:** nothing learned here will generalise to user two, and the composite result says
the way out is more people rather than more data per person.

Finally, a technical version of the same warning. Joachims et al. (WSDM 2017): *"Naive SVM-Rank
outperforms Propensity SVM-Rank for small datasets."* The statistically principled treatment loses to
the naive one until data is plentiful, because its variance dominates. Any scheme here that estimates
something per-user from a handful of sessions is in that regime by construction.

⚠️ **Two premise corrections.** Schein et al. (SIGIR 2002), routinely cited for cold start, is about
new **items**, not new users — *"We concentrate on the new-item problem"* — and contains **no
accuracy-versus-number-of-ratings curve at all**; its one sparsity remark is *"naïve Bayes is sensitive
to sparsity below 40 rated movies on this type of data **(results not shown)**."* And no primary paper
with an explicit ratings-count saturation curve was located. **Anyone citing Schein for "how much
history do you need" is citing it wrongly.**

⚠️ **Still not established:** nobody has measured few-shot personalisation of a *proactive suggestion*
system from a single user's browsing. Everything above is on ranking, recommendation or text
generation. The direction of the evidence is consistent, but the transfer is an inference.

---

## 5. Arrow 3 — deciding when to speak: what shipped, and how well

### 5.1 The base rate, which is the number everything else divides by

Donato et al. (WWW 2010) had 15 Yahoo! editors hand-label 7,303 user sessions and report: *"These
research missions account for **10% of users' sessions** and more than **25% of all query volume**, as
verified by a manual analysis that was conducted by Yahoo! editors."*

This is the true origin of the 10%/25% pair that circulates through this literature — Kotov et al.
2011 quote it from Donato rather than measuring it, and it is frequently misattributed to them.

**Ten percent is the number to hold onto.** A detector firing on a session drawn at random is right
one time in ten. That is the base rate any precision claim has to be read against, and it is the
reason ADR-0008's asymmetry is correct as stated.

### 5.2 Yahoo! Search Pad — the one that actually shipped this

Search Pad detected "research missions" in Yahoo! Search and proactively prompted *"Do you want to
take notes?"*. It is the closest shipped analogue to Propositum that has a published paper.

**Architecture.** Two boosted-decision-tree detectors — a Mission Detector (are these two consecutive
queries the same mission?) and a Research Detector (is this a research mission?) — feeding a logistic
regression "mixer" that emits a probability *p*; the prompt fires if *p* ≥ T. Session state is the
last **3** queries. 30 features per query pair, in three groups: textual, session, time. Trained on
~40K consecutive query pairs from a week in late 2008.

**Component accuracy, verbatim:** *"the **Mission Detector achieves a very high accuracy, approximately
close to the 95%**, while the **Research Detector exhibits an accuracy around 75%**."*

**The shipped operating points** (their Table 1): 1% of traffic at T = 0.6 with prompt coverage 6%;
3% of traffic at T = 0.5 with prompt coverage 11.5%.

⚠️ **Precision and recall are published only as plots** (their Figures 5 and 6) — there is no numeric
P/R anywhere in the text. Rendered at 400 dpi and read off, T = 0.5 sits near precision ≈ 0.63 /
recall ≈ 0.69 and T = 0.6 near precision ≈ 0.67 / recall ≈ 0.54. **These are chart readings, not
reported values, and should not be quoted to more than one significant figure.**

Taking them at that resolution: **the shipped product ran at roughly two-thirds precision. About one
in three "Do you want to take notes?" prompts fired on a session that was not a research mission.**
The paper concedes T = 0.6 *"guarantees a reasonable precision but a very low recall, given our ground
truth estimation that 10% of sessions are research sessions."*

**The engagement result, which is the most useful sentence in the paper**, verbatim:

> *"We did not rely on the triggering prompt as validation of search sessions as there is a
> **discoverability issue** with such artifacts. Indeed we noticed that the **Click-Through Rate
> (commonly referred to as CTR) remained constant independently of the coverage** and this signaled to
> us that more efforts need to be invested to make the prompt more discoverable."*

⚠️ **No absolute CTR, no acceptance rate, no rejection rate and no user counts appear anywhere in the
paper.** CTR staying flat while coverage nearly doubled (6% → 11.5%) means the additional prompts
converted no better than the original ones — which is the closest thing to an adoption result in the
paper, and it is not flattering.

**And then it vanished.** ⚠️ **No primary source explaining why Yahoo discontinued Search Pad could be
found** — no blog post, no help-centre article, no press release, no shutdown announcement.
Wikipedia's "Yahoo! Search" article does not mention Search Pad at all. Any causal story about why it
failed is inference, not record.

**What Propositum should take from this.** Yahoo shipped this exact feature, at roughly this exact
precision, to a mainstream search product, and published the method. The two facts that survive are:
(a) two-thirds precision was considered shippable at 6% coverage, and (b) they could not tell whether
anyone wanted it, because they never measured acceptance in a way the paper reports. Propositum is
currently in the same position — `grounds.ts` says so in as many words: *"That is the residual false
positive of this design, it has not been measured in real use."*

### 5.3 ProAgentBench — the closest published analogue to this product

**ProAgentBench** (arXiv:2602.04482, 4 February 2026) is the most directly relevant recent work: it
evaluates whether a model can decide *when* to proactively assist, from continuous real observation of
a person working.

**Data.** Screenshots sampled at **1 Hz** plus synchronised application usage logs (application name,
window title, category), segmented into events by application switching. **28,528 events from 500+
hours** of real sessions, participants "primarily student participants … across diverse academic
backgrounds". 7,222 events are LLM-related (≈25.3%). Burstiness B = 0.787.

**The evaluation is deliberately hard in the right way**, verbatim: *"for the interaction timing
prediction task, we carefully select non-assistance moments that are contextually similar to actual
assistance triggers. This strategy filters out trivial negatives (such as periods of inactivity),
forcing the model to distinguish between subtle differences in user needs."*

⚠️ The positive/negative class balance is **not reported**, so precision cannot be compared to a base
rate.

**Timing prediction results** (their Table 2, verified against raw HTML):

| Model | Method | Accuracy | Precision | Recall | F1 |
|---|---|---|---|---|---|
| GPT-4o-mini | Zero-shot | 54.9% | 52.7% | 96.2% | 68.1% |
| GPT-4o-mini | CoT | 55.7% | 55.6% | 99.5% | 71.3% |
| Qwen3-Max | Zero-shot | 59.3% | 55.5% | 93.4% | 69.7% |
| Qwen3-Max | CoT | 59.8% | 59.6% | 72.5% | 65.4% |
| **Deepseek-V3.2** | **Zero-shot** | **64.4%** | **60.8%** | 81.1% | 69.5% |
| Deepseek-V3.2 | CoT | 61.1% | 60.9% | 86.6% | 71.3% |
| Qwen3-VL-Plus | Zero-shot | 53.0% | 51.6% | 97.0% | 67.4% |
| Llama-3.1-8B | Zero-shot | 57.3% | 54.7% | 85.7% | 66.7% |
| Qwen3-VL-8B | Zero-shot | 51.7% | 50.9% | 94.4% | 66.1% |

Three things to take from that table.

**(a) Nobody can do this.** The best accuracy is 64.4%. Precision never exceeds 60.9%. This is with
the full screen, at 1 Hz, plus application metadata, plus long-term user history — vastly more signal
than Propositum will ever collect — on data gathered specifically for the task.

**(b) Every model over-triggers, badly.** Recall is 81–99% while precision hovers near 55%. Given a
choice between speaking and not speaking, models almost always speak. The one configuration that broke
the pattern (Qwen3-VL-8B with CoT) collapsed to 32.7% precision and 17.1% recall. **A model asked
"should I interrupt now?" is not a calibrated instrument, and this is a direct argument for keeping
`groundsFor` deterministic and code-owned — which is what ADR-0008 already decided for different
reasons.**

**(c) The paper names the cost in the same terms this repo does:** *"precision quantifies interruption
cost (low precision causes alert fatigue), while recall measures need coverage (low recall fragments
workflows)"*, and *"Low precision leads to alert fatigue, excessive false alarms causing users to
ignore or disable assistance features, ultimately degrading productivity."*

**The context-window ablation is the direct answer to "how much history".** They test 10 s, 30 s,
1 min, 2 min, 5 min and 10 min. Accuracy improves as the window expands, and then, verbatim:
*"intention accuracy exhibit diminishing returns beyond the 5-minute mark, with marginal gains observed
between 5 and 10 minutes. This suggests that a 5-minute context window strikes an effective balance."*

**Memory helps, and it is the only richer-input intervention in the paper that clearly does.** A
knowledge-graph memory over long-term user behaviour raises overall accuracy from **0.537 to 0.601**
(+11.8% relative), intention accuracy from **0.312 to 0.396** (+26.9%), and F1 from **0.675 to 0.716**
(+6.1%). RAG-style retrieval gives smaller gains.

### 5.4 The wider proactive-agent picture, as of 2026

- **PROBE** (arXiv:2510.19771) decomposes proactivity into searching for unspecified issues,
  identifying bottlenecks, and executing resolutions. *"the best end-to-end performance of 40% is
  achieved by both GPT-5 and Claude Opus-4.1."*
- **ATRBench** (arXiv:2605.28108) isolates whether an agent will *ask* for a reusable preference it
  will need later. See [§8](#8-asking-instead-of-inferring), where it is set against the countervailing
  evidence that a bad question is worse than none.

---

## 6. Arrow 4 — the false-positive economy

ADR-0008 states the asymmetry: *"A missed detection costs a suggestion nobody sees. A false one
interrupts someone reading the news and teaches them to ignore the feature."* The literature supports
that framing and sharpens it in three ways the ADR does not currently say.

### 6.1 The cost is irreversible, and it has been measured

**LinkedIn, "Less Is More: Optimizing Email Volume" (2016)** is the cleanest published trade curve.
They ran a send-all bucket against a random-drop bucket:

- *"2.6% less page views from members in the random-drop bucket compared to the members in the
  send-all bucket."* By vertical, −1.4% (Homepage) to −4.5% (Profile and PYMK).
- *"45% more negative responses to emails in the send-all bucket compared to the random-drop bucket."*

So: dropping a large share of messages cost about **2.6%** of engagement and bought a **45%** reduction
in negative responses. And the reason that trade is worth taking is stated plainly:

> *"If a member clicks the unsubscribe option within an email, we lose the ability to send any emails
> of that type to that member in the future."*

Plus the systemic version: *"If a large number of members report emails from a particular sender … as
spam … this can result in an email service provider blocking and filtering all emails from that
sender"*, and *"such deliverability issues are not easy to resolve."*

**Pinterest Engineering** report the same shape from the other direction: *"sending too many
notifications could cause fatigue, and lead them to unsubscribe from notifications completely"*. Their
user-state model cut notifications to dormant users by 3% while increasing them 17% to "resurrected"
and 7% to "marginal" users, for **+1% WAU** in the enabled group.

**O'Brien et al. (arXiv:2202.08812)** state the structural problem in one sentence, and it is exactly
the failure mode `PRODUCT_PRINCIPLES.md` §13 calls "no metric anywhere that would catch an offer rate
creeping upward":

> *"sending too many or irrelevant notifications may annoy a user and cause them to disable
> notifications. However, **a myopic system will always choose to send a notification since negative
> effects occur in the future**."*

### 6.2 Removing suggestions can raise acceptance without reducing output

This is the finding that should most change how the team thinks about "improving suggestion quality",
because it says the lever is subtraction rather than addition.

**JetBrains, "AI Code Completion: Less Is More" (March 2025).** A 2.5 MB CatBoost filter model running
locally in 1–2 ms decides whether to *show* a completion at all, using file/project context, user
behaviour (typing speed, pause duration) and suggestion-quality features. Result, verbatim:

> *"The filter model boosted the acceptance rate by **~50%** and cut the explicit cancel rate by
> **~40%**"* — with the ratio of completed code held steady.

Their stated objective is worth quoting because it is the same objective `grounds.ts` has: *"we want to
show you only the suggestions you'll actually use. That means fewer unwanted suggestions – ones you'll
cancel, edit, or delete."* Their earlier post reports Full Line Code Completion at *"an acceptance rate
of 35% or more"* and *"an explicit cancel rate of just 5%"*, and describes deliberate restraint on the
most intrusive suggestions: *"we suggest multi-line completions much more carefully, ensuring we don't
disturb you while you read the code."*

**Google Research, "ML-Enhanced Code Completion" (2022)** measured the same lever with a different
mechanism. Semantic checks *"filtered out 80% of uncompilable suggestions"* for Go, and *"the
acceptance rate for single-line completions improved by 1.9x over the first six weeks"*. Their overall
numbers: single-line acceptance **25%**, multi-line **34%**, **6% reduction in coding iteration time**,
3% of new code generated from accepted suggestions.

**Chrome ships a model whose entire job is predicting an unwanted prompt.** Google's Chrome ML post
describes predicting *"when permission prompts are unlikely to be granted based on how the user
previously interacted with similar permission prompts, and **silences these undesired prompts**."*

### 6.3 But acceptance rate is the wrong target, per the people who use it most

**GitHub** defines acceptance rate as *"the number of accepted suggestions by the number of shown
suggestions"* and reports *"users accept nearly 30% of code suggestions"*, rising over time as
developers get familiar with the tool. And then, in the same organisation's engineering blog:

> *"**being hyper-focused on a metric like acceptance rate can lead to experiences that look good on
> paper, but do not result in happy developers**"*

Their evaluation stack instead tracks *"accepted-and-retained characters, acceptance rates,
**completion-shown rate**, time-to-first token, latency"* — note that **how often the system speaks at
all** is a first-class metric alongside how often it is right. That is precisely the metric
`PRODUCT_PRINCIPLES.md` §13 names as missing ("there is no metric anywhere that would catch an offer
rate creeping upward"), and GitHub's answer is: measure it directly, as a named metric, next to
acceptance.

### 6.4 The hardest shipped instantiation of "be comfortable doing nothing"

`PRODUCT_PRINCIPLES.md` §13 says silence is a correct output and forbids "a notification with no
decision attached to it". **Microsoft Viva's Briefing email documents exactly that rule as a shipped
guarantee**, and it is the only first-party source found that makes the promise unconditionally:

> Q: *"If I have no tasks or meetings, will I still receive a Briefing email?"*
> A: *"**No, you will never be sent an empty email with no content.**"*

And: *"The email is not sent when you have no actionable items."* Their own FAQ carries the heading
*"Why am I getting so many emails from Microsoft and how can I manage them?"* — the annoyance question
asked and answered in the product's own documentation.

### 6.5 What platform vendors tell developers, in their own words

Ranked by how directly they make the "false positives are expensive" claim:

- **Microsoft, Windows notification UX guidance** — section heading: *"Notifications should not be
  noisy."* Body: *"Users can easily be overloaded with too much information and get frustrated if they
  are being interrupted while they are trying to focus. **Too many interruptions leads to users turning
  off this critical communication channel for your app.**"*
- **Apple, HIG Notifications** — *"**Avoid sending multiple notifications for the same thing**, even if
  someone hasn't responded… If you send multiple notifications for the same thing, you fill up
  Notification Center, and **people may turn off all notifications from your app**."*
- **Apple, HIG Alerts** — *"**Use alerts sparingly.** Alerts give people important information, but they
  interrupt the current task to do so."* And *"**Avoid using an alert merely to provide information.**
  People don't appreciate an interruption from an alert that's informative, but not actionable."*
- **Apple, developer guidance on donating shortcuts** — the precision rule, verbatim: *"**don't make
  donations for actions the user hasn't completed in your app**; if the user never places an order for
  soup, don't donate a shortcut for the *order soup* action."* And in the HIG: *"**Offer relevant
  content.** Instead of telling Spotlight about all of your app's content, consider things that are
  particularly relevant to someone's personal context."*

⚠️ **No first-party source found contains the sentence "a wrong suggestion costs more than a missing
one", and none publishes a numeric confidence threshold for showing a proactive suggestion.** The
closest quantified analogue is Apple's "Hey Siri" post, which describes *"a primary, or normal
threshold, and a lower threshold that does not normally trigger Siri"*, with a second-chance window
that raises recall *"without increasing the false alarm rate too much because it is only in this
extra-sensitive state for a short time."* That asymmetric two-threshold design is the shape of the
answer, and it is the only shipped one anyone has published.

### 6.6 What happens when people stop reading: the hard numbers

The strongest field measurement of habituation is not from recommendation systems at all — it is from
browser security warnings, where the whole point is that the user is supposed to stop and read.

**Akhawe & Felt (USENIX Security 2013)** measured **25,405,944 warning impressions** in Chrome and
Firefox telemetry over May–June 2013:

| Warning | Firefox | Chrome |
|---|---|---|
| Malware | 7.2% | 23.2% |
| Phishing | 9.1% | 18.0% |
| SSL | 33.0% | **70.2%** |

Clickthrough here means *bypassed the warning*. Two things matter for Propositum. First, the range is
enormous — **7.2% to 70.2%** for warnings of similar severity — and the authors attribute it to design
and to how often the warning is wrong: *"the user experience of a warning can have a significant impact
on user behavior."* Second, the SSL warning, which fires on benign misconfigurations far more often
than on attacks, is the one bypassed 70% of the time. **The warning with the worst precision is the
warning nobody reads.** That is the mechanism ADR-0008 asserts, measured at scale.

Their within-SSL breakdown makes the mechanism explicit. Chrome SSL warnings by error type:

| Error type | Share of impressions | Clickthrough |
|---|---|---|
| Untrusted issuer | 56.0% | **81.8%** |
| Name mismatch | 25.0% | 62.8% |
| Expired | 17.6% | 57.4% |

Verbatim: *"Users clicked through 49% of untrusted issuer warning impressions within 1.7s… **We believe
that this data is indicative of warning fatigue: users click through more-frequent errors more
quickly.**"*

**The decay curve, measured.** Bravo-Lillo et al. (SOUPS 2013), 872 participants, had people repeatedly
dismiss a dialog and measured how long they engaged with it. Median seconds per trial:

| | 1st trial | 2nd | 25th pct | 50th pct | Last |
|---|---|---|---|---|---|
| Control | **10.48** | **6.06** | 1.36 | **1.03** | 1.05 |

**Engagement collapsed by about 90%, and roughly 42% of the drop happened after a single exposure.**
When the dialog's text was then quietly changed to contain a critical instruction, only **13–19%** of
participants in the ordinary conditions noticed. Anderson et al. (CHI 2015 — ⚠️ **not** PNAS, as it is
often cited) found the neural correlate: *"a **dramatic drop in the visual processing centers of the
brain after only the second exposure** to a warning, with further decreases with subsequent exposures."*

**And habituation generalises across visually similar things.** Vance et al. (SOUPS 2019, N=600) showed
that habituating people to *routine, non-security* notifications carried over to security warnings that
merely looked similar: click-through odds at the fifteenth exposure versus the first, OR **2.60**
(p=0.008) for permission warnings and **1.95** (p=0.047) for extension warnings, with no carryover to
visually dissimilar warnings. Reaction time fell **80 ms per position** for the similar warnings and not
at all for a novel stimulus, ruling out simple fatigue.

**This is the finding that should most worry a product with one notification channel.** Every routine,
correct-but-unimportant offer Propositum sends trains the person to dismiss the notification *shape*,
and the training transfers to the one offer that mattered.

### 6.7 At what false-positive rate do people stop reading? There is no cliff

The brief asked for a threshold. **The best available evidence says no such threshold exists, and that
the framing should be replaced.**

**Bliss, Gilson & Deaton (Ergonomics 1995)**, 138 participants exposed to alarm systems of 25%, 50% and
75% reliability, verbatim:

> *"most subjects (about 90%) do not respond to all alarms but **match their response rates to the
> expected probability of true alarms (probability matching)**. About 10% of the subjects responded in
> the extreme, utilizing an all-or-none strategy."*

Replicated by Bliss & Dunn (Ergonomics 2000, N=126): *"response frequencies supported earlier research
suggesting that participants 'probability match' their response rates to alarm system reliability."*

⚠️ The per-condition response rates are behind a paywall and were **not** verified; only the qualitative
probability-matching claim is safe to cite.

**Read plainly: engagement degrades roughly linearly with precision.** A system at 30% precision gets
roughly 30% engagement. There is no cliff to stay above and no safe zone below — every point of
precision is worth a point of attention, continuously. **That is a better model for `INVESTMENT_REQUIRED`
than a threshold, because it says the question is not "are we above the line" but "what is our precision,
and is anyone measuring it."**

The dose-response has been measured in the field, too. **Bonafide et al. (J Hosp Med 2015)**, 36 nurses,
5,070 alarms, modelled response time against the count of non-actionable alarms in the preceding two
hours:

| Prior non-actionable alarms | PICU response time | Ward response time |
|---|---|---|
| 0–29 | **2.8 min** | **7.7 min** |
| 30–79 | 5.3 min (p=.001) | 11.5 min (p=.001) |
| 80+ | **8.5 min** (p=.009) | **15.6 min** (p=.001) |

⚠️ **Report the failed replication alongside it.** Bonafide et al. (JAMA Pediatrics 2017), a larger study
(551 hours, 11,745 alarms, of which 0.5% were actionable) found *"The number of nonactionable alarms to
which the nurse was exposed in the preceding 120 minutes **was not associated with response time**"* —
but time-on-shift was, at **15% longer per hour elapsed**. Their conclusion: *"Chronic alarm fatigue …
may be a more important determinant of response time than short-term exposure."*

**And the base-rate argument, which is the one that binds.** Axelsson (CCS 1999 / TISSEC 2000) formalised
why low-base-rate detectors fail, and his sentences are the cleanest statement of Propositum's actual
risk:

> *"a low Bayesian detection rate would quickly 'teach' the [operator] to safely ignore all alarms…
> **a 50% false alarm rate, with a total of 100 alarms would clearly not be tolerable.**"*
> *"…by which time **no-one will bother to care when the alarm goes off**."*
> *"the factor limiting the performance of an intrusion detection system is not the ability to correctly
> identify behaviour as intrusive, but rather **its ability to suppress false alarms**."*

Substitute Donato et al.'s base rate — research missions are **10% of sessions** ([§5.1](#51-the-base-rate-which-is-the-number-everything-else-divides-by)) — and the
arithmetic is Propositum's own. At Search Pad's shipped precision of roughly two-thirds, one prompt in
three is wrong. At ProAgentBench's measured 51–61%, one in two is.

⚠️ **No published base-rate or PPV analysis specific to recommendation or suggestion systems was found.**
The transferable analyses are all from intrusion detection and clinical alerting. Modern clinical ML
gives the closest real-world instance: the Epic Sepsis Model (Wong et al., *JAMA Internal Medicine* 2021)
shipped at *"sensitivity of 33%, specificity of 83%, **positive predictive value of 12%**"*, generating
alerts for 18% of all hospitalised patients — *"thus creating a large burden of alert fatigue."*

⚠️ The famous *"72% to 99% of clinical alarms are false"* line is **SECONDARY** — it is the opening
sentence of a 2013 review (Sendelbach & Funk), commonly misattributed to Cvach 2012, whose "72" is the
number of articles reviewed. Individual primary ICU studies do support the range: 88.8% of annotated
arrhythmia alarms false (Drew et al., *PLoS ONE* 2014, 2,558,760 alarms); 86% false-positive with only
8% clinically significant (Tsien & Fackler 1997); 99.4% false in an ED setting (Atzema et al. 2006).

The measured non-response rate is the number to hold beside those: **Görges et al. (2009)** classified
1,214 ICU alarms and found *"**23% were effective, 36% were ineffective, and 41% were ignored**"* —
77% producing no effective response. And self-report: 78% of 1,327 nurses said alarms *"can reduce trust
in alarms and cause caregivers to disable them"* (Korniewicz et al. 2008).

### 6.8 The cost of the interruption itself

**Mark, Gudith & Klocke (CHI 2008)**, 48 subjects interrupted every two minutes:

| Condition | Time to perform task (min) | Stress (1–20) |
|---|---|---|
| Baseline, no interruption | **22.77** (7.60) | 6.92 (3.85) |
| Same-context interruption | 20.31 (5.94) | higher (F(2,92)=12.15, p<.001) |
| Different-context interruption | 20.60 (4.93) | highest |

**People completed interrupted tasks *faster*, not slower.** The cost is affective, and it is large:
stress 6.92 → 9.46, frustration 4.73 → 6.63, time pressure 11.02 → 12.69, effort 9.50 → 11.04 (all
1–20 scales, all significant). The paper's own summary: *"people compensate for interruptions by working
faster, but this comes at a price."* And: *"After only 20 minutes of interrupted performance people
reported significantly higher stress, frustration, workload, effort, and pressure."*

⚠️ **And one finding that contradicts an assumption this product is built on.** Mark et al. varied
whether the interruption was *about the same topic* as the work in progress, and found it made no
difference: *"interruptions that share a context with the main task may be perceived as being beneficial
but **the actual disruption cost is the same as with a different context**."* Propositum's implicit
premise is that an offer about the very thing you are doing is a cheap interruption. **On this
measurement it is not.** It may be more *welcome* — Iqbal & Bailey's relevance results below say it is —
but it costs the same to absorb.

⚠️ **The "23 minutes 15 seconds to refocus" claim has no primary source, and the popular framing inverts
it.** Traced: the number comes from a 2006 *Gallup Business Journal* interview with Gloria Mark, where
her sentence is *"it was resumed, on average, in 23 minutes and 15 seconds, **which I guess is not so
long**."* The corresponding published figure, in Mark, González & Harris (CHI 2005, 24 informants,
700+ hours of observation), is different in value and in meaning:

> *"When people did resume work on the same day, it took an average length of time of **25 min. 26 sec
> (sd=54 min. 48 sec.)**. **This may seem like a relatively short amount of time**, but it is also
> important to consider that before resuming work, our informants worked in an average of **2.26
> (sd=2.79)** working spheres."*

So: 25:26, not 23:15; a standard deviation more than twice the mean; it is elapsed wall-clock time during
which the person did roughly two *other legitimate work activities*, not time spent recovering; and both
the paper and its author describe it as short. **It is not a measure of interruption cost and should not
be used as one.**

**What the best-sourced cost number actually is.** Iqbal & Horvitz (CHI 2007), 27 people's real machines
over two weeks, alert rate **3.74/hour**: return to the suspended application averaged **9 min 33 s**
(SD 13 m 15 s) for email and **8 min** (SD 11 m 32 s) for IM; the full resumption phase ran **10 to 16½
minutes**. Their summary: *"participants spent on average nearly 10 minutes on switches caused by alerts,
and spent on average another 10 to 15 minutes … before returning to focused activity."* And the tail is
long: **27% of task suspensions resulted in more than two hours until resumption.**

Their most relevant finding for this product is about **which** tasks get resumed: how long a person had
already been on a task before suspension predicts whether and when they return. That is the same variable
Agichtein et al. found to be the single strongest predictor of task continuation
([§4.1](#41-how-much-history-actually-helps)), and it is a direct argument for
`WORKED_MS_FOR_HANDOFF` existing at all.

### 6.9 When a proactive suggestion is actually welcome

The literature is unusually constructive here, and every result points at **timing** rather than content.

**Delivering between tasks costs nothing; delivering during them costs a lot.** Bailey & Konstan
(*Computers in Human Behavior* 2006, N=50) held the peripheral task constant and varied only *when* it
arrived. Delivered mid-task: *"users require from **3% to 27% more time** to complete the tasks, commit
**twice the number of errors** across tasks, experience from **31% to 106% more annoyance**, and
experience **twice the increase in anxiety**."* Delivered between tasks: **no measurable performance
degradation at all.** Their conclusion: *"deferring presentation for a short time, i.e. just a few
seconds, can lead to a large mitigation of disruption."*

Note the mechanism, because it is counter-intuitive and it matters: the errors were not caused by the
interruption itself (F(2,48)=0.18, p<0.83) but by the **expectancy** of interruption. A system that
*might* interrupt at any moment imposes a cost even when it stays silent.

**Waiting for a breakpoint is cheap.** Iqbal & Bailey (CHI 2008) measured a mean deferral to the next
task breakpoint of **88.6 s** (SD 139.3) — *"the average deferral time was less than 90s. We believe this
provides an acceptable balance."* Users at breakpoints reacted **faster** (3.07 s vs 4.08 s) and reported
markedly less frustration (2.6 at Medium breakpoints vs 4.5 for immediate delivery).

**Relevance buys tolerance.** Same study: general-interest notifications produced frustration 4.98
against 3.59 for relevant ones (p<0.001), and resumption after a relevant notification took **4.65 s**
against **23.1 s** for a general-interest one, because irrelevant ones triggered chains of diversion.
Mehrotra et al. (CHI 2016) found the same asymmetry from the user's side: **54% of notifications users
explicitly labelled disruptive were clicked anyway** — *"users give precedence to a notification over
the primary task, **but only if the content is valuable**."*

**Bad timing damages the relationship rather than the throughput.** Adamczyk & Bailey (CHI 2004) is the
most directly applicable result in this whole section. Interrupting at the worst moment versus the best
raised annoyance **56%**, frustration **49%**, and time pressure **55%** — and the best moment conveyed
**43% more respect** than the worst and **27% more** than a random moment. But: *"There were no
significant effects on **Resumption Lag**"*, and none on time spent on the interruption.

**What a person loses to a badly-timed offer is not minutes. It is their estimate of whether the system
respects them.** That is precisely what ADR-0008 means by "teaches them to ignore the feature", and it is
measurable, and nobody in this repo is measuring it.

**Users want the channel; they want less of it.** Pielot & Rello (CHI EA 2017) had 30 people disable all
notifications for 24 hours: they were more productive and *"less connected and anxious about violating
responsiveness norms"*, and **73.3% intended to disable *some*** notifications afterwards — with 59.1%
still following through two years later. None wanted to disable all. Iqbal & Horvitz (CSCW 2010) found
users acted on only **26.2%** of notifications and yet **17 of 18** wanted to keep them.

---

## 7. Screenshots and vision-based context

The repo is considering a rolling screenshot cache. `docs/SECURITY_AND_PRIVACY.md` currently promises
"no screen recording, no video, and no screenshot of anything you are doing", with the single
exception carved out by [ADR-0010](../adr/0010-acting-in-the-browser.md): a screenshot **only when the
accessibility tree is insufficient**, and only of a tab Propositum itself opened, while acting under a
ratified contract.

**The evidence says that exception is the right shape, and that widening it would buy less than it
costs.**

### 7.1 The head-to-head comparisons go against pixels

The cleanest same-model comparison is **OSWorld** (arXiv:2404.07972), which runs identical models over
identical desktop tasks with different observation spaces. Overall success rate:

| Model | Accessibility tree | Screenshot | Screenshot + a11y | Set-of-Mark |
|---|---|---|---|---|
| **GPT-4o** | **11.36%** | **5.03%** | 11.21% | 4.59% |
| GPT-4V | — | 5.26% | 12.17% | 11.77% |
| Claude-3-Opus | — | 2.42% | 4.41% | 6.72% |
| Gemini-Pro-1.5 | 4.81% | 5.40% | 5.10% | 7.79% |
| **GPT-4 (no vision at all)** | **12.24%** | — | — | — |
| *Human* | — | — | — | *72.36%* |

For GPT-4o the accessibility tree alone is **2.26× the screenshot alone**; adding the screenshot on top
makes it slightly *worse*; Set-of-Mark makes it dramatically worse. **The single best cell in the whole
table is a text-only model reading a structured tree.** OSWorld's own explanation for the Set-of-Mark
regression: desktop tasks have *"higher resolution and much more elements… leading to a significant
amount of noise that counteracts the auxiliary role of bounding boxes."*

**VisualWebArena** (arXiv:2401.13649) is a benchmark built specifically to require vision, and even
there the margin is small: GPT-4V with Set-of-Mark reaches **16.37%** overall, against **12.75%** for
GPT-4 reading an accessibility tree plus cheap BLIP-2 image captions. A full VLM buys under four
points over "structured text plus a caption". Note also that the table contains **no screenshot-only
row** — every multimodal configuration still ships the accessibility tree.

**SeeAct** (arXiv:2401.01614) localises where vision breaks. GPT-4V with *oracle* grounding reaches
**51.1%** whole-task success on live websites against 13.3% for text-only GPT-4 — so its *perception*
is excellent. But its best actual grounding strategy is the one that converts the visual understanding
back into **textual choices** (37.8%), and image-annotation grounding scores 20.3% against 46.4% for
textual choices on Mind2Web Cross-Task. Verbatim, and this is the sentence to remember:

> *"Grounding via image annotation … shows promising results in recent work that focuses on object- or
> scene-centric images. **However, we find that on complex images with rich semantic and spatial
> relationships like webpage screenshots, severe hallucination is observed from GPT-4V.**"*

And: *"grounding is still a major challenge. The best grounding strategy still has a 20–30% gap with
oracle grounding."*

**Microsoft's own agent research agrees.** WindowsAgentArena (arXiv:2409.08264): *"adding high-quality
UIA markers in addition to pixel-based element detectors boosts performance by **57%** for Omniparser,
**52%** for open-sourced models, and **15%** for proprietary pixel models."* The accessibility tree is
worth up to +57% on top of the best pixel parsing available.

**And the strongest text-only result is the most recent.** AgentOccam (arXiv:2410.13825) reaches
**43.1%** on WebArena against the original 16.5% baseline — *"we focus only on the text modality"* —
by cleaning up the observation and action space rather than adding a modality.

### 7.2 The genuine case for pixels, stated fairly

Two counter-examples, and both of them are narrower than they first appear.

**OmniParser** (Microsoft, arXiv:2408.00203) claims *"OmniParser with screenshot only input outperforms
the GPT-4V baselines requiring additional information outside of screenshot"*, and on Mind2Web beats
HTML-based GPT-4V on Cross-Website (+4.1) and Cross-Domain (+5.2) while losing slightly on Cross-Task
(−0.8). So pixels win where **generalisation to unseen sites** is tested and lose where the
distribution is familiar. But the mechanism matters: Microsoft Research's own description is that
OmniParser *"tokenizes"* screenshots *"from pixel spaces into structured elements in the screenshot
that are interpretable by LLMs."* **It wins by rebuilding the structure it refused to inherit.**

**UI-TARS** (arXiv:2501.12326) is a native model that *"solely perceives the screenshots as input"* and
reaches 24.6 on OSWorld against Claude's 22.0. That is an argument that pixel-only becomes viable with
enormous task-specific training, not that pixels carry more information.

**Apple's is the honest version of the pixel argument, and it is about coverage rather than accuracy.**
*Screen Recognition* (CHI 2021 Best Paper) trained on 77,637 screens from 4,068 iPhone apps and reached
**71.3% mean average precision** across thirteen UI types, at 20 MB and ~10 ms on device. Their
rationale, verbatim: pixel approaches *"are more independent of the underlying app toolkit and do not
require UIs to be exposed via APIs"*, and *"the visual interfaces for mobile apps often receive the
most attention from developers and best represent an app's intended functionality."* The measurement
that justifies it: **59% of screens have annotations that do not match any accessible UI element**,
**94% of apps have at least one such screen**, and 4% of screens expose no accessibility elements at
all.

But Apple's own discussion concedes the compromise: *"While combining information from our approach and
view hierarchy could reconstruct a more complete set of accessibility metadata, we found that
implementing this idea presents engineering challenges."* And by **Ferret-UI 2** (arXiv:2410.18967)
Apple had walked back toward structure for training data — web training labels are *"directly parsed
from the source HTML view hierarchy tree, providing **high-quality annotations**."*

The sharpest limit on pixels comes from Apple too. *Never-ending Learning of UIs* (UIST 2023) found
that tappability models trained on human labels from **screenshots** dropped to **F1 = 0.60** when
checked against what actually happens on tap, versus 0.81 on heuristic labels validated by interaction:
*"workers labeling whether a UI element is 'tappable' from a screenshot must guess using visual
signifiers, and do not have the benefit of tapping on the UI element … and observing the effects."*
**Affordance is not in the pixels.**

**The honest synthesis: what the model consumes is structured text either way. The only question is
whether you inherit the structure or pay to rebuild it.** In a browser, Propositum inherits it for
free — which is exactly why ADR-0010 already puts the accessibility tree first.

### 7.3 What Microsoft Recall documents, and what it does not

Recall is the only shipped rolling-screenshot cache with first-party documentation, and it is worth
reading closely because the repo is contemplating the same thing.

**What it is**, verbatim from Microsoft Learn: *"Snapshots are taken periodically while content on the
screen is different from the previous snapshot"*; the consumer page says *"every few seconds and when
the content of your active window changes"*. ⚠️ The widely-repeated "every 5 seconds" and "25 GB ≈ 3
months" figures **appear on no Microsoft primary page checked**. Treat both as unsourced.

**The retrieval index is text.** *"Recall uses optical character recognition (OCR), local to the PC, to
analyze snapshots and facilitate search"*, into a vector database. **Microsoft's own screenshot-memory
product converts pixels back into text before anything can find anything.** That is the same conclusion
as §7.1, arrived at by a product team rather than a benchmark.

**What it costs.** 25 GB allocated at 256 GB device capacity, 75 GB at 512 GB, 150 GB at 1 TB or higher;
retention configurable to 30/60/90/180 days. Hardware floor: a 40 TOPS NPU, 16 GB RAM, 8 logical
processors, BitLocker, and Windows Hello Enhanced Sign-in Security with biometrics. The one independent
measurement of screen-capture storage found is **0.19 GB per active day** over 51 days (Activity Frames,
arXiv:2608.05784 — ⚠️ N = 1, single author, preprint).

**Token cost, which is the number that actually decides this for Propositum.** Per Anthropic's vision
docs, an image costs `⌈width/28⌉ × ⌈height/28⌉` visual tokens; a 1920×1080 screenshot is **1,560 tokens**
on the standard tier and **2,691** on the high-resolution tier. Anthropic's own guidance: *"If you don't
need the additional fidelity that high resolution provides for computer use, screenshot understanding,
and dense documents, downsample images before sending to control token costs."* At one frame every five
seconds over an eight-hour day — 5,760 frames — naively feeding every frame at high resolution is on
the order of **15 million input tokens per day** *(arithmetic mine, from the published per-image
figures)*. This is why both published screen-capture systems converge on filter-then-summarise rather
than feed-everything: FOCAL (arXiv:2604.19541) reports *"reduces total token consumption by 60.4% and
VLM call count by 72.3%"*, and Activity Frames reports 86× context compression.

**The security record, which is the part that should settle it.** Microsoft's published account
(David Weston, CVP Enterprise and OS Security, Sept 2024) reports that *"The Microsoft Offensive
Research & Security Engineering team (MORSE) has conducted months of design reviews and penetration
testing"* and *"A third-party security vendor was engaged to perform an independent security design
review and penetration test."* ⚠️ **The vendor is not named and no results were published.** There is no
MSRC-channel write-up.

Note Microsoft's own verb for the sensitive-content filter: *"Sensitive content filtering is on by
default and **helps reduce** passwords, national ID numbers and credit card numbers from being stored in
Recall."* Helps reduce, not prevents. The reference page lists roughly 170 detected types — Credit Card
Number, General Password, U.S. Social Security Number, IBAN, SWIFT Code, Azure storage keys — and
⚠️ **publishes no accuracy figure, no false-negative rate, and no stated limitation of any kind.**

The one first-party admission of incompleteness is in the Nov 2024 Insider post: *"We'll continue to
improve this functionality, and if you find sensitive information that should be filtered out, for your
context, language, or geography, please let us know."*

Microsoft does document one concrete leak, and it is the one most relevant to a browser product:

> *"Be aware that websites are filtered when they are in the foreground or are in the currently opened
> tab of a supported browser. **Parts of filtered websites can still appear in snapshots such as
> embedded content, the browser's history, or an opened tab that isn't in the foreground.**"*

**And independent testing of the hardened, re-released version found the filter failing.** Kevin
Beaumont, April 2025, testing shipped Recall on a Copilot+ PC:

> *"**The feature to filter sensitive data doesn't appear to work reliably, across multiple devices from
> testing.**"*
> *"In this snapshot I'd typed an invalid credit card number, but it also captured the valid card
> number. It indexed both, and both were findable under 'credit card' in Recall search. **It captured
> and indexed the CVV, too.**"*
> *"**Recall still captures and stores things after deletion.** E.g. disappearing Signal and WhatsApp
> messages are still captured, as are deleted Teams messages."*
> *"I sent a private, self deleting message to somebody with a photo of a famous friend which had never
> been made public — **Recall captured it, and indexed the photo of the person by name in the
> database.**"*

His earlier assessment, May 2024, is the sentence that shaped the product's reception: *"In essence, a
keylogger is being baked into Windows as a feature."*

The current version of Alex Hagenah's TotalRecall no longer attacks the encryption at all — it injects
into the unprotected `AIXHost.exe` rendering process, which receives decrypted data after enclave
authorisation and lacks Protected Process Light status, so same-user code injection reads plaintext
without admin rights. **Encryption at rest does not defend a cache that a process on the same machine
must be able to read.** That is precisely the threat model a local-first product on a developer's
laptop lives in.

⚠️ The UK ICO's June 2024 statement could not be verified against a primary source — `ico.org.uk`
returns HTTP 403 to automated fetchers. It exists here only as **SECONDARY** press coverage and should
be read from a browser before being quoted.

### 7.4 The retrieval result nobody quotes

Even granting a perfect capture, retrieval over a screenshot archive is hard. **NTCIR-14 Lifelog-3**
— 2 lifeloggers, 43 days, 81,474 images at about two per minute — reports fully automatic retrieval at
**MAP 0.045–0.063**. Interactive, human-in-the-loop runs reach 0.399. **Under 7% MAP is the published
state of automatic search over a personal visual archive**, and the gap between automatic and
interactive is the whole story: the archive is useful when a person steers it and close to useless when
a machine does.

Against that, the one thing periodic visual capture is *demonstrated* to do well is help a **human**
remember. Microsoft Research's SenseCam work (UbiComp 2006) reports the Mrs B amnesia case study:
*"over the course of a two week period of testing and review of a given event, Mrs B's recall of that
event nearly tripled"*, reaching *"a 76% average recall across all the events at the final test"* —
where a written diary produced maintenance but no improvement, and no aid at all produced *"nothing
about an event that occurred just five days earlier."*

**That is a real and impressive result, and it is a result about a person reviewing images, not about a
system inferring intent from them.** It is evidence for a recall product. It is not evidence for this
one.

### 7.5 Verdict on the screenshot cache

For **inferring what someone is working on in a browser**, a rolling screenshot cache is the expensive
way to obtain a worse version of information the browser already hands over for free. The published
head-to-heads put structured text ahead by roughly 2× on the same model; the one shipped screenshot
memory converts to text before indexing; automatic retrieval over such an archive runs under 7% MAP;
the token cost is on the order of tens of millions per day if used naively; and the only shipped
example's sensitive-content filter was independently found capturing a credit card number and its CVV.

The narrow case where pixels genuinely win — an interface with no accessible structure — is a case a
browser extension does not have. **ADR-0010's rule ("a screenshot only when the tree is insufficient")
is the correct rule, and the evidence says it should stay exactly that narrow.**

---

## 8. Asking instead of inferring

The brief asked: what is the evidence that any of this beats simply asking the person a short question?

**The honest answer is that the evidence is genuinely split, and that this is one of the two places in
this document where an initial reading had to be walked back.** The decision theory says asking
dominates in exactly the band of uncertainty Propositum lives in. The measured results say asking has a
huge ceiling *and a real floor*, that the achievable share of the ceiling is under half, and that in the
one direct head-to-head anyone has run, **inferring beat idealised explicit feedback**. Both halves are
below.

### 8.1 Asking is a third option, and it is provably the right one in the middle

**Horvitz, "Principles of Mixed-Initiative User Interfaces" (CHI 1999)** sets out the decision-theoretic
frame that everything since has been an instance of. Given evidence *E* and a goal *G*, the expected
utility of acting is

> `eu(A|E) = p(G|E)·u(A,G) + [1 − p(G|E)]·u(A,¬G)`

and of not acting the analogous expression, so the two lines cross at a single threshold probability
`p*`. Acting above `p*`, refraining below. Crucially, `p*` is set by the **utility ratio**, not by the
classifier: *"The utility of unwanted action can diminish significantly with increases in the depth of
a user's focus on another task. Such a reduction in the value of action leads to a higher probability
threshold."*

Then the move that matters here — **adding dialog as a third action**:

> *"the utility of engaging in a dialog with a user when the user does not have the goal in question is
> typically greater than the utility of performing an action when the goal is not desired. However, the
> utility of asking a user before performing a desired action is typically smaller than the utility of
> simply performing a desired action when the user indeed has the goal. In such circumstances … action
> can be guided by two new threshold probabilities: the threshold between inaction and dialog,
> `p*¬A,D`, and the threshold between dialog and action, `p*D,A`."*

**There is a band of probability in which asking dominates both acting and staying silent, and a
heuristic detector over browsing metadata lives permanently inside that band.** Horvitz's own
principles list makes the same point twice more: principle (5) *"Employing dialog to resolve key
uncertainties … considering the costs of potentially bothering a user needlessly"*, and principle (8)
*"Scoping precision of service to match uncertainty… **A preference for 'doing less' but doing it
correctly under uncertainty** can provide user's with a valuable advance towards a solution and
minimize the need for costly undoing."*

**Propositum's architecture is already at the dialog node**, and that is its single strongest design
decision measured against this literature: ADR-0008 says *"it produces a suggestion. Never a session,
never an action."* What is missing is the other half of Horvitz's frame — there is no `p(G|E)`
anywhere in the system, and no representation of the utility ratio. `groundsFor` returns a boolean from
a fixed conjunction. That works, and its determinism is defended at length and for good reasons, but it
means the threshold cannot move with context, and the two things §6 says most change the utility ratio
— how recently the person declined something, and how deep their current focus is — cannot enter the
decision.

### 8.2 The measured version: acquisition is the bottleneck, not inference

**ATRBench** (arXiv:2605.28108, May 2026) isolates exactly this question for long-lived agents. Its
"Ask-to-Remember" task: the agent decides whether to *ask now* for a reusable user preference that the
current task does not need but a later session will. Preferences are held as hidden ground truth, so
*"success demands asking, not recall."*

The headline, verbatim from the abstract:

> *"Across eight frontier LLM agents, **defaults fall at least 62 points below an oracle handed the
> relevant preference, and prompting closes little of it. Diagnostics identify acquisition as the
> bottleneck.**"*

The reported spread: oracle agents handed the preference reach **82.5–96.7%**; default agents reach
**15.0–23.7%**; prompting recovers only **1.3–15.5%** of the available headroom, with best non-oracle
improvements of **+0.9 to +11.9 points**.

**Read that against the team's plan.** The gap between "knows the standing preference" and "does not"
is sixty-two points or more. The gap that richer observation is being asked to close — the gap between
"good behavioural signal" and "better behavioural signal" — is, per Fox et al., four points. **These are
not the same size of problem, and the effort is currently pointed at the smaller one.**

### 8.3 The floor: a bad question is worse than no question

**Aliannejadi et al. (SIGIR 2019)**, the Qulac dataset — 198 topics, 762 facets, 2,639 clarifying
questions — measured what one clarifying question is worth. Asking the *best* available question, once:

> *"the relative improvement of the system after asking only one question… **BestQuestion achieves over
> 100% relative improvement**… (MRR: 0.2820 → 0.5677, P@1: 0.1933 → 0.4986, nDCG@1: 0.1460 → 0.3988)."*

That is the ceiling, and it is enormous. Two things bring it down to earth, both from their Table 3:

| Method | MRR | vs. original query |
|---|---|---|
| OriginalQuery | 0.2715 | — |
| **NeuQS** (their actual model) | 0.3625 | **+33.5%** |
| BestQuestion (oracle) | 0.4673 | +72.1% |
| **WorstQuestion** | **0.2479** | **−8.7%** |

1. **The achievable share of the headroom is under half.** The oracle gets +72%; the best real question
   *selector* gets +33.5%.
2. **A bad question is worse than silence.** WorstQuestion (0.2479) falls below asking nothing (0.2715).

**The shipped evidence is real but narrower than it is usually quoted.** Zamani et al. (WWW 2020) ran
Bing's clarification pane against 2.5 million users for a week and report *"**48.57% more engagements
(relative)** using the clarification pane with clarifying question, compared to the one with static
title"* (p < 10⁻²⁰). ⚠️ **Both arms showed the same candidate answers** — this measures *phrasing a
refinement as a question rather than as a title*, not asking versus inferring.

Their follow-up (SIGIR 2020), over **74,617,653 clarification-pane impressions**, gives the best real
outcome number: *"We measured dissatisfaction for the sessions in which users interact with clarification,
and observed **16.6% less dissatisfaction** compared to the overall dissatisfaction of the search
engine"* — with their own caveat that *"this relative number is not a completely representative
comparison."*

And a counter-intuitive detail that matters for a detector: relative engagement with the clarification
pane was **1.58** on natural-language questions and **1.52** on faceted queries, but only **0.70** on
*ambiguous* ones — *"faceted queries are approximately 100% more likely to receive a click compared to
the ambiguous queries"*, because on ambiguous queries the results page already covers the dominant
intent and users skip the pane. **Clarification engages least exactly where uncertainty is highest.**

⚠️ MIMICS (CIKM 2020) does **not** publish real Bing CTR — *"the engagement levels released in the paper
by no mean represent the overall clickthrough rates in Bing"* — and Bing's clarification is explicitly
**not personalised**: *"the clarification panes were solely generated based on the submitted queries,
therefore they do not include session and personalized information."*

### 8.4 The other direction: inferring beat idealised asking

The only direct head-to-head found goes the other way, and it is in the canonical personalisation paper.

**Teevan, Dumais & Horvitz (SIGIR 2005)**: *"We were somewhat surprised to find that **Web search
personalization also performed somewhat better than ideal relevance feedback (RF, p<0.05)**."* A rich
passive behavioural profile outperformed *idealised explicit user feedback*. They also report that *"it
was more important to have a rich user profile than to have a rich document representation."*

**And their follow-up explains why asking has a ceiling that is not about the questioner.** Teevan,
Dumais & Horvitz (TOCHI 2010), on the potential for personalisation:

> *"**Even when our participants expressed similar intents for the same query, they still rated the query
> results very differently.** This highlights the **difficulty of articulating information needs** and
> suggests that the participants did not describe their intent to the level of detail required to
> distinguish their different goals."*

Concretely: for three participants who all stated they wanted "information about Microsoft, the company",
*"only one page … was given the same rating by all three individuals. Twenty-six of the 40 results were
rated relevant or highly relevant by one of these three people, and for only six of those 26 did more
than one rating agree."*

**People cannot fully articulate what they want, so a question retrieves a lossy answer too.** The same
paper puts a number on the whole personalisation opportunity: at group size six, the best group ranking
gave *"a **46% improvement in DCG** over the current Web ranking (0.85 vs. 0.58), while the best
individual ranking led to a **70% improvement** (1.00 vs. 0.58)."* The gap between 0.85 and 1.00 is
everything personalisation can ever buy.

### 8.5 The corroborating shape from products

- **Microsoft Viva Briefing** enforces the strictest version of "say nothing rather than guess":
  *"you will never be sent an empty email with no content."* It is a shipped instantiation of
  `PRODUCT_PRINCIPLES.md` §13.
- **Apple's "Hey Siri" post** is the only published operating point that implements Horvitz's structure
  concretely — *"a primary, or normal threshold, and a lower threshold that does not normally trigger
  Siri"*, with a brief extra-sensitive window after a near-miss that raises recall *"without increasing
  the false alarm rate too much because it is only in this extra-sensitive state for a short time."*
  A near-miss does not fire; it makes the system briefly more willing to be told.
- **Yahoo! Search Pad** asked rather than acted — *"Do you want to take notes?"* — which by Horvitz's
  frame was correct at 63–67% precision, since acting at that precision would have been indefensible.
  What it never established was whether the question was worth asking.

### 8.6 What this means concretely

At Propositum's plausible precision — nothing here is measured, but Search Pad's two-thirds is the only
comparable shipped number, and ProAgentBench's 51–61% is the only measured one — **acting is out of the
question and asking is the correct move.** That is already the design.

The improvement available is not a better inference. It is **a better question**. Today the offer asks
the person to ratify a whole composed proposal about work Propositum has guessed at. §8.2 says the
expensive missing fact is a standing preference or constraint the person has never been asked for, and
that no amount of watching produces it.

But §8.3 and §8.4 say the naive version of that conclusion is wrong in three specific ways, and all
three are actionable:

1. **A bad question costs more than silence** (Qulac: −8.7%). So the question needs the same kind of bar
   `grounds.ts` puts in front of an offer, not a lower one.
2. **The achievable share of the headroom is under half** (0.3625 against an 0.4673 oracle). Do not
   budget for the ceiling.
3. **People cannot fully articulate intent** (Teevan TOCHI 2010: three people with the same stated intent
   agreed on one page out of forty). A question about *intent* will retrieve a lossy answer. A question
   about a **standing constraint** — a preference that is stable, that the person can state, and that
   they will not be asked again — is the shape ATRBench measures and the shape that carries 62 points.

**And the framing matters as much as the fact of asking.** Bing's 48.57% engagement lift came from
phrasing the same refinement as a question rather than a title. Propositum's offer is already phrased as
a question; the improvement available is in *what* it asks about, not *whether* it asks.

The right place for it is also settled by §6.9: **Home, not a notification.** A question asked where the
person chose to look costs nothing by Bailey & Konstan's measurement; the same question delivered as an
interruption costs 3–27% task time and doubles errors, and does so through *expectancy* even on the
occasions it stays silent.

---

## 9. Signal-by-signal verdict for Propositum

What the ambient path collects, per `src/app/api/capture/ambient/route.ts`: `at`, `url`, `title`,
`kind`, `engagedMs`, and — since 2026-08-17, added while this research was running — `scrollFraction`.
`content.js` also listens for `selectionchange`, which the ambient path does not carry.

⚠️ **Two of the rows below moved under this document as it was being written**, and the state is
recorded rather than smoothed over: `scrollFraction` now reaches the server and nothing reads it, and
the `came-back` limitation is now written into `grounds.ts` with a decision attached to it
([§10.2](#102-make-scrollfraction-do-something-half-landed-while-this-was-written),
[§10.3](#103-narrow-came-back-to-cross-origin-returns-recorded-in-the-code-not-acted-on)).

| Signal | Have it? | Evidence | Verdict |
|---|---|---|---|
| **Dwell (`engagedMs`)** | ✅ | Fox: co-top of 19 predictors. Claypool: strong. Kim: needed but not sufficient alone | Keep. Best-evidenced signal in the system |
| **Exit type** — how the page was left | ❌ | Fox: the *other* co-top variable; dwell + exit type = 66% vs 70% for all nineteen | **The single best-evidenced addition.** See §10.1 |
| **Scroll depth** | ⚠️ sent since 2026-08-17, read by nothing | Claypool: *"time spent … the amount of scrolling … and the combination of time and scrolling had a strong correlation"*. Fox: present but not top-2 | **Second-best addition, and now free.** See §10.2 |
| **Lexical overlap across pages** (`findThreads` seeds) | ✅ | Jones & Klinkner: Levenshtein 89.0% vs time 62.5% on goal boundaries. Wang: Q-COSINE +5.30 vs S-SAME +1.00 | Keep. This is the strongest feature in the segmentation literature and the repo picked it independently |
| **Search-query detection** (`searchQueryOf`) | ✅ | Donato: session features are the top predictors of a *research* mission. Also the only string the person typed | Keep. Structural test over brand list is the right call |
| **Return visits** (`came-back`) | ✅ | Adar: in the sub-hour band, 77.0% same-domain, 87% same-site links, 2.9% via search | **Weakest ground. Narrow it.** See §10.3 |
| **Time span** (`SUSTAINED_MS`, `WORKED_MS_FOR_HANDOFF`) | ✅ | Agichtein: TaskSpanTime is the single strongest continuation predictor (1.000, r=.412). Iqbal & Horvitz: 5–30 min tasks get resumed | Keep. Best-supported constants in the codebase |
| **Window length** (`WINDOW_MS = 30 min`) | ✅ | Catledge & Pitkow: the real number is 25.5 and it measures walking away. Jones & Klinkner: 30 min is worse than a do-nothing baseline. ProAgentBench: plateau at 5 min | **Folklore.** It is a fine retention bound and a bad task boundary. See §10.4 |
| **Page text** | deliberately excluded | Agichtein 2012: *"removing text features … has negligible effect on performance"* | The exclusion costs less than the ADR fears |
| **Screenshots** | excluded | OSWorld: a11y tree 2.26× screenshot on the same model. Recall OCRs back to text anyway | Keep excluded. See §7.5 |
| **Text selection / copy** | listened for, unused in ambient | No primary source found measuring selection as an intent signal | Unknown. Do not assume |
| **Mouse movement / clicks** | not collected | Claypool: clicks *"not a good indicator of interest"*; mouse movement useful only for the *least* interesting pages | Do not collect |
| **Navigation `transitionType`** (typed vs link) | not collected — costs "Read your browsing history" | No primary evidence found either way | Unknown, and the permission cost is real |
| **Structured long-term memory** | none | ProAgentBench: KG memory +11.8% accuracy, +26.9% intention accuracy | The one *richer-input* intervention with a positive measured result |

### 9.3 `came-back` is the weakest ground, and the fix is one predicate

`INTENT_GROUNDS` is the half of `groundsFor` that separates *pursuing* from *receiving*, and its own
docstring says every member is *"an act of navigation a person had to choose"* and that *"None of them
can be produced by sitting still."* `ThreadPage.visits` calls a return *"the strongest statement of
intent available without asking."*

Adar, Teevan & Dumais measured what returns actually look like. Their Table 4, for the **fast** group —
pages revisited in under an hour, which is the *only* band a 30-minute buffer can observe:

| | Fast (<hourly) | Medium (daily) | Slow (>daily) |
|---|---|---|---|
| Previous URL is the same | 28.6% | 6.8% | 7.3% |
| **Previous URL same domain** | **77.0%** | 43.8% | 56.5% |
| **Accessed via a search** | **2.9%** | 4.0% | 4.3% |
| Characteristic substrings | buy, shop, photo | mail, bank | money, weather |
| Self-reported reason | *"Buy something, monitor live content"* | *"Communicate, listen to music"* | *"Interact with personal data"* |

Their explanation, verbatim: *"Many of the pages in the fast group appeared to exhibit a hub-and-spoke
revisitation pattern. For example, a person may start at a list of all products, such as a table of
blouses, visit an individual product description pages and then rapidly return to the original page to
explore more options."* And: *"Seventy seven percent of all revisits in the fast group were from the
same domain … the fast group had the highest number of links on the page pointing back at pages in the
same site (87%)."*

`visitsByUrl` already excludes the 28.6% (a reload, where the previous navigation was the same URL). It
does **not** exclude the 77% — hub → item → hub → item gives the hub `visits = 3`, and `came-back`
fires, and the sentence *"You went back to `<host>` after leaving it"* is rendered about a listing page
someone paged through. On Adar's data that is the *dominant* pattern in the sub-hour band, its
characteristic vocabulary is "buy, shop, photo", and its self-reported motive is shopping and
monitoring.

This matters more than it looks because `INTENT_REQUIRED = 1` and `came-back` is the intent ground with
no search behind it. It is the only door through which the newsletter afternoon that
`INVESTMENT_REQUIRED` spends its docstring refusing can obtain its one intent ground. `grounds.ts`
already anticipates this in the abstract — *"the next thing to do about it … is a ground that separates
'still here' from 'came back to it', which does not exist yet"* — and Adar et al. supply the missing
predicate.

---

## 10. What this means for the code

Five changes, in evidence-strength order. Each is cheap, each is in the direction ADR-0008 calls the
cheap direction, and none requires a new permission, a model call, or a byte of new page content.

### 10.1 Carry `exitType` on the ambient path

**Evidence:** Fox et al. — exit type is co-equal with dwell as the top predictor, and **dwell + exit
type recovers 94% of a nineteen-feature model's SAT accuracy**. Every decision-tree node quoted in that
paper conditions on it. It is the difference between *"they read it and moved on"* and *"they bounced
straight back"*, and dwell alone cannot express that difference.

**What it costs:** one enum on `AmbientObservation` and one field on `ambientSchema`. The extension
already knows the answer — `content.js` fires on `pagehide` and `visibilitychange` and the service
worker sees the next navigation. Something like `'navigated-on' | 'closed' | 'back' | 'switched-away' |
'unknown'`. It is metadata about *this* page, carries no page content, and does not widen the privacy
promise by a word.

**What it buys:** a `read-deeply` ground that is a conjunction rather than a threshold — sixty seconds
followed by navigating onward is a different event from sixty seconds followed by an immediate back,
and the literature says the second one is a *dissatisfaction* signal at p ≈ 0.734.

### 10.2 Make `scrollFraction` do something (half-landed while this was written)

**Status, 2026-08-17.** The transport half of this recommendation shipped during the research: the
ambient schema now carries `scrollFraction`, and `AmbientObservation.scrollFraction` exists. Its own
comment records the honest state — *"**Nothing reads it**"*. So the drift ADR-0008 had (three
true-sounding sentences over a field that was dropped on arrival) is fixed at the wire, and the signal
is now arriving and being ignored one layer further in.

**Evidence for making it count:** Claypool et al. — time, scroll, and *the combination of time and
scroll* are the three things that correlated with explicit interest; clicks and individual scroll
methods did not.

**Where it belongs:** `READ_AROUND_MS = 20 s` is currently the only defence against "three tabs opened
and skimmed", and its own docstring concedes *"Twenty seconds is a floor on a glance, not a bar on
skimming."* Twelve newsletter links at forty-five seconds each clear it. **Scroll is the signal that
separates a page read from a page held open**, and it is the conjunction — not scroll alone — that
Claypool measured.

⚠️ Two cautions. Fox et al. is the first: scroll variables were *in* the nineteen and did **not** make
the top two, so expect this to be worth less than exit type ([§10.1](#101-carry-exittype-on-the-ambient-path)). The second is
structural — a page that is entirely above the fold produces no scroll and is not thereby unread, which
is the same trap `content.js` already documents for its own engagement rule (*"Reading is not only
scrolling"*). Scroll can raise confidence; it must not gate.

### 10.3 Narrow `came-back` to cross-origin returns (recorded in the code, not acted on)

**Status, 2026-08-17.** This finding reached `grounds.ts` while the research was still running.
`returnedTo` now carries the full Adar measurement, `INTENT_GROUNDS` carries the caveat, and the product
owner's decision is recorded as *"record the research as an honest limit and retune nothing"* — no
constant moved, no predicate narrowed. **That is a legitimate decision and this section is not arguing
it was wrong.** What follows is what the evidence says the decision costs, so the next person meets a
choice rather than a rediscovery.

**Evidence:** [§9.3](#93-came-back-is-the-weakest-ground-and-the-fix-is-one-predicate). In the only band
this system can observe, 77.0% of returns are same-domain hub-and-spoke navigation, only 2.9% of those
pages were search-reached, and the self-reported motive for that band is shopping and monitoring.

**The change, if it is ever made:** `visitsByUrl` counts an arrival when `observation.url !== previous`.
Count it as a *return* only when the intervening visit was on a **different origin**, and let
same-origin returns count toward `read-around`, which is an investment ground and where paging through a
listing honestly belongs. That last clause matters and `grounds.ts`'s own block does not say it: the
narrowing does not simply delete evidence, it **moves** it from the group that is scarce (one of three
intent grounds) to the group that is plentiful (one of four investment grounds), which is a smaller bar
change than it first reads as.

**The cost, which `grounds.ts` states correctly and this document confirms:** it would refuse somebody
reading three arXiv abstracts and clicking back to the first. That is real research and it is the case
`read-around` was added for. The literature offers no way to separate it from a listing page by
navigation shape alone — and this is exactly the *"a ground that separates 'still here' from 'came back
to it'"* that `INVESTMENT_REQUIRED`'s block says does not exist yet.

**The one thing worth doing regardless of the decision: add the fixture.**
`tests/grounds.test.ts`'s `came-back` block has two cases and neither is hub-and-spoke. A standing
fixture — listing → item → listing → item on one host — pinning the ground's *current* behaviour makes
the limit executable rather than narrative, and means a future narrowing has a red test rather than a
paragraph to argue with. `PRODUCT_PRINCIPLES.md` §13 records exactly what happens when a fixture is
smaller than the session it claims to stand for.

### 10.4 Stop treating `WINDOW_MS` as a task boundary

**Evidence:** §3.1. The 30 minutes is inherited from a 1995 paper where the number is 25.5, is
mean + 1.5 SD of idle gaps, was never validated, and measures *"users will often leave XMosaic running
for extended periods of time without interacting with it"* — not tasks. Jones & Klinkner: 57.2% against
a 63.1% baseline, *"no better than random"*, *"The 30-minute standard receives no support from our
results."* Their trained optima were 5 and 13 minutes. ProAgentBench's plateau is 5 minutes.

**What this does *not* mean.** It does not mean shorten it. The two uses are different:

- As a **buffer retention bound** — how much Propositum holds in memory about someone who has not
  started a session — thirty minutes is a privacy decision and it is well-argued in ADR-0008. Keep it.
- As an **implicit claim about thread membership**, it is unsupported in both directions. Jones &
  Klinkner found **15% of goals span a 30-minute inactivity gap**: *"a 30 minute time-out will break up
  15% of goals."*

`SUSTAINED_MS`'s docstring already identifies the real problem — *"a rule that asks a thread to span
half the life of the buffer it is measured inside is measuring the window as much as the person"* — and
correctly says the fix is a longer window or a ground that does not depend on one. The literature
agrees, and adds that the number should be **chosen and recorded as a retention decision**, so that the
next person tuning `SUSTAINED_MS` is not silently tuning against an artefact of a 1994 Mosaic study.

### 10.5 Measure the offer rate, because nothing does

`PRODUCT_PRINCIPLES.md` §13's honest limit: *"the other half is enforced by nothing… there is no metric
anywhere that would catch an offer rate creeping upward."* Three shipped products name the metric that
closes it:

- **GitHub** tracks **completion-shown rate** as a first-class production metric alongside acceptance,
  and warns that *"being hyper-focused on a metric like acceptance rate can lead to experiences that
  look good on paper, but do not result in happy developers."*
- **JetBrains** optimises the pair — acceptance up, explicit-cancel down — and got **+~50% acceptance
  and −~40% cancels** by *removing* suggestions with the output ratio held flat.
- **LinkedIn** measured the trade directly: **−2.6%** engagement bought **−45%** negative responses.

The Propositum analogue is three numbers, all derivable from data the system already has, and none
requiring a model: **offers shown per hour of observed browsing**, **decline rate**, and **strands
detected but not shown**. `MAX_THREADS_SHOWN` currently caps what is visible without recording what was
suppressed — and ADR-0008 records that a strand found and discarded in silence is the exact failure the
multi-strand change existed to remove.

**Base rate to calibrate against:** Donato et al.'s editors found research missions were **10% of
sessions**. If Propositum's offer rate materially exceeds one strand per ten sessions of ordinary
browsing, it is firing on something other than research, and no amount of extra signal will fix a
threshold problem.

**And the reason to measure precision specifically, rather than accuracy or acceptance:** §6.7 says
engagement tracks precision roughly linearly, with no threshold. There is no rate that is "safe enough";
each point of precision is worth a point of attention, permanently. Axelsson's version, applied here:
*"the factor limiting the performance … is not the ability to correctly identify behaviour as intrusive,
but rather **its ability to suppress false alarms**."*

### 10.6 Wait for a breakpoint, and prefer Home to the notification channel

This is the recommendation with the largest measured effect in the entire document, and it costs nothing
in signal.

**Evidence:** Bailey & Konstan — identical content delivered *between* tasks produced **no measurable
degradation**; delivered *during* them it cost 3–27% task time, doubled errors, and raised annoyance
31–106%. Iqbal & Bailey — deferring to the next task breakpoint costs a mean of **88.6 seconds** and
users at breakpoints reacted *faster* and were markedly less frustrated. Adamczyk & Bailey — bad timing
costs **respect** (43% more respect at the best moment than the worst) while costing nothing in
resumption lag.

**And Mark et al. remove the excuse.** Interrupting someone about *the very thing they are doing* costs
the same as interrupting them about something else: *"the actual disruption cost is the same as with a
different context."* Relevance buys tolerance, not cheapness.

**What Propositum already has that nobody has connected to this.** `detectPause` fires on
`PAUSE_MS = 4 minutes` of idleness after real work, and `chrome.idle` reports `active`/`idle`/`locked`.
**That is a breakpoint detector.** It is currently wired only to the hand-off offer. The work-offer
notification fires whenever `groundsFor` says yes, which by construction is *while the person is
working* — the exact condition Bailey & Konstan measured as the expensive one.

**The change:** hold a composed work-offer until either `detectPause` fires or the person opens Home.
Show it on Home immediately; release it to the notification channel only at a pause. By the measured
numbers this costs under two minutes of latency and removes the entire mid-task interruption cost.

It also closes the gap ADR-0008 names and declines to fix — *"the front door's 'Not now' buys no quiet
from the notification channel at all"* — because a notification that only ever fires at a pause cannot
arrive a minute behind a decline made mid-flow.

⚠️ One caution from the same literature: Bailey & Konstan found the errors were caused by *expectancy*
of interruption rather than by interruptions themselves. A system that might speak at any moment imposes
a cost even while silent. A pause-gated channel is also a *predictable* channel, which is the cheaper
kind.

### 10.7 Ask one question, about a standing constraint, on Home

**Evidence:** ATRBench's 62-point oracle gap, with *"acquisition"* named as the bottleneck; Qulac's
+101% ceiling from a single question; Bing's +48.57% engagement from question-framing.

**And the three guards the same literature demands:** a bad question is **−8.7%** against not asking
(Qulac's WorstQuestion), the achievable share of the ceiling is under half, and people cannot articulate
intent (Teevan: three people, same stated intent, agreement on one page in forty).

**So ask about something stable and statable, not about intent.** "What does 'done' look like for work
like this?" is a standing constraint. "Are you researching world models?" is an intent question, and
`boundaries/subject.ts` already produces a better guess at that than a person will type.

**And put it on Home.** A question delivered where somebody chose to look is free by Bailey & Konstan's
measurement; the same question as a notification is not.

---

## 11. Open questions, and what nobody has published

**Three widely-repeated numbers in this area have no primary source, and two of them are constants this
repo or its arguments lean on.**

1. **The 30-minute session timeout** ([§3.1](#31-the-30-minute-window-is-folklore-and-the-folklore-is-wrong)) — the real number is 25.5, it measures walking away
   from a browser, and it was never validated.
2. **The "30-second dwell = satisfied" heuristic** ([§2.2](#22-the-30-second-dwell-threshold-has-no-primary-source)) — the paper universally credited with it does
   not contain it and reports 58.4 s. Relevant to anyone tempted to lower `DEEP_READ_MS`.
3. **"23 minutes 15 seconds to refocus after an interruption"** ([§6.8](#68-the-cost-of-the-interruption-itself)) — it comes from a 2006 magazine interview, the
   published figure is 25:26 with a standard deviation of 54:48, it measures elapsed time during which
   the person did ~2.26 *other work activities*, and both the paper and its author call it short. It is
   not a measure of interruption cost. **ADR-0008 does not cite it, and should not start.**

**And one question in the brief turned out to be the wrong question.** "At what false-positive rate do
people stop reading?" presumes a cliff. Bliss et al.'s probability-matching result says there is none —
response tracks precision roughly linearly, with about 10% of people going all-or-none
([§6.7](#67-at-what-false-positive-rate-do-people-stop-reading-there-is-no-cliff)). ⚠️ Their
per-condition response rates are paywalled and unverified; only the qualitative claim is safe.
⚠️ **No published base-rate or precision analysis specific to recommendation or suggestion systems was
found at all** — the transferable analyses come from intrusion detection and clinical alerting.

**Nobody has published task segmentation over general browsing.** Every accuracy figure in §3 is from
query logs. `findThreads` operates on titles and URL paths, most of which are not queries. There is no
external benchmark and there is unlikely to be one, which makes this repo's own fixtures the only
evidence there is ([§3.4](#34-the-gap-nobody-has-published-segmentation-of-general-browsing)).

**Nobody has published acceptance data for a proactive research-detection prompt.** Yahoo! Search Pad
is the only shipped instance and its paper reports no acceptance rate, no rejection rate and no absolute
CTR — only that CTR *"remained constant independently of the coverage."* No post-mortem exists for why
it was discontinued.

**Nor for most of the others.** No first-party post-mortem was found for **Google Now** (folded into the
feed and then Discover, neither announcement mentioning it), **Microsoft Cortana** (retirement notice
gives dates and alternatives, no reason), **Windows "Suggested actions"** (deprecated Dec 2024, one
sentence, no reason), **Windows Timeline**, or **Microsoft Delve** (retired Dec 2024; the admin page is
an offboarding document with no rationale and no description of how it ranked anything). The one
exception is Viva's Briefing email, paused with a stated reason: *"We're taking some time to improve the
Briefing email and give you more personalized content."*

The nearest thing to a candid public post-mortem in this whole space is The Browser Company's letter
about Arc, and its numbers are about proactive features nobody used: *"Only 5.52% of DAUs use more than
one Space regularly"*, *"Only 4.17% use Live Folders"*, *"It's 0.4% for one of our favorite features,
Calendar Preview on Hover."*

**No first-party source says "a wrong suggestion costs more than a missing one", and none publishes a
confidence threshold for showing a proactive suggestion.** The closest is Apple's dual-threshold
"Hey Siri" design ([§8.5](#85-the-corroborating-shape-from-products)). ADR-0008's asymmetry is
therefore better-stated than anything the industry has published, which is worth knowing: there is no
external number to calibrate it against.

**Unmeasured here, and worth measuring in this repo:**

1. **What is Propositum's actual offer rate per hour of ordinary browsing?** Nothing measures it
   (§10.5).
2. **What fraction of `came-back` firings are hub-and-spoke?** One instrumented afternoon answers this
   and decides §10.3 empirically rather than by inference from Adar's data.
3. **Does `exitType` change anything?** Fox predicts it should be the largest single win available.
   It is also falsifiable in a week on one person's browsing.
4. **How often does `vocabularyOf` merge two real words?** Its docstring records two measured false
   merges and names three more reachable pairs. The rate is unknown.
5. **Does one short question outperform a composed offer?** §8 says a question about a *standing
   constraint* should, and that a question about *intent* should not. Nobody has measured either for
   this class of product.
6. **Does pause-gating the notification channel cost anything?** §10.6 predicts under two minutes of
   latency for the removal of the entire mid-task interruption cost. `detectPause` already exists; the
   experiment is a flag.
7. **Does `scrollFraction` separate reading from skimming on real browsing?** It now arrives and
   nothing reads it. One instrumented afternoon settles whether it earns a place in `read-around`.

⚠️ **One stale cross-reference, noted rather than fixed, because this document may not edit code.**
`returnedTo` in `src/domain/detection/grounds.ts` cites *"`docs/research/intent-suggestion-quality.md`
§4 and §9.3"*. **§9.3 is correct and has been kept stable for exactly that reason.** §4 is not — it is
*Arrow 2, how much history*; the Adar material lives in §9.3, §0 finding 4 and §10.3. The reference
should read **§9.3 and §10.3**.

**Not established in either direction:** whether text selection is an intent signal; whether
`transitionType` would be worth its permission cost; and whether personalising anything to a single
user helps, given that the one careful measurement of per-user threshold tuning found it *worse than no
personalisation at all* ([§4.4](#44-personalising-from-small-n-a-consistent-unwelcome-pattern)).

---

## 12. Sources

⚠️ **Reliability note.** Three figures cited above exist **only as chart pixels** in their papers and
were read off rendered plots: Donato et al.'s precision/recall (Figures 5–6), Jones & Klinkner's
boundary-precision plateau (Figure 4), and Mehrotra & Yilmaz's F1 bars (Figure 2). They are flagged
where used and should not be quoted to more than one significant figure.

**Implicit feedback and dwell time**

- [Fox, Karnawat, Mydland, Dumais & White — *Evaluating implicit measures to improve web search*, ACM TOIS 23(2), 2005](http://susandumais.com/tois-p147-fox.pdf) — the 19-vs-2 feature ablation; 58.4 s; exit type
- [Claypool, Le, Wased & Brown — *Implicit interest indicators*, IUI 2001](http://web.cs.wpi.edu/~claypool/papers/iii/) — dwell + scroll; clicks ineffective; ⚠️ no correlation coefficients reported
- [Kim, Hassan, White & Zitouni — *Modeling dwell time to predict click-level satisfaction*, WSDM 2014](http://ryenwhite.com/papers/KimWSDM2014.pdf) — per-page-type thresholds 160–210 s; the 30 s misattribution
- [Liu, White & Dumais — *Understanding web browsing behaviors through Weibull analysis of dwell time*, SIGIR 2010](http://ryenwhite.com/papers/LiuSIGIR2010.pdf) — negative aging; k < 1 on 98.5% of pages
- [White & Kelly — *A study on the effects of personalization and task information on implicit feedback performance*, CIKM 2006](http://ryenwhite.com/papers/WhiteCIKM2006.pdf) — **per-user thresholds worse than global**
- [Agichtein, Brill & Dumais — *Improving web search ranking by incorporating user behavior information*, SIGIR 2006](http://susandumais.com/SIGIR2006-fp345-Ranking-agichtein.pdf) — NDCG@1 0.6→0.75; degrades on easy queries; 46–49% coverage
- [Joachims — *Optimizing search engines using clickthrough data*, KDD 2002](https://www.cs.cornell.edu/people/tj/publications/joachims_02c.pdf) — clickrank 6.26 / 6.18 / 6.04
- [Joachims, Granka, Pan, Hembrooke & Gay — *Accurately interpreting clickthrough data as implicit feedback*, SIGIR 2005](https://www.cs.cornell.edu/people/tj/publications/joachims_etal_05a.pdf) — 80.8% vs 89.5% human ceiling; trust bias
- [Joachims et al. — TOIS 2007 (extended eye-tracking study)](https://www.cs.cornell.edu/people/tj/publications/joachims_etal_07a.pdf) — abstract-viewing rates; ⚠️ no numeric rank-1/rank-2 click ratio in the text
- [Joachims, Swaminathan & Schnabel — *Unbiased learning-to-rank with biased feedback*, WSDM 2017 (arXiv:1608.04468)](https://arxiv.org/pdf/1608.04468) — propensities; **naive beats principled on small data**
- [Li, Huffman & Tokuda — *Good abandonment in mobile and PC internet search*, SIGIR 2009](https://research.google.com/pubs/archive/35486.pdf) — 19–55%; PC US 31.8%
- ⚠️ Craswell et al. WSDM 2008 (cascade model): only the [MSR abstract page](https://www.microsoft.com/en-us/research/publication/an-experimental-comparison-of-click-position-bias-models/) was obtainable. **No bias-magnitude numbers verified.**
- ⚠️ Kelly & Teevan 2003; Williams et al. (mobile good abandonment); Chuklin & Serdyukov — **not retrieved; no claims drawn from them**
- ⚠️ Yilmaz et al. is **CIKM 2014**, not SIGIR; abstract only

**Task and session segmentation**

- [Catledge & Pitkow — *Characterizing browsing strategies in the World-Wide Web*, WWW3 1995](https://web.archive.org/web/20001110091600/http://www.igd.fhg.de/archive/1995_www95/papers/80/userpatterns/UserPatterns.Paper4.formatted.html) — **the origin: 25.5 minutes, mean + 1.5 SD, idle detection**
- [Jones & Klinkner — *Beyond the session timeout*, CIKM 2008](https://dmice.ohsu.edu/bedricks/courses/cs606-ir/papers/jones_2008.pdf) — *"The 30-minute standard receives no support"*; feature ablations; 17% interleaving
- [Halfaker et al. — *User session identification based on strong regularities in inter-activity time*, WWW 2015](https://cseweb.ucsd.edu/classes/fa17/cse291-b/reading/p410.pdf) — *"Over time this threshold has simplified to 30 minutes"*; ~1 hour rule of thumb
- [Lucchese, Orlando, Perego, Silvestri & Tolomei — *Identifying task-based sessions in search engine query logs*, WSDM 2011](http://www.dsi.unive.it/~orlando/PUB/wsdm2011.pdf) — F-measure 0.81 vs 0.65 timeout; 74% multi-tasking; ⚠️ no "accuracy" reported
- [Kotov, Bennett, White, Dumais & Teevan — *Modeling and analysis of cross-session search tasks*, SIGIR 2011](http://teevan.org/publications/papers/sigir11.pdf)
- [Agichtein, White, Dumais & Bennett — *Search, interrupted*, SIGIR 2012](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/08/agichtein-et-al-sigir-2012-Copy.pdf) — **TaskSpanTime is the strongest predictor**; history ablation; text features negligible
- [Wang, Song, Chang, He, White & Chu — *Learning to extract cross-session search tasks*, **WWW** 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/WWW13_camera_fp067-wang.pdf) — Q-COSINE +5.30 vs S-SAME +1.00
- [Mehrotra & Yilmaz — *Extracting hierarchies of search tasks & subtasks*, SIGIR 2017 (arXiv:1706.01574)](https://arxiv.org/pdf/1706.01574) — ⚠️ F1 comparison exists only as a bar chart
- [Spink, Park, Jansen & Pedersen — *Multitasking during web search sessions*, IP&M 42(1), 2006](https://faculty.ist.psu.edu/jjansen/academic/pubs/jansen_multitasking_ipm05.pdf) — 81% / 91.3%; ⚠️ tiny hand-coded samples, no inter-rater reliability
- [Adar, Teevan & Dumais — *Large scale analysis of web revisitation patterns*, CHI 2008](https://www.cond.org/chi1159-adar.pdf) — **the hub-and-spoke finding: 77.0% same-domain in the fast band**

**Proactive systems that shipped**

- [Donato, Bonchi, Chi & Maarek — *Do you want to take notes? Identifying research missions in Yahoo! Search Pad*, WWW 2010](https://www.francescobonchi.com/p321.pdf) — 10% of sessions / 25% of query volume; shipped at T = 0.5/0.6; flat CTR
- [Google — *Google Now, best of, in three sizes* (2012)](https://blog.google/products-and-platforms/products/nexus/nexus-best-of-google-now-in-three-sizes/)
- [Google — *Feed your need to know* (2017)](https://blog.google/products-and-platforms/products/search/feed-your-need-know/) and [*Introducing Google Discover* (2018)](https://blog.google/products-and-platforms/products/search/introducing-google-discover/) — ⚠️ neither mentions Google Now
- [Google Search Central — Discover documentation](https://developers.google.com/search/docs/appearance/google-discover)
- [Microsoft — *Cortana: yes, and many, many other great features* (2014)](https://blogs.windows.com/windowsexperience/2014/04/02/cortana-yes-and-many-many-other-great-features-coming-in-windows-phone-8-1/) — the Notebook, quiet hours
- [Microsoft — *End of support for Cortana*](https://support.microsoft.com/en-us/cortana/end-of-support-for-cortana) — ⚠️ dates and alternatives, **no reason given**
- [Microsoft — *Deprecated features for Windows client*](https://learn.microsoft.com/en-us/windows/whats-new/deprecated-features) — "Suggested actions", Timeline, Location History
- [Microsoft — *Briefing email FAQs*](https://learn.microsoft.com/en-us/viva/insights/personal/briefing/be-faqs) — *"you will never be sent an empty email with no content"*
- [Microsoft — *Delve retirement*](https://learn.microsoft.com/en-us/sharepoint/delve-retirement) — ⚠️ no rationale published
- [Apple — *Search & Privacy: Siri Suggestions*](https://www.apple.com/legal/privacy/data/en/siri-suggestions-search/) and [*Donating Shortcuts*](https://developer.apple.com/documentation/sirikit/donating-shortcuts) — *"don't make donations for actions the user hasn't completed"*
- [Apple — *Hey Siri* (machinelearning.apple.com)](https://machinelearning.apple.com/research/hey-siri) — the only published dual-threshold operating point
- [Apple HIG — Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) and [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
- [Microsoft — App notification UX guidance](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-ux-guidance) — *"Notifications should not be noisy"*
- [Google — *Finding answers gets better in Chrome* (Journeys, 2022)](https://blog.google/products-and-platforms/products/chrome/finding-answers-gets-better-chrome/)
- [Google — *Building a more helpful browser with machine learning*](https://blog.google/products-and-platforms/products/chrome/building-a-more-helpful-browser-with-machine-learning/) — *"silences these undesired prompts"*
- [The Browser Company — *Letter to Arc members 2025*](https://browsercompany.substack.com/p/letter-to-arc-members-2025) — 5.52% / 4.17% / 0.4% feature adoption

**Suggestion acceptance in IDEs**

- [GitHub — *Research: quantifying Copilot's impact on developer productivity and happiness*](https://github.blog/news-insights/research/research-quantifying-github-copilots-impact-on-developer-productivity-and-happiness/) — 55% faster; ⚠️ no acceptance rate
- [GitHub — *The economic impact of the AI-powered developer lifecycle*](https://github.blog/news-insights/research/the-economic-impact-of-the-ai-powered-developer-lifecycle-and-lessons-from-github-copilot/) — *"users accept nearly 30% of code suggestions"*
- [GitHub — *The road to better completions*](https://github.blog/ai-and-ml/github-copilot/the-road-to-better-completions-building-a-faster-smarter-github-copilot-with-a-new-custom-model/) — *"being hyper-focused on a metric like acceptance rate…"*; **completion-shown rate**
- [Google Research — *ML-enhanced code completion improves developer productivity*](https://research.google/blog/ml-enhanced-code-completion-improves-developer-productivity/) — 25%/34% acceptance; **filtering 80% of uncompilable Go suggestions → 1.9× acceptance**
- [JetBrains — *AI code completion: less is more*](https://blog.jetbrains.com/ai/2025/03/ai-code-completion-less-is-more/) — **+~50% acceptance, −~40% cancels, output flat**
- [JetBrains — *Complete the un-completable*](https://blog.jetbrains.com/ai/2024/10/complete-the-un-completable-the-state-of-ai-completion-in-jetbrains-ides/) — 35% acceptance, 5% explicit cancel

**Notification volume and the cost of being wrong**

- [LinkedIn Engineering — *Less is more: optimizing email volume, part 1*](https://www.linkedin.com/blog/engineering/archive/less-is-more-optimizing-email-volume-part-1) — **−2.6% page views, −45% negative responses**; unsubscribe is permanent
- [Pinterest Engineering — *User state-based notification volume optimization*](https://medium.com/pinterest-engineering/user-state-based-notification-volume-optimization-7764118f73ff) and [KDD 2018 paper](https://dl.acm.org/doi/10.1145/3219819.3219906)
- [O'Brien, Wu, Zhai, Guo, Shi & Hunt — *Should I send this notification?* (arXiv:2202.08812)](https://arxiv.org/abs/2202.08812) — *"a myopic system will always choose to send a notification"*
- [Akhawe & Felt — *Alice in Warningland*, USENIX Security 2013](https://www.usenix.org/system/files/conference/usenixsecurity13/sec13-paper_akhawe.pdf) — 25.4M impressions; **7.2% to 70.2% bypass**
- [Mark, Gudith & Klocke — *The cost of interrupted work: more speed and stress*, CHI 2008](https://www.ics.uci.edu/~gmark/chi08-mark.pdf) — interrupted tasks completed **faster**, at a cost in stress; **interruption context makes no difference to disruption cost**
- [Mark, González & Harris — *No task left behind?*, CHI 2005](https://ics.uci.edu/~gmark/CHI2005.pdf) — the real resumption figure: **25 min 26 s (sd 54:48)**, across ~2.26 other working spheres
- [Gallup Business Journal — *Too many interruptions at work?* (2006)](https://news.gallup.com/businessjournal/23146/too-many-interruptions-work.aspx) — **the sole origin of "23 minutes 15 seconds"**, in an interview, described there as *"not so long"*
- [Iqbal & Horvitz — *Disruption and recovery of computing tasks*, CHI 2007](https://erichorvitz.com/CHI_2007_Iqbal_Horvitz.pdf) — 27 users, two weeks; **9 min 33 s** to return; 27% of suspensions exceed two hours
- [Iqbal & Horvitz — *Notifications and awareness*, CSCW 2010](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/253n-iqbal.pdf) — acted on **26.2%**; 17 of 18 wanted to keep them
- [Bailey & Konstan — *On the need for attention-aware systems*, Computers in Human Behavior 2006](https://interruptions.net/literature/Bailey-CHB06_1.pdf) — **between-task delivery costs nothing**; 3–27% / 2× errors / 31–106% annoyance during
- [Iqbal & Bailey — *Effects of intelligent notification management*, CHI 2008](https://interruptions.net/literature/Iqbal-CHI08.pdf) — mean deferral to breakpoint **88.6 s**; relevance halves frustration
- [Adamczyk & Bailey — *If not now, when?*, CHI 2004](https://interruptions.net/literature/Adamczyk-CHI04-p271-adamczyk.pdf) — bad timing costs **respect**, not resumption lag
- [Czerwinski, Horvitz & Wilhite — *A diary study of task switching and interruptions*, CHI 2004](http://erichorvitz.com/taskdiary.pdf) — ~50 task shifts/week; 0.7 interruptions per task
- [Pielot & Rello — *Productive, anxious, lonely: 24 hours without push notifications*, CHI EA 2017](https://dl.acm.org/doi/10.1145/3098279.3098526) — **73.3%** intended to disable *some*; none wanted none
- [Horvitz — *Principles of mixed-initiative user interfaces*, CHI 1999](https://erichorvitz.com/chi99horvitz.pdf) — **`p*`, and dialog as the third action**
- [Horvitz & Apacible — *Learning and reasoning about interruption*, ICMI 2003](http://erichorvitz.com/iw.pdf) — **personalised interruptibility models do not transfer** (cross-user 0.28 / 0.32, below baseline)
- [Horvitz, Koch & Apacible — *BusyBody*, CSCW 2004](https://www.interruptions.net/literature/Horvitz-CSCW04-p507-horvitz.pdf) — per-user accuracy 0.70–0.87; users found the training probes annoying

**Habituation, warning fatigue, and the base rate**

- [Bravo-Lillo et al. — *Your attention please*, SOUPS 2013](https://cups.cs.cmu.edu/soups/2013/proceedings/a6_Bravo-Lillo.pdf) — **10.48 s → 1.03 s median engagement**; 13–19% notice a changed message
- Anderson, Kirwan, Jenkins, Eargle, Howard & Vance — *How polymorphic warnings reduce habituation in the brain*, **CHI 2015** (⚠️ **not** PNAS), [DOI 10.1145/2702123.2702322](https://dl.acm.org/doi/10.1145/2702123.2702322) — *"a dramatic drop … after only the second exposure"*; ⚠️ abstract only, ACM blocked
- [Vance et al. — *The fog of warnings*, SOUPS 2019](https://www.usenix.org/system/files/soups2019-vance.pdf) — **habituation generalises to visually similar warnings** (OR 2.60)
- Vance, Jenkins, Anderson, Bjornn & Kirwan — *Tuning out security warnings*, MIS Quarterly 2018, [BYU ScholarsArchive record](https://scholarsarchive.byu.edu/facpub/6495) — ⚠️ **abstract verified only; decay percentages not retrievable**
- [Axelsson — *The base-rate fallacy and its implications for the difficulty of intrusion detection*, CCS 1999 preprint](https://users.ece.cmu.edu/~dbrumley/courses/18487-f15/reading/Axelsson_1999_The%20base-rate%20fallacy%20and%20its%20implications%20for%20the%20difficulty%20of%20intrusion%20detection.pdf) — *"no-one will bother to care when the alarm goes off"*; ⚠️ TISSEC 2000 version not retrievable
- Bliss, Gilson & Deaton — *Human probability matching behaviour in response to alarms of varying reliability*, Ergonomics 38(11), 1995, [DOI 10.1080/00140139508925269](https://doi.org/10.1080/00140139508925269) — **probability matching; ~90% of subjects**; ⚠️ per-condition rates paywalled and unverified
- [Bonafide et al. — *Association between exposure to nonactionable physiologic monitor alarms and response time*, J Hosp Med 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4456276/) — dose-response 2.8 → 5.3 → 8.5 min
- Bonafide et al. — *Video analysis of factors associated with response time to physiologic monitor alarms*, JAMA Pediatrics 2017 (PMID 28394995) — ⚠️ **the failed replication**: prior-exposure not associated; time-on-shift was
- [Drew et al. — *Insights into the problem of alarm fatigue with physiologic monitor devices*, PLoS ONE 2014](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0110274) — 2,558,760 alarms; **88.8% of annotated arrhythmia alarms false**
- Görges, Markewitz & Westenskow — *Improving alarm performance in the medical intensive care unit*, Anesth Analg 2009 (PMID 19372334) — **23% effective / 36% ineffective / 41% ignored**
- [Wong et al. — *External validation of a widely implemented proprietary sepsis prediction model*, JAMA Internal Medicine 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC8218233/) — **PPV 12%**, alerts on 18% of patients, *"a large burden of alert fatigue"*
- ⚠️ *"72% to 99% of clinical alarms are false"* — **SECONDARY**, Sendelbach & Funk, *AACN Adv Crit Care* 2013 (PMID 24153215); commonly misattributed to Cvach 2012, whose "72" is the number of articles reviewed

**How much history, personalisation, and asking**

- [Bennett, White, Chu, Dumais, Bailey, Borisyuk & Cui — *Modeling the impact of short- and long-term behavior on search personalization*, SIGIR 2012](https://www.microsoft.com/en-us/research/wp-content/uploads/2012/08/bennett-et-al-sigir-2012.pdf) — ⚠️ **measures session depth, not history depth, and says so**
- [White, Bennett & Dumais — *Predicting short-term interests using activity-based search context*, CIKM 2010](http://susandumais.com/cikm1248-white.pdf) — F 0.39 → 0.50 from richer context; all prior actions beat the previous one
- [Teevan, Dumais & Horvitz — *Personalizing search via automated analysis of interests and activities*, SIGIR 2005](http://erichorvitz.com/SIGIR2005_personalize.pdf) — **personalized alone was significantly worse than the web ranking**; profiling beat idealised relevance feedback
- [Teevan, Dumais & Horvitz — *Potential for personalization*, TOCHI 2010](http://teevan.org/publications/papers/tochi10.pdf) — the 0.85-vs-1.00 ceiling; **same stated intent, one page in forty agreed**
- [Teevan, Dumais & Liebling — *To personalize or not to personalize*, SIGIR 2008](http://teevan.org/publications/papers/sigir08.pdf) — history alone nearly worthless, transformative in combination
- [Dou, Song & Wen — *A large-scale evaluation and analysis of personalized search strategies*, WWW 2007](https://www.microsoft.com/en-us/research/wp-content/uploads/2007/01/wwwfp495-dou.pdf) — **three of five strategies below the non-personalized baseline**; unstable past ~80 queries
- [Schein, Popescul, Ungar & Pennock — *Methods and metrics for cold-start recommendations*, SIGIR 2002](https://www.andrewschein.com/publications/p8734-schein.pdf) — ⚠️ **about new items, not new users; no ratings-count curve exists in it**
- [Bar-Yossef & Kraus — *Context-sensitive query auto-completion*, WWW 2011](http://www.ra.ethz.ch/cdstore/www2011/proceedings/p107.pdf) — wMRR 0.139 / 0.154 / 0.164; **unrelated context scores exactly 0**, and 40% of contexts are unrelated
- [Parate, Böhmer, Chu, Ganesan & Marlin — *Practical prediction and prefetch for faster access to applications*, UbiComp 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ubi1443-parate.pdf) — **95% top-5 on day one**; extra context 80.85% → 81.35%
- [Shokouhi — *Learning to personalize query auto-completion*, SIGIR 2013](https://www.microsoft.com/en-us/research/wp-content/uploads/2013/01/SIGIR2013-Shokouhi-PersonalizedQAC.pdf) — ⚠️ no history-depth analysis in it
- [Salemi et al. — *LaMP* (arXiv:2304.11406)](https://arxiv.org/abs/2304.11406) · [*LongLaMP* (arXiv:2407.11016)](https://arxiv.org/abs/2407.11016) · [*OPPU* (arXiv:2402.04401)](https://arxiv.org/abs/2402.04401) · [*Persona-DB* (arXiv:2402.11060)](https://arxiv.org/abs/2402.11060) · [*PPlug* (arXiv:2409.11901)](https://arxiv.org/abs/2409.11901) — first item carries most of the gain; more history degrades; compression is the exception
- [Hwang et al. (arXiv:2305.14929)](https://arxiv.org/abs/2305.14929) — **top-3 ≈ top-8 ≈ 16-plus-demographics**
- [Shaikh et al. — *DITTO* (arXiv:2406.00888)](https://arxiv.org/abs/2406.00888) — 0% → 5% → 11.9%, then saturating; **4 demonstrations beat 500 preference pairs**
- [Aliannejadi, Zamani, Crestani & Croft — *Asking clarifying questions in open-domain information-seeking conversations*, SIGIR 2019 (Qulac)](https://arxiv.org/pdf/1907.06554) — **+101% from one best question; −8.7% from a bad one**; real selector +33.5%
- [Zamani et al. — *Generating clarifying questions for information retrieval*, WWW 2020](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/01/webconf-2020-camera-zamani-et-al.pdf) — **+48.57% engagement**, 2.5M users; ⚠️ measures question-framing, not asking-vs-inferring
- [Zamani et al. — *Analyzing and learning from user interactions for search clarification*, SIGIR 2020](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/05/SIGIR_2020___Analyzing_Clarification_in_Web_Search.pdf) — 74.6M impressions; **16.6% less dissatisfaction**; clarification engages *least* on ambiguous queries
- [Zamani et al. — *MIMICS* (arXiv:2006.10174)](https://arxiv.org/abs/2006.10174) — ⚠️ *"by no mean represent the overall clickthrough rates in Bing"*; the pane is **not** personalised

**Proactive agents, 2025–2026**

- [Tang et al. — *ProAgentBench* (arXiv:2602.04482, Feb 2026)](https://arxiv.org/abs/2602.04482) — 1 Hz screenshots, 500+ hours; best accuracy 64.4%, precision 51.6–60.8%; **5-minute plateau**
- [Wu, Zou, Wang, Zhao & Shi — *Ask Now, Use Later* / ATRBench (arXiv:2605.28108, May 2026)](https://arxiv.org/abs/2605.28108) — ***"defaults fall at least 62 points below an oracle… acquisition is the bottleneck"***
- [Pasternak et al. — *Beyond Reactivity* / PROBE (arXiv:2510.19771)](https://arxiv.org/abs/2510.19771) — best end-to-end 40%

**Screenshots, vision, and structured context**

- [Xie et al. — *OSWorld* (arXiv:2404.07972)](https://arxiv.org/abs/2404.07972) — **GPT-4o: a11y tree 11.36% vs screenshot 5.03%**
- [Koh et al. — *VisualWebArena* (arXiv:2401.13649)](https://arxiv.org/abs/2401.13649) — 16.37% SoM vs 12.75% a11y + captions
- [Zheng et al. — *SeeAct / GPT-4V(ision) is a generalist web agent, if grounded* (arXiv:2401.01614)](https://arxiv.org/abs/2401.01614) — *"severe hallucination"* on webpage screenshots; grounding is the bottleneck
- [Zhou et al. — *WebArena* (arXiv:2307.13854)](https://arxiv.org/abs/2307.13854) — a11y tree chosen for structure and compactness; ⚠️ no modality ablation
- [Yang et al. — *AgentOccam* (arXiv:2410.13825)](https://arxiv.org/abs/2410.13825) — **43.1% on WebArena, text only**
- [Bonatti et al. — *WindowsAgentArena* (arXiv:2409.08264)](https://arxiv.org/abs/2409.08264) — UIA markers worth **+15% to +57%**
- [Lu et al. — *OmniParser* (arXiv:2408.00203)](https://arxiv.org/abs/2408.00203) — the strongest screenshot-only result, achieved by rebuilding structure from pixels
- [Qin et al. — *UI-TARS* (arXiv:2501.12326)](https://arxiv.org/abs/2501.12326)
- [Zhang et al. — *Screen Recognition*, CHI 2021 (Apple)](https://docs-assets.developer.apple.com/ml-research/papers/screen-recognition-chi-2021.pdf) — 71.3% mean AP; **59% of screens have elements the a11y API does not expose**
- [Apple — *Ferret-UI 2* (arXiv:2410.18967)](https://arxiv.org/abs/2410.18967) — web training labels *"directly parsed from the source HTML view hierarchy tree"*
- [Apple — *Never-ending Learning of UIs*, UIST 2023 (arXiv:2308.08726)](https://arxiv.org/abs/2308.08726) — tappability F1 0.81 → 0.60; **affordance is not in the pixels**
- [Gurrin et al. — *NTCIR-14 Lifelog-3 overview*](https://research.nii.ac.jp/ntcir/workshop/OnlineProceedings14/pdf/ntcir/01-NTCIR14-OV-LIFELOG-GurrinC.pdf) — **automatic retrieval MAP 0.045–0.063**
- [Hodges et al. — *SenseCam: a retrospective memory aid*, UbiComp 2006 (Microsoft Research)](https://www.microsoft.com/en-us/research/wp-content/uploads/2006/09/sensecam-ubicomp-2006-camera-ready.pdf) — the Mrs B case study
- [Anthropic — Vision docs (image token formula and price anchors)](https://platform.claude.com/docs/en/build-with-claude/vision)

**Microsoft Recall**

- [Microsoft Learn — *Manage Recall for Windows clients*](https://learn.microsoft.com/en-us/windows/client-management/manage-recall) — opt-in, OCR + vector DB, 25/75/150 GB, the foreground-tab filtering limitation
- [Microsoft Learn — *Reference for sensitive information filtering in Recall*](https://learn.microsoft.com/en-us/windows/client-management/recall-sensitive-information-filtering) — ⚠️ ~170 types, **zero accuracy figures**
- [Microsoft — *Update on the Recall preview feature* (June 2024)](https://blogs.windows.com/windowsexperience/2024/06/07/update-on-the-recall-preview-feature-for-copilot-pcs/) — opt-in and index encryption announced as *changes*
- [Weston — *Update on Recall security and privacy architecture* (Sept 2024)](https://blogs.windows.com/windowsexperience/2024/09/27/update-on-recall-security-and-privacy-architecture/) — MORSE review; ⚠️ third-party vendor unnamed, results unpublished; *"helps reduce"*
- [Microsoft — Windows Insider re-release (Nov 2024)](https://blogs.windows.com/windows-insider/2024/11/22/previewing-recall-with-click-to-do-on-copilot-pcs-with-windows-insiders-in-the-dev-channel/) — *"if you find sensitive information that should be filtered out … please let us know"*
- [Beaumont — *How the new Microsoft Recall feature fundamentally undermines Windows security* (May 2024)](https://doublepulsar.com/how-the-new-microsoft-recall-feature-fundamentally-undermines-windows-security-aa072829f218)
- [Beaumont — *Testing the security and privacy implications of the shipped version* (April 2025)](https://doublepulsar.com/microsoft-recall-on-copilot-pc-testing-the-security-and-privacy-implications-ddb296093b6c) — **credit card and CVV captured and indexed; deleted messages retained**
- [Hagenah — *TotalRecall*](https://github.com/xaitax/TotalRecall) — the current version bypasses encryption by injecting into the unprotected rendering process
- ⚠️ **UK ICO June 2024 statement — SECONDARY only.** `ico.org.uk` returns HTTP 403 to automated fetchers; read from a browser before quoting.

**This repo**

- [ADR-0008 — Ambient detection](../adr/0008-ambient-detection.md) · [ADR-0010 — Acting in the browser](../adr/0010-acting-in-the-browser.md)
- `src/domain/detection/topics.ts` · `src/domain/detection/detect.ts` · `src/domain/detection/grounds.ts` · `src/app/api/capture/ambient/route.ts` · `tests/grounds.test.ts`
- [`docs/PRODUCT_PRINCIPLES.md`](../PRODUCT_PRINCIPLES.md) §13
