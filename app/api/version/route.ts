import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf-8");
    const { version } = JSON.parse(raw) as { version: string };
    return NextResponse.json({ version });
  } catch {
    return NextResponse.json({ version: null });
  }
}
