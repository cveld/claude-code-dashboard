import { NextResponse } from "next/server";
import {
  attachTranscriptInfo,
  deleteSessionFile,
  getMemoryUsage,
  readSessionFile,
} from "@/app/lib/activeSessions";

// Single-session lookup: the SSE fast-path in `/api/events` tells the client
// which pid appeared, and the client fetches just that one record here
// instead of re-downloading and re-enriching the entire active-sessions list.
export async function GET(_request: Request, { params }: { params: Promise<{ pid: string }> }) {
  const { pid: pidParam } = await params;
  const pid = Number(pidParam);
  if (!Number.isInteger(pid) || pid <= 0) {
    return NextResponse.json({ error: "Invalid pid" }, { status: 400 });
  }

  const session = readSessionFile(pid);
  if (!session) {
    return NextResponse.json(null, { status: 404 });
  }

  await attachTranscriptInfo(session);

  const { ok, usage: memory } = await getMemoryUsage([pid]);
  const usage = memory.get(pid);
  if (usage) {
    session.memoryBytes = usage.memoryBytes;
    session.pagedMemoryBytes = usage.pagedMemoryBytes;
  } else if (ok) {
    // The probe succeeded and this pid specifically wasn't found — the
    // process is already gone. Same stale-file case the list endpoint
    // prunes; clean it up here too. A *failed* probe (ok: false) must not
    // reach this branch — that would delete a live session's file just
    // because the liveness check itself didn't work.
    deleteSessionFile(pid);
    return NextResponse.json(null, { status: 404 });
  }

  return NextResponse.json(session);
}
