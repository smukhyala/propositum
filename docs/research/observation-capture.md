# Observation capture: Chrome MV3 extension vs. Playwright/CDP-controlled browser

_Research for [#5](https://github.com/smukhyala/propositum/issues/5), feeding the decision in [#11](https://github.com/smukhyala/propositum/issues/11)._
_Researched 2026-08-06. Chrome stable is **M151** (released 2025-07-28); M152 due 2026-08-25. Version-sensitive claims are dated; where docs are silent this note says so rather than guessing._

---

**In one paragraph.** Build the **Chrome MV3 extension**, scoped by host permissions to approved sources
only, and keep the worker's Playwright browser entirely separate. The decisive fact is that host
permissions alone let an extension read a tab's URL and title *for matching tabs only*
([§3.2](#32-the-finding-that-decides-the-product-question)) — so "approved tabs only" becomes an invariant
Chrome enforces rather than a promise our code makes. The usual argument for the controlled browser
collapses on inspection: **CDP has no passive input observation at all**
([§4.1](#41-the-finding-that-reframes-the-whole-comparison)), so selection, scroll and dwell need the same
injected DOM listeners either way, while `chrome.idle` and `windows.onFocusChanged` have no CDP
equivalent. Everything CDP uniquely offers is something this brief forbids. Externally, every full-browser
bet is now dead or dying ([§7.4](#74-agentic-browsers--every-full-browser-bet-is-dead-or-dying)), and
Rewind's own docs record its app-level exclusion controls leaking in production
([§7.2](#72-rewind--limitless--and-the-specific-way-its-scoping-controls-leaked)).

---

## 1. The question

Propositum needs to observe a real human work session and turn it into `ObservationEvent`s carrying enough
signal that inference can reconstruct *what the person was trying to do*. Two vehicles are on the table:

- **A** — a Chrome Manifest V3 extension running inside the user's real, everyday browser.
- **B** — a Playwright/CDP-controlled Chromium window that *is* the work surface for the session.

The founding brief's hard constraints bound the answer before any technical comparison starts:
no full-screen recording, no keystroke logging, no automatic access to every application,
explicit session start/stop, **approved tabs only**.

So the question is not "which can see more". The vehicle that sees more is, on this brief, partly
disqualified *by* that fact. The real question is:

> **Which vehicle makes the constraints enforceable by something other than our own good intentions,
> while still producing signal rich enough for inference to work?**

That reframing turns out to decide it. See [§8](#8-recommendation).

---

## 2. Capability matrix

`✅` available · `⚠️` available with caveats · `❌` not available · `🚫` available but **excluded by the brief**

| Signal | MV3 extension — mechanism (permission) | Playwright / CDP — mechanism | Verdict |
|---|---|---|---|
| Tab URL + title | ✅ `tabs.onUpdated` / `tabs.query` — **host permission for that site is sufficient**; no `tabs` permission needed | ✅ `page.url()`, `page.title()`, `page.on('framenavigated')` | Parity |
| Full-page navigation | ✅ `tabs.onUpdated`, or `webNavigation.onCommitted` (⚠️ scary permission) | ✅ `Page.frameNavigated` / `page.on('framenavigated')` | Parity |
| SPA navigation (`pushState`) | ⚠️ `webNavigation.onHistoryStateUpdated` (scary permission), **or** content-script patching of `history.pushState` / Navigation API | ✅ Same CDP event, or the same in-page listener via `addInitScript` | Parity, both awkward |
| Navigation *intent* (typed vs. link vs. bookmark vs. form submit) | ⚠️ `webNavigation.onCommitted.transitionType` — **only** source, and it costs "Read your browsing history" | ❌ Not in CDP's `Page` domain; `transitionType` is a browser-history concept, not a protocol one | **Extension-only**, at a permissions cost |
| Referrer (weak substitute for the above) | ✅ `document.referrer` in content script (host permission) | ✅ Same, via `addInitScript` | Parity |
| Search query | ✅ Parse from URL (`?q=`) — no extra permission beyond host access to the search engine | ✅ Same | Parity |
| Dwell time on a page | ✅ Content script `visibilitychange` + `pagehide` timestamps, corroborated by `tabs.onActivated` / `windows.onFocusChanged` | ✅ Same via `addInitScript`; `context.on('page')` for tab churn | Parity |
| Browser-window focus lost to another app | ✅ `windows.onFocusChanged` → `WINDOW_ID_NONE` | ⚠️ No direct equivalent; `page` blur is not the same thing | **Extension advantage** |
| User idle / machine locked | ✅ `chrome.idle` — OS-level, three states (`active`/`idle`/`locked`), no install warning | ❌ No equivalent. Would need an OS-level side channel | **Extension advantage** |
| Text selection | ✅ Content script `document.getSelection()` on `selectionchange`/`mouseup`; **or** `contextMenus.onClicked.selectionText` for an explicit-gesture-only variant | ✅ `addInitScript` + same DOM listener | Parity |
| Scroll depth | ✅ Content script scroll / `IntersectionObserver` | ✅ Same via `addInitScript` | Parity |
| Extracted page text | ✅ Content script `innerText` or Mozilla Readability (host permission) | ✅ Same, plus `DOMSnapshot.captureSnapshot` and the accessibility tree | CDP richer, but see note |
| Copy events | ✅ Content script `copy` listener (no `clipboardRead` needed if you read the selection, not the clipboard) | ✅ Same | Parity |
| Console errors / JS exceptions | ⚠️ Content script listener (isolated world sees `window.onerror` only partially) | ✅ `Runtime.exceptionThrown`, `Log.entryAdded` — cleanly | CDP advantage, low product value |
| Full request/response **bodies** | ❌ MV3 removed blocking `webRequest`; `declarativeNetRequest` cannot read bodies | 🚫 `Network.getResponseBody` — trivially available | CDP "advantage" that is a **liability** |
| Screenshots / video of the tab | 🚫 `tabs.captureVisibleTab` (needs `<all_urls>` or `activeTab`) | 🚫 `page.screenshot()`, `Page.startScreencast` | Excluded by brief |
| Keystrokes | 🚫 Content-script `keydown` is technically trivial | 🚫 See note below on CDP `Input` | Excluded by brief |
| Whole-screen / other apps | ❌ Impossible — extensions are browser-scoped (`desktopCapture` would warn "Capture content of your screen") | ❌ Out of scope for a browser | Excluded by brief |
| `chrome://` pages, Chrome Web Store, other extensions | ❌ Blocked by Chrome | ❌ Also blocked | Parity |
| Full CDP power from inside the real browser | ⚠️ `chrome.debugger` API — see [§3.4](#34-the-chromedebugger-trap) | ✅ Native | Extension path is poisoned |

**Note on "CDP is richer".** Every capability in the matrix where CDP genuinely beats an extension —
response bodies, screencast, DOM snapshots of everything, the full accessibility tree — is a capability
this product has committed **not to use**. The delta between the two vehicles, *restricted to signals
Propositum is allowed to collect*, is close to zero. The one place the extension is meaningfully ahead
(`chrome.idle`, `windows.onFocusChanged`, `transitionType`) is browser/OS-state signal that CDP has no
concept of, because CDP was designed to drive a page, not to watch a person.

---

## 3. Manifest V3 extension: permissions and privacy

### 3.1 The permission set, and what the user actually sees

Chrome's install prompt is generated from permission *messages*, not permission strings, and messages are
coalesced ([Chromium `permissions.md`](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/permissions.md)).
Verbatim warning strings from the [Chrome permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list):

| Manifest entry | Install-time warning | Needed by Propositum? |
|---|---|---|
| `"storage"` | *(none)* | Yes |
| `"alarms"` | *(none)* | Yes — service-worker survival |
| `"idle"` | *(none)* | Yes — away/idle detection |
| `"scripting"` | *(none)* | Yes |
| `"sidePanel"` | *(none)* | Yes — session start/stop UI |
| `"contextMenus"` | *(none listed)* | Optional — explicit-gesture selection capture |
| `"activeTab"` | **none** — explicitly "displays *no warning message* during installation" ([activeTab docs](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)) | Maybe |
| `host_permissions` for approved sites | "Read and change your data on *site*" (Google's own consumer wording: *"Your data on a list of websites"*) | **Yes — the core ask** |
| `"tabs"` | **"Read your browsing history."** | **No — avoid** |
| `"webNavigation"` | **"Read your browsing history."** | **No — avoid** |
| `"history"` | **"Read and change your browsing history on all signed-in devices."** | No |
| `"debugger"` | **"Access the page debugger backend."** + **"Read and change all your data on all websites."** | No |
| `"tabCapture"` / `"pageCapture"` | **"Read and change all your data on all websites."** | No |
| `"desktopCapture"` | **"Capture content of your screen."** | No |
| `"nativeMessaging"` | **"Communicate with cooperating native applications."** | Only if native messaging is chosen as transport |
| `<all_urls>` | **"Read and change all your data on all websites."** | **Never** |

### 3.2 The finding that decides the product question

> **Host permissions alone are enough to read a tab's `url`, `pendingUrl`, `title`, and `favIconUrl` — for matching tabs only.**

From the [`chrome.tabs` reference](https://developer.chrome.com/docs/extensions/reference/api/tabs):
*"Host permissions allow an extension to read and query a matching tab's four sensitive `tabs.Tab` properties."*
And on `onUpdated`: the `url` field *"is ignored if the extension does not have the `"tabs"` permission or host permissions for the page."*

This means the manifest can express **"approved tabs only" as a browser-enforced invariant**, not as a
promise our code makes. An extension with `host_permissions: ["https://docs.google.com/*", ...]` and *no*
`"tabs"` permission is **structurally incapable** of learning that the user visited anything else — not
the URL, not the title, not that the tab exists in any meaningful way. Chrome, not Propositum, is the
enforcement point.

Combined with `optional_host_permissions` + `chrome.permissions.request()` (which *"must be requested
from inside a user gesture, like a button's click handler"*, per the
[permissions API docs](https://developer.chrome.com/docs/extensions/reference/api/permissions)), the
install prompt can be reduced to **zero warnings**, with each approved source granted one at a time
through Chrome's own consent UI. `scripting.registerContentScripts()` then persists that grant
(`persistAcrossSessions` defaults to `true`).

Chrome additionally hands the *user* a runtime kill switch we do not control: the per-extension site
access control ("On click" / "On specific sites" / "On all sites") in `chrome://extensions` and the
extension context menu. Under "On click" the extension behaves as if it only had `activeTab`.

**The cost of that posture**: `webNavigation` is the only source of `transitionType` — the single most
semantically loaded raw signal available (`typed` = deliberate intent, `link` = following a trail,
`form_submit`, `reload`, `keyword`). It costs "Read your browsing history". Partial substitutes with no
permission cost: `document.referrer` and `performance.getEntriesByType('navigation')[0].type`
(`navigate` / `reload` / `back_forward`).

### 3.3 What MV3 broke, and what the service worker lifetime means

MV2 is gone: disabled by default for all users on 2025-03-31, and as of **Chrome 138 (2025-07-24) users
can no longer re-enable it**; the `ExtensionManifestV2Availability` enterprise policy was removed in
Chrome 139 ([MV2 deprecation timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline)).
Remaining MV2 items are removed from the Web Store on **2026-08-31**. There is no MV2 fallback.

What MV3 removed that matters here:

- **Blocking `webRequest`** — gone. `declarativeNetRequest` is declarative and cannot read bodies. For
  Propositum this is *good news*: the most invasive capture path is simply not on the menu, and its
  install warning ("Block content on any page") would have been a product problem anyway.
- **Persistent background pages** — replaced by an ephemeral service worker with **no DOM**. Offscreen
  documents are the documented workaround for DOM work
  ([known issues](https://developer.chrome.com/docs/extensions/develop/migrate/known-issues)).
- **Remotely hosted code** — banned. *"all of your extension's logic must be part of the extension package"*.
  CSP for `extension_pages` allows only `self`, `none`, `wasm-unsafe-eval` for `script-src`/`object-src`/`worker-src`
  (plus localhost sources for unpacked extensions). No `eval`, no `new Function`, no code-string `executeScript`.
- **In-memory state** — *"Any global variables you set will be lost if the service worker shuts down."*
  `setTimeout`/`setInterval` do not survive.

Service worker lifetime, precisely:

- Terminates after **30 seconds of inactivity**; receiving an event or calling an extension API resets the timer
  ([lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
- The old "5 minutes total" cap was relaxed in **Chrome 110** — the 5-minute limit now applies only to a
  *single* request/event ([longer ESW lifetimes](https://developer.chrome.com/blog/longer-esw-lifetimes)).
- Keep-alive contributors: extension API calls (110+), long-lived ports (114+), WebSocket message
  transmission (**116+**), native messaging via `connectNative()` (105+), messages from offscreen documents (109+).
- `chrome.alarms` minimum period dropped from 60s to **30s in Chrome 120**, specifically to match the
  service-worker idle timeout.

**Design consequences.** The extension must be written as if it dies every 30 seconds, because it does.
Event buffering belongs in `chrome.storage.session` (10 MB since Chrome 111; **not exposed to content
scripts** unless `setAccessLevel()` is called) or `chrome.storage.local` (10 MB since Chrome 113, more
with `unlimitedStorage`). A `chrome.alarms` heartbeat at 30s is the flush trigger. A persistent WebSocket
to the local app is *both* the transport and the keep-alive, which is a genuinely nice property — but a
dropped socket must not silently drop a session, so the store-then-flush design is mandatory regardless.

### 3.4 The `chrome.debugger` trap

There is a tempting third vehicle: an extension that calls `chrome.debugger.attach()` to get CDP power
inside the user's real browser. It exposes most CDP domains (`Network`, `DOM`, `DOMSnapshot`,
`Accessibility`, `Input`, `Page`, `Runtime`, …), with the caveat that
*"For security reasons, the `chrome.debugger` API does not provide access to all Chrome DevTools Protocol Domains."*

Reject it. Two reasons, both fatal for a consumer product:

1. The install warning is **"Access the page debugger backend."** *plus* **"Read and change all your data on all websites."** — the worst string in the catalogue, and it is not scopeable to approved sites.
2. Chrome shows a **persistent, non-suppressible infobar** while an extension is attached ("… started debugging this browser"). Google has [declined to make it suppressible](https://issues.chromium.org/issues/40419543) precisely because its purpose is to be un-ignorable. A product that asks the user to work all day under a debugger banner is not a product.

### 3.5 Transport to the local app

Three options.

**(a) `fetch()` from the extension service worker to `http://127.0.0.1:PORT`.** This works and is the
simplest. Two facts make it work:

- *"A script executing in an extension service worker or foreground tab can talk to remote servers outside
  of its origin, as long as the extension requests host permissions"* — so with
  `host_permissions: ["http://127.0.0.1:PORT/*"]` the service worker's request is **not subject to CORS**
  ([cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)).
- **Content scripts cannot do this.** *"Content scripts initiate requests on behalf of the web origin that
  the content script has been injected into and therefore content scripts are also subject to the same
  origin policy."* Content scripts must relay through the service worker via `runtime.sendMessage`.

The same doc carries a warning that is directly on point for our threat model:
*"never allow content scripts to specify arbitrary URLs, as malicious pages could exploit this."*

**(b) WebSocket from the service worker.** Same permission story, plus it keeps the worker alive
(Chrome 116+) and gives the local app a push channel back (e.g. "session stopped from the app UI").
This is the better default for a live session.

**(c) Native messaging** (`chrome.runtime.connectNative`). The strongest identity binding — the native
host manifest's `allowed_origins` field lists exactly which extension IDs may connect, and
*"`allowed-origins` values can't contain wildcards."* No web page can reach it. Costs: a
`"nativeMessaging"` permission warning ("Communicate with cooperating native applications"), a JSON
manifest that must be installed at
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json` on macOS, a 1 MB inbound /
64 MiB outbound message cap, and a length-prefixed stdio protocol. It also does not fit a Next.js app
cleanly — the native host is a separate process Chrome launches.

Chromium is blunt that this is not free security:
*"The Native Messaging API is not a secure communication channel and… secure communication… must be
established by the extension developer"* ([Extensions Security FAQ](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/security_faq.md)).

**Recommendation: (b) WebSocket to loopback, with a per-session shared secret** (see [§6.2](#62-forgery-the-loopback-endpoint)).
Native messaging is the escape hatch if loopback ever proves insufficient.

### 3.6 The unpacked / developer-mode install story

For a local-first, single-user product this is the least pleasant part.

- Install is: `chrome://extensions` → toggle **Developer mode** → **Load unpacked** → pick the directory.
- Chrome shows a **"Disable developer mode extensions" bubble on startup**. Google has explicitly refused
  to add a kill switch, because malware would use it ([chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/LHtbj6Up5dU)).
  The documented ways around it are Chrome Dev channel, or an **unlisted Chrome Web Store listing**.
- **The extension ID of an unpacked extension is a hash of its directory path.**
  `GenerateIdForPath()` normalises the path and SHA-256s it ([`components/crx_file/id_util.cc`](https://chromium.googlesource.com/chromium/src.git/+/master/components/crx_file/id_util.cc)).
  Move or rename the repo and the ID changes — breaking native messaging `allowed_origins`, any
  ID-keyed local state, and any origin allowlist. **Pin it with a `key` field in the manifest.**
- The Chrome Web Store's **unlisted** visibility is the clean escape: *"does not create a listing… but does
  allow anyone to install your item if they know its Chrome Web Store URL"*, and *"All visibility settings
  have the same policy requirements and will go through the same review process."*

**Review friction, if we go that route.** *"For most extensions, review is completed within a few days, but
it can take up to a few weeks"* — slower for new developers, new extensions, **dangerous permission
requests**, and significant code changes. Chrome names broad host patterns explicitly:
*"Host permissions patterns like `*://*/*`, `https://*/*`, and `<all_urls>` give extensions extensive
access to the user's web activity"*, and `tabs`, `downloads`, `cookies`, `webRequest` also extend review.
The policy is *"request access to the **narrowest** permissions necessary"*, with no requesting permissions
for future features. Separately, the **Limited Use** policy states *"Collection and use of web browsing
activity is prohibited, except to the extent required for a user-facing feature described prominently in
the Product's Chrome Web Store page and in the Product's user interface."* All of this points the same way
as [§3.2](#32-the-finding-that-decides-the-product-question): the narrow-host-permission posture is not
just kinder to users, it is materially cheaper to ship.

---

## 4. Playwright / CDP: capability, permissions, and privacy

### 4.1 The finding that reframes the whole comparison

> **CDP has no passive input observation. The `Input` domain is dispatch-only.**

An enumeration of the tip-of-tree [`Input` domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/)
finds **13 methods, all client→browser synthesis** (`dispatchKeyEvent`, `dispatchMouseEvent`, `insertText`,
`synthesizeScrollGesture`, …) and **exactly one event: `Input.dragIntercepted`**, which only fires when
`Input.setInterceptDrags` is enabled. Adjacent domains do not help: `EventBreakpoints` and
`DOMDebugger.setEventListenerBreakpoint` *pause* execution rather than stream events;
`DOMDebugger.getEventListeners` returns which listeners are attached, not events that fire.

There is **no CDP event that reports a real human's keystroke, click, scroll, or text selection.**

The proof is Playwright's own codegen recorder — the thing whose entire job is recording a human in a
Playwright window. It is implemented as an **injected script** registering document-level capture-phase
listeners (`packages/injected/src/recorder/recorder.ts`): `click`, `auxclick`, `dblclick`, `contextmenu`,
`dragstart`, `input`, `keydown`, `keyup`, `pointerdown/up`, `mousedown/up/move/leave/enter`, `focus`,
`scroll` — reporting back through `window.__pw_recorder*` bindings, i.e. `exposeBinding` in all but name.
If Playwright's own team must do it that way, so must we.

**Two consequences.**

1. **For every behavioural signal Propositum actually wants** — selection, scroll, dwell, engagement —
   the Playwright vehicle uses *the same technique as a content script*: inject JS, listen to DOM events.
   `context.addInitScript()` + `context.exposeBinding()` is the Playwright spelling of
   `content_scripts` + `chrome.runtime.sendMessage`. There is no capability advantage.
2. **Good news for the risk register:** neither vehicle makes keylogging *ambient*. In both, it requires
   an affirmative, greppable line of our own code (`addEventListener('keydown', …)`). The
   no-keystroke-logging constraint is enforceable by lint and code review in both vehicles — and by
   nothing else in either. Say that plainly in `SECURITY_AND_PRIVACY.md` rather than implying the
   platform prevents it.

### 4.2 What CDP genuinely adds — and why most of it is liability

| CDP capability | Status under the brief |
|---|---|
| `Network.getResponseBody`, `getRequestPostData`, `streamResourceContent`, `webSocketFrameReceived` | Reads every API response the user's authenticated session receives. **Far beyond the brief.** |
| `Network.requestWillBeSentExtraInfo` / `responseReceivedExtraInfo` (experimental) | Cookies and headers an extension cannot see. **Beyond the brief.** |
| `Page.startScreencast` → `Page.screencastFrame`, `Page.captureScreenshot` | **Explicitly excluded** ("no full-screen recording"). |
| `DOMSnapshot.captureSnapshot` — *"the full DOM tree of the root node (including iframes, template contents, and imported documents) in a flattened array"*, with computed styles, paint order, DOM rects | Genuinely useful for text extraction; also captures far more than needed. |
| `Accessibility.getFullAXTree` + live `Accessibility.nodesUpdated` | The one CDP capability with a clean, proportionate use: a semantic tree instead of raw text. |
| `Runtime.evaluate` arbitrary JS, `Runtime.addBinding` | Needed for the injection approach anyway. |
| `Runtime.exceptionThrown`, `Log.entryAdded` | Cleaner than the extension equivalent; low product value. |

Playwright's non-CDP surface covers most of what we'd want without dropping to raw protocol:
`context.on('request'|'response')`, `page.on('framenavigated')`, `context.on('pageLoad')` /
`context.on('pageClose')` (both **since v1.60**), `page.on('console'|'pageerror'|'crash'|'download')`,
`context.on('webError')` (since v1.38).

**Aria snapshots, with versions verified:** `locator.ariaSnapshot()` since **v1.49**; `page.ariaSnapshot()`
since **v1.59**, with `mode: "ai"` returning *"a snapshot optimized for AI consumption: including element
references like `[ref=e2]` and snapshots of `<iframe>`s"*, plus `depth` (v1.59) and `boxes` (v1.60).
`page.ariaSnapshotJSON()` is marked **`since: v1.63`** in `main` and is **not in v1.62.1**, the current
release — do not design against it. The old `page.accessibility` class was **removed** (present at v1.55,
absent from v1.58 onward), not merely deprecated. `_snapshotForAI` exists internally; the supported public
equivalent is `ariaSnapshot({ mode: 'ai' })`.

### 4.3 Can it host a genuine human session? Largely no, and the trend is against it

**Playwright cannot drive the user's real Chrome profile.** Verbatim from
[`launchPersistentContext`](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-persistent-context):

> *"Due to recent Chrome policy changes, automating the default Chrome user profile is not supported.
> Pointing `userDataDir` to Chrome's main 'User Data' directory (the profile used for your regular
> browsing) may result in pages not loading or the browser exiting. Create and use a separate directory
> (for example, an empty folder) as your automation profile instead."*

The root cause is on Chrome's side. From **Chrome 136**, `--remote-debugging-port` and
`--remote-debugging-pipe` *"will no longer be respected if attempting to debug the default Chrome data
directory"* — because *"Since App-Bound Encryption was enabled we've seen an increase in attackers using
Chrome Remote Debugging to extract cookies"*
([Chrome blog](https://developer.chrome.com/blog/remote-debugging-port)). Google's recommendation for
automation is Chrome for Testing.

So the human would work in a **separate, empty profile**: no existing logins, no bookmarks, no history,
no password manager. `launchPersistentContext(userDataDir)` does persist cookies and localStorage across
restarts, so logins survive *after the first sign-in* — but the first sign-in is a real cost, and Google
is widely reported to block sign-in from automation-instrumented browsers ("This browser or app may not
be secure"). **No first-party Playwright or Google doc confirming or scoping that was found — treat it as
unverified but likely.**

**Chrome sync**: playwright.dev is **silent**. Playwright's source is not: `chromiumSwitches.ts` (v1.62.1)
passes `--disable-sync` on every non-Android launch, with the comment *"Prevents the 'three dots' menu
crash in IdentityManager::HasPrimaryAccount for ephemeral contexts."* Stripping it via `ignoreDefaultArgs`
is undocumented and untested.

**The user's own extensions** (1Password, uBlock Origin) cannot be brought along. `--load-extension` was
**removed from Chrome branded builds in Chrome 137**, and `--disable-extensions-except` /
`--extensions-on-chrome-urls` in **Chrome 139** — both because the flags were *"commonly abused to load
malicious and unwanted software into the browser"*. They still work in Chromium, Chrome for Testing, and
ChromeOS builds. Playwright's [Chrome extensions doc](https://playwright.dev/docs/chrome-extensions)
concedes this directly: *"Google Chrome and Microsoft Edge removed the command-line flags needed to
side-load extensions"* → you must use Playwright's bundled Chromium. And the docs cover **only unpacked**
extensions from a filesystem path; installing a real Web Store extension into a Playwright profile is
**undocumented** on playwright.dev and unsupported by CDP's experimental
[`Extensions` domain](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/), which offers
only `loadUnpacked`.

**The automation banner.** Nuanced, and moving the wrong way:

- Playwright ≥ **1.60** no longer passes `--enable-automation` at all (traced through
  `chromiumSwitches.ts` across release tags: unconditional at v1.40/v1.50, conditional at v1.55–v1.59,
  absent at v1.60–v1.62.1). It does pass `--disable-infobars`, whose in-source comment states it
  *"disables Chrome for Testing infobar… The switch is ignored everywhere else, including Chromium/Chrome/Edge."*
- Suppressing the banner is **not a supported feature** — maintainer response on
  [#18872](https://github.com/microsoft/playwright/issues/18872): *"This is out of scope for Playwright."*
- On **Chrome ≥ 144**, the banner is driven by the debugging session itself:
  *"While a debugging session is active, Chrome displays the 'Chrome is being controlled by automated test
  software' banner at the top"*, and *"every time the […] server requests a remote debugging session,
  Chrome will show a dialog to the user and ask for their permission"*
  ([Chrome DevTools MCP blog](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)).
  Chrome's own auto-connect docs are blunt about the exposure: *"your agent has access to all data in your
  browser profile, including open tabs, session storage, local storage, cookies, and other data surfaced
  through JavaScript APIs."*

Chrome is actively hardening *against* the exact posture option B requires. Designing on it is designing
against the platform's direction of travel.

### 4.4 The scoping problem: nothing constrains it but us

This is the decisive privacy difference and it deserves its own heading.

A Playwright context has **no permission model**. `context.on('page')` fires for *"a new Page created in
the BrowserContext… also for popup pages"* — every tab, unconditionally. `context.addInitScript()` runs in
*every* page and *every* child frame, on every navigation. There is no manifest, no install prompt, no
`chrome://extensions` toggle, no per-site grant. "Approved tabs only" would be implemented as an
`if (isApproved(url))` in our own TypeScript.

That is a promise, not a guarantee. A bug, a refactor, or a future contributor deletes the guard and
capture silently widens to everything the human does in that window — with no user-visible change and no
platform signal. Under an extension, the same bug produces **no data at all**, because Chrome never handed
the extension the URL in the first place ([§3.2](#32-the-finding-that-decides-the-product-question)).

Secondary but real: `addInitScript` runs in the page's **main world** by default, so a hostile page can
enumerate and call our `window.*` bindings, or shadow the DOM APIs our listeners depend on. Playwright
namespaces its own as `__pw_*`; CDP's `Page.addScriptToEvaluateOnNewDocument` accepts a `worldName` for
isolated-world injection, but **Playwright's public `addInitScript` does not expose it**. An extension
content script gets isolated-world execution by default. (Chromium is clear that isolated worlds are
*"not a security boundary"* either — see [§6](#6-prompt-injection-and-event-forgery) — but "isolated by
default" beats "main world by default".)

### 4.5 Operational notes

- **Session does not survive the Node process dying.** Playwright launches with `--remote-debugging-pipe`
  (not a port) and refuses a user-supplied port: *"Playwright manages remote debugging connection itself."*
  A pipe lives on the child's fds, so there is no listening socket to reconnect to. What survives is
  on-disk: the `userDataDir` profile, or an exported `storageState()` (*"current cookies, local storage
  snapshot, IndexedDB snapshot and virtual WebAuthn credentials"*). `browser.bind()` (**new in v1.59**)
  lets *other clients* attach, but the docs are **silent** on whether a bound browser outlives its binder.
- **`connectOverCDP` is explicitly second-class:** *"significantly lower fidelity than the Playwright
  protocol connection… you probably want to use `browserType.connect()`"*, and *"Playwright maintains a
  curated list of arguments for launching the browser. If you launch the browser without Playwright and do
  not pass the exact same arguments, some of Playwright functionality may be broken."*
- **Prefer the launch path over `connectOverCDP` on security grounds**: Playwright's own launch opens
  **no listening socket**, whereas `--remote-debugging-port=9222` exposes an unauthenticated local
  endpoint any process on the machine can drive.

### 4.6 The consolidation argument, quantified — and rejected

The ticket asks whether the same infrastructure could serve the worker's constrained research later.
Technically yes; strategically no.

**What is genuinely shared:** a Playwright dependency, a page-text extraction routine, a URL allowlist
helper. Perhaps 200–400 lines. That is the whole saving.

**What is not shared, and is in direct opposition:**

| | Human session | Worker research |
|---|---|---|
| Credentials | Must have the human's real logins | Must have **none** |
| Profile | Persistent, personal | Ephemeral, disposable |
| Mode | Headed, human-driven | Headless, agent-driven |
| Input | Passive observation only | Active navigation |
| Trust | Whatever the human chooses to open | Hard allowlist |
| Failure mode | Missed signal | **Unauthorised action** |

Sharing a browser process between these is a direct violation of *"Observation may never execute actions."*
The worker would be one `page.click()` away from acting inside the human's authenticated session.
Playwright's own isolation story argues for separation: contexts are *"equivalent to incognito-like
profiles… completely isolated"*, but `newContext()` lives on a `Browser` while `launchPersistentContext()`
returns a `BrowserContext`. Creating extra contexts on a persistently-launched browser is
**undocumented** (no source-level prohibition found in `crBrowser.doCreateNewContext`, but playwright.dev
never describes the combination). The unambiguous design is a **separate `chromium.launch()` process** for
the worker.

For the worker's own browsing, note `channel: 'chromium'` opts into the new headless mode — *"more
authentic, reliable, and offers more features"* — versus the default `chromium-headless-shell`, where
Playwright warns to "expect different behavior".

---

## 5. The raw-signal-to-semantic-event problem

This is the part the vehicle choice does *not* solve. Both vehicles emit the same raw stream. The
interesting question from [#11](https://github.com/smukhyala/propositum/issues/11) —
*"'Encountered missing information' is not a browser event — where does it come from?"* — has an answer
that falls directly out of the founding brief's own constraints.

### 5.1 The layering the brief already implies

Two of the standing constraints settle this:

> *Models propose; deterministic code authorizes.*
> *Every inference carries provenance to its events.*

If a model emits `ObservationEvent`s directly, provenance collapses: the event **is** the model's output,
so there is nothing underneath it to point at. Provenance would be circular — the inference cites the
event, and the event is the inference. That is precisely the laundering of a guess into a fact that the
provenance constraint exists to prevent.

Therefore:

> **Models must never mint `ObservationEvent`s.** `ObservationEvent`s are deterministic, near-raw,
> and cheap to verify. Model interpretation belongs one layer up, at session-state inference — which
> the architecture already has as a separate step.

**"Encountered missing information" is not an ObservationEvent. It is an element of inferred session
state**, whose provenance points at a *cluster* of observation events — a refinement sequence of queries
with no selection, a nav chain that terminates without engagement, a repeat return to the same document.
Modelling it as an observation would be a category error, and would also make it untestable: H1 scores the
inferred session state against a human-authored reference, and it can only do that honestly if the
observation layer beneath is not already doing the inferring.

This also gives the eval harness a clean seam: the same recorded raw event stream can be replayed through
different inference prompts and scored, because the events are stable ground truth rather than a previous
model's opinion.

### 5.2 What heuristics can honestly produce

Deterministic, reproducible, exactly attributable — the skeleton:

| Semantic event | Deterministic derivation | Confidence |
|---|---|---|
| `queried` | Search-engine URL + query param extraction | Exact |
| `visited` | Navigation commit + title | Exact |
| `excerpted` | `selectionchange` / `copy` → selected text + DOM anchor | **Highest — an explicit human act** |
| `engaged` | Dwell above threshold **and** scroll depth above threshold, with `visibilityState === 'visible'` | Good |
| `bounced` | Opened, dwell below threshold, no scroll, no selection, never revisited | Good |
| `returnedTo` | Revisit count for a normalised URL within the session | Exact |
| `switchedAway` | `windows.onFocusChanged → WINDOW_ID_NONE`, or `chrome.idle` transition | Exact |
| `refinedQuery` | ≥2 queries to the same engine within a window, sharing tokens | Structural only — **do not label it "stuck"** |

Text selection deserves emphasis. Of every signal available, it is the only one that is an *unambiguous,
deliberate act of the human marking something as important*. Dwell can be a phone call. Scroll can be
skimming. A selection is intent. It should be weighted accordingly, and it is the one signal worth
capturing verbatim.

### 5.3 What heuristics cannot produce, and the two ways to get it

Heuristics cannot produce topic, relatedness, contradiction, or the shape of the human's goal. Two options:

**(a) Periodic model summarisation during the session.** Costs: latency, spend, and — decisively — it
feeds hostile page text into a model **while no human is watching**, during the phase whose entire purpose
is passive observation. It also makes the event stream non-reproducible, which breaks the eval harness's
ability to re-score a fixture.

**(b) A single interpretation pass at session end**, over the deterministic skeleton plus a bounded quote
budget of page text, producing *session state* rather than events.

**(b) is right for slice 0.** It preserves reproducibility (same events in → re-runnable), keeps the
injection surface confined to one clearly-marked step with a human review immediately after (the editable
handoff contract), and matches the shift-change UX, where nothing needs interpreting until the human
leaves. If per-page semantic labels later prove necessary, they can be added as a *derived, re-computable*
projection over stored events — never as events themselves.

### 5.4 Text extraction: when, how much, and what to keep

- **When.** `document_idle` gives a first snapshot; SPA-heavy tools change content without navigating.
  A `MutationObserver` with a settle timer, or re-extraction on `history.pushState`, is needed. This is
  identical work in both vehicles.
- **How.** [Mozilla Readability](https://github.com/mozilla/readability) is the obvious primary tool, and
  its cheap gate `isProbablyReaderable()` (defaults `minScore: 20`, `minContentLength: 140`) is useful for
  a purpose it was not designed for: **distinguishing "an article the human is reading" from "an
  application UI the human is working in."** Note the library's own honesty — it is *"likely to produce
  both false positives and false negatives."* On the non-readerable branch, `innerText` of a scoped
  container plus the visible selection is more proportionate than dumping the DOM.
- **How much.** Full page text is the single most sensitive artifact this product will hold. A defensible
  default: store **selections verbatim** (explicit human act), store a **bounded excerpt** of everything
  else, and store the title and normalised URL. Never store form field values or `<input>` contents.
- **Redaction and normalisation before storage.** Strip credential-bearing URL components (`access_token`,
  `id_token`, `code`, `session`, `sig`, and the fragment), and strip invisible Unicode — tag-block
  (U+E0000–E007F), variation selectors (U+FE00–FE0F), zero-width (U+200B/C/D, U+2060) — per OWASP's 2026
  guidance. Do both in the *source adapter*, not downstream: an unredacted event that reaches the
  append-only ledger cannot be unwritten. Note that `innerText` does **not** filter most hidden text
  ([§6.3](#63-poisoning-the-part-that-cannot-be-engineered-away)), so extraction and sanitisation are two
  separate steps, not one.

### 5.5 The gap problem

The MV3 service worker dies after 30 s idle, and machines sleep. A capture stream therefore has holes.
If a hole is indistinguishable from "the human did nothing", inference will confidently report a lull that
never happened — corrupting H1 in exactly the way that is hardest to notice. **Gaps must be first-class
events**, not absences. See [§9](#9-the-interface-both-vehicles-must-satisfy).

---

## 6. Prompt injection and event forgery

Two distinct threats, often conflated:

- **Forgery** — a hostile page causes a *fake* `ObservationEvent` to enter the store.
- **Poisoning** — a hostile page causes *genuine* events to carry attacker-authored text, which later
  reaches a model that treats it as instruction.

Forgery is largely solvable by construction. Poisoning is not, and must be managed.

### 6.1 Forgery: what the platform gives us for free

**A web page cannot message a Chrome extension by default.** From the
[`externally_connectable` reference](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable):

> *"If the `externally_connectable` key is **not** declared in your extension's manifest, all extensions
> can connect, but no web pages can connect."*

Note the second half. **Other installed extensions can connect by default.** This is the forgery hole most
people miss. They arrive at `runtime.onMessageExternal` / `onConnectExternal`, not `onMessage`, so simply
never registering those listeners closes it — and Chrome's own guidance is that *"An extension should only
register for `runtime.onMessageExternal`, if it is expecting communication from an external website or
extension."* Declare `externally_connectable: { "ids": [], "matches": [] }` explicitly anyway, so the
intent is legible in the manifest rather than implied by an absent listener. (Chrome also warns that once
you declare the key, *"if `"ids": ["*"]` is not specified, then other extensions will lose the ability to
connect"* — which is what we want.)

⚠️ **A footgun the docs do not flag.** The `externally_connectable` page documents no restriction requiring
a second-level domain in `matches`, and current Chromium `externally_connectable.cc` contains **no**
effective-TLD/registry check — patterns are validated only by `URLPattern::Parse`. Whatever historical
restriction existed against top-level wildcards appears to be gone. So `"matches": ["*://*/*"]` is
*accepted*, and would open the extension to messages from every page on the web. Verified against source;
docs silent.

**A page cannot enter the content script's JS context.** *"An isolated world is a private execution
environment that isn't accessible to the page or other extensions"*; *"None of these… can access the
context and variables of the others."* Chromium is careful to say this is **not** a security boundary —
*"Isolated worlds… provide a soft separation… not protection of the main page from extensions"*, and an
extension can trivially escape into the main world — but the escape direction is extension→page, not
page→extension.

**The rule that follows.** The service worker must derive an event's identity from
**browser-attested** `MessageSender` fields, never from the message body. `sender.origin` is documented as
*"useful for identifying if the origin can be trusted if we can't immediately tell from the URL"*;
`sender.tab.url` and `sender.frameId` are likewise set by Chrome. So:

```
onMessage(msg, sender):
  reject unless sender.id === chrome.runtime.id       // not another extension
  reject unless sender.tab && sender.frameId === 0    // not a nested hostile iframe
  source := approvedSourceFor(sender.origin)          // from the BROWSER, not from msg
  reject unless source                                // Chrome shouldn't have injected us here at all
  emit event with { source, trust: 'page-derived' for all msg-supplied strings }
```

Chrome's own security guidance is unusually direct here and should be quoted in the ADR:
*"Assume that messages from a content script might have been crafted by an attacker."*
*"Do not allow content scripts to trigger requests to arbitrary URLs or pass arbitrary arguments to
extension APIs."* *"Always validate that the sender matches a trusted source."*
*"Do not send sensitive data (e.g. secrets from the extension, data from other web origins, browsing
history) to content scripts."* — that last one rules out ever handing the content script the
approved-source list or the transport token.

**CORS does part of the work too.** *"Content scripts initiate requests on behalf of the web origin that
the content script has been injected into and therefore content scripts are also subject to the same
origin policy."* A content script therefore **cannot** POST directly to our loopback endpoint; only the
service worker can (host permissions exempt it from CORS). This forces the relay design, which is also the
design that gives us `sender` validation.

**The equivalent under the controlled browser is weaker.** `exposeBinding` installs a function on
`window` in the page's **main world**, where any script on the page can call it with arbitrary arguments.
Playwright's binding callback does supply `{ browserContext, page, frame }`, giving frame attribution
comparable to `sender` — so the same "trust the runtime, not the payload" rule is implementable. But the
call itself is open to the page, so the adapter must additionally rate-limit and shape-validate, and it
cannot distinguish "our injected listener called this" from "page script called this". Under the
extension, that distinction is free.

### 6.2 Forgery: the loopback endpoint

A local HTTP/WebSocket server on `127.0.0.1` is a target for any page the user visits.

**Local Network Access has shipped, and the timeline matters:**

| Chrome | Date | What landed |
|---|---|---|
| M138 | Jun 2025 | Opt-in flag `chrome://flags#local-network-access-check` |
| **M142** | **2025-10-28** | LNA permission prompt **ships by default** — `fetch()`, subresources, subframe navigation |
| M145 | ~Mar 2026 | Single permission split into `local-network` and `loopback-network` |
| M146 | ~Apr 2026 | Enterprise policies |
| **M147** | ~Jun 2026 | Extended to **WebSockets and WebTransport** |

Per the [WICG spec](https://wicg.github.io/local-network-access/), a local network request is one
*"crossing an address space boundary to a more-private address space: public → local, public → loopback,
local → loopback"*, and loopback includes *"a loopback IP literal (e.g., 127.0.0.1), `localhost`"*. The
prompt reads *"Look for and connect to any device on your local network."* Firefox is shipping an
equivalent; **Safari has given no signal**. Brave shipped its own localhost permission in **v1.54
(2023-06-27)**, motivated by observed abuse: *"a wide range of malicious, user-harming software on the Web
uses access to localhost resources for malicious reasons"* — fingerprinting and vulnerability probing,
citing the eBay port-scanning case. WebRTC is **not yet** gated; main-frame navigations are explicitly out
of scope.

> **✅ Resolved: extensions are exempt from LNA.** The only place this is stated is Google's
> **LNA Adoption Guide** (a Google Doc, last updated **2026-05-18**), verbatim:
> *"We do not currently have plans to apply LNA restrictions to extensions. Currently, extensions that
> have the necessary host permissions are allowed to make local network requests."*
> `developer.chrome.com/blog/local-network-access`, the extension cross-origin-requests doc, and the WICG
> explainer are **all silent** on `chrome-extension://` origins. Cite the adoption guide explicitly and
> note that it is an unversioned Google Doc, not stable documentation — this exemption could change.

**Net effect.** Our extension service worker → `http://127.0.0.1:PORT` works with **no prompt**, given
`host_permissions: ["http://localhost/*"]` (match patterns wildcard all ports by default:
*"`http://localhost/*` Matches any localhost port"*). A hostile website → the same port now hits an LNA
prompt in Chrome 142+ and Firefox — but that is a **user decision, persisted per-origin**, and absent
entirely in Safari and in older Chrome.

**Do not treat LNA as the security boundary.** The spec says so itself (§5.3):
*"The proposal in this document **merely mitigates** attacks against local web services, **it cannot fully
solve them**… vendors should not consider themselves absolved of responsibility, even if all UAs implement
this mitigation."* §5.5 further notes that a page served from a local address can still reach loopback
services in some configurations.

**And CORS never protected the endpoint at all.** Per the
[Fetch spec](https://fetch.spec.whatwg.org/#cors-preflight-fetch), `POST` is a CORS-safelisted method and
`Content-Type` is safelisted for `application/x-www-form-urlencoded`, `multipart/form-data`, and
`text/plain`. So a `POST` with `Content-Type: text/plain` is **not preflighted**: the request is
**delivered and executed** by our server, and only the *response* is withheld from the attacker's JS.
A fire-and-forget forged event needs no response. This is the single most likely way a naive
implementation gets this wrong.

**Defence in depth, all cheap:**

- Bind to `127.0.0.1` only, never `0.0.0.0`.
- **Require `Content-Type: application/json` *and* a custom header** (e.g. `X-Propositum-Session`), and
  reject anything else. Either one forces a CORS preflight we can fail. Do not rely on JSON alone if the
  parser is lenient about content type.
- Reject any request whose `Origin` is not `chrome-extension://<our pinned id>` — and reject any request
  bearing a *web* origin outright. Note this requires the `key` manifest field so the ID is stable
  ([§3.6](#36-the-unpacked--developer-mode-install-story)).
- A **per-session bearer token** minted by the local app and delivered to the extension out of band
  (displayed in the app UI, pasted once into the extension options page, stored in `chrome.storage.local`).
  A page that guesses the port still cannot forge an event.
- **Native messaging is the escape hatch** if any of the above proves insufficient: `allowed_origins`
  names exact extension IDs and *"can't contain wildcards"*, and there is no network surface at all.
  Chromium still warns *"The Native Messaging API is not a secure communication channel."*

### 6.3 Poisoning: the part that cannot be engineered away

Captured page text is attacker-controlled input that later reaches a model whose output shapes a handoff
contract and drives a worker. Everything a hostile page can do to page text, it can do to us:

**Anthropic names our exact fields as attack surfaces.** From the Claude in Chrome post, the vectors they
red-teamed include *"hidden malicious form fields in a webpage's Document Object Model (DOM) invisible to
humans, and other hard-to-catch injections such as **through the URL text and tab title** that only an
agent might see."* Our event schema is URL + title + extracted text + selection. **All of them are named.**

- Rewrite `document.title` at will — so a title read from the DOM is `page-derived`, while a title from
  `tabs.onUpdated` is `browser-attested`. **They are not the same field and must not share a schema slot.**
- Place text that reads as an instruction to whatever downstream system ingests it.
- **Hide instructions from the human but not from extraction — and `innerText` is a much weaker filter
  than people assume.** Per the [HTML spec's `innerText` algorithm](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute),
  only two things are excluded: nodes *"not being rendered"* (`display:none`) and nodes whose
  *"computed value of 'visibility' is not 'visible'"*. **Everything else is included**, specifically:
  `opacity: 0`, `font-size: 0`, `color: transparent` / white-on-white, off-screen absolute positioning,
  `clip-path`, `height:0; overflow:hidden`, and zero-width / tag-block Unicode. `textContent` filters
  **nothing at all**, including `display:none` subtrees and `<template>` contents. The spec also carries a
  trap: invoking `innerText` on an element *"not being rendered"* silently returns `textContent`
  behaviour — so extracting from a detached or hidden container quietly disables even the two filters you
  had. This matches exactly what Brave found in the wild (`opacity: 0` spans, white-on-white, HTML
  comments, faint-blue-on-yellow text recovered by OCR). Readability's `visibilityChecker` is a
  readability heuristic, not an adversarial defence.
- **Strip invisible Unicode at ingest.** OWASP's 2026 mitigation is specific: *"Strip tag-block
  (U+E0000 to E007F), variation-selector (U+FE00 to FE0F), and zero-width (U+200B, U+200C, U+200D, U+2060)
  characters at every ingest and render boundary."*

And this is not theoretical background risk. Google's Common Crawl scan (2–3B pages/month) reports
*"a relative increase of **32%** in the malicious category between November 2025 and February 2026"* —
though their own read is that *"attackers have yet not productionized this research at scale."*

Structural mitigations that do not depend on model behaviour:

1. **Never let `page-derived` text influence a decision.** Under *"deterministic code authorizes"*, the
   policy gate must read only `browser-attested` fields and human-authored contract text. This is the
   real defence; everything else is depth.

   **Every serious first-party defender converged on this same shape**, which is strong evidence it is the
   right one. Chrome's agentic architecture (Chrome security team, 2025-12-08) runs a **User Alignment
   Critic** *"architected to see only metadata about the proposed action and **not any unfiltered
   untrustworthy web content**"*, plus **Agent Origin Sets** that *"architecturally limit the agent to only
   access data from origins that are related to the task at hand"*, with the gating functions themselves
   *"not exposed to untrusted web content."* Brave's Leo alignment checker *"does not directly receive raw
   website content—by firewalling it from untrusted website input, we can reduce (but not eliminate) the
   risk of subversion."* Google DeepMind/ETH's **CaMeL** ([arXiv:2503.18813](https://arxiv.org/abs/2503.18813),
   v2 2025-06-24) is the same idea made formal — *"the first concrete instantiation of the Dual-LLM pattern
   (Willison, 2023)"*, closing the gap that *"while the **control flow** is protected by the Dual LLM
   pattern, the **data flow** can still be manipulated"* by attaching capabilities to every value and
   enforcing policy in *"a custom Python interpreter"*, *"without modifying the LLM itself"*. It solves
   *"**77%** of tasks with provable security (compared to **84%** with an undefended system)"* on AgentDojo.

   **Propositum's version of this is the handoff contract.** If the contract is a typed, enumerated
   structure validated in ordinary TypeScript, and the worker acts only on validated fields rather than on
   free prose derived from page content, we have built the same boundary without any of the machinery.
   If summarised page text flows into the contract *as prose the worker then follows*, we have not.
2. **One interpretation point, after the human leaves, with review immediately after.** Per
   [§5.3](#53-what-heuristics-cannot-produce-and-the-two-ways-to-get-it), the model pass happens at
   session end and its output lands in an *editable* handoff contract the human reviews. That review is
   the highest-value control in the entire design and should be framed as a security control, not just UX.
3. **Envelope every quotation — pick the technique deliberately, and do not mistake it for a boundary.**
   Microsoft's *spotlighting* work ([arXiv:2403.14720](https://arxiv.org/abs/2403.14720), 2024-03-20) names
   three instantiations. **Delimiting** (special tokens around the block) — the one most people reach for —
   is explicitly *not* recommended by its own authors: *"we do not recommend using delimiting in practice,
   but include it here for comparisons."* **Datamarking** interleaves a signifier *throughout* the text
   (e.g. every whitespace becomes `^`: `"In^this^manner^Cosette^traversed^the^labyrinth^of"`), which cannot
   be escaped by guessing a boundary token. **Encoding** (base64/ROT13) is strongest but degrades weaker
   models. Reported: *"spotlighting reduces the attack success rate from greater than 50% to below 2%"* —
   datamarking scoring 3.10% on summarisation and 8.0% on document Q&A with GPT-3.5-Turbo, 1.0% with GPT-4.
   **Recommendation: datamarking as the floor.**

   ⚠️ **These are non-adaptive numbers from 2024, and the caveat is severe.** OWASP's 2026 edition states
   that provenance marking *"reduces attack success in non-adaptive tests only: an attacker who knows the
   marking scheme can mimic it, and StruQ was bypassed under adaptive attack"*, citing Nasr et al. 2025 —
   *"static attack success near zero while adaptive attack success exceeded 90% for most of 12 recent
   defenses."* Willison made the same argument from first principles in 2023: *"An attacker has an
   effectively unlimited set of options for confounding the model with a sequence of tokens that subverts
   the original prompt."* **Use spotlighting as depth, never as the boundary** — the boundary is
   mitigation 1.
4. **Bound the quote budget.** A hard cap on how much extracted text per source reaches a prompt limits
   how much room an attacker has to work in.
5. **Approved sources are the primary control.** Because the extension only sees approved tabs
   ([§3.2](#32-the-finding-that-decides-the-product-question)), the attacker must first get their content
   onto a source the human explicitly approved. That is a much narrower opening than "any page the human
   visits" — and it is a *browser-enforced* narrowing under vehicle A, a *code-enforced* one under
   vehicle B.

### 6.4 Where Propositum sits in the published threat model

**OWASP.** Note there are now two editions in play: the live per-risk web pages still serve
**LLM01:2025**, while the **2026** edition exists as a PDF only (resource page dated 2026-08-03). Use the
2026 wording. Its definition of indirect injection names our case exactly:

> *"The model ingests content from an external source (a web page, a document, an email, a tool response,
> a retrieved RAG passage, an image, an MCP server's output, a database row, or an issue title) that
> contains data which acts as prompt injection. **The user did not supply or see those instructions.**"*

The 2026 edition adds a **trust-tier model** that maps directly onto our pipeline — *untrusted* (public web
pages), *semi-trusted* (*"content the user chose to retrieve but did not author"*), *trusted*. Captured
page text is tier 1 even when the human approved the source; approving a source is not authoring its
content. Its root-cause framing is the one to quote: LLMs *"make no architectural distinction between
'instructions' and 'data' (both are tokens on the same stream), so there is no clean equivalent to
parameterized queries."* NIST makes the same comparison in
[AI 100-2e2025](https://csrc.nist.gov/pubs/ai/100/2/e2025/final): *"data and instructions are not provided
in separate channels to the LLM… (a similar flaw to that which underlies decades-old SQL injection
attacks)."*

Its mitigations map onto decisions already in the brief — *"enforce privilege control and least privilege
access"*, *"require human approval for high-risk actions"*, and *"pass external content through a
structurally separate, provenance-labeled channel so the model can distinguish data from instructions"*,
which is precisely the `trust` field in [§9](#9-the-interface-both-vehicles-must-satisfy). Note that OWASP
attaches its own caveat to that last one (see [§6.3](#63-poisoning-the-part-that-cannot-be-engineered-away)
mitigation 3).

For the agentic layer, OWASP's *Top 10 for Agentic Applications 2026* ranks **ASI01 Agent Goal Hijack**
first. There is no standalone prompt-injection ID in its threat taxonomy — injection is the *technique*
that realises **T6 Intent Breaking & Goal Manipulation**, **T2 Tool Misuse**, and **T1 Memory Poisoning**.
That framing is the right one for Propositum: the risk is not "bad text in the store", it is
**goal hijack of the handoff contract**.

**The lethal trifecta** ([Willison, 2025-06-16](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/))
is the more useful lens, because it explains *why the observation layer is the safe part*. The three legs,
verbatim: **(1)** *"Access to your private data"*, **(2)** *"Exposure to untrusted content—any mechanism by
which text (or images) controlled by a malicious attacker could become available to your LLM"*,
**(3)** *"The ability to externally communicate in a way that could be used to steal your data."*
*"If your agent combines these three features, an attacker can easily trick it into accessing your private
data and sending it to that attacker."* OWASP's 2026 edition cites it by name as a pre-deployment check.

Meta's **Agents Rule of Two** (2025-10-31) is the same shape stated as a hard budget, and is the more
actionable version: *"Agents **must satisfy no more than two** of the following three properties within a
session… [A] can process untrustworthy inputs, [B] has access to sensitive systems or private data,
[C] can change state or communicate externally."* And the consequence, verbatim: *"If an agent requires
all three without starting a new session (i.e., with a fresh context window), then the agent should **not
be permitted to operate autonomously** and at a minimum requires supervision — via human-in-the-loop
approval or another reliable means of validation."* OWASP 2026 adopts this *"as a floor."*

Applied to Propositum's architecture:

| Phase | Private data | Untrusted content | External communication | Trifecta complete? |
|---|---|---|---|---|
| **Observation** | Yes — the session | Yes — page text | **No** — loopback to our own app only | **No** |
| **Session-state inference** | Yes | Yes (stored text) | **No** — output is a local contract | **No** |
| **Human review of the contract** | Yes | Yes | No | **No** — and a human is looking |
| **Worker run** | Yes | Yes (carried forward) | **Yes** — the worker acts | **Yes** |

Two conclusions follow, and both are architectural rather than model-level:

1. **The observation layer must never acquire an outbound channel.** This is already a standing constraint
   (*"Observation may never execute actions"*), but the trifecta explains why it is load-bearing rather
   than merely tidy: it is the leg that keeps the entire capture-and-inference half of the product out of
   the exploitable configuration. It is also the strongest argument against consolidating the observation
   browser with the worker's browser ([§4.6](#46-the-consolidation-argument-quantified--and-rejected)) —
   consolidation would hand the observation phase leg (3).
2. **The human review of the handoff contract is the trifecta boundary — and under the Rule of Two it is
   not optional.** The worker run holds all three properties [A]+[B]+[C] in one session, which is exactly
   the case Meta says *"should not be permitted to operate autonomously"* without human-in-the-loop
   approval. Everything upstream of the review is structurally safe; everything downstream is not. That
   makes the contract review a *security control*, and it means the review UI must show the human what
   page-derived content influenced the plan — not
   just the plan.

Anthropic's numbers ([§7.1](#71-anthropic-claude-in-chrome--the-closest-analogue-and-the-most-useful-published-numbers))
put a floor under how much residual risk to expect downstream of that boundary, and their own conclusion —
*"No browser agent is immune to prompt injection"* — is the right thing to design around.

_See [§7](#7-what-comparable-products-actually-do) for the wider product evidence base._

---

## 7. What comparable products actually do

### 7.1 Anthropic, Claude in Chrome — the closest analogue, and the most useful published numbers

Vehicle: **a Chrome extension**, not a browser. The permission model is **site-level**:
*"Users can grant or revoke Claude's access to specific websites at any time in the Settings"*, plus
confirmation before *"high-risk actions like publishing, purchasing, or sharing personal data"*, plus a
default block on *"websites from certain high-risk categories such as financial services, adult content,
and pirated content"* ([claude.com/blog/claude-for-chrome](https://claude.com/blog/claude-for-chrome)).

The published red-team numbers are the single most useful external data point in this whole document:

| Evaluation | Result |
|---|---|
| 123 test cases, 29 attack scenarios, no mitigations | **23.6% attack success rate** |
| Same, with mitigations | **11.2%** |
| Browser-specific attack subset, with mitigations | **35.7% → 0%** |
| Claude Opus 4.5 + new safeguards, internal adaptive attacker (2025-11-24) | **~1%** |

And Anthropic's own conclusion, which should be quoted verbatim in `SECURITY_AND_PRIVACY.md`:

> *"A 1% attack success rate—while a significant improvement—still represents meaningful risk.
> No browser agent is immune to prompt injection."*
> — [Mitigating the risk of prompt injections in browser use](https://www.anthropic.com/research/prompt-injection-defenses), 2025-11-24

Note what it *reads*: **screenshots, not DOM scraping.** *"Claude takes screenshots of the tabs it's
working in. Whatever is visible in one of those tabs is captured in the screenshots and becomes part of
the conversation."* Its declared permissions include `debugger`, `tabs`, `webNavigation`,
`nativeMessaging`, and `downloads` — very nearly the full scary set, and the Chrome Web Store data
disclosures name PII, personal communications, location, web history, user activity, and website content.
Anthropic's own user guidance is worth quoting in `SECURITY_AND_PRIVACY.md` as a statement of what this
posture costs: *"don't open the extension while viewing sensitive info, and consider using a separate
browser profile."* The listing sits at **2.8★ across ~1.4K ratings on ~13M users** (2026-07-28), which is
weak evidence but not zero evidence about how a maximal-permission extension lands with consumers.

Four lessons transfer.

- **(a)** The company with the strongest incentive and resources to build a browser copilot chose *an
  extension with per-site permissions*, not a controlled browser — the same conclusion this document
  reaches, arrived at independently.
- **(b)** They shipped to **1,000 Max users** in August 2025 and widened gradually. A staged trust posture,
  not a launch.
- **(c)** Their defences are RL-trained injection robustness, classifiers over untrusted context, and human
  red-teaming — **none available to slice 0**. Propositum's residual risk is therefore *higher* than 1%,
  and the mitigation must be structural
  ([§6.3](#63-poisoning-the-part-that-cannot-be-engineered-away)).
- **(d)** Propositum needs far less than Claude in Chrome, because it **only observes**. Claude needs
  `debugger` and screenshots because it acts; we need neither. Our narrower brief buys a genuinely
  narrower permission set — that is the product advantage, and it should be said out loud.

### 7.2 Rewind → Limitless — and the specific way its scoping controls leaked

> ⚠️ **Sourcing warning.** `rewind.ai` is **no longer first-party** — the domain now hosts an unrelated
> AI-tools site that states it *"has no affiliation with the original Rewind AI, Limitless, or Meta — only
> the domain name is the same."* `help.rewind.ai` no longer resolves. Everything below comes from
> Internet Archive captures of the real Rewind site and help centre, or from limitless.ai. **Do not cite
> the live rewind.ai domain as a primary source.**

Rewind was the maximal version of this idea — screen recording plus local OCR of everything on screen,
*"we use native macOS APIs and Optical Character Recognition (OCR) to recognize & index all the words that
appear on your screen"* — with a strong local-first pitch: *"Recording data (including screenshots, video
& audio) is **NEVER** sent off your Mac."* It is precisely the approach Propositum's brief excludes.

**The single most useful document any of these companies published** is Rewind's own help-centre article
*"What are the limitations of excluding apps & private browsing?"*, in which a vendor documents that its
own scoping controls leak:

> *"Excluding private browsing windows is only supported when the system language is set to English and
> for the following browsers: Chrome, Safari, Arc, Firefox, Brave."*
> *"When using features like macOS Mission Control… **all apps visible (including excluded apps) may show
> up in the recording.**"*
> *"Even if you select 1Password as an app to be excluded, **Rewind will still record it if it shows up as
> a Chrome extension** in the browser."*
> *"When playing videos from an incognito browser in **picture-in-picture** mode, Rewind will still record
> the video since it is no longer part of the incognito browser."*

**This is [§4.4](#44-the-scoping-problem-nothing-constrains-it-but-us) demonstrated in production.** Rewind's
exclusions were implemented in application code against a capture surface that saw everything by default.
The exclusions were sincere, documented, and *leaky* — because the leaks were emergent properties of the
platform, not bugs anyone was careless about. Any "approved sources only" guarantee implemented as our own
filter over a see-everything vehicle will fail the same way. Chrome's permission model fails closed
instead: it never hands over the data.

Timeline: launched macOS Nov 2022 → Pendant announced late 2023 → **rebrand to Limitless, Apr 2024**, with
the Mac app entering maintenance mode → **Meta acquisition, Dec 5 2025** → **capture disabled for good on
2025-12-19** (*"The latest update disables all screen and audio capture starting December 19, 2025"*).
Limitless never shipped screen recording at all; the pivot went **from screen capture to a single narrow
signal (audio)**. Note also that they gave up local-only for an attested "Confidential Cloud" — their own
stated reason being that local-only cost them device access, storage, performance, and model quality.
That is a real warning for a local-first product, though Propositum's much smaller data volume makes it
far less binding.

### 7.3 Granola — narrow capture as the product, and it worked

Vehicle: native macOS/Windows desktop app. **Audio only, and they never expanded past it.**
*"Granola runs locally on your device and captures audio directly from your microphone and system audio."*
*"**No bot joins your meeting** — other participants will not see any additional attendee."*
*"Granola doesn't store the audio from meetings — it transcribes in real time."*

Their public changelog contains **no update that ever adds screen capture, screenshots, or browser
monitoring**. Expansion went to user-uploaded files and images, phone calls, and integrations — never
ambient visual capture. Commercially: **$125M Series C at $1.5bn**, SOC 2 Type 2, and an explicit
*"We do not allow third parties (like OpenAI or Anthropic) to use your data to train their AI models."*

Three things to steal:

1. **The absence is the feature.** *"Bots… behave differently across different meeting platforms, and worst
   of all, they're incredibly awkward"* — *"a creepy third party lurking in the corner of every call."*
   The product goal was to feel *"like a notepad, not a recorder."* Propositum's equivalent — no screen
   recording, no keylogging, only tabs you approve — belongs on the surface of the product, not buried in
   a policy page.
2. **Discard the raw signal, keep the derived one.** Audio in, transcript out, audio dropped. The direct
   analogue is [§5.4](#54-text-extraction-when-how-much-and-what-to-keep).
3. **Build transparency affordances rather than only asserting consent.** Granola pushes consent to the
   user (*"You are responsible for obtaining consent from participants"*) but ships an automatic in-meeting
   chat notice and a video watermark to make that tractable. Propositum's analogue is a visible,
   non-dismissible indication that a session is being observed, and an obvious stop control.

Their founder's framing is also the closest thing to Propositum's thesis anyone has published:
*"If we are not careful, as a society we may accidentally outsource not just our busywork, but our
judgment to LLMs."*

### 7.4 Agentic browsers — every full-browser bet is dead or dying

This is the strongest external evidence in the document, and it lands squarely on the vehicle question.

| Product | Vehicle | Reads page content | Consent granularity | Status, Aug 2026 |
|---|---|---|---|---|
| **Claude in Chrome** | Extension on the real profile | Screenshots of worked tabs | Per-site + per-action + 3 modes | **Live**, ~13M users |
| **Dia** (Browser Company) | Full Chromium browser | Only with granted access | **Zero-access default** | Live; Atlassian-owned |
| **Arc Max** | Full browser | Page content per AI feature | Feature-bundle opt-in only | **Maintenance-only** |
| **Comet** (Perplexity) | Chromium fork | On-demand, "minimal context" | Per-site block + 3-way per-run | Live |
| **ChatGPT Atlas** | Chromium + native shell | **Continuous background summarisation** | Per-page address-bar toggle | **Stops working 2026-08-09** |
| **Edge Copilot Mode** | Mode inside Edge | Tabs + history with permission | Global opt-in, region-dependent | **Retired 2026-05-13** |

**OpenAI's stated reason for killing Atlas is the reason not to build vehicle B:**
*"We're deprecating Atlas and moving browser-based agentic capabilities into ChatGPT and Codex… Atlas is
scheduled to stop working on August 9, 2026."* — because *"Browsers require ongoing security maintenance,
and we do not want users to remain on a discontinued browser."* Their replacement is a **ChatGPT Chrome
extension plus a desktop app**. Microsoft retired Copilot Mode outright on 2026-05-13. Arc now carries
*"Arc receives Chromium updates only. For active security patches… download Dia instead."*

Two design patterns worth importing:

- **Dia's zero-access default.** *"Dia's chat session starts with **no access** to other tabs or ability
  to take write actions. Your review is needed to grant access."* That is exactly the
  `optional_host_permissions` posture of [§3.2](#32-the-finding-that-decides-the-product-question),
  independently arrived at by a browser vendor. Dia's security bulletin also records the best *unshipping*
  story in this space: they built a `fetch_web_content` tool, discovered the fetch itself was a
  prompt-injection **exfiltration channel** (the outbound request leaked context into an attacker's logs),
  concluded **detection was not enough**, removed the feature before public beta, and reshipped it two
  months later with architectural URL-provenance controls that hold *even when injection succeeds*. That
  is the lethal-trifecta argument ([§6.4](#64-where-propositum-sits-in-the-published-threat-model)) in
  practice: they cut the exfiltration leg rather than trying to filter the untrusted-content leg.
- **Comet's default refusals.** *"By default, Comet Assistant does **not** access or upload: Browsing
  history · Full list of your open tabs · Cookies or site data · Passwords and autofill data · Local
  files · Input you type on websites"*, and sends *"only the minimal required context."* Per-run consent
  is a three-way **Allow this time only / Always allow / Don't allow**. Their published negative result is
  useful for our own eval design: detectors show *"a structural bias toward 'hidden' injections"* — attacks
  placed in visible footers, table cells, and inline paragraphs are much **harder** to catch than the
  hidden-text attacks everyone tests. Their BrowseSafe benchmark (14,719 examples, 11 attack types,
  Dec 2025) is a ready-made source for the adversarial fixture.

**The asymmetry that matters for us.** These products can afford a full browser because a person can adopt
one wholesale, with a real profile and real logins. A Playwright window cannot offer that
([§4.3](#43-can-it-host-a-genuine-human-session-largely-no-and-the-trend-is-against-it)). So vehicle B gets
the maintenance burden and consent-model complexity of the browser bet **without** the thing that made the
browser bet viable. And the companies that took that bet with real resources are, as of this month,
exiting it.

---

## 8. Recommendation

### 8.1 The recommendation

> **Build the Chrome MV3 extension. Do not consolidate it with the worker's browser.**
>
> - **Human observation** → MV3 extension, scoped by `optional_host_permissions` to approved sources,
>   with `"storage"`, `"alarms"`, `"idle"`, `"scripting"`, `"sidePanel"` (all warning-free), and
>   **explicitly not** `"tabs"`, `"webNavigation"`, `"history"`, or `"debugger"`.
> - **Worker research** (later, [#10](https://github.com/smukhyala/propositum/issues/10)) → a **separate**
>   `chromium.launch()` process with `channel: 'chromium'`, its own ephemeral context, no credentials,
>   hard URL allowlist.
> - **Transport** → WebSocket from the extension service worker to `127.0.0.1`, per-session bearer token,
>   `Origin` pinned to the extension ID. Native messaging held in reserve.

### 8.2 Why — four arguments, in order of weight

**1. Under the extension, the brief's constraints are enforced by Chrome. Under Playwright, they are
enforced by us.**

This is the argument that decides it, and it is a privacy argument, not a technical one. With
`host_permissions` scoped to approved sources and no `"tabs"` permission, the extension is *structurally
incapable* of learning that the user visited anything else — Chrome will not hand over the URL, the title,
or the tab ([§3.2](#32-the-finding-that-decides-the-product-question)). "Approved tabs only" becomes a
manifest declaration the user consents to in Chrome's own UI, revocable in Chrome's own UI, independent of
our code being correct.

A Playwright context has no permission model at all. `context.on('page')` fires for every tab and popup;
`context.addInitScript()` runs in every frame. "Approved tabs only" becomes an `if` statement in our
TypeScript ([§4.4](#44-the-scoping-problem-nothing-constrains-it-but-us)). A regression widens capture to
everything, silently, with no user-visible signal. For a product whose entire proposition is that it
watches your real knowledge work, "trust our `if` statement" is not a posture that survives contact with
a sceptical user — and it should not, because it is genuinely weaker.

**Rewind proved this empirically** ([§7.2](#72-rewind--limitless--and-the-specific-way-its-scoping-controls-leaked)):
their app-level exclusion controls were sincere, documented, and leaked anyway — through Mission Control,
through picture-in-picture, through password managers rendered as browser extensions. Those leaks were
emergent properties of building exclusions on top of a see-everything vehicle. That failure mode is not
available to a vehicle that is never handed the data.

**2. The capability advantage that motivates the controlled browser does not exist for our signal set.**

The intuition is that CDP sees more. It does — but every capability where it decisively wins (response
bodies, screencast, full DOM snapshots) is something the brief forbids. And on the signals we actually
want, CDP is *behind*: it has **no passive input observation at all**
([§4.1](#41-the-finding-that-reframes-the-whole-comparison)), so selection, scroll, and dwell require the
same injected DOM listeners a content script uses. Meanwhile `chrome.idle` (OS-level away/lock detection)
and `windows.onFocusChanged` have **no CDP equivalent** — and "the human left" is a first-class event for a
product about shift changes.

The controlled browser therefore buys capabilities we have promised not to use, at the cost of
capabilities we need.

**3. It has to feel like work, not like a test harness — and Chrome is actively hardening against
option B.**

A Playwright window is a fresh empty profile: no logins, no bookmarks, no password manager, no extensions.
Chrome has closed the doors that made it feel otherwise, and kept closing them: `--load-extension` removed
from branded Chrome in **137**, `--disable-extensions-except` in **139**, the default-profile debugging
block in **136**, and from **144** an unsuppressible automation banner plus a per-session permission
dialog. Playwright's own maintainers call banner suppression *"out of scope"*. Building the primary human
work surface on this is building against the platform's direction of travel, and the friction compounds
every Chrome release.

**4. The market has already run this experiment, and the browser bet lost.**

As of this month: **ChatGPT Atlas stops working 2026-08-09**, **Edge Copilot Mode was retired
2026-05-13**, and **Arc is Chromium-updates-only**. OpenAI's stated reason is the one that applies to us —
*"Browsers require ongoing security maintenance, and we do not want users to remain on a discontinued
browser"* — and their replacement is a **Chrome extension plus a desktop app**. Meanwhile Anthropic, which
started from the extension, is live at ~13M users. The two survivors of the browser bet (Dia, Comet) are
funded browser vendors shipping weekly Chromium security releases; that is the actual cost of the vehicle,
and it is not a cost slice 0 can carry ([§7.4](#74-agentic-browsers--every-full-browser-bet-is-dead-or-dying)).

### 8.3 What we give up, honestly

- **`transitionType`.** `webNavigation.onCommitted` is the only source of "typed vs. followed a link vs.
  submitted a form" — the most semantically loaded raw signal available — and it costs the
  "Read your browsing history" warning. We take `document.referrer` and
  `performance.getEntriesByType('navigation')[0].type` as partial substitutes and accept the loss.
  **Revisit this if H1 scores poorly and ablation points at navigation intent.**
- **Developer-mode friction.** A startup bubble Google refuses to make suppressible, and an extension ID
  that changes if the repo moves (fixed by pinning `key`). Escape hatch: an unlisted Web Store listing,
  which still requires full review.
- **The 30-second service worker.** Every design must assume the extension dies constantly. This is real
  engineering cost, and it is where capture bugs will live.
- **No consolidation saving.** ~200–400 lines shared, versus a worker that is one `page.click()` from
  acting inside the human's authenticated session
  ([§4.6](#46-the-consolidation-argument-quantified--and-rejected)). The saving is not worth the coupling.

### 8.4 What this does *not* settle

Playwright is still the right tool for the worker's own browsing, and it is worth building the
`ObservationSource` interface so a `controlled-browser` implementation remains possible — the eval harness
benefits from being able to drive one, and there may be a future scenario (a fully unattended
demo session, an adversarial fixture recorded reproducibly) where a controlled browser is the *better*
vehicle precisely because it is not the human's real browser. Keep the door open; do not walk through it
for slice 0.

One hybrid worth noting rather than adopting: Playwright's own
[browser-extension attach mode](https://playwright.dev/mcp/configuration/browser-extension) —
*"connects to your existing browser tabs, reusing your logged-in sessions, cookies, and installed
extensions"*. That is an extension wearing Playwright's clothes, and it inherits Chrome's per-session
debugging permission dialog and banner. It confirms the direction of this recommendation more than it
offers an alternative to it.

---

## 9. The interface both vehicles must satisfy

The point of `ObservationSource` is that the fixture adapter, the real adapter, and the adversarial
regression fixture are genuinely interchangeable, and the eval harness can drive any of them. Three
properties do most of the work, and all three are easy to leave out and expensive to add later.

```ts
type Vehicle = 'fixture' | 'chrome-extension' | 'controlled-browser'

/** How much a field can be trusted. Set by the adapter; never inferred downstream. */
type Trust =
  | 'browser-attested'   // Chrome/CDP told us: URL, title, nav timing, focus, idle
  | 'page-derived'       // the page could have authored it: text, selection, DOM-read title
  | 'user-asserted'      // the human typed it into Propositum

interface ObservationEvent {
  readonly seq: number                // monotonic per session — gaps are detectable
  readonly sessionId: SessionId
  readonly observedAt: string         // ISO wall clock
  readonly elapsedMs: number          // since session start — lets a fixture replay in virtual time
  readonly source: ApprovedSourceId   // which approved source; never a bare URL
  readonly kind: ObservationKind
  readonly payload: unknown           // Zod-validated per kind
  readonly trust: Trust               // REQUIRED on every event
  readonly vehicle: Vehicle
}

interface ObservationSource {
  readonly vehicle: Vehicle

  /** Which signals this vehicle can emit at all. The harness must not score what a vehicle cannot produce. */
  capabilities(): SignalCapability[]

  /** Explicit start. Returns only once capture is actually live. */
  start(session: SessionStart): Promise<void>

  /** Explicit stop. Flushes, then reports what was and was not captured. */
  stop(): Promise<CaptureSummary>

  subscribe(onEvent: (e: ObservationEvent) => void): Unsubscribe
}
```

**1. `trust` is mandatory on every event.** This is the highest-value field in the schema and the one most
likely to be omitted. `tabs.onUpdated.url` is `browser-attested`: Chrome told us, a page cannot lie about
it. `document.title` read from the DOM is `page-derived`: a hostile page rewrites it at will. Extracted
text is always `page-derived`. Downstream, every `page-derived` string must be **datamarked** before it
reaches a model ([§6.3](#63-poisoning-the-part-that-cannot-be-engineered-away) mitigation 3), and no
`page-derived` value may ever influence a policy decision. Without this field on the event itself, that
distinction has to be reconstructed later from the event kind — which is exactly the kind of inference
that goes wrong quietly.

Two refinements worth encoding now rather than later. **(a)** `page-derived` is per *field*, not per
event: an event can carry a `browser-attested` URL and a `page-derived` title simultaneously, so the flag
belongs on values, not just on the envelope. **(b)** Approving a source does **not** upgrade its content —
in OWASP 2026's trust tiers, an approved source is *"content the user chose to retrieve but did not
author"*, which is semi-trusted at best and untrusted in practice. The approved-source list constrains
*where* we look; it says nothing about who wrote what we find there.

**2. `capabilities()` prevents a silent eval bug.** A hand-authored fixture can trivially emit
`transitionType: 'typed'`. The extension can only emit it with a permission we have chosen not to request;
the controlled browser cannot emit it at all. If the harness scores inference against fixtures carrying
signals no real vehicle can produce, slice 0 will report H1 numbers that real capture can never reach —
and the failure will look like a model problem rather than a fixture problem.

**3. Gaps are events, not absences.** `seq` is monotonic so the store can detect holes, and the source
must emit an explicit `capture_gap` event (with a reason: `service_worker_terminated`, `machine_slept`,
`transport_disconnected`, `permission_revoked`) whenever it knows it stopped seeing. Otherwise a dropped
window reads to inference as "the human did nothing for eleven minutes."

**Two further requirements that fall out of the vehicles:**

- **No internal `Date.now()`.** `elapsedMs` must be supplied, so a fixture can replay a 40-minute session
  in 400 ms without inference behaving differently. Any dwell threshold must read `elapsedMs`, never the
  clock.
- **`ApprovedSourceId`, not a URL.** The approved-source list is the product-level consent artifact, and
  it is what the extension's `optional_host_permissions` grants map onto. Events reference it by ID.
  This also means an event whose source is not on the list is a **schema violation**, not a filtering
  decision made downstream — the ledger writer can reject it, satisfying "deterministic code authorizes."

**What deliberately does not belong in this interface:** any semantic-inference method. `ObservationSource`
produces near-raw events and nothing else ([§5.1](#51-the-layering-the-brief-already-implies)). If a
`summarise()` method ever appears on it, the layering has collapsed.

---

## 10. Open questions

**Must be resolved before or during slice 0 build**

1. ~~**Are Chrome extension service workers subject to Local Network Access?**~~ **Resolved:** extensions
   are exempt — *"We do not currently have plans to apply LNA restrictions to extensions"* (Google's LNA
   Adoption Guide, updated 2026-05-18). Residual risk: that statement lives only in an unversioned Google
   Doc and says *"currently"*. **Add a startup self-check** that fails loudly if the loopback POST is ever
   blocked, rather than assuming it will keep working.
2. ~~**Is LNA actually shipped?**~~ **Resolved:** shipped by default in **M142 (2025-10-28)**, split into
   `local-network` / `loopback-network` in M145, extended to WebSockets and WebTransport in **M147**. The
   `chromestatus` `is_released: false` field is stale metadata. Note M147 matters directly: if the
   transport is a WebSocket, a hostile page attempting the same is gated too — but see
   [§6.2](#62-forgery-the-loopback-endpoint), this is not our security boundary.
3. **Does `chrome.storage.session` survive a service worker restart within the same browser session?** The
   docs say it is cleared when the browser closes, but the flush-on-alarm design depends on the exact
   boundary. Verify empirically rather than by inference.
4. **What is the real event volume?** Scroll and selection listeners can be chatty. Sampling and
   debouncing policy needs a number from a real session, not a guess, before the append-only ledger design
   is fixed ([#12](https://github.com/smukhyala/propositum/issues/12)).
5. **Does `window.navigation` (the Navigation API) exist in a content script's isolated world?** If so it
   is a much cleaner SPA-navigation signal than patching `history.pushState`, and it avoids the
   `webNavigation` permission entirely. Not verified here.

**Undocumented — docs are silent, treat as unknown**

6. Whether a `browser.bind()`-bound Playwright browser survives its binding process exiting.
7. Whether creating extra ephemeral contexts on a persistently-launched Chromium is supported (no
   source-level prohibition found; playwright.dev never describes the combination).
8. Whether Chrome sync / Google sign-in works in a Playwright persistent context. Playwright passes
   `--disable-sync` by default; Google is widely *reported* to block sign-in from instrumented browsers,
   but no first-party confirmation was found.
9. Whether real Chrome Web Store extensions can be installed into a Playwright profile at all. Only
   unpacked loading is documented, and CDP's experimental `Extensions` domain offers only `loadUnpacked`.
10. `--remote-allow-origins`, which gates which web origins may open a CDP WebSocket, appears in Chromium
    issue trackers but has **no developer.chrome.com page**. Verify before relying on it. (Only relevant if
    the controlled-browser path is ever revisited.)
11. OpenAI's first-party Atlas security posts could not be read — `openai.com` returns HTTP 403 to
    automated fetchers. The CISO quote in [§7.4](#74-agentic-browsers--every-full-browser-bet-is-dead-or-dying)
    reaches us via Willison quoting [@cryps1s](https://twitter.com/cryps1s/status/1981037851279278414);
    `openai.com/index/hardening-atlas-against-prompt-injection/` should be read manually before being
    quoted as primary.

**Useful leads found but not pursued**

10. **Perplexity's BrowseSafe** benchmark — 14,719 examples across 11 injection attack types, open-sourced
    Dec 2025 — is a ready-made corpus for the adversarial fixture
    ([#11](https://github.com/smukhyala/propositum/issues/11) asks for one). Their published negative
    result is the more useful part: detectors show *"a structural bias toward 'hidden' injections"*, so
    attacks placed in **visible** footers, table cells, and inline paragraphs are harder to catch than the
    hidden-text attacks everyone tests first. Build the fixture accordingly.
11. If a real-profile automation path is ever revisited, note that `browser-use`'s
    `from_system_chrome()` **silently downgrades to a throwaway temp profile** when the real profile is
    locked (SingletonLock → `tempfile.mkdtemp()`, three retries, WARNING only). That is the
    "looked like it worked, observed nothing real" failure mode, and any adapter in this space needs an
    explicit assertion rather than a warning.

**Product questions this research cannot answer**

12. Does the approved-source grant flow feel like consent or like friction? The permissions model supports
    a zero-warning install with per-source runtime grants, but whether a user will approve four sources at
    the start of every session — or come to resent it — is a
    [#16](https://github.com/smukhyala/propositum/issues/16) prototype question.
13. Is the developer-mode startup bubble tolerable for slice 0, or does an unlisted Chrome Web Store
    listing become a prerequisite? This affects timeline: review is *"a few days… up to a few weeks"*, and
    unlisted listings go through the same review.
14. What exactly does `SECURITY_AND_PRIVACY.md` promise about extracted page text — verbatim storage,
    bounded excerpt, or selection-only? [§5.4](#54-text-extraction-when-how-much-and-what-to-keep) argues
    for bounded, but this is a product commitment, not a technical finding.
15. What is the visible in-session indicator? Granola shipped an in-meeting chat notice and a video
    watermark rather than relying on the user to disclose. Propositum's analogue — an unmistakable
    "observing" state and a one-click stop — is a design decision this research can only flag.

---

## 11. Sources

All primary. Where a claim rests on something weaker, the section says so inline.

**Chrome extensions — developer.chrome.com**

- [Permissions reference (warning strings)](https://developer.chrome.com/docs/extensions/reference/permissions-list)
- [Permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings)
- [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [`activeTab` permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [`chrome.permissions` API](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns)
- [`chrome.tabs` API](https://developer.chrome.com/docs/extensions/reference/api/tabs)
- [`chrome.windows` API](https://developer.chrome.com/docs/extensions/reference/api/windows)
- [`chrome.webNavigation` API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation)
- [`chrome.idle` API](https://developer.chrome.com/docs/extensions/reference/api/idle)
- [`chrome.storage` API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [`chrome.scripting` API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [`chrome.contextMenus` API](https://developer.chrome.com/docs/extensions/reference/api/contextMenus)
- [`chrome.sidePanel` API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [`chrome.debugger` API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
- [`chrome.runtime` — MessageSender](https://developer.chrome.com/docs/extensions/reference/api/runtime#type-MessageSender)
- [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [Message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [`externally_connectable` manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable)
- [`key` manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Content Security Policy manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
- [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Stay secure](https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure)
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Longer extension service worker lifetimes (Chrome 110)](https://developer.chrome.com/blog/longer-esw-lifetimes)
- [What's new in Chrome 120 for Extensions](https://developer.chrome.com/blog/chrome-120-beta-whats-new-for-extensions)
- [Improve extension security (MV3)](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- [Known issues migrating to MV3](https://developer.chrome.com/docs/extensions/develop/migrate/known-issues)
- [Manifest V2 deprecation timeline](https://developer.chrome.com/docs/extensions/develop/migrate/mv2-deprecation-timeline)
- [What's happening in Chrome Extensions, June 2025 (`--load-extension` removal)](https://developer.chrome.com/blog/extension-news-june-2025)
- [What's new in Chrome extensions](https://developer.chrome.com/docs/extensions/whats-new)
- [Hello World tutorial (load unpacked)](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world)
- [Chrome Web Store distribution / visibility](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
- [Chrome Web Store Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- [Permissions requested by apps and extensions (consumer wording)](https://support.google.com/chrome_webstore/answer/186213)

**Chromium primary sources**

- [Extensions Security FAQ](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/security_faq.md) — *"isolated worlds… not a security boundary"*, native messaging not a secure channel
- [Extension Permissions (permission message coalescing)](https://chromium.googlesource.com/chromium/src/+/main/extensions/docs/permissions.md)
- [`components/crx_file/id_util.cc`](https://chromium.googlesource.com/chromium/src.git/+/master/components/crx_file/id_util.cc) — unpacked extension ID = hash of directory path
- [PSA: removing `--extensions-on-chrome-urls` and `--disable-extensions-except` (Chrome 139)](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/FxMU1TvxWWg/m/daZVTYNlBQAJ)
- [Developer-mode bubble: no kill switch](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/LHtbj6Up5dU)
- [crbug 40419543 — suppress "Disable developer mode extensions" bubble](https://issues.chromium.org/issues/40419543)

**Playwright and the DevTools Protocol**

- [`class BrowserType` — `launchPersistentContext`, `connectOverCDP`, `channel`](https://playwright.dev/docs/api/class-browsertype)
- [`class BrowserContext` — `addInitScript`, `exposeBinding`, `on('page')`, `newCDPSession`](https://playwright.dev/docs/api/class-browsercontext)
- [`class Page` — `ariaSnapshot`, event surface](https://playwright.dev/docs/api/class-page)
- [Browser contexts (isolation)](https://playwright.dev/docs/browser-contexts)
- [Browsers (channels, headless modes)](https://playwright.dev/docs/browsers)
- [Chrome extensions in Playwright](https://playwright.dev/docs/chrome-extensions)
- [Aria snapshots](https://playwright.dev/docs/aria-snapshots)
- [`playwright-cli attach`](https://playwright.dev/agent-cli/commands/attach)
- [Playwright browser-extension mode](https://playwright.dev/mcp/configuration/browser-extension)
- [`chromiumSwitches.ts`](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts) — `--disable-infobars`, `--disable-sync`, `--enable-automation` history
- [`recorder.ts`](https://github.com/microsoft/playwright/blob/main/packages/injected/src/recorder/recorder.ts) — Playwright's own human-observation implementation
- [Issue #18872 — banner suppression "out of scope"](https://github.com/microsoft/playwright/issues/18872)
- [CDP `Input` domain](https://chromedevtools.github.io/devtools-protocol/tot/Input/) — dispatch-only
- [CDP `Network`](https://chromedevtools.github.io/devtools-protocol/tot/Network/) · [`Page`](https://chromedevtools.github.io/devtools-protocol/tot/Page/) · [`Accessibility`](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/) · [`DOMSnapshot`](https://chromedevtools.github.io/devtools-protocol/tot/DOMSnapshot/) · [`Runtime`](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/) · [`Extensions`](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/)
- [Chrome: changes to `--remote-debugging-port` (Chrome 136)](https://developer.chrome.com/blog/remote-debugging-port)
- [Chrome DevTools MCP — debugging-session banner and per-session dialog (Chrome 144)](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)

**Local network / loopback**

- [Local Network Access permission prompt (Chrome 142)](https://developer.chrome.com/blog/local-network-access)
- [WICG Local Network Access explainer](https://github.com/WICG/local-network-access/blob/main/explainer.md)
- [Chrome Platform Status: Local network access restrictions](https://chromestatus.com/feature/5152728072060928) — note the stale `is_released` discrepancy
- [Brave: localhost permission (v1.54, 2023-06-27)](https://brave.com/privacy-updates/27-localhost-permission/)

**Web platform**

- [Page Visibility API (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — including the caveat that `blur`/`focus` are not equivalent to visibility
- [mozilla/readability](https://github.com/mozilla/readability) and [`isProbablyReaderable`](https://github.com/mozilla/readability/blob/main/Readability-readerable.js)

**Prompt injection — standards and taxonomies**

- [OWASP Top 10 for LLM Applications **2026**](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) (PDF only; resource page 2026-08-03)
- [OWASP LLM01:2025 — Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) (still the live web page)
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) — ASI01 Agent Goal Hijack
- [OWASP Agentic AI — Threats and Mitigations v1.1 (Dec 2025)](https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/) — T1/T2/T6
- [NIST AI 100-2e2025 (Mar 2025)](https://csrc.nist.gov/pubs/ai/100/2/e2025/final)
- [Greshake et al. — Not what you've signed up for (arXiv:2302.12173, 2023-02-23)](https://arxiv.org/abs/2302.12173) — coined the term

**Prompt injection — defences**

- [Simon Willison — The lethal trifecta for AI agents (2025-06-16)](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- [Simon Willison — The Dual LLM pattern (2023-04-25)](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/)
- [Simon Willison — Delimiters won't save you (2023-05-11)](https://simonwillison.net/2023/May/11/delimiters-wont-save-you/)
- [Microsoft — Defending Against Indirect Prompt Injection Attacks With Spotlighting (arXiv:2403.14720)](https://arxiv.org/abs/2403.14720)
- [MSRC — How Microsoft defends against indirect prompt injection attacks (2025-07)](https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks)
- [Debenedetti et al. — CaMeL: Defeating Prompt Injections by Design (arXiv:2503.18813, v2 2025-06-24)](https://arxiv.org/abs/2503.18813)
- [Meta — Agents Rule of Two (2025-10-31)](https://ai.meta.com/blog/practical-ai-agent-security/)
- [Google — Architecting Security for Agentic Capabilities in Chrome (2025-12-08)](https://blog.google/security/architecting-security-for-agentic/)
- [Google — Mitigating prompt injection attacks with a layered defense strategy (2025-06-13)](https://blog.google/security/mitigating-prompt-injection-attacks/)
- [Google — AI threats in the wild (2026-04-23)](https://blog.google/security/prompt-injections-web/) — Common Crawl, +32% malicious pages

**Prompt injection — attacks observed in agentic browsers (Brave)**

- [Comet prompt injection (2025-08-20)](https://brave.com/blog/comet-prompt-injection/)
- [Unseeable prompt injections via screenshots (2025-10-21)](https://brave.com/blog/unseeable-prompt-injections/)
- [Opera Neon (2025-10-31)](https://brave.com/blog/prompt-injection-flaw-opera-neon/)
- [Mozilla Tabstack / Cotypist (2026-06-08)](https://brave.com/blog/indirect-prompt-injection/)
- [Brave Leo — AI browsing security posture (2025-12-10)](https://brave.com/blog/ai-browsing/)

**Web platform specs used for the forgery analysis**

- [WHATWG HTML — the `innerText` algorithm](https://html.spec.whatwg.org/multipage/dom.html#the-innertext-idl-attribute)
- [WHATWG Fetch — CORS-preflight and safelisted methods/headers](https://fetch.spec.whatwg.org/#cors-preflight-fetch)
- [Chromium — `V8BindingDesign.md`](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/V8BindingDesign.md) — worlds share C++ DOM objects, not prototype chains
- [Chromium — `externally_connectable.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/manifest_handlers/externally_connectable.cc) — no eTLD check
- [Google — Local Network Access Adoption Guide](https://docs.google.com/document/d/1QQkqehw8umtAgz5z0um7THx-aoU251p705FbIQjDuGs/) (Google Doc, upd. 2026-05-18) — **the extension exemption**
- [Chrome release notes 142](https://developer.chrome.com/release-notes/142)

**Comparable products — Anthropic**

- [Piloting Claude in Chrome (2025-08-25, updated 2025-12-18)](https://claude.com/blog/claude-for-chrome)
- [Mitigating the risk of prompt injections in browser use (2025-11-24)](https://www.anthropic.com/research/prompt-injection-defenses)
- [Use Claude in Chrome safely](https://support.claude.com/en/articles/12902428-use-claude-in-chrome-safely)
- [Claude in Chrome permissions guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide)
- [Claude Code — Chrome integration](https://code.claude.com/docs/en/chrome)
- [Chrome Web Store listing (permissions and data disclosures)](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn)

**Comparable products — Rewind / Limitless**

⚠️ `rewind.ai` is no longer operated by the original company. Use archive captures.

- [Rewind privacy policy, archived (dated 2023-10-04)](https://web.archive.org/web/20240519113334/https://www.rewind.ai/privacy)
- [Rewind help: "What permissions does Rewind need?" (archived)](https://web.archive.org/web/2024/https://help.rewind.ai/en/articles/6539903-what-permissions-does-rewind-need)
- [Rewind help: "What are the limitations of excluding apps & private browsing?" (archived)](https://web.archive.org/web/2024/https://help.rewind.ai/en/articles/6709718-what-are-the-limitations-of-excluding-apps-private-browsing)
- [Rewind help: "The importance of consent" (archived)](https://web.archive.org/web/2024/https://help.rewind.ai/en/articles/6698435-the-importance-of-consent)
- [limitless.ai — Meta acquisition banner and Rewind sunset date](https://www.limitless.ai/)

**Comparable products — Granola**

- [Security at Granola](https://www.granola.ai/security)
- [Security, privacy and data FAQs](https://docs.granola.ai/help-center/consent-security-privacy/security-privacy-data-faqs)
- [Why Granola doesn't use a bot](https://www.granola.ai/blog/why-granola-doesnt-use-a-bot)
- [Launch post (2024-05-22)](https://www.granola.ai/blog/announcement)
- [Changelog](https://www.granola.ai/updates)

**Comparable products — agentic browsers**

- [Dia — Security](https://www.diabrowser.com/security) and [Security bulletins](https://www.diabrowser.com/security/bulletins)
- [Browser Company — Letter to Arc members 2025 (2025-05-26)](https://browsercompany.substack.com/p/letter-to-arc-members-2025)
- [Arc — CVE-2024-45489 incident response](https://arc.net/blog/CVE-2024-45489-incident-response)
- [Perplexity — Comet Assistant privacy and data use](https://www.perplexity.ai/help-center/comet/en/articles/12867415-comet-assistant-privacy-data-use.html)
- [Perplexity — Mitigating prompt injection in Comet (2025-10-22)](https://www.perplexity.ai/hub/blog/mitigating-prompt-injection-in-comet)
- [Perplexity — BrowseSafe benchmark (2025-12-02)](https://www.perplexity.ai/hub/blog/building-safer-ai-browsers-with-browsesafe)
- [OpenAI — Introducing ChatGPT Atlas (2025-10-21)](https://openai.com/index/introducing-chatgpt-atlas/)
- [OpenAI — Evolving Atlas into ChatGPT for browser-based agentic work (deprecation)](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work)
- [OpenAI — Hardening Atlas against prompt injection](https://openai.com/index/hardening-atlas-against-prompt-injection/) — ⚠️ `openai.com` returns 403 to automated fetchers; **not independently verified**, read manually before quoting
- [OpenAI CISO Dane Stuckey on Atlas, via Willison (2025-10-22)](https://simonwillison.net/2025/Oct/22/openai-ciso-on-atlas/) — *"prompt injection remains a frontier, unsolved security problem"*
- [Microsoft Edge — New updates across desktop and mobile (Copilot Mode retirement, 2026-05-13)](https://blogs.windows.com/msedgedev/2026/05/13/new-updates-to-edge-across-desktop-and-mobile/)
- [Microsoft — Considerations for safe agentic browsing (2025-10-23)](https://blogs.windows.com/msedgedev/2025/10/23/considerations-for-safe-agentic-browsing/)

**Chrome Web Store review**

- [Review process and timelines](https://developer.chrome.com/docs/webstore/review-process)
- [Permissions policy (narrowest necessary)](https://developer.chrome.com/docs/webstore/program-policies/permissions)
- [User data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

**Real-profile automation**

- [browser-use — real browser / `from_system_chrome`](https://docs.browser-use.com/open-source/customize/browser/real-browser)
- [browser-use `local_browser_watchdog.py`](https://github.com/browser-use/browser-use/blob/main/browser_use/browser/watchdogs/local_browser_watchdog.py) — silent fallback to a temp profile
