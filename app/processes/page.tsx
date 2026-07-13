"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardNav } from "@/app/components/DashboardNav";
import type { ActiveSession } from "@/app/api/active-sessions/route";

const POLL_INTERVAL_MS = 2 * 60 * 1000;

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function fmtUptime(startedAt: number): string {
  const delta = Date.now() - startedAt;
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export default function ProcessesPage() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    fetch("/api/active-sessions")
      .then((r) => r.json())
      .then((data: ActiveSession[]) => setSessions(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  const copyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  const withMemory = sessions?.filter((s) => s.memoryBytes != null) ?? [];
  const totalRam = withMemory.reduce((sum, s) => sum + (s.memoryBytes ?? 0), 0);
  const totalPaged = withMemory.reduce((sum, s) => sum + (s.pagedMemoryBytes ?? 0), 0);

  const titleFromSession = (s: ActiveSession): string => {
    if (s.title && s.title.length > 0) return s.title;
    if (s.name && /^[A-Za-z][A-Za-z0-9 -]{7,}$/.test(s.name) && !/^[a-z0-9]+-[a-z0-9]+$/i.test(s.name)) {
      return s.name;
    }
    // Fallback: last segment of cwd, with path separators normalized
    const parts = s.cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || s.cwd;
  };

  return (
    <div className="w-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl w-full mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center gap-2 md:block">
            <DashboardNav
              projects={[]}
              selectedSlugs={[]}
              onSelectedChange={() => {}}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between w-full gap-3">
                <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 shrink-0">
                  Active Processes
                  {sessions !== null && (
                    <span className="ml-2 normal-case font-normal text-zinc-400">
                      {sessions.length} process{sessions.length === 1 ? "" : "es"}
                    </span>
                  )}
                </h2>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl w-full mx-auto px-4 py-4">
        {sessions === null ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="text-zinc-500 text-sm">No active Claude Code processes found.</p>
        ) : (
          <>
            {/* Summary bar */}
            {withMemory.length > 0 && (
              <div className="flex items-center gap-4 mb-4 px-4 py-3 rounded-lg bg-zinc-900 border border-zinc-800 text-sm">
                <span className="text-zinc-400">
                  <span className="text-zinc-200 font-semibold">{withMemory.length}</span> process{withMemory.length === 1 ? "" : "es"} with memory data
                </span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400">
                  Total RAM: <span className="text-emerald-400 font-semibold">{fmtBytes(totalRam)}</span>
                </span>
                <span className="text-zinc-600">·</span>
                <span className="text-zinc-400">
                  Total paged: <span className="text-amber-400 font-semibold">{fmtBytes(totalPaged)}</span>
                </span>
              </div>
            )}

            {/* Process table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider">
                    <th className="px-3 py-2">PID</th>
                    <th className="px-3 py-2">Session</th>
                    <th className="px-3 py-2">Working directory</th>
                    <th className="px-3 py-2 text-right">RAM</th>
                    <th className="px-3 py-2 text-right">Paged</th>
                    <th className="px-3 py-2 text-right">Uptime</th>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Entry</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const hasMem = s.memoryBytes != null;
                    const sessionTitle = titleFromSession(s);
                    const titleIsFallback = !s.title && !s.name;
                    const sessionIdShort = s.sessionId.slice(0, 8);
                    return (
                      <tr
                        key={s.sessionId}
                        className="border-t border-zinc-800 hover:bg-zinc-800/50 transition-colors group"
                      >
                        <td className="px-3 py-2.5 font-mono text-zinc-500 text-xs">
                          {s.pid}
                        </td>
                        <td className="px-3 py-2.5 min-w-[220px]">
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/projects/${encodeURIComponent(s.projectSlug)}/sessions/${encodeURIComponent(s.sessionId)}?from=processes`}
                              className={`truncate max-w-[220px] block text-xs font-medium hover:underline ${
                                titleIsFallback ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-200 hover:text-white"
                              }`}
                              title={`Session: ${s.sessionId}`}
                            >
                              {sessionTitle}
                            </Link>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] text-zinc-500 select-all" title={s.sessionId}>
                                {sessionIdShort}…
                              </span>
                              <button
                                onClick={() => copyId(s.sessionId)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] px-1 py-px rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-500 transition-colors shrink-0"
                                title="Copy full session ID"
                              >
                                {copied === s.sessionId ? "✓" : "Copy"}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-zinc-400 truncate max-w-[300px] block" title={s.cwd}>
                            {s.cwd}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {hasMem ? (
                            <span className="text-emerald-400">{fmtBytes(s.memoryBytes!)}</span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {s.pagedMemoryBytes != null ? (
                            <span className="text-amber-400">{fmtBytes(s.pagedMemoryBytes)}</span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-400 text-xs">
                          {fmtUptime(s.startedAt)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">
                          {s.version}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-zinc-400">
                          {s.entrypoint}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}