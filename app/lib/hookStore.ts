import fs from "fs";
import path from "path";
import type { HookEvent } from "./dashboard";

const STORE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".claude",
  "dashboard-hook-events.json"
);

function read(): Record<string, HookEvent> {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function setHookEvent(event: HookEvent): void {
  const key = `${event.projectSlug}/${event.sessionId}`;
  const data = read();
  data[key] = event;
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data), "utf-8");
  } catch {
    // best-effort
  }
}

export function getAllHookEvents(): Record<string, HookEvent> {
  return read();
}
