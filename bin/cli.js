#!/usr/bin/env node
// Launcher for `npx claude-code-dashboard`.
// Starts the prebuilt Next.js production server from the package root.
// Extra args are forwarded to `next start` (e.g. `-p 4000`, `-H 0.0.0.0`).

const { spawn } = require("node:child_process");
const path = require("node:path");

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

const userArgs = process.argv.slice(2);
const nextArgs = userArgs[0] === "start" ? userArgs : ["start", ...userArgs];

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: appDir,
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
