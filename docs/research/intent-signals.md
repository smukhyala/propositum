# Intent signals: what a desktop + Chrome user can be read from, and what each one costs

_Research feeding a decision that has not been taken. Nothing here is implemented, and two of the findings
below are **corrections to shipped documentation** rather than proposals._
_Researched 2026-08-17. Chrome stable is **M151/M152**; version-sensitive claims are dated. Several macOS and
OCR claims were reproduced by execution on this machine (macOS 26.5.2, build 25F84) and are marked
**[VERIFIED]** or **[MEASURED]** so they are never mistaken for citations. Where no primary source exists I
say **UNVERIFIED** rather than guessing, and §11 collects every instance._

---

**In one paragraph.** The cheapest large gain available here is not a new permission — it is **Chrome APIs
the extension can already call today**, because `chrome.tabs.query()` requires no permission at all and
`host_permissions: ["https://*/*"]` already unscrubs every https tab's URL and title
([§2.1](#21-the-extension-can-enumerate-every-open-tab-today)). That makes
[`SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md)'s promise — *"there is no call it can make that
returns a tab it did not create itself"* — **false as written**, and it cuts both ways: Chromium's permission
rules *absorb* the warnings for `tabs`, `webNavigation`, `topSites` and `favicon` into the "all your data on
all websites" prompt the person already accepted ([§4.1](#41-the-finding-that-changes-the-arithmetic)), so
the manifest's stated reason for excluding them — *"costs the scary warning"* — **stopped being true the day
ADR-0008 widened host permissions.** Those two sentences have to be fixed before anything else in this note
is actionable. The ranking beyond that is unsentimental, and one pattern shows up four times independently:
**the best intent signals are the ones a person authored** — a tab group title, a calendar `focusTime` block,
a Slack `status_text`, a git branch name — each of which *is* the sentence `topics.ts` and
`boundaries/subject.ts` spend their length reconstructing, typed by the person, for free. Against that,
**Gmail's "metadata-only" scope is a trap** (it is *restricted*, so it carries an annual CASA security
assessment, and Gmail's approved-use-case list does not obviously admit this product,
[§6.1](#61-gmail--and-the-finding-that-inverts-the-obvious-plan)), and **a rolling screenshot cache fails on
arithmetic before it fails on principle**: one interpreted frame per minute costs more per hour than an
entire half-hour handoff run, macOS gates window *titles* behind the same permission as the pixels
([§5.3](#53-the-ones-that-cross-a-line)), Apple's persistence entitlement for this is restricted and framed
as VNC-only, and the two comparable products both ended badly — Microsoft reversed Recall to opt-in under
public pressure and still documents its own filtering leaking, while Rewind's local-first architecture did
not survive its acquisition ([§8.5](#85-what-the-two-comparable-products-actually-did--and-one-of-them-is-dead)).

---

## 1. The question, and the frame

Propositum today captures, ambiently, from every `https` page: a cleaned URL, the page title, dwell time,
scroll depth, and an interaction flag. Metadata only, in memory, bounded by a 30-minute window and a 500-row
cap ([ADR-0008](../adr/0008-ambient-detection.md)). From that, `detect.ts` → `topics.ts` → `grounds.ts`
reconstructs *threads* — pages across ≥2 origins sharing subject terms — and decides, by arithmetic, whether
to name one and whether to offer to work on it.

The question is what else could be read, and whether it is worth reading. Every signal below is answered on
three axes, and the third is the one that usually decides it:

| Axis | The test |
|---|---|
| **What it buys** | something that *cannot* be inferred from URL + title + dwell + scroll today. Not "more of the same, more accurately" — a different fact |
| **What it costs** | the exact prompt string, the install-time warning, review friction, battery, and the size of the privacy surface if the product is later compromised or subpoenaed |
| **Whether it is reversible** | can the person revoke it *after* granting, without uninstalling, and does the product still function without it |

**One thing this note refuses to do.** [`docs/SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) promises
no keystroke logging and no screen recording, and it makes those promises **as design commitments, not as a
roadmap position**. Several capabilities researched below would cross those lines. Where that happens the
section says so in its own first line, and it is written as *a reversal that needs its own ADR*, in the same
form ADR-0010 used when it reversed ADR-0002 — with the price in the opening paragraph rather than in a
footnote. Nothing here is written so that a later reader could adopt it by accident.

---

## 2. Two sentences in the corpus that are already false

Both are consequences of [ADR-0008](../adr/0008-ambient-detection.md) widening `optional_host_permissions`
(scoped to approved sources) into `host_permissions: ["https://*/*"]`. Neither was noticed at the time. Both
are corrections, not proposals, and they are first because the rest of this note is unreadable if they are
not fixed.

### 2.1 The extension *can* enumerate every open tab, today

[`SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md), *Data explicitly not collected*:

> **A list of your open tabs.** The extension is not granted `tabs`, `webNavigation` or `history`, and the
> acting agent never calls `chrome.debugger.getTargets`. There is no call it can make that returns a tab it
> did not create itself. **This one is still enforced by the browser rather than by our code.**

Three primary sources, in the order that matters:

1. **The `chrome.tabs` namespace requires no permission.** Chromium's
   [`_api_features.json`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/_api_features.json)
   declares `"tabs"` with `"channel": "stable"` and **no `dependencies` entry** — compare `"sessions"`, which
   is `{"dependencies": ["permission:sessions"], …}`. The public docs say the same thing from the other
   side: *"This permission does not give access to the `chrome.tabs` namespace. Instead, it grants an
   extension the ability to call `tabs.query()` against four sensitive properties on `tabs.Tab` instances:
   `url`, `pendingUrl`, `title`, and `favIconUrl`."*
   ([tabs reference](https://developer.chrome.com/docs/extensions/reference/api/tabs))

2. **`tabs.query()` performs no permission check.** [`tabs_api.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/tabs/tabs_api.cc),
   `TabsQueryFunction::Run`, carries this comment verbatim:

   > `// It is o.k. to use URLPattern::SCHEME_ALL here because this function does`
   > `// not grant access to the content of the tabs, only to seeing their URLs`
   > `// and meta data.`

3. **Host permission is sufficient to unscrub the URL and title.**
   [`extension_tab_util.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/extension_tab_util.cc),
   `GetScrubTabBehaviorImpl`:

   ```cpp
   } else if (permissions->active_permissions().HasExplicitAccessToOrigin(url)) {
     // Explicit host permission allows access.
     has_permission = true;
   }
   ```

So `chrome.tabs.query({})` from `service-worker.js` returns, today, the URL and title of **every open `https`
tab in every window**. What prevents it is that no line in the extension calls it — which is precisely the
*behavioural* guarantee ADR-0008 said it was trading down to, applied to a bullet that still claims the
*structural* one. The honest replacement sentence is the one ADR-0008 already wrote for the bullet above it:
Chrome no longer refuses; our code declines.

**What is still structurally true, and worth keeping:** `chrome.debugger.getTargets` is genuinely never
called, and `tests/extension-cdp.test.ts` greps for it. That half of the bullet survives.

### 2.2 "Warning-free" is no longer why `tabs` and `webNavigation` are absent

[`extension/manifest.json`](../../extension/manifest.json)'s permission comment:

> `webNavigation costs the 'Read your browsing history' warning, and carries transitionType — the most`
> `semantically loaded signal there is […]. We give it up and take document.referrer plus Navigation Timing`
> `as partial substitutes.`

That was true under ADR-0002's scoped host permissions. Under `https://*/*` it is not — see
[§4.1](#41-the-finding-that-changes-the-arithmetic). Adding `webNavigation` to this manifest **adds no new
string to the install prompt**, and because Chrome decides "is this a privilege increase?" by comparing
rendered *messages* rather than permission IDs, adding it in an update would not even disable the extension
pending re-approval.

The exclusion may still be right. It is no longer right *for the reason written down*, and a reason that has
quietly stopped applying is the kind that gets overturned by the first person who checks.

---

## 3. The ranking

Ordered by what each buys divided by what it costs, for **this** product — a local-first thing whose entire
job is to name a subject and offer to continue it. Opinionated on purpose; the argument for each row is in
its section.

| # | Signal | What it buys | What it costs | Reversible? |
|---|---|---|---|---|
| **1** | `chrome.tabs` events + `query` (**already reachable, no permission**) | returns and tab-switches — the defect `content.js` and `visitsByUrl` both document and cannot fix; which strand is *in front of them right now* | **nothing.** No permission, no warning, no manifest change. Plausibly *reduces* steady-state CPU by replacing a per-page `setInterval` | Site access → "on click" in `chrome://extensions` |
| **2** | `tabGroups` | a **human-typed name for a thread** — the detector's own output, authored by the person | one honest warning: *"View and manage your tab groups."* Not on Google's named review-friction list | Yes — optional permission |
| **3** | `git status` / `git reflog` on allowlisted repos | which repo and branch *this second*; **90 days of attention-switching**, including abandoned work | no prompt, no token, no API — and **no OS revocation**, so the allowlist has to be ours | Only if we build it |
| **4** | `webNavigation` (`transitionType`) | typed-vs-link-vs-`form_submit`; SPA navigation without a document load | **no new warning** under `https://*/*`; not on the named review list | Optional-capable |
| **5** | `sessions.getRecentlyClosed` | the 25 most recently closed tabs — a research session's churn, which the in-memory buffer loses at process death | **no new warning**, which is itself the problem ([§4.4](#44-sessions-the-one-that-should-warn-and-does-not)). Decline `getDevices` | Optional-capable |
| **6** | Slack `users.profile:read` → `status_text` | the person **typing their own intent** into a field | one low scope — but workspace-admin approval may still gate the app entirely | Yes |
| **7** | Calendar, local (EventKit) | *how long they will be away, and what for*; `eventType: focusTime` / `outOfOffice` are declared intent | one prompt — but **there is no read-only tier**, so the button says *Allow Full Access* ([§5.4](#54-calendar--the-one-worth-a-prompt-with-a-cost-correction)). Plus a signed macOS helper that does not exist | Yes — System Settings |
| **8** | GitHub `Metadata` + `Issues` + `Pull requests`, read | "what am I working on" from a system of record | a token in `.env`; no verification, no review — but `Pull requests: read` **returns diffs**, so "we never see your code" breaks | Yes — revoke the token |
| **9** | `NSWorkspace` frontmost app | *"they left Chrome for their editor"* — separates **gone** from **working elsewhere**, which `detectPause` cannot | **no TCC prompt and no indicator at all** — which is a reason for caution, not comfort. Needs the macOS helper | Nothing to revoke; the switch would have to be ours |
| **10** | `readingList` / `bookmarks` | deliberate save-for-later — low volume, stated rather than inferred | one warning each; `bookmarks` over-asks (*"Read and change"*) for a read-only need | Optional-capable |
| **11** | `history` | `typedCount`, `visitCount`, and everything from before the process started | *"Read and change your browsing history on all signed-in devices"* — **not** absorbed, and the one warning consumers recognise | Optional-capable |
| **12** | Chrome's History SQLite file on disk | `keyword_search_terms` — literal omnibox text | **no prompt at all**, and it is locked while Chrome runs. The absence of a gate is the objection | Nothing to revoke |
| **13** | Gmail `gmail.metadata` | correspondents and subject lines | a **restricted** scope: CASA security assessment, annually, *"several weeks"* — **and** an approved-use-case list this product does not obviously fit | Yes, and expensive to get |
| **14** | Accessibility API tree | text from *other applications* | a TCC pane the app **cannot even prompt for**; no per-app scoping; Apple's own warning; incompatible with App Sandbox | Yes, and the pane is alarming |
| **15** | Rolling screenshot cache | everything, indiscriminately | Screen Recording TCC, recurring system alerts, a **restricted Apple entitlement framed as VNC-only**, 48 GB/month, and **a documented reversal** | Yes — but the promise does not come back |
| **16** | `CGEventTap` input monitoring | keystrokes | **excluded by the founding brief and by `SECURITY_AND_PRIVACY.md`.** Not a tradeoff; a line | — |

**Rows 1–5 are free or nearly free and are the whole of the recommendation.** Rows 6–9 are each worth one
ADR, separately. Rows 12–13 fail on cost, not on principle. Rows 15–16 are here because the brief asked for
them to be priced, not because the price is worth paying.

**The pattern across the top of this table is worth naming, because it recurs three times independently.**
The best signals are the ones a person **authored**: a tab group title (§4.3), a calendar `focusTime` block
(§6.2), a Slack `status_text` (§6.4), a branch name (§6.6). Every one of them is the output `topics.ts` and
`boundaries/subject.ts` spend their length trying to reconstruct, typed by the person, for free. **More
observation is the expensive way to guess at something people keep writing down.**

---

## 4. Chrome MV3 — what each permission actually costs

### 4.1 The finding that changes the arithmetic

Chrome's install prompt is not a list of permissions. It is a list of **messages**, generated by an ordered
rule engine in which each rule *consumes* the permissions it covers.

[`chrome_permission_message_provider.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_permission_message_provider.cc),
`GetPermissionMessagesHelper`, verbatim:

> `// Apply each of the rules, in order, to generate the messages for the given`
> `// permissions. Once a permission is used in a rule, remove it from the set`
> `// of available permissions so it cannot be applied to subsequent rules.`

The first host rule in
[`chrome_permission_message_rules.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_permission_message_rules.cc)
reads:

```cpp
// Full host access already allows DeclarativeWebRequest, reading the list
// of most frequently visited sites, and tab access.
{IDS_EXTENSION_PROMPT_WARNING_ALL_HOSTS,
 {APIPermissionID::kHostsAll},
 {APIPermissionID::kDeclarativeWebRequest,
  APIPermissionID::kDeclarativeNetRequestFeedback,
  APIPermissionID::kFavicon, APIPermissionID::kHostsAllReadOnly,
  APIPermissionID::kHostReadOnly, APIPermissionID::kHostReadWrite,
  APIPermissionID::kProcesses, APIPermissionID::kTab,
  APIPermissionID::kTopSites, APIPermissionID::kWebNavigation,
  APIPermissionID::kDeclarativeNetRequest,
  APIPermissionID::kWebAuthenticationProxy}},
```

The second list is the **absorb** list. And `https://*/*` does produce `kHostsAll` —
[`permission_set.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/permission_set.cc)'s
`InitShouldWarnAllHostsForHostPermissions` loops `pattern.MatchesEffectiveTld()`, and
[`url_pattern.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/url_pattern.cc)
opens that function with:

> `// Check if it matches all urls or is a pattern like http://*/*.`
> `if (match_all_urls_ || (match_subdomains_ && host_.empty())) { return true; }`

The public docs state the consequence in one sentence and then drop it:
*"Some permissions may not display warnings when paired with other permissions. For example, the `"tabs"`
warning won't show if the extension also requests `"<all_urls>"`."*
([Permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings))

**For this extension, which already declares `https://*/*`:**

| Permission | Warning if added today |
|---|---|
| `tabs` | **none** — absorbed |
| `webNavigation` | **none** — absorbed |
| `topSites` | **none** — absorbed |
| `favicon` | **none** — absorbed |
| `processes` | **none** — absorbed (dev-channel API; see §4.7) |
| `declarativeNetRequest` | **none** — absorbed |
| `sessions` | **none** — no rule fires on it alone (§4.4) |
| `history` | *"Read and change your browsing history on all signed-in devices."* — **not** absorbed |
| `bookmarks` | *"Read and change your bookmarks."* |
| `downloads` | *"Manage your downloads."* |
| `readingList` | *"Read and change entries in the reading list."* |
| `tabGroups` | *"View and manage your tab groups."* |
| `management` | *"Manage your apps, extensions, and themes."* |
| `nativeMessaging` | *"Communicate with cooperating native applications."* |
| `desktopCapture` | *"Capture content of your screen."* |
| `tabCapture` | *"Read and change all your data on all websites."* (already shown) |
| `clipboardRead` | *"Read data you copy and paste."* |
| `privacy` | *"Change your privacy-related settings."* |

Warning strings quoted from the
[Permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list). That page
also lists the permissions with **no warning at all**, which for our purposes are: `activeTab`, `alarms`,
`idle`, `offscreen`, `scripting`, `sessions`, `sidePanel`, `storage`, `unlimitedStorage`, `contextMenus`,
`identity`, `processes`, `system.display`, `declarativeNetRequestWithHostAccess`,
`declarativeNetRequestFeedback`, `userScripts`.

**And an update adding an absorbed permission does not require re-approval.**
`ChromePermissionMessageProvider::IsAPIOrManifestPrivilegeIncrease` builds the message lists for the granted
and the requested sets and compares *those*, not the IDs:

> `// Otherwise, check the actual messages - not all IDs result in a message,`
> `// and some messages can suppress others.`

Contrast the documented default: *"When an extension adds a new permission that triggers a warning it may
temporarily disable it. The extension will be re-enabled only after the user agrees to accept the new
permission."*

**This should make the product more cautious, not less.** A capability that can be added without the person
being asked again is exactly the capability that needs a decision written down, because Chrome will not stop
it and the person will not see it. The correct response to §4.1 is not "so we may as well take `tabs`" — it
is that the manifest's permission comment must stop citing a warning that no longer exists and state the
real reason, whatever that turns out to be.

**Caveat, stated.** Everything in §4.1 is read from Chromium source at `main`, not from a doc sentence, and
rule ordering is the load-bearing part. Before acting on it, load the extension unpacked with `tabs` added
and read the prompt. That is a five-minute experiment and this note is not a substitute for it.

### 4.2 What each API actually yields, and what it would buy detection

| API | Permission | What it yields | What detection gains that it cannot get today |
|---|---|---|---|
| `tabs.onActivated` / `onUpdated` / `query` | none (namespace is free); URL+title unscrubbed by host permission | tab id, window id, and — under `https://*/*` — `url`, `title`, `favIconUrl`, `pendingUrl` | **The `came-back` ground.** `content.js` documents its own defect: *"A back-navigation served from bfcache runs no script, and switching to a tab that is already loaded produces nothing at all — and both of those are somebody leaving a page and choosing to come back."* `onActivated` is exactly that event. `came-back` is one of three `INTENT_GROUNDS`, and one intent ground is required to offer work at all |
| `webNavigation.onCommitted` | `webNavigation` | `transitionType` ∈ {`link`, `typed`, `auto_bookmark`, `auto_subframe`, `manual_subframe`, `generated`, `start_page`, `form_submit`, `reload`, `keyword`, `keyword_generated`}; `transitionQualifiers` ∈ {`client_redirect`, `server_redirect`, `forward_back`, `from_address_bar`} | *Chose this* vs *was handed this* — the exact distinction `grounds.ts` spends its length arguing for ("**Intent separates pursuing from receiving**"). `typed` and `keyword` are pursuit; `link` from a newsletter is not. It is also the only clean fix for the `forward_back` case `visitsByUrl` currently cannot see |
| `webNavigation.onHistoryStateUpdated` | `webNavigation` | SPA navigations via the History API | Sites where the whole session is one document. Today a `pushState`-driven research session produces one navigation event and one dwell figure |
| `sessions.getRecentlyClosed` | `sessions` | up to `MAX_SESSION_RESULTS = 25` `Session{lastModified, tab?, window?}`; tab objects scrubbed by the same rule, so URL+title come through under `https://*/*` | Thread continuity across the tab churn a research session produces. Also survives an app restart in a way the in-memory buffer does not |
| `sessions.getDevices` | `sessions` + `tabs` | `Device{deviceName, sessions[]}` — tabs open on the person's **other** signed-in Chrome installs | Cross-device thread. Also the single most surprising thing on this list, and see §4.4 |
| `tabGroups.query` | `tabGroups` | `TabGroup{id, title?, color, collapsed, windowId, shared}` (Chrome 89+; `shared` 137+). **No host permission needed to read the title** | A **person-authored thread name**. `topics.ts` exists to reconstruct, by string arithmetic and Damerau-Levenshtein, a label a person would recognise; `boundaries/subject.ts` spends a model call on the same job. A tab group title is that label, typed by the person, for free |
| `readingList` | `readingList` | entries the person explicitly saved to read later | Deliberate deferral. Low volume, high signal, and *stated* rather than inferred |
| `bookmarks` | `bookmarks` | `BookmarkTreeNode` with `dateAdded`, `dateGroupModified`, folder structure | Same as above, plus folder names as an existing taxonomy of the person's own subjects |
| `downloads` | `downloads` | `DownloadItem` incl. `url`, `referrer`, `filename`, `mime`, `startTime` | A PDF downloaded mid-thread is strong investment evidence. But `referrer` on a download is *also* a URL from a tab we may not otherwise see, so it widens the surface sideways |
| `history.search` / `getVisits` | `history` | `HistoryItem{url, title, lastVisitTime, visitCount, typedCount}`, `VisitItem{transition, referringVisitId, visitTime, isLocal}`; `search()` default `maxResults` 100 | Everything before the app started, plus `typedCount` as a durable measure of intent. This is the only signal on the list that is *retrospective* |
| `topSites` | `topSites` | the person's most-frequently-visited sites | Little. A baseline against which "this is unusual for them" could be computed — a profile, which `SECURITY_AND_PRIVACY.md` forbids for `Intention` and should probably forbid here too |
| `idle` | `idle` (held) | `"active"` / `"idle"` / `"locked"`; default detection interval 60 s; `"locked"` when *"the screen is locked or the screensaver activates"* | Already the basis of the `away` observation and therefore of `detectPause` |
| `management` | `management` | every installed extension | Nothing this product needs. Listed to be rejected |
| `storage` / `alarms` / `scripting` / `offscreen` | as named | held or warning-free | Infrastructure, not signal |

### 4.3 `tabGroups` is the best signal in this table and it is not close

Everything else in §4.2 is a better *measurement* of the thing `detect.ts` already measures. `tabGroups` is a
different kind of thing: it is the person's own answer to the question the whole detection pipeline exists to
guess.

Read `topics.ts` next to it. That file contains a stopword list, a branding-suffix regex, a Damerau-Levenshtein
neighbour test with a measured argument about English word density over `/usr/share/dict/words`, a
canonicalisation pass whose comment warns that running it on one path and not the other would put *"the two
views of one page into disagreement about which word is on it"* — and the output of all of it is a ranked
list of recurring terms that `boundaries/subject.ts` then spends a model call turning into a sentence. A tab
group titled *"world models"* is that sentence, authored by the person, with no model call, no confidence
flag, and no possibility of a confidently-wrong name — the failure ADR-0008's *Revisit when* section names
first.

**What it costs:** one warning, *"View and manage your tab groups"*, which describes what it does. It is
optional-capable (see §4.6), so it can be requested at the moment it would help rather than at install.

**What it does not do:** most people do not use tab groups. This is a signal that is *excellent when present
and absent most of the time*, which is the right shape for an optional permission and the wrong shape for a
dependency. It should raise confidence and never gate detection.

### 4.4 `sessions`: the one that should warn and does not

`chrome.sessions` on its own is warning-free. `getRecentlyClosed()` returns up to
`MAX_SESSION_RESULTS = 25` sessions — `Session{lastModified, tab?, window?}`, and note `lastModified` is in
**seconds** since the epoch where every other Chrome timestamp is milliseconds. `getDevices()` returns
`Device{deviceName, sessions[]}` — tabs open on the person's **other signed-in Chrome devices**.

Chrome's own documentation is explicit that the combination is meant to warn. The
[permissions reference](https://developer.chrome.com/docs/extensions/reference/permissions-list) gives
`sessions` two conditional strings rather than none:

> with `history`: *"Read and change your browsing history on all your signed-in devices."*
> with `tabs`: *"Read your browsing history on all your signed-in devices."*

And Chromium's rules file agrees:

```cpp
{IDS_EXTENSION_PROMPT_WARNING_HISTORY_READ_ON_ALL_DEVICES,
 {APIPermissionID::kTab, APIPermissionID::kSessions},
 { … }},
// Note: kSessions allows reading history from other devices only if kTab
// is also present. Therefore, there are no _ON_ALL_DEVICES versions of
// the other rules that generate the HISTORY_READ warning.
```

That rule requires `kTab`. But the `kHostsAll` rule sits **earlier in the array** and lists `kTab` in its
absorb set, and the engine removes consumed permissions before later rules run. So an extension holding
`https://*/*` plus `tabs` plus `sessions` appears — by reading the source — to show **no cross-device
warning at all**, while being able to read the tab list of the person's other machines.

**The documentation and the source disagree here, and I am not going to resolve it by picking one.** The
reference page documents a warning for `sessions` + `tabs`; the rule ordering suggests `kHostsAll` consumes
`kTab` before that rule is reached. Both readings are defensible from a primary source, only one can be true
on a real install, and it takes five minutes to settle.

Either way the conclusion is the same, and it is not "take it": a capability whose own designers wrote a
warning for it, which may or may not be shown depending on an ordering artefact, is the definition of
something that needs a written decision rather than a permission-list edit. **Take `getRecentlyClosed`;
decline `getDevices` explicitly**, and say why in the manifest comment where the other refusals already live.

`getRecentlyClosed` on its own is a different matter and is genuinely useful — a research session closes tabs
constantly, and the in-memory ambient buffer loses them at process death.

### 4.5 Screenshots inside Chrome

Three distinct mechanisms, and only one of them is currently reachable.

**`tabs.captureVisibleTab` — not reachable today, and the reason is precise.**
[`permissions_data.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/permissions_data.cc),
`CanCaptureVisiblePage`:

```cpp
// Check if any of the host permissions match all urls.
for (const auto& pattern : active_permissions_unsafe_->explicit_hosts()) {
  if (pattern.match_all_urls()) { has_all_urls = true; break; }
}
…
if (!has_active_tab && !has_all_urls) {
  *error = manifest_errors::kAllURLOrActiveTabNeeded;
  return false;
}
```

`match_all_urls()` is the flag for the literal `<all_urls>` pattern. `https://*/*` does **not** set it —
[match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) documents
`<all_urls>` as *"any URL that starts with a permitted scheme"*, a superset. So the same string that is broad
enough to absorb the `tabs` warning is *not* broad enough to authorise a screenshot. That is a genuinely
useful asymmetry and it is worth not disturbing: adding `activeTab` (warning-free) plus a user gesture on the
extension action would open this door, and adding `<all_urls>` would open it without one.

Two more properties of `captureVisibleTab` worth knowing. It is rate-limited —
`MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND = 2`, because *"captureVisibleTab is expensive and should not be
called too often"* — and under `activeTab` specifically it reaches further than host permissions do: *"this
method allows extensions to capture sensitive sites that are otherwise restricted, including chrome:-scheme
pages, other extensions' pages, and data: URLs."*

**`chrome.tabCapture`** carries *"Read and change all your data on all websites"* — already shown — and
produces a media stream of a tab. It is gesture-gated in the same way: *"Capture can only be started on the
currently active tab after the extension has been invoked, similar to the way that activeTab works."*

**`chrome.desktopCapture`** carries *"Capture content of your screen."* and, by construction, shows Chrome's
own source picker listing screens, windows and tabs; the stream id *is* the user's selection, and *"If user
didn't select any source (i.e. canceled the prompt) then the callback is called with an empty streamId."*
There is no documented flag to bypass it.

**Now the question the brief actually asked, and the answer is uncomfortable.** The consent ordering is
inverted from intuition: the API with the mandatory picker carries the *narrower* warning, and the APIs with
no picker carry the broad one. And on indicators, Chrome's
[screen-capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture)
documents an indicator in exactly one place:

> *"For screen recording, call `getDisplayMedia()`, which triggers the dialog box shown below. This provides
> the user with the ability to select which tab, window or screen they wish to share **and provides a clear
> indication that recording is taking place**."*

while explicitly framing the tab-capture path as *skipping* a prompt:

> *"Calling `getDisplayMedia()` results in the browser showing a dialog which asks the user what they would
> like to share. **However, in some cases the user has just clicked on the action button to invoke your
> extension for a specific tab, and you would like to immediately start capturing the tab without this
> prompt.**"*

Chrome documents **no** capture indicator for `tabCapture`, `tabs.captureVisibleTab` or `pageCapture`. What it
documents instead is `getCapturedTabs()`, whose stated purpose is *"to inform the user that there is an
existing tab capture"* — i.e. Chrome expects the *extension* to tell the person.

**The defensible sentence, and it should be quoted carefully:** *Chrome documents a capture indicator only for
`getDisplayMedia()`; it documents none for `tabCapture` or `captureVisibleTab`.* Absence of documentation is
not proof that no browser-drawn UI exists — Chrome's own tab-strip capture indicator is an implementation
detail outside developer.chrome.com — so the claim "no indicator exists" is not one this note will make.

**For this product the ordering is the useful part.** Today `https://*/*` is not `<all_urls>`, so nothing can
be captured at all. Adding `activeTab` — warning-free, and the only optional permission that would enable
this — would put a screenshot of the person's current tab one user gesture away, with no install warning and,
by Chrome's own documentation, no promised indicator. That is precisely the kind of capability that should be
**refused in the manifest comment alongside `tabs` and `history`**, rather than left unmentioned because it
happens not to work yet.

### 4.6 What can be requested at runtime, and what cannot

`chrome.permissions.request()` lets a permission be moved out of the install prompt and asked for at the
moment it is needed — which is the correct shape for everything in §4.2 that is *nice when present*. The
authoritative list of what may not be optional is a flag in Chromium's permission tables
([`chrome_api_permissions.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_api_permissions.cc),
[`extensions_api_permissions.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/extensions_api_permissions.cc)),
`kFlagCannotBeOptional`.

Of the permissions relevant here, **only `debugger` cannot be optional**:

```cpp
{APIPermissionID::kDebugger, "debugger",
 APIPermissionInfo::kFlagImpliesFullURLAccess |
     APIPermissionInfo::kFlagCannotBeOptional |
     APIPermissionInfo::kFlagRequiresManagementUIWarning},
```

`tabs`, `history`, `webNavigation`, `topSites`, `sessions`, `readingList`, `tabGroups`, `downloads`,
`bookmarks`, `management`, `desktopCapture`, `tabCapture`, `favicon` and `activeTab` all carry no such flag
and can be requested at runtime. `declarativeNetRequest` and `unlimitedStorage` cannot.

**This matters for ADR-0010's ledger.** `debugger` — the permission that ADR-0010 itself calls *"the first
decision in this series whose net effect on safety is negative"* — is the one permission on this list that
**must** be declared at install and cannot be dropped without uninstalling the extension. That is not an
argument against ADR-0010, which made its case; it is a fact about revocability that the ADR does not state
and that belongs on its revisit list.

**Host permissions are revocable by the person without any code change.** Since Chrome 70, `chrome://extensions`
and the action's context menu let a person set an extension to run *on click*, *on specific sites*, or *on all
sites* ([user controls for host permissions](https://developer.chrome.com/docs/extensions/mv2/runtime-host-permissions)).
So the broad grant ADR-0008 took is, in the one dimension that matters to the person, reversible by them at
any time — and the product should behave well when it is, because *"capture is silently OFF"* with a `!`
badge is the shipped behaviour for a transport failure and should be the shipped behaviour for this too.

### 4.7 Web Store review friction — and this is where the free permissions stop being free

§4.1 shows that `tabs` and `webNavigation` cost no *warning*. They do cost *review*, and Chrome names them.

From [Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions/):

> *"Request access to the narrowest permissions necessary to implement your Product's features or services."*
> *"If more than one permission could be used to implement a feature, you must request those with the least
> access to data or functionality."*
> *"Don't attempt to 'future proof' your Product by requesting a permission that might benefit services or
> features that have not yet been implemented."*

From the [review process](https://developer.chrome.com/docs/webstore/review-process) page's own
*Notable factors that increase review time*, and this is the closest thing to a named list Google publishes:

> *"Host permissions patterns like `*://*/*`, `https://*/*`, and `<all_urls>` give extensions extensive
> access… Extensions with this kind of access can collect a user's browsing history, hijack web search
> behavior, scrape data"*

> *"Some permissions do this directly (for example, **`tabs` and `downloads`**) while others must be combined
> with host permissions grants (for example, **`cookies` and `webRequest`**). Review must verify that each
> requested permission is actually necessary… **Requesting powerful and potentially dangerous capabilities
> takes more time to review.**"*

Corroborated at [match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns):
*"Because it affects all hosts, Chrome web store reviews for extensions that use it may take longer."*

**So the honest cost table for §4.1 has a second column.** `https://*/*` already puts this extension in the
slow lane — that price was paid by ADR-0008. Adding `tabs` adds a second named factor to a review that is
already flagged, and Google states timing as *"within a few days, but it can take up to a few weeks."*
`webNavigation`, `sessions`, `tabGroups` and `readingList` are **not** on the named list; `tabs` and
`downloads` are. That is a real reason to prefer the §10 ordering, in which `tabs.onActivated` is used
**without the `tabs` permission** — which §2.1 establishes is possible — rather than declaring it.

Two more policy sentences bind the design rather than the permission list.

From [Limited use](https://developer.chrome.com/docs/webstore/program-policies/limited-use):

> *"Collection and use of web browsing activity is prohibited, except to the extent required for a
> user-facing feature described prominently in the Product's Chrome Web Store page and in the Product's user
> interface."*

Propositum's answer here is unusually good, and it is good *because of decisions already taken*: ambient
capture is bounded to 30 minutes and 500 rows, held in memory, discarded on decline, and exists solely to
produce an offer the person sees. That is a user-facing feature by any reading.

And from [quality guidelines](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines):

> *"An extension must have a single purpose that is narrow and easy to understand. **Don't create an extension
> that requires users to accept bundles of unrelated functionality.**"*

**That sentence is a constraint on this entire research note.** A design that collects bookmarks *and* reading
list *and* downloads *and* top sites *and* sessions *and* history, because each was individually cheap, is
precisely the bundle that policy names. The permission-by-permission framing of §4.2 makes each row look
affordable and hides the fact that the sum is a different product. Take few, and be able to say in one
sentence what each is for.

### 4.8 The service worker, alarms, and battery

**One correction to a widely-held number.** The `chrome.alarms` floor is **30 seconds, not one minute**, and
has been since Chrome 120: *"Chrome limits alarms to at most once every 30 seconds but may delay them an
arbitrary amount more. That is, setting `delayInMinutes` or `periodInMinutes` to less than `0.5` will not be
honored and will cause a warning"*
([`chrome.alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms)). The
[lifecycle page](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
dates it and gives the reason: *"Chrome 120 — Alarms can now be set to a minimum period of 30s to match the
service worker lifecycle."*

The three documented shutdown conditions, verbatim from that page:

> *"After 30 seconds of inactivity. Receiving an event or calling an extension API resets this timer."*
> *"When a single request, such as an event or API call, takes longer than 5 minutes to process."*
> *"When a `fetch()` response takes more than 30 seconds to arrive."*

The third is routinely overlooked and is directly relevant: the extension's ambient flush is a `fetch` to
loopback, and `flushAmbient` already puts a batch back when the app is unavailable — which is the correct
handling of exactly this case.

**And there is a policy line near where this extension sits.** From
[migrating to service workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers),
on keeping a worker alive artificially:

> *"We have identified enterprise and education as the biggest use cases, and we specifically allow this
> there, but we do not support this in general… **It is not allowed in other cases and the Chrome extension
> team reserves the right to take action against those extensions in the future.**"*

Propositum's 30-second `chrome.alarms` heartbeat is **not** that — alarms are the sanctioned mechanism and the
worker dies between them. Worth stating explicitly, because the alarm floor now *equals* the idle timeout, so
an alarm **wakes** a worker and cannot **sustain** one, and a future maintainer reaching for a shorter period
to "keep it alive" would be crossing a documented line rather than tuning a constant.

One useful escape hatch, unrelated to keepalive: an
[offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen) (warning-free,
Chrome 109+, one per extension) has **no lifetime limit** for any reason other than `AUDIO_PLAYBACK`, which
closes after 30 seconds of silence. It does not keep the service worker alive — only *messages sent from it*
reset the timer — but it can hold state across worker deaths without `chrome.storage.session`.

**On battery: Chrome documents nothing.** There is no MV3 extension-performance page (the URL 404s), and the
only Chrome-authored guidance on extension CPU cost is on the **deprecated MV2** page
([mv2/performance](https://developer.chrome.com/docs/extensions/mv2/performance)):

> *"An extension running content scripts in unnecessary locations or at inappropriate times can cause the
> browser to slow down… It is a drain on system resources to keep an unneeded script running."*

Chrome's framing throughout is CPU, memory and *"load on the user's machine"* — **never battery life**. Do not
attribute a battery claim to Chrome's documentation; there is none to attribute it to.

What can be said structurally, which is the part that matters for §10:

- Every API in §4.2 is **event-driven**, and events wake the worker rather than requiring it to stay alive.
  That is strictly cheaper than the current arrangement, in which `content.js` runs a `setInterval` at
  `REPORT_EVERY_MS = 15_000` **on every `https` page** — the exact pattern the MV2 performance page warns
  about. **Moving return-detection from a per-page interval to `tabs.onActivated` would plausibly reduce this
  extension's steady-state cost, not raise it**, which is unusual for a new capability and is part of why it
  ranks first.
- `chrome.idle`'s detection interval defaults to 60 seconds, bounding how often that path can fire. **No
  documented minimum exists** — the commonly repeated 15-second floor has no primary source I could find.
- The DevTools [Performance panel](https://developer.chrome.com/docs/devtools/performance/reference)
  documents a first-party/third-party table listing *"Extensions marked with `Extension` badges"* with main
  thread times. That is the citable way to measure this, and it is a measurement to take rather than a source
  to find.

---

## 5. macOS — what a background app can observe, and what it costs

**Read this paragraph before any of the detail.** Propositum has **no macOS binary**. It is a Next.js app, a
worker process and a Chrome extension. Every signal in this section requires shipping something that does not
exist: a signed, notarised helper, plus a
[native messaging host](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
manifest at `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/…` and the `nativeMessaging`
permission (*"Communicate with cooperating native applications."*) so the helper can reach the extension, plus
[`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice) registration to
keep it running — which itself surfaces *"a corresponding switch in the Login Items panel in System
Settings"*, because App Store Review Guideline 2.4.5(iii) says an app *"may not auto-launch or have other code
run automatically at startup or login **without consent**."*

**That cost is larger than every TCC prompt below put together**, and it is why §3 ranks the whole of macOS
below four Chrome APIs that need no code outside `service-worker.js`.

Figures marked **[VERIFIED]** were reproduced by execution on this machine (macOS 26.5.2, build 25F84) from a
process holding **no** TCC grants. Prompt strings marked **[OS STRING]** were recovered from the shipping
`TCC.framework` localization table — an Apple-authored artefact, but **not Apple documentation**, and the
distinction is flagged every time because it is exactly the kind of thing that gets quoted as if it were.

### 5.1 The structural fact that organises everything below

Apple's own index of purpose-string keys,
[Protected resources](https://developer.apple.com/documentation/bundleresources/protected-resources), lists 28
categories. **It contains no key for Accessibility, Input Monitoring, Screen Recording or Full Disk Access.**

That splits the platform in two, and the split is the opposite of what an intuition about "sensitivity" would
predict:

| Class | Gate | Can the app prompt? |
|---|---|---|
| Calendar, Reminders, Contacts, Desktop/Documents/Downloads, Focus | Info.plist purpose string + API call or first access | **Yes**, in-app, with your sentence |
| Screen Recording | TCC, no purpose-string key | Alert only — no sentence of yours |
| **Accessibility, Input Monitoring, Full Disk Access** | System Settings only | **No** |

Apple Platform Security's
[Controlling app access to files](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web)
marks Accessibility and full-storage access as not app-promptable, and the shipping `tccd` binary carries the
literal log string `Service kTCCServiceAccessibility does not allow prompting; returning preflight_unknown`.

**For a product whose whole argument is that permissions should be legible and revocable, this is decisive.**
The three most powerful capabilities are precisely the three where you cannot say *why* you want them. The
onboarding is a screenshot of System Settings and a request to please go and flip a switch, next to the
switches for screen readers and remote-control software.

### 5.2 The one that is free — and it is genuinely useful

**[VERIFIED]** with no TCC grants of any kind:

```
frontmost bundleID = com.apple.Terminal, name = Terminal     <- works, no permission
runningApplications count = 104                              <- works, no permission
window count (CGWindowListCopyWindowInfo) = 5                <- works, no permission
windows exposing kCGWindowName = 0                           <- GATED
```

[`NSWorkspace.shared.frontmostApplication`](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication)
(macOS 10.7+) — *"Returns the frontmost app, which is the app that receives key events"* — and
[`didActivateApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification)
(macOS 10.6+), whose `userInfo` carries the activated `NSRunningApplication`. Apple's documentation for
neither mentions any authorisation, and there is no TCC pane governing app *identity*. One trap Apple flags in
its own aside: *"To receive this notification, you must register using `NSWorkspace.notificationCenter`. If
you use a different notification center, you won't receive the notification."*

**Say the consequence plainly, because it is the uncomfortable half of a convenient finding: a permissionless
macOS app can build a complete, timestamped log of which application a person is in, all day, with no prompt
and no indicator.** That is app-level attention telemetry with no consent gate. It is *not* free of ethical
cost merely because it is free of TCC cost, and if Propositum builds it, the switch has to be ours, because
macOS supplies none.

**What it buys, precisely.** `detectPause` reads `chrome.idle` and treats *"no OS input for four minutes"* as
*"they stepped away."* That conflates two different afternoons — someone at lunch, and someone who switched to
their editor and is now working harder than before — and the offer it produces, *"want me to carry on while
you're gone"*, is right for the first and wrong for the second. A bundle identifier separates them in one
field. `chrome.idle` cannot, because it reports input, not focus.

### 5.3 The ones that cross a line

**Screen Recording, and the finding that collapses two questions into one.**

**[VERIFIED]** `SCShareableContent.excludingDesktopWindows(...)` fails without the grant with
`SCStreamErrorUserDeclined` (`-3801`, confirmed in the shipped `SCError.h` header): *"The user chose not to
authorize capture."* **You cannot even enumerate windows or applications without it.** And separately
**[VERIFIED]**, `CGWindowListCopyWindowInfo` returns `kCGWindowOwnerName`, `kCGWindowBounds`, `kCGWindowLayer`
and `kCGWindowNumber` with no permission — but **`kCGWindowName` is absent entirely**, not empty, for every
window including the caller's own.

**So window titles and screen pixels sit behind the same gate.** There is no cheaper way to learn *"which
document is this person editing"* than full Screen Recording. *"Which application are they in"* is free (§5.2);
*"what is it showing"* costs everything. That is the single most useful boundary in this section, and **Apple
documents neither half of it** — not on
[`CGWindowListCopyWindowInfo`](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)),
not on [`kCGWindowName`](https://developer.apple.com/documentation/coregraphics/kcgwindowname), not on
[`SCShareableContent`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent). It is
reproducible behaviour, not published contract, and it could change.

The rest of the gate: TCC service `ScreenCapture`, pane *"Screen & System Audio Recording"*, Info.plist key
`NSScreenCaptureUsageDescription` documented **only** on the
[ScreenCaptureKit landing page](https://developer.apple.com/documentation/screencapturekit), preflight and
request via `CGPreflightScreenCaptureAccess()` / `CGRequestScreenCaptureAccess()` — **both of which ship with
no abstract and no discussion at all**. **[OS STRING]** the alert:
`"%@" would like to capture the contents of the system display.` Apple's own sample notes that *"After you
grant permission, you need to restart the app to enable capture."*

**On the periodic re-authorisation that everyone repeats: the mechanism is primary-sourced, the cadence is
not.** What Apple actually documents is the macOS 15 release note that deprecated capture APIs *"can trigger
system alerts indicating they might be able to collect detailed information about the user"*, the macOS 15.1
note that *"Users will see fewer dialogs if they regularly use apps in which they have already acknowledged
and accepted the risks"*, and the macOS 15.1 MDM key `forceBypassScreenCaptureAlert`, which *"allows owners of
managed devices to **opt out of user notifications for content capture technologies**."* An MDM opt-out for
recurring capture notifications is Apple confirming they recur. **The weekly-then-monthly cadence and its
wording are press-only and are not asserted here.**

**And there is a gate above the gate, which effectively settles §9.1.** The escape hatch from repeated alerts
is the entitlement
[`com.apple.developer.persistent-content-capture`](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.persistent-content-capture)
(macOS 14.4+) — described by Apple as *"whether a **Virtual Network Computing (VNC) app** needs persistent
access to screen capture"*, and gated: *"Before your app can use this entitlement, request permission to use
it by submitting the Persistent Content Capture Entitlement Request form. After receiving permission from
Apple…"* **A rolling screenshot cache is, in Apple's taxonomy, exactly the thing this restricted entitlement
governs, and Apple frames it as VNC-only.** A general background observer should not plan on being granted it,
and without it the product's core loop is punctuated by system alerts it cannot suppress.

**Accessibility.** No Info.plist key — verified three ways (absent from Protected resources, absent from the
`tccutil` service table's usage-description column, no such key in the property-list reference). The gate is
[`AXIsProcessTrustedWithOptions`](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions),
whose sole option `kAXTrustedCheckOptionPrompt` merely *informs*: *"Prompting occurs asynchronously and does
not affect the return value."* There is no grant callback. **[VERIFIED]** without it, another app's
`kAXWindowsAttribute` returns `kAXErrorAPIDisabled` (`-25211`) and the system-wide focused element returns
`kAXErrorCannotComplete` (`-25204`) — the tree is fully opaque, and those two codes are a reliable detector.

Apple's own description of what granting it means is the strongest argument against it, and it is Apple's
sentence:

> *"If you give apps access to your Mac, you also give them access to your contact, calendar, and other
> information."*
> *"Be cautious and grant access only to apps that you know and trust."*
> — [Allow accessibility apps to access your Mac](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac)

There is no per-application scoping, no indicator, and — per Apple Staff on the developer forums, though **not
in any reference documentation** — *"It is not possible to use the accessibility API from a sandboxed app.
This will not work even if the user manually grants it permission."* Since Mac App Store distribution requires
App Sandbox, taking Accessibility is also choosing Developer ID distribution.

**Input Monitoring.** TCC service `ListenEvent`, and Apple's MDM reference is the clearest statement of scope
anywhere in the docs: *"Allows the application to use CoreGraphics and HID APIs to **listen to (receive)
CGEvents and HID events from all processes**."* The user-facing description is *"Some apps can monitor your
keyboard, mouse, or trackpad even when you're using other apps"*
([Apple support](https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac)).
No Info.plist key, no prompt, no indicator. `CGPreflightListenEventAccess()` and
`CGRequestListenEventAccess()` are the entire public API and **both ship with no abstract and no discussion**.

This is keystroke logging. It is excluded by the founding brief and by `SECURITY_AND_PRIVACY.md`, it is priced
here only because the brief asked, and it is not a candidate. See §9.2.

**Full Disk Access.** The cleanest answer in this section, and it is Apple's own, from
[Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox):

> *"**Your app can't automatically gain full disk access through an entitlement or with code: the person using
> your app must choose to grant access in System Settings > Privacy & Security.**"*

There is no `NSFullDiskAccessUsageDescription`. What it covers, in Apple's user-facing words: *"all files on
your computer, including data from other apps (for example, Mail, Messages, Safari, and Home), data from Time
Machine backups, and certain administrative settings for all users on this Mac."*

The **narrower** folder grants do prompt in-app, automatically, triggered by the filesystem operation rather
than by an API call. **[OS STRING]**, and this settles a question the brief flagged as uncertain — the
template really is:

| Key | Prompt |
|---|---|
| `NSDesktopFolderUsageDescription` | `"%@" would like to access files in your Desktop folder.` |
| `NSDocumentsFolderUsageDescription` | `"%@" would like to access files in your Documents folder.` |
| `NSDownloadsFolderUsageDescription` | `"%@" would like to access files in your Downloads folder.` |

Apple documents only the structure — *"The system automatically generates the prompt's title, which includes
the name of your app"* — and notes the usage description is *"optional, but highly recommended."*

### 5.4 Calendar — the one worth a prompt, with a cost correction

EventKit's authorisation surface is explicit
([`EKEventStore`](https://developer.apple.com/documentation/eventkit/ekeventstore)):
`requestFullAccessToEvents(completion:)` and `requestWriteOnlyAccessToEvents(completion:)`, macOS 14+, with
`EKAuthorizationStatus.fullAccess` / `.writeOnly` and the undifferentiated `.authorized` deprecated. Purpose
strings `NSCalendarsFullAccessUsageDescription` (*"A message that tells people why the app is requesting
access to read and write their calendar data"*) and `NSCalendarsWriteOnlyAccessUsageDescription`.

**[OS STRING]** the prompts, and note the OS models three tiers:

- `kTCCServiceCalendar_ADD` → `"%@" would like to add to your Calendar.` — button `Allow`
- `kTCCServiceCalendar_FULL` → `"%@" would like full access to your Calendar.` — button **`Allow Full Access`**
- `kTCCServiceReminders` → `"%@" would like to access your Reminders.`

**And here is the correction to the cheerful version of this in §6.2.** Apple, verbatim from
[Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store):

> *"**NOTE:** Your app can't request read-only access to either events or reminders. To read events or
> reminders from the event store, your app needs full access."*

**There is no read-only calendar tier on macOS.** A product that wants to know *"how long will they be away"*
must ask for **read and write** access to every calendar the Mac syncs, and the button the person presses says
*Allow Full Access*. That is a materially worse ask than Google's `calendar.freebusy`, and it is the one place
in this note where the OAuth path is *narrower* than the local one. It does not reverse §6.2's conclusion —
one dialog still beats verification plus a demo video — but it should be stated in the product's own words
rather than discovered by the first person who reads the prompt.

Two further facts worth having before designing around it. Apple: *"The operating system only prompts them the
first time your app requests full access to events"*, and — a real trap — *"If you request events before
prompting people for access with this method, you'll need to reset the event store with the `reset()` method
to receive data after they grant access."* And a privacy note this document should surface rather than
inherit: `EKEvent.birthdayContactIdentifier` is *"the contact identifier (for use with the Contacts
framework)"* — full calendar access hands you Contacts join keys.

### 5.5 Focus state — the API exists and answers a different question

**Correcting a common assumption:** [`INFocusStatusCenter`](https://developer.apple.com/documentation/intents/infocusstatuscenter)
is **macOS 12.0+**, not iOS-only. `requestAuthorization`, `authorizationStatus`, `focusStatus`, purpose string
`NSFocusStatusUsageDescription`. **[OS STRING]** the prompt is unusually well-worded:
`Allow "%@" to share that you have notifications silenced when using Focus?`

But [`INFocusStatus`](https://developer.apple.com/documentation/intents/infocusstatus) exposes **exactly one
property**: `isFocused: Bool?`. No mode name, no identifier, no schedule, no end time. And the semantics are
app-relative, verbatim: *"**The perspective of the app is important; the user doesn't appear focused to an app
if an enabled Focus allows notifications from that app.**"*

So it answers *"am I currently silenced for this person"*, not *"is this person in Do Not Disturb."* There is
no change notification and no KVO; the documented observation path is an Intents app extension. **No public
API exposes the Focus mode's identity**, and reading `com.apple.donotdisturb` is unsupported and undocumented.
A design that wanted *"they are in Deep Work until 3pm"* should use the calendar (§5.4), not this.

### 5.6 File system events

`FSEventStreamCreate` has **no TCC service, no entitlement and no pane.** Apple's only documented gate is
POSIX, from the archived
[File System Event Security](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/FileSystemEventSecurity/FileSystemEventSecurity.html):
*"users do not receive any events unless the user can reach the modified directory through standard file
system permissions"*, and *"Only applications running as the root user can be guaranteed to receive all
events."*

Two properties make it a good fit for a background observer, both Apple's words. Event IDs *"are guaranteed to
always be increasing… **even across system reboots and moving drives from one machine to another**"*, so
persisting `FSEventStreamGetLatestEventId()` gives a durable replay cursor — which is the same shape as
`ObservationEvent.seq` and would compose with it. And the default deferring mode is the one Apple recommends
for exactly this: *"Specifying a larger value may result in more effective temporal coalescing"*, and the
`NoDefer` flag's discussion says the default *"is more appropriate for background, daemon or batch processing
apps."* Apple's own sample uses a 3-second latency.

**UNVERIFIED, and it is the question that decides whether this works:** no Apple source states whether FSEvents
delivers events for TCC-protected paths — Desktop, Documents, Downloads — to an app lacking the folder grant.
That security chapter predates TCC by a decade and the App Sandbox documentation does not mention FSEvents at
all. Design so that *"the watch returns nothing"* is detectable rather than silent. Also unverified, and
universally assumed: whether `NSMetadataQuery` / Spotlight results are TCC-filtered.

Every `Item*` flag — `ItemCreated`, `ItemRenamed`, `ItemModified` and the rest — **ships with a declaration and
no description**, so rename-pairing semantics in particular are undocumented. Do not write invented semantics
into a design.

### 5.7 Battery, and the API Apple actually recommends

Apple documents the *policy inputs* and publishes **no quantitative energy data for anything** — no wattage,
no drain percentages, and specifically nothing for ScreenCaptureKit, FSEvents or accessibility observers.

What exists:

- [`ProcessInfo.ThermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)
  (macOS 10.10.3+), with per-state guidance in the archived energy guide — at `.serious`, *"Reduce CPU usage.
  Reduce GPU usage. Reduce I/O."* Gotcha, verbatim: *"To receive `thermalStateDidChangeNotification`, you must
  access the `thermalState` prior to registering for the notification."*
- `isLowPowerModeEnabled` (macOS 12+). **What it actually does on a Mac is undocumented** — Apple's prose for
  it is iPhone-specific.
- **App Nap is not a solution**, and Apple says so: *"The preceding measures do not necessarily save energy.
  They primarily reduce a non-foreground app's impact on other apps. **Don't rely on App Nap to get your app
  to fully idle.**"*
- **[`NSBackgroundActivityScheduler`](https://developer.apple.com/documentation/foundation/nsbackgroundactivityscheduler)
  is the API Apple recommends for precisely this shape of work**, macOS-only, 10.10+: *"`NSBackgroundActivityScheduler`
  gives the system flexibility to determine the most efficient time to execute based on energy usage, thermal
  conditions, and CPU use"*, with *"Activities occurring in intervals of 10 minutes or more"* named as the
  target case. It wraps `beginActivity` automatically. If a macOS helper is ever built, this is what it should
  poll on rather than a timer — and note Apple's named anti-pattern is *"Polling for state changes instead of
  responding to events."*

---

## 6. Structured sources — the ones that are not observation at all

The interesting property of this category: **none of it requires watching anybody.** A calendar entry, an
open pull request, a branch checkout is a statement the person already made, to a system of record, on
purpose. That is categorically better evidence of intent than dwell time, and it is why this section
outranks most of §5 despite the consent friction.

It also contains this note's second-most-useful sentence, which is about the local sources at the end:
**the absence of a prompt is not permission.**

### 6.1 Gmail — and the finding that inverts the obvious plan

The obvious plan is *"take the metadata scope, not the read scope — subject lines and participants, never
bodies."* Two things are wrong with it, and they are wrong in opposite directions.

**First: `gmail.metadata` gives you more than the name suggests.** Google's
[`Format` enum](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format) defines
`metadata` as *"Returns only email message ID, labels, and email headers"*, and both `full` and `raw` carry
the note *"Format cannot be used when accessing the api using the gmail.metadata scope."* Since Subject,
From, To and Date are RFC 5322 **headers**, the subject line and the full participant list come through.
`messages.get` even accepts `metadataHeaders` — *"When given and format is `METADATA`, only include headers
specified"* — so the app can narrow server-side to exactly `Subject`, `From`, `To`, `Date`.

The real restriction is elsewhere and is operationally worse:
[`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list)'s
`q` parameter carries *"Parameter cannot be used when accessing the api using the gmail.metadata scope."*
**No server-side search.** You page over label-filtered IDs and filter client-side.

**Second: the narrow scope costs exactly what the wide one costs.** From
[Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) and confirmed against
Google's canonical [restricted-scope list](https://support.google.com/cloud/answer/13464325):

| Scope | Google's description | Class |
|---|---|---|
| `https://www.googleapis.com/auth/gmail.metadata` | *"View your email message metadata such as labels and headers, but not the email body."* | **Restricted** |
| `https://www.googleapis.com/auth/gmail.readonly` | *"View your email messages and settings."* | **Restricted** |
| `https://mail.google.com/` | *"Read, compose, send, and permanently delete all your email from Gmail."* | **Restricted** |
| `https://www.googleapis.com/auth/gmail.labels` | *"See and edit your email labels."* | Non-sensitive |
| `https://www.googleapis.com/auth/gmail.addons.current.message.metadata` | *"View your email message metadata when the add-on is running."* | Sensitive |

Restricted means, from
[Google's own verification page](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification):

> *"Every app that requests access to Google users' restricted data and has the ability to access data from
> or through a third-party server must go through a security assessment from Google-empanelled security
> assessors."*

repeated *"at least every 12 months"*, with the process taking *"several weeks"*. (For contrast,
[sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
requires a justification and a demo video and *"can take up to 10 days"*, with no assessment.) Google
publishes no cost figure for CASA — **UNVERIFIED**, and the circulating numbers are all vendor blogs.

**Third, and this is the one that actually decides it.** The
[Gmail API policy](https://developers.google.com/workspace/gmail/api/policy) enumerates the *only* approved
use cases for Gmail scopes: email clients; automatic backup; *"applications that enhance the email
experience for productivity purposes"*; and *"applications that use information from emails to provide
reporting or monitoring services for the benefit of users that improve the email experience."*

A general "notice what this person is working on" tool is not obviously any of those. The third is the only
plausible fit and it requires the feature to be *about email* and prominent in the UI. **That is not a delay
to plan around, it is a rejection to plan around**, and it is the clearest "no" in this note.

**The one cheap exception, and it is not a background source.** The add-on scope
`gmail.addons.current.message.metadata` is classed *Sensitive*, not Restricted, and Google describes it as
granting *"temporary access to the open message's metadata (such as the subject or recipients)"*
([Workspace add-on scopes](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes)).
Subject and recipients, no CASA — but only while the person is looking at that message, in the Gmail UI. It
cannot poll and cannot see anything they are not already reading. Useless for ambient detection; exactly
right for a *"help me with this thread"* gesture, which is a different product than the one being designed.

**UNVERIFIED and worth testing before any design leans either way:** whether `Message.snippet` — *"A short
part of the message text"* — is populated under `format=metadata`. The enum wording implies not. If it were,
body text would be leaking under a scope named *metadata*.

### 6.2 Calendar — the bargain, and why the local path still wins

**No Google Calendar scope is restricted.** Verified by absence: Google's canonical restricted list covers
Gmail, Drive, Fit, Chat, Data Portability, Photos Ambient and Health. Calendar does not appear on it at all.
That single fact is the largest cost asymmetry in this section — Calendar buys a large share of Gmail's
intent signal without ever triggering CASA.

From [Calendar API auth](https://developers.google.com/workspace/calendar/api/auth), verbatim:

| Scope | Description |
|---|---|
| `.../auth/calendar.readonly` | *"See and download any calendar you can access using your Calendar."* |
| `.../auth/calendar.events.readonly` | *"View events on all your calendars."* |
| `.../auth/calendar.events.owned.readonly` | *"See the events on Google calendars you own."* |
| `.../auth/calendar.events.freebusy` | *"See the availability on Google calendars you have access to."* |
| `.../auth/calendar.freebusy` | *"View your availability in your calendars."* |
| `.../auth/calendar.calendarlist.readonly` | *"See the list of Google calendars you're subscribed to."* |
| `.../auth/calendar.settings.readonly` | *"View your Calendar settings."* |

**`freebusy` is times without titles.** [`freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)
returns only `calendars.(key).busy[]`, each entry a bare `start`/`end` — *"List of time ranges during which
this calendar should be regarded as busy."* For the question `detectPause` actually has — *how long will
they be gone* — that is sufficient, and it is the most defensible thing to ask for.

**The full Event resource contains something better than a title.**
[`Events`](https://developers.google.com/workspace/calendar/api/v3/reference/events) carries `summary`,
`description`, `attendees[]` with `responseStatus`, `organizer`, `conferenceData`, `attachments` — and
`eventType`, whose values include **`focusTime`** and **`outOfOffice`**. Those two are *the person declaring
their own intent in a structured field*. Nothing inferred from browsing comes close, and this is the same
argument §4.3 makes for tab group titles: the best signal is the one the human typed.

**But EventKit still beats it for this product**, and not on scope width:

- **No network, no second credential.** `SECURITY_AND_PRIVACY.md`: *"Everything is local… The single
  exception: prompts sent to the Anthropic API."* One OAuth refresh token doubles the secret set and adds a
  failure mode (expired token) that must be surfaced somewhere.
- **One OS dialog against verification-plus-video.** EventKit needs no app verification, no demo video, no
  assessment, no annual reassessment, and no admin.
- **It reads every account the Mac syncs** — Google *and* iCloud *and* Exchange — in one query.

The API is explicit about the read/write split
([`EKEventStore`](https://developer.apple.com/documentation/eventkit/ekeventstore)):
`requestFullAccessToEvents(completion:)` and `requestWriteOnlyAccessToEvents(completion:)`, macOS 14+, with
`EKAuthorizationStatus.fullAccess` / `.writeOnly` and the old undifferentiated `.authorized` deprecated as an
alias. Purpose strings: `NSCalendarsFullAccessUsageDescription` — Apple's abstract, *"A message that tells
people why the app is requesting access to read and write their calendar data"* — and
`NSCalendarsWriteOnlyAccessUsageDescription`. Apple on the prompt's lifetime:

> *"The operating system only prompts them the first time your app requests full access to events; any
> subsequent instantiations of \[the store\] uses existing permissions."*

One documented limit worth knowing before designing around it: `predicateForEvents(withStart:end:calendars:)`
*"will only return events within a four year timespan"*, for performance.

**CalDAV, briefly.** [RFC 4791](https://www.rfc-editor.org/rfc/rfc4791) is real and defines
`CALDAV:free-busy-query` — the same cheap-signal trade, in an open protocol — with discovery in
[RFC 6764](https://www.rfc-editor.org/rfc/rfc6764). **iCloud's CalDAV endpoint is undocumented and
unsupported by Apple**: no Apple developer or support page names it, documents its authentication, or commits
to its stability. Third-party clients use it anyway. Building on it means depending on an interface Apple has
never promised to keep, and on a Mac EventKit is strictly better on every axis.

### 6.3 GitHub — the best ratio here, with one hole in the privacy claim

GitHub steers you away from OAuth App scopes in its own words: *"Consider building a GitHub App instead of an
OAuth app. GitHub Apps use fine-grained permissions instead of scopes, which give you more control over what
your app can do."* ([OAuth scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)).
The reason is stark: **there is no read-only repo scope**. `repo` is *"Full access to public and private
repositories with read/write to code, statuses, invitations, and webhooks."*

Fine-grained permissions
([reference](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens))
give a genuinely narrow read set:

| Want | Endpoint | Permission |
|---|---|---|
| Repos I touched recently | `GET /user/repos` | **Metadata: read** — listed under Metadata, *not* Contents |
| My open PRs | `GET /repos/{owner}/{repo}/pulls` | **Pull requests: read** |
| Issues assigned to me | `GET /issues` (default `filter=assigned`) | **Issues: read** |
| My recent commits | `GET /repos/{owner}/{repo}/commits` | **Contents: read** |

**So `Metadata` + `Issues` + `Pull requests`, with `Contents` unselected, answers "what am I working on"
without granting arbitrary code read.** That is the recommendation.

**And here is the hole, which matters because it would break a sentence this product would want to say.**
GitHub's own table lists `GET /repos/{owner}/{repo}/pulls/{pull_number}/files` at **Pull requests: read**
with *no additional permissions required* — and that endpoint returns per-file **patches**. So *"we never
see your code"* is false the moment `Pull requests: read` is granted. The honest sentence is *"we see code
only where you have already opened a pull request"*, or the permission is not requested.

Two more, both useful:

- **`GET /users/{username}/events`** with the account-level **Events: read** permission is the closest thing
  to a single "what has this person been doing" feed — pushes, PR opens, issue comments, across all repos,
  behind one permission and no repository permissions at all. Bounded, verbatim: *"The timeline will include
  up to 300 events. Only events created within the past 30 days will be included."* That ceiling is fine for
  current intent and useless for history — which is the right shape for this product.
- **`GET /notifications` is a trap**: *"These endpoints only support authentication using a personal access
  token (classic)"* and require the `notifications` or `repo` scope. Reaching it forces you back to a classic
  token and the coarse scopes. Do not build on it.

**UNVERIFIED:** the widely-repeated claim that `Metadata: read` is *mandatory* on a fine-grained token. The
token-creation UI marks it so; no GitHub documentation page states it.

### 6.4 Slack — one cheap signal, and terms that forbid the obvious architecture

The cheap signal first, because it is genuinely good and almost free.
[`users.profile.get`](https://docs.slack.dev/reference/methods/users.profile.get) under `users.profile:read`
(*"View profile details about people in a workspace"*) returns `status_text` — *"The displayed text of up to
100 characters"* — plus `status_emoji` and `status_expiration`. **That is the person typing their current
intent into a field.** No message content, no history scope, no search. It is the same category as a tab
group title and a `focusTime` calendar block, and by now the pattern is the point of this whole note.

One tier up, `channels:read` (*"View basic information about public channels in a workspace"*) plus
[`users.conversations`](https://docs.slack.dev/reference/methods/users.conversations) gives channel names
with no message content at all. `#project-atlas` is a topic label.

Everything beyond that gets expensive fast:

| Scope | Description | Tokens |
|---|---|---|
| `channels:history` | *"View messages and other content in public channels that your Slack app has been added to"* | Bot, User |
| `groups:history` | *"View messages and other content in private channels that your Slack app has been added to"* | Bot, User |
| `im:history` | *"View messages and other content in direct messages that your Slack app has been added to"* | Bot, User |
| `mpim:history` | *"View messages and other content in group direct messages that your Slack app has been added to"* | Bot, User |
| `search:read` | *"Search a workspace's content"* | **User only** |

Note the repeated *"that your Slack app has been added to"* — a bot must be invited to each conversation
individually, which is unworkable for ambient coverage and is exactly what pushes designs toward a **user
token**, which acts as the person. [`search:read`](https://docs.slack.dev/reference/scopes/search.read)
confirms *"Supported token types: User"* — the only workspace-wide search is the largest grant available.

**And then the [Slack API Terms](https://slack.com/terms-of-service/api) close the door on the architecture
anyone would build**, verbatim:

> *"When using these APIs as a third-party Application provider, you may not create persistent copies,
> archives, indexes, or long-term data stores of other organizations' API Data."*

with temporary storage permitted only *"to the extent it is essential for the immediate operation"* and
*"deleted promptly"*, and a flat prohibition on using API Data *"to train a large language model."*

So: no durable index, no embeddings store, no retention. Anything Slack contributes must be computed on the
fly and discarded. Add workspace-admin approval on top and Slack is, for a single-user local product, a
`status_text` read and nothing more.

### 6.5 Notion, Linear, Asana, Jira

**Notion has no scopes.** It uses per-integration **capabilities** plus per-page sharing
([authorization](https://developers.notion.com/docs/authorization), [capabilities](https://developers.notion.com/reference/capabilities)):
*Read content*, *Update content*, *Insert content*, *Read comments*, *Insert comments*, and a three-way user
setting (*No user information* / *without email addresses* / *with email addresses*). Access is bounded by
what the person shares: *"Before a connection can interact with your Notion workspace page(s), the page must
be manually shared with the connection."* And a good property, verbatim: *"A connection's capabilities will
never supersede a user's."*

The [search endpoint](https://developers.notion.com/reference/post-search) returns only pages *"that have
been shared with a connection"* and sorts by `last_edited_time`. **Sorted descending with an empty query,
that is "the documents this person touched most recently", in order, without reading a single page body** —
titles plus recency, which is often the whole signal. Narrowest useful configuration: *Read content* +
*No user information*.

**Linear** ([OAuth](https://linear.app/developers/oauth-2-0-authentication)) has nothing narrower than
`read` — *"(Default) Read access for the user's account. This scope will always be present."* All-or-nothing.
**Asana** ([OAuth scopes](https://developers.asana.com/docs/oauth-scopes)) has the best granularity of the
three: `tasks:read` + `projects:read` + `users:read`, with the caveat *"scopes are not yet available for
every Asana API endpoint."* **Jira** — **UNVERIFIED**: Atlassian's granular-scopes reference 404'd at the
documented URL. What is confirmed from
[3LO apps](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) is the useful design point:
*"users' existing permissions always constrain what apps can access, regardless of granted scopes."*

### 6.6 Local files — no prompt, which is the problem

The highest-confidence findings in this section, and the ones with the best ratio, need no API at all.

**Git is the sharpest "right now" signal available anywhere.**

- `git status --porcelain=v2 --branch` emits `# branch.head <name>`, `# branch.upstream`, `# branch.ab +n -m`
  ([docs](https://git-scm.com/docs/git-status)). Which repository, which branch, clean or dirty, ahead or
  behind — at second resolution, at zero consent cost. For an engineer, *"they are on
  `direction/persistent-intentions` with uncommitted changes"* is a better subject label than anything
  `topics.ts` can reconstruct from page titles.
- **`git reflog` is the one nobody thinks of, and it is the best fit for this product in the entire note.**
  *"Reference logs, or 'reflogs', record when the tips of branches and other references were updated"*
  ([docs](https://git-scm.com/docs/git-reflog)). Entries read like
  `HEAD@{2026-08-16 10:05:11 -0700}: checkout: moving from main to direction/persistent-intentions`.
  **`git log` shows what was committed; the reflog shows what the person did** — branch switches, resets,
  rebases, abandoned work. That is a timestamped trace of *attention and context-switching*, which is
  precisely what `detectWork` is trying to reconstruct from dwell time. Retention is free and self-pruning:
  `gc.reflogExpire` *"defaults to 90 days"* ([git-gc](https://git-scm.com/docs/git-gc)).
- One trap: `git log --since` filters on **committer** date, not author date, so a rebase an hour ago drops
  months of old work inside the window. Git's documentation does not state which field is used — **verified
  by execution rather than by citation**. Prefer `--since-as-filter`, documented as *"visits all commits in
  the range, rather than stopping at the first commit which is older than `<date>`"*.
- **Consent: none. Revocation: none exists.** A user-editable allowlist of repository paths is the only
  honest revocation surface, and it has to be ours.

**Chrome's own History database.** Path from
[Chromium's docs](https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md):
`~/Library/Application Support/Google/Chrome/<profile>`. The schema is in Chromium source —
[`url_database.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/url_database.cc)
(`urls`: `url`, `title`, `visit_count`, `typed_count`, `last_visit_time`) and
[`visit_database.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/visit_database.cc)
(`visits`: `visit_time`, `from_visit`, `transition`, `visit_duration`). There is also a
`keyword_search_terms` table holding **the literal text typed into the omnibox** — the most direct statement
of intent available locally.

Three facts that decide whether this is usable:

1. **It does not require Full Disk Access.** Verified by execution on this machine (macOS 26.5.2): a
   Terminal-parented process that is refused `~/Library/Safari` reads the Chrome History file with no prompt.
   **UNVERIFIED** why `SystemPolicyAppData` does not fire; Apple documents that service only in an
   [MDM payload reference](https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary)
   (*"Specifies the policies for the app to access the data of other apps"*), and a future macOS may begin
   prompting. Treat `EPERM` as a first-class state.
2. **It is locked while Chrome runs.** `history_database.cc` executes `PRAGMA locking_mode=EXCLUSIVE`, under
   which [SQLite](https://www.sqlite.org/pragma.html) states *"no other process can access the database
   file."* Verified: opening it read-only with Chrome running returns `database is locked (5)`. The workaround
   is to copy the file and its `-wal`/`-shm` siblings and read the copy — **not** `immutable=1`, which SQLite
   itself warns *"might return incorrect query results and/or SQLITE_CORRUPT errors"* if the file changes.
3. **Timestamps are Windows-epoch microseconds.** `unix_seconds = value/1000000 - 11644473600`, from
   [`time.h`](https://chromium.googlesource.com/chromium/src/+/main/base/time/time.h)'s
   `kMicrosecondsFromWindowsToUnixEpoch`.

**Shell history is the one to leave alone.** zsh has no default history file — `HISTFILE` is
*"If unset, the history is not saved"* ([zsh parameters](https://zsh.sourceforge.io/Doc/Release/Parameters.html))
— and Apple's shipped `/etc/zshrc` sets `HISTSIZE=2000`, `SAVEHIST=1000` without `EXTENDED_HISTORY`, so
**there are no timestamps on disk**, and without `INC_APPEND_HISTORY` nothing is written until the shell
exits. A "what are they doing right now" feature cannot use it. Meanwhile it is the highest-sensitivity file
on the list — secrets pasted into `export` and `curl -H` live there — behind nothing but a 0600 file mode.

**Which is the general point of this subsection, and it deserves to be the sentence somebody quotes:
Chrome history and shell history are the two most revealing sources on this machine and neither of them
prompts. The absence of an OS consent gate is not consent.** If either is ever read, this product has to
manufacture the prompt and the revocation switch itself, because macOS will not — and a product whose whole
argument is *"Chrome enforces the constraint, not our code"* would be reaching for the one class of data
where nothing enforces anything.

---

## 7. On-device inference — what is actually available on this Mac

This matters because [ADR-0008](../adr/0008-ambient-detection.md) already runs a model call for detection.
`boundaries/subject.ts` is *"the seventh boundary, and the only one that runs with no session and no
contract"*, sending titles and search terms to Anthropic to name a thread. That is the one place a local model
would change the privacy story rather than just the bill.

### 7.1 Apple Foundation Models — the right shape, three hard limits, one bespoke adapter

Apple ships a ~3B-parameter on-device model behind `import FoundationModels`
([SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel), macOS
26.0+), described in [Apple's 2025 tech report](https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025)
as a *"~3B-parameter on-device model optimized for Apple silicon through architectural innovations such as
KV-cache sharing and 2-bit quantization-aware training."* Apple scopes it plainly: *"optimized for use cases
like summarization, extraction, classification… It's **not designed for world knowledge or advanced
reasoning**."*

**Apple's own capability list is the job `subject.ts` does, almost word for word**
([Generating content and performing tasks](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models)):

> **Classify or judge text** — *"Is this text relevant to the topic 'Swift'?"*
> **Generate tags from text** — *"Provide two tags that describe the main topics of this text."*

**And there is a purpose-built adapter for exactly this.** `SystemLanguageModel(useCase: .contentTagging)`
*"produces a list of categorizing tags based on the input prompt… The tagging capabilities of the model
include detecting **topics**, emotions, actions, and objects"*
([Content tags](https://developer.apple.com/documentation/foundationmodels/categorizing-and-organizing-data-with-content-tags)).
It is `@Generable`-compatible. Two documented caveats land on this product's exact case: for very short
inputs *"Actions or object lists will be too specific, and may repeat the words in the query"*, and reusing
one session across batches produces *"tags related to the previous turn or a combination of turns"* — which
means one session per thread, which is what `subject.ts` already does by keying on terms.

Guided generation is the other reason it fits. `@Generable` uses **constrained decoding**, which Apple says
*"fundamentally guarantees structural correctness"* — the same property `ADR-0005`'s structured-output
boundary needs, obtained from the runtime rather than from a retry loop.

Three limits, each decisive for a different part of this product:

1. **The context window is 4,096 tokens, total.** *"This includes all prompts, instructions, tool definitions
   and their input and output, generable type schemas, and all of the model's responses"*
   ([Managing the context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window)),
   at roughly 3–4 characters per token in English. Naming a thread from a dozen page titles fits easily. The
   session-reading boundary — up to 2,000 characters per approved source, across a whole sitting — does not
   fit and cannot be made to. From 26.4, `SystemLanguageModel.contextSize` and `tokenCount(for:)` exist, and
   Apple's guidance is to read them rather than hardcode 4,096.

2. **It is rate-limited specifically in the background.**
   [`GenerationError.rateLimited`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror/ratelimited(_:)):
   *"This error will only happen if your app is running in the background and exceeds the **system defined**
   rate limit."* Propositum's entire premise is doing work while the person is away. **The numeric limit is
   not published anywhere in Apple's documentation, videos or research pages** — this is the single largest
   unquantified risk in adopting it, and it would have to be characterised empirically.

3. **The model changes underneath you, in OS point releases.** Apple, verbatim: *"Apple periodically updates
   `SystemLanguageModel` in routine OS updates… Currently, there are 3 model versions that align with: iOS,
   iPadOS, macOS, and visionOS 26.0 - 26.3 / … 26.4 / … 27.0"*, with explicit advice to re-test prompts per
   version.

   **This is the one that should stop the conversation for this repo.** `CONTEXT.md` bans model calls on a
   timer partly because they make the event stream non-reproducible and the eval harness unable to re-score a
   fixture. A pinned `claude-opus-5` is reproducible in a way a model shipping with a point release of the
   operating system is not. Moving inference on-device would trade a privacy gain for a reproducibility loss
   in the exact dimension `EVALUATION.md` depends on. That is a real trade and it may be worth making — but
   it is a trade, and the corpus currently reads as though local inference would be free.

Availability is conditional in three documented ways
([UnavailableReason](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason)):
`.deviceNotEligible` (Apple Silicon and Apple Intelligence-capable only), `.appleIntelligenceNotEnabled`
(a user toggle), and `.modelNotReady` — *"Models are downloaded automatically based on factors like network
status, battery level, and system load."* On a fresh machine the model may simply not be there, and you
cannot force the download. Apple also requires **7 GB of storage** and a supported system language
([support](https://support.apple.com/en-us/121115)).

Failure modes worth designing for: `guardrailViolation` (input *or* output failed a safety check) and
`refusal`. Apple's warning about the latter is sharp — for plain string responses, *"You might not be able to
programmatically determine whether a string response is a normal response or a refusal"*; with guided
generation it throws instead, which is another argument for `@Generable` over free text.

Apple publishes **no tokens-per-second or time-to-first-token figure for this framework, and none for Mac at
all**. The only first-party generation numbers are from the 2024 report and are iPhone: *"On iPhone 15 Pro we
are able to reach time-to-first-token latency of about 0.6 millisecond per prompt token, and a generation rate
of 30 tokens per second"* ([Introducing AFM](https://machinelearning.apple.com/research/introducing-apple-foundation-models)).
What Apple supplies instead is a **Foundation Models Instrument** reporting per-request total duration,
time-to-first-token and cached-token counts
([Analyzing runtime performance](https://developer.apple.com/documentation/foundationmodels/analyzing-the-runtime-performance-of-your-foundation-models-app)).
You measure it yourself.

### 7.2 The cheaper idea: embeddings, not a language model — and Apple recommends it

`topics.ts` clusters pages by shared terms and merges near-identical spellings with Damerau-Levenshtein. Its
own header is candid: *"This is string arithmetic over titles and search terms. It can say WHICH words recur;
it cannot say what they mean."* The gap that closes — *"world models"* against *"general intuition"* — is a
**semantic similarity** problem, and semantic similarity does not need a language model.

[`NLEmbedding`](https://developer.apple.com/documentation/naturallanguage/nlembedding) is *"a map of strings
to vectors, which locates neighboring, similar strings"*. `sentenceEmbedding(for:)` is macOS 11+. The numbers
are not in the API reference; they are in
[WWDC20 session 10657](https://developer.apple.com/videos/play/wwdc2020/10657/):

> *"The dimension of this vector is **512 dimensions**."*
> Languages: *"English, Spanish, French, German, Italian, Portuguese and simplified Chinese."*
> Intended input: *"text that is similar in length to a **single sentence, maybe a couple of sentences or a
> short paragraph**"* — and *"You don't have to remove stop words."*

**Apple then describes this product's own clustering problem and recommends this API for it**, verbatim:

> *"you can take Sentence Embeddings and calculate a vector for each one of these and then you can use
> **standard clustering algorithms to group these into as many groups as you want**. And what Sentence
> Embedding means is that these groups are going to be sentences close together in meaning."*

Page titles are precisely *"similar in length to a single sentence"*, and `STOPWORDS` in `topics.ts` exists to
do by hand what Apple says is unnecessary here.

**This is the most under-considered option in this note, and the argument for it is availability rather than
quality.** `NLEmbedding` has been on every Mac since 10.15 (sentence embeddings since 11), works on Intel
Macs, needs no Apple Intelligence, no 7 GB download, no `.modelNotReady`, no background rate limit, no
guardrail refusal, and no model that changes in a point release. It would not *name* a thread in a sentence a
person recognises — that is what `subject.ts` is for — but it could plausibly *bind* pages into a thread more
accurately than edit distance, deterministically and on-device. **The LLM is better used for naming the
cluster than for forming it.**

Two neighbours worth knowing:
[`NLContextualEmbedding`](https://developer.apple.com/documentation/naturallanguage/nlcontextualembedding)
(macOS 14+, transformer-based, 27 languages) is better in principle but downloads assets on demand and Apple
explicitly steers away from it here — *"For semantic similarity tasks, consider using `NLEmbedding`"* —
positioning it instead as a feature extractor for Create ML text classifiers, which is itself a live option:
train a small Core ML classifier on your own labelled titles. And `NLTagger` gives named-entity recognition
over titles with no model download at all, which is a cheap way to pull *"General Intuition"* out of a page
title as an entity rather than as two recurring tokens.

### 7.3 llama.cpp, Ollama and MLX

[llama.cpp](https://github.com/ggml-org/llama.cpp): *"Apple silicon is a first-class citizen - optimized via
ARM NEON, Accelerate and Metal frameworks"*, Metal enabled by default on macOS, and `llama-server` exposing
OpenAI-compatible `/v1/chat/completions` plus JSON-Schema constrained decoding — so it drops in behind a
`ModelClient` implementation with no new interface. **It never uses the Apple Neural Engine**; the README's
list of frameworks is exact and a repository-wide grep for CoreML or ANE returns nothing.

The repo's own quantization table, baselined on Llama-3-8B, is the useful sizing artefact: **Q4_K_M is 4.58 GB
with ΔPPL +0.1754**; Q5_K_M 5.33 GB / +0.0569; Q2_K 2.96 GB / **+3.5199**. And a finding from its perplexity
README that matters more than the numbers: **newer models degrade far worse under aggressive quantization** —
at q2_K, Llama-2-7B loses 0.63 perplexity where Llama-3-8B loses 3.52. Do not go below Q4_K_M on a modern
small model.

[Ollama](https://github.com/ollama/ollama) runs as a login-item background daemon on `127.0.0.1:11434` and
**wraps `llama-server` as a subprocess** — its own source says *"All GGML models are served via the upstream
llama-server subprocess"*, with llama.cpp pinned by a `LLAMA_CPP_VERSION` file. Structured outputs accept a
JSON Schema directly and are implemented by passing it through to llama.cpp. Two traps: the OpenAI-compatible
route **cannot set context length**, and the default context is **VRAM-tiered** — *"< 24 GiB → 4k; 24–48 GiB →
32k; ≥ 48 GiB → 256k"* ([context-length](https://raw.githubusercontent.com/ollama/ollama/main/docs/context-length.mdx))
— so on a Mac, where unified memory reads as VRAM, the same binary gives a 16 GB laptop 4k and a 64 GB one
256k. Always set `num_ctx`. **The README no longer publishes any RAM requirement**; the old "at least 8 GB"
line has been removed and nothing replaced it.

**MLX is Apple's own, MIT-licensed, and it is the only source here that publishes a first-party quality/speed
table.** From [`mlx-lm/BENCHMARKS.md`](https://raw.githubusercontent.com/ml-explore/mlx-lm/main/mlx_lm/BENCHMARKS.md)
(64 GB M4 Max, macOS 26.1), Qwen3-4B-Instruct:

| Precision | MMLU Pro | Generation t/s | Memory |
|---|---|---|---|
| bf16 | 64.05 | 52.47 | 9.02 GB |
| q8 | 63.85 | 86.91 | 5.25 GB |
| **q4** | **60.72** | **134.52** | **3.35 GB** |

That is the honest shape of the trade at this size: **4-bit costs 3.3 MMLU-Pro points and buys 2.7× memory and
2.6× speed.** Note also that Apple's own on-device model runs at **2 bits**, and nobody publishes what 2-bit
QAT costs on a classification task.

One structural insight from llama.cpp's long-running Apple Silicon thread that outlives its numbers — and it
*is* a [community-contributed table](https://github.com/ggml-org/llama.cpp/discussions/4167) on a frozen 2023
commit, not repo documentation: **prompt processing scales with GPU cores; token generation scales with memory
bandwidth.** An M2 Ultra at 800 GB/s beats an M4 Max at 546 GB/s on generation despite being two generations
older. For a product that sends short prompts and wants short answers, bandwidth is the number that predicts
the experience.

### 7.4 The question nobody's documentation answers

**Is a 3B-class local model good enough to name what a person is working on from a dozen page titles?**

There is no first-party benchmark for short-text topic classification at this size. Apple lists tagging and
classification among the things its model can do and ships a `contentTagging` adapter for it, but **publishes
no accuracy figure for that adapter**. llama.cpp and Ollama publish no task-level quality figures at all,
correctly, since they are runtimes rather than models.

The nearest honest proxy is instruction-following rather than knowledge, because the task is *"follow a format
and emit a label"*, not *"know things"*. From the vendors' own model cards: **IFEval** is 77.4 for Llama 3.2
3B against 80.4 for Llama 3.1 8B, and 90.2 for Gemma 3 4B — close at 3–4B — while **MMLU** is 58.0 against
66.7, where the gap actually lives. Combined with constrained decoding, which both Apple and llama.cpp
guarantee structurally, format compliance stops being the risk and label quality is all that is left.

**So: plausible and worth prototyping, not proven.** And the responsible move is the one this repo is already
equipped for — `subject@1` is one prompt against a fixture set, and running it against Foundation Models and
scoring the names is a day's work that would settle in evidence what no amount of documentation can. Apple
now says the same thing, having shipped an Evaluations framework for exactly this purpose.

### 7.5 Battery and thermal — the API exists, the figures do not

Apple documents the *policy* input and not the cost.
[`ProcessInfo.ThermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)
(macOS 10.10.3+) carries per-state guidance, and the `.fair` entry names this product's workload directly:

> `.fair` — *"The system takes steps to reduce thermal state, like running fans and stopping background
> services… **Reduce or defer background work, like prefetching content over the network or updating database
> indexes.**"*
> `.serious` — *"**Reduce CPU and GPU usage by stopping or deferring work.**"*

with `isLowPowerModeEnabled` (macOS 12+) as the second gate. A background inference loop should be gated on
both, and a documented gotcha: you must read `thermalState` *before* registering for
`thermalStateDidChangeNotification` or you will not receive it.

**No first-party wattage figure exists for local LLM inference, from Apple or anyone.** Apple's M5 materials
mention *"running large language models locally"* with no watts, no tokens per second and no TTFT. `powermetrics`
ships with macOS and reports per-subsystem estimates including the ANE, with Apple's own caveat in the man
page that the values *"are estimated and may be inaccurate… should not be used for any comparison between
devices."* Any battery claim here has to be measured on this machine and cannot be cited.

---

## 8. Screenshots — the arithmetic, before the argument

Set aside for one section whether a screenshot cache *should* exist, and price it. The numbers decide it
without appeal to principle, which is a better outcome than winning on principle alone — and the two
comparable products decide it more sharply still.

Figures marked **[MEASURED]** were produced on this machine (macOS 26.5.2, Apple M4 Max) during this
research, against synthetic 2560×1600 UI screenshots. They are not vendor-published numbers and are not a
benchmark; they are one image, English, one font family. They are labelled so nobody later mistakes them for
citations.

### 8.1 Extraction path A — OCR on device, which turns out to be free

[`VNRecognizeTextRequest`](https://developer.apple.com/documentation/vision/vnrecognizetextrequest) (macOS
10.15+) and its Swift successor
[`RecognizeTextRequest`](https://developer.apple.com/documentation/vision/recognizetextrequest) (macOS 15+).
Apple's substantive description of the two levels is in
[Recognizing text in images](https://developer.apple.com/documentation/vision/recognizing-text-in-images),
not in the enum:

> *"The **fast path** uses the framework's character-detection capabilities to find individual characters, and
> then uses a small machine learning model to recognize individual characters and words."*
> *"The **accurate path** uses a neural network to find text in terms of strings and lines… much more in line
> with how humans read text."*

Apple publishes **no latency figures** for either — I checked WWDC19 234, WWDC21 10041, WWDC22 10024, WWDC24
10163 and WWDC25 272 and found none.

**[MEASURED]**, 30 iterations, `recognitionLanguages = ["en-US"]`:

| Level | `usesLanguageCorrection` | p50 latency | Token recall vs ground truth |
|---|---|---|---|
| `.fast` | false | **67.7 ms** | **96.3%** |
| `.fast` | true | 242.8 ms | 96.3% |
| `.accurate` | false | 431.5 ms | 93.9% |
| `.accurate` | true | 919.4 ms | 95.9% |

Three consequences, and the first is the one that reframes the section:

1. **OCR is free at any realistic cadence.** 68 ms per frame at a 5-second interval is about 1.4% of one core.
   Whatever makes a screenshot cache expensive, it is not the text extraction.
2. **On crisp, axis-aligned screenshot text, `.fast` matched `.accurate`.** Apple's fast/accurate framing is
   built for *camera* imagery — rotated, warped, motion-blurred — and a screenshot has none of those
   properties. **[MEASURED]**, one synthetic image; treat as a hypothesis worth A/B-ing, not a result. Note
   `.fast` supports only 6 recognition languages against `.accurate`'s 30.
3. **`usesLanguageCorrection` is the largest tunable and nobody talks about it** — it triples or quadruples
   the cost for no measured recall gain here.

**One silent-failure trap worth writing down before anyone builds this. [MEASURED]** The new Swift API
defaults `minimumTextHeightFraction` to `0.03125` — one thirty-second of image height — where the legacy
`minimumTextHeight` defaults to `0`. On a 1600 px-tall screenshot that discards any text under 50 px; normal
UI text is about 22 px. Measured on the same image at `.fast`: **75 observations at `0.0`, and 0 at the new
API's default.** It throws no error. Apple's reference page lists the property and states no default.

**Does OCR itself need a permission? No — verified by execution.** A binary that read a PNG from disk and ran
Vision produced no prompt while reporting `AXIsProcessTrusted() = false`.

**Capturing does, and there is a specific entitlement that a rolling cache needs.**
[ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) documents
`NSScreenCaptureUsageDescription`, names `SCContentSharingPicker` as *"the recommended approach"*, and states
that background capture *"may require the **Persistent Content Capture** entitlement
(`com.apple.developer.persistent-content-capture`)"*. That is not a footnote — it is the OS naming the exact
capability a rolling cache is, and gating it separately from ordinary screen recording.

### 8.2 Extraction path B — a vision model, and the number that ends it

Anthropic's [vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision) gives the
accounting verbatim:

> *"Claude views images in patches instead of pixels. Each patch is a 28×28-pixel block of the image, referred
> to as a visual token. An image, therefore, costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens."*

with a high-resolution tier capped at a 2576 px long edge and 4784 visual tokens. Anthropic names this exact
use case when advising downsampling: *"If you don't need the additional fidelity that high resolution provides
for **computer use, screenshot understanding**, and dense documents…"*

For a 1512×982 window screenshot: `⌈1512/28⌉ = 54`, `⌈982/28⌉ = 36`, `54 × 36 = **1944 visual tokens**`. At
Opus 5's $5/MTok that is **$0.00972 per frame**. A full-screen 2560×1600 Retina capture hits the tier cap of
**4784 tokens ≈ $0.0239**, matching Anthropic's own worked example (*"the 4K image about $23.92 USD per
thousand"*).

Now the cadence arithmetic. A rolling cache at **5-second intervals, 8 hours a day, 30 days** is
`5,760 × 30 = 172,800` frames:

| Strategy | Opus 5 | Sonnet 5 | Haiku 4.5 |
|---|---|---|---|
| **Every frame sent as an image** (1944 tok) | **$1,679.62** | $671.85 | $270.95 |
| Every frame OCR'd locally, text sent (~830 tok) | $716.69 | $286.68 | $143.34 |
| **OCR locally, model on 1% of frames** | **$7.17** | $2.87 | $1.43 |

`172,800 × 1944 = 335.9 MTok × $5/MTok = $1,679.62`. The gated row is `1,728 × 830 = 1.43 MTok × $5 = $7.17`.
**A 234× spread**, and it is entirely a question of where the extraction happens.

Put the top row beside the figure this repo already measured and published in
[`MVP.md`](../MVP.md)'s out-of-scope table, in the row explaining why there is no cost dial:

> *"Measured on a real boundary at \$0.0325 and 15.1 s per call: a 30-minute budget buys ~120 sequential
> calls, about a dollar. Latency binds; cost never does."*

**At one interpreted screenshot per minute, watching costs more per hour than an entire half-hour handoff run
costs to perform.** The sentence *"cost never binds; latency does"* — load-bearing for the decision not to
build a cost dial — stops being true the moment a screenshot enters a prompt. That is not a privacy objection.
It is an arithmetic one, and it arrives first.

**No provider publishes latency figures for image inputs.** I checked Anthropic's
[reduce-latency guide](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency),
OpenAI's latency-optimization guide, and Google's media-resolution docs: no TTFT values, no percentiles, no
mention of images in two of the three.

### 8.3 Extraction path C — the accessibility tree, and the finding that decides against it

`SECURITY_AND_PRIVACY.md` already describes the acting path preferring *"the accessibility tree — the page as
the browser describes it to assistive technology"* and taking *"a screenshot **only when the tree is
insufficient**"*. That ordering is right and was argued here already. The tree is structured, has no OCR error
class, is immune to occlusion, and sees text scrolled out of the viewport.

**But the earlier UNVERIFIED gap about Chrome closes badly, and it closes against a system-level AX strategy.**
Chromium's own documentation:

> *"**Accessibility features in Chrome are off by default and enabled automatically on-demand.**"*
> — [accessibility/overview.md](https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/overview.md)

> *"Typically, AX processing is enabled for the browser when it **detects the presence of an AT**. This is done
> via **platform-specific mechanisms, which may involve heuristics**."*
> — [content/browser/accessibility/README.md](https://chromium.googlesource.com/chromium/src/+/main/content/browser/accessibility/README.md)

and Chromium maintains a page whose opening sentence is the cost:

> *"**Accessibility support can have a negative impact on performance**, so it is important to test for
> regressions and to improve performance over time."*
> — [accessibility/browser/perf.md](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/browser/perf.md)

with the architectural reason stated plainly:

> *"**Memory usage is higher.** The cache necessarily duplicates information that was already stored
> elsewhere."*
> *"the accessibility tree **can't be computed lazily**. Whenever a web page changes, updates have to be pushed
> to the browser process cache right away… **when assistive technology is not actually consuming the changes,
> this approach can be inefficient.**"*
> — [how_a11y_works_2.md](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/browser/how_a11y_works_2.md)

That last sentence describes the rolling-cache scenario exactly: a background sampler at 5 seconds forces
Chrome to serialise and push *every DOM mutation continuously* while consuming a fraction of a percent of
them. And background tabs give nothing anyway — *"Mode flag changes are **not distributed immediately to
`WebContents` that are hidden**"*, and a never-drawn `WebContents` returns an empty mode set.

**The conclusion is not "AX or OCR". It is that a Mac-side AX strategy makes this product slower at the one
thing it is for.** Propositum already gets structured page text the correct way — from inside the tab, via a
content script it registered, on pages the person granted — and ADR-0010's acting path already gets the tree
via CDP for tabs it opened. A system-level AX grant would buy other applications' text at the cost of the
scariest TCC pane macOS has, no per-app scoping, and Chrome's own documented performance regression.

### 8.4 Storage, measured

Uncompressed baseline: `2560 × 1600 × 4 = 15.6 MiB` per frame. **[MEASURED]** via ImageIO on a realistic UI
composite (wallpaper, translucent menu bar, vibrancy sidebar, 22 px text, an overlapping window):

| Encoder | Bytes/frame | 5 s cadence, 8 h/day, 30 days |
|---|---|---|
| PNG | 754,941 | 130.45 GB |
| JPEG q60 | 528,360 | 91.30 GB |
| **HEIC q60** | 281,275 | **48.60 GB** |
| HEIC q30 | 182,760 | 31.58 GB |
| **OCR text only (UTF-8)** | 3,316 | **0.57 GB** |
| OCR text, gzip -9 | 1,125 | 0.19 GB |
| OCR JSON + boxes + confidence, gzip -9 | 3,156 | 0.55 GB |

**The extracted text is 1.18% of the HEIC image, and 0.40% of it gzipped.** A month of searchable text *with
bounding boxes and confidence* is about 550 MB; the pixels are ninety times that.

Two more measured notes. Downscaling to about **1512 px wide is free** — recall was flat from 2560 down to
1512, degraded gently to 1024, and collapsed to 75% at 800 — but it does **not** speed up OCR, which was
nearly resolution-independent across a 3.2× area reduction. And Apple publishes **no** HEIC-versus-JPEG
compression ratio; [its support page](https://support.apple.com/en-us/HT207022) says only *"better
compression… so they use less storage space"*. The 0.39–0.47× measured here is mine, not Apple's.

### 8.5 What the two comparable products actually did — and one of them is dead

**Microsoft Recall** is the only live incumbent, and its own documentation is the strongest available argument
that this is not a feature you add to an existing product. Its floor is a Copilot+ PC meeting **Secured-core**,
a **40 TOPS NPU**, 16 GB RAM, 256 GB storage and Device Encryption; snapshots live in a
**Virtualization-based Security Enclave** with keys in the TPM, tied to Windows Hello Enhanced Sign-in
Security, and Microsoft states *"IT admins can't access or view the snapshots… Microsoft can't access or view
the snapshots."*
([manage-recall](https://learn.microsoft.com/en-us/windows/client-management/manage-recall),
[security architecture](https://blogs.windows.com/windowsexperience/2024/09/27/update-on-recall-security-and-privacy-architecture/))

Two details matter more than the architecture:

- **The opt-in reversal, in Microsoft's own words**, 7 June 2024: *"**If you don't proactively choose to turn
  it on, it will be off by default.**"* and *"**Windows Hello enrollment is required to enable Recall.**"*
  ([blog](https://blogs.windows.com/windowsexperience/2024/06/07/update-on-the-recall-preview-feature-for-copilot-pcs/)).
  Shipped on, reversed to off, under public pressure, by a company with more security engineering than this
  project will ever have.
- **The filtering leaks, and Microsoft says so.** Sensitive-information filtering covers roughly 170
  *structured identifier* types — cards, IBANs, national IDs, cloud secrets — and has **no category for
  private free text**: medical notes, private messages, legal drafts and proprietary source are captured in
  full. Microsoft's own hedge is *"helps reduce"*, and its own disclosure reads: *"**Parts of filtered
  websites can still appear in snapshots such as embedded content, the browser's history, or an opened tab
  that isn't in the foreground.**"*

  That is [ADR-0002](../adr/0002-observation-capture.md)'s Rewind argument, happening again, to a different
  company, with the same shape: *exclusions built on a see-everything vehicle leak as an emergent property.*

**And Rewind — the case ADR-0002 already cites — is dead.** Limitless's own homepage now reads:

> *"**Limitless has been acquired by Meta**"*
> *"**The Rewind app is sunsetting. The latest update disables all screen and audio capture starting December
> 19, 2025.**"*

Its archived first-party documentation is still the best field data anyone published: frames every two
seconds, *"On average users use **14 GB per month**"* with a range of 1–39 GB, *"we compress raw recording data
**up to 3,750x**"* via inter-frame delta compression (*"If we only store the information related to the
changes"*), and CPU at *"**20 - 40% of a single core**"*. That 14 GB/month beats §8.4's 48.6 GB precisely
because per-frame encoding is the wrong model — consecutive desktop screenshots are enormously redundant, and
a delta or HEVC path is the obvious order-of-magnitude win. I did not measure it.

The architecture is the part worth reading twice, from
[Rewind's archived privacy page](https://web.archive.org/web/20240224095244/https://www.rewind.ai/privacy):

> *"Recording data (including screenshots, video & audio) is **NEVER sent off your Mac**. Compression,
> Automated Speech Recognition (ASR), and Optical Character Recognition (OCR) processes **all happen
> locally**."*
> *"**If you choose to use our meeting summarization or Ask Rewind features, only relevant text-based data is
> sent to our LLM partners**"*

**They landed independently on exactly the architecture §8.2's arithmetic recommends** — pixels stay local,
extracted text goes to the model — which is real evidence that it is the right shape. And then:
**Limitless's current privacy policy is cloud-first** (*"We store some of your information, such as your audio
recordings, in cloud-based storage services"*) and does not mention screen recording at all.

**The local-first architecture did not survive the acquisition.** For a document arguing that this product's
posture is local-first, that is the single most useful sentence in this section: the posture is not preserved
by having chosen it once. ADR-0002 cited Rewind for how its exclusions leaked; it can now cite it for what
happened to the promise afterwards.

**Apple ships no rolling screenshot cache**, and its nearest precedent is stated as a boundary rather than a
feature — [Core Spotlight](https://developer.apple.com/documentation/corespotlight): *"**The indexes you
create using Core Spotlight remain on device, and are private to the owner of the device. Devices don't share
indexed data with Apple, or synchronize that data with the person's other devices.**"*

### 8.6 So what would a defensible version look like

Only because the brief asked for the price rather than a verdict, and because getting the shape right matters
if §9.1's ADR is ever written:

- Capture the **foreground window**, not the screen, at a **change-gated** interval rather than a timer —
  Recall's own trigger.
- OCR every frame **locally** at `.fast` with `usesLanguageCorrection = false` and
  `minimumTextHeightFraction = 0`, store text plus boxes, and **discard the pixels immediately.** At 0.19 GB
  per month gzipped and 68 ms per frame, this is the cheap part in every dimension including privacy.
- Send text, never images, and only on a small gated fraction of frames.
- Treat `com.apple.developer.persistent-content-capture` as the honest name of what is being built.

That is a *text* cache with a screenshot as a transient intermediate, which is a materially different promise
from a screenshot cache — and it is still a reversal of the sentence in §9.1.

---

## 9. The three lines, and what crossing each would take

Written in the form [ADR-0010](../adr/0010-acting-in-the-browser.md) used: the price in the sentence that
names the thing.

### 9.1 Screen recording — a reversal, not an extension

`SECURITY_AND_PRIVACY.md`, *Data explicitly not collected*:

> **Your screen.** No screen recording, no video, and no screenshot of anything you are doing.

That bullet has already been amended once, on 2026-08-11, to carve out the tab Propositum opened while
acting. **A rolling screenshot cache is not a second carve-out of the same kind.** The existing exception is
bounded by three facts — a tab Propositum opened, under an agreement the person ratified, swept within seven
days. A cache has none of them: it covers applications Propositum has no relationship with, runs with no
agreement in force, and its entire value is that it is retained.

What crossing it would take, minimally: a new ADR that (a) states in its opening paragraph that it reverses a
stated design commitment, as ADR-0010 did; (b) says what the screenshots are *for* that §4.2's signals cannot
supply, in a sentence that survives being read back in six months; (c) answers §8.2's arithmetic; and (d)
accepts that *"no screen recording"* can never be said again, because a promise withdrawn once is not a
promise.

**And it would have to answer three things the research turned up that are not about principle at all**, each
of which is closer to a blocker than to a cost:

- **Apple treats persistent capture as a restricted capability and frames it as VNC-only.** The entitlement
  that stops the recurring system alerts, `com.apple.developer.persistent-content-capture`, requires
  submitting a request form and *"receiving permission from Apple"* (§5.3). Without it the product's core loop
  is punctuated by alerts it cannot suppress; with it, it has told Apple it is a remote-desktop app.
- **Microsoft shipped this and reversed it**, to opt-in with a Windows Hello gate, under public pressure, with
  a VBS enclave and 40-TOPS hardware floor behind it — and its filtering still leaks, by its own disclosure
  (§8.5). That is [ADR-0002](../adr/0002-observation-capture.md)'s Rewind argument recurring at a company with
  more security engineering than this project will ever have.
- **Rewind's local-first promise did not survive its acquisition** (§8.5). For a document whose central claim
  is a posture, that is the most useful fact in this note: a posture is not preserved by having chosen it
  once.

### 9.2 Keystroke logging — not a tradeoff

The founding brief lists *raw keystroke logging* among its hard scope constraints, and
`SECURITY_AND_PRIVACY.md` says *"Keystrokes. No key logging anywhere."* On macOS the mechanism is a
`CGEventTap` behind Input Monitoring; **inside Chrome it is one line in a file that already exists** —
`content.js` registers a `keydown` listener today and deliberately records only `interacted = true`.

That one line is the entire distance between this product and the thing it says it is not, which is why it is
worth naming rather than assuming. There is no version of this that is a tradeoff to be priced.

### 9.3 Reading other applications — the one that is genuinely open

Neither document forbids knowing which application is frontmost. The brief excludes *automatic access to
every application*; `SECURITY_AND_PRIVACY.md` says *"Other applications. Chrome only."* under **Data
collected**, which is a statement about what is captured rather than a claim about what is knowable.

This is the line actually open for argument, and it splits cleanly:

- **App identity only** (§5.2) needs no TCC prompt and fixes a real defect in `detectPause`. Worth an ADR —
  and note that "needs no prompt" is a reason the ADR is *more* necessary, not less: macOS supplies no
  revocation switch, so the product must supply one.
- **App contents** (window titles, accessibility tree) is a different decision, gated behind Screen Recording
  or Accessibility, with no per-app scoping and Apple's own warning attached. Worth an ADR that says no.

Keeping those two apart is most of the value of this section. They will arrive as one proposal.

---

## 10. Recommendation

**Take nothing new at install. Fix two documents. Then take the four Chrome signals that cost nothing, in
this order.**

1. **Correct [`SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) and the manifest comment** (§2). Both
   make claims that stopped being true when ADR-0008 widened host permissions. This is first because
   everything else reads differently once they are right, and because a document that has quietly stopped
   being true is, by this corpus's own method, the most expensive thing in it.

2. **`chrome.tabs.onActivated` + `tabs.get`** — no permission, no warning, no manifest change, and **no
   review-friction cost**, which is exactly why it should be used *without* declaring `tabs` (§4.7). It fixes
   the `came-back` under-firing that `content.js` and `visitsByUrl` both already document, and `came-back` is
   one of three `INTENT_GROUNDS`, of which one is required before work is ever offered. It also plausibly
   *lowers* the extension's steady-state cost by replacing a per-page 15-second interval with an event.

3. **`tabGroups`, optional, requested in context** (§4.3). One honest warning for a human-typed thread name.
   Raises confidence; never gates detection, because most people do not use tab groups.

4. **`webNavigation`, and re-argue it properly** (§4.2). `transitionType` is the cleanest available
   separation of *pursuing* from *receiving* — precisely what `grounds.ts` spends its length arguing for. It
   is free in warning terms and is not on Google's named review list. The reason to take it is the ground;
   the reason to write it down is that **Chrome will not ask the person again**, so the decision has to be
   ours and visible.

5. **`sessions.getRecentlyClosed`, and explicitly decline `getDevices`** (§4.4). Verify the warning behaviour
   on a real install first.

**Then stop, and evaluate.** Everything after that point costs a signed native binary (§5), an annual
security assessment (§6.1), a reproducibility loss (§7.1), or a promise (§9). None is worth taking before the
free signals have been measured — and this repo has an eval harness built for exactly that.

**Three things worth one ADR each, in time, and they should not arrive as one proposal:**

- **Local git, read-only, on repositories the person allowlists** (§6.6). `git status --porcelain=v2 --branch`
  and `git reflog` answer *"which repo, which branch, and what have they been switching between"* with no
  prompt, no token and no network. The reflog in particular is a 90-day trace of attention-switching, which is
  the thing `detectWork` reconstructs from dwell time. **The catch is that macOS supplies no revocation, so
  the allowlist and its off switch have to be ours** — which is the same shape as ADR-0008's move from
  structural to behavioural guarantees, and should be argued the same way.
- **Local calendar read via EventKit** (§5.4, §6.2), because it answers the one question browsing cannot —
  with the correction that there is no read-only tier and the button says *Allow Full Access*.
- **Frontmost-app identity via NSWorkspace** (§5.2, §9.3), because `detectPause` cannot currently tell *gone*
  from *working elsewhere* and offers the same thing in both cases. Note it needs no prompt, which makes it
  cheap and makes it the one that most needs a product-side switch.

**And one thing worth writing into the manifest comment now, before anyone asks for it.** `activeTab` is
warning-free and is the only optional permission that would make `tabs.captureVisibleTab` work (§4.5). It
belongs on the refusal list next to `tabs` and `history`, rather than being unmentioned because it happens not
to function today.

---

## 11. What this note could not determine

Collected so a later reader knows what is missing rather than assuming it was checked.

**Should be settled by a five-minute experiment, not more reading:**

- Whether §4.1's absorption behaviour holds in a live Chrome install. It is read from Chromium source at
  `main` and the rule *ordering* is load-bearing. **Load the extension unpacked with `tabs` added and read the
  prompt.**
- Whether adding `sessions` alongside `tabs` suppresses the cross-device history warning (§4.4). Chrome's
  documentation and Chromium's rule ordering **disagree**; only one can be true on a real install.
- Whether FSEvents delivers events for TCC-protected paths to an app without the folder grant (§5.6). Apple's
  FSEvents security document predates TCC by a decade.
- Whether `Message.snippet` is populated under Gmail's `format=metadata` (§6.1). If it were, body text would
  be leaking under a scope named *metadata*.
- Whether a 3B-class local model can name a thread as well as `subject@1` does (§7.4). **This is an eval, not
  a citation**, and the harness for it already exists.
- The numeric background rate limit for Apple's Foundation Models (§7.1). Apple confirms it exists and
  publishes no value anywhere.

**Genuinely undocumented by the vendor, and reproducible only by observation:**

- That `kCGWindowName` and `SCShareableContent` enumeration are gated behind Screen Recording (§5.3).
  Reproduced on this machine; Apple documents it on none of the three relevant pages.
- The verbatim body text of the Accessibility and Input Monitoring alerts, and the cadence and wording of
  macOS's recurring screen-capture re-authorisation (§5.3). The *mechanism* is primary-sourced via the MDM key
  `forceBypassScreenCaptureAlert`; the cadence is press-only and is not asserted here.
- Whether a sandboxed app can use ScreenCaptureKit; whether it can use the Accessibility API (Apple Staff say
  no, on the forums only) (§5.3).
- What Low Power Mode actually does on a Mac; the semantics of every FSEvents `Item*` flag (§5.6, §5.7).
- Whether Chrome's macOS AX auto-enable trigger is `AXEnhancedUserInterface` — absent from current Chromium
  docs and undocumented by Apple (§8.3).
- Whether Slack's history scopes are user-token, bot-token or both; Notion's public-integration review
  requirements; Jira's granular scope strings, whose reference page 404s (§6.4, §6.5).
- Whether iCloud publishes a supported CalDAV endpoint. It almost certainly does not (§6.2).
- Google's cost for a CASA assessment. Not published; every figure in circulation is a vendor blog (§6.1).
- Ollama's per-model memory requirements, and any maintainer-published Apple Silicon throughput for llama.cpp
  or Ollama. The widely-cited M-series table is community-contributed on a frozen 2023 commit (§7.3).
- Any first-party figure for the battery cost of extension content scripts, of local inference, or of
  ScreenCaptureKit. Chrome documents CPU and memory and **never battery**; Apple publishes no wattage for
  anything. These are measurements to take, not sources to find (§4.8, §5.7).

**One process note.** This session exhausted its web-search budget partway through, so parts of this note lean
on documents reached directly by URL and on reading Chromium and Apple source, SDK headers and shipped
localization tables rather than on search. That biases it toward sources whose existence was already known.
Sections 4, 5 and 8 are the best-supported — several of their claims were verified by execution — and
sections 6.5 and 8.5's non-Rewind material are the thinnest, and say so in place.

---

## 12. Sources

All primary. Where a claim rests on something weaker — a shipped OS artefact, an Apple Staff forum post, a
community-contributed table, or a measurement taken here — the section says so inline and this list repeats
the flag.

**Chromium source (read at `main`)**

- [`chrome_permission_message_rules.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_permission_message_rules.cc) — the absorb lists; the `{kTab, kSessions}` rule
- [`chrome_permission_message_provider.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_permission_message_provider.cc) — `GetPermissionMessagesHelper`, `IsAPIOrManifestPrivilegeIncrease`
- [`permission_set.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/permission_set.cc) · [`url_pattern.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/url_pattern.cc) — `ShouldWarnAllHosts`, `MatchesEffectiveTld`
- [`extension_tab_util.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/extension_tab_util.cc) — `GetScrubTabBehaviorImpl`
- [`tabs_api.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/tabs/tabs_api.cc) — `TabsQueryFunction::Run`, `TabsCaptureVisibleTabFunction`
- [`sessions_api.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/sessions/sessions_api.cc) · [`permissions_data.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/permissions_data.cc) — `CanCaptureVisiblePage`
- [`_api_features.json`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/api/_api_features.json) — which namespaces require a permission
- [`chrome_api_permissions.cc`](https://chromium.googlesource.com/chromium/src/+/main/chrome/common/extensions/permissions/chrome_api_permissions.cc) · [`extensions_api_permissions.cc`](https://chromium.googlesource.com/chromium/src/+/main/extensions/common/permissions/extensions_api_permissions.cc) — `kFlagCannotBeOptional`
- [`url_database.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/url_database.cc) · [`visit_database.cc`](https://chromium.googlesource.com/chromium/src/+/main/components/history/core/browser/visit_database.cc) · [`time.h`](https://chromium.googlesource.com/chromium/src/+/main/base/time/time.h) — the History schema and its epoch
- [`user_data_dir.md`](https://chromium.googlesource.com/chromium/src/+/main/docs/user_data_dir.md)
- Accessibility: [`overview.md`](https://chromium.googlesource.com/chromium/src/+/main/docs/accessibility/overview.md) · [`browser/perf.md`](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/browser/perf.md) · [`how_a11y_works_2.md`](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/accessibility/browser/how_a11y_works_2.md) · [`content/browser/accessibility/README.md`](https://chromium.googlesource.com/chromium/src/+/main/content/browser/accessibility/README.md)

**Chrome extensions — developer.chrome.com**

- [Permissions reference (warning strings)](https://developer.chrome.com/docs/extensions/reference/permissions-list) · [Permission warning guidelines](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings) · [Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [`chrome.permissions`](https://developer.chrome.com/docs/extensions/reference/api/permissions) — user-gesture requirement, the ten non-optional permissions
- [Match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns) · [`activeTab`](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [`chrome.tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [`sessions`](https://developer.chrome.com/docs/extensions/reference/api/sessions) · [`webNavigation`](https://developer.chrome.com/docs/extensions/reference/api/webNavigation) · [`history`](https://developer.chrome.com/docs/extensions/reference/api/history) · [`bookmarks`](https://developer.chrome.com/docs/extensions/reference/api/bookmarks) · [`readingList`](https://developer.chrome.com/docs/extensions/reference/api/readingList) · [`tabGroups`](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) · [`topSites`](https://developer.chrome.com/docs/extensions/reference/api/topSites) · [`downloads`](https://developer.chrome.com/docs/extensions/reference/api/downloads) · [`idle`](https://developer.chrome.com/docs/extensions/reference/api/idle) · [`alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms) · [`offscreen`](https://developer.chrome.com/docs/extensions/reference/api/offscreen) · [`management`](https://developer.chrome.com/docs/extensions/reference/api/management) · [`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
- [Service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) · [Migrate to service workers](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers) · [Known issues](https://developer.chrome.com/docs/extensions/develop/migrate/known-issues)
- [Audio recording and screen capture](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) — the only documented capture indicator
- [Native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) · [User controls for host permissions](https://developer.chrome.com/docs/extensions/mv2/runtime-host-permissions) · [MV2 performance](https://developer.chrome.com/docs/extensions/mv2/performance) *(deprecated page; the only Chrome-authored CPU guidance)* · [DevTools Performance reference](https://developer.chrome.com/docs/devtools/performance/reference)
- Web Store: [Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions/) · [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use) · [Quality guidelines (single purpose)](https://developer.chrome.com/docs/webstore/program-policies/quality-guidelines) · [Review process](https://developer.chrome.com/docs/webstore/review-process) · [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

**Apple**

- [ScreenCaptureKit](https://developer.apple.com/documentation/screencapturekit) · [`SCShareableContent`](https://developer.apple.com/documentation/screencapturekit/scshareablecontent) · [Capturing screen content](https://developer.apple.com/documentation/screencapturekit/capturing-screen-content-in-macos) · [`com.apple.developer.persistent-content-capture`](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.persistent-content-capture)
- [macOS 15 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-15-release-notes) · [macOS 15.1 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-15_1-release-notes) — `forceBypassScreenCaptureAlert`
- [Protected resources](https://developer.apple.com/documentation/bundleresources/protected-resources) · [PPPC Services dictionary](https://developer.apple.com/documentation/devicemanagement/privacypreferencespolicycontrol/services-data.dictionary) · [Controlling app access to files](https://support.apple.com/guide/security/controlling-app-access-to-files-secddd1d86a6/web) · [Resetting access](https://developer.apple.com/documentation/xcode/resetting-access-to-protected-resources-in-macos)
- [`AXUIElement.h`](https://developer.apple.com/documentation/applicationservices/axuielement_h) · [`AXIsProcessTrustedWithOptions`](https://developer.apple.com/documentation/applicationservices/1459186-axisprocesstrustedwithoptions) · [Quartz Event Services](https://developer.apple.com/documentation/coregraphics/quartz-event-services) · [`CGPreflightScreenCaptureAccess()`](https://developer.apple.com/documentation/coregraphics/cgpreflightscreencaptureaccess())
- [Accessing files from the macOS App Sandbox](https://developer.apple.com/documentation/security/accessing-files-from-the-macos-app-sandbox) — Full Disk Access cannot be requested in code · [`NSDesktopFolderUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsdesktopfolderusagedescription) · [App Sandbox](https://developer.apple.com/documentation/security/app-sandbox)
- [`EKEventStore`](https://developer.apple.com/documentation/eventkit/ekeventstore) · [Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store) — no read-only tier
- [`NSWorkspace`](https://developer.apple.com/documentation/appkit/nsworkspace) · [`frontmostApplication`](https://developer.apple.com/documentation/appkit/nsworkspace/frontmostapplication) · [`didActivateApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/didactivateapplicationnotification) · [`CGWindowListCopyWindowInfo`](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:)) · [`kCGWindowName`](https://developer.apple.com/documentation/coregraphics/kcgwindowname)
- [File System Events](https://developer.apple.com/documentation/coreservices/file_system_events) · [File System Event Security (archived)](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/FSEvents_ProgGuide/FileSystemEventSecurity/FileSystemEventSecurity.html)
- [`INFocusStatusCenter`](https://developer.apple.com/documentation/intents/infocusstatuscenter) · [`INFocusStatus`](https://developer.apple.com/documentation/intents/infocusstatus) · [Handling Focus status updates](https://developer.apple.com/documentation/usernotifications/handling-communication-notifications-and-focus-status-updates)
- [`NSBackgroundActivityScheduler`](https://developer.apple.com/documentation/foundation/nsbackgroundactivityscheduler) · [`ProcessInfo.ThermalState`](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum) · [App Nap (archived)](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/AppNap.html) · [`SMAppService`](https://developer.apple.com/documentation/servicemanagement/smappservice)
- Vision: [`VNRecognizeTextRequest`](https://developer.apple.com/documentation/vision/vnrecognizetextrequest) · [`RecognizeTextRequest`](https://developer.apple.com/documentation/vision/recognizetextrequest) · [Recognizing text in images](https://developer.apple.com/documentation/vision/recognizing-text-in-images) · [`RecognizeDocumentsRequest`](https://developer.apple.com/documentation/vision/recognizedocumentsrequest) · [WWDC24 10163](https://developer.apple.com/videos/play/wwdc2024/10163/) · [WWDC25 272](https://developer.apple.com/videos/play/wwdc2025/272/)
- Foundation Models: [`SystemLanguageModel`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) · [Generating content](https://developer.apple.com/documentation/foundationmodels/generating-content-and-performing-tasks-with-foundation-models) · [Content tags](https://developer.apple.com/documentation/foundationmodels/categorizing-and-organizing-data-with-content-tags) · [Managing the context window](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window) · [`rateLimited`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror/ratelimited(_:)) · [`UnavailableReason`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.enum/unavailablereason) · [Tech report 2025](https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025)
- [`NLEmbedding`](https://developer.apple.com/documentation/naturallanguage/nlembedding) · [`NLContextualEmbedding`](https://developer.apple.com/documentation/naturallanguage/nlcontextualembedding) · [WWDC20 10657](https://developer.apple.com/videos/play/wwdc2020/10657/) — the 512-dimension figure and the clustering recommendation
- [Core Spotlight](https://developer.apple.com/documentation/corespotlight) — the on-device index precedent
- Apple support: [Screen & System Audio Recording](https://support.apple.com/guide/mac-help/control-access-to-screen-and-system-audio-recording-mchld6aa7d23/mac) · [Accessibility](https://support.apple.com/guide/mac-help/allow-accessibility-apps-to-access-your-mac-mh43185/mac) · [Input Monitoring](https://support.apple.com/guide/mac-help/control-access-to-input-monitoring-on-mac-mchl4cedafb6/mac) · [Privacy & Security settings](https://support.apple.com/guide/mac-help/change-privacy-security-settings-on-mac-mchl211c911f/mac) · [Apple Intelligence requirements](https://support.apple.com/en-us/121115)
- **Not Apple documentation, and flagged as such wherever used:** prompt strings recovered from the shipping `TCC.framework` localization table; the sandbox/Accessibility incompatibility, which exists only as an Apple Staff answer on the developer forums.

**Providers**

- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) · [`Format` enum](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format) · [`users.messages.list`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list) · [Gmail API policy](https://developers.google.com/workspace/gmail/api/policy) · [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) · [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) · [Restricted scopes list](https://support.google.com/cloud/answer/13464325) · [Workspace add-on scopes](https://developers.google.com/workspace/add-ons/concepts/workspace-scopes)
- [Google Calendar API auth](https://developers.google.com/workspace/calendar/api/auth) · [`freebusy.query`](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query) · [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events)
- [RFC 4791 (CalDAV)](https://www.rfc-editor.org/rfc/rfc4791) · [RFC 6764 (discovery)](https://www.rfc-editor.org/rfc/rfc6764)
- [GitHub — permissions for fine-grained PATs](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) · [OAuth App scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) · [Events](https://docs.github.com/en/rest/activity/events) · [Notifications](https://docs.github.com/en/rest/activity/notifications)
- [Slack scope reference](https://docs.slack.dev/reference/scopes) · [`search:read`](https://docs.slack.dev/reference/scopes/search.read) · [`users.profile.get`](https://docs.slack.dev/reference/methods/users.profile.get) · [Slack API Terms](https://slack.com/terms-of-service/api)
- [Notion authorization](https://developers.notion.com/docs/authorization) · [capabilities](https://developers.notion.com/reference/capabilities) · [search](https://developers.notion.com/reference/post-search)
- [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication) · [Asana OAuth scopes](https://developers.asana.com/docs/oauth-scopes) · [Atlassian 3LO](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)
- [Anthropic — Vision](https://platform.claude.com/docs/en/build-with-claude/vision) — the patch formula, resolution tiers, worked cost example · [pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [reduce latency](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency)

**Local tooling and git**

- [`git-status`](https://git-scm.com/docs/git-status) · [`git-reflog`](https://git-scm.com/docs/git-reflog) · [`git-log`](https://git-scm.com/docs/git-log) · [`git-gc`](https://git-scm.com/docs/git-gc) — the 90-day reflog default
- [zsh parameters](https://zsh.sourceforge.io/Doc/Release/Parameters.html) · [zsh options](https://zsh.sourceforge.io/Doc/Release/Options.html) — `EXTENDED_HISTORY`
- [SQLite `PRAGMA locking_mode`](https://www.sqlite.org/pragma.html) · [URI parameters](https://www.sqlite.org/uri.html) — the `immutable=1` warning
- [llama.cpp](https://github.com/ggml-org/llama.cpp) · [multimodal docs](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md) · [Apple Silicon thread](https://github.com/ggml-org/llama.cpp/discussions/4167) *(community-contributed, frozen 2023 commit)*
- [Ollama](https://github.com/ollama/ollama) · [context-length](https://raw.githubusercontent.com/ollama/ollama/main/docs/context-length.mdx) · [MLX](https://github.com/ml-explore/mlx) · [mlx-lm benchmarks](https://raw.githubusercontent.com/ml-explore/mlx-lm/main/mlx_lm/BENCHMARKS.md) *(first-party)* · [mlx-swift-lm](https://github.com/ml-explore/mlx-swift-lm)

**Comparable products (first-party only)**

- Microsoft Recall: [manage-recall](https://learn.microsoft.com/en-us/windows/client-management/manage-recall) · [sensitive information filtering](https://learn.microsoft.com/en-us/windows/client-management/recall-sensitive-information-filtering) · [snapshots and disk space](https://support.microsoft.com/en-us/windows/manage-your-recall-snapshots-and-disk-space-2c35b596-5a96-4090-b791-c27fae75f660) · [security architecture](https://blogs.windows.com/windowsexperience/2024/09/27/update-on-recall-security-and-privacy-architecture/) · [the opt-in reversal](https://blogs.windows.com/windowsexperience/2024/06/07/update-on-the-recall-preview-feature-for-copilot-pcs/)
- Rewind / Limitless: [limitless.ai](https://www.limitless.ai/) (the sunset notice) · [Rewind privacy, archived](https://web.archive.org/web/20240224095244/https://www.rewind.ai/privacy) · [Rewind compression, archived](https://web.archive.org/web/20250109013308/https://help.rewind.ai/en/articles/6706118-how-does-rewind-compression-work)

**This repository**

- [`extension/manifest.json`](../../extension/manifest.json) · [`extension/src/content.js`](../../extension/src/content.js) · [`extension/src/service-worker.js`](../../extension/src/service-worker.js)
- [`src/domain/detection/detect.ts`](../../src/domain/detection/detect.ts) · [`topics.ts`](../../src/domain/detection/topics.ts) · [`grounds.ts`](../../src/domain/detection/grounds.ts)
- [ADR-0002](../adr/0002-observation-capture.md) · [ADR-0008](../adr/0008-ambient-detection.md) · [ADR-0010](../adr/0010-acting-in-the-browser.md)
- [`SECURITY_AND_PRIVACY.md`](../SECURITY_AND_PRIVACY.md) · [`MVP.md`](../MVP.md) · [`FOUNDING_BRIEF.md`](../FOUNDING_BRIEF.md) · [`PRODUCT_PRINCIPLES.md`](../PRODUCT_PRINCIPLES.md) · [`observation-capture.md`](./observation-capture.md)
