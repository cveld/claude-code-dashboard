import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import WebSocket from "ws";

export async function POST(req: NextRequest) {
  const { port, filePath } = await req.json();
  console.log(`[open-file] port=${port} filePath=${filePath}`);

  const lockFile = path.join(os.homedir(), ".claude", "ide", `${port}.lock`);
  if (!fs.existsSync(lockFile)) {
    console.warn(`[open-file] lock file not found: ${lockFile}`);
    return NextResponse.json({ error: "IDE window not found" }, { status: 404 });
  }

  let authToken: string;
  let pid: number | undefined;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    authToken = lock.authToken;
    pid = lock.pid;
  } catch {
    console.error(`[open-file] failed to read lock file: ${lockFile}`);
    return NextResponse.json({ error: "Failed to read lock file" }, { status: 500 });
  }

  // On Windows, use SetForegroundWindow via PowerShell — fire and forget
  if (process.platform === "win32" && pid) {
    console.log(`[open-file] focusing pid=${pid} via PowerShell`);
    const ps = `
$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
if ($p -and $p.MainWindowHandle -ne 0) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
}
"@
  [WinFocus]::ShowWindow($p.MainWindowHandle, 9)
  [WinFocus]::SetForegroundWindow($p.MainWindowHandle)
  Write-Host "focused"
} else { Write-Host "not found or no window" }`;
    const child = spawn("powershell", ["-NonInteractive", "-NoProfile", "-Command", ps]);
    child.stdout.on("data", (d) => console.log(`[open-file] ps: ${d.toString().trim()}`));
    child.stderr.on("data", (d) => console.error(`[open-file] ps err: ${d.toString().trim()}`));
  }

  try {
    await mcpOpenFile(port, authToken, filePath);
    console.log(`[open-file] ok port=${port}`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(`[open-file] error port=${port}:`, e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

function mcpOpenFile(port: number, authToken: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { "x-claude-code-ide-authorization": authToken },
    });

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("Timeout connecting to MCP server"));
    }, 5000);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "dashboard", version: "1.0" },
          },
        })
      );
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: {
              name: "openFile",
              arguments: { filePath, makeFrontmost: true },
            },
          })
        );
      } else if (msg.id === 2) {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
