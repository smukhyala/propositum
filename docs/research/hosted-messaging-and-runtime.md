# Hosting the thread and the worker elsewhere: Photon, Daytona, and their field

*Research note, 2026-09-01. Nothing in here is decided; nothing in here changes a decision.
Every price and claim was read from the vendor's own page or a named third party on that
date, and each carries its source in §7. Vendor-authored comparisons are marked as such.*

## 0. The answer, first

**Neither vendor is adopted. Nothing in `src/` changes.**

| Question | Answer | Why, in one line |
|---|---|---|
| Host the phone thread on Photon (Spectrum Cloud)? | **No** | It is the hosted relay [ADR-0021](../adr/0021-a-thread-on-the-persons-phone.md) refused — *"a server of theirs, and we chose it for you"* — with a better SDK. |
| Host the worker on Daytona? | **No** | There is no seam. The act path needs the person's own Chrome, cookies and the loopback origin the extension hardcodes. Cloud execution *"needs an ADR before it needs a todo"* (`docs/todo/README.md`). |
| Is either worth revisiting? | **Photon's local kit, as a reference only** | `imessage-kit` reads `chat.db` the way [ADR-0026](../adr/0026-reading-a-one-time-code.md) will; its send path is `osascript`, which [ADR-0025 §3](../adr/0025-computer-use-beyond-the-browser.md) bans. |

If you read only this table, you have the decision. The rest is the evidence, so that the next
person proposing either vendor argues against a dated number rather than a feeling.

## 1. What Propositum does today, so the comparison has a baseline

- **The thread** is one file, `src/runtime/thread-channel.ts`, long-polling Telegram's Bot API
  with a per-person bot token held in SQLite. No webhook, no relay, no host, no shared bot.
  `tests/reachability.test.ts` pins `api.telegram.org` to that one file.
- **The worker** is a sibling OS process on the person's Mac
  ([ADR-0001](../adr/0001-worker-runtime.md)). It stops when the lid closes — *"leave your desk,
  not leave the building"* — and that ADR names *"runs need to survive sleep"* as a **product**
  decision, not a runtime one.
- **Acting** goes through the person's real Chrome and the unpacked extension, which hardcodes
  `http://127.0.0.1:3117`. The extension can only make outbound `fetch`, so the worker holds a
  dispatch open and the extension long-polls it. None of that survives a network boundary.
- **The rule** in `AGENTS.md`, `VISION.md` and `SECURITY_AND_PRIVACY.md`: *no cloud, no
  telemetry, no server of ours*. `ANTHROPIC_API_KEY` is the only credential, and
  `tests/architecture.test.ts` allows exactly five token-shaped columns in the schema. A vendor
  secret is a sixth, and *"that is an ADR, not a migration."*

## 2. Photon (photon.codes) — Spectrum

**What it is.** An MIT TypeScript framework, `spectrum-ts`, plus a hosted service, Spectrum
Cloud. You write `for await (const [space, message] of app.messages)` and reply on the message.
Inbound arrives either through that iterator, which needs no public URL, or through
`app.webhook()`, which does. Auth is a project id and secret.

**Which channels are local and which are not.**

| Channel | Package | Where it runs |
|---|---|---|
| iMessage | `@spectrum-ts/imessage` | Spectrum Cloud, pooled or dedicated numbers |
| iMessage, local | `@spectrum-ts/imessage-local` | your own Mac, your own iCloud |
| WhatsApp Business | `@spectrum-ts/whatsapp-business` | Spectrum Cloud |
| Telegram | `@spectrum-ts/telegram` | Spectrum Cloud — *"inbound messages delivered through Fusor webhooks"* |
| Slack | `@spectrum-ts/slack` | Spectrum Cloud |
| Terminal | `@spectrum-ts/terminal` | local |

The Telegram row is the one that matters here. It is Telegram → Photon → you. Today it is
Telegram → you. Adopting it inserts a vendor into the only path that has none, and buys
reactions, edits and typing indicators for a thread whose outbound set is five closed kinds
(`src/domain/conversation/messages.ts`) and needs none of them.

**Local iMessage is thin.** Text and attachments only. Typing is a no-op, streaming unsupported,
no reactions, no edits, no group creation. The underlying `imessage-kit` reads
`~/Library/Messages/chat.db` (Full Disk Access; `better-sqlite3` on Node, zero dependencies on
Bun) and sends by `osascript`, resolving when the process exits — it does not confirm the row
landed. That is the local bridge ADR-0021 deferred, and its send half is what ADR-0025 §3 forbids:
*"No shell, no `osascript`, no AppleScript, no `open(1)`. Synthesised input and nothing else."*

**Pricing, 2026-09-01.**

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | up to 10 users; iMessage, SMS/RCS, Telegram; "unlimited daily messages"; community support |
| Pro | $25/mo | up to 100 users; same channels |
| Business | $250/line/mo | dedicated numbers, WhatsApp, calls, group API, iMessage mini apps, 50 cold contacts/day |
| Enterprise | custom | dedicated lines you own, SLAs |

Quotas quoted in Photon's iMessage docs: 5,000 messages per server per day, 50 new conversations
per line per day. On Free and Pro the iMessage number is **pooled** — a fresh number per
recipient from Photon's pool. That is a shared bot with extra steps, and ADR-0021 is explicit:
*"There is no shared Propositum bot and there must never be one, because a shared bot is a
server of ours wearing a different hat."*

**Trust posture.** The site claims SOC 2 Type II and HIPAA-capable plans. The docs index
(`photon.codes/docs/llms.txt`) has **no security, privacy, retention or encryption page**, and
`photon.codes/privacy` returned 404 on the date checked. Nothing published says whether Spectrum
Cloud stores message bodies, or for how long.

**Reliability datapoint.** Hermes Agent issue #42454 (2026-06-08): the 0.1.x cloud host
`spectrum-cloud.photon.codes` stopped resolving with no backward compatibility, and 1.x
(2026-05-31) changed `space.send` and space resolution. Photon states 10M iMessage API calls a
day and names Rho, Vercel, Hermes and Ditto as customers. Both things are true at once.

**Verdict.** Refused, on the argument ADR-0021 already made. Photon is that rejected category
with the best developer experience in it, which is worth knowing and changes nothing.

## 3. Daytona (daytona.io)

**What it is.** Managed sandboxes for agent code, with SDKs in TypeScript (`@daytona/sdk`),
Python, Go, Ruby and Java. **Closed source since 2026-06-11**, citing AI-driven vulnerability
discovery against open isolation code. The old repository (71.8k stars) stays public and
unmaintained; SDKs and docs moved to `github.com/daytona`. $24M Series A, February 2026.

**Pricing, 2026-09-01.** $0.0504 per vCPU-hour, $0.0162 per GiB-hour, $0.000108 per GiB-hour of
disk after 5 GiB, per second, $200 free credit. GPUs from $0.57/h (RTX 4090) to $2.61/h (H200).
Windows $0.0858 per vCPU-hour.

**Sandbox shape.** 1 to 4 vCPU, 1 to 8 GiB, 1 to 10 GiB disk by default. States: started,
stopped, paused, archived, destroyed. The filesystem persists across stop and start; an ephemeral
flag deletes on stop; snapshots and shared volumes exist. Isolation is Docker by default with
Kata or Sysbox on request.

**Network is gated by how much you have paid.**

| Tier | How you get there | Egress |
|---|---|---|
| 1 | verified email | restricted; cannot be overridden per sandbox |
| 2 | card + $25 top-up | restricted; cannot be overridden |
| 3 | $500 top-up | open; domain allowlist (max 20, wildcards) *or* CIDR allowlist (max 10) *or* block-all; outbound proxy URL |
| 4 | $2,000 every 30 days | as Tier 3 |

Essential services do not bypass an allowlist; you list npm and GitHub yourself.

**Computer use.** Linux and Windows: Xvfb, xfce4, x11vnc, noVNC; mouse, keyboard, screenshot,
recording, an AT-SPI accessibility tree. macOS is a private alpha behind a request form. A CDP
endpoint for browser automation was an open issue (#4456) on the archived repo.

**Elsewhere in the stack.** Bring-your-own-compute is Helm charts on Kubernetes; custom regions
are invite-only. Daytona is also one of four sandbox back ends for Claude Managed Agents, where
Anthropic runs the loop and you run an orchestrator and a snapshot.

**Third-party measurement** (MarkTechPost, 2026-08-27, eight platforms): 0.27 s median cold
start, the fastest in the set, and **37 % success on bursts**, the lowest.

**Verdict.** Refused, and not on Daytona's merits. There is no part of the runtime that can move:

1. Acting needs the person's Chrome, their cookies, and an origin the extension hardcodes.
   `docs/research/instinct.md` (on PR #129 until it merges) calls the cloud agent's lack of those *"our structural advantage"*.
2. ADR-0025's whole unlock is *"the screen is where the affordances already are"*. A Linux
   desktop in a container has none of them; a macOS VM would still not be the person's Mac.
3. The one piece that could physically move — the worker's own credential-free headless
   Chromium for research fetches — would send page text through a vendor before it is
   `Datamarked`, which `SECURITY_AND_PRIVACY.md` forbids.
4. Sleep is the real problem, and the in-bounds answer is the tray app
   (`docs/todo/01-menu-bar-app.md`) keeping the Mac awake, not a runtime elsewhere.

If the product ever reopens cloud execution, it gets the ADR `docs/todo/README.md` asks for, and
Daytona is a weak pick for it: closed source, Docker default, egress behind a $500 top-up, the
worst measured burst reliability, macOS alpha only.

## 4. The field: message hosting

**iMessage APIs.** Every row except the last two delivers from the vendor's own Macs with real
Apple IDs, which is the property ADR-0021 refused at *"$39 to $1000 a month"*. The range holds.

| Vendor | Price | Setup | Note |
|---|---|---|---|
| Sendblue | ~$100/line AI Agent plan, inbound only; ~$1,000/line + ~$2,000 setup on the standard plan, annual | none | market leader; CRM integrations; RCS/SMS fallback |
| Blooio | $39/mo shared (~5 new contacts a day); $289/mo dedicated | none | RCS from day one; hosted MCP server; month to month |
| Linq | ~$167/mo, ~$500 setup, sales contact only, annual | — | SOC 2; CRM-first |
| Tuco AI | $149 to $299/mo + $335 setup | a dedicated Mac mini of theirs | rebuilds the Apple ID if flagged |
| Photon | $0 / $25 / $250 per line | none | agent-first SDK; typing and reactions in webhooks |
| LoopMessage | per message, no monthly | your Mac, a DUNS number, a warm-up period | fine under ~10 messages a day |
| BlueBubbles | free, open source | your Mac | the local bridge, deferred not refused |

**Multi-channel frameworks.** Vercel Chat SDK (MIT; Slack, Teams, Google Chat, Discord,
Telegram, WhatsApp, GitHub, Linear; you host the webhook; iMessage only through Photon's adapter).
Vercel Eve channels (Slack, Discord, Teams, web; deploys to Vercel). Spectrum, above. A bare
`fetch` against the Bot API, which is what this repository has. **Signal via `signal-cli`** stays
what ADR-0021 called it — *"the most likely thing to overturn this ADR"* — because it is the only
option in this section that is end-to-end encrypted.

## 5. The field: agent runtime hosting

| Platform | Isolation | Cold start, third-party | Price | Session cap | Egress control | Self-host |
|---|---|---|---|---|---|---|
| Daytona | Docker; Kata/Sysbox opt-in | 0.27 s median; 37 % burst success | $0.0504/vCPU-h + $0.0162/GiB-h | none | Tier 3 and up | BYOC on Kubernetes, invite-only |
| E2B | Firecracker | 1.61 s | same rates; Hobby free ($100 credit, 1 h sessions); Pro $150/mo (24 h) | 1 h / 24 h | header injection, beta | Apache-2.0 infra, Terraform and Nomad |
| Vercel Sandbox | Firecracker | 0.67 s | $0.128/active-vCPU-h + $0.0212/GB-h | 45 min Hobby / 24 h Pro | firewall and credential brokering on every plan | AWS BYOC, beta |
| Modal | gVisor | 0.88 s | $0.071/vCPU-h + $0.024/GB-h | 24 h | allowlists, beta | no |
| Cloudflare Sandbox | containers on Workers | 5.06 s | $0.072 active + $0.009/GB-h; Browser Run $0.09/h | sleeps at 10 min idle | programmable egress handlers | no |
| Runloop / Fly Sprites / Northflank | microVM / Firecracker / Kata | — | $0.108 / $0.07 / $0.0167 per CPU-h | suspend / persistent / either | yes | VPC / no / BYOC |
| Claude Managed Agents | Anthropic cloud, or self-hosted on Cloudflare, Daytona, Modal, Vercel, custom | — | tokens + $0.08 per session-hour | long-running | domain allow and deny on web tools | the sandbox yes, the harness no |

Managed Agents is stateful by design and **not eligible for Zero Data Retention**. For a product
whose default is no retention of ours, that line alone settles it.

**Cloud browsers**, the closer analogue to what the worker actually does: Browserbase ($20/mo for
100 h, $99/mo for 500 h, 6 h session cap), Steel (Apache-2.0, self-hostable, sub-second), Hyperbrowser
(stealth, plus sandboxes), Kernel (unikernel, cheapest per run), Anchor (SSO and VPN targets, ~8 s
starts). All share one defect for us: the browser is not the person's.

**macOS specifically.** Daytona's alpha; Cua/Lume and Tart for local VMs on Apple silicon;
MacStadium Orchard and EC2 Mac (24 h minimum) for fleets; GhostVM, sandvault and clodpod for
isolating an agent on one Mac. None is signed in as the person without holding the person's
credentials, and ADR-0025 §3 has no keychain.

## 6. What would have to be true to change §0

Each of these is already a **Revisit when** somewhere; this section only points.

1. *"Runs need to survive sleep, which means leaving local execution, which is a product decision"*
   — ADR-0001. That ADR comes first, and it reverses ADR-0025's premise as well.
2. *"The local iMessage bridge's read path becomes reliable"* — ADR-0021. Then the local bridge is
   the default and Telegram the fallback. `imessage-kit` is the reference read path; its
   `osascript` send is not.
3. *"`signal-cli` grows an inline-keyboard equivalent"* — ADR-0021.
4. A sixth token column in the schema — `tests/architecture.test.ts` refuses it until an ADR
   names what it holds.

## 7. Sources, read 2026-09-01

- **Photon.** photon.codes · photon.codes/pricing · photon.codes/docs/spectrum-ts/getting-started ·
  photon.codes/docs/spectrum-ts/providers/imessage · photon.codes/docs/spectrum-ts/providers/telegram ·
  photon.codes/docs/llms.txt · github.com/photon-hq/spectrum-ts · github.com/photon-hq/imessage-kit ·
  github.com/NousResearch/hermes-agent/issues/42454 · hackernoon.com, *Introducing Spectrum*.
- **iMessage field.** tuco.ai/blog/imessage-api-pricing-comparison-2026 *(vendor-authored)* ·
  sendblue.com/compare *(vendor-authored)* · blooio.com/blog/best-imessage-api-2026
  *(vendor-authored)* · photon.codes/blog/photon-vs-sendblue *(vendor-authored)*.
- **Daytona.** daytona.io/pricing · daytona.io/docs/en/sandboxes · /limits · /network-limits ·
  /computer-use · /bring-your-own-compute · /guides/claude/claude-managed-agents ·
  daytona.io/dotfiles/updates/daytona-is-going-closed-source · github.com/daytonaio/daytona.
- **Runtime field.** marktechpost.com, *Best Agent Sandboxes in 2026* (2026-08-27) ·
  northflank.com, Daytona alternatives *(vendor-authored)* · vercel.com/docs/sandbox/pricing ·
  E2B pricing coverage (morphllm.com, beam.cloud) · developers.cloudflare.com/browser-run/pricing ·
  platform.claude.com/docs/en/managed-agents/overview and /self-hosted-sandboxes.
- **Browsers and macOS.** pkgpulse.com Browserbase/Hyperbrowser/Steel guide ·
  browser-use.com/benchmarks/browsers · cua.ai/docs macOS sandbox · MacStadium Orchard and Tart ·
  github.com/webcoyote/sandvault and clodpod.
