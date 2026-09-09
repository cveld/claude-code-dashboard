// Server-only: shared helpers for reading and enriching `~/.claude/sessions/*.json`
// (the live Claude Code process registry). Used by both the list endpoint
// (`/api/active-sessions`) and the single-pid endpoint
// (`/api/active-sessions/[pid]`, the SSE fast-path for one added/updated session).
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";
import { loadCache, saveCache, peekJsonlCached } from "@/app/lib/peekJsonl";

export const SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");

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
  /** ISO timestamp of the last user/assistant turn in the transcript — an idle proxy. */
  lastMessageAt?: string;
  memoryBytes?: number;
  pagedMemoryBytes?: number;
}

export function pathToSlug(folderPath: string): string {
  return folderPath.replace(/[:\\/\s]/g, "-");
}

export function readSessionFile(pid: number): ActiveSession | null {
  try {
    const raw = fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), "utf-8");
    return JSON.parse(raw) as ActiveSession;
  } catch {
    return null;
  }
}

export function deleteSessionFile(pid: number): void {
  fs.unlink(path.join(SESSIONS_DIR, `${pid}.json`), () => {});
}

interface MemoryUsage {
  memoryBytes: number;
  pagedMemoryBytes: number;
}

export interface MemoryUsageResult {
  /**
   * False when the `Get-Process` call itself failed (spawn error, timeout,
   * unparsable output) — a pid missing from `usage` in that case means
   * "unknown", NOT "confirmed dead". Only treat an absence as a genuine kill
   * signal (safe to delete the session file for) when `ok` is true — a
   * failed probe must never be read as proof every pid died, or a transient
   * PowerShell hiccup wipes out every still-running session's registry file.
   */
  ok: boolean;
  usage: Map<number, MemoryUsage>;
}

// Single batched `Get-Process` call for every pid, so polling this route
// never spawns more than one PowerShell process regardless of session count.
export function getMemoryUsage(pids: number[]): Promise<MemoryUsageResult> {
  const usage = new Map<number, MemoryUsage>();
  if (pids.length === 0) {
    return Promise.resolve({ ok: true, usage });
  }
  if (process.platform !== "win32") {
    return Promise.resolve({ ok: false, usage });
  }

  return new Promise((resolve) => {
    // Wrap in an object so valid JSON comes out even when zero pids match —
    // otherwise empty stdout is ambiguous between "found nothing" (ok) and
    // "PowerShell crashed before printing anything" (not ok), and treating
    // the latter as the former is exactly what wiped every session's
    // registry file the last time this went wrong.
    const ps =
      `$procs = @(Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | ` +
      `Select-Object Id,WorkingSet64,PagedMemorySize64); ` +
      `[pscustomobject]@{ procs = $procs } | ConvertTo-Json -Compress -Depth 3`;
    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps], { windowsHide: true });

    const timeout = setTimeout(() => {
      child.kill();
      resolve({ ok: false, usage });
    }, 5000);

    let out = "";
    child.stdout.on("data", (d) => { out += d.toString(); });
    child.on("close", () => {
      clearTimeout(timeout);
      if (!out.trim()) {
        resolve({ ok: false, usage });
        return;
      }
      try {
        const parsed = JSON.parse(out) as { procs?: unknown };
        const arr = Array.isArray(parsed.procs) ? parsed.procs : parsed.procs ? [parsed.procs] : [];
        for (const p of arr as Array<{ Id?: unknown; WorkingSet64?: unknown; PagedMemorySize64?: unknown }>) {
          if (p && typeof p.Id === "number" && typeof p.WorkingSet64 === "number" && typeof p.PagedMemorySize64 === "number") {
            usage.set(p.Id, { memoryBytes: p.WorkingSet64, pagedMemoryBytes: p.PagedMemorySize64 });
          }
        }
        resolve({ ok: true, usage });
      } catch {
        resolve({ ok: false, usage });
      }
    });
    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ ok: false, usage });
    });
  });
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

export interface TranscriptInfo {
  title: string | null;
  lastMessageAt: string | null;
}

// Look up a session's title and last-activity timestamp from its transcript
// .jsonl file. Uses peekJsonlCached (streams the whole file, not just a
// leading chunk, and re-parses only when the file's mtime changed) so a large
// early tool-result line can't push the title event out of range, and repeat
// calls while nothing changed are a cache hit.
export async function findTranscriptInfo(sessionId: string, cwd: string): Promise<TranscriptInfo> {
  const empty: TranscriptInfo = { title: null, lastMessageAt: null };
  const slug = pathToSlug(cwd);
  if (!slug) return empty;

  const projectDir = path.join(os.homedir(), ".claude", "projects", slug);
  if (!fs.existsSync(projectDir)) return empty;

  const candidates = [`${sessionId}.jsonl`];

  // Also check for any .jsonl that contains this sessionId in the first line.
  try {
    const dirFiles = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    for (const df of dirFiles) {
      if (df === `${sessionId}.jsonl`) continue;
      try {
        const firstLine = readFirstLine(path.join(projectDir, df));
        if (firstLine && firstLine.includes(sessionId)) {
          candidates.push(df);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // skip
  }

  const cache = loadCache(projectDir);
  try {
    for (const filename of candidates) {
      const filePath = path.join(projectDir, filename);
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      const { title, lastMessageAt } = await peekJsonlCached(filePath, filename, stat.mtime, cache);
      if (title || lastMessageAt) return { title, lastMessageAt };
    }
  } finally {
    saveCache(projectDir, cache);
  }

  return empty;
}

/** Mutates `session` in place with projectSlug, title and lastMessageAt. */
export async function attachTranscriptInfo(session: ActiveSession): Promise<void> {
  session.projectSlug = pathToSlug(session.cwd);
  const { title, lastMessageAt } = await findTranscriptInfo(session.sessionId, session.cwd);
  if (title) session.title = title;
  if (lastMessageAt) session.lastMessageAt = lastMessageAt;
}
