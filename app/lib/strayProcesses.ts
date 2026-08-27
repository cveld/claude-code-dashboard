// Pure detection logic for stranded git / Git Credential Manager process trees.
// The PowerShell snapshot that feeds it lives in app/api/stray-processes/route.ts.

export interface StrayProcess {
  pid: number;
  parentPid: number;
  name: string;
  commandLine: string;
  createdAt: number;
  memoryBytes: number;
  /** Hops from the chain root; the root itself is 0. */
  depth: number;
}

export type StrayReason = "waiting-for-credentials" | "orphaned" | "stale";

export interface StrayChain {
  rootPid: number;
  processes: StrayProcess[];
  ageMs: number;
  /** Repo name pulled from the remote URL in a command line, when present. */
  target?: string;
  reasons: StrayReason[];
}

export interface StrayProcessesResponse {
  supported: boolean;
  chains: StrayChain[];
  totalProcesses: number;
  oldestAgeMs: number;
}

/** A healthy git fetch/push never takes this long — beyond it, assume it hung. */
const STALE_AFTER_MS = 10 * 60 * 1000;

/** Process names that can strand while a git operation waits on credentials. */
export const HELPER_NAMES = [
  "git.exe",
  "git-remote-https.exe",
  "git-credential-manager.exe",
  "sh.exe",
  "ssh.exe",
];

/** sh/ssh are far too common to flag on the name alone. */
const NEEDS_GCM_IN_COMMAND = new Set(["sh.exe", "ssh.exe"]);

export interface RawProc {
  ProcessId?: unknown;
  ParentProcessId?: unknown;
  Name?: unknown;
  CommandLine?: unknown;
  WorkingSetSize?: unknown;
  CreatedAt?: unknown;
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseDateMs(value: unknown, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : fallback;
}

function repoFromCommandLine(commandLine: string): string | undefined {
  const match = commandLine.match(/https?:\/\/[^\s"']+/i);
  if (!match) return undefined;
  const segments = match[0].replace(/[),.;]+$/, "").split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last) return undefined;
  return last.endsWith(".git") ? last.slice(0, -4) : last;
}

export function buildChains(procs: RawProc[], livePids: Set<number>, now = Date.now()): StrayChain[] {
  const parsed: StrayProcess[] = [];
  for (const p of procs) {
    const pid = toNumber(p.ProcessId);
    const parentPid = toNumber(p.ParentProcessId);
    if (pid === undefined || parentPid === undefined) continue;
    const name = toText(p.Name).toLowerCase();
    const commandLine = toText(p.CommandLine);
    if (NEEDS_GCM_IN_COMMAND.has(name) && !commandLine.toLowerCase().includes("git-credential-manager")) {
      continue;
    }
    parsed.push({
      pid,
      parentPid,
      name,
      commandLine,
      createdAt: parseDateMs(p.CreatedAt, now),
      memoryBytes: toNumber(p.WorkingSetSize) ?? 0,
      depth: 0,
    });
  }

  const byPid = new Map(parsed.map((p) => [p.pid, p]));
  const groups = new Map<number, StrayProcess[]>();

  for (const p of parsed) {
    // Walk up while the parent is a helper too — the topmost one roots the chain.
    let root = p;
    let depth = 0;
    const seen = new Set<number>([p.pid]);
    for (let hop = 0; hop < 32; hop++) {
      const parent = byPid.get(root.parentPid);
      if (!parent || seen.has(parent.pid)) break;
      seen.add(parent.pid);
      root = parent;
      depth++;
    }
    const group = groups.get(root.pid) ?? [];
    group.push({ ...p, depth });
    groups.set(root.pid, group);
  }

  const chains: StrayChain[] = [];
  for (const [rootPid, group] of groups) {
    group.sort((a, b) => a.depth - b.depth || a.createdAt - b.createdAt);
    const ageMs = Math.max(0, now - Math.min(...group.map((p) => p.createdAt)));

    const reasons: StrayReason[] = [];
    if (group.some((p) => p.name === "git-credential-manager.exe" ||
        p.commandLine.toLowerCase().includes("git-credential-manager"))) {
      reasons.push("waiting-for-credentials");
    }
    const root = group.find((p) => p.pid === rootPid);
    if (root && (root.parentPid === 0 || !livePids.has(root.parentPid))) {
      reasons.push("orphaned");
    }
    if (ageMs > STALE_AFTER_MS) reasons.push("stale");

    // No reason at all = a git operation that is simply still running.
    if (reasons.length === 0) continue;

    let target: string | undefined;
    for (const p of group) {
      target = repoFromCommandLine(p.commandLine);
      if (target) break;
    }

    chains.push({ rootPid, processes: group, ageMs, target, reasons });
  }

  chains.sort((a, b) => b.ageMs - a.ageMs);
  return chains;
}

