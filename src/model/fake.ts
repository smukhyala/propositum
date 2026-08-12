/**
 * The fake ModelClient — layer 1 of the testing strategy.
 *
 * Tests our CONTROL FLOW: does the worker record a refusal, stop on budget,
 * write the ledger row, hand the right thing to the gate. It says nothing about
 * whether the API still returns what we expect — that is layers 3 and 4
 * (schema snapshots and the tagged live contract test).
 *
 * Being explicit about which layer answers which question matters, because the
 * tempting mistake is a suite of green fake-backed tests that would stay green
 * through a breaking API change.
 *
 * Scripted responses are validated against the boundary's own schema before
 * being returned, so a fixture cannot drift into a shape the real client could
 * never produce. A fake that can return impossible values tests nothing.
 */

import type {
  BoundaryResult,
  CallTelemetry,
  FailureKind,
  ModelBoundary,
  ModelClient,
} from './client'

export type ScriptedReply<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'fail'; readonly failure: FailureKind; readonly detail?: string }

export interface RecordedCall {
  readonly boundary: string
  readonly promptVersion: string
  readonly system: string | undefined
  readonly user: string
  /**
   * Pictures the boundary attached, if any.
   *
   * Recorded because a prompt that CLAIMS an attachment and sends none is a
   * real defect this suite has already caught once — the boundary said "a
   * screenshot is attached" while `PromptParts` had no image field at all. A
   * fake that captured only the prose could not tell the two apart, so the
   * assertion that fixes it would have had nothing to assert against.
   */
  readonly images: ReadonlyArray<{ mediaType: 'image/png'; base64: string }> | undefined
}

/**
 * Replies are consumed in order. Running out is an error rather than a default,
 * because a test that makes an unexpected extra call has found something and
 * should say so.
 */
export class FakeModelClient implements ModelClient {
  private readonly replies: ScriptedReply<unknown>[]
  readonly calls: RecordedCall[] = []

  constructor(replies: ReadonlyArray<ScriptedReply<never>> | ReadonlyArray<ScriptedReply<unknown>>) {
    this.replies = [...(replies as ReadonlyArray<ScriptedReply<unknown>>)]
  }

  async run<TInput, TOutput>(
    boundary: ModelBoundary<TInput, TOutput>,
    input: TInput,
  ): Promise<BoundaryResult<TOutput>> {
    const prompt = boundary.buildPrompt(input)
    this.calls.push({
      boundary: boundary.name,
      promptVersion: boundary.promptVersion,
      system: prompt.system,
      user: prompt.user,
      images: prompt.images,
    })

    const reply = this.replies.shift()
    if (!reply) {
      throw new Error(
        `FakeModelClient: unscripted call to boundary "${boundary.name}" (call #${this.calls.length}).`,
      )
    }

    const telemetry: CallTelemetry = {
      boundary: boundary.name,
      model: 'fake',
      promptVersion: boundary.promptVersion,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: 0,
      stopReason: reply.kind === 'ok' ? 'end_turn' : null,
      repairTurns: 0,
    }

    if (reply.kind === 'fail') {
      return { ok: false, failure: reply.failure, detail: reply.detail ?? '', telemetry }
    }

    // The fake is held to the real contract.
    const validated = boundary.schema.safeParse(reply.value)
    if (!validated.success) {
      throw new Error(
        `FakeModelClient: scripted reply for "${boundary.name}" does not satisfy the boundary schema. ` +
          `A fixture that could never come from the real API tests nothing.\n` +
          validated.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
      )
    }

    return { ok: true, value: validated.data, telemetry }
  }

  /** Assert the script was fully consumed — an unused reply usually means a
   *  call that was expected and never happened. */
  get pendingReplies(): number {
    return this.replies.length
  }
}
