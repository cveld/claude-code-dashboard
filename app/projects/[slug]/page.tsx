"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { HookEvent } from "@/app/lib/dashboard";
import { useDataRefresh } from "@/app/lib/useDataRefresh";

interface SessionInfo {
  id: string;
  title: string | null;
  startedAt: string | null;
  messageCount: number;
  firstUserMessage: string | null;
  lastActivity: string;
  lastInputTokens: number | null;
}

const CONTEXT_WINDOW = 200000;

function contextBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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

function HookBadge({ type }: { type: "stop" | "notification" }) {
  if (type === "stop") {
    return (
      <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center shrink-0">
        <IconCheck />
      </span>
    );
  }
  return (
    <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
      <IconBell />
    </span>
  );
}

export default function ProjectPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get("highlight");
  const [flashId, setFlashId] = useState<string | null>(highlightId);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [readState, setReadState] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [showUnreadOnly, setShowUnreadOnly] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("show-unread-only") === "true"
  );
  const [sortAsc, setSortAsc] = useState(() =>
    typeof window !== "undefined" && localStorage.getItem("sort-asc") === "true"
  );
  const [hookNotifs, setHookNotifs] = useState<Record<string, HookEvent>>({});

  useEffect(() => { localStorage.setItem("sort-asc", String(sortAsc)); }, [sortAsc]);
  useEffect(() => { localStorage.setItem("show-unread-only", String(showUnreadOnly)); }, [showUnreadOnly]);

  useEffect(() => {
    if (loading || !flashId) return;
    const el = document.getElementById(flashId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFlashId(null), 1500);
    return () => clearTimeout(t);
  }, [loading, flashId]);

  const loadData = useCallback(() => {
    Promise.all([
      fetch(`/api/projects/${slug}/sessions`).then((r) => r.json()),
      fetch("/api/read-state").then((r) => r.json()),
    ]).then(([data, rs]) => {
      setSessions(data);
      setReadState(rs);
      setLoading(false);
    });
  }, [slug]);

  useEffect(() => {
    loadData();
    fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: decodeURIComponent(slug) }),
    });
  }, [slug, loadData]);

  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const handleHookEvent = useCallback((event: HookEvent) => {
    if (event.projectSlug !== decodeURIComponent(slug)) return;
    const key = event.sessionId;
    setHookNotifs((prev) => ({ ...prev, [key]: event }));

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      const body =
        event.type === "stop"
          ? `Klaar: ${event.title || event.projectSlug || "sessie"}`
          : event.message || "Aandacht nodig";
      new Notification("Claude Code", { body, silent: true });
    }
  }, [slug]);

  useDataRefresh(loadData, handleHookEvent);

  async function markSession(sessionKey: string, unread: boolean) {
    await fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slugs: [sessionKey], unread }),
    });
    setReadState((prev) => {
      const next = { ...prev };
      if (unread) {
        delete next[sessionKey];
      } else {
        next[sessionKey] = new Date().toISOString();
      }
      return next;
    });
  }

  const displayPath = decodeURIComponent(slug)
    .replace(/^([a-zA-Z])--/, "$1:\\")
    .replace(/-/g, "\\");

  const filteredSessions = showUnreadOnly
    ? sessions.filter((s) => {
        const sessionKey = `${decodeURIComponent(slug)}/${s.id}`;
        return !readState[sessionKey] || s.lastActivity > readState[sessionKey];
      })
    : sessions;
  const visibleSessions = sortAsc ? [...filteredSessions].reverse() : filteredSessions;

  return (
    <div className="h-screen flex flex-col overflow-hidden w-full">
      {/* Sticky header */}
      <div className="shrink-0 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-5xl w-full mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← All projects</Link>
              <h1 className="text-sm font-bold mt-0.5 font-mono text-zinc-100 truncate">{displayPath}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-4">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-semibold">
                Sessions
                {!loading && <span className="ml-1.5 normal-case font-normal text-zinc-600">{visibleSessions.length}</span>}
              </span>
              <button
                onClick={() => setSortAsc((a) => !a)}
                className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
              >
                {sortAsc ? "↑ Oldest first" : "↓ Newest first"}
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
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl w-full mx-auto px-4 py-4">
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : visibleSessions.length === 0 ? (
        <p className="text-zinc-500 text-sm">{showUnreadOnly ? "No unread sessions." : "No sessions found."}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {visibleSessions.map((s) => {
            const sessionKey = `${decodeURIComponent(slug)}/${s.id}`;
            const isUnread = !readState[sessionKey] || s.lastActivity > readState[sessionKey];
            const hookNotif = hookNotifs[s.id];
            const ctxPct = s.lastInputTokens != null ? Math.min(Math.round(s.lastInputTokens / CONTEXT_WINDOW * 100), 100) : null;
            return (
            <div
              key={s.id}
              id={s.id}
              className={`rounded-lg overflow-hidden transition-colors duration-1000 ${
                s.id === flashId ? "bg-amber-900/50" : "bg-zinc-900"
              }`}
            >
              <div className="flex items-stretch group hover:bg-zinc-800 transition-colors">
                <Link
                  href={`/projects/${slug}/sessions/${s.id}`}
                  className="flex items-start gap-4 px-4 py-3 flex-1 min-w-0"
                >
                  <div className="mt-1.5 shrink-0">
                    {hookNotif ? (
                      <HookBadge type={hookNotif.type} />
                    ) : isUnread ? (
                      <span className="w-2 h-2 rounded-full bg-blue-400 block" />
                    ) : (
                      <span className="w-2 h-2 block" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    {s.title ? (
                      <div className="text-sm font-semibold text-white truncate mb-0.5">{s.title}</div>
                    ) : null}
                    {s.firstUserMessage ? (
                      <div className={`text-sm truncate ${s.title ? "text-zinc-500" : "text-zinc-300 group-hover:text-white"}`}>{s.firstUserMessage}</div>
                    ) : !s.title ? (
                      <div className="text-sm text-zinc-600 italic">No user messages</div>
                    ) : null}
                    <div className="font-mono text-xs text-zinc-700 mt-0.5">{s.id}</div>
                  </div>
                </Link>
                <div className="flex items-start gap-2 shrink-0 px-4 py-3">
                  <button
                    onClick={() => markSession(sessionKey, !isUnread)}
                    title={isUnread ? "Mark read" : "Mark unread"}
                    className="text-xs text-zinc-600 hover:text-zinc-200 transition-colors opacity-0 group-hover:opacity-100 whitespace-nowrap mt-0.5"
                  >
                    {isUnread ? "Mark read" : "Mark unread"}
                  </button>
                  <div className="text-right">
                    <div className="text-sm text-zinc-400">{s.messageCount} lines</div>
                    <div className="text-xs text-zinc-600">{timeAgo(s.lastActivity)}</div>
                    {ctxPct !== null && (
                      <div className="text-xs text-zinc-600 mt-0.5">{ctxPct}% ctx</div>
                    )}
                  </div>
                </div>
              </div>
              {ctxPct !== null && (
                <div className="h-0.5 bg-zinc-800">
                  <div className={`h-full ${contextBarColor(ctxPct)}`} style={{ width: `${ctxPct}%` }} />
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
