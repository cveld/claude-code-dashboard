"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectInfo } from "@/app/lib/dashboard";
import { ProjectFilter } from "./ProjectFilter";
import { TokenUsageBadge } from "./TokenUsageBadge";

interface Props {
  projects: ProjectInfo[];
  unreadCount?: number;
  unreadCounts?: Record<string, number>;
  selectedSlugs: string[];
  onSelectedChange: (slugs: string[]) => void;
  refreshCount?: number;
}

export function DashboardNav({ projects, unreadCount, unreadCounts, selectedSlugs, onSelectedChange, refreshCount }: Props) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-4 mb-2 w-full">
      <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
        <Link
          href="/"
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            pathname === "/" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Projects
        </Link>
        <Link
          href="/sessions"
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
            pathname === "/sessions" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Sessions
          {unreadCount != null && unreadCount > 0 && (
            <span className="text-xs text-blue-400">{unreadCount}</span>
          )}
        </Link>
        <Link
          href="/settings"
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            pathname === "/settings" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Settings
        </Link>
        {refreshCount !== undefined && refreshCount > 0 && (
          <span className="relative group px-2 py-1 text-xs text-zinc-600 tabular-nums cursor-default">
            ↺ {refreshCount}
            <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-max max-w-[200px] rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-50 text-center">
              {refreshCount} live data refresh{refreshCount === 1 ? "" : "es"} since page load
            </span>
          </span>
        )}
      </div>

      {projects.length > 1 && (
        <ProjectFilter
          projects={projects}
          selectedSlugs={selectedSlugs}
          onSelectedChange={onSelectedChange}
          unreadCounts={unreadCounts}
        />
      )}
      <TokenUsageBadge />
    </div>
  );
}
