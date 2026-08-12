import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Propositum is local-first and single-user. Nothing here should reach for
  // a CDN, an image proxy, or telemetry — see docs/SECURITY_AND_PRIVACY.md.
  reactStrictMode: true,

  /**
   * `127.0.0.1` and `localhost` are the same machine and different ORIGINS.
   *
   * The dev server announces itself as `localhost` and refuses dev-asset
   * requests from origins it was not told about — a static chunk requested with
   * `Origin: http://127.0.0.1:3117` comes back **403**. Verified directly:
   * the same URL is 200 with no Origin, 200 with `Origin: localhost`, and 403
   * with `Origin: 127.0.0.1`.
   *
   * The failure is invisible in the log and brutal on screen. The page returns
   * 200 with all its text, one client chunk is missing, hydration never
   * completes, and every `motion` section stays at the `opacity: 0` its own
   * server render emitted. The result is a blank page and no error anywhere.
   *
   * The extension pins `http://127.0.0.1:3117` and cannot be told to use
   * `localhost` — it is buildless, the constant is hardcoded, and a test asserts
   * it matches the dev script. So the app has to accept the origin the rest of
   * the product already uses.
   */
  allowedDevOrigins: ['127.0.0.1'],
}

export default nextConfig
