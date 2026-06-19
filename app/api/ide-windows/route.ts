import { NextResponse } from "next/server";
import { readIdeWindows } from "../../lib/ideWindows";

export async function GET() {
  return NextResponse.json(readIdeWindows());
}
