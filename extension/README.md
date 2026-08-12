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

Only origins the person approved, granted through `optional_host_permissions`
at approval time and revocable in Chrome's own UI.

It does **not** request `tabs`, `webNavigation` or `history`. Without `tabs`,
the extension is *structurally incapable* of learning that the person visited
anything else — Chrome will not hand over the URL, the title, or the tab. The
constraint is enforced by the browser, not by our code being correct. See
[ADR-0002](../docs/adr/0002-observation-capture.md).

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
  refusing `tabs` was for. **The agent can never learn that any other tab
  exists**, and the cost is that it cannot continue in a tab you were already
  reading: it opens its own and navigates there itself.
- **No `Runtime` domain, ever.** Propositum never runs a line of its own
  JavaScript inside a page you are signed into. Clicks are synthesised at
  coordinates, which costs robustness on purpose — an occluded element fails
  loudly instead of being clicked through an overlay the site put there.
- **Three ways to stop it, none of which need the app.** Chrome's own
  attachment bar has a Cancel; the tab carries a *"Propositum is working here —
  Stop"* chip; the side panel has the same Stop. All three detach first and
  tell the app afterwards, so stopping works with the app closed.

`tests/extension-cdp.test.ts` is the enforcement: the extension has no build
step, so the file under review is the file Chrome runs, and a grep over it is a
real guard rather than a proxy for one.

## What it gives up

`transitionType` — "typed it" versus "followed a link" versus "submitted a
form" — is the most semantically loaded signal available, and it lives behind
`webNavigation`, which costs the *"Read your browsing history"* install
warning. We take `document.referrer` and Navigation Timing as partial
substitutes. Revisit only if H1 scores badly and ablation points here.

## The service worker dies constantly

MV3 terminates it aggressively. Nothing is held in a module variable; state
lives in `chrome.storage.session` and a `chrome.alarms` heartbeat wakes the
worker to flush.

A missed heartbeat is how the app detects a gap — **the gap is inferred from
silence, never reported by the dead worker**. That is why `captureGap` is a
first-class event with `service_worker_terminated` as one of its reasons.

## Setting it up for real work

1. `npm run dev` and `npm run worker` in the repo. The app serves on **port
   3117**, which `manifest.json` and `service-worker.js` both hardcode — a test
   asserts the two agree, because when they drifted capture was silently off and
   the badge blamed Local Network Access.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
3. Copy the extension **ID** Chrome shows, and put it in `.env`:
   ```
   PROPOSITUM_EXTENSION_ID=<the id>
   ```
   Restart `npm run dev`. Without this the app rejects every request with
   `bad-origin` — the response says so explicitly rather than failing silently.
4. In the app, create a project, paste in your document, and approve the sources
   you want watched.
5. Press **Start session**. The extension picks up the session and its token
   from `GET /api/session/current` on its next heartbeat.
6. **Open the side panel** (click the Propositum toolbar icon) and press
   **Allow** next to each approved source. Chrome shows its own permission
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
