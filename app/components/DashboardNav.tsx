"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectInfo, topSegment } from "@/app/lib/dashboard";

interface Props {
  projects: ProjectInfo[];
  unreadCount?: number;
  projectFilter: string;
  onFilterChange: (f: string) => void;
}

export function DashboardNav({ projects, unreadCount, projectFilter, onFilterChange }: Props) {
  const pathname = usePathname();

  const rootSegments = Array.from(
    new Set(projects.map((p) => topSegment(p.displayPath)))
  ).sort();

  return (
    <div className="flex flex-wrap items-center gap-4 mb-8">
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
      </div>

      {rootSegments.length > 1 && (
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
          <button
            onClick={() => onFilterChange("all")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              projectFilter === "all" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            All
          </button>
          {rootSegments.map((seg) => (
            <button
              key={seg}
              onClick={() => onFilterChange(seg === projectFilter ? "all" : seg)}
              className={`px-3 py-1.5 rounded-md text-sm font-mono transition-colors ${
                projectFilter === seg ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {seg}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
