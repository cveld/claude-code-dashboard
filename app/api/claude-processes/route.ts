import { NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { SESSIONS_DIR, pathToSlug } from "@/app/lib/activeSessions";
import { listClaudeProcesses } from "@/app/lib/claudeProcesses";

export interface UnregisteredClaudeProcess {
  pid: number;
  path: string;
  ageMs: number;
  memoryBytes: number;
  pagedBytes: number;
  cwd: string | null;
  /** ISO timestamp of the newest transcript file in this cwd's project folder — a best-effort
   * "last interaction" proxy. Unlike the registered table, there's no sessionId to pin this to
   * the exact process, so it's the most recent activity anywhere in that project, not this pid. */
  lastActivityAt: string | null;
}

// Best-effort "last interaction" for a process with no session registry file: newest .jsonl
// mtime in the project folder for its cwd. Not exact (multiple sessions can share a cwd), but
// close enough to tell a genuinely stale/crashed process apart from one still in active use.
function findLastActivity(cwd: string | null): string | null {
  if (!cwd) return null;
  const slug = pathToSlug(cwd);
  if (!slug) return null;
  const projectDir = path.join(os.homedir(), ".claude", "projects", slug);
  try {
    let newest = 0;
    for (const f of fs.readdirSync(projectDir)) {
      if (!f.endsWith(".jsonl")) continue;
      const mtime = fs.statSync(path.join(projectDir, f)).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
    return newest > 0 ? new Date(newest).toISOString() : null;
  } catch {
    return null;
  }
}

export interface ClaudeProcessesResponse {
  supported: boolean;
  unregistered: UnregisteredClaudeProcess[];
}

// Every real `claude.exe` process, minus the ones already covered by
// /api/active-sessions (i.e. that still have a `~/.claude/sessions/<pid>.json`
// registry file). Exists so a process whose registry file is missing —
// crashed before writing it, or lost to the pruning bug this app once had —
// doesn't become permanently invisible and unkillable from the dashboard.
export async function GET() {
  const { ok, processes } = await listClaudeProcesses();
  if (!ok) {
    return NextResponse.json({ supported: process.platform === "win32", unregistered: [] } satisfies ClaudeProcessesResponse);
  }

  let registeredPids = new Set<number>();
  try {
    registeredPids = new Set(
      fs.readdirSync(SESSIONS_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => Number(f.slice(0, -".json".length)))
        .filter((n) => Number.isFinite(n))
    );
  } catch {
    // sessions dir missing entirely — every claude.exe process is unregistered
  }

  const now = Date.now();
  const unregistered = processes
    .filter((p) => !registeredPids.has(p.pid))
    .map((p) => ({
      pid: p.pid,
      path: p.path,
      ageMs: Math.max(0, now - p.createdAt),
      memoryBytes: p.memoryBytes,
      pagedBytes: p.pagedBytes,
      cwd: p.cwd,
      lastActivityAt: findLastActivity(p.cwd),
    }))
    .sort((a, b) => b.ageMs - a.ageMs);

  return NextResponse.json({ supported: true, unregistered } satisfies ClaudeProcessesResponse);
}
