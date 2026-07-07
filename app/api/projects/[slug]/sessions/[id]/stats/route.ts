import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

export interface SessionStats {
  currentContext: number;
  // Fresh (non-cached) input tokens summed over every assistant turn.
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  // Total tokens billed across every assistant turn: input + cache + output.
  totalTokensBurned: number;
  // Per-model split of the burned components, keyed by message.model.
  perModel: Record<string, ModelTokenComponents>;
  assistantTurns: number;
  contextWindowSize: number;
}

export interface ModelTokenComponents {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
}

async function parseStats(filePath: string): Promise<SessionStats> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    let currentContext = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreation = 0;
    let totalCacheRead = 0;
    let totalTokensBurned = 0;
    let assistantTurns = 0;
    const perModel: Record<string, ModelTokenComponents> = {};

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "assistant" && obj.message?.usage) {
          const u = obj.message.usage;
          if (u.input_tokens != null) currentContext = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
          totalInputTokens += u.input_tokens ?? 0;
          totalOutputTokens += u.output_tokens ?? 0;
          totalCacheCreation += u.cache_creation_input_tokens ?? 0;
          totalCacheRead += u.cache_read_input_tokens ?? 0;
          totalTokensBurned += (u.input_tokens ?? 0)
            + (u.cache_creation_input_tokens ?? 0)
            + (u.cache_read_input_tokens ?? 0)
            + (u.output_tokens ?? 0);
          const model = obj.message.model ?? "unknown";
          const m = (perModel[model] ??= { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 });
          m.input += u.input_tokens ?? 0;
          m.cacheCreation += u.cache_creation_input_tokens ?? 0;
          m.cacheRead += u.cache_read_input_tokens ?? 0;
          m.output += u.output_tokens ?? 0;
          assistantTurns++;
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", () =>
      resolve({
        currentContext,
        totalInputTokens,
        totalOutputTokens,
        totalCacheCreation,
        totalCacheRead,
        totalTokensBurned,
        perModel,
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
