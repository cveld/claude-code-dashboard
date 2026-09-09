"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardNav } from "@/app/components/DashboardNav";
import { StrayProcesses } from "@/app/components/StrayProcesses";
import { UnregisteredClaudeProcesses } from "@/app/components/UnregisteredClaudeProcesses";
import { useDataRefresh, type SessionEvent } from "@/app/lib/useDataRefresh";
import type { ActiveSession } from "@/app/api/active-sessions/route";
import type { KillSessionResult } from "@/app/api/active-sessions/kill/route";

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const IDLE_AMBER_MS = 5 * 60_000;
const IDLE_ROSE_MS = 30 * 60_000;

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function fmtUptime(startedAt: number): string {
  return fmtDuration(Date.now() - startedAt);
}

// Time since the last user/assistant turn in the transcript — a proxy for
// "is anyone still waiting on this", not a live idle signal from the CLI itself.
function idleMs(lastMessageAt?: string): number | null {
  if (!lastMessageAt) return null;
  return Math.max(0, Date.now() - new Date(lastMessageAt).getTime());
}

function idleColor(ms: number | null): string {
  if (ms === null) return "text-zinc-600";
  if (ms > IDLE_ROSE_MS) return "text-rose-400";
  if (ms > IDLE_AMBER_MS) return "text-amber-400";
  return "text-zinc-400";
}

export default function ProcessesPage() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [strayCount, setStrayCount] = useState(0);
  const [unregisteredCount, setUnregisteredCount] = useState(0);
  const [sessionsExpanded, setSessionsExpanded] = useState(true);
  const [killingPids, setKillingPids] = useState<Set<number>>(new Set());
  const [killNotice, setKillNotice] = useState<string | null>(null);

  const scrollToStray = useCallback(() => {
    document.getElementById("stray-git-helpers")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const scrollToUnregistered = useCallback(() => {
    document.getElementById("unregistered-claude-processes")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const fetchData = useCallback(() => {
    return fetch("/api/active-sessions")
      .then((r) => r.json())
      .then((data: ActiveSession[]) => setSessions(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  // SSE fast-path: a session file appearing/disappearing patches just that one
  // row instead of waiting up to POLL_INTERVAL_MS for a full list re-download.
  const handleSessionEvent = useCallback((event: SessionEvent) => {
    if (event.type === "removed") {
      setSessions((prev) => prev?.filter((s) => s.pid !== event.pid) ?? prev);
      return;
    }
    fetch(`/api/active-sessions/${event.pid}`)
      .then((r) => (r.ok ? (r.json() as Promise<ActiveSession>) : null))
      .then((session) => {
        if (!session) return;
        setSessions((prev) => {
          const others = (prev ?? []).filter((s) => s.pid !== session.pid);
          return [...others, session].sort((a, b) => b.startedAt - a.startedAt);
        });
      })
      .catch(() => {});
  }, []);

  useDataRefresh(() => {}, undefined, handleSessionEvent);

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

  const killSession = useCallback(
    async (s: ActiveSession) => {
      const label = titleFromSession(s);
      if (!window.confirm(`Kill Claude Code process ${s.pid} (${label})?\n\nThis ends the session immediately — any in-flight tool call is aborted.`)) {
        return;
      }
      setKillingPids((prev) => new Set(prev).add(s.pid));
      setKillNotice(null);
      try {
        const res = await fetch("/api/active-sessions/kill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pid: s.pid }),
        });
        const result = (await res.json()) as KillSessionResult;
        setKillNotice(result.killed ? `Killed process ${s.pid}.` : `Could not kill ${s.pid}: ${result.error ?? "unknown error"}`);
      } catch {
        setKillNotice(`Kill request for ${s.pid} failed.`);
      } finally {
        // Keep showing "Killing…" until the refresh lands, so a successful
        // kill goes straight from "Killing…" to the row disappearing —
        // never flashes back to a clickable "Kill" first.
        await fetchData();
        setKillingPids((prev) => {
          const next = new Set(prev);
          next.delete(s.pid);
          return next;
        });
      }
    },
    [fetchData]
  );

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
                  Active Claude Code processes
                  {sessions !== null && (
                    <span className="ml-2 normal-case font-normal text-zinc-400">
                      {sessions.length} process{sessions.length === 1 ? "" : "es"}
                    </span>
                  )}
                  {strayCount > 0 && (
                    <button
                      onClick={scrollToStray}
                      className="ml-2 normal-case font-normal text-rose-400 hover:underline"
                    >
                      {strayCount} stray git helper{strayCount === 1 ? "" : "s"}
                    </button>
                  )}
                  {unregisteredCount > 0 && (
                    <button
                      onClick={scrollToUnregistered}
                      className="ml-2 normal-case font-normal text-amber-400 hover:underline"
                    >
                      {unregisteredCount} unregistered claude.exe
                    </button>
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
            {/* Process table */}
            <button
              onClick={() => setSessionsExpanded((v) => !v)}
              className="flex items-center gap-2 mb-2"
              aria-expanded={sessionsExpanded}
            >
              <span className="text-zinc-500 text-xs">{sessionsExpanded ? "▾" : "▸"}</span>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Claude Code processes
              </h2>
              <span className="text-xs text-zinc-600">({sessions.length})</span>
            </button>

            {sessionsExpanded && killNotice && (
              <p className="mb-3 text-xs text-zinc-300">{killNotice}</p>
            )}

            {sessionsExpanded && (
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
                    <th className="px-3 py-2 text-right">Idle</th>
                    <th className="px-3 py-2">Version</th>
                    <th className="px-3 py-2">Entry</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => {
                    const hasMem = s.memoryBytes != null;
                    const sessionTitle = titleFromSession(s);
                    const titleIsFallback = !s.title && !s.name;
                    return (
                      <tr
                        key={s.sessionId}
                        className="border-t border-zinc-800 hover:bg-zinc-800/50 transition-colors group"
                      >
                        <td className="px-3 py-2.5 font-mono text-zinc-500 text-xs">
                          {s.pid}
                        </td>
                        <td className="px-3 py-2.5 min-w-[320px]">
                          <div className="flex flex-col gap-0.5">
                            <Link
                              href={`/projects/${encodeURIComponent(s.projectSlug)}/sessions/${encodeURIComponent(s.sessionId)}?from=processes`}
                              className={`truncate max-w-[300px] block text-xs font-medium hover:underline ${
                                titleIsFallback ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-200 hover:text-white"
                              }`}
                              title={`Session: ${s.sessionId}`}
                            >
                              {sessionTitle}
                            </Link>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] text-zinc-500 select-all whitespace-nowrap" title={s.sessionId}>
                                {s.sessionId}
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
                        <td
                          className={`px-3 py-2.5 text-right tabular-nums text-xs ${idleColor(idleMs(s.lastMessageAt))}`}
                          title={s.lastMessageAt ? `Last transcript activity: ${new Date(s.lastMessageAt).toLocaleString()}` : "No transcript activity recorded yet"}
                        >
                          {(() => {
                            const ms = idleMs(s.lastMessageAt);
                            return ms === null ? "—" : fmtDuration(ms);
                          })()}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-zinc-500">
                          {s.version}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-zinc-400">
                          {s.entrypoint}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => killSession(s)}
                            disabled={killingPids.has(s.pid)}
                            className="text-[10px] px-1.5 py-px rounded border border-zinc-700 text-zinc-500 hover:text-rose-300 hover:border-rose-800 disabled:opacity-50 transition-colors whitespace-nowrap"
                            title="Kill this Claude Code process"
                          >
                            {killingPids.has(s.pid) ? "Killing…" : "Kill"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
                </div>
              </>
            )}
          </>
        )}

        <UnregisteredClaudeProcesses onCountChange={setUnregisteredCount} />
        <StrayProcesses onCountChange={setStrayCount} />
      </div>
    </div>
  );
}