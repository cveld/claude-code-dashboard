import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const SETTINGS_FILE = path.join(os.homedir(), ".claude", "dashboard-settings.json");

export interface DashboardSettings {
  autoMarkAsRead: boolean;
}

const DEFAULTS: DashboardSettings = { autoMarkAsRead: false };

export function readSettings(): DashboardSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function GET() {
  return NextResponse.json(readSettings());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const settings = readSettings();
  if (typeof body.autoMarkAsRead === "boolean") {
    settings.autoMarkAsRead = body.autoMarkAsRead;
  }
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  return NextResponse.json(settings);
}
