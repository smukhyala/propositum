# ADR-0002 — Chrome MV3 extension for observation; Playwright kept separate

**Status:** accepted · 2026-08-06
**Ticket:** [#11](https://github.com/smukhyala/propositum/issues/11)
**Research:** [`docs/research/observation-capture.md`](../research/observation-capture.md)

## Context

Real capture is in scope for slice 0 — a deliberate widening, so inference is tested against
genuinely noisy input rather than hand-authored fixtures that are suspiciously clean.

The vehicle choice is a product decision with heavy technical consequences: an extension in the
person's real Chrome, or a Playwright-controlled window that *is* the work surface.

## Decision

**A Chrome MV3 extension for human observation. The worker's browser stays a separate Playwright
process. They are not consolidated.**

| | |
|---|---|
| **Permissions** | `storage`, `alarms`, `idle`, `scripting`, `sidePanel` — all warning-free — plus `optional_host_permissions` scoped to `ApprovedSource`s |
| **Explicitly NOT** | `tabs`, `webNavigation`, `history`, `debugger` |
| **Transport** | WebSocket from the service worker to `127.0.0.1`, per-session bearer token, `Origin` pinned to the extension id |
| **Worker research** | a separate `chromium.launch()` process, own ephemeral context, no credentials, hard URL allowlist |

## Why — and it is a privacy argument, not a technical one

**Under the extension, the brief's constraints are enforced by Chrome. Under Playwright, they are
enforced by us.**

With `host_permissions` scoped and no `tabs` permission, the extension is **structurally
incapable** of learning that the person visited anything else — Chrome will not hand over the URL,
the title, or the tab. "Approved sources only" becomes a manifest declaration consented to in
Chrome's own UI, revocable in Chrome's own UI, and independent of our code being correct.

A Playwright context has no permission model at all. `context.on('page')` fires for every tab and
popup; `addInitScript()` runs in every frame. "Approved sources only" becomes an `if` statement,
and a regression widens capture to everything — silently, with no user-visible signal.

**Rewind proved this empirically.** Their exclusion controls were sincere, documented, and leaked
anyway — through Mission Control, picture-in-picture, and password managers rendered as extensions.
Those leaks were emergent properties of building exclusions on top of a see-everything vehicle.
That failure mode is not available to a vehicle that is never handed the data.

**The capability advantage motivating the controlled browser does not exist for our signal set.**
Every capability where CDP decisively wins — response bodies, screencast, full DOM snapshots — is
something the brief forbids. On the signals we actually want, CDP is *behind*: it has no passive
input observation at all, so selection, scroll and dwell need the same injected listeners a content
script uses. Meanwhile `chrome.idle` and `windows.onFocusChanged` have no CDP equivalent, and *"the
human left"* is a first-class event for a product about shift changes.

**The market already ran this experiment.** ChatGPT Atlas stops working 2026-08-09; Edge Copilot
Mode retired 2026-05-13; Arc is Chromium-updates-only. OpenAI's stated reason is ours — browsers
require ongoing security maintenance — and their replacement is a Chrome extension plus a desktop
app. Chrome is also actively closing the controlled-browser path: `--load-extension` removed in
137, `--disable-extensions-except` in 139, default-profile debugging blocked in 136, and an
unsuppressible automation banner from 144.

**Consolidation is not worth the coupling.** Sharing infrastructure would save perhaps 200–400
lines, against a worker one `page.click()` away from acting inside the person's authenticated
session.

## Raw signals to semantic events

The interesting half, and the one the research left to this ADR.

**The adapter emits `ObservationEvent`s by deterministic heuristic only. It never summarises,
classifies, or interprets.** `CaptureAdapter` has no method that returns anything but events — if
one appears, observation has started inferring and the layering has collapsed.

| `ObservationKind` | Derived from |
|---|---|
| `visited` | navigation to an approved origin; title and cleaned URL |
| `queried` | search terms parsed from a known query parameter |
| `excerpted` | a deliberate selection or copy |
| `engaged` | dwell time past a threshold plus scroll depth |
| `returnedTo` | a second `visited` for an origin already seen this session |
| `switchedAway` | `windows.onFocusChanged` / `chrome.idle` |
| `documentEdited` | the in-app editor, not the extension |
| `note` | typed by the person |
| `sourceApproved` | a host-permission grant |
| `captureGap` | service worker death, sleep, transport loss, permission revocation |

**`encountered missing information` is not a kind.** The brief lists it as an example
`ObservationEvent`, but it is an *interpretation*, not an observable fact — and putting it in the
capture layer would violate "observation never acts" one layer up, where nobody is watching. It
belongs to inference, as a `SessionClaim`.

**Interpretation happens exactly once**, at the inference boundary, where it can be given
`Evidence` and audited. Not in the adapter.

## Retention

Per `ApprovedSource`: the page title, a cleaned URL, deliberate selections verbatim, and **at most
the first 2,000 characters** of readable article text. Nothing else. Full page text is never stored.

The 2,000 is a product constant published in `docs/SECURITY_AND_PRIVACY.md`, not an adapter knob.
Expensive to revisit — `ObservationEvent`s are append-only, so changing it invalidates every
fixture already captured.

**Extraction hygiene is a real hazard, not a detail.** `innerText` excludes only `display:none` and
`visibility:hidden`. `opacity:0`, zero-size fonts, white-on-white and off-screen text all survive,
and extraction from a *detached* container silently degrades to `textContent`, which filters
nothing. The extraction contract must be tested against a hostile fixture.

## Trust boundary and forgery

**CORS does not protect the loopback endpoint.** Per the Fetch spec, `POST` with
`Content-Type: text/plain` is fully CORS-safelisted, so a forged event from a hostile page is
**delivered and executed** — only the response is withheld, and fire-and-forget forgery needs no
response.

Therefore the transport requires **all** of: `application/json`, a custom header, an `Origin` check
pinned to the extension id, and a per-session bearer token.

**Chrome extensions are exempt from Local Network Access** — verbatim from Google's LNA Adoption
Guide: *"We do not currently have plans to apply LNA restrictions to extensions."* That sentence
lives in an unversioned Google Doc and says "currently", so the extension performs a **startup
self-check that fails loudly** rather than assuming it.

Everything downstream of transport — what page-derived text may influence — belongs to
[#18](https://github.com/smukhyala/propositum/issues/18).

## What we give up

**`transitionType`.** `webNavigation.onCommitted` is the only source of "typed it" versus "followed
a link" versus "submitted a form" — the most semantically loaded raw signal available — and it
costs the *"Read your browsing history"* install warning. We take `document.referrer` and the
Navigation Timing `type` as partial substitutes. **Revisit if H1 scores poorly and ablation
implicates navigation intent.**

**The 30-second service worker.** Every design must assume the extension dies constantly. This is
where capture bugs will live, and it is why `captureGap` is a first-class event rather than an
inferred absence.

**Developer-mode friction.** A startup bubble Google refuses to make suppressible, and an extension
id that changes if the repo moves — fixed by pinning `key` in the manifest.

## Consequences

- `CaptureAdapter` has two implementations behind one port: `fixture` and `chrome-extension`. The
  eval harness drives either. A `controlled-browser` implementation stays possible and is not built.
- Gaps are events, never absences. A hole indistinguishable from inactivity would make inference
  confidently report a lull that never happened — corrupting H1 in the way hardest to notice.
- The messy adversarial fixture is still required. Real capture is noisy but not *reproducibly*
  noisy, and regression testing needs determinism.
- Playwright remains the right tool for the worker's own browsing. Keeping the door open costs
  nothing; walking through it for slice 0 would cost the privacy argument above.

## Revisit when

- H1 scores poorly and ablation points at navigation intent — that is when `transitionType` and its
  install warning get re-weighed.
- A second browser matters. Nothing here is Chrome-specific by preference; it is Chrome-specific
  because that is where the permission model we are relying on exists.
