# ADR-0028 — A capped key ships in the bundle, and the first run stops asking for one

**Status:** accepted · 2026-08-29
**Requested by:** the owner, 2026-08-29, in the todo 09 design sitting — *"we can use our own
internal anthropic api key for now, find way to get money back later not that important"*
**Depends on:** [ADR-0027](./0027-a-sealed-bundle-and-where-the-state-moves.md) — the sealed
bundle this key rides in, and the staging script that would carry it
**Amends:** the invariant *"`ANTHROPIC_API_KEY` is the only credential needed"* (AGENTS.md,
`docs/SECURITY_AND_PRIVACY.md`) — the credential stops being **the person's** in a tester build,
which is a change in kind those documents must carry as a dated note

## What this costs

**A distributed artefact carries a live secret, and extraction is one `strings` away.** Anyone
who downloads the `.dmg` — and a GitHub release page is public — can lift the key and spend
against it from any machine, for anything, with no tie to Propositum at all. The **hard monthly
spend cap on a dedicated workspace key is the entire containment**, and rotation-plus-new-release
is the entire remedy. That is a weaker guarantee than any other credential arrangement in this
repository, and it is accepted with eyes open because the alternative — an API-key step in the
first run — is the single least native moment the product has, and todo 09's design brief is that
setup feels like part of the Mac.

A second cost, smaller but real: every tester's prompts pool on one key, so Anthropic's usage
view attributes all of them to the owner. The *content* exposure is unchanged — prompts already
go to Anthropic — but attribution stops being per-person.

## Decision

1. **A build may carry a bundled key.** A dedicated Anthropic workspace key with a hard monthly
   spend cap, created for exactly this, revocable in one click. It reaches the staged runtime at
   stage time **from the builder's environment** (locally, or a CI secret) — it never enters git,
   and a build whose environment carries no key produces the keyless behaviour below.
2. **The person's own key always outranks it.** The state-dir `.env` (the tray's *Set the API
   key…*) wins over the bundled default, using the same precedence mechanics ADR-0027 §2
   established — explicit and layered, nothing guessed. The key appears in no log, no error and
   no return value, which is `env_file.rs`'s standing discipline.
3. **Asking remains the floor.** When the bundled key is absent~~, revoked or exhausted~~, the first
   run falls back to asking for a key exactly as `/welcome` *(now `/first-run`)* does — worse-looking and still
   working beats sleek and dead.
4. **Tester circle only.** The moment distribution is aimed at people the owner has not met,
   this ADR's premise is spent and the *Revisit when* below fires.

## Rejected alternatives

**A metered proxy of ours.** The natural "right" answer — testers hit our endpoint, we hold the
key server-side, per-tester limits. Rejected because it is *a server of ours*, which reverses
*"no cloud, no telemetry, no server of ours"* wholesale to solve a pre-alpha convenience; it
also creates real per-person usage telemetry where none exists today. If the product ever needs
metered distribution, that is its own ADR and a much bigger day.

**Per-tester keys, handed personally.** Better containment (revoke one tester, not the fleet)
and no secret in a public artefact. Rejected *for now* on friction — it reintroduces a
provisioning step per person, which is most of what this ADR exists to remove — and it returns
as the obvious middle ground when the circle grows.

**Keep the key step.** The status quo. It is the floor (Decision 3), not the front door.

## What holds the line now

| | |
|---|---|
| The workspace spend cap | Set in Anthropic's console, outside this repository — **discipline, not code**; nothing here can verify it exists |
| Stage-time injection from env | The key has no home in git; `scripts/stage-runtime.ts` carries the mechanism *(built 2026-08-30)* |
| Precedence under the person's key | ADR-0027 §2's layered child-env mechanics, unit-tested in `src-tauri/src/runtime.rs` *(built 2026-08-30; detection is presence, not validity — a revoked or exhausted bundled key still reads as set, and that failure surfaces at the model call, one menu from the tray's* Set the API key… *item)* |

## Revisit when

- **Distribution goes beyond people the owner knows.** A capped shared key in a public artefact
  is a tester-circle arrangement, not a product one.
- **The cap gets hit by abuse.** Rotation works once or twice; a pattern means per-tester keys
  or the proxy argument, properly had.
- **"Getting money back" starts mattering.** Billing is a different product decision and
  nothing here prices it.
