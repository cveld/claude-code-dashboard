export interface HookEvent {
  type: "stop" | "notification";
  sessionId: string;
  projectSlug: string;
  message?: string;
  title?: string;
  timestamp: string;
}

export interface ProjectInfo {
  slug: string;
  displayPath: string;
  sessionCount: number;
  lastActivity: string | null;
}

export interface SessionWithProject {
  id: string;
  title: string | null;
  firstUserMessage: string | null;
  lastActivity: string;
  startedAt: string | null;
  messageCount: number;
  projectSlug: string;
  projectDisplayPath: string;
  lastInputTokens: number | null;
}

export function isUnread(
  session: { id: string; projectSlug: string; lastActivity: string },
  readState: Record<string, string>
): boolean {
  const key = `${session.projectSlug}/${session.id}`;
  return !readState[key] || session.lastActivity > readState[key];
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface IdeWindow {
  port: number;
  workspaceFolders: string[];
  pid: number;
  ideName: string;
}

// Encodes a workspace folder path the same way Claude encodes project paths to slugs.
export function pathToSlug(folderPath: string): string {
  return folderPath.replace(/[:\\/\s]/g, "-");
}

export function findIdeWindowForSlug(
  slug: string,
  windows: IdeWindow[]
): IdeWindow | undefined {
  return windows.find((w) =>
    w.workspaceFolders.some((folder) => pathToSlug(folder) === slug)
  );
}

export function topSegment(displayPath: string): string {
  const parts = displayPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[0] ?? displayPath;
}
