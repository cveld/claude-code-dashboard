"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ActiveSession } from "@/app/api/active-sessions/route";

// RAM footprint changes slowly and each poll spawns a PowerShell process on
// the server, so this polls far less often than the SSE-driven session data.
const POLL_INTERVAL_MS = 2 * 60 * 1000;

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

export function MemoryUsageBadge() {
  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      fetch("/api/active-sessions")
        .then((r) => r.json())
        .then((data: ActiveSession[]) => {
          if (!cancelled) setSessions(data);
        })
        .catch(() => {});
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!sessions) return null;
  const withMemory = sessions.filter((s) => s.memoryBytes != null);
  const totalActive = sessions.length;
  if (totalActive === 0) return null;

  const total = withMemory.reduce((sum, s) => sum + (s.memoryBytes ?? 0), 0);
  const totalPaged = withMemory.reduce((sum, s) => sum + (s.pagedMemoryBytes ?? 0), 0);
  const tooltip = withMemory.length > 0
    ? [
        `Total paged: ${fmtBytes(totalPaged)}`,
        "",
        ...withMemory.map(
          (s) => `${s.cwd} (pid ${s.pid}): ${fmtBytes(s.memoryBytes ?? 0)} RAM, ${fmtBytes(s.pagedMemoryBytes ?? 0)} paged`
        ),
      ].join("\n")
    : `${totalActive} active process${totalActive === 1 ? "" : "es"} — no memory data available`;

  return (
    <Link href="/processes" className="flex items-center gap-1.5 text-xs text-zinc-500 tabular-nums hover:text-zinc-300 transition-colors" title={tooltip}>
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      {totalActive} session{totalActive === 1 ? "" : "s"}{withMemory.length > 0 ? ` · ${fmtBytes(total)} RAM · ${fmtBytes(totalPaged)} paged` : ""}
    </Link>
  );
}
