# 09 — Onboarding

**Status:** ~~written down 2026-08-27, deliberately unshaped.~~ **Designed
2026-08-29, in the sitting this file was waiting for** — the owner and the
agent shaped it by interview, and the owner's own caveat is recorded with it:
*"this may and probably will be changed later."* The shape is below; ~~none of
it is built~~ **struck 2026-09-03 — all five items are built as of 2026-08-30
([#127](https://github.com/smukhyala/propositum/issues/127)); *The work* below
ticks each, and `ls src/app/first-run/page.tsx src/server/first-run.ts` finds
both**. The original note stands as history: the owner asked for
the file before the design: *"will flesh out how it looks later, but just make
sure it's written down."*
**Blocked by:** nothing, for the design pass itself. The *stranger's* path runs
through ~~[`01`](./01-menu-bar-app.md) stage 2 (a signed install) and~~
**— the signed install's machinery exists as of 2026-08-28
([ADR-0027](../adr/0027-a-sealed-bundle-and-where-the-state-moves.md)); what remains of `01` is a
credential step and a first tag, so the long pole is —**
[`05`](./05-chrome-web-store.md) (an extension that is not Developer mode) —
but deciding what the experience should be needs neither.
**Blocks:** nothing named yet. It will say what it blocks when it has a shape.

---

## Is this already done?

```bash
ls src/app/first-run/page.tsx src/server/first-run.ts
grep -rn 'Finish setting up' src/app/page.tsx src-tauri/src/menu.rs
grep -n 'first_run_window' src-tauri/src/main.rs   # the window opens itself
# history: until 2026-08-30 the first two greps named src/app/welcome/ and
# src/server/welcome.ts, which existed and were the point — the pieces
# without the experience. Both now 404/gone by design.
```

**Both return hits, and that is the point of this file: the pieces exist and
the experience is undesigned.** What exists as of 2026-08-27:

- **`/welcome`** — five steps (`key`, `extension`, `sources`, `watching`,
  `phone`), each derived from what is actually true rather than a progress
  cursor, so refreshing and returning land in the same place.
- **The front door links it** while setup is unfinished, and the tray app's
  menu carries the same *Finish setting up* link.
- **The tray app** (stage 1) holds the key field, runs `prisma db push` before
  the children, and installs the Playwright browser on a click.

What does not exist: any designed end-to-end first-run *experience* — the
sequence a new person actually walks, from nothing installed to first offer,
with the seams between the `.dmg`, the extension install, the key, and
`/welcome` decided rather than accreted. ADR-0023's own revisit line is the
bar nobody has measured against: *"Onboarding still takes more than five
minutes from a fresh user account"*.

## What you have to do yourself

| | What | Lead time |
|---|---|---|
| **Decision** | ~~**The owner fleshes this file out.**~~ **Done 2026-08-29 — see *The design*.** | ~~a sitting~~ **spent** |
| **Account** | **A dedicated, spend-capped Anthropic workspace key** for tester builds ([ADR-0028](../adr/0028-a-capped-key-ships-in-the-bundle.md)) — created in the Anthropic console, cap set by hand, revocable. Nothing in the repository can verify the cap exists; that is the ADR's stated weakest link. | minutes |

## The design *(2026-08-29)*

**The first run is a consent conversation, not a value demo.** The owner's
brief, near-verbatim: it should feel *"like an essential part of the mac"* —
Apple-assistant calm, *"simplistic and sleek"* — and therefore *"doesn't need
to immediately have value, but will generate value in the future."* Five
decisions:

1. **A native-feeling assistant window, rendering the app's own page.** The
   tray opens a dedicated window (the settings window's pattern, larger) that
   renders the first-run page from `127.0.0.1` — no browser chrome, no tabs.
   The *page* decides, so ADR-0023 prohibition 5 (*the tray decides nothing*)
   and ADR-0019 (*a decision needs a page*) both stand unspent.
2. **The opening ask is what Propositum should be for this person** — act on
   things now · quietly watch approved work and learn · just connect sources
   for later. The answer routes which consent cards come first; it is not a
   new persisted mode and adds no schema.
3. **One consent card per source that exists**: watching approved work in
   Chrome (a guided sideload from the bundle's own `extension/` folder,
   honest about Developer mode until [`05`](./05-chrome-web-store.md)), the
   calendar's free/busy (ADR-0014's scope, unchanged), and the phone thread.
   Each card grants exactly one thing; skipping any is fine. The consent
   language is written **source-generically** — *what may Propositum watch* —
   so a future source slots in without redesign.
4. **No key step.** Tester builds carry a spend-capped bundled key
   ([ADR-0028](../adr/0028-a-capped-key-ships-in-the-bundle.md)); the
   person's own key, set from the tray, always outranks it; asking remains
   the fallback when the bundled key is absent or exhausted.
5. **First value arrives later, by design.** No seeded offer, no demo
   theatre: the first offer is earned from whatever was consented to, in the
   person's first real working session.

**The bar, re-argued as this file was told to do:** ADR-0023's
five-minutes-from-a-fresh-account line is kept as the *setup* bound — the
assistant completes inside it comfortably — but time-to-first-offer moves out
of setup's ledger entirely, because point 5 makes deferral the design rather
than a failure.

## The work

**All five built 2026-08-30 ([#127](https://github.com/smukhyala/propositum/issues/127)),
in the order the naming rule demanded — the glossary entry first.**

1. ~~The assistant window in the tray~~ **Done** — `menu.rs`'s `first_run_window`
   renders `/first-run` in a chrome-less frame; `main.rs` polls
   `GET /api/first-run` once per launch after the children serve and opens it
   only while setup is unfinished. The label matches no capability, so the
   window has no IPC and `tests/tray-permissions.test.ts` held untouched.
2. ~~The first-run page itself~~ **Done** — `src/app/first-run/page.tsx`: the
   opening ask routes consent cards through a pure `consentOrder`, the ask
   lives in the URL and persists nothing, and `/welcome` folded (the module is
   `src/server/first-run.ts` now; `stepFrom`'s thirty-two-combination table
   moved intact).
3. ~~The guided extension sideload~~ **Done** — the watching card names the
   real absolute `extension/` folder, the bundle's own in an installed copy.
4. ~~ADR-0028's key mechanics~~ **Done** — stage-time injection from
   `PROPOSITUM_BUNDLED_KEY`, seeded under the person's own key by
   construction, asking as the floor; unit-tested in both directions.
5. ~~Naming~~ **Done** — `FirstRun` entered `CONTEXT.md` in the commit before
   any file used it. Consumer wording stayed the shipped set; the vocabulary
   guards read every new screen automatically.

## Done when

- A fresh macOS account installs the `.dmg` and the assistant window opens on
  first launch, walks the opening ask and the consent cards, and completes —
  key never mentioned when a bundled key is present — in under ADR-0023's
  five minutes, feeling like part of the machine rather than a web page.
- Skipping every card leaves a working, idle install that says so calmly.
- The first offer arrives from consented watching during the person's first
  real working session — measured, because that number replaces
  time-to-first-offer as the product metric that matters here.
- The guards agree: `tests/consumer-vocabulary.test.ts`,
  `tests/tray-strings.test.ts`, and `tests/tray-permissions.test.ts` all
  green, the last unchanged — nothing here takes a permission.

## What this does not cover

- **App-agnostic intent observation.** The owner's stated direction —
  *"in the future it should be app agnostic and should be able to track
  intent on everything the user does not just chrome"* — is recorded here and
  deliberately not designed: ambient system-wide observation is exactly what
  [ADR-0012](../adr/0012-screen-capture-refused.md) refused and
  [ADR-0025](../adr/0025-computer-use-beyond-the-browser.md) kept refusing
  (*"watching the desktop is a different product"*). When it arrives it
  reopens that argument by name, in its own ADR — which is why point 3's
  consent language is source-generic now.
- **The Chrome Web Store listing** ([`05`](./05-chrome-web-store.md)) — the
  sideload card gets less ugly the day that lands, and nothing here waits on
  it.
- **Getting money back** for the bundled key's spend — ADR-0028 records the
  owner's own priority: *"not that important."*
