# 05 — Get the extension out of Developer mode

**Status:** not started
**Blocked by:** ~~[`01`](./01-menu-bar-app.md) and~~ item 7 of
[`04`](./04-quick-fixes.md). ~~Do not submit before the id is pinned and the
desktop app can pair it.~~ **Corrected 2026-08-28, in two halves: `01` stage 2
is done ([ADR-0027](../adr/0027-a-sealed-bundle-and-where-the-state-moves.md)),
and the second condition was never real — the desktop app deliberately pairs
nothing (`/welcome` pairs, restart-free; ADR-0023's own table row records why
a tray-written id would be a regression). What still holds: do not submit
before the id is pinned.**
**Blocks:** anybody installing this who is not you.

This is the file with the longest wall-clock time and the least work in it. Most
of it is waiting for a review team, and the permissions this extension holds are
the kind that get a submission read carefully by a person.

---

## Is this already done?

```bash
grep -n 'update_url\|"key"' extension/manifest.json
grep -n '"version"' extension/manifest.json
```

**As of 2026-08-26:** no `update_url`, no `key`, `"version": "0.0.1"`. There is
no store listing. The extension is loaded unpacked, in Developer mode, which
means Chrome nags about it on every restart and the id changes if the folder
moves.

---

## What you have to do yourself

Almost all of this file is this section.

| | What | Cost | Lead time |
|---|---|---|---|
| **Account** | A Chrome Web Store developer account, on a Google account you are willing to have permanently attached to this. | **$5, one-off** | minutes |
| **Verification** | Verify a contact email. For a broad-permission extension, expect to be asked for more. | free | hours to days |
| **Hosting** | **A privacy policy at a public URL.** Required, and it must be a real page — not a file in the repo. `docs/SECURITY_AND_PRIVACY.md` is the content; somewhere to serve it is the missing part. Note the awkwardness: this product's whole argument is that there is no server of ours, and the store requires a hosted page. | a domain, if you do not have one | an afternoon |
| **Assets** | A 128×128 icon, at least one 1280×800 (or 640×400) screenshot, and a short store description. `public/` currently holds one file. | free | an afternoon |
| **Writing** | **A justification, per permission, that a human reviewer reads.** See below. This is the part that decides whether it takes a week or a month. | free | half a day, and worth all of it |
| **Patience** | An extension holding `debugger` plus `https://*/*` does not get an automated pass. Expect an in-depth review, expect questions, and expect **weeks** rather than days. | free | weeks |

### The permission story, which is the actual work

Chrome will show a person installing this:

- *"Read and change all your data on all websites"* — from `host_permissions: ["https://*/*"]`
- *"Access the page debugger backend"* — from `debugger`
- *"View and manage your tab groups"* — from `tabGroups`
- *"Display notifications"* — from `notifications`

The manifest's own superseded comment names the problem better than a reviewer
will: *"a consumer product that asks to read your browsing history has already
lost the argument it is trying to make."*

**The arguments already exist and are unusually good.** They are in
`extension/manifest.json`'s `_comment_*` blocks, in
[ADR-0002](../adr/0002-observation-capture.md),
[ADR-0008](../adr/0008-ambient-detection.md),
[ADR-0010](../adr/0010-acting-in-the-browser.md) and
[ADR-0013](../adr/0013-authored-labels-and-exit-type.md). The four points that matter to a
reviewer:

1. **No `tabs` permission and no `chrome.tabs.query`** — so no tab list is ever
   enumerated, held by `tests/extension-permissions.test.ts`.
2. **No `Runtime` domain, ever.** Propositum never runs a line of its own
   JavaScript inside a page the person is signed into; clicks are synthesised at
   coordinates. Held by `tests/extension-cdp.test.ts`, which greps for the calls
   that must never appear.
3. **The only tab it ever attaches to is one it opened itself** —
   `chrome.tabs.create` is the sole source of a tab id in the extension.
4. **The extension is buildless.** The file in git is the file Chrome runs, which
   makes every grep test a real guard and makes the source a reviewer reads the
   source that ships.

Write those four as the submission's justification, not as a link to an ADR.

---

## The work

1. Pin the `key` — item 7 of [`04`](./04-quick-fixes.md) — and confirm the id it
   produces matches whatever is already in anybody's `.env`.
2. Bump `"version"` to something meaningful. `0.0.1` reads as abandoned.
3. Host the privacy policy; put its URL in the listing and in the side panel.
4. Produce the icon and screenshots.
5. Write the per-permission justification and the single-purpose statement.
6. Submit. Then wait, and answer questions in the register of the ADRs rather
   than the register of a support ticket.
7. Once published, add the store id to the desktop app's pairing flow so pairing
   stops depending on Developer mode at all.

---

## Done when

A person can install the extension from the store, and the six-step order in
`extension/README.md` collapses to *install, then grant each source from the side
panel* — that last step being the one that can never be automated, because a host
grant needs a user gesture.

---

## What this does not cover

- **`tabGroups` disables the extension pending re-approval when added in an
  update.** It is already in the manifest, so this is a note for the next
  permission rather than this submission — but it is the shape of every future
  permission change and it is worth knowing before you need it.
- **Rejection is a real outcome.** `debugger` on a consumer extension is unusual.
  If it is refused, the fallback is not a smaller extension — it is
  [ADR-0010](../adr/0010-acting-in-the-browser.md) reopened, because acting in
  the person's own browser is what that permission buys.
- **Firefox, Edge, Safari.** Different stores, different manifests, different
  arguments.
