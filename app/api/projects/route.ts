import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

export interface ProjectInfo {
  slug: string;
  displayPath: string;
  sessionCount: number;
  lastActivity: string | null;
}

function slugToPath(slug: string): string {
  return slug.replace(/^([a-zA-Z])--/, "$1:\\").replace(/-/g, "\\");
}

// Slug → cwd cache: never invalidated (slug is deterministically derived from cwd)
const cwdCache = new Map<string, string>();

function resolveCwd(slug: string, projectDir: string, jsonlFiles: string[]): string {
  if (cwdCache.has(slug)) return cwdCache.get(slug)!;

  let cwd: string | null = null;
  const firstFile = jsonlFiles[0];
  if (firstFile) {
    try {
      const fd = fs.openSync(path.join(projectDir, firstFile), "r");
      const buf = Buffer.alloc(8192);
      const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
      fs.closeSync(fd);
      for (const line of buf.subarray(0, bytesRead).toString("utf-8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (typeof obj.cwd === "string") { cwd = obj.cwd; break; }
        } catch { /* skip malformed */ }
      }
    } catch { /* skip unreadable */ }
  }

  const result = cwd ?? slugToPath(slug);
  cwdCache.set(slug, result);
  return result;
}

export function GET() {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");

  if (!fs.existsSync(claudeDir)) {
    return NextResponse.json([]);
  }

  const slugs = fs.readdirSync(claudeDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  const projects: ProjectInfo[] = slugs.map((slug) => {
    const projectDir = path.join(claudeDir, slug);
    const files = fs.readdirSync(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    let lastActivity: string | null = null;
    let latestMs = 0;
    for (const f of jsonlFiles) {
      const stat = fs.statSync(path.join(projectDir, f));
      if (stat.mtimeMs > latestMs) {
        latestMs = stat.mtimeMs;
        lastActivity = stat.mtime.toISOString();
      }
    }

    return {
      slug,
      displayPath: resolveCwd(slug, projectDir, jsonlFiles),
      sessionCount: jsonlFiles.length,
      lastActivity,
    };
  });

  projects.sort((a, b) => {
    if (!a.lastActivity) return 1;
    if (!b.lastActivity) return -1;
    return b.lastActivity.localeCompare(a.lastActivity);
  });

  return NextResponse.json(projects);
}
