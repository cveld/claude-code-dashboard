"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { DashboardNav } from "./components/DashboardNav";
import {
  ProjectInfo,
  IdeWindow,
  timeAgo,
  topSegment,
  findIdeWindowForSlug,
} from "./lib/dashboard";
import { useDataRefresh } from "./lib/useDataRefresh";

export default function Home() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [readState, setReadState] = useState<Record<string, string>>({});
  const [ideWindows, setIdeWindows] = useState<IdeWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState("all");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => { setSortAsc(localStorage.getItem("sort-asc") === "true"); }, []);
  useEffect(() => { localStorage.setItem("sort-asc", String(sortAsc)); }, [sortAsc]);

  const loadData = useCallback(() => {
    Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/read-state").then((r) => r.json()),
      fetch("/api/ide-windows").then((r) => r.json()),
    ]).then(([p, rs, ide]) => {
      setProjects(p);
      setReadState(rs);
      setIdeWindows(ide);
      setLoading(false);
    });
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

  const visibleProjects = projects.filter(
    (p) => projectFilter === "all" || topSegment(p.displayPath) === projectFilter
  );
  const displayedProjects = sortAsc ? [...visibleProjects].reverse() : visibleProjects;

  return (
    <div className="max-w-5xl w-full mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-1 text-zinc-100">Claude Session Browser</h1>
      <p className="text-zinc-500 text-sm mb-6">All sessions stored in ~/.claude/projects</p>

      <DashboardNav
        projects={projects}
        projectFilter={projectFilter}
        onFilterChange={setProjectFilter}
      />

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Projects
            {visibleProjects.length !== projects.length && (
              <span className="ml-2 normal-case font-normal text-zinc-600">
                {visibleProjects.length} of {projects.length}
              </span>
            )}
          </h2>
          <button
            onClick={() => setSortAsc((a) => !a)}
            className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
          >
            {sortAsc ? "↑ Oldest first" : "↓ Newest first"}
          </button>
        </div>
        {loading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
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
  );
}
