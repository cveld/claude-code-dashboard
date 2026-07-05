"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ProjectInfo } from "@/app/lib/dashboard";
import { ProjectFilter } from "./ProjectFilter";
import { TokenUsageBadge } from "./TokenUsageBadge";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projects: ProjectInfo[];
  selectedSlugs: string[];
  onSelectedChange: (slugs: string[]) => void;
  unreadCount?: number;
  unreadCounts?: Record<string, number>;
  refreshCount?: number;
}

export function MobileNavDrawer({
  isOpen,
  onClose,
  projects,
  selectedSlugs,
  onSelectedChange,
  unreadCount,
  unreadCounts,
  refreshCount,
}: Props) {
  const pathname = usePathname();

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Overlay — starts below the header so the hamburger stays visible */}
      <div data-testid="drawer-overlay" className="fixed inset-x-0 bottom-0 top-[52px] bg-black/60 z-40" onClick={onClose} />

      {/* Drawer panel — also starts below the header */}
      <div className="fixed top-[52px] left-0 bottom-0 w-64 bg-zinc-900 border-r border-zinc-800 z-50 flex flex-col">
        <nav className="flex flex-col gap-1 p-3">
          <Link
            href="/"
            onClick={onClose}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === "/" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            Projects
          </Link>
          <Link
            href="/sessions"
            onClick={onClose}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              pathname === "/sessions" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            Sessions
            {unreadCount != null && unreadCount > 0 && (
              <span className="text-xs text-blue-400">{unreadCount}</span>
            )}
          </Link>
          <Link
            href="/settings"
            onClick={onClose}
            className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
              pathname === "/settings" ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            }`}
          >
            Settings
          </Link>
        </nav>

        {projects.length > 1 && (
          <div className="px-3 py-2 border-t border-zinc-800">
            <ProjectFilter
              projects={projects}
              selectedSlugs={selectedSlugs}
              onSelectedChange={onSelectedChange}
              unreadCounts={unreadCounts}
            />
          </div>
        )}

        <div className="px-3 py-2 border-t border-zinc-800">
          <TokenUsageBadge />
        </div>

        {refreshCount !== undefined && refreshCount > 0 && (
          <div className="px-4 py-2">
            <span className="text-xs text-zinc-600">↺ {refreshCount} refresh{refreshCount === 1 ? "" : "es"}</span>
          </div>
        )}
      </div>
    </>
  );
}
