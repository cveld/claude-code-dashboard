import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const CREDENTIALS_FILE = path.join(os.homedir(), ".claude", ".credentials.json");
const API_URL = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface UsageLimitWindow {
  utilization: number;
  resets_at: string | null;
}

export interface TokenUsage {
  five_hour: UsageLimitWindow | null;
  seven_day: UsageLimitWindow | null;
  seven_day_sonnet: UsageLimitWindow | null;
}

let cache: { data: TokenUsage; timestamp: number } | null = null;

function readToken(): string | null {
  try {
    const content = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    const creds = JSON.parse(content);
    return creds?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null;
  }
}

function validateWindow(raw: unknown): UsageLimitWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.utilization !== "number") return null;
  return {
    utilization: w.utilization,
    resets_at: typeof w.resets_at === "string" ? w.resets_at : null,
  };
}

export async function GET() {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const token = readToken();
  if (!token) {
    return NextResponse.json({ error: "no_credentials" }, { status: 401 });
  }

  try {
    const res = await fetch(API_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `api_error_${res.status}` }, { status: res.status });
    }

    const raw = await res.json();
    const data: TokenUsage = {
      five_hour: validateWindow(raw.five_hour),
      seven_day: validateWindow(raw.seven_day),
      seven_day_sonnet: validateWindow(raw.seven_day_sonnet),
    };

    cache = { data, timestamp: Date.now() };
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "fetch_failed" }, { status: 502 });
  }
}
