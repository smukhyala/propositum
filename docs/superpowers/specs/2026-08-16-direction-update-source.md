Propositum
Direction Update: Persistent Intentions → Everyday AI
Purpose: capture the feature and architectural changes that should update the repository context, vision, architecture, roadmap, and later implementation. This is a direction document—not a mandate to build the full future state now.
# Executive direction
Old framing: Observe an unfinished work session, take over, make progress, and hand the work back.
New framing: Maintain persistent intentions—live representations of what a person is trying to accomplish—and coordinate humans, models, tools, and agents to move those intentions forward over time.
Consumer promise: Everything you're working toward keeps moving, even when you're not.
Technical thesis: Model human work as persistent, partially observable, goal-directed processes; update their state from heterogeneous events; and reason or learn policies for what useful progress looks like, who should perform the next action, how far they should go, and when human judgment is required.
# 1. Product hierarchy: Intention becomes the top-level primitive
WorkSession remains important, but sessions are temporary episodes. An Intention persists across sessions, agents, applications, external events, and periods of inactivity.
Intention — Persistent desired outcome with state, constraints, deadlines, dependencies, success criteria, and history.
Project — Optional organizational container for related intentions, artifacts, and people.
WorkSession — Bounded period of human activity that updates one or more intentions.
ObservationEvent — Semantic signal about what changed during human work.
ExternalEvent — State change from outside active work: email reply, calendar change, CI result, deadline, document update, etc.
HandoffContract — Explicit temporary agreement defining what AI may pursue, change, spend, and when it must stop.
WorkingAgreement — Durable user preference/permission policy that can apply across handoffs.
AgentRun / HumanAction — Execution episode attempting to advance an intention.
ProgressEvent — Evidence that an intention's state meaningfully changed.
Decision / Blocker / Dependency — Structured state explaining why progress can or cannot continue.
ShiftReport — Human re-entry artifact summarizing progress, uncertainty, and required judgment.
## Intention lifecycle
State
Meaning
Working
Human is actively progressing it.
Delegated
Propositum or another approved worker is progressing it.
Waiting
Progress depends on an external event or dependency.
Needs You
Next useful step requires human judgment or approval.
Sleeping
No useful action should be taken right now.
Done
Desired state or definition of success has been reached.
# 2. Feature additions
## Intention Home
A non-chat-first home surface showing active intentions, state, progress, blockers, deadlines, and where useful AI work is available.
## Universal Take Over
Keep the signature handoff: infer current objective and unfinished work, confirm scope, then continue within explicit boundaries.
## Standing Working Agreements
Durable delegation policies by domain/intention: research freely, edit drafts, never send externally, never spend money, ask before changing commitments.
## Trust / Delegation Model
Track classes of actions users accept, edit, reject, or require approval for. Use history to recommend—not silently grant—appropriate autonomy.
## Opportunity-to-Help Detection
On state changes, determine whether useful progress is possible. Do not invent work simply to remain active.
## Event-Driven Updates
Intention state can eventually update from email, calendar, Slack, GitHub, docs, browser activity, local files, agent outputs, deadlines, and direct input. Observation is one sensor.
## Human-Centered Notifications
Three main moments: I can move this forward; I need your decision; I finished meaningful work.
## Progress Reasoning
Represent current state, desired state, candidate actions, uncertainty, cost, risk, dependencies, and expected useful progress.
## Worker Routing
Treat foundation models and specialized agents as interchangeable executors selected by fit, permissions, quality, latency, cost, and tool access.
## Outcome Feedback
Capture intention → state → action → result → user correction/acceptance → updated state trajectories.
# 3. Architectural changes
Previous: Observation → Session State → Handoff → Planning → Execution → Verification → Human Re-entry
Revised layers:
Intention Graph — persistent source of truth for goals, subgoals, constraints, dependencies, artifacts, people, decisions, sessions, and outcomes.
State Ingestion Layer — accepts observations, external events, user input, and worker results.
State Reconciler — determines which intentions changed, resolves conflicting evidence, preserves provenance, and updates current state.
Progress Reasoner — determines whether useful progress exists and generates candidate next actions.
Delegation / Policy Layer — combines working agreements, hard permissions, trust history, budgets, risk, and stop conditions.
Worker Router — chooses human, model, specialized agent, API, browser worker, or computer-use worker.
Execution Runtime — performs bounded work through the highest-level available tool.
Verification Layer — checks whether the intended state change occurred and scope was respected.
Outcome / Learning Layer — records accepted, edited, rejected, blocked, and reverted outcomes.
Re-entry Layer — presents the minimum information required for the human to understand state and resume control.
## Control-plane principle
Propositum sits above models and agents. OpenAI, Anthropic, local models, browser agents, coding agents, and future executors are workers beneath the Propositum control plane. Propositum owns intention state, delegation policy, progress reasoning, provenance, and human continuity. Better foundation models should improve Propositum rather than replace it.
# 4. How existing concepts change
Concept
Keep?
Updated role
WorkSession
Yes
Temporary episode contributing evidence/progress to an Intention.
Observation Window
Yes
One state-ingestion mechanism, not the product identity.
Handoff Contract
Yes
Temporary delegation contract layered on durable working agreements.
Worker + Reviewer
Yes
MVP execution pattern; general routing comes later.
Computer Use
Later
Fallback when structured APIs/integrations are unavailable.
Persistent Processes
Yes
Represent primarily as persistent Intentions with lifecycle states.
Multi-project Scheduler
Later
Becomes intention-level scheduling of highest-value useful progress.
Session Replay
Maybe
Useful for provenance/debugging; semantic events matter more than raw replay.
# 5. Consumer UX changes
Chat is an interaction surface, not the home screen.
Home represents the user's active world: intentions, progress, blockers, waiting states, and decisions.
Use human language: Take over, Keep going, Needs you, While you were away, Waiting, Sleeping, Done.
Do not expose agents, context windows, orchestration graphs, tool calls, or model-specific terminology.
Reduce prompting by inferring context and asking for confirmation only when intention or permission is ambiguous.
Notifications should be actionable and sparse. The system should be comfortable doing nothing.
Re-entry remains first-class: what changed, why, uncertainty, and the exact next human decision.
Every consequential action remains inspectable, attributable, and reversible.
# 6. ML / learning direction
State estimation — infer latent intention state from incomplete, heterogeneous observations.
Progress estimation — distinguish activity from actions that reduce distance to the desired outcome.
Next-action ranking — estimate expected useful progress, cost, risk, uncertainty, and dependency effects.
Delegation policy — determine whether the human, an AI worker, or nobody should act.
Stopping policy — identify when continued autonomy is likely to drift, waste compute, or require judgment.
Worker routing — select an executor using task characteristics and historical performance.
Trust calibration — use acceptance, edits, rejection, reversal, and approval patterns to recommend autonomy.
Trajectory learning — preserve intention → state → action → outcome → correction as the core feedback dataset.
# 7. Privacy and trust implications
Keep observation local-first where practical; send workers only minimum necessary context.
Prefer semantic events over raw recordings; avoid raw keystroke logging.
Make every connected source and permission visible and revocable.
Separate state inference from action authorization.
Hard consequential-action gates remain explicit even when working agreements reduce repetitive confirmations.
Preserve provenance for state updates, decisions, and agent actions.
Provide retention, deletion, export, and clear personalization boundaries.
Trust history can recommend a setting; it cannot silently create permission.
# 8. MVP impact: change now vs. later
## Change now
Put Intention above WorkSession in domain language.
Allow Project/Session models to attach to an Intention without building a full graph system.
Add minimal desired outcome, definition of success, and lifecycle state.
Keep the observation → handoff → worker → reviewer → re-entry vertical slice.
Make HandoffContract compatible with future WorkingAgreements.
Keep model/provider interfaces abstract and workers replaceable.
Record action outcomes and user accept/edit/reject decisions as structured feedback.
Update UX copy around moving intentions forward, not deploying agents.
Update context, vision, architecture, and roadmap docs while clearly marking future capabilities.
## Do not build yet
Full graph database or generalized intention-graph infrastructure.
Automatic Gmail/Slack/Calendar/GitHub/Notion ingestion.
Continuous autonomous background scheduling.
Learned trust/autonomy models.
Multi-provider quality/cost routing beyond clean interfaces.
Large multi-agent swarms.
Unrestricted computer use.
Automatic multi-intention compute allocation.
Cross-device continuity.
Proactive consequential action without established permission policy.
# 9. Documentation changes Claude should make
VISION.md — Reframe around persistent intentions and everyday AI. Keep “works while you're away” as the consumer wedge; destination is an intention control plane coordinating human and AI progress.
CONTEXT / PRODUCT CONTEXT — Introduce Intention as top-level primitive and relate intentions, projects, sessions, observations, handoffs, workers, outcomes, and re-entry.
UBIQUITOUS_LANGUAGE.md — Add Intention, ExternalEvent, ProgressEvent, WorkingAgreement, DelegationPolicy, Blocker, Dependency, and lifecycle states. Recast WorkSession beneath Intention.
ARCHITECTURE.md — Document future layers: Intention Graph, State Ingestion, Reconciler, Progress Reasoner, Delegation Policy, Worker Router, Outcome Feedback, Re-entry. Explicitly label unimplemented components.
MVP.md — Do not dramatically expand scope. Reframe hypothesis around an unfinished intention surviving human → AI → human handoff with useful progress and minimal re-explanation.
ROADMAP.md — Evolve stages toward Guided Intention Continuation → Event-Driven Understanding → Adaptive Delegation → Multi-Intention Everyday AI.
PRODUCT_PRINCIPLES.md — Add: intentions outlive sessions; activity is not progress; the system should be comfortable sleeping; models are workers, not the product; learned trust never overrides permissions.
SECURITY_AND_PRIVACY.md — Add standing agreements, event ingestion, minimum-context worker routing, learned personalization boundaries, and explicit distinction between trust and authorization.
EVALUATION.md — Eventually evaluate intention-state accuracy, useful-progress quality, correct delegation, stopping, worker selection, and user re-entry—not only session summarization.
# 10. Suggested roadmap framing
## Stage 1 — Guided Intention Continuation
Explicit intention + work session + handoff + bounded worker + reviewer + re-entry. This is the current MVP target.
## Stage 2 — Event-Driven Understanding
More passive observation and external events update intention state; better state reconciliation and opportunity detection.
## Stage 3 — Adaptive Delegation
Standing working agreements, richer permissions, learned trust recommendations, worker routing, improved stopping and progress policies.
## Stage 4 — Multi-Intention Everyday AI
Multiple persistent intentions, background scheduling, cross-tool/cross-device state, proactive but permissioned progress, and continuous human/AI coordination.
# 11. Key non-goals / moat boundaries
Do not define Propositum's moat as any commodity executor capability. Screen recording, computer control, browser automation, generic memory, MCP/connectors, multi-agent orchestration, long-running agents, and model quality should be consumed as replaceable capabilities.
The durable layer to own is: live intention state + progress reasoning + delegation policy + human continuity + outcome trajectories.
# 12. Immediate next action
Have Claude inspect the repository's current implementation and update the context/vision/domain/architecture/roadmap documents to reflect this direction. Claude should preserve the current MVP scope unless a small schema/interface change is necessary to prevent architectural dead ends. After the docs are consistent, compare the current codebase against the revised MVP and implement only the next smallest missing vertical slice.
# Definition of the product after this update
Propositum is the intention layer for everyday AI. It maintains a live model of what a person is trying to accomplish, understands how human work and external events change that state, determines when useful progress is possible, and coordinates the appropriate human or AI worker to advance it within learned preferences and explicit permissions.
