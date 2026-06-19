import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { loadCache, saveCache, peekJsonlCached } from "@/app/lib/peekJsonl";

export interface SessionInfo {
  id: string;
  title: string | null;
  startedAt: string | null;
  messageCount: number;
  firstUserMessage: string | null;
  lastActivity: string;
  lastInputTokens: number | null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const projectDir = path.join(os.homedir(), ".claude", "projects", slug);

  if (!fs.existsSync(projectDir)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  const cache = loadCache(projectDir);

  const sessions = await Promise.all(
    files.map(async (f) => {
      const filePath = path.join(projectDir, f);
      const stat = fs.statSync(filePath);
      const { startedAt, messageCount, firstUserMessage, title, lastInputTokens } = await peekJsonlCached(filePath, f, stat.mtime, cache);
      return {
        id: f.replace(".jsonl", ""),
        title,
        startedAt,
        messageCount,
        firstUserMessage,
        lastActivity: stat.mtime.toISOString(),
        lastInputTokens: lastInputTokens ?? null,
      } as SessionInfo;
    })
  );

  saveCache(projectDir, cache);
  sessions.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  return NextResponse.json(sessions);
}
