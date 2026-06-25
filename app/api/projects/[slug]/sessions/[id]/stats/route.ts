import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

export interface SessionStats {
  currentContext: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  assistantTurns: number;
  contextWindowSize: number;
}

async function parseStats(filePath: string): Promise<SessionStats> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    let currentContext = 0;
    let totalOutputTokens = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;
    let assistantTurns = 0;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.usage) {
          const u = obj.message.usage;
          if (u.input_tokens != null) currentContext = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          totalOutputTokens += u.output_tokens ?? 0;
          totalCacheCreation += u.cache_creation_input_tokens ?? 0;
          totalCacheRead += u.cache_read_input_tokens ?? 0;
          assistantTurns++;
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", () =>
      resolve({
        currentContext,
        totalOutputTokens,
        totalCacheCreation,
        totalCacheRead,
        assistantTurns,
        contextWindowSize: 200000,
      })
    );
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const filePath = path.join(os.homedir(), ".claude", "projects", slug, `${id}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const stats = await parseStats(filePath);
  return NextResponse.json(stats);
}
