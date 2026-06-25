import { NextResponse } from "next/server";
import { getAllHookEvents } from "@/app/lib/hookStore";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAllHookEvents());
}
