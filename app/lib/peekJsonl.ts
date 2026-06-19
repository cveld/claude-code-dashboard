import fs from "fs";
import path from "path";
import readline from "readline";

export type PeekResult = {
  startedAt: string | null;
  messageCount: number;
  firstUserMessage: string | null;
  title: string | null;
  lastInputTokens: number | null;
};

type CacheEntry = PeekResult & { mtime: string };
type PeekCache = Record<string, CacheEntry>;

const CACHE_FILE = ".peek-cache.json";

export function loadCache(projectDir: string): PeekCache {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, CACHE_FILE), "utf-8"));
  } catch {
    return {};
  }
}

export function saveCache(projectDir: string, cache: PeekCache): void {
  try {
    fs.writeFileSync(path.join(projectDir, CACHE_FILE), JSON.stringify(cache), "utf-8");
  } catch {
    // ignore write errors — cache is best-effort
  }
}

async function peekJsonlRaw(filePath: string): Promise<PeekResult> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    let count = 0;
    let startedAt: string | null = null;
    let firstUserMessage: string | null = null;
    let aiTitle: string | null = null;
    let customTitle: string | null = null;
    let lastInputTokens: number | null = null;

    rl.on("line", (line) => {
      if (!line.trim()) return;
      count++;
      try {
        const obj = JSON.parse(line);
        if (!startedAt && obj.timestamp) startedAt = obj.timestamp;
        if (obj.type === "ai-title" && obj.aiTitle) aiTitle = obj.aiTitle;
        if (obj.type === "custom-title" && obj.customTitle) customTitle = obj.customTitle;
        if (!firstUserMessage && obj.type === "user" && obj.message?.content) {
          const content = obj.message.content;
          if (typeof content === "string") {
            firstUserMessage = content.slice(0, 120);
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: { type: string; text?: string }) => b.type === "text");
            if (textBlock?.text) firstUserMessage = textBlock.text.slice(0, 120);
          }
        }
        if (obj.type === "assistant" && obj.message?.usage?.input_tokens != null) {
          lastInputTokens = obj.message.usage.input_tokens;
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", () => resolve({ startedAt, messageCount: count, firstUserMessage, title: customTitle ?? aiTitle, lastInputTokens }));
  });
}

export async function peekJsonlCached(
  filePath: string,
  filename: string,
  mtime: Date,
  cache: PeekCache
): Promise<PeekResult> {
  const mtimeStr = mtime.toISOString();
  const entry = cache[filename];
  if (entry && entry.mtime === mtimeStr) {
    const { mtime: _m, ...result } = entry;
    return result;
  }
  const result = await peekJsonlRaw(filePath);
  cache[filename] = { ...result, mtime: mtimeStr };
  return result;
}
