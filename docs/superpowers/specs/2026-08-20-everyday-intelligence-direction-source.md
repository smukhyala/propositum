Propositum

The personal intelligence layer for everyday computing

Product Intention

Propositum is an always-available, proactive personal AI system that lives alongside the user on their computer. The goal is not to build another chatbot, desktop assistant, or collection of AI automations. Propositum should become an intelligence layer for the computer itself: something that understands what the user is doing, develops persistent knowledge of how they work, recognizes what they are trying to accomplish, and steps in when AI can meaningfully help.

Today's AI products are overwhelmingly request-driven. The user first has to realize that AI could help, open an AI product, gather or explain the relevant context, formulate a prompt, potentially choose a model or tool, and then evaluate the response. Even many "Jarvis" projects ultimately reproduce this interaction with better memory, voice control, or computer access. They know more about the user, but they still wait to be asked.

Propositum should invert this relationship. The user works normally while Propositum observes the evolving state of their work. It builds an understanding of what they are working on, what they have already done, what information matters, what their preferences are, and what they are probably trying to accomplish. From that state, it identifies opportunities where AI could move the work forward. The fundamental loop is therefore:

Observe → Understand → Anticipate → Act → Learn.

The long-term goal is that users stop thinking, "I should ask AI about this." AI simply becomes part of how their computer works.

A General-Purpose Personal AI

Propositum should deliberately be designed beyond the Silicon Valley version of knowledge work. Coding is an excellent proving ground for agents because the environment is structured and the outcomes are relatively easy to evaluate, but the eventual product should work for anyone who does ordinary tasks on a computer.

Someone planning a vacation, researching an investment, shopping for a television, comparing insurance plans, organizing an event, reading about a health topic, filling out paperwork, searching for an apartment, working on a presentation, or simply browsing the internet should benefit from the same underlying system.

The user should not need to understand agents, prompts, MCP servers, context windows, or model selection. They should simply be able to use their computer. Propositum should handle the technical complexity required to turn their intentions into useful actions.

This makes Propositum less of an AI application and more of an AI runtime for everyday computing.

Building on Cortex and Frontier

The existing ideas behind Cortex and Frontier naturally become two of Propositum's foundational systems.

Cortex represents the understanding layer. Rather than every AI interaction starting from zero, Propositum maintains a persistent and evolving representation of the user's world. It should understand projects, goals, preferences, people, organizations, documents, previous decisions, recurring behaviors, active work, unfinished work, and the relationships between them.

Importantly, Cortex should not merely become a database of facts such as "the user prefers X." It should represent the user's working state. If someone has spent three evenings planning a trip, Propositum should understand that there is a trip, what decisions have already been made, what constraints exist, what remains unresolved, and what information from previous sessions is relevant to the current one.

Frontier becomes the decision layer. Given everything Propositum understands about the current state, it continually asks a simple question: what useful thing could happen next? Sometimes the correct answer is nothing. Other times it might surface information, identify a missing step, prepare a comparison, continue previous research, notice a contradiction, suggest a next action, or launch an agent to complete something.

Propositum connects these two ideas to execution. Cortex understands the user. Frontier determines what could move them forward. Propositum provides the models, agents, tools, MCP servers, browser control, computer control, and application access necessary to actually do it.

Observation and Understanding

For this system to work, Propositum needs a rich understanding of what happens on the user's computer. With appropriate permissions, the local application should be able to receive signals such as the active application, browser pages, selected text, files being viewed or edited, application transitions, searches, downloads, clipboard events, and other useful operating-system events.

The goal, however, is not to record the user's screen continuously and dump everything into a model. Propositum needs an observation engine that turns noisy computer activity into meaningful events.

For example, opening Google, searching for "best hotels Kauai," opening several hotel websites, switching to Maps, and eventually opening a spreadsheet are individually meaningless UI events. Together they strongly suggest that the user is comparing accommodations for a Kauai trip.

Propositum should convert these low-level events into semantic state. It might understand that there is a "Kauai Trip" project, that the current objective is finding accommodation, that several properties have been evaluated, that price and location appear to matter, and that a decision has not yet been made.

This semantic layer is critical. Propositum should reason about what the person is doing, not merely what pixels happen to be on their screen.

From Observation to Proactivity

Once Propositum understands the user's state, Frontier can evaluate whether there is an opportunity to help. This is one of the most important product and technical problems in the entire system.

The goal is not to maximize how frequently Propositum intervenes. An assistant that reacts to everything the user does would become unbearable almost immediately. The goal is to maximize useful assistance while minimizing interruption.

Every potential intervention should therefore be evaluated based on factors such as confidence in the inferred intent, expected usefulness, urgency, cost, reversibility, execution risk, and the user's historical response to similar suggestions.

If someone opens two Amazon pages, Propositum probably does nothing. If they spend twenty minutes opening ten different monitors, reading reviews, searching specifications, and switching between retailer pages, Propositum may become confident that a comparison would be valuable.

It could then unobtrusively surface something like "Compare these monitors?" The user clicks once and receives the comparison. No prompting, context gathering, copying URLs, or model configuration is necessary.

Over time, Propositum should learn the user's personal intervention threshold. Some people may want frequent suggestions. Others may only want the system to appear when it is extremely confident. Learning when not to act should be treated as seriously as learning how to act.

Dynamic Agent Configuration

Once the system identifies useful work, the user should not have to determine how AI should accomplish it.

Today, sophisticated AI workflows often require users to select models, configure agents, install MCP servers, choose tools, write prompts, and manually supply context. That may be powerful for technical users, but it is the wrong abstraction for a universal personal AI product.

Propositum should dynamically assemble the best execution environment for the objective. A research task might require a reasoning model, browsing agents, web search, and document retrieval. A coding task might use a coding model, GitHub access, terminal tools, and repository context. Trip planning might combine browsing, maps, calendar information, reservations, weather, and the user's previous travel preferences.

Conceptually, the system should operate as:

Intent → Relevant Context → Plan → Agent Configuration → Models + Tools → Execution → Verification.

The user should see the result of this orchestration rather than the orchestration itself. Models should therefore remain interchangeable. MCP servers should be infrastructure. Agents should be implementation details. Propositum's job is to decide how these pieces should be composed for whatever the user happens to be doing.

Computer Access as the Integration Layer

Propositum should be local-first and live directly on the user's device. This matters for privacy, but it also creates an important product advantage: the computer itself becomes the integration layer.

Instead of requiring a nontechnical user to manually connect dozens of services before Propositum becomes useful, the system should take advantage of the applications and authenticated environments the user already uses, wherever operating-system permissions and service security boundaries allow it. If someone is already signed into a website in their browser, Propositum's computer-use layer may be able to assist with that workflow without forcing the user to understand APIs or integrations.

Sensitive long-term state should remain local whenever practical. The local environment can maintain activity history, project state, personal memory, preferences, permissions, and intervention history. Remote models should receive only the context necessary to perform the current task rather than unrestricted access to everything Propositum knows about the user.

The goal is for onboarding to feel closer to installing an operating-system utility than configuring an enterprise automation platform.

Interaction and UX

The default Propositum interface should not be a blank chat box.

Typing should exist because there will always be cases where users want to explicitly tell the system something, but ordinary interaction should primarily happen through lightweight contextual interfaces: suggestions, buttons, approvals, previews, cards, notifications, and small overlays.

A user researching a trip might see "Planning a trip?" with options such as Help me plan, Just remember this, or Ignore. Someone shopping might see Compare these. Someone repeatedly moving information between applications might eventually see Automate this.

The deeper technical system can remain available for advanced users. Someone who wants to inspect or modify the prompt, choose models, configure an MCP server, inspect context, or change agent behavior should be able to do so. But that complexity should be progressively disclosed rather than becoming a prerequisite for using the product.

The ideal onboarding experience is extremely short: install Propositum, understand clearly what it can observe, grant the desired permissions, choose an initial autonomy level, and continue using the computer normally.

A Spectrum of Autonomy

Propositum should not treat autonomy as binary. There should be a spectrum between observing something and independently acting on it.

At the lowest level, Propositum simply observes and remembers. At the next level, it surfaces something relevant. It can then suggest an action, prepare the work without executing it, execute after one-click approval, or eventually perform specific categories of low-risk actions autonomously.

Permissions should therefore exist at the capability level. A user might allow Propositum to research automatically, organize information automatically, and prepare documents automatically while requiring approval before sending messages, booking reservations, purchasing anything, or changing important files.

This provides a path toward significant autonomy without requiring users to hand an AI unrestricted control over their computer.

Everyday Examples

Shopping illustrates the intended experience well. A user starts opening different monitors. Propositum initially stays silent. As the behavior becomes clearly comparative, it recognizes the task, remembers the products being considered, and offers to compare them. The resulting analysis can incorporate specifications, current prices, reviews, compatibility with the user's existing hardware, and previously observed preferences. If another monitor is researched tomorrow, it can automatically become part of the same decision rather than starting another conversation from scratch.

Travel planning demonstrates the importance of persistent context. Someone might research flights on Monday, hotels on Tuesday, restaurants later in the week, and hiking trails over the weekend. Existing AI interfaces treat those as separate sessions unless the user manually provides context. Propositum should recognize them as parts of the same trip. Eventually it can identify problems across those activities—for example, noticing that Tuesday's itinerary requires excessive driving—and offer to reorganize the schedule.

Financial research follows the same architecture. If someone spends several days researching a company, Propositum can understand that this is an investment decision, organize the evidence being gathered, connect it to previous research and portfolio considerations, and identify questions the user has not investigated. Rather than merely summarizing the current article, it might recognize that the user has never compared the company's valuation against two relevant competitors and offer to perform that analysis.

These are different domains, but they are fundamentally the same computational problem: understand what the user is trying to accomplish, maintain the state of that objective, determine what would help, and assemble the tools necessary to do it.

Core Product Architecture

The next-generation Propositum architecture should therefore revolve around several major systems working together.

The Observation Engine captures useful signals from the computing environment. The Semantic Activity Engine converts those signals into meaningful human activities. Cortex maintains persistent knowledge of projects, goals, entities, preferences, history, and active state. The Intent Engine determines what the user appears to be trying to accomplish. Frontier generates potentially valuable next actions. An Intervention Policy determines whether the system should remain silent, surface information, suggest something, prepare work, or act.

Once an action is selected, the Agent Orchestrator translates the objective into an execution plan and selects the appropriate models, agents, tools, MCP servers, and context. A Computer Runtime provides controlled interaction with browsers, applications, files, and the operating system. A Verification Layer checks whether the action actually accomplished the intended objective. A Permission Layer determines what each process is allowed to access or change. Finally, a Learning Layer incorporates user approvals, rejections, corrections, and repeated behavior back into Cortex and the intervention policy.

These components form a continuous loop rather than a traditional request-response application.

Trust as a Product Requirement

A system that observes someone's computer and occasionally acts on their behalf will only work if users trust it. Privacy and control therefore cannot be secondary features added after the intelligence works.

The user should always be able to understand what Propositum can see, what it remembers, what it is allowed to do, what information leaves the device, and what actions it has taken. Memory should be inspectable and editable. Actions should have history. Consequential actions should require appropriate approval. Reversible actions should provide undo whenever technically possible.

The system should also make the difference between observing, remembering, and sharing extremely clear. Allowing Propositum to understand something locally should not automatically mean that the information can be sent to every model or service Propositum uses.

Trust infrastructure is part of the core architecture.

What Propositum Is Not

Propositum should resist becoming another desktop chatbot, AI shortcut collection, developer agent framework, MCP client, automation builder, or screen-recording application. It may contain elements of all of those technologies, but they are implementation details.

Likewise, access to the newest model should never define the product. Propositum should remain model-agnostic and continuously use whichever models best accomplish particular tasks.

The durable value should instead accumulate in the system's understanding of the user, its representation of ongoing work, its ability to recognize intent from behavior, its knowledge of when intervention is useful, and its ability to reliably execute work across the computer.

Defensibility

The long-term moat is therefore not simply "AI that can control your computer." General computer-use agents will increasingly become commodities.

Propositum should compound around a longitudinal model of the user and their work. The longer it runs, the better it understands how the user accomplishes things, which projects matter, what decisions have already been made, what kinds of help they accept, which interventions annoy them, and what actions they trust the system to perform.

The intervention policy itself could become particularly important. Knowing how to execute a task is useful. Knowing which task is worth executing without being asked is much harder.

Propositum should ultimately become better not because its underlying foundation model is uniquely powerful, but because it understands the user and their current state better than a generic model ever could.

Near-Term Product Requirement

The next version should not attempt to implement the entire vision. It should prove the central hypothesis underlying everything else:

Can Propositum observe ordinary computer activity, correctly understand the task a person is performing, and proactively offer something useful without requiring a prompt?

The immediate architecture should therefore focus on completing one reliable loop:

Desktop observation → semantic events → task detection → persistent task state → opportunity generation → contextual suggestion → one-click agent execution → feedback.

The first workflows should intentionally extend beyond coding. Research, shopping and product comparison, trip planning, browsing-to-action workflows, and document-heavy work are strong initial environments because users naturally perform them across many websites and applications and because the value of persistent context is easy to demonstrate.

A successful early Propositum does not need to autonomously run someone's entire computer. It needs to produce the moment where a user is working normally, Propositum appears with exactly the thing they were about to need, and the user thinks:

"I didn't ask it to do that, but that's exactly what I needed."

That moment is the core product.

North Star

The eventual Propositum experience should be remarkably simple. A person installs it, grants a small set of clearly explained permissions, and continues using their computer normally.

Over time, Propositum begins understanding what they work on. Projects emerge without the user manually creating them. Information from different applications becomes connected. Previous decisions remain available. Unfinished work is recognized. Useful work gets prepared in the background. Occasionally, the system surfaces something that can move the user forward.

When the user approves an action, Propositum handles the complexity underneath: selecting models, retrieving context, configuring agents, connecting tools, operating applications, verifying the result, and remembering what happened.

The user does not need to learn how to use AI. They simply use their computer.

Propositum is not an AI you operate. It is an intelligence layer that understands your work, anticipates what would help, and moves it forward.
