# ADR-0019 — Disclosure, and what may never be behind one

**Status:** accepted · 2026-08-22
**Depends on:** [ADR-0006](0006-trust-boundary.md) §5 — the human review of the handoff is
structurally non-optional, and this ADR folds a screen around that rule rather than through it
**Amends:** nothing. No principle is struck and no ruling is reversed — see _What this does not
touch_
**Extends:** [ADR-0009](0009-composed-offers.md) — the offer's outline and _will not do_ list stay
visible, which this ADR now states as a general rule rather than a fact about one screen ·
[ADR-0017](0017-continuing-an-intention.md) — `WorkSoFar` renders before the click, unchanged
**Requested by:** the owner, 2026-08-21 — _"make the ui way simpler, way less choices, way less to
read"_

---

## The problem, at its real size

The front door was cut to the bone in the owner's own brief — _"extremely bare bones and simple…
black and white, bare bones, but they should be friendly"_ — and `src/app/page.tsx` renders about
45 words in its quiet state. The confirmation screen has three controls. Those two screens are what
this product looks like when it is finished.

The others are not that. Measured on 2026-08-21:

| Screen          | Words rendered                                         | Controls  |
| --------------- | ------------------------------------------------------ | --------- |
| the agreement   | **~700–850**, across **14** blocks of explanatory copy | **22–28** |
| `/projects/:id` | ~330                                                   | 16–21     |
| `/shifts/:id`   | ~400 plus every ledger row                             | ~17       |
| `/start`        | ~280                                                   | N + 2     |

The agreement alone is roughly three times the next-heaviest screen in the product, on the way to a
decision most people make the same way every time.

**None of those fourteen blocks is wrong.** Every one was added by somebody who had just found a way
to be misread, and each is defensible on its own. That is exactly the shape of the problem: the
screen did not get long through carelessness, it got long through forty individually correct
decisions, and no single one of them is the one to remove. A guard nobody finishes reading is weaker
than a short one they do — so length is not a cosmetic property of a permission screen, it is a
property of how well it guards.

## The decision

**Progressive disclosure is the product's density mechanism, it is `<details>`, and there is a
closed list of things that may never be behind one.**

### The mechanism

One reveal, `<details>`/`<summary>`, exported as `Disclosure` from `src/ui/primitives.tsx`. Not
client state.

Every screen here is a Server Component by default, and a reveal built on `useState` makes the thing
it hides unreachable until React has hydrated. `<details>` costs no JavaScript, works before
hydration and with it broken, is keyboard-operable, is announced as an expandable by screen readers,
and keeps its children **in the document** — so find-in-page and a screen reader's browse mode still
reach folded text. The browser owns the open state and nothing in `src/` has to.

It also closes a defect rather than only adding a feature. Re-entry finding 9 measured the thing
`<details>` replaces:

> a `title` tooltip is not reliably reachable by keyboard or screen reader… the explanation needs to
> be inline text or a real disclosure, not a tooltip.

Ten tooltips carried real prose. Text that exists only in a `title` is text some people never
receive, which makes it worse than deleting it — it reads as thorough while being absent. So the
rule is now: **text worth keeping goes on the page or behind a `Disclosure`; text not worth that is
cut. `title` is not a third option.**

### What may never fold

A disclosure is for evidence and detail _underneath_ a decision. It is never for the terms of the
decision itself. Concretely, and this list is the operative part of this ADR:

1. **The objective and _Done means…_ on the agreement.** Not for symmetry — they are the
   prompt-injection catch. [ADR-0006](0006-trust-boundary.md) §5: the session-reading boundary is
   inside the blast radius, so an injection _"rewrites the objective before the human ever sees the
   handoff screen. The human review is the only thing that catches it… The interface should make
   that hard, not merely possible."_ Folding the objective folds the review, and the review is the
   boundary.
2. **The offer's outline and _will not do_ list** — [ADR-0009](0009-composed-offers.md): _"the offer
   screen must show the outline and the *will not do* list, not just the title."_
3. **`WorkSoFar`** — [ADR-0017](0017-continuing-an-intention.md): it renders _"before anybody clicks
   anything"_, because before the click is the whole of that ADR's answer to the word _quietly_.
4. **Which sources Propositum may look at.** A count is not a permission a person can check. The
   tickboxes fold; the hostnames do not.
5. **_What I need from you_ on the re-entry note**, and the section order behind it — re-entry
   finding 1, and Principle 10's ban on _"a report that buries what I need from you"_.
6. **Anything a `landed` outcome would gain a control from.** Unchanged here, and named so a later
   reader does not reach for a disclosure as a way to tidy it.

### What this buys

The agreement now meets a person with **194 words** and everything else one keystroke away — down
from ~700–850, with **nothing removed**. `tests/agreement-density.test.ts` holds a ceiling of 300
and asserts that the folded half stays larger than the visible half, because the day those invert
the disclosure has become decoration.

## Principle 15, argued rather than leaned on

§15 forbids _"a recommendation rendered so that accepting it is indistinguishable from not reading
it."_ A bare **[Take over]** over a folded panel is precisely that, and this ADR does not get to wave
it through.

Two things answer it, and only the second is a real defence.

The weak one: §15 is scoped to **learned** trust, and says so — _"Enforced by nothing, because
nothing learns yet. No component reads acceptance history."_ `DEFAULT_CONTROLS` is static, so the
clause is arguable here. That is a technicality and technicalities are not arguments.

The real one: **what sits above the button is not a label for the defaults, it is a statement of what
will happen.** `Summary` renders one generated sentence — how long, what it will work on, whether it
may write, when it stops — computed from the same values `compilePolicy` hands the gate. It changes
when the dials change. So the cheapest way to confirm is to read it, which is the inverse of the
failure §15 names. The dials being folded does not make them invisible; it makes them _stated in
prose instead of enumerated in controls_, and a sentence is the form most people can actually check.

**Where this could still go wrong, said plainly.** `Summary` is four facts. A dial that later
compiles to something it does not mention would be a permission a folded screen never says out loud,
and the person would have ratified it having read a sentence that was true and incomplete. So: **any
new control behind Adjust must either appear in `Summary` or be argued into this paragraph.** That is
the cost of folding, and it is now written down where the next person adding a dial will meet it.

## What this does not touch

**No route changed.** The plan this came from proposed collapsing the flow toward a single route, and
that turned out to be the wrong target once the constraints were read rather than assumed.
`tests/reachability.test.ts` asserts by file path that `WhereYouLeftOff` is imported by both
`src/app/start/page.tsx` and `src/app/projects/[projectId]/page.tsx`, and that the project page calls
`statusWordFor` into its `kicker`. Those assertions exist to stop screens quietly disappearing.
Deleting the files to satisfy a slogan about one surface would have been defeating that guard rather
than passing it — and the density win was never in the route count. The route table is unchanged and
no second ADR is needed for a decision that was not taken.

**No dial was removed.** Principle 6 — _"every dial must bite"_ — means a dial is a permission, not a
control, and removing one removes a permission. All four are reachable, all four still compile to the
same deterministic checks, and the panel still renders from `compilePolicy` rather than a parallel
list.

**No verdict control was collapsed.** H2's denominator is `accepted / (accepted + rejected)` over
decidable units, and bulk accept would change what is being measured on a hypothesis that has never
been scored. Per-change Accept/Reject stays per-change, _Accept all_ stays inert while a question is
open, and a `landed` outcome still renders no control at all.

**No principle is struck.** This ADR adds a rule about where text goes; it overturns nothing, so
nothing is struck-and-dated and no number moves in `PRODUCT_PRINCIPLES.md`.

## Rejected alternatives

**Defaults with no escape hatch** — one fixed agreement, no adjustment UI. This is the version that
actually reverses something: it removes the person's ability to narrow a permission, which is
Principle 6's subject and not a density question at all. Refused.

**Cutting the fourteen blocks instead of folding them.** Tempting, and it is what "less to read"
literally asks for. But each block is a promise somebody made for a reason, several are pinned by
`tests/agreement-honesty.test.ts` precisely because _"a permission screen is a promise in prose"_,
and a screen that stops explaining what it permits is not simpler, it is quieter about the same
power. Folding keeps every word for the person who wants it and charges nobody else for it.

**A shorter model-written summary of the permissions.** Refused on Principle 8 — a `ShiftReport`
section that is model-authored rather than rendered from durable rows is banned, and the same
argument applies with more force to a permission panel. `Summary` is generated, not model-authored:
it is a template over `compilePolicy`'s output, and no model can reach it.

**Keeping the tooltips and folding only the long prose.** This would have left the accessibility
defect in place while claiming a density win, and re-entry finding 9 had already measured that
tooltips do not reach everybody. A simplification that improves the screen for sighted mouse users
and leaves it worse for everyone else is not one.
