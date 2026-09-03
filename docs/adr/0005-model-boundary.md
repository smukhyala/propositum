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

~~Structured outputs throughout: `output_format` + `betaZodOutputFormat` +
`client.beta.messages.parse()`. All three under the **beta** namespace — the research recorded the
stable names and was wrong.~~

> **Amended 2026-08-20 — that is true of one of the two paths, and the other one had never
> worked.** `betaZodOutputFormat` and the **beta** namespace stand; the rest is now split, and the
> split is not a preference.
>
> |                             | Boundary that does not stream  | Boundary that streams                              |
> | --------------------------- | ------------------------------ | -------------------------------------------------- |
> | Call                        | `client.beta.messages.parse()` | `client.beta.messages.stream()` + `finalMessage()` |
> | Field                       | `output_format`                | `output_config.format`                             |
> | Where the object comes from | the SDK's `parsed_output`      | this repo parses the text block itself             |
>
> **What was wrong.** `.parse()` does not support streaming. Handed `stream: true` it pipes the
> returned `Stream` into `parseBetaMessage`, which does `message.content.map(...)` on an object that
> has no `content`, and throws `Cannot read properties of undefined (reading 'map')`. `worker-action`
> is the only boundary with `stream: true` — so **every action proposal the product ever made
> failed**, was misfiled as `transport` by the client's catch, and was then discarded entirely by
> `runWorker`'s `finish([], 'failed')`. A live eval of all four scenarios took `0 action(s)` on all
> four. 1,709 tests were green throughout, because every other test of this layer runs on
> `FakeModelClient`, which never touches the SDK at all.
>
> **Why the two halves cannot be made to match.** Measured against `claude-opus-5` on
> `@anthropic-ai/sdk` **0.71.2** — the version matters, because the whole trap is a version lag:
>
> - `.stream()` + `output_format` → HTTP 400, _"output_format: This field is deprecated. Use
>   'output_config.format' instead."_
> - `.stream()` + `output_config.format` → works, and `parsed_output` comes back **null**, because
>   `maybeParseBetaMessage` decides whether to parse by testing `params.output_format` and consults
>   nothing else.
>
> So the field the API has deprecated is the only field the SDK's parser knows. The non-streaming
> path stays on `output_format` **deliberately**: moving it for symmetry would null its
> `parsed_output` too and break the three boundaries that work today, buying tidiness with three
> regressions. Upgrading the SDK is the real fix and is not this change; the lag is a fact to work
> with today.
>
> **What did not change.** Zod still re-validates everything the grammar does not enforce — the
> section below is untouched, and it is what makes hand-parsing the streamed text block safe rather
> than a second place for shape to be trusted. `classifyStopReason` still runs **before** any parse,
> which is also what lets a `JSON.parse` failure on the streaming path be read as `schema-mismatch`
> rather than truncation: truncation has already been ruled out by then. And `schema-mismatch` is
> what it is filed as — **a `JSON.parse` failure on a complete response is not `transport`**. Half of
> why this defect hid for a wave is that a local TypeError was reported as a network error, which is
> the one classification nobody investigates and the one `recoveryFor` gives no repair turn to.
>
> Guarded in two places, both load-bearing: `tests/architecture.test.ts` refuses a boundary
> declaring `stream: true` reaching the `.parse()` call site, and `tests/model-boundary.live.test.ts`
> drives the streaming boundary against the real API. The second is the only kind of test that could
> have caught this. **Revisit when the SDK's parser learns `output_config.format`** — then both paths
> collapse onto it and this amendment goes with them.

### Failures are values, not exceptions

`run()` does not throw for model failures. An unattended run at 2am has to record what went wrong
and decide what to do next; an exception thrown through the worker loop loses the telemetry and
turns a recoverable boundary failure into a dead run.

It throws only for programmer error — a boundary that cannot be built at all.

### Classify by `stop_reason` before parsing

Order matters and is easy to get wrong. The SDK's parser throws on truncated JSON **without
consulting `stop_reason`**, so a parse-first design reports "schema mismatch" for what is actually
"ran out of tokens", then repairs the wrong problem and burns a turn to be told the same thing.

> **Amended 2026-09-03 — this order was not ours to keep, and we were not keeping
> it.** `betaZodOutputFormat` gives `beta.messages.parse()` a validator that
> THROWS, and `parseBetaOutputFormat` rethrows it, so on the non-streaming path
> the SDK parsed before this repository could classify anything. Two failures
> came out of that as `transport`, which is the classification `recoveryFor`
> grants nothing:
>
> - **A reply in the wrong shape.** Measured 2026-09-02: `partnership-messy`'s
>   session reading cited an evidence handle it had not been shown, the
>   refinement rejected it correctly, and the repair turn this table promises —
>   for the one failure class the section below calls the one where *"re-asking
>   is rational"* — never fired. That scenario produced no reading at all.
> - **A reply truncated at `max_tokens`.** Truncated JSON is not JSON, so the
>   same validator threw on it too, and every truncated non-streaming reply was
>   filed as a network error rather than escalated. Exactly the mistake this
>   section forbids, arriving from inside the SDK.
>
> The fix is to stop asking the SDK to validate. `structuredOutput` in
> `src/model/anthropic.ts` keeps `betaZodOutputFormat`'s JSON schema — the wire
> request is byte-identical, because `parse` is a function and never leaves the
> process — and replaces its `parse` with a decode that never throws.
> `stop_reason` is read first and Zod second, which is what this section asked
> for in the first place. `classifyThrow` is the fallback for a throw that
> arrives anyway, and it reads the whole `APIError` family as `transport`
> structurally before testing any message. *(Added 2026-09-03: the SDK's own
> local refusal of an oversized non-streaming request — "Streaming is required
> for operations that may take longer than 10 minutes", a bare `AnthropicError`
> naming no field — is `truncation` too, so it gets the one doubled retry below
> rather than `transport`'s none. Every budget in `src/model/boundaries` doubled
> stays under `NON_STREAMING_MAX_TOKENS`, so that retry runs on the same
> transport; `tests/model-boundary.test.ts` holds both. What it does not cover:
> a retry the SDK refuses again, which is filed `truncation` a second time and
> ends there.)*
>
> **The table below is unchanged**, including `transport → none`: the SDK backs
> off already, and stacking our own retries multiplies the delay and hides the
> real error. What changed is which failures are honestly called `transport`.
>
> **A throw now records null tokens rather than zero.** Zero was a claim that
> the call was free, and it is what made 2026-09-02's `$0.81` a floor printed as
> a figure. `ModelCallRecord.inputTokens` and `outputTokens` are nullable for
> that reason, and anything summing them is summing a lower bound and should say
> so. What it does **not** cover: `FakeModelClient` still reports zero, because a
> scripted reply genuinely spent nothing.

| Failure           | Recovery                                        | Why                                                                                                     |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `refusal`         | **none**                                        | Terminal. Retrying asks the same model the same thing.                                                  |
| `truncation`      | one doubled-budget escalation                   | A second would double again into a budget the boundary never sized for.                                 |
| `schema-mismatch` | exactly one repair turn, quoting the Zod issues | More than one rarely converges and always costs minutes.                                                |
| `transport`       | **none**                                        | The SDK already backs off. Stacking retries multiplies delay and hides the real error behind a timeout. |

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
is also why `sessionReadingSchema` is built per call: a static schema could check the _shape_ of a
citation but not whether it points at anything real.

## No prompt caching

Changing `output_format` invalidates the cache, so six schemas mean six mutually-exclusive prefixes
even with byte-identical system prompts. Four of the six boundaries run once per handoff, minutes
apart, against a 5-minute TTL — `cache_control` there is a pure 1.25× write tax that is never read.

Deliberately omitted rather than forgotten.

## Measured cost, and a correction to the earlier figure

[#3](https://github.com/smukhyala/propositum/issues/3) measured a toy call. The reference boundary
on a realistic five-event session is substantially heavier:

|         | Toy call (#3)    | Real session-reading     |
| ------- | ---------------- | ------------------------ |
| Latency | 7.8 s            | **15.1 s**               |
| Tokens  | 470 in / 266 out | **1,235 in / 1,053 out** |
| Cost    | $0.0090          | **$0.0325**              |

**A 30-minute budget buys roughly 120 sequential calls, not 231** — before any tool latency,
research fetches, or repair turns. Cost for a full handoff still lands around a dollar, so the
conclusion holds: **latency binds, cost does not, and Budget stays time-only.** But the margin is
narrower than the toy call implied, and boundaries with larger schemas will be heavier still.

Recorded because the earlier number is quoted in `MVP.md` and would otherwise quietly become wrong.

## Testing: four layers, and what each does NOT answer

Being explicit about the gaps, because the tempting mistake is a suite of green fake-backed tests
that would stay green through a breaking API change.

| Layer                                                    | Answers                                                                                                                              | Does not answer                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **1 Fakes** (`FakeModelClient`)                          | Is our control flow right?                                                                                                           | Anything about the API                         |
| **2 Cassettes**                                          | Does the wire format still match?                                                                                                    | Whether the model behaves the same             |
| **3 Schema snapshots** (`schema-transformation.test.ts`) | Has a Zod/SDK bump silently weakened the grammar?                                                                                    | Anything about a live call                     |
| **4 Live contract** (`npm run test:live`)                | Does the API still return what we expect? **And, added 2026-08-20: is the request shape we send one this SDK can actually execute?** | Nothing — but it costs money and takes seconds |

Layers 1 and 3 run in `npm test`. Layer 4 runs deliberately. **Layer 2 is not built yet** — noted
here rather than left as an implicit gap.

**Added 2026-08-20, after layer 4's second column turned out to be understating it.** Layer 1 does
not touch the SDK and layer 3 inspects a transformed schema, so neither can see whether the request
we build is one the installed SDK can execute at all. The streaming boundary was unexercised by all
1,709 tests in `npm test` and threw on every call in production — see the amendment under
**Decision**. The rule that follows: **every call SHAPE needs a layer 4 test, not every boundary.**
There are two shapes now, and there are two live tests.

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
person authorized, and the ledger they _read_ must not list them.

## Consequences

- One boundary is implemented — `session-reading` — as the reference the other five copy. Its file
  layout (schema, prompt, version, budget colocated) is the pattern: a prompt change and its schema
  change land in the same diff and the same review.
- Streaming is not a cost lever. It is required above `max_tokens ≈ 21,333`, where the SDK throws
  locally before any HTTP call, and it is a genuine liveness signal for an unattended run. Encoded
  as `NON_STREAMING_MAX_TOKENS` so a boundary raising its budget cannot silently become unrunnable.
  *(Incomplete since noticed 2026-09-03: the same throw also fires under a per-model cap,
  `MODEL_NONSTREAMING_TOKENS` in `@anthropic-ai/sdk/src/internal/constants.ts`, which the constant
  does not encode and the default model is not subject to.)*
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
