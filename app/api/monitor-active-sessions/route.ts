import { NextResponse } from "next/server";
import { readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

export async function GET() {
  const dir = join(homedir(), ".claude", "sessions");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return NextResponse.json([]);
  }

  const activeIds = files
    .filter((f) => f.endsWith("-monitor.ready"))
    .map((f) => f.replace("-monitor.ready", ""));

  return NextResponse.json(activeIds);
}
