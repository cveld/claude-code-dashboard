import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

const CLAUDE_SETTINGS_FILE = path.join(os.homedir(), ".claude", "settings.json");

export interface ConfiguredHook {
  event: string;
  matcher?: string;
  type: string;
  shell?: string;
  command: string;
}

interface HookEntry {
  type?: string;
  shell?: string;
  command?: string;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
}

export function GET() {
  let hooks: ConfiguredHook[] = [];
  let error: string | null = null;

  try {
    const raw = fs.readFileSync(CLAUDE_SETTINGS_FILE, "utf-8");
    const settings = JSON.parse(raw);
    const hooksSection: Record<string, HookGroup[]> = settings.hooks ?? {};

    hooks = Object.entries(hooksSection).flatMap(([event, groups]) =>
      (Array.isArray(groups) ? groups : []).flatMap((group) =>
        (group.hooks ?? []).map((h) => ({
          event,
          ...(group.matcher ? { matcher: group.matcher } : {}),
          type: h.type ?? "command",
          ...(h.shell ? { shell: h.shell } : {}),
          command: h.command ?? "",
        }))
      )
    );
  } catch (e) {
    error =
      e instanceof SyntaxError
        ? "Could not parse ~/.claude/settings.json"
        : "Could not read ~/.claude/settings.json";
  }

  return NextResponse.json({ source: "~/.claude/settings.json", hooks, error });
}
