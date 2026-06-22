"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ProjectInfo } from "@/app/lib/dashboard";

interface Props {
  projects: ProjectInfo[];
  selectedSlugs: string[];
  onSelectedChange: (slugs: string[]) => void;
  unreadCounts?: Record<string, number>;
}

/** Last two path segments, for a compact trigger label. */
function shortLabel(displayPath: string): string {
  const parts = displayPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.slice(-2).join("/") || displayPath;
}

export function ProjectFilter({ projects, selectedSlugs, onSelectedChange, unreadCounts }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on click-outside and Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the search box when opening.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.displayPath.toLowerCase().includes(q));
  }, [projects, query]);

  const selected = new Set(selectedSlugs);

  const triggerLabel =
    selectedSlugs.length === 0
      ? "All"
      : selectedSlugs.length === 1
        ? shortLabel(projects.find((p) => p.slug === selectedSlugs[0])?.displayPath ?? selectedSlugs[0])
        : `${selectedSlugs.length} selected`;

  function toggle(slug: string) {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onSelectedChange([...next]);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 text-sm font-medium transition-colors ${
          selectedSlugs.length > 0 ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
        }`}
      >
        <span className="text-zinc-500">Projects:</span>
        <span className="font-mono">{triggerLabel}</span>
        {selectedSlugs.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelectedChange([]);
            }}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Clear filter"
          >
            ✕
          </span>
        )}
        <span className="text-zinc-600 text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-80 max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
          <div className="p-2 border-b border-zinc-800">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type to filter…"
              className="w-full px-2 py-1.5 rounded-md bg-zinc-950 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:ring-1 focus:ring-zinc-600"
            />
          </div>

          {selectedSlugs.length > 0 && (
            <button
              onClick={() => onSelectedChange([])}
              className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors border-b border-zinc-800"
            >
              <span>Clear all</span>
              <span className="text-zinc-500">({selectedSlugs.length}) ✕</span>
            </button>
          )}

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-3 text-sm text-zinc-600">No projects match.</div>
            ) : (
              filtered.map((p) => {
                const isSel = selected.has(p.slug);
                return (
                  <button
                    key={p.slug}
                    onClick={() => toggle(p.slug)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800 transition-colors"
                  >
                    <span
                      className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                        isSel
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-zinc-600 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="flex-1 min-w-0 font-mono text-xs text-zinc-200 truncate" title={p.displayPath}>
                      {p.displayPath}
                    </span>
                    {unreadCounts?.[p.slug] ? (
                      <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-900 text-blue-400">
                        {unreadCounts[p.slug]}
                      </span>
                    ) : null}
                    <span className="shrink-0 text-xs text-zinc-600">{p.sessionCount}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
