// Trim the build output down to what `next start` needs before packing/publishing.
// Runs as the `prepack` lifecycle script, so it executes on both `npm pack` and
// `npm publish`. The `files` field whitelists `.next`, and a `files` whitelist
// cannot be narrowed by .npmignore — so we delete the cruft on disk instead.

import { rm, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const nextDir = path.join(root, ".next");

// Directories that only matter for `next dev` / local builds.
const dropDirs = ["dev", "cache", "trace"];
for (const d of dropDirs) {
  await rm(path.join(nextDir, d), { recursive: true, force: true });
}

// Source maps are not needed to serve the production build.
async function dropMaps(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await dropMaps(full);
    else if (entry.name.endsWith(".map")) await rm(full, { force: true });
  }
}
await dropMaps(nextDir);

console.log("clean-package: trimmed .next/{dev,cache,trace} and source maps");
