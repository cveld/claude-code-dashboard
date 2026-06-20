import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export interface IdeWindowLock {
  port: number;
  workspaceFolders: string[];
  pid: number;
  ideName: string;
  authToken: string;
}

export interface IdeWindow {
  port: number;
  workspaceFolders: string[];
  pid: number;
  ideName: string;
}

export function readIdeWindowLocks(): IdeWindowLock[] {
  const ideDir = path.join(os.homedir(), ".claude", "ide");
  if (!fs.existsSync(ideDir)) return [];

  const windows: IdeWindowLock[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(ideDir).filter((f) => f.endsWith(".lock"));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const port = parseInt(file.replace(".lock", ""), 10);
      if (isNaN(port)) continue;
      const content = JSON.parse(
        fs.readFileSync(path.join(ideDir, file), "utf-8")
      );
      const pid: number = content.pid;
      if (!isAlive(pid)) continue;
      windows.push({
        port,
        workspaceFolders: content.workspaceFolders ?? [],
        pid,
        ideName: content.ideName ?? "VS Code",
        authToken: content.authToken ?? "",
      });
    } catch {
      // skip malformed lock files
    }
  }

  return windows;
}

export function readIdeWindows(): IdeWindow[] {
  return readIdeWindowLocks().map(({ port, workspaceFolders, pid, ideName }) => ({
    port,
    workspaceFolders,
    pid,
    ideName,
  }));
}
