/**
 * Does a granted Chrome match pattern actually cover this origin?
 *
 * ── Why a string comparison was never going to work ──────────────────────
 *
 * The panel compared the granted pattern to the source origin with `===`, after
 * stripping a trailing `/*`. That held only while every grant was a specific
 * host. It stopped holding the moment the manifest went BROAD — `https://*​/*`
 * is what ambient detection needs, because detection cannot work on sources the
 * person has not set up yet — and from then on the comparison was
 * `'https://*' === 'https://northwind.com'`, which is false for every source
 * that has ever existed.
 *
 * So the panel showed an Allow button beside every approved source, on a
 * machine where Chrome had already granted all of them. And the button did
 * nothing: `permissions.request()` only works for something listed under
 * `optional_host_permissions`, which the manifest no longer has, so it resolved
 * false and the row re-rendered unchanged. A control that is both unnecessary
 * and inert is the worst of the three available states, because a person who
 * presses it and sees nothing happen concludes the product is broken — and on
 * this screen, of all screens, what they are being told is what Propositum may
 * see.
 *
 * ── What it implements, and what it deliberately does not ────────────────
 *
 * Match-pattern semantics, narrowly: the scheme must agree, with `*://`
 * matching http and https; the host either matches exactly, or the pattern is
 * a `*.` wildcard the host falls under, or the pattern's host is `*`.
 *
 * Paths are not compared. Every pattern this extension registers ends in `/*`,
 * and every source it asks about is a bare origin, so a path comparison could
 * only ever add a way to be wrong. If that stops being true, this needs to
 * grow rather than be worked around at the call site.
 *
 * Its own file, and plain JS, for the same reason `search-url.js` is: the
 * extension has no build step on purpose, and a predicate that decides what a
 * person is told about their own privacy is worth being able to test.
 */

/**
 * True when `pattern` — a Chrome host match pattern — covers `origin`.
 *
 * `origin` is a bare origin like `https://northwind.com`. Anything unparseable
 * on either side is `false`: this answers "may Propositum see it", and the
 * conservative answer to a question it cannot parse is no.
 */
export function patternCovers(pattern, origin) {
  const match = /^(\*|https?):\/\/([^/]+)/.exec(pattern)
  if (!match) return false

  const [, scheme, hostPattern] = match

  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }

  const originScheme = originUrl.protocol.replace(':', '')
  if (scheme === '*') {
    if (originScheme !== 'http' && originScheme !== 'https') return false
  } else if (scheme !== originScheme) {
    return false
  }

  const host = originUrl.hostname.toLowerCase()
  const wanted = hostPattern.toLowerCase()

  if (wanted === '*') return true
  if (wanted.startsWith('*.')) {
    const suffix = wanted.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === wanted
}
