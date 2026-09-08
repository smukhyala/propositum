use superpowers to plan the following and a large agent swarm (like 100+ useful agents) to implement. You are working inside the existing Propositum repository.

Your job is not to blindly implement features from this prompt. Your first job is to understand the current repository, existing product direction, architecture, docs, implemented features, unfinished work, and technical constraints. Then determine the cleanest path from the current state toward the product vision described below.

Treat the repository as the source of truth for what currently exists. Treat this prompt as the source of truth for where the product should go.

Do not assume the current implementation is bad or obsolete. Preserve useful systems and abstractions wherever possible. Prefer evolutionary changes over a ground-up rewrite unless the repository clearly warrants one.

⸻

1. Why Propositum Is Changing

The original Propositum idea was roughly:

A personal AI system that observes what you do on your computer, develops rich context about how you work, proactively recognizes what needs to happen, and can act on your behalf.

That direction is still interesting, but the competitive landscape has changed.

Frontier AI systems increasingly have:

* screen understanding
* computer use
* browser automation
* tool use
* application integrations
* multimodal context
* persistent memory
* autonomous task execution

Products such as Astra and increasingly capable systems from OpenAI, Anthropic, Google, and others make “an AI that can see your computer and operate it” a weak standalone thesis.

Computer control is becoming infrastructure.

Therefore Propositum should NOT try to win by being the best mouse-and-keyboard agent.

Instead, Propositum should move one layer above execution.

The central question becomes:

What does Propositum know, infer, or learn about a person that a generic agent does not?

The answer should be:

Propositum learns how a person works over time well enough to infer what should happen next.

Execution may eventually be delegated to whatever frontier computer-use system is strongest.

Propositum should own the intelligence around the user.

⸻

2. New Product Thesis

Propositum should become a personal decision and intention layer that continuously learns a model of how the user works.

A useful conceptual framing is:

Observation → Memory → Workflow Understanding → Intention Inference → Opportunity Detection → Planning → Execution → Feedback → Learning

The core product should increasingly focus on the middle of this chain rather than the final execution step.

A simple description:

Propositum learns how you work well enough to decide what should happen next—not just execute what you ask.

Another framing:

Generic agents understand the task you give them. Propositum understands the context in which the task exists.

Another:

The goal is not a Jarvis you command. The goal is a system that develops enough context about your work to notice useful work before you ask.

This distinction should influence architecture, product UX, data models, documentation, and implementation priorities.

⸻

3. Relationship to Existing Concepts: Cortex + Frontier + Propositum

There were previously separate conceptual systems:

Cortex

Cortex represented persistent knowledge about the user.

It answered:

* What has the user worked on?
* What projects exist?
* What people, companies, documents, concepts, and commitments matter?
* What happened previously?
* What recurring preferences or patterns exist?
* What context from one application should inform another?

Conceptually:

Cortex = understanding the user across time.

Frontier

Frontier represented deciding what should happen next.

It answered:

* What are the possible next actions?
* Which task is highest leverage?
* What work is blocked?
* What opportunity has emerged?
* What is likely to be forgotten?
* What action would move a project forward?
* Which actions can AI complete or prepare?

Conceptually:

Frontier = deciding what should happen next.

Propositum

Propositum should now absorb these ideas into a unified system.

Conceptually:

Cortex = memory.
Frontier = prioritization / opportunity detection.
Propositum = the full personal intelligence layer connecting context to action.

Do not necessarily use these names in the implementation unless useful. They are conceptual modules, not mandatory package names.

⸻

4. The Core Differentiator: A Learned User Model

The strongest version of Propositum should go beyond storing facts.

Most AI memory systems look like:

* user likes concise responses
* user is working on project X
* user knows person Y
* user has meeting Z tomorrow

That is useful but shallow.

Propositum should gradually learn behavioral structure.

Examples:

* When the user begins recruiting for a company, they usually research the product, inspect open roles, draft outreach, identify employees, and track follow-ups.
* When a GitHub task reaches a certain state, the user typically tests locally, checks the diff, commits provenance, and opens a PR.
* After a meeting with an external partner, the user usually sends a recap, creates follow-up tasks, updates internal notes, and schedules the next step.
* Before an exam, the user tends to ask conceptual questions first, then solve representative problems, then request a condensed recap.
* When a research result is weaker than expected, the user often compares assumptions, checks positive controls, reframes the research question, and modifies the paper narrative.
* When an event is approaching without certain logistics completed, the user tends to handle those logistics within a characteristic lead time.
* When the user writes something for LinkedIn, they prefer a less polished, more natural tone than typical corporate content.
* When a project reaches a certain degree of implementation without obvious usefulness, the user tends to reassess the product thesis rather than simply add features.

These are not static memories.

They are patterns.

The product should eventually represent things such as:

* workflows
* repeated action sequences
* triggers
* dependencies
* user preferences
* inferred goals
* project states
* deadlines
* collaborators
* recurring decisions
* task completion criteria
* behavioral tendencies
* confidence in inferred patterns
* evidence supporting those patterns

This learned model is potentially the core moat.

⸻

5. Propositum Should Be Model-Agnostic and Execution-Agnostic

Do not architect the product around one model provider.

The system should assume that the best agent/model changes constantly.

Potential execution providers may include:

* Anthropic
* OpenAI
* Google
* local models
* browser agents
* desktop agents
* MCP servers
* custom deterministic tools
* APIs
* external workflow systems

Propositum should ideally contain a provider abstraction such that its proprietary value remains in:

* context construction
* memory retrieval
* event interpretation
* workflow modeling
* intention inference
* opportunity ranking
* planning
* action governance
* feedback learning

rather than:

* raw LLM completion
* screen clicking
* browser control

In other words:

Models are interchangeable reasoning engines.

Computer-use systems are interchangeable actuators.

Propositum owns the persistent user intelligence.

⸻

6. Important Architectural Shift: Events, Not Screenshots

A naive architecture would continuously screenshot the desktop and send everything into an LLM.

Do not make that the central abstraction.

Screenshots may be one sensor, but the internal system should preferably operate on normalized events.

Examples:

* application opened
* browser URL visited
* file created
* file edited
* Git commit made
* Git branch changed
* calendar event started
* calendar event ended
* email received
* email sent
* Slack message received
* task created
* task completed
* document updated
* terminal command executed
* coding session started
* coding session ended
* project switched
* idle period detected
* meeting notes created

The architecture should aim toward:

Raw signals
    ↓
Adapters / Observers
    ↓
Normalized Events
    ↓
Event Store
    ↓
Interpretation / Enrichment
    ↓
Memory + Workflow State
    ↓
Opportunity / Intention Engine
    ↓
Suggested or Autonomous Actions

This creates a cleaner and more extensible system than reasoning directly over raw screen state.

⸻

7. Proposed Internal Data Model

You should inspect the existing data model first.

Do not force this exact schema if the repo already has equivalent concepts.

However, the system should conceptually support entities similar to:

Event

A timestamped observation.

Potential fields:

id
timestamp
source
event_type
application
project
raw_payload
normalized_payload
entities
confidence
privacy_level

Entity

Something persistent in the user’s world.

Examples:

* person
* company
* project
* repository
* course
* document
* event
* task
* research topic

Potential fields:

id
type
name
aliases
attributes
relationships
first_seen
last_seen

Memory

A persistent claim inferred or explicitly observed.

Potential fields:

id
memory_type
content
evidence_event_ids
confidence
created_at
updated_at
valid_from
valid_until

Types may include:

* factual
* preference
* behavioral
* workflow
* relationship
* commitment
* goal

Project State

A structured representation of an active project.

Potential fields:

project_id
objective
current_state
recent_activity
open_threads
blockers
deadlines
people
artifacts
next_actions

Workflow Pattern

A learned recurring sequence.

Potential fields:

id
name
trigger
context
steps
completion_signal
frequency
confidence
supporting_examples

Example:

Meeting ends
→ summarize notes
→ send follow-up
→ create tasks
→ schedule next event

Opportunity

A possible action Propositum believes may be useful.

Potential fields:

id
description
reason
supporting_context
expected_value
urgency
confidence
cost
risk
reversibility
required_permissions
suggested_action
status

Intent

An inferred user objective.

Potential fields:

id
goal
scope
time_horizon
confidence
evidence
related_projects

These abstractions should make the system more explainable and eventually easier to evaluate.

⸻

8. Opportunity Detection Is the Key Product Loop

A major product primitive should be the generation of opportunities.

An opportunity is:

Something Propositum believes the user would likely want done, prepared, surfaced, or considered.

Examples:

* “You met with Corgi yesterday and haven’t sent the promised event dates yet.”
* “Your research draft references an experiment whose latest results are newer than the numbers currently written in Section 4.”
* “You told this recruiter you would follow up this week. No follow-up has been sent.”
* “You have an exam tomorrow and have repeatedly struggled with subgroup proofs. Here are three problems worth reviewing.”
* “Three companies you applied to recently opened related roles.”
* “You finished implementing this feature but haven’t added tests.”
* “This project has accumulated seven implementation tasks but its product hypothesis has not been validated.”
* “Your meeting starts in 20 minutes; these are the three unresolved items from the previous meeting.”

The user should not have to explicitly ask for these.

This is the point of the product.

⸻

9. Opportunity Ranking

Do not treat every possible action equally.

Build toward a ranking function.

A conceptual score may depend on:

Opportunity Score =
    expected usefulness
    × confidence
    × urgency
    × goal alignment
    × contextual relevance
    × user preference fit
    - interruption cost
    - execution cost
    - risk

This can initially be heuristic.

Do not prematurely build ML training infrastructure unless justified.

But create clean interfaces so it could eventually become learned.

Important opportunity dimensions:

* urgency
* value
* confidence
* effort
* reversibility
* interruption cost
* required user attention
* execution risk
* alignment with active goals

⸻

10. Proactivity Must Be Carefully Controlled

A proactive AI can easily become annoying.

The UX must avoid turning into a notification spam engine.

The system should distinguish between levels of intervention.

For example:

Level 0 — Observe

No visible intervention.

Level 1 — Remember

Update memory but do not surface anything.

Level 2 — Suggest

Surface:

“You may want to follow up with X.”

Level 3 — Prepare

Generate the draft/action but do not execute.

Example:

“I drafted the follow-up email.”

Level 4 — Ask for approval

Prepare execution and request confirmation.

Level 5 — Autonomous

Execute reversible / pre-approved actions automatically.

These levels may eventually be user-configurable globally or per action type.

Existing repo concepts around autonomy settings should be preserved if already implemented.

⸻

11. Reversibility and Risk

Every action should have a risk classification.

For example:

Low risk

* summarize notes
* create local draft
* organize files
* generate task suggestions
* create private metadata

Medium risk

* create calendar event
* draft email
* modify project files
* update task tracker

High risk

* send email
* submit application
* post publicly
* delete files
* purchase something
* merge code
* modify production resources

Actions should ideally include:

risk_level
reversible
approval_required

This should influence whether Propositum merely suggests, prepares, or acts.

⸻

12. Explainability Is Essential

A proactive system must always be able to answer:

Why are you suggesting this?

Every opportunity should be grounded in concrete evidence.

Bad:

“You should email Alex.”

Good:

“You told Alex last Thursday you’d send the updated deck after the meeting. The deck was edited yesterday, but I haven’t seen a follow-up email.”

The user should be able to inspect the underlying chain:

Observed event
→ inferred state
→ inferred intent
→ detected opportunity
→ suggested action

This is both a trust feature and a debugging feature.

⸻

13. Feedback Loop

The system must learn from user responses.

Possible feedback signals:

* accepted suggestion
* dismissed suggestion
* postponed suggestion
* edited generated content
* reversed action
* ignored repeatedly
* explicitly marked helpful
* explicitly marked unhelpful

These signals should influence future behavior.

For example:

If the user consistently dismisses reminders about low-priority tasks, similar opportunities should be ranked lower.

If the user frequently accepts meeting follow-up drafts, Propositum should become more confident preparing those automatically.

Do not build complex reinforcement learning immediately.

But build the data model such that learning is possible.

⸻

14. Behavioral Workflow Learning

A particularly interesting long-term capability is automatically discovering recurring workflows.

Example event sequence:

Calendar meeting ended
Opened Notion
Edited meeting notes
Opened Gmail
Sent email to meeting attendee
Opened Todoist
Created 3 tasks

If similar sequences occur repeatedly, Propositum could infer:

Workflow:
Post-partner-meeting follow-up

Eventually the system could say:

“After these meetings you usually send a recap and create follow-up tasks. Want me to prepare both?”

Later:

“I prepared your usual post-meeting follow-up.”

Eventually, under explicit permission:

perform it automatically.

Possible initial implementation strategies:

* rule-based repeated subsequence detection
* clustering sequences by context
* LLM-generated workflow hypotheses
* workflow confirmation UI
* confidence based on repeated examples

Do not overengineer the ML now.

Design the interfaces correctly first.

⸻

15. Context Graph

Another useful conceptual representation is a lightweight personal context graph.

Nodes might include:

* projects
* people
* companies
* meetings
* documents
* repositories
* tasks
* goals
* commitments

Edges might include:

works_on
met_with
emailed
depends_on
belongs_to
mentioned_in
deadline_for
collaborates_with
related_to
promised_to
blocked_by

This graph does not necessarily need a graph database.

A relational database may be preferable initially.

The important idea is preserving relationships across otherwise siloed applications.

Example:

Person: Erica
    ↓ works_at
Company: Corgi
    ↓ partner_for
Project: E@B sponsorship
    ↓ has_commitment
Task: send event dates

This is the kind of cross-application reasoning generic agents often lack.

⸻

16. Product Interface

Do not turn the product into a giant chatbot.

Chat may exist, but the primary value should be visible without prompting.

Potential primary surfaces:

Today / Home

A concise dashboard:

Good morning.
3 things worth your attention:
1. Corgi follow-up
   You promised event dates yesterday.
   [Draft reply]
2. Research paper
   Section 4 uses results from an older experiment.
   [Review discrepancy]
3. Recruiting
   Two companies you contacted opened new roles.
   [View]

Timeline

Shows what Propositum observed.

Example:

9:04 AM   Opened research repo
9:16 AM   Modified experiment config
9:42 AM   Git commit
10:03 AM  Opened paper draft

Memory

Lets users inspect what the system believes.

Examples:

Projects
People
Commitments
Preferences
Workflows

Users should be able to correct incorrect memories.

Opportunities

A queue of detected useful actions.

Filters:

Now
Soon
Someday
Prepared
Dismissed

Activity / Actions

Shows what Propositum has:

* suggested
* prepared
* executed

Settings

Controls:

Observation sources
Privacy
Autonomy
Notification threshold
Execution providers
Model providers
Data retention

⸻

17. The Killer Demo

The product should be built toward a compelling demonstration.

Avoid a demo whose main point is:

“Watch my AI click around the screen.”

That is becoming commodity functionality.

A stronger demo:

The user works normally for several days.

Monday morning Propositum opens with:

“Here are five things I think matter today.”

Each recommendation is derived from previous behavior.

Examples:

1. Send Corgi the dates you promised Friday.
2. Update your research draft with Saturday's new experiment.
3. Follow up with the recruiter who asked you to reconnect this week.
4. Your Data 100 quizterm is approaching and your recent questions suggest logarithm manipulation is still a weak point.
5. You usually commit provenance after completing repository work; yesterday's changes are still uncommitted.

Three actions are already prepared.

The user clicks:

“Why?”

Propositum shows exactly what evidence produced each recommendation.

That demo communicates the real product thesis.

⸻

18. Privacy Must Be Architectural, Not Cosmetic

A system observing personal workflows will contain extremely sensitive context.

Privacy must be considered early.

Where feasible:

* local-first storage
* explicit observation permissions
* per-source controls
* encrypted storage
* transparent retention
* delete/export controls
* avoid retaining raw screen content unnecessarily
* transform raw observations into structured events
* allow sensitive applications to be excluded
* make cloud processing optional where possible

Do not claim absolute privacy guarantees the implementation cannot provide.

Document what is local vs remote.

⸻

19. Separate Observation from Interpretation

The system should avoid tightly coupling observation to LLM reasoning.

Prefer:

Observer
    ↓
Normalized Event
    ↓
Event Store
    ↓
Interpreter
    ↓
Memory / Project State

This allows:

* replaying historical events
* changing models
* debugging inference
* testing deterministically
* offline evaluation
* rebuilding memories from raw events

This separation is very important.

⸻

20. Event Replay

If feasible within the current architecture, support deterministic replay.

For example:

propositum replay ./sessions/demo.jsonl

This would feed recorded events through the system.

Why this matters:

It allows development of proactive behavior without requiring hours of live computer activity.

A fixed demo event stream could simulate:

meeting
→ document edit
→ email conversation
→ repo work
→ deadline

Then developers can evaluate whether the correct opportunities are produced.

This may become one of the most useful engineering/testing tools.

⸻

21. Evaluation

Propositum needs a way to measure whether it is becoming useful.

Possible metrics:

Opportunity Precision

Of surfaced opportunities, what fraction were useful?

accepted / surfaced

Opportunity Recall

Of actions the user eventually performed, how often did Propositum anticipate them?

This is more difficult but potentially very interesting.

Preparation Acceptance

How often does the user use a prepared action with minimal editing?

Time-to-Action

Does Propositum help important actions happen earlier?

Interrupt Cost

How many surfaced suggestions are dismissed?

Workflow Prediction Accuracy

Given recent events, how accurately can Propositum predict the next meaningful action?

This is especially interesting.

An offline dataset could represent:

context window → actual next action

Then evaluate:

Top-1 accuracy
Top-k recall
MRR

This could eventually turn Propositum into a real ML project rather than just an application wrapper.

⸻

22. Potential ML Direction

Do NOT immediately build this unless the repository is ready.

But design toward it.

A future dataset:

User event history
→ next meaningful action

Example training samples:

Context:
meeting ended
notes edited
task tracker opened
Target:
create follow-up tasks

or:

Context:
research experiment completed
metrics improved
paper opened
Target:
update results section

Possible modeling approaches eventually:

* sequence models
* embeddings over event windows
* next-event prediction
* retrieval over historical workflows
* personalized ranking models
* contextual bandits for suggestion ranking
* lightweight classifiers
* LLM + structured retrieval hybrids

The key insight:

Propositum could eventually learn a personal action prior.

Given context (C_t):

P(action | user history, current context)

This may become a much deeper technical direction than generic agent orchestration.

⸻

23. The System Should Improve from Generic to Personal

Cold start behavior:

generic heuristics
+ explicitly configured goals
+ calendar / tasks / current activity

Over time:

generic priors
+ learned preferences
+ repeated workflows
+ project-specific behavior
+ personal action sequences

The product should visibly improve with use.

That improvement curve is central to its defensibility.

⸻

24. MVP Scope

The immediate product should NOT attempt to solve every part of this vision.

After analyzing the repository, design a focused MVP proving the core thesis.

A good MVP probably demonstrates:

1. capture or ingest a small number of structured event sources
2. store normalized events
3. build lightweight persistent memory/project state
4. infer opportunities
5. rank them
6. display them
7. explain why each was generated
8. allow accept/dismiss feedback
9. optionally prepare actions
10. replay recorded event streams for testing

The MVP may use synthetic or locally generated activity if live integration is expensive.

Avoid prematurely implementing:

* full OS automation
* dozens of integrations
* autonomous email sending
* complicated ML training
* distributed infrastructure
* complex vector architecture without demonstrated need
* heavy graph databases
* always-on multimodal video capture

The MVP question is:

Can Propositum observe enough context to surface something genuinely useful before the user asks?

⸻

25. Example MVP Scenario

Use a scenario similar to:

The user has a project called:

Research Paper

Events:

09:00 — experiment completes
09:03 — results.json updated
09:10 — Git commit created
09:15 — paper.tex opened
09:20 — results section viewed

Memory says:

The user usually updates the paper after significant experiment changes.

Current project state says:

The paper still references experiment version 17.
The latest results are experiment version 18.

Opportunity engine generates:

Update the paper's results section with experiment 18.

Reason:

Experiment 18 completed this morning and changed the primary metric.
The current paper still references experiment 17.

Action:

[Review changes]
[Prepare patch]
[Dismiss]

This is a clear example of Propositum creating value above generic computer control.

⸻

26. Architecture Preferences

Prefer:

* TypeScript or existing repository language where appropriate
* clear domain boundaries
* typed data contracts
* provider interfaces
* dependency injection where useful
* deterministic core logic
* structured logs
* SQLite/Postgres rather than unnecessary exotic infrastructure
* JSONL for recorded event streams
* background jobs only where genuinely useful
* testable pure functions for ranking/state derivation
* clean separation between UI and intelligence layer

Avoid:

* giant agent prompts containing all state
* hidden global state
* uncontrolled autonomous loops
* every module calling LLMs directly
* tightly coupling model APIs to business logic
* unnecessary LangChain-style abstraction layers unless existing repo depends on them and they add value
* architecture astronautics

⸻

27. Suggested Service Boundaries

These are conceptual.

Adapt to the existing repository.

observers/
    browser
    filesystem
    git
    calendar
    manual
events/
    schema
    normalization
    storage
    replay
memory/
    extraction
    storage
    retrieval
    consolidation
projects/
    state
    relationships
    timelines
workflows/
    detection
    matching
    storage
opportunities/
    generation
    ranking
    deduplication
    lifecycle
actions/
    planning
    execution
    permissions
    providers
models/
    provider interface
    prompt templates
    structured output
feedback/
    acceptance
    dismissal
    editing
    learning signals
ui/
    today
    timeline
    memories
    opportunities
    settings

Again: do not force these directories if the repo already has a better structure.

⸻

28. Model Calls Should Produce Structured Outputs

When using LLMs for interpretation, prefer schemas.

For example:

{
  "entities": [],
  "memories": [],
  "project_updates": [],
  "possible_opportunities": []
}

Or:

{
  "goal": "...",
  "confidence": 0.84,
  "evidence_event_ids": ["..."]
}

Avoid relying on unstructured prose internally.

Validate outputs.

Store model/provider/version metadata for debugging where appropriate.

⸻

29. Opportunity Deduplication

This matters.

A proactive system must not repeatedly surface:

Email Alex.
Email Alex.
Email Alex.

Opportunities should have identity and lifecycle.

Potential statuses:

new
surfaced
prepared
accepted
executed
dismissed
expired
superseded

Deduplicate based on:

* semantic task identity
* linked entities
* linked project
* trigger
* timeframe

A dismissed opportunity should not instantly reappear unless circumstances materially change.

⸻

30. Temporal Reasoning

Time matters heavily.

The system should distinguish:

* happened today
* recently
* overdue
* recurring
* upcoming
* stale
* completed

Examples:

“You promised this yesterday.”

is more useful than:

“At some point you mentioned this.”

Where possible preserve timestamps and confidence rather than collapsing everything into timeless memory.

⸻

31. Memory Should Decay or Change

Not all memories are permanent truths.

Examples:

User is working on recruiting.

may stop being relevant.

Potential memory states:

active
stale
superseded
archived

Memories should link to supporting evidence and be updateable.

Avoid endlessly accumulating embeddings with no lifecycle.

⸻

32. User Corrections

The user should be able to say:

That's wrong.
I don't care about this.
Don't suggest this again.
This project is finished.
I always want you to prepare these automatically.

These corrections should become structured data.

Do not hide corrections in chat history.

⸻

33. Autonomy Profiles

Potential user configuration:

Email:
  observe: yes
  suggest: yes
  draft: yes
  send: never
Calendar:
  observe: yes
  suggest: yes
  create: ask
Git:
  observe: yes
  suggest: yes
  local changes: ask
  push: never
Tasks:
  observe: yes
  create: automatic

This can become a strong UX primitive.

⸻

34. Propositum Should Not Depend on Chat

The user should be able to open the product and immediately receive value.

Chat can answer:

What am I forgetting?
What should I work on next?
Why did you suggest this?
What happened with the Corgi partnership?
Prepare everything I usually do after this meeting.

But these queries should leverage the same structured internal state powering the proactive interface.

⸻

35. Documentation Changes

After inspecting the repo, update documentation to clearly distinguish:

Vision

The long-term personal intelligence layer.

Current MVP

What the repository actually does today.

Architecture

How current implementation maps to the vision.

Non-goals

Explicitly state what is not being built right now.

Potential non-goals:

* replacing frontier computer-use agents
* building our own foundation model
* full autonomous desktop control
* monitoring every application
* learning a perfect behavioral model immediately

Competitive framing

Generic agents:

execute instructions.

Propositum:

maintains longitudinal context and predicts useful intentions/actions.

Be careful not to make unsupported competitive claims.

⸻

36. Repo Audit — Do This First

Before making major changes, inspect:

* README
* docs
* package manifests
* directory structure
* existing architecture
* database layer
* state management
* AI provider abstractions
* agent logic
* memory system
* observation system
* desktop app components
* frontend
* API
* tests
* unfinished TODOs
* recent git history if available

Answer internally:

1. What currently works?
2. What is partial?
3. What is unused?
4. What was the previous architectural thesis?
5. Which components already align with this new direction?
6. Which components are now misaligned?
7. What can be repurposed?
8. What should be deprecated?
9. What is the smallest implementation that proves the new thesis?

Do not destroy working functionality merely because naming or abstractions differ from this prompt.

⸻

37. Then Create a Migration Plan

Before implementing broad changes, create/update a document such as:

docs/PROPOSITUM_V2.md

or the repo’s existing equivalent.

It should contain:

Current state
New thesis
Key architectural changes
Reusable existing components
Components to refactor
Components to deprecate
MVP scope
Milestones
Risks
Open questions

Then proceed with the highest-leverage implementation work.

Do not create a giant speculative backlog.

Prioritize concrete vertical slices.

⸻

38. Preferred First Vertical Slice

Unless the existing repo suggests a better one, aim for something like:

Synthetic/recorded events
        ↓
Event Store
        ↓
Project State
        ↓
Opportunity Generation
        ↓
Opportunity Ranking
        ↓
Today UI
        ↓
Why this?
        ↓
Accept/Dismiss feedback

This vertical slice demonstrates the thesis without requiring full desktop automation.

Make it easy to demo.

Create example/demo data if necessary.

⸻

39. Example Demo Dataset

Potential fixture:

Project: Robotics Hackathon
Event 1:
User created experiment results.
Event 2:
New accuracy increased from previous run.
Event 3:
README still references old number.
Event 4:
LinkedIn draft opened.
Opportunity:
Update README and social post with new result.

Another:

Project: Partner Event
Event 1:
Meeting ended.
Event 2:
Meeting notes contain:
"Sanjay to send proposed dates."
Event 3:
24 hours pass.
Opportunity:
Send proposed dates.

Another:

Project: Recruiting
Event 1:
User emails recruiter.
Event 2:
Recruiter says:
"Reach back out next week."
Event 3:
One week passes.
Opportunity:
Follow up.

The system should show its reasoning from evidence.

⸻

40. Build for Replayability and Demoability

It should be possible to seed or replay the demo easily.

Ideal developer experience might look like:

pnpm demo:seed
pnpm dev

or:

propositum replay fixtures/demo-week.jsonl

The UI should populate with realistic opportunities.

This is more useful right now than requiring the developer to run Propositum continuously for a week.

⸻

41. Testing

Add meaningful tests around core logic.

At minimum:

* event normalization
* memory/project updates
* opportunity generation
* ranking
* deduplication
* opportunity lifecycle
* feedback
* temporal behavior
* permission checks

Where LLM calls are involved:

* mock provider
* structured fixture
* deterministic test path

Core unit tests should not require external APIs.

⸻

42. Possible Evaluation Harness

If practical, create fixtures such as:

scenario_001_partner_followup
scenario_002_research_update
scenario_003_recruiter_followup
scenario_004_unimportant_noise

Each fixture contains:

events
expected opportunity
expected non-opportunities

Then calculate:

precision
recall
ranking quality

Even a primitive harness would make the project much more technically serious.

⸻

43. What Not to Optimize for Yet

Do NOT spend most of the effort on:

* fancy visual animations
* pixel-perfect dashboard design before the loop works
* dozens of integrations
* complex embeddings
* vector DB tuning
* massive prompt engineering
* custom browser automation
* desktop control
* continuous video/screenshot analysis
* agent swarms
* autonomous indefinite loops

The product hypothesis is not:

Can an AI operate applications?

The hypothesis is:

Can longitudinal context allow an AI to identify useful work before the user asks?

Everything should serve that question.

⸻

44. Important UX Principle

The best outcome should feel like:

“Oh, I actually was going to do that.”

Not:

“Technically that suggestion is related to something I did.”

The bar for proactivity is high.

Fewer high-confidence suggestions are better than many mediocre suggestions.

Default conservative.

⸻

45. Longer-Term Moat

Architectural decisions should preserve the possibility that Propositum eventually develops a unique dataset:

observed context
→ predicted opportunity
→ user response
→ eventual actual behavior

Over time this creates personalized examples of:

what the user tends to do
what the user wants
what suggestions are useful
when the user wants intervention
how workflows unfold

This dataset may support:

* personal ranking
* personalized classifiers
* workflow prediction
* contextual bandits
* sequence models
* preference models

The system should therefore preserve structured training/evaluation signals where reasonable.

Do not overclaim this in product-facing docs yet.

⸻

46. Strategic Positioning

Think of the stack as:

Foundation models
        ↓
Agent / computer-use layer
        ↓
Propositum
        ↓
User

Actually, the runtime flow may be:

User context
        ↓
Propositum
        ↓
Agent
        ↓
Applications

Propositum decides:

what matters
what should happen
what context is relevant
what the user likely wants
how much autonomy is allowed

The agent decides:

how to execute it

This distinction should become very clear throughout the system.

⸻

47. Product Philosophy

Keep these principles visible throughout development:

Context over commands

The system should understand the environment surrounding a request.

Intention over instruction

The user should not need to phrase every task explicitly.

Learning over configuration

The system should gradually infer workflows rather than requiring users to script all of them.

Preparation before autonomy

The system earns trust by preparing useful work before automatically executing it.

Evidence over mystery

Every proactive action should have a reason.

Personalization over general intelligence

The moat is not being smarter than frontier models.

The moat is understanding this user better.

⸻

48. Your Immediate Workflow

Do this in order:

1. Thoroughly inspect the repository.
2. Read all major project/vision/architecture documentation.
3. Understand what functionality actually exists today.
4. Map current systems onto the new thesis.
5. Identify contradictions or obsolete assumptions.
6. Write/update a V2 vision/architecture migration document.
7. Choose the smallest vertical slice that demonstrates proactive longitudinal intelligence.
8. Implement that slice using existing infrastructure where possible.
9. Add realistic demo fixtures.
10. Add tests.
11. Update the README to clearly explain:

* what Propositum is
* what currently works
* what the demo demonstrates
* how to run it
* where the project is going

12. Run the relevant test/lint/typecheck/build commands.
13. Fix issues introduced by your changes.
14. Review your own work for unnecessary complexity.

⸻

49. Expected End State of This Pass

At the end of this work session, I want the repository to feel like it is clearly moving toward:

A personal intelligence system that observes activity, builds longitudinal context, identifies useful next actions, and can delegate execution to interchangeable agents.

Not:

Another desktop AI agent.

The implementation does not need to fulfill the entire vision.

It needs to establish the correct architecture and prove the central loop.

A visitor to the repository should be able to understand the distinction within a few minutes.

A developer should be able to run a demo showing it.

And the architecture should leave room for much deeper personalization and ML later.

⸻

50. Final Instruction

Use judgment.

If the current repository already contains strong implementations for observation, memory, autonomy, planning, or agent execution, adapt and reuse them.

If this prompt conflicts with a clearly superior existing abstraction, preserve the superior abstraction and document why.

Do not cargo-cult terminology from this document.

Do not rewrite everything.

Do not build speculative infrastructure just because it appears here.

The objective is to make the current Propositum repository materially closer to the product thesis while keeping it coherent, testable, and demoable.

Start by understanding what exists.

Then make the highest-leverage changes you can.
