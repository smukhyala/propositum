# Vision

Where Propositum is going, and — kept strictly separate — what it actually does today.

Everything under **Now** is built or being built in slice 0. Everything under **Later** is
direction, not commitment. Nothing in this document should be read as a claim about shipped
capability; [`MVP.md`](./MVP.md) is the authority on that.

---

## The problem

Knowledge work does not end at a stopping point. It ends at an interruption.

You leave mid-thought, with a half-drafted section, six tabs whose relevance only you understand,
and a decision you were circling but had not made. When you come back — an hour later, a day later —
the expensive part is not resuming the typing. It is **rebuilding the intention**: what you were
going for, what you had already ruled out, why that tab was open.

AI tools do not help with this, because they start from a prompt. To get useful work from one, you
first reconstruct the context yourself and then explain it. That reconstruction is the part that
was hard. Being asked to do it *and then type it out* is worse than being left alone.

Propositum starts somewhere else: from a `WorkSession` it already watched.

---

## Persistent work sessions

**Now.** The `WorkSession` is the durable object. It survives handoffs, idle, lid close, sleep, a
dead service worker, and revoked permissions. Only a human act ends it.

Agents are not durable. A worker `AgentRun` is ephemeral and has no identity, no name, and no
personality. It exists for one `Shift` and is gone. What persists is the session, the
`HandoffContract`, the `Document`, and the ledger.

This is the inversion the product rests on. Most AI products make the assistant the persistent
thing and the conversation disposable. Propositum makes the *work* persistent and the assistant
disposable.

---

## Intention-preserving continuation

**Now.** Propositum builds a `SessionReading` — inferred objective, what is done, what is open,
what remains uncertain, what is likely next — with `Evidence` linking every claim back to the
`ObservationEvent`s that support it. You correct it. It becomes a `HandoffContract` you ratify.

The provenance is not a nicety. An inference you cannot audit is an inference you cannot correct,
and correction is the entire mechanism by which the contract becomes trustworthy enough to act on.

**Later.** Reading intention across sessions and across projects. Recognising that today's work
continues last week's without being told. Learning that you always want the objection section
drafted before the pricing section.

---

## Human and AI shift changes

**Now.** Control transfers in one direction, once: you hand off, Propositum works, you come back.
One `Shift` per session. Re-entry ends at accept or reject.

**Later.** Genuine shift changes — *keep going*, *redirect*, several handoffs across one long piece
of work. Deliberately deferred, because continuation requires replanning against a `Document` that
moved between shifts, and shipping that unsolved produces a second shift that confidently
re-proposes work the first already did.

The metaphor is a colleague taking over your shift. Today the product delivers the first half of
that metaphor honestly and stops. That gap is real: **a second session currently starts cold**, and
someone will reasonably read that as a bug.

---

## Adaptive autonomy

**Now.** Four dials, set per handoff, each compiling to something the gate deterministically
evaluates: Initiative, Progress, Output, Budget. A control that only changes prompt wording is not
shipped, on principle.

**Later.** Autonomy that earns itself. Propositum notices which decisions you always approve and
proposes widening its own scope — with the widening itself requiring ratification. Preferences
accruing on the `Project`, never on the agent.

The hard part is not the mechanism. It is that autonomy which drifts upward without a person
noticing is exactly the failure mode the trust model exists to prevent. Any version of this needs
the widening to be a visible, revocable, human act.

---

## Observation

**Now.** A Chrome MV3 extension, scoped by `optional_host_permissions` to sources you approved,
emitting semantic `ObservationEvent`s. It keeps page titles, cleaned URLs, text you deliberately
selected, and at most 2,000 characters of readable article text per source.

It is **structurally incapable** of seeing anything else — Chrome will not hand over the URL, title,
or tab for a source you have not approved. That is the point of the vehicle: the constraint is
enforced by the browser, not by our code being correct. Rewind's exclusion controls were sincere,
documented, and leaked anyway, because exclusions built on a see-everything vehicle leak.

**Later.** Structured integrations with the tools people actually work in. Editors, note apps,
calendars — each with the same posture: least privilege, enforced by the platform where possible.

**Not planned, at any horizon.** Full-screen recording. Keystroke logging. Automatic access to
every application. These are not sequencing decisions.

---

## Computer use

**Now.** None. The worker acts through a small closed set of `ActionKind`s: read an approved
source, read the document, draft a section. Capabilities the brief excludes — send a message,
purchase, publish, delete — are **absent from the enum entirely** rather than denied by a rule.

**Later.** Preference order stays: native APIs, then structured integrations, then browser DOM
tools, and only then visual computer use. Visual computer use is the last resort, not the goal —
it is the least inspectable and least reversible way to act, and both properties are load-bearing
here.

---

## Multiple projects, and dynamic orchestration

**Later, both.** Several projects with their own sources, documents, and preferences; Propositum
choosing where the next hour is best spent.

Orchestration deserves particular scepticism. It is the most attractive thing to build early and
among the least useful: a generic agent framework built before one workflow works is the failure
mode the founding brief names most sharply. One worker and one reviewer, until there is evidence
that more helps.

---

## Safety and trust model

The part of the vision that is **most** built today, because it had to be.

### Now

**The contract is the boundary.** Every serious defender in this space converged on the same
architecture independently — Chrome's User Alignment Critic sees only metadata, Brave's checker is
firewalled from raw page content, CaMeL formalises it. The component that *decides* must not see
unfiltered untrusted content.

Propositum's `HandoffContract` is that boundary: a typed structure the worker acts on. It stops
being one the moment summarised page prose becomes something the worker follows — which is why
inferred constraints surface as **attributed quotations** beside the agreement and are structurally
barred from entering it. Anything you want honoured, you type yourself.

**Models never authorize.** `compilePolicy` cannot receive prose — a compile error, not a
convention.

**Everything is recorded, including refusals.** `ActionIntent` before, `ActionOutcome` after, both
append-only, enforced by database triggers reinstalled and verified at every startup.

**Everything is reversible.** The base is immutable for the whole review; review produces decisions,
never documents.

### Honest limits, today

- A successful prompt injection can change **what the worker attempts**, never **what it can
  touch**. The `ContractScope` holds regardless.
- But injection reaches the `SessionReading` too — page text influences the inferred objective
  *before* you ever see the handoff screen. **Your review is the thing that catches it.** That makes
  the review load-bearing rather than a courtesy, and it is why nothing in the autonomy dials can
  switch it off.
- Spotlighting and datamarking are **depth, not a boundary.** OWASP 2026 cites adaptive attack
  success above 90% against twelve recent defences. They are deployed; they are not relied on.
- Everything is local. There is no cloud, no telemetry, and no account. That is a privacy property
  today and a limitation tomorrow — it is also why a run stops when your Mac sleeps.

### Later

Signed provenance on captured content. A reviewer that can actually block rather than only
annotate. Formal verification of the gate's coverage. Multi-user, which changes the threat model
entirely and is not a small extension of this one.

---

## What would make this real

Not features. Evidence.

The product turns on one belief, and it is not the one that sounds hardest:

> Given a correct understanding of unfinished work, there exists work that is valuable enough to be
> glad about, safe enough unsupervised, and not so mechanical you would rather have done it.

Understanding is the tractable half. If knowledge work is unfinished *precisely because* the rest
needs judgment, that window is empty and no amount of inference quality fills it.

H2 in [`MVP.md`](./MVP.md) is that question, asked at n=1, against fixtures deliberately built so
the answer can be no.
