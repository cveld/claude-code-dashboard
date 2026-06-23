import fs from "fs";
import path from "path";

function slugToPath(slug: string): string {
  return slug.replace(/^([a-zA-Z])--/, "$1:\\").replace(/-/g, "\\");
}

// Never invalidated — slug is deterministically derived from cwd
const cwdCache = new Map<string, string>();

export function resolveCwd(slug: string, projectDir: string, jsonlFiles: string[]): string {
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
