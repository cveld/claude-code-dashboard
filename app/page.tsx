"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardNav } from "./components/DashboardNav";
import { MemoryUsageBadge } from "./components/MemoryUsageBadge";
import { ListSkeleton } from "./components/ListSkeleton";
import {
  ProjectInfo,
  SessionWithProject,
  IdeWindow,
  timeAgo,
  isUnread,
  findIdeWindowForSlug,
} from "./lib/dashboard";
import { useDataRefresh, type ChangeEvent } from "./lib/useDataRefresh";

export default function Home() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sessions, setSessions] = useState<SessionWithProject[]>([]);
  const [readState, setReadState] = useState<Record<string, string>>({});
  const [ideWindows, setIdeWindows] = useState<IdeWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [sortAsc, setSortAsc] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => { setSortAsc(localStorage.getItem("sort-asc") === "true"); }, []);
  useEffect(() => { localStorage.setItem("sort-asc", String(sortAsc)); }, [sortAsc]);

  const loadData = useCallback((change?: ChangeEvent) => {
    const isInitial = change === undefined;
    if (!isInitial) setRefreshCount((c) => c + 1);

    const sessionUrl = change?.slug
      ? `/api/sessions?limit=500&project=${encodeURIComponent(change.slug)}`
      : "/api/sessions?limit=500";

    const promises: Promise<unknown>[] = [
      fetch("/api/projects").then((r) => r.json()),
      fetch(sessionUrl).then((r) => r.json()),
    ];
    if (isInitial) {
      promises.push(fetch("/api/read-state").then((r) => r.json()));
      promises.push(fetch("/api/ide-windows").then((r) => r.json()));
    }

    Promise.all(promises).then((results) => {
      const [p, s] = results as [ProjectInfo[], SessionWithProject[]];
      const rs = isInitial ? (results[2] as Record<string, string>) : undefined;
      const ide = isInitial ? (results[3] as IdeWindow[]) : undefined;

      setProjects(p);
      if (change?.slug) {
        setSessions((prev) => {
          const others = prev.filter((sess) => sess.projectSlug !== change.slug);
          return [...others, ...(Array.isArray(s) ? s : [])].sort(
            (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
          );
        });
      } else {
        setSessions(s);
      }
      if (rs !== undefined) setReadState(rs);
      if (ide !== undefined) setIdeWindows(ide);
      setLoading(false);
    });
  }, []);

  // Poll ide-windows separately — they don't change due to session writes
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/ide-windows")
        .then((r) => r.json())
        .then((ide) => setIdeWindows(ide));
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useDataRefresh(loadData);

  const focusIde = useCallback((ideWindow: IdeWindow) => {
    fetch("/api/ide-windows/open-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: ideWindow.port, filePath: ideWindow.workspaceFolders[0] }),
    });
  }, []);

  const markProject = useCallback((slug: string, asUnread: boolean) => {
    setReadState((prev) => {
      const next = { ...prev };
      if (asUnread) delete next[slug];
      else next[slug] = new Date().toISOString();
      return next;
    });
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(asUnread ? { slug, unread: true } : { slug }),
    });
  }, []);

  const unreadCountsPerProject: Record<string, number> = {};
  for (const s of sessions) {
    if (isUnread(s, readState)) {
      unreadCountsPerProject[s.projectSlug] = (unreadCountsPerProject[s.projectSlug] || 0) + 1;
    }
  }

  const visibleProjects = projects.filter(
    (p) => selectedSlugs.length === 0 || selectedSlugs.includes(p.slug)
  );
  const displayedProjects = sortAsc ? [...visibleProjects].reverse() : visibleProjects;

  return (
    <div className="w-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl w-full mx-auto px-4 pt-3 pb-2">
          {/* Mobile: single row (hamburger + controls). Desktop: two rows (nav + controls). */}
          <div className="flex items-center gap-2 md:block">
            <DashboardNav
              projects={projects}
              unreadCounts={unreadCountsPerProject}
              selectedSlugs={selectedSlugs}
              onSelectedChange={setSelectedSlugs}
              refreshCount={refreshCount}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between w-full gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 shrink-0">
                    Projects
                    {visibleProjects.length !== projects.length && (
                      <span className="ml-2 normal-case font-normal text-zinc-600">
                        {visibleProjects.length} of {projects.length}
                      </span>
                    )}
                  </h2>
                  <MemoryUsageBadge />
                </div>
                <button
                  onClick={() => setSortAsc((a) => !a)}
                  className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                >
                  {sortAsc ? "↑ Oldest first" : "↓ Newest first"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div>
      <div className="max-w-5xl w-full mx-auto px-4 py-4">
      <section>
        {loading ? (
          <ListSkeleton />
        ) : visibleProjects.length === 0 ? (
          <p className="text-zinc-500 text-sm">No projects match the current filter.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {displayedProjects.map((p) => {
              const ideWindow = findIdeWindowForSlug(p.slug, ideWindows);
              const unread = !!(p.lastActivity && (!readState[p.slug] || p.lastActivity > readState[p.slug]));
              return (
                <div
                  key={p.slug}
                  className="flex items-center gap-4 px-4 py-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 transition-colors group"
                >
                  <Link
                    href={`/projects/${encodeURIComponent(p.slug)}`}
                    className="flex-1 min-w-0 flex items-center gap-2"
                  >
                    {unread && (
                      <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-mono text-sm text-zinc-200 truncate group-hover:text-white">
                        {p.displayPath}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5">{p.slug}</div>
                    </div>
                  </Link>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => markProject(p.slug, !unread)}
                      className="opacity-0 group-hover:opacity-100 text-xs px-2 py-0.5 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-400 transition-colors"
                    >
                      {unread ? "Mark read" : "Mark unread"}
                    </button>
                    {ideWindow && (
                      <button
                        onClick={() => focusIde(ideWindow)}
                        title={`Bring ${ideWindow.ideName} to foreground`}
                        className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-950 text-blue-400 hover:bg-blue-900 hover:text-blue-300 transition-colors"
                      >
                        VS
                      </button>
                    )}
                    <div className="text-right">
                      <div className="text-sm text-zinc-400">{p.sessionCount} sessions</div>
                      {p.lastActivity && (
                        <div className="text-xs text-zinc-600">{timeAgo(p.lastActivity)}</div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
      </div>
    </div>
  );
}
