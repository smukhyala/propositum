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

It does **not** request `tabs`, `webNavigation`, `history`, or `debugger`.
Without `tabs`, the extension is *structurally incapable* of learning that the
person visited anything else — Chrome will not hand over the URL, the title, or
the tab. The constraint is enforced by the browser, not by our code being
correct. See [ADR-0002](../docs/adr/0002-observation-capture.md).

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

## Before a real install

`manifest.json` has no pinned `key`. Add one, or the extension id changes if the
repo moves and the `Origin` check on the loopback transport starts rejecting our
own events.
