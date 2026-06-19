import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export interface ActiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  version: string;
  entrypoint: string;
}

export function GET() {
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

  active.sort((a, b) => b.startedAt - a.startedAt);
  return NextResponse.json(active);
}
