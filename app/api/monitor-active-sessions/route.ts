import { NextResponse } from "next/server";
import { readdir, stat, unlink } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

// Monitor liveness is checked by mtime: the bash monitor touches the ready
// file every 20s via a heartbeat subshell. Files older than 60s are stale.
const STALE_MS = 60_000;

export async function GET() {
  const dir = join(homedir(), ".claude", "sessions");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return NextResponse.json([]);
  }

  const readyFiles = files.filter((f) => f.endsWith("-monitor.ready"));
  const activeIds: string[] = [];
  const now = Date.now();

  await Promise.all(
    readyFiles.map(async (f) => {
      const sessionId = f.replace("-monitor.ready", "");
      const readyPath = join(dir, f);
      try {
        const { mtimeMs } = await stat(readyPath);
        if (now - mtimeMs < STALE_MS) {
          activeIds.push(sessionId);
        } else {
          await unlink(readyPath).catch(() => {});
        }
      } catch {
        // File disappeared between readdir and stat — ignore.
      }
    })
  );

  return NextResponse.json(activeIds);
}
