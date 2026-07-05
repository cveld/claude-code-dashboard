"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { ProjectInfo } from "@/app/lib/dashboard";
import { ProjectFilter } from "./ProjectFilter";
import { TokenUsageBadge } from "./TokenUsageBadge";
import { MobileNavDrawer } from "./MobileNavDrawer";

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
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Mobile: hamburger button only */}
      <div className="flex items-center md:hidden shrink-0">
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className={`p-1.5 rounded-md transition-colors ${drawerOpen ? "text-zinc-200 bg-zinc-800" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"}`}
          aria-label={drawerOpen ? "Close navigation menu" : "Open navigation menu"}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            {/* transformOrigin must be each line's own centre so translate+rotate converge at (9,9) */}
            <line
              x1="2" y1="4.5" x2="16" y2="4.5"
              style={{
                transformOrigin: "9px 4.5px",
                transform: drawerOpen ? "translateY(4.5px) rotate(45deg)" : "none",
                transition: "transform 0.25s ease",
              }}
            />
            <line
              x1="2" y1="9" x2="16" y2="9"
              style={{
                opacity: drawerOpen ? 0 : 1,
                transition: "opacity 0.15s ease",
              }}
            />
            <line
              x1="2" y1="13.5" x2="16" y2="13.5"
              style={{
                transformOrigin: "9px 13.5px",
                transform: drawerOpen ? "translateY(-4.5px) rotate(-45deg)" : "none",
                transition: "transform 0.25s ease",
              }}
            />
          </svg>
        </button>
        <MobileNavDrawer
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          projects={projects}
          selectedSlugs={selectedSlugs}
          onSelectedChange={onSelectedChange}
          unreadCount={unreadCount}
          unreadCounts={unreadCounts}
          refreshCount={refreshCount}
        />
      </div>

      {/* Desktop: full nav bar */}
      <div className="hidden md:flex flex-wrap items-center gap-4 mb-2 w-full">
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
    </>
  );
}
