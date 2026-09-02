# The Propositum extension

Loaded unpacked, from this directory.

```
chrome://extensions → Developer mode → Load unpacked → select extension/
```

## Why plain JavaScript with no build step

The extension holds the privacy guarantee. Adding a bundler between the source
and what Chrome executes would mean the thing under review is not the thing
running — an unhelpful property for exactly this component.

Shared logic that benefits from types lives in `src/capture/` and is tested
there; this directory is the thin Chrome-facing shell.

## What it can see

~~Only origins the person approved, granted through `optional_host_permissions`
at approval time and revocable in Chrome's own UI.~~

~~It does **not** request `tabs`, `webNavigation` or `history`. Without `tabs`,
the extension is *structurally incapable* of learning that the person visited
anything else — Chrome will not hand over the URL, the title, or the tab. The
constraint is enforced by the browser, not by our code being correct.~~

**Both paragraphs were false and are corrected here, 2026-08-18.** They are the
last place in the repository still saying it; the same claim was struck in
`docs/SECURITY_AND_PRIVACY.md`, `docs/VISION.md`, `docs/adr/0010-acting-in-the-browser.md`
and `extension/manifest.json` on 2026-08-17.

**What it actually sees.** Every `https` page, as metadata — a cleaned URL, the
title, dwell, scroll, how the page was left, and a tab group title if the person
named one. `optional_host_permissions` is gone: since
[ADR-0008](../docs/adr/0008-ambient-detection.md) the manifest holds
`host_permissions: ["https://*/*"]`, granted at install rather than requested at
approval. Approving a source is what starts a *session* and unlocks page text;
it is not what lets the extension see the page exists.

**And the structural claim is not true either.** `chrome.tabs.query()` needs no
permission — the `tabs` permission gates four properties (`url`, `pendingUrl`,
`title`, `favIconUrl`), and *host* permissions restore them, which the manifest
now holds for every `https` site. So the extension **could** enumerate every open
tab. It does not, and `tests/extension-permissions.test.ts` fails if any source
starts to. That is a test rather than a refusal, which is weaker, and the
weakness is the point of saying so. See
[ADR-0002](../docs/adr/0002-observation-capture.md) for the original argument and
ADR-0008 for the commit that ended it without noticing.

## What it can do — and this reverses the sentence above it

It **does** request `debugger`, which ADR-0002 explicitly refused on the
grounds that it *"would make every constraint below advisory"*.
[ADR-0010](../docs/adr/0010-acting-in-the-browser.md) grants it anyway and
states the price in its own opening paragraph: it is the first decision in the
series whose net effect on safety is negative.

Three things carry the weight now:

- **The tab is one Propositum opened.** `chrome.debugger.attach` needs a tab
  id, and without `tabs` the only id available is the one
  `chrome.tabs.create` returned. `chrome.debugger.getTargets` is never called —
  it would hand back the URL and title of every open tab, which is exactly what
  refusing `tabs` was for. ~~**The agent can never learn that any other tab
  exists**~~ **— narrowed 2026-08-18.** The *acting agent* still cannot: it
  attaches only to an id `chrome.tabs.create` returned, and `getTargets` is
  never called. What is no longer true is the stronger reading, that no part of
  the extension could find out — see *What it can see* above. The cost is
  unchanged: it cannot continue in a tab you were already reading, so it opens
  its own and navigates there itself.
- **No `Runtime` domain, ever.** Propositum never runs a line of its own
  JavaScript inside a page you are signed into. Clicks are synthesised at
  coordinates, which costs robustness on purpose — an occluded element fails
  loudly instead of being clicked through an overlay the site put there.
- **Three ways to stop it, none of which need the app.** Chrome's own
  attachment bar has a Cancel; the tab carries a *"Propositum is working here —
  Stop"* chip; the side panel has the same Stop. All three detach first and
  tell the app afterwards, so stopping works with the app closed.

  **All three are true of this extension and 2026-08-26 decided they will stop
  being the whole story.** [ADR-0025](../docs/adr/0025-computer-use-beyond-the-browser.md)
  takes Propositum out of the browser, and none of these three stops a
  synthesised keystroke going to a native application: Chrome's Cancel covers a
  debugger attachment that is no longer how it works, and the chip and the panel
  both live in a tab there may not be. The replacement is a global hotkey and a
  menu-bar item handled in the signed Tauri process, so it works when the app is
  wedged — verified by `kill -STOP` on the Node processes and then pressing it.

  **The thing being lost is worth naming.** ADR-0010 leaned on Chrome's infobar
  *precisely because it was not ours to break* — it cannot be suppressed, cannot
  be styled, and does not depend on our code being correct. Its replacement is
  ours, and a kill switch you wrote yourself is a kill switch that can have a bug
  in it. Not built as this is written.

`tests/extension-cdp.test.ts` is the enforcement: the extension has no build
step, so the file under review is the file Chrome runs, and a grep over it is a
real guard rather than a proxy for one.

## What it gives up

`transitionType` — "typed it" versus "followed a link" versus "submitted a
form" — is the most semantically loaded signal available, and it lives behind
`webNavigation`. ~~which costs the *"Read your browsing history"* install
warning.~~ **That reason expired on 2026-08-11 and this sentence outlived it by
a week.** Chrome's permission-message rules let a broad host permission *absorb*
the warnings for `tabs`, `webNavigation`, `topSites` and `favicon`, so once
ADR-0008 took `https://*/*` the extra warning stopped being the cost — and
because Chrome compares rendered messages to decide whether an update needs
re-approval, adding it would not even re-prompt.

So the reason not to take it is now a capability decision and has to stand as
one: it returns navigation for every tab, not only the ones being observed, and
nothing in the detector needs that. `document.referrer` and Navigation Timing
stay the partial substitutes. Revisit only if H1 scores badly and ablation
points here.

## The service worker dies constantly

MV3 terminates it aggressively. Nothing is held in a module variable; state
lives in `chrome.storage.session` and a `chrome.alarms` heartbeat wakes the
worker to flush.

A missed heartbeat is how the app detects a gap — **the gap is inferred from
silence, never reported by the dead worker**. That is why `captureGap` is a
first-class event with `service_worker_terminated` as one of its reasons.

## Setting it up for real work

1. ~~`npm run dev` and `npm run worker` in the repo.~~ **One command since
   2026-08-26** — `npm run dev` spawns the app and the worker as siblings
   ([ADR-0001](../docs/adr/0001-worker-runtime.md), amended). `npm run worker`
   still starts one on its own and is unchanged. The app serves on **port
   3117**, which `manifest.json` and `service-worker.js` both hardcode — a test
   asserts the two agree, because when they drifted capture was silently off and
   the badge blamed Local Network Access.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
3. ~~Copy the extension **ID** Chrome shows, and put it in `.env`:~~
   ~~```~~
   ~~PROPOSITUM_EXTENSION_ID=<the id>~~
   ~~```~~
   ~~Restart `npm run dev`.~~ **Struck 2026-08-26.** Open
   [`/first-run`](http://127.0.0.1:3117/first-run) instead. The extension knocks on
   its own heartbeat, the page says *"Something just knocked."* and shows the id
   verbatim so you can compare it against `chrome://extensions`, and one click
   pairs it. No file to edit and **no restart**:
   `src/server/extension-pairing.ts` writes a row, and `resolveExtensionOrigin`
   reads it on the next request. A knock lasts five minutes — the heartbeat
   fires every thirty seconds, so anything that has stopped knocking is gone,
   and pairing with something no longer there would be a decision nobody can
   check.

   Two things about that page worth knowing before you trust it. **`.env` still
   wins** — a clone that already sets `PROPOSITUM_EXTENSION_ID` behaves exactly
   as it did before the page existed, and a pinned id is never quietly
   overridden by a click. And **pairing is not authentication**: anything on
   this machine can claim to be an extension, and a forged `Origin` was always
   possible from a non-browser client. What changed is only *where* the person
   expresses the decision.

   Unpaired, the app still rejects every request with `bad-origin` — the
   response says so explicitly rather than failing silently. That hint used to
   be the only place it was said, buried in a JSON body nobody reads, which is
   what `/first-run` exists to stop.
4. ~~In the app, create a project, paste in your document, and approve the
   sources you want watched.~~ **Struck 2026-08-26 — the first clause describes
   a flow that was deleted.** Nothing in the product creates a project any more:
   `createProject` is private and reached only by accepting an offer, on the
   owner's instruction that *"the user shouldn't have to create it."* What is
   still true is the rest — paste in your document and approve the sources you
   want watched, both on the project screen once a project exists.
5. Press **Start session**. The extension picks up the session and its token
   from `GET /api/session/current` on its next heartbeat.
6. **Open the side panel** (click the Propositum toolbar icon) and press
   **Allow** next to each approved source. `/first-run` names this on its watching card
   and links here; it cannot do it for you, for the reason below. Chrome shows its own permission
   prompt; the grant is Chrome's, visible and revocable in Chrome's own UI, not
   ours.

   This step is not optional and nothing else can do it. A host grant requires a
   user gesture, so it cannot be requested from the service worker — and until
   the grant lands, Chrome refuses to register the content script and **nothing
   on that site is captured**. Earlier versions of this file promised Chrome
   would "prompt the first time it needs one". It never did, and the content
   script was never injected on any page.

If the toolbar icon shows a **!**, the extension cannot reach the app and
**capture is off**. It fails loudly on purpose.

Withdrawing a grant in `chrome://extensions` stops capture for that site
immediately, whether or not Propositum is running — Chrome unregisters the
script itself. The extension also tells the app, so the source shows as
withdrawn rather than sitting there looking live.

## Before a real install

`manifest.json` has no pinned `key`. Add one, or the extension id changes if the
repo moves and the `Origin` check on the loopback transport starts rejecting our
own events.
