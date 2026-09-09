import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { hookEmitter } from "@/app/lib/hookEvents";
import type { HookEvent } from "@/app/lib/dashboard";
import { SESSIONS_DIR } from "@/app/lib/activeSessions";

export const runtime = "nodejs";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// Only `<pid>.json` — skip `-inbox.jsonl` and `-monitor.ready` companion files.
const SESSION_FILE_RE = /^(\d+)\.json$/;

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      let watcher: fs.FSWatcher | null = null;
      try {
        watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_event, filename) => {
          if (filename?.endsWith(".jsonl")) {
            const parts = filename.replace(/\\/g, "/").split("/");
            const slug = parts.length >= 2 ? parts[0] : null;
            const sessionId = parts.length >= 2 ? parts[parts.length - 1].replace(".jsonl", "") : null;
            const payload = JSON.stringify({ slug, sessionId });
            controller.enqueue(encoder.encode(`event: change\ndata: ${payload}\n\n`));
          }
        });
      } catch {
        // projects dir doesn't exist yet
      }

      // Fast-path for `/processes`: a `<pid>.json` appearing/disappearing means
      // a Claude Code process started or stopped. Only the pid + which of the
      // two happened is sent — the client fetches (or drops) just that one
      // record instead of re-downloading the whole active-sessions list.
      let sessionsWatcher: fs.FSWatcher | null = null;
      try {
        sessionsWatcher = fs.watch(SESSIONS_DIR, (_event, filename) => {
          const match = filename?.match(SESSION_FILE_RE);
          if (!match) return;
          const pid = Number(match[1]);
          const type = fs.existsSync(path.join(SESSIONS_DIR, filename!)) ? "added" : "removed";
          const payload = JSON.stringify({ type, pid });
          controller.enqueue(encoder.encode(`event: session\ndata: ${payload}\n\n`));
        });
      } catch {
        // sessions dir doesn't exist yet
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
        sessionsWatcher?.close();
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
