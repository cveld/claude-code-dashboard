"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDataRefresh } from "@/app/lib/useDataRefresh";

interface TranscriptMessage {
  type: "user" | "assistant" | "system" | "other";
  timestamp: string | null;
  text: string;
  uuid?: string;
}

interface SessionStats {
  currentContext: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  assistantTurns: number;
  contextWindowSize: number;
}

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function contextBarColor(pct: number): string {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 75) return "bg-orange-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-blue-500";
}

function StatsBar({ stats }: { stats: SessionStats }) {
  const pct = Math.round((stats.currentContext / stats.contextWindowSize) * 100);
  const cacheTotal = stats.totalCacheCreation + stats.totalCacheRead;
  const cacheHitPct = cacheTotal > 0 ? Math.round((stats.totalCacheRead / cacheTotal) * 100) : null;

  return (
    <div className="mt-2 pt-2 border-t border-zinc-800 flex items-center gap-4">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-xs text-zinc-500 shrink-0">Context</span>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full min-w-[40px]">
          <div
            className={`h-full rounded-full transition-all ${contextBarColor(pct)}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-xs text-zinc-400 shrink-0 tabular-nums">
          {fmtTokens(stats.currentContext)}/{fmtTokens(stats.contextWindowSize)} ({pct}%)
        </span>
      </div>
      <span className="text-xs text-zinc-500 shrink-0">
        Out <span className="text-zinc-300 tabular-nums">{fmtTokens(stats.totalOutputTokens)}</span>
      </span>
      {cacheHitPct !== null && (
        <span className="text-xs text-zinc-500 shrink-0">
          Cache <span className="text-zinc-300 tabular-nums">{cacheHitPct}%</span>
        </span>
      )}
      <span className="text-xs text-zinc-500 shrink-0">
        Turns <span className="text-zinc-300 tabular-nums">{stats.assistantTurns}</span>
      </span>
    </div>
  );
}

function isNearBottom(el: HTMLElement, threshold = 120) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

export default function SessionPage() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const searchParams = useSearchParams();
  const backHref = searchParams.get("from") === "sessions" ? "/sessions" : `/projects/${slug}`;
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  const [displayPath, setDisplayPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [isRead, setIsRead] = useState(false);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const readStateKey = `${decodeURIComponent(slug)}/${id}`;

  function copyId() {
    navigator.clipboard.writeText(id);
    setToast("Session ID copied");
    setTimeout(() => setToast(null), 2000);
  }

  function copyPath() {
    if (!displayPath) return;
    navigator.clipboard.writeText(displayPath);
    setToast("Path copied");
    setTimeout(() => setToast(null), 2000);
  }

  async function toggleRead() {
    const nowRead = !isRead;
    setIsRead(nowRead);
    await fetch("/api/read-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        nowRead
          ? { slug: readStateKey }
          : { slug: readStateKey, unread: true }
      ),
    });
  }

  const loadTranscript = useCallback(() => {
    const wasNearBottom = scrollRef.current ? isNearBottom(scrollRef.current) : false;
    fetch(`/api/projects/${slug}/sessions/${id}`)
      .then((r) => r.json())
      .then((transcript) => {
        setMessages(transcript.messages ?? []);
        if (wasNearBottom) {
          setTimeout(() => {
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
          }, 50);
        }
      });
  }, [slug, id]);

  useEffect(() => {
    fetch(`/api/projects/${slug}/sessions/${id}/stats`)
      .then((r) => r.json())
      .then((s) => { if (!s.error) setStats(s); });
  }, [slug, id]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/projects/${slug}/sessions/${id}`).then((r) => r.json()),
      fetch(`/api/projects/${slug}/sessions`).then((r) => r.json()),
      fetch("/api/read-state").then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/projects").then((r) => r.json()),
    ]).then(([transcript, sessions, readState, settings, projects]) => {
      setMessages(transcript.messages ?? []);
      const session = Array.isArray(sessions) ? sessions.find((s: { id: string; title: string | null; lastActivity: string }) => s.id === id) : null;
      setTitle(session?.title ?? null);
      const project = Array.isArray(projects) ? projects.find((p: { slug: string; displayPath: string }) => p.slug === decodeURIComponent(slug)) : null;
      setDisplayPath(project?.displayPath ?? null);

      const readTimestamp: string | undefined = readState[readStateKey];
      const lastActivity: string = session?.lastActivity ?? "";
      const currentlyRead = !!readTimestamp && (!lastActivity || readTimestamp >= lastActivity);
      setIsRead(currentlyRead);

      if (settings?.autoMarkAsRead && !currentlyRead) {
        fetch("/api/read-state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: readStateKey }),
        });
        setIsRead(true);
      }

      setLoading(false);
    });
  }, [slug, id, readStateKey]);

  useDataRefresh(loadTranscript);

  useEffect(() => {
    if (!loading) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [loading]);

  return (
    <div className="flex flex-col h-screen">
      <div className="shrink-0 bg-zinc-950 border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Link href={backHref} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← Sessions</Link>
              {title && <h1 className="text-lg font-semibold text-white mt-1">{title}</h1>}
              {displayPath && (
                <div className="flex items-center gap-1 mt-0.5 min-w-0">
                  <Link
                    href={`/projects/${slug}?highlight=${id}`}
                    className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors truncate"
                  >
                    {displayPath}
                  </Link>
                  <button
                    onClick={copyPath}
                    title="Copy path"
                    className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs font-mono text-zinc-600 break-all">{id}</span>
                <button
                  onClick={copyId}
                  title="Copy session ID"
                  className="shrink-0 text-zinc-600 hover:text-zinc-300 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </div>
            {!loading && (
              <button
                onClick={toggleRead}
                className={`shrink-0 mt-1 text-xs px-3 py-1.5 rounded-md border transition-colors ${
                  isRead
                    ? "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                    : "border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-200"
                }`}
              >
                {isRead ? "Mark as unread" : "Mark as read"}
              </button>
            )}
          </div>
          {stats && <StatsBar stats={stats} />}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto px-4 py-8">

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : messages.length === 0 ? (
        <p className="text-zinc-500 text-sm">No messages in this session.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {messages.map((msg, i) => (

            <div
              key={msg.uuid ?? i}
              className={`flex gap-3 ${msg.type === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              <div className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                msg.type === "user"
                  ? "bg-blue-700 text-white"
                  : "bg-zinc-700 text-zinc-300"
              }`}>
                {msg.type === "user" ? "U" : "C"}
              </div>
              <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm break-words ${
                msg.type === "user"
                  ? "bg-blue-900 text-zinc-100"
                  : "bg-zinc-800 text-zinc-200"
              }`}>
                {msg.type === "user" ? (
                  <div className="prose prose-sm prose-invert max-w-none
                    prose-p:my-1 prose-code:bg-blue-950 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-blue-950 prose-pre:border prose-pre:border-blue-900 prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto
                    prose-headings:text-zinc-100 prose-strong:text-zinc-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none
                    prose-p:my-1 prose-p:leading-relaxed
                    prose-headings:text-zinc-100 prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1
                    prose-code:bg-zinc-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-zinc-200 prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                    prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded-lg prose-pre:p-3 prose-pre:overflow-x-auto
                    prose-ul:my-1 prose-ol:my-1 prose-li:my-0
                    prose-strong:text-zinc-100
                    prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
                    prose-blockquote:border-zinc-600 prose-blockquote:text-zinc-400
                    prose-hr:border-zinc-700">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        table: ({ children }) => (
                          <div className="overflow-x-auto my-2">
                            <table className="text-xs border-collapse w-full">{children}</table>
                          </div>
                        ),
                        th: ({ children }) => (
                          <th className="border border-zinc-600 px-3 py-1.5 text-left font-semibold text-zinc-200 bg-zinc-700">{children}</th>
                        ),
                        td: ({ children }) => (
                          <td className="border border-zinc-600 px-3 py-1.5 text-zinc-300">{children}</td>
                        ),
                        tr: ({ children }) => (
                          <tr className="even:bg-zinc-750">{children}</tr>
                        ),
                      }}
                    >{msg.text}</ReactMarkdown>
                  </div>
                )}
                {msg.timestamp && (
                  <div className="mt-2 text-xs text-zinc-600">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-700 text-zinc-100 text-xs px-4 py-2 rounded-full shadow-lg pointer-events-none">
          {toast}
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
