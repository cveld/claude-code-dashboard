"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useCallback, useRef, useLayoutEffect, Suspense } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DashboardNav } from "../components/DashboardNav";
import { TranscriptPanel } from "../components/TranscriptPanel";
import {
  ProjectInfo,
  SessionWithProject,
  HookEvent,
  isUnread,
  timeAgo,
} from "../lib/dashboard";
import { BurnedTokensTooltip } from "../components/BurnedTokensTooltip";
import { MemoryUsageBadge } from "../components/MemoryUsageBadge";
import { ListSkeleton } from "../components/ListSkeleton";
import { useDataRefresh, type ChangeEvent } from "../lib/useDataRefresh";
import { buildMonitorToolCall } from "../lib/monitorToolCall";

const CONTEXT_WINDOW = 200000;

function contextBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface TailMessage {
  type: "user" | "assistant" | "system" | "other";
  text: string;
  timestamp: string | null;
}

function getTimeLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAY = 86400000;

  if (d >= startOfToday) return "Today";
  if (d >= new Date(startOfToday.getTime() - DAY)) return "Yesterday";
  if (d >= new Date(startOfToday.getTime() - 7 * DAY)) return "This week";
  if (d >= new Date(startOfToday.getTime() - 14 * DAY)) return "Last week";
  if (d >= new Date(startOfToday.getTime() - 30 * DAY)) return "This month";
  if (d >= new Date(startOfToday.getTime() - 60 * DAY)) return "Last month";
  const month = d.toLocaleString("en-US", { month: "long" });
  return d.getFullYear() === now.getFullYear() ? month : `${month} ${d.getFullYear()}`;
}

const FIXED_LABELS = ["Today", "Yesterday", "This week", "Last week", "This month", "Last month"];

function groupSessions(sessions: SessionWithProject[]): { label: string; sessions: SessionWithProject[] }[] {
  const now = new Date();
  const map = new Map<string, SessionWithProject[]>();
  for (const s of sessions) {
    const label = getTimeLabel(s.lastActivity, now);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(s);
  }

  const result: { label: string; sessions: SessionWithProject[] }[] = [];
  for (const label of FIXED_LABELS) {
    if (map.has(label)) {
      result.push({ label, sessions: map.get(label)! });
      map.delete(label);
    }
  }

  const rest = [...map.entries()].sort(
    (a, b) => new Date(b[1][0].lastActivity).getTime() - new Date(a[1][0].lastActivity).getTime()
  );
  for (const [label, sessions] of rest) {
    result.push({ label, sessions });
  }
  return result;
}

function IconCheck() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1,4 3,6 7,2" />
    </svg>
  );
}

function IconBell() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <path d="M4 0.5a.5.5 0 0 0-.5.5v.3A2.5 2.5 0 0 0 1.5 3.8V5.5l-.5.5v.5h6V6l-.5-.5V3.8A2.5 2.5 0 0 0 4.5 1.3V1A.5.5 0 0 0 4 .5zM3 7a1 1 0 0 0 2 0H3z"/>
    </svg>
  );
}

function IconQuestion() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.7 2.6a1.3 1.3 0 1 1 2.05 1.06c-.4.3-.75.6-.75 1.14v.2" />
      <circle cx="4" cy="6.6" r="0.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HookBadge({ type, read, tool }: { type: "stop" | "notification" | "permission"; read?: boolean; tool?: string }) {
  if (type === "stop") {
    return (
      <span
        title={read ? "Completed (read)" : "Completed (unread)"}
        className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${read ? "bg-zinc-500/20 text-zinc-500" : "bg-green-500/20 text-green-400"}`}
      >
        <IconCheck />
      </span>
    );
  }
  if (type === "permission") {
    return (
      <span
        title={tool ? `Permission needed: ${tool}` : "Permission needed"}
        className="w-4 h-4 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5 animate-pulse"
      >
        <IconQuestion />
      </span>
    );
  }
  return (
    <span title="Notification" className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
      <IconBell />
    </span>
  );
}

function IconList() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="2" y1="4" x2="12" y2="4"/>
      <line x1="2" y1="7" x2="12" y2="7"/>
      <line x1="2" y1="10" x2="12" y2="10"/>
    </svg>
  );
}

function IconSplit() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="2" width="5" height="10" rx="1"/>
      <rect x="8" y="2" width="5" height="10" rx="1"/>
    </svg>
  );
}


function SessionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSlug = searchParams.get("slug");
  const selectedId = searchParams.get("id");

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [sessions, setSessions] = useState<SessionWithProject[]>([]);
  const [readState, setReadState] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("sessions-unread-only") === "true";
    }
    return false;
  });
  const [sortAsc, setSortAsc] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("sort-asc") === "true"
  );
  const [layoutMode, setLayoutMode] = useState<"list" | "split">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("sessions-layout") as "list" | "split") ?? "list";
    }
    return "list";
  });
  useEffect(() => { localStorage.setItem("sort-asc", String(sortAsc)); }, [sortAsc]);
  useEffect(() => { localStorage.setItem("sessions-layout", layoutMode); }, [layoutMode]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [tailCache, setTailCache] = useState<Record<string, TailMessage[]>>({});
  const [tailErrors, setTailErrors] = useState<Set<string>>(new Set());
  const [tailSize, setTailSize] = useState<Record<string, number>>({});
  const [changedSessions, setChangedSessions] = useState<Set<string>>(new Set());
  const [hookNotifs, setHookNotifs] = useState<Record<string, HookEvent>>({});
  const [refreshCount, setRefreshCount] = useState(0);
  const [monitorActiveSessions, setMonitorActiveSessions] = useState<Set<string>>(new Set());
  const [sendModalSession, setSendModalSession] = useState<SessionWithProject | null>(null);
  const [sendMessage, setSendMessage] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const menuPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sessionStorage.setItem("sessions-unread-only", String(showUnreadOnly));
  }, [showUnreadOnly]);

  useEffect(() => {
    if (!openMenuKey) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const btnWrap = menuRefs.current.get(openMenuKey!);
      const panel = menuPanelRef.current;
      if ((!btnWrap || !btnWrap.contains(target)) && (!panel || !panel.contains(target))) {
        setOpenMenuKey(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuKey]);

  useEffect(() => {
    function pollMonitors() {
      fetch("/api/monitor-active-sessions")
        .then((r) => r.json())
        .then((ids: string[]) => setMonitorActiveSessions(new Set(ids)))
        .catch(() => {});
    }
    pollMonitors();
    const interval = setInterval(pollMonitors, 10000);
    return () => clearInterval(interval);
  }, []);

  const sessionsRef = useRef<SessionWithProject[]>([]);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const flipSnapshot = useRef<Map<string, DOMRect>>(new Map());

  useEffect(() => {
    if (changedSessions.size === 0) return;
    changedSessions.forEach((key) => {
      const el = itemRefs.current.get(key);
      if (!el) return;
      el.style.animation = "none";
      void el.offsetWidth;
      el.style.animation = "session-updated 1.8s ease-out forwards";
    });
    const timer = setTimeout(() => {
      changedSessions.forEach((key) => {
        const el = itemRefs.current.get(key);
        if (el) el.style.animation = "";
      });
    }, 1800);
    return () => clearTimeout(timer);
  }, [changedSessions]);

  useLayoutEffect(() => {
    const snap = flipSnapshot.current;
    flipSnapshot.current = new Map();
    if (snap.size === 0) return;

    itemRefs.current.forEach((el, key) => {
      if (!el?.isConnected) return;
      const oldRect = snap.get(key);
      if (!oldRect) return;
      const newRect = el.getBoundingClientRect();
      const deltaY = oldRect.top - newRect.top;
      if (Math.abs(deltaY) < 1) return;

      el.style.transition = "none";
      el.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "transform 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94)";
          el.style.transform = "";
          el.addEventListener("transitionend", () => {
            el.style.transition = "";
          }, { once: true });
        });
      });
    });
  }, [sessions]);

  function copyId(id: string) {
    navigator.clipboard.writeText(id);
    setToast("Session ID copied to clipboard");
    setTimeout(() => setToast(null), 2000);
  }

  const loadData = useCallback((change?: ChangeEvent) => {
    const isInitial = change === undefined;
    if (!isInitial) setRefreshCount((c) => c + 1);

    const sessionUrl = change?.slug
      ? `/api/sessions?project=${encodeURIComponent(change.slug)}`
      : "/api/sessions";

    const promises: Promise<unknown>[] = [
      fetch("/api/projects").then((r) => r.json()),
      fetch(sessionUrl).then((r) => r.json()),
    ];
    if (isInitial) {
      promises.push(fetch("/api/read-state").then((r) => r.json()));
      promises.push(fetch("/api/hook-events").then((r) => r.json()));
    }

    Promise.all(promises).then((results) => {
      const [p, newSessions] = results as [ProjectInfo[], SessionWithProject[]];
      const rs = isInitial ? (results[2] as Record<string, string>) : undefined;
      const persistedHooks = isInitial ? (results[3] as Record<string, HookEvent>) : undefined;

      const allSessions: SessionWithProject[] = change?.slug
        ? (() => {
            const others = sessionsRef.current.filter((s) => s.projectSlug !== change.slug);
            return [...others, ...(Array.isArray(newSessions) ? newSessions : [])].sort(
              (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
            );
          })()
        : (newSessions as SessionWithProject[]);

      const oldSessions = sessionsRef.current;
      if (oldSessions.length > 0) {
        const oldMap = new Map(oldSessions.map((o) => [`${o.projectSlug}/${o.id}`, o]));
        const changed = new Set<string>();
        for (const newS of allSessions) {
          const key = `${newS.projectSlug}/${newS.id}`;
          const old = oldMap.get(key);
          if (old && (old.lastActivity !== newS.lastActivity || old.messageCount !== newS.messageCount)) {
            changed.add(key);
          }
        }
        if (changed.size > 0) setChangedSessions(changed);
      }

      const snap = new Map<string, DOMRect>();
      itemRefs.current.forEach((el, key) => {
        if (el?.isConnected) snap.set(key, el.getBoundingClientRect());
      });
      flipSnapshot.current = snap;

      sessionsRef.current = allSessions;
      setProjects(p);
      setSessions(allSessions);
      if (rs !== undefined) setReadState(rs);
      if (persistedHooks !== undefined) setHookNotifs(persistedHooks);
      setLoading(false);
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleHookEvent = useCallback((event: HookEvent) => {
    const key = `${event.projectSlug}/${event.sessionId}`;
    setHookNotifs((prev) => ({ ...prev, [key]: event }));

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const body =
        event.type === "stop"
          ? `Klaar: ${event.title || event.projectSlug || "sessie"}`
          : event.type === "permission"
          ? `Toestemming vereist: ${event.tool || event.projectSlug || "tool"}`
          : event.message || "Aandacht nodig";
      new Notification("Claude Code", { body, silent: true });
    }
  }, []);

  useDataRefresh(loadData, handleHookEvent);

  useEffect(() => {
    if (!loading && layoutMode === "list") {
      const saved = sessionStorage.getItem("sessions-scroll-y");
      if (saved) {
        sessionStorage.removeItem("sessions-scroll-y");
        const y = parseInt(saved, 10);
        requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
      }
    }
  }, [loading, layoutMode]);

  const unreadCount = sessions.filter((s) => isUnread(s, readState)).length;

  const unreadCountsPerProject: Record<string, number> = {};
  for (const s of sessions) {
    if (isUnread(s, readState)) {
      unreadCountsPerProject[s.projectSlug] = (unreadCountsPerProject[s.projectSlug] || 0) + 1;
    }
  }

  const visibleSessions = sessions.filter(
    (s) =>
      (selectedSlugs.length === 0 || selectedSlugs.includes(s.projectSlug)) &&
      (!showUnreadOnly || isUnread(s, readState))
  );

  const rawGroups = groupSessions(visibleSessions);
  const groups = sortAsc
    ? rawGroups.reverse().map((g) => ({ ...g, sessions: [...g.sessions].reverse() }))
    : rawGroups;

  function toggleCollapse(label: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function fetchTail(key: string, slug: string, id: string, size: number) {
    fetch(`/api/projects/${encodeURIComponent(slug)}/sessions/${encodeURIComponent(id)}?tail=${size}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not-found"))))
      .then((data) => {
        setTailErrors((prev) => { if (!prev.has(key)) return prev; const next = new Set(prev); next.delete(key); return next; });
        setTailCache((prev) => ({ ...prev, [key]: data.messages ?? [] }));
      })
      .catch(() => setTailErrors((prev) => new Set(prev).add(key)));
  }

  function toggleTail(key: string, slug: string, id: string) {
    if (expandedSessions.has(key)) {
      setExpandedSessions((prev) => { const n = new Set(prev); n.delete(key); return n; });
    } else {
      setExpandedSessions((prev) => new Set([...prev, key]));
      const size = tailSize[key] ?? 5;
      if (!tailCache[key]) {
        fetchTail(key, slug, id, size);
      }
    }
  }

  function loadMoreTail(key: string, slug: string, id: string, totalMessages: number) {
    const current = tailSize[key] ?? 5;
    const next = Math.min(current + 10, totalMessages);
    setTailSize((prev) => ({ ...prev, [key]: next }));
    fetchTail(key, slug, id, next);
  }

  async function markSlugs(slugs: string[], unread: boolean) {
    await fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs, unread }),
    });
    setReadState((prev) => {
      const next = { ...prev };
      const now = new Date().toISOString();
      for (const slug of slugs) {
        if (unread) delete next[slug];
        else next[slug] = now;
      }
      return next;
    });
  }

  function markGroup(groupSessions: SessionWithProject[], unread: boolean) {
    return markSlugs(groupSessions.map((s) => `${s.projectSlug}/${s.id}`), unread);
  }

  function markSession(s: SessionWithProject, unread: boolean) {
    return markSlugs([`${s.projectSlug}/${s.id}`], unread);
  }

  function selectSession(s: SessionWithProject) {
    router.push(`/sessions?slug=${encodeURIComponent(s.projectSlug)}&id=${encodeURIComponent(s.id)}`);
  }

  function openSendModal(s: SessionWithProject) {
    setSendModalSession(s);
    setSendMessage("");
    setSendResult(null);
    setSendError(null);
  }

  function closeSendModal() {
    if (sendLoading) return;
    setSendModalSession(null);
  }

  async function handleSendMessage() {
    if (!sendModalSession || !sendMessage.trim() || sendLoading) return;
    setSendLoading(true);
    setSendResult(null);
    setSendError(null);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sendModalSession.id)}/send-message`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: sendMessage }),
        }
      );
      const data = await res.json();
      if (res.ok) {
        setSendResult("sent");
        setSendMessage("");
      } else {
        setSendError(data.error ?? "Failed to send message.");
      }
    } catch {
      setSendError("Network error.");
    } finally {
      setSendLoading(false);
    }
  }

  // Controls bar — shared between list and split mode
  const controlsBar = (
    <div className="flex items-center justify-between w-full gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 shrink-0">
          Sessions
          {!loading && (
            <span className="ml-2 normal-case font-normal text-zinc-600">
              {visibleSessions.length}
            </span>
          )}
        </h2>
        <MemoryUsageBadge />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setSortAsc((a) => !a)}
          title={sortAsc ? "Oldest first" : "Newest first"}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          {sortAsc ? "↑" : "↓"}
          <span className="hidden md:inline">{sortAsc ? " Oldest first" : " Newest first"}</span>
        </button>
        <div className="flex rounded-md overflow-hidden border border-zinc-700">
          <button
            onClick={() => setShowUnreadOnly(false)}
            className={`text-xs px-3 py-1 transition-colors ${
              !showUnreadOnly ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setShowUnreadOnly(true)}
            className={`text-xs px-3 py-1 transition-colors border-l border-zinc-700 ${
              showUnreadOnly ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Unread
          </button>
        </div>
        <button
          onClick={() => setLayoutMode(layoutMode === "list" ? "split" : "list")}
          title={layoutMode === "list" ? "Switch to split view" : "Switch to list view"}
          className="px-2 py-1 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          {layoutMode === "list" ? <IconSplit /> : <IconList />}
        </button>
      </div>
    </div>
  );

  // Session list — compact version for split mode left panel
  const splitSessionList = (
    <div className="py-2">
      {loading ? (
        <div className="px-1"><ListSkeleton count={8} compact /></div>
      ) : visibleSessions.length === 0 ? (
        <p className="text-zinc-500 text-sm px-3 py-2">No sessions found.</p>
      ) : (
        <div>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.label);
            const groupUnreadCount = group.sessions.filter((s) => isUnread(s, readState)).length;
            return (
              <div key={group.label}>
                <button
                  onClick={() => toggleCollapse(group.label)}
                  className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <svg
                    className={`w-2.5 h-2.5 transition-transform shrink-0 ${isCollapsed ? "" : "rotate-90"}`}
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path d="M6 4l8 6-8 6V4z" />
                  </svg>
                  <span className="truncate">{group.label}</span>
                  <span className="font-normal text-zinc-600 normal-case tracking-normal shrink-0">
                    {group.sessions.length}
                  </span>
                  {groupUnreadCount > 0 && (
                    <span className="font-normal text-blue-400 normal-case tracking-normal shrink-0">
                      {groupUnreadCount}
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <div>
                    {group.sessions.map((s) => {
                      const sessionKey = `${s.projectSlug}/${s.id}`;
                      const unread = isUnread(s, readState);
                      const splitHookNotif = hookNotifs[sessionKey];
                      const isSelected = selectedSlug === s.projectSlug && selectedId === s.id;
                      return (
                        <button
                          key={sessionKey}
                          onClick={() => selectSession(s)}
                          className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors group ${
                            isSelected
                              ? "bg-zinc-700"
                              : "hover:bg-zinc-800"
                          }`}
                        >
                          {splitHookNotif ? (
                            <span
                              title={
                                splitHookNotif.type === "stop"
                                  ? unread
                                    ? "Completed (unread)"
                                    : "Completed (read)"
                                  : splitHookNotif.type === "permission"
                                  ? splitHookNotif.tool
                                    ? `Permission needed: ${splitHookNotif.tool}`
                                    : "Permission needed"
                                  : "Notification"
                              }
                              className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${
                                splitHookNotif.type === "stop"
                                  ? unread
                                    ? "bg-green-400"
                                    : "bg-zinc-500"
                                  : splitHookNotif.type === "permission"
                                  ? "bg-red-400 animate-pulse"
                                  : "bg-amber-400"
                              }`}
                            />
                          ) : unread ? (
                            <span title="Unread" className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 mt-1.5" />
                          ) : (
                            <span className="w-1.5 h-1.5 shrink-0" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-xs truncate ${isSelected ? "text-white" : "text-zinc-300 group-hover:text-white"}`}
                              title={s.title ?? s.firstUserMessage ?? undefined}
                            >
                              {s.title ?? s.firstUserMessage ?? (
                                <span className="italic text-zinc-500">Untitled</span>
                              )}
                            </div>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className="text-xs text-zinc-600 truncate font-mono text-[10px]"
                                title={s.projectDisplayPath}
                              >
                                {s.projectDisplayPath}
                              </span>
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[10px] text-zinc-600">{timeAgo(s.lastActivity)}</div>
                            <div className="text-[10px] text-zinc-600">{s.messageCount}m</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  if (layoutMode === "split") {
    return (
      <div className="flex flex-col h-screen overflow-hidden w-full">
        {/* Top bar — sticky */}
        <div className="shrink-0 px-4 pt-4 pb-3 border-b border-zinc-800">
          {/* Mobile: single row (hamburger + controls). Desktop: two rows (nav + controls). */}
          <div className="flex items-center gap-2 md:block md:space-y-3">
            <DashboardNav
              projects={projects}
              unreadCount={unreadCount}
              unreadCounts={unreadCountsPerProject}
              selectedSlugs={selectedSlugs}
              onSelectedChange={setSelectedSlugs}
              refreshCount={refreshCount}
            />
            <div className="flex-1 min-w-0">{controlsBar}</div>
          </div>
        </div>

        {/* Split pane */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: session list */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-950">
            {splitSessionList}
          </div>

          {/* Right: transcript */}
          <div className="flex-1 overflow-hidden bg-zinc-950">
            {selectedSlug && selectedId ? (
              <TranscriptPanel
                slug={selectedSlug}
                id={selectedId}
                onReadStateChange={loadData}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
                Select a session to view the transcript
              </div>
            )}
          </div>
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-700 text-zinc-100 text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none">
            {toast}
          </div>
        )}
      </div>
    );
  }

  // List mode (default)
  return (
    <div className="w-full">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl w-full mx-auto px-4 pt-3 pb-2">
          {/* Mobile: single row (hamburger + controls). Desktop: two rows (nav + controls). */}
          <div className="flex items-center gap-2 md:block">
            <DashboardNav
              projects={projects}
              unreadCount={unreadCount}
              unreadCounts={unreadCountsPerProject}
              selectedSlugs={selectedSlugs}
              onSelectedChange={setSelectedSlugs}
              refreshCount={refreshCount}
            />
            <div className="flex-1 min-w-0">{controlsBar}</div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div>
      <div className="max-w-5xl w-full mx-auto px-4 py-4">
      <section>
        {loading ? (
          <ListSkeleton />
        ) : visibleSessions.length === 0 ? (
          <p className="text-zinc-500 text-sm">No sessions found.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.label);
              const groupUnreadCount = group.sessions.filter((s) => isUnread(s, readState)).length;
              return (
                <div key={group.label}>
                  <div
                    className="items-center gap-2 mb-1.5"
                    style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", width: "100%" }}
                  >
                    <button
                      onClick={() => toggleCollapse(group.label)}
                      className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path d="M6 4l8 6-8 6V4z" />
                      </svg>
                      {group.label}
                      <span className="font-normal text-zinc-600 normal-case tracking-normal">
                        {group.sessions.length}
                      </span>
                      {groupUnreadCount > 0 && (
                        <span className="font-normal text-blue-400 normal-case tracking-normal">
                          {groupUnreadCount} unread
                        </span>
                      )}
                    </button>
                    <div className="h-px bg-zinc-800 w-full" />
                    <div className="flex gap-1">
                      <button
                        onClick={() => markGroup(group.sessions, false)}
                        className="text-xs px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        Mark read
                      </button>
                      <button
                        onClick={() => markGroup(group.sessions, true)}
                        className="text-xs px-2 py-0.5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                      >
                        Mark unread
                      </button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="flex flex-col gap-1">
                      {group.sessions.map((s) => {
                        const sessionKey = `${s.projectSlug}/${s.id}`;
                        const isExpanded = expandedSessions.has(sessionKey);
                        const tail = tailCache[sessionKey];
                        const tailFailed = tailErrors.has(sessionKey);
                        const unread = isUnread(s, readState);
                        const hookNotif = hookNotifs[sessionKey];
                        const ctxPct = s.lastInputTokens != null ? Math.min(Math.round(s.lastInputTokens / CONTEXT_WINDOW * 100), 100) : null;
                        return (
                          <div
                            key={sessionKey}
                            ref={(el) => {
                              if (el) itemRefs.current.set(sessionKey, el);
                              else itemRefs.current.delete(sessionKey);
                            }}
                            className={`rounded-lg overflow-hidden ${
                              hookNotif?.type === "permission" && unread
                                ? "bg-red-950/40 ring-1 ring-red-500/50"
                                : "bg-zinc-900"
                            }`}
                          >
                            <div className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-800 transition-colors group">
                              {hookNotif ? (
                                <HookBadge type={hookNotif.type} read={!unread} tool={hookNotif.tool} />
                              ) : unread ? (
                                <span title="Unread" className="w-2 h-2 rounded-full bg-blue-400 shrink-0 mt-1" />
                              ) : (
                                <span className="w-2 h-2 shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                {/* Row 1: title + time-ago */}
                                <div className="flex items-start justify-between gap-2">
                                  <Link
                                    href={`/projects/${encodeURIComponent(s.projectSlug)}/sessions/${encodeURIComponent(s.id)}?from=sessions`}
                                    className="flex-1 min-w-0"
                                    onClick={() => sessionStorage.setItem("sessions-scroll-y", String(window.scrollY))}
                                  >
                                    <div className="text-sm text-zinc-200 group-hover:text-white truncate">
                                      {s.title ?? s.firstUserMessage ?? (
                                        <span className="italic text-zinc-500">Untitled</span>
                                      )}
                                    </div>
                                  </Link>
                                  <span className="text-xs text-zinc-600 shrink-0 mt-0.5">{timeAgo(s.lastActivity)}</span>
                                </div>
                                {/* Row 2: path + msgs + ctx + actions */}
                                <div className="flex items-center justify-between gap-1 mt-0.5">
                                  <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                                    <span className="text-xs text-zinc-500 truncate font-mono">{s.projectDisplayPath}</span>
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyId(s.id); }}
                                      title="Copy session ID"
                                      className="shrink-0 text-zinc-700 hover:text-zinc-300 transition-colors opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                      </svg>
                                    </button>
                                    <span className="text-xs text-zinc-600 shrink-0">{s.messageCount} msgs</span>
                                    {ctxPct !== null && (
                                      <span className={`text-xs shrink-0 tabular-nums ${ctxPct >= 75 ? "text-orange-500" : "text-zinc-600"}`}>{ctxPct}% ctx</span>
                                    )}
                                    {s.totalTokensBurned > 0 && (
                                      <BurnedTokensTooltip {...s.tokenBreakdown}>
                                        <span className="text-xs text-zinc-600 shrink-0 tabular-nums">{fmtTokens(s.totalTokensBurned)} burned</span>
                                      </BurnedTokensTooltip>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); markSession(s, !unread); }}
                                      title={unread ? "Mark read" : "Mark unread"}
                                      className="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                                    >
                                      {unread ? (
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M3 8v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8" />
                                          <path d="M3 8 12 3l9 5" />
                                          <path d="M3 8l7 4.5" />
                                          <path d="M21 8l-7 4.5" />
                                        </svg>
                                      ) : (
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                          <rect x="3" y="5" width="18" height="14" rx="2" />
                                          <path d="m3 7 9 6 9-6" />
                                        </svg>
                                      )}
                                    </button>
                                    <button
                                      onClick={() => toggleTail(sessionKey, s.projectSlug, s.id)}
                                      title="Preview tail"
                                      className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
                                    >
                                      <svg
                                        className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                        fill="currentColor"
                                        viewBox="0 0 20 20"
                                      >
                                        <path d="M6 4l8 6-8 6V4z" />
                                      </svg>
                                    </button>
                                    <div
                                      className="relative"
                                      ref={(el) => {
                                        if (el) menuRefs.current.set(sessionKey, el);
                                        else menuRefs.current.delete(sessionKey);
                                      }}
                                    >
                                      <button
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          if (openMenuKey === sessionKey) {
                                            setOpenMenuKey(null);
                                          } else {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                                            setOpenMenuKey(sessionKey);
                                          }
                                        }}
                                        title="More actions"
                                        className={`p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors relative ${
                                          openMenuKey === sessionKey ? "opacity-100 bg-zinc-800 text-zinc-100" : "opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                                        }`}
                                      >
                                        {monitorActiveSessions.has(s.id) && (
                                          <span className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full bg-green-400" />
                                        )}
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                                          <circle cx="5" cy="12" r="1.8" />
                                          <circle cx="12" cy="12" r="1.8" />
                                          <circle cx="19" cy="12" r="1.8" />
                                        </svg>
                                      </button>
                                      {openMenuKey === sessionKey && menuPos && typeof document !== "undefined" &&
                                        createPortal(
                                          <div
                                            ref={menuPanelRef}
                                            style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}
                                            className="z-50 min-w-[9rem] bg-zinc-900 border border-zinc-700 rounded-lg shadow-lg py-1"
                                          >
                                            <button
                                              onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setOpenMenuKey(null);
                                                openSendModal(s);
                                              }}
                                              className="w-full text-left text-xs px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                            >
                                              {monitorActiveSessions.has(s.id) && (
                                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                                              )}
                                              Send message
                                            </button>
                                          </div>,
                                          document.body
                                        )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {ctxPct !== null && (
                              <div className="h-0.5 bg-zinc-800">
                                <div className={`h-full ${contextBarColor(ctxPct)}`} style={{ width: `${ctxPct}%` }} />
                              </div>
                            )}
                            {isExpanded && (
                              <div className="border-t border-zinc-800">
                                {tail && tail.length > 0 && (tailSize[sessionKey] ?? 5) < s.messageCount && (
                                  <button
                                    onClick={() => loadMoreTail(sessionKey, s.projectSlug, s.id, s.messageCount)}
                                    className="w-full px-4 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors text-center border-b border-zinc-800"
                                  >
                                    ↑ Load more ({s.messageCount - (tailSize[sessionKey] ?? 5)} earlier messages)
                                  </button>
                                )}
                                <div className="px-4 py-3 space-y-2.5">
                                  {tailFailed ? (
                                    <p className="text-xs text-zinc-600">Couldn&apos;t load this session — it may have been deleted or moved.</p>
                                  ) : !tail ? (
                                    <p className="text-xs text-zinc-600">Loading…</p>
                                  ) : tail.length === 0 ? (
                                    <p className="text-xs text-zinc-600">No messages</p>
                                  ) : (
                                    tail.map((msg, i) => (
                                      <div key={i} className="flex gap-2 items-start">
                                        <span className={`shrink-0 text-xs font-mono px-1.5 py-0.5 rounded leading-none mt-px ${
                                          msg.type === "user"
                                            ? "bg-zinc-700 text-zinc-300"
                                            : "bg-zinc-800 text-blue-400"
                                        }`}>
                                          {msg.type === "user" ? "U" : "A"}
                                        </span>
                                        <div className="prose prose-xs prose-invert max-w-none text-xs text-zinc-400
                                          prose-p:my-0.5 prose-p:leading-relaxed
                                          prose-headings:text-zinc-300 prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-0.5
                                          prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-300 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                                          prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-xs
                                          prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0
                                          prose-strong:text-zinc-300
                                          prose-a:text-blue-400 prose-a:no-underline
                                          break-words min-w-0 overflow-hidden">
                                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                            {msg.text}
                                          </ReactMarkdown>
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-700 text-zinc-100 text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none">
          Session ID copied to clipboard
        </div>
      )}

      {sendModalSession && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={closeSendModal}
        >
          <div
            className="bg-zinc-900 rounded-xl border border-zinc-700 p-6 w-full max-w-lg mx-4 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold text-zinc-200">Send message to session</h3>
              <p className="text-xs text-zinc-500 mt-1 font-mono truncate">
                {sendModalSession.title ?? sendModalSession.firstUserMessage ?? sendModalSession.id}
              </p>
              <p className="text-xs text-zinc-600 mt-0.5 font-mono">{sendModalSession.id}</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-zinc-400">
                Step 1 — paste this Monitor tool call into your Claude Code session:
              </p>
              <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-3 flex items-start gap-2">
                <pre className="text-xs text-zinc-300 font-mono flex-1 leading-relaxed overflow-x-auto whitespace-pre">
                  {buildMonitorToolCall(sendModalSession.id)}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildMonitorToolCall(sendModalSession.id));
                    setToast("Copied to clipboard");
                    setTimeout(() => setToast(null), 2000);
                  }}
                  title="Copy tool call"
                  className="shrink-0 text-xs px-2 py-1 rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                >
                  Copy
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-zinc-400">
                Step 2 — type your message:
              </p>
              <textarea
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSendMessage(); }}
                placeholder="Type your message… (Ctrl+Enter to send)"
                rows={3}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 resize-none focus:outline-none focus:border-blue-500"
                autoFocus
              />
            </div>

            {sendResult === "sent" && (
              <p className="text-xs text-green-400">Message appended to session inbox.</p>
            )}
            {sendError !== null && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-lg p-3">
                <p className="text-xs text-red-300">{sendError}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={closeSendModal}
                disabled={sendLoading}
                className="text-xs px-3 py-1.5 rounded text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50"
              >
                Close
              </button>
              <button
                onClick={handleSendMessage}
                disabled={sendLoading || !sendMessage.trim()}
                className="text-xs px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sendLoading ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={null}>
      <SessionsPageInner />
    </Suspense>
  );
}
