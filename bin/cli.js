#!/usr/bin/env node
// Launcher for `npx claude-code-dashboard`.
// Starts the prebuilt Next.js production server from the package root.
// Extra args are forwarded to `next start` (e.g. `-p 4000`, `-H 0.0.0.0`).
//
// Optional Caddy integration (opt-in, off by default - never required to run the app):
// pass `--caddy` (or set CLAUDE_DASHBOARD_CADDY=1) to auto-pick a free port and register a
// route with a locally running Caddy server via its admin API for the life of this process.
// See bin/caddy.js for the flags and env vars; the upstream host is auto-detected, so a
// containerised Caddy is re-pointed at host.docker.internal without any configuration.

const path = require("node:path");
const { launch } = require("./launch.js");

const appDir = path.join(__dirname, "..");

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [appDir] });
} catch {
  console.error(
    "Could not locate the `next` runtime. Reinstall the package (npm i -g claude-code-dashboard) and try again."
  );
  process.exit(1);
}

launch({
  nextBin,
  cwd: appDir,
  argv: process.argv.slice(2),
  command: "start",
  defaultHost: "claude-code-dashboard.localhost",
  // Registering a route mutates a Caddy config this package does not own, so the published
  // CLI stays opt-in. `npm run dev` in this repo opts in on the developer's behalf.
  caddyByDefault: false,
});
