# ADR-0004 — Making the policy gate unbypassable

**Status:** accepted · 2026-08-06
**Ticket:** [#13](https://github.com/smukhyala/propositum/issues/13)

## Context

"Models propose, deterministic code authorizes" is the entire safety story. If a worker can reach a
source, a document, or a network call without passing the gate — even by accident, even in a future
refactor — the story is decorative and every guarantee in the security doc is false.

The interesting question is not *what the gate checks*. It is **what makes bypass impossible rather
than merely impolite.**

## Decision

**A branded capability token that only the gate can construct, and tools that accept nothing else.**

```
ToolProposal  ──authorize(policy, proposal, run, intentId)──►  AuthorizedAction
   (no authority)                    │                              │
                                     └── refusal + rule             └── the only thing tools accept
```

Three parts:

1. **`AuthorizedAction` is branded** with a `unique symbol` declared in `gate.ts` and never
   exported. TypeScript admits exactly one construction site — `authorize()`. No other code can
   fabricate one, cast to one, or build one structurally.
2. **Every tool takes an `AuthorizedAction` as its first parameter.** A worker holding a
   `ToolProposal` can do nothing with it.
3. **The token is typed by kind.** `readApprovedSource` will not accept a token authorizing
   `draft-section`, so authority cannot be spent on the wrong action.

### Why this and not the alternatives

**A wrapper around every tool** relies on the wrapper being used. That is a convention, and
conventions are exactly what a refactor discards.

**A separate process with no ambient authority** is genuinely stronger and is the right answer if
the worker ever runs untrusted code. It is not warranted for slice 0, where the worker is our own
code and the threat is our own future carelessness rather than an adversary.

**Runtime checks inside each tool** put the check after the call site, which means a tool can be
called and only then refuse — so the refusal is a thrown exception rather than a recorded decision,
and the ledger loses it.

### The honest limit

This is a **compile-time** guarantee, not a runtime sandbox. Code inside this repo could reach the
brand reflectively off a real token. It makes accidental bypass impossible and deliberate bypass
loud — which is the correct bar for the actual threat model. It is not a defence against an attacker
who can already run arbitrary code in the worker; nothing at this layer would be.

## What the gate checks, in order

Deny by default. **No denylist** — a second mechanism creates a precedence question with no
principled answer.

| Order | Check | Refusal rule |
|---|---|---|
| 1 | budget exhausted | `budget_exhausted` |
| 2 | kind outside the enum | `unknown_action_kind` |
| 3 | kind not in the contract's allowlist | `action_kind_not_allowed` |
| 4 | plan longer than the cap | `plan_limit_exceeded` |
| 5 | off-plan without `use-judgment` | `off_plan` |
| 6 | later step under `current-step-only` | `step_out_of_scope` |
| 7 | source not approved / params absent | `source_not_approved`, `source_missing`, `document_missing` |

**Budget is checked first** so an exhausted run reports the real reason rather than whichever
narrower rule happens to also apply. And it refuses *everything*, including reads — a time limit is
a limit on working, not on writing, or the dial does not mean what its label says.

**Kind is checked as a `string`, not an `ActionKind`.** [#3](https://github.com/smukhyala/propositum/issues/3)
verified that `enum` does not survive schema transformation, so the model genuinely can return
`send-email`. Deny-by-default covers it; the cost is one wasted turn.

**Rules are identifiers, never prose.** They are queried, counted, and rendered — a refused
`ActionIntent` is evidence about H3.

## Blast radius needs no new field

The all-red diff is a **policy** failure, not a rendering one: no differ rescues a wholesale
rewrite, so re-entry quality dies regardless of the diff UI. Bounding it belongs here.

But it needs no dedicated policy field, because the plan already bounds it — one `PlanStep` is one
action, and each drafting step targets a distinct section, so capping plan length caps sections
touched. `MAX_PLAN_STEPS = 12` is a module constant. Adding `maxSectionsPerRun` beside it would be a
second mechanism for one truth, and `CONTEXT.md` stays unchanged.

## The gate is pure

No clock, no I/O, no model. Time arrives as `RunContext.nowEpochMs`, so a 40-minute fixture replays
in 400ms and a decision never depends on when it ran.

The domain is finite — 2 × 2 × 2 controls × the `ActionKind` set — so `tests/policy-gate.test.ts`
walks the matrix exhaustively rather than sampling it. A gate with an untested combination is a gate
with an unknown hole.

## Enforcement is tested, not documented

Three layers, because a rule that lives only in this file is a rule people forget.

**Compile-time** — `tests/policy-gate.type-test.ts` is never run; `tsc --noEmit` is the assertion.
Each `@ts-expect-error` asserts the next line does *not* compile, so if a change makes one legal,
TypeScript flags the unused directive and the typecheck fails. It proves prose cannot reach
`compilePolicy`, authority cannot be fabricated, a read token cannot be spent on a drafting tool,
and the compiled policy cannot be widened by its holder.

**Architecture** — `tests/architecture.test.ts` parses `tools.ts` and fails if an exported function
lacks an `AuthorizedAction` first parameter. **Verified by adding an ungated `fetchAnything` tool and
watching it fail by name**, then removing it. A guard that has never been seen to fail is not known
to work.

It also checks the brand is never exported, that no tool exists for sending / purchasing /
publishing / deleting, and that the domain layer imports nothing from `app`, `model`, `persistence`
or `policy`, makes no network or filesystem calls, and never reads the clock.

**Behaviour** — the exhaustive matrix above.

## Absence over prohibition

`ActionKind` is `read-approved-source | read-document | draft-section`. Capabilities the brief
excludes — send a message, purchase, publish, delete a file — are **absent from the enum entirely**
rather than denied by a rule.

A prohibition implemented as a missing capability cannot be misconfigured and cannot be re-enabled
by a policy bug. It is the strongest form available, and the architecture test asserts those
functions do not exist.

## A bug worth recording

The brand was first written as `declare const authorized: unique symbol`. That type-checks
perfectly and is completely broken: `declare` is type-only and emits nothing, so at runtime the
token carried no brand and every construction threw `ReferenceError`.

Six tests caught it immediately. Worth recording because the failure mode is instructive — the type
system was fully satisfied by a program that could not run, and only executing it revealed that.

## Consequences

- The reviewer split is now concrete. Scope adherence is **deterministic**: sources used ⊆
  allowlist, actions ⊆ permitted, both readable straight off the ledger. The model reviewer never
  touches it. This is why `ReviewFinding` is display-only, and why the reviewer is close to
  decorative in slice 0 — recorded as a measured question rather than an assumed answer.
- Refusals are first-class. Every one becomes an `ActionIntent` with `authorized = false` and a
  `refusedRule`, queryable for H3 scoring.
- Tools are stubs. The gate contract is what this ticket owed; wiring them to a fetcher and a
  document store belongs to the build slices.
- Semantic stop conditions are **not** here. Structural ones already implied by the policy are
  enforced; the rule set is [#15](https://github.com/smukhyala/propositum/issues/15).

## Revisit when

- The worker runs code we did not write. That is when the separate-process model stops being
  over-engineering and starts being the requirement.
- A capability is genuinely needed that mutates something outside a `Changeset`. Adding it to
  `ActionKind` should feel heavy, because it is.
