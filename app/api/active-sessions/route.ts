import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version: string;
  entrypoint: string;
  memoryBytes?: number;
  pagedMemoryBytes?: number;
}

interface MemoryUsage {
  memoryBytes: number;
  pagedMemoryBytes: number;
}

// Single batched `Get-Process` call for every pid, so polling this route
// never spawns more than one PowerShell process regardless of session count.
function getMemoryUsage(pids: number[]): Promise<Map<number, MemoryUsage>> {
  const result = new Map<number, MemoryUsage>();
  if (pids.length === 0 || process.platform !== "win32") {
    return Promise.resolve(result);
  }

  return new Promise((resolve) => {
    const ps = `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PagedMemorySize64 | ConvertTo-Json -Compress`;
    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps]);

    const timeout = setTimeout(() => {
      child.kill();
      resolve(result);
    }, 5000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const parsed = out.trim() ? JSON.parse(out) : [];
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        for (const p of arr) {
          if (p && typeof p.Id === "number" && typeof p.WorkingSet64 === "number" && typeof p.PagedMemorySize64 === "number") {
            result.set(p.Id, { memoryBytes: p.WorkingSet64, pagedMemoryBytes: p.PagedMemorySize64 });
          }
        }
      } catch {
        // skip — leave result empty
      }
      resolve(result);
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(result);
    });
  });
}

export async function GET() {
  const sessionsDir = path.join(os.homedir(), ".claude", "sessions");

  if (!fs.existsSync(sessionsDir)) {
    return NextResponse.json([]);
  }

  const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));
  const active: ActiveSession[] = [];

  for (const f of files) {
    try {
      const raw = fs.readFileSync(path.join(sessionsDir, f), "utf-8");
      const obj = JSON.parse(raw);
      active.push(obj);
    } catch {
      // skip
    }
  }

  const memory = await getMemoryUsage(active.map((s) => s.pid));
  for (const s of active) {
    const usage = memory.get(s.pid);
    if (usage !== undefined) {
      s.memoryBytes = usage.memoryBytes;
      s.pagedMemoryBytes = usage.pagedMemoryBytes;
    }
  }

  active.sort((a, b) => b.startedAt - a.startedAt);
  return NextResponse.json(active);
}
