"use client";

import { useEffect, useState, useRef } from "react";
import type { TokenUsage, UsageLimitWindow } from "@/app/api/token-usage/route";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

function formatTimeRemaining(resetsAt: string | null): string {
  if (!resetsAt) return "";
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m > 0 ? `${m}m` : ""}` : `${m}m`;
}

function WindowBar({ label, window: w }: { label: string; window: UsageLimitWindow }) {
  const pct = Math.min(100, Math.max(0, Math.round(w.utilization)));
  const color =
    pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-blue-500";
  const timeLeft = formatTimeRemaining(w.resets_at);

  return (
    <div className="flex items-center gap-1.5" title={timeLeft ? `resets in ${timeLeft}` : undefined}>
      <span className="text-zinc-500 text-xs tabular-nums w-5 shrink-0">{label}</span>
      <div className="w-16 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-zinc-400 text-xs tabular-nums">{pct}%</span>
      {timeLeft && (
        <span className="text-zinc-600 text-xs tabular-nums hidden sm:inline">{timeLeft}</span>
      )}
    </div>
  );
}

export function TokenUsageBadge() {
  const [usage, setUsage] = useState<TokenUsage | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchUsage() {
    try {
      const res = await fetch("/api/token-usage");
      if (res.ok) {
        const data: TokenUsage = await res.json();
        setUsage(data);

        // Schedule next fetch at reset time if available, otherwise in 5 min
        const nextWindow = data.five_hour ?? data.seven_day;
        if (nextWindow?.resets_at) {
          const msUntilReset = new Date(nextWindow.resets_at).getTime() - Date.now();
          const delay = Math.max(30_000, Math.min(msUntilReset + 5000, POLL_INTERVAL_MS));
          timerRef.current = setTimeout(fetchUsage, delay);
          return;
        }
      }
    } catch {
      // ignore
    }
    timerRef.current = setTimeout(fetchUsage, POLL_INTERVAL_MS);
  }

  useEffect(() => {
    fetchUsage();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!usage) return null;

  const windows: { label: string; window: UsageLimitWindow }[] = [];
  if (usage.five_hour) windows.push({ label: "5h", window: usage.five_hour });
  if (usage.seven_day) windows.push({ label: "7d", window: usage.seven_day });
  if (usage.seven_day_sonnet) windows.push({ label: "7dS", window: usage.seven_day_sonnet });

  if (windows.length === 0) return null;

  return (
    <div className="flex items-center gap-3 ml-auto">
      {windows.map(({ label, window: w }) => (
        <WindowBar key={label} label={label} window={w} />
      ))}
    </div>
  );
}
