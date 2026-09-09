"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClaudeProcessesResponse } from "@/app/api/claude-processes/route";
import type { KillClaudeProcessResult } from "@/app/api/claude-processes/kill/route";

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const IDLE_AMBER_MS = 5 * 60_000;
const IDLE_ROSE_MS = 30 * 60_000;

function idleColor(ms: number | null): string {
  if (ms === null) return "text-zinc-600";
  if (ms > IDLE_ROSE_MS) return "text-rose-400";
  if (ms > IDLE_AMBER_MS) return "text-amber-400";
  return "text-zinc-400";
}

function fmtAge(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

// The full executable path repeats long absolute prefixes; keep the part that
// says *where this claude.exe came from* (VS Code extension vs. WinGet vs. elsewhere).
function shortPath(fullPath: string): string {
  const stripped = fullPath.replace(/^"?[A-Za-z]:[\\/].*?([\\/][^\\/]+[\\/][^\\/]+)$/, "…$1");
  return stripped.length > 70 ? `…${stripped.slice(-70)}` : stripped;
}

function folderName(cwd: string): string {
  const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || cwd;
}

interface UnregisteredClaudeProcessesProps {
  onCountChange?: (count: number) => void;
}

export function UnregisteredClaudeProcesses({ onCountChange }: UnregisteredClaudeProcessesProps = {}) {
  const [data, setData] = useState<ClaudeProcessesResponse | null>(null);
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sectionExpanded, setSectionExpanded] = useState(true);

  const fetchData = useCallback(() => {
    setRefreshing(true);
    return fetch("/api/claude-processes")
      .then((r) => r.json())
      .then((d: ClaudeProcessesResponse) => setData(d))
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    onCountChange?.(data?.supported ? data.unregistered.length : 0);
  }, [data, onCountChange]);

  const kill = useCallback(
    async (pid: number) => {
      const cwd = data?.unregistered.find((p) => p.pid === pid)?.cwd;
      const cwdNote = cwd ? `Working directory: ${cwd}` : "Its working directory could not be determined.";
      if (!window.confirm(`Kill claude.exe process ${pid}?\n\nThis process has no ~/.claude/sessions registry file. ${cwdNote}`)) {
        return;
      }
      setKillingPids((prev) => new Set(prev).add(pid));
      setNotice(null);
      try {
        const res = await fetch("/api/claude-processes/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid }),
        });
        const result = (await res.json()) as KillClaudeProcessResult;
        setNotice(result.killed ? `Killed process ${pid}.` : `Could not kill ${pid}: ${result.error ?? "unknown error"}`);
      } catch {
        setNotice(`Kill request for ${pid} failed.`);
      } finally {
        await fetchData();
        setKillingPids((prev) => {
          const next = new Set(prev);
          next.delete(pid);
          return next;
        });
      }
    },
    [fetchData, data]
  );

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

  return (
    <section id="unregistered-claude-processes" className="mt-8 scroll-mt-20">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <button
          onClick={() => setSectionExpanded((v) => !v)}
          className="flex items-center gap-2"
          aria-expanded={sectionExpanded}
        >
          <span className="text-zinc-500 text-xs">{sectionExpanded ? "▾" : "▸"}</span>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Unregistered claude.exe processes
          </h2>
        </button>
        <span className={`text-sm ${data.unregistered.length > 0 ? "text-amber-400" : "text-zinc-500"}`}>
          {data.unregistered.length === 0 ? "none" : `${data.unregistered.length} process${data.unregistered.length === 1 ? "" : "es"}`}
        </span>
        <div className="ml-auto">{refreshButton}</div>
      </div>

      {sectionExpanded && data.unregistered.length > 0 && (
        <p className="mb-3 text-xs text-zinc-400 leading-relaxed">
          Real <span className="font-mono text-zinc-300">claude.exe</span> processes with no{" "}
          <span className="font-mono text-zinc-300">~/.claude/sessions</span> registry file — usually after a crash or a
          registry-cleanup bug, not a normal state. They don&apos;t show up in the table above, but their working
          directory is read straight from the process, so you can still tell which project each one belongs to.
        </p>
      )}

      {sectionExpanded && notice && <p className="mb-3 text-xs text-zinc-300">{notice}</p>}

      {sectionExpanded && data.unregistered.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider">
                <th className="px-3 py-2">PID</th>
                <th className="px-3 py-2">Working directory</th>
                <th className="px-3 py-2">Executable</th>
                <th className="px-3 py-2 text-right">RAM</th>
                <th className="px-3 py-2 text-right">Paged</th>
                <th className="px-3 py-2 text-right">Age</th>
                <th className="px-3 py-2 text-right">Last activity</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.unregistered.map((p) => (
                <tr key={p.pid} className="border-t border-zinc-800 hover:bg-zinc-800/50 transition-colors">
                  <td className="px-3 py-2.5 font-mono text-zinc-500 text-xs">{p.pid}</td>
                  <td className="px-3 py-2.5 font-mono text-xs" title={p.cwd ?? undefined}>
                    {p.cwd ? (
                      <span className="text-zinc-300">{folderName(p.cwd)}</span>
                    ) : (
                      <span className="text-zinc-600 italic">unknown</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-zinc-400" title={p.path}>
                    {shortPath(p.path)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-emerald-400">
                    {fmtBytes(p.memoryBytes)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-amber-400">
                    {fmtBytes(p.pagedBytes)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-zinc-400">{fmtAge(p.ageMs)}</td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums text-xs ${idleColor(p.lastActivityAt ? Date.now() - new Date(p.lastActivityAt).getTime() : null)}`}
                    title={
                      p.lastActivityAt
                        ? `Newest transcript in this project folder: ${new Date(p.lastActivityAt).toLocaleString()} (best effort — no session id to pin this to exactly this process)`
                        : "No transcript activity found for this working directory"
                    }
                  >
                    {p.lastActivityAt ? fmtAge(Date.now() - new Date(p.lastActivityAt).getTime()) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={() => kill(p.pid)}
                      disabled={killingPids.has(p.pid)}
                      className="text-[10px] px-1.5 py-px rounded border border-zinc-700 text-zinc-500 hover:text-rose-300 hover:border-rose-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                      title="Kill this claude.exe process"
                    >
                      {killingPids.has(p.pid) ? "Killing…" : "Kill"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
