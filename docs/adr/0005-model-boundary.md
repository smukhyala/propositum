# ADR-0005 — The model boundary

**Status:** accepted · 2026-08-06
**Ticket:** [#14](https://github.com/smukhyala/propositum/issues/14)
**Research:** [`structured-model-output.md`](../research/structured-model-output.md) (with the
corrections from [#3](https://github.com/smukhyala/propositum/issues/3))

## Context

Six places call a model: session-reading inference, handoff generation, planning, worker action
proposals, review, and shift-report narration. Each needs a schema, validation, failure handling,
traceability, deterministic fixtures, and substitutability. The brief forbids scattering provider
calls through UI or domain code.

Getting the pattern right once determines the quality of all six.

## Decision

**Two shapes, deliberately separated.**

A **`ModelBoundary` is data** — prompt builder, schema, version, token budget. Pure, trivially
testable, and where the interesting decisions live.

A **`ModelClient` is the machine** — call, classify, repair, record. One real implementation, one
fake, neither knowing anything about any particular boundary.

Structured outputs throughout: `output_format` + `betaZodOutputFormat` +
`client.beta.messages.parse()`. All three under the **beta** namespace — the research recorded the
stable names and was wrong.

### Failures are values, not exceptions

`run()` does not throw for model failures. An unattended run at 2am has to record what went wrong
and decide what to do next; an exception thrown through the worker loop loses the telemetry and
turns a recoverable boundary failure into a dead run.

It throws only for programmer error — a boundary that cannot be built at all.

### Classify by `stop_reason` before parsing

Order matters and is easy to get wrong. The SDK's parser throws on truncated JSON **without
consulting `stop_reason`**, so a parse-first design reports "schema mismatch" for what is actually
"ran out of tokens", then repairs the wrong problem and burns a turn to be told the same thing.

| Failure | Recovery | Why |
|---|---|---|
| `refusal` | **none** | Terminal. Retrying asks the same model the same thing. |
| `truncation` | one doubled-budget escalation | A second would double again into a budget the boundary never sized for. |
| `schema-mismatch` | exactly one repair turn, quoting the Zod issues | More than one rarely converges and always costs minutes. |
| `transport` | **none** | The SDK already backs off. Stacking retries multiplies delay and hides the real error behind a timeout. |

## Schema design, forced by what the grammar actually enforces

[#3](https://github.com/smukhyala/propositum/issues/3) verified by execution that the grammar
enforces **shape only**. `enum`, `const`, `default`, `minLength`, `maxLength` and `pattern` are all
folded into `description` as prose; `z.record()` collapses so the empty object is the only legal
value.

Three consequences bind every boundary:

1. **No discriminated unions on a literal discriminator.** A bad discriminator makes the whole union
   unresolvable and the repair message useless. Flat objects with a `kind` string fail on one named
   field and repair cleanly.
2. **`z.record()` is banned** in model-facing schemas.
3. **Every model-facing enum needs a Zod check and a fail-closed path**, because the model genuinely
   can return a value outside the set.

**Zod re-validates after the grammar.** The grammar guaranteed shape; bounds, patterns, enum
membership and refinements are only prose to the model and are checked client-side. That gap is
precisely where the repair turn belongs.

### The model emits no ids

The grammar cannot enforce referential integrity, so asking for real event ids invites plausible
fabrications. The prompt numbers events `E1..En` and the model cites those handles; a Zod refinement
resolves them against the exact handle set it was shown.

This is the one failure class where re-asking is rational — the model can see what it got wrong. It
is also why `sessionReadingSchema` is built per call: a static schema could check the *shape* of a
citation but not whether it points at anything real.

## No prompt caching

Changing `output_format` invalidates the cache, so six schemas mean six mutually-exclusive prefixes
even with byte-identical system prompts. Four of the six boundaries run once per handoff, minutes
apart, against a 5-minute TTL — `cache_control` there is a pure 1.25× write tax that is never read.

Deliberately omitted rather than forgotten.

## Measured cost, and a correction to the earlier figure

[#3](https://github.com/smukhyala/propositum/issues/3) measured a toy call. The reference boundary
on a realistic five-event session is substantially heavier:

| | Toy call (#3) | Real session-reading |
|---|---|---|
| Latency | 7.8 s | **15.1 s** |
| Tokens | 470 in / 266 out | **1,235 in / 1,053 out** |
| Cost | $0.0090 | **$0.0325** |

**A 30-minute budget buys roughly 120 sequential calls, not 231** — before any tool latency,
research fetches, or repair turns. Cost for a full handoff still lands around a dollar, so the
conclusion holds: **latency binds, cost does not, and Budget stays time-only.** But the margin is
narrower than the toy call implied, and boundaries with larger schemas will be heavier still.

Recorded because the earlier number is quoted in `MVP.md` and would otherwise quietly become wrong.

## Testing: four layers, and what each does NOT answer

Being explicit about the gaps, because the tempting mistake is a suite of green fake-backed tests
that would stay green through a breaking API change.

| Layer | Answers | Does not answer |
|---|---|---|
| **1 Fakes** (`FakeModelClient`) | Is our control flow right? | Anything about the API |
| **2 Cassettes** | Does the wire format still match? | Whether the model behaves the same |
| **3 Schema snapshots** (`schema-transformation.test.ts`) | Has a Zod/SDK bump silently weakened the grammar? | Anything about a live call |
| **4 Live contract** (`npm run test:live`) | Does the API still return what we expect? | Nothing — but it costs money and takes seconds |

Layers 1 and 3 run in `npm test`. Layer 4 runs deliberately. **Layer 2 is not built yet** — noted
here rather than left as an implicit gap.

**The fake is held to the real contract.** Scripted replies are validated against the boundary's own
schema before being returned, so a fixture cannot drift into a shape the real client could never
produce. A fake that can return impossible values tests nothing.

It also **throws on an unscripted call** rather than returning a default, because a test making an
unexpected extra call has found something.

### Live tests need their own config, not a flag

Vitest's CLI `--exclude` **appends** to the base config's exclude list rather than replacing it, so
`*.live.test.ts` stays filtered out however it is named on the command line. `vitest.live.config.ts`
exists for that reason. A config that cannot run its own tests is worse than no config.

## Traceability

`onCall` fires once per attempt, **including failures** — traceability that only records successes
is not traceability. Each emission carries boundary, model, prompt version, tokens, latency, stop
reason, and repair count, and becomes one `ModelCallRecord` row.

`promptVersion` is mandatory. Prompts are code — they need review and regression tests — and a
telemetry row that cannot say which prompt produced it is not traceability either.

`ModelCallRecord` is deliberately distinct from `ActionIntent`. A model call is not an action the
person authorized, and the ledger they *read* must not list them.

## Consequences

- One boundary is implemented — `session-reading` — as the reference the other five copy. Its file
  layout (schema, prompt, version, budget colocated) is the pattern: a prompt change and its schema
  change land in the same diff and the same review.
- Streaming is not a cost lever. It is required above `max_tokens ≈ 21,333`, where the SDK throws
  locally before any HTTP call, and it is a genuine liveness signal for an unattended run. Encoded
  as `NON_STREAMING_MAX_TOKENS` so a boundary raising its budget cannot silently become unrunnable.
- Untrusted content has a labelled slot in the prompt (`page text:`) and a system-prompt rule that
  it is evidence, never instruction. **Datamarking itself is [#18](https://github.com/smukhyala/propositum/issues/18).**
  The field exists so the boundary is ready rather than needing reshaping.
- The prompt asks for an honest low-confidence answer explicitly, on the grounds that a person
  corrects a stated "I could not work this out" and may not notice a confident guess.

## Revisit when

- Cassettes are needed — the first time a wire-format change breaks something and layer 1 does not
  notice.
- A boundary needs a schema large enough that input cost stops being negligible. Input scales with
  schema size, not prompt size.
- A second provider is genuinely required. The interface allows it; nothing else should.
