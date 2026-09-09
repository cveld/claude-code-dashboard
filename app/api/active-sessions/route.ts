import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  SESSIONS_DIR,
  attachTranscriptInfo,
  getMemoryUsage,
  type ActiveSession,
} from "@/app/lib/activeSessions";

export type { ActiveSession };

export async function GET() {
  if (!fs.existsSync(SESSIONS_DIR)) {
    return NextResponse.json([]);
  }

  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
  const active: ActiveSession[] = [];

  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, f), "utf-8");
      const obj = JSON.parse(raw);
      active.push(obj);
    } catch {
      // skip
    }
  }

  // Attach project slug, transcript title and last-activity timestamp.
  for (const s of active) {
    await attachTranscriptInfo(s);
  }

  const { ok, usage: memory } = await getMemoryUsage(active.map((s) => s.pid));
  for (const s of active) {
    const usage = memory.get(s.pid);
    if (usage !== undefined) {
      s.memoryBytes = usage.memoryBytes;
      s.pagedMemoryBytes = usage.pagedMemoryBytes;
    }
  }

  // A pid absent from a *successful* Get-Process batch is no longer running.
  // That legitimately happens after a forced kill: Stop-Process -Force gives
  // the CLI no chance to delete its own session file on exit, so the stale
  // file would otherwise keep reappearing here forever — drop it and clean up.
  // Only prune when `ok`: a failed probe (timeout, spawn error) must never be
  // read as "every pid died", or one PowerShell hiccup deletes every
  // still-running session's registry file.
  const live = !ok
    ? active
    : active.filter((s) => {
        if (memory.has(s.pid)) return true;
        fs.unlink(path.join(SESSIONS_DIR, `${s.pid}.json`), () => {});
        return false;
      });

  live.sort((a, b) => b.startedAt - a.startedAt);
  return NextResponse.json(live);
}
