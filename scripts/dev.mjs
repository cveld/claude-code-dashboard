// Dev launcher behind `npm run dev`.
// Runs `next dev` and, when a local Caddy admin API answers, registers
// http://claude-code-dashboard.localhost -> 127.0.0.1:3000 for the life of the process.
// Caddy is never a requirement: if it is not running the route is skipped with a one-line
// notice and the dev server starts as usual. Opt out with `npm run dev -- --no-caddy` or
// CLAUDE_DASHBOARD_CADDY=0.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { launch } = require("../bin/launch.js");

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

launch({
  nextBin: require.resolve("next/dist/bin/next", { paths: [appDir] }),
  cwd: appDir,
  argv: process.argv.slice(2),
  command: "dev",
  defaultHost: process.env.CLAUDE_DASHBOARD_CADDY_HOST || "claude-code-dashboard.localhost",
  // Unlike the published CLI, the dev server registers without being asked - the route is the
  // whole point of running it behind Caddy locally.
  caddyByDefault: true,
  // `next dev` defaults to 3000; keep that instead of picking a random free port, so
  // http://localhost:3000 keeps working next to the Caddy hostname.
  defaultPort: Number(process.env.PORT) || 3000,
});
