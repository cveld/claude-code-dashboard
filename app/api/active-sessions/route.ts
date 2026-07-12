import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

// Inline slug function — same logic as app/lib/dashboard.ts pathToSlug,
// avoids cross-module import issues with Turbopack in API routes.
function pathToSlug(folderPath: string): string {
  return folderPath.replace(/[:\\/\s]/g, "-");
}

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  projectSlug: string;
  startedAt: number;
  version: string;
  entrypoint: string;
  name?: string;
  nameSource?: string;
  title?: string;
  titleSource?: string;
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

// Look up a session's title from its transcript .jsonl file, reading only the
// first 50 lines (the title is set early in the conversation).
function findTranscriptTitle(sessionId: string, cwd: string): { title: string; source: string } | null {
  const slug = pathToSlug(cwd);
  if (!slug) return null;

  const projectDir = path.join(os.homedir(), ".claude", "projects", slug);
  if (!fs.existsSync(projectDir)) return null;

  // Session .jsonl files are named <sessionId>.jsonl — some may have a different
  // naming convention, so we check a few patterns.
  const candidates = [
    path.join(projectDir, `${sessionId}.jsonl`),
  ];

  // Also check for any .jsonl that contains this sessionId in the first line
  try {
    const dirFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    for (const df of dirFiles) {
      if (df === `${sessionId}.jsonl`) continue; // already checked
      try {
        const firstLine = readFirstLine(path.join(projectDir, df));
        if (firstLine && firstLine.includes(sessionId)) {
          candidates.push(path.join(projectDir, df));
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = readFirstLines(filePath, 256 * 1024);
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === "ai-title" && obj.aiTitle) {
            return { title: obj.aiTitle, source: "ai-title" };
          }
          if (obj.type === "custom-title" && obj.customTitle) {
            return { title: obj.customTitle, source: "custom-title" };
          }
        } catch {
          continue;
        }
      }
    } catch (e) {
      console.log(`[active-sessions]   error reading ${filePath}:`, e);
      continue;
    }
  }

  return null;
}

function readFirstLine(filePath: string): string | null {
  try {
    const buf = Buffer.alloc(4096);
    const fd = fs.openSync(filePath, "r");
    try {
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
      const content = buf.toString("utf-8", 0, bytesRead);
      const newline = content.indexOf("\n");
      return newline >= 0 ? content.slice(0, newline) : content;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

// Read the first `maxBytes` of a file, returning full lines.
// Useful for scanning transcript headers without loading the entire file.
function readFirstLines(filePath: string, maxBytes: number): string {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
      return buf.toString("utf-8", 0, bytesRead);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
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

  // Attach project slug and transcript titles.
  for (const s of active) {
    s.projectSlug = pathToSlug(s.cwd);
    const titleInfo = findTranscriptTitle(s.sessionId, s.cwd);
    if (titleInfo) {
      s.title = titleInfo.title;
      s.titleSource = titleInfo.source;
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
