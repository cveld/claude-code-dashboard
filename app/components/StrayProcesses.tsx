"use client";

import { useCallback, useEffect, useState } from "react";
import type { StrayChain, StrayProcessesResponse, StrayReason } from "@/app/lib/strayProcesses";
import type { KillResult } from "@/app/api/stray-processes/kill/route";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

const REASON_LABEL: Record<StrayReason, string> = {
  "waiting-for-credentials": "waiting for credentials",
  orphaned: "orphaned",
  stale: "stale",
};

const REASON_STYLE: Record<StrayReason, string> = {
  "waiting-for-credentials": "border-rose-800 bg-rose-950/50 text-rose-300",
  orphaned: "border-amber-800 bg-amber-950/50 text-amber-300",
  stale: "border-zinc-700 bg-zinc-800/60 text-zinc-400",
};

function fmtAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function fmtMb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

// The full command lines repeat long absolute paths; keep the informative tail.
function shortCommand(commandLine: string): string {
  const stripped = commandLine.replace(/"?\b[A-Za-z]:[\/][^"\s]*[\/]/g, "");
  return stripped.length > 110 ? `${stripped.slice(0, 110)}…` : stripped;
}

interface StrayProcessesProps {
  /** Called whenever the chain count changes, so a page header can show a summary badge. */
  onCountChange?: (count: number) => void;
}

export function StrayProcesses({ onCountChange }: StrayProcessesProps = {}) {
  const [data, setData] = useState<StrayProcessesResponse | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState<number | "all" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(true);

  const fetchData = useCallback(() => {
    setRefreshing(true);
    return fetch("/api/stray-processes")
      .then((r) => r.json())
      .then((d: StrayProcessesResponse) => setData(d))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    onCountChange?.(data?.supported ? data.chains.length : 0);
  }, [data, onCountChange]);

  const toggle = useCallback((rootPid: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rootPid)) next.delete(rootPid);
      else next.add(rootPid);
      return next;
    });
  }, []);

  const kill = useCallback(
    async (scope: number | "all", pids: number[], label: string) => {
      const question = `Kill ${pids.length} process${pids.length === 1 ? "" : "es"} (${label})?`;
      if (!window.confirm(`${question}\n\n${pids.join(", ")}`)) return;

      setPending(scope);
      setNotice(null);
      try {
        const res = await fetch("/api/stray-processes/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pids }),
        });
        const result = (await res.json()) as KillResult;
        const skipped = result.skipped ?? [];
        const detail = skipped.length
          ? ` — ${skipped.length} skipped: ${skipped.map((s) => `${s.pid} (${s.reason})`).join(", ")}`
          : "";
        setNotice(`Killed ${result.killed?.length ?? 0} of ${pids.length}${detail}`);
      } catch {
        setNotice("Kill request failed.");
      } finally {
        setPending(null);
        fetchData();
      }
    },
    [fetchData]
  );

  // Not Windows, or the first fetch hasn't landed yet — stay out of the way entirely.
  if (!data || !data.supported) {
    return notice ? <p className="mt-8 text-xs text-zinc-400">{notice}</p> : null;
  }

  const refreshButton = (
    <button
      onClick={fetchData}
      disabled={refreshing}
      className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 disabled:opacity-50 transition-colors"
    >
      {refreshing ? "Refreshing…" : "Refresh"}
    </button>
  );

  // Nothing stranded right now — a compact line with a manual refresh, so a
  // batch that started after the last poll doesn't need up to 2 minutes to show up.
  if (data.chains.length === 0) {
    return (
      <section id="stray-git-helpers" className="mt-8 scroll-mt-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSectionExpanded((v) => !v)}
            className="flex items-center gap-2"
            aria-expanded={sectionExpanded}
          >
            <span className="text-zinc-500 text-xs">{sectionExpanded ? "▾" : "▸"}</span>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
              Stray git helpers
            </h2>
          </button>
          <span className="text-sm text-zinc-500">none</span>
          <div className="ml-auto">{refreshButton}</div>
        </div>
        {sectionExpanded && notice && <p className="mt-3 text-xs text-zinc-300">{notice}</p>}
      </section>
    );
  }

  const blocking = data.chains.filter((c) => c.reasons.includes("waiting-for-credentials")).length;
  const allPids = data.chains.flatMap((c) => c.processes.map((p) => p.pid));

  return (
    <section id="stray-git-helpers" className="mt-8 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <button
          onClick={() => setSectionExpanded((v) => !v)}
          className="flex items-center gap-2"
          aria-expanded={sectionExpanded}
        >
          <span className="text-zinc-500 text-xs">{sectionExpanded ? "▾" : "▸"}</span>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Stray git helpers
          </h2>
        </button>
        <span className={`text-sm ${blocking > 0 ? "text-rose-400" : "text-amber-400"}`}>
          {data.totalProcesses} process{data.totalProcesses === 1 ? "" : "es"} in {data.chains.length} chain
          {data.chains.length === 1 ? "" : "s"}
        </span>
        <span className="text-zinc-600">·</span>
        <span className="text-sm text-zinc-400">oldest {fmtAge(data.oldestAgeMs)}</span>
        <div className="ml-auto flex items-center gap-2">
          {refreshButton}
          <button
            onClick={() => kill("all", allPids, "all chains")}
            disabled={pending !== null}
            className="text-xs px-2 py-1 rounded border border-rose-900 bg-rose-950/40 text-rose-300 hover:bg-rose-900/50 disabled:opacity-50 transition-colors"
          >
            {pending === "all" ? "Killing…" : `Kill all (${data.totalProcesses})`}
          </button>
        </div>
      </div>

      {sectionExpanded && blocking > 0 && (
        <p className="mb-3 text-xs text-zinc-400 leading-relaxed">
          {blocking} chain{blocking === 1 ? "" : "s"} deadlocked on a credential prompt. These hold locks on their
          working directory, which breaks <span className="font-mono text-zinc-300">git worktree move</span> and folder
          deletes. Prevent recurrence with{" "}
          <span className="font-mono text-zinc-300">GIT_TERMINAL_PROMPT=0</span> and{" "}
          <span className="font-mono text-zinc-300">credential.interactive=false</span> for non-interactive git.
        </p>
      )}

      {sectionExpanded && notice && <p className="mb-3 text-xs text-zinc-300">{notice}</p>}

      {sectionExpanded && (
      <div className="flex flex-col gap-2">
        {data.chains.map((chain: StrayChain) => {
          const isOpen = expanded.has(chain.rootPid);
          const root = chain.processes[0];
          const pids = chain.processes.map((p) => p.pid);
          return (
            <div key={chain.rootPid} className="rounded-lg border border-zinc-800 bg-zinc-900">
              <div className="flex items-center gap-3 px-3 py-2">
                <button
                  onClick={() => toggle(chain.rootPid)}
                  className="flex items-center gap-2 min-w-0 flex-1 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-zinc-500 text-xs w-3 shrink-0">{isOpen ? "▾" : "▸"}</span>
                  <span className="font-mono text-xs text-zinc-500 w-14 shrink-0">{chain.rootPid}</span>
                  <span className="text-xs text-zinc-300 truncate">
                    {root?.name ?? "?"}
                    <span className="text-zinc-600"> · {chain.processes.length} procs</span>
                  </span>
                  {chain.target && (
                    <span className="font-mono text-xs text-zinc-500 truncate hidden md:inline" title={chain.target}>
                      {chain.target}
                    </span>
                  )}
                </button>
                <span className="text-xs tabular-nums text-zinc-400 shrink-0">{fmtAge(chain.ageMs)}</span>
                <div className="flex items-center gap-1 shrink-0">
                  {chain.reasons.map((r) => (
                    <span
                      key={r}
                      className={`text-[10px] px-1.5 py-px rounded border whitespace-nowrap ${REASON_STYLE[r]}`}
                    >
                      {REASON_LABEL[r]}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => kill(chain.rootPid, pids, `chain ${chain.rootPid}`)}
                  disabled={pending !== null}
                  className="text-[10px] px-1.5 py-px rounded border border-zinc-700 text-zinc-400 hover:text-rose-300 hover:border-rose-800 disabled:opacity-50 transition-colors shrink-0 whitespace-nowrap"
                  title="Kill this chain, leaf process first"
                >
                  {pending === chain.rootPid ? "Killing…" : `Kill chain (${pids.length})`}
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-zinc-800 px-3 py-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <tbody>
                      {chain.processes.map((p) => (
                        <tr key={p.pid} className="text-zinc-400">
                          <td className="py-1 pr-3 font-mono text-zinc-500 align-top w-14">{p.pid}</td>
                          <td className="py-1 pr-3 align-top whitespace-nowrap">
                            <span style={{ paddingLeft: `${p.depth * 12}px` }} className="text-zinc-300">
                              {p.name}
                            </span>
                          </td>
                          <td className="py-1 pr-3 font-mono text-zinc-500 align-top" title={p.commandLine}>
                            {shortCommand(p.commandLine)}
                          </td>
                          <td className="py-1 text-right tabular-nums align-top whitespace-nowrap">
                            {fmtMb(p.memoryBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}
