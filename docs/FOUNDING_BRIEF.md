# Founding Brief

The originating product brief for Propositum, recorded verbatim in substance so that
every later session works from the same source rather than from a summary.

This document is **historical**. It is not updated as decisions are made — decisions
live in `docs/adr/`, vocabulary lives in `CONTEXT.md`, and current scope lives in
`docs/MVP.md`. Where a later document contradicts this one, the later document wins
and should say that it does.

---

## What Propositum is

Propositum is Latin for *intention*.

The long-term vision is a consumer AI system that understands a person's unfinished
work, preserves the intention behind that work, and safely continues making progress
while the person is away.

**Most AI tools begin with a prompt. Propositum begins with an ongoing work session.**

A person works normally on a project. Propositum observes approved workflow signals,
constructs a structured understanding of the session, and identifies:

- what the person is trying to accomplish
- what has already been completed
- what remains unfinished
- what constraints or preferences govern the work
- where uncertainty remains
- what actions would constitute meaningful progress

When the person leaves, they can hand the session to Propositum. Propositum receives an
explicit handoff contract containing the objective, scope, permissions, desired progress,
autonomy level, budget, and stop conditions. It then continues the work in a constrained
environment.

When the person returns, Propositum provides a concise re-entry experience showing what
changed, what was completed, why key decisions were made, what remains uncertain, what
requires human judgment, and how to resume immediately.

**The product should feel like switching shifts with a trusted collaborator, not
submitting a task to a chatbot.**

## What Propositum is not

Not primarily a screen recorder, a workflow replay tool, a macro system, a coding agent,
a general computer-control agent, a collection of fixed agent personas, or a passive
second-brain application.

Its core primitive is the **persistent work session**. A work session can transfer control
between Human → Propositum → Human → Propositum. The persistent object is the session,
not the individual agent.

## MVP hypothesis

> Can Propositum understand an unfinished knowledge-work session well enough to make
> useful progress after the user leaves, without requiring the user to fully re-explain
> the work?

The MVP does not need to prove Propositum can operate every application or complete every
kind of task.

> **Note (added during charting):** this single hypothesis was later split into three —
> H1 context transfer, H2 useful progress, H3 calibrated stopping — because the demo
> scenario requires all three and they have different failure modes. See the wayfinder map
> and `docs/MVP.md`.

## Initial MVP workflow

1. The user creates a project workspace.
2. The user begins an explicit work session.
3. The user researches in approved browser tabs and edits a project document.
4. Propositum records lightweight semantic session events.
5. Propositum constructs an editable summary of objective, progress, open questions, and
   likely next steps.
6. The user selects **Take Over**.
7. Propositum generates an editable handoff contract.
8. The user sets autonomy, progress, time, and output controls.
9. One worker agent continues the work using approved sources and edits a copy of the document.
10. One reviewer checks the output against the handoff contract.
11. The user returns to a concise shift report, document diff, uncertainties, and remaining decisions.
12. The user can accept, reject, edit, redirect, or continue.

## Initial supported scenario

A user is researching and drafting an **event or partnership proposal**. The user leaves
before completing the research and final sections. Propositum reconstructs the session,
continues researching approved sources, completes a draft copy, identifies one strategic
decision it cannot safely make, and returns the work through a clear re-entry screen.

The implementation should remain domain-neutral internally, but this scenario guides the
initial UX and fixtures.

## MVP boundaries

**In the first version:** explicit project creation · explicit session start and stop · a
local event timeline · manually entered session notes · lightweight browser event capture ·
document edit events · structured session-state generation · an editable handoff contract ·
one worker agent · one reviewer agent · constrained research tools · edits to a document
copy · action and reasoning provenance · configurable stop conditions · a clear return
summary · a document diff · acceptance, rejection, redirection, and continuation controls.

**Not in the first version — treat as hard scope constraints** unless a foundational
interface must exist to preserve future extensibility: unrestricted full-screen recording ·
raw keystroke logging · automatic access to every application · unrestricted control of the
host computer · sending messages or emails · purchasing or booking · publishing documents ·
deleting user files · dynamically spawning large swarms · automatic multi-project compute
allocation · long-term personality modeling · automatic project recognition · cross-device
synchronization · autonomous background action without an explicit handoff ·
production-grade enterprise integrations.

## Product controls

The handoff experience exposes a small, understandable working agreement.

| Control | Options |
| --- | --- |
| **Initiative** | Follow closely · Use judgment |
| **Progress** | Finish the current step · Continue obvious next steps |
| **Output** | Suggestions only · Edit a copy |
| **Interruption** | Stop when uncertain · Stop only when blocked |
| **Budget** | time limit · model or compute budget |

Do not expose implementation details such as recursion depth, agent count, temperature, or
token limits to the consumer. Translate consumer settings into a structured internal policy.

## Core domain objects

To be defined precisely before implementation. Do not introduce additional abstractions
unless they solve a demonstrated requirement.

- **Project** — a persistent container for related work, documents, sessions, goals, and permissions.
- **WorkSession** — a bounded interval in which the user performs work toward an intention.
- **ObservationEvent** — a timestamped, semantic record of something relevant that occurred
  during a session. Examples: opened source · edited document · selected text · created note ·
  searched topic · changed section · encountered missing information.
- **SessionState** — a structured interpretation of the current work session: inferred
  objective, objective confidence, completed work, artifacts involved, open threads,
  constraints, unresolved questions, likely next actions, and evidence supporting each inference.
- **HandoffContract** — the explicit agreement governing autonomous continuation: objective,
  definition of done, allowed actions, prohibited actions, approved resources, initiative
  level, progress level, interruption policy, time and compute budget, stop conditions,
  output mode.
- **ExecutionPlan** — a bounded graph of proposed work derived from the session state and
  handoff contract.
- **AgentRun** — one worker or reviewer execution associated with a handoff.
- **ActionRecord** — an append-only record of an action, its reason, its result, and its
  verification status.
- **ShiftReport** — the re-entry artifact presented when control returns: summary, completed
  work, changed artifacts, source provenance, uncertainties, blocked items, human decisions
  required, suggested resume point.
- **ArtifactVersion** — a versioned copy of a document or output supporting comparison,
  acceptance, and rollback.

## Architectural principles

```
Observation → State inference → Handoff → Planning → Execution → Verification → Human re-entry
```

- **Observation must not directly execute actions.** The observation subsystem may produce
  events and inferred state. It must not control tools or modify external artifacts.
- **Policy must be explicit.** An LLM may suggest actions, but it must not authorize its own
  actions. Use deterministic application logic for permission checks, resource allowlists,
  budget checks, prohibited-action checks, stop-condition enforcement, and approval requirements.
- **Execution must be reversible.** The MVP edits copies or isolated artifact versions. Every
  material change must be inspectable and attributable.
- **State must have provenance.** An inferred objective or open thread must retain references
  to the observation events or user notes that support it.
- **Agents must be ephemeral.** Do not model workers as persistent personalities. The project,
  session, handoff, and artifacts persist; worker and reviewer runs are temporary.
- **Prefer high-level tools.** Execution should prefer native APIs, then structured application
  integrations, then browser DOM tools, then visual computer use. Avoid visual computer use
  unless absolutely necessary.
- **Stop rather than guess.** When confidence falls below the configured threshold or the next
  action requires consequential judgment, stop and surface the question.

## Model-boundary requirements

All model calls must use structured, validated outputs. Explicit prompts and schemas are
required for: session-state inference · handoff generation · execution planning · worker
action proposals · reviewer evaluation · shift-report generation.

Every model boundary must have a schema, validation, retries or graceful failure,
traceability, deterministic test fixtures, and an interface allowing model substitution.
Do not scatter direct model calls through UI or domain code.

## Evaluation requirements

A small evaluation harness with fixtures representing incomplete work sessions, scoring
whether the system correctly identifies objective, completed work, unresolved work,
constraints, next steps, and when to stop.

Measures: **context-transfer quality** (closeness to a human-authored reference) ·
**handoff correction rate** (how much the user must edit the proposed handoff) ·
**useful progress** (accepted / edited / rejected) · **scope adherence** (did the worker stay
within allowed actions and sources) · **stop quality** (did it stop when judgment or missing
information required it) · **re-entry quality** (can the user resume within ~one minute).

Synthetic fixtures and manual scoring are acceptable; the evaluation *architecture* must be real.

## UX standard

Consumer-facing. Avoid: *spawn agent · orchestration graph · inference confidence threshold ·
context window · tool call · execution trace*.

Use: *Start session · Take over · What I think you are working on · How far should I go? ·
What can I change? · Stop and ask me when… · While you were away · What I completed ·
What I need from you · Review changes · Keep going · Take back control*.

The interface should feel calm, transparent, and reversible. Do not use anthropomorphic fluff
to conceal uncertainty. Human-feeling means clear communication, calibrated confidence,
respectful interruption, continuity, and understandable decisions.

## Engineering standard

Strict types · clear dependency boundaries · small modules · schema validation at every
external boundary · append-only logs for observation and execution history · test-driven
development for core domain behavior · deterministic fixtures · dependency injection for
models and tools · no hidden global state · no direct provider calls from components ·
no framework-specific logic inside core domain models · accessible UI · clear empty, loading,
blocked, and error states · useful logging without leaking private content · no premature
microservices · no speculative infrastructure.

**Prefer a modular monolith.**

## Anti-overengineering rules

Do not: build a generic agent framework before the first workflow works · create a plugin
system · add vector databases without a demonstrated retrieval need · create many specialized
agents · add Kubernetes · split into microservices · build a real-time video pipeline ·
implement broad computer control · support multiple model providers beyond a clean interface
and one implementation · build production authentication unless the MVP environment requires
it · add billing · add team collaboration · optimize for scale before measuring usefulness ·
claim autonomous capability that is not implemented.

> When considering any new abstraction, ask: **is this necessary to test intention-preserving
> continuation in the first vertical slice?** If not, defer it.

## Decision behavior

Make reasonable implementation decisions, document them, and proceed. Stop for clarification
only when two interpretations would materially change the MVP hypothesis, a decision would
create irreversible scope expansion, credentials or unavailable external resources are
essential, or a safety or privacy decision requires explicit owner approval.

When making an assumption, record it in the relevant document.

## The goal

The goal is not to produce the most code. It is to build the smallest credible version of
Propositum that demonstrates this experience:

> *I stopped working. Propositum understood where I was going, made safe and useful progress,
> and handed the work back without breaking my momentum.*
