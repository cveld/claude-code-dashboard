import fs from "fs";
import path from "path";
import readline from "readline";

export type PeekResult = {
  startedAt: string | null;
  messageCount: number;
  firstUserMessage: string | null;
  title: string | null;
  lastInputTokens: number | null;
  lastMessageAt: string | null;
  // Total tokens billed across the whole session: sum over every assistant turn
  // of input + cache-creation + cache-read + output. Unlike lastInputTokens
  // (which reflects only the final turn's context), this accumulates every turn.
  totalTokensBurned: number;
  // Per-component breakdown of totalTokensBurned, summed over every turn.
  tokenBreakdown: TokenBreakdown;
};

export type TokenBreakdown = {
  input: number;
  cacheCreation: number;
  cacheRead: number;
  output: number;
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
    let lastMessageAt: string | null = null;
    let burnedInput = 0;
    let burnedCacheCreation = 0;
    let burnedCacheRead = 0;
    let burnedOutput = 0;

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
        if (obj.type === "assistant" && obj.message?.usage) {
          const u = obj.message.usage;
          if (u.input_tokens != null) {
            lastInputTokens = (u.input_tokens ?? 0)
              + (u.cache_creation_input_tokens ?? 0)
              + (u.cache_read_input_tokens ?? 0);
          }
          burnedInput += u.input_tokens ?? 0;
          burnedCacheCreation += u.cache_creation_input_tokens ?? 0;
          burnedCacheRead += u.cache_read_input_tokens ?? 0;
          burnedOutput += u.output_tokens ?? 0;
        }
        if ((obj.type === "user" || obj.type === "assistant") && obj.timestamp) {
          lastMessageAt = obj.timestamp;
        }
      } catch {
        // skip malformed lines
      }
    });

    rl.on("close", () => resolve({
      startedAt,
      messageCount: count,
      firstUserMessage,
      title: customTitle ?? aiTitle,
      lastInputTokens,
      lastMessageAt,
      totalTokensBurned: burnedInput + burnedCacheCreation + burnedCacheRead + burnedOutput,
      tokenBreakdown: {
        input: burnedInput,
        cacheCreation: burnedCacheCreation,
        cacheRead: burnedCacheRead,
        output: burnedOutput,
      },
    }));
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
  // Recompute when the field is missing so cache entries written before
  // totalTokensBurned existed get backfilled on next read.
  if (entry && entry.mtime === mtimeStr && entry.tokenBreakdown != null) {
    const { mtime: _m, ...result } = entry;
    return result;
  }
  const result = await peekJsonlRaw(filePath);
  cache[filename] = { ...result, mtime: mtimeStr };
  return result;
}
