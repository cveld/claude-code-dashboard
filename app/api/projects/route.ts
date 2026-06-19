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
  // e.g. c--work-git-igh → c:\work\git\igh
  // Drive letter: first char + "-" → first char + ":"
  // Then remaining "-" → "\"
  // But "-" inside folder names (like "2026-06") must be preserved.
  // Claude's actual encoding: colon → nothing, each path separator → "-"
  // We just display it as-is for now (decoded best-effort)
  return slug.replace(/^([a-zA-Z])--/, "$1:\\").replace(/-/g, "\\");
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
      displayPath: slugToPath(slug),
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
