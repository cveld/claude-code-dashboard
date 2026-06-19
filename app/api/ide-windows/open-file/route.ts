import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import WebSocket from "ws";

export async function POST(req: NextRequest) {
  const { port, filePath } = await req.json();

  const lockFile = path.join(os.homedir(), ".claude", "ide", `${port}.lock`);
  if (!fs.existsSync(lockFile)) {
    return NextResponse.json({ error: "IDE window not found" }, { status: 404 });
  }

  let authToken: string;
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile, "utf-8"));
    authToken = lock.authToken;
  } catch {
    return NextResponse.json({ error: "Failed to read lock file" }, { status: 500 });
  }

  try {
    await mcpOpenFile(port, authToken, filePath);
    return NextResponse.json({ ok: true });
  } catch (e) {
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
