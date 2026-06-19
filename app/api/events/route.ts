import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { hookEmitter } from "@/app/lib/hookEvents";
import type { HookEvent } from "@/app/lib/dashboard";

export const runtime = "nodejs";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      let watcher: fs.FSWatcher | null = null;
      try {
        watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_event, filename) => {
          if (filename?.endsWith(".jsonl")) {
            controller.enqueue(encoder.encode("event: change\ndata: {}\n\n"));
          }
        });
      } catch {
        // projects dir doesn't exist yet
      }

      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": heartbeat\n\n"));
      }, 30_000);

      function onHook(event: HookEvent) {
        controller.enqueue(encoder.encode(`event: hook\ndata: ${JSON.stringify(event)}\n\n`));
      }
      hookEmitter.on("hook", onHook);

      req.signal.addEventListener("abort", () => {
        watcher?.close();
        clearInterval(heartbeat);
        hookEmitter.off("hook", onHook);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
