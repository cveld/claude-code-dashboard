import { describe, it, expect } from "vitest";
import { buildChains } from "./strayProcesses";
import type { RawProc } from "./strayProcesses";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const AGO = (ms: number) => new Date(NOW - ms).toISOString();

function proc(pid: number, parentPid: number, name: string, commandLine: string, ageMs = 60_000): RawProc {
  return {
    ProcessId: pid,
    ParentProcessId: parentPid,
    Name: name,
    CommandLine: commandLine,
    WorkingSetSize: 1024 * 1024,
    CreatedAt: AGO(ageMs),
  };
}

const GCM = "C:\Users\me\.dotnet\tools\git-credential-manager.exe get";
const REMOTE = "git remote-https origin https://org@dev.azure.com/org/proj/_git/my-repo";

// The real-world case: git fetch -> remote-https -> sh -> GCM, all deadlocked on a prompt.
const strandedChain = (rootPid: number, parentPid: number, ageMs: number): RawProc[] => [
  proc(rootPid, parentPid, "git.exe", "git.exe fetch", ageMs),
  proc(rootPid + 1, rootPid, "git-remote-https.exe", REMOTE, ageMs),
  proc(rootPid + 2, rootPid + 1, "sh.exe", `"C:/Program Files/Git/usr/bin/sh.exe" -c "${GCM}"`, ageMs),
  proc(rootPid + 3, rootPid + 2, "git-credential-manager.exe", GCM, ageMs),
];

describe("buildChains", () => {
  it("groups a stranded tree into one chain with depths, age, reasons and repo target", () => {
    const chains = buildChains(strandedChain(100, 999, 41 * 3600_000), new Set([100, 101, 102, 103]), NOW);

    expect(chains).toHaveLength(1);
    const chain = chains[0];
    expect(chain.rootPid).toBe(100);
    expect(chain.processes.map((p) => [p.pid, p.depth])).toEqual([[100, 0], [101, 1], [102, 2], [103, 3]]);
    expect(chain.ageMs).toBe(41 * 3600_000);
    expect(chain.target).toBe("my-repo");
    expect(chain.reasons).toEqual(["waiting-for-credentials", "orphaned", "stale"]);
  });

  it("keeps separate parallel batches apart", () => {
    const procs = [...strandedChain(100, 998, 3600_000), ...strandedChain(200, 997, 3600_000)];
    const chains = buildChains(procs, new Set(), NOW);
    expect(chains.map((c) => c.rootPid).sort()).toEqual([100, 200]);
  });

  it("drops a healthy in-flight git operation", () => {
    const procs = [
      proc(300, 301, "git.exe", "git.exe fetch", 5_000),
      proc(302, 300, "git-remote-https.exe", REMOTE, 5_000),
    ];
    // Parent alive, young, no credential helper — nothing to report.
    expect(buildChains(procs, new Set([301, 300, 302]), NOW)).toEqual([]);
  });

  it("ignores sh/ssh that have nothing to do with git credentials", () => {
    const procs = [proc(400, 1, "sh.exe", '"C:/Program Files/Git/usr/bin/sh.exe" -c "npm run build"', 7200_000)];
    expect(buildChains(procs, new Set(), NOW)).toEqual([]);
  });

  it("flags a young orphan even before it is stale", () => {
    const chains = buildChains(strandedChain(500, 4242, 60_000), new Set([500, 501, 502, 503]), NOW);
    expect(chains[0].reasons).toEqual(["waiting-for-credentials", "orphaned"]);
  });

  it("survives a parent cycle without hanging", () => {
    const procs = [
      proc(600, 601, "git.exe", "git.exe fetch", 7200_000),
      proc(601, 600, "git.exe", "git.exe fetch", 7200_000),
    ];
    expect(() => buildChains(procs, new Set(), NOW)).not.toThrow();
  });

  it("skips rows without a usable pid", () => {
    expect(buildChains([{ ProcessId: null, ParentProcessId: 1, Name: "git.exe" }], new Set(), NOW)).toEqual([]);
  });
});
