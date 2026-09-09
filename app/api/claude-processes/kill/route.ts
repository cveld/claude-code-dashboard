import { NextResponse } from "next/server";
import { listClaudeProcesses } from "@/app/lib/claudeProcesses";
import { stopProcess } from "@/app/lib/processControl";

export interface KillClaudeProcessResult {
  killed: boolean;
  error?: string;
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

  // Re-verify against a fresh process list — never trust a pid the client
  // saw a poll cycle ago, and never kill a pid just because a caller sent it.
  const { ok, processes } = await listClaudeProcesses();
  if (!ok) {
    return NextResponse.json({ killed: false, error: "could not verify running claude.exe processes" } satisfies KillClaudeProcessResult);
  }
  if (!processes.some((p) => p.pid === pid)) {
    return NextResponse.json({ killed: false, error: "no longer a claude.exe process" } satisfies KillClaudeProcessResult);
  }

  const gone = await stopProcess(pid);
  console.log(`[claude-processes] kill pid ${pid}: ${gone ? "killed" : "failed"}`);
  return NextResponse.json({
    killed: gone,
    error: gone ? undefined : "still running after Stop-Process",
  } satisfies KillClaudeProcessResult);
}
