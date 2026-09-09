import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { stopProcess } from "@/app/lib/processControl";

export interface KillSessionResult {
  killed: boolean;
  error?: string;
}

// Fresh read of ~/.claude/sessions/*.json — a stale page can only ever ask to
// kill a pid that is still backing an active session right now.
function readActivePids(): Set<number> {
  const sessionsDir = path.join(os.homedir(), ".claude", "sessions");
  const pids = new Set<number>();
  if (!fs.existsSync(sessionsDir)) return pids;

  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), "utf-8"));
      if (typeof obj.pid === "number") pids.add(obj.pid);
    } catch {
      // skip
    }
  }
  return pids;
}

export async function POST(request: Request) {
  if (process.platform !== "win32") {
    return NextResponse.json({ error: "Windows only" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const pid = (body as { pid?: unknown }).pid;
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return NextResponse.json({ error: "Expected { pid: number }" }, { status: 400 });
  }

  const activePids = readActivePids();
  if (!activePids.has(pid)) {
    return NextResponse.json({ killed: false, error: "no longer an active Claude Code session" } satisfies KillSessionResult);
  }

  const gone = await stopProcess(pid);
  console.log(`[active-sessions] kill pid ${pid}: ${gone ? "killed" : "failed"}`);
  return NextResponse.json({
    killed: gone,
    error: gone ? undefined : "still running after Stop-Process",
  } satisfies KillSessionResult);
}
