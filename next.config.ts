import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next blocks cross-origin requests to dev-only assets, so every hostname the dev server is
  // reached under has to be listed here - including the Caddy route scripts/dev.mjs registers.
  allowedDevOrigins: [
    "100.122.168.56",
    "claude-code-dashboard.localhost",
    "*.localhost",
  ],
};

export default nextConfig;
