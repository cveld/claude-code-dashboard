import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { resolveCwd } from "@/app/lib/resolveCwd";

export interface ProjectInfo {
  slug: string;
  displayPath: string;
  sessionCount: number;
  lastActivity: string | null;
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
