import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Propositum is local-first and single-user. Nothing here should reach for
  // a CDN, an image proxy, or telemetry — see docs/SECURITY_AND_PRIVACY.md.
  reactStrictMode: true,
}

export default nextConfig
