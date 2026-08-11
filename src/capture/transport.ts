/**
 * The loopback transport, and why CORS is not part of its defence.
 *
 * ── CORS protects nothing here ───────────────────────────────────────────
 *
 * The instinct is that a hostile page cannot POST to `127.0.0.1` because CORS
 * will stop it. It will not.
 *
 * Per the Fetch spec, `POST` with `Content-Type: text/plain` is fully
 * CORS-safelisted: the browser sends it without a preflight, the server
 * executes it, and only the RESPONSE is withheld from the page. A
 * fire-and-forget forgery does not want the response — it wants the write.
 *
 * So a page could inject events into someone's session ledger. Four controls,
 * all required, none sufficient alone:
 *
 *   1. `application/json` — not CORS-safelisted, so it forces a preflight the
 *      page cannot satisfy.
 *   2. A custom header — same reason, and belt to the above's braces.
 *   3. Proof this was not page-initiated — the extension's `Origin` when Chrome
 *      sends one, and `Sec-Fetch-Site: none` when it does not. See
 *      `fromOurExtension`: granting the loopback host permission the extension
 *      cannot work without makes Chrome DROP the Origin header entirely.
 *   4. A per-session bearer token — the extension gets it at session start;
 *      a page never sees it.
 *
 * ── The LNA exemption is documented in a Google Doc that says "currently" ──
 *
 * Chrome extensions are currently exempt from Local Network Access
 * restrictions. That sentence lives in an unversioned document and hedges
 * itself, so the extension performs a startup self-check that FAILS LOUDLY
 * rather than assuming the exemption holds. Silent capture failure is the worst
 * outcome available: the person believes they are being watched and they are
 * not.
 */

import { z } from 'zod'

export const CUSTOM_HEADER = 'x-propositum-capture'
export const REQUIRED_CONTENT_TYPE = 'application/json'

export const envelopeSchema = z.object({
  token: z.string().min(1),
  sessionId: z.string().min(1),
  events: z.array(z.unknown()).max(200),
})

export type Envelope = z.infer<typeof envelopeSchema>

export interface TransportContext {
  /** `chrome-extension://<id>` — the only Origin we accept. */
  readonly expectedOrigin: string
  /** Issued at session start. Rotated per session, never persisted to a page. */
  readonly sessionToken: string
  readonly sessionId: string
}

export type RejectionReason =
  | 'bad-content-type'
  | 'missing-custom-header'
  | 'bad-origin'
  | 'bad-token'
  | 'wrong-session'
  | 'malformed-envelope'

export type Admission =
  | { readonly ok: true; readonly events: readonly unknown[] }
  | { readonly ok: false; readonly reason: RejectionReason }

export interface IncomingRequest {
  readonly headers: Readonly<Record<string, string | undefined>>
  readonly body: unknown
}

/**
 * Is this our extension, given that Chrome may not tell us its origin?
 *
 * ── The trap, found by shipping it ───────────────────────────────────────
 *
 * The manifest needs `host_permissions` for `http://127.0.0.1/*`, or the
 * service worker cannot reach the app at all. But granting it makes the fetch
 * PRIVILEGED rather than cross-origin — and Chrome then sends **no `Origin`
 * header at all**. Observed directly: the extension's request arrives with
 * `sec-fetch-site: none`, our custom header, and no origin.
 *
 * So requiring `Origin` meant the extension reached the app and was refused by
 * its own transport, every 30 seconds, silently. Removing `host_permissions`
 * does not fix it either: the fetch is then a real CORS request, the app sends
 * no `Access-Control-Allow-Origin` deliberately, and the browser withholds the
 * response. Both directions fail; only the failure mode changes.
 *
 * ── What replaces it, and why it is not weaker ───────────────────────────
 *
 * The threat this control exists for is a HOSTILE WEB PAGE reaching loopback.
 * It is not a local process — a local process can read the SQLite file directly
 * and has no need of this route.
 *
 * Against a page, two things already hold and neither involves `Origin`:
 *
 *   - `Sec-Fetch-Site` is a **forbidden header name**. No script can set or
 *     suppress it. A page-initiated request carries `cross-site`; only a
 *     browser-privileged caller with no initiating document sends `none`.
 *   - The custom header and `application/json` both force a CORS preflight
 *     that this app never satisfies, so a page's request is never delivered.
 *
 * So: accept the expected extension origin when it is present, and otherwise
 * accept only a request the browser itself attests was not page-initiated. A
 * forged `Origin` was always possible from a non-browser client; this is the
 * same guarantee, stated honestly.
 */
export function fromOurExtension(
  header: (name: string) => string | undefined,
  expectedOrigin: string,
): boolean {
  const origin = header('origin')

  // Present: it must be ours. A page that reaches this far is rejected here.
  if (origin !== undefined && origin !== '') return origin === expectedOrigin

  // Absent: only a caller the browser itself attests was not page-initiated.
  return header('sec-fetch-site') === 'none'
}

/**
 * All four checks, in the order that reveals the cheapest failure first.
 *
 * Deliberately does not distinguish a bad token from a wrong session in what it
 * returns to the caller — both are `false` at the boundary. The distinction is
 * useful in a log and useless to an attacker.
 */
export function admit(request: IncomingRequest, context: TransportContext): Admission {
  const header = (name: string) => request.headers[name] ?? request.headers[name.toLowerCase()]

  const contentType = header('content-type') ?? ''
  if (!contentType.startsWith(REQUIRED_CONTENT_TYPE)) {
    // The single most important line here. text/plain is CORS-safelisted and
    // would be delivered and executed.
    return { ok: false, reason: 'bad-content-type' }
  }

  if (header(CUSTOM_HEADER) !== '1') return { ok: false, reason: 'missing-custom-header' }

  if (!fromOurExtension(header, context.expectedOrigin)) return { ok: false, reason: 'bad-origin' }

  const parsed = envelopeSchema.safeParse(request.body)
  if (!parsed.success) return { ok: false, reason: 'malformed-envelope' }

  if (!timingSafeEqual(parsed.data.token, context.sessionToken)) {
    return { ok: false, reason: 'bad-token' }
  }
  if (parsed.data.sessionId !== context.sessionId) return { ok: false, reason: 'wrong-session' }

  return { ok: true, events: parsed.data.events }
}

/** Constant-time-ish comparison. The token is short-lived and local, so this is
 *  cheap insurance rather than a hard requirement. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/* ── the startup self-check ────────────────────────────────────────────── */

export class TransportUnreachableError extends Error {
  constructor(detail: string) {
    super(
      `Propositum cannot reach the local app: ${detail}\n\n` +
        'Capture is OFF. This fails loudly on purpose — the worst outcome is a ' +
        'person who believes their work is being watched when it is not.\n\n' +
        'Chrome extensions are currently exempt from Local Network Access ' +
        'restrictions, but that is documented only in an unversioned Google ' +
        'document that says "currently". If this started failing after a Chrome ' +
        'update, check whether the exemption still holds.',
    )
    this.name = 'TransportUnreachableError'
  }
}

export interface SelfCheckDeps {
  /** Injected so this is testable without a network. */
  probe(): Promise<{ ok: boolean; status?: number; error?: string }>
}

export async function verifyTransportReachable(deps: SelfCheckDeps): Promise<void> {
  let result: { ok: boolean; status?: number; error?: string }
  try {
    result = await deps.probe()
  } catch (error) {
    throw new TransportUnreachableError(error instanceof Error ? error.message : String(error))
  }

  if (!result.ok) {
    throw new TransportUnreachableError(result.error ?? `status ${result.status ?? 'unknown'}`)
  }
}
