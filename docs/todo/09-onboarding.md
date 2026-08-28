# 09 — Onboarding

**Status:** written down 2026-08-27, deliberately unshaped. The owner asked for
the file before the design: *"will flesh out how it looks later, but just make
sure it's written down."* So this records that the work exists and what is
already true, and attempts none of the design — a placeholder that pretends to
a shape would be the exact ahead-of-the-code failure this folder documents
catching three times.
**Blocked by:** nothing, for the design pass itself. The *stranger's* path runs
through [`01`](./01-menu-bar-app.md) stage 2 (a signed install) and
[`05`](./05-chrome-web-store.md) (an extension that is not Developer mode) —
but deciding what the experience should be needs neither.
**Blocks:** nothing named yet. It will say what it blocks when it has a shape.

---

## Is this already done?

```bash
ls src/app/welcome/page.tsx src/server/welcome.ts
grep -rn 'Finish setting up' src/app/page.tsx src-tauri/src/menu.rs
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
| **Decision** | **The owner fleshes this file out.** What the first run looks like, in what order, on which surfaces — this is the design pass the file is waiting for, and nothing below it can be written first. | a sitting |

## The work

*Unwritten, on purpose — see Status.* The one rule already binding on whatever
gets written: consumer wording comes from `CONTEXT.md`, and
`tests/consumer-vocabulary.test.ts` (app + side panel) and
`tests/tray-strings.test.ts` (tray) will read whatever screens it touches.

## Done when

*Unwritten.* A real Done-when arrives with the design; the only candidate
already on record is ADR-0023's five-minutes-from-a-fresh-account bar, kept
here so the design pass has to accept or argue with it.

## What this does not cover

Everything, currently — that is what a placeholder is. It exists so the work
is on the map rather than in somebody's head, per this folder's own rule that
found work gets a file in the change that finds it.
