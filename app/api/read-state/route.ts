import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const STATE_FILE = path.join(os.homedir(), ".claude", "dashboard-read.json");

function readState(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function GET() {
  return NextResponse.json(readState());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const state = readState();
  const now = new Date().toISOString();

  const slugs: string[] = body.slugs ?? (body.slug ? [body.slug] : []);
  if (slugs.length === 0) {
    return NextResponse.json({ error: "slug or slugs required" }, { status: 400 });
  }

  for (const slug of slugs) {
    if (body.unread) delete state[slug];
    else state[slug] = now;
  }

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return NextResponse.json({ ok: true });
}
