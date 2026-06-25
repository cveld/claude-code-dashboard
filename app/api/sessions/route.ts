import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { loadCache, saveCache, peekJsonlCached } from "@/app/lib/peekJsonl";
import { resolveCwd } from "@/app/lib/resolveCwd";

export interface SessionWithProject {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  lastActivity: string;
  startedAt: string | null;
  messageCount: number;
  projectSlug: string;
  projectDisplayPath: string;
  lastInputTokens: number | null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);
  const projectSlugFilter = searchParams.get("project") ?? null;

  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) return NextResponse.json([]);

  const slugs = fs.readdirSync(claudeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((s) => !projectSlugFilter || s === projectSlugFilter);

  // Collect all (slug, file, mtime) pairs first so we can sort cheaply before peeking
  const candidates: { slug: string; file: string; mtime: Date }[] = [];
  for (const slug of slugs) {
    const projectDir = path.join(claudeDir, slug);
    const files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      const stat = fs.statSync(path.join(projectDir, file));
      candidates.push({ slug, file, mtime: stat.mtime });
    }
  }

  candidates.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  const top = candidates.slice(0, limit);

  // Group by slug so we load one cache file per project
  const bySlug = new Map<string, typeof top>();
  for (const c of top) {
    if (!bySlug.has(c.slug)) bySlug.set(c.slug, []);
    bySlug.get(c.slug)!.push(c);
  }

  const resultGroups = await Promise.all(
    [...bySlug.entries()].map(async ([slug, candidates]) => {
      const projectDir = path.join(claudeDir, slug);
      const cache = loadCache(projectDir);

      const jsonlFiles = candidates.map((c) => c.file);
      const displayPath = resolveCwd(slug, projectDir, jsonlFiles);

      const sessions = await Promise.all(
        candidates.map(async ({ file, mtime }) => {
          const filePath = path.join(projectDir, file);
          const { startedAt, messageCount, firstUserMessage, title, lastInputTokens, lastMessageAt } = await peekJsonlCached(filePath, file, mtime, cache);
          return {
            id: file.replace(".jsonl", ""),
            title,
            firstUserMessage,
            lastActivity: lastMessageAt ?? mtime.toISOString(),
            startedAt,
            messageCount,
            projectSlug: slug,
            projectDisplayPath: displayPath,
            lastInputTokens: lastInputTokens ?? null,
          } as SessionWithProject;
        })
      );

      saveCache(projectDir, cache);
      return sessions;
    })
  );

  return NextResponse.json(resultGroups.flat());
}
