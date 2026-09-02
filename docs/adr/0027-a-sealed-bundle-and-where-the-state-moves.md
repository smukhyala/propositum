# ADR-0027 — Shipping a sealed bundle, and refusing the update feed for now

**Status:** accepted · 2026-08-28
**Ticket:** [#125](https://github.com/smukhyala/propositum/issues/125)
**Depends on:** [ADR-0023](./0023-the-tray-app-owns-the-runtime.md) — the binary this signs and
ships; its stage split named signing, notarisation and a bundled runtime as stage 2
**Amends:** [ADR-0023](./0023-the-tray-app-owns-the-runtime.md) — the *Configures* row's `.env`
location, for an installed copy only; a checkout is untouched

## Context

Stage 1 supervised the checkout: the children ran out of the repository, `.env` sat beside the
code, and `repo.rs` resolved `node` by probing the person's login shell. None of that survives
contact with a stranger, and ADR-0023 said so about itself — *"the reason n=1 is partly that the
second person cannot get the thing running."*

A distributable macOS app is signed and notarised, and a signed bundle is **sealed**: writing
into `Propositum.app` breaks the signature the whole exercise exists to earn. So bundling the
runtime forces two decisions that were never taken because there was nowhere to take them —
where the person's mutable state lives, and what the shipped binary is allowed to trust.

## Decision

**1. The bundle carries the checkout's shape, sealed.** `scripts/stage-runtime.ts` stages the
sources, a production `node_modules`, a prebuilt `.next` and a pinned, checksum-verified Node
sidecar; Tauri copies the tree into `Contents/Resources/runtime` and the sidecar into
`Contents/MacOS/node`. The shape that is known to run — tsx over `src/`, the same entrypoints
stage 1 spawned — is the shape that ships. Nothing in the app writes inside the bundle, and the
staged tree holds zero symlinks, because codesign seals a symlink as its literal target string
and one escaping the bundle notarises fine and breaks on the stranger's machine.

**2. The person's state lives in `~/Library/Application Support/Propositum/`** — `.env` (0600)
and `propositum.db` — and reaches the children as **explicit environment**, not a dotfile: the
supervisor parses the state-dir `.env` and appends its own `DATABASE_URL`, which no line in the
file can outrank. Explicit env wins in all three of the runtime's dotenv readers (Next, the
worker's `loadEnvFile`, Prisma's bundled dotenv), which is what makes a sealed bundle workable
without patching any of them. A checkout keeps stage 1's behaviour byte for byte: `.env` in the
checkout, nothing injected.

**3. The hardened runtime gets exactly two carve-outs**, in `src-tauri/entitlements.plist`:
`allow-jit` (arm64 W^X — a hardened Node aborts at startup without it) and
`allow-unsigned-executable-memory` (Node upstream ships it; likely inert on arm64; kept because
the failure mode of guessing wrong is an abort in a path no test exercises). These are
constraints relaxed on our own processes, **not TCC grants** — they take nothing of the
person's and prompt nobody — and `tests/tray-permissions.test.ts` now pins that distinction:
the file is admitted by exact path and exact content while every piece of TCC vocabulary stays
banned. `disable-library-validation` is deliberately absent; every Mach-O in the bundle is
signed with the same Developer ID instead (`scripts/sign-runtime.ts`), so the hole is not
needed.

**4. The update feed is refused, for now.** Todo 01 item 10 named it in a checklist, which is
not where a decision of this shape belongs. At its strongest: an app without an update feed
rots, a stranger never learns a bug was fixed, and Tauri makes the plumbing an afternoon. But a
feed is a URL the shipped binary polls for new code — on a product whose posture is *"no cloud,
no telemetry, no server of ours"*, it is the first phone-home this binary would ever make, it
tells whoever hosts the feed when and how often every install is awake, and its signing keypair
is a second credential to hold. That deserves its own ADR with those arguments answered, not a
row in a build script. Until then, updating is downloading the next `.dmg`.

**Apple Silicon only, for now.** A universal build doubles the sidecar story (two Node
runtimes, lipo) for machines that are two hardware generations gone; it is planned, not built,
and `stage-runtime.ts` refuses on any other arch so the limit is stated where it binds.

## Rejected alternatives

**State inside the bundle.** Where stage 1 kept it, and the reason this ADR exists: the first
`.env` write would break the signature. Not close.

**Next standalone output plus a precompiled worker.** Smaller — `output: 'standalone'` traces
the server's real dependency set, and an esbuild-compiled worker would drop tsx and its
compiler from the bundle. Rejected for this slice because it ships a *different shape than the
one that runs in development*: the `triggers.sql` lookup rides on module-relative arithmetic,
the worker leans on `tsconfig.json` at runtime, and every difference between the tested tree
and the shipped tree is a place only a stranger can find the bug. The ~200 MB this costs is
real and is the price of shipping the tested thing. Revisit when size hurts.

**The updater now.** Argued above at its strongest, refused above.

## What this costs

The download is roughly two hundred megabytes of `node_modules` a leaner build would not
carry. The staged tree is a second copy of the product that can diverge from the checkout by
exactly the set of staging bugs — held by script assertions, not by construction. Two JIT
carve-outs weaken hardened runtime for our own processes, permanently, because V8 is the
runtime. The person's data now lives in a different place per mode — an installed copy and
a checkout on the same machine are two products with two databases, which is correct and will
confuse somebody. And **every signed build uploads the entire staged runtime tree to Apple,
twice** — `notarytool submit` on the `.app` and again on the `.dmg` — which is why the staging
script strips `src/fixtures/afternoons/` (where `capture:afternoon` writes what ADR-0015 calls
"a profile of you") and asserts its absence: staging copies the working tree, the never-commit
fence only guards commits, and distribution must not become the exit the fence never covered.
The builds themselves run with Next's and Prisma's phone-homes off, and the bundled children get
the same two switches, because a no-telemetry product does not ship a vendor's exception.

## What holds the line now

| | |
|---|---|
| `tests/tray-permissions.test.ts` | The entitlements file pinned to exactly two keys; TCC vocabulary still banned; the capability file pinned to one window, core defaults |
| `scripts/stage-runtime.ts` | The zero-symlink sweep, the load-bearing-path assertions, the checksum on the Node sidecar, and the assertion that `src/fixtures/afternoons` never ships |
| `scripts/release-tray.ts` | The post-build audit: no ad-hoc Mach-O anywhere in the bundle, and the sidecar's entitlements checked — the tripwire for the assumption that Tauri entitles sidecars |
| `tests/stage-runtime.test.ts` | The inventory, the engines floor and `tauri.conf.json`'s paths agree with the script |

## Revisit when

- **Anyone proposes the update feed.** It gets its own ADR, and the phone-home argument above
  is the one it has to answer.
- **A stranger on Intel asks.** Universal is a staging change (second tarball, lipo) and a CI
  matrix entry, not a design change.
- **The download size costs an install.** Then the standalone-output rejection above is worth
  re-arguing with measurements.
- **Anything proposes writing inside the bundle** — a cache, a settings file, an "just this
  once" temp file. The signature is the reason there is no field for it.
