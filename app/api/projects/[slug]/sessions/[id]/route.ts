import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";

export interface TranscriptMessage {
  type: "user" | "assistant" | "system" | "other";
  timestamp: string | null;
  text: string;
  uuid?: string;
}

async function parseTranscript(filePath: string): Promise<TranscriptMessage[]> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    const messages: TranscriptMessage[] = [];

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "user" || obj.type === "assistant") {
          const content = obj.message?.content;
          let text = "";
          if (typeof content === "string") {
            text = content;
          } else if (Array.isArray(content)) {
            text = content
              .filter((b: { type: string; text?: string }) => b.type === "text")
              .map((b: { type: string; text?: string }) => b.text ?? "")
              .join("\n");
          }
          if (text) {
            messages.push({
              type: obj.type,
              timestamp: obj.message?.timestamp ?? obj.timestamp ?? null,
              text,
              uuid: obj.uuid,
            });
          }
        }
      } catch {
        // skip
      }
    });

    rl.on("close", () => resolve(messages));
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const { slug, id } = await params;
  const tail = parseInt(new URL(req.url).searchParams.get("tail") ?? "0", 10);
  const filePath = path.join(os.homedir(), ".claude", "projects", slug, `${id}.jsonl`);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const messages = await parseTranscript(filePath);
  return NextResponse.json({ messages: tail > 0 ? messages.slice(-tail) : messages });
}
