import { NextRequest, NextResponse } from "next/server";
import { appendFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  if (!/^[0-9a-f-]{36}$/.test(sessionId)) {
    return NextResponse.json({ error: "invalid session id" }, { status: 400 });
  }

  const body = await req.json();
  const message: unknown = body?.message;
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const inboxPath = join(homedir(), ".claude", "sessions", `${sessionId}-inbox.jsonl`);
  const line =
    JSON.stringify({
      message: message.trim(),
      from: "dashboard",
      timestamp: new Date().toISOString(),
    }) + "\n";

  await appendFile(inboxPath, line, "utf8");
  return NextResponse.json({ ok: true });
}
