import { NextRequest, NextResponse } from "next/server";
import { hookEmitter } from "@/app/lib/hookEvents";
import { setHookEvent } from "@/app/lib/hookStore";
import type { HookEvent } from "@/app/lib/dashboard";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json();

  let projectSlug = "";
  let sessionId = body.sessionId ?? "";

  if (body.transcriptPath) {
    const parts = (body.transcriptPath as string).replace(/\\/g, "/").split("/");
    const filename = parts[parts.length - 1];
    if (!sessionId) sessionId = filename.replace(".jsonl", "");
    projectSlug = parts[parts.length - 2] ?? "";
  }

  const event: HookEvent = {
    type: body.event as "stop" | "notification" | "permission",
    sessionId,
    projectSlug,
    message: body.message,
    title: body.title,
    tool: body.tool,
    timestamp: new Date().toISOString(),
  };

  hookEmitter.emit("hook", event);
  setHookEvent(event);
  return NextResponse.json({ ok: true });
}
